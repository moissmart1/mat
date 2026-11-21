// A stay's booking, look A (予約票): the ruled form on the hotel card, the
// stay at the top of the Tickets tab and the white stub held up (js/views/
// staycard.js, passcase.js, stub.js; the words are js/staywords.js). Every
// name, number and picture here is made up: the hotel Tsubame Stay
// Akebonocho, the booking number 55302917408621, the guest M. EXAMPLE.
// Pictures are taken only when MAT_TAB_SHOTS names an output folder.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { SEED, PLAN, makeBackend, open, until, text, expectText, visible } = require("./helpers.cjs");
const { png } = require("./pictures.cjs");

const SHOTS = process.env.MAT_TAB_SHOTS || "";
const KEY = "test-key";
const INN = "planstay0001";
const D10 = "2026-12-10";
const EVE10 = Date.parse("2026-12-10T17:05:00+09:00");
const EVE9 = Date.parse("2026-12-09T17:05:00+09:00");
const PHOTO = "https://example.test/hotel.png";
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

const BOOKED = { tkRef: "55302917408621", tkName: "M. EXAMPLE", tkPeople: "3", tkRoom: "Apartment for 3" };
const FIXTURE = {
  ...PLAN.stays[0],
  name: "Tsubame Stay Akebonocho",
  nameJp: "",
  addressJp: "",
  place: "",
  photo: PHOTO,
  note: "Booked. Apartment, no front desk. Check-in 15:00–00:00, check-out 10:00.",
  link: "https://example.test/booking",
  firstNight: "2026-12-10",
  lastNight: "2026-12-12",
  ...BOOKED,
};
const trip = (over = {}) => ({ ...SEED, ...PLAN, stays: PLAN.stays.map((s) => (s.id === INN ? { ...FIXTURE, ...over } : s)) });

const tk = (date) => '#rail .pg[data-date="' + date + '"]';
const isOpen = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  return !!el && el.classList.contains("is-open");
}, id);
const tixUp = (page) => page.evaluate(() => !document.getElementById("tix").hidden && !!document.querySelector("#tix .tstub.is-stay"));

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || (a.effect && a.effect.getTiming().iterations === Infinity)), null, { timeout: 2000 }).catch(() => {});
  await page.screenshot({ path: SHOTS + "/" + name });
}

async function stayPicture(backend, id, page = 1) {
  const r = await backend.handle({ key: KEY, actor: "Ajen", action: "addTicket", args: { ticket: { id, stay: INN, who: "", seat: "", page, mime: "image/png", w: 300, h: 300, data: png(300, 300, 40 + page) } } });
  assert.equal(r.ok, true, r.message);
}

// A phone on the made-up trip: the stay's fields over the plan, `pages` pictures on it.
async function start(ctx, { over = {}, pages = 2, nowMs = EVE10, phone = ctx.page, tag = "" } = {}) {
  await ctx.context.route(PHOTO, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }));
  const backend = makeBackend(trip(over), { now: nowMs });
  for (let i = 1; i <= pages; i++) await stayPicture(backend, "stayPic" + tag + "00" + i, i);
  await open(phone, { backend, tab: "days", nowMs });
  await until(() => phone.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  await phone.clock.resume();
  return backend;
}
async function openCard(page, date = D10) {
  await page.click(tk(date) + " .tk-stay");
  await until(() => isOpen(page, "stay"), "the hotel card opens");
}
async function goTickets(page) {
  await until(() => visible(page, "#ticketsBtn"), "the Tickets key is in the bar");
  await page.click("#ticketsBtn");
  await until(() => page.evaluate(() => document.getElementById("vTickets").classList.contains("is-active") && !!document.querySelector("#vTickets .pc-case")), "the pass case shows");
}
const pagesLoaded = (page, n) => until(() => page.evaluate((k) => [...document.querySelectorAll("#tix .pages .stub-code img")].filter((i) => i.naturalWidth > 0).length === k, n), "the pages show");
const photoLoaded = (page) => until(() => page.evaluate(() => { const i = document.querySelector("#stay .sy-ph"); return !!i && i.complete && i.naturalWidth > 0; }), "the photo loads");

