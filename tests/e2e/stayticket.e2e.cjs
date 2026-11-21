// A ticket on a stay (S2 鍵札, the key tag on the hook): the hotel card's
// Edit opens Edit stay (js/views/staysheet.js), where a PDF and the four
// booking fields are added; the tag then hangs on the card, on the 宿泊 line
// and on the hook at the top of the Tickets tab; Show booking holds it up
// (js/views/stub.js). Bulk add puts a lodging line on its stay, or offers to
// add the stay. Everything is made up: the guest house, the airport inn, the
// reference, the name on the booking and the files (tests/e2e/pictures.cjs).
// Pictures are taken only when MAT_TAB_SHOTS names an output folder.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { SEED, PLAN, makeBackend, open, advance, until, text, expectText, visible } = require("./helpers.cjs");
const { png, pngBytes, pdfBytes } = require("./pictures.cjs");

const SHOTS = process.env.MAT_TAB_SHOTS || "";
const KEY = "test-key";
const INN = "planstay0001";
const RIVER = "planstay0002";
const SKY = "planstop1203";
const D10 = "2026-12-10";
const EVE10 = Date.parse("2026-12-10T17:05:00+09:00");
const NOON11 = Date.parse("2026-12-11T13:00:00+09:00");

const STAYS = [
  { id: INN, name: "Tsubame-so Guest House", nameJp: "つばめ荘", addressJp: "東京都台東区 つばめ町 1-2-3", firstNight: "2026-12-10", lastNight: "2026-12-12", note: "Check-in from 15:00. After 22:00 the front door wants the keypad code.", place: "Tsubame-so Guest House", link: "https://example.test/booking" },
  { id: RIVER, name: "Ryokan by the river", firstNight: "2026-12-13", lastNight: "2026-12-15" },
];
const BOOKED = { tkRef: "TSB-4827-KQ", tkName: "M. EXAMPLE", tkPeople: "3", tkRoom: "Tatami room for 3" };
const trip = (stays = STAYS) => ({ ...SEED, ...PLAN, stays });
const withBooking = () => trip(STAYS.map((s) => (s.id === INN ? { ...s, ...BOOKED } : s)));

const file = (name, mimeType, buffer) => ({ name, mimeType, buffer });
const tk = (date) => '#rail .pg[data-date="' + date + '"]';
const isOpen = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  return !!el && el.classList.contains("is-open");
}, id);
const tixUp = (page) => page.evaluate(() => !document.getElementById("tix").hidden && !!document.querySelector("#tix .kt-label"));
const calls = (backend, action) => backend.requests.filter((b) => b.action === action);

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  // Sheets and tabs slide and fade: the picture is taken once they are still.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || (a.effect && a.effect.getTiming().iterations === Infinity)), null, { timeout: 2000 }).catch(() => {});
  await page.screenshot({ path: SHOTS + "/" + name });
}

