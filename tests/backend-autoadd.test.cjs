/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Tickets from the planner's list (auto-add), on the backend: listTickets and
// listTicketFile (the owner's own key only; the planner read here, the files
// through the newsletter desk, a stand-in in tests/fake-backend.cjs), the
// planner_id tie in addTicket (one live picture per line, page and person),
// and load's ticketList. Every id, key, name and reference here is made up.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../backend/Pure.js");
const { createFakeBackend, CHECK_KEY } = require("./fake-backend.cjs");
const PLAN = require("./fixtures/plan.json");

const SKY = "planstop1203";
const LUNCH = "planstop1202";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(292, 7)]).toString("base64");
const HEAD = ["ticket_id", "booking_key", "start_date", "start_time", "type", "title", "provider", "confirmation", "traveler", "ticket_ref", "seat", "holder", "file_url", "notes", "manage_url", "status"];
const line = (o) => HEAD.map((h) => (o[h] === undefined ? "" : o[h]));
const LIST = [
  HEAD,
  line({ ticket_id: "T001", start_date: "2026-12-12", start_time: "14:00", type: "activity", title: "Sky deck", confirmation: "QZ48810", traveler: "ALL", holder: "A PERSON", file_url: "https://drive.google.com/file/d/driveid-invented-000000000001/view", notes: "private note", manage_url: "https://booking.example.test/manage/1", status: "active" }),
  line({ ticket_id: "T002", start_date: "Sat, Dec 12, 2026", start_time: 0.375, title: "Garden", traveler: "Ajen", status: "active" }),
  line({ ticket_id: "T003", start_date: "12/13/2026", start_time: "7:05 PM", title: "Boat", status: "cancelled" }),
  line({ ticket_id: "T002", start_date: "2026-12-14", title: "A second T002" }),
  line({ ticket_id: "", start_date: "2026-12-14", title: "No id" }),
];
const H1 = "a".repeat(32);
const H2 = "b".repeat(32);
const DESK_FILES = [
  { h: H1, name: "T001 Sky.png", mime: "image/png", size: 300, print: "0123456789ab", at: "2026-11-18T10:00:00.000Z" },
  { h: H2, name: "T002 Garden.pdf", mime: "application/pdf", size: 9000, print: "ba9876543210", at: "2026-11-18T10:00:00.000Z" },
];

let nowMs = Date.parse("2026-12-01T00:00:00.000Z");
function trip(over = {}) {
  const fake = createFakeBackend({ ...PLAN, plannerId: "planner-invented-id-000000000000", plannerTabs: { Tickets: LIST }, desk: true, ...over }, { clock: () => new Date(nowMs).toISOString() });
  fake.desk.answer = (body) => (body.action === "tickets" ? { ok: true, files: DESK_FILES, skipped: 0, list: true } : { ok: true, h: body.h, name: "T001 Sky.png", mime: "image/png", data: PNG });
  const keys = { Mo: fake.personKey("Mo"), Ajen: fake.personKey("Ajen") };
  const as = (who, action, args = {}) => fake({ key: who === "shared" ? "test-key" : who === "check" ? CHECK_KEY : keys[who], actor: "Mo", action, args });
  return { fake, as, keys };
}
const secretsIn = (fake, text) => [fake.props.TICKET_DESK_KEY, fake.props.TICKET_DESK_URL, fake.props.PLANNER_ID, "driveid-invented"].filter((s) => text.includes(s));

test("listTickets: the owner on his own key gets the list's lines and the desk's files; nobody else does", async () => {
  const { fake, as } = trip();
  const r = await as("Mo", "listTickets");
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(r.data.files, DESK_FILES);
  assert.equal(r.data.stored, false);
  assert.equal(r.data.at, new Date(nowMs).toISOString());
  // The desk was asked once, its key in the body.
  assert.deepEqual(fake.desk.calls.map((c) => c.action), ["tickets"]);
  assert.equal(fake.desk.calls[0].k, fake.props.TICKET_DESK_KEY);
  for (const who of ["Ajen", "shared"]) {
    const no = await as(who, "listTickets");
    assert.equal(no.ok, false, who);
    assert.equal(no.error, "bad_input");
    assert.equal(no.message, "Only Mo can bring in tickets from the list.");
    assert.equal((await as(who, "listTicketFile", { handle: H1 })).message, "Only Mo can bring in tickets from the list.");
  }
  assert.equal((await as("check", "listTickets")).message, "This key can only read the trip.");
  assert.equal((await fake.claude("listTickets")).error, "bad_input");
  assert.equal((await fake.claude("listTicketFile", { handle: H1 })).error, "bad_input");
  assert.equal(fake.desk.calls.length, 1, "no one else reached the desk");
});

