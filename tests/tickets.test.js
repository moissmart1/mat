/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// js/tickets.js (the limits, what a file is, shrinking a picture, the
// IndexedDB keep, fetching what this phone lacks) and the store's ticket
// writes. Pictures are made up here: a signature and some bytes. The canvas
// and IndexedDB are small fakes.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { LIMITS, sniff, shrink, createKeep, keptOrLate, readKept, fetchMissing, toBase64, fromBase64, ticketKinds, ticketMark, whoseOf, sameName, fetchMode, setFetchMode, fetchesAll, pruneKeep, fetchOrder } from "../js/tickets.js";
import { createApi } from "../js/api.js";
import { createStore } from "../js/store.js";
import { changeText } from "../js/format.js";

const require = createRequire(import.meta.url);
const { createFakeBackend } = require("./fake-backend.cjs");
const P = require("../backend/Pure.js");
const PLAN = require("./fixtures/plan.json");

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG = [0xff, 0xd8, 0xff, 0xe0];
const bytes = (head, n) => {
  const b = new Uint8Array(n);
  b.set(head);
  return b;
};
const blobOf = (head, n, type = "") => new Blob([bytes(head, n)], { type });

// ---------- the limits are the backend's ----------

test("the phone's limits are the backend's", () => {
  assert.deepEqual(LIMITS, P.TICKET_LIMITS);
});

// ---------- what a file is ----------

test("sniff reads the first bytes, never the name or the type the phone gives", async () => {
  assert.equal(await sniff(blobOf(PNG, 20, "image/jpeg")), "image/png");
  assert.equal(await sniff(blobOf(JPG, 20, "")), "image/jpeg");
  assert.equal(await sniff(new Blob(["%PDF-1.7\n..."])), "application/pdf");
  assert.equal(await sniff(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: "image/png" })), null);
  assert.equal(await sniff(new Blob(["GIF89a"])), null);
  assert.equal(await sniff(new Blob([])), null);
});

// ---------- shrinking ----------

// A fake canvas world: decode gives the picture's size; encode makes a blob
// whose size the test controls (size(w, h, mime, quality) in bytes).
function canvasWorld(size) {
  const log = [];
  return {
    log,
    deps: {
      decode: async (blob) => ({ width: blob.w || 3000, height: blob.h || 2000, source: "pic" }),
      makeCanvas: (w, h) => ({ width: w, height: h, getContext: () => ({ fillRect() {}, drawImage(src, x, y, dw, dh) { log.push(["draw", dw, dh]); }, set fillStyle(v) {} }) }),
      encode: async (canvas, mime, q) => {
        log.push(["encode", mime, q, canvas.width, canvas.height]);
        return blobOf(mime === "image/png" ? PNG : JPG, size(canvas.width, canvas.height, mime, q), mime);
      },
    },
  };
}
const file = (head, w, h) => Object.assign(blobOf(head, 64), { w, h });

test("shrink: at most 1,500 on the longer side, never larger than it was, JPEG at 0.9", async () => {
  const w = canvasWorld(() => 50000);
  const big = await shrink(file(JPG, 3000, 2000), w.deps);
  assert.deepEqual([big.mime, big.w, big.h], ["image/jpeg", 1500, 1000]);
  assert.equal(big.data, toBase64Sync(await big.blob.arrayBuffer()));
  assert.deepEqual(w.log.find((l) => l[0] === "encode"), ["encode", "image/jpeg", 0.9, 1500, 1000]);
  const small = await shrink(file(JPG, 800, 600), w.deps);
  assert.deepEqual([small.w, small.h], [800, 600]);
  const tall = await shrink(file(JPG, 1179, 2556), w.deps);
  assert.deepEqual([tall.w, tall.h], [692, 1500]);
});

test("shrink: a PNG stays a PNG only when that is smaller than the JPEG", async () => {
  const smallerPng = canvasWorld((cw, ch, mime) => (mime === "image/png" ? 9000 : 30000));
  assert.equal((await shrink(file(PNG, 600, 600), smallerPng.deps)).mime, "image/png");
  const smallerJpg = canvasWorld((cw, ch, mime) => (mime === "image/png" ? 90000 : 30000));
  assert.equal((await shrink(file(PNG, 600, 600), smallerJpg.deps)).mime, "image/jpeg");
  // A JPEG is never tried as a PNG.
  const w = canvasWorld(() => 30000);
  await shrink(file(JPG, 600, 600), w.deps);
  assert.equal(w.log.some((l) => l[1] === "image/png"), false);
});

test("shrink: too big at first, it tries lower quality, then smaller, until it fits", async () => {
  // 450,000 characters is 337,500 bytes.
  const w = canvasWorld((cw, ch, mime, q) => Math.round(cw * ch * q * 0.4));
  const r = await shrink(file(JPG, 3000, 2000), w.deps);
  assert.ok(r.data.length <= LIMITS.maxChars, String(r.data.length));
  assert.ok(r.w <= 1500 && r.h <= 1000);
  const tries = w.log.filter((l) => l[0] === "encode");
  assert.ok(tries.length > 1);
  // Never past a sensible floor: a picture that cannot fit says so.
  const never = canvasWorld(() => 400000);
  await assert.rejects(shrink(file(JPG, 3000, 2000), never.deps), /too big/);
});

test("shrink refuses an SVG or anything else that is not a JPEG or PNG, with a sentence", async () => {
  const w = canvasWorld(() => 1000);
  await assert.rejects(shrink(new Blob(["<svg/>"], { type: "image/svg+xml" }), w.deps), /photo, a screenshot or a PDF/);
  await assert.rejects(shrink(new Blob(["GIF89a......"]), w.deps), /photo, a screenshot or a PDF/);
  assert.equal(w.log.length, 0);
});

// ---------- base64 ----------

function toBase64Sync(buf) {
  return Buffer.from(buf).toString("base64");
}

test("toBase64 and fromBase64 carry the bytes both ways, and fromBase64 checks the signature against the type", async () => {
  const b = bytes(PNG, 70000);
  b[69999] = 5;
  const s = await toBase64(new Blob([b]));
  assert.equal(s, toBase64Sync(b));
  const back = fromBase64(s, "image/png");
  assert.equal(back.type, "image/png");
  assert.deepEqual(new Uint8Array(await back.arrayBuffer()), b);
  assert.equal(fromBase64(s, "image/jpeg"), null);
  assert.equal(fromBase64("!!!", "image/png"), null);
  assert.equal(fromBase64(Buffer.from("<svg/>").toString("base64"), "image/svg+xml"), null);
});

// ---------- the keep (IndexedDB) ----------

