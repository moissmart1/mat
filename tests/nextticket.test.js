/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Your next ticket in the slot above the bar (js/nextticket.js slotModel):
// which ticket, and every word on it, for each whose. Every stop, seat,
// picture and reference here is made up.
import test from "node:test";
import assert from "node:assert/strict";
import { slotModel, LABELS } from "../js/nextticket.js";
import { passCase } from "../js/passcase.js";

const TZ = "Asia/Tokyo";
const TRIP = { name: "Trip", start: "2026-12-10", end: "2026-12-20", tz: TZ };
const DAYS = Array.from({ length: 11 }, (_, i) => ({ date: "2026-12-" + (10 + i), lineJp: "線", lineEn: "Line", lineColour: "#9ACD32" }));
const PEOPLE = [{ name: "Mo" }, { name: "Ajen" }, { name: "Trenton" }];
const at = (iso) => Date.parse(iso);
const stop = (id, date, time, o = {}) => ({ id, date, time, title: "Shibuya Sky", detail: "", place: "", travelMin: 0, deleted: false, tkRef: "", tkName: "", tkPeople: "", tkSeat: "", ...o });
const pic = (id, stopId, o = {}) => ({ id, stop: stopId, who: "", seat: "", page: 1, mime: "image/png", ...o });
const state = (o = {}) => ({ status: "ready", me: "Ajen", people: PEOPLE, trip: TRIP, days: DAYS, stops: [], tickets: [], ticketsReady: true, ...o });
const have = () => true;
// 13:20 on Sat Dec 12 in Japan (Day 3); and three weeks before the trip.
const NOON = at("2026-12-12T13:20:00+09:00");
const BEFORE = at("2026-11-21T10:00:00+09:00");

// Shibuya Sky at 14:00, 30 min to get there, with three per-person codes.
const sky = (o = {}, pics = null) =>
  state({
    stops: [stop("sky", "2026-12-12", "14:00", { travelMin: 30, tkSeat: "Car 7 · 10A–C", ...o })],
    tickets: pics || [pic("m", "sky", { who: "Mo", seat: "Car 7 · 10A" }), pic("a", "sky", { who: "Ajen", seat: "Car 7 · 10B" }), pic("t", "sky", { who: "Trenton", seat: "Car 7 · 10C" })],
  });

test("the labels: whose in words, the Japanese apart", () => {
  assert.deepEqual(LABELS, {
    mine: { jp: "あなたの切符", en: "Your next ticket" },
    all: { jp: "全員", en: "Next ticket · all of us" },
    ref: { jp: "番号のみ", en: "Next ticket · reference only" },
    none: { jp: "つぎの切符", en: "Next ticket" },
  });
});

test("mine, another day (before the trip): the date, time and my seat; no tag", () => {
  const m = slotModel(sky(), BEFORE, { have });
  assert.equal(m.id, "sky");
  assert.equal(m.whose.kind, "mine");
  assert.deepEqual(m.label, LABELS.mine);
  assert.equal(m.tag, "");
  assert.equal(m.title, "Shibuya Sky");
  assert.equal(m.line, "Sat Dec 12 · 14:00 · Car 7 · 10B");
  assert.equal(m.aria, "Show your ticket: Shibuya Sky, Sat Dec 12 14:00, Car 7 · 10B");
  assert.equal(m.colour, "#9ACD32");
  assert.equal(typeof m.ink, "string");
});

test("mine, today with a leave line: こんど, the lead as the case prints it, nothing else", () => {
  const m = slotModel(sky(), NOON, { have });
  assert.equal(m.tag, "こんど");
  assert.equal(m.line, "Leave by 13:30 · in 10 min");
  assert.equal(m.line, passCase(sky(), NOON, { have }).next.lead, "one source with the pass case");
  assert.equal(m.aria, "Show your ticket: Shibuya Sky, Leave by 13:30 · in 10 min, Car 7 · 10B");
});

test("today with no leave line (no time): Today and the seat", () => {
  const m = slotModel(sky({ time: "" }), NOON, { have });
  assert.equal(m.tag, "こんど");
  assert.equal(m.line, "Today · Car 7 · 10B");
  assert.equal(m.aria, "Show your ticket: Shibuya Sky, today, Car 7 · 10B");
});

test("no seat anywhere: the line and the label end at the time; no time on another day: the date alone", () => {
  const bare = [pic("m", "sky", { who: "Mo" }), pic("a", "sky", { who: "Ajen" })];
  const m = slotModel(sky({ tkSeat: "" }, bare), BEFORE, { have });
  assert.equal(m.line, "Sat Dec 12 · 14:00");
  assert.equal(m.aria, "Show your ticket: Shibuya Sky, Sat Dec 12 14:00");
  const untimed = slotModel(sky({ tkSeat: "", time: "" }, bare), BEFORE, { have });
  assert.equal(untimed.line, "Sat Dec 12");
  assert.equal(untimed.aria, "Show your ticket: Shibuya Sky, Sat Dec 12");
  // My own picture has no seat: the stop's.
  const stops = slotModel(sky({}, bare), BEFORE, { have });
  assert.equal(stops.line, "Sat Dec 12 · 14:00 · Car 7 · 10A–C");
  // Today, no time and no seat: Today.
  assert.equal(slotModel(sky({ tkSeat: "", time: "" }, bare), NOON, { have }).line, "Today");
});

