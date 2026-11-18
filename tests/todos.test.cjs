/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// "Before we go" (Task 19): the planner's Book Now tab pulled into the Todos
// tab, ticks written back to the planner. Pure helpers from Pure.js; actions
// through the fake backend (the real Actions.js and Mcp.js) and its fake
// planner, which records every write it receives. Every planner value here is
// made up: items, notes, links, numbers and the sheet id.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../backend/Pure.js");
const { createFakeBackend } = require("./fake-backend.cjs");

const KEY = "test-key";
const PLANNER_ID = "fakePlannerSheet_0123456789abcdefXYZ";

// ---------- the Book Now tab and the Change Log, as Sheets hands them back ----------

const BHEAD = ["#", "Item", "Who", "Book by", "Status", "Notes", "Booking link"];
const brow = (o) => BHEAD.map((h) => (o[h] === undefined ? "" : o[h]));
const B1 = { "#": 1, Item: "Rail pass reservation", Who: "Mo", "Book by": "2026-11-25", Status: "Not booked", Notes: "Seats for three", "Booking link": "https://rail.example.test/book" };
const B2 = { "#": 2, Item: "Tea ceremony class", "Book by": "Dec 1", Status: "Pending", "Booking link": "javascript:alert(1)" };
const B3 = { "#": 3, Item: "Snow park day trip", "Book by": "5 Dec", Status: "Booked" };
// A title row and a blank row above the header (row 3), a row with no item,
// and a footnote line under the table.
const bookNow = (...items) => [["Before we go: bookings"], [], BHEAD, ...items.map(brow), brow({ "#": 9, Item: "" }), ["* Prices are estimates", "Ask Mo before booking"]];
const BOOK = bookNow(B1, B2, B3); // B1 is row 4, B2 row 5, B3 row 6; Status is column E

const CHEAD = ["#", "Date / time", "Agent / session", "Tab", "Cell(s)", "Item", "Old value", "New value", "Why", "Proof / source", "Verified?"];
const LOG = [["Change log"], CHEAD, [6, "2026-11-01 10:00 ET", "Planner chat", "Book Now", "E5", "Tea ceremony class", "(empty)", "Pending", "Asked the host", "", ""], ["7.0", "2026-11-02 09:00 ET", "Planner chat", "Payments", "C2", "x", "a", "b", "", "", ""]];

// A fake whose clock can be moved: at.now = ISO string.
function linked({ book = BOOK, log = LOG, over = {} } = {}) {
  const at = { now: "2026-11-20T15:00:00.000Z" };
  // lock.busy(n): whether the app's nth lock taking finds it busy (test-only).
  const lock = { n: 0, busy: () => false };
  const fake = createFakeBackend({ plannerId: PLANNER_ID, plannerTabs: { "Book Now": book, "Change Log": log }, ...over }, { clock: () => at.now, lockFails: () => lock.busy(++lock.n) });
  const call = (action, args = {}, actor = "Mo") => fake({ key: KEY, actor, action, args });
  call.fake = fake;
  call.at = at;
  call.lock = lock;
  return call;
}
const later = (call, minutes) => { call.at.now = new Date(Date.parse(call.at.now) + minutes * 60000).toISOString(); };
const stored = (call, id) => call.fake.tables.Todos.find((r) => r.id === id);
const writes = (call) => JSON.parse(JSON.stringify(call.fake.planner.writes));
const logRows = (call) => call.fake.tables.Log;
const history = async (call) => (await call("history")).data.entries;
// A forced pull a minute later (a forced pull within 30 seconds of the last answers the stored list).
const forced = (call, actor = "Mo") => { later(call, 1); return call("syncTodos", { force: true }, actor); };

// The Change Log row a tick of B1 by Mo appends (the clock's 15:00Z is 10:00 in Toronto).
const tickLog = (o = {}) => ({
  kind: "append", tab: "Change Log", headerRow: 2,
  values: [8, "2026-11-20 10:00 ET", "MAT app (Mo)", "Book Now", "E4", "Rail pass reservation", "Not booked", "Booked", "Ticked off in the MAT app", "MAT app History", "By Mo", ...[]].map((v, i) => (o[i] !== undefined ? o[i] : v)),
});

// ---------- pure: the Book Now parser ----------

test("todosFromRows finds the header below a title row and skips the blank item, the footnote and rows above", () => {
  const r = P.todosFromRows(BOOK, 2026);
  assert.equal(r.missing, null);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.items, [
    { id: "1", item: "Rail pass reservation", bookBy: "2026-11-25", status: "Not booked", note: "Seats for three", link: "https://rail.example.test/book", row: 4, statusCol: 4 },
    { id: "2", item: "Tea ceremony class", bookBy: "2026-12-01", status: "Pending", note: "", link: "", row: 5, statusCol: 4 },
    { id: "3", item: "Snow park day trip", bookBy: "2026-12-05", status: "Booked", note: "", link: "", row: 6, statusCol: 4 },
  ]);
});

test("todosFromRows: # as 17 or 17.0 text; a # that is not whole skips the row; a repeated # keeps the first and says so", () => {
  const rows = [BHEAD, brow({ "#": 17, Item: "A" }), brow({ "#": " 18.0 ", Item: "B" }), brow({ "#": 19.5, Item: "C" }), brow({ "#": "x", Item: "D" }), brow({ "#": "17", Item: "E" }), brow({ "#": -2, Item: "F" })];
  const r = P.todosFromRows(rows, 2026);
  assert.deepEqual(r.items.map((x) => [x.id, x.item, x.row]), [["17", "A", 2], ["18", "B", 3]]);
  assert.deepEqual(r.problems, [{ id: "17", message: "That number is in the Book Now tab twice.", row: 6, what: "E" }]);
});

test("todosFromRows: header cells match trimmed and in any case; Notes and Booking link are optional; no header or no tab is missing", () => {
  const r = P.todosFromRows([[" # ", "ITEM", "book BY", " status"], [4, " Visa forms ", "", ""]], 2026);
  assert.deepEqual(r.items, [{ id: "4", item: "Visa forms", bookBy: "", status: "", note: "", link: "", row: 2, statusCol: 3 }]);
  assert.equal(P.todosFromRows([["#", "Item", "Book by"], [1, "x", ""]], 2026).missing, "The planner’s Book Now tab has no row with the columns #, Item, Book by and Status.");
  assert.equal(P.todosFromRows([], 2026).missing, "The planner has no Book Now tab to read.");
  assert.equal(P.todosFromRows(null, 2026).missing, "The planner has no Book Now tab to read.");
});

test("todosFromRows keeps a link only when it is a plain https address", () => {
  const link = (v) => P.todosFromRows([BHEAD, brow({ "#": 1, Item: "x", "Booking link": v })], 2026).items[0].link;
  assert.equal(link(" https://a.example.test/x?y=1 "), "https://a.example.test/x?y=1");
  assert.equal(link("javascript:alert(1)"), "");
  assert.equal(link("http://a.example.test/"), "");
  assert.equal(link("https://a.example.test/has space"), "");
  assert.equal(link("see email"), "");
  assert.equal(link(42), "");
});

test("bookByDay reads ISO text, month-name text (with or without a year) and a serial day number; anything else is no date", () => {
  assert.equal(P.bookByDay("2026-12-05", 2026), "2026-12-05");
  assert.equal(P.bookByDay(" 2027-01-03 ", 2026), "2027-01-03");
  assert.equal(P.bookByDay("Dec 5", 2026), "2026-12-05");
  assert.equal(P.bookByDay("Dec 5, 2027", 2026), "2027-12-05");
  assert.equal(P.bookByDay("December 15", 2026), "2026-12-15");
  assert.equal(P.bookByDay("Sept 30", 2026), "2026-09-30");
  assert.equal(P.bookByDay("5 Dec", 2026), "2026-12-05");
  assert.equal(P.bookByDay("5 Dec 2027", 2026), "2027-12-05");
  assert.equal(P.bookByDay(46361, 2026), "2026-12-05", "Sheets' day 46361 is 2026-12-05");
  assert.equal(P.bookByDay(46361.75, 2026), "2026-12-05", "a time of day is dropped");
  for (const bad of ["", "soon", "2026-02-30", "Feb 30", "Dex 5", "12/05", "2026-12-5", 0, -3, NaN, null, undefined, true, "Dec"]) {
    assert.equal(P.bookByDay(bad, 2026), "", String(bad));
  }
  assert.equal(P.bookByDay("Dec 5", NaN), "", "no trip year: no date");
});

test("a todo is done when its status starts with the word booked, or someone ticked it", () => {
  const t = (status, ticked_by = "") => P.todoFromRow({ id: "1", item: "x", status, ticked_by }).done;
  assert.equal(t("Booked"), true);
  assert.equal(t(" booked ✓"), true);
  assert.equal(t("BOOKED (paid)"), true);
  assert.equal(t("Not booked"), false);
  assert.equal(t("Bookedx"), false);
  assert.equal(t("Pending"), false);
  assert.equal(t(""), false);
  assert.equal(t("", "Ajen"), true);
});

test("changeLogRow: the header found below a title, # one above the largest whole number, columns it lacks skipped", () => {
  const fields = { "Date / time": "2026-11-20 10:00 ET", "Agent / session": "MAT app (Mo)", Tab: "Book Now", "Cell(s)": "E4", Item: "x", "Old value": "(empty)", "New value": "Booked", Why: "w", "Proof / source": "MAT app History", "Verified?": "By Mo" };
  assert.deepEqual(P.changeLogRow(LOG, fields), { headerRow: 2, firstCol: 0, values: [8, "2026-11-20 10:00 ET", "MAT app (Mo)", "Book Now", "E4", "x", "(empty)", "Booked", "w", "MAT app History", "By Mo"] });
  const small = P.changeLogRow([["Old value", "#", "New value", " TAB ", "Extra"]], fields);
  assert.deepEqual(small, { headerRow: 1, firstCol: 0, values: ["(empty)", "", "Booked", "Book Now", ""] }, "no number in the column: # left blank, never a guessed 1");
  assert.equal(P.changeLogRow([["#", "Tab", "Old value"]], fields), null);
  assert.equal(P.changeLogRow([], fields), null);
  assert.equal(P.changeLogRow(null, fields), null);
});

test("changeLogRow: firstCol and values run from the table's first to last header cell, with or without a blank margin column", () => {
  const fields = { "Date / time": "D", Item: "I", "Verified?": "V" };
  const a = P.changeLogRow(LOG, fields);
  assert.equal(a.firstCol, 0);
  assert.equal(a.values.length, CHEAD.length);
  const margin = P.changeLogRow([["Change log"], ["", ...CHEAD, ""], ["", 44, "x"]], fields);
  assert.equal(margin.headerRow, 2);
  assert.equal(margin.firstCol, 1);
  assert.deepEqual(margin.values, [45, "D", "", "", "", "I", "", "", "", "", "V"], "no leading or trailing padding");
});

test("colLetter names a column the way A1 addresses do", () => {
  assert.deepEqual([0, 4, 25, 26, 27, 51, 52, 701, 702].map(P.colLetter), ["A", "E", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
});

test("History sentences for a todo hold the item (cut to 60) and names, nothing else", () => {
  const long = "A very long booking name that goes on and on past sixty letters for sure";
  const before = { id: "1", item: long, status: "Secret status", claimedBy: "", tickedBy: "", tickedAt: "" };
  assert.equal(P.summarize("tick", "todo", before, { ...before, tickedBy: "Mo" }), "ticked off: A very long booking name that goes on and on past sixty…");
  const item = { ...before, item: "Rail pass reservation" };
  assert.equal(P.summarize("claim", "todo", item, { ...item, claimedBy: "Mo" }), "is on: Rail pass reservation");
  assert.equal(P.summarize("claim", "todo", { ...item, claimedBy: "Ajen" }, { ...item, claimedBy: "Mo" }), "took over: Rail pass reservation, from Ajen");
  assert.equal(P.summarize("unclaim", "todo", { ...item, claimedBy: "Mo" }, item), "handed back: Rail pass reservation");
});

// ---------- the pull ----------

test("a first pull adds every item, writes no History, bumps rev and answers the list", async () => {
  const call = linked();
  const rev0 = (await call("rev")).rev;
  const logs = logRows(call).length;
  const r = await call("syncTodos");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.rev > rev0);
  assert.deepEqual(r.data, {
    todos: [
      { id: "1", item: "Rail pass reservation", bookBy: "2026-11-25", status: "Not booked", note: "Seats for three", link: "https://rail.example.test/book", claimedBy: "", tickedBy: "", tickedAt: "", done: false, plannerComputes: false },
      { id: "2", item: "Tea ceremony class", bookBy: "2026-12-01", status: "Pending", note: "", link: "", claimedBy: "", tickedBy: "", tickedAt: "", done: false, plannerComputes: false },
      { id: "3", item: "Snow park day trip", bookBy: "2026-12-05", status: "Booked", note: "", link: "", claimedBy: "", tickedBy: "", tickedAt: "", done: true, plannerComputes: false },
    ],
    pulledAt: "2026-11-20T15:00:00.000Z",
    more: false,
    problems: [],
  });
  assert.deepEqual(stored(call, "1"), { id: "1", item: "Rail pass reservation", book_by: "2026-11-25", status: "Not booked", note: "Seats for three", link: "https://rail.example.test/book", claimed_by: "", ticked_by: "", ticked_at: "", ticked_item: "", planner_written: "", planner_was: "", gone: "" });
  assert.equal(logRows(call).length, logs, "a pull writes no History");
  assert.deepEqual(writes(call), [], "a pull with nothing ticked writes nothing to the planner");
  const load = (await call("load")).data;
  assert.deepEqual(load.todos, r.data.todos);
  assert.equal(load.todosPulledAt, "2026-11-20T15:00:00.000Z");
});

test("a second pull within 10 minutes reads nothing and answers the stored list; force or 10 minutes later reads again", async () => {
  const call = linked();
  await call("syncTodos");
  const reads = call.fake.planner.reads;
  later(call, 9);
  const again = await call("syncTodos");
  assert.equal(call.fake.planner.reads, reads, "no planner read");
  assert.deepEqual([again.data.pulledAt, again.data.more, again.data.todos.length], ["2026-11-20T15:00:00.000Z", false, 3]);
  await call("syncTodos", { force: true });
  assert.equal(call.fake.planner.reads, reads + 1, "forced: read");
  later(call, 10);
  const due = await call("syncTodos");
  assert.equal(call.fake.planner.reads, reads + 2);
  assert.equal(due.data.pulledAt, call.at.now);
  assert.deepEqual((await call("syncTodos", { force: "yes" })).error, "bad_input");
});

test("M3: a forced pull within 30 seconds of the last answers the stored list without reading the planner", async () => {
  const call = linked();
  await call("syncTodos");
  const reads = call.fake.planner.reads;
  later(call, 0.4);
  const soon = await call("syncTodos", { force: true });
  assert.deepEqual([soon.ok, soon.data.todos.length, soon.data.pulledAt, call.fake.planner.reads], [true, 3, "2026-11-20T15:00:00.000Z", reads]);
  later(call, 0.2);
  await call("syncTodos", { force: true });
  assert.equal(call.fake.planner.reads, reads + 1, "after 30 seconds a forced pull reads");
});

test("a changed status and a row taken out: updated and marked gone, never deleted; it comes back when it returns; claims and ticks are left alone", async () => {
  const call = linked();
  await call("syncTodos");
  await call("claimTodo", { id: "1", on: true }, "Ajen");
  call.fake.planner.tabs["Book Now"] = bookNow({ ...B2, Status: "Booked", Notes: "Paid by Trenton" }, B3);
  const r = await forced(call);
  assert.deepEqual(r.data.todos.map((t) => [t.id, t.status, t.note, t.done]), [["2", "Booked", "Paid by Trenton", true], ["3", "Booked", "", true]]);
  assert.equal(stored(call, "1").gone, "yes");
  assert.equal(stored(call, "1").claimed_by, "Ajen");
  assert.equal(call.fake.tables.Todos.length, 3, "nothing deleted");
  assert.deepEqual((await call("load")).data.todos.map((t) => t.id), ["2", "3"]);
  assert.equal((await call("tickTodo", { id: "1" })).error, "not_found", "a gone item can't be ticked");

  call.fake.planner.tabs["Book Now"] = bookNow({ ...B1, Notes: "Window seats" }, B2, B3);
  await forced(call);
  assert.deepEqual([stored(call, "1").gone, stored(call, "1").note, stored(call, "1").claimed_by], ["", "Window seats", "Ajen"]);
});

test("a pull writes at most 15 rows and says more; the next pull, even within 10 minutes, finishes", async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ "#": i + 1, Item: "Item " + (i + 1), Status: "" }));
  const call = linked({ book: bookNow(...many) });
  const r = await call("syncTodos");
  assert.deepEqual([r.data.todos.length, r.data.more, r.data.pulledAt], [15, true, ""]);
  later(call, 1);
  const r2 = await call("syncTodos");
  assert.deepEqual([r2.data.todos.length, r2.data.more, r2.data.pulledAt], [20, false, call.at.now]);
});

