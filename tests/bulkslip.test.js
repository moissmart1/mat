/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// js/bulkslip.js: the slip of the planner's list (bulk C). Everything is
// made up: people A, B and C, invented places, lines and files.
import test from "node:test";
import assert from "node:assert/strict";
import { sortFiles, placeOf, placeKey } from "../js/bulk.js";
import { slipModel, toAnswers, extrasOf, defaultPick, skipsOf, buttonText, cellsOf, questionOf, addedSlip } from "../js/bulkslip.js";

const DAYS = Array.from({ length: 11 }, (_, i) => ({ date: "2026-12-" + String(10 + i).padStart(2, "0") }));
const STOPS = [
  { id: "s-aq", date: "2026-12-11", time: "13:00", title: "Sakuragawa Aquarium" },
  { id: "s-mu", date: "2026-12-12", time: "10:00", title: "Aonami Museum" },
  { id: "s-kg", date: "2026-12-13", time: "18:00", title: "Kogane Garden" },
  { id: "s-rw", date: "2026-12-14", time: "11:00", title: "Hoshizora Ropeway" },
  { id: "s-fr", date: "2026-12-18", time: "09:40", title: "Harbour ferry" },
  { id: "s-tw", date: "2026-12-17", time: "17:45", title: "Tsukimi Tower" },
];
const STAYS = [{ id: "y-1", name: "Mizuumi lodge", firstNight: "2026-12-10", lastNight: "2026-12-12" }];
const PEOPLE = [{ name: "A" }, { name: "B" }, { name: "C" }];
const state = (more = {}) => ({ days: DAYS, stops: STOPS, stays: STAYS, people: PEOPLE, tickets: [], ...more });
const R = (o) => ({ status: "active", traveler: "ALL", type: "activity", ...o });
const png = (key, name, extra = {}) => ({ key, name, kind: "image/png", pages: 1, sig: { mime: "image/png", w: 400, h: 400, size: 1000 + key.length, hash: "h-" + key }, ...extra });
const pdf = (key, name, pages) => ({ key, name, kind: "application/pdf", pages, sig: { mime: "image/jpeg", w: 900, h: 1200, size: 5000 + pages, hash: "p-" + key } });

const ROWS = [
  R({ ticket_id: "T001", start_date: "2026-12-11", start_time: "13:00", title: "Sakuragawa Aquarium", traveler: "A" }),
  R({ ticket_id: "T002", start_date: "2026-12-11", start_time: "13:00", title: "Sakuragawa Aquarium", traveler: "B" }),
  R({ ticket_id: "T003", start_date: "2026-12-12", start_time: "10:00", title: "Aonami Museum" }),
  R({ ticket_id: "T004", start_date: "2026-12-10", type: "lodging", title: "Mizuumi lodge" }),
  R({ ticket_id: "T009", start_date: "2026-12-13", start_time: "18:00", title: "Kogane Garden night walk" }),
  R({ ticket_id: "T010", start_date: "2026-12-16", start_time: "16:30", title: "Lantern boat" }),
];
const FILES = [png("f1", "T001 a.png"), png("f2", "T002 b.png"), pdf("f3", "T003 museum.pdf", 2), png("f4", "T004 lodge.png"), png("f10", "T010 boat.png")];

// A changed line's card, as js/views/bulkadd.js listCards() makes it.
const chg = (o = {}) => ({ kind: "changed", key: "chg:T009", label: "T009 · Kogane Garden night walk", file: null, onList: true, rowIds: ["T009"], who: "", stop: "s-kg", drop: [{ id: "old1", from: "T009:aaa" }, { id: "old2", from: "T009:aaa" }], got: [{ name: "T009 new.png", tie: "T009:bbb" }], newPages: 1, choices: [], short: "file changed", slip: "replace", row: ROWS[4], lchoices: [{ act: "replace" }, { act: "keep" }], ...o });
const off = (o = {}) => ({ kind: "cancelled", key: "off:T011", label: "T011 · Night bus", file: null, onList: true, rowIds: ["T011"], who: "", stop: "s-tw", drop: [{ id: "old3", from: "T011:ccc" }, { id: "old4", from: "T011:ccc" }], got: [], newPages: 0, choices: [], short: "cancelled in the list", slip: "cancelled", status: "Cancelled", row: R({ ticket_id: "T011", start_date: "2026-12-17", start_time: "21:00", title: "Night bus", status: "Cancelled" }), lchoices: [{ act: "off" }, { act: "keep" }], ...o });

