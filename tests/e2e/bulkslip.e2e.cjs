// The slip (bulk C, 2026-11-20): on the owner's phone You → Add tickets opens
// straight on the planner's list as one paper slip (js/bulkslip.js drawn by
// js/views/bulkadd.js): the sure tickets as cells, the questions with their
// likely answer filled, one key, Add; a line with no stop can add its stop;
// what an Add did can be taken back in one tap, here and from History
// (js/bulkbatch.js, js/takeback.js). Everything is made up: the list's
// lines, the stops, the files (tests/e2e/pictures.cjs), the desk (a stand-in
// in Node); the people are the test trip's own. 09:12 on Dec 12.
// Pictures are taken only when MAT_TAB_SHOTS names an output folder.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { SEED, PLAN, makeBackend, open, ownKey, until, text, expectText, visible } = require("./helpers.cjs");
const { pngBytes, pdfBytes } = require("./pictures.cjs");

const SHOTS = process.env.MAT_TAB_SHOTS || "";
const NOW = Date.parse("2026-12-12T09:12:00+09:00");
const AQ = "slipstop-aq01";
const MU = "slipstop-mu01";
const KG = "slipstop-kg01";
const RW = "slipstop-rw01";
const KX = "slipstop-kx01";
const TW = "slipstop-tw01";
const HF = "slipstop-hf01";
const STOPS = [
  { id: AQ, date: "2026-12-11", time: "13:00", title: "Sakuragawa Aquarium" },
  { id: MU, date: "2026-12-12", time: "10:00", title: "Aonami Museum" },
  { id: KG, date: "2026-12-13", time: "18:00", title: "Kogane Garden" },
  { id: RW, date: "2026-12-14", time: "11:00", title: "Hoshizora Ropeway" },
  { id: KX, date: "2026-12-15", time: "08:10", title: "Kitamine Express" },
  { id: TW, date: "2026-12-17", time: "17:30", title: "Tsukimi Tower" },
  { id: HF, date: "2026-12-18", time: "09:40", title: "Harbour ferry" },
];
const TRIP = { ...SEED, ...PLAN, stops: STOPS };

const HEAD = ["ticket_id", "start_date", "start_time", "type", "title", "provider", "confirmation", "traveler", "seat", "holder", "file_url", "notes", "status"];
const line = (o) => HEAD.map((h) => (o[h] === undefined ? "" : o[h]));
const A = (o) => line({ type: "activity", traveler: "ALL", status: "active", ...o });
const LINES = [
  A({ ticket_id: "T001", start_date: "2026-12-11", start_time: "13:00", title: "Sakuragawa Aquarium", traveler: "Mo" }),
  A({ ticket_id: "T002", start_date: "2026-12-11", start_time: "13:00", title: "Sakuragawa Aquarium", traveler: "Ajen" }),
  A({ ticket_id: "T003", start_date: "2026-12-11", start_time: "13:00", title: "Sakuragawa Aquarium", traveler: "Trenton" }),
  A({ ticket_id: "T004", start_date: "2026-12-12", start_time: "10:00", title: "Aonami Museum" }),
  A({ ticket_id: "T005", start_date: "2026-12-14", start_time: "11:00", title: "Hoshizora Ropeway" }),
  A({ ticket_id: "T006", start_date: "2026-12-15", start_time: "08:10", type: "train", title: "Kitamine Express" }),
  A({ ticket_id: "T007", start_date: "2026-12-17", start_time: "17:30", title: "Tsukimi Tower" }),
  A({ ticket_id: "T008", start_date: "2026-12-18", start_time: "09:40", type: "ferry", title: "Harbour ferry" }),
  A({ ticket_id: "T009", start_date: "2026-12-13", start_time: "18:00", title: "Kogane Garden night walk" }),
  A({ ticket_id: "T010", start_date: "2026-12-16", start_time: "16:30", title: "Lantern boat", confirmation: "LB-55120" }),
];
const b64 = (buf) => buf.toString("base64");
const H = (n) => String(n).padStart(2, "0").repeat(16);
const desk = (list) => {
  const files = list.map((f) => ({ h: f.h, name: f.name, mime: f.mime, size: Math.ceil(f.data.length * 0.75), print: f.print, at: "2026-11-18T10:00:00.000Z" }));
  const byH = new Map(list.map((f) => [f.h, f]));
  return (body) => {
    if (body.action === "tickets") return { ok: true, files, skipped: 0, list: true };
    const f = byH.get(body.h);
    if (!f) return { ok: false, why: "not found" };
    return { ok: true, h: f.h, name: f.name, mime: f.mime, data: f.data };
  };
};
const png = (n, name, seed) => ({ h: H(n), name, mime: "image/png", print: "aaaaaaaaaa" + String(n).padStart(2, "0"), data: b64(pngBytes(300, 300, seed)) });
const FERRY = b64(pngBytes(300, 300, 8));
const FOLDER = () => [
  png(1, "T001 aquarium Mo.png", 1), png(2, "T002 aquarium Ajen.png", 2), png(3, "T003 aquarium Trenton.png", 3),
  png(4, "T004 museum.png", 4), png(5, "T005 ropeway.png", 5), png(6, "T006 express.png", 6), png(7, "T007 tower.png", 7),
  { ...png(8, "T008 ferry.png", 8), data: FERRY }, { ...png(18, "T008 ferry copy.png", 8), data: FERRY },
  png(9, "T009 night walk.png", 9), png(10, "T010 lantern boat.png", 10),
];
const smallPng = b64(pngBytes(60, 60, 9));
const tied = (id, stop, from) => ({ id, stop, who: "", seat: "", page: 1, mime: "image/png", w: 60, h: 60, data: smallPng, from });

