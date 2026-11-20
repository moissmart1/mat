/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// js/bulkbatch.js and js/takeback.js: what a phone remembers of an Add from
// the list, and taking it all back. Everything is made up.
import test from "node:test";
import assert from "node:assert/strict";
import { BATCH_KEY, BATCH_MAX, batchOf, readBatches, writeBatches, addBatch, loadBatches, saveBatches, printOf, planOf, stopFree, resultText, rowText, NO_SIGNAL, NOT_LOOKED_UP } from "../js/bulkbatch.js";
import { createTakeBack } from "../js/takeback.js";

const id = (n) => "pictureid" + String(n).padStart(4, "0");
const STOP = { id: "newstop00001", date: "2026-12-16", time: "16:30", title: "Lantern boat", tkRef: "QZ-REF-1" };
const fields = (o = {}) => ({ at: "2026-12-12T00:13:00.000Z", n: 3, off: 2, items: [[id(1)], [id(2)], [id(3)]], removed: [id(8), id(9)], stops: [STOP.id], stays: ["newstay00001"], prints: { [STOP.id]: printOf(STOP) }, ...o });
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test("the record: ids, counts and times only, never a name, a reference or a file name", () => {
  const b = batchOf({ ...fields(), items: [[id(1), "Lantern boat.png", id(1), "x"], ["T010 boat.png"], [id(1), id(2)]], title: "Lantern boat", file: "T010 boat.png", prints: { [STOP.id]: printOf(STOP), other: "Lantern" } });
  assert.deepEqual(Object.keys(b).sort(), ["at", "back", "items", "n", "off", "prints", "removed", "stays", "stops"]);
  assert.deepEqual(b.items, [[id(1)], [id(2)]], "ids only, each picture once");
  assert.deepEqual(batchOf({ tickets: [id(1), id(2)] }).items, [[id(1)], [id(2)]], "an older record: one picture per ticket");
  assert.deepEqual(Object.keys(b.prints), [STOP.id]);
  assert.match(b.prints[STOP.id], /^[0-9a-f]{8}$/);
  const text = writeBatches([b]);
  for (const never of ["Lantern", "boat", ".png", "T010", "QZ-REF-1"]) assert.equal(text.includes(never), false, never);
  assert.equal(batchOf({ at: "yesterday" }).at, "");
  assert.equal(batchOf({ n: -1, off: 1.5 }).n, 0);
});

test("5 at most, newest first; a batch with the same time replaces its old self", () => {
  let list = [];
  for (let i = 0; i < 7; i++) list = addBatch(list, fields({ at: "2026-12-12T00:1" + i + ":00.000Z" }));
  assert.equal(list.length, BATCH_MAX);
  assert.deepEqual(list.map((b) => b.at.slice(14, 16)), ["16", "15", "14", "13", "12"]);
  list = addBatch(list, { ...fields({ at: "2026-12-12T00:14:00.000Z" }), back: "2026-12-12T00:20:00.000Z" });
  assert.equal(list.length, 5);
  assert.equal(list[0].back, "2026-12-12T00:20:00.000Z");
  assert.deepEqual(readBatches(writeBatches(list)), list);
  assert.deepEqual(readBatches("not json"), []);
  assert.deepEqual(readBatches('{"a":1}'), []);
  assert.deepEqual(readBatches('[{"n":3}]'), [], "a batch with no time is dropped");
});

test("a storage that throws: nothing is lost in memory, nothing throws", () => {
  const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
  assert.deepEqual(loadBatches(bad), []);
  assert.equal(saveBatches(bad, [batchOf(fields())]), false);
  assert.deepEqual(loadBatches(null), []);
  const ok = memory();
  assert.equal(saveBatches(ok, [batchOf(fields())]), true);
  assert.equal(loadBatches(ok).length, 1);
  assert.ok(ok.m.has(BATCH_KEY));
  assert.equal(BATCH_KEY, "mat.bulkBatch");
});

test("the plan: the batch's pictures still on come off, the old ones are put back, the new stop goes; the stay stays", () => {
  const b = batchOf(fields());
  const state = {
    online: true,
    stops: [STOP],
    stays: [{ id: "newstay00001", firstNight: "2026-12-14", lastNight: "2026-12-14", name: "Inn" }],
    tickets: [{ id: id(1), stop: STOP.id }, { id: id(2), stop: "otherstop001" }, { id: id(3), stop: "otherstop001", gone: true }, { id: id(8), stop: "otherstop001", gone: true }, { id: id(9), stop: "otherstop001" }],
  };
  const p = planOf(b, state);
  assert.deepEqual(p.remove, [id(1), id(2)]);
  assert.deepEqual(p.putBack, [id(8)], "one already back is not put back twice");
  assert.deepEqual(p.stops, [STOP.id]);
  assert.equal(p.stays, 1);
  assert.equal(p.blocked, false);
});

