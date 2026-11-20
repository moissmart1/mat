import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createApi } from "../js/api.js";
import { createStore } from "../js/store.js";
import { balances, direct } from "../js/money.js";

const require = createRequire(import.meta.url);
const { createFakeBackend } = require("./fake-backend.cjs");
const SEED = require("./fixtures/seed.json");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY = "test-key";
const URL = "https://example.test/exec";
const NOW = Date.UTC(2026, 11, 11, 3);
const ALL = ["Mo", "Ajen", "Trenton"];
const UNDO_FAILED = "Couldn’t undo that. Try again from History.";
const STALE = "That was changed again since. Undo the newer change first.";

// ---------- helpers ----------

function memStorage(init = {}) {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

// One phone: a store on its own (or a shared) storage, talking to a fake
// backend through createApi with a controllable network.
//   net.offline        every request fails like a dropped connection
//   net.failing        actions that fail like a dropped connection
//   net.override(body) return an envelope to answer instead of the backend
//   net.hold(action)   the next response for that action waits for release()
//   net.lose           actions that reach the backend but whose reply is lost
//   net.garble         actions that reach the backend but get a non-envelope reply
//   net.knownOffline   the phone itself says it has no network: nothing is sent
//   timeoutMs          how long the api waits for a reply (the app's own 30 s by default)
function phone({ seed, fake, storage, me = "Mo", nowMs = NOW, clock, timeoutMs, ticketData } = {}) {
  fake = fake || createFakeBackend(seed);
  storage = storage || memStorage({ "mat.key": KEY, "mat.me": me });
  const net = { offline: false, knownOffline: false, failing: new Set(), lose: new Set(), garble: new Set(), override: null, holds: [], sent: [] };
  net.hold = (action) => {
    let release;
    const promise = new Promise((r) => { release = r; });
    net.holds.push({ action, promise, used: false });
    return release;
  };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    net.sent.push(body);
    if (net.offline || net.failing.has(body.action)) throw new TypeError("Failed to fetch");
    let env = net.override ? net.override(body) : null;
    if (!env) env = await fake(body);
    if (net.lose.has(body.action)) throw new TypeError("Load failed");
    if (net.garble.has(body.action)) return { ok: false, status: 502, text: async () => "<html>Bad gateway</html>" };
    const hold = net.holds.find((h) => h.action === body.action && !h.used);
    if (hold) {
      hold.used = true;
      await hold.promise;
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(env) };
  };
  const api = createApi({ url: URL, getKey: () => storage.getItem("mat.key"), getActor: () => storage.getItem("mat.me"), fetchImpl, isOnline: () => !net.knownOffline, ...(timeoutMs ? { timeoutMs } : {}) });
  const waits = [];
  const store = createStore({ api, storage, now: clock || (() => nowMs), wait: async (ms) => { waits.push(ms); }, ...(ticketData ? { ticketData } : {}) });
  return { fake, storage, net, api, store, waits };
}

// Straight to the backend, as another phone would.
async function backend(fake, action = "load", args = {}, actor = "Ajen") {
  const r = await fake({ key: KEY, actor, action, args });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data;
}

const until = async (f) => { for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 5)); };
const sent = (fake, action) => fake.requests.filter((r) => r.action === action).length;
const queueOf = (storage) => JSON.parse(storage.getItem("mat.queue") || "[]");
const byId = (list, id) => list.find((x) => x.id === id);

function draft(over = {}) {
  return { day: "2026-12-11", title: "Dinner", amount: 14500, currency: "JPY", paidBy: "Mo", split: ALL.slice(), splitMode: "equal", splitVals: [], note: "", kind: "", ...over };
}

// The id of the line a write token made.
function idOf(store) {
  return store.state.lastChange.item.id;
}

// ---------- api ----------

test("api posts { key, actor, via, action, args } as text/plain and resolves { rev, data }", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, rev: 7, data: { hello: 1 } }) };
  };
  let actor = "Mo";
  const api = createApi({ url: URL, getKey: () => "sekret-key", getActor: () => actor, fetchImpl });
  actor = "Ajen"; // read at call time
  const r = await api("load", { a: 1 });
  assert.deepEqual(r, { rev: 7, data: { hello: 1 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, URL);
  assert.equal(calls[0].url.includes("sekret"), false);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "text/plain;charset=utf-8");
  assert.deepEqual(JSON.parse(calls[0].init.body), { key: "sekret-key", actor: "Ajen", via: "app", action: "load", args: { a: 1 } });
});

test("api rejects with the backend's error code, network when fetch fails, server on a bad reply, and never shows the key", async () => {
  const reply = (text) => async () => ({ ok: true, status: 200, text: async () => text });
  const make = (fetchImpl) => createApi({ url: URL, getKey: () => "sekret-key", getActor: () => "Mo", fetchImpl });
  const cases = [
    [reply(JSON.stringify({ ok: false, error: "stale", message: "Too late." })), "stale"],
    [async () => { throw new TypeError("Failed to fetch"); }, "network"],
    [reply("<html>oops</html>"), "server"],
    [reply(JSON.stringify({ rev: 1, data: {} })), "server"],
    [reply(JSON.stringify({ ok: "yes" })), "server"],
  ];
  for (const [fetchImpl, code] of cases) {
    const err = await make(fetchImpl)("load").then(() => null, (e) => e);
    assert.ok(err instanceof Error, code);
    assert.equal(err.code, code);
    assert.equal(String(err.message).includes("sekret"), false);
    assert.equal(String(err.stack).includes("sekret"), false);
  }
});

test("api gives up after its timeout: a request that never settles is a network failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal = null;
  const never = (url, init) => { signal = init.signal; return new Promise(() => {}); }; // ignores the signal, never settles
  const api = createApi({ url: URL, getKey: () => "sekret-key", getActor: () => "Mo", fetchImpl: never, timeoutMs: 20 });
  const request = api("rev").then(() => null, (e) => e);
  t.mock.timers.tick(19);
  assert.equal(signal.aborted, false, "the request gets its full timeout");
  t.mock.timers.tick(1);
  const err = await request;
  assert.ok(err instanceof Error);
  assert.equal(err.code, "network");
  assert.ok(signal && signal.aborted, "the request was aborted");
  assert.equal(String(err.message).includes("sekret"), false);

  // A body that never finishes counts the same.
  let reading = false;
  const slowBody = async () => ({
    text() {
      reading = true;
      return new Promise(() => {});
    },
  });
  const body = createApi({ url: URL, getKey: () => KEY, getActor: () => "Mo", fetchImpl: slowBody, timeoutMs: 20 })("rev").then(() => null, (e) => e);
  await Promise.resolve(); // fetch answered, but reading its body is still pending
  assert.equal(reading, true);
  t.mock.timers.tick(20);
  assert.equal((await body).code, "network");
});

test("api waits 30 seconds by default before giving up", async () => {
  const { API_TIMEOUT_MS } = await import("../js/api.js");
  assert.equal(API_TIMEOUT_MS, 30000);
});

test("api uses MAT_FAKE_API in place of fetch, and a rejection from it is a network failure", async () => {
  const bodies = [];
  let fetched = 0;
  const api = createApi({ url: URL, getKey: () => KEY, getActor: () => "Mo", fetchImpl: async () => { fetched++; } });
  try {
    globalThis.MAT_FAKE_API = async (body) => { bodies.push(body); return { ok: true, rev: 3, data: { x: 1 } }; };
    assert.deepEqual(await api("rev", {}), { rev: 3, data: { x: 1 } });
    assert.deepEqual(bodies, [{ key: KEY, actor: "Mo", via: "app", action: "rev", args: {} }]);
    globalThis.MAT_FAKE_API = () => Promise.reject(new Error("bridge down"));
    const err = await api("rev", {}).then(() => null, (e) => e);
    assert.equal(err.code, "network");
    assert.equal(fetched, 0);
  } finally {
    delete globalThis.MAT_FAKE_API;
  }
});

// ---------- boot ----------

test("Boot paints from cache first", async () => {
  const p = phone({ seed: SEED });
  const empty = await backend(createFakeBackend());
  const cached = { id: "cached0001", ...draft({ title: "Cached" }), rate: 111, addedBy: "Mo", addedAt: "2026-12-11T01:00:00.000Z", deleted: false };
  p.storage.setItem("mat.cache", JSON.stringify({ data: { ...empty, expenses: [cached] }, rev: 0, loadedAt: 1000 }));
  const release = p.net.hold("load");
  const seen = [];
  p.store.subscribe((s) => seen.push({ ids: s.expenses.map((e) => e.id), loadedAt: s.loadedAt }));
  const booting = p.store.boot();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(seen.length >= 1);
  assert.deepEqual(seen[0].ids, ["cached0001"]);
  assert.equal(seen[0].loadedAt, 1000);
  assert.equal(p.store.state.status, "ready");
  release();
  await booting;
  const server = await backend(p.fake);
  assert.deepEqual(p.store.state.expenses, server.expenses);
  assert.deepEqual(p.store.state.people, server.people);
  assert.equal(p.store.state.status, "ready");
  assert.equal(p.store.state.loadedAt, NOW);
  assert.equal(p.store.state.online, true);
  assert.equal(p.store.state.me, "Mo");
  const cache = JSON.parse(p.storage.getItem("mat.cache"));
  assert.equal(cache.loadedAt, NOW);
  assert.equal(cache.data.expenses.length, 9);
});

test("No key", async () => {
  const p = phone({ storage: memStorage({ "mat.me": "Mo" }) });
  await p.store.boot();
  assert.equal(p.store.state.status, "nokey");
  assert.equal(p.net.sent.length, 0);
  assert.equal(p.fake.requests.length, 0);
});

test("Wrong key", async () => {
  const p = phone({ storage: memStorage({ "mat.key": "not-the-key", "mat.me": "Mo" }) });
  await p.store.boot();
  assert.equal(p.store.state.status, "nokey");
});

test("me is null when mat.me is missing or not one of the people, and setMe stores it", async () => {
  const a = phone({ storage: memStorage({ "mat.key": KEY }) });
  await a.store.boot();
  assert.equal(a.store.state.me, null);
  a.store.setMe("Ajen");
  assert.equal(a.store.state.me, "Ajen");
  assert.equal(a.storage.getItem("mat.me"), "Ajen");

  const b = phone({ storage: memStorage({ "mat.key": KEY, "mat.me": "Zed" }) });
  await b.store.boot();
  assert.equal(b.store.state.me, null);
});

test("corrupt JSON in mat.cache and mat.queue is treated as absent", async () => {
  const storage = memStorage({ "mat.key": KEY, "mat.me": "Mo", "mat.cache": "{not json", "mat.queue": "[oops" });
  const p = phone({ seed: SEED, storage });
  await p.store.boot();
  assert.equal(p.store.state.status, "ready");
  assert.equal(p.store.state.expenses.length, 9);
  assert.equal(sent(p.fake, "addExpense"), 0);
  // valid JSON of the wrong shape is ignored too
  const q = phone({ seed: SEED, storage: memStorage({ "mat.key": KEY, "mat.cache": "42", "mat.queue": "{\"a\":1}" }) });
  await q.store.boot();
  assert.equal(q.store.state.expenses.length, 9);
});

test("storage that throws never breaks the store", async () => {
  const fake = createFakeBackend(SEED);
  const writesThrow = { getItem: (k) => ({ "mat.key": KEY, "mat.me": "Mo" }[k] ?? null), setItem: () => { throw new Error("QuotaExceededError"); } };
  const p = phone({ fake, storage: writesThrow });
  await p.store.boot();
  assert.equal(p.store.state.status, "ready");
  p.store.addExpense(draft());
  p.store.markSeen();
  p.store.setMe("Ajen");
  await p.store.idle();
  assert.equal((await backend(fake)).expenses.length, 10);

  const allThrow = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); } };
  const q = phone({ fake, storage: allThrow });
  await q.store.boot();
  assert.equal(q.store.state.status, "nokey");
});

test("a failed load keeps the cached loadedAt and goes offline; the next good call comes back online", async () => {
  const first = phone({ seed: SEED });
  await first.store.boot();
  const p = phone({ fake: first.fake, storage: first.storage });
  p.storage.setItem("mat.cache", JSON.stringify({ ...JSON.parse(p.storage.getItem("mat.cache")), loadedAt: 1234 }));
  p.net.offline = true;
  await p.store.boot();
  assert.equal(p.store.state.status, "ready");
  assert.equal(p.store.state.online, false);
  assert.equal(p.store.state.loadedAt, 1234);
  assert.equal(p.store.state.expenses.length, 9);
  p.net.offline = false;
  await p.store.checkRev();
  assert.equal(p.store.state.online, true);
});

test("with no cache and no signal, boot ends in error", async () => {
  const p = phone({ seed: SEED });
  p.net.offline = true;
  await p.store.boot();
  assert.equal(p.store.state.status, "error");
  assert.equal(p.store.state.online, false);
});

// ---------- writes ----------

test("Optimistic add", async () => {
  const p = phone();
  await p.store.boot();
  const t = p.store.addExpense(draft());
  assert.equal(typeof t, "string");
  const id = idOf(p.store);
  const line = byId(p.store.state.expenses, id);
  assert.equal(line.pending, true);
  assert.equal(line.title, "Dinner");
  assert.equal(line.rate, p.store.state.rateToday);
  assert.equal(line.rate, 111);
  assert.deepEqual(p.store.state.lastChange, { token: t, action: "add", kind: "expense", item: p.store.state.lastChange.item, canUndo: true });
  await p.store.idle();
  const server = byId((await backend(p.fake)).expenses, id);
  assert.deepEqual(byId(p.store.state.expenses, id), server);
  assert.equal("pending" in byId(p.store.state.expenses, id), false);
  assert.equal(server.addedBy, "Mo");
});

test("an edit made while the add is in flight reaches the backend after it", async () => {
  const p = phone();
  await p.store.boot();
  p.store.addExpense(draft());
  const id = idOf(p.store);
  p.store.updateExpense(id, { amount: 15000 });
  assert.equal(byId(p.store.state.expenses, id).amount, 15000);
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, id).amount, 15000);
  assert.equal(byId(p.store.state.expenses, id).amount, 15000);
  const h = await backend(p.fake, "history", { ref: id });
  assert.deepEqual(h.entries.map((e) => e.action), ["edit", "add"]);
});

test("lastChange carries the item as changed, the old copy for an edit, and canUndo", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  const t = p.store.updateExpense("seedexp006", { title: "Dinner" });
  const lc = p.store.state.lastChange;
  assert.equal(lc.token, t);
  assert.equal(lc.action, "edit");
  assert.equal(lc.kind, "expense");
  assert.equal(lc.item.title, "Dinner");
  assert.equal(lc.before.title, "Shibuya dinner");
  assert.equal(lc.canUndo, true);
  await p.store.idle();
  for (const [fn, arg, action] of [["deleteExpense", "seedexp006", "delete"], ["restoreExpense", "seedexp006", "restore"]]) {
    p.store[fn](arg);
    assert.equal(p.store.state.lastChange.action, action);
    assert.equal(p.store.state.lastChange.canUndo, true);
    await p.store.idle();
  }
  const pt = p.store.addPayment({ from: "Ajen", to: "Mo", cad: 25 });
  assert.equal(p.store.state.lastChange.action, "stamp");
  assert.equal(p.store.state.lastChange.kind, "payment");
  await p.store.idle();
  const pid = idOf(p.store);
  p.store.removePayment(pid);
  assert.equal(p.store.state.lastChange.action, "unstamp");
  await p.store.idle();
  p.store.restorePayment(pid);
  assert.equal(p.store.state.lastChange.action, "restamp");
  await p.store.idle();
  assert.equal(typeof pt, "string");
});

test("addPayment makes an id, a whole seed from 1 to 999999 and a rot from -13 to 7 with one decimal", async () => {
  const p = phone();
  await p.store.boot();
  for (let i = 0; i < 40; i++) {
    p.store.addPayment({ from: "Ajen", to: "Mo", cad: 1 + i });
    const pay = p.store.state.lastChange.item;
    assert.match(pay.id, /^[A-Za-z0-9]{20}$/);
    assert.ok(Number.isInteger(pay.seed) && pay.seed >= 1 && pay.seed <= 999999, String(pay.seed));
    assert.ok(pay.rot >= -13 && pay.rot <= 7, String(pay.rot));
    assert.equal(Math.round(pay.rot * 10) / 10, pay.rot);
  }
  await p.store.idle();
  assert.equal((await backend(p.fake)).payments.length, 40);
});

test("Offline queue survives a reload", async () => {
  const one = phone();
  await one.store.boot();
  one.net.offline = true;
  one.store.addExpense(draft());
  const id = idOf(one.store);
  await one.store.idle();
  assert.equal(byId(one.store.state.expenses, id).pending, true);
  assert.equal(one.store.state.online, false);
  assert.deepEqual(queueOf(one.storage).map((q) => q.expense.id), [id]);

  // reload: a new store on the same storage, still without signal
  const two = phone({ fake: one.fake, storage: one.storage });
  two.net.offline = true;
  await two.store.boot();
  assert.equal(byId(two.store.state.expenses, id).pending, true);
  assert.equal(byId(two.store.state.expenses, id).title, "Dinner");

  two.net.offline = false;
  await Promise.all([two.store.flush(), two.store.flush()]);
  await two.store.flush();
  await two.store.idle();
  assert.equal(sent(one.fake, "addExpense"), 1);
  const server = await backend(one.fake);
  assert.equal(server.expenses.filter((e) => e.id === id).length, 1);
  assert.equal("pending" in byId(two.store.state.expenses, id), false);
  assert.deepEqual(queueOf(two.storage), []);

  // a third load of the page sends nothing more
  const three = phone({ fake: one.fake, storage: one.storage });
  await three.store.boot();
  await three.store.idle();
  assert.equal(sent(one.fake, "addExpense"), 1);
});

test("Undoing a queued line means it is never sent", async () => {
  const p = phone();
  await p.store.boot();
  p.net.offline = true;
  await p.store.checkRev(); // the phone now knows it has no signal
  assert.equal(p.store.state.online, false);
  const t = p.store.addExpense(draft());
  const id = idOf(p.store);
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, id).pending, true);
  assert.deepEqual(queueOf(p.storage).map((q) => [q.expense.id, q.sent]), [[id, false]]);
  await p.store.undo(t);
  assert.equal(byId(p.store.state.expenses, id), undefined);
  assert.deepEqual(queueOf(p.storage), []);
  p.net.offline = false;
  await p.store.flush();
  await p.store.checkRev();
  await p.store.idle();
  // a reload sends nothing either
  const again = phone({ fake: p.fake, storage: p.storage });
  await again.store.boot();
  await again.store.idle();
  assert.equal(p.net.sent.filter((b) => b.action === "addExpense").length + again.net.sent.filter((b) => b.action === "addExpense").length, 0);
  assert.equal(sent(p.fake, "addExpense"), 0);
  assert.equal(sent(p.fake, "undo"), 0);
  assert.deepEqual((await backend(p.fake)).expenses, []);
  assert.deepEqual((await backend(p.fake, "history")).entries, []);
});

test("a line undone after flush() has picked it is skipped and the lines after it still go", async () => {
  const p = phone();
  await p.store.boot();
  p.net.offline = true;
  await p.store.checkRev();
  p.store.addExpense(draft({ title: "First" }));
  const first = idOf(p.store);
  const t2 = p.store.addExpense(draft({ title: "Second" }));
  const second = idOf(p.store);
  p.store.addExpense(draft({ title: "Third" }));
  const third = idOf(p.store);
  await p.store.idle();
  p.net.offline = false;
  const flushing = p.store.flush(); // First is on its way; Second and Third are picked
  p.store.undo(t2);
  await flushing;
  await p.store.idle();
  const server = (await backend(p.fake)).expenses;
  assert.deepEqual(server.map((e) => e.id).sort(), [first, third].sort());
  assert.equal(p.fake.requests.filter((r) => r.action === "addExpense" && r.args.expense.id === second).length, 0);
  assert.equal(sent(p.fake, "undo"), 0);
  assert.deepEqual(queueOf(p.storage), []);
  assert.equal(byId(p.store.state.expenses, second), undefined);
  assert.equal("pending" in byId(p.store.state.expenses, third), false);
});

test("a queued line looks the same after a reload: its time and rate are kept", async () => {
  const one = phone();
  await one.store.boot();
  one.net.offline = true;
  one.store.addExpense(draft());
  const id = idOf(one.store);
  await one.store.idle();
  const shown = byId(one.store.state.expenses, id);
  assert.equal(shown.addedAt, new Date(NOW).toISOString());
  assert.equal(shown.rate, 111);
  // the next day the cached rate has moved on
  const cache = JSON.parse(one.storage.getItem("mat.cache"));
  cache.data.rateToday = 120;
  one.storage.setItem("mat.cache", JSON.stringify(cache));
  const two = phone({ fake: one.fake, storage: one.storage, nowMs: NOW + 86400000 });
  two.net.offline = true;
  await two.store.boot();
  assert.equal(two.store.state.rateToday, 120);
  const again = byId(two.store.state.expenses, id);
  assert.equal(again.addedAt, new Date(NOW).toISOString());
  assert.equal(again.rate, 111);
  assert.equal(again.addedBy, "Mo");
  assert.equal(again.pending, true);
});

