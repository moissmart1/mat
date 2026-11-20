// Tickets from the planner's list by themselves (auto-add, js/autoadd.js and
// the list mode of js/views/bulkadd.js): the owner's phone looks at the list
// and the ticket folder (listTickets), shows "N new tickets from the list" in
// You, fetches only what needs something after he opens it (listTicketFile,
// one at a time) and adds through the same addTicket path, each picture with
// its tie, after 入鋏. Everything is made up: the list's lines, the files
// (tests/e2e/pictures.cjs), the desk (a stand-in answering in Node), the
// people are the test trip's own. 13:20 on Dec 12.

const assert = require("node:assert/strict");
const { SEED, PLAN, makeBackend, open, ownKey, until, text, expectText, visible } = require("./helpers.cjs");
const { pngBytes, pdfBytes } = require("./pictures.cjs");

const NOON12 = Date.parse("2026-12-12T13:20:00+09:00");
const SENSO = "planstop1101";
const MEIJI = "planstop1201";
const SKY = "planstop1203";
const TRIP = { ...SEED, ...PLAN };

const HEAD = ["ticket_id", "start_date", "start_time", "type", "title", "provider", "confirmation", "traveler", "seat", "holder", "file_url", "notes", "status"];
const line = (o) => HEAD.map((h) => (o[h] === undefined ? "" : o[h]));
const LINES = [
  line({ ticket_id: "T001", start_date: "2026-12-12", start_time: "14:00", type: "activity", title: "Shibuya Sky deck", confirmation: "QZ48810", traveler: "ALL", holder: "A PERSON", status: "active", notes: "never on the phone" }),
  line({ ticket_id: "T005", start_date: "2026-12-12", start_time: "09:00", type: "activity", title: "Garden entry", traveler: "Mo", seat: "1A", status: "active" }),
  line({ ticket_id: "T008", start_date: "2026-12-11", start_time: "10:00", type: "activity", title: "Temple walk", traveler: "ALL", status: "active" }),
  line({ ticket_id: "T009", start_date: "2026-12-15", start_time: "10:00", type: "train", title: "No file yet", status: "active" }),
  line({ ticket_id: "T010", start_date: "2026-12-12", start_time: "14:00", title: "Old booking", status: "cancelled" }),
  line({ ticket_id: "T019", start_date: "2026-12-16", start_time: "19:30", title: "Lantern boat", status: "active" }),
  line({ ticket_id: "T030", start_date: "2026-11-30", start_time: "08:00", title: "Before Japan", status: "active" }),
];
const b64 = (buf) => buf.toString("base64");
const H = (n) => String(n).padStart(2, "0").repeat(16); // 32 hex characters
const desk = (list) => {
  const files = list.map((f) => ({ h: f.h, name: f.name, mime: f.mime, size: Math.ceil(f.data.length * 0.75), print: f.print, at: "2026-11-18T10:00:00.000Z" }));
  const byH = new Map(list.map((f) => [f.h, f]));
  return (body) => {
    if (body.action === "tickets") return { ok: true, files, skipped: 0, list: true };
    const f = byH.get(body.h);
    if (!f) return { ok: false, why: "not found" };
    if (f.fail) return f.fail === "throw" ? (() => { throw new Error("desk down"); })() : { ok: false, why: f.fail };
    return { ok: true, h: f.h, name: f.name, mime: f.mime, data: f.data };
  };
};
const FOLDER = () => [
  { h: H(1), name: "T001 Sky order.png", mime: "image/png", print: "aaaaaaaaaaa1", data: b64(pngBytes(360, 360, 11)) },
  { h: H(5), name: "T005 Mo.png", mime: "image/png", print: "aaaaaaaaaaa5", data: b64(pngBytes(300, 300, 15)) },
  { h: H(8), name: "T008 Temple.pdf", mime: "application/pdf", print: "aaaaaaaaaaa8", data: b64(pdfBytes(2)) },
  { h: H(10), name: "T010 old.png", mime: "image/png", print: "aaaaaaaaaa10", data: b64(pngBytes(300, 300, 20)) },
  { h: H(19), name: "T019 Lantern boat.png", mime: "image/png", print: "aaaaaaaaaa19", data: b64(pngBytes(300, 300, 19)) },
  { h: H(30), name: "T030 before.png", mime: "image/png", print: "aaaaaaaaaa30", data: b64(pngBytes(300, 300, 30)) },
  { h: H(40), name: "receipt.png", mime: "image/png", print: "aaaaaaaaaa40", data: b64(pngBytes(300, 300, 40)) },
];
const smallPng = b64(pngBytes(60, 60, 9));
const handPic = (id, stop, from) => ({ id, stop, who: "", seat: "", page: 1, mime: "image/png", w: 60, h: 60, data: smallPng, ...(from ? { from } : {}) });

