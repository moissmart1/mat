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
const { SEED, PLAN, makeBackend, open, until, text, expectText, visible } = require("./helpers.cjs");
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
  return !!t && t.textContent.startsWith(n + (n === 1 ? " file" : " files")) && !document.querySelector("#bulk .ba-prog");
}, n), n + " files sorted", 20000);
const added = (page) => until(() => page.evaluate(() => !!document.querySelector("#bulk .ba-done-h")), "added", 30000);
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
    await expectText(page, "#bulk .ba-empty", "Drop the ticket files here.PDFs and pictures, all at once. Add the list (.csv) too if you have it: fewer to check by hand.Choose filesPDF · PNG · JPGChoose list.csv, optional");
    await expectText(page, "#bulk .ba-say", /Nothing is sent until 入鋏\.$/);
    assert.equal(await page.evaluate(() => document.activeElement.id), "bulkTop");
    await shot(page, "phone-empty.png");

    await page.setInputFiles("#bulkList", file("Tickets.csv", "text/csv", Buffer.from(LIST, "utf8")));
    await expectText(page, "#bulkChooseList", "List chosen9 lines");
    const before = backend.requests.length;
    await page.setInputFiles("#bulkFiles", FILES());
    await sorted(page, 9);
    assert.equal(backend.requests.slice(before).some((b) => b.action === "addTicket" || b.action === "updateStop"), false, "nothing is sent before 入鋏");
    await expectText(page, "#bulk .sheet-top i", "9 files · list of 9");
    await expectText(page, "#bulk .ba-band", "帯5 sortedD2 to D3 · 3 stops · 3 one eachUntie ›");
    // The top ticket of the bundle: the stop with one each, three seals.
    await expectText(page, "#bulk .ba-bundle .ba-k", "D3 Sat 09:00 · one each");
    await expectText(page, "#bulk .ba-bundle .ba-n", "Meiji Shrine");
    assert.equal(await page.evaluate(() => document.querySelectorAll("#bulk .ba-bundle .ba-seal").length), 3);
    // The first card: the file with no line, two stops by its name.
    await expectText(page, "#bulk .ba-h", /^検札 To look at · 1 of 2/);
    await expectText(page, "#bulk .ba-card .ba-q", "どちら？ Which one?not on the list");
    await expectText(page, "#bulk .ba-card .ba-ask", "Two stops have this name.");
    await expectText(page, "#bulk .ba-card .ba-fn", "A picture");
    await expectText(page, "#bulk .ba-card .ba-cap", "hoshizora ropeway.png");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#bulk .ba-card [data-choice]")].map((b) => b.textContent)), ["D4Sun 11:00Hoshizora Ropeway, up›", "D5Mon 10:30Hoshizora Ropeway, night run›"]);
    await until(() => page.evaluate(() => { const i = document.querySelector("#bulk .ba-card .ba-pv img"); return !!i && i.naturalWidth > 0; }), "the card shows the file's picture");
    await expectText(page, "#bulk .ba-next", "T019 · Lantern boatno stop on D7");
    // The quiet lines.
    const asides = await page.evaluate(() => [...document.querySelectorAll("#bulk .ba-aside")].map((a) => a.textContent.replace(/\s+/g, " ").trim()));
    assert.deepEqual(asides, [
      "外1 file isn’t a ticket file: T020 cal.ics. Left out.",
      "止1 not active on the list: T010 · Old booking (cancelled). Left out.",
      "表1 line on the list has no file here.",
      "120Pictures on the trip: 0 now, 6 after this.",
    ]);
    await expectText(page, "#bulkPunch", "入鋏Add 5 nowthe 2 not looked at stay out · on every phone›");
    await toTop(page);
    await shot(page, "phone-sorted.png");

    // Untie: the bundle as a list by day; a line opens to change it, then tie again.
    await page.click('#bulk [data-act="untie"]');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#bulk .ba-lh")].map((h) => h.textContent)), ["D2 Fri", "D3 Sat"]);
    assert.equal(await page.evaluate(() => document.querySelectorAll("#bulk .ba-line").length), 5);
    await page.click("#bulk .ba-lh + .ba-line .ba-lb");
    await until(() => page.evaluate(() => !!document.querySelector("#bulk .ba-ed select")), "the line opens");
    assert.equal(await page.evaluate(() => document.querySelector("#bulk .ba-ed select").value), SENSO);
    await page.click('#bulk [data-act="untie"]');

    // The card: D4.
    await page.click('#bulk .ba-card [data-choice$="|0"]');
    await expectText(page, "#bulk .ba-h", /^検札 To look at · 2 of 2/);
    await expectText(page, "#bulk .ba-card .ba-ask", "No stop on Day 7 at 19:30.");
    await expectText(page, "#bulk .ba-card .ba-fn", "T019 · Lantern boat");
    await expectText(page, "#bulk .ba-band", /^帯6 sorted/);
    await expectText(page, "#bulkPunch", "入鋏Add 6 nowthe 1 not looked at stays out · on every phone›");

    // 入鋏: through the same path as a stop's Edit sheet.
    await page.click("#bulkPunch");
    await added(page);
    await expectText(page, "#bulk .sheet-top", "Add ticketspunchedDone");
    await expectText(page, "#bulk .ba-done-h", "6 tickets added to 4 stops.");
    await expectText(page, "#bulk .ba-done-s", "7 pictures, kept in the trip. Every phone shows them on its stubs the next time it opens MAT with signal.");
    await expectText(page, "#bulk .ba-band", "済6 punched in5 sorted + 1 you checkedSee all ›");
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
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#bulk .ba-next > div")].map((d) => d.textContent)), [
      "T019 · Lantern boatleft out: no stop on D7",
      "T010 · Old bookingon the list as cancelled",
      "T020 cal.icsnot a ticket file",
    ]);
    await expectText(page, "#bulk .ba-h", "Not added · 3");
    await page.click('#bulk [data-act="seeall"]');
    assert.equal(await page.evaluate(() => document.querySelectorAll("#bulk .ba-list .ba-line").length), 6);
    await page.click('#bulk [data-act="seeall"]');
    await toTop(page);
    await shot(page, "phone-added.png");
    // Open Day 2: the Days screen on Senso-ji's day, the sheets gone.
    await expectText(page, "#bulkOpenDay", "Open Day 2 · see the stubs");
    await page.click("#bulkOpenDay");
    await until(() => page.evaluate(() => !document.getElementById("bulk").classList.contains("is-open") && !document.getElementById("you").classList.contains("is-open") && document.getElementById("vDays").classList.contains("is-active")), "Days shows");
    // Done starts afresh.
    await openBulk(page);
    await expectText(page, "#bulk .ba-done-h", "6 tickets added to 4 stops.");
    await page.click("#bulkTop");
    await openBulk(page);
    await until(() => page.evaluate(() => !!document.querySelector("#bulk .ba-empty")), "empty again");
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
    assert.match(await text(page, "#bulk .ba-aside"), /^既1 already there: T001 · Shibuya Sky deck is on Shibuya Sky\. Left out\.$/);
    await expectText(page, "#bulkPunch", /^入鋏Add 1 now/);
    // No signal now.
    backend.failWith = "network";
    await page.context().setOffline(true);
    const sent = calls(backend, "addTicket").length;
    await page.click("#bulkPunch");
    await added(page);
    await expectText(page, "#bulk .ba-done-h", "1 ticket added to 1 stop.");
    await expectText(page, "#bulk .ba-done-s", /They wait on this phone and go up when there is signal\.$/);
    // Fix round 1 (I2): which ones wait, by name.
    await expectText(page, "#bulk .ba-wait", "T005 · Meiji Shrineon this phone, goes up when there is signal");
    assert.ok((await page.evaluate(() => [...document.querySelectorAll("#bulk .ba-h")].map((h) => h.textContent))).includes("Waiting for signal · 1"));
    // The stop's details cannot go with no signal (not queued, as a stop's Edit sheet): said, by stop.
    await expectText(page, "#bulk .ba-next:not(.ba-wait)", "T001 · Shibuya Skyalready thereMeiji Shrinedetails not filled: no signal");
    assert.equal(backend.fake.tables.Tickets.length, 1, "nothing reached the trip");
    assert.equal(calls(backend, "addTicket").length - sent, 0, "with failWith network nothing is received");
    // Its data is kept on the phone, only its fields in mat.queue.
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("mat.queue") || "[]").filter((o) => o.ticket && o.ticket.who === "Mo" && !("data" in o.ticket)).length), 1);
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
    await expectText(page, "#bulk .ba-aside.is-warn", "表The list has no start_date column, so it wasn’t used. The files are matched without it.");
    await page.setInputFiles("#bulkFiles", [
      file("T001 Sky order.png", "image/png", pngBytes(360, 360, 11)),
      file("hoshizora ropeway with a very long file name to wrap.png", "image/png", pngBytes(320, 320, 30)),
    ]);
    await sorted(page, 2);
    // Without the list both are cards; Shibuya Sky's file shares the stop's name.
    await expectText(page, "#bulk .ba-h", /^検札 To look at · 1 of 2/);
    await expectText(page, "#bulk .ba-card .ba-ask", "Is it for this stop?");
    await expectText(page, "#bulkPunch", /^入鋏Nothing to add yet/);
    assert.equal(await page.evaluate(() => document.getElementById("bulkPunch").disabled), true);
    assert.deepEqual(await noSideways(page), { doc: true, sheet: true, over: [] });
    // Another stop, or leave it out: the picker.
    await page.click('#bulk [data-other]');
    await page.selectOption("#bulk [data-pick-for]", RW2);
    await page.click("#bulk [data-put]");
    await expectText(page, "#bulk .ba-h", /^検札 To look at · 2 of 2/);
    assert.deepEqual(await noSideways(page), { doc: true, sheet: true, over: [] });
    await toTop(page);
    await shot(page, "phone-320.png");
    await page.click('#bulk [data-other]');
    await page.click("#bulk .ba-card [data-out]");
    await expectText(page, "#bulk .ba-h", "検札 All 2 looked at");
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
    await expectText(page, "#bulk .ba-band", /^帯5 sorted/);
    await toTop(page);
    await shot(page, "desktop.png");
    // The card from the keyboard: Tab reaches its choices; Enter picks.
    await page.focus("#bulk .ba-card [data-choice]");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.choice || ""), (await page.evaluate(() => document.querySelectorAll("#bulk .ba-card [data-choice]")[1].dataset.choice)));
    await page.keyboard.press("Enter");
    await expectText(page, "#bulk .ba-band", /^帯6 sorted/);
    assert.deepEqual(await noSideways(page), { doc: true, sheet: true, over: [] });
    await page.focus("#bulkPunch");
    await page.keyboard.press("Enter");
    await added(page);
    await expectText(page, "#bulk .ba-done-h", "6 tickets added to 4 stops.");
    assert.equal(backend.fake.tables.Tickets.filter((r) => r.stop === RW2).length, 1, "the second choice, D5");
    // Escape closes it; focus back on You.
    await page.keyboard.press("Escape");
    await until(() => page.evaluate(() => !document.getElementById("bulk").classList.contains("is-open") && document.activeElement.id === "youBtn"), "closed, focus on You");
  },
});