// No sideways scroll anywhere, nor inside the given element.
const noSideways = (page, sel) => page.evaluate((s) => {
  const box = s ? document.querySelector(s) : null;
  const over = box ? [...box.querySelectorAll("*")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 0.5).map((e) => e.className || e.tagName) : [];
  return { doc: document.scrollingElement.scrollWidth <= innerWidth, box: !box || box.scrollWidth <= box.clientWidth + 0.5, over };
}, sel);

// How many lines a Range over the element's text takes (one client rect per line box).
const lineRects = (page, sel) => page.evaluate((s) => {
  const r = document.createRange();
  r.selectNodeContents(document.querySelector(s));
  return r.getClientRects().length;
}, sel);
// The text's own right and left edges (a Range), and the element's box.
const edges = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  const r = document.createRange();
  r.selectNodeContents(el);
  const b = r.getBoundingClientRect();
  return { left: b.left, right: b.right };
}, sel);
const rectOf = (page, sel) => page.evaluate((s) => {
  const b = document.querySelector(s).getBoundingClientRect();
  return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, height: b.height };
}, sel);
// Every word of the element's text is on one line (no word split), and how many lines it takes.
const wordsWhole = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const split = [];
  let words = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (const m of n.data.matchAll(/\S+/g)) {
      const r = document.createRange();
      r.setStart(n, m.index);
      r.setEnd(n, m.index + m[0].length);
      words++;
      if (r.getClientRects().length !== 1) split.push(m[0]);
    }
  }
  const all = document.createRange();
  all.selectNodeContents(el);
  const tops = new Set([...all.getClientRects()].map((q) => Math.round(q.top)));
  return { words, split, lines: tops.size };
}, sel);

const cases = [];

cases.push({
  name: "390: the card, the Tickets tab and the booking as in A-1, A-2, A-3",
  viewport: { width: 390, height: 844 },
  async run(ctx) {
    const { page } = ctx;
    await start(ctx);
    await openCard(page);
    await photoLoaded(page);
    // The card: photo, name, form (no address, no driver key), the key.
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#stay .sy > *")].map((n) => n.className)), ["sy-ph", "sy-name", "bk-form", "sy-ask", "sy-note", "r-btns", "bk-key", "sy-tkline"]);
    assert.equal(await page.getAttribute("#stay .bk-form", "aria-label"), "Booking");
    await expectText(page, "#stay .bk-hd", "予約 BookingDec 10 → Dec 13Dec 10 to 13");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#stay .bk-g > div")].map((d) => d.textContent)), ["予約番号Booking no.55302917408621", "泊Night1 / 3泊Night 1 of 3"]);
    await expectText(page, "#stay .bk-key", "予約票Show bookingNight 1 of 3 ›");
    assert.equal(await page.getAttribute("#stay .bk-key", "aria-label"), "Show booking, night 1 of 3");
    assert.ok((await rectOf(page, "#stay .bk-key")).height >= 56);
    await until(async () => (await text(page, "#stay .sy-tkline")) === "券2 pages · on this phone", "the pages are on this phone");
    await page.evaluate(() => { document.getElementById("stay").scrollTop = 0; });
    await shot(page, "A-1-390.png");
    await page.click("#stayDone");
    await until(async () => !(await isOpen(page, "stay")), "the card closes");

    // The Tickets tab.
    await goTickets(page);
    await until(() => page.evaluate(() => !!document.querySelector("#vTickets .pc-case > .pc-stay:first-child")), "the stay is first in the case");
    await expectText(page, "#vTickets .pc-stay-l", "今夜の宿 Tonight’s stay1 / 3泊");
    await expectText(page, "#vTickets .pc-stay-n", "Tsubame Stay Akebonocho");
    await expectText(page, "#vTickets .pc-stay-r", "予約番号 Booking no.55302917408621");
    await expectText(page, "#vTickets .pc-stay-b", "予約票Show bookingNight 1 of 3 ›");
    assert.equal(await page.getAttribute("#vTickets .pc-stay-b", "aria-label"), "Show booking: Tsubame Stay Akebonocho, night 1 of 3");
    assert.ok((await rectOf(page, "#vTickets .pc-stay-b")).height >= 48);
    await shot(page, "A-2-390.png");

    // The booking, open.
    await page.click("#vTickets .pc-stay-b");
    await until(() => tixUp(page), "the booking is held up");
    await expectText(page, "#tix .oa-top", "予約票 Booking · Thu Dec 10Put it back");
    await expectText(page, "#tix .stub-band", "宿泊StayD 01–03");
    await expectText(page, "#tix .stub-k", "予約票BookingNight 1 of 3 · 1 / 3泊");
    await expectText(page, "#tix .stub-t", "Tsubame Stay Akebonocho");
    assert.equal(await page.evaluate(() => !!document.querySelector("#tix .stub-w")), false);
    await expectText(page, "#tix .ref-big small", "予約番号 Booking number");
    await expectText(page, "#tix .ref-big b", "55302917408621");
    await expectText(page, "#tix .ref-big p", "M. EXAMPLE の名前で、本日から3泊予約しています。");
    await expectText(page, "#tix .ref-big span", "We have a booking for 3 nights from today under M. EXAMPLE.");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#tix .facts > div")].map((d) => d.textContent)), ["お名前Name on bookingM. EXAMPLE", "人数In the room3名", "部屋RoomApartment for 3", "泊数Nights1 / 3泊Dec 10 to 13"]);
    await expectText(page, "#tix .pg-cap", "予約確認書 Confirmation, 2 pagesTap to enlarge");
    await pagesLoaded(page, 2);
    await expectText(page, "#tix .stub-foot", "保存済On this phone. Works with no signal.12.10 → 12.13");
    await shot(page, "A-3-390.png");
    await page.click("#tix [data-close]");
    await until(() => page.evaluate(() => document.getElementById("tix").hidden && document.activeElement.classList.contains("pc-stay-b")), "Put it back: focus on the stay's key");
  },
});

