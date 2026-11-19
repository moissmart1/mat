/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The real ticket on a stop, on the backend: the four facts on the stop, the
// Tickets and TicketData tabs, addTicket / ticket / removeTicket, History and
// undo, the connector, and a Sheet where migrate has not been run. Through the
// fake backend (the real Actions.js, Pure.js and Mcp.js). Every picture here
// is made up on the spot: a PNG or JPEG signature followed by zeros.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../backend/Pure.js");
const { createFakeBackend } = require("./fake-backend.cjs");
const PLAN = require("./fixtures/plan.json");

const KEY = "test-key";
const SKY = "planstop1203";
const LUNCH = "planstop1202";
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG_SIG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

// base64 of a made-up picture of about `bytes` bytes.
const png = (bytes = 300) => Buffer.concat([PNG_SIG, Buffer.alloc(Math.max(0, bytes - 8), 7)]).toString("base64");
const jpg = (bytes = 300) => Buffer.concat([JPG_SIG, Buffer.alloc(Math.max(0, bytes - 4), 9)]).toString("base64");

function trip(over = {}) {
  const fake = createFakeBackend({ ...PLAN, ...over }, { clock: () => "2026-12-01T00:00:00.000Z" });
  const call = (action, args = {}, actor = "Mo", extra = {}) => fake({ key: KEY, actor, action, args, ...extra });
  call.fake = fake;
  return call;
}
let n = 0;
const tid = () => "tkt" + String(++n).padStart(9, "0");
const pic = (over = {}) => ({ id: tid(), stop: SKY, who: "", seat: "", page: 1, mime: "image/png", w: 300, h: 300, data: png(), ...over });
const add = (call, over = {}, actor) => call("addTicket", { ticket: pic(over) }, actor);
const ticketLines = (call) => call.fake.tables.Log.filter((r) => r.kind === "ticket");

test("a stop carries the four ticket facts through updateStop, History and undo", async () => {
  const call = trip();
  const r = await call("updateStop", { id: SKY, patch: { tkRef: "REF-0001", tkName: "MO", tkPeople: "3 adults", tkSeat: "Car 7" } });
  assert.equal(r.ok, true);
  assert.deepEqual([r.data.stop.tkRef, r.data.stop.tkName, r.data.stop.tkPeople, r.data.stop.tkSeat], ["REF-0001", "MO", "3 adults", "Car 7"]);
  const load = (await call("load")).data;
  assert.equal(load.stops.find((s) => s.id === SKY).tkRef, "REF-0001");
  const h = (await call("history")).data.entries;
  assert.equal(h[0].summary, "changed Shibuya Sky: ticket");
  const u = await call("undo", { logId: h[0].id });
  assert.equal(u.ok, true);
  assert.equal(u.data.stop.tkRef, "");
  // A stop with no facts reads them as empty.
  assert.equal(load.stops.find((s) => s.id === LUNCH).tkSeat, "");
});

test("a fact over 60 letters is refused; a formula-looking one is kept as typed", async () => {
  const call = trip();
  const long = await call("updateStop", { id: SKY, patch: { tkRef: "x".repeat(61) } });
  assert.equal(long.ok, false);
  assert.equal(long.error, "bad_input");
  const f = await call("updateStop", { id: SKY, patch: { tkName: "=HYPERLINK(1)" } });
  assert.equal(f.data.stop.tkName, "=HYPERLINK(1)");
  assert.equal(call.fake.tables.Stops.find((s) => s.id === SKY).tk_name, "'=HYPERLINK(1)");
});

