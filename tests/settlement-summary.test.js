import test from "node:test";
import assert from "node:assert/strict";
import { settlementSummary, summaryText, summaryFigures } from "../js/views/money.js";
import { japanTime } from "../js/format.js";

const AT = Date.parse("2026-12-20T05:12:33.123Z"); // Sun Dec 20, 14:12 in Japan

function trip() {
  const train = { id: "e1", title: "Train", day: "pre", paidBy: "A", split: ["A", "B"], currency: "JPY", amount: 15000, rate: 100, note: "private-marker", link: "https://example.test/private-marker", addedAt: "2026-12-01T00:00:00Z" };
  const lunch = { id: "e2", title: "Lunch", day: "2026-12-12", paidBy: "B", split: ["A", "B"], currency: "CAD", amount: 45, addedAt: "2026-12-12T03:00:00Z" };
  const ramen = { id: "e3", title: "Ramen", day: "2026-12-11", paidBy: "A", split: ["A", "B"], splitMode: "parts", splitVals: [1, 3], currency: "JPY", amount: 4000, rate: 100, addedAt: "2026-12-11T03:00:00Z" };
  const payment = { id: "p1", from: "B", to: "A", cad: 2, stampedAt: "2026-12-13T00:00:00Z" };
  return {
    trip: { name: "Demo" }, me: "A", online: true, settlementProvisional: false, setAside: [],
    people: [{ name: "A", etransfer: "private-marker" }, { name: "B" }, { name: "C" }],
    loadedAt: Date.parse("2026-12-20T04:58:00Z"),
    expenses: [lunch, train, ramen, { ...train, id: "e4", title: "Removed", deleted: true }],
    payments: [payment, { ...payment, id: "p2", removed: true }],
  };
}

test("times read in Japan time, whatever zone the phone is in", () => {
  assert.equal(japanTime(AT), "Sun Dec 20, 14:12 Japan time");
  assert.equal(japanTime(Date.parse("2026-12-10T15:05:00Z")), "Fri Dec 11, 00:05 Japan time");
  assert.equal(japanTime(NaN), "");
});

test("the summary uses the slip's figures, plain wording, and only settlement fields", () => {
  const state = trip();
  const s = settlementSummary(state, AT);
  assert.equal(s.provisional, false);
  assert.deepEqual(s.expenses.map((e) => e.description), ["Train", "Ramen", "Lunch"], "before the trip first, then by day");
  assert.deepEqual(s.expenses[0].sharesCadCents, { A: 7500, B: 7500 });
  assert.equal(s.payments.length, 1);
  assert.doesNotMatch(JSON.stringify(s), /private-marker|Removed/);
  const text = summaryText(s);
  assert.doesNotMatch(text, /private-marker|Removed|undefined|NaN|Provisional|\bpre\b|T\d\d:\d\d|Z\b/);
  const lines = text.split("\n");
  assert.equal(lines[0], "Demo — Settlement summary");
  assert.equal(lines[1], "Dollar amounts are CAD.");
  assert.equal(lines[2], "Prepared Sun Dec 20, 14:12 Japan time");
  assert.equal(lines[3], "Last loaded Sun Dec 20, 13:58 Japan time");
  for (const line of [
    "Before the trip · Train · A paid ¥15,000 ($150.00 at 100 JPY/CAD)",
    "  Split equally: A $75.00, B $75.00",
    "Fri Dec 11 · Ramen · A paid ¥4,000 ($40.00 at 100 JPY/CAD)",
    "  Split by parts: A $10.00, B $30.00",
    // A dollar line: no rate.
    "Sat Dec 12 · Lunch · B paid $45.00",
    "B → A  $2.00",
    "C is even",
    "Remaining transfers (simplified)",
  ]) assert.ok(lines.includes(line), line);
  assert.ok(lines.some((l) => / owes \$\d/.test(l)) && lines.some((l) => / is owed \$\d/.test(l)));
});

test("Provisional only when this phone has money lines the Sheet hasn't confirmed (#21's signal)", () => {
  const state = trip();
  // Long after the last load, nothing waiting: not provisional.
  assert.equal(settlementSummary(state, AT + 3 * 3600000).provisional, false);
  // Offline with nothing waiting: still not provisional.
  state.online = false;
  assert.equal(settlementSummary(state, AT).provisional, false);
  state.settlementProvisional = true;
  const s = settlementSummary(state, AT);
  assert.equal(s.provisional, true);
  assert.ok(summaryText(s).split("\n").includes("Provisional. Some changes haven’t synced."));
});

test("lines the Sheet can't read are named with the app's own words", () => {
  const state = trip();
  state.setAside = [{ kind: "expense", id: "x", title: "?", reason: "name" }];
  assert.ok(summaryText(settlementSummary(state, AT)).includes("1 line in the Sheet can’t be read (a name the app doesn’t know). It’s left out of the totals. Tell Mo."));
});

test("the figures part ignores the time lines, so a redraw with the same figures changes nothing", () => {
  const state = trip();
  const a = summaryText(settlementSummary(state, AT));
  const b = summaryText(settlementSummary({ ...state, loadedAt: state.loadedAt + 300000 }, AT + 300000));
  assert.notEqual(a, b);
  assert.equal(summaryFigures(a), summaryFigures(b));
  state.expenses[0].amount = 16000;
  assert.notEqual(summaryFigures(summaryText(settlementSummary(state, AT))), summaryFigures(a));
});
