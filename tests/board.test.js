/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The departure board's rules: what it says and when it is there, and the
// closed-until-tomorrow rule across midnight and time zones. Every name here
// is made up.
import test from "node:test";
import assert from "node:assert/strict";
import { boardFor, tidyLine, closedDate, isClosed, BOARD_KEY, RUN, overBy, runMs } from "../js/board.js";
import { tripNow } from "../js/plan.js";
import { dec9State, et } from "./fixtures/dec9.js";

const TZ = "Asia/Tokyo";
const TRIP = { name: "Trip", start: "2026-12-10", end: "2026-12-20", tz: TZ };
const DAYS = Array.from({ length: 11 }, (_, i) => ({ date: "2026-12-" + (10 + i) }));
const at = (iso) => Date.parse(iso);
const todo = (o) => ({ id: "1", item: "Rail seats", bookBy: "", status: "", note: "", link: "", claimedBy: "", tickedBy: "", tickedAt: "", done: false, ...o });
const stop = (id, time, o = {}) => ({ id, date: "2026-12-12", time, title: id, place: "", travelMin: 0, deleted: false, ...o });
const state = (o = {}) => ({ status: "ready", me: "Mo", trip: TRIP, days: DAYS, stops: [], todos: [], plannerLinked: true, ...o });

// ---- before the trip ----
test("before the trip: the days to go and the next booking, earliest book-by first", () => {
  const s = state({ todos: [todo({ id: "2", item: "Ryokan", bookBy: "2026-11-30" }), todo({ id: "1", item: "Rail seats", bookBy: "2026-11-20", claimedBy: "Mo" })] });
  // 12:00 on Nov 17 in Japan is 22:00 on Nov 16 in Toronto.
  assert.deepEqual(boardFor(s, at("2026-11-17T12:00:00+09:00")), { kind: "before", small: "出発まで", big: "23", unit: "日", l1: "Book next: Rail seats", l2: "By Fri Nov 20 · You’re on it" });
});

test("before the trip: someone else on it is named; nobody on it says only the date; no date and nobody says nothing", () => {
  const now = at("2026-11-17T12:00:00+09:00");
  assert.equal(boardFor(state({ todos: [todo({ bookBy: "2026-11-20", claimedBy: "Ajen" })] }), now).l2, "By Fri Nov 20 · Ajen is on it");
  assert.equal(boardFor(state({ todos: [todo({ bookBy: "2026-11-20" })] }), now).l2, "By Fri Nov 20");
  assert.equal(boardFor(state({ todos: [todo({})] }), now).l2, "");
});

test("before the trip: a late booking says how late, counted on the Toronto calendar like the list", () => {
  const now = at("2026-11-17T12:00:00+09:00"); // Nov 16 in Toronto
  assert.equal(boardFor(state({ todos: [todo({ bookBy: "2026-11-14" })] }), now).l2, "Was due Sat Nov 14 · 2 days late");
});

test("before the trip: done items are not next; nothing open, no planner or no list: no board", () => {
  const now = at("2026-11-17T12:00:00+09:00");
  const s = state({ todos: [todo({ id: "1", status: "Booked", bookBy: "2026-11-18" }), todo({ id: "2", item: "Open one", bookBy: "2026-11-25" }), todo({ id: "3", tickedBy: "Ajen", bookBy: "2026-11-19" })] });
  assert.equal(boardFor(s, now).l1, "Book next: Open one");
  assert.equal(boardFor(state({ todos: [todo({ status: "Booked" })] }), now), null);
  assert.equal(boardFor(state({ todos: [] }), now), null);
  assert.equal(boardFor(state({ todos: undefined }), now), null);
  assert.equal(boardFor(state({ plannerLinked: false, todos: [todo({})] }), now), null);
  assert.equal(boardFor(state({ plannerLinked: undefined, todos: [todo({})] }), now), null);
});

test("before the trip: the day count is the trip zone's, the last day before it is 1", () => {
  const s = state({ todos: [todo({ bookBy: "2026-12-01" })] });
  assert.equal(boardFor(s, at("2026-12-09T23:59:00+09:00")).big, "1");
  assert.equal(boardFor(s, at("2026-12-09T00:00:00+09:00")).big, "1");
  assert.equal(boardFor(s, at("2026-11-10T08:00:00+09:00")).big, "30");
});

test("before the trip: a row with no id or no item is not a booking", () => {
  const now = at("2026-11-17T12:00:00+09:00");
  const s = state({ todos: [{ id: "", item: "No id" }, { id: "4", item: 5 }, null, todo({ id: "5", item: "  Padded  " })] });
  assert.equal(boardFor(s, now).l1, "Book next: Padded");
});

// ---- during the trip ----
test("on a trip day: the next stop, its time, and the leave line the ticket prints", () => {
  const s = state({ stops: [stop("a", "09:00"), stop("b", "14:20", { title: "Yudanaka", travelMin: 30 }), stop("c", "19:00")] });
  // 13:12 on Dec 12 in Japan.
  assert.deepEqual(boardFor(s, at("2026-12-12T13:12:00+09:00")), { kind: "trip", small: "次 Next", big: "14:20", unit: "", l1: "Yudanaka", l2: "Leave by 13:50 · in 38 min" });
  assert.equal(boardFor(s, at("2026-12-12T13:55:00+09:00")).l2, "Leave now");
  assert.equal(boardFor(s, at("2026-12-12T14:25:00+09:00")).l2, "Now", "a stop just started is still next (R38)");
});

