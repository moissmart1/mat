// 一括 Add tickets (js/views/bulkadd.js, js/bulk.js): many files and the list
// at once, opened from You. The sure ones go in a bundle, the odd ones are
// cards, 入鋏 adds them through the same addTicket path as a stop's Edit
// sheet. Everything is made up: the files are drawn here
// (tests/e2e/pictures.cjs), the list's operators, references and seats are
// invented, the people are the test trip's own. The plan is
// tests/fixtures/plan.json with two made-up ropeway stops; 13:20 on Dec 12.
// Pictures are taken only when MAT_TAB_SHOTS names an output folder.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { SEED, PLAN, makeBackend, open, until, text, expectText } = require("./helpers.cjs");
const { pngBytes, pdfBytes } = require("./pictures.cjs");

const SHOTS = process.env.MAT_TAB_SHOTS || "";
const NOON12 = Date.parse("2026-12-12T13:20:00+09:00");
const SENSO = "planstop1101";
const MEIJI = "planstop1201";
const SKY = "planstop1203";
const RW1 = "bulkstop-rw1";
const RW2 = "bulkstop-rw2";

const STOPS = PLAN.stops.map((s) => (s.id === SENSO ? { ...s, tkRef: "KEEP-1" } : s)).concat([
  { id: RW1, date: "2026-12-13", time: "11:00", title: "Hoshizora Ropeway, up" },
  { id: RW2, date: "2026-12-14", time: "10:30", title: "Hoshizora Ropeway, night run" },
]);
const TRIP = { ...SEED, ...PLAN, stops: STOPS };

const HEAD = "ticket_id,booking_key,start_date,start_time,end_date,end_time,type,title,provider,confirmation,traveler,ticket_ref,seat,holder,how_to_use,file_url,manage_url,deadline,deadline_what,notes,status,book_now_no,updated,added_by";
const COLS = HEAD.split(",");
const row = (o) => COLS.map((c) => {
  const v = o[c] === undefined ? "" : String(o[c]);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}).join(",");
const LIST = "﻿" + [HEAD,
  row({ ticket_id: "T001", start_date: "2026-12-12", start_time: "14:00", type: "activity", title: "Shibuya Sky deck", provider: "Sky Co", confirmation: "QZ48810", traveler: "ALL", holder: "AJEN", notes: "two lines,\nwith a comma", status: "active" }),
  row({ ticket_id: "T005", start_date: "2026-12-12", start_time: "09:00", type: "activity", title: "Garden entry", provider: "Garden Co", confirmation: "GD-7700", traveler: "Mo", seat: "1A", status: "active" }),
  row({ ticket_id: "T006", start_date: "2026-12-12", start_time: "09:00", type: "activity", title: "Garden entry", provider: "Garden Co", confirmation: "GD-7700", traveler: "Ajen", seat: "1B", status: "active" }),
  row({ ticket_id: "T007", start_date: "2026-12-12", start_time: "09:00", type: "activity", title: "Garden entry", provider: "Garden Co", confirmation: "GD-7700", traveler: "Trenton", seat: "1C", status: "active" }),
  row({ ticket_id: "T008", start_date: "2026-12-11", start_time: "10:00", type: "activity", title: "Temple walk", provider: "Tour Co", ticket_ref: "TR99120", traveler: "ALL", status: "active" }),
  row({ ticket_id: "T009", start_date: "2026-12-15", start_time: "10:00", type: "train", title: "No file for this one", status: "active" }),
  row({ ticket_id: "T010", start_date: "2026-12-12", start_time: "14:00", type: "activity", title: "Old booking", status: "cancelled" }),
  row({ ticket_id: "T019", start_date: "2026-12-16", start_time: "19:30", type: "activity", title: "Lantern boat", status: "active" }),
  row({ ticket_id: "T020", start_date: "2026-12-13", start_time: "11:00", type: "activity", title: "Calendar entry", status: "active" }),
].join("\r\n") + "\r\n";

const file = (name, mimeType, buffer) => ({ name, mimeType, buffer });
const FILES = () => [
  file("T001 Sky order.png", "image/png", pngBytes(360, 360, 11)),
  file("T005 Mo.png", "image/png", pngBytes(300, 300, 15)),
  file("T006 Ajen.png", "image/png", pngBytes(300, 300, 16)),
  file("T007 Trenton.png", "image/png", pngBytes(300, 300, 17)),
  file("T008 Temple e-ticket.pdf", "application/pdf", pdfBytes(2)),
  file("T010 old.png", "image/png", pngBytes(300, 300, 20)),
  file("hoshizora ropeway.png", "image/png", pngBytes(320, 320, 30)),
  file("T019 Lantern boat.png", "image/png", pngBytes(300, 300, 19)),
  file("T020 cal.ics", "text/calendar", Buffer.from("BEGIN:VCALENDAR\nEND:VCALENDAR\n")),
];

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.screenshot({ path: SHOTS + "/" + name });
}