cases.push({
  name: "320: the 14-digit number is on one line on the card, the tab and the open booking, clear of the rule; no sideways scroll",
  viewport: { width: 320, height: 568 },
  async run(ctx) {
    const { page } = ctx;
    await start(ctx);
    await openCard(page);
    await photoLoaded(page);
    await until(() => page.evaluate(() => !!document.querySelector("#stay .bk-g")), "the form");
    assert.equal(await lineRects(page, "#stay .bk-g b"), 1, "the number is on one line on the card");
    const num = await edges(page, "#stay .bk-g > div:first-child b");
    const second = await rectOf(page, "#stay .bk-g > div + div");
    assert.ok(second.left - num.right >= 12, "the number is " + (second.left - num.right) + " px from the rule");
    assert.ok((await rectOf(page, "#stay .bk-key")).height >= 56);
    assert.deepEqual(await noSideways(page, "#stay"), { doc: true, box: true, over: [] });
    await page.evaluate(() => { document.getElementById("stay").scrollTop = 0; });
    await shot(page, "A-1-320.png");
    await page.click("#stayDone");
    await until(async () => !(await isOpen(page, "stay")), "the card closes");

    await goTickets(page);
    await until(() => page.evaluate(() => !!document.querySelector("#vTickets .pc-stay-r b")), "the stay on the tab");
    assert.equal(await lineRects(page, "#vTickets .pc-stay-r b"), 1, "the number is on one line on the tab");
    assert.ok((await rectOf(page, "#vTickets .pc-stay-b")).height >= 48);
    assert.deepEqual(await noSideways(page, "#vTickets"), { doc: true, box: true, over: [] });
    await shot(page, "A-2-320.png");

    await page.click("#vTickets .pc-stay-b");
    await until(() => tixUp(page), "the booking is held up");
    await pagesLoaded(page, 2);
    assert.equal(await lineRects(page, "#tix .ref-big b"), 1, "the number is on one line when open");
    const n = await edges(page, "#tix .ref-big b");
    const box = await rectOf(page, "#tix .ref-big");
    assert.ok(n.left - box.left >= 12 && box.right - n.right >= 12, "the number is clear of the white box: " + (n.left - box.left) + " / " + (box.right - n.right));
    assert.ok((await rectOf(page, "#tix [data-close]")).height >= 44);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#tix .tstub.is-stay .ref-big b")).fontSize), "32px");
    assert.deepEqual(await noSideways(page, "#tix .ov"), { doc: true, box: true, over: [] });
    await shot(page, "A-3-320.png");
  },
});

