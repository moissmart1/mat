import test from "node:test";
import assert from "node:assert/strict";
import { noBreakRuns } from "../js/views/driver.js";

test("noBreakRuns keeps a house number whole: 9-9-9 is one run that never breaks at its hyphens (#95)", () => {
  assert.deepEqual(noBreakRuns("架空県湖畔市港町9-9-9 みどりビル3階"), [
    { text: "架空県湖畔市港町", nb: false },
    { text: "9-9-9", nb: true },
    { text: " みどりビル3階", nb: false },
  ]);
  // A house number with a block number and a floor after it.
  assert.deepEqual(noBreakRuns("架空県湖畔市港町2丁目9-9-9 みどりビル3階").filter((r) => r.nb).map((r) => r.text), ["9-9-9"]);
});

test("noBreakRuns: full-width digits and the other dashes a phone types", () => {
  assert.deepEqual(noBreakRuns("架空県湖畔市１２−３４−５"), [
    { text: "架空県湖畔市", nb: false },
    { text: "１２−３４−５", nb: true },
  ]);
  for (const dash of ["-", "‐", "−", "–", "ー", "－"]) {
    assert.deepEqual(noBreakRuns("湖畔1" + dash + "2"), [{ text: "湖畔", nb: false }, { text: "1" + dash + "2", nb: true }], dash);
  }
  // Two numbers: two runs; a lone number (3階) is not a run.
  assert.deepEqual(noBreakRuns("1-2 3階 4-5-6").filter((r) => r.nb).map((r) => r.text), ["1-2", "4-5-6"]);
});

test("noBreakRuns: a run too long to be a house number stays breakable (review M3)", () => {
  assert.deepEqual(noBreakRuns("1234-5678-9012-3"), [{ text: "1234-5678-9012-3", nb: true }], "16 letters: still one word");
  const long = "1234-5678-9012-3456-7890";
  assert.deepEqual(noBreakRuns("湖畔" + long), [{ text: "湖畔", nb: false }, { text: long, nb: false }]);
});

test("noBreakRuns: a text with no numbers is one run; empty and not-text give none", () => {
  assert.deepEqual(noBreakRuns("炭火焼鳥 鳥花 湖畔店"), [{ text: "炭火焼鳥 鳥花 湖畔店", nb: false }]);
  assert.deepEqual(noBreakRuns(""), []);
  assert.deepEqual(noBreakRuns(undefined), []);
  // The runs put back together are the text, unchanged.
  const t = "架空県湖畔市港町9-9-9 みどりビル3階";
  assert.equal(noBreakRuns(t).map((r) => r.text).join(""), t);
});