test("refusals: no planner, needs migrate, unreadable and missing columns (the stored list still comes back)", async () => {
  const none = createFakeBackend({});
  assert.deepEqual(await none({ key: KEY, actor: "Mo", action: "syncTodos", args: {} }), { ok: false, error: "no_planner", message: "No planner sheet is linked yet. Ask Mo to link it.", rev: 0 });

  const call = linked();
  await call("syncTodos");
  call.fake.planner.fails = true;
  const r = await forced(call);
  assert.deepEqual([r.ok, r.error, r.message], [false, "planner_unreadable", "Couldn’t read the planner sheet. Ask Mo to check its permission."]);
  assert.deepEqual([r.data.todos.length, r.data.pulledAt], [3, "2026-11-20T15:00:00.000Z"]);
  assert.equal(JSON.stringify(r).includes(PLANNER_ID), false);
  call.fake.planner.fails = false;
  call.fake.planner.tabs["Book Now"] = [["#", "Item", "Book by"], [1, "x", ""]];
  const cols = await forced(call);
  assert.deepEqual([cols.error, cols.message, cols.data.todos.length], ["planner_columns", "The planner’s Book Now tab has no row with the columns #, Item, Book by and Status.", 3]);
  delete call.fake.planner.tabs["Book Now"];
  assert.equal((await forced(call)).message, "The planner has no Book Now tab to read.");
});

// Wave A item 1 (as payments since version 20): a problem names its row and a
// few words of its Item, so the Before list can say which one (was: "by
// number only, never with the planner's text").
test("a repeated # is reported by number, row and a few words of its Item (cut to 60)", async () => {
  const long = "Made-up duplicate text " + "x".repeat(80);
  const call = linked({ book: bookNow(B1, { ...B2, "#": 1, Item: long }) });
  const r = await call("syncTodos");
  assert.deepEqual(r.data.problems, [{ id: "1", message: "That number is in the Book Now tab twice.", row: 5, what: P.plannerWhat_(long) }]);
  assert.equal(P.plannerWhat_(long), "Made-up duplicate text…");
  assert.equal(JSON.stringify(r).includes(long), false, "never the whole text");
});

// ---------- tick ----------

test("a tick with the planner writable: saved first, one History entry, then exactly one Status cell and one Change Log row", async () => {
  const call = linked();
  await call("syncTodos");
  const rev0 = (await call("rev")).rev;
  const r = await call("tickTodo", { id: "1" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.planner, "written");
  assert.deepEqual(r.data.todo, { id: "1", item: "Rail pass reservation", bookBy: "2026-11-25", status: "Booked", note: "Seats for three", link: "https://rail.example.test/book", claimedBy: "", tickedBy: "Mo", tickedAt: "2026-11-20T15:00:00.000Z", done: true, plannerComputes: false });
  assert.ok(r.rev > rev0);
  assert.deepEqual(writes(call), [{ kind: "cell", tab: "Book Now", cell: "E4", value: "Booked" }, tickLog()]);
  assert.deepEqual([stored(call, "1").planner_written, stored(call, "1").status], ["yes", "Booked"]);
  const h = await history(call);
  assert.deepEqual(h.map((e) => [e.who, e.action, e.kind, e.ref, e.summary, e.canUndo]), [["Mo", "tick", "todo", "1", "ticked off: Rail pass reservation", true]]);
  assert.equal(r.data.logId, h[0].id);
  // History never carries a planner value beyond the item.
  assert.equal(/Seats for three|rail\.example|Not booked/.test(JSON.stringify(h)), false);
  // The planner now says Booked: a later pull changes nothing and writes nothing more.
  await forced(call);
  assert.equal(writes(call).length, 2);
});

test("tick refusals: not a member, no id, unknown id, already done (by the planner or a tick), a todo tab not there yet", async () => {
  const call = linked();
  await call("syncTodos");
  for (const action of ["syncTodos", "tickTodo", "claimTodo"]) {
    const r = await call(action, { id: "1", on: true }, "Nadia");
    assert.deepEqual([r.ok, r.error, r.message], [false, "bad_input", "Pick who you are first."], action);
  }
  assert.equal((await call("tickTodo", {})).error, "bad_input");
  const gone = await call("tickTodo", { id: "99" });
  assert.deepEqual([gone.error, gone.message], ["not_found", "That one isn’t on the list any more."]);
  const done = await call("tickTodo", { id: "3" });
  assert.deepEqual([done.error, done.message], ["bad_input", "That one is already done."]);
  await call("tickTodo", { id: "2" });
  assert.equal((await call("tickTodo", { id: "2" }, "Ajen")).message, "That one is already done.");

  const old = linked({ over: { missingTabs: ["Todos"] } });
  assert.equal((await old("tickTodo", { id: "1" })).error, "needs_migrate");
  assert.equal((await old("syncTodos")).error, "needs_migrate");
  assert.equal((await old("claimTodo", { id: "1", on: true })).error, "needs_migrate");
});

test("a tick whose planner write is refused stands in the app, answers pending, and the next pull writes it", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.cellFails = true;
  const r = await call("tickTodo", { id: "1" });
  assert.deepEqual([r.ok, r.data.planner, r.data.todo.done, r.data.todo.tickedBy, r.data.todo.status], [true, "pending", true, "Mo", "Not booked"]);
  assert.equal(stored(call, "1").planner_written, "");
  assert.deepEqual(writes(call), []);
  // Still refused: retried, still pending, nothing written.
  await forced(call);
  assert.equal(stored(call, "1").planner_written, "");
  call.fake.planner.cellFails = false;
  const logs = logRows(call).length;
  const p = await forced(call, "Trenton");
  assert.equal(p.ok, true);
  assert.deepEqual(writes(call), [{ kind: "cell", tab: "Book Now", cell: "E4", value: "Booked" }, tickLog({ 1: "2026-11-20 10:02 ET" })], "written as the one who ticked, once");
  assert.deepEqual([stored(call, "1").planner_written, stored(call, "1").status], ["yes", "Booked"]);
  assert.equal(logRows(call).length, logs, "the retry writes no History");
  await forced(call);
  assert.equal(writes(call).length, 2, "never re-asserted");
});

test("a pull does not retry a tick on a row the planner already says is booked, nor on a gone row", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.cellFails = true;
  await call("tickTodo", { id: "1" });
  await call("tickTodo", { id: "2" });
  call.fake.planner.cellFails = false;
  call.fake.planner.tabs["Book Now"] = bookNow({ ...B1, Status: "Booked" }, B3);
  await forced(call);
  assert.deepEqual(writes(call), []);
  assert.deepEqual([stored(call, "1").status, stored(call, "1").planner_written, stored(call, "2").gone], ["Booked", "", "yes"]);
});

test("C1: a tick when the planner row's Item changed is not written; the next pull takes the tick off, writes nothing, and says so once in History", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.tabs["Book Now"] = bookNow({ ...B1, Item: "Something else now" }, B2, B3);
  const r = await call("tickTodo", { id: "1" });
  assert.deepEqual([r.data.planner, r.data.todo.tickedBy], ["pending", "Mo"]);
  assert.deepEqual(writes(call), []);
  const p = await forced(call);
  assert.deepEqual(writes(call), [], "never written");
  const s1 = stored(call, "1");
  assert.deepEqual([s1.item, s1.ticked_by, s1.ticked_at, s1.ticked_item, s1.planner_written, s1.planner_was, s1.claimed_by], ["Something else now", "", "", "", "", "", ""]);
  assert.deepEqual(p.data.problems, [{ id: "1", message: "That number is another item in the planner now: its tick was taken off.", row: 4, what: "Something else now" }]);
  const h = await history(call);
  assert.deepEqual([h[0].who, h[0].action, h[0].summary, h[0].canUndo], ["The planner", "takeoff", "changed “Rail pass reservation”: the tick was taken off", false]);
  assert.equal(h[1].canUndo, false, "the tick itself can't be undone any more");
  assert.equal((await call("undo", { logId: h[0].id })).error, "stale");
  await forced(call);
  assert.deepEqual(writes(call), [], "never retried");
  assert.equal((await history(call)).length, 2, "said once");
});

test("a tick when the row moved to another # is not written", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.tabs["Book Now"] = bookNow({ ...B1, "#": 11 }, B2, B3);
  assert.equal((await call("tickTodo", { id: "1" })).data.planner, "pending");
  assert.deepEqual(writes(call), []);
});

test("a tick when the Change Log tab or its header is missing is not written at all", async () => {
  const call = linked();
  await call("syncTodos");
  delete call.fake.planner.tabs["Change Log"];
  assert.equal((await call("tickTodo", { id: "1" })).data.planner, "pending");
  call.fake.planner.tabs["Change Log"] = [["Change log"], ["#", "When", "What"]];
  assert.equal((await call("tickTodo", { id: "2" })).data.planner, "pending");
  assert.deepEqual(writes(call), []);
  assert.deepEqual([stored(call, "1").ticked_by, stored(call, "2").ticked_by], ["Mo", "Mo"]);
});

test("a Change Log append that fails after the Status write puts the old Status back; the tick stands, pending", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.appendFails = true;
  const r = await call("tickTodo", { id: "2" });
  assert.deepEqual([r.data.planner, r.data.todo.tickedBy, r.data.todo.status], ["pending", "Mo", "Pending"]);
  assert.deepEqual(writes(call), [{ kind: "cell", tab: "Book Now", cell: "E5", value: "Booked" }, { kind: "cell", tab: "Book Now", cell: "E5", value: "Pending" }]);
  assert.equal(stored(call, "2").planner_written, "");
});

test("a tick when the planner already says Booked writes nothing there and takes its status", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.tabs["Book Now"] = bookNow({ ...B1, Status: "Booked" }, B2, B3);
  const r = await call("tickTodo", { id: "1" });
  assert.deepEqual([r.data.planner, r.data.todo.status, stored(call, "1").planner_written], ["written", "Booked", ""]);
  assert.deepEqual(writes(call), []);
});

test("a planner that can't be read at all leaves the tick standing, pending", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.fails = true;
  const r = await call("tickTodo", { id: "1" });
  assert.deepEqual([r.ok, r.data.planner, r.data.todo.tickedBy], [true, "pending", "Mo"]);
  assert.equal(JSON.stringify(r).includes(PLANNER_ID), false);
});

// ---------- undo of a tick ----------

async function ticked(setup) {
  const call = linked();
  await call("syncTodos");
  if (setup) setup(call);
  const r = await call("tickTodo", { id: "1" });
  call.fake.planner.cellFails = false;
  call.fake.planner.appendFails = false;
  return { call, logId: r.data.logId };
}

test("undo of a written tick: cleared in the app, the old Status put back and one Change Log row", async () => {
  const { call, logId } = await ticked();
  later(call, 2);
  const u = await call("undo", { logId }, "Ajen");
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(u.data.planner, "written");
  assert.deepEqual([u.data.todo.tickedBy, u.data.todo.tickedAt, u.data.todo.status, u.data.todo.done], ["", "", "Not booked", false]);
  assert.equal(u.data.entry.summary, "undid: ticked off: Rail pass reservation");
  assert.deepEqual(writes(call).slice(2), [
    { kind: "cell", tab: "Book Now", cell: "E4", value: "Not booked" },
    { kind: "append", tab: "Change Log", headerRow: 2, values: [9, "2026-11-20 10:02 ET", "MAT app (Ajen)", "Book Now", "E4", "Rail pass reservation", "Booked", "Not booked", "Tick undone in the MAT app", "MAT app History", "By Ajen"] },
  ]);
  assert.equal(stored(call, "1").planner_written, "");
  // The next pull agrees and writes nothing.
  await forced(call);
  assert.equal(writes(call).length, 4);
  assert.equal(stored(call, "1").status, "Not booked");
});

