/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The booking's words (js/staywords.js). Made-up data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nightsShort, nightsLong, nightLabel, stayArrow, stayDots, stayDayNums, peopleWord, cardCell } from "../js/staywords.js";

test("nights: before, on, after", () => {
  const before = { total: 3, n: 0, state: "before" };
  const on = { total: 3, n: 2, state: "on" };
  const after = { total: 3, n: 3, state: "after" };
  assert.deepEqual([nightsShort(before), nightsShort(on), nightsShort(after)], ["3泊", "2 / 3泊", "3泊"]);
  assert.deepEqual([nightsLong(before), nightsLong(on), nightsLong(after)], ["3 nights", "Night 2 of 3", "3 nights"]);
  assert.deepEqual([nightLabel(before), nightLabel(on), nightLabel(after)], ["Nights", "Night", "Nights"]);
});

test("nights: one night reads the same in every state", () => {
  for (const state of ["before", "on", "after"]) {
    const n = { total: 1, n: state === "before" ? 0 : 1, state };
    assert.equal(nightsShort(n), "1泊");
    assert.equal(nightsLong(n), "1 night");
    assert.equal(nightLabel(n), "Night");
  }
});

test("nights: no total", () => {
  assert.equal(nightsShort({ total: 0, n: 0, state: "before" }), "");
  assert.equal(nightsLong({ total: 0, n: 0, state: "before" }), "");
  assert.equal(nightsShort(null), "");
});

test("stayArrow and stayDots", () => {
  assert.equal(stayArrow({ firstNight: "2026-12-10", lastNight: "2026-12-12" }), "Dec 10 → Dec 13");
  assert.equal(stayDots({ firstNight: "2026-12-10", lastNight: "2026-12-12" }), "12.10 → 12.13");
  assert.equal(stayArrow({ firstNight: "2026-12-09", lastNight: "2026-12-09" }), "Dec 9 → Dec 10");
  assert.equal(stayDots({ firstNight: "2026-12-09", lastNight: "2026-12-09" }), "12.09 → 12.10");
  assert.equal(stayArrow({ firstNight: "2026-12-30", lastNight: "2027-01-01" }), "Dec 30 → Jan 2");
  assert.equal(stayDots({ firstNight: "2026-12-30", lastNight: "2027-01-01" }), "12.30 → 1.02");
  for (const bad of [{}, null, { firstNight: "soon", lastNight: "2026-12-12" }, { firstNight: "2026-12-12", lastNight: "2026-12-10" }]) {
    assert.equal(stayArrow(bad), "");
    assert.equal(stayDots(bad), "");
  }
});

test("stayDayNums", () => {
  const days = [];
  for (let d = 10; d <= 20; d++) days.push({ date: "2026-12-" + d });
  assert.equal(stayDayNums({ firstNight: "2026-12-10", lastNight: "2026-12-12" }, days), "01–03");
  assert.equal(stayDayNums({ firstNight: "2026-12-10", lastNight: "2026-12-10" }, days), "01");
  assert.equal(stayDayNums({ firstNight: "2026-12-05", lastNight: "2026-12-12" }, days), "");
  assert.equal(stayDayNums({ firstNight: "2026-12-19", lastNight: "2026-12-22" }, days), "10");
  assert.equal(stayDayNums({ firstNight: "2026-12-19", lastNight: "2026-12-20" }, days), "10–11");
});

test("peopleWord", () => {
  assert.equal(peopleWord("3"), "3名");
  assert.equal(peopleWord(" 2 adults "), "2 adults");
  assert.equal(peopleWord(""), "");
  assert.equal(peopleWord(undefined), "");
});

test("cardCell", () => {
  assert.deepEqual(cardCell({ tkRef: "TSB-4827-KQ" }, { kind: "ref" }), { jp: "予約番号", en: "Booking no.", value: "TSB-4827-KQ" });
  assert.deepEqual(cardCell({}, { kind: "pics", label: "2 pages" }), { jp: "予約確認書", en: "Confirmation", value: "2 pages" });
  assert.deepEqual(cardCell({ tkName: "M. EXAMPLE" }, { kind: "ref" }), { jp: "予約", en: "Booking", value: "M. EXAMPLE" });
  assert.deepEqual(cardCell({}, { kind: "ref" }), { jp: "予約", en: "Booking", value: "Booked" });
});