test("addTicket keeps the picture in chunks and the row last; load lists it without its data", async () => {
  const call = trip();
  const data = png(120000); // 160,000 base64 characters: four chunks
  const r = await add(call, { data, who: "Ajen", seat: "Car 7 · 10B", w: 690, h: 1500 });
  assert.equal(r.ok, true, r.message);
  const t = r.data.ticket;
  assert.deepEqual({ ...t, at: "", id: "" }, { id: "", stop: SKY, who: "Ajen", seat: "Car 7 · 10B", page: 1, mime: "image/png", w: 690, h: 1500, size: data.length, chunks: 4, by: "Mo", at: "" });
  assert.equal(call.fake.tables.TicketData.length, 4);
  assert.ok(call.fake.tables.TicketData.every((c) => c.ticket === t.id && c.data.length <= 45000));
  const load = (await call("load")).data;
  assert.deepEqual(load.tickets.map((x) => x.id), [t.id]);
  assert.equal("data" in load.tickets[0], false);
  assert.equal(JSON.stringify(load).length < 10000, true);
  const got = await call("ticket", { id: t.id });
  assert.equal(got.ok, true);
  assert.deepEqual(got.data, { id: t.id, mime: "image/png", data });
});

test("load reads the Tickets tab but never TicketData", async () => {
  const call = trip();
  await add(call);
  const before = call.fake.tableReads.TicketData || 0;
  await call("load");
  assert.equal(call.fake.tableReads.TicketData || 0, before);
});

test("chunks are joined by number, not as text, with 11 or more", async () => {
  const call = trip();
  const fit = jpg(337500); // exactly 450,000 characters: ten chunks
  assert.equal(fit.length, 450000);
  const r = await add(call, { data: fit, mime: "image/jpeg" });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.data.ticket.chunks, 10);
  // Twelve chunks by hand: shuffle the rows so text order (0, 1, 10, 11, 2 ...) differs from number order.
  const id = r.data.ticket.id;
  const rows = call.fake.tables.TicketData;
  const joined = fit;
  const small = joined.match(/.{1,40000}/g);
  assert.equal(small.length, 12);
  rows.length = 0;
  const order = [3, 11, 0, 10, 1, 2, 9, 4, 5, 8, 6, 7];
  for (const i of order) rows.push({ ticket: id, n: String(i), data: small[i] });
  call.fake.tables.Tickets[0].chunks = "12";
  const got = await call("ticket", { id });
  assert.equal(got.ok, true, got.message);
  assert.equal(got.data.data, joined);
  // A chunk missing is no picture, never a part of one.
  rows.splice(rows.findIndex((c) => c.n === "10"), 1);
  assert.equal((await call("ticket", { id })).ok, false);
});

test("a picture of 450,001 characters is refused, and nothing is written", async () => {
  const call = trip();
  const over = png(337500) + "A"; // 450,001 characters
  assert.equal(over.length, 450001);
  const r = await add(call, { data: over });
  assert.equal(r.ok, false);
  assert.equal(r.error, "bad_input");
  assert.match(r.message, /too big/);
  const four = png(337503); // 450,004 well-formed characters
  assert.equal((await add(call, { data: four })).ok, false);
  assert.equal(call.fake.tables.TicketData.length, 0);
  assert.equal(call.fake.tables.Tickets.length, 0);
});

test("an SVG, a JPEG whose bytes are not a JPEG, broken base64 and odd sizes are refused", async () => {
  const call = trip();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
  const bad = [
    { mime: "image/svg+xml", data: svg },
    { mime: "image/jpeg", data: svg },
    { mime: "image/jpeg", data: png() },
    { mime: "image/png", data: jpg() },
    { data: png().slice(0, -2) + "*=" },
    { data: png().slice(0, -1) },
    { w: 1501 },
    { h: 0 },
    { w: 10.5 },
    { page: 0 },
    { page: 9 },
    { who: "Nobody" },
    { seat: "s".repeat(61) },
    { stop: "nosuchstop01" },
    { id: "x" },
  ];
  for (const b of bad) {
    const r = await add(call, b);
    assert.equal(r.ok, false, JSON.stringify(Object.keys(b)) + " " + JSON.stringify(b).slice(0, 60));
  }
  assert.equal(call.fake.tables.Tickets.length, 0);
  assert.equal(call.fake.tables.TicketData.length, 0);
});