cases.push({
  name: "320: a long hotel name wraps between words, never inside one, and nothing overlaps it",
  viewport: { width: 320, height: 568 },
  async run(ctx) {
    const { page } = ctx;
    await start(ctx, { over: { name: "Tsubame Stay Akebonocho Riverside Annex" } });
    await openCard(page);
    await photoLoaded(page);
    const card = await wordsWhole(page, "#stay .sy-name");
    assert.deepEqual(card.split, []);
    assert.ok(card.lines >= 2, "the name takes " + card.lines + " lines");
    const name = await rectOf(page, "#stay .sy-name");
    const form = await rectOf(page, "#stay .bk-form");
    const photo = await rectOf(page, "#stay .sy-ph");
    assert.ok(name.bottom <= form.top + 0.5, "the form starts under the name");
    assert.ok(photo.bottom <= name.top + 0.5, "the photo is above the name");
    assert.deepEqual(await noSideways(page, "#stay"), { doc: true, box: true, over: [] });
    await page.evaluate(() => { document.getElementById("stay").scrollTop = 0; });
    await shot(page, "long-320.png");
    await page.click("#stayDone");
    await until(async () => !(await isOpen(page, "stay")), "the card closes");

    await goTickets(page);
    await until(() => page.evaluate(() => !!document.querySelector("#vTickets .pc-stay-n")), "the stay on the tab");
    const tab = await wordsWhole(page, "#vTickets .pc-stay-n");
    assert.deepEqual(tab.split, []);
    assert.ok(tab.lines >= 2);
    assert.ok((await rectOf(page, "#vTickets .pc-stay-n")).bottom <= (await rectOf(page, "#vTickets .pc-stay-r")).top + 0.5);
    assert.deepEqual(await noSideways(page, "#vTickets"), { doc: true, box: true, over: [] });

    await page.click("#vTickets .pc-stay-b");
    await until(() => tixUp(page), "the booking is held up");
    const open_ = await wordsWhole(page, "#tix .stub-t");
    assert.deepEqual(open_.split, []);
    assert.ok(open_.lines >= 2);
    assert.ok((await rectOf(page, "#tix .stub-t")).bottom <= (await rectOf(page, "#tix .stub-p")).top + 0.5);
    assert.deepEqual(await noSideways(page, "#tix .ov"), { doc: true, box: true, over: [] });
  },
});

cases.push({
  name: "no booking number, pages only",
  async run(ctx) {
    const { page } = ctx;
    await start(ctx, { over: { tkRef: "" } });
    await openCard(page);
    await expectText(page, "#stay .bk-g > div:first-child", "予約確認書Confirmation2 pages");
    await page.click("#stayDone");
    await until(async () => !(await isOpen(page, "stay")), "the card closes");
    await goTickets(page);
    await until(() => page.evaluate(() => !!document.querySelector("#vTickets .pc-stay")), "the stay on the tab");
    assert.equal(await page.evaluate(() => !!document.querySelector("#vTickets .pc-stay-r")), false);
    await page.click("#vTickets .pc-stay-b");
    await until(() => tixUp(page), "the booking is held up");
    assert.equal(await page.evaluate(() => !!document.querySelector("#tix .ref-big small, #tix .ref-big b")), false);
    await expectText(page, "#tix .ref-big p", "M. EXAMPLE の名前で、本日から3泊予約しています。");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#tix .facts > div")].map((d) => d.textContent)), ["お名前Name on bookingM. EXAMPLE", "人数In the room3名", "部屋RoomApartment for 3", "泊数Nights1 / 3泊Dec 10 to 13"]);
  },
});

cases.push({
  name: "no booking number and no pages",
  async run(ctx) {
    const { page, newPhone } = ctx;
    await start(ctx, { over: { tkRef: "", tkName: "", tkPeople: "" }, pages: 0 });
    await openCard(page);
    await expectText(page, "#stay .bk-g > div:first-child", "予約BookingBooked");
    await expectText(page, "#stay .sy-tkline", "券Reference only");
    await page.click("#stay .bk-key");
    await until(() => tixUp(page), "the booking is held up");
    assert.equal(await page.evaluate(() => !!document.querySelector("#tix .ref-big, #tix .stub-f")), false);
    await expectText(page, "#tix .stub-foot", "文字Text only, always on this phone.12.10 → 12.13");
    // With the name on it too.
    const other = await newPhone();
    await start(ctx, { over: { tkRef: "", tkPeople: "" }, pages: 0, phone: other });
    await openCard(other);
    await expectText(other, "#stay .bk-g > div:first-child", "予約BookingM. EXAMPLE");
  },
});