// A trip whose planner has the Tickets list and whose desk answers with `folder`; returns the backend.
function tripWith({ lines = LINES, folder = FOLDER() } = {}) {
  const backend = makeBackend({ ...TRIP, plannerId: "planner-invented-0000000000000000", plannerTabs: { Tickets: [HEAD, ...lines] }, desk: true }, { now: NOON12 });
  backend.fake.desk.answer = desk(folder);
  return backend;
}
const as = (backend, who, action, args) => backend.fake({ key: ownKey(backend, who), action, args });
const calls = (backend, action) => backend.requests.filter((b) => b.action === action);
const deskCalls = (backend, action) => backend.fake.desk.calls.filter((c) => c.action === action);

async function ready(page, backend, who = "Mo") {
  await open(page, { backend, nowMs: NOON12, own: who });
  await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0 || document.querySelectorAll("#rail .pg").length > 0), "the app draws");
  await page.clock.resume();
}
const sheetUp = (page, id) => page.evaluate((id) => {
  const s = document.getElementById(id);
  return !!s && s.classList.contains("is-open") && Math.abs(s.getBoundingClientRect().bottom - innerHeight) < 1;
}, id);
async function openYou(page) {
  await page.dispatchEvent("#youBtn", "click");
  await until(() => sheetUp(page, "you"), "You opens");
}
const listSorted = (page) => until(() => page.evaluate(() => {
  return !!document.querySelector("#bulk .sl") && !document.querySelector("#bulk .ba-prog") && !!document.getElementById("bulkPunch");
}), "the list's slip is up", 20000);
const added = (page) => until(() => page.evaluate(() => !!document.querySelector("#bulk .ba-done-h")), "added", 30000);

const cases = [];

cases.push({
  name: "the owner's phone: the notice in You, only the files that need something fetched after Check, sure ones bundled, a card left out, 入鋏 adds each with its tie",
  async run({ page }) {
    const backend = tripWith();
    // A stop someone filled by hand: Senso-ji (T008's) has a picture with no tie.
    assert.equal((await as(backend, "Trenton", "addTicket", { ticket: handPic("handpic00001", SENSO) })).ok, true);
    const addsBefore = calls(backend, "addTicket").length;
    const logged = [];
    page.on("console", (m) => logged.push(m.text()));
    await ready(page, backend);
    await until(() => calls(backend, "listTickets").length === 1, "the phone looks at the list at start");
    assert.deepEqual(calls(backend, "listTickets")[0].args, { force: false });
    await openYou(page);
    await until(() => visible(page, "#setListNt"), "the notice shows");
    await expectText(page, "#setListNt", "検札3 new tickets from the listCheck ›");
    assert.equal(deskCalls(backend, "ticketFile").length, 0, "no file is fetched before the notice is opened");
    assert.equal(calls(backend, "addTicket").length, addsBefore);

    await page.dispatchEvent("#setListNt", "click");
    await until(() => sheetUp(page, "bulk"), "the sheet opens");
    await listSorted(page);
    // Fetched one at a time: T001, T005, T019; not T008 (its stop was filled by hand), T010 (cancelled), T030 (before the trip), receipt.png (not on the list).
    assert.deepEqual(deskCalls(backend, "ticketFile").map((c) => c.h), [H(1), H(5), H(19)]);
    await expectText(page, "#bulk .sheet-top i", "一括");
    await expectText(page, "#bulk .sl-h", "Will add · 2 ticketson 2 stops");
    await expectText(page, "#bulk .sl-q .sl-qt b", "Lantern boat: Day 7 has no stop for it");
    const asides = await page.evaluate(() => [...document.querySelectorAll("#bulk .sl-notes > span")].map((a) => a.textContent.replace(/\s+/g, " ").trim()));
    assert.ok(asides.includes("1 stop was filled by hand; the list’s tickets for them are left out"), JSON.stringify(asides));
    assert.ok(asides.includes("On the list: 1 line has no file yet, 1 is outside the trip’s days, 1 file in the folder isn’t on the list"), JSON.stringify(asides));
    assert.equal(calls(backend, "addTicket").length, addsBefore, "nothing is added before Add");

    // The odd one left out: remembered on this phone (its tie only), once Add is pressed.
    await page.click("#bulk .sl-q [data-out]");
    assert.equal(await page.evaluate(() => localStorage.getItem("mat.listSkip")), null);
    await expectText(page, "#bulkPunch", "Add 2 ticketsUndo from History");
    await page.click("#bulkPunch");
    await added(page);
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem("mat.listSkip"))), ["T019:aaaaaaaaaa19"]);
    const adds = calls(backend, "addTicket").slice(addsBefore).map((b) => b.args.ticket);
    assert.deepEqual(adds.map((t) => [t.stop, t.who, t.page, t.from]), [
      [MEIJI, "Mo", 1, "T005:aaaaaaaaaaa5"],
      [SKY, "", 1, "T001:aaaaaaaaaaa1"],
    ]);
    assert.deepEqual(backend.fake.tables.Tickets.filter((r) => r.planner_id).map((r) => [r.stop, r.planner_id]), [[MEIJI, "T005:aaaaaaaaaaa5"], [SKY, "T001:aaaaaaaaaaa1"]]);
    // Facts only where empty: Sky's reference and the name on the booking from T001's line; Mo's seat on his own picture.
    assert.equal(adds[0].seat, "1A");
    const sky = backend.fake.tables.Stops.find((s) => s.id === SKY);
    assert.equal(sky.tk_ref, "QZ48810");
    // Nothing new any more: the notice goes.
    await page.dispatchEvent("#bulkTop", "click");
    await openYou(page);
    await until(() => page.evaluate(() => document.getElementById("setListNt").hidden), "the notice is gone");
    for (const l of logged) for (const w of ["T001", "T005", "Sky order", "QZ48810", "A PERSON", H(1)]) assert.equal(l.includes(w), false, "console: " + l);
    // The lines the phone got never held the planner's notes or file links.
    const got = await page.evaluate(async () => JSON.stringify(await globalThis.__matTest.store.listTickets({ force: false })));
    for (const never of ["never on the phone", "drive.google.com"]) assert.equal(got.includes(never), false, never);
  },
});

