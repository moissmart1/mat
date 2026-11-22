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

test("every ticket says whose it is (window, today, later, used): mine with my seat, all, none with the holders, ref", () => {
  const people = [{ name: "Mo" }, { name: "Ajen" }, { name: "Trenton" }];
  const base = full();
  base.people = people;
  base.tickets = base.tickets.map((t) => (t.who ? { ...t, seat: t.who === "Mo" ? "Car 3 · 7B" : "" } : t));
  // Mo: his own code on c, one code for all on a / d / f, pages on b, references on e, g and y1.
  const c = passCase(base, NOON, { have });
  const all = [c.next, ...c.today, ...c.later, ...c.used];
  assert.ok(all.every((t) => t.whose && typeof t.whose.kind === "string"), "every ticket has whose");
  assert.deepEqual(c.next.whose, { kind: "mine", seat: "Car 3 · 7B", holders: ["Mo", "Ajen", "Trenton"], count: 3 });
  assert.deepEqual(c.today.find((x) => x.id === "d").whose, { kind: "all", seat: "", holders: [], count: 0 });
  assert.deepEqual(c.today.find((x) => x.id === "e").whose, { kind: "ref", seat: "", holders: [], count: 0 });
  assert.equal(c.later.find((x) => x.id === "f").whose.kind, "all");
  assert.equal(c.used.find((x) => x.id === "b").whose.kind, "all", "pages are for all of us");
  assert.equal(c.used.find((x) => x.id === "y1").whose.kind, "ref");
  // Someone with no code of their own on c: none, and who has theirs.
  const zed = passCase({ ...base, me: "Zed", people: [...people, { name: "Zed" }] }, NOON, { have });
  assert.deepEqual(zed.next.whose, { kind: "none", seat: "", holders: ["Mo", "Ajen", "Trenton"], count: 3 });
  // Nobody chosen: nobody's.
  assert.equal(passCase({ ...base, me: null }, NOON, { have }).next.whose.kind, "none");
  // My code with no seat on it: the stop's.
  const noSeat = passCase({ ...base, tickets: full().tickets }, NOON, { have });
  assert.equal(noSeat.next.whose.seat, "Car 3 · 7A");
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

test("a ticket carries its line's ink beside the colour; a stop outside the trip's days has day 0", () => {
  const c = passCase(full(), NOON, { have });
  assert.equal(c.next.colour, "#336699");
  assert.equal(typeof c.next.ink, "string");
  assert.ok(c.next.day >= 1);
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

// ---------- the hook: tonight's stay, when it has a booking (S2 鍵札) ----------

const INN = { id: "inn00001", name: "Tsubame-so Guest House", nameJp: "つばめ荘", firstNight: "2026-12-11", lastNight: "2026-12-13", deleted: false, tkRef: "TSB-4827-KQ", tkName: "", tkPeople: "", tkRoom: "" };
const stayPic = (id, o = {}) => ({ id, stop: "", stay: "inn00001", who: "", seat: "", page: 1, mime: "image/png", ...o });

test("the hook: tonight's stay with its booking, its night; nothing else in the case changes", () => {
  const plain = passCase({ ...full(), stays: [{ ...INN, tkRef: "" }] }, NOON, { have });
  assert.equal(plain.hook, null, "a stay with no booking hangs nothing");
  const withPics = { ...full(), stays: [INN] };
  withPics.tickets = [...withPics.tickets, stayPic("k1"), stayPic("k2", { page: 2 })];
  const c = passCase(withPics, NOON, { have: (id) => have(id) || id === "k1" });
  assert.deepEqual(c.hook, { id: "inn00001", name: "Tsubame-so Guest House", ref: "TSB-4827-KQ", n: 2, total: 3, state: "on", mark: { kind: "pics", label: "2 pages", saved: false } });
  // The same state with and without the stay's pictures: the window, pockets and counts are the same.
  const without = passCase({ ...full(), stays: [INN] }, NOON, { have });
  const strip = (x) => ({ ...x, hook: null });
  assert.deepEqual(strip(c), strip(without));
  assert.deepEqual(strip(c), strip(passCase(full(), NOON, { have })));
  // Facts alone hang it too.
  assert.deepEqual(without.hook.mark, { kind: "ref", label: "Reference", saved: true });
});

test("the hook shows with no stop ticket at all, on the night and at 01:00 the morning after the last, not the day after", () => {
  const s = state({ stops: [stop("a", "2026-12-12", "09:00")], stays: [INN], tickets: [stayPic("k1")] });
  const night2 = passCase(s, NOON, { have });
  assert.equal(night2.empty, true);
  assert.deepEqual([night2.hook.n, night2.hook.total, night2.hook.state], [2, 3, "on"]);
  const late = passCase(s, at("2026-12-14T01:00:00+09:00"), { have });
  assert.deepEqual([late.hook.id, late.hook.n, late.hook.state], ["inn00001", 3, "on"]);
  assert.equal(passCase(s, at("2026-12-14T09:00:00+09:00"), { have }).hook, null);
  assert.equal(passCase(s, at("2026-12-10T20:00:00+09:00"), { have }).hook, null, "not before its first night");
  // A removed stay hangs nothing; nor before migrate.
  assert.equal(passCase({ ...s, stays: [{ ...INN, deleted: true }] }, NOON, { have }).hook, null);
  assert.equal(passCase({ ...s, ticketsReady: false }, NOON, { have }).hook, null);
});

// ---- a day in its own zone and the eve (Dec 9, T1 現地時刻) ----
import { dec9State, seedState, et } from "./fixtures/dec9.js";

test("Dec 9 in its own zone: a boarding pass is not Used at 10:01 Eastern (Japan's midnight has passed)", () => {
  const c = passCase(dec9State(), et("2026-12-09T10:01"));
  assert.equal(c.date, "2026-12-09");
  assert.equal(c.next.id, "dec9stop0902", "the first flight is still in the window");
  assert.deepEqual(ids(c.today), ["dec9stop0903"]);
  assert.deepEqual(ids(c.used), ["dec9stop0801"], "only the eve's train");
});

test("Dec 9 at 11:45 Eastern: the first flight is Used, the second in the window; at 12:50 both are Used", () => {
  const c = passCase(dec9State(), et("2026-12-09T11:45"));
  assert.equal(c.next.id, "dec9stop0903");
  assert.equal(c.next.lead, "In 35 min");
  assert.deepEqual(ids(c.used), ["dec9stop0902", "dec9stop0801"]);
  const after = passCase(dec9State(), et("2026-12-09T12:50"));
  assert.equal(after.date, "2026-12-10");
  assert.equal(after.next, null);
  assert.deepEqual(ids(after.used), ["dec9stop0903", "dec9stop0902", "dec9stop0801"]);
});

test("the eve's tickets stand by date, with no day number; on the eve the train is in the window", () => {
  const c = passCase(dec9State(), et("2026-12-08T17:00"));
  assert.equal(c.date, "2026-12-08");
  assert.equal(c.on, true);
  assert.deepEqual([c.next.id, c.next.day, c.next.lead], ["dec9stop0801", 0, "In 10 min"]);
  assert.deepEqual(ids(c.later), ["dec9stop0902", "dec9stop0903"]);
  assert.equal(passCase(dec9State(), et("2026-12-09T07:00")).later.length, 0);
  assert.equal(passCase(dec9State(), et("2026-12-09T07:00")).today[0].day, 1, "Dec 9 is Day 1");
});

test("tripStarted from the eve when there is one, by the Days clock; else from the first day", () => {
  assert.equal(tripStarted(dec9State(), et("2026-12-07T23:59")), false, "Dec 8 in Japan, still Dec 7 in Eastern");
  assert.equal(tripStarted(dec9State(), et("2026-12-08T00:00")), true, "the eve has begun");
  assert.equal(tripStarted(dec9State({ eves: [] }), et("2026-12-08T17:00")), false, "no eve: from Dec 9");
  assert.equal(tripStarted(dec9State({ eves: [] }), et("2026-12-09T00:00")), true);
  // The 11-day trip, unchanged: from Dec 10 in Japan.
  assert.equal(tripStarted(seedState(), at("2026-12-09T23:59:00+09:00")), false);
  assert.equal(tripStarted(seedState(), at("2026-12-10T00:00:00+09:00")), true);
});