async function ready(page, opts = {}) {
  const backend = await open(page, { nowMs: NOON12, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0 || document.querySelectorAll("#rail .pg").length > 0), "the app draws");
  // pdf.js and the sheet wait on timers: let the page's clock run.
  await page.clock.resume();
  return backend;
}
const sheetUp = (page, id) => page.evaluate((id) => {
  const s = document.getElementById(id);
  return !!s && s.classList.contains("is-open") && Math.abs(s.getBoundingClientRect().bottom - innerHeight) < 1;
}, id);
async function openBulk(page) {
  await page.dispatchEvent("#youBtn", "click");
  await until(() => sheetUp(page, "you"), "You opens");
  await until(() => page.evaluate(() => !document.getElementById("setBulk").hidden), "the Add tickets row shows");
  await page.evaluate(() => document.getElementById("setBulk").scrollIntoView({ block: "center" }));
  await page.dispatchEvent("#setBulk", "click");
  await until(() => sheetUp(page, "bulk"), "Add tickets opens");
}
const sorted = (page, n) => until(() => page.evaluate((n) => {
  const t = document.querySelector("#bulk .sheet-top i");
  return !!t && t.textContent.startsWith(n + " files") && !document.querySelector("#bulk .bk-prog");
}, n), n + " files sorted", 20000);
const added = (page) => until(() => page.evaluate(() => !!document.querySelector("#bulk .bk-done-h")), "added", 30000);
const noSideways = (page) => page.evaluate(() => {
  const s = document.getElementById("bulk");
  const over = [...s.querySelectorAll("*")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 0.5).map((e) => e.className || e.tagName);
  return { doc: document.scrollingElement.scrollWidth <= innerWidth, sheet: s.scrollWidth <= s.clientWidth, over };
});
const calls = (backend, action) => backend.requests.filter((b) => b.action === action);
const toTop = (page) => page.evaluate(() => { document.getElementById("bulk").scrollTop = 0; });

const cases = [];