test("a picture on a removed stop is refused", async () => {
  const call = trip();
  await call("deleteStop", { id: SKY });
  const r = await add(call);
  assert.equal(r.ok, false);
  assert.equal(r.error, "not_found");
});

test("a ninth picture on one stop is refused; another stop still takes one", async () => {
  const call = trip();
  for (let i = 0; i < 8; i++) assert.equal((await add(call, { page: i + 1 })).ok, true);
  const ninth = await add(call, { page: 1 });
  assert.equal(ninth.ok, false);
  assert.match(ninth.message, /8/);
  assert.equal((await add(call, { stop: LUNCH })).ok, true);
  // A removed one makes room.
  const first = call.fake.tables.Tickets[0].id;
  await call("removeTicket", { id: first });
  assert.equal((await add(call)).ok, true);
});

test("the whole trip holds at most 120 pictures", async () => {
  const call = trip();
  const stops = PLAN.stops.map((s) => s.id);
  // 120 rows by hand (8 a stop over 15 made-up stops would need more stops).
  for (let i = 0; i < 120; i++) call.fake.tables.Tickets.push({ id: "hand" + String(i).padStart(6, "0"), stop: "elsewhere" + (i % 20), who: "", seat: "", page: "1", mime: "image/png", w: "1", h: "1", size: "4", chunks: "1", by: "Mo", at: "2026-12-01T00:00:00.000Z", gone: "" });
  const r = await add(call, { stop: stops[0] });
  assert.equal(r.ok, false);
  assert.match(r.message, /120/);
});

test("the same add sent twice is one picture and one History line; the second answers the first", async () => {
  const call = trip();
  const t = pic();
  const a = await call("addTicket", { ticket: t });
  const b = await call("addTicket", { ticket: t });
  assert.equal(a.ok && b.ok, true);
  assert.deepEqual(b.data.ticket, a.data.ticket);
  assert.equal(b.data.logId, a.data.logId);
  assert.equal(call.fake.tables.Tickets.length, 1);
  assert.equal(call.fake.tables.TicketData.length, 1);
  assert.equal(ticketLines(call).length, 1);
});

test("a failure between the chunks and the row leaves no ticket, and the next add sweeps the orphan chunks", async () => {
  const call = trip();
  const real = call.fake.world.appendObj_;
  call.fake.world.appendObj_ = (tab, obj) => {
    if (tab === "Tickets") throw new Error("boom");
    return real(tab, obj);
  };
  const t = pic({ data: png(80000) });
  const r = await call("addTicket", { ticket: t });
  assert.equal(r.ok, false);
  assert.equal(call.fake.tables.Tickets.length, 0);
  assert.ok(call.fake.tables.TicketData.length > 0); // orphans, not shown anywhere
  assert.deepEqual((await call("load")).data.tickets, []);
  assert.equal((await call("ticket", { id: t.id })).ok, false);
  call.fake.world.appendObj_ = real;
  // The same add again (the phone resends it): one ticket, exactly its own chunks.
  const again = await call("addTicket", { ticket: t });
  assert.equal(again.ok, true, again.message);
  assert.equal(call.fake.tables.TicketData.length, again.data.ticket.chunks);
  assert.equal((await call("ticket", { id: t.id })).data.data, t.data);
  // Another failed add's orphans are swept by an unrelated add.
  call.fake.world.appendObj_ = (tab, obj) => {
    if (tab === "Tickets") throw new Error("boom");
    return real(tab, obj);
  };
  await add(call, { data: png(80000) });
  call.fake.world.appendObj_ = real;
  const other = await add(call, { stop: LUNCH });
  assert.equal(other.ok, true);
  const ids = new Set(call.fake.tables.Tickets.map((x) => x.id));
  assert.ok(call.fake.tables.TicketData.every((c) => ids.has(c.ticket)));
});

