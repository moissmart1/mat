// Ring it up asks "Yen or dollars?" (issue #90): the rule, yenAsk(d, state),
// line by line. A trip Dec 9 to 20 in Japan whose Dec 9 is on Eastern time.

import test from "node:test";
import assert from "node:assert/strict";
import { yenAsk, YEN_ASK_CENTS } from "../js/views/register.js";

const STATE = {
  trip: { name: "Japan 2026", start: "2026-12-09", end: "2026-12-20", tz: "Asia/Tokyo" },
  days: [
    { date: "2026-12-09", tz: "America/New_York" },
    { date: "2026-12-10", tz: "" },
    { date: "2026-12-12", tz: "" },
  ],
};

// A new entry of $12,000 on Sat Dec 12, the currency key untouched.
const draft = (over = {}) => ({
  amt: "12000", cur: "CAD", curTouched: false, day: "2026-12-12", editId: null, orig: null,
  split: ["Mo", "Ajen", "Trenton"], mode: null, parts: {}, exact: {}, ...over,
});

test("the figure is $500, in cents (issue #90)", () => {
  assert.equal(YEN_ASK_CENTS, 50000);
});

test("a new whole-dollar entry of $500 or more on a day in Japan asks", () => {
  assert.equal(yenAsk(draft(), STATE), true);
  assert.equal(yenAsk(draft({ amt: "500" }), STATE), true);
});

test("1: a yen entry never asks", () => {
  assert.equal(yenAsk(draft({ cur: "JPY" }), STATE), false);
});

test("2: the currency key pressed during the entry: no question", () => {
  assert.equal(yenAsk(draft({ curTouched: true }), STATE), false);
});

test("3: cents typed anywhere: no question", () => {
  assert.equal(yenAsk(draft({ amt: "500." }), STATE), false);
  assert.equal(yenAsk(draft({ amt: "500.00" }), STATE), false);
  assert.equal(yenAsk(draft({ amt: "1200.50" }), STATE), false);
});

test("4: below the figure: no question ($499, $499.99)", () => {
  assert.equal(yenAsk(draft({ amt: "499" }), STATE), false);
  assert.equal(yenAsk(draft({ amt: "499.99" }), STATE), false);
  assert.equal(yenAsk(draft({ amt: "" }), STATE), false);
});

test("5: the same digits must be a legal yen amount (at most 10,000,000)", () => {
  assert.equal(yenAsk(draft({ amt: "10000000" }), STATE), true);
  assert.equal(yenAsk(draft({ amt: "10000001" }), STATE), false);
  assert.equal(yenAsk(draft({ amt: "123456789" }), STATE), false, "nine digits");
});

test("6: before the trip, Dec 9 on Eastern, and a day past the end never ask", () => {
  assert.equal(yenAsk(draft({ day: "pre" }), STATE), false);
  assert.equal(yenAsk(draft({ day: "2026-12-09" }), STATE), false, "Dec 9 is on Eastern time");
  assert.equal(yenAsk(draft({ day: "2026-12-08" }), STATE), false, "the eve is before the trip");
  assert.equal(yenAsk(draft({ day: "2026-12-21" }), STATE), false);
  assert.equal(yenAsk(draft({ day: "2026-12-10" }), STATE), true, "Dec 10 has a row in the trip's zone");
  assert.equal(yenAsk(draft({ day: "2026-12-20" }), STATE), true, "the last day, with no row, is the trip's zone");
});

test("6: no trip, or no dates, never asks", () => {
  assert.equal(yenAsk(draft(), { trip: null, days: [] }), false);
  assert.equal(yenAsk(draft(), { trip: { start: "2026-12-09" }, days: [] }), false);
  assert.equal(yenAsk(draft(), {}), false);
});

test("7: an edit asks only when its amount was changed in this opening", () => {
  const orig = { amount: 650, currency: "CAD" };
  assert.equal(yenAsk(draft({ editId: "e1", orig, amt: "650" }), STATE), false, "amount unchanged");
  assert.equal(yenAsk(draft({ editId: "e1", orig, amt: "700" }), STATE), true, "amount changed");
  assert.equal(yenAsk(draft({ editId: "e1", orig: { amount: 650.5, currency: "CAD" }, amt: "650" }), STATE), true, "cents dropped is a change");
});

test("7: an edit of a yen line never asks", () => {
  const orig = { amount: 12000, currency: "JPY" };
  assert.equal(yenAsk(draft({ editId: "e1", orig, cur: "JPY", amt: "15000" }), STATE), false);
  assert.equal(yenAsk(draft({ editId: "e1", orig, cur: "CAD", curTouched: true, amt: "15000" }), STATE), false, "switched to dollars with the key");
});

test("exact split in whole figures asks; any cents in it does not", () => {
  const exact = { Mo: "6000", Ajen: "4000", Trenton: "2000" };
  assert.equal(yenAsk(draft({ mode: "exact", exact }), STATE), true);
  assert.equal(yenAsk(draft({ mode: "exact", exact: { ...exact, Mo: "5999.50", Trenton: "2000.50" } }), STATE), false);
  // A figure of someone out of the split does not count.
  assert.equal(yenAsk(draft({ mode: "exact", split: ["Mo", "Ajen"], exact: { Mo: "8000", Ajen: "4000", Trenton: "1.5" } }), STATE), true);
  // Cents kept in exact figures while the mode is parts do not count either.
  assert.equal(yenAsk(draft({ mode: "parts", exact: { Mo: "1.5" } }), STATE), true);
});

test("a parts split asks; parts are not money", () => {
  assert.equal(yenAsk(draft({ mode: "parts", parts: { Mo: 2, Ajen: 1, Trenton: 1 } }), STATE), true);
});