async function ready(page, opts = {}) {
  const backend = await open(page, { tab: "days", nowMs: EVE10, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}
async function openCard(page, date = D10) {
  await page.click(tk(date) + " .tk-stay");
  await until(() => isOpen(page, "stay"), "the hotel card opens");
}
async function openEdit(page) {
  await page.evaluate(() => document.querySelector("#stay .r-edit").scrollIntoView({ block: "center" }));
  await page.click("#stay .r-edit");
  await until(async () => (await isOpen(page, "staySheet")) && !(await isOpen(page, "stay")), "Edit stay opens in the card's place");
}
async function goTickets(page) {
  await until(() => visible(page, "#ticketsBtn"), "the Tickets key is in the bar");
  await page.click("#ticketsBtn");
  await until(() => page.evaluate(() => document.getElementById("vTickets").classList.contains("is-active") && !!document.querySelector("#vTickets .pc-case")), "the pass case shows");
}
// A picture on the stay, added as another phone would.
async function stayPicture(backend, id, page = 1, actor = "Ajen") {
  const r = await backend.handle({ key: KEY, actor, action: "addTicket", args: { ticket: { id, stay: INN, who: "", seat: "", page, mime: "image/png", w: 300, h: 300, data: png(300, 300, 40 + page) } } });
  assert.equal(r.ok, true, r.message);
}
async function stopPicture(backend, id) {
  const r = await backend.handle({ key: KEY, actor: "Ajen", action: "addTicket", args: { ticket: { id, stop: SKY, who: "", seat: "", page: 1, mime: "image/png", w: 300, h: 300, data: png(300, 300, 9) } } });
  assert.equal(r.ok, true, r.message);
}
// No sideways scroll anywhere, nor inside the given element.
const noSideways = (page, sel) => page.evaluate((s) => {
  const box = s ? document.querySelector(s) : null;
  const over = box ? [...box.querySelectorAll("*")].filter((e) => e.getClientRects().length && !e.closest(".kt-wrap") && e.getBoundingClientRect().right > innerWidth + 0.5).map((e) => e.className || e.tagName) : [];
  return { doc: document.scrollingElement.scrollWidth <= innerWidth, box: !box || box.scrollWidth <= box.clientWidth + 0.5, over };
}, sel);

const cases = [];

cases.push({
  name: "390: no booking, the card has Edit and no tag; Edit stay adds a PDF and the four fields; the tag on the card, the 宿泊 line and the hook; Show booking; Hang it back",
  viewport: { width: 390, height: 844 },
  async run({ page }) {
    const backend = makeBackend(trip(), { now: EVE10 });
    await ready(page, { backend });
    await page.clock.resume(); // pdf.js waits on timers, and the sheets slide
    // The 宿泊 line with no booking is as it always was.
    assert.equal(await page.evaluate((sel) => document.querySelector(sel + " .tk-stay").className, tk(D10)), "tk-stay");
    assert.equal(await page.evaluate((sel) => document.querySelector(sel + " .tk-stay").childElementCount, tk(D10)), 2);
    await openCard(page);
    // The card with no booking: Edit is the last key, no tag, no Show booking.
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#stay .r-btns > *")].map((b) => b.textContent)), ["地図 Map ↗", "Booking ↗", "Edit"]);
    assert.equal(await page.evaluate(() => !!document.querySelector("#stay .sy-hang, #stay .kt-line, #stay .sy-tkline, #stay .sy.has-tag")), false);
    assert.equal(await page.evaluate(() => !!document.querySelector("#stay .sy-nm .sy-name")), true);
    await shot(page, "card-plain.png");

    // Edit stay, in the card's place.
    await openEdit(page);
    assert.equal(await page.getAttribute("#staySheet", "aria-label"), "Edit stay");
    assert.equal(await page.evaluate(() => document.getElementById("phone").classList.contains("staysheet-open")), true);
    await expectText(page, "#staySheet .sheet-top", "Edit stay宿泊Done");
    await expectText(page, "#staySheet .st-day", "Tsubame-so Guest HouseDec 10 to 13 · 3 nights");
    await expectText(page, "#staySheet .st-say", "The name, address and nights come from the planner. Here you add the booking.");
    await expectText(page, "#staySheet .st-none", "No booking on this stay yet.");
    await expectText(page, "#staySheet .tkp-fh", "控Shown with the booking");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#staySheet .tkp-facts .st-f span")].map((s) => s.textContent)), ["Booking ref", "Name on booking", "People", "Room"]);
    assert.equal(await page.evaluate(() => document.querySelector("#staySheet #syNote").value), STAYS[0].note);
    assert.equal(await page.evaluate(() => !!document.querySelector("#staySheet .st-btns button:not(.st-save)")), false, "no Remove");
    await page.setInputFiles("#syTkFile", [file("Confirmation.pdf", "application/pdf", pdfBytes(2))]);
    await until(() => page.evaluate(() => document.querySelectorAll("#syTix .tkp-picked .file").length === 2), "the PDF's two pages are picked", 15000);
    await page.fill("#syTkRef", BOOKED.tkRef);
    await page.fill("#syTkName", BOOKED.tkName);
    await page.fill("#syTkPeople", BOOKED.tkPeople);
    await page.fill("#syTkRoom", BOOKED.tkRoom);
    await page.evaluate(() => { document.getElementById("staySheet").scrollTop = 0; });
    await shot(page, "edit.png");

    // Save: the four fields through saveStay (merge, only the patch), then the pictures with stay.
    const before = backend.requests.length;
    await page.click("#sySave");
    await until(async () => !(await isOpen(page, "staySheet")) && (await isOpen(page, "stay")), "Save closes Edit stay and the card is back", 20000);
    const sent = backend.requests.slice(before);
    const save = sent.findIndex((b) => b.action === "saveStay");
    assert.ok(save >= 0, "saveStay was sent");
    assert.deepEqual(sent[save].args, { stay: { id: INN, ...BOOKED }, merge: true });
    const adds = sent.map((b, i) => [b, i]).filter(([b]) => b.action === "addTicket");
    assert.equal(adds.length, 2);
    for (const [b, i] of adds) {
      assert.ok(i > save, "the pictures go after the stay is saved");
      assert.equal(b.args.ticket.stay, INN);
      assert.equal(b.args.ticket.stop, "");
    }
    const rows = backend.fake.tables.Tickets;
    assert.deepEqual(rows.map((r) => [r.stay, r.stop]), [[INN, ""], [INN, ""]]);
    const stayRow = backend.fake.tables.Stays.find((r) => r.id === INN);
    assert.deepEqual([stayRow.tk_ref, stayRow.tk_name, stayRow.tk_people, stayRow.tk_room, stayRow.name], [BOOKED.tkRef, BOOKED.tkName, BOOKED.tkPeople, BOOKED.tkRoom, "Tsubame-so Guest House"]);

    // The tag hangs on the card.
    await until(() => page.evaluate(() => !!document.querySelector("#stay .sy.has-tag .sy-nm .sy-hang .kt.sm")), "the tag hangs on the card");
    assert.equal(await page.getAttribute("#stay .sy-hang .kt-wrap", "aria-hidden"), "true");
    await expectText(page, "#stay .sy-hang .kt-ref", "予約番号TSB-4827-KQ");
    await expectText(page, "#stay .sy-hang .kt-nights", "1 / 3泊");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#stay .sy-hang .kt-notch i")].map((i) => i.className)), ["is-on", "", ""]);
    await expectText(page, "#stay .kt-line", "鍵札Show bookingNight 1 of 3 ›");
    await until(async () => (await text(page, "#stay .sy-tkline")) === "券2 pages · on this phone", "the pages are on this phone");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#stay .sy > *")].map((n) => n.className)).then((l) => l.slice(l.indexOf("drv"))), ["drv", "kt-line", "sy-tkline"]);
    assert.ok((await page.evaluate(() => document.querySelector("#stay .kt-line").getBoundingClientRect().height)) >= 56);
    await page.evaluate(() => { document.getElementById("stay").scrollTop = 0; });
    await shot(page, "card.png");

    // Show booking: the key tag off the hook, the reference, the sentence, the pages.
    await page.click("#stay .kt-line");
    await until(() => tixUp(page), "the booking is held up");
    assert.equal(await page.getAttribute("#tix .ov", "aria-label"), "Booking: Tsubame-so Guest House");
    await expectText(page, "#tix .oa-top", "鍵札 Off the hook · Thu Dec 10Hang it back");
    await expectText(page, "#tix .kt.big .kt-nm", "つばめ荘");
    await expectText(page, "#tix .kt.big .kt-nights", "第1夜 · Night 1 of 3");
    assert.equal(await page.getAttribute("#tix .kt-wrap", "aria-hidden"), "true");
    await expectText(page, "#tix .kt-label .stub-k", "予約Booking · Tsubame-so Guest HouseDec 10 to 13");
    await expectText(page, "#tix .ref-big small", "予約番号 Confirmation");
    await expectText(page, "#tix .ref-big b", "TSB-4827-KQ");
    await expectText(page, "#tix .ref-big p", "M. EXAMPLE の名前で、本日から3泊予約しています。");
    await expectText(page, "#tix .ref-big span", "We have a booking for 3 nights from today under M. EXAMPLE.");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#tix .facts > div")].map((d) => d.textContent)), ["お名前Name on bookingM. EXAMPLE", "人数In the room3", "部屋RoomTatami room for 3", "泊数Nights3泊 · Dec 10 to 13"]);
    await expectText(page, "#tix .pg-cap", "予約確認書 Confirmation, 2 pagesTap to enlarge");
    await until(() => page.evaluate(() => [...document.querySelectorAll("#tix .pages .stub-code img")].filter((i) => i.naturalWidth > 0).length === 2), "both pages show");
    await expectText(page, "#tix .stub-foot", "保存済On this phone. Works with no signal.3泊");
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#tix .pages")).gridTemplateColumns.split(" ").length), 2);
    await shot(page, "open.png");
    // Tap to enlarge, then back.
    await page.click("#tix .pages .stub-code");
    await until(() => page.evaluate(() => !!document.querySelector("#tix .zoom")), "a page is enlarged");
    await page.click("#tix .zoom-x");
    // Hang it back: focus goes back to Show booking.
    await page.click("#tix [data-close]");
    await until(() => page.evaluate(() => document.getElementById("tix").hidden), "the booking goes back");
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains("kt-line")), true);
    assert.equal(await isOpen(page, "stay"), true, "the card is still open under it");

    // The 宿泊 line: 券, the booking, and the key-tag chip with that ticket's night.
    await page.click("#stayDone");
    await until(async () => !(await isOpen(page, "stay")), "the card closes");
    const line = tk(D10) + " .tk-stay";
    await until(() => page.evaluate((sel) => !!document.querySelector(sel + ".has-tag .kt-chip"), line), "the chip on the 宿泊 line");
    assert.equal(await page.getAttribute(line, "aria-label"), "Tonight: Tsubame-so Guest House. Booking, night 1 of 3.");
    await expectText(page, line + " .tk-stay-n", "Tsubame-so Guest House");
    await expectText(page, line + " .r-fx", "券Booking · on this phone");
    await expectText(page, line + " .kt-chip", "1/ 3泊");
    await expectText(page, tk("2026-12-11") + " .tk-stay .kt-chip", "2/ 3泊");
    await expectText(page, tk("2026-12-13") + " .tk-stay", "宿泊TonightRyokan by the river");
    await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: "end" }), line);
    await shot(page, "day.png");

    // The Tickets tab: the hook, before the first foil, even with no stop ticket.
    await goTickets(page);
    await until(() => page.evaluate(() => !!document.querySelector("#vTickets .pc-case > .pc-hook:first-child")), "the hook is first in the case");
    await expectText(page, "#vTickets .pc-hk small", "今夜の宿 Tonight’s stay");
    await expectText(page, "#vTickets .pc-hk b", "Tsubame-so Guest House");
    await expectText(page, "#vTickets .pc-hk span", "On the hook every night you sleep there. Night 1 of 3.");
    await expectText(page, "#vTickets .pc-hkb", "鍵札 Show booking");
    await expectText(page, "#vTickets .pc-none", /^No tickets on any stop yet\./);
    assert.ok((await page.evaluate(() => document.querySelector("#vTickets .pc-hkb").getBoundingClientRect().height)) >= 44);
    await shot(page, "tab.png");
    await page.click("#vTickets .pc-hkb");
    await until(() => tixUp(page), "the hook's Show booking holds it up");
    await page.click("#tix [data-close]");
    await until(() => page.evaluate(() => document.getElementById("tix").hidden && document.activeElement.classList.contains("pc-hkb")), "Hang it back: focus on the hook's key");
  },
});

