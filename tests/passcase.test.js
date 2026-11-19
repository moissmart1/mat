/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The Tickets tab's pass case (定期入れ): which ticket is in the window, what
// stands in each pocket, the counts, and when the Tickets key takes Before's
// place. Every stop, picture and reference here is made up.
import test from "node:test";
import assert from "node:assert/strict";
import { passCase, tripStarted } from "../js/passcase.js";

const TZ = "Asia/Tokyo";
const TRIP = { name: "Trip", start: "2026-12-10", end: "2026-12-20", tz: TZ };
const DAYS = Array.from({ length: 11 }, (_, i) => ({ date: "2026-12-" + (10 + i), lineJp: "線", lineEn: "Line", lineColour: "#336699" }));
const at = (iso) => Date.parse(iso);
const stop = (id, date, time, o = {}) => ({ id, date, time, title: "Stop " + id, detail: "", place: "", travelMin: 0, deleted: false, tkRef: "", tkName: "", tkPeople: "", tkSeat: "", ...o });
const pic = (id, stopId, o = {}) => ({ id, stop: stopId, who: "", seat: "", page: 1, mime: "image/png", ...o });
const state = (o = {}) => ({ status: "ready", me: "Mo", trip: TRIP, days: DAYS, stops: [], tickets: [], ticketsReady: true, ...o });
// 13:20 on Dec 12 in Japan: Day 3.
const NOON = at("2026-12-12T13:20:00+09:00");
const ids = (list) => list.map((x) => x.id);

// A day with every kind: two used today, the next, two more today, two later, one the day before.
function full() {
  return state({
    stops: [
      stop("y1", "2026-12-11", "18:30", { tkRef: "TEST-0001" }),
      stop("a", "2026-12-12", "09:00"),
      stop("b", "2026-12-12", "12:30"),
      stop("c", "2026-12-12", "14:00", { travelMin: 30, tkSeat: "Car 3 · 7A" }),
      stop("plain", "2026-12-12", "15:00"),
      stop("d", "2026-12-12", "17:00"),
      stop("e", "2026-12-12", "19:00", { tkRef: "TEST-0412" }),
      stop("f", "2026-12-13", "10:08"),
      stop("g", "2026-12-15", "", { tkRef: "TEST-1500" }),
      stop("gone", "2026-12-13", "11:00", { deleted: true, tkRef: "TEST-9" }),
    ],
    tickets: [
      pic("pa", "a"),
      pic("pb1", "b", { page: 1 }),
      pic("pb2", "b", { page: 2 }),
      pic("pc1", "c", { who: "Ajen", page: 1 }),
      pic("pc2", "c", { who: "Mo", page: 1 }),
      pic("pc3", "c", { who: "Trenton", page: 1 }),
      pic("pd", "d", { mime: "image/jpeg" }),
      pic("pf", "f"),
      pic("pgone", "gone"),
      pic("old", "f", { gone: true }),
    ],
  });
}
const KEPT = new Set(["pa", "pb1", "pb2", "pc1", "pc2", "pc3", "pf"]);
const have = (id) => KEPT.has(id);

test("the window holds the next ticket not yet used; it is the day's next stop once its time has come and gone within the grace", () => {
  const c = passCase(full(), NOON, { have });
  assert.equal(c.on, true);
  assert.equal(c.date, "2026-12-12");
  assert.equal(c.next.id, "c");
  // 14:10: Sky started ten minutes ago and is still the day's next stop (R38): still in the window.
  assert.equal(passCase(full(), at("2026-12-12T14:10:00+09:00"), { have }).next.id, "c");
  // 14:31: over; the next is d.
  assert.equal(passCase(full(), at("2026-12-12T14:31:00+09:00"), { have }).next.id, "d");
});

test("the pockets: today after the window, later days soonest first, used most recent first; a removed stop is never in the case", () => {
  const c = passCase(full(), NOON, { have });
  assert.deepEqual(ids(c.today), ["d", "e"]);
  assert.deepEqual(ids(c.later), ["f", "g"]);
  assert.deepEqual(ids(c.used), ["b", "a", "y1"]);
  assert.ok(![c.next, ...c.today, ...c.later, ...c.used].some((x) => x.id === "gone" || x.id === "plain"));
});

test("the counts: to come is every ticket not used, today left counts the window's when it is today's", () => {
  const c = passCase(full(), NOON, { have });
  assert.equal(c.toCome, 5); // c, d, e, f, g
  assert.equal(c.todayLeft, 3); // c, d, e
  // Evening: only later days remain; the window holds f and today has none left.
  const eve = passCase(full(), at("2026-12-12T21:00:00+09:00"), { have });
  assert.equal(eve.next.id, "f");
  assert.equal(eve.todayLeft, 0);
  assert.equal(eve.toCome, 2);
  assert.deepEqual(ids(eve.later), ["g"], "the window's ticket is not in a pocket as well");
  assert.deepEqual(ids(eve.used), ["e", "d", "c", "b", "a", "y1"]);
});