test("a stop that still holds a picture not the batch's, or that was changed since, is not removed", () => {
  const b = batchOf(fields());
  const base = { stops: [STOP], tickets: [{ id: id(1), stop: STOP.id }] };
  assert.equal(stopFree(STOP.id, b, base, { removing: [id(1)] }), true);
  assert.equal(stopFree(STOP.id, b, base), false, "the batch's own picture still on it, not being taken off");
  assert.equal(stopFree(STOP.id, b, { ...base, tickets: [{ id: id(1), stop: STOP.id }, { id: "handpic00001", stop: STOP.id }] }, { removing: [id(1)] }), false);
  assert.equal(stopFree(STOP.id, b, { ...base, tickets: [{ id: "handpic00001", stop: STOP.id, gone: true }] }), true);
  assert.equal(stopFree(STOP.id, b, { stops: [{ ...STOP, time: "17:00" }], tickets: [] }), false, "moved since");
  assert.equal(stopFree(STOP.id, b, { stops: [{ ...STOP, note: "bring cash" }], tickets: [] }), false, "a note added since");
  assert.equal(stopFree(STOP.id, b, { stops: [{ ...STOP, deleted: true }], tickets: [] }), false);
  assert.equal(stopFree(STOP.id, b, { stops: [], tickets: [] }), false);
  assert.equal(stopFree(STOP.id, batchOf({ ...fields(), prints: {} }), { stops: [STOP], tickets: [] }), false, "no print: never removed");
  // The print is the stop's own fields, whatever the store adds around them.
  assert.equal(printOf({ ...STOP, pending: true, lat: "", deleted: false }), printOf(STOP));
  assert.equal(printOf({ ...STOP, booked: false }), printOf(STOP));
  assert.notEqual(printOf({ ...STOP, booked: true }), printOf(STOP));
});

test("no signal: nothing tried once anything was sent; pictures only waiting on the phone can still be taken back", () => {
  const b = batchOf(fields({ removed: [], stops: [] }));
  const state = { online: false, stops: [], stays: [], tickets: [{ id: id(1), stop: "s" }, { id: id(2), stop: "s" }] };
  assert.equal(planOf(b, state).blocked, true);
  assert.equal(planOf(b, state, { unsent: new Set([id(1), id(2)]) }).blocked, false);
  assert.equal(planOf(batchOf(fields({ stops: [] })), state, { unsent: new Set([id(1), id(2)]) }).blocked, true, "old pictures to put back need signal");
  assert.equal(planOf(b, { ...state, online: true }).blocked, false);
});

test("the words: the result, and the row on the added screen and in History", () => {
  assert.equal(resultText({ total: 10, back: 10 }), "Taken back: 10 tickets.");
  assert.equal(resultText({ total: 1, back: 1 }), "Taken back: 1 ticket.");
  assert.equal(resultText({ total: 10, back: 8, done: false }), "Taken back 8 of 10. Try again for the rest.");
  assert.equal(resultText({ total: 10, back: 10, put: 1, done: false }), "Taken back: 10 tickets. 1 old picture put back. Try again for the rest.");
  assert.equal(resultText({ total: 10, back: 10, put: 2 }), "Taken back: 10 tickets. 2 old pictures put back.");
  assert.equal(resultText({ total: 10, back: 10, put: 1, lost: 1 }), "Taken back: 10 tickets. 1 old picture put back. The rest have their own line in History.");
  assert.equal(resultText({ total: 3, back: 3, stays: 1 }), "Taken back: 3 tickets. The stay it added is left on.");
  assert.equal(NO_SIGNAL, "No signal. Take it back from History when there is signal.");
  const b = batchOf(fields({ n: 10 }));
  const r = rowText(b, "sheet");
  assert.match(r.time, /^\d\d:\d\d$/);
  assert.equal(r.title, "10 tickets from the list");
  assert.equal(r.small, "also in History");
  assert.match(rowText(b).small, /^added from this phone · (Sun|Mon|Tue|Wed|Thu|Fri|Sat) Dec 1[12]$/);
  assert.equal(rowText(batchOf(fields({ n: 1 }))).title, "1 ticket from the list");
  assert.equal(rowText(batchOf(fields({ n: 0, off: 2 }))).title, "2 pictures taken off, from the list");
  const back = rowText({ ...b, back: "2026-12-12T00:20:00.000Z" });
  assert.match(back.small, /^taken back at \d\d:\d\d$/);
  assert.equal(back.undone, true);
});

