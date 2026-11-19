/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// js/bulk.js: reading the list and matching dropped files to lines and stops.
// Everything is made up: people A, B and C, invented places, references and codes.
import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseList, listRefused, idsAtStart, rowsForFile, sortFiles, factsFor, seatFor, stopLabel } from "../js/bulk.js";

const HEAD = "ticket_id,booking_key,start_date,start_time,end_date,end_time,type,title,provider,confirmation,traveler,ticket_ref,seat,holder,how_to_use,file_url,manage_url,deadline,deadline_what,notes,status,book_now_no,updated,added_by";
const COLS = HEAD.split(",");
const line = (o) => COLS.map((c) => {
  const v = o[c] === undefined ? "" : String(o[c]);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}).join(",");
const csv = (rows) => [HEAD, ...rows.map(line)].join("\n");

const DAYS = Array.from({ length: 11 }, (_, i) => ({ date: "2026-12-" + String(10 + i).padStart(2, "0") }));
const STOPS = [
  { id: "s-aq", date: "2026-12-15", time: "13:00", title: "Sakuragawa Aquarium" },
  { id: "s-rw1", date: "2026-12-14", time: "11:00", title: "Hoshizora Ropeway, up" },
  { id: "s-rw2", date: "2026-12-17", time: "10:30", title: "Hoshizora Ropeway, night run" },
  { id: "s-mu", date: "2026-12-11", time: "10:00", title: "Aonami Museum" },
  { id: "s-tr1", date: "2026-12-12", time: "09:00", title: "Kitamine train" },
  { id: "s-tr2", date: "2026-12-12", time: "09:40", title: "Lunch stop" },
  { id: "s-ck", date: "2026-12-13", time: "15:00", title: "Check in at Mizuumi lodge" },
  { id: "s-fl", date: "2026-12-10", time: "08:00", title: "Flight out" },
  { id: "s-un", date: "2026-12-16", time: "", title: "Kumo garden" },
  { id: "s-gone", date: "2026-12-16", time: "12:00", title: "Removed one", deleted: true },
];
const PEOPLE = [{ name: "A" }, { name: "B" }, { name: "C" }];
const state = (more = {}) => ({ days: DAYS, stops: STOPS, people: PEOPLE, tickets: [], ...more });
const png = (key, name, extra = {}) => ({ key, name, kind: "image/png", pages: 1, sig: { mime: "image/png", w: 400, h: 400, size: 1000 + key.length, hash: "h-" + key }, ...extra });
const pdf = (key, name, pages, extra = {}) => ({ key, name, kind: "application/pdf", pages, sig: { mime: "image/jpeg", w: 900, h: 1200, size: 5000, hash: "p-" + key }, ...extra });
const R = (o) => ({ status: "active", traveler: "ALL", type: "activity", ...o });

// ---------- the list ----------

test("the CSV: quotes, commas and line breaks inside quotes, a doubled quote, a BOM, CRLF", () => {
  const t = "﻿a,b,c\r\n1,\"two, too\",\"line\nbreak\"\r\n\"say \"\"hi\"\"\",,x\r\n";
  assert.deepEqual(parseCsv(t), [["a", "b", "c"], ["1", "two, too", "line\nbreak"], ['say "hi"', "", "x"]]);
});

test("parseList: rows by column name; a BOM before the header; unknown columns ignored; blank lines skipped", () => {
  const t = "﻿" + HEAD + ",extra_col\nT001,,2026-12-15,13:00,,,activity,Sakuragawa Aquarium,Aqua Co,QX7781,ALL,,,A,,,,,,\"notes, with comma\",active,,,,zzz\n\n";
  const { rows, error } = parseList(t);
  assert.equal(error, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ticket_id, "T001");
  assert.equal(rows[0].start_date, "2026-12-15");
  assert.equal(rows[0].notes, "notes, with comma");
  assert.equal(rows[0].extra_col, "zzz");
});