cases.push({
  name: "390: the list and nine files; the sure ones bundle, a card answered and one left; 入鋏 adds through addTicket, facts only where empty; Not added; Open Day",
  async run({ page }) {
    const backend = makeBackend(TRIP, { now: NOON12 });
    await ready(page, { backend });
    await openBulk(page);
    // Empty: the drop zone, the two keys, nothing sent.
    assert.equal(await page.getAttribute("#bulk", "role"), "dialog");
    await expectText(page, "#bulk .sheet-top", "Add tickets一括Cancel");
    await expectText(page, "#bulk .bk-empty", "Drop the ticket files here.PDFs and pictures, all at once. Add the list (.csv) too if you have it: fewer to check by hand.Choose filesPDF · PNG · JPGChoose list.csv, optional");
    await expectText(page, "#bulk .bk-say", /Nothing is sent until 入鋏\.$/);
    assert.equal(await page.evaluate(() => document.activeElement.id), "bulkTop");
    await shot(page, "phone-empty.png");

    await page.setInputFiles("#bulkList", file("Tickets.csv", "text/csv", Buffer.from(LIST, "utf8")));
    await expectText(page, "#bulkChooseList", "List chosen9 lines");
    const before = backend.requests.length;
    await page.setInputFiles("#bulkFiles", FILES());
    await sorted(page, 9);
    assert.equal(backend.requests.slice(before).some((b) => b.action === "addTicket" || b.action === "updateStop"), false, "nothing is sent before 入鋏");
    await expectText(page, "#bulk .sheet-top i", "9 files · list of 9");
    await expectText(page, "#bulk .bk-band", "帯5 sortedD2 to D3 · 3 stops · 3 one eachUntie ›");
    // The top ticket of the bundle: the stop with one each, three seals.
    await expectText(page, "#bulk .bk-bundle .k", "D3 Sat 09:00 · one each");
    await expectText(page, "#bulk .bk-bundle .n", "Meiji Shrine");
    assert.equal(await page.evaluate(() => document.querySelectorAll("#bulk .bk-bundle .bk-seal").length), 3);
    // The first card: the file with no line, two stops by its name.
    await expectText(page, "#bulk .bk-h", /^検札 To look at · 1 of 2/);
    await expectText(page, "#bulk .bk-card .q", "どちら？ Which one?not on the list");
    await expectText(page, "#bulk .bk-card .ask", "Two stops have this name.");
    await expectText(page, "#bulk .bk-card .cap", "hoshizora ropeway.png");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#bulk .bk-card [data-choice]")].map((b) => b.textContent)), ["D4Sun 11:00Hoshizora Ropeway, up›", "D5Mon 10:30Hoshizora Ropeway, night run›"]);
    await until(() => page.evaluate(() => { const i = document.querySelector("#bulk .bk-card .pv img"); return !!i && i.naturalWidth > 0; }), "the card shows the file's picture");
    await expectText(page, "#bulk .bk-next", "T019 · Lantern boatno stop on D7");
    // The quiet lines.
    const asides = await page.evaluate(() => [...document.querySelectorAll("#bulk .bk-aside")].map((a) => a.textContent.replace(/\s+/g, " ").trim()));
    assert.deepEqual(asides, [
      "外 1 file isn’t a ticket file: T020 cal.ics. Left out.",
      "止 1 not active on the list: T010 · Old booking (cancelled). Left out.",
      "表 1 line on the list has no file here.",
      "120 Pictures on the trip: 0 now, 6 after this.",
    ]);
    await expectText(page, "#bulkPunch", "入鋏Add 5 nowthe 2 not looked at stay out · on every phone›");
    await toTop(page);
    await shot(page, "phone-sorted.png");

    // Untie: the bundle as a list by day; a line opens to change it, then tie again.
    await page.click('#bulk [data-act="untie"]');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#bulk .bk-lh")].map((h) => h.textContent)), ["D2 Fri", "D3 Sat"]);
    assert.equal(await page.evaluate(() => document.querySelectorAll("#bulk .bk-line").length), 5);
    await page.click("#bulk .bk-lh + .bk-line .bk-lb");
    await until(() => page.evaluate(() => !!document.querySelector("#bulk .bk-ed select")), "the line opens");
    assert.equal(await page.evaluate(() => document.querySelector("#bulk .bk-ed select").value), SENSO);
    await page.click('#bulk [data-act="untie"]');

    // The card: D4.
    await page.click('#bulk .bk-card [data-choice$="|0"]');
    await expectText(page, "#bulk .bk-h", /^検札 To look at · 2 of 2/);
    await expectText(page, "#bulk .bk-card .ask", "No stop on Day 7 at 19:30.");
    await expectText(page, "#bulk .bk-card .fn", "T019 · Lantern boat");
    await expectText(page, "#bulk .bk-band", /^帯6 sorted/);
    await expectText(page, "#bulkPunch", "入鋏Add 6 nowthe 1 not looked at stays out · on every phone›");

    // 入鋏: through the same path as a stop's Edit sheet.
    await page.click("#bulkPunch");
    await added(page);
    await expectText(page, "#bulk .sheet-top", "Add ticketspunchedDone");
    await expectText(page, "#bulk .bk-done-h", "6 tickets added to 4 stops.");
    await expectText(page, "#bulk .bk-done-s", "7 pictures, kept in the trip. Every phone shows them on its stubs the next time it opens MAT with signal.");
    await expectText(page, "#bulk .bk-band", "済6 punched in5 sorted + 1 you checkedSee all ›");
    assert.equal(calls(backend, "addTicket").length, 7);
    const rows = backend.fake.tables.Tickets.map((r) => [r.stop, r.who, r.seat, String(r.page)]).sort();
    assert.deepEqual(rows, [
      [MEIJI, "Ajen", "1B", "1"], [MEIJI, "Mo", "1A", "1"], [MEIJI, "Trenton", "1C", "1"],
      [SKY, "", "", "1"], [SENSO, "", "", "1"], [SENSO, "", "", "2"], [RW1, "", "", "1"],
    ].sort());
    // The facts: only where the stop's own field was empty.
    assert.equal(calls(backend, "updateStop").length, 2);
    const st = (id) => backend.fake.tables.Stops.find((s) => s.id === id);
    assert.deepEqual([st(SKY).tk_ref, st(SKY).tk_name], ["QZ48810", "AJEN"]);
    assert.equal(st(MEIJI).tk_ref, "GD-7700");
    assert.equal(st(SENSO).tk_ref, "KEEP-1", "never overwritten");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#bulk .bk-next > div")].map((d) => d.textContent)), [
      "T019 · Lantern boatnot looked at: no stop on D7",
      "T010 · Old bookingon the list as cancelled",
      "T020 cal.icsnot a ticket file",
    ]);
    await expectText(page, "#bulk .bk-h", "Not added · 3");
    await page.click('#bulk [data-act="seeall"]');
    assert.equal(await page.evaluate(() => document.querySelectorAll("#bulk .bk-list .bk-line").length), 6);
    await page.click('#bulk [data-act="seeall"]');
    await toTop(page);
    await shot(page, "phone-added.png");
    // Open Day 2: the Days screen on Senso-ji's day, the sheets gone.
    await expectText(page, "#bulkOpenDay", "Open Day 2 · see the stubs");
    await page.click("#bulkOpenDay");
    await until(() => page.evaluate(() => !document.getElementById("bulk").classList.contains("is-open") && !document.getElementById("you").classList.contains("is-open") && document.getElementById("vDays").classList.contains("is-active")), "Days shows");
    // Done starts afresh.
    await openBulk(page);
    await expectText(page, "#bulk .bk-done-h", "6 tickets added to 4 stops.");
    await page.click("#bulkTop");
    await openBulk(page);
    await until(() => page.evaluate(() => !!document.querySelector("#bulk .bk-empty")), "empty again");
    assert.equal(await text(page, "#bulk .sheet-top i"), "一括");
  },
});

