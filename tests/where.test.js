import { test } from "node:test";
import assert from "node:assert/strict";
import { createWhere, ASK_GAP_MS, OPTIONS } from "../js/where.js";

const NOW = Date.parse("2026-12-15T13:20:00+09:00");

function mem(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}
// A stand-in phone: each request waits until the test answers it.
function phone() {
  const calls = [];
  return {
    calls,
    watched: 0,
    getCurrentPosition(ok, no, opts) {
      calls.push({ ok, no, opts });
    },
    watchPosition() {
      this.watched++;
    },
    give(i, lat, lng, accuracy = 30, at = NOW) {
      calls[i].ok({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp: at });
    },
    refuse(i) {
      calls[i].no({ code: 1 });
    },
  };
}
// No real timers in a unit test.
const T = { every: () => 1, stopEvery: () => {}, later: () => {} };
function doc(state = "visible") {
  const fns = [];
  return { visibilityState: state, addEventListener: (t, f) => fns.push(f), fire() { for (const f of fns) f(); } };
}

test("unset at first; nothing is asked until a tap; only the choice is stored", () => {
  const s = mem();
  const g = phone();
  let t = NOW;
  const w = createWhere({ ...T, storage: s, geolocation: g, now: () => t, doc: doc() });
  w.start();
  assert.equal(w.state(), "unset");
  assert.equal(g.calls.length, 0, "never asked by itself");
  w.ask();
  assert.equal(w.state(), "on");
  assert.equal(s.getItem("mat.where"), "on");
  assert.equal(g.calls.length, 1);
  assert.deepEqual(g.calls[0].opts, { enableHighAccuracy: false, maximumAge: 120000, timeout: 8000 });
  assert.deepEqual(OPTIONS, g.calls[0].opts);
  assert.equal(w.current(), null, "nothing waits: no position yet");
  g.give(0, 35.0037, 135.7788, 40);
  assert.deepEqual(w.current(), { lat: 35.0037, lng: 135.7788, at: NOW, accuracy: 40 });
  // Only the choice is kept on the phone.
  assert.deepEqual([...s.m.keys()], ["mat.where"]);
  assert.equal([...s.m.values()].join().includes("35.0037"), false);
  assert.equal(g.watched, 0, "never watchPosition");
});

test("stale, rough or from the phone's no: as if off", () => {
  const g = phone();
  let t = NOW;
  const w = createWhere({ ...T, storage: mem(), geolocation: g, now: () => t, doc: doc() });
  w.ask();
  g.give(0, 35, 135, 301);
  assert.equal(w.current(), null, "rough");
  t = NOW + 3 * 60000 + 1000;
  w.ask();
  g.give(1, 35, 135, 50, NOW);
  assert.equal(w.current(), null, "already older than 3 minutes when it came");
  t += 1;
  w.ask();
  g.refuse(2);
  assert.equal(w.state(), "refused");
  assert.equal(w.current(), null);
});

test("asked at most once every 2 minutes, only while on screen", () => {
  const g = phone();
  let t = NOW;
  const d = doc();
  const w = createWhere({ ...T, storage: mem({ "mat.where": "on" }), geolocation: g, now: () => t, doc: d });
  w.start();
  assert.equal(g.calls.length, 1, "on: asked when the app starts on screen");
  g.give(0, 35, 135);
  d.fire();
  assert.equal(g.calls.length, 1, "not again within 2 minutes");
  t += ASK_GAP_MS;
  d.visibilityState = "hidden";
  d.fire();
  assert.equal(g.calls.length, 1, "never while hidden");
  d.visibilityState = "visible";
  d.fire();
  assert.equal(g.calls.length, 2, "back on screen after 2 minutes: asked");
});

test("refused stays quiet: nothing is asked again until a person taps", () => {
  const g = phone();
  const d = doc();
  let t = NOW;
  const w = createWhere({ ...T, storage: mem({ "mat.where": "refused" }), geolocation: g, now: () => t, doc: d });
  w.start();
  t += 10 * ASK_GAP_MS;
  d.fire();
  assert.equal(g.calls.length, 0);
  assert.equal(w.state(), "refused");
  w.ask();
  assert.equal(g.calls.length, 1, "a tap asks again");
});

test("turning it off forgets the position and asks no more", () => {
  const g = phone();
  const d = doc();
  let t = NOW;
  const s = mem();
  const w = createWhere({ ...T, storage: s, geolocation: g, now: () => t, doc: d });
  let told = 0;
  w.subscribe(() => told++);
  w.ask();
  g.give(0, 35, 135);
  assert.ok(w.current());
  w.turnOff();
  assert.equal(w.state(), "off");
  assert.equal(s.getItem("mat.where"), "off");
  assert.equal(w.current(), null);
  t += 10 * ASK_GAP_MS;
  d.fire();
  assert.equal(g.calls.length, 1);
  assert.ok(told >= 3);
});