// The trip, its list and folder, and Kogane Garden's two pictures from T009's older file.
async function tripWith({ lines = LINES, folder = FOLDER(), old = true } = {}) {
  const backend = makeBackend({ ...TRIP, plannerId: "planner-invented-0000000000000000", plannerTabs: { Tickets: [HEAD, ...lines] }, desk: true }, { now: NOW });
  backend.fake.desk.answer = desk(folder);
  if (old) {
    for (const [id, page] of [["oldwalk00001", 1], ["oldwalk00002", 2]]) assert.equal((await as(backend, "Mo", "addTicket", { ticket: { ...tied(id, KG, "T009:000000000009"), page } })).ok, true);
  }
  return backend;
}
const as = (backend, who, action, args) => backend.fake({ key: ownKey(backend, who), action, args });
const calls = (backend, action) => backend.requests.filter((b) => b.action === action);
const live = (backend) => backend.fake.tables.Tickets.filter((r) => r.gone !== "yes");

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.screenshot({ path: SHOTS + "/" + name });
}
async function ready(page, backend, who = "Mo") {
  await open(page, { backend, nowMs: NOW, own: who });
  await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0 || document.querySelectorAll("#rail .pg").length > 0), "the app draws");
  await page.clock.resume();
}
const sheetUp = (page, id) => page.evaluate((id) => {
  const s = document.getElementById(id);
  return !!s && s.classList.contains("is-open") && Math.abs(s.getBoundingClientRect().bottom - innerHeight) < 1;
}, id);
async function addTickets(page) {
  await page.dispatchEvent("#youBtn", "click");
  await until(() => sheetUp(page, "you"), "You opens");
  await until(() => page.evaluate(() => !document.getElementById("setBulk").hidden), "the Add tickets row shows");
  await page.dispatchEvent("#setBulk", "click");
  await until(() => sheetUp(page, "bulk"), "Add tickets opens");
}
const slipUp = (page) => until(() => page.evaluate(() => !!document.querySelector("#bulk .sl") && !document.querySelector("#bulk .ba-prog") && !!document.getElementById("bulkPunch")), "the slip is up", 20000);
const added = (page) => until(() => page.evaluate(() => !!document.querySelector("#bulk .ba-done-h")), "added", 30000);
const key = (page) => text(page, "#bulkPunch");
const texts = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.replace(/\s+/g, " ").trim()), sel);
const skipNow = (page) => page.evaluate(() => localStorage.getItem("mat.listSkip"));
const noSideways = (page) => page.evaluate(() => {
  const s = document.getElementById("bulk");
  const over = [...s.querySelectorAll("*")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 0.5).map((e) => e.className || e.tagName);
  return { doc: document.scrollingElement.scrollWidth <= innerWidth, sheet: s.scrollWidth <= s.clientWidth, over };
});
async function openHistory(page) {
  await page.evaluate(() => document.getElementById("histBtn").click());
  await until(() => page.evaluate(() => document.getElementById("hist").classList.contains("is-open")), "History opens");
}

const cases = [];

cases.push({
  name: "the owner taps You → Add tickets: the slip opens with no other tap, every word as C2; nothing sent",
  async run({ page }) {
    const backend = await tripWith();
    const writes = () => backend.requests.filter((b) => ["addTicket", "removeTicket", "addStop", "updateStop"].includes(b.action)).length;
    await ready(page, backend);
    const before = writes();
    await addTickets(page);
    // While the files are fetched: the progress line, the list's own small line.
    await slipUp(page);
    await expectText(page, "#bulk .sheet-top", "Add tickets一括Cancel");
    await expectText(page, "#bulk .sl-hd", /^From the planner’s listread at \d\d:\d\d$/);
    await expectText(page, "#bulk .sl-key", "= will happen= won’tTap to changeA filled dot will happen, an empty one won’t. Tap to change.");
    assert.deepEqual(await texts(page, "#bulk .sl-h"), ["Will add · 8 ticketson 6 stops", "Check these 2the likely answer is picked"]);
    assert.deepEqual(await texts(page, "#bulk .sl-c"), [
      "D2 Fri 13:00 · 3 ticketsSakuragawa Aquarium",
      "D3 Sat 10:00Aonami Museum",
      "D5 Mon 11:00Hoshizora Ropeway",
      "D6 Tue 08:10Kitamine Express",
      "D8 Thu 17:30Tsukimi Tower",
      "D9 Fri 09:40Harbour ferry",
    ]);
    assert.equal(await page.getAttribute('#bulk [data-cell="stop:' + AQ + '"]', "aria-label"), "Sakuragawa Aquarium, D2 Fri 13:00, 3 tickets, will be added");
    assert.equal(await page.getAttribute('#bulk [data-cell="stop:' + AQ + '"]', "aria-pressed"), "true");
    const qs = await page.evaluate(() => [...document.querySelectorAll("#bulk .sl-q")].map((q) => ({
      key: q.dataset.card,
      head: q.querySelector(".sl-qt").textContent,
      opts: [...q.querySelectorAll(".sl-o")].map((o) => [o.querySelector("select") ? o.querySelector("select").selectedOptions[0].textContent : o.textContent.replace(/\s+/g, " ").trim(), o.classList.contains("is-on")]),
    })));
    const nostop = qs[0].key;
    assert.deepEqual(qs.map((q) => q.head), ["T010 · D7 Wed 16:30Lantern boat: Day 7 has no stop for it", "T009 · D4 Sun 18:00Kogane Garden night walk: the list has a newer file"]);
    assert.deepEqual(qs[0].opts, [["Add a stop for itDay 7, 16:30, “Lantern boat”", true], ["Put it on another stop…", false], ["Leave it outnothing is added for T010", false]]);
    assert.deepEqual(qs[1].opts, [["Replace the old pictures with the new filethe 2 old ones can be put back from History", true], ["Keep the old picturesthe new file stays out", false]]);
    assert.equal(qs[1].key, "chg:T009");
    assert.equal(await page.getAttribute('#bulk [data-lchoice="chg:T009|replace"]', "aria-checked"), "true");
    assert.equal(await page.getAttribute('#bulk [data-out="' + nostop + '"]', "aria-checked"), "false");
    await expectText(page, "#bulk .sl-ft", "1 already there, not added twicePictures: 2 now, 10 after");
    await expectText(page, "#bulkPunch", "Add 10 ticketsUndo from History");
    await expectText(page, "#bulk .sl-by", "Not from the list? Choose files by hand");
    await expectText(page, "#bulk .ba-vh[role=status]", "8 tickets ready to add, 2 to check.");
    const sheet = await page.evaluate(() => document.getElementById("bulk").textContent);
    for (const never of ["入鋏", "SURE", "PUNCHED", "No."]) assert.equal(sheet.includes(never), false, never);
    // Every dot row and cell a real button at least 44 px tall; the key at least 58.
    const small = await page.evaluate(() => [...document.querySelectorAll("#bulk .sl-c, #bulk button.sl-o")].filter((b) => b.tagName !== "BUTTON" || b.getBoundingClientRect().height < 44).length);
    assert.equal(small, 0);
    assert.ok(await page.evaluate(() => document.getElementById("bulkPunch").getBoundingClientRect().height >= 58));
    assert.equal(writes(), before, "nothing is sent before Add");
    assert.equal(await skipNow(page), null, "nothing remembered");
    await shot(page, "slip.png");
    // Cancel throws it away: nothing sent, nothing remembered.
    await page.dispatchEvent("#bulkTop", "click");
    assert.equal(writes(), before);
    assert.equal(await skipNow(page), null);
  },
});