// The review as bulkadd.js sorted() works it out in list mode: the files' own
// sorting, then the list's cards not answered, the acts done and the pictures after.
function review({ files = FILES, rows = ROWS, st = state(), answers = new Map(), lanswers = new Map(), list = [] } = {}) {
  const r = sortFiles({ files, rows, state: st, answers });
  r.cards = r.cards.concat(list.filter((c) => !lanswers.has(c.key)));
  r.listDone = list.filter((c) => lanswers.has(c.key)).map((c) => ({ card: c, act: lanswers.get(c.key) }));
  let after = r.now + r.items.reduce((n, i) => n + i.pages, 0);
  for (const { card, act } of r.listDone) {
    if (act === "replace" || act === "first" || act === "add") after += card.newPages;
    if (act === "replace" || act === "first" || act === "off") after -= card.drop.length;
  }
  r.after = after;
  return r;
}
// The slip as bulkadd.js draws it: base, answers, extras, the result.
function slip({ picks = new Map(), outs = new Set(), list = [chg()], st = state(), files = FILES, aside = {}, listAt = "" } = {}) {
  const base = review({ files, st, list });
  let a = toAnswers({ base, picks, outs });
  const r1 = review({ files, st, list, ...a });
  const extras = extrasOf(base, r1);
  if (extras.length) a = toAnswers({ base, picks, outs, extras });
  const result = review({ files, st, list, ...a });
  return { base, result, extras, a, m: slipModel({ base, picks, outs, state: st, rows: ROWS, result, extras, aside, listAt }) };
}

test("cells: the sure ones grouped by place, the stay first, then day and time; the small line and the words for a screen reader", () => {
  const { m } = slip();
  assert.deepEqual(m.cells.map((c) => [c.key, c.small, c.title, c.tickets, c.out]), [
    ["stay:y-1", "D1 · stay", "Mizuumi lodge", 1, false],
    ["stop:s-aq", "D2 Fri 13:00 · 2 tickets", "Sakuragawa Aquarium", 2, false],
    ["stop:s-mu", "D3 Sat 10:00", "Aonami Museum", 1, false],
  ]);
  assert.deepEqual(m.cells[1].who, ["A", "B"]);
  assert.deepEqual(m.cells[1].itemKeys, ["f1#0", "f2#0"]);
  assert.equal(m.cells[1].aria, "Sakuragawa Aquarium, D2 Fri 13:00, 2 tickets, will be added");
  assert.equal(m.cells[2].aria, "Aonami Museum, D3 Sat 10:00, will be added");
  assert.deepEqual(m.will, { left: "Will add · 4 tickets", right: "on 2 stops and 1 stay" });
  assert.deepEqual(m.check, { left: "Check these 2", right: "the likely answer is picked" });
  assert.equal(m.say, "4 tickets ready to add, 2 to check.");
});

test("the button: 4 sure, the replace and the new stop by default; Undo from History is drawn by the view", () => {
  const { m } = slip();
  assert.equal(m.add, 6);
  assert.equal(m.off, 0);
  assert.equal(m.button, "Add 6 tickets");
  assert.equal(m.canAdd, true);
  // now 0; +5 pages of the sure (2 PDF pages), +1 new stop, +1 new file, -2 old ones.
  assert.equal(m.now, 0);
  assert.equal(m.after, 5 + 1 + 1 - 2);
});