test("the three kinds of status: pictures on this phone, pictures still to fetch, reference only", () => {
  const c = passCase(full(), NOON, { have });
  assert.deepEqual(c.next.status, { kind: "have", label: "3 codes", ref: "" });
  const d = c.today.find((x) => x.id === "d");
  assert.deepEqual(d.status, { kind: "needs", label: "1 code", ref: "" });
  const e = c.today.find((x) => x.id === "e");
  assert.deepEqual(e.status, { kind: "ref", label: "Reference only", ref: "TEST-0412" });
  assert.deepEqual(c.used.find((x) => x.id === "b").status, { kind: "have", label: "2 pages", ref: "" });
  // One of three still to fetch: the stop needs signal once.
  const part = passCase(full(), NOON, { have: (id) => id !== "pc3" && KEPT.has(id) });
  assert.equal(part.next.status.kind, "needs");
});

test("a ticket's fields: time, title, detail, seat, the day's number and line, the first picture only when it is on this phone", () => {
  const c = passCase(full(), NOON, { have });
  const n = c.next;
  assert.equal(n.time, "14:00");
  assert.equal(n.title, "Stop c");
  assert.equal(n.seat, "Car 3 · 7A");
  assert.equal(n.day, 3);
  assert.deepEqual(n.line, { jp: "線", en: "Line" });
  assert.equal(n.colour, "#336699");
  // This phone's person's code first (Mo), as the stub opens on it.
  assert.equal(n.first, "pc2");
  assert.equal(c.today.find((x) => x.id === "d").first, null, "not on this phone: no picture");
  assert.equal(c.today.find((x) => x.id === "e").first, null, "reference only: no picture");
});

test("the window's lead line comes from the existing leave-by: travel minutes, or where you are; none for a later day", () => {
  const c = passCase(full(), NOON, { have });
  assert.equal(c.next.lead, "Leave by 13:30 · in 10 min");
  const started = passCase(full(), at("2026-12-12T14:05:00+09:00"), { have });
  assert.equal(started.next.lead, "Now");
  const eve = passCase(full(), at("2026-12-12T21:00:00+09:00"), { have });
  assert.equal(eve.next.lead, null);
  assert.equal(c.today[0].lead, null, "only the window has a lead line");
});

test("empty: no ticket on any stop, or tickets not loaded yet", () => {
  const none = passCase(state({ stops: [stop("a", "2026-12-12", "09:00")] }), NOON, { have });
  assert.equal(none.empty, true);
  assert.equal(none.next, null);
  assert.deepEqual([none.toCome, none.todayLeft, none.today.length, none.later.length, none.used.length], [0, 0, 0, 0, 0]);
  const notReady = passCase({ ...full(), ticketsReady: false }, NOON, { have });
  assert.equal(notReady.empty, true);
});

test("all used (after the last ticket): no window, everything in the back pocket, not empty", () => {
  const c = passCase(full(), at("2026-12-21T09:00:00+09:00"), { have });
  assert.equal(c.next, null);
  assert.equal(c.empty, false);
  assert.equal(c.toCome, 0);
  assert.deepEqual(ids(c.used), ["g", "f", "e", "d", "c", "b", "a", "y1"]);
});

test("the day-1 switch: off before the trip's first day in its own zone, on from 00:00 that day, and after the trip", () => {
  assert.equal(tripStarted(full(), at("2026-12-09T23:59:00+09:00")), false);
  assert.equal(tripStarted(full(), at("2026-12-10T00:00:00+09:00")), true);
  assert.equal(tripStarted(full(), at("2026-12-25T12:00:00+09:00")), true);
  // 23:30 on Dec 9 in Toronto is already Dec 10 in Japan: the trip's zone decides.
  assert.equal(tripStarted(full(), at("2026-12-09T23:30:00-05:00")), true);
  assert.equal(passCase(full(), at("2026-12-09T23:59:00+09:00"), { have }).on, false);
  // Not loaded, no trip, no start: off.
  assert.equal(tripStarted({ status: "loading" }, NOON), false);
  assert.equal(tripStarted(state({ trip: { name: "x" } }), NOON), false);
  assert.equal(tripStarted(null, NOON), false);
});

test("an untimed stop today is never used before the day is over; it stands after the timed ones", () => {
  const s = full();
  s.stops.push(stop("h", "2026-12-12", "", { tkRef: "TEST-77" }));
  const c = passCase(s, at("2026-12-12T23:00:00+09:00"), { have });
  assert.equal(c.next.id, "h");
  assert.equal(c.next.time, "");
  assert.equal(c.todayLeft, 1);
});

test("a blank or odd row from the Sheet does not break it", () => {
  const s = full();
  s.stops.push(null, { id: "", date: "2026-12-12" }, { id: "x" }, stop("odd", "2026-12-12", "25:99", { tkRef: "TEST-5" }));
  s.tickets.push(null, { id: "nostop" });
  const c = passCase(s, NOON, { have });
  assert.equal(c.next.id, "c");
  assert.ok(c.today.some((x) => x.id === "odd"), "an odd time is treated as no time");
});