test("undo of a tick that was never written: cleared in the app, nothing written to the planner", async () => {
  const { call, logId } = await ticked((c) => { c.fake.planner.cellFails = true; });
  const u = await call("undo", { logId });
  assert.deepEqual([u.ok, u.data.planner, u.data.todo.tickedBy], [true, "kept", ""]);
  assert.deepEqual(writes(call), []);
  await forced(call);
  assert.deepEqual(writes(call), [], "an undone tick is not retried");
});

test("undo of a written tick when the planner refuses the write: undone in the app, pending and owed; the next pull puts it back", async () => {
  const { call, logId } = await ticked();
  call.fake.planner.cellFails = true;
  const u = await call("undo", { logId });
  assert.deepEqual([u.ok, u.data.planner, u.data.todo.tickedBy, u.data.todo.status], [true, "pending", "", "Not booked"]);
  assert.equal(stored(call, "1").planner_written, "undo");
  assert.equal(writes(call).length, 2);
  call.fake.planner.cellFails = false;
  const p = await forced(call);
  assert.equal(p.data.todos.find((t) => t.id === "1").done, false, "the app's own Booked is not taken as done");
  assert.deepEqual(writes(call).slice(2).map((w) => (w.kind === "cell" ? w.value : w.values[8])), ["Not booked", "Tick undone in the MAT app"]);
});

test("undo of a written tick when the row's Item changed: nothing written, pending", async () => {
  const { call, logId } = await ticked();
  call.fake.planner.tabs["Book Now"][3][1] = "Renamed in the planner";
  const u = await call("undo", { logId });
  assert.deepEqual([u.data.planner, u.data.todo.tickedBy], ["pending", ""]);
  assert.equal(writes(call).length, 2);
  assert.equal(stored(call, "1").planner_written, "undo");
  await forced(call);
  assert.equal(stored(call, "1").planner_written, "", "the next pull sees another item there: nothing owed to it");
  assert.equal(writes(call).length, 2);
});

test("undo of a written tick when the planner's status was changed since: nothing written there", async () => {
  const { call, logId } = await ticked();
  call.fake.planner.tabs["Book Now"][3][4] = "Cancelled";
  const u = await call("undo", { logId });
  assert.deepEqual([u.data.planner, u.data.todo.tickedBy], ["kept", ""]);
  assert.equal(writes(call).length, 2);
});

test("undo of a written tick when the Change Log append fails: the Status goes back to Booked, pending", async () => {
  const { call, logId } = await ticked();
  call.fake.planner.appendFails = true;
  const u = await call("undo", { logId });
  assert.deepEqual([u.data.planner, u.data.todo.tickedBy, u.data.todo.status], ["pending", "", "Not booked"]);
  assert.deepEqual(writes(call).slice(2), [{ kind: "cell", tab: "Book Now", cell: "E4", value: "Not booked" }, { kind: "cell", tab: "Book Now", cell: "E4", value: "Booked" }]);
  assert.equal(stored(call, "1").planner_written, "undo", "still owed");
});

test("undoing the undo ticks it again and writes the planner again", async () => {
  const { call, logId } = await ticked();
  const u = await call("undo", { logId });
  const again = await call("undo", { logId: u.data.logId }, "Trenton");
  assert.deepEqual([again.ok, again.data.planner, again.data.todo.tickedBy, again.data.todo.status], [true, "written", "Mo", "Booked"]);
  assert.deepEqual(writes(call).slice(4).map((w) => (w.kind === "cell" ? w.value : w.values[0] + " " + w.values[2] + " " + w.values[8])), ["Booked", "10 MAT app (Trenton) Ticked off in the MAT app"]);
});

// ---------- claim ----------

test("claim, take over and hand back: History sentences, each undoable; a done item can't be claimed", async () => {
  const call = linked();
  await call("syncTodos");
  const a = await call("claimTodo", { id: "1", on: true }, "Ajen");
  assert.deepEqual([a.ok, a.data.todo.claimedBy], [true, "Ajen"]);
  const b = await call("claimTodo", { id: "1", on: true }, "Mo");
  assert.equal(b.data.todo.claimedBy, "Mo");
  const same = await call("claimTodo", { id: "1", on: true }, "Mo");
  assert.equal(same.data.logId, null, "already on it: nothing logged");
  const notMine = await call("claimTodo", { id: "1", on: false }, "Trenton");
  assert.deepEqual([notMine.data.todo.claimedBy, notMine.data.logId], ["Mo", null], "only the one on it can hand it back");
  const c = await call("claimTodo", { id: "1", on: false }, "Mo");
  assert.equal(c.data.todo.claimedBy, "");
  const h = await history(call);
  assert.deepEqual(h.map((e) => [e.who, e.summary]), [["Mo", "handed back: Rail pass reservation"], ["Mo", "took over: Rail pass reservation, from Ajen"], ["Ajen", "is on: Rail pass reservation"]]);
  assert.deepEqual(h.map((e) => e.canUndo), [true, false, false]);

  const u1 = await call("undo", { logId: c.data.logId });
  assert.deepEqual([u1.data.todo.claimedBy, u1.data.planner], ["Mo", "kept"]);
  const u2 = await call("undo", { logId: b.data.logId }, "Ajen");
  assert.equal(u2.ok, false, "the newest change must be undone first");
  assert.deepEqual(writes(call), [], "claims never touch the planner");

  const done = await call("claimTodo", { id: "3", on: true });
  assert.deepEqual([done.error, done.message], ["bad_input", "That one is already done."]);
  assert.equal((await call("claimTodo", { id: "1", on: "yes" })).error, "bad_input");
  assert.equal((await call("claimTodo", { id: "99", on: true })).error, "not_found");
});

test("undo of a take over gives it back to the one it was taken from", async () => {
  const call = linked();
  await call("syncTodos");
  await call("claimTodo", { id: "2", on: true }, "Ajen");
  const b = await call("claimTodo", { id: "2", on: true }, "Trenton");
  const u = await call("undo", { logId: b.data.logId }, "Trenton");
  assert.equal(u.data.todo.claimedBy, "Ajen");
});

test("an undo whose Log row names someone not on the trip is refused", async () => {
  const call = linked();
  await call("syncTodos");
  const a = await call("claimTodo", { id: "2", on: true }, "Ajen");
  const b = await call("claimTodo", { id: "2", on: false }, "Ajen");
  const row = call.fake.tables.Log.find((r) => Number(r.id) === b.data.logId);
  row.before = JSON.stringify({ ...JSON.parse(row.before), claimedBy: "Intruder" });
  assert.equal((await call("undo", { logId: b.data.logId })).error, "stale");
  assert.ok(a.ok);
});

test("I2: undo puts back the status recorded when Booked was written (planner_was), never one from the Log row", async () => {
  const { call, logId } = await ticked();
  assert.equal(stored(call, "1").planner_was, "Not booked");
  const row = call.fake.tables.Log.find((r) => Number(r.id) === logId);
  row.before = JSON.stringify({ ...JSON.parse(row.before), status: "=EVIL()" });
  const u = await call("undo", { logId });
  assert.deepEqual([u.ok, u.data.planner, u.data.todo.tickedBy], [true, "written", ""]);
  assert.deepEqual(writes(call)[2], { kind: "cell", tab: "Book Now", cell: "E4", value: "Not booked" });
  assert.deepEqual([stored(call, "1").planner_written, stored(call, "1").planner_was], ["", ""]);
});

// ---------- load, connector, migrate ----------

test("load: todos not gone, camel-cased, with done; todosPulledAt empty before any pull; load never reads the planner", async () => {
  const call = linked();
  const first = (await call("load")).data;
  assert.deepEqual([first.todos, first.todosPulledAt], [[], ""]);
  await call("syncTodos");
  const reads = call.fake.planner.reads;
  const d = (await call("load")).data;
  assert.equal(call.fake.planner.reads, reads);
  assert.deepEqual(Object.keys(d.todos[0]), ["id", "item", "bookBy", "status", "note", "link", "claimedBy", "tickedBy", "tickedAt", "done", "plannerComputes"]);
  assert.equal(/planner_?[wW]ritten|gone/.test(JSON.stringify(d.todos)), false);
});

test("load on a Sheet without the Todos tab still works", async () => {
  const call = linked({ over: { missingTabs: ["Todos"] } });
  const r = await call("load");
  assert.equal(r.ok, true);
  assert.deepEqual([r.data.todos, r.data.todosPulledAt], [[], ""]);
});

test("migrate adds the Todos tab once", async () => {
  const call = linked({ over: { missingTabs: ["Todos"] } });
  const m = await call.fake({ key: KEY, action: "migrate", args: {} });
  assert.deepEqual(m.data.added, P.TABS.Todos.map((c) => "Todos." + c));
  assert.deepEqual((await call.fake({ key: KEY, action: "migrate", args: {} })).data.added, []);
  assert.equal((await call("syncTodos")).ok, true);
  assert.deepEqual(P.TABS.Todos, ["id", "item", "book_by", "status", "note", "link", "claimed_by", "ticked_by", "ticked_at", "ticked_item", "planner_written", "planner_was", "gone"]);
  for (const col of P.TABS.Todos) assert.equal(P.isTextColumn("Todos", col), true, col);
});

test("get_trip lists the open todos (id, item, book_by, claimed_by) and counts the done ones", async () => {
  const call = linked();
  await call("syncTodos");
  await call("claimTodo", { id: "2", on: true }, "Ajen");
  await call("tickTodo", { id: "1" });
  const r = call.fake.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_trip", arguments: {} } }, { t: "claude-token" });
  const trip = JSON.parse(r.result.content[0].text);
  assert.deepEqual(trip.todos, { open: [{ id: "2", item: "Tea ceremony class", book_by: "2026-12-01", claimed_by: "Ajen" }], done: 2 });
});

// ---------- fix round 1 (R49): the reviewer's probes P1 to P11, and the new rules ----------

const lastLogId = (call) => Math.max(...call.fake.tables.Log.map((r) => Number(r.id)));

test("P1 (C1): a pending tick on #1 never reaches the item that takes #1 later; the tick is taken off", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.cellFails = true;
  await call("tickTodo", { id: "1" });
  call.fake.planner.cellFails = false;
  call.fake.planner.tabs["Book Now"] = bookNow({ "#": 1, Item: "Sumo tickets", Status: "Not booked" }, { ...B1, "#": 4 }, B2, B3);
  const p = await forced(call);
  assert.deepEqual(writes(call), [], "Sumo is never marked Booked");
  assert.deepEqual([stored(call, "1").item, stored(call, "1").ticked_by, stored(call, "4").ticked_by], ["Sumo tickets", "", ""]);
  assert.deepEqual(p.data.problems.map((x) => x.id), ["1"]);
  assert.equal(call.fake.planner.tabs["Book Now"][3][4], "Not booked");
});

test("C1: a claim on a # whose Item changed is taken off, with its own History line", async () => {
  const call = linked();
  await call("syncTodos");
  await call("claimTodo", { id: "2", on: true }, "Ajen");
  call.fake.planner.tabs["Book Now"] = bookNow(B1, { ...B2, Item: "Flower arranging" }, B3);
  const p = await forced(call);
  assert.equal(stored(call, "2").claimed_by, "");
  assert.deepEqual(p.data.problems, [{ id: "2", message: "That number is another item in the planner now: nobody is on it any more.", row: 5, what: "Flower arranging" }]);
  const h = await history(call);
  assert.deepEqual([h[0].who, h[0].summary, h[0].canUndo], ["The planner", "changed “Tea ceremony class”: Ajen is no longer on it", false]);
  assert.deepEqual(writes(call), []);
});

test("P2 (I3): two retries in one pull each read the Change Log for their own #", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.cellFails = true;
  await call("tickTodo", { id: "1" });
  await call("tickTodo", { id: "2" });
  call.fake.planner.cellFails = false;
  await forced(call);
  assert.deepEqual(writes(call).filter((w) => w.kind === "append").map((w) => w.values[0]), [8, 9]);
});

test("I4: a pull retries at most 2 pending ticks (round 2: and is still complete); the next pull takes the rest", async () => {
  const call = linked({ book: bookNow(B1, B2, { ...B3, Status: "" }) });
  await call("syncTodos");
  call.fake.planner.cellFails = true;
  for (const id of ["1", "2", "3"]) await call("tickTodo", { id });
  call.fake.planner.cellFails = false;
  const p = await forced(call);
  assert.deepEqual([p.data.more, p.data.pulledAt, writes(call).filter((w) => w.kind === "cell").length], [false, call.at.now, 2]);
  await forced(call);
  assert.equal(writes(call).filter((w) => w.kind === "cell").length, 3);
});

test("P3 (I2): undo puts back what the planner held when Booked was written, not the app's older status", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.tabs["Book Now"][3][4] = "Pending (deposit sent)";
  const t = await call("tickTodo", { id: "1" });
  assert.equal(stored(call, "1").planner_was, "Pending (deposit sent)");
  const u = await call("undo", { logId: t.data.logId });
  assert.equal(u.data.planner, "written");
  assert.deepEqual(writes(call).map((w) => (w.kind === "cell" ? w.value : [w.values[6], w.values[7]])), ["Booked", ["Pending (deposit sent)", "Booked"], "Pending (deposit sent)", ["Booked", "Pending (deposit sent)"]]);
  assert.equal(u.data.todo.status, "Pending (deposit sent)");
});

test("I2: an empty status at write time is put back as an empty cell", async () => {
  const call = linked({ book: bookNow({ ...B1, Status: "" }) });
  await call("syncTodos");
  const t = await call("tickTodo", { id: "1" });
  await call("undo", { logId: t.data.logId });
  assert.deepEqual(writes(call)[2], { kind: "cell", tab: "Book Now", cell: "E4", value: "" });
  assert.deepEqual(writes(call)[3].values.slice(6, 8), ["Booked", "(empty)"]);
});

test("P4 (I1): undo leaves a later 'Booked - conf …' edit alone and answers kept; the app's undo still happens", async () => {
  const call = linked();
  await call("syncTodos");
  const t = await call("tickTodo", { id: "1" });
  call.fake.planner.tabs["Book Now"][3][4] = "Booked - conf JR123, paid by Ajen";
  const u = await call("undo", { logId: t.data.logId });
  assert.deepEqual([u.ok, u.data.planner, u.data.todo.tickedBy], [true, "kept", ""]);
  assert.equal(writes(call).length, 2);
  assert.equal(call.fake.planner.tabs["Book Now"][3][4], "Booked - conf JR123, paid by Ajen");
});