test("buttonText: all four forms, singular and plural", () => {
  assert.equal(buttonText(10, 0), "Add 10 tickets");
  assert.equal(buttonText(1, 0), "Add 1 ticket");
  assert.equal(buttonText(9, 2), "Add 9 tickets, take 2 pictures off");
  assert.equal(buttonText(1, 1), "Add 1 ticket, take 1 picture off");
  assert.equal(buttonText(0, 2), "Take 2 pictures off");
  assert.equal(buttonText(0, 1), "Take 1 picture off");
  assert.equal(buttonText(0, 0), "Nothing to add");
});

test("a pick and an out change add, off, after, the heading and the button", () => {
  // The no-stop question to Leave it out: 5.
  let { m } = slip({ picks: new Map([["f10#0", "out"]]) });
  assert.equal(m.button, "Add 5 tickets");
  assert.equal(m.after, 4);
  // A cell out: the aquarium's two.
  ({ m } = slip({ picks: new Map([["f10#0", "out"]]), outs: new Set(["stop:s-aq"]) }));
  assert.equal(m.button, "Add 3 tickets");
  assert.deepEqual(m.will, { left: "Will add · 2 tickets", right: "on 1 stop and 1 stay" });
  assert.equal(m.cells[1].out, true);
  assert.equal(m.cells[1].aria, "Sakuragawa Aquarium, D2 Fri 13:00, 2 tickets, left out");
  // Every cell out: Will add · nothing, no right side.
  ({ m } = slip({ outs: new Set(["stay:y-1", "stop:s-aq", "stop:s-mu"]) }));
  assert.deepEqual(m.will, { left: "Will add · nothing", right: "" });
  assert.equal(m.button, "Add 2 tickets");
  // Keep the old pictures and leave the boat out: only a cancelled line taken off.
  ({ m } = slip({ outs: new Set(["stay:y-1", "stop:s-aq", "stop:s-mu"]), list: [chg(), off()], picks: new Map([["chg:T009", "keep"], ["f10#0", "out"], ["off:T011", "off"]]) }));
  assert.equal(m.add, 0);
  assert.equal(m.off, 2);
  assert.equal(m.button, "Take 2 pictures off");
  ({ m } = slip({ list: [chg(), off()], picks: new Map([["off:T011", "off"]]) }));
  assert.equal(m.button, "Add 6 tickets, take 2 pictures off");
  ({ m } = slip({ outs: new Set(["stay:y-1", "stop:s-aq", "stop:s-mu"]), picks: new Map([["chg:T009", "keep"], ["f10#0", "out"]]) }));
  assert.equal(m.button, "Nothing to add");
  assert.equal(m.canAdd, false);
});

test("picks and outs give exactly the answers the old taps gave", () => {
  const base = review({ list: [chg(), off()] });
  const nostop = base.cards.find((c) => c.kind === "nostop");
  // The defaults: the new stop (the first choice), replace, leave the cancelled one's pictures on.
  let a = toAnswers({ base });
  assert.deepEqual(a.answers.get("f10#0"), { ...placeOf(nostop.choices[0]), who: "", rowIds: ["T010"], pages: null });
  assert.deepEqual([...a.lanswers], [["chg:T009", "replace"], ["off:T011", "keep"]]);
  // A cell out: { out: true } on each of its items, as Leave it out in the untied list.
  // Leave it out on a card: { out: true, why: card.short }, as the card's Leave it out.
  // A stop from the picker: as Put it on this stop.
  a = toAnswers({ base, outs: new Set(["stop:s-aq"]), picks: new Map([["f10#0", "out"], ["off:T011", "off"]]) });
  assert.deepEqual(a.answers.get("f1#0"), { out: true });
  assert.deepEqual(a.answers.get("f2#0"), { out: true });
  assert.equal(a.answers.has("f3#0"), false);
  assert.deepEqual(a.answers.get("f10#0"), { out: true, why: "no stop on D7" });
  assert.equal(a.lanswers.get("off:T011"), "off");
  a = toAnswers({ base, picks: new Map([["f10#0", "pick:s-tw"]]) });
  assert.deepEqual(a.answers.get("f10#0"), { stop: "s-tw", who: "", rowIds: ["T010"] });
  // An act a card does not offer falls back to the likely one.
  a = toAnswers({ base, picks: new Map([["chg:T009", "add"]]) });
  assert.equal(a.lanswers.get("chg:T009"), "replace");
  // The picked stop lands in the review.
  const r = review({ list: [chg(), off()], ...toAnswers({ base, picks: new Map([["f10#0", "pick:s-tw"]]) }) });
  assert.deepEqual(r.items.filter((i) => i.key === "f10#0").map((i) => i.stop), ["s-tw"]);
});