// ---------- fix round 1 ----------

const listFile = () => file("Tickets.csv", "text/csv", Buffer.from(LIST, "utf8"));
const keptIds = (page) => page.evaluate(() => new Promise((resolve) => {
  const r = indexedDB.open("mat-tickets", 1);
  r.onsuccess = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains("pics")) return resolve([]);
    const q = db.transaction("pics", "readonly").objectStore("pics").getAllKeys();
    q.onsuccess = () => {
      db.close();
      resolve(q.result.map(String));
    };
    q.onerror = () => resolve([]);
  };
  r.onerror = () => resolve([]);
}));
const queued = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("mat.queue") || "[]").filter((o) => o.ticket).map((o) => ({ id: o.ticket.id, data: "data" in o.ticket })));
const drawn = (page) => until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0 || document.querySelectorAll("#rail .pg").length > 0), "the app draws");

cases.push({
  name: "fix round 1, I2: no signal halfway through, MAT closed and opened again, then signal: every confirmed ticket arrives exactly once",
  async run({ page }) {
    const backend = makeBackend(TRIP, { now: NOON12 });
    await ready(page, { backend });
    await openBulk(page);
    await page.setInputFiles("#bulkList", listFile());
    // Five sure ones, six pictures (the temple PDF has two pages).
    await page.setInputFiles("#bulkFiles", FILES().slice(0, 5));
    await sorted(page, 5);
    await expectText(page, "#bulkPunch", /^入鋏Add 5 now/);
    // Two pictures land; the third leaves and no reply comes (a tunnel). Every ticket request is counted while it is out,
    // and each takes a moment, so two at once would show (fix round 2, R1: never more than one in flight, first run and after the reload).
    const handle = backend.handle;
    let landed = 0;
    let out = 0;
    let most = 0;
    let sent = 0;
    const held = [];
    backend.handle = async (body) => {
      if (body.action !== "addTicket") return handle(body);
      sent += 1;
      out += 1;
      most = Math.max(most, out);
      try {
        await new Promise((r) => setTimeout(r, 40));
        if (landed >= 2) {
          held.push(body);
          throw new Error("network");
        }
        landed += 1;
        return await handle(body);
      } finally {
        out -= 1;
      }
    };
    await page.click("#bulkPunch");
    await until(() => held.length === 1, "two land, the third is on its way and gets no reply", 20000);
    await until(async () => (await queued(page)).length === 4, "the four not landed are in mat.queue");
    assert.equal(sent, 3, "after the first no-reply the rest wait on the phone without being sent");
    assert.equal(most, 1, "at most one ticket request in flight (first run)");
    // Every one confirmed is on the phone before any reply: in mat.queue without its data, its picture in the keep.
    const q = await queued(page);
    assert.equal(q.some((x) => x.data), false, "no picture data in mat.queue");
    const kept = await keptIds(page);
    for (const x of q) assert.ok(kept.includes(x.id), "kept: " + x.id);
    await until(() => page.evaluate(() => !!document.querySelector("#bulk .ba-done-h")), "the run ends");
    assert.equal(backend.fake.tables.Tickets.length, 2);
    // No signal now; MAT is closed and opened again.
    backend.failWith = "network";
    await page.reload();
    await page.clock.resume();
    await drawn(page);
    assert.deepEqual((await queued(page)).map((x) => x.id).sort(), q.map((x) => x.id).sort(), "still waiting after the reload");
    // One request that left before the close lands late on the backend.
    assert.equal((await backend.fake(held[0])).ok, true);
    // Signal back: the waiting ones go up one after another.
    backend.failWith = null;
    landed = -100;
    sent = 0;
    await page.evaluate(() => globalThis.__matTest.store.checkRev());
    await until(async () => backend.fake.tables.Tickets.length === 6 && (await queued(page)).length === 0, "every confirmed ticket arrives", 20000);
    await page.evaluate(() => globalThis.__matTest.store.checkRev());
    await page.evaluate(() => globalThis.__matTest.store.idle());
    assert.equal(most, 1, "at most one ticket request in flight (after the reload)");
    assert.ok(sent >= 3, "the waiting ones were sent after the reload");
    const rows = backend.fake.tables.Tickets;
    assert.equal(rows.length, 6, "exactly once");
    assert.equal(new Set(rows.map((r) => r.id)).size, 6);
    assert.deepEqual(rows.map((r) => [r.stop, r.who, r.seat, String(r.page)]).sort(), [
      [MEIJI, "Ajen", "1B", "1"], [MEIJI, "Mo", "1A", "1"], [MEIJI, "Trenton", "1C", "1"],
      [SKY, "", "", "1"], [SENSO, "", "", "1"], [SENSO, "", "", "2"],
    ].sort());
    // Each with its picture's data.
    for (const r of rows) assert.ok(backend.fake.tables.TicketData.some((d) => d.ticket === r.id), "data for " + r.id);
  },
});