test("listTickets: lines in the list's own shape, dates and times made plain, only the columns the phone matches with", async () => {
  const { as } = trip();
  const rows = (await as("Mo", "listTickets")).data.rows;
  assert.deepEqual(rows.map((r) => [r.ticket_id, r.start_date, r.start_time, r.status]), [
    ["T001", "2026-12-12", "14:00", "active"],
    ["T002", "2026-12-12", "09:00", "active"],
    ["T003", "2026-12-13", "19:05", "cancelled"],
  ], "a second T002 and a line with no id are left out");
  assert.deepEqual(Object.keys(rows[0]).sort(), P.LIST_COLS_.slice().sort());
  assert.equal(rows[0].traveler, "ALL");
  assert.equal(rows[0].confirmation, "QZ48810");
  const text = JSON.stringify(rows);
  for (const never of ["drive.google.com", "private note", "booking.example.test", "booking_key"]) assert.equal(text.includes(never), false, never);
});

test("listTickets: the desk is asked at most once in 10 minutes unless forced, never twice in 30 seconds; the planner is read each time", async () => {
  const { fake, as } = trip();
  nowMs = Date.parse("2026-12-01T00:00:00.000Z");
  await as("Mo", "listTickets");
  const reads = () => fake.planner.calls.filter((c) => c.tab === "Tickets").length;
  nowMs += 5 * 60 * 1000;
  const again = await as("Mo", "listTickets");
  assert.equal(again.data.stored, true);
  assert.deepEqual(again.data.files, DESK_FILES);
  assert.equal(fake.desk.calls.length, 1);
  assert.equal(reads(), 2, "the planner is read afresh");
  const forced = await as("Mo", "listTickets", { force: true });
  assert.equal(forced.data.stored, false);
  assert.equal(fake.desk.calls.length, 2);
  nowMs += 10 * 1000;
  assert.equal((await as("Mo", "listTickets", { force: true })).data.stored, true, "a forced look within 30 seconds");
  assert.equal(fake.desk.calls.length, 2);
  nowMs += 11 * 60 * 1000;
  assert.equal((await as("Mo", "listTickets")).data.stored, false);
  assert.equal(fake.desk.calls.length, 3);
  // The cache emptied (Google may drop it at any time): the desk is asked.
  for (const k of Object.keys(fake.cache)) delete fake.cache[k];
  nowMs += 60 * 1000;
  assert.equal((await as("Mo", "listTickets")).data.stored, false);
  assert.equal(fake.desk.calls.length, 4);
  assert.equal((await as("Mo", "listTickets", { force: "yes" })).error, "bad_input");
});

test("listTickets: each thing missing is said, with nothing private in the reply", async () => {
  const cases = [
    [{ plannerId: undefined }, "no_planner"],
    [{ missingColumns: ["Tickets.planner_id"] }, "needs_migrate"],
    [{ desk: false }, "no_desk"],
    [{ plannerTabs: {} }, "planner_columns"],
    [{ plannerTabs: { Tickets: [["id", "start_date"], ["T1", "2026-12-12"]] } }, "planner_columns"],
  ];
  for (const [over, code] of cases) {
    const { fake, as } = trip(over);
    const r = await as("Mo", "listTickets");
    assert.equal(r.error, code, JSON.stringify(over));
    assert.deepEqual(secretsIn(fake, JSON.stringify(r)), []);
  }
  const unread = trip();
  unread.fake.planner.fails = true;
  const r = await unread.as("Mo", "listTickets");
  assert.equal(r.error, "planner_unreadable");
  assert.deepEqual(secretsIn(unread.fake, JSON.stringify(r)), [], "the planner's error text, which names its id, is not passed on");
  for (const answer of [() => null, () => { throw new Error("desk down " + "x"); }, () => ({ ok: false }), () => ({ ok: false, why: "failed" }), () => ({ ok: true, files: "nope" })]) {
    const t = trip();
    t.fake.desk.answer = answer;
    assert.equal((await t.as("Mo", "listTickets")).error, "desk_unreachable");
    assert.equal(t.fake.props.LIST_TICKETS_AT, undefined, "a failed look is not a look");
  }
  const noFolder = trip();
  noFolder.fake.desk.answer = () => ({ ok: false, why: "no folder" });
  assert.equal((await noFolder.as("Mo", "listTickets")).error, "no_desk");
});

