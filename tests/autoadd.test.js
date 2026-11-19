/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// js/autoadd.js: comparing the planner's list and the desk's files with the
// trip's pictures by their tie. Everything is made up: people A, B and C,
// invented lines, handles and prints.
import test from "node:test";
import assert from "node:assert/strict";
import { listPlan, byHand, noticeText, tieOf, tidKey, firstId, readSkip, writeSkip, SKIP_MAX } from "../js/autoadd.js";
import { createApi, API_TIMEOUT_MS } from "../js/api.js";

const DAYS = Array.from({ length: 11 }, (_, i) => ({ date: "2026-12-" + String(10 + i).padStart(2, "0") }));
const STOPS = [
  { id: "s-aq", date: "2026-12-15", time: "13:00", title: "Sakuragawa Aquarium" },
  { id: "s-mu", date: "2026-12-11", time: "10:00", title: "Aonami Museum" },
  { id: "s-tr", date: "2026-12-12", time: "09:00", title: "Kitamine train" },
];
const R = (o) => ({ status: "active", traveler: "ALL", type: "activity", start_time: "", ...o });
const ROWS = [
  R({ ticket_id: "T001", start_date: "2026-12-15", start_time: "13:00", title: "Aquarium" }),
  R({ ticket_id: "T002", start_date: "2026-12-11", start_time: "10:00", title: "Museum" }),
  R({ ticket_id: "T003", start_date: "2026-12-12", start_time: "09:00", title: "Train", traveler: "B" }),
  R({ ticket_id: "T004", start_date: "2026-12-12", status: "cancelled" }),
  R({ ticket_id: "T005", start_date: "2026-11-30", title: "Before the trip" }),
  R({ ticket_id: "T006", start_date: "2026-12-15", title: "No file" }),
];
const F = (n, name, print, mime = "image/png") => ({ h: String(n).repeat(32).slice(0, 32), name, mime, size: 300, print, at: "" });
const FILES = [
  F(1, "T001 Aquarium.png", "aaaaaaaaaaa1"),
  F(2, "T002 Museum.pdf", "bbbbbbbbbbb2", "application/pdf"),
  F(3, "T003 B train.jpg", "ccccccccccc3", "image/jpeg"),
  F(4, "T004 old.png", "ddddddddddd4"),
  F(5, "T005 before.png", "eeeeeeeeeee5"),
  F(6, "receipt.png", "fffffffffff6"),
];
const tk = (id, stop, from, o = {}) => ({ id, stop, who: "", page: 1, mime: "image/png", w: 10, h: 10, size: 1, from, ...o });
const state = (tickets = []) => ({ days: DAYS, stops: STOPS, people: [{ name: "A" }, { name: "B" }, { name: "C" }], tickets });

test("tieOf: the id's letters and digits, a colon, the print", () => {
  assert.equal(tieOf("T007", "0123456789ab"), "T007:0123456789ab");
  assert.equal(tieOf("T-7 x", "0123456789abcdef"), "T7x:0123456789ab");
  assert.equal(tidKey("T-007"), "T007");
  assert.match(tieOf("T" + "9".repeat(40), "a".repeat(12)), /^[A-Za-z0-9:]{1,40}$/);
  assert.equal(firstId("T003 T001 both.png", ROWS), "T003");
  assert.equal(firstId("receipt.png", ROWS), "");
});

test("new: lines with a file and no picture on the trip; cancelled, outside the trip's days, no file and unlisted files are left alone", () => {
  const p = listPlan({ rows: ROWS, files: FILES, state: state() });
  assert.deepEqual(p.fresh.map((f) => [f.tid, f.file.name, f.tie]), [
    ["T001", "T001 Aquarium.png", "T001:aaaaaaaaaaa1"],
    ["T002", "T002 Museum.pdf", "T002:bbbbbbbbbbb2"],
    ["T003", "T003 B train.jpg", "T003:ccccccccccc3"],
  ]);
  assert.deepEqual(p.changed, []);
  assert.deepEqual(p.cancelled, []);
  assert.deepEqual(p.quiet, { unlisted: 1, outside: 1, skipped: 0, noFile: 1 });
});

test("already there: a line whose picture is tied with the same print is nothing to do", () => {
  const p = listPlan({ rows: ROWS, files: FILES, state: state([tk("x1", "s-aq", "T001:aaaaaaaaaaa1"), tk("x2", "s-mu", "T002:bbbbbbbbbbb2"), tk("x3", "s-mu", "T002:bbbbbbbbbbb2", { page: 2 })]) });
  assert.deepEqual(p.fresh.map((f) => f.tid), ["T003"]);
  assert.deepEqual(p.changed, []);
  // A removed picture does not count: its line is new again.
  const q = listPlan({ rows: ROWS, files: FILES, state: state([tk("x1", "s-aq", "T001:aaaaaaaaaaa1", { gone: true })]) });
  assert.ok(q.fresh.some((f) => f.tid === "T001"));
});