cases.push({
  name: "fix round 2, R1: with signal and slow replies the pictures go up one at a time, in order, the next only after the last one's reply",
  async run({ page }) {
    const backend = makeBackend(TRIP, { now: NOON12 });
    await ready(page, { backend });
    await openBulk(page);
    await page.setInputFiles("#bulkList", listFile());
    await page.setInputFiles("#bulkFiles", FILES().slice(0, 5));
    await sorted(page, 5);
    const handle = backend.handle;
    let out = 0;
    let most = 0;
    let begun = 0;
    let replied = 0;
    let early = 0;
    backend.handle = async (body) => {
      if (body.action !== "addTicket") return handle(body);
      // A request that starts before the one before it was answered is a second one in flight.
      if (begun !== replied) early += 1;
      begun += 1;
      out += 1;
      most = Math.max(most, out);
      try {
        await new Promise((r) => setTimeout(r, 60));
        return await handle(body);
      } finally {
        out -= 1;
        replied += 1;
      }
    };
    await page.click("#bulkPunch");
    await until(() => page.evaluate(() => !!document.querySelector("#bulk .ba-done-h")), "the run ends", 30000);
    assert.equal(begun, 6, "six pictures, six requests");
    assert.equal(most, 1, "never two ticket requests in flight");
    assert.equal(early, 0, "each request starts after the last was answered");
    assert.equal(backend.fake.tables.Tickets.length, 6);
    assert.equal(new Set(backend.fake.tables.Tickets.map((r) => r.id)).size, 6);
  },
});

