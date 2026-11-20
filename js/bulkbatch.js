/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// "Take all back" (bulk C, 2026-11-20), the part with no screen and no store:
// what this phone remembers of each Add from the planner's list (a batch),
// and the plan for taking one back with what the store already offers
// (js/takeback.js runs it; js/views/bulkadd.js and js/views/history.js show
// the row).
//
// A batch: { at, n, off, items, removed, stops, stays, prints, back }:
// when it was added (ISO), how many tickets and how many old pictures it
// took off, the ids of the pictures it added (saved or waiting on the phone),
// one list per ticket (a PDF's pages are one ticket; fix round 1, M2),
// of the old pictures it took off, of the stops and stays it added, a short
// print of each stop it added as the batch left it (8 hex characters, so a
// stop changed since is left alone), and when it was taken back ("" until
// then). Ids, counts and times only: never a name, a reference or a file name.
// Kept newest first, 5 at most, under mat.bulkBatch (cleared with every
// other mat.* key by Forget this phone and a refused key, js/forget.js).
//
// - batchOf(fields) -> a batch, every field checked (ids by shape only).
// - readBatches(text) / writeBatches(list) / loadBatches(storage) /
//   saveBatches(storage, list) (both never throw) / addBatch(list, batch).
// - printOf(stop) -> the stop's print.
// - planOf(batch, state, { unsent }) -> { remove, putBack, stops, stays, blocked }.
// - stopFree(id, batch, state, { removing }) -> the stop can go: there, as
//   the batch left it, no picture on it but the batch's own being taken off.
// - resultText(...) / rowText(batch, where) -> the words.

import { clock, dayHead, localDay } from "./format.js";

export const BATCH_KEY = "mat.bulkBatch";
export const BATCH_MAX = 5;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,39}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const PRINT = /^[0-9a-f]{8}$/;
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const ids = (v) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && ID.test(x)))].slice(0, 200);
const count = (v) => (Number.isInteger(v) && v >= 0 && v <= 10000 ? v : 0);
// Its tickets, each a list of picture ids; an older record's flat `tickets` is one picture each.
const itemsOf = (o) => {
  const seen = new Set();
  const raw = Array.isArray(o.items) ? o.items : Array.isArray(o.tickets) ? o.tickets.map((id) => [id]) : [];
  return raw.slice(0, 120).map((one) => ids(one).filter((id) => !seen.has(id) && seen.add(id))).filter((one) => one.length);
};
// Every picture id of a batch.
export const picturesOf = (b) => b.items.flat();

export function batchOf(o = {}) {
  const prints = {};
  const stops = ids(o.stops);
  for (const id of stops) if (o.prints && typeof o.prints[id] === "string" && PRINT.test(o.prints[id])) prints[id] = o.prints[id];
  return {
    at: typeof o.at === "string" && ISO.test(o.at) ? o.at : "",
    n: count(o.n),
    off: count(o.off),
    items: itemsOf(o),
    removed: ids(o.removed),
    stops,
    stays: ids(o.stays),
    prints,
    back: typeof o.back === "string" && ISO.test(o.back) ? o.back : "",
  };
}

export function readBatches(text) {
  try {
    const v = JSON.parse(text || "[]");
    return (Array.isArray(v) ? v : []).filter((b) => b && typeof b === "object").map(batchOf).filter((b) => b.at).slice(0, BATCH_MAX);
  } catch {
    return [];
  }
}
export const writeBatches = (list) => JSON.stringify((list || []).slice(0, BATCH_MAX).map(batchOf));
export const addBatch = (list, batch) => [batchOf(batch)].concat((list || []).filter((b) => b.at !== batch.at)).slice(0, BATCH_MAX);

export function loadBatches(storage) {
  try {
    return readBatches(storage ? storage.getItem(BATCH_KEY) : null);
  } catch {
    return [];
  }
}
export function saveBatches(storage, list) {
  try {
    if (storage) storage.setItem(BATCH_KEY, writeBatches(list));
    return true;
  } catch {
    return false; // kept for this visit only
  }
}