cases.push({
  name: "the hook on night 2 and at 01:00 the morning after the last night, not the day after; the window, pockets and counts as with no booking",
  async run({ page, newPhone }) {
    const backend = makeBackend(withBooking(), { now: NOON11 });
    await stayPicture(backend, "stayPicA00001");
    await stopPicture(backend, "stopPicA00001");
    await ready(page, { backend, nowMs: NOON11 });
    await goTickets(page);
    await until(() => page.evaluate(() => !!document.querySelector("#vTickets .pc-hook")), "the hook");
    await expectText(page, "#vTickets .pc-hk span", "On the hook every night you sleep there. Night 2 of 3.");
    await expectText(page, "#vTickets .pc-hook .kt-nights", "2 / 3泊");
    // The same trip with no booking: everything but the hook is the same.
    const other = await newPhone();
    const plain = makeBackend(trip(), { now: NOON11 });
    await stopPicture(plain, "stopPicA00001");
    await ready(other, { backend: plain, nowMs: NOON11 });
    await goTickets(other);
    const caseText = (p) => p.evaluate(() => {
      const c = document.querySelector("#vTickets .pc-case").cloneNode(true);
      const h = c.querySelector(".pc-hook");
      if (h) h.remove();
      return [c.textContent, document.querySelector("#vTickets .pc-bar").textContent, document.getElementById("ticketsBtn").textContent];
    });
    assert.equal(await other.evaluate(() => !!document.querySelector("#vTickets .pc-hook")), false);
    assert.deepEqual(await caseText(page), await caseText(other));
    // 01:00 on the morning after the last night (Dec 13): still last night's stay, night 3.
    await advance(page, backend, Date.parse("2026-12-13T01:00:00+09:00") - NOON11);
    await until(async () => (await text(page, "#vTickets .pc-hk span")) === "On the hook every night you sleep there. Night 3 of 3.", "night 3 at 01:00");
    // 09:00 that day: tonight is the river ryokan, with no booking: no hook.
    await advance(page, backend, 8 * 3600000);
    await until(() => page.evaluate(() => !document.querySelector("#vTickets .pc-hook")), "no hook the day after");
  },
});