cases.push({
  name: "two phones of the owner: the second's 入鋏 of a ticket the first already added is refused as already there, never a second picture",
  async run({ page }) {
    const backend = tripWith({ lines: [LINES[0]], folder: [FOLDER()[0]] });
    await ready(page, backend);
    await openYou(page);
    await until(() => visible(page, "#setListNt"), "the notice shows");
    await page.dispatchEvent("#setListNt", "click");
    await listSorted(page);
    // Meanwhile the owner's computer adds the same line (another id, the same tie, page and person).
    const other = await as(backend, "Mo", "addTicket", { ticket: { ...handPic("otherphone01", SKY, "T001:aaaaaaaaaaa1"), data: smallPng } });
    assert.equal(other.ok, true);
    await page.click("#bulkPunch");
    await added(page);
    assert.equal(backend.fake.tables.Tickets.filter((r) => r.stop === SKY && r.gone !== "yes").length, 1, "one picture of T001, not two");
    await expectText(page, "#bulk .ba-done-h", "No ticket was added.");
    assert.match(await text(page, "#bulk .ba-next.is-flat"), /That ticket from the list is already on this stop\./);
  },
});

cases.push({
  name: "a changed line and a cancelled one are cards: replace (old ones off first when the stop would pass 8) and take off, both undoable",
  async run({ page }) {
    const lines = [LINES[0], line({ ticket_id: "T010", start_date: "2026-12-12", start_time: "12:30", title: "Lunch voucher", status: "cancelled" })];
    const backend = tripWith({ lines, folder: [FOLDER()[0]] });
    // T001's picture on the trip came from an older file; Sky also holds 7 pictures added by hand.
    assert.equal((await as(backend, "Mo", "addTicket", { ticket: handPic("oldtie000001", SKY, "T001:000000000000") })).ok, true);
    for (let i = 0; i < 7; i++) assert.equal((await as(backend, "Ajen", "addTicket", { ticket: { ...handPic("handsky0000" + i, SKY), page: i + 2 } })).ok, true);
    // T010's picture is on Lunch; the line is now cancelled in the list.
    assert.equal((await as(backend, "Mo", "addTicket", { ticket: handPic("oldtie000010", "planstop1202", "T010:bbbbbbbbbbbb") })).ok, true);
    await ready(page, backend);
    await openYou(page);
    await until(() => visible(page, "#setListNt"), "the notice shows");
    await expectText(page, "#setListNt", "検札2 tickets changed in the listCheck ›");
    await page.dispatchEvent("#setListNt", "click");
    await listSorted(page);
    assert.deepEqual(deskCalls(backend, "ticketFile").map((c) => c.h), [H(1)]);
    await expectText(page, '#bulk [data-card="chg:T001"] .sl-qt b', "Shibuya Sky deck: the list has a newer file");
    await expectText(page, '#bulk [data-lchoice="chg:T001|first"]', "Take the old pictures off, then add the new filethe stop holds 8 pictures; the old ones can be put back from History");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#bulk [data-card="chg:T001"] [data-lchoice]')].map((b) => b.dataset.lchoice)), ["chg:T001|first", "chg:T001|keep"]);
    await page.click('#bulk [data-lchoice="chg:T001|first"]');
    await expectText(page, '#bulk [data-card="off:T010"] .sl-qt b', "Lunch voucher: cancelled in the list");
    await page.click('#bulk [data-lchoice="off:T010|off"]');
    await expectText(page, "#bulkPunch", "Add 1 ticket, take 1 picture offUndo from History");
    const before = backend.requests.length;
    await page.click("#bulkPunch");
    await added(page);
    const seq = backend.requests.slice(before).filter((b) => b.action === "addTicket" || b.action === "removeTicket").map((b) => b.action + ":" + (b.args.id || b.args.ticket.from));
    assert.deepEqual(seq, ["removeTicket:oldtie000001", "removeTicket:oldtie000010", "addTicket:T001:aaaaaaaaaaa1"], "the old ones off first, then the new");
    const rows = backend.fake.tables.Tickets;
    assert.equal(rows.find((r) => r.id === "oldtie000001").gone, "yes");
    assert.equal(rows.find((r) => r.id === "oldtie000010").gone, "yes");
    assert.equal(rows.filter((r) => r.planner_id === "T001:aaaaaaaaaaa1" && r.gone !== "yes").length, 1);
    await expectText(page, "#bulk .ba-done-s", "2 old pictures taken off. History puts them back.");
    // Undoable from History: each removal is a History line.
    const hist = (await as(backend, "Mo", "history", {})).data.entries.filter((e) => e.kind === "ticket" && e.action === "remove");
    assert.equal(hist.length, 2);
  },
});