test("removeTicket hides it; undo brings it back; undoing the undo hides it again", async () => {
  const call = trip();
  const t = (await add(call, { who: "Trenton" })).data.ticket;
  const rm = await call("removeTicket", { id: t.id }, "Ajen");
  assert.equal(rm.ok, true);
  assert.equal(rm.data.ticket.gone, true);
  assert.deepEqual((await call("load")).data.tickets, []);
  assert.equal((await call("ticket", { id: t.id })).ok, false);
  let h = (await call("history")).data.entries;
  assert.deepEqual(h.slice(0, 2).map((e) => e.who + " " + e.summary), ["Ajen removed Trenton’s ticket from Shibuya Sky", "Mo added Trenton’s ticket to Shibuya Sky"]);
  const u = await call("undo", { logId: h[0].id });
  assert.equal(u.ok, true, u.message);
  assert.equal(u.data.ticket.gone, undefined);
  assert.equal(u.data.entry.kind, "ticket");
  assert.deepEqual((await call("load")).data.tickets.map((x) => x.id), [t.id]);
  assert.equal((await call("ticket", { id: t.id })).data.data.length > 0, true);
  h = (await call("history")).data.entries;
  const redo = await call("undo", { logId: h[0].id });
  assert.equal(redo.ok, true, redo.message);
  assert.deepEqual((await call("load")).data.tickets, []);
  // An older entry for it can no longer be undone.
  h = (await call("history")).data.entries;
  assert.equal(h.find((e) => e.action === "add").canUndo, false);
});

test("undoing an add removes the picture; its data rows stay", async () => {
  const call = trip();
  const t = (await add(call)).data.ticket;
  const u = await call("undo", { logId: (await call("history")).data.entries[0].id });
  assert.equal(u.ok, true);
  assert.deepEqual((await call("load")).data.tickets, []);
  assert.equal(call.fake.tables.TicketData.length, t.chunks);
});

test("removing twice changes nothing the second time; an unknown id is refused", async () => {
  const call = trip();
  const t = (await add(call)).data.ticket;
  await call("removeTicket", { id: t.id });
  const again = await call("removeTicket", { id: t.id });
  assert.equal(again.ok, true);
  assert.equal(again.data.logId, null);
  assert.equal((await call("removeTicket", { id: "nosuchticket" })).error, "not_found");
  assert.equal((await call("ticket", { id: "nosuchticket" })).error, "not_found");
});

test("ticket is a read: no lock, no Log line, rev unchanged", async () => {
  const call = trip();
  const t = (await add(call)).data.ticket;
  const rev = (await call("rev")).rev;
  const lines = call.fake.tables.Log.length;
  const r = await call("ticket", { id: t.id });
  assert.equal(r.rev, rev);
  assert.equal(call.fake.tables.Log.length, lines);
});

test("an un-migrated Sheet: load has no tickets, the stop has empty facts, and the ticket actions say migrate", async () => {
  const call = trip({ missingTabs: ["Tickets", "TicketData"], missingColumns: ["Stops.tk_ref", "Stops.tk_name", "Stops.tk_people", "Stops.tk_seat"] });
  const load = (await call("load")).data;
  assert.equal("tickets" in load, false);
  assert.equal(load.stops.find((s) => s.id === SKY).tkRef, "");
  for (const [action, args] of [["addTicket", { ticket: pic() }], ["removeTicket", { id: "abcdefgh1" }], ["ticket", { id: "abcdefgh1" }]]) {
    const r = await call(action, args);
    assert.equal(r.error, "needs_migrate", action);
  }
  // A stop edit without facts works as before; one with facts says migrate.
  assert.equal((await call("updateStop", { id: SKY, patch: { note: "x" } })).ok, true);
  assert.equal((await call("updateStop", { id: SKY, patch: { tkRef: "R1" } })).error, "needs_migrate");
  const m = await call("migrate");
  assert.deepEqual(m.data.added.filter((a) => /^Stops\.tk_|^Tickets\.|^TicketData\./.test(a)), [
    "Stops.tk_ref", "Stops.tk_name", "Stops.tk_people", "Stops.tk_seat",
    "Tickets.id", "Tickets.stop", "Tickets.who", "Tickets.seat", "Tickets.page", "Tickets.mime", "Tickets.w", "Tickets.h", "Tickets.size", "Tickets.chunks", "Tickets.by", "Tickets.at", "Tickets.gone", "Tickets.planner_id",
    "TicketData.ticket", "TicketData.n", "TicketData.data",
  ]);
  assert.deepEqual((await call("migrate")).data.added, []);
  assert.deepEqual((await call("load")).data.tickets, []);
  assert.equal((await add(call)).ok, true);
});