cases.push({
  name: "already there is left out; with no signal the pictures wait on the phone and go up when it returns",
  async run({ page }) {
    const backend = makeBackend(TRIP, { now: NOON12 });
    await ready(page, { backend });
    const sky = () => file("T001 Sky order.png", "image/png", pngBytes(360, 360, 11));
    const listFile = () => file("Tickets.csv", "text/csv", Buffer.from(LIST, "utf8"));
    await openBulk(page);
    await page.setInputFiles("#bulkList", listFile());
    await page.setInputFiles("#bulkFiles", [sky()]);
    await sorted(page, 1);
    await page.click("#bulkPunch");
    await added(page);
    assert.equal(backend.fake.tables.Tickets.length, 1);
    await page.click("#bulkTop");

    // The same file again, with another: the first is 既, already there.
    await openBulk(page);
    await page.setInputFiles("#bulkList", listFile());
    await page.setInputFiles("#bulkFiles", [sky(), file("T005 Mo.png", "image/png", pngBytes(300, 300, 15))]);
    await sorted(page, 2);
    assert.match(await text(page, "#bulk .bk-aside"), /^既 1 already there: T001 · Shibuya Sky deck is on Shibuya Sky\. Left out\.$/);
    await expectText(page, "#bulkPunch", /^入鋏Add 1 now/);
    // No signal now.
    backend.failWith = "network";
    await page.context().setOffline(true);
    const sent = calls(backend, "addTicket").length;
    await page.click("#bulkPunch");
    await added(page);
    await expectText(page, "#bulk .bk-done-h", "1 ticket added to 1 stop.");
    await expectText(page, "#bulk .bk-done-s", /They wait on this phone and go up when there is signal\.$/);
    await expectText(page, "#bulk .bk-next", "T001 · Shibuya Skyalready there");
    assert.equal(backend.fake.tables.Tickets.length, 1, "nothing reached the trip");
    assert.equal(calls(backend, "addTicket").length - sent, 0, "with failWith network nothing is received");
    // Its data is kept on the phone, only its fields in mat.queue.
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("mat.queue") || "[]").filter((o) => o.api === "addTicket" && !o.args.ticket.data).length), 1);
    // Signal back: it goes up.
    backend.failWith = null;
    await page.context().setOffline(false);
    await until(() => backend.fake.tables.Tickets.length === 2, "the waiting picture goes up", 15000);
    const mo = backend.fake.tables.Tickets.find((r) => r.who === "Mo");
    assert.deepEqual([mo.stop, mo.seat], [MEIJI, "1A"]);
  },
});