test("the likely way, per kind: a file's first choice, else Leave it out; a line never loses pictures by default", () => {
  const card = (kind, choices) => ({ kind, choices });
  for (const kind of ["nostop", "far", "close", "ref", "several", "split", "stranger", "norow", "stays", "newstay", "limit"]) {
    assert.equal(defaultPick(card(kind, [{ stop: "s-aq" }, { stop: "s-mu" }])), "c0", kind);
    assert.equal(defaultPick(card(kind, [])), "out", kind + " with no choice");
  }
  assert.equal(defaultPick(card("outside", [])), "out");
  const L = (...acts) => ({ lchoices: acts.map((act) => ({ act })) });
  assert.equal(defaultPick(L("replace", "keep")), "replace");
  assert.equal(defaultPick(L("first", "keep")), "first");
  assert.equal(defaultPick(L("add", "keep")), "add");
  assert.equal(defaultPick(L("keep")), "keep");
  assert.equal(defaultPick(L("off", "keep")), "keep", "a file gone, a cancelled line, a line gone from the list");
  // The rule: no filled dot takes a picture off unless a newer one goes in its place.
  for (const acts of [["replace", "keep"], ["first", "keep"], ["add", "keep"], ["keep"], ["off", "keep"]]) {
    const d = defaultPick(L(...acts));
    assert.notEqual(d, "off", acts.join());
  }
  const { m } = slip({ list: [chg({ slip: "filegone", got: [], newPages: 0, lchoices: [{ act: "off" }, { act: "keep" }] }), off(), off({ key: "off:T012", slip: "offList", row: null, rowIds: ["T012"], status: "" })] });
  assert.equal(m.off, 0);
  for (const q of m.questions.filter((x) => !x.file)) assert.deepEqual(q.options.filter((o) => o.on).map((o) => o.id), ["keep"], q.key);
});

test("the questions word for word: the newer file and the stop to add, as C2", () => {
  const { m } = slip();
  const [q1, q2] = m.questions;
  assert.equal(q1.key, "f10#0");
  assert.equal(q1.head, "T010 · D7 Wed 16:30");
  assert.equal(q1.title, "Lantern boat: Day 7 has no stop for it");
  assert.deepEqual(q1.options.map((o) => [o.id, o.label, o.small, o.on]), [
    ["c0", "Add a stop for it", "Day 7, 16:30, “Lantern boat”", true],
    ["out", "Leave it out", "nothing is added for T010", false],
  ]);
  assert.equal(q1.hasPicker, true);
  assert.equal(q1.pickOn, false);
  assert.equal(q2.head, "T009 · D4 Sun 18:00");
  assert.equal(q2.title, "Kogane Garden night walk: the list has a newer file");
  assert.deepEqual(q2.options.map((o) => [o.id, o.label, o.small, o.on]), [
    ["replace", "Replace the old pictures with the new file", "the 2 old ones can be put back from History", true],
    ["keep", "Keep the old pictures", "the new file stays out", false],
  ]);
  // Moved to the picker: its dot, the stop chosen.
  const moved = slip({ picks: new Map([["f10#0", "pick:s-tw"]]) }).m.questions[0];
  assert.equal(moved.pickOn, true);
  assert.equal(moved.picked, "s-tw");
  assert.deepEqual(moved.options.filter((o) => o.on), []);
});