test("the queue goes out on any contact: a later checkRev sends it exactly once", async () => {
  const one = phone();
  await one.store.boot();
  one.net.offline = true;
  one.store.addExpense(draft());
  const id = idOf(one.store);
  await one.store.idle();
  const two = phone({ fake: one.fake, storage: one.storage });
  two.net.offline = true;
  await two.store.boot();
  assert.equal(byId(two.store.state.expenses, id).pending, true);
  two.net.offline = false;
  await two.store.checkRev(); // rev unchanged, still proof of contact
  await two.store.idle();
  await two.store.checkRev();
  await two.store.refresh();
  await two.store.idle();
  assert.equal(sent(one.fake, "addExpense"), 1);
  assert.equal("pending" in byId(two.store.state.expenses, id), false);
  assert.deepEqual(queueOf(two.storage), []);
});

test("an undone add whose reply was lost is finished on the next contact: add then undo", async () => {
  const p = phone();
  await p.store.boot();
  p.net.lose.add("addExpense"); // reaches the backend, the reply never comes back
  const t = p.store.addExpense(draft());
  const id = idOf(p.store);
  p.store.undo(t);
  await p.store.idle();
  assert.equal(p.store.state.expenses.find((e) => e.id === id && !e.deleted), undefined);
  assert.equal(byId((await backend(p.fake)).expenses, id).deleted, false); // live on the backend for now
  assert.deepEqual(queueOf(p.storage).map((q) => [q.undo, q.args.expense.id]), [[true, id]]);
  assert.equal(p.store.state.online, false);
  p.net.lose.clear();
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, id).deleted, true);
  assert.deepEqual((await backend(p.fake, "history")).entries.map((e) => e.action), ["undo", "add"]);
  assert.deepEqual(byId(p.store.state.expenses, id), byId((await backend(p.fake)).expenses, id));
  assert.deepEqual(queueOf(p.storage), []);
  assert.equal(p.store.state.notice, null);
  await p.store.refresh();
  assert.equal(byId(p.store.state.expenses, id).deleted, true);
});

test("an undone add whose request never arrived ends the same way: add then undo", async () => {
  const p = phone();
  await p.store.boot();
  p.net.failing.add("addExpense");
  const t = p.store.addExpense(draft());
  const id = idOf(p.store);
  p.store.undo(t);
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, id), undefined);
  assert.equal(queueOf(p.storage)[0].undo, true);
  p.net.failing.clear();
  await p.store.flush();
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, id).deleted, true);
  assert.deepEqual((await backend(p.fake, "history")).entries.map((e) => e.action), ["undo", "add"]);
  assert.deepEqual(queueOf(p.storage), []);
});

test("an undo whose own reply was lost is finished without a second undo", async () => {
  const p = phone();
  await p.store.boot();
  const t = p.store.addExpense(draft());
  const id = idOf(p.store);
  await p.store.idle();
  p.net.lose.add("undo");
  p.store.undo(t);
  await p.store.idle();
  assert.equal(p.store.state.expenses.find((e) => e.id === id && !e.deleted), undefined);
  assert.equal(queueOf(p.storage)[0].undo, true);
  p.net.lose.clear();
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, id).deleted, true);
  assert.deepEqual((await backend(p.fake, "history")).entries.map((e) => e.action), ["undo", "add"]);
  assert.equal(byId(p.store.state.expenses, id).deleted, true);
  assert.equal(p.store.state.notice, null);
  assert.deepEqual(queueOf(p.storage), []);
});

test("a reload between an undo and its add's reply still ends with the line undone", async () => {
  const one = phone();
  await one.store.boot();
  one.net.hold("addExpense"); // the backend has it, the reply never arrives before the reload
  const t = one.store.addExpense(draft());
  const id = idOf(one.store);
  one.store.undo(t);
  assert.deepEqual(queueOf(one.storage).map((q) => [q.undo, q.args.expense.id]), [[true, id]]);

  const two = phone({ fake: one.fake, storage: one.storage });
  await two.store.boot();
  await two.store.idle();
  assert.equal(byId((await backend(two.fake)).expenses, id).deleted, true);
  assert.deepEqual((await backend(two.fake, "history")).entries.map((e) => e.action), ["undo", "add"]);
  assert.equal(byId(two.store.state.expenses, id).deleted, true);
  assert.equal("pending" in byId(two.store.state.expenses, id), false);
  assert.deepEqual(queueOf(two.storage), []);
});

test("a reload while an undone add waits offline finishes it on the next contact", async () => {
  const one = phone();
  await one.store.boot();
  one.net.lose.add("addExpense");
  const t = one.store.addExpense(draft());
  const id = idOf(one.store);
  one.store.undo(t);
  await one.store.idle();
  const two = phone({ fake: one.fake, storage: one.storage });
  two.net.offline = true;
  await two.store.boot();
  assert.equal(two.store.state.expenses.find((e) => e.id === id && !e.deleted), undefined);
  two.net.offline = false;
  await two.store.checkRev();
  await two.store.idle();
  assert.equal(byId((await backend(two.fake)).expenses, id).deleted, true);
  assert.deepEqual((await backend(two.fake, "history")).entries.map((e) => e.action), ["undo", "add"]);
  assert.deepEqual(queueOf(two.storage), []);
});

test("an undone add whose reply came back garbled is finished on the next contact: add then undo", async () => {
  const p = phone();
  await p.store.boot();
  p.net.garble.add("addExpense"); // the backend saved it, the reply is an error page
  const t = p.store.addExpense(draft());
  const id = idOf(p.store);
  p.store.undo(t);
  await p.store.idle();
  assert.equal(p.store.state.expenses.find((e) => e.id === id && !e.deleted), undefined);
  assert.deepEqual(queueOf(p.storage).map((q) => [q.undo, q.args.expense.id]), [[true, id]]);
  p.net.garble.clear();
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, id).deleted, true);
  assert.deepEqual((await backend(p.fake, "history")).entries.map((e) => e.action), ["undo", "add"]);
  await p.store.refresh();
  assert.equal(byId(p.store.state.expenses, id).deleted, true);
  assert.equal(p.store.state.notice, null);
  assert.deepEqual(queueOf(p.storage), []);
});

test("an add whose reply came back garbled stays queued and is resent once, not marked failed", async () => {
  const p = phone();
  await p.store.boot();
  p.net.garble.add("addExpense");
  p.store.addExpense(draft());
  const id = idOf(p.store);
  await p.store.idle();
  const line = byId(p.store.state.expenses, id);
  assert.equal(line.pending, true);
  assert.equal("failed" in line, false);
  assert.deepEqual(queueOf(p.storage).map((q) => [q.expense.id, q.failed, q.sent]), [[id, false, true]]);
  p.net.garble.clear();
  await p.store.checkRev();
  await p.store.idle();
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(sent(p.fake, "addExpense"), 2); // the garbled one and one resend
  const server = (await backend(p.fake)).expenses;
  assert.equal(server.filter((e) => e.id === id).length, 1);
  assert.deepEqual((await backend(p.fake, "history")).entries.map((e) => e.action), ["add"]);
  assert.deepEqual(byId(p.store.state.expenses, id), byId(server, id));
  assert.deepEqual(queueOf(p.storage), []);
});

test("an undo whose reply came back garbled is finished without a second undo", async () => {
  const p = phone();
  await p.store.boot();
  const t = p.store.addExpense(draft());
  const id = idOf(p.store);
  await p.store.idle();
  p.net.garble.add("undo");
  p.store.undo(t);
  await p.store.idle();
  assert.equal(p.store.state.expenses.find((e) => e.id === id && !e.deleted), undefined);
  p.net.garble.clear();
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, id).deleted, true);
  assert.deepEqual((await backend(p.fake, "history")).entries.map((e) => e.action), ["undo", "add"]);
  assert.equal(p.store.state.notice, null);
  assert.deepEqual(queueOf(p.storage), []);
});

test("an undone add that the backend refuses is dropped with nothing more sent", async () => {
  const p = phone();
  await p.store.boot();
  p.net.override = (body) => (body.action === "addExpense" ? { ok: false, error: "bad_input", message: "Pick a day." } : null);
  const t = p.store.addExpense(draft());
  const id = idOf(p.store);
  p.store.undo(t);
  await p.store.idle();
  p.net.override = null;
  await p.store.checkRev();
  await p.store.flush();
  await p.store.idle();
  assert.equal(p.net.sent.filter((b) => b.action === "addExpense").length, 1);
  assert.equal(p.net.sent.filter((b) => b.action === "undo").length, 0);
  assert.equal(byId(p.store.state.expenses, id), undefined);
  assert.deepEqual(queueOf(p.storage), []);
});

test("an undone stamp whose reply was lost is finished the same way", async () => {
  const p = phone();
  await p.store.boot();
  p.net.lose.add("addPayment");
  const t = p.store.addPayment({ from: "Ajen", to: "Mo", cad: 25 });
  const id = idOf(p.store);
  p.store.undo(t);
  await p.store.idle();
  p.net.lose.clear();
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).payments, id).removed, true);
  assert.deepEqual((await backend(p.fake, "history")).entries.map((e) => e.action), ["undo", "stamp"]);
});

test("Undo right after a write", async () => {
  const p = phone();
  await p.store.boot();
  const t = p.store.addExpense(draft());
  const id = idOf(p.store);
  assert.deepEqual(queueOf(p.storage).map((q) => q.expense.id), [id]); // kept until the backend has it
  p.store.undo(t);
  // its request is out, so the undo is kept until the backend confirms it
  assert.deepEqual(queueOf(p.storage).map((q) => [q.undo, q.args.expense.id]), [[true, id]]);
  assert.equal(p.store.state.expenses.find((e) => e.id === id && !e.deleted), undefined);
  assert.equal(p.store.state.lastChange.action, "undo");
  assert.equal(p.store.state.lastChange.canUndo, false);
  await p.store.idle();
  const server = byId((await backend(p.fake)).expenses, id);
  assert.equal(server.deleted, true);
  const h = await backend(p.fake, "history");
  assert.deepEqual(h.entries.map((e) => e.action), ["undo", "add"]);
  assert.deepEqual(byId(p.store.state.expenses, id), server);
  assert.deepEqual(queueOf(p.storage), []);
});

test("Undo of an edit and of a delete", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  const t1 = p.store.updateExpense("seedexp004", { amount: 4500 });
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, "seedexp004").amount, 4500);
  p.store.undo(t1);
  assert.equal(byId(p.store.state.expenses, "seedexp004").amount, 4200);
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, "seedexp004").amount, 4200);
  assert.equal(byId(p.store.state.expenses, "seedexp004").amount, 4200);

  const t2 = p.store.deleteExpense("seedexp006");
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, true);
  p.store.undo(t2);
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, false);
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, "seedexp006").deleted, false);
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, false);
});

test("Undo of a stamp", async () => {
  const p = phone();
  await p.store.boot();
  const t = p.store.addPayment({ from: "Ajen", to: "Mo", cad: 25 });
  const id = idOf(p.store);
  await p.store.idle();
  p.store.undo(t);
  assert.equal(byId(p.store.state.payments, id).removed, true);
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).payments, id).removed, true);
  assert.equal(byId(p.store.state.payments, id).removed, true);
});

test("undo of an unknown or already undone token does nothing", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  const t = p.store.deleteExpense("seedexp006");
  await p.store.idle();
  await p.store.undo("no-such-token");
  await p.store.undo(t);
  await p.store.undo(t);
  await p.store.idle();
  assert.equal(sent(p.fake, "undo"), 1);
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, false);
});

test("A failed undo puts things back", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  const t = p.store.updateExpense("seedexp004", { amount: 4500 });
  await p.store.idle();
  p.net.failing.add("undo");
  p.store.undo(t);
  assert.equal(byId(p.store.state.expenses, "seedexp004").amount, 4200);
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, "seedexp004").amount, 4500);
  // A failed fetch may have left the phone: no reply, so the fate is unknown.
  assert.equal(p.store.state.notice, UNCONFIRMED);
  assert.equal(p.store.state.online, false);
  assert.equal(byId((await backend(p.fake)).expenses, "seedexp004").amount, 4500);
});

test("an undo from the bar whose reply is lost says it is checking, and the next contact shows it undone", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  const t = p.store.updateExpense("seedexp004", { amount: 4500 });
  await p.store.idle();
  p.net.lose.add("undo");
  p.store.undo(t);
  await p.store.idle();
  assert.equal(p.store.state.notice, "Couldn’t confirm that. Checking…");
  p.net.lose.clear();
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, "seedexp004").amount, 4200, "the undo landed");
  assert.equal(byId(p.store.state.expenses, "seedexp004").amount, 4200, "the screen shows what the backend holds");
});

test("Stale undo from history", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.store.updateExpense("seedexp004", { amount: 4500 });
  p.store.updateExpense("seedexp004", { amount: 4600 });
  await p.store.idle();
  await p.store.loadHistory();
  const edits = p.store.state.history.entries.filter((e) => e.ref === "seedexp004" && e.action === "edit");
  assert.equal(edits.length, 2);
  const older = edits[edits.length - 1];
  const before = JSON.parse(JSON.stringify(p.store.state.expenses));
  await p.store.undoEntry(older.id);
  assert.equal(p.store.state.notice, STALE);
  assert.deepEqual(p.store.state.expenses, before);
  assert.equal(byId((await backend(p.fake)).expenses, "seedexp004").amount, 4600);
});

test("a stale undo bar shows the notice and then what the backend has", async () => {
  const a = phone({ seed: SEED });
  const b = phone({ seed: SEED, fake: a.fake, storage: memStorage({ "mat.key": KEY, "mat.me": "Ajen" }) });
  await a.store.boot();
  await b.store.boot();
  await a.store.loadHistory();
  const t = a.store.updateExpense("seedexp004", { amount: 4500 });
  await a.store.idle();
  await b.store.refresh();
  b.store.updateExpense("seedexp004", { amount: 4600 });
  await b.store.idle();
  await a.store.undo(t);
  await a.store.idle();
  assert.equal(a.store.state.notice, STALE);
  const server = await backend(a.fake);
  assert.deepEqual(a.store.state.expenses, server.expenses);
  assert.equal(byId(a.store.state.expenses, "seedexp004").amount, 4600);
  const top = a.store.state.history.entries[0];
  assert.equal(top.ref, "seedexp004");
  assert.equal(top.who, "Ajen");
  assert.equal(top.action, "edit");
});

test("a stale undo from history shows the notice, then the backend's data and a fresh tape", async () => {
  const a = phone({ seed: SEED });
  const b = phone({ seed: SEED, fake: a.fake, storage: memStorage({ "mat.key": KEY, "mat.me": "Ajen" }) });
  await a.store.boot();
  await b.store.boot();
  a.store.updateExpense("seedexp004", { amount: 4500 });
  await a.store.idle();
  await a.store.loadHistory();
  const mine = a.store.state.history.entries[0];
  assert.equal(mine.canUndo, true);
  await b.store.refresh();
  b.store.updateExpense("seedexp004", { amount: 4600 });
  await b.store.idle();
  const ok = await a.store.undoEntry(mine.id);
  assert.equal(ok, false);
  assert.equal(a.store.state.notice, STALE);
  assert.deepEqual(a.store.state.expenses, (await backend(a.fake)).expenses);
  assert.equal(a.store.state.history.entries[0].who, "Ajen");
  assert.equal(a.store.state.history.entries.find((e) => e.id === mine.id).canUndo, false);
});

test("undoEntry undoes a history entry and updates the tape", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  await p.store.loadHistory();
  const del = p.store.state.history.entries.find((e) => e.ref === "seedexp005" && e.action === "delete");
  assert.equal(del.canUndo, true);
  await p.store.undoEntry(del.id);
  assert.equal(byId(p.store.state.expenses, "seedexp005").deleted, false);
  assert.equal(p.store.state.lastChange.action, "undo");
  assert.equal(p.store.state.lastChange.canUndo, false);
  const top = p.store.state.history.entries[0];
  assert.equal(top.action, "undo");
  assert.equal(top.undoes, del.id);
  assert.equal(top.canUndo, true);
  const was = p.store.state.history.entries.find((e) => e.id === del.id);
  assert.equal(was.undoneBy, top.id);
  assert.equal(was.canUndo, false);
});

test("after an undo from History the tape is loaded again from the first page", async () => {
  const a = phone({ seed: SEED });
  const b = phone({ seed: SEED, fake: a.fake, storage: memStorage({ "mat.key": KEY, "mat.me": "Ajen" }) });
  await a.store.boot();
  await b.store.boot();
  await a.store.loadHistory();
  const del = a.store.state.history.entries.find((e) => e.ref === "seedexp005" && e.action === "delete");
  b.store.updateExpense("seedexp004", { amount: 4500 }); // another phone, after the tape was loaded
  await b.store.idle();
  const before = sent(a.fake, "history");
  await a.store.undoEntry(del.id);
  assert.equal(sent(a.fake, "history"), before + 1);
  const top = a.store.state.history.entries.slice(0, 2).map((e) => e.action + ":" + e.ref);
  assert.deepEqual(top, ["undo:seedexp005", "edit:seedexp004"]);
  assert.equal(a.store.state.history.entries.find((e) => e.id === del.id).undoneBy, a.store.state.history.entries.find((e) => e.action === "undo").id);
});

test("two overlapping first-page loads: the older request answering last never replaces the newer", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  const releaseA = p.net.hold("history");
  const a = p.store.loadHistory(); // reaches the backend now: sees ten entries
  await until(() => sent(p.fake, "history") === 1);
  await backend(p.fake, "updateExpense", { id: "seedexp004", patch: { amount: 4500 } });
  const releaseB = p.net.hold("history");
  const b = p.store.loadHistory(); // sees eleven
  await until(() => sent(p.fake, "history") === 2);
  releaseB();
  assert.equal((await b).entries.length, 11, "each load resolves with what it fetched");
  assert.equal(p.store.state.history.entries.length, 11);
  releaseA();
  const gotA = await a;
  assert.equal(gotA.entries.length, 10, "the older load still resolves with its own answer");
  assert.equal(gotA.error, null);
  assert.equal(p.store.state.history.entries.length, 11, "the older answer is dropped");
  assert.equal(p.store.state.history.entries[0].action, "edit");
  assert.equal(p.store.state.history.loading, false);
});

test("an older-page append is ignored when a first-page load started after it", async () => {
  const expenses = [];
  for (let i = 0; i < 205; i++) expenses.push({ id: "bulk" + String(i).padStart(6, "0"), day: "pre", title: "Line " + i, amount: 100, currency: "JPY", paidBy: "Mo", split: ALL.slice(), addedAt: new Date(Date.UTC(2026, 10, 1) + i * 1000).toISOString() });
  const p = phone({ seed: { expenses, payments: [] } });
  await p.store.boot();
  await p.store.loadHistory();
  assert.equal(p.store.state.history.entries.length, 200);
  const release = p.net.hold("history");
  const older = p.store.loadHistory({ older: true });
  await until(() => sent(p.fake, "history") === 2);
  await p.store.loadHistory(); // first page again, started after
  assert.equal(p.store.state.history.entries.length, 200);
  release();
  await older;
  assert.equal(p.store.state.history.entries.length, 200, "the append is not added to the new first page");
  assert.equal(p.store.state.history.more, true);
});

test("a failed History load says why: no connection, or any other trouble", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.failing.add("history");
  assert.deepEqual(await p.store.loadHistory(), { entries: [], more: false, error: "network" });
  assert.equal(p.store.state.history.error, "network");
  p.net.failing.clear();
  p.net.override = (body) => (body.action === "history" ? { ok: false, error: "server", message: "Boom" } : null);
  await p.store.loadHistory();
  assert.equal(p.store.state.history.error, "server");
  p.net.override = null;
  await p.store.loadHistory();
  assert.equal(p.store.state.history.error, null);
  assert.equal(p.store.state.history.entries.length, 10);
});

test("Busy is retried", async () => {
  const p = phone();
  await p.store.boot();
  let busy = 1;
  p.net.override = (body) => (body.action === "addExpense" && busy-- > 0 ? { ok: false, error: "busy", message: "Someone else is saving right now." } : null);
  p.store.addExpense(draft());
  const id = idOf(p.store);
  await p.store.idle();
  assert.equal((await backend(p.fake)).expenses.length, 1);
  const line = byId(p.store.state.expenses, id);
  assert.equal("failed" in line, false);
  assert.equal("pending" in line, false);
  assert.deepEqual(p.waits, [400]);
});

test("busy that never clears is tried four times and the line is marked failed", async () => {
  const p = phone();
  await p.store.boot();
  p.net.override = (body) => (body.action === "addExpense" ? { ok: false, error: "busy", message: "Someone else is saving right now." } : null);
  p.store.addExpense(draft());
  const id = idOf(p.store);
  await p.store.idle();
  assert.equal(p.net.sent.filter((b) => b.action === "addExpense").length, 4);
  assert.deepEqual(p.waits, [400, 400, 400]);
  assert.equal(byId(p.store.state.expenses, id).failed, true);
});