test("P5 (C2): a retry finds its row on a read made just before the write, not on the pull's earlier read", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.cellFails = true;
  await call("tickTodo", { id: "1" });
  call.fake.planner.cellFails = false;
  later(call, 1);
  // Runs after the pull has read Book Now, just before the planner lock is taken.
  call.fake.planner.between = () => { call.fake.planner.tabs["Book Now"].splice(3, 0, brow({ "#": 9, Item: "Inserted above", Status: "Not booked" })); };
  await call("syncTodos", { force: true });
  assert.deepEqual(writes(call)[0], { kind: "cell", tab: "Book Now", cell: "E5", value: "Booked" });
  assert.deepEqual(call.fake.planner.tabs["Book Now"].slice(3, 5).map((r) => [r[0], r[1], r[4]]), [[9, "Inserted above", "Not booked"], [1, "Rail pass reservation", "Booked"]]);
});

test("C2: a tick finds its row on a fresh read too; a row moved away meanwhile is not written", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.between = () => { call.fake.planner.tabs["Book Now"][3][0] = 12; };
  const t = await call("tickTodo", { id: "1" });
  assert.deepEqual([t.data.planner, writes(call)], ["pending", []]);
});

test("P6 (I5): a second table under Book Now is never read with the first table's columns", async () => {
  const book = [...bookNow(B2), [], ["Done"], ["#", "Status", "Item", "Book by"], [1, "Not booked", "Rail pass reservation", ""]];
  const call = linked({ book });
  const r = await call("syncTodos");
  assert.deepEqual(r.data.todos.map((t) => [t.id, t.item]), [["2", "Tea ceremony class"]]);
  assert.equal((await call("tickTodo", { id: "1" })).error, "not_found");
  assert.deepEqual(writes(call), []);
});

test("I5: parsing stops at the first blank row after an item and at a repeated header row", () => {
  const blank = P.todosFromRows([BHEAD, brow({ "#": 1, Item: "A" }), [], brow({ "#": 2, Item: "B" })], 2026);
  assert.deepEqual(blank.items.map((x) => x.id), ["1"]);
  const again = P.todosFromRows([BHEAD, brow({ "#": 1, Item: "A" }), BHEAD, brow({ "#": 2, Item: "B" })], 2026);
  assert.deepEqual(again.items.map((x) => x.id), ["1"]);
  const lead = P.todosFromRows([BHEAD, [], ["", "  "], brow({ "#": 1, Item: "A" })], 2026);
  assert.deepEqual(lead.items.map((x) => x.id), ["1"], "blank rows before the first item are skipped");
});

test("P7 (M1): an undo of a tick made through the Claude connector never reaches the planner (the put-back is owed to the next pull)", async () => {
  const call = linked();
  await call("syncTodos");
  const t = await call("tickTodo", { id: "1" });
  const r = call.fake.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "undo", arguments: { log_id: t.data.logId } } }, { t: "claude-token" });
  const out = JSON.parse(r.result.content[0].text);
  assert.deepEqual([out.planner, out.todo.tickedBy, out.todo.done], ["pending", "", false]);
  assert.equal(stored(call, "1").planner_written, "undo");
  assert.equal(writes(call).length, 2, "only the tick's own two writes");
  assert.equal(call.fake.planner.calls.filter((c) => c.op !== "read" && c.op !== "formula").length, 2);
});

test("M1 (round 2): a tick through Claude is refused; nothing is saved or written", async () => {
  const call = linked();
  await call("syncTodos");
  const t = await call.fake.claude("tickTodo", { id: "1" });
  assert.deepEqual([t.ok, t.error, t.message], [false, "bad_input", "Tick this one in the app."]);
  assert.equal(stored(call, "1").ticked_by, "");
  assert.deepEqual(writes(call), []);
});

test("P8: a claim made before a tick can no longer be undone on its own (newest first)", async () => {
  const call = linked();
  await call("syncTodos");
  await call("claimTodo", { id: "1", on: true }, "Ajen");
  await call("tickTodo", { id: "1" });
  const h = await history(call);
  assert.deepEqual(h.map((e) => [e.summary, e.canUndo]), [["ticked off: Rail pass reservation", true], ["is on: Rail pass reservation", false]]);
});

test("P9: the Change Log # skips text, decimals and blanks", async () => {
  const call = linked({ log: [CHEAD, ["CL-40", "x"], ["", "x"], [12.5, "x"], ["9", "x"]] });
  await call("syncTodos");
  await call("tickTodo", { id: "1" });
  assert.deepEqual(writes(call).filter((w) => w.kind === "append").map((w) => w.values[0]), [10]);
});

test("P10: an Item that differs only in case or spaces is another item: not written", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.tabs["Book Now"][3][1] = "  rail pass reservation ";
  const t = await call("tickTodo", { id: "1" });
  assert.deepEqual([t.data.planner, writes(call).length], ["pending", 0]);
});

test("P11: an Item that looks like a formula is kept as text and written back as the same text", async () => {
  const f = "=IMPORTXML(\"http://x\",\"//a\")";
  const call = linked({ book: bookNow({ "#": 1, Item: f, Status: "" }) });
  const r = await call("syncTodos");
  assert.equal(r.data.todos[0].item, f);
  const t = await call("tickTodo", { id: "1" });
  assert.equal(t.data.planner, "written");
  assert.equal(writes(call)[1].values[5], f, "the log's Item is the planner's own text (written RAW)");
});

test("M2: Item is cut to 300 characters and Note to 2,000; the tick matches cut against cut", async () => {
  const long = "Rail ".repeat(100).trim();
  const note = "n".repeat(2500);
  const call = linked({ book: bookNow({ ...B1, Item: long, Notes: note }) });
  const r = await call("syncTodos");
  assert.deepEqual([r.data.todos[0].item.length, r.data.todos[0].item.endsWith("…"), r.data.todos[0].note.length], [300, true, 2000]);
  const t = await call("tickTodo", { id: "1" });
  assert.equal(t.data.planner, "written");
  assert.equal(stored(call, "1").ticked_item, r.data.todos[0].item);
  const emoji = P.todosFromRows([BHEAD, brow({ "#": 1, Item: "a".repeat(298) + "😀😀" })], 2026).items[0].item;
  assert.equal(emoji, "a".repeat(298) + "…", "never half an emoji");
});

test("I4: no planner call ever runs while the app's lock is held; planner writes run under the planner lock", async () => {
  const call = linked();
  await call("syncTodos");
  const t1 = await call("tickTodo", { id: "1" });
  await call("undo", { logId: t1.data.logId });
  call.fake.planner.cellFails = true;
  await call("tickTodo", { id: "2" });
  call.fake.planner.cellFails = false;
  await forced(call);
  await call("claimTodo", { id: "1", on: true }, "Ajen");
  const calls = call.fake.planner.calls;
  assert.ok(calls.length > 6);
  // The one exception (second fix round, ruling C1): settleUntick_ reads the Book Now cell under the
  // app's lock when a row was ticked again while its put-back was out, so a re-tick that lands while
  // it waits for the lock is not wiped. A read only, with no planner lock: no lock waits on another.
  assert.deepEqual(calls.filter((c) => c.appLock && !(c.op === "read" && c.tab === "Book Now" && !c.plannerLock)), [], "none under the app lock but that read");
  assert.deepEqual(calls.filter((c) => c.op !== "read" && !c.plannerLock), [], "every write under the planner lock");
});

test("I4: a planner lock that can't be had leaves the tick pending and calls nothing", async () => {
  const call = linked();
  await call("syncTodos");
  const before = call.fake.planner.calls.length;
  call.fake.planner.lockFails = true;
  const t = await call("tickTodo", { id: "1" });
  assert.deepEqual([t.ok, t.data.planner, t.data.todo.tickedBy], [true, "pending", "Mo"]);
  assert.equal(call.fake.planner.calls.length, before);
});

test("I4: a tick undone while its planner write was on its way is put back in the planner", async () => {
  const call = linked();
  await call("syncTodos");
  // Between the app's save and the planner lock, someone undoes the tick.
  call.fake.planner.between = () => { call.fake({ key: KEY, actor: "Ajen", action: "undo", args: { logId: lastLogId(call) } }); };
  const t = await call("tickTodo", { id: "1" });
  assert.equal(t.data.planner, "pending");
  assert.deepEqual(writes(call).map((w) => (w.kind === "cell" ? w.value : w.values[8])), ["Booked", "Ticked off in the MAT app", "Not booked", "Tick undone in the MAT app"]);
  assert.deepEqual([stored(call, "1").ticked_by, stored(call, "1").planner_written, stored(call, "1").planner_was], ["", "", ""]);
});

test("migrate adds ticked_item and planner_was to a Todos tab that lacks them; until then the actions are refused", async () => {
  const call = linked({ over: { missingColumns: ["Todos.ticked_item", "Todos.planner_was"] } });
  assert.equal((await call("syncTodos")).error, "needs_migrate");
  assert.equal((await call("load")).ok, true);
  const m = await call.fake({ key: KEY, action: "migrate", args: {} });
  assert.deepEqual(m.data.added, ["Todos.ticked_item", "Todos.planner_was"]);
  assert.equal((await call("syncTodos")).ok, true);
});

// ---------- fix round 2 ----------

const asClaude = (call, action, args) => call.fake.claude(action, args);
const cellTries = (call) => call.fake.planner.calls.filter((c) => c.op === "cell").map((c) => c.cell);

test("round 2, 1: a Claude undo that would put a tick back is refused; one that takes a tick off still works", async () => {
  const call = linked();
  await call("syncTodos");
  const t = await call("tickTodo", { id: "1" });
  const u = await call("undo", { logId: t.data.logId });
  assert.equal(stored(call, "1").ticked_by, "");
  const back = await asClaude(call, "undo", { logId: u.data.logId });
  assert.deepEqual([back.ok, back.error, back.message], [false, "bad_input", "Undo this one in the app."]);
  assert.equal(stored(call, "1").ticked_by, "", "the tick is not put back");
  await forced(call);
  assert.equal(writes(call).length, 4, "and no later pull writes it");
  const r = call.fake.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "undo", arguments: { log_id: u.data.logId } } }, { t: "claude-token" });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /Undo this one in the app\./);
  // Taking a tick off through Claude is fine.
  const t2 = await call("tickTodo", { id: "2" });
  const off = await asClaude(call, "undo", { logId: t2.data.logId });
  assert.deepEqual([off.ok, off.data.planner, stored(call, "2").ticked_by, stored(call, "2").planner_written], [true, "pending", "", "undo"]);
});

test("round 2, 2: stuck ticks never keep a pull open; the two retries rotate, oldest tick first, so one that always fails starves no other", async () => {
  const call = linked({ book: bookNow(B1, B2, { ...B3, Status: "" }) });
  await call("syncTodos");
  call.fake.planner.cellFails = true;
  for (const id of ["1", "2", "3"]) { later(call, 1); await call("tickTodo", { id }); }
  assert.deepEqual(cellTries(call), ["E4", "E5", "E6"], "the ticks' own tries");
  const tries = () => cellTries(call).slice(3);
  const a = await forced(call);
  assert.deepEqual([a.data.more, a.data.pulledAt], [false, call.at.now], "all stuck: still a complete pull");
  assert.deepEqual(tries(), ["E4", "E5"], "the two oldest first");
  call.fake.planner.cellFails = (cell) => cell === "E4"; // #1 always fails
  const b = await forced(call);
  assert.deepEqual([b.data.more, b.data.pulledAt], [false, call.at.now]);
  assert.deepEqual(tries().slice(2), ["E6", "E4"], "then on from where it stopped, round to the start");
  const c = await forced(call);
  assert.deepEqual(tries().slice(4), ["E5", "E4"], "#2, still pending, gets its turn before #1 again");
  assert.equal(c.data.more, false);
  assert.deepEqual([stored(call, "1").planner_written, stored(call, "2").planner_written, stored(call, "3").planner_written], ["", "yes", "yes"]);
});

test("round 2, 3: a planner write reads the Change Log, then Book Now, then writes", async () => {
  const call = linked();
  await call("syncTodos");
  const start = call.fake.planner.calls.length;
  await call("tickTodo", { id: "1" });
  assert.deepEqual(call.fake.planner.calls.slice(start).map((c) => c.op + " " + c.tab), ["read Change Log", "read Book Now", "formula Book Now", "cell Book Now", "append Change Log"]);
});

test("round 2, 4: when the app can't record a planner write, the planner is put back; the tick stays and is retried", async () => {
  const call = linked();
  await call("syncTodos");
  const n0 = call.lock.n;
  call.lock.busy = (n) => n === n0 + 2; // free for the save, busy when the write is to be recorded
  const t = await call("tickTodo", { id: "1" });
  call.lock.busy = () => false;
  assert.deepEqual([t.ok, t.data.planner, t.data.todo.tickedBy], [true, "pending", "Mo"]);
  assert.deepEqual(writes(call).map((w) => (w.kind === "cell" ? w.value : w.values[8])), ["Booked", "Ticked off in the MAT app", "Not booked", "The MAT app couldn’t record the tick; put back"]);
  assert.deepEqual([stored(call, "1").planner_written, call.fake.planner.tabs["Book Now"][3][4]], ["", "Not booked"]);
  await forced(call);
  assert.equal(stored(call, "1").planner_written, "yes", "the next pull writes it, recorded");
});

test("round 2, 4: if putting back fails too, the answer is pending and History says Booked was left in the planner", async () => {
  const call = linked();
  await call("syncTodos");
  const n0 = call.lock.n;
  call.lock.busy = (n) => n === n0 + 2;
  call.fake.planner.cellFails = (cell, value) => value !== "Booked";
  const t = await call("tickTodo", { id: "1" });
  call.lock.busy = () => false;
  assert.equal(t.data.planner, "pending");
  const h = await history(call);
  assert.deepEqual([h[0].who, h[0].kind, h[0].summary, h[0].canUndo], ["Mo", "planner", "left “Rail pass reservation” marked Booked in the planner: the app couldn’t record it", false]);
  assert.equal(h[1].canUndo, true, "the tick itself can still be undone");
});