cases.push({
  name: "320: fits with no sideways scroll, empty and sorted; a refused list says so and the files are matched without it",
  viewport: { width: 320, height: 568 },
  async run({ page }) {
    const backend = makeBackend(TRIP, { now: NOON12 });
    await ready(page, { backend });
    await openBulk(page);
    assert.deepEqual(await noSideways(page), { doc: true, sheet: true, over: [] });
    await page.setInputFiles("#bulkList", file("bad.csv", "text/csv", Buffer.from("ticket_id,title\nT001,Thing\n")));
    await expectText(page, "#bulk .bk-aside.is-warn", "表 The list has no start_date column, so it wasn’t used. The files are matched without it.");
    await page.setInputFiles("#bulkFiles", [
      file("T001 Sky order.png", "image/png", pngBytes(360, 360, 11)),
      file("hoshizora ropeway with a very long file name to wrap.png", "image/png", pngBytes(320, 320, 30)),
    ]);
    await sorted(page, 2);
    // Without the list both are cards; Shibuya Sky's file shares the stop's name.
    await expectText(page, "#bulk .bk-h", /^検札 To look at · 1 of 2/);
    await expectText(page, "#bulk .bk-card .ask", "Is it for this stop?");
    await expectText(page, "#bulkPunch", /^入鋏Nothing to add yet/);
    assert.equal(await page.evaluate(() => document.getElementById("bulkPunch").disabled), true);
    assert.deepEqual(await noSideways(page), { doc: true, sheet: true, over: [] });
    // Another stop, or leave it out: the picker.
    await page.click('#bulk [data-other]');
    await page.selectOption("#bulk [data-pick-for]", RW2);
    await page.click("#bulk [data-put]");
    await expectText(page, "#bulk .bk-h", /^検札 To look at · 2 of 2/);
    assert.deepEqual(await noSideways(page), { doc: true, sheet: true, over: [] });
    await toTop(page);
    await shot(page, "phone-320.png");
    await page.click('#bulk [data-other]');
    await page.click("#bulk .bk-card [data-out]");
    await expectText(page, "#bulk .bk-h", "検札 All 2 looked at");
    await expectText(page, "#bulkPunch", "入鋏Add 1 nowon every phone›");
  },
});

cases.push({
  name: "1440: the sheet in the Money pane; files and the list dropped on it; a card answered from the keyboard; 入鋏 from the keyboard",
  viewport: { width: 1440, height: 900 },
  mobile: false,
  async run({ page }) {
    const backend = makeBackend(TRIP, { now: NOON12 });
    await ready(page, { backend });
    await page.click("#youBtn");
    await until(() => sheetUp(page, "you"), "You opens");
    await page.focus("#setBulk");
    await page.keyboard.press("Enter");
    await until(() => sheetUp(page, "bulk"), "Add tickets opens");
    const box = await page.evaluate(() => {
      const s = document.getElementById("bulk").getBoundingClientRect();
      const m = document.getElementById("vMoney").getBoundingClientRect();
      return { left: Math.round(s.left - m.left), right: Math.round(m.right - s.right) };
    });
    assert.ok(Math.abs(box.left) <= 2 && Math.abs(box.right) <= 2, "over the Money pane: " + JSON.stringify(box));
    // Dropped: a DataTransfer of the list and five files.
    const drop = FILES().slice(0, 7).concat([file("Tickets.csv", "text/csv", Buffer.from(LIST, "utf8"))]).map((f) => ({ name: f.name, type: f.mimeType, b64: f.buffer.toString("base64") }));
    await page.evaluate((list) => {
      const dt = new DataTransfer();
      for (const f of list) {
        const bin = atob(f.b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        dt.items.add(new File([u], f.name, { type: f.type }));
      }
      const s = document.getElementById("bulk");
      s.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      s.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, drop);
    await sorted(page, 7);
    await expectText(page, "#bulk .sheet-top i", "7 files · list of 9");
    await expectText(page, "#bulk .bk-band", /^帯5 sorted/);
    // The card from the keyboard: Tab reaches its choices; Enter picks.
    await page.focus("#bulk .bk-card [data-choice]");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.choice || ""), (await page.evaluate(() => document.querySelectorAll("#bulk .bk-card [data-choice]")[1].dataset.choice)));
    await page.keyboard.press("Enter");
    await expectText(page, "#bulk .bk-band", /^帯6 sorted/);
    assert.deepEqual(await noSideways(page), { doc: true, sheet: true, over: [] });
    await toTop(page);
    await shot(page, "desktop.png");
    await page.focus("#bulkPunch");
    await page.keyboard.press("Enter");
    await added(page);
    await expectText(page, "#bulk .bk-done-h", "6 tickets added to 4 stops.");
    assert.equal(backend.fake.tables.Tickets.filter((r) => r.stop === RW2).length, 1, "the second choice, D5");
    // Escape closes it; focus back on You.
    await page.keyboard.press("Escape");
    await until(() => page.evaluate(() => !document.getElementById("bulk").classList.contains("is-open") && document.activeElement.id === "youBtn"), "closed, focus on You");
  },
});

module.exports = cases;
