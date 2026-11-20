/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// 一括 Add tickets: many ticket files at once (and the list, a CSV, if you
// have it), opened from You, as option C of the bulk-add mock-up, 検札 the
// ticket check: the sure ones go by in a banded bundle (帯), the odd ones are
// held up one card at a time, and 入鋏 adds them all.
//
// mountBulkAdd(root, store, keep, { onOpenDay(date), onClose() }) -> { open(), close(restoreFocus), isOpen(), isBusy() }
//
// Steps: empty (drop zone, Choose files, Choose list) -> reading -> sorted
// (bundle, cards, the quiet lines, 入鋏) -> adding -> added. Nothing is sent
// before 入鋏. Matching is js/bulk.js. Each picture goes in through the same
// path as one added from a stop's Edit sheet (js/views/ticketpart.js
// upload): put in the keep, store.addTicket, then store.ticketOutcome; a PDF
// is made into pictures of its pages here, as there. After review the phone
// prepares the remaining pages, then keeps and sends each picture in order.
// The stop's still-empty ticket facts follow through store.updateStop. With
// no signal, each handed-over picture waits on the phone across a reload.
//
// The list and the files never leave the phone except as those pictures and
// facts; nothing from them is logged. Text from them goes in with
// textContent; a thumbnail is an <img> of a picture the phone made itself.
// Closing the sheet any way but Cancel keeps what was sorted (or the adding
// going on); Cancel throws it away, Done after adding starts afresh.
//
// Tickets from the list by themselves (auto-add, option A, 2026-11-19): on
// the owner's phone only (store.state.ticketList), the sheet also looks at
// the planner's list and the ticket folder (store.listTickets, at start and
// at most every 10 minutes while MAT is open: maybeCheckList; Check the list
// now: checkList({ force })), compares them with the trip's pictures by their
// tie (js/autoadd.js) and tells You what it found (onList({ text, error })),
// the notice "4 new tickets from the list". Its Check opens this sheet in list
// mode (openList): only the files that need something are fetched, up to two
// at a time (store.listTicketFile), read in list order, and sorted
// in the same review; a changed or cancelled line is a card, never acted on
// by itself; a stop someone filled by hand gets nothing from the list. 入鋏
// adds them through the same path, each with its tie (`from`), and takes off
// the old pictures a card said to (store.removeTicket: soft, undoable). What
// the list brings is held in memory only and wiped with the rest. A line
// left out is remembered on this phone (mat.listSkip: ties only).
//
// A stay's booking (S2 鍵札): a lodging line goes on its stay (js/bulk.js);
// sorted, the stays come first in the untied list under 宿泊, each with the
// 宿 mark; a card may offer to add the stay the line names (store.addStay,
// waited for, before its pictures go up with `stay`); the stays' booking
// facts follow through store.saveStay, only where empty.

import { LIMITS, sniff, shrink, shrinkCanvas, pdfPages } from "../tickets.js";
import { parseList, sortFiles, factsFor, stayFactsFor, seatFor, stopLabel, placeKey, placeOf, spanOf, monthDay, nightsOf } from "../bulk.js";
import { newId } from "../time.js";
import { minutesOf } from "../plan.js";
import { listPlan, byHand, noticeText, readSkip, writeSkip } from "../autoadd.js";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
const btn = (cls, text) => {
  const b = el("button", cls, text);
  b.type = "button";
  return b;
};
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const initial = (name) => ([...String(name || "")][0] || "").toUpperCase();
const isCsv = (f) => /\.csv$/i.test(String(f.name || "")) || f.type === "text/csv";

