/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// js/tickets.js (the limits, what a file is, shrinking a picture, the
// IndexedDB keep, fetching what this phone lacks) and the store's ticket
// writes. Pictures are made up here: a signature and some bytes. The canvas
// and IndexedDB are small fakes.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { LIMITS, sniff, shrink, createKeep, fetchMissing, toBase64, fromBase64, ticketKinds, ticketMark, fetchMode, setFetchMode, fetchesAll } from "../js/tickets.js";
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
  const db = { objectStoreNames: { contains: () => true }, createObjectStore() {}, transaction: tx, close() {} };
  return {
    data,
    deleted: 0,
    deleteDatabase() {
      const r = { onsuccess: null, onerror: null, onblocked: null };
      this.deleted++;
      data.clear();
      queueMicrotask(() => r.onsuccess && r.onsuccess());
      return r;
    },
    open() {
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