test("listTickets: the desk's files are checked; anything not in shape is dropped", async () => {
  const { fake, as } = trip();
  fake.desk.answer = () => ({ ok: true, files: [
    DESK_FILES[0],
    { ...DESK_FILES[1], h: "driveid-invented-000000000002" },
    { ...DESK_FILES[1], mime: "image/svg+xml" },
    { ...DESK_FILES[1], print: "zz" },
    { ...DESK_FILES[1], name: 42 },
    "nope",
    { ...DESK_FILES[1], name: "T002\nGarden.pdf", size: -3, id: "driveid-invented-000000000002" },
  ] });
  const files = (await as("Mo", "listTickets")).data.files;
  assert.deepEqual(files, [DESK_FILES[0], { ...DESK_FILES[1], name: "T002 Garden.pdf", size: 0 }]);
});

test("listTicketFile: one file's bytes through the desk; too big, gone, a bad handle or a bad answer each said", async () => {
  const { fake, as } = trip();
  const r = await as("Mo", "listTicketFile", { handle: H1 });
  assert.deepEqual(r.data, { handle: H1, name: "T001 Sky.png", mime: "image/png", data: PNG });
  assert.deepEqual(fake.desk.calls[0], { action: "ticketFile", h: H1, k: fake.props.TICKET_DESK_KEY });
  for (const handle of [undefined, "", "A".repeat(32), "a".repeat(31), 7, "driveid-invented-000000000001"]) {
    assert.equal((await as("Mo", "listTicketFile", { handle })).error, "bad_input", String(handle));
  }
  assert.equal(fake.desk.calls.length, 1, "a bad handle never reaches the desk");
  for (const [answer, code] of [
    [{ ok: false, why: "too big" }, "too_big"],
    [{ ok: false, why: "not found" }, "not_found"],
    [{ ok: false, why: "failed" }, "desk_unreachable"],
    [null, "desk_unreachable"],
    [{ ok: true, h: H2, name: "x", mime: "image/png", data: PNG }, "desk_unreachable"],
    [{ ok: true, h: H1, name: "x", mime: "image/svg+xml", data: PNG }, "desk_unreachable"],
    [{ ok: true, h: H1, name: "x", mime: "image/png", data: "not base64!" }, "desk_unreachable"],
    [{ ok: true, h: H1, name: "x", mime: "image/png", data: "A".repeat(5333340) }, "desk_unreachable"],
  ]) {
    fake.desk.answer = () => answer;
    const no = await as("Mo", "listTicketFile", { handle: H1 });
    assert.equal(no.error, code, JSON.stringify(answer).slice(0, 80));
    assert.deepEqual(secretsIn(fake, JSON.stringify(no)), []);
  }
});

const pic = (over = {}) => ({ id: "tkt" + Math.random().toString(36).slice(2, 11).padEnd(9, "0"), stop: SKY, who: "", seat: "", page: 1, mime: "image/png", w: 300, h: 300, data: PNG, ...over });

test("addTicket from the list: the tie is kept; a second live picture of the same line, page and person is refused under the lock", async () => {
  const { fake, as } = trip();
  const first = await as("Mo", "addTicket", { ticket: pic({ from: "T001:0123456789ab" }) });
  assert.equal(first.ok, true, first.message);
  assert.equal(first.data.ticket.from, "T001:0123456789ab");
  assert.equal(fake.tables.Tickets[0].planner_id, "T001:0123456789ab");
  const load = (await as("Mo", "load")).data;
  assert.equal(load.tickets[0].from, "T001:0123456789ab");
  // Another phone (another id), the same line, page and person: already there.
  const twice = await as("Mo", "addTicket", { ticket: pic({ from: "T001:0123456789ab" }) });
  assert.equal(twice.ok, false);
  assert.equal(twice.message, "That ticket from the list is already on this stop.");
  assert.equal(fake.tables.Tickets.length, 1);
  assert.equal(fake.tables.TicketData.length, 1, "nothing of it was written");
  // A resend of the first (the same id) still answers the first.
  const resend = await as("Mo", "addTicket", { ticket: { ...pic({ from: "T001:0123456789ab" }), id: first.data.ticket.id } });
  assert.equal(resend.ok, true);
  assert.equal(resend.data.ticket.id, first.data.ticket.id);
  // Page 2, another person, another line, another stop: each is a new picture.
  for (const over of [{ page: 2 }, { who: "Ajen" }, { from: "T001:ffffffffffff" }, { stop: LUNCH, from: "T009:0123456789ab" }]) {
    const r = await as("Mo", "addTicket", { ticket: pic({ from: "T001:0123456789ab", ...over }) });
    assert.equal(r.ok, true, JSON.stringify(over) + " " + r.message);
  }
  // Once the first is removed, the line may go in again.
  assert.equal((await as("Mo", "removeTicket", { id: first.data.ticket.id })).ok, true);
  assert.equal((await as("Mo", "addTicket", { ticket: pic({ from: "T001:0123456789ab" }) })).ok, true);
  // A picture added by hand has no tie and is never refused as a twin.
  assert.equal((await as("Mo", "addTicket", { ticket: pic() })).ok, true);
  assert.equal((await as("Mo", "addTicket", { ticket: pic() })).ok, true);
  assert.equal("from" in (await as("Mo", "load")).data.tickets.slice(-1)[0], false);
});