test("on a trip day: a stop with no travel minutes counts down to its time", () => {
  const s = state({ stops: [stop("b", "14:20")] });
  assert.equal(boardFor(s, at("2026-12-12T14:00:00+09:00")).l2, "In 20 min");
  assert.equal(boardFor(s, at("2026-12-12T13:20:00+09:00")).l2, "In 1 h");
});

test("on a trip day: with a usable position, the line is the ticket's from-where-you-are line", () => {
  // About 1 km away: the same rule the ticket asks (plan.js hereLine).
  const s = state({ stops: [stop("b", "14:20", { lat: 35.68, lng: 139.77, travelMin: 5 })] });
  const here = { lat: 35.689, lng: 139.77, at: 0, accuracy: 20 };
  const l = boardFor(s, at("2026-12-12T13:12:00+09:00"), here).l2;
  assert.match(l, /^Leave by \d\d:\d\d · in \d+ min$/);
  assert.notEqual(l, boardFor(s, at("2026-12-12T13:12:00+09:00")).l2, "not the plain travel-minutes line");
  // Too far (a train away): the plain line stands.
  assert.equal(boardFor(s, at("2026-12-12T13:12:00+09:00"), { lat: 36.5, lng: 139.77, at: 0, accuracy: 20 }).l2, boardFor(s, at("2026-12-12T13:12:00+09:00")).l2);
});

test("on a trip day: a stop without a title says Next stop; the title is trimmed", () => {
  assert.equal(boardFor(state({ stops: [stop("b", "14:20", { title: "" })] }), at("2026-12-12T13:12:00+09:00")).l1, "Next stop");
  assert.equal(boardFor(state({ stops: [stop("b", "14:20", { title: "  Shrine  " })] }), at("2026-12-12T13:12:00+09:00")).l1, "Shrine");
});

test("on a trip day: no timed stop still to come, deleted or other days' stops, or a day with no ticket: no board", () => {
  const now = at("2026-12-12T13:12:00+09:00");
  assert.equal(boardFor(state({ stops: [] }), now), null);
  assert.equal(boardFor(state({ stops: [stop("a", "09:00")] }), now), null, "the day is over");
  assert.equal(boardFor(state({ stops: [stop("a", "")] }), now), null, "only untimed stops");
  assert.equal(boardFor(state({ stops: [stop("a", "15:00", { deleted: true })] }), now), null);
  assert.equal(boardFor(state({ stops: [stop("a", "15:00", { date: "2026-12-13" })] }), now), null);
  assert.equal(boardFor(state({ days: DAYS.filter((d) => d.date !== "2026-12-12"), stops: [stop("a", "15:00")] }), now), null, "no ticket for today");
});

test("the trip day is the trip zone's: just after midnight in Japan it is already the next day", () => {
  const s = state({ stops: [stop("a", "09:00", { date: "2026-12-13", title: "Breakfast" })] });
  assert.equal(boardFor(s, at("2026-12-13T00:30:00+09:00")).l1, "Breakfast"); // Dec 12 in Toronto
  assert.equal(boardFor(s, at("2026-12-12T23:30:00+09:00")), null);
});

test("after the trip, and when not ready: no board", () => {
  const s = state({ stops: [stop("a", "15:00", { date: "2026-12-21" })], todos: [todo({})] });
  assert.equal(boardFor(s, at("2026-12-21T10:00:00+09:00")), null);
  assert.equal(boardFor(state({ status: "loading" }), at("2026-12-12T13:12:00+09:00")), null);
  assert.equal(boardFor(state({ trip: null }), at("2026-12-12T13:12:00+09:00")), null);
  assert.equal(boardFor(null, 0), null);
});

test("tidyLine: one line, the board's own words", () => {
  assert.equal(tidyLine("Leave by 13:50, in 38 min."), "Leave by 13:50 · in 38 min");
  assert.equal(tidyLine("Leave now."), "Leave now");
  assert.equal(tidyLine("Now."), "Now");
  assert.equal(tidyLine("Next, in 12 min."), "In 12 min");
  assert.equal(tidyLine("Leave now. 4 min to spare."), "Leave now · 4 min to spare");
  assert.equal(tidyLine("About 5 min late. Leave now."), "About 5 min late · Leave now");
  assert.equal(tidyLine(""), "");
  assert.equal(tidyLine(undefined), "");
});

// ---- closed until tomorrow ----
// The date kept and compared is the Days clock's (tripNow): the trip's zone,
// or a zoned day's own.
const day = (s, ms) => tripNow(s, ms).date;