async function hashOf(blob) {
  try {
    const d = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

const NOTHING_SENT = "Nothing is sent until 入鋏.";

const SKIP_KEY = "mat.listSkip";
const LIST_GAP_MS = 10 * 60 * 1000;
const LIST_FILE_MAX = 4000000;
const fromB64 = (data, mime) => {
  const raw = atob(data);
  const b = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i);
  return new Blob([b], { type: mime });
};

export function mountBulkAdd(root, store, keep, { onOpenDay = () => {}, onClose = () => {}, onList = () => {}, storage = null, now = () => Date.now() } = {}) {
  const scrim = el("div", "scrim");
  scrim.id = "bulkScrim";
  scrim.hidden = true;
  const sheet = el("div", "sheet");
  sheet.id = "bulk";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Add tickets");
  sheet.inert = true;
  const top = el("div", "sheet-top");
  const topT = el("span", "", "Add tickets");
  const topI = el("i", "", "一括");
  topT.append(topI);
  const topB = btn("", "Cancel");
  topB.id = "bulkTop";
  top.append(topT, topB);
  const body = el("div", "ba-body");
  const say = el("p", "ba-vh");
  say.setAttribute("role", "status");
  const fileIn = el("input");
  fileIn.type = "file";
  fileIn.multiple = true;
  fileIn.accept = "application/pdf,image/png,image/jpeg";
  fileIn.id = "bulkFiles";
  fileIn.hidden = true;
  fileIn.tabIndex = -1;
  const listIn = el("input");
  listIn.type = "file";
  listIn.accept = ".csv,text/csv";
  listIn.id = "bulkList";
  listIn.hidden = true;
  listIn.tabIndex = -1;
  sheet.append(top, body, say, fileIn, listIn);
  root.append(scrim, sheet);

  let opened = false;
  // phase: "empty" | "reading" | "sorted" | "adding" | "added"
  let phase = "empty";
  let files = []; // { key, name, raw, kind, pages, sig, pic, url, unreadable }
  let list = null; // { rows, error, name }
  let answers = new Map();
  let checked = new Set(); // placement keys answered on a card
  let untied = false;
  let openLine = null; // the untied line being changed
  let other = null; // the card whose "another stop" picker is open
  let reading = { done: 0, total: 0 };
  let hashes = new Map(); // ticket id -> hash of the bytes this phone keeps
  let adding = null; // { done, total, items, ... } while adding and after
  let seeAll = false;
  let urls = [];
  let gen = 0; // one per Cancel / Done: work begun before it is dropped
  // ---- tickets from the list (auto-add) ----
  let mode = "drop"; // "drop" (files picked or dropped) | "list" (opened from the notice)
  let listData = null; // { rows, files, at }: the last look, in memory only
  let listErr = ""; // the last look's refusal (the desk or the planner can't be reached)
  let plan = null; // listPlan of listData against the trip as it is now
  let listGen = 0; // one per wipe: a look begun before it is dropped
  let lastLook = null;
  let looking = null;
  let lanswers = new Map(); // a changed or cancelled line's card -> "replace" | "first" | "add" | "off" | "keep"
  let chgFiles = new Map(); // a changed line's card -> the new files, fetched and read
  let fetching = { done: 0, total: 0, failed: [] };
  let handPre = []; // lines not fetched: their stop was filled by hand
  const store_ = () => {
    try {
      return storage || globalThis.localStorage || null;
    } catch {
      return null;
    }
  };
  let skip = (() => {
    try {
      const st = store_();
      return readSkip(st ? st.getItem(SKIP_KEY) : null);
    } catch {
      return new Set();
    }
  })();
  function addSkip(ties) {
    for (const t of ties) if (t) {
      skip.delete(t);
      skip.add(t);
    }
    try {
      const st = store_();
      if (st) st.setItem(SKIP_KEY, writeSkip(skip));
    } catch {
      // kept for this visit only
    }
  }

  const url = (blob) => {
    const u = URL.createObjectURL(blob);
    urls.push(u);
    return u;
  };

  // ---- matching ----

  const liveTickets = () => (store.state.tickets || []).filter((t) => t && !t.gone);
  function isThere(fileKey, stopId, who = "", place = null) {
    const f = files.find((x) => x.key === fileKey);
    if (!f || !f.sig) return false;
    const here = place && place.stay ? (t) => t.stay === place.stay : (t) => !t.stay && t.stop === stopId;
    return liveTickets().some((t) => here(t) && (t.who || "") === (who || "") && t.mime === f.sig.mime && Number(t.w) === f.sig.w && Number(t.h) === f.sig.h && Number(t.size) === f.sig.size && (!hashes.has(t.id) || !f.sig.hash || hashes.get(t.id) === f.sig.hash));
  }
  // The bytes of every kept picture that could be the same as a dropped one, hashed once.
  async function hashKept() {
    const want = liveTickets().filter((t) => !hashes.has(t.id) && keep.have(t.id) && files.some((f) => f.sig && f.sig.mime === t.mime && f.sig.w === Number(t.w) && f.sig.h === Number(t.h) && f.sig.size === Number(t.size)));
    for (const t of want) {
      const b = await keep.get(t.id);
      if (b) hashes.set(t.id, await hashOf(b));
    }
  }

  const sortedFiles = () => sortFiles({ files, rows: list && !list.error ? list.rows : [], listError: list ? list.error : null, state: store.state, answers, isThere });
  // In list mode: Mo's rule (a stop filled by hand gets nothing from the
  // list), the list's own quiet counts, and the changed and cancelled lines'
  // cards after the files' own.
  function sorted() {
    const r = sortedFiles();
    if (mode !== "list") return r;
    const hand = byHand(r.items, store.state.tickets);
    for (const it of hand.out) r.out.push({ kind: "hand", file: it.file, label: it.label, key: it.key, ...placeOf(it), why: "filled by hand" });
    r.items = hand.keep;
    r.quiet = 0;
    const cards = listCards();
    r.cards = r.cards.concat(cards.filter((c) => !lanswers.has(c.key)));
    r.listDone = cards.filter((c) => lanswers.has(c.key)).map((c) => ({ card: c, act: lanswers.get(c.key) }));
    let after = r.now + r.items.reduce((n, i) => n + i.pages, 0);
    for (const { card, act } of r.listDone) {
      if (act === "replace" || act === "first" || act === "add") after += card.newPages;
      if (act === "replace" || act === "first" || act === "off") after -= card.drop.length;
    }
    r.after = after;
    return r;
  }

  // ---- tickets from the list (auto-add) ----

  const stopOf_ = (id) => (store.state.stops || []).find((s) => s && s.id === id && !s.deleted);
  const stayOf_ = (id) => (store.state.stays || []).find((s) => s && s.id === id && !s.deleted);
  const onStopNow = (id) => (store.state.tickets || []).filter((t) => t && !t.gone && t.stop === id).length;
  // A place's pictures now: a stop's, or a stay's.
  const onPlaceNow = (p) => (p.stay ? (store.state.tickets || []).filter((t) => t && !t.gone && t.stay === p.stay).length : onStopNow(p.stop));
  const placeGone = (p) => (p.stay ? !stayOf_(p.stay) : !stopOf_(p.stop));
  const where = (p) => {
    const lab = placeLabel(typeof p === "string" ? { stop: p } : p);
    if (!lab.there) return p && p.stay ? "its stay" : "its stop";
    return [lab.d, lab.title].filter(Boolean).join(" · ");
  };
  const lineTitle = (row) => (row ? String(row.title || row.provider || "").trim() : "");

  // The changed and cancelled lines as cards (choices: act buttons, not stops).
  function listCards() {
    if (mode !== "list" || !plan) return [];
    const out = [];
    for (const c of plan.changed) {
      const got = chgFiles.get(c.key) || [];
      const label = [c.tid, lineTitle(c.row)].filter(Boolean).join(" · ");
      const newPages = got.reduce((n, f) => n + Math.max(1, f.pages || 1), 0);
      // Where the line's pictures are: a stop, or a stay.
      const at = c.stay ? { stay: c.stay } : { stop: c.stop };
      const word = c.stay ? "stay" : "stop";
      const stopGone = placeGone(at);
      if (c.add.length && !got.length && !c.drop.length) continue; // its file could not be fetched: said in the asides
      const base = { kind: "changed", key: c.key, label, file: got[0] || null, onList: true, rowIds: [c.tid], who: c.who, ...at, drop: c.drop, got, newPages, choices: [] };
      if (stopGone) {
        out.push({ ...base, ask: c.tid + "’s " + word + " is no longer on the trip.", hint: "Add its new file from Add tickets by hand.", short: "its " + word + " was removed", lchoices: [{ act: "keep", label: "Leave it", sub: "nothing changes" }] });
        continue;
      }
      if (got.length && c.drop.length) {
        const fits = onPlaceNow(at) + newPages <= LIMITS.perStop;
        const pics = c.drop.length === 1 ? "its picture" : "its " + c.drop.length + " pictures";
        out.push({ ...base, ask: c.tid + "’s file changed in the list: replace " + pics + " on " + where(at) + "?", hint: fits ? "The old ones come off afterwards and can be put back from History." : "Adding first would pass " + LIMITS.perStop + " pictures on the " + word + ".", short: "file changed", lchoices: [fits ? { act: "replace", label: "Replace them", sub: plural(newPages, "new page", "new pages") + " in, then the old off" } : { act: "first", label: "Take the old ones off first", sub: "then add the new " + plural(newPages, "page", "pages") }, { act: "keep", label: "Keep the old ones", sub: "the new file stays out" }] });
      } else if (got.length) {
        const fits = onPlaceNow(at) + newPages <= LIMITS.perStop;
        out.push({ ...base, ask: c.tid + " has another file in the list: add it to " + where(at) + "?", hint: fits ? "Its other pictures stay." : "It would pass " + LIMITS.perStop + " pictures on the " + word + ".", short: "another file", lchoices: (fits ? [{ act: "add", label: "Add it", sub: plural(newPages, "page", "pages") }] : []).concat([{ act: "keep", label: "Leave it out", sub: "nothing changes" }]) });
      } else {
        const pics = c.drop.length === 1 ? "its picture" : "its " + c.drop.length + " pictures";
        out.push({ ...base, ask: "A file of " + c.tid + " is gone from the list: take " + pics + " off " + where(at) + "?", hint: "They can be put back from History.", short: "file gone from the list", lchoices: [{ act: "off", label: "Take them off", sub: plural(c.drop.length, "picture", "pictures") }, { act: "keep", label: "Leave them", sub: "nothing changes" }] });
      }
    }
    for (const c of plan.cancelled) {
      const seen = new Map();
      for (const t of c.tickets) {
        const p = t.stay ? { stay: t.stay } : { stop: t.stop };
        if (!seen.has(placeKey(p))) seen.set(placeKey(p), p);
      }
      const places = [...seen.values()];
      const on = places.map(where).join(", ");
      const label = [c.tid, lineTitle(c.row)].filter(Boolean).join(" · ");
      const ask = c.why === "cancelled" ? c.tid + " is " + (c.status || "not active").toLowerCase() + " in the list: take its pictures off " + on + "?" : c.why === "gone" ? c.tid + " is gone from the list: take its pictures off " + on + "?" : c.tid + "’s file is gone from the list: take its pictures off " + on + "?";
      out.push({ kind: "cancelled", key: c.key, label, file: null, onList: !!c.row, rowIds: [c.tid], who: "", ...(places[0] || { stop: undefined }), drop: c.tickets, got: [], newPages: 0, choices: [], ask, hint: plural(c.tickets.length, "picture", "pictures") + ". They can be put back from History.", short: c.why === "cancelled" ? "cancelled in the list" : "gone from the list", lchoices: [{ act: "off", label: "Take them off", sub: plural(c.tickets.length, "picture", "pictures") }, { act: "keep", label: "Leave them", sub: "nothing changes" }] });
    }
    return out;
  }

  // What the notice says: the new lines that would go in or need a look, and the changed or cancelled ones.
  function noticeNow() {
    if (!plan || !listData) return "";
    const stubs = plan.fresh.map((f) => ({ key: f.file.h, name: f.file.name, kind: f.file.mime, pages: 1, sig: null }));
    const r = sortFiles({ files: stubs, rows: listData.rows, state: store.state });
    const fresh = byHand(r.items, store.state.tickets).keep.length + r.cards.length;
    return noticeText({ fresh, other: plan.changed.length + plan.cancelled.length });
  }
  let told = "";
  function replan() {
    plan = listData ? listPlan({ rows: listData.rows, files: listData.files, state: store.state, skip }) : null;
    const text = noticeNow();
    const error = text ? "" : listErr;
    const sig = text + "|" + error;
    if (sig !== told) {
      told = sig;
      onList({ text, error });
    }
  }

  // A look at the list: the owner's phone only, one at a time.
  function checkList({ force = false } = {}) {
    if (store.state.ticketList !== true || store.state.status !== "ready") return Promise.resolve({ ok: false, code: "off" });
    if (looking) return looking;
    const mine = listGen;
    lastLook = now();
    looking = (async () => {
      try {
        const d = await store.listTickets({ force });
        if (mine !== listGen) return { ok: false, code: "late" };
        listData = { rows: Array.isArray(d && d.rows) ? d.rows : [], files: Array.isArray(d && d.files) ? d.files : [], at: (d && d.at) || "" };
        listErr = "";
        replan();
        return { ok: true };
      } catch (err) {
        if (mine !== listGen) return { ok: false, code: "late" };
        const code = (err && err.code) || "server";
        // No signal: what the last look found still stands. Anything else (the
        // desk or the planner can't be reached, the setup gone): said in the
        // notice in place of what it found, never quietly.
        if (code !== "network") {
          listErr = (err && err.message) || "The list can’t be reached right now.";
          listData = null;
        }
        replan();
        return { ok: false, code, message: (err && err.message) || "" };
      } finally {
        if (mine === listGen) looking = null;
      }
    })();
    return looking;
  }
  // At start, and at most every 10 minutes while MAT is open.
  function maybeCheckList() {
    if (store.state.ticketList !== true || store.state.status !== "ready" || looking) return null;
    if (lastLook !== null && now() - lastLook < LIST_GAP_MS) return null;
    return checkList();
  }

  // Settle failures here: a prefetched response may arrive before it is wanted.
  async function fetchListFile(file) {
    if (file.size > LIST_FILE_MAX) return { why: "too big to fetch: add it by hand" };
    let got;
    try {
      got = await store.listTicketFile(file.h);
    } catch (err) {
      return { why: err && err.code === "network" ? "no signal: Check the list again later" : (err && err.message) || "it couldn’t be fetched" };
    }
    return { got };
  }

  // The notice's Check (and Check the list now): fetch only the files needing review.
  async function openList({ force = false } = {}) {
    if (phase === "adding" || phase === "reading" || phase === "fetching" || (mode === "list" && phase === "sorted" && !force)) return open();
    reset();
    mode = "list";
    const mine = gen;
    phase = "fetching";
    fetching = { done: 0, total: 0, failed: [] };
    open();
    draw();
    if (force || !listData) await checkList({ force: true });
    if (mine !== gen) return;
    if (!listData || !plan) {
      phase = "empty";
      mode = "drop";
      draw();
      say.textContent = listErr || "The list couldn’t be looked at. Try again when there is signal.";
      return;
    }
    // A line whose stop was filled by hand is not even fetched (Mo's rule): said in the asides.
    const rows = listData.rows;
    const stubs = plan.fresh.map((f) => ({ key: f.file.h, name: f.file.name, kind: f.file.mime, pages: 1, sig: null }));
    const pre = sortFiles({ files: stubs, rows, state: store.state });
    const handOut = byHand(pre.items, store.state.tickets).out;
    const notNeeded = new Set(handOut.filter((it) => !pre.items.some((x) => x.file.key === it.file.key && !handOut.includes(x))).map((it) => it.file.key));
    handPre = handOut.filter((it) => notNeeded.has(it.file.key)).map((it) => ({ label: it.label, stop: it.stop }));
    const want = plan.fresh.filter((f) => !notNeeded.has(f.file.h)).map((f) => ({ file: f.file, tie: f.tie, card: null }))
      .concat(...plan.changed.map((c) => c.add.map((a) => ({ file: a.file, tie: a.tie, card: c.key }))));
    fetching.total = want.length;
    draw();
    // Keep at most one file ahead. Decode in order, so a slow first response
    // cannot reorder cards or let a whole folder accumulate in phone memory.
    let next = want.length ? fetchListFile(want[0].file) : null;
    for (const [i, w] of want.entries()) {
      if (mine !== gen) return;
      const current = next;
      next = i + 1 < want.length ? fetchListFile(want[i + 1].file) : null;
      const { got, why } = await current;
      if (mine !== gen) return;
      if (why) fetching.failed.push({ label: w.file.name, why });
      else {
        let raw = null;
        try {
          if (got && typeof got.data === "string") raw = fromB64(got.data, got.mime);
        } catch {
          raw = null;
        }
        const f = raw ? await readOne(raw, w.file.name) : null;
        if (mine !== gen) return;
        if (f && f.pic) {
          f.tie = w.tie;
          if (w.card) {
            if (!chgFiles.has(w.card)) chgFiles.set(w.card, []);
            chgFiles.get(w.card).push(f);
          } else files.push(f);
        } else fetching.failed.push({ label: w.file.name, why: "couldn’t be read on this phone" });
      }
      fetching.done += 1;
      draw();
    }
    await hashKept();
    if (mine !== gen) return;
    list = { rows, error: null, warn: [], name: "the list" };
    phase = "sorted";
    afterChange();
    const r = sorted();
    say.textContent = r.items.length || r.cards.length ? "Sorted from the list." : "Nothing new on the list.";
  }

  // ---- reading what was picked or dropped ----

  async function readList(file) {
    const mine = gen;
    let text = "";
    try {
      text = await file.text();
    } catch {
      text = "";
    }
    if (mine !== gen || (phase !== "empty" && phase !== "reading" && phase !== "sorted")) return;
    const got = parseList(text);
    list = { ...got, name: String(file.name || "list.csv").slice(0, 60) };
    // Fix round 1, M4: answers were given to the cards of the old list (or of none): they start again.
    answers = new Map();
    checked = new Set();
    openLine = null;
    other = null;
    if (phase === "empty") draw();
    else afterChange();
  }

  // One file read on this phone: its kind by its first bytes, its first
  // picture (a PDF's first page; the rest are drawn at 入鋏) and its pages.
  async function readOne(raw, name) {
    const f = { key: newId(), name: String(name || "A file").slice(0, 80), raw, kind: null, pages: 0, sig: null, pic: null, url: "", unreadable: "" };
    try {
      f.kind = await sniff(raw);
      if (f.kind === "image/png" || f.kind === "image/jpeg") {
        f.pic = await shrink(raw);
        f.pages = 1;
      } else if (f.kind === "application/pdf") {
        const got = await pdfPages(raw, {
          max: 1,
          each: async (canvas) => {
            f.pic = await shrinkCanvas(canvas);
          },
        });
        f.pages = got.total;
        if (!f.pic) throw new Error("no page");
      }
    } catch {
      f.unreadable = "couldn’t be read on this phone";
      f.kind = null;
      f.pic = null;
    }
    if (f.pic) f.sig = { mime: f.pic.mime, w: f.pic.w, h: f.pic.h, size: f.pic.data.length, hash: await hashOf(f.pic.blob) };
    return f;
  }

  // One pick or drop at a time, in the order they came.
  let queue = Promise.resolve();
  function take(picked) {
    queue = queue.then(() => takeNow(picked)).catch(() => {
      // Anything else that went wrong reading: what was read is kept and sorted, and it is said.
      if (phase === "reading") phase = "sorted";
      draw();
      say.textContent = "A file couldn’t be read on this phone. Try a screenshot of the ticket instead.";
    });
    return queue;
  }
  async function takeNow(picked) {
    const all = [...picked];
    const csv = all.filter(isCsv);
    const rest = all.filter((f) => !isCsv(f));
    const mine = gen;
    if (csv.length) await readList(csv[0]);
    if (!rest.length || mine !== gen) return;
    if (phase !== "empty" && phase !== "sorted") return;
    phase = "reading";
    reading = { done: 0, total: rest.length };
    draw();
    for (const raw of rest) {
      const f = await readOne(raw, raw.name);
      if (mine !== gen) return;
      files.push(f);
      reading.done += 1;
      drawReading();
    }
    await hashKept();
    if (mine !== gen) return;
    phase = "sorted";
    afterChange();
    say.textContent = plural(files.length, "file", "files") + " sorted.";
  }

  // ---- drawing ----

  const dayLabel = (stop) => stopLabel(stop, store.state.days || []);
  const stopOf = (id) => (store.state.stops || []).find((s) => s && s.id === id && !s.deleted);
  const dayNum = (date) => (store.state.days || []).findIndex((d) => d && d.date === date) + 1;
  // { d, when, title, date, there } for a place: a stop as stopLabel gives it;
  // a stay (or one to add) by its first night's day, its dates and its name.
  function placeLabel(p) {
    if (p && (p.stay || p.newStay)) {
      const st = p.stay ? stayOf_(p.stay) : p.newStay;
      if (!st) return { d: "", when: "", title: "A stay", date: "", there: false };
      const n = dayNum(st.firstNight);
      return { d: n ? "D" + n : "", when: spanOf(st), title: String(st.name || st.nameJp || "").trim() || "A stay", date: st.firstNight || "", there: true };
    }
    const st = p ? stopOf(p.stop) : null;
    if (!st) return { ...dayLabel({}), date: "", there: false };
    return { ...dayLabel(st), date: st.date || "", there: true };
  }
  const placeTitle = (p, none = "its stop") => {
    const lab = placeLabel(p);
    return lab.there ? lab.title : p && (p.stay || p.newStay) ? "its stay" : none;
  };
  const isStayPlace = (p) => !!(p && (p.stay || p.newStay));
  const people = () => (store.state.people || []).map((p) => p.name).filter(Boolean);

  function drawTop() {
    if (phase === "empty") topI.textContent = "一括";
    else if (phase === "fetching") topI.textContent = "from the list";
    else if (phase === "adding" || phase === "added") topI.textContent = "punched";
    else if (mode === "list") topI.textContent = "from the list · " + plural(files.length + [...chgFiles.values()].reduce((n, l) => n + l.length, 0), "file", "files");
    else topI.textContent = plural(files.length, "file", "files") + (list && !list.error ? " · list of " + list.rows.length : "");
    topB.textContent = phase === "adding" || phase === "added" ? "Done" : "Cancel";
  }

  function emptyZone() {
    const z = el("div", "ba-empty");
    z.append(el("b", "", "Drop the ticket files here."), el("span", "", "PDFs and pictures, all at once. Add the list (.csv) too if you have it: fewer to check by hand."));
    const two = el("div", "ba-two");
    const f = btn("is-p", "Choose files");
    f.id = "bulkChoose";
    f.append(el("small", "", "PDF · PNG · JPG"));
    const l = btn("", list && !list.error ? "List chosen" : "Choose list");
    l.id = "bulkChooseList";
    l.append(el("small", "", list && !list.error ? plural(list.rows.length, "line", "lines") : ".csv, optional"));
    two.append(f, l);
    z.append(two);
    return z;
  }

  // The owner's phone: the list and its folder, looked at now.
  function checkLine() {
    const a = aside("表", "", "The planner’s list and its ticket files: ");
    const b = btn("ba-link", "Check the list now");
    b.id = "bulkCheckList";
    a.lastChild.append(b);
    return a;
  }

  function drawReading() {
    const p = body.querySelector(".ba-prog");
    if (!p) return;
    p.firstChild.textContent = "Reading " + reading.done + " of " + reading.total + "…";
    p.querySelector(".ba-bar i").style.width = (reading.total ? Math.round((100 * reading.done) / reading.total) : 0) + "%";
  }

  function progress(head, small, part, whole) {
    const p = el("div", "ba-prog", head);
    p.append(el("small", "", small));
    const bar = el("div", "ba-bar");
    const fill = el("i");
    fill.style.width = (whole ? Math.round((100 * part) / whole) : 0) + "%";
    bar.append(fill);
    p.append(bar);
    return p;
  }

  // A small round seal with a person's initial.
  // Fix round 1, M10: what it means is in the text, for a screen reader.
  const seal = (name) => {
    const s = el("span", "ba-seal", initial(name));
    s.append(el("span", "ba-vh", " for " + name));
    return s;
  };

  // The banded bundle: the top ticket (a stop with one each, else the first),
  // two edges under it, the band with the count.
  function bundle(items, { punched = false, band, small, action, actionLabel, expanded }) {
    const wrap = el("div", "ba-bundle" + (punched ? " is-punched" : ""));
    const edge1 = el("div", "ba-tk");
    const edge2 = el("div", "ba-tk");
    const topTk = el("div", "ba-tk is-top");
    const pp = items.find((i) => i.who && items.filter((j) => placeKey(j) === placeKey(i) && j.who).length > 1);
    const first = pp || items[0];
    const mine = items.filter((i) => placeKey(i) === placeKey(first));
    const lab = placeLabel(first);
    const each = mine.filter((i) => i.who).length > 1;
    const left = el("div");
    left.append(el("div", "ba-k", [lab.d, lab.when].filter(Boolean).join(" ") + (each ? " · one each" : mine.length > 1 ? " · " + mine.length + " files" : "")), el("div", "ba-n", lab.title));
    const s = el("div", "ba-s");
    if (punched) s.textContent = each ? mine.filter((i) => i.who).map((i) => initial(i.who)).join(" · ") : mine.length + (mine.length === 1 ? " ticket" : " tickets");
    else {
      for (const i of mine.slice(0, 4)) {
        const one = el("span", "ba-id", i.rowIds.length ? i.rowIds.join(" ") : i.file.name);
        if (i.who) one.append(seal(i.who));
        s.append(one);
      }
    }
    left.append(s);
    const right = el("div", "ba-pv");
    if (first.file.pic) {
      const img = el("img");
      img.alt = "";
      img.src = first.file.url || (first.file.url = url(first.file.pic.blob));
      right.append(img);
    }
    topTk.append(left, right);
    const b = el("div", "ba-band");
    const t = el("b");
    t.append(el("span", punched ? "ba-ai is-shu" : "ba-ai", punched ? "済" : "帯"), band, el("small", "", small));
    b.append(t);
    if (action) {
      const u = btn("ba-untie", actionLabel);
      u.dataset.act = action;
      u.setAttribute("aria-expanded", String(!!expanded));
      b.append(u);
    }
    wrap.append(edge1, edge2, topTk, b);
    return wrap;
  }

  // The stops as a picker: one group per day.
  function stopPicker(selected) {
    const s = el("select", "ba-pick");
    s.append(new Option("Pick a stop…", ""));
    const days = store.state.days || [];
    days.forEach((d, i) => {
      const stops = (store.state.stops || []).filter((x) => x && !x.deleted && x.date === d.date);
      if (!stops.length) return;
      stops.sort((a, b) => (minutesOf(a.time) ?? 9999) - (minutesOf(b.time) ?? 9999));
      const g = el("optgroup");
      g.label = "D" + (i + 1) + " " + dayLabel({ date: d.date }).when;
      for (const st of stops) {
        const o = new Option([st.time, st.title].filter(Boolean).join(" ") || "A stop", st.id);
        o.selected = st.id === selected;
        g.append(o);
      }
      s.append(g);
    });
    s.setAttribute("aria-label", "Stop");
    return s;
  }

  function choiceBtn(c, i, card) {
    const b = btn("");
    b.dataset.choice = card.key + "|" + i;
    // A stay to add: 宿 Add the stay and its booking, its name and nights.
    if (c.newStay) {
      const sp = el("span", "", "Add the stay and its booking");
      const n = nightsOf(c.newStay);
      sp.append(el("small", "", c.newStay.name + " · " + (n === 1 ? "night of " + monthDay(c.newStay.firstNight) : spanOf(c.newStay))));
      b.classList.add("is-yado");
      b.append(el("b", "", "宿"), sp, el("i", "", "›"));
      return b;
    }
    const lab = placeLabel(c);
    if (c.stay) {
      const sp = el("span", "", c.pages ? "First " + plural(c.pages, "page", "pages") : lab.title);
      sp.append(el("small", "", (c.pages ? lab.title + " · " : "") + lab.when + (c.who ? " · for " + c.who : "")));
      b.append(el("b", "", c.pages ? "" : lab.d), sp, el("i", "", "›"));
      if (c.pages) b.classList.add("is-fit");
      return b;
    }
    const sp = el("span", "", c.pages ? "First " + plural(c.pages, "page", "pages") : lab.when || "No time");
    sp.append(el("small", "", (c.pages ? lab.d + " " : "") + lab.title + (c.who ? " · for " + c.who : "")));
    b.append(el("b", "", c.pages ? "" : lab.d), sp, el("i", "", "›"));
    if (c.pages) b.classList.add("is-fit");
    return b;
  }

  function cardNode(card, n, of) {
    const c = el("div", "ba-card");
    c.dataset.card = card.key;
    const q = el("div", "ba-q");
    const stayCard = card.kind === "newstay" || card.kind === "stays";
    q.append(el("span", "", card.kind === "limit" ? "満員 Too many" : stayCard ? "宿泊 A STAY" : "どちら？ Which one?"), el("i", "", card.onList ? (card.rowIds.join(" ") || "on the list") + (stayCard ? " · lodging" : "") : "not on the list"));
    const big = el("div", "ba-big");
    const pv = el("div", "ba-pv");
    if (card.file.pic) {
      const img = el("img");
      img.alt = "";
      img.src = card.file.url || (card.file.url = url(card.file.pic.blob));
      pv.append(img);
    }
    pv.append(el("div", "ba-cap", card.file.name));
    const words = el("div");
    // A stay's line: its name and night ("Lakeside Airport Inn · Dec 8").
    const fn = stayCard && card.line ? [card.line.title, card.line.date ? monthDay(card.line.date) : ""].filter(Boolean).join(" · ") : card.onList ? card.label : card.file.kind === "application/pdf" ? "A PDF · " + plural(card.file.pages || 1, "page", "pages") : "A picture";
    words.append(el("div", "ba-fn", fn), el("div", "ba-ask", card.ask), el("div", "ba-hint", card.hint));
    big.append(pv, words);
    const opts = el("div", "ba-opts");
    card.choices.forEach((ch, i) => opts.append(choiceBtn(ch, i, card)));
    const showOther = other === card.key || !card.choices.length;
    if (stayCard || (card.kind === "limit" && card.choices.some(isStayPlace))) {
      // A stay is never moved to a stop: only Leave it out beside its choices.
      const soft = btn("is-soft");
      soft.dataset.out = card.key;
      soft.append(el("span", "", "Leave it out"), el("i", "", "›"));
      opts.append(soft);
    } else if (!showOther) {
      const soft = btn("is-soft");
      soft.dataset.other = card.key;
      soft.append(el("span", "", "Another stop, or leave it out"), el("i", "", "›"));
      opts.append(soft);
    } else {
      const box = el("div", "ba-other");
      const pick = stopPicker("");
      pick.dataset.pickFor = card.key;
      const put = btn("ba-put", "Put it on this stop");
      put.dataset.put = card.key;
      const out = btn("ba-out", "Leave it out");
      out.dataset.out = card.key;
      box.append(pick, put, out);
      opts.append(box);
    }
    c.append(q, big, opts);
    c.setAttribute("role", "group");
    c.setAttribute("aria-label", "To look at, " + n + " of " + of);
    return c;
  }

  // A changed or cancelled line from the list: the question and two acts.
  function listCardNode(card, n, of) {
    const c = el("div", "ba-card");
    c.dataset.card = card.key;
    const q = el("div", "ba-q");
    q.append(el("span", "", card.kind === "changed" ? "変更 Changed" : "取消 Off the list"), el("i", "", card.rowIds.join(" ")));
    const big = el("div", "ba-big");
    const pv = el("div", "ba-pv");
    if (card.file && card.file.pic) {
      const img = el("img");
      img.alt = "";
      img.src = card.file.url || (card.file.url = url(card.file.pic.blob));
      pv.append(img);
      pv.append(el("div", "ba-cap", card.file.name));
    } else pv.append(el("div", "ba-cap", plural(card.drop.length, "picture", "pictures") + " on the trip"));
    const words = el("div");
    words.append(el("div", "ba-fn", card.label), el("div", "ba-ask", card.ask), el("div", "ba-hint", card.hint));
    big.append(pv, words);
    const opts = el("div", "ba-opts");
    for (const ch of card.lchoices) {
      const b = btn(ch.act === "keep" ? "is-soft" : "");
      b.dataset.lchoice = card.key + "|" + ch.act;
      const sp = el("span", "", ch.label);
      sp.append(el("small", "", ch.sub));
      if (ch.act === "keep") b.append(sp, el("i", "", "›"));
      else b.append(el("b", "", ch.act === "off" ? "外" : "換"), sp, el("i", "", "›"));
      opts.append(b);
    }
    c.append(q, big, opts);
    c.setAttribute("role", "group");
    c.setAttribute("aria-label", "To look at, " + n + " of " + of);
    return c;
  }

  function aside(sealText, strong, rest, cls = "") {
    const a = el("div", "ba-aside" + (cls ? " " + cls : ""));
    a.append(el("span", "ba-ring", sealText));
    const t = el("span");
    if (strong) t.append(el("b", "", strong), " ");
    t.append(rest);
    a.append(t);
    return a;
  }

  function untiedList(items) {
    const box = el("div", "ba-list");
    const days = store.state.days || [];
    // The stays first, under 宿泊: each with its day, name, line, file and dates, and the 宿 mark.
    const onStays = items.filter(isStayPlace);
    if (onStays.length) {
      box.append(el("div", "ba-lh", "On a stay 宿泊"));
      for (const it of onStays) {
        const lab = placeLabel(it);
        const d = el("div", "ba-lb");
        const yado = el("span", "ba-seal yado", "宿");
        yado.setAttribute("aria-hidden", "true");
        d.append(el("b", "", lab.d), el("span", "", lab.title), el("small", "", [it.rowIds.join(" "), it.file.name, it.pages > 1 ? it.pages + " pages" : "", lab.when].filter(Boolean).join(" · ")), yado);
        box.append(d);
      }
    }
    let lastDay = null;
    for (const it of items) {
      if (isStayPlace(it)) continue;
      const st = stopOf(it.stop) || {};
      if (st.date !== lastDay) {
        lastDay = st.date;
        const i = days.findIndex((d) => d.date === st.date);
        box.append(el("div", "ba-lh", "D" + (i + 1) + " " + dayLabel({ date: st.date }).when));
      }
      const line = el("div", "ba-line" + (openLine === it.key ? " is-open" : ""));
      const b = btn("ba-lb");
      b.dataset.line = it.key;
      b.setAttribute("aria-expanded", String(openLine === it.key));
      const lab = dayLabel(st);
      b.append(el("b", "", (st.time || "—")), el("span", "", lab.title), el("small", "", (it.rowIds.length ? it.rowIds.join(" ") + " · " : "") + it.file.name + (it.pages > 1 ? " · " + it.pages + " pages" : "")));
      if (it.who) b.append(seal(it.who));
      line.append(b);
      if (openLine === it.key) {
        const ed = el("div", "ba-ed");
        const pick = stopPicker(it.stop);
        pick.dataset.move = it.key;
        const fr = el("div", "ba-for");
        fr.append("For ");
        const ppl = people();
        for (const [v, label] of [["", ppl.length === 3 ? "All three" : "Everyone"], ...ppl.map((p) => [p, initial(p)])]) {
          const w = btn(it.who === v ? "is-on" : "", label);
          w.dataset.who = it.key + "|" + v;
          w.setAttribute("aria-pressed", String(it.who === v));
          if (v) w.setAttribute("aria-label", "For " + v);
          fr.append(w);
        }
        const out = btn("ba-out", "Leave it out");
        out.dataset.out = it.key;
        ed.append(pick, fr, out);
        line.append(ed);
      }
      box.append(line);
    }
    return box;
  }

  function drawSorted(r) {
    const nodes = [];
    if (phase === "reading") nodes.push(progress("Reading " + reading.done + " of " + reading.total + "…", "Made into pictures on this phone. " + NOTHING_SENT, reading.done, reading.total));
    const sure = r.items;
    if (sure.length) {
      const days = sure.map((i) => dayNum(placeLabel(i).date)).filter((n) => n > 0);
      const lo = days.length ? Math.min(...days) : 0;
      const hi = days.length ? Math.max(...days) : 0;
      const stops = new Set(sure.filter((i) => !isStayPlace(i)).map((i) => i.stop)).size;
      const onStays = sure.filter(isStayPlace).length;
      const each = sure.filter((i) => i.who).length;
      nodes.push(bundle(sure, {
        band: sure.length + " sorted",
        small: [lo ? (lo === hi ? "D" + lo : "D" + lo + " to D" + hi) : "", stops || !onStays ? plural(stops, "stop", "stops") : ""].filter(Boolean).join(" · ") + (each ? " · " + each + " one each" : "") + (onStays ? " · " + onStays + " on stays" : ""),
        action: "untie",
        actionLabel: untied ? "Tie ‹" : "Untie ›",
        expanded: untied,
      }));
      if (untied) nodes.push(untiedList(sure));
    }
    const total = checked.size + r.cards.length;
    if (r.cards.length) {
      const h = el("div", "ba-h");
      h.append(el("span", "", "検札 To look at · " + (checked.size + 1) + " of " + total));
      const dots = el("span", "ba-dots");
      dots.setAttribute("aria-hidden", "true");
      for (let i = 0; i < Math.min(total, 8); i++) dots.append(el("span", i < checked.size ? "is-done" : i === checked.size ? "is-on" : ""));
      h.append(dots);
      nodes.push(h, (r.cards[0].lchoices ? listCardNode : cardNode)(r.cards[0], checked.size + 1, total));
      const next = el("div", "ba-next");
      for (const c of r.cards.slice(1, 3)) {
        const d = el("div");
        d.append(el("span", "", c.label), el("i", "", c.short));
        next.append(d);
      }
      if (next.childNodes.length) nodes.push(next);
    } else if (checked.size) {
      nodes.push(el("div", "ba-h", "検札 All " + checked.size + " looked at"));
    }
    const there = r.out.filter((o) => o.kind === "there");
    if (there.length) {
      const names = there.map((o) => o.label + " is on " + placeTitle(o)).join("; ");
      nodes.push(aside("既", there.length + " already there:", names + ". Left out."));
    }
    const notT = r.out.filter((o) => o.kind === "notTicket");
    if (notT.length) {
      const bad = notT.filter((o) => o.file.unreadable);
      const odd = notT.filter((o) => !o.file.unreadable);
      if (odd.length) nodes.push(aside("外", plural(odd.length, "file isn’t a ticket file:", "files aren’t ticket files:"), odd.map((o) => o.file.name).join(", ") + ". Left out."));
      if (bad.length) nodes.push(aside("外", plural(bad.length, "file couldn’t be read", "files couldn’t be read") + " on this phone:", bad.map((o) => o.file.name).join(", ") + ". Try a screenshot instead."));
    }
    const inactive = r.out.filter((o) => o.kind === "inactive");
    if (inactive.length) nodes.push(aside("止", plural(inactive.length, "not active", "not active") + " on the list:", inactive.map((o) => o.label + " (" + o.why.replace(/^on the list as /, "") + ")").join(", ") + ". Left out."));
    const mineOut = r.out.filter((o) => o.kind === "leftOut");
    if (mineOut.length) nodes.push(aside("除", plural(mineOut.length, "left out", "left out") + ":", mineOut.map((o) => o.label).join(", ") + "."));
    const hand = r.out.filter((o) => o.kind === "hand").map((o) => ({ label: o.label, ...placeOf(o) })).concat(mode === "list" ? handPre : []);
    if (hand.length) nodes.push(aside("手", plural(hand.length, "stop was", "stops were") + " filled by hand:", hand.map((o) => o.label.split(" · ")[0] + " on " + placeTitle(o)).join("; ") + ". The list’s are left out."));
    if (mode === "list") {
      if (fetching.failed.length) nodes.push(aside("外", plural(fetching.failed.length, "file wasn’t fetched:", "files weren’t fetched:"), fetching.failed.map((x) => x.label + " (" + x.why + ")").join(", ") + ".", "is-warn"));
      const qd = plan ? plan.quiet : null;
      if (qd) {
        const bits = [];
        if (qd.noFile) bits.push(plural(qd.noFile, "line has", "lines have") + " no file yet");
        if (qd.outside) bits.push(plural(qd.outside, "is", "are") + " outside the trip’s days");
        if (qd.unlisted) bits.push(plural(qd.unlisted, "file in the folder isn’t", "files in the folder aren’t") + " on the list");
        if (bits.length) nodes.push(aside("表", "", "On the list: " + bits.join(", ") + "."));
        if (qd.skipped) {
          const a = aside("除", "", plural(qd.skipped, "line", "lines") + " left out before on this phone. ");
          const b = btn("ba-link", "Bring them back");
          b.id = "bulkUnskip";
          a.lastChild.append(b);
          nodes.push(a);
        }
      }
    } else if (list && list.error) nodes.push(aside("表", "", list.error, "is-warn"));
    else if (list && list.warn && list.warn.length) nodes.push(aside("表", "", list.warn.join(" "), "is-warn"));
    if (mode === "list") {
      // (the list's own lines above)
    } else if (list && !list.error && r.quiet) nodes.push(aside("表", "", plural(r.quiet, "line", "lines") + " on the list " + (r.quiet === 1 ? "has" : "have") + " no file here."));
    else if (!list) {
      const a = aside("表", "", "No list: every file not matched is looked at by hand. ");
      const b = btn("ba-link", "Choose list");
      b.id = "bulkChooseList";
      a.lastChild.append(b);
      nodes.push(a);
    }
    nodes.push(aside(String(LIMITS.perTrip), "", "", "is-count"));
    const cnt = nodes[nodes.length - 1].lastChild;
    cnt.append("Pictures on the trip: ", el("b", "", r.now + " now, " + r.after + " after this"), ".");
    const done = r.listDone || [];
    const n = sure.length + done.filter((d) => d.act === "replace" || d.act === "first" || d.act === "add").length;
    const offs = done.filter((d) => d.act === "off").reduce((k, d) => k + d.card.drop.length, 0);
    const key = btn("ba-punch");
    key.id = "bulkPunch";
    key.disabled = (n === 0 && offs === 0) || phase === "reading";
    const sp = el("span");
    const small = (r.cards.length ? (r.cards.length === 1 ? "the 1 not looked at stays out" : "the " + r.cards.length + " not looked at stay out") + " · " : "") + "on every phone";
    const words = n && offs ? "Add " + n + ", take " + offs + " off" : n ? "Add " + n + " now" : offs ? "Take " + offs + " off now" : "Nothing to add yet";
    sp.append(el("b", "", "入鋏"), words, el("small", "", small));
    key.append(el("span", "ba-hole"), sp, el("i", "", "›"));
    nodes.push(key);
    return nodes;
  }

  function drawAdded() {
    const a = adding;
    const nodes = [];
    if (phase === "adding") {
      // Fix round 1 (I2): until every picture is kept on this phone, MAT must stay open; after that nothing confirmed is lost.
      if (a.step === "making") nodes.push(progress("Making pictures: " + a.made + " of " + a.total, "Keep MAT open until they are all added. Nothing is sent yet.", a.made, a.total));
      else if (a.step === "off") nodes.push(progress("Taking pictures off: " + a.off, "The old ones, as you said. They can be put back from History.", a.off, a.off + 1));
      else if (a.step === "sending") nodes.push(progress("While adding: " + a.settled + " of " + plural(a.pics, "picture", "pictures"), "Keep MAT open until they are all added. One that can’t go up now is kept on this phone and goes up when MAT next has signal.", a.settled, a.pics));
      else if (a.step === "stay") nodes.push(progress("Adding the stay…", "A stay from the list, so its booking has a card to go on.", 0, 1));
      else nodes.push(progress("Filling in the stops’ details…", "From the list, only where a stop’s field is empty.", 1, 1));
    }
    if (phase === "added") {
      const ok = a.items.filter((i) => i.saved + i.waiting > 0);
      const stops = new Set(ok.filter((i) => !isStayPlace(i)).map((i) => i.stop)).size;
      const stays = new Set(ok.filter(isStayPlace).map((i) => placeKey(i))).size;
      const pics = ok.reduce((s, i) => s + i.saved + i.waiting, 0);
      const waiting = ok.reduce((s, i) => s + i.waiting, 0);
      const to = stays ? [stops ? plural(stops, "stop", "stops") : "", plural(stays, "stay", "stays")].filter(Boolean).join(" and ") : plural(stops, "stop", "stops");
      nodes.push(el("p", "ba-done-h", ok.length ? plural(ok.length, "ticket", "tickets") + " added to " + to + "." : a.off ? plural(a.off, "picture", "pictures") + " taken off." : "No ticket was added."));
      if (ok.length && a.off) nodes.push(el("p", "ba-done-s", plural(a.off, "old picture", "old pictures") + " taken off. History puts them back."));
      if (ok.length) {
        const s = el("p", "ba-done-s");
        s.append(el("b", "", plural(pics, "picture", "pictures")), ", kept in the trip. Every phone shows them on its stubs the next time it opens MAT with signal.");
        if (waiting) s.append(" " + (waiting === pics ? "They wait" : waiting + " wait") + " on this phone" + (a.busy && a.busy === waiting ? " and go up in a moment." : " and go up when there is signal."));
        nodes.push(s);
        const sure = ok.filter((i) => i.from === "sure").length;
        nodes.push(bundle(ok, { punched: true, band: ok.length + " punched in", small: sure + " sorted + " + (ok.length - sure) + " you checked", action: "seeall", actionLabel: seeAll ? "Hide ‹" : "See all ›", expanded: seeAll }));
        if (seeAll) {
          const box = el("div", "ba-list");
          for (const it of ok) {
            const lab = placeLabel(it);
            const row = el("div", "ba-line");
            const d = el("div", "ba-lb");
            d.append(el("b", "", lab.d), el("span", "", lab.title), el("small", "", (it.rowIds.length ? it.rowIds.join(" ") + " · " : "") + plural(it.saved + it.waiting, "picture", "pictures") + (it.waiting ? ", waiting" : "")));
            if (it.who) d.append(seal(it.who));
            row.append(d);
            box.append(row);
          }
          nodes.push(box);
        }
      }
      // Fix round 1 (I2): which ones wait on this phone for signal, by name.
      const waitingNow = ok.filter((i) => i.waiting > 0);
      if (waitingNow.length) {
        nodes.push(el("div", "ba-h", "Waiting for signal · " + waitingNow.length));
        const box = el("div", "ba-next is-flat ba-wait");
        for (const it of waitingNow) {
          const d = el("div");
          const lab = placeLabel(it);
          d.append(el("span", "", [it.rowIds.join(" ") || it.file.name, lab.there ? lab.title : ""].filter(Boolean).join(" · ")), el("i", "", (it.waiting === it.saved + it.waiting ? "" : it.waiting + " of " + (it.saved + it.waiting) + " ") + "on this phone, goes up " + (it.busy === it.waiting ? "in a moment" : "when there is signal")));
          box.append(d);
        }
        nodes.push(box);
      }
      const notAdded = a.notAdded;
      if (notAdded.length) {
        nodes.push(el("div", "ba-h", "Not added · " + notAdded.length));
        const box = el("div", "ba-next is-flat");
        for (const x of notAdded) {
          const d = el("div");
          d.append(el("span", "", x.label), el("i", x.grey ? "is-g" : "", x.why));
          box.append(d);
        }
        nodes.push(box);
      }
      if (notAdded.some((x) => x.why.startsWith("details not filled"))) nodes.push(aside("控", "", "Details not filled can be added from the stop’s Edit sheet.", "is-warn"));
      const firstDay = ok.map((i) => placeLabel(i).date).filter((d) => d && dayNum(d) > 0).sort()[0];
      if (firstDay) {
        const n = (store.state.days || []).findIndex((d) => d.date === firstDay) + 1;
        const go = btn("ba-plain", "Open Day " + n + " · see the stubs");
        go.id = "bulkOpenDay";
        go.dataset.day = firstDay;
        nodes.push(go);
      }
    }
    return nodes;
  }

  let lastSig = "";
  function draw() {
    drawTop();
    const focusKey = document.activeElement && sheet.contains(document.activeElement) ? focusId(document.activeElement) : null;
    let nodes;
    if (phase === "empty") {
      nodes = [emptyZone()];
      if (list && (list.error || (list.warn && list.warn.length))) nodes.push(aside("表", "", list.error || list.warn.join(" "), "is-warn"));
      const p = el("p", "ba-say");
      p.append("Yours, or anyone’s on the trip. The conductor sorts them; you only look at the odd ones. ", el("b", "", NOTHING_SENT));
      nodes.push(p);
      if (store.state.ticketList === true) nodes.push(checkLine());
    } else if (phase === "fetching") {
      nodes = [progress(fetching.total ? "Fetching " + fetching.done + " of " + plural(fetching.total, "file", "files") + " from the list…" : "Looking at the list…", "One at a time, from the list’s ticket folder, then made into pictures on this phone. " + NOTHING_SENT, fetching.done, fetching.total)];
    } else if (phase === "reading" || phase === "sorted") {
      const r = sorted();
      lastSig = sigOf(r);
      noteStops();
      nodes = drawSorted(r);
    }
    else nodes = drawAdded();
    body.replaceChildren(...nodes);
    if (focusKey) refocus(focusKey);
  }
  // A redraw keeps focus on the same control (keyboard on a computer).
  const ATTRS = ["choice", "lchoice", "other", "put", "out", "line", "who", "act", "pickFor", "move"];
  function focusId(n) {
    if (n.id) return "#" + n.id;
    for (const a of ATTRS) if (n.dataset && n.dataset[a] !== undefined) return "[data-" + a.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) + '="' + CSS.escape(n.dataset[a]) + '"]';
    return null;
  }
  function refocus(sel) {
    const n = body.querySelector(sel) || sheet.querySelector(sel);
    if (n && !n.disabled) n.focus({ preventScroll: true });
    else if (body.querySelector(".ba-card button")) body.querySelector(".ba-card button").focus({ preventScroll: true });
    else topB.focus({ preventScroll: true });
  }

  const sigOf = (r) => JSON.stringify([r.items.map((i) => [i.key, placeKey(i), i.who, i.pages]), r.cards.map((c) => [c.key, c.kind, c.choices.map((x) => placeKey(x))]), r.out.map((o) => o.kind + (o.key || "")), r.now, r.after, (store.state.stops || []).map((x) => x.id + x.date + x.time + x.title + !!x.deleted), (store.state.stays || []).map((x) => x.id + x.firstNight + x.lastNight + x.name + !!x.deleted)]);

  // After an answer or a change of the trip: sort again and draw.
  function afterChange() {
    draw();
  }

  // ---- 入鋏: adding ----
  //
  // Three steps, so that nothing the person confirmed hangs on anything else.
  // Closing MAT part way loses the pictures not yet handed over (fix round 3).
  // 1. Every picture is made (a PDF's pages drawn here), in memory only.
  // 2. Then the pictures are handed to store.addTicket one at a time (fix
  //    round 2, R1), each one's outcome awaited before the next, as the
  //    single add does; each is put in the keep right before its own add
  //    (fix round 3, R2). One with no signal waits on the phone (in mat.queue,
  //    its data in the keep) and goes up later through the store's flush,
  //    which is one at a time, after a reload too.
  // 3. Then the stops' facts, each worked out as it is sent (I1).
  // A wipe (Forget, a refused key) or Cancel stops waiting at once (aborts).

  let aborts = new Set();
  const orAbort = (p) => new Promise((resolve) => {
    aborts.add(resolve);
    Promise.resolve(p).then((v) => {
      aborts.delete(resolve);
      resolve(v);
    }, () => {
      aborts.delete(resolve);
      resolve(null);
    });
  });

  // Every stop as it was when the sort was last drawn (I1): a stop changed
  // since then gets no facts from the list.
  let seenStops = new Map();
  let seenStays = new Map();
  const stopKey = (st) => {
    const b = { ...st };
    delete b.pending;
    delete b.failed;
    return JSON.stringify(Object.keys(b).sort().map((k) => [k, b[k]]));
  };
  const noteStops = () => {
    seenStops = new Map((store.state.stops || []).filter((x) => x && x.id).map((x) => [x.id, stopKey(x)]));
    seenStays = new Map((store.state.stays || []).filter((x) => x && x.id).map((x) => [x.id, stopKey(x)]));
  };

  const FACTS_WHY = { notSent: "no signal", notLanded: "it didn’t land", unsure: "no reply yet, look at the stop later", gone: "the stop was removed", changed: "changed on another phone" };

  async function punch() {
    if (phase !== "sorted") return;
    const r = sorted();
    const done = (r.listDone || []).filter((d) => d.act !== "keep");
    if (!r.items.length && !done.length) return;
    // Fix round 1, M7: what is added is what was shown; a trip changed since is drawn again first.
    if (sigOf(r) !== lastSig) {
      draw();
      say.textContent = "The trip changed while you looked. Check it again, then 入鋏.";
      return;
    }
    const mine = gen;
    const at = keep.gen;
    const dead = () => mine !== gen || at !== keep.gen || store.state.status === "nokey";
    const rows = list && !list.error ? list.rows : [];
    const listing = mode === "list";
    // From the list: a changed line's new files go where its pictures are; the
    // old ones come off before (first) or after (replace) them; a cancelled
    // line's come off (off). Each picture added carries its tie.
    const extra = [];
    const offBefore = [], offAfter = [];
    for (const { card, act } of done) {
      if (act === "replace" || act === "first" || act === "add") {
        card.got.forEach((f, i) => extra.push({ key: card.key + "#" + i, file: f, label: card.label, ...placeOf(card), who: card.who, rowIds: card.rowIds, pages: Math.min(Math.max(1, f.pages || 1), LIMITS.perStop), cut: "", from: "card" }));
      }
      const ids = card.drop.map((t) => ({ id: t.id, label: card.label }));
      if (act === "first" || act === "off") offBefore.push(...ids);
      if (act === "replace") offAfter.push(...ids);
    }
    const all = r.items.concat(extra);
    phase = "adding";
    adding = {
      step: "making", made: 0, pics: 0, settled: 0, total: all.length, busy: 0, off: 0,
      items: all.map((i) => ({ ...i, saved: 0, waiting: 0, busy: 0, failed: 0, message: "", short: 0 })),
      notAdded: [],
    };
    // What the sort left out goes on the Not added list: cards not looked at, then the rest.
    for (const c of r.cards) adding.notAdded.push({ label: c.label, why: "left out: " + c.short });
    for (const o of r.out) {
      if (o.kind === "there") adding.notAdded.push({ label: [o.label.split(" · ")[0], placeLabel(o).there ? placeLabel(o).title : ""].filter(Boolean).join(" · "), why: "already there", grey: true });
      else if (o.kind === "notTicket") adding.notAdded.push({ label: o.file.name, why: o.file.unreadable || "not a ticket file", grey: true });
      else adding.notAdded.push({ label: o.label, why: o.why });
    }
    if (listing) {
      for (const h of handPre) adding.notAdded.push({ label: h.label, why: "filled by hand", grey: true });
      for (const x of fetching.failed) adding.notAdded.push({ label: x.label, why: x.why });
    }
    draw();
    say.textContent = all.length ? "Adding " + plural(all.length, "ticket", "tickets") + "." : "Taking " + plural(offBefore.length, "picture", "pictures") + " off.";

    // 1. Every picture made (in memory only), nothing kept or sent yet.
    const pics = []; // { it, id, pic, k }
    const hold = (it, pic, k) => {
      pics.push({ it, id: newId(), pic, k });
    };
    for (const it of adding.items) {
      if (dead()) break;
      const firstPicture = pics.length;
      try {
        // The review already holds the final compressed first page (or image).
        hold(it, it.file.pic, 0);
        if (it.file.kind === "application/pdf" && it.pages > 1) {
          let bad = false;
          await pdfPages(it.file.raw, {
            max: it.pages, skipFirst: true,
            each: async (canvas, k) => {
              if (bad || dead()) return;
              try {
                hold(it, await shrinkCanvas(canvas), k);
              } catch {
                bad = true;
                it.short = it.pages - k;
              }
            },
          });
        }
      } catch {
        it.failed += 1;
        pics.splice(firstPicture);
        it.message = "That PDF couldn’t be read here. Try a screenshot of the ticket instead.";
      }
      if (dead()) return;
      adding.made += 1;
      draw();
    }
    if (dead()) return;

    // Pictures a card said to take off, one at a time, each waited on (soft: History puts them back).
    async function takeOff(list) {
      for (const { id, label } of list) {
        if (dead()) return;
        let unsure = null;
        const noReply = new Promise((resolve) => {
          unsure = resolve;
        });
        const token = store.removeTicket(id, { quiet: true, onUnsure: () => unsure({ saved: false, reason: "unsure" }) });
        const out = token ? await orAbort(Promise.race([store.outcome(token), noReply])) : null;
        if (mine !== gen) return;
        const now = (store.state.tickets || []).find((t) => t && t.id === id);
        if ((out && out.saved) || !now || now.gone) adding.off += 1;
        else adding.notAdded.push({ label, why: "not taken off: " + (out && out.reason === "refused" ? out.message || "refused" : out && out.reason === "notSent" ? "no signal" : "no reply yet, look at the stop later") });
      }
    }
    if (offBefore.length) {
      adding.step = "off";
      draw();
      await takeOff(offBefore);
      if (mine !== gen || dead()) return;
    }

    // A stay the list names that MAT does not have yet: added first (store.addStay,
    // waited for; it needs signal, as a stop's edit does), then its pictures go
    // up on it. One that is not added keeps its pictures out.
    const made = new Map(); // newStay's place key -> the stay's id, or { failed: why }
    for (const it of adding.items) {
      if (!it.newStay || dead()) continue;
      const pk = placeKey(it);
      if (!made.has(pk)) {
        adding.step = "stay";
        draw();
        let unsure = null;
        const noReply = new Promise((resolve) => {
          unsure = resolve;
        });
        const token = store.addStay({ name: it.newStay.name, firstNight: it.newStay.firstNight, lastNight: it.newStay.lastNight }, { id: newId(), quiet: true, onUnsure: () => unsure({ saved: false, reason: "unsure" }) });
        const out = token ? await orAbort(Promise.race([store.outcome(token), noReply])) : null;
        if (mine !== gen) return;
        made.set(pk, out && out.saved && out.item ? out.item.id : { failed: out && out.reason === "refused" ? out.message || "refused" : out && out.reason === "notSent" ? "no signal" : "no reply yet, look at Days later" });
      }
      const got = made.get(pk);
      if (typeof got === "string") {
        it.stay = got;
        delete it.newStay;
      } else {
        it.failed += 1;
        it.message = "the stay wasn’t added: " + got.failed;
      }
    }
    if (dead()) return;

    // 2. Handed over ONE AT A TIME, each one's outcome awaited before the next, as the single add does (fix round 2, R1): never two ticket sends of ours in flight. One that cannot go up (no signal, busy) settles as waiting and the next is handed over; with no signal the store keeps each without sending it.
    adding.step = "sending";
    adding.pics = pics.length;
    const liveOn = (p) => (store.state.tickets || []).filter((t) => t && !t.gone && (p.stay ? t.stay === p.stay : t.stop === p.stop));
    draw();
    for (const { it, id, pic, k } of pics.splice(0)) {
      if (dead()) break;
      // A stay that could not be added: its pictures stay out (said on the Not added list).
      if (it.newStay) continue;
      // Into the keep right before its own add, as the single add does (fix round 3, R2): a load's cleanup of the keep can never take a picture this loop has not reached. Not waited for: a keep that never answers must not hold the rest up; the data travels with the add.
      keep.put(id, pic.blob, { gen: at });
      const sameWho = liveOn(it).filter((t) => (t.who || "") === it.who).length;
      // From the list: its tie, and its page within its own file, so another phone adding the same one is told it is already there.
      const tie = listing && typeof it.file.tie === "string" ? it.file.tie : "";
      const page = tie ? Math.min(LIMITS.perStop, k + 1) : Math.min(LIMITS.perStop, Math.max(k + 1, sameWho + 1));
      const token = store.addTicket({ id, ...(it.stay ? { stay: it.stay } : { stop: it.stop }), who: it.who, seat: seatFor(it, rows), page, mime: pic.mime, w: pic.w, h: pic.h, data: pic.data, ...(tie ? { from: tie } : {}) });
      const res = await orAbort(store.ticketOutcome(token));
      if (mine !== gen) return;
      if (res && res.saved) it.saved += 1;
      else if (res && res.reason === "queued") {
        it.waiting += 1;
        if (res.busy) {
          it.busy += 1;
          adding.busy += 1;
        }
      } else {
        it.failed += 1;
        it.message = (res && res.message) || "That picture wasn’t saved.";
        keep.drop(id);
      }
      adding.settled += 1;
      draw();
    }
    if (mine !== gen) return;
    if (offAfter.length) {
      adding.step = "off";
      draw();
      await takeOff(offAfter);
      if (mine !== gen) return;
    }
    for (const it of adding.items) {
      // Fix round 1, M9: which limit cut a PDF.
      if (it.pages < it.file.pages) adding.notAdded.push({ label: (it.rowIds[0] || it.file.name) + " · pages " + (it.pages + 1) + (it.file.pages > it.pages + 1 ? "–" + it.file.pages : ""), why: it.cut === "trip" ? "trip full, " + LIMITS.perTrip + " of " + LIMITS.perTrip : (it.cut === "stay" ? "stay" : "stop") + " full, " + LIMITS.perStop + " of " + LIMITS.perStop });
      if (it.short) adding.notAdded.push({ label: it.label, why: it.short + " pages couldn’t be made into pictures here" });
      else if (it.failed) adding.notAdded.push({ label: it.newStay ? it.newStay.name : it.stay ? placeTitle(it) : it.label, why: it.message });
    }

    // 3. The stops' facts, each from the stop as this phone has it now.
    adding.step = "facts";
    draw();
    const missed = (id, why) => adding.notAdded.push({ label: (stopOf(id) || {}).title || (r.items.find((i) => i.stop === id) || {}).label || "A stop", why: "details not filled: " + FACTS_WHY[why] });
    const stopIds = [...new Set(adding.items.filter((i) => !isStayPlace(i)).map((i) => i.stop))];
    for (const id of stopIds) {
      if (dead()) break;
      const now = stopOf(id);
      const mineHere = adding.items.filter((i) => i.stop === id);
      const want = factsFor(mineHere, rows, now ? [now] : [{ id }])[id];
      if (!want) continue;
      if (!now) {
        missed(id, "gone");
        continue;
      }
      if (seenStops.get(id) !== stopKey(now)) {
        missed(id, "changed");
        continue;
      }
      let unsure = null;
      const noReply = new Promise((resolve) => {
        unsure = resolve;
      });
      const token = store.updateStop(id, want, { quiet: true, onUnsure: () => unsure({ saved: false, reason: "unsure" }) });
      if (!token) {
        missed(id, "gone");
        continue;
      }
      const out = await orAbort(Promise.race([store.outcome(token), noReply]));
      if (mine !== gen) return;
      if (!out || !out.saved) {
        if (out && out.reason === "refused") adding.notAdded.push({ label: now.title || "A stop", why: "details not filled: " + (out.message || "refused") });
        else missed(id, out ? out.reason : "unsure");
      }
    }
    // The stays' booking (tkRef, tkName), only where empty, through store.saveStay
    // (merge: only these fields). A stay this phone saw change since the sort gets none.
    const stayItems = adding.items.filter((i) => i.stay && i.saved + i.waiting > 0);
    const stayWant = stayFactsFor(stayItems, rows, store.state.stays || []);
    for (const [id, want] of Object.entries(stayWant)) {
      if (dead()) break;
      const now = stayOf_(id);
      const name = (now && now.name) || "A stay";
      if (!now) {
        adding.notAdded.push({ label: name, why: "details not filled: the stay was removed" });
        continue;
      }
      if (seenStays.has(id) && seenStays.get(id) !== stopKey(now)) {
        adding.notAdded.push({ label: name, why: "details not filled: " + FACTS_WHY.changed });
        continue;
      }
      let unsure = null;
      const noReply = new Promise((resolve) => {
        unsure = resolve;
      });
      const token = store.saveStay(id, want, { quiet: true, onUnsure: () => unsure({ saved: false, reason: "unsure" }) });
      const out = token ? await orAbort(Promise.race([store.outcome(token), noReply])) : null;
      if (mine !== gen) return;
      if (!out || !out.saved) adding.notAdded.push({ label: name, why: "details not filled: " + (out && out.reason === "refused" ? out.message || "refused" : FACTS_WHY[out ? out.reason : "unsure"] || FACTS_WHY.unsure) });
    }
    if (mine !== gen) return;
    phase = "added";
    draw();
    const ok = adding.items.filter((i) => i.saved + i.waiting > 0).length;
    say.textContent = plural(ok, "ticket", "tickets") + " added.";
  }

  // Check the list now (the owner's phone, the empty sheet): a forced look,
  // then the list's review if anything needs something.
  async function checkNow() {
    say.textContent = "Looking at the list…";
    const got = await checkList({ force: true });
    if (phase !== "empty") return;
    if (!got || !got.ok) {
      say.textContent = got && got.code === "network" ? "No signal: the list can’t be looked at now." : (got && got.message) || listErr || "The list can’t be looked at now.";
      return;
    }
    if (noticeNow()) return openList();
    say.textContent = "Nothing new on the list.";
  }

  // ---- taps ----

  function answerCard(key, a) {
    answers.set(key, a);
    checked.add(key);
    other = null;
    // From the list, left out: remembered on this phone, so it is not new again.
    if (mode === "list" && a.out) leftOut(key);
    afterChange();
  }
  function leftOut(key) {
    const f = files.find((x) => key.startsWith(x.key + "#"));
    if (f && f.tie) addSkip([f.tie]);
  }
  function answerList(key, act) {
    const card = listCards().find((c) => c.key === key);
    if (!card) return;
    lanswers.set(key, act);
    checked.add(key);
    if (act === "keep") addSkip(card.got.map((f) => f.tie).concat((plan.changed.find((c) => c.key === key) || { add: [] }).add.map((a) => a.tie), card.drop.map((t) => "keep:" + t.from)));
    afterChange();
  }

  body.addEventListener("click", (ev) => {
    const t = ev.target.closest("button");
    if (!t || t.disabled) return;
    if (t.id === "bulkChoose") return fileIn.click();
    if (t.id === "bulkCheckList") return checkNow();
    if (t.id === "bulkUnskip") {
      skip = new Set();
      addSkip([]);
      replan();
      return openList({ force: true });
    }
    if (t.id === "bulkChooseList") return listIn.click();
    if (t.id === "bulkPunch") return punch();
    if (t.id === "bulkOpenDay") {
      const day = t.dataset.day;
      close(false);
      onOpenDay(day);
      return;
    }
    const d = t.dataset;
    if (d.act === "untie") {
      untied = !untied;
      openLine = null;
      return draw();
    }
    if (d.act === "seeall") {
      seeAll = !seeAll;
      return draw();
    }
    const r = phase === "sorted" ? sorted() : null;
    if (!r) return;
    if (d.lchoice) {
      const [key, act] = d.lchoice.split("|");
      return answerList(key, act);
    }
    if (d.choice) {
      const [key, i] = d.choice.split("|");
      const card = r.cards.find((c) => c.key === key);
      const ch = card && card.choices[Number(i)];
      if (ch) answerCard(key, { ...placeOf(ch), who: ch.who, rowIds: ch.rowIds, pages: ch.pages || null });
      return;
    }
    if (d.other) {
      other = d.other;
      draw();
      const p = body.querySelector('[data-pick-for="' + CSS.escape(d.other) + '"]');
      if (p) p.focus();
      return;
    }
    if (d.put) {
      const card = r.cards.find((c) => c.key === d.put);
      const p = body.querySelector('[data-pick-for="' + CSS.escape(d.put) + '"]');
      if (!card || !p || !p.value) {
        say.textContent = "Pick a stop first.";
        if (p) p.focus();
        return;
      }
      answerCard(card.key, { stop: p.value, who: card.who || "", rowIds: card.rowIds || [] });
      return;
    }
    if (d.out) {
      const card = r.cards.find((c) => c.key === d.out);
      if (card) answerCard(card.key, { out: true, why: card.short });
      else {
        answers.set(d.out, { out: true });
        if (mode === "list") leftOut(d.out);
        openLine = null;
        afterChange();
      }
      return;
    }
    if (d.line) {
      openLine = openLine === d.line ? null : d.line;
      return draw();
    }
    if (d.who) {
      const [key, who] = d.who.split("|");
      const it = r.items.find((i) => i.key === key);
      if (it) {
        answers.set(key, { ...placeOf(it), who, rowIds: it.rowIds, pages: it.pages });
        afterChange();
      }
    }
  });
  body.addEventListener("change", (ev) => {
    const s = ev.target.closest && ev.target.closest("select[data-move]");
    if (!s || !s.value || phase !== "sorted") return;
    const it = sorted().items.find((i) => i.key === s.dataset.move);
    if (!it) return;
    answers.set(it.key, { stop: s.value, who: it.who, rowIds: it.rowIds });
    openLine = it.key;
    afterChange();
  });

  fileIn.addEventListener("change", () => {
    const f = [...(fileIn.files || [])];
    fileIn.value = "";
    if (f.length) take(f);
  });
  listIn.addEventListener("change", () => {
    const f = listIn.files && listIn.files[0];
    listIn.value = "";
    if (f) readList(f);
  });
  // A computer: files dropped anywhere on the sheet, before 入鋏.
  sheet.addEventListener("dragover", (ev) => {
    if (phase === "adding" || phase === "added") return;
    ev.preventDefault();
    sheet.classList.add("is-drop");
  });
  sheet.addEventListener("dragleave", (ev) => {
    if (ev.target === sheet) sheet.classList.remove("is-drop");
  });
  sheet.addEventListener("drop", (ev) => {
    sheet.classList.remove("is-drop");
    if (phase === "adding" || phase === "added") return;
    ev.preventDefault();
    const f = [...((ev.dataTransfer && ev.dataTransfer.files) || [])];
    if (f.length) take(f);
  });

  // Starts afresh: everything sorted is dropped (nothing was sent).
  function reset() {
    gen += 1;
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    files = [];
    for (const l of chgFiles.values()) for (const f of l) f.raw = null;
    list = null;
    answers = new Map();
    checked = new Set();
    untied = false;
    openLine = null;
    other = null;
    reading = { done: 0, total: 0 };
    hashes = new Map();
    adding = null;
    seenStops = new Map();
    seenStays = new Map();
    // Work waiting on the store (outcomes, facts) stops waiting.
    for (const done of [...aborts]) done(null);
    aborts = new Set();
    seeAll = false;
    mode = "drop";
    lanswers = new Map();
    chgFiles = new Map();
    fetching = { done: 0, total: 0, failed: [] };
    handPre = [];
    phase = "empty";
    say.textContent = "";
  }

  topB.addEventListener("click", () => {
    // Cancel throws away what was sorted; Done after adding starts afresh. Adding goes on behind a close.
    if (phase === "added" || phase === "empty" || phase === "sorted" || phase === "reading") reset();
    close();
  });
  scrim.addEventListener("click", () => close());
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && opened) close();
  });

  // The trip taken off this phone (Forget this phone, a refused key; fix
  // round 1, I3): as every other view, nothing of it stays: the list, the
  // files, their pictures' addresses, the answers and what was drawn, open
  // or not. Work begun before it is dropped.
  let wiped = false;
  function wipe() {
    reset();
    // What the list brought (its lines, the files' names and handles): gone, and the notice with it.
    listGen += 1;
    skip = new Set(); // the left-out ties in memory too: storage was cleared by Forget, and the next "leave out" must not write the old ones back
    listData = null;
    listErr = "";
    plan = null;
    looking = null;
    lastLook = null;
    replan();
    body.replaceChildren();
    say.textContent = "";
    topI.textContent = "一括";
    topB.textContent = "Cancel";
    fileIn.value = "";
    listIn.value = "";
    queue = Promise.resolve();
    close(false);
  }

  // Another phone's change (a stop moved, a picture added): sorted again, and
  // drawn when it shows differently (never under an open stop picker).
  store.subscribe(() => {
    if (store.state.status === "nokey") {
      if (!wiped) {
        wiped = true;
        wipe();
      }
      return;
    }
    wiped = false;
    // Another phone's (or this one's) pictures: the notice counted again.
    if (listData) replan();
    if (!opened || phase !== "sorted") return;
    if (sigOf(sorted()) === lastSig) return;
    const a = document.activeElement;
    if (a && a.tagName === "SELECT" && sheet.contains(a)) return;
    draw();
  });

  function open() {
    if (opened) return;
    opened = true;
    draw();
    sheet.classList.add("is-open");
    sheet.inert = false;
    scrim.hidden = false;
    root.classList.add("bulk-open");
    sheet.scrollTop = 0;
    topB.focus({ preventScroll: true });
  }

  function close(restoreFocus = true) {
    if (!opened) return;
    opened = false;
    sheet.classList.remove("is-open", "is-drop");
    sheet.inert = true;
    scrim.hidden = true;
    root.classList.remove("bulk-open");
    if (sheet.contains(document.activeElement)) document.activeElement.blur();
    onClose(restoreFocus === true);
  }

  // Reading files or adding (fix round 1, I4): a new release waits, open or not.
  const isBusy = () => phase === "reading" || phase === "adding" || phase === "fetching";

  return { open, close: (restoreFocus) => close(restoreFocus), isOpen: () => opened, isBusy, checkList, maybeCheckList, openList };
}
