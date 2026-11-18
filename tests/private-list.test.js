/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// scripts/private.mjs: the private list the release scan checks against
// holds each ticket's booking reference and name on the booking (tickets,
// fix round 1, I4). Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { privateStrings } from "../scripts/private.mjs";

const trip = {
  people: [{ name: "Mo" }, { name: "Ajen" }, { name: "Trenton" }],
  stops: [
    { id: "s1", tkRef: "TEST-4401", tkName: "MADE UP PERSON" },
    { id: "s2", tkRef: "R2D2", tkName: "TRENTON" },
    { id: "s3", tkRef: "", tkName: "" },
    { id: "s4" },
  ],
};

test("I4: booking references and names on bookings are on the private list", () => {
  const out = privateStrings(trip, {});
  assert.ok(out.has("TEST-4401"));
  assert.ok(out.has("R2D2"), "a short ref of four characters too");
  assert.ok(out.has("MADE UP PERSON"));
});

test("I4: a name on a booking that is only a trip person's first name is not listed (it is in the public code)", () => {
  const out = privateStrings(trip, {});
  assert.equal([...out].some((s) => s.toLowerCase() === "trenton"), false);
  assert.equal(out.has(""), false);
});