cases.push({
  name: "fix round 1, I1: a stop's details filled on another phone while the pictures go up are not overwritten; it is listed",
  async run({ page }) {
    const backend = makeBackend(TRIP, { now: NOON12 });
    await ready(page, { backend });
    await openBulk(page);
    await page.setInputFiles("#bulkList", listFile());
    await page.setInputFiles("#bulkFiles", FILES().slice(0, 4));
    await sorted(page, 4);
    // The pictures are held on their way until another phone has filled Shibuya Sky's reference.
    const handle = backend.handle;
    let release;
    const gate = new Promise((r) => (release = r));
    let seen = 0;
    backend.handle = async (body) => {
      if (body.action === "addTicket") {
        seen += 1;
        await gate;
      }
      return handle(body);
    };
    await page.click("#bulkPunch");
    await until(() => seen >= 1, "the pictures leave", 20000);
    const other = await handle({ key: "test-key", actor: "Ajen", action: "updateStop", args: { id: SKY, patch: { tkRef: "OTHER-1" } } });
    assert.equal(other.ok, true, other.message);
    await page.evaluate(() => globalThis.__matTest.store.checkRev());
    await until(() => page.evaluate((id) => globalThis.__matTest.store.state.stops.find((s) => s.id === id).tkRef === "OTHER-1", SKY), "this phone has the other phone's reference");
    const edits = calls(backend, "updateStop").length;
    release();
    await added(page);
    backend.handle = handle;
    const st = (id) => backend.fake.tables.Stops.find((s) => s.id === id);
    assert.equal(st(SKY).tk_ref, "OTHER-1", "never overwritten");
    assert.equal(st(SKY).tk_name, "", "a stop changed since the sort gets none of the list's details");
    assert.equal(st(MEIJI).tk_ref, "GD-7700", "an unchanged stop's empty field is filled");
    assert.equal(calls(backend, "updateStop").length - edits, 1);
    assert.ok((await page.evaluate(() => [...document.querySelectorAll("#bulk .ba-next > div")].map((d) => d.textContent))).includes("Shibuya Skydetails not filled: changed on another phone"));
    await expectText(page, "#bulk .ba-aside.is-warn", "控Details not filled can be added from the stop’s Edit sheet.");
    assert.equal(backend.fake.tables.Tickets.length, 4);
  },
});