test("a phone with no geolocation is off and asks nothing; storage that throws is survived", () => {
  const w = createWhere({ ...T, storage: mem(), geolocation: undefined, doc: doc() });
  w.start();
  w.ask();
  assert.equal(w.supported(), false);
  assert.equal(w.state(), "off");
  assert.equal(w.current(), null);
  const bad = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); } };
  const g = phone();
  const w2 = createWhere({ ...T, storage: bad, geolocation: g, now: () => NOW, doc: doc() });
  assert.equal(w2.state(), "unset");
  w2.ask();
  assert.equal(w2.state(), "on", "kept for this visit");
});

test("the phone's own permission, when it can be read, brings the choice in line", async () => {
  const g = phone();
  const perm = (state) => ({ query: () => Promise.resolve({ state }) });
  const w = createWhere({ ...T, storage: mem({ "mat.where": "refused" }), geolocation: g, permissions: perm("granted"), now: () => NOW, doc: doc() });
  w.start();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.state(), "on", "allowed since in Settings");
  const w2 = createWhere({ ...T, storage: mem({ "mat.where": "on" }), geolocation: phone(), permissions: perm("denied"), now: () => NOW, doc: doc() });
  w2.start();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w2.state(), "refused");
});

test("(a) a request the phone never answers stops blocking after 15 seconds", () => {
  const g = phone();
  const d = doc();
  let t = NOW;
  const timers = [];
  const w = createWhere({ ...T, later: (f, ms) => timers.push({ f, ms }), storage: mem({ "mat.where": "on" }), geolocation: g, now: () => t, doc: d });
  w.start();
  assert.equal(g.calls.length, 1);
  t += ASK_GAP_MS;
  d.fire();
  assert.equal(g.calls.length, 1, "still waiting on the first");
  assert.equal(timers.at(-1).ms, 15000);
  timers.at(-1).f();
  d.fire();
  assert.equal(g.calls.length, 2, "asked again once the stuck one is given up");
  // A late answer to the given-up request is still taken.
  g.give(0, 35, 135, 40, t);
  assert.ok(w.current());
});

// ---- the Location row after a refusal (found on a real iPhone, 2026-11-18) ----

test("refused, then allowed in Settings: coming back to the app turns it on and a position is asked for", async () => {
  const g = phone();
  const d = doc();
  let state = "denied";
  let queries = 0;
  const permissions = { query: () => { queries++; return Promise.resolve({ state }); } };
  const w = createWhere({ ...T, storage: mem({ "mat.where": "refused" }), geolocation: g, permissions, now: () => NOW, doc: d });
  w.start();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.state(), "refused");
  assert.equal(g.calls.length, 0);
  d.visibilityState = "hidden";
  d.fire();
  state = "granted"; // turned on in iPhone Settings meanwhile
  d.visibilityState = "visible";
  d.fire();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(queries, 2, "looked again only on coming back on screen");
  assert.equal(w.state(), "on");
  assert.equal(g.calls.length, 1, "a position is asked for");
});

for (const [what, permissions] of [
  ["prompt", { query: () => Promise.resolve({ state: "prompt" }) }],
  ["denied", { query: () => Promise.resolve({ state: "denied" }) }],
  ["no permissions API", undefined],
  ["a query that fails", { query: () => Promise.reject(new Error("no")) }],
]) {
  test("refused, back on screen with " + what + ": stays refused, quietly, and the phone is never asked", async () => {
    const g = phone();
    const d = doc();
    let told = 0;
    const w = createWhere({ ...T, storage: mem({ "mat.where": "refused" }), geolocation: g, permissions, now: () => NOW, doc: d });
    w.subscribe(() => told++);
    w.start();
    for (const v of ["hidden", "visible", "hidden", "visible"]) {
      d.visibilityState = v;
      d.fire();
    }
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(w.state(), "refused");
    assert.equal(g.calls.length, 0, "getCurrentPosition is not called");
    assert.equal(told, 0, "nothing to tell anyone");
  });
}

test("why(): the phone's answer to a refusal, cut to 80, memory only; cleared by a position and by turning off", () => {
  const s = mem();
  const g = phone();
  let t = NOW;
  const w = createWhere({ ...T, storage: s, geolocation: g, now: () => t, doc: doc() });
  assert.equal(w.why(), null);
  w.ask();
  g.calls[0].no({ code: 1, message: "User denied <b>Geolocation</b> " + "x".repeat(100) });
  assert.equal(w.state(), "refused");
  assert.deepEqual(w.why(), { code: 1, message: ("User denied <b>Geolocation</b> " + "x".repeat(100)).slice(0, 80) });
  assert.equal(w.why().message.length, 80);
  assert.equal([...s.m.values()].join().includes("denied"), false, "never stored");
  t += ASK_GAP_MS;
  w.ask();
  g.give(1, 35, 135);
  assert.equal(w.why(), null, "cleared by a position");
  t += ASK_GAP_MS;
  w.ask();
  g.calls[2].no({ code: 1 });
  assert.deepEqual(w.why(), { code: 1, message: "" });
  w.turnOff();
  assert.equal(w.why(), null, "cleared by turning off");
  // Another error (a timeout) neither refuses nor sets it.
  w.ask();
  g.calls[3].no({ code: 3, message: "Timeout expired" });
  assert.equal(w.state(), "on");
  assert.equal(w.why(), null);
});
