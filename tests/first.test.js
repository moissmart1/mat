import test from "node:test";
import assert from "node:assert/strict";
import { keyFromPaste } from "../js/views/first.js";

test("keyFromPaste takes the key from an invite link, or a bare key, trimmed", () => {
  assert.equal(keyFromPaste("https://example.github.io/mat/#k=3f2a9c0d1e4b5a6978c0d1e2"), "3f2a9c0d1e4b5a6978c0d1e2");
  assert.equal(keyFromPaste("  http://localhost:4173/#k=test-key \n"), "test-key");
  assert.equal(keyFromPaste("http://localhost:4173/#x=1&k=test-key"), "test-key");
  assert.equal(keyFromPaste("#k=test%2Dkey"), "test-key");
  assert.equal(keyFromPaste("3f2a9c0d1e4b5a6978c0d1e2"), "3f2a9c0d1e4b5a6978c0d1e2");
});

test("keyFromPaste refuses what cannot be a key", () => {
  for (const bad of [undefined, null, "", "   ", "abc", "hello there", "http://localhost:4173/", "http://localhost:4173/#x=1", "#k=", "#k=%E0%A4%A", "#k=a b c d e f", "<script>"]) {
    assert.equal(keyFromPaste(bad), null, JSON.stringify(bad));
  }
});

test("never loaded (issue 84): the Home Screen app's paper and Safari's, the glass, the line under the field", async () => {
  const { newPaper, GLASS_NEW, NEW_NOTE } = await import("../js/views/first.js");
  assert.deepEqual(newPaper(true), {
    head: "Nothing of the trip is in this app yet.",
    text: "The Home Screen app keeps its own copy, apart from Safari. Find the email with your own MAT link, press and hold the link, tap Copy Link, then paste it here.",
  });
  assert.deepEqual(newPaper(false), { head: "Nothing of the trip is on this phone yet.", text: "Open your MAT link from your email again, or paste it here." });
  assert.deepEqual(GLASS_NEW, { mark: "調整中", top: "Not set up yet", under: "Needs your link and signal, once" });
  assert.equal(NEW_NOTE, "With signal it fetches the trip and every ticket picture, once. No signal? Paste anyway: it keeps the link and opens by itself when signal is back.");
});

test("never loaded: the “opens by itself” sentence is said now that issue 85 makes it true", async () => {
  const { NEW_NOTE } = await import("../js/views/first.js");
  assert.match(NEW_NOTE, /Paste anyway: it keeps the link and opens by itself when signal is back\./);
});
