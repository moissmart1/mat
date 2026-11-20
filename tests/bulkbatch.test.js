/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// js/bulkbatch.js and js/takeback.js: what a phone remembers of an Add from
// the list, and taking it all back. Everything is made up.
import test from "node:test";
import assert from "node:assert/strict";
import { BATCH_KEY, BATCH_MAX, batchOf, readBatches, writeBatches, addBatch, loadBatches, saveBatches, printOf, planOf, stopFree, resultText, rowText, NO_SIGNAL } from "../js/bulkbatch.js";
import { createTakeBack } from "../js/takeback.js";

const id = (n) => "pictureid" + String(n).padStart(4, "0");
const STOP = { id: "newstop00001", date: "2026-12-16", time: "16:30", title: "Lantern boat", tkRef: "QZ-REF-1" };
const fields = (o = {}) => ({ at: "2026-12-12T00:13:00.000Z", n: 3, off: 2, tickets: [id(1), id(2), id(3)], removed: [id(8), id(9)], stops: [STOP.id], stays: ["newstay00001"], prints: { [STOP.id]: printOf(STOP) }, ...o });
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test("the record: ids, counts and times only, never a name, a reference or a file name", () => {
  const b = batchOf({ ...fields(), tickets: [id(1), "Lantern boat.png", id(1), "x"], title: "Lantern boat", file: "T010 boat.png", prints: { [STOP.id]: printOf(STOP), other: "Lantern" } });
  assert.deepEqual(Object.keys(b).sort(), ["at", "back", "n", "off", "prints", "removed", "stays", "stops", "tickets"]);
  assert.deepEqual(b.tickets, [id(1)]);
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
    tickets: [{ id: id(1), stop: STOP.id }, { id: id(2), stop: "otherstop001" }, { id: id(3), stop: "otherstop001", gone: true }, { id: id(8), stop: "otherstop001", gone: true }],
  };
  const p = planOf(b, state);
  assert.deepEqual(p.remove, [id(1), id(2)]);
  assert.deepEqual(p.putBack, [id(8), id(9)]);
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
  assert.equal(resultText({ total: 10, back: 8 }), "Taken back 8 of 10. The rest have their own line in History.");
  assert.equal(resultText({ total: 10, back: 10, put: 2, removed: 2 }), "Taken back: 10 tickets. 2 old pictures put back.");
  assert.equal(resultText({ total: 10, back: 10, put: 1, removed: 2 }), "Taken back: 10 tickets. 1 old picture put back. The rest have their own line in History.");
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
function fakeStore({ online = true, tickets = [], stops = [], history = [] } = {}) {
  const calls = [];
  const subs = new Set();
  const store = {
    state: { status: "ready", online, tickets, stops, stays: [], history: { entries: history } },
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
      this.state.tickets = this.state.tickets.map((t) => (t.id === tid ? { ...t, gone: true } : t));
      return "tok-" + tid;
    },
    outcome: async () => ({ saved: true }),
    loadHistory: async () => {
      calls.push("loadHistory");
    },
    async undoEntry(n) {
      calls.push("undoEntry:" + n);
      const e = this.state.history.entries.find((x) => x.id === n);
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

test("the runner: one step at a time, in order; then the row reads taken back and it is said", async () => {
  const store = fakeStore({
    tickets: [{ id: id(1), stop: STOP.id }, { id: id(2), stop: "otherstop001" }, { id: id(3), stop: "otherstop001" }, { id: id(8), stop: "otherstop001", gone: true }, { id: id(9), stop: "otherstop001", gone: true }],
    stops: [STOP],
    history: [
      { id: 7, kind: "ticket", ref: id(9), action: "remove", canUndo: true },
      { id: 6, kind: "ticket", ref: id(8), action: "remove", canUndo: true },
      { id: 5, kind: "ticket", ref: id(8), action: "remove", canUndo: false, undoneBy: 4 },
    ],
  });
  const storage = memory();
  let t = Date.parse("2026-12-12T00:20:00.000Z");
  const tb = createTakeBack(store, { storage, now: () => t });
  assert.equal(tb.record(fields({ stays: [] })).at, "2026-12-12T00:13:00.000Z");
  assert.equal(tb.record({ at: "2026-12-12T00:14:00.000Z", n: 0, off: 0 }), null, "nothing added or taken off: no row");
  assert.equal(loadBatches(storage).length, 1);
  const seen = [];
  tb.subscribe(() => seen.push(tb.running("2026-12-12T00:13:00.000Z")));
  const text = await tb.run("2026-12-12T00:13:00.000Z");
  assert.equal(text, "Taken back: 3 tickets. 2 old pictures put back.");
  assert.deepEqual(store.calls, ["removeTicket:" + id(1), "removeTicket:" + id(2), "removeTicket:" + id(3), "loadHistory", "undoEntry:6", "undoEntry:7", "deleteStop:" + STOP.id, "idle", "notify:" + text]);
  assert.deepEqual(seen, [true, false]);
  assert.equal(tb.list()[0].back, "2026-12-12T00:20:00.000Z");
  assert.equal(loadBatches(storage)[0].back, "2026-12-12T00:20:00.000Z");
  // A second tap does nothing.
  t += 1000;
  assert.equal(await tb.run("2026-12-12T00:13:00.000Z"), "");
});

test("the runner: no signal and something sent: nothing is tried; a wipe empties the memory", async () => {
  const store = fakeStore({ online: false, tickets: [{ id: id(1), stop: "s" }] });
  const tb = createTakeBack(store, { storage: memory() });
  tb.record(fields({ removed: [], stops: [], stays: [] }));
  assert.equal(await tb.run("2026-12-12T00:13:00.000Z"), NO_SIGNAL);
  assert.deepEqual(store.calls, ["notify:" + NO_SIGNAL]);
  assert.equal(tb.list()[0].back, "");
  store.state.status = "nokey";
  store.emit();
  assert.deepEqual(tb.list(), []);
});

test("the runner: an old picture changed since is not put back, and it is said", async () => {
  const store = fakeStore({ tickets: [{ id: id(1), stop: "s" }, { id: id(8), stop: "s", gone: true }], history: [{ id: 3, kind: "ticket", ref: id(8), action: "remove", canUndo: false }] });
  const tb = createTakeBack(store, { storage: memory() });
  tb.record(fields({ n: 1, tickets: [id(1)], removed: [id(8)], stops: [], stays: [] }));
  assert.equal(await tb.run("2026-12-12T00:13:00.000Z"), "Taken back: 1 ticket. The rest have their own line in History.");
});