// Enough of IndexedDB for js/tickets.js: one database, one object store.
function fakeIndexedDB({ fails = false, fullAfter = Infinity, hangs = false } = {}) {
  const data = new Map();
  const req = (run) => {
    const r = { result: undefined, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      try {
        r.result = run();
        if (r.onsuccess) r.onsuccess({ target: r });
      } catch (e) {
        r.error = e;
        if (r.onerror) r.onerror({ target: r });
      }
    });
    return r;
  };
  const tx = () => {
    const t = { oncomplete: null, onerror: null, onabort: null, error: null };
    const done = () => queueMicrotask(() => queueMicrotask(() => t.oncomplete && t.oncomplete()));
    t.objectStore = () => ({
      get: (k) => { done(); return req(() => data.get(k)); },
      put: (v, k) => {
        if (data.size >= fullAfter) {
          queueMicrotask(() => { t.error = new Error("QuotaExceededError"); if (t.onabort) t.onabort(); });
          return req(() => { throw new Error("QuotaExceededError"); });
        }
        done();
        return req(() => { data.set(k, v); return k; });
      },
      delete: (k) => { done(); return req(() => { data.delete(k); }); },
      getAllKeys: () => { done(); return req(() => [...data.keys()]); },
    });
    return t;
  };
  const db = { objectStoreNames: { contains: () => true }, createObjectStore() {}, transaction: tx, close() { this.closed++; }, closed: 0, onversionchange: null };
  return {
    data,
    db,
    opens: 0,
    exists: false,
    deleted: 0,
    deleteDatabase() {
      const r = { onsuccess: null, onerror: null, onblocked: null };
      this.deleted++;
      this.exists = false;
      data.clear();
      queueMicrotask(() => r.onsuccess && r.onsuccess());
      return r;
    },
    open() {
      this.opens++;
      this.exists = true;
      const r = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      if (hangs) return r; // a known WebKit fault: never success, error or blocked
      queueMicrotask(() => {
        if (fails) {
          r.error = new Error("SecurityError");
          if (r.onerror) r.onerror({ target: r });
          return;
        }
        if (r.onupgradeneeded) r.onupgradeneeded({ target: r });
        if (r.onsuccess) r.onsuccess({ target: r });
      });
      return r;
    },
  };
}

test("the keep: put, have, get, drop; what was kept before is known at start", async () => {
  const idb = fakeIndexedDB();
  const keep = createKeep({ indexedDB: idb });
  await keep.ready;
  assert.equal(keep.lasting, true);
  assert.equal(keep.have("a"), false);
  const seen = [];
  keep.subscribe(() => seen.push(1));
  assert.equal(await keep.put("a", blobOf(PNG, 10, "image/png")), true);
  assert.equal(keep.have("a"), true);
  assert.equal((await keep.get("a")).size, 10);
  assert.equal(seen.length, 1);
  const again = createKeep({ indexedDB: idb });
  // A view drawn before the keep has read what it holds is told once it has.
  let told = 0;
  again.subscribe(() => told++);
  assert.equal(again.have("a"), false);
  await again.ready;
  assert.equal(again.have("a"), true);
  assert.equal(told, 1);
  await again.drop("a");
  assert.equal(again.have("a"), false);
  assert.equal(await again.get("a"), null);
});

test("the keep with no IndexedDB (private mode, blocked): kept in memory for this visit, never thrown", async () => {
  const keep = createKeep({ indexedDB: fakeIndexedDB({ fails: true }) });
  await keep.ready;
  assert.equal(keep.lasting, false);
  assert.equal(await keep.put("a", blobOf(PNG, 10)), true);
  assert.equal(keep.have("a"), true);
  const none = createKeep({ indexedDB: undefined });
  await none.ready;
  assert.equal(none.lasting, false);
  assert.equal(await none.get("zz"), null);
});

test("the keep when the phone is full: put says false, nothing is thrown", async () => {
  const keep = createKeep({ indexedDB: fakeIndexedDB({ fullAfter: 0 }) });
  await keep.ready;
  assert.equal(await keep.put("a", blobOf(PNG, 10)), false);
  assert.equal(keep.have("a"), false);
});

// ---------- fetching what this phone lacks ----------

function fakeStore({ tickets, stops, online = true, busy = () => false, answer }) {
  const calls = { now: 0, max: 0, ids: [] };
  const store = {
    state: { ticketsReady: true, online, tickets, stops, trip: { tz: "Asia/Tokyo" } },
    busy,
    async fetchTicket(id) {
      calls.now++;
      calls.max = Math.max(calls.max, calls.now);
      calls.ids.push(id);
      await new Promise((r) => setTimeout(r, 2));
      calls.now--;
      return answer(id);
    },
  };
  return { store, calls };
}
const pngData = Buffer.from(bytes(PNG, 40)).toString("base64");
const T = (id, stop, extra = {}) => ({ id, stop, who: "", seat: "", page: 1, mime: "image/png", w: 10, h: 10, size: pngData.length, chunks: 1, by: "Mo", at: "", ...extra });
const STOPS = [
  { id: "past0001", date: "2026-12-10", time: "09:00" },
  { id: "soon0001", date: "2026-12-12", time: "15:00" },
  { id: "late0001", date: "2026-12-14", time: "08:00" },
  { id: "soon0002", date: "2026-12-12", time: "10:00" },
];
const NOW12 = Date.parse("2026-12-12T09:00:00+09:00");

test("fetchMissing: one at a time, never two in flight, upcoming stops first (soonest first), then past ones", async () => {
  const keep = createKeep({ indexedDB: fakeIndexedDB() });
  await keep.ready;
  const { store, calls } = fakeStore({
    tickets: [T("t1", "past0001"), T("t2", "late0001"), T("t3", "soon0001"), T("t4", "soon0002"), T("t5", "soon0001", { pending: true })],
    stops: STOPS,
    answer: (id) => ({ id, mime: "image/png", data: pngData }),
  });
  const a = fetchMissing(store, keep, { now: () => NOW12 });
  const b = fetchMissing(store, keep, { now: () => NOW12 });
  assert.equal(a, b, "a second call joins the first");
  await a;
  assert.equal(calls.max, 1);
  assert.deepEqual(calls.ids, ["t4", "t3", "t2", "t1"]);
  assert.equal(keep.have("t1") && keep.have("t4"), true);
  assert.equal(keep.have("t5"), false, "an unsent one of this phone's own is not asked for");
  // Nothing more to fetch: no request.
  await fetchMissing(store, keep, { now: () => NOW12 });
  assert.equal(calls.ids.length, 4);
});

test("fetchMissing stops when the signal goes, and does not start without it or while the store is saving", async () => {
  const keep = createKeep({ indexedDB: fakeIndexedDB() });
  await keep.ready;
  let n = 0;
  const { store, calls } = fakeStore({
    tickets: [T("t1", "soon0001"), T("t2", "soon0001"), T("t3", "soon0001")],
    stops: STOPS,
    answer: (id) => {
      if (++n === 2) {
        store.state.online = false;
        const e = new Error("Couldn’t reach the trip sheet.");
        e.code = "network";
        throw e;
      }
      return { id, mime: "image/png", data: pngData };
    },
  });
  await fetchMissing(store, keep, { now: () => NOW12 });
  assert.equal(calls.ids.length, 2);
  assert.equal(keep.have("t1"), true);
  await fetchMissing(store, keep, { now: () => NOW12 });
  assert.equal(calls.ids.length, 2, "offline: not tried");
  store.state.online = true;
  let saving = true;
  store.busy = () => saving;
  await fetchMissing(store, keep, { now: () => NOW12 });
  assert.equal(calls.ids.length, 2, "busy: not tried");
  saving = false;
  await fetchMissing(store, keep, { now: () => NOW12 });
  assert.deepEqual(calls.ids.slice(2), ["t2", "t3"]);
});