test("parseList: a missing ticket_id or start_date column refuses the list with a sentence", () => {
  const noDate = parseList("ticket_id,title\nT001,Thing\n");
  assert.deepEqual(noDate.rows, []);
  assert.equal(noDate.error, listRefused("start_date"));
  assert.match(noDate.error, /start_date/);
  const noId = parseList("start_date,title\n2026-12-15,Thing\n");
  assert.equal(noId.error, listRefused("ticket_id"));
  assert.equal(parseList("").error, listRefused("ticket_id"));
});

test("a refused list: the files are matched without it", () => {
  const out = sortFiles({ files: [png("f1", "T001 aquarium.png")], rows: [R({ ticket_id: "T001", start_date: "2026-12-15", start_time: "13:00" })], listError: "refused", state: state() });
  assert.equal(out.items.length, 0);
  assert.equal(out.cards.length, 1);
  assert.equal(out.cards[0].kind, "norow");
  assert.deepEqual(out.cards[0].choices.map((c) => c.stop), ["s-aq"]);
});

// ---------- rule 1: ticket ids at the start of the name ----------

test("rule 1: the name starts with a ticket id, any case, then a space, _, - or .", () => {
  const rows = [R({ ticket_id: "T007" }), R({ ticket_id: "T070" }), R({ ticket_id: "T0071" })];
  assert.deepEqual(idsAtStart("T007 e-ticket.pdf", rows), ["T007"]);
  assert.deepEqual(idsAtStart("t007_x.png", rows), ["T007"]);
  assert.deepEqual(idsAtStart("T007-x.png", rows), ["T007"]);
  assert.deepEqual(idsAtStart("T007.pdf", rows), ["T007"]);
  assert.deepEqual(idsAtStart("T0071 x.pdf", rows), ["T0071"]);
  assert.deepEqual(idsAtStart("T007x.pdf", rows), []);
  assert.deepEqual(idsAtStart("my T007 x.pdf", rows), []);
});

test("rule 1: several ids at the start, space-separated, belong to every one of those lines", () => {
  const rows = [R({ ticket_id: "T009" }), R({ ticket_id: "T010" }), R({ ticket_id: "T011" })];
  assert.deepEqual(idsAtStart("T009 T010 T011 Some park order.png", rows), ["T009", "T010", "T011"]);
  assert.deepEqual(rowsForFile("T009 T010 T011 Some park order.png", rows).rows.map((r) => r.ticket_id), ["T009", "T010", "T011"]);
});

// ---------- rule 2: the reference in the name ----------

test("rule 2: a confirmation or ticket_ref of 5 or more characters, ignoring case and punctuation", () => {
  const rows = [R({ ticket_id: "T001", confirmation: "QX-77 81" }), R({ ticket_id: "T002", ticket_ref: "ZZ12" }), R({ ticket_id: "T003", ticket_ref: "KM-55021" })];
  assert.equal(rowsForFile("booking qx7781.pdf", rows).rows[0].ticket_id, "T001");
  assert.equal(rowsForFile("e_ticket_km55021.png", rows).rows[0].ticket_id, "T003");
  // Four characters are too few to trust.
  assert.equal(rowsForFile("zz12.png", rows).how, "none");
});

test("rule 2: several lines with the reference: the one whose traveler is named too; still several, odd", () => {
  const rows = [R({ ticket_id: "T014", confirmation: "AQ55501", traveler: "Avi" }), R({ ticket_id: "T015", confirmation: "AQ55501", traveler: "Bea" })];
  assert.equal(rowsForFile("AQ55501 bea.png", rows).rows[0].ticket_id, "T015");
  const both = rowsForFile("AQ55501.png", rows);
  assert.equal(both.how, "several");
  const out = sortFiles({ files: [png("f", "AQ55501.png")], rows: [R({ ticket_id: "T014", confirmation: "AQ55501", traveler: "A", start_date: "2026-12-15", start_time: "13:00" }), R({ ticket_id: "T015", confirmation: "AQ55501", traveler: "B", start_date: "2026-12-15", start_time: "13:00" })], state: state() });
  assert.equal(out.cards.length, 1);
  assert.equal(out.cards[0].kind, "several");
  assert.deepEqual(out.cards[0].choices.map((c) => [c.stop, c.who]), [["s-aq", "A"], ["s-aq", "B"]]);
});