cases.push({
  name: "no signal: Save is off with the sentence, the picked picture stays; a picture that can't go up waits on the phone and goes up later",
  async run({ page }) {
    const backend = makeBackend(trip(), { now: EVE10 });
    await ready(page, { backend });
    await openCard(page);
    await openEdit(page);
    await page.setInputFiles("#syTkFile", [file("booking.png", "image/png", pngBytes(320, 320, 33))]);
    await until(() => page.evaluate(() => document.querySelectorAll("#syTix .tkp-picked .file").length === 1), "the picture is picked", 15000);
    backend.failWith = "network";
    await advance(page, backend, 20000);
    await until(() => page.evaluate(() => globalThis.__matTest.store.state.online === false), "the app learns it is offline");
    await until(() => page.evaluate(() => document.getElementById("sySave").disabled), "Save is off");
    assert.ok((await text(page, "#staySheet")).includes("No signal. Stays need a connection."), await text(page, "#staySheet"));
    assert.equal(await page.evaluate(() => document.querySelectorAll("#syTix .tkp-picked .file").length), 1, "the picture stays picked");
    // Signal back, but the picture's own add gets no answer: it waits on the phone.
    backend.failWith = null;
    const real = backend.handle;
    let drop = true;
    backend.handle = async (body) => {
      if (drop && body.action === "addTicket") throw new Error("network");
      return real(body);
    };
    await advance(page, backend, 20000);
    await until(() => page.evaluate(() => !document.getElementById("sySave").disabled), "Save comes on with signal");
    await page.click("#sySave");
    await until(async () => !(await isOpen(page, "staySheet")) && (await isOpen(page, "stay")), "Edit stay closes; the card is back");
    assert.equal(backend.fake.tables.Tickets.length, 0);
    assert.equal(calls(backend, "saveStay").length, 0, "nothing typed: no saveStay");
    await until(() => page.evaluate(() => (globalThis.__matTest.store.state.tickets || []).some((t) => t.stay === "planstay0001")), "the picture is on the phone, on the stay");
    assert.ok((await page.evaluate(() => localStorage.getItem("mat.queue"))).includes("planstay0001"), "waiting in mat.queue with its stay");
    // The card shows the booking from the waiting picture.
    await until(() => page.evaluate(() => !!document.querySelector("#stay .kt-line")), "the tag hangs from the waiting picture");
    drop = false;
    await advance(page, backend, 21000);
    await until(() => backend.fake.tables.Tickets.length === 1, "it goes up later");
    assert.deepEqual([backend.fake.tables.Tickets[0].stay, backend.fake.tables.Tickets[0].stop], [INN, ""]);
  },
});