cases.push({
  name: "a dot moved: Leave it out gives Add 9, nothing sent or remembered; back gives Add 10; a cell out and in",
  async run({ page }) {
    const backend = await tripWith();
    await ready(page, backend);
    await addTickets(page);
    await slipUp(page);
    const nostop = await page.evaluate(() => document.querySelector("#bulk .sl-q").dataset.card);
    const sent = backend.requests.length;
    await page.click('#bulk [data-out="' + nostop + '"]');
    await expectText(page, "#bulkPunch", "Add 9 ticketsUndo from History");
    await expectText(page, "#bulk .sl-ft", "1 already there, not added twicePictures: 2 now, 9 after");
    assert.equal(await page.getAttribute('#bulk [data-out="' + nostop + '"]', "aria-checked"), "true");
    await expectText(page, "#bulk .ba-vh[role=status]", "Add 9 tickets");
    assert.equal(backend.requests.length, sent, "nothing sent");
    assert.equal(await skipNow(page), null, "a moved dot remembers nothing");
    await shot(page, "slip-moved.png");
    await page.click('#bulk [data-choice="' + nostop + '|0"]');
    await expectText(page, "#bulkPunch", "Add 10 ticketsUndo from History");
    // A cell out and in: the heading, the key and aria-pressed follow.
    const aq = '#bulk [data-cell="stop:' + AQ + '"]';
    await page.click(aq);
    await expectText(page, "#bulk .sl-h", "Will add · 5 ticketson 5 stops");
    await expectText(page, "#bulkPunch", "Add 7 ticketsUndo from History");
    assert.equal(await page.getAttribute(aq, "aria-pressed"), "false");
    assert.equal(await page.getAttribute(aq, "aria-label"), "Sakuragawa Aquarium, D2 Fri 13:00, 3 tickets, left out");
    assert.ok(await page.evaluate((s) => document.querySelector(s).classList.contains("is-out"), aq));
    await page.click(aq);
    await expectText(page, "#bulk .sl-h", "Will add · 8 ticketson 6 stops");
    assert.equal(await page.getAttribute(aq, "aria-pressed"), "true");
    await expectText(page, "#bulkPunch", "Add 10 ticketsUndo from History");
    assert.equal(backend.requests.length, sent);
    assert.equal(await skipNow(page), null);
  },
});

// The Add of the C2 slip as it opens; returns the backend after the added screen is up.
async function addAll(page, backend) {
  await addTickets(page);
  await slipUp(page);
  const before = backend.requests.length;
  await page.click("#bulkPunch");
  await added(page);
  return backend.requests.slice(before);
}