test("rule 3: no line of the list: odd, offering the stops whose name the file shares", () => {
  const out = sortFiles({ files: [png("f", "hoshizora ropeway.png")], rows: [], state: state() });
  assert.equal(out.cards.length, 1);
  const c = out.cards[0];
  assert.equal(c.kind, "norow");
  assert.equal(c.ask, "Two stops have this name.");
  assert.equal(c.onList, false);
  assert.deepEqual(c.choices.map((x) => x.stop), ["s-rw1", "s-rw2"]);
  // Nothing shared: no choices, only another stop or out.
  assert.deepEqual(sortFiles({ files: [png("g", "IMG_7702.PNG")], state: state() }).cards[0].choices, []);
});

// ---------- a line to a stop ----------

test("the stop on the line's day nearest its time, within 90 minutes: sure", () => {
  const rows = [R({ ticket_id: "T001", start_date: "2026-12-15", start_time: "12:10", title: "Aquarium" })];
  const out = sortFiles({ files: [png("f", "T001 x.png")], rows, state: state() });
  assert.deepEqual(out.items.map((i) => [i.stop, i.who, i.pages, i.from]), [["s-aq", "", 1, "sure"]]);
  assert.equal(out.items[0].label, "T001 · Aquarium");
});

test("two stops close: a word of the title or provider settles it; otherwise odd, offering both", () => {
  const settled = sortFiles({ files: [png("f", "T001 x.png")], rows: [R({ ticket_id: "T001", start_date: "2026-12-12", start_time: "09:20", title: "Kitamine line", provider: "Rail Co" })], state: state() });
  assert.equal(settled.items[0].stop, "s-tr1");
  const odd = sortFiles({ files: [png("f", "T001 x.png")], rows: [R({ ticket_id: "T001", start_date: "2026-12-12", start_time: "09:20", title: "Something" })], state: state() });
  assert.equal(odd.items.length, 0);
  assert.equal(odd.cards[0].kind, "close");
  assert.deepEqual(odd.cards[0].choices.map((c) => c.stop), ["s-tr1", "s-tr2"]);
});

test("no stop that day near the time: odd, 'No stop on Day N at HH:MM', no choices (pick a stop or leave it out)", () => {
  const out = sortFiles({ files: [png("f", "T019 lantern boat.png")], rows: [R({ ticket_id: "T019", start_date: "2026-12-16", start_time: "19:30", title: "Lantern boat" })], state: state() });
  const c = out.cards[0];
  assert.equal(c.kind, "nostop");
  assert.equal(c.ask, "No stop on Day 7 at 19:30.");
  assert.equal(c.short, "no stop on D7");
  assert.deepEqual(c.choices, []);
  assert.equal(c.label, "T019 · Lantern boat");
});

test("an untimed stop counts only by name", () => {
  const out = sortFiles({ files: [png("f", "T020 x.png")], rows: [R({ ticket_id: "T020", start_date: "2026-12-16", start_time: "10:00", title: "Kumo garden entry" })], state: state() });
  assert.equal(out.items[0].stop, "s-un");
});

test("a date outside the trip's days: odd, 'not in the trip's days'", () => {
  const out = sortFiles({ files: [png("f", "T002 x.png")], rows: [R({ ticket_id: "T002", start_date: "2026-12-05", start_time: "10:00", title: "Before Japan" })], state: state() });
  assert.equal(out.cards[0].kind, "outside");
  assert.equal(out.cards[0].ask, "Not in the trip’s days.");
});

test("lodging: odd, offering the stop that starts the stay", () => {
  const out = sortFiles({ files: [png("f", "T030 x.pdf")], rows: [R({ ticket_id: "T030", type: "lodging", start_date: "2026-12-13", start_time: "15:00", title: "Mizuumi lodge" })], state: state() });
  assert.equal(out.items.length, 0);
  assert.equal(out.cards[0].kind, "lodging");
  assert.deepEqual(out.cards[0].choices.map((c) => c.stop), ["s-ck"]);
});