test("A refused write is marked, not dropped", async () => {
  const p = phone();
  await p.store.boot();
  p.net.override = (body) => (body.action === "addExpense" ? { ok: false, error: "bad_input", message: "Pick a day." } : null);
  p.store.addExpense(draft());
  const id = idOf(p.store);
  await p.store.idle();
  const line = byId(p.store.state.expenses, id);
  assert.equal(line.failed, true);
  assert.equal("pending" in line, false);
  assert.equal(line.title, "Dinner");
  assert.deepEqual(queueOf(p.storage).map((q) => [q.expense.id, q.failed]), [[id, true]]);
  // a failed line is not resent by flush
  p.net.override = null;
  await p.store.flush();
  assert.equal((await backend(p.fake)).expenses.length, 0);
});

test("retry resends a failed line with the same id", async () => {
  const p = phone();
  await p.store.boot();
  p.net.override = (body) => (body.action === "addExpense" ? { ok: false, error: "bad_input", message: "Pick a day." } : null);
  p.store.addExpense(draft());
  const id = idOf(p.store);
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, id).failed, true);
  p.net.override = null;
  p.store.retry(id);
  const line = byId(p.store.state.expenses, id);
  assert.equal(line.pending, true);
  assert.equal("failed" in line, false);
  await p.store.idle();
  const server = (await backend(p.fake)).expenses;
  assert.deepEqual(server.map((e) => e.id), [id]);
  assert.deepEqual(byId(p.store.state.expenses, id), server[0]);
  assert.deepEqual(queueOf(p.storage), []);
});

test("a refused edit is rolled back and its message shown", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.store.updateExpense("seedexp004", { splitMode: "exact", splitVals: [1, 2, 3] });
  await p.store.idle();
  const line = byId(p.store.state.expenses, "seedexp004");
  assert.equal(line.splitMode, "equal");
  assert.equal("pending" in line, false);
  assert.equal(typeof p.store.state.notice, "string");
});

test("Delete and restore roll back offline", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.offline = true;
  p.store.deleteExpense("seedexp006");
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, true);
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, false);
  assert.equal(p.store.state.online, false);
  p.store.restoreExpense("seedexp005");
  assert.equal(byId(p.store.state.expenses, "seedexp005").deleted, false);
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, "seedexp005").deleted, true);
  assert.deepEqual(queueOf(p.storage), []);
});

// ---------- reading ----------

test("checkRev only reloads on change", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  assert.equal(sent(p.fake, "load"), 1);
  await p.store.checkRev();
  await p.store.checkRev();
  assert.equal(sent(p.fake, "load"), 1);
  await backend(p.fake, "addExpense", { expense: { id: "other00001", ...draft({ title: "Their lunch", paidBy: "Ajen" }) } });
  await p.store.checkRev();
  assert.equal(sent(p.fake, "load"), 2);
  assert.equal(byId(p.store.state.expenses, "other00001").title, "Their lunch");
});

test("checkRev reloads when the rev goes down too", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  await backend(p.fake, "addExpense", { expense: { id: "other00001", ...draft() } });
  await p.store.checkRev();
  assert.equal(p.store.state.rev, 1);
  p.fake.props.REV = "0"; // settings reset on the backend
  await p.store.checkRev();
  assert.equal(sent(p.fake, "load"), 3);
  assert.equal(p.store.state.rev, 0);
});

test("own writes do not make checkRev reload, another phone's do", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.store.deleteExpense("seedexp006");
  await p.store.idle();
  await p.store.checkRev();
  assert.equal(sent(p.fake, "load"), 1);
  await backend(p.fake, "deleteExpense", { id: "seedexp004" });
  p.store.deleteExpense("seedexp003");
  await p.store.idle();
  await p.store.checkRev();
  assert.equal(sent(p.fake, "load"), 2);
  assert.equal(byId(p.store.state.expenses, "seedexp004").deleted, true);
});

test("a load sent before a write settled does not wipe the write", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  const release = p.net.hold("load");
  const refreshing = p.store.refresh(); // backend answers now, reply held
  await new Promise((r) => setTimeout(r, 0));
  p.store.addExpense(draft());
  const id = idOf(p.store);
  p.store.deleteExpense("seedexp006");
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, id).title, "Dinner");
  release();
  await refreshing;
  const line = byId(p.store.state.expenses, id);
  assert.ok(line, "the new line survives the older load");
  assert.equal("pending" in line, false);
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, true);
  // and the next load agrees with it
  await p.store.refresh();
  assert.equal(byId(p.store.state.expenses, id).title, "Dinner");
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, true);
});

test("an older load landing after a newer one is ignored", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  const release = p.net.hold("load");
  const first = p.store.refresh();
  await new Promise((r) => setTimeout(r, 0));
  await backend(p.fake, "addExpense", { expense: { id: "other00001", ...draft({ title: "Their lunch" }) } });
  await p.store.refresh();
  assert.equal(byId(p.store.state.expenses, "other00001").title, "Their lunch");
  release();
  await first;
  assert.equal(byId(p.store.state.expenses, "other00001").title, "Their lunch");
  assert.equal(p.store.state.rev, 1);
});

test("refresh keeps lines that are still pending", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.failing.add("addExpense");
  p.store.addExpense(draft());
  const id = idOf(p.store);
  await p.store.idle();
  await p.store.refresh();
  assert.equal(byId(p.store.state.expenses, id).pending, true);
  assert.equal(p.store.state.expenses.length, 10);
});

test("Person settings", async () => {
  const one = phone();
  const two = phone({ fake: one.fake, storage: memStorage({ "mat.key": KEY, "mat.me": "Ajen" }) });
  await one.store.boot();
  await two.store.boot();
  const saving = one.store.setPerson("Mo", { simplify: false });
  assert.equal(one.store.state.people.find((x) => x.name === "Mo").simplify, false);
  await saving;
  assert.equal((await backend(one.fake)).people.find((x) => x.name === "Mo").simplify, false);
  assert.equal(one.store.state.people.find((x) => x.name === "Mo").simplify, false);
  assert.equal(two.store.state.people.find((x) => x.name === "Mo").simplify, true);
  await two.store.refresh();
  assert.equal(two.store.state.people.find((x) => x.name === "Mo").simplify, false);
});

test("a person setting with no signal is rolled back", async () => {
  const p = phone();
  await p.store.boot();
  p.net.offline = true;
  const saving = p.store.setPerson("Mo", { simplify: false });
  assert.equal(p.store.state.people.find((x) => x.name === "Mo").simplify, false);
  await saving;
  assert.equal(p.store.state.people.find((x) => x.name === "Mo").simplify, true);
  assert.equal(p.store.state.online, false);
});

test("History", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  const states = [];
  p.store.subscribe((s) => states.push(s.history.loading));
  await p.store.loadHistory();
  assert.equal(states[0], true);
  const h = p.store.state.history;
  assert.equal(h.loading, false);
  assert.equal(h.entries.length, 10);
  assert.equal(h.more, false);
  const ids = h.entries.map((e) => e.id);
  assert.deepEqual(ids, ids.slice().sort((a, b) => b - a));
  const five = await p.store.historyFor("seedexp005");
  assert.equal(five.length, 2);
  assert.deepEqual(five.map((e) => e.action), ["delete", "add"]);
  assert.ok(five.every((e) => e.ref === "seedexp005"));
});

test("loadHistory({ older: true }) appends the next page", async () => {
  const expenses = [];
  for (let i = 0; i < 205; i++) expenses.push({ id: "bulk" + String(i).padStart(6, "0"), day: "pre", title: "Line " + i, amount: 100, currency: "JPY", paidBy: "Mo", split: ALL.slice(), addedAt: new Date(Date.UTC(2026, 10, 1) + i * 1000).toISOString() });
  const p = phone({ seed: { expenses } });
  await p.store.boot();
  await p.store.loadHistory();
  assert.equal(p.store.state.history.entries.length, 200);
  assert.equal(p.store.state.history.more, true);
  await p.store.loadHistory({ older: true });
  assert.equal(p.store.state.history.entries.length, 205);
  assert.equal(p.store.state.history.more, false);
  assert.equal(new Set(p.store.state.history.entries.map((e) => e.id)).size, 205);
});

test("historyFor rejects with network when there is no signal", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.offline = true;
  const err = await p.store.historyFor("seedexp005").then(() => null, (e) => e);
  assert.equal(err.code, "network");
  assert.equal(p.store.state.online, false);
});

test("Seen", async () => {
  const p = phone();
  await p.store.boot();
  assert.equal(p.store.state.seenAt, null);
  p.store.markSeen();
  assert.equal(p.store.state.seenAt, NOW);
  assert.equal(p.storage.getItem("mat.seen"), String(NOW));
  const again = phone({ fake: p.fake, storage: p.storage });
  await again.store.boot();
  assert.equal(again.store.state.seenAt, NOW);
});

test("notify sets a notice and tells subscribers; clearNotice clears it", async () => {
  const p = phone();
  await p.store.boot();
  const notices = [];
  const off = p.store.subscribe((s) => notices.push(s.notice));
  p.store.notify("Link copied.");
  assert.equal(p.store.state.notice, "Link copied.");
  p.store.clearNotice();
  assert.equal(p.store.state.notice, null);
  assert.deepEqual(notices, ["Link copied.", null]);
  off();
  p.store.notify("again");
  assert.equal(notices.length, 2);
});

// ---------- discard ----------

test("discard of a queued line that never left the phone sends nothing, ever", async () => {
  const p = phone();
  await p.store.boot();
  p.net.offline = true;
  await p.store.refresh(); // the failed load is what tells the store there is no signal
  p.store.addExpense(draft());
  const id = idOf(p.store);
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, id).pending, true);
  assert.equal(p.net.sent.filter((b) => b.action === "addExpense").length, 0, "it never left the phone");
  const before = p.net.sent.filter((b) => b.action === "addExpense").length;
  assert.equal(p.store.discard(id), true);
  assert.equal(byId(p.store.state.expenses, id), undefined);
  assert.deepEqual(queueOf(p.storage), []);
  p.net.offline = false;
  await p.store.refresh();
  await p.store.idle();
  assert.equal(sent(p.fake, "addExpense"), 0, "no add reached the backend");
  assert.equal(p.net.sent.filter((b) => b.action === "addExpense").length, before, "none sent after it either");
  assert.equal(byId(p.store.state.expenses, id), undefined);
});

test("discard of a line the backend refused removes it and leaves nothing on the backend", async () => {
  const p = phone();
  await p.store.boot();
  p.net.override = (body) => (body.action === "addExpense" ? { ok: false, error: "bad_input", message: "Pick a day." } : null);
  p.store.addExpense(draft());
  const id = idOf(p.store);
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, id).failed, true);
  assert.equal(p.store.discard(id), true);
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, id), undefined);
  assert.deepEqual(queueOf(p.storage), []);
  p.net.override = null;
  await p.store.refresh();
  assert.equal(byId(p.store.state.expenses, id), undefined);
  assert.equal(byId((await backend(p.fake)).expenses, id), undefined);
});

test("discard of a line whose reply was lost is resolved as add then undo on the next contact", async () => {
  const p = phone();
  await p.store.boot();
  p.net.lose.add("addExpense");
  p.store.addExpense(draft());
  const id = idOf(p.store);
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, id).deleted, false, "it did reach the backend");
  p.net.lose.clear();
  assert.equal(p.store.discard(id), true);
  const goneFromReceipt = () => { const l = byId(p.store.state.expenses, id); return !l || l.deleted === true; };
  assert.equal(goneFromReceipt(), true, "gone from the receipt at once");
  await p.store.idle();
  await p.store.refresh();
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, id).deleted, true);
  assert.equal(goneFromReceipt(), true, "gone from the receipt");
});

test("discard does nothing for a confirmed line", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  const line = p.store.state.expenses[0];
  assert.equal(p.store.discard(line.id), false);
  assert.equal(p.store.discard("nosuchid1"), false);
  p.store.addExpense(draft());
  const id = idOf(p.store);
  assert.equal(p.store.unsaved(id), true, "still on its way");
  await p.store.idle();
  assert.equal(p.store.unsaved(id), false);
  p.store.updateExpense(id, { note: "x" });
  assert.equal(p.store.unsaved(id), false, "an edit of a confirmed line is not an unsaved line");
  assert.equal(p.store.discard(id), false, "a line the backend has confirmed");
  assert.equal(byId(p.store.state.expenses, id).deleted, false);
});

test("discard says Undone. on the undo bar instead of leaving a dead Undo", async () => {
  const p = phone();
  await p.store.boot();
  p.net.override = (body) => (body.action === "addExpense" ? { ok: false, error: "bad_input", message: "Pick a day." } : null);
  p.store.addExpense(draft());
  const id = idOf(p.store);
  await p.store.idle();
  assert.equal(p.store.state.lastChange.action, "add");
  assert.equal(p.store.discard(id), true);
  const lc = p.store.state.lastChange;
  assert.equal(lc.action, "undo");
  assert.equal(lc.canUndo, false);
  assert.equal(lc.item.id, id);
});

test("discard while the add is in flight: the backend ends with it deleted, add and undo in its history, and none on the phone", async () => {
  const p = phone();
  await p.store.boot();
  const release = p.net.hold("addExpense"); // the backend takes the add; the reply waits
  p.store.addExpense(draft());
  const id = idOf(p.store);
  await until(() => p.net.sent.some((b) => b.action === "addExpense"));
  assert.equal(p.store.discard(id), true);
  release();
  await p.store.idle();
  const data = await backend(p.fake);
  assert.equal(byId(data.expenses, id).deleted, true);
  const h = await backend(p.fake, "history", { ref: id });
  const actions = h.entries.map((e) => e.action);
  assert.ok(actions.includes("add") && actions.includes("undo"), "history: " + actions);
  const l = byId(p.store.state.expenses, id);
  assert.equal(!l || l.deleted === true, true);
  assert.deepEqual(queueOf(p.storage), []);
});

// ---------- boundaries ----------

test("js modules reach the outside world only through their arguments", () => {
  const src = fs.readFileSync(path.join(HERE, "..", "js", "store.js"), "utf8");
  for (const word of ["window", "document", "localStorage", "navigator"]) {
    assert.equal(new RegExp("\\b" + word + "\\b").test(src), false, "store.js mentions " + word);
  }
  for (const f of ["store.js", "api.js", "time.js"]) {
    const s = fs.readFileSync(path.join(HERE, "..", "js", f), "utf8");
    assert.equal(/from\s+["'][^"']*(backend|tests)\//.test(s), false, f + " imports backend/ or tests/");
  }
});

test("outbox counts lines not yet on the backend: sending or waiting, never refused ones", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  assert.deepEqual(p.store.outbox(), { unsent: 0, waiting: 0 });
  const draft = (title) => ({ day: "2026-12-11", title, amount: 500, currency: "JPY", paidBy: "Mo", split: ALL.slice() });

  const release = p.net.hold("addExpense");
  p.store.addExpense(draft("Sending"));
  assert.deepEqual(p.store.outbox(), { unsent: 1, waiting: 0 }, "in flight: to send, not waiting");
  release();
  await p.store.idle();
  assert.deepEqual(p.store.outbox(), { unsent: 0, waiting: 0 });

  p.net.offline = true;
  await p.store.checkRev();
  p.store.addExpense(draft("One"));
  p.store.addExpense(draft("Two"));
  await p.store.idle();
  assert.deepEqual(p.store.outbox(), { unsent: 2, waiting: 2 });

  p.net.offline = false;
  p.net.override = (body) => (body.action === "addExpense" ? { ok: false, error: "bad_input", message: "No" } : null);
  await p.store.flush();
  await p.store.idle();
  assert.deepEqual(p.store.outbox(), { unsent: 0, waiting: 0 }, "refused lines are not counted");
});

// ---------- fix wave: a write whose reply is lost (F1, F2, F11) ----------

const UNCONFIRMED = "Couldn’t confirm that. Checking…";
const NOT_SAVED = "No signal. That wasn’t saved.";
const LODGE = { expenses: [{ id: "exp00001", day: "pre", title: "Lodge", amount: 300, currency: "CAD", paidBy: "Mo", split: ["Mo", "Ajen"] }] };

test("a stamp whose reply is lost stays on the slip and is resent with the same id: one payment, and a later stamp makes a second", async () => {
  const p = phone({ seed: LODGE, me: "Ajen" });
  await p.store.boot();
  p.net.lose.add("addPayment");
  p.store.addPayment({ from: "Ajen", to: "Mo", cad: 150 });
  const id = idOf(p.store);
  await p.store.idle();
  assert.equal(p.fake.tables.Settlements.length, 1, "it reached the backend");
  assert.notEqual(p.store.state.notice, NOT_SAVED, "never told it was not saved");
  const shown = p.store.state.payments;
  assert.deepEqual(shown.map((x) => [x.id, x.pending]), [[id, true]], "still on the slip, drawn as pending");

  p.net.lose.clear();
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(p.fake.tables.Settlements.length, 1, "the resend is answered with the first one");
  assert.deepEqual(p.net.sent.filter((b) => b.action === "addPayment").map((b) => b.args.payment.id), [id, id]);
  assert.deepEqual(p.store.state.payments.map((x) => [x.id, "pending" in x]), [[id, false]]);

  p.store.addPayment({ from: "Ajen", to: "Mo", cad: 10 });
  await p.store.idle();
  assert.equal(p.fake.tables.Settlements.length, 2, "a second, not a third");
  assert.equal(p.store.state.payments.length, 2);
});

test("a second stamp while one is of unknown fate: each tap is one payment with its own id", async () => {
  const p = phone({ seed: LODGE, me: "Ajen" });
  await p.store.boot();
  p.net.lose.add("addPayment");
  p.store.addPayment({ from: "Ajen", to: "Mo", cad: 100 });
  await p.store.idle();
  p.net.lose.clear();
  p.net.offline = true;
  p.store.addPayment({ from: "Ajen", to: "Mo", cad: 50 });
  await p.store.idle();
  assert.equal(p.store.state.payments.length, 2);
  p.net.offline = false;
  await p.store.checkRev();
  await p.store.idle();
  assert.deepEqual(p.fake.tables.Settlements.map((r) => Number(r.cad)).sort((a, b) => a - b), [50, 100]);
  assert.equal(new Set(p.fake.tables.Settlements.map((r) => r.id)).size, 2);
  assert.equal(p.store.state.payments.filter((x) => !x.pending).length, 2);
});

test("a delete whose reply is lost: not called unsaved, shown deleted after contact, and Undo really restores it", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.lose.add("deleteExpense");
  const t = p.store.deleteExpense("seedexp006");
  await p.store.idle();
  assert.equal(p.store.state.notice, UNCONFIRMED);
  p.net.lose.clear();
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, true, "the backend has it deleted, so the phone shows that");
  await p.store.undo(t);
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, "seedexp006").deleted, false, "really restored");
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, false);
  assert.equal(p.store.state.lastChange.action, "undo");
  assert.deepEqual((await backend(p.fake, "history", { ref: "seedexp006" })).entries.map((e) => e.action).slice(0, 2), ["undo", "delete"]);
});

test("the next contact of any kind brings the backend's view after an unconfirmed write", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.lose.add("deleteExpense");
  p.store.deleteExpense("seedexp006");
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, false, "rolled back meanwhile");
  p.net.lose.clear();
  const loads = sent(p.fake, "load");
  p.store.updateExpense("seedexp004", { note: "x" }); // a write is contact too
  await p.store.idle();
  assert.equal(sent(p.fake, "load"), loads + 1);
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, true);
});

test("a delete repeated after a lost reply, then Undo: never Undone. while nothing happens", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.lose.add("deleteExpense");
  p.store.deleteExpense("seedexp006");
  await p.store.idle();
  p.net.lose.clear();
  const t = p.store.deleteExpense("seedexp006"); // the backend already has it: no log id
  await p.store.idle();
  await p.store.undo(t);
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, "seedexp006").deleted, false);
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, false);
  assert.equal(p.store.state.lastChange.action, "undo");
});

test("Undo of an unconfirmed change that another phone has changed since says it could not", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.lose.add("updateExpense");
  const t = p.store.updateExpense("seedexp004", { title: "Ramen bar" });
  await p.store.idle();
  assert.equal(p.store.state.notice, UNCONFIRMED);
  assert.equal(byId(p.store.state.expenses, "seedexp004").title, "Ramen", "rolled back meanwhile");
  p.net.lose.clear();
  await backend(p.fake, "updateExpense", { id: "seedexp004", patch: { amount: 5000 } });
  p.store.clearNotice();
  await p.store.undo(t);
  await p.store.idle();
  assert.equal(p.store.state.notice, UNDO_FAILED);
  const server = byId((await backend(p.fake)).expenses, "seedexp004");
  assert.deepEqual([server.title, server.amount], ["Ramen bar", 5000], "nothing overwritten");
  assert.deepEqual([byId(p.store.state.expenses, "seedexp004").title, byId(p.store.state.expenses, "seedexp004").amount], ["Ramen bar", 5000]);
  assert.equal(sent(p.fake, "undo"), 0);
});

test("an edit whose reply is lost: shown after contact, and Undo takes it back", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.lose.add("updateExpense");
  const t = p.store.updateExpense("seedexp004", { amount: 4500 });
  await p.store.idle();
  assert.equal(p.store.state.notice, UNCONFIRMED);
  assert.equal(byId(p.store.state.expenses, "seedexp004").amount, 4200);
  p.net.lose.clear();
  p.store.clearNotice();
  // Undo before any contact: it waits for the backend's answer, then undoes.
  await p.store.undo(t);
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, "seedexp004").amount, 4200);
  assert.equal(byId(p.store.state.expenses, "seedexp004").amount, 4200);
  assert.equal(p.store.state.lastChange.action, "undo");
  assert.equal(p.store.state.notice, null);
});

