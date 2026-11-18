/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The Before list as a pad of reservation slips (予約票): the number printed
// on a slip's counterfoil. Every id here is made up.
import test from "node:test";
import assert from "node:assert/strict";
import { slipNo } from "../js/todos.js";

test("slipNo: the planner's own number, two digits at the least", () => {
  assert.equal(slipNo("4", 0), "No.04");
  assert.equal(slipNo("12", 3), "No.12");
  assert.equal(slipNo("104", 0), "No.104");
  assert.equal(slipNo(" 7 ", 0), "No.07");
});

test("slipNo: an id that is not a number is numbered by its place in the pad", () => {
  assert.equal(slipNo("abc", 0), "No.01");
  assert.equal(slipNo("abc", 8), "No.09");
  assert.equal(slipNo("", 1), "No.02");
  assert.equal(slipNo(undefined, 2), "No.03");
  assert.equal(slipNo("12345", 0), "No.01", "too long for a counterfoil");
});