// The fields a person (or the list's facts) can change on a stop, as one short print.
const PRINTED = ["date", "time", "title", "detail", "gettingThere", "note", "link", "photo", "place", "signJp", "booked", "fixed", "tkRef", "tkName", "tkSeat"];
export function printOf(stop) {
  const s = PRINTED.map((k) => {
    const v = stop ? stop[k] : "";
    return v === true ? "1" : v === false || v === undefined || v === null ? "" : String(v).trim();
  }).join("\u0001");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const live = (state) => (state.tickets || []).filter((t) => t && !t.gone);

export function stopFree(id, batch, state, { removing = [] } = {}) {
  const st = (state.stops || []).find((x) => x && x.id === id);
  if (!st || st.deleted) return false;
  if (!batch.prints[id] || printOf(st) !== batch.prints[id]) return false;
  const going = new Set(removing);
  return !live(state).some((t) => t.stop === id && !going.has(t.id));
}

// The plan: the batch's pictures still on the trip come off, then the old
// ones it took off are put back (from History), then the stops it added
// that hold nothing else go. A stay it added is left on. With no signal and
// anything of it already sent, nothing is tried (blocked).
// Run again after a part failed (fix round 1, I1), it does only what is left:
// the pictures still on, the old ones not back yet, the stops still there.
export function planOf(batch, state, { unsent = new Set() } = {}) {
  const on = new Set(live(state).map((t) => t.id));
  const remove = picturesOf(batch).filter((id) => on.has(id));
  const putBack = batch.removed.filter((id) => !on.has(id));
  const stops = batch.stops.filter((id) => stopFree(id, batch, state, { removing: remove }));
  const stays = batch.stays.filter((id) => (state.stays || []).some((x) => x && x.id === id && !x.deleted)).length;
  const sent = remove.some((id) => !unsent.has(id)) || putBack.length > 0 || stops.length > 0;
  return { remove, putBack, stops, stays, blocked: state.online === false && sent };
}

// The tickets of a batch now off the trip (every picture of each), counted in tickets.
export function ticketsBack(batch, isOn) {
  return batch.items.filter((one) => one.every((id) => !isOn(id))).length;
}

export const NO_SIGNAL = "No signal. Take it back from History when there is signal.";
export const NOT_LOOKED_UP = "The old pictures couldn’t be looked up, so nothing was taken back. Try again.";

// back: the batch's tickets now off the trip, of total (tickets, not pages);
// put: old pictures put back; lost: old pictures History can no longer put
// back; done: nothing is left to try (else the row keeps its button).
export function resultText({ total = 0, back = 0, put = 0, lost = 0, stays = 0, done = true } = {}) {
  let t;
  if (!total) t = "Taken back.";
  else if (back >= total) t = "Taken back: " + plural(total, "ticket", "tickets") + ".";
  else t = "Taken back " + back + " of " + total + ".";
  if (put) t += " " + plural(put, "old picture", "old pictures") + " put back.";
  if (!done) return t + " Try again for the rest.";
  if (lost) t += " The rest have their own line in History.";
  if (stays) t += stays === 1 ? " The stay it added is left on." : " The stays it added are left on.";
  return t;
}

// The batch's row: { time, title, small, undone }. where: "sheet" (the added screen) or "history".
export function rowText(batch, where = "history") {
  const at = Date.parse(batch.at);
  const title = batch.n ? plural(batch.n, "ticket", "tickets") + " from the list" : plural(batch.off, "picture", "pictures") + " taken off, from the list";
  let small;
  if (batch.back) small = "taken back at " + clock(Date.parse(batch.back));
  else if (where === "sheet") small = "also in History";
  else small = "added from this phone · " + dayHead(localDay(at), []).en;
  return { time: isFinite(at) ? clock(at) : "", title, small, undone: !!batch.back };
}
