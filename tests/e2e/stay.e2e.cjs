// Where you sleep, and the shape of the trip: the stay row at the foot of a
// ticket, the hotel card it opens (#stay), and the list of every day (#allDays)
// opened from the day counter. The plan is tests/fixtures/plan.json over the
// seed; the clock is 13:20 on Dec 12 in Japan, Day 3.

const assert = require("node:assert/strict");
const { WITH_PLAN, open, advance, until, atRest, text, expectText } = require("./helpers.cjs");

// A 1x1 PNG in place of a real photo, and a stay seed with a photo address.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
const PHOTO = "https://example.test/hotel.png";
const BAD_PHOTO = "https://example.test/gone.png";
function seedWithPhoto(photo) {
  const seed = JSON.parse(JSON.stringify(WITH_PLAN));
  seed.stays.find((s) => s.id === "planstay0001").photo = photo;
  return seed;
}

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: WITH_PLAN, tab: "days", ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}

const tk = (date) => '#rail .pg[data-date="' + date + '"]';
const isOpen = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  return !!el && el.classList.contains("is-open");
}, id);

// The text of each child of the ticket's last part before the footer.
const lastPart = (page, date) => page.evaluate((sel) => {
  const foot = document.querySelector(sel + " .tk-foot");
  const before = foot && foot.previousElementSibling;
  return before ? { cls: before.className, text: before.textContent.replace(/\s+/g, " ").trim() } : null;
}, tk(date));

async function openCard(page, date) {
  await page.click(tk(date) + " .tk-stay");
  await atRest(page, "#stay", { message: "the hotel card opens" });
}

const cardText = (page) => text(page, "#stay");
const size = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
}, sel);
const href = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? el.getAttribute("href") : null;
}, sel);
// The card's links by their words.
const links = (page) => page.evaluate(() => [...document.querySelectorAll("#stay a")].map((a) => ({ text: a.textContent.trim(), href: a.getAttribute("href") })));

async function expectFullCard(page) {
  const t = await cardText(page);
  for (const s of ["浅草ホテル", "Asakusa hotel", "東京都台東区浅草1-1-1", "ここまでお願いします", "Please take me here."]) {
    assert.ok(t.includes(s), "the card reads " + s + ": " + t);
  }
  const ls = await links(page);
  const map = ls.find((l) => l.text.startsWith("地図"));
  assert.ok(map, "a map link: " + JSON.stringify(ls));
  assert.equal(map.text, "地図 Map ↗");
  assert.equal(map.href, "https://www.google.com/maps/search/?api=1&query=Asakusa%20hotel%20Tokyo");
  const booking = ls.find((l) => l.text === "Booking ↗");
  assert.ok(booking, "a booking link: " + JSON.stringify(ls));
  assert.equal(booking.href, "https://example.test/booking");
}

// "ok", or why the element is not on screen and tappable (as in small.e2e.cjs).
function reach(page, selector, scroll = false) {
  return page.evaluate(
    ([sel, scroll]) => {
      const el = document.querySelector(sel);
      if (!el) return "missing";
      if (scroll) el.scrollIntoView({ block: "center", inline: "nearest" });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return "not drawn";
      if (r.top < -0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5) {
        return "off screen: top " + Math.round(r.top) + ", bottom " + Math.round(r.bottom) + " of " + innerHeight;
      }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) return "covered by " + (hit ? hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") + "." + hit.className : "nothing");
      return "ok";
    },
    [selector, scroll],
  );
}

async function expectReach(page, selector, scroll) {
  let got;
  try {
    await until(async () => (got = await reach(page, selector, scroll)) === "ok", "");
  } catch {
    throw new Error(selector + " is not on screen and tappable at 390x664: " + got);
  }
}