test("all of us: one code for everyone, with the stop's seat", () => {
  const m = slotModel(sky({}, [pic("o", "sky")]), BEFORE, { have });
  assert.equal(m.whose.kind, "all");
  assert.deepEqual(m.label, LABELS.all);
  assert.equal(m.line, "Sat Dec 12 · 14:00 · Car 7 · 10A–C");
  assert.equal(m.aria, "Show the ticket for all of us: Shibuya Sky, Sat Dec 12 14:00, Car 7 · 10A–C");
  const today = slotModel(sky({}, [pic("o", "sky")]), NOON, { have });
  assert.equal(today.line, "Leave by 13:30 · in 10 min");
  assert.equal(today.aria, "Show the ticket for all of us: Shibuya Sky, Leave by 13:30 · in 10 min, Car 7 · 10A–C");
});

test("reference only: the facts, no picture", () => {
  const m = slotModel(sky({ tkRef: "TEST-0412", tkSeat: "Table 4" }, []), BEFORE, { have });
  assert.equal(m.whose.kind, "ref");
  assert.deepEqual(m.label, LABELS.ref);
  assert.equal(m.line, "Sat Dec 12 · 14:00 · Table 4");
  assert.equal(m.aria, "Show the booking reference: Shibuya Sky, Sat Dec 12 14:00, Table 4");
});

test("none for you yet: others have codes, you have none; shown on purpose", () => {
  const two = [pic("m", "sky", { who: "Mo", seat: "Car 7 · 10A" }), pic("t", "sky", { who: "Trenton", seat: "Car 7 · 10C" })];
  const m = slotModel(sky({}, two), BEFORE, { have });
  assert.equal(m.whose.kind, "none");
  assert.deepEqual(m.whose.holders, ["Mo", "Trenton"]);
  assert.deepEqual(m.label, LABELS.none);
  assert.equal(m.line, "Sat Dec 12 · 14:00 · none for you yet");
  assert.equal(m.aria, "Show ticket: Shibuya Sky, Sat Dec 12 14:00, no code for you yet");
  const today = slotModel(sky({}, two), NOON, { have });
  assert.equal(today.line, "Leave by 13:30 · in 10 min · none for you yet");
  assert.equal(today.aria, "Show ticket: Shibuya Sky, Leave by 13:30 · in 10 min, no code for you yet");
  assert.equal(slotModel(sky({ time: "" }, two), NOON, { have }).line, "Today · none for you yet");
  // Nobody chosen on this phone: nobody's.
  assert.equal(slotModel({ ...sky(), me: null }, BEFORE, { have }).whose.kind, "none");
});

test("no title: Ticket", () => {
  assert.equal(slotModel(sky({ title: "" }), BEFORE, { have }).title, "Ticket");
});

test("the slot moves on: past the stop, the next ticket; all used, none; nothing at all, none", () => {
  const s = state({
    stops: [stop("sky", "2026-12-12", "14:00", { tkRef: "TEST-1" }), stop("tea", "2026-12-12", "17:00", { title: "Tea ceremony" }), stop("nara", "2026-12-13", "10:08", { title: "Limited express to Nara" })],
    tickets: [pic("o", "tea"), pic("n", "nara", { who: "Ajen" })],
  });
  assert.equal(slotModel(s, NOON, { have }).id, "sky");
  assert.equal(slotModel(s, at("2026-12-12T14:31:00+09:00"), { have }).id, "tea");
  const later = slotModel(s, at("2026-12-12T19:00:00+09:00"), { have });
  assert.equal(later.id, "nara");
  assert.equal(later.tag, "", "not today's: no tag");
  assert.equal(later.line, "Sun Dec 13 · 10:08");
  assert.equal(slotModel(s, at("2026-12-13T12:00:00+09:00"), { have }), null, "every ticket used");
  assert.equal(slotModel(s, at("2026-12-22T12:00:00+09:00"), { have }), null, "after the trip");
  assert.equal(slotModel(state({ stops: [stop("a", "2026-12-12", "09:00")] }), BEFORE, { have }), null, "no ticket at all");
  assert.equal(slotModel({ ...s, ticketsReady: false }, BEFORE, { have }), null, "tickets not loaded");
  assert.equal(slotModel({ status: "nokey" }, BEFORE, { have }), null, "no trip key");
  assert.equal(slotModel(null, BEFORE, { have }), null);
});