cases.push({
  name: "Add: one addStop with the line's day, time and title, then each addTicket with its tie, the new stop's id on its ticket, the old ones off after; the added screen; Take all back",
  async run({ page }) {
    const backend = await tripWith();
    await ready(page, backend);
    const sent = await addAll(page, backend);
    const seq = sent.filter((b) => ["addStop", "addTicket", "removeTicket"].includes(b.action));
    assert.equal(seq[0].action, "addStop");
    const stop = seq[0].args.stop;
    assert.deepEqual({ date: stop.date, time: stop.time, title: stop.title }, { date: "2026-12-16", time: "16:30", title: "Lantern boat" });
    assert.equal(seq.filter((b) => b.action === "addStop").length, 1);
    const adds = seq.filter((b) => b.action === "addTicket").map((b) => b.args.ticket);
    // One of T008's two identical files (the other is already there, not added twice).
    assert.deepEqual(adds.map((t) => t.from.split(":")[0]).sort(), ["T001", "T002", "T003", "T004", "T005", "T006", "T007", "T008", "T009", "T010"]);
    assert.ok(adds.every((t) => /^T0\d\d:aaaaaaaaaa\d\d$/.test(t.from)));
    assert.equal(adds.find((t) => t.from === "T010:aaaaaaaaaa10").stop, stop.id, "the new stop's id on its ticket");
    assert.equal(adds.find((t) => t.from === "T009:aaaaaaaaaa09").stop, KG);
    const lastAdd = seq.map((b) => b.action).lastIndexOf("addTicket");
    assert.deepEqual(seq.slice(lastAdd + 1).map((b) => b.action + ":" + b.args.id), ["removeTicket:oldwalk00001", "removeTicket:oldwalk00002"], "the old ones off after the new ones");
    // The new stop is on the trip, its empty facts filled from the line.
    const row = backend.fake.tables.Stops.find((s) => s.id === stop.id);
    assert.equal(row.title, "Lantern boat");
    assert.equal(row.tk_ref, "LB-55120");
    // The added screen.
    await expectText(page, "#bulk .sheet-top", "Add ticketsaddedDone");
    await expectText(page, "#bulk .ba-done-h", "10 tickets added to 8 stops.");
    assert.deepEqual(await texts(page, "#bulk .ba-done-s"), ["2 old pictures taken off. History puts them back.", "Added the stop Lantern boat on Day 7.", "10 pictures, kept in the trip. Every phone shows them on its stubs the next time it opens MAT with signal."]);
    await expectText(page, "#bulk .sl.is-done .sl-hd", /^From the planner’s listadded at \d\d:\d\d$/);
    await expectText(page, "#bulk .sl.is-done .sl-h", "Added · 10 ticketson 8 stops");
    const cells = await texts(page, "#bulk .sl.is-done .sl-c");
    assert.equal(cells.length, 8);
    assert.ok(cells.includes("D4 Sun 18:00Kogane Gardenold pictures replaced"), JSON.stringify(cells));
    assert.ok(cells.includes("D7 Wed 16:30Lantern boatstop added"), JSON.stringify(cells));
    assert.equal(await page.evaluate(() => document.querySelectorAll("#bulk .sl.is-done button, #bulk .sl.is-done .sl-dot.off").length), 0);
    await expectText(page, "#bulk .sl-batch", /^\d\d:\d\d10 tickets from the listalso in HistoryTake all back$/);
    await expectText(page, "#bulkOpenDay", "Open Day 2 · see the stubs");
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("mat.bulkBatch")));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].items.length, 10, "ten tickets, one list of picture ids each");
    assert.ok(stored[0].items.every((one) => one.length === 1));
    assert.deepEqual(stored[0].removed.sort(), ["oldwalk00001", "oldwalk00002"]);
    assert.deepEqual(stored[0].stops, [stop.id]);
    for (const never of ["Lantern", "Kogane", ".png", "T010", "LB-55120"]) assert.equal(JSON.stringify(stored).includes(never), false, never);
    await shot(page, "added.png");

    // Take all back: the tickets gone, the two old pictures back, the stop removed.
    await page.click("#bulkTakeBack");
    await until(() => page.evaluate(() => /taken back at \d\d:\d\d/.test(document.querySelector("#bulk .sl-batch").textContent)), "the row reads taken back", 20000);
    assert.equal(await page.evaluate(() => !!document.getElementById("bulkTakeBack")), false);
    assert.ok(await page.evaluate(() => document.querySelector("#bulk .sl-batch .tp-row").classList.contains("is-undone")));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#bulk .sl-batch .tp-s")).textDecorationLine), "none", "the taken back line is not struck through");
    assert.ok((await texts(page, "#bulk .sl.is-done .sl-c")).includes("D7 Wed 16:30Lantern boatstop added"), "the slip keeps the stop's name");
    await expectText(page, "#bulk .ba-vh[role=status]", "Taken back: 10 tickets. 2 old pictures put back.");
    const now = live(backend);
    assert.equal(now.filter((r) => r.planner_id && r.planner_id.endsWith("aaaaaaaaaa10")).length, 0);
    assert.deepEqual(now.map((r) => r.id).sort(), ["oldwalk00001", "oldwalk00002"]);
    assert.equal(backend.fake.tables.Stops.find((s) => s.id === stop.id).deleted_at !== "", true, "the stop is removed");
    await shot(page, "taken-back.png");
    // History: the same row, and every single line under it as before.
    await page.dispatchEvent("#bulkTop", "click");
    await openHistory(page);
    await until(() => page.evaluate(() => document.querySelectorAll("#tape .tp-batch").length === 1 && document.querySelectorAll("#tape .tp-day").length > 0), "History shows the batch");
    await expectText(page, "#tape .tp-batch", /^\d\d:\d\d10 tickets from the listtaken back at \d\d:\d\d$/);
    assert.ok(await page.evaluate(() => document.querySelector("#tape .tp-batch").nextElementSibling.classList.contains("tp-day")), "above the first day's head");
    const single = await texts(page, "#tape .tp-row:not(.tp-batch) .tp-s");
    assert.ok(single.some((t) => /added .*ticket to /.test(t)), JSON.stringify(single.slice(0, 5)));
  },
});

cases.push({
  name: "the batch row in History after a reload, and Take all back from there",
  async run({ page }) {
    const backend = await tripWith();
    await ready(page, backend);
    await addAll(page, backend);
    await page.dispatchEvent("#bulkTop", "click");
    await page.reload();
    await page.clock.resume();
    await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0 || document.querySelectorAll("#rail .pg").length > 0), "the app draws again");
    await openHistory(page);
    await until(() => page.evaluate(() => !!document.querySelector("#tape .tp-batch") && document.querySelectorAll("#tape .tp-day").length > 0), "History shows the batch after the reload");
    await expectText(page, "#tape .tp-batch", /^\d\d:\d\d10 tickets from the listadded from this phone · Sat Dec 12Take all back$/);
    await shot(page, "history.png");
    const stopId = calls(backend, "addStop")[0].args.stop.id;
    await page.click("#tape .tp-batch [data-batch]");
    await until(() => page.evaluate(() => /taken back at \d\d:\d\d/.test(document.querySelector("#tape .tp-batch").textContent)), "the row reads taken back", 20000);
    assert.ok(await page.evaluate(() => document.querySelector("#tape .tp-batch").classList.contains("is-undone")));
    assert.equal(await page.evaluate(() => !!document.querySelector("#tape .tp-batch button")), false);
    assert.deepEqual(live(backend).map((r) => r.id).sort(), ["oldwalk00001", "oldwalk00002"]);
    assert.equal(backend.fake.tables.Stops.find((s) => s.id === stopId).deleted_at !== "", true, "the stop is removed");
  },
});