test("the Claude connector reads the facts with the stop but no pictures, and cannot add, remove or undo one", async () => {
  const call = trip();
  await call("updateStop", { id: SKY, patch: { tkRef: "REF-0002" } });
  const t = (await add(call)).data.ticket;
  // The connector's own path (security, 2026-11-18): a phone's via is ignored.
  const claude = call.fake.claude;
  assert.equal((await claude("addTicket", { ticket: pic() })).ok, false);
  assert.equal((await claude("removeTicket", { id: t.id })).ok, false);
  assert.equal((await claude("ticket", { id: t.id })).ok, false);
  const h = (await call("history")).data.entries;
  assert.equal((await claude("undo", { logId: h[0].id })).ok, false);
  assert.equal(call.fake.tables.Tickets.length, 1);
  assert.equal(call.fake.tables.Tickets[0].gone, "");
  const params = { t: "claude-token", as: "Mo" };
  const list = call.fake.mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, params);
  const getTrip = list.result.tools.find((x) => x.name === "get_trip");
  assert.match(getTrip.description, /ticket/i);
  assert.match(getTrip.description, /pictures/);
  const res = call.fake.mcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_trip", arguments: {} } }, params);
  const body = JSON.parse(res.result.content[0].text);
  assert.equal(body.stops.find((s) => s.id === SKY).tkRef, "REF-0002");
  assert.equal("tickets" in body, false);
  assert.equal(JSON.stringify(body).includes(t.id), false);
});

test("pure: the limits, the base64 check and the summaries", () => {
  assert.equal(P.TICKET_LIMITS.maxChars, 450000);
  assert.equal(P.TICKET_LIMITS.maxSide, 1500);
  assert.equal(P.TICKET_LIMITS.perStop, 8);
  assert.equal(P.TICKET_LIMITS.perTrip, 120);
  assert.equal(P.TICKET_LIMITS.chunk, 45000);
  assert.equal(P.TICKET_LIMITS.fact, 60);
  assert.equal(P.validateTicket({ ...pic(), data: png() }, ["Mo"]).ok, true);
  assert.equal(P.validateTicket({ ...pic(), mime: "image/jpeg", data: jpg() }, ["Mo"]).ok, true);
  assert.equal(P.validateTicket({ ...pic(), data: "" }, ["Mo"]).ok, false);
  assert.equal(P.summarize("add", "ticket", null, { who: "", stopTitle: "Dinner" }), "added a ticket to Dinner");
  assert.equal(P.summarize("remove", "ticket", { who: "" }, { who: "", stopTitle: "Dinner", gone: true }), "removed a ticket from Dinner");
});

// ---------- the real Sheets.js helpers, over a small pretend Spreadsheet ----------