test("round 2, 4: a tick undone while its write was on its way, whose put-back fails, leaves the same History line", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.between = () => { call.fake({ key: KEY, actor: "Ajen", action: "undo", args: { logId: lastLogId(call) } }); };
  call.fake.planner.cellFails = (cell, value) => value !== "Booked";
  const t = await call("tickTodo", { id: "1" });
  assert.equal(t.data.planner, "pending");
  assert.equal((await history(call))[0].kind, "planner");
});

test("round 2, 5: a take-off names both the tick and the claim when both go", async () => {
  const call = linked();
  await call("syncTodos");
  await call("claimTodo", { id: "1", on: true }, "Ajen");
  call.fake.planner.cellFails = true;
  await call("tickTodo", { id: "1" });
  call.fake.planner.cellFails = false;
  call.fake.planner.tabs["Book Now"] = bookNow({ ...B1, Item: "Sumo tickets" }, B2, B3);
  const p = await forced(call);
  assert.equal((await history(call))[0].summary, "changed “Rail pass reservation”: the tick was taken off and Ajen is no longer on it");
  assert.deepEqual(p.data.problems, [{ id: "1", message: "That number is another item in the planner now: its tick was taken off and nobody is on it any more.", row: 4, what: "Sumo tickets" }]);
});

test("round 2, 6: a throw after the app's save answers pending; the tick stands", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.between = () => { throw new Error("boom"); };
  const t = await call("tickTodo", { id: "1" });
  assert.deepEqual([t.ok, t.data.planner, t.data.todo.tickedBy, stored(call, "1").ticked_by], [true, "pending", "Mo", "Mo"]);
  assert.equal("then_" in t, false);
});

test("round 2, 7: Items match after runs of spaces and non-breaking spaces are collapsed, on both sides", async () => {
  const call = linked({ book: bookNow({ ...B1, Item: "Rail\u00a0 pass  reservation" }) });
  await call("syncTodos");
  call.fake.planner.tabs["Book Now"][3][1] = "Rail pass\u00a0reservation";
  const t = await call("tickTodo", { id: "1" });
  assert.equal(t.data.planner, "written");
  call.fake.planner.cellFails = true;
  call.fake.planner.tabs["Book Now"][3][4] = "Not booked";
  call.fake.planner.tabs["Book Now"][3][1] = "Rail  pass reservation";
  const p = await forced(call);
  assert.deepEqual(p.data.problems, [], "no take-off for spacing alone");
  assert.equal(stored(call, "1").ticked_by, "Mo");
});

test("round 2, 8: the stored list answered by the 30-second rule (or the 10-minute one) says stored: true; a real pull has no such field", async () => {
  const call = linked();
  const real = await call("syncTodos");
  assert.equal("stored" in real.data, false);
  const soon = await call("syncTodos", { force: true });
  assert.equal(soon.data.stored, true);
  later(call, 5);
  assert.equal((await call("syncTodos")).data.stored, true);
  assert.equal("stored" in (await call("syncTodos", { force: true })).data, false);
});

// ---------- final fix wave ----------

// A planner cell holding a formula: Book Now row 4 (item 1), column E.
const withFormula = (call, cell = "E4") => { call.fake.planner.formulas["Book Now"] = { ...(call.fake.planner.formulas["Book Now"] || {}), [cell]: "=IF(F4>0,\"Booked\",\"Not booked\")" }; };
const bookStatus = (call, row = 4) => call.fake.planner.tabs["Book Now"][row - 1][4];

test("final 1: when recording the write throws, the planner is put back, no planner_written, answer pending", async () => {
  const call = linked();
  await call("syncTodos");
  const real = call.fake.world.updateById_;
  call.fake.world.updateById_ = (tab, id, patch) => {
    if (tab === "Todos" && patch.planner_written === "yes") throw new Error("boom: Sheets error");
    return real(tab, id, patch);
  };
  const t = await call("tickTodo", { id: "1" });
  call.fake.world.updateById_ = real;
  assert.deepEqual([t.ok, t.data.planner, t.data.todo.tickedBy], [true, "pending", "Mo"]);
  assert.equal(bookStatus(call), "Not booked");
  assert.equal(stored(call, "1").planner_written, "");
  assert.deepEqual(writes(call).filter((w) => w.kind === "cell").map((w) => w.value), ["Booked", "Not booked"]);
});

test("final 1: when recording throws and the put-back fails too, History says Booked was left and the answer is pending", async () => {
  const call = linked();
  await call("syncTodos");
  const real = call.fake.world.updateById_;
  call.fake.world.updateById_ = (tab, id, patch) => {
    if (tab === "Todos" && patch.planner_written === "yes") throw new Error("boom");
    return real(tab, id, patch);
  };
  call.fake.planner.cellFails = (cell, value) => value !== "Booked";
  const t = await call("tickTodo", { id: "1" });
  call.fake.world.updateById_ = real;
  assert.equal(t.data.planner, "pending");
  assert.equal((await history(call))[0].kind, "planner");
});

// Fix round 6a: past tense, true for as long as the row stays so (was: "The planner computes this one’s Status, so it was left alone.").
const FORMULA_LINE = "The planner worked out this one’s Status itself when it was ticked, so the app left it alone.";

test("final 2: a tick on a Status cell that holds a formula writes nothing to the planner and answers kept", async () => {
  const call = linked();
  await call("syncTodos");
  withFormula(call);
  const t = await call("tickTodo", { id: "1" });
  assert.deepEqual([t.ok, t.data.planner, t.data.todo.tickedBy], [true, "kept", "Mo"]);
  assert.deepEqual(writes(call), [], "no cell, no Change Log row");
  const h = await history(call);
  assert.deepEqual([h[0].kind, h[0].summary, h[0].canUndo], ["planner", FORMULA_LINE, false]);
  await forced(call);
  assert.deepEqual(writes(call), []);
  assert.equal((await history(call)).filter((e) => e.summary === FORMULA_LINE).length, 1);
});

test("round 4: a tick on a formula Status is recorded as planner_written formula, planner_was empty", async () => {
  const call = linked();
  await call("syncTodos");
  withFormula(call);
  const t = await call("tickTodo", { id: "1" });
  assert.deepEqual([stored(call, "1").planner_written, stored(call, "1").planner_was], ["formula", ""]);
  assert.deepEqual([t.data.todo.done, t.data.todo.plannerComputes], [true, true]);
});

test("round 4: a settled formula tick counts as done and is never retried, read or written by a pull", async () => {
  const call = linked();
  await call("syncTodos");
  withFormula(call);
  await call("tickTodo", { id: "1" });
  const start = call.fake.planner.calls.length;
  const s = await forced(call);
  const td = s.data.todos.find((x) => x.id === "1");
  assert.deepEqual([td.done, td.tickedBy, td.plannerComputes], [true, "Mo", true]);
  assert.deepEqual(call.fake.planner.calls.slice(start).map((c) => c.op + " " + c.tab), ["read Book Now"], "only the pull's own read");
  assert.deepEqual(writes(call), []);
  assert.equal(stored(call, "1").planner_written, "formula");
});

test("round 4: a pull never takes the tick off because the computed Status is not Booked, nor changes anything when it reads Booked", async () => {
  const call = linked();
  await call("syncTodos");
  withFormula(call);
  await call("tickTodo", { id: "1" });
  await forced(call);
  assert.equal(stored(call, "1").ticked_by, "Mo");
  assert.equal(stored(call, "1").planner_written, "formula");
  call.fake.planner.tabs["Book Now"][3][4] = "Booked";
  const s = await forced(call);
  const td = s.data.todos.find((x) => x.id === "1");
  assert.deepEqual([td.tickedBy, td.done, td.plannerComputes], ["Mo", true, true]);
  assert.deepEqual([stored(call, "1").planner_written, stored(call, "1").planner_was], ["formula", ""]);
  assert.deepEqual(writes(call), []);
  assert.deepEqual(s.data.problems, []);
});

test("final 2: undo of a tick made on a formula cell writes nothing", async () => {
  const call = linked();
  await call("syncTodos");
  withFormula(call);
  const t = await call("tickTodo", { id: "1" });
  later(call, 2);
  const u = await call("undo", { logId: t.data.logId }, "Ajen");
  assert.equal(u.ok, true);
  assert.equal(u.data.planner, "kept");
  assert.deepEqual([u.data.todo.tickedBy, u.data.todo.done, u.data.todo.plannerComputes], ["", false, false], "the tick is off in the app");
  assert.deepEqual([stored(call, "1").planner_written, stored(call, "1").planner_was], ["", ""]);
  assert.deepEqual(writes(call), [], "nothing in the planner, no Change Log row");
  assert.equal(call.fake.planner.tabs["Change Log"].length, LOG.length);
});

test("final 2: a put-back never writes over a formula either", async () => {
  const { call, logId } = await ticked();
  withFormula(call);
  later(call, 2);
  const u = await call("undo", { logId }, "Ajen");
  assert.equal(u.data.planner, "kept");
  assert.equal(writes(call).length, 2, "only the tick's own two writes");
});

test("correction: a Status cell that cannot be checked leaves the tick pending, nothing written, no formula note; the next pull writes it", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.formulaFails = true;
  const t = await call("tickTodo", { id: "1" });
  assert.equal(t.data.planner, "pending");
  assert.equal(stored(call, "1").planner_written, "");
  assert.deepEqual(writes(call), []);
  assert.equal((await history(call)).filter((e) => e.summary === FORMULA_LINE).length, 0);
  await forced(call);
  assert.deepEqual([stored(call, "1").planner_written, writes(call)], ["", []], "a pull's retry leaves it as it was");
  call.fake.planner.formulaFails = false;
  await forced(call);
  assert.deepEqual([stored(call, "1").planner_written, stored(call, "1").planner_was, bookStatus(call)], ["yes", "Not booked", "Booked"]);
  assert.equal(writes(call).length, 2);
});

test("correction: a tick left pending by an unknown check settles as formula once a working read shows a computed cell", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.formulaFails = true;
  await call("tickTodo", { id: "1" });
  call.fake.planner.formulaFails = false;
  withSpill(call);
  await forced(call);
  assert.equal(stored(call, "1").planner_written, "formula");
  assert.deepEqual(writes(call), []);
  assert.equal((await history(call)).filter((e) => e.summary === FORMULA_LINE).length, 1);
});

test("correction: an undo whose check is unknown stays owed with its note; the next pull puts it back", async () => {
  const { call, u } = await owed((c) => { c.fake.planner.formulaFails = true; });
  assert.equal(u.data.planner, "pending");
  assert.deepEqual(owedOf(call), ["", "undo", "Not booked", "Not booked"]);
  assert.equal((await owedNotes(call)).length, 1);
  assert.equal(writes(call).length, 2);
  call.fake.planner.formulaFails = false;
  await forced(call);
  assert.deepEqual(owedOf(call), ["", "", "", "Not booked"]);
  assert.deepEqual(writes(call).slice(2).map((w) => (w.kind === "cell" ? w.value : w.values[8])), ["Not booked", "Tick undone in the MAT app"]);
});

test("final 3: a failed Change Log append puts the old Status back only while the cell still says what the app wrote", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.appendFails = true;
  // Someone edits the cell after the app's write and before the put-back.
  const orig = call.fake.planner.tabs;
  const realAppend = call.fake.world.plannerAppendRow_;
  call.fake.world.plannerAppendRow_ = (...a) => { orig["Book Now"][3][4] = "Booked - conf 123"; return realAppend(...a); };
  const t = await call("tickTodo", { id: "1" });
  call.fake.world.plannerAppendRow_ = realAppend;
  assert.equal(t.data.planner, "pending");
  assert.equal(bookStatus(call), "Booked - conf 123", "the hand edit is left alone");
  assert.deepEqual(writes(call).filter((w) => w.kind === "cell").map((w) => w.value), ["Booked"]);
});

test("round 4: a Change Log row someone adds between the app's read and its append survives", async () => {
  const call = linked();
  await call("syncTodos");
  const realSet = call.fake.world.plannerSetCell_;
  const human = [9, "2026-11-20 10:01 ET", "By hand", "Payments", "C3", "x", "a", "b", "", "", ""];
  call.fake.world.plannerSetCell_ = (...a) => { call.fake.planner.tabs["Change Log"].push(human.slice()); return realSet(...a); };
  const t = await call("tickTodo", { id: "1" });
  call.fake.world.plannerSetCell_ = realSet;
  assert.equal(t.data.planner, "written");
  const rows = call.fake.planner.tabs["Change Log"];
  assert.equal(rows.length, LOG.length + 2);
  assert.deepEqual(rows[LOG.length], human, "the hand-added row is still there");
  assert.equal(rows[LOG.length + 1][5], "Rail pass reservation");
  assert.deepEqual(call.fake.planner.writes.filter((w) => w.kind === "append").map((w) => [w.tab, w.headerRow]), [["Change Log", 2]]);
});

// The real Change Log: its table starts in column B, column A is an empty margin.
const MHEAD = ["", ...CHEAD, ""];
const MLOG = [["Change log"], MHEAD, ["", 43, "2026-11-01 10:00 ET", "Planner chat", "Book Now", "E5", "Tea", "(empty)", "Pending", "w", "", ""], ["", 44, "2026-11-02 09:00 ET", "Planner chat", "Payments", "C2", "x", "a", "b", "", "", ""]];

function assertAligned(row, n, who, why) {
  assert.equal(row[0] === undefined || row[0] === "", true, "column A stays empty");
  assert.equal(row[1], n, "# in column B");
  assert.match(row[2], /^2026-11-20 \d\d:\d\d ET$/, "date in column C");
  assert.equal(row[3], "MAT app (" + who + ")");
  assert.equal(row[4], "Book Now");
  assert.equal(row[5], "E4");
  assert.equal(row[6], "Rail pass reservation");
  assert.equal(row[9], why);
  assert.equal(row[11], "By " + who, "last value under Verified?");
  assert.equal(row.length <= 12, true, "nothing in column M or beyond");
}

test("Change Log aligned: a tick writes the # in column B when the table starts in B; the undo's row aligns too", async () => {
  const call = linked({ log: MLOG });
  await call("syncTodos");
  const t = await call("tickTodo", { id: "1" });
  const rows = call.fake.planner.tabs["Change Log"];
  assert.equal(rows.length, MLOG.length + 1);
  assertAligned(rows[MLOG.length], 45, "Mo", "Ticked off in the MAT app");
  later(call, 2);
  const u = await call("undo", { logId: t.data.logId }, "Ajen");
  assert.equal(u.data.planner, "written");
  assert.equal(rows.length, MLOG.length + 2);
  assertAligned(rows[MLOG.length + 1], 46, "Ajen", "Tick undone in the MAT app");
});