// Each all-days row's words.
const dayRows = (page) => page.evaluate(() => [...document.querySelectorAll("#allDays .ad-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()));

module.exports = [
  {
    name: "tonight's stay is on the ticket",
    async run({ page }) {
      await ready(page);
      const d12 = await lastPart(page, "2026-12-12");
      assert.ok(d12 && d12.cls.split(" ").includes("tk-stay"), "Dec 12 ends with the stay: " + JSON.stringify(d12));
      for (const s of ["宿泊", "Tonight", "Asakusa hotel"]) assert.ok(d12.text.includes(s), "Dec 12's stay reads " + s + ": " + d12.text);
      assert.equal(await page.evaluate((sel) => document.querySelector(sel + " .tk-stay").tagName, tk("2026-12-12")), "BUTTON");
      assert.equal(await page.evaluate((sel) => document.querySelector(sel + " .tk-stay").dataset.stay, tk("2026-12-12")), "planstay0001");
      const d13 = await lastPart(page, "2026-12-13");
      assert.ok(d13 && d13.cls.split(" ").includes("tk-stay"), "Dec 13 ends with the stay");
      assert.ok(d13.text.includes("Niseko lodge"), d13.text);
      assert.equal(await page.evaluate((sel) => document.querySelectorAll(sel + " .tk-stay").length, tk("2026-12-20")), 0, "no stay on Dec 20");
      assert.equal((await text(page, tk("2026-12-20") + " .tk")).includes("undefined"), false);
    },
  },
  {
    name: "after midnight on a hotel-change day, last night's stay (R37)",
    async run({ page }) {
      const backend = await ready(page, { nowMs: Date.parse("2026-12-13T00:30:00+09:00") });
      await expectText(page, "#dayCount", /^Day 4 of 11 ?today$/);
      const stayOf = (date) => page.evaluate((sel) => {
        const b = document.querySelector(sel + " .tk-stay");
        return b ? { id: b.dataset.stay, text: b.textContent } : null;
      }, tk(date));
      const d13 = await stayOf("2026-12-13");
      assert.equal(d13.id, "planstay0001");
      for (const s of ["宿泊", "Tonight", "Asakusa hotel"]) assert.ok(d13.text.includes(s), d13.text);
      // Other tickets are as they were.
      assert.equal((await stayOf("2026-12-14")).id, "planstay0002");
      assert.equal((await stayOf("2026-12-12")).id, "planstay0001");
      await openCard(page, "2026-12-13");
      const t = await cardText(page);
      for (const s of ["浅草ホテル", "東京都台東区浅草1-1-1"]) assert.ok(t.includes(s), "the card reads " + s + ": " + t);
      await page.click("#stayDone");
      await atRest(page, "#stay", { open: false, message: "the card closed" });
      await advance(page, backend, 3.5 * 3600000); // 04:00
      await until(async () => (await stayOf("2026-12-13")).id === "planstay0002", "from 04:00, tonight's stay");
      assert.ok((await stayOf("2026-12-13")).text.includes("Niseko lodge"));
      await expectText(page, "#dayCount", /^Day 4 of 11 ?today$/);
    },
  },
  {
    name: "after midnight on a phone in Toronto, last night's stay (R37)",
    timezoneId: "America/Toronto",
    async run({ page }) {
      await ready(page, { nowMs: Date.parse("2026-12-13T00:30:00+09:00") });
      assert.notEqual(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), "Asia/Tokyo");
      await expectText(page, "#dayCount", /^Day 4 of 11 ?today$/);
      assert.equal(await page.evaluate((sel) => document.querySelector(sel + " .tk-stay").dataset.stay, tk("2026-12-13")), "planstay0001");
    },
  },
  {
    name: "the hotel card",
    async run({ page }) {
      await ready(page);
      await openCard(page, "2026-12-12");
      await expectFullCard(page);
      assert.ok((await size(page, "#stay .sy-name")) >= 28, "the Japanese name is large: " + (await size(page, "#stay .sy-name")));
      assert.equal(await text(page, "#stay .sy-name"), "浅草ホテル");
      assert.ok((await size(page, "#stay .sy-ad")) >= 20, "the address is large: " + (await size(page, "#stay .sy-ad")));
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "stayDone", "focus on Done");
      await page.click("#stayDone");
      await atRest(page, "#stay", { open: false, message: "Done closes it" });
      assert.equal(await page.evaluate(() => document.getElementById("stay").inert), true);
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("tk-stay")), true, "focus back on the stay row");
    },
  },
  {
    name: "a stay with a photo shows it first on the card",
    async run({ page, context }) {
      await context.route(PHOTO, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
      await ready(page, { seed: seedWithPhoto(PHOTO) });
      await openCard(page, "2026-12-12");
      await until(() => page.evaluate(() => { const i = document.querySelector("#stay .sy-ph"); return !!i && i.complete && i.naturalWidth > 0; }), "the photo loads");
      const got = await page.evaluate(() => {
        const imgs = [...document.querySelectorAll("#stay .sy-ph")];
        const body = document.getElementById("stayBody");
        const i = imgs[0];
        return { n: imgs.length, first: body.firstElementChild === i, tag: i.tagName, src: i.getAttribute("src"), alt: i.getAttribute("alt"), ref: i.referrerPolicy, w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height, bw: body.getBoundingClientRect().width };
      });
      assert.equal(got.n, 1);
      assert.equal(got.first, true, "the first thing on the card");
      assert.deepEqual([got.tag, got.src, got.alt, got.ref], ["IMG", PHOTO, "", "no-referrer"]);
      assert.ok(Math.abs(got.w - got.bw) < 1.5, "full width of the card: " + got.w + " of " + got.bw);
      assert.ok(Math.abs(got.h - (got.w * 9) / 16) < 2, "16:9: " + got.w + "x" + got.h);
      await expectFullCard(page);
    },
  },
  {
    name: "a stay with no photo has no picture on the card",
    async run({ page }) {
      await ready(page);
      await openCard(page, "2026-12-12");
      assert.equal(await page.evaluate(() => document.querySelectorAll("#stay .sy-ph, #stay img").length), 0);
      await expectFullCard(page);
    },
  },
  {
    name: "a stay photo that fails is dropped, the card stays whole, and it is not drawn again",
    async run({ page }) {
      let asked = 0; // nothing serves it: the harness refuses every address it does not know
      page.on("request", (req) => { if (req.url() === BAD_PHOTO) asked++; });
      await ready(page, { seed: seedWithPhoto(BAD_PHOTO) });
      await openCard(page, "2026-12-12");
      await until(() => page.evaluate(() => !document.querySelector("#stay .sy-ph")), "the broken photo is removed");
      await expectFullCard(page);
      assert.equal(asked, 1);
      await page.click("#stayDone");
      await atRest(page, "#stay", { open: false, message: "the card closed" });
      await openCard(page, "2026-12-12");
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(await page.evaluate(() => document.querySelectorAll("#stay .sy-ph").length), 0, "not drawn again");
      assert.equal(asked, 1, "not asked for again");
      await expectFullCard(page);
    },
  },
  {
    name: "a stay photo at 320 wide does not scroll the page sideways",
    viewport: { width: 320, height: 568 },
    async run({ page, context }) {
      await context.route(PHOTO, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
      await ready(page, { seed: seedWithPhoto(PHOTO) });
      await openCard(page, "2026-12-12");
      await until(() => page.evaluate(() => { const i = document.querySelector("#stay .sy-ph"); return !!i && i.complete && i.naturalWidth > 0; }), "the photo loads");
      const o = await page.evaluate(() => {
        const sheet = document.getElementById("stay");
        const i = document.querySelector("#stay .sy-ph").getBoundingClientRect();
        return { doc: document.documentElement.scrollWidth - innerWidth, body: document.body.scrollWidth - innerWidth, sheet: sheet.scrollWidth - sheet.clientWidth, right: i.right, left: i.left, vw: innerWidth };
      });
      assert.ok(o.doc <= 0 && o.body <= 0 && o.sheet <= 0, "no sideways scroll: " + JSON.stringify(o));
      assert.ok(o.left >= 0 && o.right <= o.vw + 0.5, "the photo is inside the screen: " + JSON.stringify(o));
    },
  },
  {
    name: "held sideways, the photo is capped and the address stays on screen",
    viewport: { width: 740, height: 360 },
    async run({ page, context }) {
      await context.route(PHOTO, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
      await ready(page, { seed: seedWithPhoto(PHOTO) });
      await openCard(page, "2026-12-12");
      await until(() => page.evaluate(() => { const i = document.querySelector("#stay .sy-ph"); return !!i && i.complete && i.naturalWidth > 0; }), "the photo loads");
      const h = await page.evaluate(() => document.querySelector("#stay .sy-ph").getBoundingClientRect().height);
      assert.ok(h <= 0.38 * 360 + 1, "the photo is capped at 38vh: " + h);
      await expectReach(page, "#stay .sy-ad");
    },
  },
  {
    name: "a stay with almost nothing",
    async run({ page }) {
      await ready(page);
      await page.click("#pager .sq:nth-child(4)");
      await openCard(page, "2026-12-13");
      assert.equal(await text(page, "#stay .sy-name"), "Niseko lodge");
      assert.ok((await size(page, "#stay .sy-name")) >= 28);
      assert.equal(await page.evaluate(() => document.querySelectorAll("#stay .sy-ad").length), 0, "no empty address line");
      assert.equal(await page.evaluate(() => document.querySelectorAll("#stay .sy-en").length), 0, "the name is not printed twice");
      const t = await cardText(page);
      assert.ok(t.includes("ここまでお願いします") && t.includes("Please take me here."), t);
      assert.equal(t.includes("undefined"), false);
      const ls = await links(page);
      assert.equal(ls.some((l) => l.text === "Booking ↗"), false, "no booking link");
      const map = ls.find((l) => l.text === "地図 Map ↗");
      assert.ok(map && map.href.endsWith("query=Niseko%20lodge"), JSON.stringify(ls));
      const empty = await page.evaluate(() => [...document.querySelectorAll("#stay *")].filter((n) => !n.children.length && !n.textContent.trim() && n.tagName !== "BR").map((n) => n.tagName + "." + n.className));
      assert.deepEqual(empty, [], "no empty lines on the card");
    },
  },
  {
    name: "works with no signal",
    async run({ page }) {
      const backend = await ready(page);
      backend.failWith = "network";
      await page.reload();
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets paint from saved data");
      await openCard(page, "2026-12-12");
      await expectFullCard(page);
    },
  },
  {
    name: "the shape of the trip",
    async run({ page }) {
      await ready(page);
      await page.click("#dayCount");
      await atRest(page, "#allDays", { message: "the list opens" });
      const rows = await dayRows(page);
      assert.equal(rows.length, 11);
      for (const s of ["D 03", "Sat Dec 12", "Tokyo", "today"]) assert.ok(rows[2].includes(s), "the third row reads " + s + ": " + rows[2]);
      for (const s of ["Temples, then the view", "used"]) assert.ok(rows[1].includes(s), "the second row reads " + s + ": " + rows[1]);
      assert.equal(/today|used/.test(rows[5]), false, "an ahead day is neither: " + rows[5]);
      assert.equal(rows.some((r) => r.includes("undefined")), false);
      assert.equal(await page.evaluate(() => document.querySelector("#allDays .ad-row").tagName), "BUTTON");
      await page.click("#allDays .ad-row:nth-child(6)");
      await atRest(page, "#allDays", { open: false, message: "the list closes" });
      await expectText(page, "#dayCount", /^Day 6 of 11/);
    },
  },
  {
    name: "the list's today and used follow the clock when it opens",
    async run({ page }) {
      const backend = await ready(page, { nowMs: Date.parse("2026-12-12T23:40:00+09:00") });
      await page.click("#dayCount");
      await atRest(page, "#allDays", { message: "the list opens" });
      assert.ok((await dayRows(page))[2].includes("today"));
      await page.click("#allDaysDone");
      await atRest(page, "#allDays", { open: false, message: "the list closes" });
      await page.clock.fastForward(50 * 60000);
      backend.now += 50 * 60000;
      await page.evaluate(() => document.getElementById("dayCount").click());
      await atRest(page, "#allDays", { message: "the list opens again" });
      const rows = await dayRows(page);
      assert.ok(rows[2].includes("used"), rows[2]);
      assert.ok(rows[3].includes("today"), rows[3]);
    },
  },
  {
    name: "the open list is only redrawn when it changes",
    async run({ page }) {
      const backend = await ready(page);
      await page.click("#dayCount");
      await atRest(page, "#allDays", { message: "the list opens" });
      await page.evaluate(() => { document.querySelector("#allDays .ad-row:nth-child(3)").__kept = 1; });
      const kept = () => page.evaluate(() => document.querySelector("#allDays .ad-row:nth-child(3)").__kept === 1);
      const syncs = () => backend.requests.length;
      for (let i = 0; i < 2; i++) {
        const before = syncs();
        await advance(page, backend, 20000);
        await until(() => syncs() > before, "a sync with nothing new");
        await new Promise((r) => setTimeout(r, 150));
        assert.equal(await kept(), true, "the third row is the same node after sync " + (i + 1));
      }
      backend.failWith = "network";
      await advance(page, backend, 20000);
      await until(() => page.evaluate(() => !!document.querySelector("#net:not([hidden])")), "no signal shows");
      assert.equal(await kept(), true, "the same node with no signal");
      backend.failWith = null;
      await advance(page, backend, 20000);
      await until(() => page.evaluate(() => !document.querySelector("#net:not([hidden])")), "signal is back");
      assert.equal(await kept(), true, "the same node when signal is back");

      const r = await backend.handle({ key: "test-key", actor: "Ajen", via: "app", action: "setDay", args: { date: "2026-12-13", patch: { city: "Sapporo" } } });
      assert.equal(r.ok, true, JSON.stringify(r));
      await advance(page, backend, 20000);
      await expectText(page, "#allDays .ad-row:nth-child(4)", /Sun Dec 13 ?Sapporo/);
    },
  },
  {
    name: "one sheet at a time",
    async run({ page }) {
      await ready(page);
      // Settings is under the list's and the card's dimmed area: a person
      // closes the sheet first, then taps it.
      await page.click("#dayCount");
      await atRest(page, "#allDays", { message: "the list opens" });
      await page.click("#allDaysDone");
      await atRest(page, "#allDays", { open: false, message: "the list closed" });
      await page.click("#youBtn");
      await atRest(page, "#you", { message: "Settings opens" });
      assert.equal(await isOpen(page, "allDays"), false);

      await page.click("#youDone");
      await atRest(page, "#you", { open: false, message: "Settings closed" });
      await openCard(page, "2026-12-12");
      await page.click("#stayDone");
      await atRest(page, "#stay", { open: false, message: "the card closed" });
      await page.click("#youBtn");
      await atRest(page, "#you", { message: "Settings opens" });
      assert.equal(await isOpen(page, "stay"), false);

      // Opening the card or the list closes Settings, and each closes the other.
      await page.evaluate(() => document.querySelector('#rail .pg[data-date="2026-12-12"] .tk-stay').click());
      await atRest(page, "#stay", { message: "the card opens" });
      await atRest(page, "#you", { open: false, message: "Settings closed" });
      await page.evaluate(() => document.getElementById("dayCount").click());
      await atRest(page, "#allDays", { message: "the list opens" });
      await atRest(page, "#stay", { open: false, message: "the card closed" });
      await page.evaluate(() => document.querySelector('#rail .pg[data-date="2026-12-12"] .tk-stay').click());
      await atRest(page, "#stay", { message: "the card opens" });
      await atRest(page, "#allDays", { open: false, message: "the list closed" });

      // Ring up closes it; so does a tab switch.
      await page.evaluate(() => document.getElementById("ring").click());
      await atRest(page, "#reg", { message: "the register opens" });
      assert.equal(await isOpen(page, "stay"), false, "Ring up closed the card");
      await page.evaluate(() => globalThis.__matTest.register.close());
      await atRest(page, "#reg", { open: false, message: "the register closed" });
      await page.evaluate(() => document.getElementById("dayCount").click());
      await atRest(page, "#allDays", { message: "the list opens" });
      await page.evaluate(() => document.querySelector('#nav [data-tab="money"]').click());
      await atRest(page, "#allDays", { open: false, message: "a tab switch closed the list" });
      assert.equal(await page.evaluate(() => document.getElementById("allDays").inert), true);
    },
  },
  {
    name: "reachable in a Safari tab",
    viewport: { width: 390, height: 664 },
    async run({ page }) {
      await ready(page);
      await openCard(page, "2026-12-12");
      await expectReach(page, "#stayDone");
      await expectReach(page, "#stay .sy-map", true);
      await page.click("#stayDone");
      await atRest(page, "#stay", { open: false, message: "the card closed" });
      await page.click("#dayCount");
      await atRest(page, "#allDays", { message: "the list opens" });
      await expectReach(page, "#allDaysDone");
      await expectReach(page, "#allDays .ad-row:last-child", true);
    },
  },
];