const SECRET_WORDS = ["T001", "T019", "Shibuya Sky deck", "Lantern", "Sky order", "hoshizora", "QZ48810", "AJEN", "cal.ics", "Tickets.csv"];
for (const how of ["Forget this phone", "a refused key"]) {
  cases.push({
    name: "fix round 1, I3: " + how + " with a sort held and the sheet closed: nothing of it stays, its pictures' addresses revoked",
    async run({ page }) {
      const backend = makeBackend(TRIP, { now: NOON12 });
      await ready(page, { backend });
      await openBulk(page);
      await page.setInputFiles("#bulkList", listFile());
      await page.setInputFiles("#bulkFiles", FILES());
      await sorted(page, 9);
      await until(() => page.evaluate(() => { const i = document.querySelector("#bulk .ba-card .ba-pv img"); return !!i && i.naturalWidth > 0; }), "the card's picture shows");
      const srcs = await page.evaluate(() => [...document.querySelectorAll("#bulk img")].map((i) => i.src).filter((u) => u.startsWith("blob:")));
      assert.ok(srcs.length > 0);
      // Closed: what it sorted is kept behind the close.
      await page.keyboard.press("Escape");
      await until(() => page.evaluate(() => !document.getElementById("bulk").classList.contains("is-open")), "closed");
      assert.ok((await page.evaluate(() => document.getElementById("bulk").textContent)).includes("T019"));
      await page.evaluate(() => {
        window.__revoked = [];
        const real = URL.revokeObjectURL;
        URL.revokeObjectURL = (u) => {
          window.__revoked.push(u);
          return real.call(URL, u);
        };
      });
      if (how === "a refused key") {
        backend.failWith = "bad_key";
        await page.evaluate(() => globalThis.__matTest.store.checkRev());
      } else {
        await page.dispatchEvent("#youBtn", "click");
        await until(() => page.evaluate(() => document.getElementById("you").classList.contains("is-open")), "settings open");
        await page.dispatchEvent("#setForget", "click");
        await page.dispatchEvent("#setForget", "click");
      }
      await until(() => visible(page, "#gate"), "the no-key screen shows", 10000);
      await until(() => page.evaluate(() => document.querySelector("#bulk .ba-body").childNodes.length === 0), "the sheet's body is emptied");
      const t = await page.evaluate(() => document.getElementById("bulk").textContent);
      for (const w of SECRET_WORDS) assert.equal(t.includes(w), false, w + " is still in the sheet");
      assert.equal(await page.evaluate(() => document.querySelectorAll("#bulk img").length), 0);
      assert.equal(await page.evaluate(() => document.getElementById("bulkFiles").files.length + document.getElementById("bulkList").files.length), 0);
      assert.equal(await page.evaluate(() => document.getElementById("bulk").classList.contains("is-open")), false);
      const revoked = await page.evaluate(() => window.__revoked);
      for (const u of srcs) assert.ok(revoked.includes(u), "revoked: " + u);
    },
  });
}