cases.push({
  name: "a stay removed on another phone closes Edit stay, and the booking held up",
  async run({ page }) {
    const backend = makeBackend(withBooking(), { now: EVE10 });
    await ready(page, { backend });
    await openCard(page);
    await openEdit(page);
    await page.fill("#syTkRoom", "half typed");
    await backend.handle({ key: KEY, actor: "Ajen", action: "deleteStay", args: { id: INN } });
    await advance(page, backend, 21000);
    await until(async () => !(await isOpen(page, "staySheet")), "Edit stay closes");
    assert.equal(await isOpen(page, "stay"), false, "the card does not come back for a removed stay");
    assert.equal(calls(backend, "saveStay").length, 0);
    await backend.handle({ key: KEY, actor: "Ajen", action: "restoreStay", args: { id: INN } });
    await advance(page, backend, 21000);
    await until(() => page.evaluate((sel) => !!document.querySelector(sel + " .tk-stay.has-tag"), tk(D10)), "the stay is back with its booking");
    await openCard(page);
    await page.click("#stay .kt-line");
    await until(() => tixUp(page), "the booking is held up");
    // Reference only: no pages part, the text-only line.
    assert.equal(await page.evaluate(() => !!document.querySelector("#tix .stub-f")), false);
    await expectText(page, "#tix .stub-foot", "文字Text only, always on this phone.3泊");
    await backend.handle({ key: KEY, actor: "Ajen", action: "deleteStay", args: { id: INN } });
    await advance(page, backend, 21000);
    await until(() => page.evaluate(() => document.getElementById("tix").hidden), "the booking closes itself");
  },
});