test("the questions word for word: every other kind", () => {
  const st = state();
  const rows = ROWS.concat([
    R({ ticket_id: "T020", start_date: "2026-12-17", start_time: "16:30", title: "Tower deck" }),
    R({ ticket_id: "T021", start_date: "2026-12-08", start_time: "08:00", title: "Before it all" }),
    R({ ticket_id: "T022", start_date: "2026-12-12", start_time: "10:00", title: "Museum pass", traveler: "Zed" }),
  ]);
  const q = (card) => questionOf(card, { rows, state: st });
  const far = q({ kind: "far", key: "k#0", rowIds: ["T020"], choices: [{ stop: "s-tw", who: "", rowIds: ["T020"] }], short: "check the stop on D8", file: { name: "T020 deck.png" } });
  assert.equal(far.title, "Tower deck: is it this stop?");
  assert.deepEqual(far.options.map((o) => [o.label, o.small]), [["Yes, put it on D8 · Tsukimi Tower", "the list says 16:30, the stop is at 17:45"], ["Leave it out", "nothing is added for T020"]]);
  assert.equal(far.hasPicker, true);
  const close = q({ kind: "close", key: "k#0", rowIds: ["T020"], choices: [{ stop: "s-tw", who: "A", rowIds: ["T020"] }, { stop: "s-fr", who: "", rowIds: ["T020"] }], short: "2 stops on D8", file: { name: "x.png" } });
  assert.equal(close.title, "Tower deck: which stop is it for?");
  assert.deepEqual(close.options.map((o) => [o.label, o.small]), [["Put it on D8 · Tsukimi Tower", "Thu 17:45 · for A"], ["Put it on D9 · Harbour ferry", "Fri 09:40"], ["Leave it out", "nothing is added for T020"]]);
  const norow = q({ kind: "norow", key: "k#0", rowIds: [], choices: [], short: "not on the list", file: { name: "ropeway.png" } });
  assert.equal(norow.head, "ropeway.png");
  assert.equal(norow.title, "ropeway.png: which stop is it for?");
  assert.deepEqual(norow.options.map((o) => [o.label, o.small]), [["Leave it out", "nothing is added"]]);
  const stranger = q({ kind: "stranger", key: "k#0", rowIds: ["T022"], choices: [{ stop: "s-mu", who: "", rowIds: ["T022"] }], short: "for Zed", file: { name: "T022.png" } });
  assert.equal(stranger.title, "Museum pass: it is for Zed, who isn’t on the trip");
  assert.deepEqual(stranger.options.map((o) => o.label), ["Add it for everyone, on D3 · Aonami Museum", "Leave it out"]);
  assert.equal(stranger.hasPicker, false);
  const outside = q({ kind: "outside", key: "k#0", rowIds: ["T021"], choices: [], short: "not in the trip’s days", file: { name: "T021.png" } });
  assert.equal(outside.title, "Before it all: not in the trip’s days");
  assert.deepEqual(outside.options.map((o) => [o.label, o.small]), [["Leave it out", "the list dates it Dec 8"]]);
  assert.equal(outside.hasPicker, true);
  assert.equal(defaultPick({ kind: "outside", choices: [] }), "out");
  const some = q({ kind: "limit", key: "k#0", rowIds: ["T020"], place: { stop: "s-tw" }, pages: 9, room: 6, choices: [{ stop: "s-tw", who: "", rowIds: ["T020"], pages: 6, cut: "stop" }], short: "9 pages, 6 fit", file: { name: "T020.pdf" } });
  assert.equal(some.title, "Tower deck: 9 pages, 6 fit on the stop");
  assert.deepEqual(some.options.map((o) => [o.label, o.small]), [["Add the first 6 pages", "D8 · Tsukimi Tower"], ["Leave it out", "nothing is added for T020"]]);
  const full = q({ kind: "limit", key: "k#0", rowIds: ["T020"], place: { stop: "s-tw" }, pages: 2, room: 0, choices: [], short: "stop full, 8 of 8", file: { name: "T020.pdf" } });
  assert.equal(full.title, "Tower deck: D8 · Tsukimi Tower is full (8 pictures)");
  assert.deepEqual(full.options.map((o) => o.label), ["Leave it out"]);
  const trip = q({ kind: "limit", key: "k#0", rowIds: ["T020"], place: { stop: "s-tw" }, pages: 2, room: 0, choices: [], short: "trip full, 120 of 120", file: { name: "T020.pdf" } });
  assert.equal(trip.title, "Tower deck: the trip is full (120 pictures)");
  const stays = q({ kind: "stays", key: "k#0", rowIds: ["T004"], choices: [{ stay: "y-1", who: "", rowIds: ["T004"] }], short: "2 stays start Dec 10", file: { name: "T004.png" } });
  assert.equal(stays.title, "Mizuumi lodge: two stays start that night".replace("two", "1"));
  assert.deepEqual(stays.options.map((o) => [o.label, o.small]), [["Put it on Mizuumi lodge", "Dec 10 to 13"], ["Leave it out", "nothing is added for T004"]]);
  assert.equal(stays.hasPicker, false);
  const two = q({ kind: "stays", key: "k#0", rowIds: ["T004"], choices: [{ stay: "y-1" }, { stay: "y-1" }], short: "2 stays start Dec 10", file: { name: "T004.png" } });
  assert.equal(two.title, "Mizuumi lodge: two stays start that night");
  const ns = q({ kind: "newstay", key: "k#0", rowIds: ["T004"], choices: [{ newStay: { name: "Lakeside Inn", firstNight: "2026-12-14", lastNight: "2026-12-14" } }], short: "a stay with no card", file: { name: "T004.png" } });
  assert.equal(ns.title, "Mizuumi lodge: no stay in MAT has that night");
  assert.deepEqual(ns.options.map((o) => [o.label, o.small]), [["Add the stay and its booking", "Lakeside Inn · night of Dec 14"], ["Leave it out", "nothing is added for T004"]]);
  const ns2 = q({ kind: "newstay", key: "k#0", rowIds: ["T004"], choices: [{ newStay: { name: "Lakeside Inn", firstNight: "2026-12-13", lastNight: "2026-12-14" } }], short: "", file: { name: "T004.png" } });
  assert.equal(ns2.options[0].small, "Lakeside Inn · Dec 13 to 15");
  // The list's lines.
  const another = q(chg({ slip: "another", drop: [], newPages: 2, lchoices: [{ act: "add" }, { act: "keep" }] }));
  assert.equal(another.title, "Kogane Garden night walk: the list has one more file");
  assert.deepEqual(another.options.map((o) => [o.id, o.label, o.small]), [["add", "Add it too", "2 pages; the other pictures stay"], ["keep", "Leave it out", "nothing changes"]]);
  const first = q(chg({ slip: "first", lchoices: [{ act: "first" }, { act: "keep" }] }));
  assert.deepEqual(first.options.map((o) => [o.id, o.label, o.small]), [["first", "Take the old pictures off, then add the new file", "the stop holds 8 pictures; the old ones can be put back from History"], ["keep", "Keep the old pictures", "the new file stays out"]]);
  const one = q(chg({ drop: [{ id: "old1", from: "x" }] }));
  assert.equal(one.options[0].small, "the 1 old one can be put back from History");
  const gone = q(chg({ slip: "filegone", got: [], lchoices: [{ act: "off" }, { act: "keep" }] }));
  assert.equal(gone.title, "Kogane Garden night walk: a file is gone from the list");
  assert.deepEqual(gone.options.map((o) => [o.id, o.label, o.small]), [["keep", "Leave its pictures on", "nothing changes"], ["off", "Take its 2 pictures off", "they can be put back from History"]]);
  const cancelled = q(off());
  assert.equal(cancelled.head, "T011 · D8 Thu 21:00");
  assert.equal(cancelled.title, "Night bus: cancelled in the list");
  const offList = q(off({ slip: "offList", row: null, rowIds: ["T012"] }));
  assert.equal(offList.head, "T012");
  assert.equal(offList.title, "T012: no longer on the list");
  const placeGone = q(chg({ slip: "placeGone", lchoices: [{ act: "keep" }] }));
  assert.equal(placeGone.title, "Kogane Garden night walk: its stop is no longer on the trip");
  assert.deepEqual(placeGone.options.map((o) => [o.id, o.label, o.small]), [["keep", "Leave it", "add its new file by hand if you need it"]]);
});

