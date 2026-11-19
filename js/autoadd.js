/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Tickets from the planner's list by themselves (auto-add), the part with no
// screen: the owner's phone has the list's lines and the desk's list of the
// ticket files (store.listTickets) and compares them with the trip's
// pictures by their tie (a picture's `from`, the Tickets tab's planner_id:
// "<ticket id>:<print>"). js/views/bulkadd.js draws what this finds, in the
// same review as bulk add; nothing goes in before 入鋏. Pure: no DOM, no
// storage, no clock.
//
// - tieOf(ticketId, print): "T007:0123456789ab" (the id's letters and digits only).
// - listPlan({ rows, files, state, skip }) -> { fresh, changed, cancelled, quiet }:
//   fresh: the desk's files for lines with no picture on the trip yet
//     ([{ file, tid, tie }]); changed: [{ key, tid, row, add: [{ file, tie }],
//     drop: [ticket], stop, who }] (a line whose pictures are on the trip but
//     whose file is now another); cancelled: [{ key, tid, row, tickets, why }]
//     (a line not active any more, gone from the list, or with no file, whose
//     pictures are still on); quiet: counts of what is left alone (files not
//     tied to a line, lines outside the trip's days, left out before).
//   skip: Set of ties left out on this phone before, and "keep:<tie>" for
//   pictures kept when asked.
// - byHand(items, tickets) -> { keep, out }: Mo's rule (2026-11-19): a stop
//   someone filled by hand (a picture there with no tie, for the same person
//   or for everyone) gets nothing from the list.
// - noticeText(n) -> the notice's words.

import { idsAtStart } from "./bulk.js";

const str = (v) => (typeof v === "string" ? v.trim() : "");
const low = (v) => str(v).toLowerCase();
export const tidKey = (id) => String(id || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
export const tieOf = (tid, print) => tidKey(tid) + ":" + String(print || "").replace(/[^0-9a-f]/g, "").slice(0, 12);
const tidOfTie = (from) => String(from || "").split(":")[0];
const printOfTie = (from) => String(from || "").split(":")[1] || "";
const KINDS = ["application/pdf", "image/png", "image/jpeg"];

// The first ticket id a file's name starts with (the line its tie names), or "".
export function firstId(name, rows) {
  return idsAtStart(name, rows || [])[0] || "";
}

export function listPlan({ rows = [], files = [], state = {}, skip = new Set() } = {}) {
  const days = new Set((state.days || []).map((d) => d && d.date).filter(Boolean));
  // A tie counts only on a picture the owner (the trip's first person) added: the backend refuses
  // anyone else's, and a stored one from before that is not trusted. The load gives each picture's `by`.
  const owner = state.people && state.people[0] && state.people[0].name;
  const live = (state.tickets || []).filter((t) => t && !t.gone && typeof t.from === "string" && t.from && (!owner || t.by === owner));
  const byTid = new Map();
  for (const t of live) {
    const k = tidOfTie(t.from);
    if (!byTid.has(k)) byTid.set(k, []);
    byTid.get(k).push(t);
  }
  const rowOf = new Map();
  for (const r of rows) if (r && str(r.ticket_id) && !rowOf.has(tidKey(r.ticket_id))) rowOf.set(tidKey(r.ticket_id), r);
  const groups = new Map(); // tid -> desk files whose name starts with it
  const quiet = { unlisted: 0, outside: 0, skipped: 0, noFile: 0 };
  for (const f of files) {
    if (!f || !KINDS.includes(f.mime)) continue;
    const id = firstId(f.name, rows);
    if (!id) {
      quiet.unlisted += 1;
      continue;
    }
    const k = tidKey(id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const fresh = [], changed = [], cancelled = [];
  const tids = [...new Set([...groups.keys(), ...byTid.keys()])].sort();
  for (const tid of tids) {
    const row = rowOf.get(tid) || null;
    const tied = (byTid.get(tid) || []).filter((t) => !skip.has("keep:" + t.from));
    const mine = groups.get(tid) || [];
    const active = !!row && (!str(row.status) || low(row.status) === "active");
    const label = row ? str(row.ticket_id) : tid;
    if (!row || !active || !mine.length) {
      if (!tied.length) continue;
      const why = !row ? "gone" : !active ? "cancelled" : "nofile";
      cancelled.push({ key: "off:" + tid, tid: label, row, tickets: tied, why, status: row ? str(row.status) : "" });
      continue;
    }
    if (!(byTid.get(tid) || []).length) {
      if (!days.has(str(row.start_date))) {
        quiet.outside += 1;
        continue;
      }
      for (const file of mine) {
        const tie = tieOf(tid, file.print);
        if (skip.has(tie)) quiet.skipped += 1;
        else fresh.push({ file, tid: label, tie });
      }
      continue;
    }
    const prints = new Set(mine.map((f) => f.print));
    const tiedPrints = new Set((byTid.get(tid) || []).map((t) => printOfTie(t.from)));
    const add = mine.filter((f) => !tiedPrints.has(f.print)).map((file) => ({ file, tie: tieOf(tid, file.print) })).filter((a) => !skip.has(a.tie));
    const drop = tied.filter((t) => !prints.has(printOfTie(t.from)));
    if (!add.length && !drop.length) continue;
    // Where the new file goes: where the line's pictures are now.
    const at = (drop[0] || tied[0] || (byTid.get(tid) || [])[0]);
    changed.push({ key: "chg:" + tid, tid: label, row, add, drop, stop: at.stop, who: at.who || "" });
  }
  // Active lines on the trip's days with no file and no picture: said in one quiet line.
  for (const [tid, r] of rowOf) {
    if (groups.has(tid) || byTid.has(tid) || (str(r.status) && low(r.status) !== "active") || !days.has(str(r.start_date))) continue;
    quiet.noFile += 1;
  }
  return { fresh, changed, cancelled, quiet };
}

// A stop someone filled by hand: any live picture there with no tie, for the
// same person or for everyone (or any, when the list's is for everyone).
export function byHand(items, tickets) {
  const hand = (tickets || []).filter((t) => t && !t.gone && !t.from);
  const keep = [], out = [];
  for (const it of items) {
    const filled = hand.some((t) => t.stop === it.stop && (!it.who || !t.who || t.who === it.who));
    (filled ? out : keep).push(it);
  }
  return { keep, out };
}

export function noticeText({ fresh = 0, other = 0 } = {}) {
  if (fresh && other) return fresh + (fresh === 1 ? " new ticket" : " new tickets") + " from the list, " + other + " changed";
  if (fresh) return fresh + (fresh === 1 ? " new ticket" : " new tickets") + " from the list";
  if (other) return other + (other === 1 ? " ticket changed" : " tickets changed") + " in the list";
  return "";
}

// The skip list kept on this phone (mat.listSkip): ties only, the newest 400.
export const SKIP_MAX = 400;
export function readSkip(text) {
  try {
    const v = JSON.parse(text || "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length <= 60).slice(-SKIP_MAX) : []);
  } catch {
    return new Set();
  }
}
export const writeSkip = (set) => JSON.stringify([...set].slice(-SKIP_MAX));