test("Undo of an unconfirmed change with still no signal waits, and finishes on the next contact", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.lose.add("deleteExpense");
  const t = p.store.deleteExpense("seedexp006");
  await p.store.idle();
  p.net.lose.clear();
  p.net.offline = true;
  const before = p.store.state.lastChange.token;
  await p.store.undo(t);
  await p.store.idle();
  assert.equal(p.store.state.lastChange.token, before, "no Undone. while nothing has happened");
  p.net.offline = false;
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, "seedexp006").deleted, false);
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, false);
  assert.equal(p.store.state.lastChange.action, "undo");
});

test("an unconfirmed change that never landed: Undo leaves it as it was and sends no undo", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.failing.add("deleteExpense"); // fails before reaching the backend, but the phone cannot know that
  const t = p.store.deleteExpense("seedexp006");
  await p.store.idle();
  assert.equal(p.store.state.notice, UNCONFIRMED);
  p.net.failing.clear();
  await p.store.undo(t);
  await p.store.idle();
  assert.equal(sent(p.fake, "undo"), 0);
  assert.equal(byId((await backend(p.fake)).expenses, "seedexp006").deleted, false);
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, false);
});

test("a person setting whose reply is lost says it is checking and shows the backend after contact", async () => {
  const p = phone();
  await p.store.boot();
  p.net.lose.add("setPerson");
  await p.store.setPerson("Mo", { simplify: false });
  assert.equal(p.store.state.notice, UNCONFIRMED);
  assert.equal(p.store.state.people.find((x) => x.name === "Mo").simplify, true, "rolled back meanwhile");
  p.net.lose.clear();
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(p.store.state.people.find((x) => x.name === "Mo").simplify, false);
});

test("when the phone itself knows it has no network, a change is not sent and is said not saved", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.knownOffline = true;
  const before = p.net.sent.length;
  p.store.deleteExpense("seedexp006");
  await p.store.idle();
  assert.equal(p.store.state.notice, NOT_SAVED);
  assert.equal(p.net.sent.length, before, "nothing left the phone");
  assert.equal(byId(p.store.state.expenses, "seedexp006").deleted, false);
  await p.store.setPerson("Mo", { simplify: false });
  assert.equal(p.store.state.notice, NOT_SAVED);
});

test("a line rung up while the phone knows it is offline is kept and provably never left: undo forgets it", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.knownOffline = true;
  const t = p.store.addExpense(draft());
  await p.store.idle();
  assert.equal(p.store.outbox().waiting, 1);
  p.store.undo(t);
  p.net.knownOffline = false;
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(sent(p.fake, "addExpense"), 0);
  assert.deepEqual(queueOf(p.storage), []);
});

test("rev is not stepped for a resent add: another phone's line written in between is shown (E3)", async () => {
  const fake = createFakeBackend({});
  let adds = 0;
  const wrapped = async (body) => {
    if (body.action === "addExpense" && ++adds === 2) {
      await fake({ key: KEY, actor: "Ajen", via: "app", action: "addExpense", args: { expense: { id: "bbbbbbbb1", day: "pre", title: "B line", amount: 5, currency: "CAD", paidBy: "Ajen", split: ALL } } });
    }
    return fake(body);
  };
  wrapped.tables = fake.tables;
  wrapped.requests = fake.requests;
  wrapped.props = fake.props;
  const a = phone({ fake: wrapped });
  await a.store.boot();
  a.net.lose.add("addExpense");
  a.store.addExpense({ day: "pre", title: "A1", amount: 10, currency: "CAD", paidBy: "Mo", split: ALL, note: "", kind: "" });
  await a.store.idle();
  a.net.lose.clear();
  await a.store.checkRev();
  await a.store.idle();
  await a.store.checkRev();
  await a.store.idle();
  assert.deepEqual(fake.tables.Expenses.map((r) => r.title).sort(), ["A1", "B line"]);
  assert.deepEqual(a.store.state.expenses.map((e) => e.title).sort(), ["A1", "B line"]);
  assert.equal(a.store.state.rev, Number(fake.props.REV));
});

test("a queued line is credited to whoever rang it up, even after the phone switches person", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.offline = true;
  p.store.addExpense(draft({ title: "Mo's taxi" }));
  const id = idOf(p.store);
  await p.store.idle();
  p.store.setMe("Ajen");
  p.net.offline = false;
  await p.store.checkRev();
  await p.store.idle();
  const row = p.fake.tables.Expenses.find((r) => r.id === id);
  assert.equal(row.added_by, "Mo");
  const log = p.fake.tables.Log.find((r) => r.ref === id && r.action === "add");
  assert.equal(log.who, "Mo");
});

test("a queued line restored from mat.queue after a reload is still credited to whoever rang it up", async () => {
  const first = phone({ seed: SEED });
  await first.store.boot();
  first.net.offline = true;
  first.store.addExpense(draft({ title: "Mo's taxi" }));
  const id = idOf(first.store);
  await first.store.idle();
  first.storage.setItem("mat.me", "Ajen");
  const p = phone({ fake: first.fake, storage: first.storage });
  await p.store.boot();
  await p.store.idle();
  assert.equal(p.fake.tables.Expenses.find((r) => r.id === id).added_by, "Mo");
});

test("api sends a per-request actor when given one, and the phone's own otherwise", async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, rev: 1, data: {} }) };
  };
  const api = createApi({ url: URL, getKey: () => "k", getActor: () => "Ajen", fetchImpl });
  await api("addExpense", {}, { actor: "Mo" });
  await api("load", {});
  assert.deepEqual(bodies.map((b) => b.actor), ["Mo", "Ajen"]);
});

test("api refuses to send when the phone says it is offline, marked as never sent", async () => {
  let calls = 0;
  const api = createApi({ url: URL, getKey: () => "k", getActor: () => "Mo", fetchImpl: async () => { calls++; }, isOnline: () => false });
  const err = await api("load").then(() => null, (e) => e);
  assert.equal(err.code, "network");
  assert.equal(err.notSent, true);
  assert.equal(calls, 0);
});

// ---------- fix wave: a bad row in the Sheet (F3) ----------

const draw = (s) => {
  // what the slip does with the state: money.js is strict and throws on an unknown name
  if (!s.trip) return;
  const names = s.people.map((x) => x.name);
  direct(names, s.expenses.filter((e) => !e.deleted), s.payments);
  const bal = balances(names, s.expenses, s.payments);
  for (const n of names) if (!Number.isFinite(bal[n])) throw new Error("NaN balance for " + n);
};

test("emit: a subscriber that throws does not stop the others or the store", async () => {
  const p = phone({ seed: SEED });
  let others = 0;
  p.store.subscribe(() => { throw new Error("a broken view"); });
  p.store.subscribe(() => { others++; });
  await p.store.boot();
  assert.ok(others >= 2);
  assert.equal(p.store.state.status, "ready");
  assert.equal(sent(p.fake, "load"), 1);
});

test("a mistyped name in a split is set aside, and a phone reopened after the Sheet is fixed loads (H1, H2)", async () => {
  const fake = createFakeBackend(LODGE);
  fake.tables.Expenses[0].split = "Mo,Ajen,Trent";
  const a = phone({ fake });
  a.store.subscribe(draw);
  await a.store.boot();
  assert.deepEqual(a.store.state.expenses, []);
  assert.deepEqual(a.store.state.setAside, [{ kind: "expense", id: "exp00001", title: "Lodge", reason: "name" }]);

  fake.tables.Expenses[0].split = "Mo,Ajen,Trenton";
  const b = phone({ fake, storage: a.storage });
  b.store.subscribe(draw);
  const loads = sent(fake, "load");
  await b.store.boot();
  assert.equal(sent(fake, "load"), loads + 1, "the reopened phone loads");
  assert.deepEqual(b.store.state.expenses.map((e) => e.id), ["exp00001"]);
  assert.deepEqual(b.store.state.setAside, []);
});

test("even if painting the cache throws, boot still loads", async () => {
  const first = phone({ seed: SEED });
  await first.store.boot();
  const p = phone({ fake: first.fake, storage: first.storage });
  let calls = 0;
  p.store.subscribe(() => { if (++calls === 1) throw new Error("first paint"); });
  const loads = sent(p.fake, "load");
  await p.store.boot();
  assert.equal(sent(p.fake, "load"), loads + 1);
});

test("a mistyped payer is set aside, not counted as owing nobody (H3)", async () => {
  const fake = createFakeBackend(LODGE);
  fake.tables.Expenses[0].paid_by = "mo";
  const p = phone({ fake });
  p.store.subscribe(draw);
  await p.store.boot();
  assert.deepEqual(p.store.state.expenses, []);
  assert.deepEqual(p.store.state.setAside.map((x) => [x.id, x.reason]), [["exp00001", "name"]]);
});

test("a yen line with a blank rate is set aside (H4); a bad payment is set aside too", async () => {
  const fake = createFakeBackend({
    expenses: [{ id: "exp00002", day: "pre", title: "Taxi", amount: 3000, currency: "JPY", paidBy: "Mo", split: ALL }, { id: "exp00003", day: "pre", title: "Fine", amount: 30, currency: "CAD", paidBy: "Mo", split: ALL }],
    payments: [{ id: "pay000001", from: "Ajen", to: "Mo", cad: 5, seed: 1, rot: 0 }, { id: "pay000002", from: "Ajen", to: "Mo", cad: 5, seed: 1, rot: 0 }],
  });
  fake.tables.Expenses[0].rate = "";
  fake.tables.Settlements[1].to = "Moe";
  const p = phone({ fake });
  p.store.subscribe(draw);
  await p.store.boot();
  assert.deepEqual(p.store.state.expenses.map((e) => e.id), ["exp00003"]);
  assert.deepEqual(p.store.state.payments.map((x) => x.id), ["pay000001"]);
  assert.deepEqual(p.store.state.setAside, [
    { kind: "expense", id: "exp00002", title: "Taxi", reason: "amount" },
    { kind: "payment", id: "pay000002", title: "Ajen → Moe", reason: "name" },
  ]);
  for (const v of Object.values(balances(ALL, p.store.state.expenses, p.store.state.payments))) assert.ok(Number.isFinite(v));
});

test("an edit undone while its request is out, whose reply is then lost, is settled against the backend", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.lose.add("updateExpense");
  const t = p.store.updateExpense("seedexp004", { amount: 4500 });
  p.store.undo(t);
  await p.store.idle();
  p.net.lose.clear();
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).expenses, "seedexp004").amount, 4200, "the backend ends undone");
  const line = byId(p.store.state.expenses, "seedexp004");
  assert.equal(line.amount, 4200);
  assert.equal("pending" in line, false, "nothing left pending on the phone");
});

// ---------- fix-wave follow-up (N1, N2, N6) ----------

const livePayments = (fake) => fake.tables.Settlements.filter((r) => !r.removed_at);

for (const mode of ["failing", "lose"]) {
  const how = mode === "failing" ? "never arrived" : "arrived but its reply was lost";
  test("removing a stamp whose request " + how + " leaves no live payment, now or after contact (N1)", async () => {
    const p = phone({ seed: LODGE, me: "Ajen" });
    await p.store.boot();
    p.net[mode].add("addPayment");
    p.store.addPayment({ from: "Ajen", to: "Mo", cad: 150 });
    const id = idOf(p.store);
    await p.store.idle();
    p.net[mode].clear();
    p.store.removePayment(id);
    await p.store.idle();
    assert.equal(p.store.state.notice, null, "no refusal shown");
    assert.equal(p.store.state.payments.filter((x) => !x.removed).length, 0, "gone from the slip");
    await p.store.checkRev();
    await p.store.idle();
    await p.store.checkRev();
    await p.store.idle();
    assert.deepEqual(livePayments(p.fake), [], "the backend has no live payment");
    assert.equal(p.store.state.payments.filter((x) => !x.removed).length, 0);
    const adds = p.fake.requests.filter((r) => r.action === "addPayment").length;
    await p.store.checkRev();
    await p.store.idle();
    assert.equal(p.fake.requests.filter((r) => r.action === "addPayment").length, adds, "a later contact creates nothing");
  });

  test("the bar's Undo on a stamp whose request " + how + " leaves no live payment (N1)", async () => {
    const p = phone({ seed: LODGE, me: "Ajen" });
    await p.store.boot();
    p.net[mode].add("addPayment");
    const t = p.store.addPayment({ from: "Ajen", to: "Mo", cad: 150 });
    await p.store.idle();
    p.net[mode].clear();
    await p.store.undo(t);
    await p.store.checkRev();
    await p.store.idle();
    assert.deepEqual(livePayments(p.fake), []);
    assert.equal(p.store.state.payments.filter((x) => !x.removed).length, 0);
  });

  test("deleteExpense on a line whose add " + how + " leaves no live line (N1)", async () => {
    const p = phone({ seed: SEED });
    await p.store.boot();
    p.net[mode].add("addExpense");
    p.store.addExpense(draft({ title: "Gone" }));
    const id = idOf(p.store);
    await p.store.idle();
    p.net[mode].clear();
    p.store.deleteExpense(id);
    await p.store.idle();
    await p.store.checkRev();
    await p.store.idle();
    const server = byId((await backend(p.fake)).expenses, id);
    assert.ok(!server || server.deleted, "not live on the backend");
    const shown = byId(p.store.state.expenses, id);
    assert.ok(!shown || shown.deleted, "not live on the phone");
    assert.equal(sent(p.fake, "deleteExpense"), 0, "never sent as a delete of a line the backend may not have");
  });
}

test("a stamp of unknown fate counts in the outbox, survives a reload in mat.queue, and is sent once (N2)", async () => {
  const p = phone({ seed: LODGE, me: "Ajen" });
  await p.store.boot();
  p.net.lose.add("addPayment");
  p.store.addPayment({ from: "Ajen", to: "Mo", cad: 150 });
  const id = idOf(p.store);
  await p.store.idle();
  assert.deepEqual(p.store.outbox(), { unsent: 1, waiting: 1 });
  assert.deepEqual(queueOf(p.storage).map((q) => q.payment && q.payment.id), [id]);
  p.net.lose.clear();

  const q = phone({ fake: p.fake, storage: p.storage, me: "Ajen" });
  q.store.setMe("Mo"); // credited to whoever stamped it, not the phone's person now
  await q.store.boot();
  await q.store.idle();
  assert.equal(p.fake.tables.Settlements.length, 1, "one payment, not two");
  assert.equal(p.fake.tables.Settlements[0].stamped_by, "Ajen");
  assert.deepEqual(q.store.state.payments.map((x) => [x.id, "pending" in x]), [[id, false]]);
  assert.deepEqual(queueOf(q.storage), []);
  assert.deepEqual(q.store.outbox(), { unsent: 0, waiting: 0 });
});

test("a stamp that never left, restored after a reload, is sent once (N2)", async () => {
  const p = phone({ seed: LODGE, me: "Ajen" });
  await p.store.boot();
  p.net.knownOffline = true;
  p.store.addPayment({ from: "Ajen", to: "Mo", cad: 150 });
  await p.store.idle();
  assert.equal(queueOf(p.storage)[0].sent, false);
  const q = phone({ fake: p.fake, storage: p.storage, me: "Ajen" });
  await q.store.boot();
  await q.store.idle();
  assert.equal(p.fake.tables.Settlements.length, 1);
});

test("an undo from History whose reply is lost says it is checking and reloads on the next contact (N6)", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.store.updateExpense("seedexp004", { amount: 4500 });
  await p.store.idle();
  await p.store.loadHistory();
  const entry = p.store.state.history.entries.find((e) => e.ref === "seedexp004" && e.action === "edit");
  p.net.lose.add("undo");
  await p.store.undoEntry(entry.id);
  assert.equal(p.store.state.notice, UNCONFIRMED);
  p.net.lose.clear();
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, "seedexp004").amount, 4200, "the backend's undone line is shown");
});

// ---------- stops (Plan 2, Task 7) ----------

const SKY = { id: "stopAAAA0001", date: "2026-12-12", title: "Shibuya Sky", time: "14:00" };
const stopOf = (store, id) => byId(store.state.stops, id);
const stopRows = (fake) => fake.tables.Stops.length;

test("a stop: added, shown at once, confirmed, undone", async () => {
  const { store, fake } = phone({ seed: {} });
  await store.boot();
  const token = store.addStop({ date: "2026-12-12", title: "Shibuya Sky", time: "14:00" });
  assert.equal(store.state.stops.at(-1).pending, true);
  await store.idle();
  assert.equal(store.state.stops.at(-1).pending, undefined);
  assert.equal(fake.tables.Stops.length, 1);
  assert.deepEqual([store.state.lastChange.kind, store.state.lastChange.action], ["stop", "add"]);
  await store.undo(token);
  await store.idle();
  assert.equal(store.state.stops.at(-1).deleted, true);
  assert.equal(fake.tables.Stops.length, 1);
});

test("a stop edit the phone knows never left is rolled back and said not saved; nothing is queued", async () => {
  const { store, net, storage } = phone({ seed: { stops: [SKY] } });
  await store.boot();
  net.knownOffline = true;
  store.updateStop(SKY.id, { time: "15:30" });
  await store.idle();
  assert.equal(store.state.stops[0].time, "14:00");
  assert.equal(store.state.notice, "No signal. That wasn’t saved.");
  assert.deepEqual(JSON.parse(storage.getItem("mat.queue") || "[]"), []);
});

test("a stop add whose reply is lost is not sent twice, and the next contact shows the truth", async () => {
  const { store, fake, net } = phone({ seed: {} });
  await store.boot();
  net.lose.add("addStop"); // the backend saves it; the reply never arrives
  store.addStop({ date: "2026-12-12", title: "Shibuya Sky" });
  await store.idle();
  assert.equal(store.state.notice, "Couldn’t confirm that. Checking…");
  net.lose.clear();
  await store.checkRev();
  await store.idle();
  assert.equal(store.state.stops.filter((s) => s.title === "Shibuya Sky" && !s.deleted).length, 1);
  assert.equal(fake.tables.Stops.length, 1);
  assert.equal(net.sent.filter((b) => b.action === "addStop").length, 1);
});

test("undo from History works on a stop and a day header", async () => {
  const { store, fake } = phone({ seed: { stops: [SKY] } });
  await store.boot();
  await backend(fake, "updateStop", { id: SKY.id, patch: { time: "15:30" } });
  await backend(fake, "setDay", { date: "2026-12-12", patch: { city: "Tokyo" } });
  await store.refresh();
  await store.loadHistory();
  const [day, stop] = store.state.history.entries;
  assert.equal(await store.undoEntry(stop.id), true);
  assert.equal(store.state.stops[0].time, "14:00");
  assert.equal(await store.undoEntry(day.id), true);
  assert.equal(store.state.days.find((d) => d.date === "2026-12-12").city, "");
});

test("a stop add whose reply is lost, then Undo: the backend ends with it removed, sent once, nothing queued", async () => {
  const p = phone({ seed: {} });
  await p.store.boot();
  p.net.lose.add("addStop");
  const t = p.store.addStop({ date: "2026-12-12", title: "Shibuya Sky" });
  const id = idOf(p.store);
  await p.store.idle();
  assert.equal(p.store.state.notice, UNCONFIRMED);
  assert.equal(stopOf(p.store, id).deleted, false, "the backend's truth is shown at once (it did land)");
  assert.deepEqual(queueOf(p.storage), [], "a stop add is never kept in mat.queue");
  p.net.lose.clear();
  p.store.clearNotice();
  await p.store.undo(t);
  await p.store.idle();
  assert.equal(stopRows(p.fake), 1);
  assert.equal(byId((await backend(p.fake)).stops, id).deleted, true);
  assert.equal(stopOf(p.store, id).deleted, true);
  assert.equal(sent(p.fake, "addStop"), 1, "never sent twice");
  assert.equal(sent(p.fake, "undo"), 1);
  assert.deepEqual([p.store.state.lastChange.kind, p.store.state.lastChange.action], ["stop", "undo"]);
  assert.equal(p.store.state.notice, null);
  assert.deepEqual(queueOf(p.storage), []);
});

test("a stop add whose reply is lost, then Undo with still no signal: it waits and finishes on the next contact", async () => {
  const p = phone({ seed: {} });
  await p.store.boot();
  p.net.lose.add("addStop");
  const t = p.store.addStop({ date: "2026-12-12", title: "Shibuya Sky" });
  const id = idOf(p.store);
  await p.store.idle();
  p.net.lose.clear();
  p.net.offline = true;
  const before = p.store.state.lastChange.token;
  await p.store.undo(t);
  await p.store.idle();
  assert.equal(p.store.state.lastChange.token, before, "no Undone. while nothing has happened");
  assert.deepEqual(queueOf(p.storage), []);
  p.net.offline = false;
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).stops, id).deleted, true);
  assert.equal(stopOf(p.store, id).deleted, true);
  assert.equal(sent(p.fake, "addStop"), 1);
  assert.equal(p.store.state.lastChange.action, "undo");
});