test("Sheets.js: appendObjs_ writes one block, columnValues_ and cellsAt_ read it back, deleteRowsAt_ takes runs out; migrate adds the tabs once", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const sheets = new Map();
  const calls = { setValues: 0, deleteRows: [] };
  const make = (name, grid) => {
    const sh = { grid, maxRows: 3, maxCols: 26 };
    sh.getLastRow = () => grid.length;
    sh.getLastColumn = () => grid.reduce((n, r) => Math.max(n, r.length), 0);
    sh.getMaxRows = () => sh.maxRows;
    sh.getMaxColumns = () => sh.maxCols;
    sh.insertRowsAfter = (_r, n) => { sh.maxRows += n; };
    sh.insertColumnsAfter = (_c, n) => { sh.maxCols += n; };
    sh.setFrozenRows = () => {};
    sh.deleteRows = (at, n) => { calls.deleteRows.push([at, n]); grid.splice(at - 1, n); };
    sh.getRange = (r, c, nr = 1, nc = 1) => {
      if (r + nr - 1 > sh.maxRows) throw new Error("past the last row");
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (grid[r - 1 + i] && grid[r - 1 + i][c - 1 + j] !== undefined ? grid[r - 1 + i][c - 1 + j] : ""))),
        setValues(rows) {
          calls.setValues++;
          rows.forEach((row, i) => { while (grid.length < r + i) grid.push([]); row.forEach((v, j) => { grid[r - 1 + i][c - 1 + j] = v; }); });
          return this;
        },
        setNumberFormats() { return this; },
        setNumberFormat() { return this; },
        setValue(v) { while (grid.length < r) grid.push([]); grid[r - 1][c - 1] = v; return this; },
        setFontWeight() { return this; },
      };
    };
    sheets.set(name, sh);
    return sh;
  };
  const old = {};
  for (const [tab, headers] of Object.entries(P.TABS)) if (!/^Ticket/.test(tab)) old[tab] = [tab === "Stops" ? headers.filter((h) => !/^tk_/.test(h)) : headers.slice()];
  for (const [name, grid] of Object.entries(old)) make(name, grid);
  const ss = { getSheetByName: (n) => sheets.get(n) || null, insertSheet: (n) => make(n, []) };
  const ctx = vm.createContext({ SpreadsheetApp: { getActiveSpreadsheet: () => ss } });
  for (const f of ["Pure.js", "Sheets.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "backend", f), "utf8"), ctx, { filename: f });
  const added = Array.from(ctx.ensureColumns_());
  assert.deepEqual(added, [...["tk_ref", "tk_name", "tk_people", "tk_seat"].map((h) => "Stops." + h), ...P.TABS.Tickets.map((h) => "Tickets." + h), ...P.TABS.TicketData.map((h) => "TicketData." + h)]);
  assert.deepEqual(Array.from(ctx.ensureColumns_()), []);
  assert.deepEqual(sheets.get("TicketData").grid[0], ["ticket", "n", "data"]);

  const rows = [0, 1, 2, 3, 4].map((i) => ({ ticket: i < 3 ? "aaaaaaaa" : "bbbbbbbb", n: String(i < 3 ? i : i - 3), data: i === 1 ? "+abc" : "d" + i }));
  ctx.appendObjs_("TicketData", rows);
  assert.equal(calls.setValues, 1, "one block");
  assert.deepEqual(Array.from(ctx.columnValues_("TicketData", "ticket")), ["aaaaaaaa", "aaaaaaaa", "aaaaaaaa", "bbbbbbbb", "bbbbbbbb"]);
  // A chunk starting + is kept escaped in the cell and read back as it was.
  assert.equal(sheets.get("TicketData").grid[2][2], "'+abc");
  assert.deepEqual(Array.from(ctx.cellsAt_("TicketData", "data", [2, 3, 4])), ["d0", "+abc", "d2"]);
  ctx.deleteRowsAt_("TicketData", [2, 3, 4, 6]);
  assert.deepEqual(calls.deleteRows, [[6, 1], [2, 3]]);
  assert.deepEqual(Array.from(ctx.columnValues_("TicketData", "ticket")), ["bbbbbbbb"]);
});

// ---------- who is calling (security, 2026-11-18) ----------

test("under a personal key the picture is the key's person's, whatever actor the phone sends", async () => {
  const call = trip();
  const key = call.fake.personKey("Ajen");
  const r = await call.fake({ key, actor: "Mo", action: "addTicket", args: { ticket: pic() } });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.data.ticket.by, "Ajen");
  const rm = await call.fake({ key, actor: "Trenton", action: "removeTicket", args: { id: r.data.ticket.id } });
  assert.equal(rm.ok, true);
  const h = (await call.fake({ key, action: "history", args: {} })).data.entries;
  assert.deepEqual(h.slice(0, 2).map((e) => e.who), ["Ajen", "Ajen"]);
  const u = await call.fake({ key, actor: "Mo", action: "undo", args: { logId: h[0].id } });
  assert.equal(u.ok, true);
  assert.equal(call.fake.tables.Log[call.fake.tables.Log.length - 1].who, "Ajen");
});