test("fetchMissing keeps nothing whose bytes are not what its type says, and tries the rest", async () => {
  const keep = createKeep({ indexedDB: fakeIndexedDB() });
  await keep.ready;
  const { store } = fakeStore({
    tickets: [T("t1", "soon0002"), T("t2", "soon0001")],
    stops: STOPS,
    answer: (id) => (id === "t1" ? { id, mime: "image/png", data: Buffer.from("<svg/>").toString("base64") } : { id, mime: "image/png", data: pngData }),
  });
  await fetchMissing(store, keep, { now: () => NOW12 });
  assert.equal(keep.have("t1"), false);
  assert.equal(keep.have("t2"), true);
  // The broken one is not asked for again at once (every redraw would), only after a while.
  const asked = [];
  const real = store.fetchTicket;
  store.fetchTicket = (id) => { asked.push(id); return real(id); };
  await fetchMissing(store, keep, { now: () => NOW12 + 1000 });
  assert.deepEqual(asked, []);
  await fetchMissing(store, keep, { now: () => NOW12 + 11 * 60 * 1000 });
  assert.deepEqual(asked, ["t1"]);
});

test("fetchMissing does nothing before migrate, or when nothing lasts (private mode): the stub fetches on its own then", async () => {
  const keep = createKeep({ indexedDB: fakeIndexedDB() });
  await keep.ready;
  const { store, calls } = fakeStore({ tickets: [T("t1", "soon0001")], stops: STOPS, answer: (id) => ({ id, mime: "image/png", data: pngData }) });
  store.state.ticketsReady = false;
  await fetchMissing(store, keep, { now: () => NOW12 });
  assert.equal(calls.ids.length, 0);
  store.state.ticketsReady = true;
  const brief = createKeep({ indexedDB: undefined });
  await brief.ready;
  await fetchMissing(store, brief, { now: () => NOW12 });
  assert.equal(calls.ids.length, 0);
});

// ---------- what a stop's tickets look like ----------

test("ticketKinds and ticketMark: per-person codes, one code, pages, reference only, or nothing", () => {
  const people = ["Mo", "Ajen", "Trenton"];
  const has = () => true;
  const none = () => false;
  assert.equal(ticketMark({ id: "s" }, [], has), null, "no facts and no pictures: nothing");
  assert.deepEqual(ticketMark({ id: "s", tkRef: "R1" }, [], has), { kind: "ref", label: "Reference", saved: true });
  const three = people.map((who, i) => T("p" + i, "s", { who }));
  assert.deepEqual(ticketMark({ id: "s" }, three, has), { kind: "pp", label: "3 codes", saved: true });
  assert.deepEqual(ticketMark({ id: "s" }, three, (id) => id !== "p1"), { kind: "pp", label: "3 codes", saved: false });
  assert.deepEqual(ticketMark({ id: "s" }, [T("o", "s")], none), { kind: "one", label: "1 code", saved: false });
  assert.deepEqual(ticketMark({ id: "s" }, [T("a", "s", { page: 1 }), T("b", "s", { page: 2 })], has), { kind: "pages", label: "2 pages", saved: true });
  assert.equal(ticketKinds([T("a", "s", { gone: true })]).kind, null);
  // Only this stop's, and never a removed one.
  assert.equal(ticketMark({ id: "s" }, [T("x", "other")], has), null);
});

test("whoseOf: mine (my first picture's seat by page, else the stop's, else none), all, none, ref; holders in trip order", () => {
  const people = ["Mo", "Ajen", "Trenton"];
  const stop = { id: "s", tkSeat: "Car 7 · 10A–C" };
  // Per-person, one mine: my first page's seat.
  const pp = [T("t", "s", { who: "Trenton", seat: "Car 7 · 10C" }), T("a2", "s", { who: "Ajen", seat: "Car 9 · 1A", page: 2 }), T("a1", "s", { who: "Ajen", seat: "Car 7 · 10B", page: 1 }), T("m", "s", { who: "Mo", seat: "Car 7 · 10A" })];
  assert.deepEqual(whoseOf(stop, pp, "Ajen", people), { kind: "mine", seat: "Car 7 · 10B", holders: ["Mo", "Ajen", "Trenton"], count: 3 });
  // My picture has no seat: the stop's; neither: "".
  const noSeat = [T("a", "s", { who: "Ajen" }), T("m", "s", { who: "Mo", seat: "Car 7 · 10A" })];
  assert.equal(whoseOf(stop, noSeat, "Ajen", people).seat, "Car 7 · 10A–C");
  assert.equal(whoseOf({ id: "s" }, noSeat, "Ajen", people).seat, "");
  assert.equal(whoseOf({ id: "s", tkSeat: "  " }, noSeat, "Ajen", people).seat, "");
  // Per-person, none mine, one for everyone: all, with the stop's seat.
  const withAll = [T("m", "s", { who: "Mo" }), T("e", "s", { who: "" })];
  assert.deepEqual(whoseOf(stop, withAll, "Ajen", people), { kind: "all", seat: "Car 7 · 10A–C", holders: ["Mo"], count: 1 });
  // Per-person, none mine, none for everyone: none, no seat.
  const others = [T("t", "s", { who: "Trenton" }), T("m", "s", { who: "Mo" })];
  assert.deepEqual(whoseOf(stop, others, "Ajen", people), { kind: "none", seat: "", holders: ["Mo", "Trenton"], count: 2 });
  // One code, or pages: all of us.
  assert.deepEqual(whoseOf(stop, [T("o", "s")], "Ajen", people), { kind: "all", seat: "Car 7 · 10A–C", holders: [], count: 0 });
  assert.equal(whoseOf(stop, [T("p1", "s", { page: 1 }), T("p2", "s", { page: 2 })], "Ajen", people).kind, "all");
  // Facts only: ref; nothing at all: null.
  assert.deepEqual(whoseOf({ id: "s", tkRef: "TEST-1", tkSeat: "Table 4" }, [], "Ajen", people), { kind: "ref", seat: "Table 4", holders: [], count: 0 });
  assert.equal(whoseOf({ id: "s" }, [], "Ajen", people), null);
  assert.equal(whoseOf(null, pp, "Ajen", people), null);
  // Only this stop's live pictures count.
  assert.equal(whoseOf(stop, [T("x", "other", { who: "Ajen" }), T("g", "s", { who: "Ajen", gone: true }), ...others], "Ajen", people).kind, "none");
  // Nobody chosen (a shared link): nobody's.
  assert.equal(whoseOf(stop, pp, "", people).kind, "none");
  assert.equal(whoseOf(stop, pp, null, people).kind, "none");
  assert.equal(whoseOf(stop, withAll, "", people).kind, "all");
  // Names match trimmed and in any case (as the backend matches a name); a holder is counted once.
  assert.equal(sameName(" Ajen ", "ajen"), true);
  assert.equal(sameName("", ""), false);
  assert.equal(sameName(null, "Ajen"), false);
  assert.deepEqual(whoseOf(stop, [T("a", "s", { who: "ajen ", seat: "Car 7 · 10B" }), T("m", "s", { who: "Mo" })], "Ajen", people), { kind: "mine", seat: "Car 7 · 10B", holders: ["Mo", "ajen "], count: 2 });
  assert.deepEqual(whoseOf(stop, [T("a", "s", { who: "Ajen" }), T("b", "s", { who: "AJEN", page: 2 })], "Mo", people).holders, ["Ajen"]);
  // A holder not among the people stands after them, by name.
  assert.deepEqual(whoseOf(stop, [T("z", "s", { who: "Zed" }), T("b", "s", { who: "Bea" }), T("t", "s", { who: "Trenton" })], "Mo", people).holders, ["Trenton", "Bea", "Zed"]);
});