test("a stop add that never reached the backend, then Undo: nothing is sent and it is gone", async () => {
  const p = phone({ seed: {} });
  await p.store.boot();
  p.net.failing.add("addStop"); // dropped before the backend; the phone cannot know that
  const t = p.store.addStop({ date: "2026-12-12", title: "Shibuya Sky" });
  const id = idOf(p.store);
  await p.store.idle();
  assert.equal(p.store.state.notice, UNCONFIRMED);
  p.net.failing.clear();
  p.store.clearNotice();
  await p.store.undo(t);
  await p.store.idle();
  assert.equal(stopRows(p.fake), 0);
  assert.equal(sent(p.fake, "undo"), 0);
  assert.equal(stopOf(p.store, id), undefined);
  assert.equal(p.store.state.lastChange.action, "undo");
  assert.equal(p.store.state.notice, null);
});

test("Undo of a stop add while it is still on its way: one stop on the backend, removed", async () => {
  const p = phone({ seed: {} });
  await p.store.boot();
  const release = p.net.hold("addStop");
  const t = p.store.addStop({ date: "2026-12-12", title: "Shibuya Sky" });
  const id = idOf(p.store);
  const undone = p.store.undo(t);
  assert.equal(stopOf(p.store, id).deleted, true, "shown gone at once");
  release();
  await undone;
  await p.store.idle();
  assert.equal(stopRows(p.fake), 1);
  assert.equal(byId((await backend(p.fake)).stops, id).deleted, true);
  assert.equal(stopOf(p.store, id).deleted, true);
  assert.equal(sent(p.fake, "addStop"), 1);
});

test("a stop edit whose reply is lost: shown after contact, and Undo takes it back", async () => {
  const p = phone({ seed: { stops: [SKY] } });
  await p.store.boot();
  p.net.lose.add("updateStop");
  const t = p.store.updateStop(SKY.id, { time: "15:30", travelMin: 20 });
  await p.store.idle();
  assert.equal(p.store.state.notice, UNCONFIRMED);
  assert.equal(stopOf(p.store, SKY.id).time, "15:30", "the backend's truth is shown at once (it did land)");
  assert.deepEqual(queueOf(p.storage), []);
  p.net.lose.clear();
  p.store.clearNotice();
  await p.store.undo(t);
  await p.store.idle();
  const server = byId((await backend(p.fake)).stops, SKY.id);
  assert.deepEqual([server.time, server.travelMin], ["14:00", 0]);
  assert.deepEqual([stopOf(p.store, SKY.id).time, stopOf(p.store, SKY.id).travelMin], ["14:00", 0]);
  assert.equal(sent(p.fake, "updateStop"), 1);
  assert.equal(p.store.state.lastChange.action, "undo");
  assert.equal(p.store.state.notice, null);
});

test("a stop removed, undone from the bar, removed again and put back", async () => {
  const p = phone({ seed: { stops: [SKY] } });
  await p.store.boot();
  const t = p.store.deleteStop(SKY.id);
  assert.equal(stopOf(p.store, SKY.id).deleted, true, "shown removed at once");
  await p.store.idle();
  assert.deepEqual([p.store.state.lastChange.kind, p.store.state.lastChange.action], ["stop", "delete"]);
  assert.equal(byId((await backend(p.fake)).stops, SKY.id).deleted, true);
  await p.store.undo(t);
  await p.store.idle();
  assert.equal(byId((await backend(p.fake)).stops, SKY.id).deleted, false);
  assert.equal(stopOf(p.store, SKY.id).deleted, false);
  p.store.deleteStop(SKY.id);
  await p.store.idle();
  p.store.restoreStop(SKY.id);
  assert.equal(stopOf(p.store, SKY.id).deleted, false, "shown back at once");
  await p.store.idle();
  assert.deepEqual([p.store.state.lastChange.kind, p.store.state.lastChange.action], ["stop", "restore"]);
  assert.equal(byId((await backend(p.fake)).stops, SKY.id).deleted, false);
  assert.equal(stopRows(p.fake), 1);
  assert.deepEqual(queueOf(p.storage), []);
});

test("a stop removed and put back from History", async () => {
  const p = phone({ seed: { stops: [SKY] } });
  await p.store.boot();
  p.store.deleteStop(SKY.id);
  await p.store.idle();
  await p.store.loadHistory();
  const top = p.store.state.history.entries[0];
  assert.deepEqual([top.kind, top.action, top.canUndo], ["stop", "delete", true]);
  assert.equal(await p.store.undoEntry(top.id), true);
  assert.equal(stopOf(p.store, SKY.id).deleted, false);
  assert.deepEqual([p.store.state.lastChange.kind, p.store.state.lastChange.action], ["stop", "undo"]);
  assert.equal(byId((await backend(p.fake)).stops, SKY.id).deleted, false);
});

test("stop writes while the phone knows it has no signal: nothing sent, nothing queued, said not saved", async () => {
  const p = phone({ seed: { stops: [SKY] } });
  await p.store.boot();
  p.net.knownOffline = true;
  const before = p.net.sent.length;
  p.store.addStop({ date: "2026-12-12", title: "Tower Records" });
  await p.store.idle();
  assert.equal(p.store.state.notice, NOT_SAVED);
  assert.equal(p.store.state.stops.some((s) => s.title === "Tower Records"), false);
  p.store.clearNotice();
  p.store.deleteStop(SKY.id);
  await p.store.idle();
  assert.equal(p.store.state.notice, NOT_SAVED);
  assert.equal(stopOf(p.store, SKY.id).deleted, false);
  assert.equal(p.net.sent.length, before, "nothing left the phone");
  assert.deepEqual(queueOf(p.storage), []);
  assert.deepEqual(p.store.outbox(), { unsent: 0, waiting: 0 });
  // signal back: nothing is sent on contact either
  p.net.knownOffline = false;
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(sent(p.fake, "addStop") + sent(p.fake, "deleteStop"), 0);
  assert.equal(stopRows(p.fake), 1);
});

test("a stop in a saved queue from before a reload is never sent; the expense beside it still is", async () => {
  const storage = memStorage({ "mat.key": KEY, "mat.me": "Mo" });
  const stop = { id: "stopBBBB0001", date: "2026-12-12", title: "Tower Records", time: "", detail: "", gettingThere: "", travelMin: 0, fixed: false, place: "", signJp: "", booked: false, link: "", photo: "", note: "" };
  const expense = { id: "expQQQQ0001", ...draft() };
  storage.setItem("mat.queue", JSON.stringify([
    { stop, sent: true },
    { undo: true, kind: "stop", args: { stop }, logId: 1, actor: "Mo" },
    { expense, addedAt: "2026-12-11T03:00:00.000Z", rate: 111, addedBy: "Mo", failed: false, sent: false },
  ]));
  const p = phone({ seed: { stops: [SKY] }, storage });
  await p.store.boot();
  await p.store.idle();
  assert.equal(sent(p.fake, "addStop"), 0);
  assert.equal(sent(p.fake, "undo"), 0);
  assert.equal(sent(p.fake, "addExpense"), 1);
  assert.deepEqual(p.store.state.stops.map((s) => [s.id, s.deleted]), [[SKY.id, false]]);
  assert.equal(stopOf(p.store, SKY.id).deleted, false, "the logged add the queue named is not undone");
  assert.deepEqual(queueOf(p.storage), []);
});

test("a cache from before the plan existed still paints, and the load fills in the stops", async () => {
  const storage = memStorage({ "mat.key": KEY, "mat.me": "Mo" });
  const p0 = phone({ seed: { stops: [SKY] } });
  const data = (await backend(p0.fake)).valueOf();
  const old = { ...data };
  delete old.stops;
  delete old.stays;
  delete old.days;
  storage.setItem("mat.cache", JSON.stringify({ data: old, rev: 0, loadedAt: 1 }));
  const p = phone({ fake: p0.fake, storage });
  const hold = p.net.hold("load");
  const booting = p.store.boot();
  await until(() => p.store.state.status === "ready");
  assert.deepEqual(p.store.state.stops, []);
  hold();
  await booting;
  assert.equal(stopOf(p.store, SKY.id).title, "Shibuya Sky");
});

test("a cache in the real Plan 1 shape paints Days and the same money before the load lands (M4)", async () => {
  const plan = require("./fixtures/plan.json");
  const seedAll = { ...SEED, ...plan };
  const p0 = phone({ seed: seedAll });
  const old = await p0.fake.plan1Load();
  assert.equal("deleted" in old.data.stops[0], false, "Plan 1 stops have deletedAt, not deleted");
  const storage = memStorage({ "mat.key": KEY, "mat.me": "Mo" });
  storage.setItem("mat.cache", JSON.stringify({ data: old.data, rev: old.rev, loadedAt: 1 }));
  const p = phone({ fake: p0.fake, storage });
  const hold = p.net.hold("load");
  const booting = p.store.boot();
  await until(() => p.store.state.status === "ready");
  const painted = p.store.state;
  assert.equal(painted.days.length, 11);
  assert.deepEqual(painted.stops.map((x) => x.title), plan.stops.map((x) => x.title));
  assert.equal(painted.stays[0].name, plan.stays[0].name);
  const money = (st) => JSON.stringify([balances(st.people.map((x) => x.name), st.expenses, st.payments), st.expenses.length, st.payments.length, st.setAside]);
  const before = money(painted);
  hold();
  await booting;
  await p.store.idle();
  assert.equal(money(p.store.state), before, "Money is the same once the load lands");
  assert.equal(p.store.state.stops.every((x) => x.deleted === false), true);
});

test("a stop write with no reply asks the backend at once, so the truth is back before anyone types it again", async () => {
  const p = phone({ seed: {} });
  await p.store.boot();
  p.net.lose.add("addStop");
  p.store.addStop({ date: "2026-12-12", title: "Shibuya Sky" });
  const id = idOf(p.store);
  await p.store.idle();
  assert.equal(p.store.state.notice, UNCONFIRMED);
  assert.equal(stopOf(p.store, id).title, "Shibuya Sky", "shown again from the backend, without waiting for the 20-second check");
  assert.equal(sent(p.fake, "addStop"), 1, "the write itself is not sent again");
  assert.equal(sent(p.fake, "load"), 2, "one reload");
});

test("an expense edit with no reply still waits for the next contact (unchanged by the stop rule)", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.lose.add("updateExpense");
  p.store.updateExpense("seedexp004", { amount: 4500 });
  await p.store.idle();
  assert.equal(byId(p.store.state.expenses, "seedexp004").amount, 4200);
  assert.equal(sent(p.fake, "rev") + sent(p.fake, "load"), 1, "only the boot load");
});

// ---------- stop writes the stop sheet waits on (R36) ----------

// A write the caller waits on: it says nothing on the undo bar until it is
// saved, and store.outcome(token) says how it ended.
const QUIET = { quiet: true };
const dropDay = (fake, date) => {
  const i = fake.tables.Days.findIndex((r) => String(r.date).slice(0, 10) === date || (r.date instanceof Date && r.date.toISOString().slice(0, 10) === date));
  assert.ok(i >= 0, "the day is in the fake's Days tab");
  fake.tables.Days.splice(i, 1);
};

test("R36: a waited-on stop add says nothing until the reply, then is saved and on the bar", async () => {
  const p = phone({ seed: {} });
  await p.store.boot();
  const release = p.net.hold("addStop");
  const t = p.store.addStop({ date: "2026-12-12", title: "Shibuya Sky" }, { ...QUIET, id: "stopWAIT0001" });
  let out = null;
  p.store.outcome(t).then((o) => { out = o; });
  await until(() => p.net.sent.some((b) => b.action === "addStop"));
  assert.equal(out, null, "no outcome before the reply");
  assert.equal(p.store.state.lastChange, null, "nothing on the bar while it waits");
  release();
  await until(() => out);
  assert.equal(out.saved, true);
  assert.equal(out.item.id, "stopWAIT0001");
  assert.deepEqual([p.store.state.lastChange.action, p.store.state.lastChange.kind, p.store.state.lastChange.canUndo], ["add", "stop", true]);
  assert.equal(p.store.state.lastChange.token, t);
  assert.equal(stopRows(p.fake), 1);
});

test("R36: a waited-on stop add refused by the backend comes back with its reason; no notice, nothing stored", async () => {
  const p = phone({ seed: {} });
  await p.store.boot();
  dropDay(p.fake, "2026-12-12");
  const t = p.store.addStop({ date: "2026-12-12", title: "Shibuya Sky" }, { ...QUIET, id: "stopWAIT0002" });
  const out = await p.store.outcome(t);
  await p.store.idle();
  assert.deepEqual(out, { saved: false, reason: "refused", message: "Pick a day of the trip." });
  assert.equal(p.store.state.notice, null);
  assert.equal(p.store.state.lastChange, null);
  assert.equal(stopRows(p.fake), 0);
  assert.equal(stopOf(p.store, "stopWAIT0002"), undefined);
});

test("R36: a waited-on stop add with no reply that did land: unsure first, then saved; one stop", async () => {
  const p = phone({ seed: {} });
  await p.store.boot();
  p.net.lose.add("addStop");
  let unsureAt = null;
  const t = p.store.addStop({ date: "2026-12-12", title: "Shibuya Sky" }, { ...QUIET, id: "stopWAIT0003", onUnsure: () => { unsureAt = sent(p.fake, "load"); } });
  const out = await p.store.outcome(t);
  await p.store.idle();
  assert.equal(unsureAt, 1, "told it is unsure before the check");
  assert.equal(out.saved, true);
  assert.equal(out.item.title, "Shibuya Sky");
  assert.equal(p.store.state.notice, null);
  assert.equal(p.store.state.lastChange.action, "add");
  assert.equal(stopOf(p.store, "stopWAIT0003").title, "Shibuya Sky");
  assert.equal(stopRows(p.fake), 1);
  assert.equal(sent(p.fake, "addStop"), 1);
});

test("R36: a waited-on stop add that never landed is not saved; a retry with the same id makes exactly one stop", async () => {
  const p = phone({ seed: {} });
  await p.store.boot();
  p.net.failing.add("addStop");
  const first = await p.store.outcome(p.store.addStop({ date: "2026-12-12", title: "Shibuya Sky" }, { ...QUIET, id: "stopWAIT0004" }));
  assert.deepEqual(first, { saved: false, reason: "notLanded" });
  assert.equal(p.store.state.notice, null);
  assert.equal(stopOf(p.store, "stopWAIT0004"), undefined);
  p.net.failing.clear();
  const again = await p.store.outcome(p.store.addStop({ date: "2026-12-12", title: "Shibuya Sky" }, { ...QUIET, id: "stopWAIT0004" }));
  await p.store.idle();
  assert.equal(again.saved, true);
  assert.equal(stopRows(p.fake), 1);
});

test("R36: a retry after 'not saved' when the first add landed late still makes one stop, and says what the backend has", async () => {
  const p = phone({ seed: {} });
  await p.store.boot();
  p.net.failing.add("addStop");
  const first = await p.store.outcome(p.store.addStop({ date: "2026-12-12", title: "Shibuya Sky" }, { ...QUIET, id: "stopWAIT0005" }));
  assert.equal(first.reason, "notLanded");
  // The first request reaches the backend after the check.
  await backend(p.fake, "addStop", { stop: { id: "stopWAIT0005", date: "2026-12-12", title: "Shibuya Sky" } }, "Mo");
  p.net.failing.clear();
  const again = await p.store.outcome(p.store.addStop({ date: "2026-12-12", title: "Shibuya Sky deck" }, { ...QUIET, id: "stopWAIT0005" }));
  await p.store.idle();
  assert.equal(again.saved, true);
  assert.equal(again.item.title, "Shibuya Sky", "the backend's own row, so the caller can see what differs");
  assert.equal(stopRows(p.fake), 1);
});

test("R36: a waited-on stop add the phone knows never left is not sent; no notice", async () => {
  const p = phone({ seed: {} });
  await p.store.boot();
  p.net.knownOffline = true;
  const out = await p.store.outcome(p.store.addStop({ date: "2026-12-12", title: "Shibuya Sky" }, { ...QUIET, id: "stopWAIT0006" }));
  assert.deepEqual(out, { saved: false, reason: "notSent" });
  assert.equal(p.store.state.notice, null);
  assert.equal(sent(p.fake, "addStop"), 0);
});

test("R36: when the check itself cannot reach the backend, the outcome waits for the next contact", async () => {
  const p = phone({ seed: {} });
  await p.store.boot();
  p.net.lose.add("addStop");
  p.net.failing.add("rev");
  p.net.failing.add("load");
  let out = null;
  let unsure = false;
  p.store.outcome(p.store.addStop({ date: "2026-12-12", title: "Shibuya Sky" }, { ...QUIET, id: "stopWAIT0007", onUnsure: () => { unsure = true; } })).then((o) => { out = o; });
  await p.store.idle();
  assert.equal(unsure, true);
  assert.equal(out, null, "still unknown");
  p.net.failing.clear();
  p.net.lose.clear();
  await p.store.checkRev();
  await until(() => out);
  assert.equal(out.saved, true);
  assert.equal(stopRows(p.fake), 1);
});

test("R36: a waited-on stop edit with no reply: landed is saved, not landed is not saved, and a retry saves it", async () => {
  const p = phone({ seed: { stops: [SKY] } });
  await p.store.boot();
  p.net.lose.add("updateStop");
  const landed = await p.store.outcome(p.store.updateStop(SKY.id, { time: "15:30" }, QUIET));
  assert.equal(landed.saved, true);
  assert.equal(landed.item.time, "15:30");
  assert.equal(p.store.state.notice, null);
  assert.equal(p.store.state.lastChange.action, "edit");
  p.net.lose.clear();
  p.net.failing.add("updateStop");
  const lost = await p.store.outcome(p.store.updateStop(SKY.id, { time: "16:00" }, QUIET));
  assert.deepEqual(lost, { saved: false, reason: "notLanded" });
  assert.equal(stopOf(p.store, SKY.id).time, "15:30", "the ticket shows what the backend has");
  p.net.failing.clear();
  const again = await p.store.outcome(p.store.updateStop(SKY.id, { time: "16:00" }, QUIET));
  await p.store.idle();
  assert.equal(again.saved, true);
  assert.equal(byId((await backend(p.fake)).stops, SKY.id).time, "16:00");
  assert.equal(stopRows(p.fake), 1);
});

test("R36: a waited-on stop edit refused by the backend comes back with its reason", async () => {
  const p = phone({ seed: { stops: [SKY] } });
  await p.store.boot();
  dropDay(p.fake, "2026-12-12");
  const out = await p.store.outcome(p.store.updateStop(SKY.id, { title: "Sky deck" }, QUIET));
  assert.deepEqual(out, { saved: false, reason: "refused", message: "Pick a day of the trip." });
  assert.equal(p.store.state.notice, null);
  assert.equal(stopOf(p.store, SKY.id).title, "Shibuya Sky");
});

// ---------- payments from the planner sheet (Task 12, R39) ----------
// Made-up planner rows and id.

const PLANNER_ID = "fakePlannerSheet_0123456789abcdefXYZ";
const PHEAD = ["payment_id", "date_paid", "payer", "description", "category", "vendor", "booking_ref", "amount", "currency", "amount_cad", "cad_is_exact", "split_between", "split_type", "status", "include_in_split", "source", "added_by", "notes"];
const prow = (o) => PHEAD.map((h) => (o[h] === undefined ? "" : o[h]));
const PX7 = { payment_id: "X7", date_paid: "2026-12-11", payer: "Mo", description: "Rail pass", category: "transport", vendor: "North Rail", booking_ref: "AB12", amount: 24750, currency: "JPY", amount_cad: 221.52, cad_is_exact: "yes", split_between: "Mo, Ajen, Trenton", split_type: "equal", include_in_split: "yes" };
const PQ3 = { ...PX7, payment_id: "Q3", description: "Noodle bar", amount_cad: "", amount: 3600, vendor: "Ramen Ya", booking_ref: "" };

test("syncPayments pulls, reloads so the lines are there, says what came in, and resolves with the counts", async () => {
  const p = phone({ seed: { ...SEED, planner: [PHEAD, prow(PX7), prow(PQ3), prow({ ...PX7, payment_id: "P5", split_type: "personal" })], plannerId: PLANNER_ID } });
  await p.store.boot();
  assert.equal(p.store.state.plannerLinked, true);
  const before = p.store.state.expenses.length;
  const r = await p.store.syncPayments();
  assert.deepEqual(r, { added: 2, changed: 0, same: 0, removed: 0, notCounted: [], problems: [{ id: "P5", message: "Only payments split equally can be brought in.", row: 4, what: "Rail pass" }], more: false, capped: false });
  assert.equal(p.store.state.notice, "Added 2 payments from the planner. 1 payment needs a look in the planner. See You for which.");
  assert.deepEqual(p.store.state.paymentProblems.list, [{ id: "P5", message: "Only payments split equally can be brought in.", row: 4, what: "Rail pass" }], "the list comes in with the reload");
  assert.equal(p.store.state.expenses.length, before + 2);
  assert.ok(p.store.state.expenses.some((e) => e.title === "Rail pass" && e.amount === 221.52 && !e.pending));
  assert.equal(p.net.sent.filter((b) => b.action === "syncPayments").length, 1);
  assert.equal(p.net.sent.filter((b) => b.action === "syncPayments")[0].actor, "Mo");
  assert.equal(JSON.stringify(p.storage.map.get("mat.cache")).includes(PLANNER_ID), false);

  await p.store.syncPayments();
  assert.equal(p.store.state.notice, "Nothing new in the planner. 1 payment needs a look in the planner. See You for which.");
});