test("changed: the same line with another file: the new one to add where the old ones are, the old ones to take off", () => {
  const p = listPlan({ rows: ROWS, files: FILES, state: state([tk("x1", "s-aq", "T001:000000000000", { who: "" }), tk("x2", "s-aq", "T001:000000000000", { page: 2 })]) });
  assert.equal(p.changed.length, 1);
  const c = p.changed[0];
  assert.equal(c.key, "chg:T001");
  assert.equal(c.stop, "s-aq");
  assert.equal(c.who, "");
  assert.deepEqual(c.add.map((a) => [a.file.name, a.tie]), [["T001 Aquarium.png", "T001:aaaaaaaaaaa1"]]);
  assert.deepEqual(c.drop.map((t) => t.id), ["x1", "x2"]);
  assert.equal(p.fresh.some((f) => f.tid === "T001"), false);
  // A second file for the line, the first still there: only the new one, nothing to take off.
  const two = listPlan({ rows: ROWS, files: FILES.concat([F(7, "T001 page two.png", "777777777777")]), state: state([tk("x1", "s-aq", "T001:aaaaaaaaaaa1")]) });
  assert.deepEqual(two.changed.map((x) => [x.add.map((a) => a.file.name), x.drop.length]), [[["T001 page two.png"], 0]]);
});

test("cancelled, gone from the list, or no file any more, with pictures still on: asked about, never taken off by itself", () => {
  const tickets = [tk("c1", "s-tr", "T004:ddddddddddd4"), tk("g1", "s-mu", "T099:111111111111"), tk("n1", "s-aq", "T006:222222222222")];
  const p = listPlan({ rows: ROWS, files: FILES, state: state(tickets) });
  assert.deepEqual(p.cancelled.map((c) => [c.key, c.tid, c.why, c.tickets.map((t) => t.id)]), [
    ["off:T004", "T004", "cancelled", ["c1"]],
    ["off:T006", "T006", "nofile", ["n1"]],
    ["off:T099", "T099", "gone", ["g1"]],
  ]);
  assert.equal(p.cancelled[0].status, "cancelled");
});

test("left out before on this phone: a skipped tie is not new again; a kept picture is not asked about again", () => {
  const skip = new Set(["T001:aaaaaaaaaaa1", "keep:T004:ddddddddddd4"]);
  const p = listPlan({ rows: ROWS, files: FILES, state: state([tk("c1", "s-tr", "T004:ddddddddddd4")]), skip });
  assert.equal(p.fresh.some((f) => f.tid === "T001"), false);
  assert.equal(p.quiet.skipped, 1);
  assert.deepEqual(p.cancelled, []);
  // Changed, with the new file left out and the old one kept: nothing to ask.
  const q = listPlan({ rows: ROWS, files: FILES, state: state([tk("x1", "s-aq", "T001:000000000000")]), skip: new Set(["T001:aaaaaaaaaaa1", "keep:T001:000000000000"]) });
  assert.deepEqual(q.changed, []);
});

test("byHand: a stop with a picture added by hand (no tie) for the same person or for everyone gets nothing from the list", () => {
  const hand = [{ id: "h1", stop: "s-aq", who: "", from: undefined }, { id: "h2", stop: "s-tr", who: "C" }, { id: "h3", stop: "s-mu", who: "", from: "T002:x", gone: false }, { id: "h4", stop: "s-mu", who: "", gone: true }];
  const items = [{ stop: "s-aq", who: "B" }, { stop: "s-tr", who: "B" }, { stop: "s-tr", who: "" }, { stop: "s-tr", who: "C" }, { stop: "s-mu", who: "" }];
  const r = byHand(items, hand);
  assert.deepEqual(r.out, [{ stop: "s-aq", who: "B" }, { stop: "s-tr", who: "" }, { stop: "s-tr", who: "C" }]);
  assert.deepEqual(r.keep, [{ stop: "s-tr", who: "B" }, { stop: "s-mu", who: "" }]);
});

test("noticeText and the skip list", () => {
  assert.equal(noticeText({ fresh: 4 }), "4 new tickets from the list");
  assert.equal(noticeText({ fresh: 1 }), "1 new ticket from the list");
  assert.equal(noticeText({ fresh: 2, other: 1 }), "2 new tickets from the list, 1 changed");
  assert.equal(noticeText({ other: 1 }), "1 ticket changed in the list");
  assert.equal(noticeText({}), "");
  assert.deepEqual([...readSkip(writeSkip(new Set(["a", "b"])))], ["a", "b"]);
  assert.deepEqual([...readSkip("not json")], []);
  assert.deepEqual([...readSkip('[1, "ok", "' + "x".repeat(61) + '"]')], ["ok"]);
  const many = new Set(Array.from({ length: SKIP_MAX + 5 }, (_, i) => "t" + i));
  const kept = readSkip(writeSkip(many));
  assert.equal(kept.size, SKIP_MAX);
  assert.equal(kept.has("t0"), false, "the oldest go first");
});

test("a file from the desk that takes too long: the phone's request gives up at its limit (30 seconds) as no signal, the key only in the body", async () => {
  assert.equal(API_TIMEOUT_MS, 30000);
  const seen = [];
  const api = createApi({ url: "https://backend.example.test/exec", getKey: () => "key-invented-0123456789", getActor: () => "A", timeoutMs: 40, isOnline: () => true,
    fetchImpl: (url, init) => { seen.push({ url, body: init.body }); return new Promise(() => {}); } });
  await assert.rejects(api("listTicketFile", { handle: "a".repeat(32) }), (e) => e.code === "network");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url.includes("key-invented"), false, "never in the address");
  assert.equal(JSON.parse(seen[0].body).key, "key-invented-0123456789");
});