test("a status other than active (or empty) is left out and listed", () => {
  const rows = [R({ ticket_id: "T040", status: "cancelled", start_date: "2026-12-15", start_time: "13:00" }), R({ ticket_id: "T041", status: "", start_date: "2026-12-15", start_time: "13:00" })];
  const out = sortFiles({ files: [png("f", "T040 x.png"), png("g", "T041 x.png")], rows, state: state() });
  assert.deepEqual(out.out.map((o) => [o.kind, o.why]), [["inactive", "on the list as cancelled"]]);
  assert.deepEqual(out.items.map((i) => i.rowIds), [["T041"]]);
});

test("traveler: a first name on the trip makes the ticket that person's; ALL or empty is for everyone", () => {
  const rows = ["A", "b", "ALL", ""].map((t, i) => R({ ticket_id: "T05" + i, traveler: t, start_date: "2026-12-15", start_time: "13:00", title: "Aquarium" }));
  const files = rows.map((r, i) => png("f" + i, r.ticket_id + " aquarium.png"));
  const out = sortFiles({ files, rows, state: state() });
  assert.deepEqual(out.items.map((i) => i.who), ["A", "B", "", ""]);
});

test("traveler: a name not on the trip is a card (for everyone, or out)", () => {
  const out = sortFiles({ files: [png("f", "T060 x.png")], rows: [R({ ticket_id: "T060", traveler: "Dee", start_date: "2026-12-15", start_time: "13:00" })], state: state() });
  assert.equal(out.cards[0].kind, "stranger");
  assert.deepEqual(out.cards[0].choices.map((c) => [c.stop, c.who]), [["s-aq", ""]]);
});

test("a file that is not a PDF, PNG or JPG is 'not a ticket file', left out", () => {
  const out = sortFiles({ files: [{ key: "i", name: "T001 cal.ics", kind: null, pages: 0 }, { key: "e", name: "mail.eml", kind: null }], rows: [R({ ticket_id: "T001", start_date: "2026-12-15", start_time: "13:00" })], state: state() });
  assert.deepEqual(out.out.map((o) => [o.kind, o.why]), [["notTicket", "not a ticket file"], ["notTicket", "not a ticket file"]]);
  assert.equal(out.items.length + out.cards.length, 0);
});

test("one line, several files: every picture or PDF goes to the same stop; the .ics is not a ticket file", () => {
  const rows = [R({ ticket_id: "T001", start_date: "2026-12-15", start_time: "13:00", title: "Aquarium" })];
  const files = [png("a", "T001 tickets.png"), pdf("b", "T001 invoice.pdf", 1), pdf("c", "T001 email.pdf", 2), { key: "d", name: "T001 calendar.ics", kind: null }];
  const out = sortFiles({ files, rows, state: state() });
  assert.deepEqual(out.items.map((i) => [i.file.key, i.stop, i.pages]), [["c", "s-aq", 2], ["b", "s-aq", 1], ["a", "s-aq", 1]]);
  assert.deepEqual(out.out.map((o) => [o.file.key, o.kind]), [["d", "notTicket"]]);
  assert.equal(out.quiet, 0);
});

test("several ids, all on one stop: attached once there", () => {
  const rows = ["T009", "T010", "T011"].map((id) => R({ ticket_id: id, start_date: "2026-12-16", start_time: "11:00", title: "Kumo garden" }));
  const out = sortFiles({ files: [png("f", "T009 T010 T011 Some park order.png")], rows, state: state() });
  assert.deepEqual(out.items.map((i) => [i.stop, i.rowIds, i.who]), [["s-un", ["T009", "T010", "T011"], ""]]);
});

test("several ids, one per person on one stop: one picture there, for everyone", () => {
  const rows = ["A", "B", "C"].map((t, i) => R({ ticket_id: "T01" + i, traveler: t, start_date: "2026-12-15", start_time: "13:00" }));
  const out = sortFiles({ files: [png("f", "T010 T011 T012 aquarium.png")], rows, state: state() });
  assert.deepEqual(out.items.map((i) => [i.stop, i.who]), [["s-aq", ""]]);
});