cases.push({
  name: "a second owner's phone, a second press: already there, never a second picture",
  async run({ page }) {
    const backend = await tripWith({ old: false, lines: LINES.slice(3, 5), folder: FOLDER().slice(3, 5) });
    await ready(page, backend);
    await addTickets(page);
    await slipUp(page);
    await expectText(page, "#bulkPunch", "Add 2 ticketsUndo from History");
    // Meanwhile the owner's other phone adds the same two lines (other ids, the same ties, pages and person).
    for (const [n, stop] of [[4, MU], [5, RW]]) assert.equal((await as(backend, "Mo", "addTicket", { ticket: tied("otherphone0" + n, stop, "T00" + n + ":aaaaaaaaaa0" + n) })).ok, true);
    await page.click("#bulkPunch");
    await added(page);
    assert.equal(live(backend).length, 2, "never a second picture");
    await expectText(page, "#bulk .ba-done-h", "No ticket was added.");
    assert.match(await text(page, "#bulk .ba-next.is-flat"), /already on this stop/);
    assert.equal(await page.evaluate(() => !!document.querySelector("#bulk .sl-batch")), false, "nothing added: no batch row");
    assert.equal(await page.evaluate(() => localStorage.getItem("mat.bulkBatch")), null);
    // A second press: nothing new on the list.
    await page.dispatchEvent("#bulkTop", "click");
    await page.evaluate(() => globalThis.__matTest.store.checkRev());
    await addTickets(page);
    await slipUp(page);
    await expectText(page, "#bulk .sl-none", "Nothing new on the list.");
    await expectText(page, "#bulkPunch", "Nothing to addUndo from History");
    assert.equal(await page.evaluate(() => document.getElementById("bulkPunch").disabled), true);
    await expectText(page, "#bulk .ba-vh[role=status]", "Nothing new on the list.");
    assert.equal(live(backend).length, 2);
    await shot(page, "slip-none.png");
  },
});

cases.push({
  name: "no signal at Add: the new stop is not added, its ticket is on Not added; the rest wait on the phone and go up after signal returns",
  async run({ page }) {
    const backend = await tripWith({ old: false, lines: [LINES[3], LINES[9]], folder: [FOLDER()[3], FOLDER()[10]] });
    await ready(page, backend);
    await addTickets(page);
    await slipUp(page);
    await expectText(page, "#bulkPunch", "Add 2 ticketsUndo from History");
    // No signal: the phone knows (offline), so the new stop is provably not sent.
    await page.context().setOffline(true);
    await page.click("#bulkPunch");
    await added(page);
    await expectText(page, "#bulk .ba-done-h", "1 ticket added to 1 stop.");
    assert.ok((await texts(page, "#bulk .ba-done-s")).some((t) => /They wait on this phone and go up when there is signal\.$/.test(t)), "it says the picture waits");
    const notAdded = await texts(page, "#bulk .ba-next.is-flat:not(.ba-wait) > div");
    assert.ok(notAdded.includes("T010 · Lantern boatthe stop wasn’t added: no signal"), JSON.stringify(notAdded));
    assert.equal(calls(backend, "addStop").length, 0, "never sent");
    assert.equal(backend.fake.tables.Stops.some((s) => s.title === "Lantern boat"), false);
    await expectText(page, "#bulk .sl.is-done .sl-c", "D3 Sat 10:00Aonami Museum1 picture waiting for signal");
    // Signal back: the waiting one goes up, after a reload too.
    backend.failWith = "network";
    await page.context().setOffline(false);
    await page.reload();
    await page.clock.resume();
    await until(() => page.evaluate(() => !!globalThis.__matTest && document.querySelectorAll("#rc .rc-row").length > 0), "the app draws again", 10000);
    backend.failWith = null;
    await page.evaluate(() => globalThis.__matTest.store.checkRev());
    await until(() => live(backend).some((r) => r.planner_id === "T004:aaaaaaaaaa04"), "the waiting picture goes up", 20000);
    assert.equal(live(backend).some((r) => r.planner_id === "T010:aaaaaaaaaa10"), false);
  },
});