// ---------- the store ----------

const KEY = "test-key";
function memStorage(init = {}) {
  const map = new Map(Object.entries(init));
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); } };
}
function phone({ fake, storage, ticketData = async () => null, afterLoad } = {}) {
  fake = fake || createFakeBackend({ ...PLAN });
  storage = storage || memStorage({ "mat.key": KEY, "mat.me": "Mo" });
  const net = { offline: false, sent: [], override: null, lose: new Set() };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    net.sent.push(body);
    if (net.offline) throw new TypeError("Failed to fetch");
    const env = (net.override && net.override(body)) || (await fake(body));
    if (net.lose.has(body.action)) throw new TypeError("Load failed");
    return { ok: true, status: 200, text: async () => JSON.stringify(env) };
  };
  const api = createApi({ url: "https://example.test/exec", getKey: () => storage.getItem("mat.key"), getActor: () => storage.getItem("mat.me"), fetchImpl });
  const store = createStore({ api, storage, now: () => NOW12, wait: async () => {}, ticketData, afterLoad });
  return { fake, storage, net, store };
}
const picture = (over = {}) => ({ stop: "planstop1203", who: "", seat: "", page: 1, mime: "image/png", w: 10, h: 10, data: pngData, ...over });

test("store: tickets and ticketsReady come from load; before migrate there are none and ticketsReady is false", async () => {
  const p = phone();
  await p.store.boot();
  assert.equal(p.store.state.ticketsReady, true);
  assert.deepEqual(p.store.state.tickets, []);
  const old = phone({ fake: createFakeBackend({ ...PLAN, missingTabs: ["Tickets", "TicketData"] }) });
  await old.store.boot();
  assert.equal(old.store.state.ticketsReady, false);
  assert.deepEqual(old.store.state.tickets, []);
});

test("store: afterLoad runs after every load that answered, never after one that did not", async () => {
  let n = 0;
  const p = phone({ afterLoad: () => { n++; } });
  await p.store.boot();
  assert.equal(n, 1);
  p.net.offline = true;
  await p.store.refresh();
  assert.equal(n, 1);
  p.net.offline = false;
  await p.store.refresh();
  assert.equal(n, 2);
});

test("store: addTicket shows it at once, sends it, and says how it went", async () => {
  const p = phone();
  await p.store.boot();
  const token = p.store.addTicket(picture({ who: "Ajen" }));
  const id = p.store.state.tickets[0].id;
  assert.equal(p.store.state.tickets[0].pending, true);
  assert.equal(p.store.busy(), true);
  const out = await p.store.ticketOutcome(token);
  assert.equal(out.saved, true);
  await p.store.idle();
  assert.equal(p.store.state.tickets[0].pending, undefined);
  assert.equal(p.fake.tables.Tickets[0].id, id);
  assert.equal(p.fake.tables.Tickets[0].who, "Ajen");
});

test("store: with no signal a picture waits on the phone; mat.queue never holds its data; it is sent later from the keep", async () => {
  const kept = new Map();
  const p = phone({ ticketData: async (id) => kept.get(id) || null });
  await p.store.boot();
  p.net.offline = true;
  await p.store.checkRev(); // the phone learns there is no signal
  const token = p.store.addTicket(picture());
  const id = p.store.state.tickets[0].id;
  kept.set(id, pngData);
  const out = await p.store.ticketOutcome(token);
  assert.equal(out.saved, false);
  assert.equal(out.reason, "queued");
  const q = p.storage.getItem("mat.queue");
  assert.ok(q.includes(id));
  assert.equal(q.includes(pngData), false);
  // The app is closed and opened again, with signal: the queue sends it, data from the keep.
  const again = phone({ fake: p.fake, storage: p.storage, ticketData: async (i) => kept.get(i) || null });
  await again.store.boot();
  await again.store.idle();
  assert.equal(again.fake.tables.Tickets.length, 1);
  assert.equal((await again.fake({ key: KEY, action: "ticket", args: { id } })).data.data, pngData);
  assert.equal(JSON.parse(again.storage.getItem("mat.queue")).length, 0);
});

test("store: a queued picture whose data the phone lost is dropped with a sentence, not sent empty", async () => {
  const p = phone();
  await p.store.boot();
  p.net.offline = true;
  await p.store.checkRev();
  p.store.addTicket(picture());
  const again = phone({ fake: p.fake, storage: p.storage, ticketData: async () => null });
  await again.store.boot();
  await again.store.idle();
  assert.equal(again.fake.tables.Tickets.length, 0);
  assert.equal(again.net.sent.some((b) => b.action === "addTicket"), false);
  assert.match(again.store.state.notice || "", /picture/);
  assert.deepEqual(again.store.state.tickets, []);
});

// An IndexedDB whose open can be made to hang (a slow start, or one that never opens), counting opens.
function hangable(idb = fakeIndexedDB()) {
  const realOpen = idb.open.bind(idb);
  const h = { idb, hang: false, opens: 0 };
  idb.open = (...args) => {
    h.opens++;
    return h.hang ? { result: null, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null } : realOpen(...args);
  };
  return h;
}
const dinner = { day: "2026-12-11", title: "Dinner", amount: 14500, currency: "JPY", paidBy: "Mo", split: ["Mo", "Ajen", "Trenton"], splitMode: "equal", splitVals: [], note: "", kind: "" };
// The add as the views make it: into the keep first, the store told once it is in a lasting keep.
async function addKept(p, keep) {
  const id = "pic" + Math.random().toString(36).slice(2, 10);
  const put = keep.put(id, new Blob([Buffer.from(pngData, "base64")], { type: "image/png" }));
  const token = p.store.addTicket(picture({ id }), { kept: put.then((ok) => ok === true && keep.lasting) });
  assert.equal((await p.store.ticketOutcome(token)).reason, "queued");
  await put;
  await new Promise((r) => setTimeout(r, 0));
  return id;
}
const queued = (storage) => JSON.parse(storage.getItem("mat.queue") || "[]").filter((q) => q.ticket);