cases.push({
  name: "one night",
  async run(ctx) {
    const { page } = ctx;
    await start(ctx, { over: { lastNight: "2026-12-10" } });
    await openCard(page);
    await expectText(page, "#stay .bk-g > div + div", "泊Night1泊1 night");
    await expectText(page, "#stay .bk-hd i", "Dec 10 → Dec 11Dec 10 to 11");
    await expectText(page, "#stay .bk-key", "予約票Show booking1 night ›");
    await page.click("#stayDone");
    await until(async () => !(await isOpen(page, "stay")), "the card closes");
    await goTickets(page);
    await expectText(page, "#vTickets .pc-stay-l", "今夜の宿 Tonight’s stay1泊");
    await page.click("#vTickets .pc-stay-b");
    await until(() => tixUp(page), "the booking is held up");
    await expectText(page, "#tix .stub-band", "宿泊StayD 01");
    await expectText(page, "#tix .stub-k", "予約票Booking1 night · 1泊");
    await expectText(page, "#tix .ref-big p", "M. EXAMPLE の名前で、本日から1泊予約しています。");
    await expectText(page, "#tix .ref-big span", "We have a booking for 1 night from today under M. EXAMPLE.");
    await expectText(page, "#tix .stub-foot", /12\.10 → 12\.11$/);
  },
});

cases.push({
  name: "before the first night",
  async run(ctx) {
    const { page } = ctx;
    await start(ctx, { nowMs: EVE9 });
    await openCard(page);
    await expectText(page, "#stay .bk-g > div + div", "泊Nights3泊3 nights");
    await expectText(page, "#stay .bk-key", "予約票Show booking3 nights ›");
    assert.equal(await page.getAttribute("#stay .bk-key", "aria-label"), "Show booking, 3 nights");
    await page.click("#stayDone");
    await until(async () => !(await isOpen(page, "stay")), "the card closes");
    await expectText(page, tk(D10) + " .tk-stay .tk-stay-nt", "1 / 3泊");
  },
});

cases.push({
  name: "nothing of the wooden tag is drawn",
  async run(ctx) {
    const { page } = ctx;
    await start(ctx);
    const gone = () => page.evaluate(() => document.querySelector('[class*="kt-"], .kt, .sy-hang, .sy-nm, .pc-hook, .pc-peg, svg.kt-cord') === null);
    const still = (root) => page.evaluate((r) => [...document.querySelectorAll(r + " *")].filter((e) => !e.matches(".tstub") && getComputedStyle(e).transform !== "none").map((e) => e.className), root);
    await until(() => page.evaluate(() => !!document.querySelector(".tk-stay.has-bk")), "the 宿泊 line");
    assert.equal(await gone(), true, "the day line");
    await openCard(page);
    assert.equal(await gone(), true, "the card");
    assert.deepEqual(await still("#stay .sy"), []);
    await page.click("#stayDone");
    await until(async () => !(await isOpen(page, "stay")), "the card closes");
    await goTickets(page);
    assert.equal(await gone(), true, "the tab");
    assert.deepEqual(await still("#vTickets .pc-stay"), []);
    await page.click("#vTickets .pc-stay-b");
    await until(() => tixUp(page), "the booking is held up");
    assert.equal(await gone(), true, "the booking");
    assert.deepEqual(await still("#tix .tstub"), []);
  },
});

cases.push({
  name: "1440 x 900: the card in the Days pane shows the form and the tab shows the stay; no sideways scroll",
  viewport: { width: 1440, height: 900 },
  mobile: false,
  async run(ctx) {
    const { page } = ctx;
    await start(ctx);
    await openCard(page);
    await photoLoaded(page);
    await until(() => page.evaluate(() => !!document.querySelector("#stay .bk-form")), "the form");
    assert.deepEqual(await noSideways(page, "#stay"), { doc: true, box: true, over: [] });
    await shot(page, "desktop-card.png");
    await page.click("#stayDone");
    await goTickets(page);
    await until(() => page.evaluate(() => !!document.querySelector("#vTickets .pc-stay")), "the stay on the tab");
    assert.deepEqual(await noSideways(page, "#vTickets"), { doc: true, box: true, over: [] });
    await shot(page, "desktop-tab.png");
  },
});

module.exports = cases;
