import test from "node:test";
import assert from "node:assert/strict";
import { createClock } from "../js/clock.js";
import { nowIn } from "../js/plan.js";

test("the demo clock starts at 07:00 on the chosen day, runs fast and holds at 23:30", () => {
  let real = 1000;
  const told = [];
  const clock = createClock({ now: () => real, getTz: () => "Asia/Tokyo" });
  clock.subscribe(() => told.push(clock.demoDay()));
  assert.equal(clock.now(), 1000);
  clock.start("2026-12-12");
  assert.deepEqual(nowIn("Asia/Tokyo", clock.now()), { date: "2026-12-12", minutes: 420 });
  real += 30000; // 30 real seconds is one trip hour
  assert.equal(nowIn("Asia/Tokyo", clock.now()).minutes, 480);
  real += 3600000;
  assert.deepEqual(nowIn("Asia/Tokyo", clock.now()), { date: "2026-12-12", minutes: 23 * 60 + 30 });
  clock.stop();
  assert.equal(clock.now(), real);
  assert.deepEqual(told, ["2026-12-12", null]);
});

test("holding is true only once a demo has reached its end of day", () => {
  let t = Date.parse("2026-11-15T03:00:00Z");
  const clock = createClock({ now: () => t, getTz: () => "Asia/Tokyo" });
  assert.equal(clock.holding(), false, "no demo");
  clock.start("2026-12-12");
  assert.equal(clock.holding(), false);
  t += 4 * 60000;
  assert.equal(clock.holding(), false);
  t += 5 * 60000;
  assert.equal(clock.holding(), true);
  clock.stop();
  assert.equal(clock.holding(), false);
});

test("a demo of a day in its own zone starts at 07:00 there and holds a minute before the day ends", async () => {
  const { daySpan, tripNow } = await import("../js/plan.js");
  const { dec9State, et, ET } = await import("./fixtures/dec9.js");
  const s = dec9State();
  const row = (date) => s.eves.concat(s.days).find((d) => d.date === date);
  const { zoneOf } = await import("../js/plan.js");
  let real = Date.parse("2026-11-20T12:00:00Z");
  const clock = createClock({ now: () => real, getTz: (date) => zoneOf(s.trip, row(date)), getSpan: (date) => daySpan(s, date) });
  clock.start("2026-12-09");
  assert.equal(clock.now(), et("2026-12-09T07:00"));
  assert.deepEqual(nowIn(ET, clock.now()), { date: "2026-12-09", minutes: 420 });
  real += 3600000; // far past the end
  assert.equal(clock.now(), et("2026-12-09T12:49"), "a minute before Day 1 ends (12:50), not 23:30");
  assert.equal(clock.holding(), true);
  assert.equal(tripNow(s, clock.now()).date, "2026-12-09", "it holds on Day 1");
  // A day in the trip's zone: as before, 07:00 to 23:30 in Japan.
  clock.start("2026-12-12");
  assert.deepEqual(nowIn("Asia/Tokyo", clock.now()), { date: "2026-12-12", minutes: 420 });
  real += 3600000;
  assert.deepEqual(nowIn("Asia/Tokyo", clock.now()), { date: "2026-12-12", minutes: 1410 });
});