// A stand-in store with the calls the runner uses, in the order it is called.
// log: the whole History, any length (historyFor asks by ref, as the backend
// does, with no page limit; state.history holds only the first 200).
// cut: a function (call name) -> true when that call meets no signal.
function fakeStore({ online = true, tickets = [], stops = [], log = [], cut = () => false } = {}) {
  const calls = [];
  const subs = new Set();
  const store = {
    state: { status: "ready", online, tickets, stops, stays: [], history: { entries: log.slice(0, 200) } },
    calls,
    subscribe(fn) {
      subs.add(fn);
    },
    emit() {
      for (const fn of subs) fn();
    },
    unsaved: () => false,
    removeTicket(tid) {
      calls.push("removeTicket:" + tid);
      if (cut("removeTicket:" + tid)) return "fail-" + tid; // sent, rolled back: no signal
      this.state.tickets = this.state.tickets.map((t) => (t.id === tid ? { ...t, gone: true } : t));
      return "tok-" + tid;
    },
    outcome: async (tok) => (tok.startsWith("fail-") ? { saved: false, reason: "notSent" } : { saved: true }),
    async historyFor(ref) {
      calls.push("historyFor:" + ref);
      if (cut("historyFor:" + ref)) throw Object.assign(new Error("No signal"), { code: "network" });
      return log.filter((e) => e.ref === ref);
    },
    loadHistory: async () => {
      calls.push("loadHistory");
    },
    async undoEntry(n) {
      calls.push("undoEntry:" + n);
      if (cut("undoEntry:" + n)) return false;
      const e = log.find((x) => x.id === n);
      e.undoneBy = 999;
      e.canUndo = false;
      this.state.tickets = this.state.tickets.map((t) => (t.id === e.ref ? { ...t, gone: false } : t));
      return true;
    },
    deleteStop(sid) {
      calls.push("deleteStop:" + sid);
      this.state.stops = this.state.stops.map((s) => (s.id === sid ? { ...s, deleted: true } : s));
    },
    idle: async () => {
      calls.push("idle");
    },
    notify(t) {
      calls.push("notify:" + t);
    },
  };
  return store;
}
const AT = "2026-12-12T00:13:00.000Z";
// A batch's trip: its three new pictures (one on the new stop), its two old ones off, and older History.
const world = (o = {}) => fakeStore({
  tickets: [{ id: id(1), stop: STOP.id }, { id: id(2), stop: "otherstop001" }, { id: id(3), stop: "otherstop001" }, { id: id(8), stop: "otherstop001", gone: true }, { id: id(9), stop: "otherstop001", gone: true }],
  stops: [STOP],
  log: [
    { id: 7, kind: "ticket", ref: id(9), action: "remove", canUndo: true },
    { id: 6, kind: "ticket", ref: id(8), action: "remove", canUndo: true },
    { id: 5, kind: "ticket", ref: id(8), action: "remove", canUndo: false, undoneBy: 4 },
  ],
  ...o,
});

test("the runner: the old pictures looked up first, then one step at a time, in order; the row reads taken back and it is said", async () => {
  const store = world();
  const storage = memory();
  let t = Date.parse("2026-12-12T00:20:00.000Z");
  const tb = createTakeBack(store, { storage, now: () => t });
  assert.equal(tb.record(fields({ stays: [] })).at, AT);
  assert.equal(tb.record({ at: "2026-12-12T00:14:00.000Z", n: 0, off: 0 }), null, "nothing added or taken off: no row");
  assert.equal(loadBatches(storage).length, 1);
  const seen = [];
  tb.subscribe(() => seen.push(tb.running(AT)));
  const text = await tb.run(AT);
  assert.equal(text, "Taken back: 3 tickets. 2 old pictures put back.");
  assert.deepEqual(store.calls, ["historyFor:" + id(8), "historyFor:" + id(9), "removeTicket:" + id(1), "removeTicket:" + id(2), "removeTicket:" + id(3), "undoEntry:6", "undoEntry:7", "deleteStop:" + STOP.id, "idle", "notify:" + text]);
  assert.deepEqual(seen, [true, false]);
  assert.equal(tb.list()[0].back, "2026-12-12T00:20:00.000Z");
  assert.equal(loadBatches(storage)[0].back, "2026-12-12T00:20:00.000Z");
  // A second tap does nothing.
  t += 1000;
  assert.equal(await tb.run(AT), "");
});

test("the runner counts tickets, not pages: a 3-page PDF is one ticket", async () => {
  const store = world({ tickets: [{ id: id(1), stop: "s" }, { id: id(2), stop: "s" }, { id: id(3), stop: "s" }, { id: id(4), stop: "s" }], log: [] });
  const tb = createTakeBack(store, { storage: memory() });
  tb.record(fields({ n: 2, items: [[id(1), id(2), id(3)], [id(4)]], removed: [], stops: [], stays: [] }));
  assert.equal(await tb.run(AT), "Taken back: 2 tickets.");
});

