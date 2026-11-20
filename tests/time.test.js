import test from "node:test";
import assert from "node:assert/strict";
import { tripDay, defaultRingDay, newId } from "../js/time.js";

const trip = { start: "2026-12-10", end: "2026-12-20", tz: "Asia/Tokyo" };
const BEFORE = Date.UTC(2026, 10, 14, 12);
const DURING = Date.UTC(2026, 11, 11, 18); // 03:00 Dec 12 in Tokyo
const AFTER = Date.UTC(2026, 11, 20, 15); // 00:00 Dec 21 in Tokyo

test("tripDay is pre before the trip", () => {
  assert.equal(tripDay(trip, BEFORE), "pre");
});

test("tripDay is the Tokyo date during the trip", () => {
  assert.equal(tripDay(trip, DURING), "2026-12-12");
});

test("tripDay is post once Tokyo has passed the last day", () => {
  assert.equal(tripDay(trip, AFTER), "post");
});

test("tripDay counts the first and last day as inside the trip", () => {
  assert.equal(tripDay(trip, Date.UTC(2026, 11, 9, 15)), "2026-12-10"); // 00:00 Dec 10 Tokyo
  assert.equal(tripDay(trip, Date.UTC(2026, 11, 20, 14, 59)), "2026-12-20"); // 23:59 Dec 20 Tokyo
});

test("defaultRingDay is pre before, today during and the last day after the trip", () => {
  assert.equal(defaultRingDay(trip, BEFORE), "pre");
  assert.equal(defaultRingDay(trip, DURING), "2026-12-12");
  assert.equal(defaultRingDay(trip, AFTER), "2026-12-20");
});

test("newId gives 20 letters and digits that pass the backend's id rule", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const id = newId();
    assert.match(id, /^[A-Za-z0-9]{20}$/);
    assert.match(id, /^[A-Za-z0-9][A-Za-z0-9_-]{7,39}$/);
    seen.add(id);
  }
  assert.equal(seen.size, 500);
});

test("tripDay and defaultRingDay take the Days clock's date when given", () => {
  const t12 = { start: "2026-12-09", end: "2026-12-20", tz: "Asia/Tokyo" };
  const eve = Date.parse("2026-12-08T17:00:00-05:00"); // Dec 9 07:00 in Japan
  assert.equal(tripDay(t12, eve), "2026-12-09", "Japan's date");
  assert.equal(tripDay(t12, eve, "2026-12-08"), "pre", "the eve is before the trip");
  assert.equal(defaultRingDay(t12, eve, "2026-12-08"), "pre");
  const late = Date.parse("2026-12-09T11:45:00-05:00"); // Dec 10 in Japan
  assert.equal(tripDay(t12, late), "2026-12-10");
  assert.equal(tripDay(t12, late, "2026-12-09"), "2026-12-09");
  assert.equal(defaultRingDay(t12, late, "2026-12-09"), "2026-12-09");
  assert.equal(tripDay(t12, late, "2026-12-21"), "post");
  assert.equal(defaultRingDay(t12, late, "2026-12-21"), "2026-12-20");
});