test("a question that appears only because a dot moved: a stop now full, under the others, Leave it out filled", () => {
  // The tower holds 7 pictures; the boat is put there by the picker, and a 2-page file is too many.
  const tickets = Array.from({ length: 7 }, (_, i) => ({ id: "t" + i, stop: "s-tw" }));
  const files = FILES.slice(0, 4).concat([pdf("f10", "T010 boat.pdf", 2)]);
  const st = state({ tickets });
  const { m, extras, result } = slip({ files, st, picks: new Map([["f10#0", "pick:s-tw"]]) });
  assert.deepEqual(extras.map((e) => [e.key, e.card.kind]), [["more:f10#0", "limit"]]);
  const q = m.questions[m.questions.length - 1];
  assert.equal(q.key, "more:f10#0");
  assert.equal(q.extra, true);
  assert.equal(q.title, "Lantern boat: 2 pages, 1 fit on the stop");
  assert.deepEqual(q.options.map((o) => [o.id, o.on]), [["c0", false], ["out", true]]);
  assert.deepEqual(m.check.left, "Check these 3");
  assert.equal(result.cards.length, 0);
  assert.equal(result.items.some((i) => i.key === "f10#0"), false);
  // Its first choice: the first page goes on.
  const yes = slip({ files, st, picks: new Map([["f10#0", "pick:s-tw"], ["more:f10#0", "c0"]]) });
  assert.deepEqual(yes.result.items.filter((i) => i.key === "f10#0").map((i) => [i.stop, i.pages]), [["s-tw", 1]]);
  assert.equal(yes.m.button, "Add 6 tickets");
});