test("the check key may not add, remove, undo or read a picture; its load has no booking ref or name", async () => {
  const call = trip();
  await call("updateStop", { id: SKY, patch: { tkRef: "REF-0009", tkName: "MO", tkPeople: "3", tkSeat: "Car 7" } });
  const t = (await add(call)).data.ticket;
  const check = (action, args) => call.fake({ key: call.fake.CHECK_KEY, action, args });
  for (const [action, args] of [["addTicket", { ticket: pic() }], ["removeTicket", { id: t.id }], ["ticket", { id: t.id }], ["undo", { logId: 1 }]]) {
    const r = await check(action, args);
    assert.equal(r.ok, false, action);
    assert.equal(r.error, "bad_input", action);
  }
  assert.equal(call.fake.tables.Tickets.length, 1);
  assert.equal(call.fake.tables.Tickets[0].gone, "");
  const sky = (await check("load", {})).data.stops.find((s) => s.id === SKY);
  assert.deepEqual([sky.tkRef, sky.tkName, sky.tkPeople, sky.tkSeat], ["", "", "3", "Car 7"]);
  // A person's load has them.
  const mine = (await call.fake({ key: call.fake.personKey("Mo"), action: "load", args: {} })).data.stops.find((s) => s.id === SKY);
  assert.deepEqual([mine.tkRef, mine.tkName], ["REF-0009", "MO"]);
});

test("under the shared key the ticket actions work as before (until it is retired)", async () => {
  const call = trip();
  const r = await call("addTicket", { ticket: pic() }, "Trenton");
  assert.equal(r.ok, true);
  assert.equal(r.data.ticket.by, "Trenton");
  assert.equal((await call("ticket", { id: r.data.ticket.id })).ok, true);
});

// ---------- fix round 1 ----------

test("I5: a resend without the picture's data answers the first add (and its log id); one that never landed says so", async () => {
  const call = trip();
  const t = pic();
  const first = await call("addTicket", { ticket: t });
  const meta = { ...t };
  delete meta.data;
  const again = await call("addTicket", { ticket: meta });
  assert.equal(again.ok, true, again.message);
  assert.equal(again.data.logId, first.data.logId);
  assert.deepEqual(again.data.ticket, first.data.ticket);
  const never = await call("addTicket", { ticket: { ...meta, id: tid() } });
  assert.equal(never.ok, false);
  assert.equal(never.error, "not_found");
  assert.equal(call.fake.tables.Tickets.length, 1);
  // A bad id is still refused before anything is looked up.
  assert.equal((await call("addTicket", { ticket: { ...meta, id: "x" } })).error, "bad_input");
});

test("minor 6: pictures on a removed stop are left out of load and do not count toward the limits; putting the stop back brings them back", async () => {
  const call = trip();
  for (let i = 0; i < 8; i++) assert.equal((await add(call, { stop: LUNCH, page: i + 1 })).ok, true);
  await call("deleteStop", { id: LUNCH });
  assert.deepEqual((await call("load")).data.tickets, []);
  // The trip's 120: 112 more by hand on a live stop, then one more through the app still fits.
  for (let i = 0; i < 111; i++) call.fake.tables.Tickets.push({ id: "hand" + String(i).padStart(6, "0"), stop: SKY + "x" + (i % 20), who: "", seat: "", page: "1", mime: "image/png", w: "1", h: "1", size: "4", chunks: "1", by: "Mo", at: "2026-12-01T00:00:00.000Z", gone: "" });
  assert.equal((await add(call)).ok, true, "the removed stop's 8 do not count");
  await call("restoreStop", { id: LUNCH });
  assert.equal((await call("load")).data.tickets.filter((t) => t.stop === LUNCH).length, 8);
});