test("store: a waiting picture that reached a lasting keep is not lost when the keep does not open at the next start: it waits, the rest still go, and it goes up once the keep answers", async () => {
  const disk = hangable();
  const first = createKeep({ indexedDB: disk.idb });
  await first.ready;
  const p = phone({ ticketData: readKept(first) });
  await p.store.boot();
  p.net.offline = true;
  await p.store.checkRev();
  const id = await addKept(p, first);
  assert.deepEqual(queued(p.storage).map((q) => [q.ticket.id, q.kept]), [[id, true]], "noted as kept in mat.queue");
  p.store.addExpense(dinner);
  // The next start: signal, but the keep's open never answers.
  disk.hang = true;
  let t = 0;
  const keep = createKeep({ indexedDB: disk.idb, openWaitMs: 20, now: () => t });
  const again = phone({ fake: p.fake, storage: p.storage, ticketData: readKept(keep) });
  await again.store.boot();
  await again.store.idle();
  assert.equal(again.fake.tables.Tickets.length, 0, "not sent without its data");
  assert.equal(again.net.sent.some((b) => b.action === "addTicket"), false);
  assert.equal(again.store.state.notice, null, "not said to be lost");
  assert.ok(again.store.state.tickets.some((x) => x.id === id && x.pending), "still waiting on the screen");
  assert.equal(queued(again.storage).length, 1, "still in mat.queue");
  assert.ok(again.fake.tables.Expenses.some((e) => e.title === "Dinner"), "the line queued after it still went up");
  // The keep answers again (past the reopen pause): the next contact sends it with its picture.
  disk.hang = false;
  t += 61000;
  await again.store.checkRev();
  await again.store.idle();
  assert.equal(again.fake.tables.Tickets.length, 1);
  assert.equal((await again.fake({ key: KEY, action: "ticket", args: { id } })).data.data, pngData);
  assert.equal(queued(again.storage).length, 0);
});

test("store: a waiting picture that only ever was in memory (an IndexedDB that never opens) is said lost once at the next start, not left waiting", async () => {
  const disk = hangable();
  disk.hang = true;
  const first = createKeep({ indexedDB: disk.idb, openWaitMs: 20 });
  await first.ready;
  assert.equal(first.lasting, false);
  const p = phone({ ticketData: readKept(first) });
  await p.store.boot();
  p.net.offline = true;
  await p.store.checkRev();
  const id = await addKept(p, first);
  assert.deepEqual(queued(p.storage).map((q) => [q.ticket.id, q.kept]), [[id, false]], "noted as not kept");
  const keep = createKeep({ indexedDB: disk.idb, openWaitMs: 20 });
  const again = phone({ fake: p.fake, storage: p.storage, ticketData: readKept(keep) });
  await again.store.boot();
  await again.store.idle();
  assert.match(again.store.state.notice || "", /lost on this phone/);
  assert.equal(again.store.outbox().unsent, 0);
  assert.equal(queued(again.storage).length, 0);
  assert.equal(again.net.sent.some((b) => b.action === "addTicket"), false);
  // Once only.
  again.store.clearNotice();
  await again.store.checkRev();
  await again.store.idle();
  assert.equal(again.store.state.notice, null);
});

test("store: a waiting picture queued before kept was noted (no kept in mat.queue) is read as kept: it waits for a keep that does not open", async () => {
  const disk = hangable();
  const first = createKeep({ indexedDB: disk.idb });
  await first.ready;
  const p = phone({ ticketData: readKept(first) });
  await p.store.boot();
  p.net.offline = true;
  await p.store.checkRev();
  const id = await addKept(p, first);
  const old = JSON.parse(p.storage.getItem("mat.queue")).map((q) => {
    const c = { ...q };
    delete c.kept;
    return c;
  });
  p.storage.setItem("mat.queue", JSON.stringify(old));
  disk.hang = true;
  const keep = createKeep({ indexedDB: disk.idb, openWaitMs: 20 });
  const again = phone({ fake: p.fake, storage: p.storage, ticketData: readKept(keep) });
  await again.store.boot();
  await again.store.idle();
  assert.equal(again.store.state.notice, null);
  assert.ok(again.store.state.tickets.some((x) => x.id === id && x.pending));
  assert.equal(queued(again.storage).length, 1);
});

test("readKept (the app's ticketData): the data from a working keep; null when it does not have it; an open that answered late is tried again; still not open, it rejects; no IndexedDB at all, null", async () => {
  const disk = hangable();
  const first = createKeep({ indexedDB: disk.idb });
  await first.ready;
  assert.equal(await first.put("a", new Blob([Buffer.from(pngData, "base64")], { type: "image/png" })), true);
  assert.equal(await readKept(first)("a"), pngData);
  assert.equal(await readKept(first)("zz"), null, "a working keep without it: lost");
  // A slow start: the first open does not answer in time, the reopen does.
  disk.hang = true;
  const late = createKeep({ indexedDB: disk.idb, openWaitMs: 20 });
  await late.ready;
  assert.equal(late.lasting, false);
  disk.hang = false;
  assert.equal(await readKept(late)("a"), pngData);
  assert.equal(late.lasting, true);
  // An open that never answers: rejects (the picture may be in it).
  disk.hang = true;
  const hung = createKeep({ indexedDB: disk.idb, openWaitMs: 20 });
  await assert.rejects(readKept(hung)("a"), /not open/);
  // No IndexedDB at all: nothing can be kept, so it is missing.
  const none = createKeep({ indexedDB: undefined });
  assert.equal(none.none, true);
  assert.equal(await readKept(none)("a"), null);
});

test("keep.reopen: after one that did not open, none for a minute, so waiting pictures do not each wait 3 s nor pile up open requests; then it tries again", async () => {
  const disk = hangable();
  disk.hang = true;
  let t = 1000;
  const keep = createKeep({ indexedDB: disk.idb, openWaitMs: 20, now: () => t });
  await keep.ready;
  assert.equal(disk.opens, 1);
  const read = readKept(keep);
  for (const id of ["a", "b", "c"]) await assert.rejects(read(id));
  assert.equal(disk.opens, 2, "one reopen for three pictures");
  t += 59000;
  await assert.rejects(read("a"));
  assert.equal(disk.opens, 2, "still within the pause");
  t += 2000;
  disk.hang = false;
  assert.equal(await read("a"), null, "tried again after the pause; open, and it does not have it");
  assert.equal(disk.opens, 3);
  assert.equal(keep.lasting, true);
});

test("store: a refused picture says the backend's reason through its outcome and is gone from the screen", async () => {
  const p = phone();
  await p.store.boot();
  const token = p.store.addTicket(picture({ mime: "image/jpeg" })); // PNG bytes called a JPEG
  const out = await p.store.ticketOutcome(token);
  assert.deepEqual([out.saved, out.reason], [false, "refused"]);
  assert.match(out.message, /couldn’t be used/);
  await p.store.idle();
  assert.deepEqual(p.store.state.tickets, []);
  assert.equal(p.store.state.notice, null);
});

test("store: removeTicket goes at once with Undo on the bar; Undo brings it back", async () => {
  const p = phone();
  await p.store.boot();
  const t = await p.store.ticketOutcome(p.store.addTicket(picture()));
  await p.store.idle();
  const id = t.item.id;
  const token = p.store.removeTicket(id);
  assert.equal(p.store.state.tickets.find((x) => x.id === id).gone, true);
  await p.store.idle();
  assert.equal(p.fake.tables.Tickets[0].gone, "yes");
  assert.equal(p.store.state.lastChange.kind, "ticket");
  await p.store.undo(token);
  await p.store.idle();
  assert.equal(p.fake.tables.Tickets[0].gone, "");
  assert.notEqual(p.store.state.tickets.find((x) => x.id === id).gone, true);
});

test("store: fetchTicket asks the backend for one picture's data", async () => {
  const p = phone();
  await p.store.boot();
  const t = await p.store.ticketOutcome(p.store.addTicket(picture()));
  const got = await p.store.fetchTicket(t.item.id);
  assert.deepEqual(got, { id: t.item.id, mime: "image/png", data: pngData });
});