test("skipsOf: what Add remembers, the cells out, the questions on Leave it out, the lines kept; never the defaults that add", () => {
  const base = review({ list: [chg(), off()] });
  assert.deepEqual(skipsOf({ base }), { items: [], cards: [], keeps: ["off:T011"] });
  assert.deepEqual(skipsOf({ base, outs: new Set(["stop:s-aq"]), picks: new Map([["f10#0", "out"], ["chg:T009", "keep"], ["off:T011", "off"]]) }), { items: ["f1#0", "f2#0"], cards: ["f10#0"], keeps: ["chg:T009"] });
});

test("nothing new: no cells, no questions, the button disabled, the say line", () => {
  const { m } = slip({ files: [], list: [], aside: { quiet: { noFile: 2, outside: 1, unlisted: 1, skipped: 2 } } });
  assert.equal(m.none, true);
  assert.equal(m.will, null);
  assert.equal(m.check, null);
  assert.deepEqual(m.cells, []);
  assert.equal(m.button, "Nothing to add");
  assert.equal(m.canAdd, false);
  assert.equal(m.say, "Nothing new on the list.");
  assert.deepEqual(m.notes, [
    { text: "On the list: 2 lines have no file yet, 1 is outside the trip’s days, 1 file in the folder isn’t on the list" },
    { text: "2 left out before on this phone. ", unskip: true },
  ]);
});