test("the runner: signal drops part way; the row keeps its button, and the second run does only what is left", async () => {
  let cutOff = true;
  const store = world({ cut: (c) => cutOff && (c === "removeTicket:" + id(3) || c.startsWith("undoEntry")) });
  const tb = createTakeBack(store, { storage: memory() });
  tb.record(fields({ stays: [] }));
  const first = await tb.run(AT);
  assert.equal(first, "Taken back 2 of 3. Try again for the rest.");
  assert.equal(tb.list()[0].back, "", "not marked taken back");
  assert.ok(store.calls.includes("deleteStop:" + STOP.id), "the stop whose picture surely came off goes");
  // Signal back: the same button again.
  cutOff = false;
  store.calls.length = 0;
  const second = await tb.run(AT);
  assert.equal(second, "Taken back: 3 tickets. 2 old pictures put back.");
  assert.deepEqual(store.calls.filter((c) => !c.startsWith("notify")), ["historyFor:" + id(8), "historyFor:" + id(9), "removeTicket:" + id(3), "undoEntry:6", "undoEntry:7"], "nothing done twice");
  assert.notEqual(tb.list()[0].back, "");
});

test("the runner: the first remove fails while the phone still thinks it is online; nothing is marked, the stop stays", async () => {
  const store = world({ cut: (c) => c === "removeTicket:" + id(1) });
  const tb = createTakeBack(store, { storage: memory() });
  tb.record(fields({ stays: [] }));
  assert.equal(await tb.run(AT), "Taken back 2 of 3. 2 old pictures put back. Try again for the rest.");
  assert.equal(tb.list()[0].back, "");
  assert.equal(store.calls.includes("deleteStop:" + STOP.id), false, "never a stop whose picture is still on");
});

test("the runner: a batch older than 200 History lines still finds its old pictures' lines", async () => {
  const old = [{ id: 6, kind: "ticket", ref: id(8), action: "remove", canUndo: true }, { id: 7, kind: "ticket", ref: id(9), action: "remove", canUndo: true }];
  const newer = Array.from({ length: 250 }, (_, i) => ({ id: 1000 - i, kind: "stop", ref: "otherstop001", action: "edit", canUndo: false }));
  const store = world({ log: newer.concat(old) });
  assert.equal(store.state.history.entries.some((e) => e.kind === "ticket"), false, "not on History's first page");
  const tb = createTakeBack(store, { storage: memory() });
  tb.record(fields({ stays: [] }));
  assert.equal(await tb.run(AT), "Taken back: 3 tickets. 2 old pictures put back.");
});

test("the runner: an old picture's lookup fails: nothing is taken back, and it is said", async () => {
  const store = world({ cut: (c) => c === "historyFor:" + id(9) });
  const tb = createTakeBack(store, { storage: memory() });
  tb.record(fields({ stays: [] }));
  assert.equal(await tb.run(AT), NOT_LOOKED_UP);
  assert.equal(store.calls.some((c) => /^(removeTicket|undoEntry|deleteStop)/.test(c)), false);
  assert.equal(tb.list()[0].back, "");
  store.state.online = false;
  assert.equal(await tb.run(AT), NO_SIGNAL);
});

test("the runner: no signal and something sent: nothing is tried; a wipe empties the memory", async () => {
  const store = fakeStore({ online: false, tickets: [{ id: id(1), stop: "s" }] });
  const tb = createTakeBack(store, { storage: memory() });
  tb.record(fields({ removed: [], stops: [], stays: [] }));
  assert.equal(await tb.run(AT), NO_SIGNAL);
  assert.deepEqual(store.calls, ["notify:" + NO_SIGNAL]);
  assert.equal(tb.list()[0].back, "");
  store.state.status = "nokey";
  store.emit();
  assert.deepEqual(tb.list(), []);
});

test("the runner: an old picture History can no longer put back is said, and the batch is done", async () => {
  const store = fakeStore({ tickets: [{ id: id(1), stop: "s" }, { id: id(8), stop: "s", gone: true }], log: [{ id: 3, kind: "ticket", ref: id(8), action: "remove", canUndo: false }] });
  const tb = createTakeBack(store, { storage: memory() });
  tb.record(fields({ n: 1, items: [[id(1)]], removed: [id(8)], stops: [], stays: [] }));
  assert.equal(await tb.run(AT), "Taken back: 1 ticket. The rest have their own line in History.");
  assert.notEqual(tb.list()[0].back, "");
});