cases.push({
  name: "a file gone from the list and a cancelled line open on Leave its pictures on; taking them off is said on the key",
  async run({ page }) {
    const lines = [LINES[3], A({ ticket_id: "T011", start_date: "2026-12-17", start_time: "21:00", title: "Night bus", status: "Cancelled" }), A({ ticket_id: "T012", start_date: "2026-12-18", start_time: "12:00", title: "Ferry lunch" })];
    const folder = [FOLDER()[3]];
    const backend = await tripWith({ old: false, lines, folder });
    for (const [id, stop, from, page] of [["oldbus000001", TW, "T011:bbbbbbbbbbb1", 1], ["oldbus000002", TW, "T011:bbbbbbbbbbb1", 2], ["oldlunch0001", HF, "T012:ccccccccccc1", 1], ["oldlunch0002", HF, "T012:ccccccccccc1", 2]]) {
      assert.equal((await as(backend, "Mo", "addTicket", { ticket: { ...tied(id, stop, from), page } })).ok, true);
    }
    await ready(page, backend);
    await addTickets(page);
    await slipUp(page);
    const qs = await page.evaluate(() => [...document.querySelectorAll("#bulk .sl-q")].map((q) => [q.querySelector(".sl-qt b").textContent, [...q.querySelectorAll(".sl-o")].map((o) => o.textContent + (o.classList.contains("is-on") ? " ●" : ""))]));
    assert.deepEqual(qs, [
      ["Night bus: cancelled in the list", ["Leave its pictures onnothing changes ●", "Take its 2 pictures offthey can be put back from History"]],
      ["Ferry lunch: a file is gone from the list", ["Leave its pictures onnothing changes ●", "Take its 2 pictures offthey can be put back from History"]],
    ]);
    await expectText(page, "#bulkPunch", "Add 1 ticketUndo from History");
    await page.click('#bulk [data-lchoice="off:T011|off"]');
    await expectText(page, "#bulkPunch", "Add 1 ticket, take 2 pictures offUndo from History");
    await page.click('#bulk [data-cell="stop:' + MU + '"]');
    await expectText(page, "#bulkPunch", "Take 2 pictures offUndo from History");
    await page.click("#bulkPunch");
    await added(page);
    await expectText(page, "#bulk .ba-done-h", "2 pictures taken off.");
    await expectText(page, "#bulk .sl-batch", /^\d\d:\d\d2 pictures taken off, from the listalso in HistoryTake all back$/);
    assert.deepEqual(live(backend).map((r) => r.id).sort(), ["oldlunch0001", "oldlunch0002"]);
    // The museum tapped out: remembered on this phone only now. Ferry lunch kept its
    // pictures only because its dot opened there: not remembered, it asks again (fix round 1).
    const skip = JSON.parse(await page.evaluate(() => localStorage.getItem("mat.listSkip")));
    assert.deepEqual(skip, ["T004:aaaaaaaaaa04"]);
  },
});

// Fix round 1, I3: a filled "Replace" never takes the old pictures off when the new file is not in.
cases.push({
  name: "a newer file the backend refuses: the filled Replace leaves the two old pictures on",
  async run({ page }) {
    const backend = await tripWith({ lines: [LINES[8]], folder: [FOLDER()[9]] });
    const real = backend.handle;
    backend.handle = async (body) => {
      if (body.action === "addTicket" && body.args && body.args.ticket && body.args.ticket.from === "T009:aaaaaaaaaa09") return { ok: false, error: "bad_input", message: "That picture can’t go on this stop." };
      return real.call(backend, body);
    };
    await ready(page, backend);
    await addTickets(page);
    await slipUp(page);
    await expectText(page, "#bulkPunch", "Add 1 ticketUndo from History");
    await page.click("#bulkPunch");
    await added(page);
    assert.equal(calls(backend, "removeTicket").length, 0, "nothing taken off");
    assert.deepEqual(live(backend).map((r) => r.id).sort(), ["oldwalk00001", "oldwalk00002"]);
    await expectText(page, "#bulk .ba-done-h", "No ticket was added.");
  },
});

cases.push({
  name: "a newer file that can't be made into pictures here, on a full stop (old ones off first): the old pictures stay on",
  async run({ page }) {
    const pdf = { h: H(9), name: "T009 night walk.pdf", mime: "application/pdf", print: "aaaaaaaaaa09", data: b64(pdfBytes(2)) };
    const backend = await tripWith({ lines: [LINES[8]], folder: [pdf] });
    // Kogane Garden holds the two old pictures and 6 more: adding first would pass 8.
    for (let i = 0; i < 6; i++) assert.equal((await as(backend, "Ajen", "addTicket", { ticket: { id: "handkg00000" + i, stop: KG, who: "", seat: "", page: i + 3, mime: "image/png", w: 60, h: 60, data: smallPng } })).ok, true);
    await ready(page, backend);
    await addTickets(page);
    await slipUp(page);
    await expectText(page, '#bulk [data-lchoice="chg:T009|first"]', /^Take the old pictures off, then add the new file/);
    assert.equal(await page.getAttribute('#bulk [data-lchoice="chg:T009|first"]', "aria-checked"), "true");
    // This phone can no longer turn a page into a picture.
    await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function (done) { setTimeout(() => done(null), 0); }; });
    await page.click("#bulkPunch");
    await added(page);
    assert.equal(calls(backend, "removeTicket").length, 0, "the old ones are not taken off");
    assert.equal(live(backend).filter((r) => r.stop === KG).length, 8);
    assert.ok((await texts(page, "#bulk .ba-next.is-flat > div")).some((t) => /couldn’t be made into pictures here/.test(t)));
  },
});