test("several ids on different stops: attached to each, counting toward each stop's limit", () => {
  const rows = [R({ ticket_id: "T003", start_date: "2026-12-10", start_time: "08:00", title: "Flight" }), R({ ticket_id: "T024", start_date: "2026-12-14", start_time: "11:00", title: "Ropeway" })];
  const tickets = Array.from({ length: 8 }, (_, i) => ({ id: "x" + i, stop: "s-rw1" }));
  const out = sortFiles({ files: [pdf("f", "T003 T024 Some airline eTicket.pdf", 2)], rows, state: state() });
  assert.deepEqual(out.items.map((i) => [i.stop, i.key, i.pages]), [["s-fl", "f#0", 2], ["s-rw1", "f#1", 2]]);
  assert.equal(out.after, 4);
  // The second stop already full: that placement alone becomes a card.
  const full = sortFiles({ files: [pdf("f", "T003 T024 Some airline eTicket.pdf", 2)], rows, state: state({ tickets }) });
  assert.deepEqual(full.items.map((i) => i.stop), ["s-fl"]);
  assert.equal(full.cards[0].kind, "limit");
  assert.equal(full.cards[0].short, "stop full, 8 of 8");
});

test("several ids on different stops, per-person: a card (one stop only), not duplicate codes", () => {
  const rows = [R({ ticket_id: "T003", traveler: "A", start_date: "2026-12-10", start_time: "08:00" }), R({ ticket_id: "T024", traveler: "A", start_date: "2026-12-14", start_time: "11:00" })];
  const out = sortFiles({ files: [png("f", "T003 T024 x.png")], rows, state: state() });
  assert.equal(out.items.length, 0);
  assert.equal(out.cards[0].kind, "split");
  assert.deepEqual(out.cards[0].choices.map((c) => [c.stop, c.who, c.rowIds]), [["s-fl", "A", ["T003"]], ["s-rw1", "A", ["T024"]]]);
});

// ---------- already there, limits ----------

test("a file already on its stop is 既 already there, left out; so is the same file dropped twice", () => {
  const rows = [R({ ticket_id: "T006", start_date: "2026-12-11", start_time: "10:00", title: "Museum" })];
  const there = sortFiles({ files: [png("f", "T006 museum.png")], rows, state: state(), isThere: (k, stop) => k === "f" && stop === "s-mu" });
  assert.deepEqual(there.out.map((o) => [o.kind, o.stop]), [["there", "s-mu"]]);
  assert.equal(there.items.length, 0);
  const twice = sortFiles({ files: [png("f", "T006 museum.png"), { ...png("f", "T006 museum copy.png"), key: "g" }], rows, state: state() });
  assert.equal(twice.items.length, 1);
  assert.equal(twice.out[0].kind, "there");
});

test("limits: 8 pictures per stop, counting PDF pages; a file that breaks it is a card 'N pages, M fit'", () => {
  const rows = [R({ ticket_id: "T012", start_date: "2026-12-12", start_time: "09:00", title: "Kitamine pass" })];
  const tickets = [{ id: "a", stop: "s-tr1" }, { id: "b", stop: "s-tr1" }, { id: "g", stop: "s-tr1", gone: true }];
  const out = sortFiles({ files: [pdf("f", "T012 pass.pdf", 11)], rows, state: state({ tickets }) });
  assert.equal(out.items.length, 0);
  const c = out.cards[0];
  assert.equal(c.kind, "limit");
  assert.equal(c.short, "11 pages, 6 fit");
  assert.deepEqual(c.choices.map((x) => [x.stop, x.pages]), [["s-tr1", 6]]);
  assert.equal(out.now, 2);
  // Answered "First 6 pages": in, with 6.
  const yes = sortFiles({ files: [pdf("f", "T012 pass.pdf", 11)], rows, state: state({ tickets }), answers: new Map([["f#0", { stop: "s-tr1", who: "", rowIds: ["T012"], pages: 6 }]]) });
  assert.deepEqual(yes.items.map((i) => [i.stop, i.pages]), [["s-tr1", 6]]);
  assert.equal(yes.after, 8);
});