test("syncPayments: each sentence it says", async () => {
  const cases = [
    [{ added: 0, changed: 0 }, "Nothing new in the planner."],
    [{ added: 1, changed: 0 }, "Added 1 payment from the planner."],
    [{ added: 3, changed: 0 }, "Added 3 payments from the planner."],
    [{ added: 0, changed: 1 }, "Changed 1 payment to match the planner."],
    [{ added: 0, changed: 4 }, "Changed 4 payments to match the planner."],
    [{ added: 2, changed: 1 }, "Added 2 and changed 1 to match the planner."],
    [{ added: 1, changed: 0, problems: [{ id: "", message: "x" }] }, "Added 1 payment from the planner. 1 payment needs a look in the planner. See You for which."],
    [{ added: 0, changed: 0, problems: [{ id: "a", message: "x" }, { id: "b", message: "y" }] }, "Nothing new in the planner. 2 payments need a look in the planner. See You for which."],
    [{ added: 10, changed: 0, more: true }, "Added 10 payments from the planner. More to bring in: tap Fetch again."],
    [{ added: 0, changed: 0, capped: true }, "Nothing new in the planner. Only the first 300 payments were read."],
    [{ added: 7, changed: 3, problems: [{ id: "a", message: "x" }], capped: true, more: true }, "Added 7 and changed 3 to match the planner. 1 payment needs a look in the planner. See You for which. Only the first 300 payments were read. More to bring in: tap Fetch again."],
  ];
  for (const [counts, said] of cases) {
    const p = phone({ seed: SEED });
    await p.store.boot();
    const data = { added: 0, changed: 0, same: 0, removed: 0, notCounted: [], problems: [], more: false, capped: false, ...counts };
    p.net.override = (b) => (b.action === "syncPayments" ? { ok: true, rev: 0, data } : null);
    const loads = p.net.sent.filter((b) => b.action === "load").length;
    assert.deepEqual(await p.store.syncPayments(), data);
    assert.equal(p.store.state.notice, said, JSON.stringify(counts));
    assert.equal(p.net.sent.filter((b) => b.action === "load").length, loads + 1, "it reloads");
  }
});

test("syncPayments with the phone known offline sends nothing and says No signal; a refusal shows the backend's sentence", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  assert.equal(p.store.state.plannerLinked, false);
  p.net.knownOffline = true;
  const sent = p.net.sent.length;
  assert.equal(await p.store.syncPayments(), null);
  assert.equal(p.net.sent.length, sent, "nothing sent");
  assert.equal(p.store.state.notice, "No signal. Try again.");

  p.net.knownOffline = false;
  assert.equal(await p.store.syncPayments(), null);
  assert.equal(p.store.state.notice, "No planner sheet is linked yet. Ask Mo to link it.");

  p.net.override = (b) => (b.action === "syncPayments" ? { ok: false, error: "planner_unreadable", message: "Couldn’t read the planner sheet. Ask Mo to check its permission." } : null);
  assert.equal(await p.store.syncPayments(), null);
  assert.equal(p.store.state.notice, "Couldn’t read the planner sheet. Ask Mo to check its permission.");

  // R40 fix 6: a tab the backend can't use is a refusal with its own sentence, not "nothing new".
  p.net.override = (b) => (b.action === "syncPayments" ? { ok: false, error: "planner_columns", message: "The planner’s Payments tab is missing the column amount_cad." } : null);
  assert.equal(await p.store.syncPayments(), null);
  assert.equal(p.store.state.notice, "The planner’s Payments tab is missing the column amount_cad.");
});

test("syncPayments with no reply says it couldn't confirm and the next contact reloads", async () => {
  const p = phone({ seed: { ...SEED, planner: [PHEAD, prow(PX7)], plannerId: PLANNER_ID } });
  await p.store.boot();
  p.net.lose.add("syncPayments");
  assert.equal(await p.store.syncPayments(), null);
  assert.equal(p.store.state.notice, "Couldn’t confirm that. Checking…");
  await p.store.checkRev();
  await p.store.idle();
  assert.ok(p.store.state.expenses.some((e) => e.title === "Rail pass"), "what landed shows after the next contact");
});

// ---------- "Before we go" (Task 20): the planner's Book Now list ----------

const BHEAD = ["#", "Item", "Book by", "Status", "Notes", "Booking link"];
const brow = (o) => BHEAD.map((h) => (o[h] === undefined ? "" : o[h]));
const CHEAD = ["#", "Date / time", "Agent / session", "Tab", "Cell(s)", "Item", "Old value", "New value", "Why", "Proof / source", "Verified?"];
function bookSeed(n = 3, over = {}) {
  const rows = [BHEAD];
  for (let i = 1; i <= n; i++) rows.push(brow({ "#": i, Item: "Made-up booking " + i, "Book by": "2026-12-0" + ((i % 9) + 1), Status: "Not booked" }));
  return { ...SEED, plannerId: PLANNER_ID, plannerTabs: { "Book Now": rows, "Change Log": [CHEAD] }, ...over };
}

test("syncTodos puts the list into state and asks again while the backend says more remain, at most 4 calls", async () => {
  const p = phone({ seed: bookSeed(17) });
  await p.store.boot();
  assert.deepEqual(p.store.state.todos, []);
  assert.equal(p.store.state.todosPulledAt, "");
  const r = await p.store.syncTodos();
  const calls = p.net.sent.filter((b) => b.action === "syncTodos");
  assert.deepEqual(calls.map((b) => b.args), [{ force: false }, { force: true }], "15 rows, then the 2 left");
  assert.equal(r.ok, true);
  assert.equal(r.more, false);
  assert.equal(p.store.state.todos.length, 17);
  assert.ok(p.store.state.todosPulledAt);
  assert.equal(r.pulledAt, p.store.state.todosPulledAt);
  assert.equal(JSON.parse(p.storage.map.get("mat.cache")).data.todos.length, 17, "kept in the cache");

  // A backend that always says more: four calls, then it stops and says so.
  p.net.override = (b) => (b.action === "syncTodos" ? { ok: true, rev: 0, data: { todos: [], pulledAt: "", more: true, problems: [] } } : null);
  const before = p.net.sent.length;
  const again = await p.store.syncTodos({ force: true });
  assert.equal(p.net.sent.length - before, 4);
  assert.equal(again.more, true);
  assert.ok(p.store.state.todosPulledAt, "an unfinished pull leaves the last fetched time");
});

test("syncTodos: quiet says nothing when it fails; otherwise the usual notice; never queued", async () => {
  const p = phone({ seed: bookSeed(2) });
  await p.store.boot();
  p.net.knownOffline = true;
  let r = await p.store.syncTodos({ quiet: true });
  assert.equal(r.ok, false);
  assert.equal(p.store.state.notice, null);
  r = await p.store.syncTodos();
  assert.equal(p.store.state.notice, "No signal. Try again.");
  p.net.knownOffline = false;
  p.store.clearNotice();
  p.net.override = (b) => (b.action === "syncTodos" ? { ok: false, error: "planner_unreadable", message: "Couldn’t read the planner sheet." } : null);
  r = await p.store.syncTodos();
  assert.equal(r.ok, false);
  assert.equal(r.message, "Couldn’t read the planner sheet.");
  assert.equal(p.store.state.notice, "Couldn’t read the planner sheet.");
});

test("tickTodo shows the tick at once, keeps what the backend saved, and Undo puts it back", async () => {
  const p = phone({ seed: bookSeed(2) });
  await p.store.boot();
  await p.store.syncTodos();
  const token = p.store.tickTodo("1");
  let t = byId(p.store.state.todos, "1");
  assert.equal(t.tickedBy, "Mo");
  assert.equal(t.done, true);
  assert.equal(t.pending, true);
  assert.equal(p.store.state.lastChange.kind, "todo");
  assert.equal(p.store.state.lastChange.action, "tick");
  await p.store.idle();
  t = byId(p.store.state.todos, "1");
  assert.equal(t.pending, undefined);
  assert.equal(t.status, "Booked", "the planner took it");
  assert.deepEqual(p.net.sent.filter((b) => b.action === "tickTodo").map((b) => b.args), [{ id: "1" }]);

  await p.store.undo(token);
  await p.store.idle();
  t = byId(p.store.state.todos, "1");
  assert.equal(t.tickedBy, "");
  assert.equal(t.done, false);
});

test("tickTodo refused rolls back with the backend's sentence; offline it says not saved", async () => {
  const p = phone({ seed: bookSeed(2) });
  await p.store.boot();
  await p.store.syncTodos();
  await backend(p.fake, "tickTodo", { id: "2" }, "Ajen"); // another phone ticked it first
  p.store.tickTodo("2");
  await p.store.idle();
  assert.equal(p.store.state.notice, "That one is already done.");
  assert.equal(byId(p.store.state.todos, "2").tickedBy, "", "rolled back to what this phone knew");

  p.store.clearNotice();
  p.net.knownOffline = true;
  p.store.tickTodo("1");
  await p.store.idle();
  assert.equal(p.store.state.notice, "No signal. That wasn’t saved.");
  assert.equal(byId(p.store.state.todos, "1").tickedBy, "");
  assert.equal(p.fake.tables.Todos.find((r) => r.id === "1").ticked_by, "");
});

test("claimTodo: I’ll do it, take it over, hand it back, each with its own words on the undo bar", async () => {
  const p = phone({ seed: bookSeed(2) });
  await p.store.boot();
  await p.store.syncTodos();
  p.store.claimTodo("1", true);
  assert.equal(byId(p.store.state.todos, "1").claimedBy, "Mo");
  assert.equal(p.store.state.lastChange.action, "claim");
  await p.store.idle();
  p.store.claimTodo("1", false);
  assert.equal(byId(p.store.state.todos, "1").claimedBy, "");
  assert.equal(p.store.state.lastChange.action, "unclaim");
  await p.store.idle();
  await backend(p.fake, "claimTodo", { id: "2", on: true }, "Ajen");
  await p.store.refresh();
  p.store.claimTodo("2", true);
  assert.equal(p.store.state.lastChange.action, "takeover");
  await p.store.idle();
  assert.equal(byId(p.store.state.todos, "2").claimedBy, "Mo");
  assert.deepEqual(p.net.sent.filter((b) => b.action === "claimTodo").map((b) => b.args), [{ id: "1", on: true }, { id: "1", on: false }, { id: "2", on: true }]);
});

test("syncTodos: when a later call of a long pull fails, what the earlier one brought in is kept, and the failure is said", async () => {
  const p = phone({ seed: bookSeed(2) });
  await p.store.boot();
  let calls = 0;
  p.net.override = (b) => {
    if (b.action !== "syncTodos") return null;
    calls += 1;
    p.net.failing.add("syncTodos"); // the next one has no signal
    return { ok: true, rev: 0, data: { todos: [{ id: "9", item: "Made-up first part", bookBy: "", status: "", note: "", link: "", claimedBy: "", tickedBy: "", tickedAt: "", done: false }], pulledAt: "", more: true, problems: [] } };
  };
  const r = await p.store.syncTodos({ force: true });
  assert.equal(calls, 1);
  assert.equal(r.ok, false);
  assert.deepEqual(p.store.state.todos.map((t) => t.id), ["9"], "the first answer is kept");
  assert.equal(p.store.state.notice, "Couldn’t confirm that. Checking…");
});

// ---------- payments pulled on their own (Mo, 2026-11-17) ----------
// autoPayments(): while the app is open, at most once every 10 minutes per
// phone, the planner's payments are asked for with { auto: true }. Quiet:
// it says something only when lines came in or changed.

const autoPhone = (over = {}) => {
  const at = { ms: NOW };
  const fake = createFakeBackend({ ...SEED, planner: [PHEAD, prow(PX7)], plannerId: PLANNER_ID, ...over }, { clock: () => new Date(at.ms).toISOString() });
  return { at, ...phone({ fake, clock: () => at.ms }) };
};
const autoCalls = (p) => p.net.sent.filter((b) => b.action === "syncPayments");

test("autoPayments: brings new planner payments in, says so, and the lines are on the receipt", async () => {
  const p = autoPhone();
  await p.store.boot();
  const r = await p.store.autoPayments();
  assert.equal(r.added, 1);
  assert.deepEqual(autoCalls(p).map((b) => b.args), [{ auto: true }]);
  assert.equal(p.store.state.notice, "Added 1 payment from the planner.");
  assert.ok(p.store.state.expenses.some((e) => e.title === "Rail pass"));
  assert.equal(p.store.state.paymentsPulledAt, new Date(NOW).toISOString(), "load carries when it last pulled");
});

test("paymentProblems arrives in state from load, and is empty when the backend has none", async () => {
  const none = phone({ seed: SEED });
  await none.store.boot();
  assert.deepEqual(none.store.state.paymentProblems, { at: "", list: [], more: 0 });
  const seeded = { at: "2026-12-12T01:00:00.000Z", list: [{ id: "Q1", message: "Why.", row: 9, what: "Thing" }], more: 2 };
  const p = phone({ seed: { ...SEED, paymentProblems: seeded } });
  await p.store.boot();
  assert.deepEqual(p.store.state.paymentProblems, seeded);
});

test("autoPayments: a pull with only problems raises no notice, but the list is brought up to date", async () => {
  const p = autoPhone({ planner: [PHEAD, prow({ ...PX7, split_type: "personal" })] });
  await p.store.boot();
  assert.deepEqual(p.store.state.paymentProblems.list, []);
  const loads = p.net.sent.filter((b) => b.action === "load").length;
  const r = await p.store.autoPayments();
  assert.equal(r.added, 0);
  assert.equal(r.problems.length, 1);
  assert.equal(p.store.state.notice, null, "no notice");
  assert.equal(p.net.sent.filter((b) => b.action === "load").length, loads + 1, "it reloads to get the list");
  assert.deepEqual(p.store.state.paymentProblems.list.map((x) => [x.id, x.row, x.what]), [["X7", 2, "Rail pass"]]);
  // The same problem on the next pull is not news: no reload.
  p.at.ms += 10 * 60 * 1000;
  const again = p.net.sent.filter((b) => b.action === "load").length;
  await p.store.autoPayments();
  assert.equal(p.net.sent.filter((b) => b.action === "load").length, again);
  assert.equal(p.store.state.notice, null);
});

test("autoPayments: sooner than 10 minutes after a pull sends nothing; at 10 minutes it asks again", async () => {
  const p = autoPhone();
  await p.store.boot();
  await p.store.autoPayments();
  p.at.ms += 9 * 60 * 1000;
  assert.equal(await p.store.autoPayments(), null);
  assert.equal(autoCalls(p).length, 1);
  p.at.ms += 60 * 1000;
  await p.store.autoPayments();
  assert.equal(autoCalls(p).length, 2);
});

test("autoPayments: nothing new is said nowhere and does not reload", async () => {
  const p = autoPhone({ planner: [PHEAD] });
  await p.store.boot();
  const loads = p.net.sent.filter((b) => b.action === "load").length;
  p.store.clearNotice && p.store.clearNotice();
  const before = p.store.state.notice;
  await p.store.autoPayments();
  assert.equal(autoCalls(p).length, 1);
  assert.equal(p.store.state.notice, before, "no notice");
  assert.equal(p.net.sent.filter((b) => b.action === "load").length, loads, "no reload");
});

test("autoPayments: another phone pulled a minute ago (load says so): this one waits", async () => {
  const p = autoPhone();
  await backend(p.fake, "syncPayments", {});
  p.at.ms += 60 * 1000;
  await p.store.boot();
  assert.equal(await p.store.autoPayments(), null);
  assert.equal(autoCalls(p).length, 0);
});

test("autoPayments: no planner linked, offline, or a refusal: nothing said", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  assert.equal(await p.store.autoPayments(), null);
  assert.equal(p.net.sent.filter((b) => b.action === "syncPayments").length, 0, "not linked: nothing sent");

  const q = autoPhone();
  await q.store.boot();
  const before = q.store.state.notice;
  q.net.knownOffline = true;
  assert.equal(await q.store.autoPayments(), null);
  assert.equal(autoCalls(q).length, 0, "offline: nothing sent");
  q.net.knownOffline = false;
  q.net.override = (b) => (b.action === "syncPayments" ? { ok: false, error: "planner_unreadable", message: "Couldn’t read the planner sheet." } : null);
  assert.equal(await q.store.autoPayments(), null);
  assert.equal(q.store.state.notice, before, "a refusal is not said");
});

test("autoPayments: one at a time", async () => {
  const p = autoPhone();
  await p.store.boot();
  const release = p.net.hold("syncPayments");
  const first = p.store.autoPayments();
  assert.equal(await p.store.autoPayments(), null, "a second call while one runs sends nothing");
  release();
  await first;
  assert.equal(autoCalls(p).length, 1);
});

test("autoPayments: never replaces a notice already showing (review, 2026-11-17)", async () => {
  const p = autoPhone();
  await p.store.boot();
  p.store.notify("No signal. That wasn’t saved.");
  const r = await p.store.autoPayments();
  assert.equal(r.added, 1);
  assert.equal(p.store.state.notice, "No signal. That wasn’t saved.");
  assert.ok(p.store.state.expenses.some((e) => e.title === "Rail pass"), "the line still came in");
});

// ---------- busy(): nothing may be dropped by a reload (review, 2026-11-17) ----------

test("busy: true while an edit is on its way, false once it has landed", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  assert.equal(p.store.busy(), false);
  const release = p.net.hold("updateExpense");
  const id = p.store.state.expenses[0].id;
  const saving = p.store.updateExpense(id, { note: "window seat" });
  assert.equal(p.store.busy(), true, "an edit is sending: the outbox does not count it, busy does");
  assert.equal(p.store.outbox().unsent, 0);
  release();
  await saving;
  await new Promise((r) => setImmediate(r)); // the chain lets go a tick after the write settles
  assert.equal(p.store.busy(), false);
});

test("loadHistory: a first-page load clears an error left by an earlier fetch", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  p.net.failing.add("history");
  await p.store.loadHistory();
  assert.equal(p.store.state.history.error, "network");
  p.net.failing.delete("history");
  const release = p.net.hold("history");
  const loading = p.store.loadHistory();
  assert.deepEqual([p.store.state.history.loading, p.store.state.history.error], [true, null], "no old error over a fresh load");
  release();
  await loading;
  assert.equal(p.store.state.history.error, null);
});

// ---------- the stamp book ----------

const SDEFS = [
  { id: "d1", date: "2030-01-05", name_ja: "試験", name_en: "Testville", place: "Test Hall", motif: "lantern", ink: "shu", shape: "round" },
  { id: "d2", date: "2030-01-06", name_ja: "二", name_en: "Second", place: "Second Place", motif: "tower", ink: "ai", shape: "square" },
  { id: "iss", date: "", name_ja: "発行", name_en: "Issued", place: "", motif: "crest", ink: "shu", shape: "round" },
];
// 10:00 in Japan on Jan 5 2030, inside d1's window.
const IN_D1 = Date.UTC(2030, 0, 5, 1);
const HOUR = 3600000;
const CLOSED_LINE = "That stamp’s day has closed.";

// One phone on a backend whose clock is the phone's (until clock.ms is moved).
function stampPhone({ ms = IN_D1, defs = SDEFS, fake, storage, me = "Mo", missingTabs } = {}) {
  const clock = { ms };
  const f = fake || createFakeBackend(missingTabs ? { missingTabs } : {}, { clock: () => new Date(clock.ms).toISOString() });
  if (!missingTabs && !fake) for (const d of defs) f.tables.StampDefs.push({ ...d });
  const p = phone({ fake: f, storage, me, clock: () => clock.ms });
  p.clock = clock;
  return p;
}
const mineOf = (p) => p.store.state.stamps.filter((s) => s.who === "Mo");

test("a press shows at once, flagged pending, and is the backend's stamp once it answers", async () => {
  const p = stampPhone();
  await p.store.boot();
  assert.deepEqual(p.store.state.stampDefs.map((d) => d.id), ["d1", "d2", "iss"]);
  const release = p.net.hold("pressStamp");
  const token = p.store.pressStamp("d1");
  assert.ok(token, "a token comes back");
  const now = mineOf(p);
  assert.equal(now.length, 1);
  assert.deepEqual([now[0].def, now[0].who, now[0].at, now[0].pending], ["d1", "Mo", new Date(IN_D1).toISOString(), true]);
  assert.ok(now[0].seed >= 1 && now[0].seed <= 4294967295);
  assert.equal(p.store.state.lastChange, null, "no undo bar line: a press is lifted from History");
  release();
  await p.store.idle();
  const after = mineOf(p);
  assert.deepEqual(after.map((s) => [s.def, "pending" in s]), [["d1", false]]);
  assert.equal(p.fake.tables.Stamps.length, 1);
  assert.equal(after[0].seed, p.fake.tables.Stamps[0].seed, "the backend's own stamp");
});

test("the seed the phone drew is the one that stays: the ink does not change when the answer lands", async () => {
  const p = stampPhone();
  await p.store.boot();
  p.store.pressStamp("d1");
  const local = mineOf(p)[0].seed;
  await p.store.idle();
  assert.equal(mineOf(p)[0].seed, local);
});