// Fix round 2, R1: a kept line he tapped can be saved when there is nothing to add, and stops asking.
cases.push({
  name: "only a line whose file is gone: tapping Leave its pictures on and Save my choices stops it asking; a new file for it asks again",
  async run({ page }) {
    const lines = [A({ ticket_id: "T012", start_date: "2026-12-18", start_time: "12:00", title: "Ferry lunch" })];
    const backend = await tripWith({ old: false, lines, folder: [] });
    for (const [pid, page_] of [["oldlunch0001", 1], ["oldlunch0002", 2]]) assert.equal((await as(backend, "Mo", "addTicket", { ticket: { ...tied(pid, HF, "T012:ccccccccccc1"), page: page_ } })).ok, true);
    await ready(page, backend);
    await page.dispatchEvent("#youBtn", "click");
    await until(() => sheetUp(page, "you"), "You opens");
    await until(() => visible(page, "#setListNt"), "the notice shows");
    await expectText(page, "#setListNt", /1 ticket changed in the list/);
    await page.dispatchEvent("#setBulk", "click");
    await slipUp(page);
    await expectText(page, '#bulk [data-card="off:T012"] .sl-qt b', "Ferry lunch: a file is gone from the list");
    await expectText(page, "#bulkPunch", "Nothing to addUndo from History");
    assert.equal(await page.evaluate(() => document.getElementById("bulkPunch").disabled), true);
    // Tapping the filled dot is his choice: the key saves it.
    await page.click('#bulk [data-lchoice="off:T012|keep"]');
    await expectText(page, "#bulkPunch", "Save my choices");
    assert.equal(await skipNow(page), null, "nothing remembered before the key");
    const sent = backend.requests.length;
    await page.click("#bulkPunch");
    await until(() => page.evaluate(() => !document.getElementById("bulk").classList.contains("is-open")), "the sheet closes");
    await expectText(page, "#bulk .ba-vh[role=status]", "Saved. These won’t ask again.");
    assert.equal(backend.requests.slice(sent).some((b) => b.action === "removeTicket" || b.action === "addTicket"), false, "nothing sent");
    assert.deepEqual(JSON.parse(await skipNow(page)), ["keep:T012:ccccccccccc1"]);
    // The next look: no notice, nothing to ask.
    await page.dispatchEvent("#youBtn", "click");
    await until(() => sheetUp(page, "you"), "You opens again");
    await until(() => page.evaluate(() => document.getElementById("setListNt").hidden), "the notice is gone");
    await page.dispatchEvent("#setBulk", "click");
    await slipUp(page);
    await expectText(page, "#bulk .sl-none", "Nothing new on the list.");
    // The list changes: a new file for that line asks again.
    backend.fake.desk.answer = desk([png(12, "T012 ferry lunch.png", 12)]);
    backend.now += 60 * 1000;
    await page.click("#bulkByHand");
    await page.click("#bulkCheckList");
    await slipUp(page);
    await expectText(page, '#bulk [data-card="chg:T012"] .sl-qt b', "Ferry lunch: the list has one more file");
    assert.deepEqual(live(backend).map((r) => r.id).sort(), ["oldlunch0001", "oldlunch0002"]);
  },
});

// Fix round 2, R4: an Add whose only effect was a new stop says so and can be taken back.
cases.push({
  name: "the new stop is added but its ticket refused: the stop is said by name, the row can take it back",
  async run({ page }) {
    const backend = await tripWith({ old: false, lines: [LINES[9]], folder: [FOLDER()[10]] });
    const real = backend.handle;
    backend.handle = async (body) => {
      if (body.action === "addTicket" && body.args && body.args.ticket && body.args.ticket.from === "T010:aaaaaaaaaa10") return { ok: false, error: "bad_input", message: "That picture can’t go on this stop." };
      return real.call(backend, body);
    };
    await ready(page, backend);
    await addTickets(page);
    await slipUp(page);
    await page.click("#bulkPunch");
    await added(page);
    const stopId = calls(backend, "addStop")[0].args.stop.id;
    await expectText(page, "#bulk .ba-done-h", "No ticket was added.");
    assert.ok((await texts(page, "#bulk .ba-done-s")).includes("Added the stop Lantern boat on Day 7."));
    await expectText(page, "#bulk .sl-batch", /^\d\d:\d\d1 stop added from the listalso in HistoryTake all back$/);
    await page.click("#bulkTakeBack");
    await until(() => page.evaluate(() => /taken back at \d\d:\d\d/.test(document.querySelector("#bulk .sl-batch").textContent)), "the row reads taken back", 20000);
    assert.equal(backend.fake.tables.Stops.find((x) => x.id === stopId).deleted_at !== "", true, "the stop is removed");
  },
});

cases.push({
  name: "the picker row: choosing a stop fills its dot, the first option gives the likely answer back; the ticket lands on that stop",
  async run({ page }) {
    const backend = await tripWith({ old: false, lines: [LINES[9]], folder: [FOLDER()[10]] });
    await ready(page, backend);
    await addTickets(page);
    await slipUp(page);
    const nostop = await page.evaluate(() => document.querySelector("#bulk .sl-q").dataset.card);
    const sel = '#bulk [data-pick-for="' + nostop + '"]';
    await expectText(page, sel + " option", "Put it on another stop…");
    await page.selectOption(sel, TW);
    await until(() => page.evaluate((s) => document.querySelector(s).closest(".sl-o").classList.contains("is-on"), sel), "the picker's dot fills");
    assert.equal(await page.getAttribute('#bulk [data-choice="' + nostop + '|0"]', "aria-checked"), "false");
    await expectText(page, "#bulkPunch", "Add 1 ticketUndo from History");
    await page.selectOption(sel, "");
    await until(() => page.evaluate((n) => document.querySelector('#bulk [data-choice="' + n + '|0"]').getAttribute("aria-checked") === "true", nostop), "back to the likely answer");
    await page.selectOption(sel, TW);
    await until(() => page.evaluate((s) => document.querySelector(s).value, sel).then((v) => v === TW), "kept after the redraw");
    await page.click("#bulkPunch");
    await added(page);
    assert.equal(calls(backend, "addStop").length, 0);
    assert.deepEqual(live(backend).map((r) => [r.stop, r.planner_id]), [[TW, "T010:aaaaaaaaaa10"]]);
  },
});

cases.push({
  name: "not the owner: Add tickets opens the by-hand screen; no slip, no look at the list, no batch row",
  async run({ page }) {
    const backend = await tripWith();
    await ready(page, backend, "Ajen");
    await addTickets(page);
    await until(() => page.evaluate(() => !!document.querySelector("#bulk .ba-empty")), "the by-hand screen");
    assert.equal(await page.evaluate(() => !!document.querySelector("#bulk .sl")), false);
    assert.equal(await page.evaluate(() => !!document.getElementById("bulkCheckList")), false);
    await expectText(page, "#bulk .ba-say", /Nothing is sent until 入鋏\.$/);
    assert.equal(calls(backend, "listTickets").length, 0);
    await page.dispatchEvent("#bulkTop", "click");
    await openHistory(page);
    await until(() => page.evaluate(() => document.querySelectorAll("#tape .tp-row").length > 0), "History draws");
    assert.equal(await page.evaluate(() => document.querySelectorAll("#tape .tp-batch").length), 0);
  },
});