// What the worker sends each open page when a new version takes over (as tests/e2e/update.e2e.cjs).
const announce = (page) => page.evaluate(() => new Promise((resolve) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => resolve(true);
  navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "mat-new-version" }, ports: [ch.port2] }));
  setTimeout(() => resolve(false), 500);
}));
const markPage = (page) => page.evaluate(() => { window.__notReloaded = true; });
const reloaded = (page) => page.evaluate(() => window.__notReloaded !== true).catch(() => true);
// Pictures are held where the phone makes them (canvas.toBlob) until let go.
const holdPictures = (page) => page.evaluate(() => {
  const real = HTMLCanvasElement.prototype.toBlob;
  window.__held = [];
  HTMLCanvasElement.prototype.toBlob = function (...a) {
    window.__held.push(() => real.apply(this, a));
  };
  window.__letGo = () => {
    HTMLCanvasElement.prototype.toBlob = real;
    for (const f of window.__held.splice(0)) f();
  };
});

cases.push({
  name: "fix round 1, I4: with the sheet closed, a new release waits while files are read; it reloads once they are",
  async run({ page }) {
    const backend = makeBackend(TRIP, { now: NOON12 });
    await ready(page, { backend });
    await openBulk(page);
    await holdPictures(page);
    await page.setInputFiles("#bulkFiles", [file("T008 Temple e-ticket.pdf", "application/pdf", pdfBytes(2))]);
    await until(() => page.evaluate(() => window.__held.length > 0), "reading is under way", 20000);
    await page.keyboard.press("Escape");
    await until(() => page.evaluate(() => !document.getElementById("phone").classList.contains("bulk-open")), "closed");
    await markPage(page);
    assert.equal(await announce(page), true, "the page answers");
    await page.clock.fastForward(7000);
    assert.equal(await reloaded(page), false, "not while files are read");
    await page.evaluate(() => window.__letGo());
    await until(() => reloaded(page), "then it reloads", 15000);
    await drawn(page);
  },
});

cases.push({
  name: "fix round 1, I4: with the sheet closed, a new release waits while adding; it reloads once the add is done, every picture in",
  async run({ page }) {
    const backend = makeBackend(TRIP, { now: NOON12 });
    await ready(page, { backend });
    await openBulk(page);
    await page.setInputFiles("#bulkList", listFile());
    await page.setInputFiles("#bulkFiles", [file("T008 Temple e-ticket.pdf", "application/pdf", pdfBytes(2))]);
    await sorted(page, 1);
    await holdPictures(page);
    await page.click("#bulkPunch");
    await until(() => page.evaluate(() => window.__held.length > 0), "the pages are being made into pictures", 20000);
    await page.keyboard.press("Escape");
    await until(() => page.evaluate(() => !document.getElementById("phone").classList.contains("bulk-open")), "closed");
    assert.equal(await page.evaluate(() => globalThis.__matTest.store.busy()), false, "nothing is sending yet");
    await markPage(page);
    assert.equal(await announce(page), true, "the page answers");
    await page.clock.fastForward(7000);
    assert.equal(await reloaded(page), false, "not while adding");
    await page.evaluate(() => window.__letGo());
    await until(() => reloaded(page), "then it reloads", 20000);
    await drawn(page);
    await until(() => backend.fake.tables.Tickets.length === 2, "both pages went in", 15000);
  },
});

module.exports = cases;