test("Change Log aligned: two ticks in a row get consecutive # numbers (44, 45, 46)", async () => {
  const call = linked({ log: MLOG });
  await call("syncTodos");
  await call("tickTodo", { id: "1" });
  await call("tickTodo", { id: "2" });
  const rows = call.fake.planner.tabs["Change Log"];
  assert.deepEqual(rows.slice(MLOG.length - 1).map((r) => r[1]), [44, 45, 46]);
});

test("Change Log aligned: a table starting in column A is still aligned", async () => {
  const call = linked();
  await call("syncTodos");
  await call("tickTodo", { id: "1" });
  const row = call.fake.planner.tabs["Change Log"][LOG.length];
  assert.equal(row[0], 8);
  assert.match(row[1], /^2026-11-20/);
  assert.equal(row[10], "By Mo");
  assert.equal(row.length, 11);
});

test("round 4: the fake's append adds a row and never replaces one, as Sheets' own append does", () => {
  const call = linked({ log: [LOG[0], CHEAD, LOG[2], [], LOG[3]] });
  call.fake.world.plannerAppendRow_("Change Log", 2, 0, ["new"]);
  const rows = call.fake.planner.tabs["Change Log"];
  assert.equal(rows.length, 6);
  assert.deepEqual([rows[2], rows[3], rows[5]], [LOG[2], ["new"], LOG[3]], "the gap takes it, nothing is overwritten");
});

test("round 4: when recording throws after planner_written landed, the planner is left alone and the answer is written", async () => {
  const call = linked();
  await call("syncTodos");
  const ru = call.fake.world.updateById_;
  const rb = call.fake.world.bumpRev_;
  let armed = false;
  call.fake.world.updateById_ = (tab, id, p) => { const r = ru(tab, id, p); if (p.planner_written === "yes") armed = true; return r; };
  call.fake.world.bumpRev_ = (...a) => { if (armed) { armed = false; throw new Error("boom"); } return rb(...a); };
  const t = await call("tickTodo", { id: "1" });
  call.fake.world.updateById_ = ru;
  call.fake.world.bumpRev_ = rb;
  assert.equal(t.data.planner, "written");
  assert.equal(stored(call, "1").planner_written, "yes");
  assert.equal(bookStatus(call), "Booked");
  assert.deepEqual(writes(call).filter((w) => w.kind === "cell").map((w) => w.value), ["Booked"], "no put-back");
  assert.equal(call.fake.planner.tabs["Change Log"].length, LOG.length + 1);
});

test("final 5: the refusal that carries the stored list says stored: true", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.fails = true;
  const r = await forced(call);
  assert.equal(r.error, "planner_unreadable");
  assert.equal(r.data.stored, true);
  assert.equal(r.data.todos.length, 3);
});

test("round 4: todoFromRow says when the planner computes the Status (planner_written formula)", () => {
  assert.equal(P.todoFromRow({ id: "1", item: "x", ticked_by: "Mo", planner_written: "formula" }).plannerComputes, true);
  assert.equal(P.todoFromRow({ id: "1", item: "x", ticked_by: "Mo", planner_written: "yes" }).plannerComputes, false);
  assert.equal(P.todoFromRow({ id: "1", item: "x" }).plannerComputes, false);
  assert.equal("nextLogRow" in P, false);
});

// ---------- post-deploy fixes ----------

const OWED_NOTE = "The planner still says Booked for this one; the app will put it back at the next fetch.";
const owedNotes = async (call) => (await history(call)).filter((e) => e.summary === OWED_NOTE);
const owedOf = (call, id = "1") => { const r = stored(call, id); return [r.ticked_by, r.planner_written, r.planner_was, r.status]; };

// A written tick of B1 by Mo, then Ajen's undo of it while the planner refuses the put-back (fail(call) sets that up).
async function owed(fail = (c) => { c.fake.planner.cellFails = true; }) {
  const { call, logId } = await ticked();
  fail(call);
  later(call, 2);
  const u = await call("undo", { logId }, "Ajen");
  return { call, logId, u };
}

for (const [name, fail, cells] of [
  ["the planner lock is busy", (c) => { c.fake.planner.lockFails = true; }, ["Booked"]],
  ["Sheets refuses the cell", (c) => { c.fake.planner.cellFails = true; }, ["Booked"]],
  ["the Change Log append fails (the cell goes back to Booked)", (c) => { c.fake.planner.appendFails = true; }, ["Booked", "Not booked", "Booked"]],
]) {
  test(`post-deploy 1a: an undo whose put-back is pending stays owed when ${name}`, async () => {
    const { call, u } = await owed(fail);
    assert.equal(u.ok, true, JSON.stringify(u));
    assert.equal(u.data.planner, "pending");
    assert.deepEqual(owedOf(call), ["", "undo", "Not booked", "Not booked"]);
    assert.deepEqual([u.data.todo.tickedBy, u.data.todo.status, u.data.todo.done, u.data.todo.plannerComputes], ["", "Not booked", false, false]);
    assert.equal(bookStatus(call), "Booked");
    assert.deepEqual(writes(call).filter((w) => w.kind === "cell").map((w) => w.value), cells);
    assert.equal(call.fake.planner.tabs["Change Log"].length, LOG.length + 1, "only the tick's Change Log row");
    const notes = await owedNotes(call);
    assert.equal(notes.length, 1);
    assert.deepEqual([notes[0].kind, notes[0].canUndo], ["planner", false]);
  });
}

test("post-deploy 1a: an undo whose put-back is written or kept owes nothing and adds no note", async () => {
  const w = await owed(() => {});
  assert.equal(w.u.data.planner, "written");
  assert.deepEqual(owedOf(w.call), ["", "", "", "Not booked"]);
  const k = await owed((c) => { c.fake.planner.tabs["Book Now"][3][4] = "Cancelled"; });
  assert.equal(k.u.data.planner, "kept");
  assert.deepEqual(owedOf(k.call).slice(0, 3), ["", "", ""]);
  assert.equal(writes(k.call).length, 2);
  assert.equal((await owedNotes(w.call)).length + (await owedNotes(k.call)).length, 0);
});

test("post-deploy 1b: the next pull puts it back: one cell, one Change Log row by the one who undid it; then nothing is owed", async () => {
  const { call } = await owed();
  call.fake.planner.cellFails = false;
  const p = await forced(call);
  const td = p.data.todos.find((t) => t.id === "1");
  assert.deepEqual([td.done, td.status, td.tickedBy], [false, "Not booked", ""]);
  assert.deepEqual(writes(call).slice(2), [
    { kind: "cell", tab: "Book Now", cell: "E4", value: "Not booked" },
    { kind: "append", tab: "Change Log", headerRow: 2, values: [9, "2026-11-20 10:03 ET", "MAT app (Ajen)", "Book Now", "E4", "Rail pass reservation", "Booked", "Not booked", "Tick undone in the MAT app", "MAT app History", "By Ajen"] },
  ]);
  assert.deepEqual(owedOf(call), ["", "", "", "Not booked"]);
  await forced(call);
  assert.equal(writes(call).length, 4, "a later pull writes nothing more");
  assert.equal((await owedNotes(call)).length, 1);
});

test("post-deploy 1b/1c: while the put-back keeps failing a pull keeps it owed, shows planner_was, and adds no second note", async () => {
  const { call } = await owed();
  const p = await forced(call);
  const td = p.data.todos.find((t) => t.id === "1");
  assert.deepEqual([td.done, td.status, td.tickedBy, td.plannerComputes], [false, "Not booked", "", false], "the planner's Booked is not adopted");
  assert.deepEqual(owedOf(call), ["", "undo", "Not booked", "Not booked"]);
  assert.deepEqual(cellTries(call).slice(1), ["E4", "E4"], "the undo's own try, then the pull's retry");
  assert.equal((await owedNotes(call)).length, 1);
});

test("post-deploy 1b: an owed put-back whose cell someone changed is kept: cleared, nothing written, the planner's word adopted", async () => {
  const { call } = await owed();
  call.fake.planner.cellFails = false;
  call.fake.planner.tabs["Book Now"][3][4] = "Booked by phone";
  const p = await forced(call);
  assert.deepEqual(owedOf(call), ["", "", "", "Booked by phone"]);
  assert.equal(p.data.todos.find((t) => t.id === "1").done, true);
  assert.equal(writes(call).length, 2);
});

test("post-deploy 1b: owed put-backs share the two retries a pull and their rotation with stuck ticks", async () => {
  const call = linked({ book: bookNow(B1, B2, { ...B3, Status: "" }) });
  await call("syncTodos");
  const t1 = await call("tickTodo", { id: "1" });
  later(call, 1);
  const t2 = await call("tickTodo", { id: "2" });
  call.fake.planner.cellFails = true;
  later(call, 1);
  await call("undo", { logId: t1.data.logId });
  await call("undo", { logId: t2.data.logId });
  await call("tickTodo", { id: "3" });
  assert.deepEqual([owedOf(call, "1")[1], owedOf(call, "2")[1], owedOf(call, "3")[1]], ["undo", "undo", ""]);
  const start = cellTries(call).length;
  await forced(call);
  assert.equal(cellTries(call).length - start, 2, "two retries a pull");
  await forced(call);
  assert.deepEqual(new Set(cellTries(call).slice(start)), new Set(["E4", "E5", "E6"]), "every one gets its turn");
  assert.equal(cellTries(call).length - start, 4);
  call.fake.planner.cellFails = false;
  await forced(call);
  await forced(call);
  assert.deepEqual([owedOf(call, "1"), owedOf(call, "2"), owedOf(call, "3")], [["", "", "", "Not booked"], ["", "", "", "Pending"], ["Mo", "yes", "", "Booked"]]);
  assert.deepEqual(writes(call).filter((w) => w.kind === "cell").map((w) => w.cell + "=" + w.value).sort(), ["E4=Booked", "E4=Not booked", "E5=Booked", "E5=Pending", "E6=Booked"]);
  assert.equal(writes(call).filter((w) => w.kind === "cell").length, 5, "two ticks, two put-backs, one stuck tick: nothing else");
});

test("post-deploy 1d: ticking an owed row again: ticked, yes, planner_was kept, nothing written to the planner", async () => {
  const { call } = await owed();
  call.fake.planner.cellFails = false;
  const start = call.fake.planner.calls.length;
  later(call, 1);
  const t = await call("tickTodo", { id: "1" }, "Mo");
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.deepEqual(owedOf(call), ["Mo", "yes", "Not booked", "Booked"]);
  assert.deepEqual([t.data.todo.done, t.data.todo.tickedBy], [true, "Mo"]);
  // Wave A item 7: the planner is read to check it still holds the app's Booked (was: "not even read").
  assert.deepEqual(call.fake.planner.calls.slice(start).map((c) => c.op + " " + c.tab), ["read Change Log", "read Book Now"], "only read");
  assert.equal(writes(call).length, 2);
  await forced(call);
  assert.equal(writes(call).length, 2, "nor by the next pull");
  // That tick undoes as any written tick does.
  later(call, 1);
  const u = await call("undo", { logId: t.data.logId }, "Mo");
  assert.equal(u.data.planner, "written");
  assert.deepEqual(writes(call).slice(2).map((w) => (w.kind === "cell" ? w.value : w.values[8])), ["Not booked", "Tick undone in the MAT app"]);
});

test("post-deploy 1d: undoing the undo while the put-back is owed: ticked again, yes, nothing written", async () => {
  const { call, u } = await owed();
  call.fake.planner.cellFails = false;
  const start = call.fake.planner.calls.length;
  later(call, 1);
  const uu = await call("undo", { logId: u.data.logId }, "Mo");
  assert.equal(uu.ok, true, JSON.stringify(uu));
  assert.deepEqual(owedOf(call), ["Mo", "yes", "Not booked", "Booked"]);
  assert.equal(uu.data.todo.done, true);
  // Wave A item 7: read to check, nothing written (was: no planner call at all).
  assert.deepEqual(call.fake.planner.calls.slice(start).map((c) => c.op + " " + c.tab), ["read Change Log", "read Book Now"]);
  assert.equal(writes(call).length, 2);
});

test("post-deploy 1e: a connector undo of a written tick takes it off, owes the put-back without touching the planner; the next pull puts it back", async () => {
  const call = linked();
  await call("syncTodos");
  const t = await call("tickTodo", { id: "1" });
  const start = call.fake.planner.calls.length;
  later(call, 1);
  const off = await asClaude(call, "undo", { logId: t.data.logId });
  assert.deepEqual([off.ok, off.data.planner, off.data.todo.tickedBy, off.data.todo.done], [true, "pending", "", false]);
  assert.deepEqual(call.fake.planner.calls.slice(start), [], "the connector never reaches the planner");
  assert.deepEqual(owedOf(call), ["", "undo", "Not booked", "Not booked"]);
  assert.equal((await owedNotes(call)).length, 1);
  // Nor can it put the tick back.
  const back = await asClaude(call, "undo", { logId: off.data.logId });
  assert.deepEqual([back.ok, back.error], [false, "bad_input"]);
  await forced(call);
  assert.deepEqual(owedOf(call), ["", "", "", "Not booked"]);
  assert.deepEqual(writes(call).slice(2).map((w) => (w.kind === "cell" ? w.value : w.values[2])), ["Not booked", "MAT app (Mo)"]);
});

test("post-deploy 1f: load and the actions never show an owed row as done, written or computed", async () => {
  const { call, u } = await owed();
  const keys = Object.keys(u.data.todo).sort();
  const todo = (await call("load")).data.todos.find((t) => t.id === "1");
  assert.deepEqual(Object.keys(todo).sort(), keys);
  assert.deepEqual([todo.done, todo.plannerComputes, todo.status, todo.tickedBy], [false, false, "Not booked", ""]);
  assert.equal(JSON.stringify(todo).includes("undo"), false);
  assert.equal(JSON.stringify(u.data.todo).includes("undo"), false);
  assert.equal(P.todoFromRow({ id: "1", item: "x", status: "Not booked", planner_written: "undo", planner_was: "Not booked" }).done, false);
  assert.equal(P.todoFromRow({ id: "1", item: "x", status: "Not booked", planner_written: "undo" }).plannerComputes, false);
});