test("the undo bar's words for a ticket picture", () => {
  assert.equal(changeText({ kind: "ticket", action: "add", item: {} }), "Added a ticket picture.");
  assert.equal(changeText({ kind: "ticket", action: "remove", item: {} }), "Removed a ticket picture.");
  assert.equal(changeText({ kind: "ticket", action: "undo", item: {} }), "Undone.");
});

test("pdf.js is not in the offline shell, and is the pinned build with its licence beside it", async () => {
  const fs = await import("node:fs");
  const sw = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.equal(/vendor\//.test(sw.match(/const SHELL = \[([\s\S]*?)\];/)[1]), false);
  assert.match(sw, /"js\/tickets.js"/);
  for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs", "LICENSE"]) assert.ok(fs.existsSync(new URL("../vendor/pdfjs/" + f, import.meta.url)), f);
  assert.match(fs.readFileSync(new URL("../vendor/pdfjs/LICENSE", import.meta.url), "utf8"), /Apache License/);
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(JSON.stringify(pkg).includes("pdfjs"), false, "not a dependency");
});

// ---------- the merge with version 28: a refused key and Forget take every picture off ----------

test("keep.wipe: every picture off the phone, the database deleted; a put begun before it never lands; usable after", async () => {
  const idb = fakeIndexedDB();
  const keep = createKeep({ indexedDB: idb });
  await keep.ready;
  await keep.put("a", blobOf(PNG, 10, "image/png"));
  const before = keep.gen;
  let told = 0;
  keep.subscribe(() => told++);
  await keep.wipe();
  assert.equal(keep.have("a"), false);
  assert.equal(await keep.get("a"), null);
  assert.equal(idb.deleted, 1);
  assert.equal(idb.data.size, 0);
  assert.ok(told >= 1);
  assert.equal(await keep.put("late", blobOf(PNG, 10), { gen: before }), false, "a reply from before the wipe is not kept");
  assert.equal(keep.have("late"), false);
  assert.equal(await keep.put("b", blobOf(PNG, 10)), true);
  assert.equal(keep.have("b"), true);
});

test("a fetch on its way when the phone is wiped keeps nothing", async () => {
  const keep = createKeep({ indexedDB: fakeIndexedDB() });
  await keep.ready;
  let release;
  const gate = new Promise((r) => { release = r; });
  const { store } = fakeStore({ tickets: [T("t1", "soon0001")], stops: STOPS, answer: async (id) => { await gate; return { id, mime: "image/png", data: pngData }; } });
  const run = fetchMissing(store, keep, { now: () => NOW12 });
  await new Promise((r) => setTimeout(r, 5));
  await keep.wipe();
  release();
  await run;
  assert.equal(keep.have("t1"), false);
});

test("I3 (merged here): an IndexedDB that never answers is given up on; pictures are kept in memory", async () => {
  const keep = createKeep({ indexedDB: fakeIndexedDB({ hangs: true }), openWaitMs: 30 });
  const t0 = Date.now();
  await keep.ready;
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(keep.lasting, false);
  assert.equal(await keep.put("a", blobOf(PNG, 10)), true);
  assert.equal(keep.have("a"), true);
  await keep.wipe();
  assert.equal(keep.have("a"), false);
});

test("store: a refused key takes every waiting picture out of mat.queue, and keeps the person's own lines", async () => {
  const p = phone();
  await p.store.boot();
  p.net.offline = true;
  await p.store.checkRev();
  p.store.addTicket(picture());
  p.store.addExpense({ day: "2026-12-12", title: "Tea", amount: 500, currency: "JPY", paidBy: "Mo", split: ["Mo", "Ajen", "Trenton"] });
  const q0 = JSON.parse(p.storage.getItem("mat.queue"));
  assert.equal(q0.length, 2);
  p.fake.props.TRIP_KEY = "another-key";
  p.net.offline = false;
  await p.store.checkRev();
  assert.equal(p.store.state.status, "nokey");
  const q = JSON.parse(p.storage.getItem("mat.queue") || "[]");
  assert.equal(q.some((e) => e.ticket), false, "no picture is kept");
  assert.equal(q.some((e) => e.expense), true, "the person's own line is kept");
  assert.deepEqual(p.store.state.tickets, []);
});

test("the You setting: every picture by default, only when opened on a choice; anything odd reads as the default", () => {
  const mem = memStorage();
  assert.equal(fetchMode(mem), "all");
  assert.equal(fetchesAll(mem), true);
  setFetchMode("open", mem);
  assert.equal(mem.getItem("mat.tixFetch"), "open");
  assert.equal(fetchesAll(mem), false);
  mem.setItem("mat.tixFetch", "sometimes");
  assert.equal(fetchMode(mem), "all");
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(fetchMode(broken), "all");
  setFetchMode("open", broken);
});

// ---------- fix round 1 (phone) ----------
test("I1: a waiting picture that meets a busy trip sheet stays waiting, and goes up on the next try", async () => {
  const kept = new Map();
  const p = phone({ ticketData: async (id) => kept.get(id) || null });
  await p.store.boot();
  p.net.offline = true;
  await p.store.checkRev();
  const token = p.store.addTicket(picture());
  const id = p.store.state.tickets[0].id;
  kept.set(id, pngData);
  assert.equal((await p.store.ticketOutcome(token)).reason, "queued");
  p.net.offline = false;
  p.net.override = (body) => (body.action === "addTicket" ? { ok: false, error: "busy", message: "Someone else is saving right now. Try again in a moment." } : null);
  await p.store.flush();
  await p.store.idle();
  assert.equal(p.store.state.tickets.length, 1, "still on the screen");
  assert.equal(p.store.state.tickets[0].pending, true);
  assert.ok(p.storage.getItem("mat.queue").includes(id), "still waiting on the phone");
  assert.equal(p.fake.tables.Tickets.length, 0);
  p.net.override = null;
  await p.store.flush();
  await p.store.idle();
  assert.equal(p.fake.tables.Tickets.length, 1);
  assert.equal(p.store.state.tickets[0].pending, undefined);
});
test("I2: a full phone does not fetch the same picture again at once (it backs off as for a broken one)", async () => {
  const keep = createKeep({ indexedDB: fakeIndexedDB({ fullAfter: 0 }) });
  await keep.ready;
  const { store, calls } = fakeStore({ tickets: [T("t1", "soon0001")], stops: STOPS, answer: (id) => ({ id, mime: "image/png", data: pngData }) });
  await fetchMissing(store, keep, { now: () => NOW12 });
  assert.equal(calls.ids.length, 1);
  await fetchMissing(store, keep, { now: () => NOW12 + 20000 });
  await fetchMissing(store, keep, { now: () => NOW12 + 40000 });
  assert.equal(calls.ids.length, 1, "not again every 20 seconds");
  await fetchMissing(store, keep, { now: () => NOW12 + 11 * 60 * 1000 });
  assert.equal(calls.ids.length, 2);
});
test("I5: a picture whose reply was lost, with its data gone from the phone, is resent without data and found landed", async () => {
  const p = phone({ ticketData: async () => null });
  await p.store.boot();
  p.net.lose.add("addTicket");
  const token = p.store.addTicket(picture());
  const id = p.store.state.tickets[0].id;
  assert.equal((await p.store.ticketOutcome(token)).reason, "queued");
  assert.equal(p.fake.tables.Tickets.length, 1, "it did land");
  // The app is opened again: the data is no longer in memory, and not in the keep either.
  p.net.lose.clear();
  const again = phone({ fake: p.fake, storage: p.storage, ticketData: async () => null });
  await again.store.boot();
  await again.store.idle();
  const sent = again.net.sent.filter((b) => b.action === "addTicket");
  assert.equal(sent.length, 1);
  assert.equal("data" in sent[0].args.ticket, false, "resent without data");
  assert.equal(again.store.state.notice, null, "not said lost: it is on the trip");
  assert.deepEqual(again.store.state.tickets.map((t) => t.id), [id]);
  assert.equal(JSON.parse(again.storage.getItem("mat.queue")).length, 0);
});
test("I5: undoing a picture whose reply was lost, with its data gone, still undoes it on the trip sheet", async () => {
  const p = phone({ ticketData: async () => null });
  await p.store.boot();
  p.net.lose.add("addTicket");
  const token = p.store.addTicket(picture());
  await p.store.ticketOutcome(token);
  assert.equal(p.fake.tables.Tickets.length, 1);
  // Undo before any reply came: the add must be resent (no data here) and then undone.
  const again = phone({ fake: p.fake, storage: p.storage, ticketData: async () => null });
  p.net.lose.clear();
  await p.store.undo(token);
  await p.store.idle();
  await again.store.boot();
  await again.store.idle();
  assert.equal(p.fake.tables.Tickets[0].gone, "yes", "the picture taken back is gone from the stop");
});
test("I5: a waiting picture that never left, with its data gone, is dropped with a sentence", async () => {
  const p = phone({ ticketData: async () => null });
  await p.store.boot();
  p.net.offline = true;
  await p.store.checkRev();
  p.store.addTicket(picture());
  const again = phone({ fake: p.fake, storage: p.storage, ticketData: async () => null });
  await again.store.boot();
  await again.store.idle();
  assert.equal(again.net.sent.some((b) => b.action === "addTicket"), false);
  assert.match(again.store.state.notice || "", /lost on this phone/);
});
test("minor 12: an undo refused by the trip sheet shows its own reason", async () => {
  const p = phone();
  await p.store.boot();
  const t = await p.store.ticketOutcome(p.store.addTicket(picture()));
  await p.store.idle();
  const token = p.store.removeTicket(t.item.id);
  await p.store.idle();
  p.net.override = (body) => (body.action === "undo" ? { ok: false, error: "bad_input", message: "A stop can hold at most 8 ticket pictures." } : null);
  await p.store.undo(token);
  await p.store.idle();
  assert.equal(p.store.state.notice, "A stop can hold at most 8 ticket pictures.");
});

test("minor 4: after a load, pictures no longer on the trip (removed, refused) come off the phone; those shown stay", async () => {
  const keep = createKeep({ indexedDB: fakeIndexedDB() });
  await keep.ready;
  for (const id of ["live", "gone", "refused", "mine"]) await keep.put(id, blobOf(PNG, 10));
  const s = { ticketsReady: true, tickets: [T("live", "soon0001"), T("gone", "soon0001", { gone: true }), T("mine", "soon0001", { pending: true })] };
  await pruneKeep({ state: s }, keep);
  assert.deepEqual(keep.ids().sort(), ["live", "mine"]);
  // Before migrate (or a load that did not say), nothing is taken off.
  await pruneKeep({ state: { ticketsReady: false, tickets: [] } }, keep);
  assert.deepEqual(keep.ids().sort(), ["live", "mine"]);
});

test("minor 6: a picture whose stop is removed or not on the plan is not fetched", () => {
  const s = { trip: { tz: "Asia/Tokyo" }, stops: [...STOPS, { id: "gone0001", date: "2026-12-12", time: "11:00", deleted: true }], tickets: [T("a", "soon0001"), T("b", "gone0001"), T("c", "nowhere1")] };
  assert.deepEqual(fetchOrder(s, NOW12).map((t) => t.id), ["a"]);
});


test("N1: after a wipe no database exists and none is opened again in that visit; a new link opens it afresh", async () => {
  const idb = fakeIndexedDB();
  const keep = createKeep({ indexedDB: idb });
  await keep.ready;
  await keep.put("a", blobOf(PNG, 10, "image/png"));
  assert.equal(idb.exists, true);
  assert.equal(idb.opens, 1);
  await keep.wipe();
  await keep.wipe(); // a refused key and Forget can both wipe
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(idb.exists, false, "Forget's delete is not undone by an empty database");
  assert.equal(idb.opens, 1, "not opened again");
  assert.equal(idb.db.closed >= 1, true, "the open connection was closed before the delete");
  assert.equal(keep.have("a"), false);
  await keep.restart();
  assert.equal(idb.opens, 2);
  assert.equal(keep.lasting, true);
  assert.equal(await keep.put("b", blobOf(PNG, 10, "image/png")), true);
});

test("N1: a connection told of a version change (a deletion by someone else) closes itself", async () => {
  const idb = fakeIndexedDB();
  const keep = createKeep({ indexedDB: idb });
  await keep.ready;
  assert.equal(typeof idb.db.onversionchange, "function");
  idb.db.onversionchange();
  assert.equal(idb.db.closed, 1);
  assert.equal(keep.lasting, false);
});

test("N2: switching to Only when I open one stops a running pass at the next picture", async () => {
  const keep = createKeep({ indexedDB: fakeIndexedDB() });
  await keep.ready;
  const mem = memStorage();
  let n = 0;
  const { store, calls } = fakeStore({
    tickets: [T("t1", "soon0002"), T("t2", "soon0001"), T("t3", "late0001"), T("t4", "past0001")],
    stops: STOPS,
    answer: (id) => {
      if (++n === 2) setFetchMode("open", mem); // the person changes the setting while the pass runs
      return { id, mime: "image/png", data: pngData };
    },
  });
  await fetchMissing(store, keep, { now: () => NOW12, allowed: () => fetchesAll(mem) });
  assert.deepEqual(calls.ids, ["t1", "t2"], "no third picture is asked for");
  assert.equal(keep.have("t3"), false);
  // Without the option the pass is unchanged.
  const { store: other, calls: c2 } = fakeStore({ tickets: [T("t9", "soon0002")], stops: STOPS, answer: (id) => ({ id, mime: "image/png", data: pngData }) });
  await fetchMissing(other, keep, { now: () => NOW12 });
  assert.equal(c2.ids.length, 1);
});

test("N4: a picture that meets a busy trip sheet says so, and does not blame the signal", async () => {
  const kept = new Map();
  const p = phone({ ticketData: async (id) => kept.get(id) || null });
  await p.store.boot();
  p.net.override = (body) => (body.action === "addTicket" ? { ok: false, error: "busy", message: "Someone else is saving right now. Try again in a moment." } : null);
  const token = p.store.addTicket(picture());
  const out = await p.store.ticketOutcome(token);
  assert.equal(out.reason, "queued");
  assert.equal(out.busy, true);
  // And with no signal it is not marked busy.
  const q = phone();
  await q.store.boot();
  q.net.offline = true;
  await q.store.checkRev();
  const off = await q.store.ticketOutcome(q.store.addTicket(picture()));
  assert.equal(off.reason, "queued");
  assert.equal(off.busy, undefined);
  const { waitingSentence } = await import("../js/views/ticketpart.js");
  assert.equal(waitingSentence({ waiting: 1, busy: 1 }), "The trip sheet is busy. It will go up in a moment.");
  assert.equal(waitingSentence({ waiting: 2, busy: 1 }), "Saved on this phone. It goes up in a moment, or when there is signal.");
  assert.equal(waitingSentence({ waiting: 1, busy: 0 }), "Saved on this phone. It goes up when there is signal.");
  // Not kept on this phone (keptOrLate false): never "Saved on this phone".
  assert.equal(waitingSentence({ waiting: 1, busy: 0, unkept: true }), "Keep MAT open until it goes up.");
  assert.equal(waitingSentence({ waiting: 2, busy: 1, unkept: true }), "Keep MAT open until it goes up.");
  assert.equal(waitingSentence({ waiting: 1, busy: 1, unkept: true }), "The trip sheet is busy. It will go up in a moment. Keep MAT open until it goes up.");
});

// ---------- a stay's booking (S2 鍵札) ----------

import { stayMark, stayPictures } from "../js/tickets.js";

const S = (id, stay, extra = {}) => T(id, "", { stay, ...extra });

test("stayMark: pages on a stay, the facts alone, or nothing; only the stay's own live pictures", () => {
  const inn = { id: "inn00001" };
  const has = () => true;
  assert.equal(stayMark(inn, [], has), null);
  assert.equal(stayMark(null, [], has), null);
  assert.deepEqual(stayMark({ ...inn, tkRef: "TSB-4827-KQ" }, [], has), { kind: "ref", label: "Reference", saved: true });
  assert.deepEqual(stayMark({ ...inn, tkRoom: "Tatami" }, [], has), { kind: "ref", label: "Reference", saved: true });
  assert.deepEqual(stayMark({ ...inn, tkRef: "  " }, [], has), null);
  assert.deepEqual(stayMark(inn, [S("a", "inn00001")], has), { kind: "pics", label: "1 page", saved: true });
  assert.deepEqual(stayMark(inn, [S("a", "inn00001"), S("b", "inn00001", { page: 2 })], (id) => id === "a"), { kind: "pics", label: "2 pages", saved: false });
  // Another stay's, a stop's, a removed one: not this stay's.
  assert.equal(stayMark(inn, [S("x", "other001"), T("y", "inn00001"), S("z", "inn00001", { gone: true })], has), null);
  // A stop's mark never counts a stay's picture.
  assert.equal(ticketMark({ id: "soon0001" }, [S("a", "inn00001")], has), null);
  // In order of person, then page.
  assert.deepEqual(stayPictures(inn, [S("b", "inn00001", { who: "Mo", page: 2 }), S("c", "inn00001", { who: "Ajen" }), S("a", "inn00001", { who: "Mo", page: 1 })]).map((t) => t.id), ["c", "a", "b"]);
});

test("fetchOrder: a stay's pictures at its first night, 15:00; first of all while you are in it; never a removed stay's", () => {
  const stays = [
    { id: "inn00001", firstNight: "2026-12-12", lastNight: "2026-12-13" },
    { id: "inn00002", firstNight: "2026-12-14", lastNight: "2026-12-15" },
    { id: "inn00003", firstNight: "2026-12-09", lastNight: "2026-12-10" },
    { id: "gone0001", firstNight: "2026-12-12", lastNight: "2026-12-13", deleted: true },
  ];
  const s = { trip: { tz: "Asia/Tokyo" }, stops: STOPS, stays, tickets: [T("t1", "soon0002"), S("y2", "inn00002"), S("y1", "inn00001"), T("t2", "late0001"), S("y3", "inn00003"), S("yg", "gone0001"), S("yn", "nowhere1")] };
  // Dec 12, 09:00: in the first stay (its first night is today): its picture first, then by time (Dec 14 08:00 before 15:00), then the past.
  assert.deepEqual(fetchOrder(s, NOW12).map((t) => t.id), ["y1", "t1", "t2", "y2", "y3"]);
  // Dec 11: the morning after the third stay's last night: it is first, then the rest in time order.
  const dec11 = Date.parse("2026-12-11T09:00:00+09:00");
  assert.deepEqual(fetchOrder(s, dec11).map((t) => t.id), ["y3", "t1", "y1", "t2", "y2"]);
  // Dec 14, the morning after the first stay's last night: still first; the second stay begins tonight, so first too.
  const dec14 = Date.parse("2026-12-14T07:00:00+09:00");
  assert.deepEqual(fetchOrder(s, dec14).map((t) => t.id), ["y1", "y2", "t2", "t1", "y3"]);
});

test("fetchOrder: today is the Days clock's day (Dec 9 in its own zone after Japan's midnight)", async () => {
  const { dec9State, et } = await import("./fixtures/dec9.js");
  // Two stays: the airport inn (Dec 8) and one from Dec 10. At 11:45 Eastern on Dec 9
  // it is Dec 10 in Japan, but still Dec 9 by the Days clock: the inn is the stay you are in.
  const s = dec9State({
    stays: [{ id: "dec9stay0801", firstNight: "2026-12-08", lastNight: "2026-12-08" }, { id: "laterstay01", firstNight: "2026-12-10", lastNight: "2026-12-12" }],
    tickets: [{ id: "inn", stay: "dec9stay0801" }, { id: "later", stay: "laterstay01" }, { id: "fl", stop: "dec9stop0903" }],
  });
  assert.deepEqual(fetchOrder(s, et("2026-12-09T11:45")).map((t) => t.id), ["inn", "fl", "later"]);
});

test("keptOrLate: true once every waiting picture's put kept it in a lasting keep; false when a write failed, the cap was hit, or the keep is memory only", async () => {
  const lasting = { lasting: true };
  // Waits for a put still writing.
  let doneA;
  const a = new Promise((r) => { doneA = r; });
  let over = null;
  const waiting = keptOrLate(lasting, [a, Promise.resolve(true)], 10000).then((v) => { over = v; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(over, null, "a put still writing is waited for");
  doneA(true);
  await waiting;
  assert.equal(over, true);
  assert.equal(await keptOrLate(lasting, []), true, "nothing waiting");
  // A write that failed (quota, IndexedDB error, a wipe: put resolves false), or threw.
  assert.equal(await keptOrLate(lasting, [Promise.resolve(true), Promise.resolve(false)], 10000), false);
  assert.equal(await keptOrLate(lasting, [Promise.reject(new Error("IndexedDB"))], 10000), false);
  // The cap: a put that never answers is given up on, as not kept.
  const t0 = Date.now();
  assert.equal(await keptOrLate(lasting, [new Promise(() => {})], 50), false);
  assert.ok(Date.now() - t0 < 1000);
  // Only the memory keep (IndexedDB missing or its open never answered): put says true, but closing MAT loses it.
  assert.equal(await keptOrLate({ lasting: false }, [Promise.resolve(true)], 10000), false);
  // The real keep in memory only (no IndexedDB): the same.
  const mem = createKeep({ indexedDB: null });
  const put = mem.put("pic1", new Blob(["x"], { type: "image/png" }));
  assert.equal(await put, true);
  assert.equal(await keptOrLate(mem, [put], 10000), false);
});