test("limits: 120 pictures per trip", () => {
  const tickets = Array.from({ length: 119 }, (_, i) => ({ id: "t" + i, stop: "s-fl" }));
  const rows = [R({ ticket_id: "T001", start_date: "2026-12-15", start_time: "13:00" }), R({ ticket_id: "T002", start_date: "2026-12-15", start_time: "13:00" })];
  const out = sortFiles({ files: [png("a", "T001 a.png"), png("b", "T002 b.png")], rows, state: state({ tickets }) });
  assert.equal(out.items.length, 1);
  assert.equal(out.cards[0].kind, "limit");
  assert.match(out.cards[0].short, /trip full/);
  assert.equal(out.after, 120);
});

// ---------- answers, counts, facts ----------

test("answers: a card answered goes in as checked; left out is listed with the card's reason", () => {
  const rows = [R({ ticket_id: "T019", start_date: "2026-12-16", start_time: "19:30", title: "Lantern boat" })];
  const files = [png("f", "T019 x.png"), png("g", "IMG_7702.PNG")];
  const answers = new Map([["f#0", { out: true }], ["g#0", { stop: "s-rw2", who: "", rowIds: [] }]]);
  const out = sortFiles({ files, rows, state: state(), answers });
  assert.deepEqual(out.items.map((i) => [i.stop, i.from]), [["s-rw2", "card"]]);
  assert.deepEqual(out.out.map((o) => [o.label, o.why]), [["T019 · Lantern boat", "left out: no stop on D7"]]);
  assert.equal(out.cards.length, 0);
});

test("answers: a sure line changed in the untied list (another stop, for one person, or out)", () => {
  const rows = [R({ ticket_id: "T001", start_date: "2026-12-15", start_time: "13:00" })];
  const moved = sortFiles({ files: [png("f", "T001 x.png")], rows, state: state(), answers: new Map([["f#0", { stop: "s-mu", who: "B", rowIds: ["T001"] }]]) });
  assert.deepEqual(moved.items.map((i) => [i.stop, i.who, i.from]), [["s-mu", "B", "sure"]]);
  const out = sortFiles({ files: [png("f", "T001 x.png")], rows, state: state(), answers: new Map([["f#0", { out: true }]]) });
  assert.equal(out.items.length, 0);
  assert.equal(out.out[0].why, "left out");
});

test("lines of the list with no file are counted quietly, never cards", () => {
  const rows = ["T001", "T002", "T003"].map((id) => R({ ticket_id: id, start_date: "2026-12-15", start_time: "13:00" }));
  const out = sortFiles({ files: [png("f", "T001 x.png")], rows, state: state() });
  assert.equal(out.quiet, 2);
  assert.equal(out.cards.length, 0);
});

test("a deleted stop is never matched or offered", () => {
  const out = sortFiles({ files: [png("f", "T001 x.png")], rows: [R({ ticket_id: "T001", start_date: "2026-12-16", start_time: "12:00", title: "Removed one" })], state: state() });
  assert.equal(out.items.length, 0);
  assert.ok(!out.cards[0].choices.some((c) => c.stop === "s-gone"));
});

test("facts: the stop's empty ticket fields from the line, never overwriting; a person's seat on their picture", () => {
  const rows = [
    R({ ticket_id: "T001", confirmation: "QX7781", holder: "A", seat: "Car 3 7A-C" }),
    R({ ticket_id: "T002", ticket_ref: "KM55021", holder: "B", seat: "12B", traveler: "B" }),
  ];
  const stops = [{ id: "s1", tkRef: "", tkName: "Already", tkSeat: "" }, { id: "s2" }];
  const items = [{ stop: "s1", who: "", rowIds: ["T001"] }, { stop: "s2", who: "B", rowIds: ["T002"] }];
  assert.deepEqual(factsFor(items, rows, stops), { s1: { tkRef: "QX7781", tkSeat: "Car 3 7A-C" }, s2: { tkRef: "KM55021", tkName: "B" } });
  assert.equal(seatFor(items[1], rows), "12B");
  assert.equal(seatFor(items[0], rows), "");
});

test("stopLabel: day number, weekday and time, title", () => {
  assert.deepEqual(stopLabel(STOPS[1], DAYS), { d: "D5", when: "Mon 11:00", title: "Hoshizora Ropeway, up" });
});
