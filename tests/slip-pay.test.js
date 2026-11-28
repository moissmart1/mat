// The 振込先 field's words (#89). Every name and address here is made up.
import test from "node:test";
import assert from "node:assert/strict";
import { payWords, footLine } from "../js/views/slip.js";

test("payWords: an address gives the address and its sub-line", () => {
  assert.deepEqual(payWords("Mo", "mo@example.com"), { address: "mo@example.com", sub: "Mo’s e-Transfer address" });
  assert.deepEqual(payWords("Mo", "  mo@example.com "), { address: "mo@example.com", sub: "Mo’s e-Transfer address" });
});

test("payWords: no address (empty, spaces or missing) gives the sentence", () => {
  const none = { none: "Mo hasn’t added an e-Transfer address yet. Ask Mo how to pay." };
  assert.deepEqual(payWords("Mo", ""), none);
  assert.deepEqual(payWords("Mo", "   "), none);
  assert.deepEqual(payWords("Mo", undefined), none);
});

test("footLine: send first when you have something to pay, else as before", () => {
  assert.equal(footLine(true), "Send it from your bank, then stamp 済 here. What’s left is always what’s shown here.");
  assert.equal(footLine(false), "Stamp it the moment you send. What’s left is always what’s shown here.");
});
