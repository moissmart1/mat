import test from "node:test";
import assert from "node:assert/strict";
import { findQuery, findLines, findCount, noItemText } from "../js/views/money.js";

test("findQuery trims and copes with nothing", () => {
  assert.equal(findQuery("  ramen \n"), "ramen");
  assert.equal(findQuery(null), "");
  assert.equal(findQuery(undefined), "");
  assert.equal(findQuery(42), "42");
  assert.equal(findQuery("   "), "");
});

test("findLines looks only at the description", () => {
  const lines = [
    { id: "a", title: "Ramen lunch", note: "sushi", paidBy: "Mo", amount: 900 },
    { id: "b", title: "Museum entry", note: "", paidBy: "Ajen", amount: 100 },
    { id: "c", note: "ramen" },
    { id: "d", title: "RAMEN bar", paidBy: "Trenton" },
  ];
  assert.equal(findLines(lines, ""), lines);
  assert.deepEqual(findLines(lines, "ramen").map((e) => e.id), ["a", "d"]);
  assert.deepEqual(findLines(lines, "RAMEN").map((e) => e.id), ["a", "d"]);
  assert.deepEqual(findLines(lines, "seum").map((e) => e.id), ["b"]);
  assert.deepEqual(findLines(lines, "sushi"), []);
  assert.deepEqual(findLines(lines, "ajen"), []);
  assert.deepEqual(findLines(lines, "900"), []);
  assert.deepEqual(findLines(lines, "zzz"), []);
});

test("findCount says how many of how many", () => {
  assert.equal(findCount(0, 8), "Showing 0 of 8 items");
  assert.equal(findCount(1, 8), "Showing 1 of 8 items");
  assert.equal(findCount(8, 8), "Showing 8 of 8 items");
  assert.equal(findCount(1, 1), "Showing 1 of 1 item");
  assert.equal(findCount(0, 1), "Showing 0 of 1 item");
});

test("noItemText uses curly quotes and the words as given", () => {
  assert.equal(noItemText("Sushi"), "No item says “Sushi”.");
  assert.equal(noItemText("<b>x</b>"), "No item says “<b>x</b>”.");
});