test("the backend's answer replaces whatever the phone showed (a different seed from the backend wins)", async () => {
  const p = stampPhone();
  await p.store.boot();
  p.net.override = (body) => (body.action === "pressStamp" ? { ok: true, rev: 99, data: { stamp: { def: "d1", who: "Mo", at: body.args.at, seed: 424242 }, logId: 5 } } : null);
  p.store.pressStamp("d1");
  await p.store.idle();
  assert.deepEqual(mineOf(p).map((s) => [s.seed, "pending" in s]), [[424242, false]]);
});

test("busy is true while a press is on its way, so the app does not reload under it; false when it has landed", async () => {
  const p = stampPhone();
  await p.store.boot();
  assert.equal(p.store.busy(), false);
  const release = p.net.hold("pressStamp");
  p.store.pressStamp("d1");
  assert.equal(p.store.busy(), true);
  assert.equal(p.store.outbox().unsent, 1, "and it counts as something still to send");
  release();
  await p.store.idle();
  await new Promise((r) => setImmediate(r));
  assert.equal(p.store.busy(), false);
  assert.equal(p.store.outbox().unsent, 0);
});

test("two fast taps are one press and one request", async () => {
  const p = stampPhone();
  await p.store.boot();
  const release = p.net.hold("pressStamp");
  assert.ok(p.store.pressStamp("d1"));
  assert.equal(p.store.pressStamp("d1"), null);
  release();
  await p.store.idle();
  assert.equal(p.store.pressStamp("d1"), null, "and not again once it is shown");
  assert.equal(p.net.sent.filter((b) => b.action === "pressStamp").length, 1);
  assert.equal(p.fake.tables.Stamps.length, 1);
});

test("nothing to press: an unknown stamp, or no one chosen yet", async () => {
  const p = stampPhone();
  await p.store.boot();
  assert.equal(p.store.pressStamp("nope"), null);
  const q = stampPhone({ me: null, fake: p.fake });
  await q.store.boot();
  assert.equal(q.store.pressStamp("d1"), null);
  assert.equal(p.net.sent.filter((b) => b.action === "pressStamp").length, 0);
});

test("a press made with no signal is kept on the phone, survives a reload, and is sent with the same time and seed when signal returns", async () => {
  const p = stampPhone();
  await p.store.boot();
  p.net.offline = true;
  p.store.pressStamp("d1");
  await p.store.idle();
  const first = mineOf(p)[0];
  assert.equal(first.pending, true, "still shown, not rolled back");
  assert.equal(p.fake.tables.Stamps.length, 0);
  assert.equal(p.store.outbox().waiting, 1);
  const kept = queueOf(p.storage);
  assert.equal(kept.length, 1);
  assert.deepEqual(Object.keys(kept[0].stamp).sort(), ["at", "def", "seed"]);
  assert.equal(JSON.stringify(kept).includes(KEY), false, "no key in the queue");

  // the phone is closed and opened again, still with no signal
  const again = stampPhone({ fake: p.fake, storage: p.storage });
  again.clock.ms = p.clock.ms + 5000;
  again.net.offline = true;
  await again.store.boot();
  assert.deepEqual(mineOf(again).map((s) => [s.def, s.seed, s.pending]), [["d1", first.seed, true]], "back on the book after a reload");

  // signal returns: it goes, as it was pressed
  again.net.offline = false;
  await again.store.checkRev();
  await again.store.flush();
  await again.store.idle();
  assert.equal(p.fake.tables.Stamps.length, 1);
  assert.deepEqual([p.fake.tables.Stamps[0].at, p.fake.tables.Stamps[0].seed], [first.at, first.seed]);
  assert.deepEqual(mineOf(again).map((s) => "pending" in s), [false]);
  assert.deepEqual(queueOf(again.storage), []);
});

test("a press arriving after its window closed is accepted when it was pressed inside it, and keeps the time it was pressed", async () => {
  const p = stampPhone();
  await p.store.boot();
  p.net.offline = true;
  p.store.pressStamp("d1");
  await p.store.idle();
  p.clock.ms = IN_D1 + 30 * HOUR; // d1 closed 8 hours ago
  p.net.offline = false;
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(p.fake.tables.Stamps.length, 1);
  assert.equal(p.fake.tables.Stamps[0].at, new Date(IN_D1).toISOString());
  assert.deepEqual(mineOf(p).map((s) => "pending" in s), [false]);
});

test("a reply lost: the press stays shown and is resent with the same def; one stamp, never two", async () => {
  const p = stampPhone();
  await p.store.boot();
  p.net.lose.add("pressStamp");
  p.store.pressStamp("d1");
  await p.store.idle();
  assert.equal(p.fake.tables.Stamps.length, 1, "it reached the backend");
  assert.deepEqual(mineOf(p).map((s) => s.pending), [true]);
  p.net.lose.clear();
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(p.fake.tables.Stamps.length, 1);
  assert.equal(p.fake.tables.Log.filter((r) => r.kind === "stamp").length, 1, "one History line");
  assert.deepEqual(p.net.sent.filter((b) => b.action === "pressStamp").map((b) => b.args.def), ["d1", "d1"]);
  assert.deepEqual(mineOf(p).map((s) => "pending" in s), [false]);
});

test("a press the backend refuses as closed is taken back and its line is said", async () => {
  const p = stampPhone();
  await p.store.boot();
  p.clock.ms = IN_D1 + 40 * HOUR; // the phone's clock says d1 is long closed
  const token = p.store.pressStamp("d1");
  assert.ok(token);
  await p.store.idle();
  assert.deepEqual(mineOf(p), []);
  assert.equal(p.store.state.notice, CLOSED_LINE);
  assert.equal(p.fake.tables.Stamps.length, 0);
  assert.deepEqual(queueOf(p.storage), [], "nothing left to resend");
});

test("a press for a day that is not open, or from a clock ahead of the backend's, is taken back with its own line", async () => {
  const p = stampPhone();
  await p.store.boot();
  p.store.pressStamp("d2"); // d2 opens tomorrow
  await p.store.idle();
  assert.deepEqual(mineOf(p), []);
  assert.equal(p.store.state.notice, "That stamp isn’t open yet.");
  p.store.clearNotice();
  // the phone's clock an hour ahead of the backend's
  const skew = createFakeBackend({}, { clock: () => new Date(IN_D1).toISOString() });
  for (const d of SDEFS) skew.tables.StampDefs.push({ ...d });
  const late = phone({ fake: skew, clock: () => IN_D1 + HOUR });
  await late.store.boot();
  late.store.pressStamp("d1");
  await late.store.idle();
  assert.deepEqual(late.store.state.stamps, []);
  assert.match(late.store.state.notice, /clock is ahead/);
});

test("a press still queued 48 hours and one second after it was made is dropped with a line; at exactly 48 hours it is kept", async () => {
  const p = stampPhone();
  await p.store.boot();
  p.net.offline = true;
  p.store.pressStamp("d1");
  await p.store.idle();
  assert.equal(queueOf(p.storage).length, 1);
  p.clock.ms = IN_D1 + 48 * HOUR;
  await p.store.flush();
  assert.equal(mineOf(p).length, 1, "exactly 48 hours: kept");
  assert.equal(p.store.state.notice, null);
  p.clock.ms = IN_D1 + 48 * HOUR + 1000;
  await p.store.flush();
  assert.deepEqual(mineOf(p), []);
  assert.equal(p.store.state.notice, CLOSED_LINE);
  assert.deepEqual(queueOf(p.storage), []);
  assert.equal(p.store.outbox().unsent, 0);
  // and when the signal comes back, nothing is sent
  p.net.offline = false;
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(p.fake.tables.Stamps.length, 0);
});

test("a queued press that is 48 hours old when the app opens is dropped at once", async () => {
  const p = stampPhone();
  await p.store.boot();
  p.net.offline = true;
  p.store.pressStamp("d1");
  await p.store.idle();
  const later = stampPhone({ fake: p.fake, storage: p.storage, ms: IN_D1 + 49 * HOUR });
  later.net.offline = true;
  await later.store.boot();
  assert.deepEqual(later.store.state.stamps.filter((s) => s.who === "Mo"), []);
  assert.equal(later.store.state.notice, CLOSED_LINE);
});

test("lifting a press from History lifts it here; pressing it again inside the window works, after the window it does not", async () => {
  const p = stampPhone();
  await p.store.boot();
  p.store.pressStamp("d1");
  await p.store.idle();
  await p.store.loadHistory();
  const line = p.store.state.history.entries.find((e) => e.kind === "stamp");
  assert.equal(line.summary, "stamped Jan 5");
  assert.equal(await p.store.undoEntry(line.id), true);
  assert.deepEqual(mineOf(p).filter((s) => !s.gone), [], "the ring is empty");
  assert.equal(p.fake.tables.Stamps[0].gone, "yes");
  // inside the window it can be pressed again
  assert.ok(p.store.pressStamp("d1"));
  await p.store.idle();
  assert.deepEqual(mineOf(p).filter((s) => !s.gone).map((s) => "pending" in s), [false]);
  assert.equal(p.fake.tables.Stamps[0].gone, "");
  // lift it, and let the window close
  await p.store.loadHistory();
  const again = p.store.state.history.entries.find((e) => e.kind === "stamp" && e.action === "press" && e.canUndo);
  assert.equal(await p.store.undoEntry(again.id), true);
  p.clock.ms = IN_D1 + 20 * HOUR;
  assert.ok(p.store.pressStamp("d1"), "the phone tries");
  await p.store.idle();
  assert.deepEqual(mineOf(p).filter((s) => !s.gone), []);
  assert.equal(p.store.state.notice, CLOSED_LINE);
  assert.equal(p.fake.tables.Stamps[0].gone, "yes");
});

test("a sheet where migrate has not been run: no definitions, no stamps, nothing to press, everything else as before", async () => {
  const p = stampPhone({ missingTabs: ["StampDefs", "Stamps"] });
  await p.store.boot();
  assert.equal(p.store.state.status, "ready");
  assert.deepEqual([p.store.state.stampDefs, p.store.state.stamps], [[], []]);
  assert.equal(p.store.state.people.length, 3);
  assert.equal(p.store.pressStamp("d1"), null);
  assert.equal(p.net.sent.filter((b) => b.action === "pressStamp").length, 0);
});

test("a cache saved before the book existed opens with an empty book", async () => {
  const p = stampPhone();
  await p.store.boot();
  const cache = JSON.parse(p.storage.getItem("mat.cache"));
  delete cache.data.stampDefs;
  delete cache.data.stamps;
  p.storage.setItem("mat.cache", JSON.stringify(cache));
  const q = stampPhone({ fake: p.fake, storage: p.storage });
  q.net.offline = true;
  await q.store.boot();
  assert.deepEqual([q.store.state.stampDefs, q.store.state.stamps], [[], []]);
  assert.equal(q.store.state.status, "ready");
});

test("everyone's stamps come with a load; another phone's press arrives on the next check", async () => {
  const p = stampPhone();
  await p.store.boot();
  const ajen = await p.fake({ key: KEY, actor: "Ajen", action: "pressStamp", args: { def: "d1", at: new Date(IN_D1).toISOString() } });
  assert.equal(ajen.ok, true);
  await p.store.checkRev();
  assert.deepEqual(p.store.state.stamps.map((s) => [s.def, s.who]), [["d1", "Ajen"]]);
});

// ---------- wave A: the Before list ----------

const NOTODOPROBS = { at: "", list: [], more: 0 };
// A Book Now tab where #1 is there twice (rows 2 and 4 of the tab).
const twiceSeed = () => {
  const s = bookSeed(2);
  s.plannerTabs["Book Now"].push(brow({ "#": 1, Item: "Made-up repeat", Status: "" }));
  return s;
};

test("wave A 1: todoProblems comes from load (empty shape before any pull) and is kept in the cache", async () => {
  const none = phone({ seed: bookSeed(2) });
  assert.deepEqual(none.store.state.todoProblems, NOTODOPROBS, "initial state");
  await none.store.boot();
  assert.deepEqual(none.store.state.todoProblems, NOTODOPROBS);
  const seeded = { at: "2026-12-11T02:00:00.000Z", list: [{ id: "4", message: "Made-up reason.", row: 7, what: "Made-up item" }], more: 1 };
  const p = phone({ seed: { ...bookSeed(2), todoProblems: seeded } });
  await p.store.boot();
  assert.deepEqual(p.store.state.todoProblems, seeded);
  assert.deepEqual(JSON.parse(p.storage.map.get("mat.cache")).data.todoProblems, seeded);
});

test("wave A 1: a real pull brings its problems in at once; a stored answer leaves them alone", async () => {
  const at = { ms: NOW };
  const fake = createFakeBackend(twiceSeed(), { clock: () => new Date(at.ms).toISOString() });
  const p = phone({ fake, clock: () => at.ms });
  await p.store.boot();
  await p.store.syncTodos();
  assert.deepEqual(p.store.state.todoProblems.list, [{ id: "1", message: "That number is in the Book Now tab twice.", row: 4, what: "Made-up repeat" }]);
  assert.equal(p.store.state.todoProblems.more, 0);
  // The planner is put right; within 10 minutes the backend answers its stored list.
  fake.planner.tabs["Book Now"].pop();
  at.ms += 60 * 1000;
  const r = await p.store.syncTodos();
  assert.equal(r.stored, true);
  assert.equal(p.store.state.todoProblems.list.length, 1, "left alone");
  const forced = await p.store.syncTodos({ force: true });
  assert.equal(forced.stored, false);
  assert.deepEqual(p.store.state.todoProblems.list, [], "a real pull with none clears them");
});

test("wave A 2: syncTodos says when the backend answered with its stored list", async () => {
  const p = phone({ seed: bookSeed(2) });
  await p.store.boot();
  const first = await p.store.syncTodos({ force: true });
  assert.equal(first.stored, false);
  const again = await p.store.syncTodos({ force: true });
  assert.deepEqual([again.ok, again.stored, again.pulledAt], [true, true, first.pulledAt]);
});

test("wave A 3: a tick whose reply comes after the phone stopped waiting: one tick, one History line, one planner write, and the phone shows the tick", async () => {
  const p = phone({ seed: bookSeed(2), timeoutMs: 40 });
  await p.store.boot();
  await p.store.syncTodos();
  const release = p.net.hold("tickTodo"); // the backend finishes; its reply is late
  p.store.tickTodo("1");
  await until(() => p.store.state.notice);
  assert.equal(p.store.state.notice, "Couldn’t confirm that. Checking…");
  await p.store.idle();
  const t = byId(p.store.state.todos, "1");
  assert.deepEqual([t.tickedBy, t.done, t.status, !!t.pending], ["Mo", true, "Booked", false], "the phone shows the tick the backend has");
  release();
  // A second tap (a re-send) changes nothing on the backend.
  const ticks = () => p.fake.tables.Log.filter((r) => r.kind === "todo" && r.action === "tick").length;
  assert.equal(ticks(), 1);
  assert.equal(p.fake.planner.writes.filter((w) => w.kind === "cell").length, 1);
  assert.equal(p.store.tickTodo("1") === null || isDoneShown(p, "1"), true);
  await p.store.idle();
  assert.equal(ticks(), 1, "one History line");
  assert.equal(p.fake.planner.writes.filter((w) => w.kind === "cell").length, 1, "no second planner write");
  assert.equal(byId(p.store.state.todos, "1").tickedBy, "Mo");
});

test("wave A 3: a re-send while the first tick's reply is still out: refused as done, and the phone still ends up showing the tick", async (t) => {
  const p = phone({ seed: bookSeed(2), timeoutMs: 40 });
  await p.store.boot();
  await p.store.syncTodos();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const release = p.net.hold("tickTodo");
  p.store.tickTodo("1");
  p.store.tickTodo("1"); // a second tap, sent once the first has given up
  await new Promise(setImmediate); // let the first request reach the backend and hold its reply
  assert.equal(p.net.holds[0].used, true);
  t.mock.timers.tick(40);
  await p.store.idle();
  release();
  assert.equal(p.fake.tables.Log.filter((r) => r.kind === "todo" && r.action === "tick").length, 1);
  assert.equal(p.fake.planner.writes.filter((w) => w.kind === "cell").length, 1);
  assert.equal(p.net.sent.filter((b) => b.action === "tickTodo").length, 2);
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(byId(p.store.state.todos, "1").tickedBy, "Mo");
});

const isDoneShown = (p, id) => { const t = byId(p.store.state.todos, id); return !!t && t.done === true; };

test("wave A 5: undoing a tick says what became of the planner: put back, still to put back, or left as it was changed", async () => {
  const { changeText } = await import("../js/format.js");
  // Written, then put back: just Undone.
  const a = phone({ seed: bookSeed(2) });
  await a.store.boot();
  await a.store.syncTodos();
  const ta = a.store.tickTodo("1");
  await a.store.idle();
  await a.store.undo(ta);
  await a.store.idle();
  assert.equal(changeText(a.store.state.lastChange), "Undone.");
  // Written, then the planner refuses the put-back: pending.
  const b = phone({ seed: bookSeed(2) });
  await b.store.boot();
  await b.store.syncTodos();
  const tb = b.store.tickTodo("1");
  await b.store.idle();
  b.fake.planner.cellFails = true;
  await b.store.undo(tb);
  await b.store.idle();
  assert.equal(changeText(b.store.state.lastChange), "Undone. The planner couldn’t be changed back, so it may still say Booked.");
  // Written, then someone changed the planner's Status: kept.
  const c = phone({ seed: bookSeed(2) });
  await c.store.boot();
  await c.store.syncTodos();
  const tc = c.store.tickTodo("1");
  await c.store.idle();
  c.fake.planner.tabs["Book Now"][1][3] = "Booked (made-up ref)";
  await c.store.undo(tc);
  await c.store.idle();
  assert.equal(changeText(c.store.state.lastChange), "Undone. The planner’s Status was changed there since, so it was left as it is.");
  // Never written (the planner was down for the tick): its "kept" means nothing to do there.
  const d = phone({ seed: bookSeed(2) });
  await d.store.boot();
  await d.store.syncTodos();
  d.fake.planner.cellFails = true;
  const td = d.store.tickTodo("1");
  await d.store.idle();
  await d.store.undo(td);
  await d.store.idle();
  assert.equal(changeText(d.store.state.lastChange), "Undone.");
});

test("wave A 5: an undo from History says the same", async () => {
  const { changeText } = await import("../js/format.js");
  const p = phone({ seed: bookSeed(2) });
  await p.store.boot();
  await p.store.syncTodos();
  p.store.tickTodo("1");
  await p.store.idle();
  await p.store.loadHistory();
  const tick = p.store.state.history.entries.find((e) => e.kind === "todo" && e.action === "tick");
  p.fake.planner.cellFails = true;
  await p.store.undoEntry(tick.id);
  await p.store.idle();
  assert.equal(changeText(p.store.state.lastChange), "Undone. The planner couldn’t be changed back, so it may still say Booked.");
});

test("fix minor a: an undo whose put-back can't find the item (its # holds another one now) says nothing that promises a later put-back", async () => {
  const { changeText } = await import("../js/format.js");
  const p = phone({ seed: bookSeed(2) });
  await p.store.boot();
  await p.store.syncTodos();
  const t = p.store.tickTodo("1");
  await p.store.idle();
  p.fake.planner.tabs["Book Now"][1][1] = "Made-up other booking";
  await p.store.undo(t);
  await p.store.idle();
  const said = changeText(p.store.state.lastChange);
  assert.equal(said, "Undone. The planner couldn’t be changed back, so it may still say Booked.");
  assert.equal(/\byet\b|next|later|will/.test(said), false);
});

test("fix minor b: after a pull cut short (more), the problems carry this fetch's time and messages cut to 160 as the backend keeps them", async () => {
  const at = { ms: NOW };
  const p = phone({ seed: bookSeed(2), clock: () => at.ms });
  await p.store.boot();
  await p.store.syncTodos();
  const old = p.store.state.todosPulledAt;
  at.ms += 5 * 60 * 1000;
  const long = "Made-up reason " + "word ".repeat(60);
  p.net.override = (b) => (b.action === "syncTodos" ? { ok: true, rev: 0, data: { todos: [], pulledAt: "", more: true, problems: [{ id: "4", message: long, row: 9, what: "Made-up item" }] } } : null);
  await p.store.syncTodos({ force: true });
  const tp = p.store.state.todoProblems;
  assert.equal(p.store.state.todosPulledAt, old, "an unfinished pull keeps the last fetched time");
  assert.equal(tp.at, new Date(at.ms).toISOString(), "the problems carry this fetch's time");
  assert.ok(tp.list[0].message.length <= 160);
  assert.ok(tp.list[0].message.endsWith("…"));
  assert.equal(tp.list[0].message.includes("  "), false);
});

// ---------- security (2026-11-18): who you are, a refused key ----------

test("a phone on its own link is that person: me from the backend, kept in mat.me, and no choice", async () => {
  const fake = createFakeBackend(SEED);
  const key = fake.personKey("Ajen");
  const p = phone({ fake, storage: memStorage({ "mat.key": key, "mat.me": "Mo" }) });
  await p.store.boot();
  assert.deepEqual([p.store.state.me, p.store.state.personal], ["Ajen", true]);
  assert.equal(p.storage.getItem("mat.me"), "Ajen");
  p.store.setMe("Trenton");
  assert.equal(p.store.state.me, "Ajen", "the choice cannot be changed");
  // Offline from the saved trip, still that person.
  const again = phone({ fake, storage: p.storage });
  again.net.offline = true;
  await again.store.boot();
  assert.deepEqual([again.store.state.me, again.store.state.personal], ["Ajen", true]);
});