// ---------- bulk add ----------

const HEAD = "ticket_id,booking_key,start_date,start_time,end_date,end_time,type,title,provider,confirmation,traveler,ticket_ref,seat,holder,how_to_use,file_url,manage_url,deadline,deadline_what,notes,status,book_now_no,updated,added_by";
const COLS = HEAD.split(",");
const csvRow = (o) => COLS.map((c) => (o[c] === undefined ? "" : String(o[c]))).join(",");
const LIST = [HEAD,
  csvRow({ ticket_id: "T014", start_date: "2026-12-10", start_time: "15:00", end_date: "2026-12-13", type: "lodging", title: "Tsubame-so Guest House", provider: "Agency", confirmation: "TSB-4827-KQ", traveler: "ALL", holder: "M. EXAMPLE", status: "active" }),
  csvRow({ ticket_id: "T030", start_date: "2026-12-08", start_time: "16:00", end_date: "2026-12-09", type: "lodging", title: "Lakeside Airport Inn", traveler: "ALL", status: "active" }),
].join("\n") + "\n";

async function openBulk(page) {
  await page.dispatchEvent("#youBtn", "click");
  await until(() => isOpen(page, "you"), "You opens");
  await until(() => page.evaluate(() => !document.getElementById("setBulk").hidden), "the Add tickets row shows");
  await page.evaluate(() => document.getElementById("setBulk").scrollIntoView({ block: "center" }));
  await page.dispatchEvent("#setBulk", "click");
  await until(() => isOpen(page, "bulk"), "Add tickets opens");
}