test("a closed board is kept as the date it was closed on, by the Days clock", () => {
  assert.equal(BOARD_KEY, "mat.board");
  // 23:50 on Dec 12 in Japan is 09:50 on Dec 12 in Toronto: same date there. 00:10 on the 13th in Japan is still Dec 12 in Toronto.
  assert.equal(closedDate(day(state(), at("2026-12-12T23:50:00+09:00"))), "2026-12-12");
  assert.equal(closedDate(day(state(), at("2026-12-13T00:10:00+09:00"))), "2026-12-13");
  assert.equal(closedDate(day(state({ trip: { ...TRIP, tz: "" } }), at("2026-12-13T00:10:00+09:00"))), "2026-12-13", "no zone: Japan");
  assert.equal(closedDate(undefined), "");
});

test("closed today, back tomorrow: the board is back across the trip zone's midnight, not the phone's", () => {
  const s = state();
  const kept = closedDate(day(s, at("2026-12-12T22:00:00+09:00")));
  assert.equal(isClosed(kept, day(s, at("2026-12-12T22:00:01+09:00"))), true);
  assert.equal(isClosed(kept, day(s, at("2026-12-12T23:59:59+09:00"))), true);
  assert.equal(isClosed(kept, day(s, at("2026-12-13T00:00:00+09:00"))), false, "midnight in Japan: back");
  // A phone still on Toronto time at 11 am on Dec 12 (01:00 on the 13th in Japan): the trip's day has turned, so the board is back.
  assert.equal(isClosed(kept, day(s, at("2026-12-12T11:00:00-05:00"))), false);
  assert.equal(isClosed(kept, day(s, at("2026-12-12T08:00:00-05:00"))), true, "22:00 in Japan on the 12th, still closed");
});

test("what was kept that is not today's date never closes the board", () => {
  const today = day(state(), at("2026-12-12T12:00:00+09:00"));
  for (const kept of [null, undefined, "", "yes", 20261212, "2026-12-11", "2026-12-13", "2026-12-12 "]) assert.equal(isClosed(kept, today), false, String(kept));
  assert.equal(isClosed("2026-12-12", today), true);
  assert.equal(isClosed("", ""), false, "no date: never closed");
});

// ---- a day in its own zone (Dec 9, T1 現地時刻) ----
test("on a day in its own zone the board says 次 Next · 現地, with that place's times", () => {
  const s = dec9State({ todos: [], plannerLinked: true });
  const b = boardFor(s, et("2026-12-09T07:00"));
  assert.deepEqual(b, { kind: "trip", small: "次 Next · 現地", big: "07:30", unit: "", l1: "Hotel shuttle to the airport", l2: "Leave by 07:25 · in 25 min" });
  const late = boardFor(s, et("2026-12-09T11:45"));
  assert.deepEqual([late.small, late.big, late.l1, late.l2], ["次 Next · 現地", "12:20", "Flight ZZ 7 to Tokyo", "In 35 min"], "still Day 1 after Japan's midnight");
  const after = boardFor(s, et("2026-12-09T12:50"));
  assert.deepEqual([after.small, after.big, after.l1], ["次 Next", "16:35", "Land in Tokyo, Terminal 3"], "Day 2, on Japan's clock");
  // The evening before: the before-the-trip board, one day to go.
  const eve = boardFor(dec9State({ plannerLinked: true, todos: [todo({ item: "Rail seats" })] }), et("2026-12-08T17:00"));
  assert.deepEqual([eve.kind, eve.big, eve.small], ["before", "1", "出発まで"]);
  assert.equal(boardFor(dec9State({ plannerLinked: true }), et("2026-12-08T17:00")), null, "nothing to book: no board");
});

test("closed on Day 1 in its own zone: closed until the Days clock's day turns, not Japan's midnight", () => {
  const s = dec9State();
  const kept = closedDate(day(s, et("2026-12-09T07:05")));
  assert.equal(kept, "2026-12-09");
  assert.equal(isClosed(kept, day(s, et("2026-12-09T10:01"))), true, "Japan's midnight passed at 10:00: still Day 1, still closed");
  assert.equal(isClosed(kept, day(s, et("2026-12-09T12:49"))), true);
  assert.equal(isClosed(kept, day(s, et("2026-12-09T12:50"))), false, "Day 2: back");
});

// ---- a long line runs sideways (issue 75) ----
test("overBy: words that fit, or stick out by 1 px or less, are 0; otherwise the whole px they stick out, rounded up", () => {
  assert.equal(overBy(200, 300), 0);
  assert.equal(overBy(300, 300), 0);
  assert.equal(overBy(301, 300), 0, "1 px of rounding is forgiven");
  assert.equal(overBy(300.9, 300), 0);
  assert.equal(overBy(301.1, 300), 2, "rounded up");
  assert.equal(overBy(396, 300), 96);
  assert.equal(overBy(396.2, 300), 97);
});

test("runMs: 48 px a second (96 px is 2000 ms, 150 px is 3125 ms, 0 is 0)", () => {
  assert.equal(runMs(96), 2000);
  assert.equal(runMs(150), 3125);
  assert.equal(runMs(0), 0);
});

test("RUN: hold 2000, end 2000, dark 250, 48 px a second", () => {
  assert.deepEqual(RUN, { hold: 2000, pxs: 48, end: 2000, dark: 250 });
});