cases.push({
  name: "Choose files by hand shows the by-hand screen; Check the list now returns to the slip",
  async run({ page }) {
    const backend = await tripWith();
    await ready(page, backend);
    await addTickets(page);
    await slipUp(page);
    const nostop = await page.evaluate(() => document.querySelector("#bulk .sl-q").dataset.card);
    await page.click('#bulk [data-out="' + nostop + '"]');
    const sent = backend.requests.filter((b) => b.action !== "listTickets" && b.action !== "listTicketFile").length;
    await page.click("#bulkByHand");
    await until(() => page.evaluate(() => !!document.querySelector("#bulk .ba-empty")), "the by-hand screen");
    assert.equal(await page.evaluate(() => !!document.querySelector("#bulk .sl")), false);
    await expectText(page, "#bulk .sheet-top", "Add tickets一括Cancel");
    assert.equal(await skipNow(page), null, "nothing remembered");
    assert.equal(backend.requests.filter((b) => b.action !== "listTickets" && b.action !== "listTicketFile").length, sent, "nothing sent");
    backend.now += 60 * 1000;
    await page.click("#bulkCheckList");
    await slipUp(page);
    await expectText(page, "#bulkPunch", "Add 10 ticketsUndo from History");
  },
});

cases.push({
  name: "keyboard: Tab to a cell, Space toggles it; arrows move a question's dot; focus stays put after the redraw",
  mobile: false,
  async run({ page }) {
    const backend = await tripWith();
    await ready(page, backend);
    await addTickets(page);
    await slipUp(page);
    const aq = "stop:" + AQ;
    await page.focus("#bulkTop");
    for (let i = 0; i < 10 && (await page.evaluate(() => document.activeElement.dataset.cell || "")) !== aq; i++) await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.cell), aq, "Tab reaches the first cell");
    await page.keyboard.press("Space");
    await until(() => page.evaluate((k) => document.querySelector('[data-cell="' + k + '"]').getAttribute("aria-pressed") === "false", aq), "Space leaves it out");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.cell), aq, "focus stays on the cell");
    await expectText(page, "#bulkPunch", "Add 7 ticketsUndo from History");
    await page.keyboard.press("Space");
    await until(() => page.evaluate((k) => document.querySelector('[data-cell="' + k + '"]').getAttribute("aria-pressed") === "true", aq), "Space puts it back");
    // The newer file's question: its filled dot is the one Tab reaches; Down moves the dot.
    await page.focus('#bulk [data-lchoice="chg:T009|replace"]');
    await page.keyboard.press("ArrowDown");
    await until(() => page.evaluate(() => document.querySelector('[data-lchoice="chg:T009|keep"]').getAttribute("aria-checked") === "true"), "Down moves the dot");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.lchoice), "chg:T009|keep", "focus follows the dot");
    await expectText(page, "#bulkPunch", "Add 9 ticketsUndo from History");
    await page.keyboard.press("ArrowUp");
    await until(() => page.evaluate(() => document.querySelector('[data-lchoice="chg:T009|replace"]').getAttribute("aria-checked") === "true"), "Up moves it back");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.lchoice), "chg:T009|replace");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-card="chg:T009"] button.sl-o')].map((b) => b.tabIndex)), [0, -1]);
  },
});

cases.push({
  name: "320 px: one column, the foot stacked, no sideways scroll",
  viewport: { width: 320, height: 568 },
  async run({ page }) {
    const backend = await tripWith();
    await ready(page, backend);
    await addTickets(page);
    await slipUp(page);
    assert.deepEqual(await noSideways(page), { doc: true, sheet: true, over: [] });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#bulk .sl-grid")).gridTemplateColumns.split(" ").length), 1);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#bulk .sl-ft")).flexDirection), "column");
    await shot(page, "slip-320.png");
  },
});

cases.push({
  name: "390: the key stays at the bottom of the sheet while the slip scrolls; adding shows its progress",
  async run({ page }) {
    const backend = await tripWith();
    await ready(page, backend);
    await addTickets(page);
    await slipUp(page);
    const stuck = () => page.evaluate(() => {
      const s = document.getElementById("bulk").getBoundingClientRect();
      const k = document.getElementById("bulkPunch").getBoundingClientRect();
      return k.bottom <= s.bottom + 0.5 && k.top >= s.top;
    });
    await page.evaluate(() => { document.getElementById("bulk").scrollTop = 0; });
    assert.equal(await stuck(), true, "in view at the top of the slip");
    // Hold the new stop's request: the progress line shows while it waits.
    const real = backend.handle;
    let release;
    const gate = new Promise((r) => (release = r));
    backend.handle = async (body) => {
      if (body.action === "addStop") await gate;
      return real.call(backend, body);
    };
    await page.click("#bulkPunch");
    await expectText(page, "#bulk .ba-prog", /^Adding the stop…A stop from the list, so its ticket has somewhere to go\./, 20000);
    await expectText(page, "#bulk .sheet-top", "Add ticketsaddingDone");
    await shot(page, "adding.png");
    release();
    await added(page);
  },
});

cases.push({
  name: "1440 x 900: the sheet sits in the You pane as today, the slip whole",
  viewport: { width: 1440, height: 900 },
  mobile: false,
  async run({ page }) {
    const backend = await tripWith();
    await ready(page, backend);
    await addTickets(page);
    await slipUp(page);
    assert.deepEqual(await noSideways(page), { doc: true, sheet: true, over: [] });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#bulk .sl-grid")).gridTemplateColumns.split(" ").length), 2);
    await shot(page, "desktop.png");
  },
});

module.exports = cases;