test("on the shared link nothing changes: personal is false and the choice is the phone's", async () => {
  const p = phone({ me: "Mo" });
  await p.store.boot();
  assert.deepEqual([p.store.state.me, p.store.state.personal], ["Mo", false]);
  p.store.setMe("Ajen");
  assert.equal(p.store.state.me, "Ajen");
});

test("a refused key takes the trip off the phone, keeps only this person's own unsent lines, and sends nothing more", async () => {
  const fake = createFakeBackend(SEED);
  const key = fake.personKey("Ajen");
  const storage = memStorage({ "mat.key": key, "mat.tab": "money", "mat.how": "1", "other.app": "x" });
  const p = phone({ fake, storage });
  await p.store.boot();
  assert.equal(p.store.state.status, "ready");
  assert.ok(storage.getItem("mat.cache"));
  // One line of Ajen's waits without signal; an older one rung up as Mo is in the queue too.
  p.net.offline = true;
  p.store.addExpense(draft({ paidBy: "Ajen", title: "Mine" }));
  await p.store.idle();
  const q = queueOf(storage);
  q.push({ expense: { ...q[0].expense, id: "exp9999999", title: "Not mine" }, addedAt: q[0].addedAt, rate: q[0].rate, addedBy: "Mo", failed: false, sent: false });
  storage.setItem("mat.queue", JSON.stringify(q));
  // The owner replaces Ajen's link; the phone comes back.
  fake.world.newLinkForPerson2();
  p.net.offline = false;
  await p.store.checkRev();
  await p.store.idle();
  const s = p.store.state;
  assert.deepEqual([s.status, s.keyRefused, s.me, s.personal, s.cleared], ["nokey", true, null, false, { kept: 1 }]);
  assert.deepEqual([s.expenses.length, s.people.length, s.days.length, s.trip], [0, 0, 0, null]);
  assert.deepEqual([...storage.map.keys()].sort(), ["mat.queue", "other.app"], "every other mat.* key is gone");
  assert.deepEqual(queueOf(storage).map((x) => x.expense.title), ["Mine"]);
  const before = p.net.sent.length;
  await p.store.checkRev();
  await p.store.flush();
  p.store.markSeen();
  assert.equal(p.net.sent.length, before, "nothing more goes out with the refused key");
  assert.deepEqual([...storage.map.keys()].sort(), ["mat.queue", "other.app"], "and nothing more is written");
  // A fresh phone on the same storage shows nothing of the trip until a link is given.
  const next = phone({ fake, storage });
  await next.store.boot();
  assert.deepEqual([next.store.state.status, next.store.state.expenses.length], ["nokey", 0]);
});

test("an old phone's queued line, after its key was replaced, goes out on the new link as that person", async () => {
  const fake = createFakeBackend(SEED);
  const oldKey = fake.personKey("Ajen");
  const storage = memStorage({ "mat.key": oldKey });
  const p = phone({ fake, storage });
  await p.store.boot();
  p.net.offline = true;
  p.store.addExpense(draft({ paidBy: "Ajen", title: "Kept line" }));
  await p.store.idle();
  fake.world.newLinkForPerson2();
  const fresh = /#k=([0-9a-f]{64})$/.exec(fake.logged.find((l) => l.startsWith("Ajen’s link")))[1];
  p.net.offline = false;
  await p.store.checkRev();
  await p.store.idle();
  assert.equal(p.store.state.status, "nokey");
  storage.setItem("mat.key", fresh); // the new link opened (first.js onKey keeps it and boots)
  await p.store.boot();
  await p.store.idle();
  assert.equal(p.store.state.status, "ready");
  const line = fake.tables.Expenses.find((e) => e.title === "Kept line");
  assert.ok(line, "sent once the new link opened");
  assert.equal(line.added_by, "Ajen");
  assert.deepEqual(queueOf(storage), []);
});

test("a network failure or busy never takes the trip off", async () => {
  const p = phone();
  await p.store.boot();
  p.net.offline = true;
  await p.store.checkRev();
  p.net.offline = false;
  p.net.override = (b) => (b.action === "rev" ? { ok: false, error: "busy", message: "busy" } : null);
  await p.store.checkRev();
  assert.equal(p.store.state.status, "ready");
  assert.ok(p.storage.getItem("mat.cache"));
  assert.ok(p.storage.getItem("mat.key"));
});

test("forgot() clears everything, keeps no queue, and shows the plain no-key screen", async () => {
  const p = phone();
  await p.store.boot();
  p.net.offline = true;
  p.store.addExpense(draft());
  await p.store.idle();
  p.store.forgot();
  assert.deepEqual([p.store.state.status, p.store.state.keyRefused, p.store.state.cleared, p.store.state.expenses.length], ["nokey", false, null, 0]);
  assert.deepEqual([...p.storage.map.keys()], []);
});

test("a wrong key on an empty phone says nothing was taken off", async () => {
  const p = phone({ storage: memStorage({ "mat.key": "wrong-key-123" }) });
  await p.store.boot();
  assert.deepEqual([p.store.state.status, p.store.state.keyRefused, p.store.state.cleared], ["nokey", true, null]);
});

// ---------- security fix round 1: a key in the address, refusals in a row, late replies ----------

// A phone whose stored key is `stored`, opened from an address carrying `candidate`.
async function opened(fake, stored, candidate, extra = {}) {
  const storage = memStorage({ "mat.key": stored, ...extra });
  const p = phone({ fake, storage });
  await p.store.boot();
  await p.store.idle();
  const before = p.net.sent.length;
  await p.store.boot({ candidate });
  await p.store.idle();
  return { ...p, before };
}

test("C1: a phone on its own link opened from the shared link (accepted) stays on its own link; the stored key is unchanged", async () => {
  const fake = createFakeBackend(SEED);
  const mine = fake.personKey("Ajen");
  const p = await opened(fake, mine, KEY);
  assert.equal(p.storage.getItem("mat.key"), mine);
  assert.deepEqual([p.store.state.status, p.store.state.personal, p.store.state.me], ["ready", true, "Ajen"]);
  assert.ok(p.storage.getItem("mat.cache"));
});

test("C1: a phone on its own link opened from a retired or made-up link: no wipe, still its own link, and it says the link didn't work", async () => {
  for (const make of [(fake) => { for (const n of ["Mo", "Trenton"]) fake.personKey(n); fake.world.retireSharedLink(); return KEY; }, () => "made-up-key-123"]) {
    const fake = createFakeBackend(SEED);
    const mine = fake.personKey("Ajen");
    const storage = memStorage({ "mat.key": mine });
    const p = phone({ fake, storage });
    await p.store.boot();
    const candidate = make(fake);
    await p.store.boot({ candidate });
    await p.store.idle();
    assert.equal(storage.getItem("mat.key"), mine);
    assert.deepEqual([p.store.state.status, p.store.state.personal, p.store.state.me, p.store.state.keyRefused], ["ready", true, "Ajen", false]);
    assert.ok(storage.getItem("mat.cache"), "nothing was wiped");
    assert.equal(p.store.state.notice, "That link didn’t work. This phone stays on the link it already had.");
  }
});

test("C1: a phone on the shared link opened from its own person's link switches to it", async () => {
  const fake = createFakeBackend(SEED);
  const mine = fake.personKey("Trenton");
  const p = await opened(fake, KEY, mine, { "mat.me": "Mo" });
  assert.equal(p.storage.getItem("mat.key"), mine);
  assert.deepEqual([p.store.state.personal, p.store.state.me], [true, "Trenton"]);
});

test("C1: a personal link opened on a phone already on a personal link replaces it (the newer link this phone was given)", async () => {
  const fake = createFakeBackend(SEED);
  const mine = fake.personKey("Ajen");
  const theirs = fake.personKey("Mo");
  const p = await opened(fake, mine, theirs);
  // A personal link replaces the stored one: it is the newer link this person was sent.
  assert.equal(p.storage.getItem("mat.key"), theirs);
  assert.equal(p.store.state.me, "Mo");
});

test("C1: the address key offline is not stored and the phone carries on with its own", async () => {
  const fake = createFakeBackend(SEED);
  const mine = fake.personKey("Ajen");
  const storage = memStorage({ "mat.key": mine });
  const p = phone({ fake, storage });
  await p.store.boot();
  p.net.offline = true;
  await p.store.boot({ candidate: KEY });
  assert.equal(storage.getItem("mat.key"), mine);
  assert.equal(p.store.state.status, "ready");
});

test("C2: the unsent line a refusal kept survives a second refusal (and any number), until a key is accepted", async () => {
  const fake = createFakeBackend(SEED);
  const storage = memStorage({ "mat.key": KEY, "mat.me": "Mo" });
  const p = phone({ fake, storage });
  await p.store.boot();
  p.net.offline = true;
  p.store.addExpense(draft({ title: "Kept" }));
  await p.store.idle();
  for (const n of ["Mo", "Ajen", "Trenton"]) fake.personKey(n);
  fake.world.retireSharedLink();
  p.net.offline = false;
  await p.store.checkRev();
  assert.deepEqual(p.store.state.cleared, { kept: 1 });
  for (let i = 0; i < 3; i++) {
    storage.setItem("mat.key", KEY); // the old link opened again
    const again = phone({ fake, storage });
    await again.store.boot();
    assert.equal(again.store.state.status, "nokey");
    assert.deepEqual(queueOf(storage).map((q) => q.expense.title), ["Kept"], "refusal " + (i + 2));
    assert.deepEqual(again.store.state.cleared, { kept: 1 });
  }
});

test("I1: a reply already on its way when the trip is taken off is dropped, never drawn", async () => {
  const fake = createFakeBackend(SEED);
  const mine = fake.personKey("Ajen");
  const p = phone({ fake, storage: memStorage({ "mat.key": mine }) });
  await p.store.boot();
  const release = p.net.hold("load");
  const loading = p.store.refresh();
  await until(() => p.net.sent.filter((b) => b.action === "load").length === 2);
  fake.world.cancelLinkForPerson2();
  await p.store.checkRev(); // a quicker rev is refused: the trip comes off
  assert.equal(p.store.state.status, "nokey");
  release();
  await loading;
  await p.store.idle();
  assert.deepEqual([p.store.state.status, p.store.state.expenses.length, p.store.state.people.length], ["nokey", 0, 0]);
});

test("I1: a load in flight at Forget this phone is dropped too", async () => {
  const p = phone();
  await p.store.boot();
  const release = p.net.hold("load");
  const loading = p.store.refresh();
  await until(() => p.net.sent.filter((b) => b.action === "load").length === 2);
  p.store.forgot();
  release();
  await loading;
  assert.deepEqual([p.store.state.status, p.store.state.expenses.length, p.store.state.keyRefused], ["nokey", 0, false]);
  assert.deepEqual([...p.storage.map.keys()], []);
});

test("unsentCount: what Forget this phone would lose", async () => {
  const p = phone();
  await p.store.boot();
  assert.equal(p.store.unsentCount(), 0);
  p.net.offline = true;
  p.store.addExpense(draft({ title: "a" }));
  p.store.addExpense(draft({ title: "b" }));
  await p.store.idle();
  assert.equal(p.store.unsentCount(), 2);
});

test("I3: a broken PERSON_KEYS (the plain server sentence) never takes the trip off a phone", async () => {
  const fake = createFakeBackend(SEED);
  const mine = fake.personKey("Ajen");
  const storage = memStorage({ "mat.key": mine });
  const p = phone({ fake, storage });
  await p.store.boot();
  fake.props.PERSON_KEYS = "{broken";
  await p.store.checkRev();
  await p.store.refresh();
  await p.store.idle();
  assert.deepEqual([p.store.state.status, p.store.state.keyRefused, p.store.state.me], ["ready", false, "Ajen"]);
  assert.equal(storage.getItem("mat.key"), mine);
  assert.ok(storage.getItem("mat.cache"));
});

test("round 2: an address key that is taken becomes the saved trip at once, so a failed next load can't let the shared link replace it", async () => {
  const fake = createFakeBackend(SEED);
  const mine = fake.personKey("Trenton");
  const storage = memStorage({ "mat.key": KEY, "mat.me": "Mo" });
  const p = phone({ fake, storage });
  await p.store.boot();
  // Opened from Trenton's own link: the try (a load with that key) answers;
  // the load after it fails.
  let withMine = 0;
  p.net.override = (b) => (b.action === "load" && b.key === mine && ++withMine > 1 ? { ok: false, error: "server", message: "x" } : null);
  const boot = p.store.boot({ candidate: mine });
  await boot;
  await p.store.idle();
  assert.equal(storage.getItem("mat.key"), mine);
  assert.equal(JSON.parse(storage.getItem("mat.cache")).data.personal, true, "the saved trip says personal at once");
  assert.deepEqual([p.store.state.personal, p.store.state.me], [true, "Trenton"]);
  // Opened again from the old shared link: the personal key stays.
  p.net.override = null;
  const again = phone({ fake, storage });
  await again.store.boot({ candidate: KEY });
  await again.store.idle();
  assert.equal(storage.getItem("mat.key"), mine);
  assert.equal(again.store.state.me, "Trenton");
});

// ---------- a stay's booking (S2 鍵札): saveStay, addStay, a picture on a stay ----------

const INN = { id: "stayINN00001", name: "Tsubame-so Guest House", nameJp: "つばめ荘", addressJp: "東京都台東区 つばめ町 1-2-3", firstNight: "2026-12-10", lastNight: "2026-12-12" };
const stayOf = (store, id) => byId(store.state.stays, id);

test("saveStay sends merge: true and only the patch; shown at once, saved, on the bar once saved", async () => {
  const p = phone({ seed: { stays: [INN] } });
  await p.store.boot();
  // Someone typed a note in the Sheet since this phone loaded: it is kept.
  p.fake.tables.Stays.find((r) => r.id === INN.id).note = "typed in the Sheet";
  const t = p.store.saveStay(INN.id, { tkRef: "TSB-4827-KQ", tkRoom: "Tatami room for 3" }, QUIET);
  assert.equal(stayOf(p.store, INN.id).tkRef, "TSB-4827-KQ", "shown at once");
  const out = await p.store.outcome(t);
  await p.store.idle();
  assert.equal(out.saved, true);
  const body = p.net.sent.find((b) => b.action === "saveStay");
  assert.deepEqual(body.args, { stay: { id: INN.id, tkRef: "TSB-4827-KQ", tkRoom: "Tatami room for 3" }, merge: true });
  const row = p.fake.tables.Stays.find((r) => r.id === INN.id);
  assert.deepEqual([row.tk_ref, row.tk_room, row.note, row.name], ["TSB-4827-KQ", "Tatami room for 3", "typed in the Sheet", INN.name]);
  assert.deepEqual([p.store.state.lastChange.kind, p.store.state.lastChange.action], ["stay", "edit"]);
  assert.deepEqual(queueOf(p.storage), []);
});

test("saveStay is not queued with no signal: rolled back, said not sent; nothing in mat.queue", async () => {
  const p = phone({ seed: { stays: [INN] } });
  await p.store.boot();
  p.net.knownOffline = true;
  const out = await p.store.outcome(p.store.saveStay(INN.id, { tkRef: "TSB-4827-KQ" }, QUIET));
  await p.store.idle();
  assert.deepEqual(out, { saved: false, reason: "notSent" });
  assert.equal(stayOf(p.store, INN.id).tkRef, "");
  assert.deepEqual(queueOf(p.storage), []);
  assert.equal(p.net.sent.filter((b) => b.action === "saveStay").length, 0);
});

test("saveStay refused by the backend rolls back with its sentence", async () => {
  const p = phone({ seed: { stays: [INN] } });
  await p.store.boot();
  const out = await p.store.outcome(p.store.saveStay(INN.id, { tkRef: "x".repeat(61) }, QUIET));
  await p.store.idle();
  assert.deepEqual(out, { saved: false, reason: "refused", message: "Keep each booking detail under 60 letters." });
  assert.equal(stayOf(p.store, INN.id).tkRef, "");
});

test("saveStay with no reply: unsure, then the truth from the next load", async () => {
  const p = phone({ seed: { stays: [INN] } });
  await p.store.boot();
  p.net.lose.add("saveStay");
  let unsure = false;
  const out = await p.store.outcome(p.store.saveStay(INN.id, { tkName: "M. EXAMPLE" }, { ...QUIET, onUnsure: () => { unsure = true; } }));
  await p.store.idle();
  assert.equal(unsure, true);
  assert.equal(out.saved, true, "it did land");
  assert.equal(stayOf(p.store, INN.id).tkName, "M. EXAMPLE");
});

test("addStay adds a bare stay through saveStay { stay }; refused, it is gone", async () => {
  const p = phone({ seed: {} });
  await p.store.boot();
  const t = p.store.addStay({ name: "Lakeside Airport Inn", firstNight: "2026-12-10", lastNight: "2026-12-10" }, { ...QUIET, id: "stayNEW00001" });
  assert.equal(stayOf(p.store, "stayNEW00001").pending, true);
  const out = await p.store.outcome(t);
  await p.store.idle();
  assert.equal(out.saved, true);
  assert.deepEqual(p.net.sent.find((b) => b.action === "saveStay").args, { stay: { name: "Lakeside Airport Inn", firstNight: "2026-12-10", lastNight: "2026-12-10", id: "stayNEW00001" } });
  assert.equal(p.fake.tables.Stays.length, 1);
  const bad = await p.store.outcome(p.store.addStay({ name: "", firstNight: "2026-12-10", lastNight: "2026-12-10" }, { ...QUIET, id: "stayNEW00002" }));
  await p.store.idle();
  assert.equal(bad.saved, false);
  assert.equal(stayOf(p.store, "stayNEW00002"), undefined);
});

test("a stay's picture waits on the phone with its stay, survives mat.queue and a reload, and goes up on the stay", async () => {
  const kept = new Map();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");
  const p = phone({ seed: { stays: [INN] }, ticketData: async (id) => kept.get(id) || null });
  await p.store.boot();
  p.net.knownOffline = true;
  const token = p.store.addTicket({ stay: INN.id, who: "", seat: "", page: 1, mime: "image/png", w: 10, h: 10, data: png });
  const id = p.store.state.tickets[0].id;
  kept.set(id, png);
  assert.equal(p.store.state.tickets[0].stay, INN.id);
  assert.equal(p.store.state.tickets[0].stop, "");
  const out = await p.store.ticketOutcome(token);
  assert.equal(out.reason, "queued");
  const q = queueOf(p.storage);
  assert.equal(q[0].ticket.stay, INN.id);
  assert.equal(q[0].ticket.stop, "");
  assert.equal(JSON.stringify(q).includes(png), false);
  // Closed and opened again, with signal: sent with its stay.
  const again = phone({ fake: p.fake, storage: p.storage, ticketData: async (i) => kept.get(i) || null });
  await again.store.boot();
  assert.equal(again.store.state.tickets.find((t) => t.id === id).stay, INN.id, "the reloaded queue still says its stay");
  await again.store.idle();
  const row = again.fake.tables.Tickets.find((r) => r.id === id);
  assert.deepEqual([row.stay, row.stop], [INN.id, ""]);
  assert.deepEqual(queueOf(again.storage), []);
});

// ---------- the eve kept apart from the days (Dec 9 brief) ----------

const DEC9 = require("./fixtures/dec9.json");

test("derive keeps the eve apart: state.eves, in order; state.days the rest; the cache as loaded", async () => {
  const p = phone({ seed: DEC9 });
  assert.deepEqual(p.store.state.eves, [], "eves starts empty");
  await p.store.boot();
  const s = p.store.state;
  assert.deepEqual(s.eves.map((d) => [d.date, d.kind, d.tz]), [["2026-12-08", "eve", "America/New_York"]]);
  assert.equal(s.days.length, 12, "Dec 9 to 20");
  assert.deepEqual([s.days[0].date, s.days[0].tz, s.days[0].kind], ["2026-12-09", "America/New_York", ""]);
  assert.ok(s.days.every((d) => d.kind !== "eve"));
  const cache = JSON.parse(p.storage.getItem("mat.cache"));
  assert.deepEqual(cache.data.days.map((d) => d.date).slice(0, 3), ["2026-12-08", "2026-12-09", "2026-12-10"], "the cache keeps every row as loaded");
  assert.equal(cache.data.days.length, 13);
  assert.equal("eves" in cache.data, false);
  // A phone that boots from that cache with no signal splits it the same way.
  const q = phone({ fake: p.fake, storage: p.storage });
  q.net.offline = true;
  await q.store.boot();
  assert.deepEqual([q.store.state.eves.length, q.store.state.days.length, q.store.state.days[0].date], [1, 12, "2026-12-09"]);
});

test("a trip with no eve has eves [] and its days as loaded", async () => {
  const p = phone({ seed: SEED });
  await p.store.boot();
  assert.deepEqual(p.store.state.eves, []);
  assert.equal(p.store.state.days.length, 11);
});

test("the eve is emptied with the days when the trip comes off the phone", async () => {
  const p = phone({ seed: DEC9 });
  await p.store.boot();
  assert.equal(p.store.state.eves.length, 1);
  p.store.forgot();
  assert.deepEqual([p.store.state.status, p.store.state.eves, p.store.state.days], ["nokey", [], []]);
});