test("addTicket from the list: a bad tie is refused; a Sheet without the planner_id column says migrate for a tie only", async () => {
  const { as } = trip();
  for (const from of ["T001;x", "T001 x", "x".repeat(41), 42, ["T001"], "T001:<b>"]) {
    const r = await as("Mo", "addTicket", { ticket: pic({ from }) });
    assert.equal(r.error, "bad_input", String(from));
  }
  const old = trip({ missingColumns: ["Tickets.planner_id"] });
  assert.equal((await old.as("Mo", "addTicket", { ticket: pic({ from: "T001:0123456789ab" }) })).error, "needs_migrate");
  assert.equal((await old.as("Mo", "addTicket", { ticket: pic() })).ok, true, "a picture added by hand works as before");
  assert.equal("from" in (await old.as("Mo", "load")).data.tickets[0], false);
});

test("load: ticketList only for the owner's own key, once the planner, the desk and the column are there", async () => {
  const { as } = trip();
  assert.equal((await as("Mo", "load")).data.ticketList, true);
  for (const who of ["Ajen", "shared", "check"]) assert.equal("ticketList" in (await as(who, "load")).data, false, who);
  for (const over of [{ desk: false }, { plannerId: undefined }, { missingColumns: ["Tickets.planner_id"] }, { missingTabs: ["Tickets", "TicketData"] }]) {
    assert.equal("ticketList" in (await trip(over).as("Mo", "load")).data, false, JSON.stringify(over));
  }
});

test("nothing of the desk (its address, its key) or the planner's id reaches a reply or the executions log", async () => {
  const { fake, as } = trip();
  const replies = [];
  replies.push(await as("Mo", "listTickets"), await as("Mo", "listTicketFile", { handle: H1 }), await as("Mo", "load"), await as("Ajen", "listTickets"));
  // An error inside the action: the reply is the plain sentence, the log has the secrets blanked.
  const real = fake.world.listRowsFrom;
  fake.world.listRowsFrom = () => { throw new Error("boom " + fake.props.TICKET_DESK_KEY + " " + fake.props.TICKET_DESK_URL); };
  const boom = await as("Mo", "listTickets", { force: true });
  fake.world.listRowsFrom = real;
  assert.equal(boom.error, "server");
  replies.push(boom);
  assert.deepEqual(secretsIn(fake, JSON.stringify(replies)), []);
  assert.ok(fake.consoleLines.some((l) => l.includes("boom")), "the error was logged");
  assert.deepEqual(secretsIn(fake, fake.consoleLines.join("\n")), []);
  assert.deepEqual(secretsIn(fake, JSON.stringify(fake.tables.Log)), [], "History has none of it");
});

test("pure: listDay and listTime read the planner's dates and times", () => {
  for (const [v, want] of [["2026-12-12", "2026-12-12"], ["2026/12/1", "2026-12-01"], ["12/11/2026", "2026-12-11"], ["13/12/2026", "2026-12-13"], ["Fri, Dec 11, 2026", "2026-12-11"], ["Friday, December 11, 2026", "2026-12-11"], ["Dec 11", "2026-12-11"], ["11 Dec 2026", "2026-12-11"], [46367, "2026-12-11"], ["2026-02-30", ""], ["13/13/2026", ""], ["soon", ""], ["", ""], [null, ""]]) {
    assert.equal(P.listDay(v, 2026), want, String(v));
  }
  for (const [v, want] of [["09:30", "09:30"], ["9:30", "09:30"], ["9:30:00", "09:30"], ["9:30 AM", "09:30"], ["12:15 am", "00:15"], ["12:15 PM", "12:15"], ["7:05:00 p.m.", "19:05"], [0.5, "12:00"], [46367.75, "18:00"], ["25:00", ""], ["13:00 PM", ""], ["noon", ""], ["", ""], [-1, ""]]) {
    assert.equal(P.listTime(v), want, String(v));
  }
});