test("post-deploy 1: an owed put-back whose planner row now holds another item is dropped, nothing written", async () => {
  const { call } = await owed();
  call.fake.planner.cellFails = false;
  call.fake.planner.tabs["Book Now"][3][1] = "Something else now";
  await forced(call);
  assert.deepEqual(owedOf(call).slice(0, 3), ["", "", ""]);
  assert.equal(writes(call).length, 2);
});

// A cell an array formula placed elsewhere fills: a value, nothing entered in it.
const withSpill = (call, cell = "E4") => { call.fake.planner.spilled["Book Now"] = { ...(call.fake.planner.spilled["Book Now"] || {}), [cell]: true }; };

test("post-deploy 2: a tick on a spilled Status answers kept, saves formula and writes nothing", async () => {
  const call = linked();
  await call("syncTodos");
  withSpill(call);
  const t = await call("tickTodo", { id: "1" });
  assert.equal(t.data.planner, "kept");
  assert.deepEqual([stored(call, "1").planner_written, stored(call, "1").planner_was], ["formula", ""]);
  assert.deepEqual(writes(call), []);
  later(call, 1);
  const u = await call("undo", { logId: t.data.logId });
  assert.equal(u.data.planner, "kept");
  assert.deepEqual(writes(call), [], "nor does its undo");
});

test("post-deploy 2: neither a stuck tick's retry nor an owed put-back writes over a spilled Status", async () => {
  const s = await ticked((c) => { c.fake.planner.cellFails = true; });
  withSpill(s.call);
  await forced(s.call);
  assert.deepEqual(writes(s.call), []);
  assert.equal(stored(s.call, "1").planner_written, "formula");
  const { call } = await owed();
  call.fake.planner.cellFails = false;
  withSpill(call);
  await forced(call);
  assert.equal(writes(call).length, 2);
  assert.deepEqual(owedOf(call).slice(0, 3), ["", "", ""], "kept: nothing owed");
});

test("post-deploy 2: an undo of a written tick whose Status became spilled writes nothing", async () => {
  const { call, logId } = await ticked();
  withSpill(call);
  later(call, 1);
  const u = await call("undo", { logId });
  assert.equal(u.data.planner, "kept");
  assert.equal(writes(call).length, 2);
});

test("post-deploy 2: the fake's plain cell write clears that cell's formula, as Sheets does", () => {
  const call = linked();
  withFormula(call);
  withFormula(call, "E5");
  call.fake.world.plannerSetCell_("Book Now", "E4", "Booked");
  assert.deepEqual(Object.keys(call.fake.planner.formulas["Book Now"]), ["E5"]);
});

// ---------- wave A ----------

const NOPROBS = { at: "", list: [], more: 0 };
const TWICE = "That number is in the Book Now tab twice.";

test("wave A 1: a pull's problems carry the sheet's row and a few words of the item", async () => {
  const call = linked({ book: bookNow(B1, { ...B2, "#": 1, Item: "Made-up   duplicate\nline" }) });
  const r = await call("syncTodos");
  assert.deepEqual(r.data.problems, [{ id: "1", message: TWICE, row: 5, what: "Made-up duplicate line" }]);
  assert.deepEqual(P.todosFromRows(bookNow(B1, { ...B2, "#": 1 }), 2026).problems, [{ id: "1", message: TWICE, row: 5, what: "Tea ceremony class" }]);
});

test("wave A 1: a take-off's problem names the row and the item now under that number", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.cellFails = true;
  await call("tickTodo", { id: "1" });
  call.fake.planner.cellFails = false;
  call.fake.planner.tabs["Book Now"] = bookNow({ ...B1, Item: "Made-up other booking" }, B2, B3);
  const p = await forced(call);
  assert.deepEqual(p.data.problems, [{ id: "1", message: "That number is another item in the planner now: its tick was taken off.", row: 4, what: "Made-up other booking" }]);
});

test("wave A 1: the last pull's problems are kept in TODO_PROBLEMS and load hands them back; empty shape before any", async () => {
  const call = linked({ book: bookNow(B1, { ...B2, "#": 1 }) });
  assert.deepEqual((await call("load")).data.todoProblems, NOPROBS, "never pulled");
  await call("syncTodos");
  const want = { at: call.at.now, list: [{ id: "1", message: TWICE, row: 5, what: "Tea ceremony class" }], more: 0 };
  assert.deepEqual(JSON.parse(call.fake.props.TODO_PROBLEMS), want);
  assert.deepEqual((await call("load", {}, "Ajen")).data.todoProblems, want);
  // A stored answer (within 10 minutes, or a forced one within 30 seconds) leaves them alone.
  call.fake.planner.tabs["Book Now"] = bookNow(B1, B2);
  later(call, 2);
  assert.equal((await call("syncTodos")).data.stored, true);
  assert.equal((await call("syncTodos", { force: true })).data.stored, undefined, "after 30 seconds a forced pull reads");
  assert.deepEqual((await call("load")).data.todoProblems, { at: call.at.now, list: [], more: 0 }, "a real pull with none clears them");
  later(call, 0.2);
  call.fake.planner.tabs["Book Now"] = bookNow(B1, { ...B2, "#": 1 });
  assert.equal((await call("syncTodos", { force: true })).data.stored, true);
  assert.deepEqual((await call("load")).data.todoProblems.list, []);
  // A refused pull (the planner can't be read) leaves them alone too.
  later(call, 1);
  call.fake.planner.fails = true;
  assert.equal((await call("syncTodos", { force: true })).ok, false);
  assert.deepEqual((await call("load")).data.todoProblems.list, []);
});

test("wave A 1: at most 20 problems are kept, with how many more; garbage in TODO_PROBLEMS loads as the empty shape", async () => {
  const dups = Array.from({ length: 25 }, (_, i) => ({ "#": 1, Item: "Made-up repeat " + (i + 1) }));
  const call = linked({ book: bookNow(B1, ...dups) });
  const r = await call("syncTodos");
  assert.equal(r.data.problems.length, 25, "the reply has them all");
  const kept = (await call("load")).data.todoProblems;
  assert.deepEqual([kept.list.length, kept.more, kept.list[19].what], [20, 5, "Made-up repeat 20"]);
  for (const bad of ["", "{", "null", "[]", '{"at":1,"list":[],"more":0}', '{"at":"","list":[{"id":1}],"more":0}', '{"at":"","list":[],"more":"2"}', '{"at":"","list":[{"id":"1","message":"m","what":"w","row":"5"}],"more":0}']) {
    call.fake.props.TODO_PROBLEMS = bad;
    assert.deepEqual((await call("load")).data.todoProblems, NOPROBS, bad);
  }
  call.fake.props.TODO_PROBLEMS = JSON.stringify({ at: "x", list: [{ id: "1", message: "m", what: "w", row: null }], more: 0 });
  assert.deepEqual((await call("load")).data.todoProblems, { at: "x", list: [{ id: "1", message: "m", what: "w", row: null }], more: 0 });
});

test("wave A 4: a tick written and recorded answers written even when reading the row back for the reply throws", async () => {
  const call = linked();
  await call("syncTodos");
  const real = call.fake.world.findRow_;
  call.fake.world.findRow_ = (tab, id) => {
    if (tab === "Todos" && stored(call, "1").planner_written === "yes") throw new Error("boom: read after the write");
    return real(tab, id);
  };
  const t = await call("tickTodo", { id: "1" });
  call.fake.world.findRow_ = real;
  assert.deepEqual([t.ok, t.data.planner, t.data.todo.tickedBy], [true, "written", "Mo"]);
  assert.equal(stored(call, "1").planner_written, "yes");
  assert.equal(writes(call).length, 2);
});

test("wave A 4: an undo whose put-back was written and recorded answers written even when the read back throws", async () => {
  const { call, logId } = await ticked();
  const real = call.fake.world.findRow_;
  let after = false;
  call.fake.world.findRow_ = (tab, id) => {
    if (after && tab === "Todos" && stored(call, "1").planner_written === "") throw new Error("boom: read after the put-back");
    return real(tab, id);
  };
  after = true;
  later(call, 1);
  const u = await call("undo", { logId });
  call.fake.world.findRow_ = real;
  assert.deepEqual([u.ok, u.data.planner], [true, "written"]);
  assert.equal(bookStatus(call), "Not booked");
});

test("wave A 4: a throw before the planner part is known still answers pending", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.planner.between = () => { throw new Error("boom"); };
  const t = await call("tickTodo", { id: "1" });
  assert.equal(t.data.planner, "pending");
});

test("fix 6a (ruling): a formula Status replaced by text later stays as it is, and what History and the list say stays true", async () => {
  const call = linked();
  await call("syncTodos");
  withFormula(call);
  await call("tickTodo", { id: "1" });
  delete call.fake.planner.formulas["Book Now"].E4; // the owner types a plain value over the formula
  await forced(call);
  assert.deepEqual(writes(call), [], "no new planner write path");
  assert.equal(stored(call, "1").planner_written, "formula");
  const notes = (await history(call)).filter((e) => e.kind === "planner");
  assert.deepEqual(notes.map((e) => e.summary), [FORMULA_LINE], "past tense: no promise of a later write");
  assert.equal(/later|will|next/.test(FORMULA_LINE), false);
});

test("fix 6a: the formula note's earlier wording still counts as said, so it is never said twice", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.primitives.appendObj_("Log", { id: 900, at: call.at.now, who: "Mo", via: "app", action: "note", kind: "planner", ref: "1", summary: "The planner computes this one’s Status, so it was left alone.", before: "", after: "", undoes: "", undone_by: "" });
  withFormula(call);
  await call("tickTodo", { id: "1" });
  assert.equal((await history(call)).filter((e) => e.kind === "planner").length, 1);
});

test("wave A 6: no formula note for a tick undone before its planner check was recorded", async () => {
  const call = linked();
  await call("syncTodos");
  withFormula(call);
  call.fake.planner.between = () => { call.fake({ key: KEY, actor: "Ajen", action: "undo", args: { logId: lastLogId(call) } }); };
  const t = await call("tickTodo", { id: "1" });
  assert.equal(t.ok, true);
  assert.equal(stored(call, "1").ticked_by, "", "undone meanwhile");
  assert.equal((await history(call)).filter((e) => e.summary === FORMULA_LINE).length, 0);
  assert.equal(stored(call, "1").planner_written, "");
  assert.deepEqual(writes(call), []);
});

test("wave A 7: a re-tick after a put-back that was written but not recorded writes Booked again", async () => {
  const { call, logId } = await ticked();
  const n0 = call.lock.n;
  call.lock.busy = (n) => n === n0 + 2; // free for the undo, busy when its put-back is to be recorded
  later(call, 1);
  const u = await call("undo", { logId }, "Ajen");
  call.lock.busy = () => false;
  assert.equal(u.data.planner, "written");
  assert.deepEqual([stored(call, "1").planner_written, bookStatus(call)], ["undo", "Not booked"], "the put-back went through, unrecorded");
  later(call, 1);
  const t = await call("tickTodo", { id: "1" }, "Mo");
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.equal(bookStatus(call), "Booked", "the planner says Booked again");
  assert.deepEqual([stored(call, "1").planner_written, stored(call, "1").planner_was, stored(call, "1").status], ["yes", "Not booked", "Booked"]);
  assert.equal(t.data.planner, "written");
  // And undoes as any written tick does.
  later(call, 1);
  const u2 = await call("undo", { logId: t.data.logId }, "Mo");
  assert.equal(u2.data.planner, "written");
  assert.equal(bookStatus(call), "Not booked");
});

test("wave A 7: undoing the undo after a put-back that was written but not recorded writes Booked again too", async () => {
  const { call, logId } = await ticked();
  const n0 = call.lock.n;
  call.lock.busy = (n) => n === n0 + 2;
  later(call, 1);
  const u = await call("undo", { logId }, "Ajen");
  call.lock.busy = () => false;
  later(call, 1);
  const uu = await call("undo", { logId: u.data.logId }, "Mo");
  assert.equal(uu.ok, true, JSON.stringify(uu));
  assert.equal(bookStatus(call), "Booked");
  assert.deepEqual([stored(call, "1").planner_written, stored(call, "1").status], ["yes", "Booked"]);
});

test("wave A 7: a re-tick while the put-back is really owed still writes nothing: the planner's Booked is the app's", async () => {
  const { call } = await owed();
  call.fake.planner.cellFails = false;
  later(call, 1);
  const t = await call("tickTodo", { id: "1" }, "Mo");
  assert.deepEqual(owedOf(call), ["Mo", "yes", "Not booked", "Booked"]);
  assert.equal(writes(call).length, 2, "nothing written");
  assert.equal(t.data.todo.done, true);
});

test("wave A 7: an owed put-back dropped because the planner gave its number to another item leaves one History note", async () => {
  const { call } = await owed();
  call.fake.planner.cellFails = false;
  call.fake.planner.tabs["Book Now"][3][1] = "Made-up other booking";
  await forced(call);
  assert.deepEqual(owedOf(call).slice(0, 3), ["", "", ""]);
  assert.equal(writes(call).length, 2, "nothing written");
  const notes = (await history(call)).filter((e) => e.kind === "planner" && e.summary !== OWED_NOTE);
  assert.equal(notes.length, 1);
  assert.deepEqual([notes[0].who, notes[0].canUndo], ["The planner", false]);
  assert.equal(notes[0].summary, "changed “Rail pass reservation”: the Booked the app wrote there was left as it is");
  await forced(call);
  assert.equal((await history(call)).filter((e) => e.kind === "planner" && e.summary !== OWED_NOTE).length, 1, "said once");
});

test("wave A 7: a dropped put-back whose planner row no longer says Booked adds no note", async () => {
  const { call } = await owed();
  call.fake.planner.tabs["Book Now"][3][1] = "Made-up other booking";
  call.fake.planner.tabs["Book Now"][3][4] = "Not booked";
  await forced(call);
  assert.deepEqual(owedOf(call).slice(0, 3), ["", "", ""]);
  assert.equal((await history(call)).filter((e) => e.kind === "planner" && e.summary !== OWED_NOTE).length, 0);
});