cases.push({
  name: "bulk add: a lodging file goes on its stay; one with no stay is a card, answered Add the stay; saveStay before addTicket with stay; the booking's facts",
  async run({ page }) {
    const backend = makeBackend(trip(), { now: EVE10 });
    await open(page, { backend, nowMs: EVE10 });
    await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg").length > 0 || document.querySelectorAll("#rc .rc-row").length > 0), "the app draws");
    await page.clock.resume(); // pdf.js waits on timers
    await openBulk(page);
    await page.setInputFiles("#bulkList", file("Tickets.csv", "text/csv", Buffer.from(LIST, "utf8")));
    await page.setInputFiles("#bulkFiles", [file("T014 Confirmation.pdf", "application/pdf", pdfBytes(2)), file("T030 airport-inn.png", "image/png", pngBytes(300, 400, 31))]);
    await until(() => page.evaluate(() => {
      const t = document.querySelector("#bulk .sheet-top i");
      return !!t && t.textContent.startsWith("2 files") && !document.querySelector("#bulk .ba-prog");
    }), "2 files sorted", 20000);
    assert.equal(calls(backend, "addTicket").length + calls(backend, "saveStay").length, 0, "nothing is sent before 入鋏");
    await expectText(page, "#bulk .ba-band", "帯1 sortedD1 · 1 on staysUntie ›");
    // The card: a stay with no card yet.
    await expectText(page, "#bulk .ba-card .ba-q", "宿泊 A STAYT030 · lodging");
    await expectText(page, "#bulk .ba-card .ba-fn", "Lakeside Airport Inn · Dec 8");
    await expectText(page, "#bulk .ba-card .ba-ask", "A stay with no card yet: add it?");
    await expectText(page, "#bulk .ba-card .ba-hint", "The list dates it Dec 8, one night. No stay in MAT has that night.");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#bulk .ba-card .ba-opts > button")].map((b) => b.textContent)), ["宿Add the stay and its bookingLakeside Airport Inn · night of Dec 8›", "Leave it out›"]);
    // Untied: the stays first, under 宿泊.
    await page.click('#bulk [data-act="untie"]');
    await expectText(page, "#bulk .ba-list .ba-lh", "On a stay 宿泊");
    await expectText(page, "#bulk .ba-list .ba-lb", "D1Tsubame-so Guest HouseT014 · T014 Confirmation.pdf · 2 pages · Dec 10 to 13宿");
    await page.evaluate(() => { document.getElementById("bulk").scrollTop = 0; });
    await shot(page, "bulk.png");
    await page.click('#bulk .ba-card [data-choice$="|0"]');
    await expectText(page, "#bulk .ba-band", /^帯2 sorted/);
    await expectText(page, "#bulkPunch", /^入鋏Add 2 now/);
    await page.click("#bulkPunch");
    await until(() => page.evaluate(() => !!document.querySelector("#bulk .ba-done-h")), "added", 30000);
    await expectText(page, "#bulk .ba-done-h", "2 tickets added to 2 stays.");
    // The new stay first, then its picture on it; the guest house's pages on it; its booking from the list.
    const reqs = backend.requests;
    const addStay = reqs.findIndex((b) => b.action === "saveStay" && b.args.stay && b.args.stay.name === "Lakeside Airport Inn");
    assert.ok(addStay >= 0, "the stay was added");
    assert.deepEqual({ ...reqs[addStay].args.stay, id: "" }, { name: "Lakeside Airport Inn", firstNight: "2026-12-08", lastNight: "2026-12-08", id: "" });
    const newId = reqs[addStay].args.stay.id;
    const onNew = reqs.findIndex((b) => b.action === "addTicket" && b.args.ticket.stay === newId);
    assert.ok(onNew > addStay, "its picture goes after the stay is added");
    assert.equal(reqs.filter((b) => b.action === "addTicket" && b.args.ticket.stay === INN).length, 2);
    assert.equal(reqs.filter((b) => b.action === "addTicket" && b.args.ticket.stop).length, 0);
    const facts = reqs.find((b) => b.action === "saveStay" && b.args.merge === true);
    assert.deepEqual(facts.args, { stay: { id: INN, tkRef: "TSB-4827-KQ", tkName: "M. EXAMPLE" }, merge: true });
    assert.equal(backend.fake.tables.Stays.find((r) => r.id === newId).name, "Lakeside Airport Inn");
  },
});

// ---------- sizes ----------

cases.push({
  name: "320 wide: the card, the booking and Edit stay, no sideways scroll",
  viewport: { width: 320, height: 568 },
  async run({ page }) {
    const backend = makeBackend(withBooking(), { now: EVE10 });
    await stayPicture(backend, "stayPicB00001", 1);
    await stayPicture(backend, "stayPicB00002", 2);
    await ready(page, { backend });
    await page.clock.resume(); // the sheets slide
    await openCard(page);
    await until(() => page.evaluate(() => !!document.querySelector("#stay .kt-line")), "the tag hangs");
    assert.deepEqual(await noSideways(page, "#stay"), { doc: true, box: true, over: [] });
    await shot(page, "card-320.png");
    await page.click("#stay .kt-line");
    await until(() => tixUp(page), "the booking is held up");
    await until(() => page.evaluate(() => [...document.querySelectorAll("#tix .pages .stub-code img")].filter((i) => i.naturalWidth > 0).length === 2), "both pages show");
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#tix .ref-big b")).fontSize), "36px");
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#tix .ref-big p")).fontSize), "17px");
    assert.deepEqual(await noSideways(page, "#tix .ov"), { doc: true, box: true, over: [] });
    await shot(page, "open-320.png");
    await page.click("#tix [data-close]");
    await openEdit(page);
    assert.deepEqual(await noSideways(page, "#staySheet"), { doc: true, box: true, over: [] });
  },
});