cases.push({
  name: "a slow or failing desk: a file that gets no reply (the phone's 30 seconds) or can't be reached is said and the rest go on",
  async run({ page }) {
    const folder = FOLDER().slice(0, 2);
    folder[0].fail = "failed";
    const backend = tripWith({ lines: LINES.slice(0, 2), folder });
    const real = backend.handle;
    // T005's file: no reply in time (the phone's request gives up: no signal).
    backend.handle = async (body) => {
      if (body.action === "listTicketFile" && body.args && body.args.handle === H(5)) throw new Error("timed out");
      return real(body);
    };
    await ready(page, backend);
    await openYou(page);
    await until(() => visible(page, "#setListNt"), "the notice shows");
    await page.dispatchEvent("#setListNt", "click");
    await until(() => page.evaluate(() => !document.querySelector("#bulk .ba-prog")), "fetching ends", 20000);
    const asides = await page.evaluate(() => [...document.querySelectorAll("#bulk .sl-notes > span")].map((a) => a.textContent.replace(/\s+/g, " ").trim()));
    assert.ok(asides.some((a) => a === "2 files couldn’t be fetched: T001 Sky order.png (The list’s ticket files can’t be reached right now. Try again later.), T005 Mo.png (no signal: Check the list again later)"), JSON.stringify(asides));
    assert.equal(await page.evaluate(() => document.getElementById("bulkPunch").disabled), true);
    // The look itself failing (the desk unreachable): the notice says so instead of failing quietly.
    backend.fake.desk.answer = () => null;
    backend.now += 60 * 1000; // past the backend's 30 seconds between two forced looks
    await page.dispatchEvent("#bulkTop", "click");
    await openYou(page);
    await page.dispatchEvent("#setBulk", "click");
    await until(() => sheetUp(page, "bulk"), "Add tickets opens");
    await listSorted(page);
    await page.click("#bulkByHand");
    await page.click("#bulkCheckList");
    await until(() => calls(backend, "listTickets").some((b) => b.args.force === true), "a forced look");
    await expectText(page, "#bulk .ba-vh[role=status]", "The list’s ticket files can’t be reached right now. Try again later.");
    await page.dispatchEvent("#bulkTop", "click");
    await openYou(page);
    await expectText(page, "#setListNt", "検札The list’s ticket files can’t be reached right now. Try again later.Check ›");
  },
});