test("wave A 10: a pull's two retries go to the oldest stuck tick first, then owed put-backs (as the README says)", async () => {
  const call = linked({ book: bookNow(B1, B2, { ...B3, Status: "" }) });
  await call("syncTodos");
  const t1 = await call("tickTodo", { id: "1" });
  call.fake.planner.cellFails = true;
  later(call, 1);
  await call("undo", { logId: t1.data.logId }); // #1: put-back owed
  later(call, 1);
  await call("tickTodo", { id: "2" }); // #2: stuck tick
  later(call, 1);
  await call("tickTodo", { id: "3" }); // #3: stuck tick
  const start = cellTries(call).length;
  await forced(call);
  assert.deepEqual(cellTries(call).slice(start), ["E5", "E6"], "the two stuck ticks, oldest first");
  await forced(call);
  assert.deepEqual(cellTries(call).slice(start + 2), ["E4", "E5"], "then the put-back, and round to the start");
});

test("wave A 4: an undo whose put-back was written but whose recording throws answers written; the next pull settles it", async () => {
  const { call, logId } = await ticked();
  const real = call.fake.world.updateById_;
  call.fake.world.updateById_ = (tab, id, patch) => {
    if (tab === "Todos" && patch.planner_written === "" && patch.ticked_item === "") throw new Error("boom: recording the put-back");
    return real(tab, id, patch);
  };
  later(call, 1);
  const u = await call("undo", { logId });
  call.fake.world.updateById_ = real;
  assert.deepEqual([u.ok, u.data.planner], [true, "written"]);
  assert.equal(bookStatus(call), "Not booked");
  assert.equal(stored(call, "1").planner_written, "undo", "not recorded");
  await forced(call);
  assert.deepEqual(owedOf(call), ["", "", "", "Not booked"], "the pull finds it put back: nothing owed");
  assert.equal(writes(call).length, 4, "nothing written twice");
});

// ---------- wave A fix round ----------

// Runs `first` once, just before the next put-back is recorded (settleUntick_).
function beforeSettleUntick(call, first) {
  const real = call.fake.world.settleUntick_;
  call.fake.world.settleUntick_ = (...a) => {
    call.fake.world.settleUntick_ = real;
    first();
    return real(...a);
  };
}

test("fix C1: a re-tick that wrote Booked again before a late put-back record is not cleared by it", async () => {
  const { call, logId } = await ticked();
  later(call, 1);
  beforeSettleUntick(call, () => {
    // The put-back is in the planner; Mo ticks again before it is recorded.
    assert.equal(bookStatus(call), "Not booked");
    call.fake({ key: KEY, actor: "Mo", action: "tickTodo", args: { id: "1" } });
  });
  await call("undo", { logId }, "Ajen");
  assert.equal(bookStatus(call), "Booked", "the re-tick wrote Booked again");
  assert.deepEqual(owedOf(call), ["Mo", "yes", "Not booked", "Booked"], "still ticked, yes");
});

test("fix C1: a row ticked again (as yes) whose put-back did go through is still cleared to a stuck tick", async () => {
  const { call, logId } = await ticked();
  later(call, 1);
  beforeSettleUntick(call, () => {
    call.fake.primitives.updateById_("Todos", "1", { ticked_by: "Mo", ticked_at: call.at.now, ticked_item: "Rail pass reservation", planner_written: "yes", status: "Booked" });
  });
  await call("undo", { logId }, "Ajen");
  assert.equal(bookStatus(call), "Not booked");
  assert.deepEqual(owedOf(call), ["Mo", "", "", "Not booked"], "a stuck tick, retried by a pull");
  await forced(call);
  assert.equal(bookStatus(call), "Booked");
  assert.equal(stored(call, "1").planner_written, "yes");
});

const PAYHEAD = ["payment_id", "date_paid", "payer", "description", "category", "vendor", "booking_ref", "amount", "currency", "amount_cad", "cad_is_exact", "split_between", "split_type", "status", "include_in_split", "source", "added_by", "notes"];
const payRow = (o) => PAYHEAD.map((h) => (o[h] === undefined ? "" : o[h]));

test("fix C2: a filled-down checkbox column past the Payments header (S) changes nothing: same payments, no problems, not capped", () => {
  const rows = [PAYHEAD, payRow({ payment_id: "X7", payer: "Mo", description: "Made-up inn", amount: 24750, currency: "JPY", split_between: "Mo", split_type: "equal", include_in_split: "yes" }), payRow({ payment_id: "X8", payer: "Mo", description: "Made-up bus", amount: 3000, currency: "JPY", split_between: "Mo", split_type: "equal", include_in_split: "yes" })];
  const plain = P.paymentsFromRows(rows);
  const boxes = [rows[0].concat([""]), ...rows.slice(1).map((r) => r.concat([true]))];
  for (let i = 0; i < 350; i++) boxes.push(new Array(PAYHEAD.length).fill("").concat([false]));
  const got = P.paymentsFromRows(boxes);
  assert.deepEqual(got.payments, plain.payments);
  assert.deepEqual([got.problems, got.capped, got.missing], [[], false, null]);
});

test("fix C2: a cell past Z on the blank row under Book Now does not turn the line below into a todo", () => {
  const wide = (row) => { const r = row.slice(); while (r.length < 30) r.push(""); return r; };
  const sep = wide([]);
  sep[28] = "made-up side note";
  const rows = [BHEAD, brow(B1), sep, brow({ "#": 7, Item: "Made-up line under the table" })];
  assert.deepEqual(P.todosFromRows(rows, 2026).items.map((x) => x.id), ["1"]);
  assert.deepEqual(P.todosFromRows([BHEAD, brow(B1), [], brow({ "#": 7, Item: "Made-up line under the table" })], 2026).items.map((x) => x.id), ["1"], "the same as a truly blank row");
});

test("fix C2: the Change Log row spans only the header's columns, whatever lies further right", () => {
  const head = [...CHEAD, "", "", "made-up margin note"];
  const row = P.changeLogRow([head, [5, "x"]], { Item: "I" });
  assert.equal(row.values.length, CHEAD.length + 3, "a header cell further right is part of the header");
  const clean = P.changeLogRow([CHEAD.concat(["", ""]), [5, "x", "", "", "", "", "", "", "", "", "", "", "far right"]], { Item: "I" });
  assert.equal(clean.values.length, CHEAD.length);
});

test("fix I1: a re-tick over a hand-set Status whose record finds the lock busy never later puts back the stale status", async () => {
  const { call } = await owed(); // planner Booked, row owes "Not booked"
  call.fake.planner.cellFails = false;
  call.fake.planner.tabs["Book Now"][3][4] = "Cancelled"; // set by hand in the planner
  const n0 = call.lock.n;
  call.lock.busy = (n) => n === n0 + 2; // free for the tick's save, busy when its planner write is recorded
  later(call, 1);
  const t = await call("tickTodo", { id: "1" }, "Mo");
  call.lock.busy = () => false;
  assert.equal(t.ok, true);
  later(call, 1);
  await call("undo", { logId: t.data.logId }, "Mo");
  await forced(call);
  assert.equal(bookStatus(call), "Cancelled", "never Not booked");
  assert.equal(writes(call).filter((w) => w.kind === "cell" && w.value === "Not booked").length, 0);
});

test("fix I2 (ruling): a re-tick of an owed row writes Booked over a hand-set Status, and its undo puts that Status back", async () => {
  const { call } = await owed();
  call.fake.planner.cellFails = false;
  call.fake.planner.tabs["Book Now"][3][4] = "Cancelled";
  later(call, 1);
  const t = await call("tickTodo", { id: "1" }, "Mo");
  assert.equal(t.data.planner, "written");
  assert.equal(bookStatus(call), "Booked");
  assert.deepEqual(owedOf(call), ["Mo", "yes", "Cancelled", "Booked"]);
  later(call, 1);
  const u = await call("undo", { logId: t.data.logId }, "Mo");
  assert.equal(u.data.planner, "written");
  assert.equal(bookStatus(call), "Cancelled");
});

// ---------- wave A second fix round ----------

// Runs `between` once, inside the next app-lock taking that settleUntick_
// makes, before its own work: another request that got the lock first.
function whileSettleUntickWaits(call, between) {
  const realSettle = call.fake.world.settleUntick_;
  call.fake.world.settleUntick_ = (...a) => {
    call.fake.world.settleUntick_ = realSettle;
    const realLock = call.fake.world.withLock_;
    call.fake.world.withLock_ = (fn) => {
      call.fake.world.withLock_ = realLock;
      between();
      return realLock(fn);
    };
    return realSettle(...a);
  };
}

test("fix2 C1: a re-tick that writes Booked and records yes while the put-back's record waits for the lock is not wiped", async () => {
  const { call, logId } = await ticked();
  later(call, 1);
  whileSettleUntickWaits(call, () => {
    assert.equal(bookStatus(call), "Not booked", "the put-back is in the planner");
    call.fake({ key: KEY, actor: "Mo", action: "tickTodo", args: { id: "1" } });
    assert.equal(stored(call, "1").planner_written, "yes");
  });
  await call("undo", { logId }, "Ajen");
  assert.equal(bookStatus(call), "Booked");
  assert.deepEqual(owedOf(call), ["Mo", "yes", "Not booked", "Booked"], "still ticked, yes, was what the tick replaced");
  await forced(call);
  assert.deepEqual(owedOf(call), ["Mo", "yes", "Not booked", "Booked"]);
  assert.equal(bookStatus(call), "Booked");
});

test("fix2 C1: a plain undo still clears, and the one Book Now read under the app's lock is the record's own", async () => {
  const { call, logId } = await ticked();
  later(call, 1);
  const u = await call("undo", { logId }, "Ajen");
  assert.equal(u.data.planner, "written");
  assert.deepEqual(owedOf(call), ["", "", "", "Not booked"]);
  assert.equal(bookStatus(call), "Not booked");
});

test("fix2 C1: the record's Book Now read under the app's lock happens only for a row ticked again, once, and never with the planner lock", async () => {
  const { call, logId } = await ticked();
  later(call, 1);
  whileSettleUntickWaits(call, () => { call.fake({ key: KEY, actor: "Mo", action: "tickTodo", args: { id: "1" } }); });
  const start = call.fake.planner.calls.length;
  await call("undo", { logId }, "Ajen");
  const under = call.fake.planner.calls.slice(start).filter((c) => c.appLock);
  assert.deepEqual(under.map((c) => [c.op, c.tab, c.plannerLock]), [["read", "Book Now", false]]);
  const plain = await ticked();
  later(plain.call, 1);
  const s2 = plain.call.fake.planner.calls.length;
  await plain.call("undo", { logId: plain.logId }, "Ajen");
  assert.deepEqual(plain.call.fake.planner.calls.slice(s2).filter((c) => c.appLock), [], "a plain undo reads nothing under it");
});

// An owed row whose planner Status was set to Cancelled by hand, re-ticked by Mo
// while the app's lock is busy for the record's first `busyFor` takings.
async function reTickOverCancelled(busyFor) {
  const { call } = await owed(); // planner Booked, the row owes "Not booked"
  call.fake.planner.cellFails = false;
  call.fake.planner.tabs["Book Now"][3][4] = "Cancelled";
  const logRowsBefore = call.fake.planner.tabs["Change Log"].length;
  const n0 = call.lock.n;
  call.lock.busy = (n) => n >= n0 + 2 && n < n0 + 2 + busyFor; // free for the save
  later(call, 1);
  const t = await call("tickTodo", { id: "1" }, "Mo");
  call.lock.busy = () => false;
  return { call, t, logRowsBefore };
}

test("fix2 I1 (i): a busy record waits once more; when the lock comes, the row keeps yes with was Cancelled and undo restores Cancelled", async () => {
  const { call, t, logRowsBefore } = await reTickOverCancelled(1);
  assert.deepEqual([t.ok, t.data.planner], [true, "written"]);
  assert.equal(bookStatus(call), "Booked");
  assert.deepEqual(owedOf(call), ["Mo", "yes", "Cancelled", "Booked"]);
  assert.equal(call.fake.planner.tabs["Change Log"].length, logRowsBefore + 1, "the tick's own row, nothing taken back out");
  later(call, 1);
  await call("undo", { logId: t.data.logId }, "Mo");
  assert.equal(bookStatus(call), "Cancelled");
  assert.equal(call.fake.planner.tabs["Change Log"].length, logRowsBefore + 2, "plus the undo's: no other row");
});

test("fix2 I1 (ii): both waits busy: Booked stays, the true was is kept aside; undo before any pull restores Cancelled", async () => {
  const { call, t, logRowsBefore } = await reTickOverCancelled(2);
  assert.deepEqual([t.ok, t.data.planner], [true, "written"]);
  assert.equal(bookStatus(call), "Booked", "the write is not taken back out");
  assert.equal(stored(call, "1").planner_was, "Not booked", "the row could not be told");
  assert.equal(call.fake.props.TODO_WAS_1, "Cancelled");
  assert.equal(call.fake.planner.tabs["Change Log"].length, logRowsBefore + 1, "no extra Change Log row");
  later(call, 1);
  await call("undo", { logId: t.data.logId }, "Mo");
  assert.equal(bookStatus(call), "Cancelled");
  assert.equal("TODO_WAS_1" in call.fake.props, false, "used and gone");
  assert.equal(call.fake.planner.tabs["Change Log"].length, logRowsBefore + 2);
});

test("fix2 I1 (ii): both waits busy, then one pull copies the true was onto the row and the property is gone", async () => {
  const { call, t, logRowsBefore } = await reTickOverCancelled(2);
  await forced(call);
  assert.deepEqual(owedOf(call), ["Mo", "yes", "Cancelled", "Booked"]);
  assert.equal("TODO_WAS_1" in call.fake.props, false);
  assert.equal(bookStatus(call), "Booked");
  assert.equal(call.fake.planner.tabs["Change Log"].length, logRowsBefore + 1, "the pull writes nothing to the planner");
  later(call, 1);
  await call("undo", { logId: t.data.logId }, "Mo");
  assert.equal(bookStatus(call), "Cancelled");
});

test("fix2 I1: a kept-aside was for a row no longer ticked, or gone, is just cleared by a pull", async () => {
  const call = linked();
  await call("syncTodos");
  call.fake.props.TODO_WAS_2 = "Made-up status";
  call.fake.props.TODO_WAS_3 = "Made-up status";
  call.fake.planner.tabs["Book Now"] = bookNow(B1, B2); // #3 is gone
  await forced(call);
  assert.equal("TODO_WAS_2" in call.fake.props, false);
  assert.equal("TODO_WAS_3" in call.fake.props, false);
  assert.deepEqual(writes(call), []);
});