cases.push({
  name: "1440 x 900: the card and Edit stay in the Days pane; the hook on the Tickets tab",
  viewport: { width: 1440, height: 900 },
  mobile: false,
  async run({ page }) {
    const backend = makeBackend(withBooking(), { now: EVE10 });
    await stayPicture(backend, "stayPicC00001", 1);
    await stopPicture(backend, "stopPicC00001");
    await ready(page, { backend });
    await page.clock.resume(); // the sheets slide
    await openCard(page);
    await until(() => page.evaluate(() => !!document.querySelector("#stay .kt-line")), "the tag hangs");
    // The Days pane: the left half of the phone's block.
    const inPane = (id) => page.evaluate((i) => {
      const r = document.getElementById(i).getBoundingClientRect();
      const p = document.getElementById("phone").getBoundingClientRect();
      return Math.abs(r.left - p.left) < 1 && r.right <= p.left + p.width / 2 + 1;
    }, id);
    assert.equal(await inPane("stay"), true, "the card is in the Days pane");
    assert.deepEqual(await noSideways(page, "#stay"), { doc: true, box: true, over: [] });
    await shot(page, "desktop.png");
    await openEdit(page);
    assert.equal(await inPane("staySheet"), true, "Edit stay is in the Days pane");
    await page.click("#syDone");
    await until(() => isOpen(page, "stay"), "Done opens the card again");
    await page.click("#stayDone");
    await goTickets(page);
    await until(() => page.evaluate(() => !!document.querySelector("#vTickets .pc-hook")), "the hook");
    await shot(page, "desktop-tab.png");
  },
});

// 2026-11-21 (the bulkslip flake, review M1): the single add's picture is in
// the keep before Save says it waits, so MAT closed at once after Save (here,
// a reload) still sends it later. The keep's writes are slowed; this page's
// clock is paused, so the wait for the sheet moves it (the slowed write and
// the keep's limit are page timers).
cases.push({
  name: "a picture that waits, MAT closed at once after Save: it was kept first and goes up later",
  async run({ page }) {
    await page.addInitScript(() => {
      const real = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function () {
        const p = real.call(this);
        const ms = globalThis.__slowBytes || 0;
        return ms ? p.then((b) => new Promise((resolve) => setTimeout(() => resolve(b), ms))) : p;
      };
    });
    const backend = makeBackend(trip(), { now: EVE10 });
    await ready(page, { backend });
    await openCard(page);
    await openEdit(page);
    await page.setInputFiles("#syTkFile", [file("booking.png", "image/png", pngBytes(320, 320, 33))]);
    await until(() => page.evaluate(() => document.querySelectorAll("#syTix .tkp-picked .file").length === 1), "the picture is picked", 15000);
    // The picture's add gets no answer: it waits on the phone.
    const real = backend.handle;
    let drop = true;
    backend.handle = async (body) => {
      if (drop && body.action === "addTicket") throw new Error("network");
      return real(body);
    };
    await page.evaluate(() => { globalThis.__slowBytes = 800; });
    await page.click("#sySave");
    await until(async () => { await advance(page, backend, 500); return !(await isOpen(page, "staySheet")); }, "Edit stay closes", 15000);
    assert.ok((await page.evaluate(() => localStorage.getItem("mat.queue"))).includes("planstay0001"), "waiting in mat.queue");
    assert.equal(backend.fake.tables.Tickets.length, 0);
    // MAT closed at once (a reload), then signal back.
    await page.reload();
    await page.clock.resume();
    await until(() => page.evaluate(() => !!globalThis.__matTest), "the app draws again", 10000);
    drop = false;
    await page.evaluate(() => globalThis.__matTest.store.checkRev());
    await page.evaluate(() => globalThis.__matTest.store.idle());
    await until(() => backend.fake.tables.Tickets.length === 1, "it goes up later with its picture (the backend refuses an add without data)", 15000);
  },
});

module.exports = cases;