test("the notes: already there, filled by hand, fetched and read, not active; read at", () => {
  const st = state({ tickets: [] });
  const there = (fileKey) => fileKey === "f3";
  const base = review({ st });
  base.out.push({ kind: "hand", stop: "s-rw", label: "T030" }, { kind: "hand", stop: "s-rw", label: "T031" }, { kind: "inactive", label: "T040" });
  const r = sortFiles({ files: FILES, rows: ROWS, state: st, isThere: there });
  r.out.push(...base.out.slice(-3));
  r.listDone = [];
  const m = slipModel({ base, state: st, rows: ROWS, result: r, listAt: "2026-12-12T09:12:00+09:00", aside: { hand: [{ stop: "s-fr", label: "T050" }], failed: [{ label: "T060 a.png", why: "no signal: Check the list again later" }, { label: "T061 b.pdf", why: "couldn’t be read on this phone" }], quiet: { noFile: 1 } } });
  assert.deepEqual(m.notes.map((n) => n.text), [
    "1 already there, not added twice",
    "2 stops were filled by hand; the list’s tickets for them are left out",
    "1 file couldn’t be fetched: T060 a.png (no signal: Check the list again later)",
    "1 file couldn’t be read on this phone: T061 b.pdf",
    "1 is not active on the list, left out",
    "On the list: 1 line has no file yet",
  ]);
  assert.equal(m.notes[2].warn, true);
  assert.equal(m.at, "read at " + new Date(Date.parse("2026-12-12T09:12:00+09:00")).toTimeString().slice(0, 5));
});

test("cellsOf: a stay to add and a stop to add are cells of their own", () => {
  const cells = cellsOf([
    { key: "a#0", newStop: { date: "2026-12-16", time: "", title: "Lantern boat" }, who: "" },
    { key: "b#0", newStay: { name: "Lakeside Inn", firstNight: "2026-12-14", lastNight: "2026-12-14" }, who: "" },
  ], state());
  assert.deepEqual(cells.map((c) => [c.key, c.small, c.title]), [["new:2026-12-14:Lakeside Inn", "D5 · stay", "Lakeside Inn"], ["newstop:2026-12-16::Lantern boat", "D7 Wed", "Lantern boat"]]);
});

test("addedSlip: one cell per place that got something, with what happened there", () => {
  const items = [
    { key: "f1#0", stop: "s-aq", who: "A", saved: 1, waiting: 0 },
    { key: "f2#0", stop: "s-aq", who: "B", saved: 0, waiting: 1 },
    { key: "f10#0", stop: "s-new", who: "", saved: 1, waiting: 0, made: "stop" },
    { key: "chg:T009#0", stop: "s-kg", who: "", saved: 1, waiting: 0, replaced: true },
    { key: "f4#0", stay: "y-1", who: "", saved: 1, waiting: 0, made: "stay" },
    { key: "f9#0", stop: "s-mu", who: "", saved: 0, waiting: 0, failed: 1 },
  ];
  const st = state({ stops: STOPS.concat([{ id: "s-new", date: "2026-12-16", time: "16:30", title: "Lantern boat" }]) });
  const d = addedSlip({ items, state: st, at: "2026-12-12T09:13:00+09:00" });
  assert.equal(d.left, "Added · 5 tickets");
  assert.equal(d.right, "on 3 stops and 1 stay");
  assert.deepEqual(d.cells.map((c) => [c.small, c.title, c.how]), [
    ["D1 · stay", "Mizuumi lodge", "stay added"],
    ["D2 Fri 13:00 · 2 tickets", "Sakuragawa Aquarium", "1 picture waiting for signal"],
    ["D4 Sun 18:00", "Kogane Garden", "old pictures replaced"],
    ["D7 Wed 16:30", "Lantern boat", "stop added"],
  ]);
  assert.match(d.at, /^added at \d\d:\d\d$/);
  assert.equal(placeKey(items[0]), "stop:s-aq");
});
