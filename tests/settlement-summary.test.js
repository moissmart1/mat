import test from "node:test";
import assert from "node:assert/strict";
import { settlementSummary } from "../js/views/money.js";

test("summary uses the displayed CAD balances and only exports settlement fields", () => {
  const expense = { title: "Train", day: "pre", paidBy: "A", split: ["A","B"], currency: "JPY", amount: 1000, rate: 100, secret: "private-marker" };
  const payment = { from: "B", to: "A", cad: 2, pending: true };
  const state = { trip: { name: "Demo" }, me: "A", people: [{ name: "A", etransfer: "private-marker" }, { name: "B" }],
    loadedAt: Date.parse("2030-01-02T00:00:00.000Z"), expenses: [expense, { ...expense, title: "Removed", deleted: true }], payments: [payment, { ...payment, pending: false, removed: true }], online: true };
  const s = settlementSummary(state, "2030-01-02T00:00:00.000Z");
  assert.equal(s.exportedAt, "2030-01-02T00:00:00.000Z");
  assert.equal(s.lastLoadedAt, s.exportedAt);
  assert.equal(s.settlementCurrency, "CAD");
  assert.equal(s.simplified, true);
  assert.equal(s.expenses[0].rate, 100);
  assert.deepEqual(s.expenses[0].sharesCadCents, { A: 500, B: 500 });
  assert.equal(s.provisional, true);
  assert.equal(s.expenses.length, 1);
  assert.equal(s.expenses[0].cadCents, 1000);
  assert.equal(s.payments.length, 1);
  assert.deepEqual(s.balances, { A: 300, B: -300 });
  assert.doesNotMatch(JSON.stringify(s), /private-marker|Removed/);
  payment.pending = false;
  state.online = false;
  assert.equal(settlementSummary(state, s.exportedAt).provisional, true);
  state.online = true;
  assert.equal(settlementSummary(state, "2030-01-03T00:00:00.000Z").provisional, true);
  assert.equal(settlementSummary(state, s.exportedAt).provisional, false);
});