for (const how of ["Forget this phone", "a refused key"]) {
  cases.push({
    name: "auto-add: " + how + " clears what the notice and the list's review hold",
    async run({ page }) {
      const backend = tripWith();
      await ready(page, backend);
      await openYou(page);
      await until(() => visible(page, "#setListNt"), "the notice shows");
      await page.dispatchEvent("#setListNt", "click");
      await listSorted(page);
      await page.click("#bulk .sl-q [data-out]");
      await page.click("#bulkPunch");
      await added(page);
      assert.ok(await page.evaluate(() => localStorage.getItem("mat.listSkip")));
      assert.ok(await page.evaluate(() => localStorage.getItem("mat.bulkBatch")));
      await page.keyboard.press("Escape");
      await until(() => page.evaluate(() => !document.getElementById("bulk").classList.contains("is-open")), "closed");
      if (how === "a refused key") {
        backend.failWith = "bad_key";
        await page.evaluate(() => globalThis.__matTest.store.checkRev());
      } else {
        await openYou(page);
        await page.dispatchEvent("#setForget", "click");
        await page.dispatchEvent("#setForget", "click");
      }
      await until(() => visible(page, "#gate"), "the no-key screen shows", 10000);
      const t = await page.evaluate(() => document.getElementById("bulk").textContent + document.getElementById("you").textContent);
      for (const w of ["T001", "T005", "T019", "Sky order", "Lantern", "new tickets from the list"]) assert.equal(t.includes(w), false, w + " is still there");
      assert.equal(await page.evaluate(() => document.getElementById("setListNt").hidden), true);
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.listSkip")), null);
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.bulkBatch")), null);
      // Nothing more is asked of the list once the trip is off the phone.
      const n = calls(backend, "listTickets").length;
      await page.clock.fastForward(11 * 60 * 1000);
      assert.equal(calls(backend, "listTickets").length, n);
    },
  });
}

cases.push({
  name: "not the owner: no notice, no look at the list, no Check line; the owner's looks are 10 minutes apart, and forced only by Check the list now",
  async run({ page, newPhone }) {
    const backend = tripWith();
    await ready(page, backend, "Ajen");
    await page.dispatchEvent("#youBtn", "click");
    await until(() => sheetUp(page, "you"), "You opens");
    await page.dispatchEvent("#setBulk", "click");
    await until(() => sheetUp(page, "bulk"), "Add tickets opens");
    assert.equal(await page.evaluate(() => !!document.getElementById("bulkCheckList")), false);
    assert.equal(await page.evaluate(() => document.getElementById("setListNt").hidden), true);
    assert.equal(calls(backend, "listTickets").length, 0);
    // A request made anyway is refused by the backend.
    assert.equal((await as(backend, "Ajen", "listTickets", {})).message, "Only Mo can bring in tickets from the list.");

    const mo = await newPhone();
    const moKey = ownKey(backend, "Mo");
    const looks = () => backend.requests.filter((b) => b.action === "listTickets" && b.key === moKey);
    await ready(mo, backend, "Mo");
    await until(() => looks().length === 1, "Mo's phone looks at start");
    await mo.clock.fastForward(5 * 60 * 1000);
    assert.equal(looks().length, 1, "not again within 10 minutes");
    await mo.clock.fastForward(6 * 60 * 1000);
    await until(() => looks().length === 2, "again after 10 minutes");
    assert.equal(looks()[1].args.force, false);
    await mo.dispatchEvent("#youBtn", "click");
    await until(() => sheetUp(mo, "you"), "You opens");
    await mo.dispatchEvent("#setBulk", "click");
    await until(() => sheetUp(mo, "bulk"), "Add tickets opens");
    await listSorted(mo);
    await mo.click("#bulkByHand");
    await mo.click("#bulkCheckList");
    await until(() => looks().length === 3, "Check the list now looks at once");
    assert.equal(looks()[2].args.force, true);
    await listSorted(mo);
  },
});

cases.push({
  name: "320 px: the notice and the list's review fit with no sideways scroll",
  viewport: { width: 320, height: 568 },
  async run({ page }) {
    const backend = tripWith();
    await ready(page, backend);
    await openYou(page);
    await until(() => visible(page, "#setListNt"), "the notice shows");
    const fits = () => page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth && [...document.querySelectorAll("#you *, #bulk *")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 0.5).length === 0);
    assert.equal(await fits(), true);
    await page.dispatchEvent("#setListNt", "click");
    await listSorted(page);
    assert.equal(await fits(), true);
  },
});

module.exports = cases;
