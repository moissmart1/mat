// Dec 9 keeps its own clock (T1 現地時刻) with the evening before (E1 前夜):
// a 12-day trip (tests/fixtures/dec9.json, laid over the seed) whose eve
// (Dec 8) and Day 1 (Dec 9) are in America/New_York. The page's clock is set
// by instant; the phone itself is on Eastern time, as it would be there.
// Invented places, flights and hotel throughout.
// Pictures are taken only when MAT_TAB_SHOTS names an output folder.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const P = require("../../backend/Pure.js");
const { SEED, makeBackend, open, advance, until, text, expectText, visible } = require("./helpers.cjs");

const SHOTS = process.env.MAT_TAB_SHOTS || "";
const DEC9 = JSON.parse(fs.readFileSync(require("node:path").join(__dirname, "..", "fixtures", "dec9.json"), "utf8"));
const TWELVE = { ...SEED, ...DEC9 };
const ET = "America/New_York";
const et = (iso) => Date.parse(iso + ":00-05:00");

const TRAIN = "dec9stop0801";
const INN = "dec9stop0802";
const SHUTTLE = "dec9stop0901";
const FLIGHT1 = "dec9stop0902";
const FLIGHT2 = "dec9stop0903";
const D1 = '#rail .pg[data-date="2026-12-09"]';
const D2 = '#rail .pg[data-date="2026-12-10"]';
const row = (id) => '.r[data-id="' + id + '"]';

async function ready(page, nowMs, opts = {}) {
  const backend = await open(page, { seed: TWELVE, tab: "days", nowMs, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 12), "the twelve tickets draw");
  return backend;
}

// The day whose ticket sits in the middle of the rail.
const inView = (page) =>
  page.evaluate(() => {
    const rail = document.getElementById("rail").getBoundingClientRect();
    const mid = rail.left + rail.width / 2;
    let best = null;
    for (const pg of document.querySelectorAll("#rail .pg")) {
      const r = pg.getBoundingClientRect();
      const off = Math.abs(r.left + r.width / 2 - mid);
      if (!best || off < best.off) best = { date: pg.dataset.date, off };
    }
    return best && best.off < 2 ? best.date : null;
  });
const has = (page, sel, cls) => page.evaluate(([s, c]) => { const n = document.querySelector(s); return !!n && n.classList.contains(c); }, [sel, cls]);
const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const clocks = (page, pg) => page.evaluate((sel) => [...document.querySelectorAll(sel + " .zc b")].map((b) => b.textContent), pg);
const board = (page) => page.evaluate(() => {
  const w = document.querySelector(".brd-wrap");
  if (!w || w.hidden) return null;
  return { small: w.querySelector("small").textContent, big: w.querySelector(".led-big b").firstChild.data, l1: w.querySelector(".led-1").textContent, l2: w.querySelector(".led-2").textContent };
});
const keys = (page) => page.evaluate(() => [...document.querySelectorAll("#nav button")].filter((b) => !b.hidden && b.getClientRects().length).map((b) => b.dataset.tab || b.id));
const noSideways = (page) => page.evaluate(() => {
  const tk = document.querySelector('#rail .pg[data-date="2026-12-09"] .tk');
  const edge = tk.getBoundingClientRect().right;
  const over = [...tk.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().width && e.getBoundingClientRect().right > edge + 0.5).map((e) => e.tagName + "." + (e.getAttribute("class") || "") + ":" + (e.textContent || "").slice(0, 20));
  return { doc: document.scrollingElement.scrollWidth <= innerWidth, over };
});

async function shot(page, name, opts = {}) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  if (opts.el) await page.locator(opts.el).first().screenshot({ path: SHOTS + "/" + name });
  else await page.screenshot({ path: SHOTS + "/" + name });
}

// The open checks for Day 1 at 07:00 Eastern.
async function day0700(page) {
  await expectText(page, "#dayCount", /^Day 1 of 12 ?today$/);
  assert.equal(await count(page, "#pager .sq"), 12);
  await until(async () => (await inView(page)) === "2026-12-09", "Day 1 is in view");
  await until(async () => (await board(page)) !== null, "the board is up");
  assert.deepEqual(await board(page), { small: "次 Next · 現地", big: "07:30", l1: "Hotel shuttle to the airport", l2: "Leave by 07:25 · in 25 min" });
  assert.deepEqual(await clocks(page, D1), ["07:00", "21:00水 Wed"]);
  assert.equal(await text(page, D1 + " .zc small"), "現地Eastern");
  assert.equal(await text(page, D1 + " .zc.is-dim small"), "日本Japan");
  assert.equal(await text(page, D1 + " .zs-vh"), "Local time 07:00, Eastern. Japan 21:00, Wednesday.");
  assert.equal(await text(page, D1 + " .zs-say"), "現地Times on this ticket are local, Eastern.");
  assert.equal(await page.evaluate((s) => [...document.querySelectorAll(s + " .zc")].every((c) => c.getAttribute("aria-hidden") === "true"), D1), true);
  // The clocks sit at the end of the head, after the date row.
  assert.equal(await page.evaluate((s) => document.querySelector(s + " .tk-head").lastElementChild.className, D1), "zs");
  // 前夜: between the band and the head, two past rows, 現地 on the right.
  assert.deepEqual(await page.evaluate((s) => [...document.querySelector(s + " .tk").children].slice(0, 3).map((n) => n.className), D1), ["tk-band", "eve", "tk-head"]);
  assert.equal(await text(page, D1 + " .eve-h"), "前夜The evening before · Tue Dec 8現地");
  assert.equal(await count(page, D1 + " .eve .r"), 2);
  for (const id of [TRAIN, INN]) assert.equal(await has(page, D1 + " .eve " + row(id), "is-done"), true, id + " is past");
  assert.equal(await count(page, D1 + " .eve .tk-add"), 0, "no Add a stop for the eve");
  // Day 1's own rows: the shuttle next, with its leave line.
  assert.equal(await has(page, row(SHUTTLE), "is-next"), true);
  assert.equal(await text(page, row(SHUTTLE) + " .r-lv"), "Leave by 07:25, in 25 min.");
  assert.equal(await has(page, row(SHUTTLE), "is-open"), true, "the next stop is open");
  // Only Day 1 carries a zone: Day 2 has no clocks and no line.
  assert.equal(await count(page, D2 + " .zs"), 0);
}

const cases = [
  {
    name: "Dec 9 07:00 Eastern: Day 1 of 12, the board 次 Next · 現地, the two clocks, the 前夜 strip with two past rows",
    timezoneId: ET,
    async run({ page }) {
      await ready(page, et("2026-12-09T07:00"));
      await day0700(page);
      await shot(page, "day-0700.png");
      await page.evaluate(() => { document.getElementById("vDays").scrollTop = 0; });
      await shot(page, "eve-strip.png", { el: D1 + " .tk" });
    },
  },
  {
    name: "Dec 9 11:45 Eastern: still Day 1, the 12:20 flight next in 35 min, the clocks 11:45 and 01:45 木; the first pass Used, the second in the window",
    timezoneId: ET,
    async run({ page }) {
      await ready(page, et("2026-12-09T11:45"));
      await expectText(page, "#dayCount", /^Day 1 of 12 ?today$/);
      await until(async () => (await inView(page)) === "2026-12-09", "Day 1 is in view");
      await until(async () => (await board(page)) !== null, "the board is up");
      assert.deepEqual(await board(page), { small: "次 Next · 現地", big: "12:20", l1: "Flight ZZ 7 to Tokyo", l2: "In 35 min" });
      assert.deepEqual(await clocks(page, D1), ["11:45", "01:45木 Thu"]);
      assert.equal(await has(page, row(FLIGHT1), "is-done"), true);
      assert.equal(await has(page, row(FLIGHT2), "is-next"), true);
      assert.equal(await text(page, row(FLIGHT2) + " .r-lv"), "Next, in 35 min.");
      assert.equal(await count(page, '#pager .sq.is-done'), 0, "nothing used yet");
      await shot(page, "day-1145.png");
      // The minute timer moves the clocks without redrawing the ticket.
      await page.evaluate((s) => { document.querySelector(s + " .tk-head").__kept = true; }, D1);
      await page.clock.fastForward(60000);
      await until(async () => (await clocks(page, D1))[0] === "11:46", "the clock moves");
      assert.deepEqual(await clocks(page, D1), ["11:46", "01:46木 Thu"]);
      assert.equal(await page.evaluate((s) => document.querySelector(s + " .tk-head").__kept === true, D1), true, "the head was not redrawn");
      // Tickets: the first flight in Used, the second in the window.
      await until(() => visible(page, "#ticketsBtn"), "the Tickets key is in the bar");
      await page.click("#ticketsBtn");
      await until(() => page.evaluate(() => document.getElementById("vTickets").classList.contains("is-active") && !!document.querySelector("#vTickets .pc-case")), "the pass case shows");
      await expectText(page, "#pcWin .pc-tk .pc-title", "Flight ZZ 7 to Tokyo");
      assert.equal(await count(page, '.pc-pk.is-used[data-id="' + FLIGHT1 + '"]'), 1, "the first flight is in Used");
      assert.equal(await count(page, '.pc-pk.is-used[data-id="' + TRAIN + '"]'), 1, "the eve's train is in Used");
      await until(() => page.evaluate(() => [...document.querySelectorAll(".view")].every((v) => getComputedStyle(v).opacity === (v.classList.contains("is-active") ? "1" : "0"))), "the views have faded");
      await shot(page, "tab-1145.png");
    },
  },
  {
    name: "Dec 9 12:50 Eastern: Day 2 of 12; Day 1 punched and stamped, no clocks on it, only the 現地 line",
    timezoneId: ET,
    async run({ page }) {
      await ready(page, et("2026-12-09T12:50"));
      await expectText(page, "#dayCount", /^Day 2 of 12 ?today$/);
      await until(async () => (await inView(page)) === "2026-12-10", "Day 2 is in view");
      await until(async () => (await board(page)) !== null, "the board is up");
      assert.deepEqual(await board(page), { small: "次 Next", big: "16:35", l1: "Land in Tokyo, Terminal 3", l2: "In 13 h 45 min" });
      assert.equal(await has(page, "#pager .sq[data-i='0']", "is-done"), true, "Day 1 is used");
      assert.equal(await count(page, D1 + " .insp"), 1, "stamped");
      assert.equal(await count(page, D1 + " .punch"), 1, "punched");
      assert.equal(await count(page, D1 + " .zc"), 0, "no clocks on a used day");
      assert.equal(await text(page, D1 + " .zs-say"), "現地Times on this ticket are local, Eastern.");
      assert.equal(await count(page, D2 + " .zs"), 0);
      await shot(page, "day-1250.png");
      await page.click("#pager .sq[data-i='0']");
      await until(async () => (await inView(page)) === "2026-12-09", "Day 1 is in view");
      await expectText(page, "#dayCount", /^Day 1 of 12 ?used$/);
      await page.clock.fastForward(1000);
      await shot(page, "day1-used.png");
    },
  },
  {
    name: "Dec 8 17:00 Eastern (the eve): Day 1's ticket, 1 day to go; the Tickets key with the train in the window",
    timezoneId: ET,
    async run({ page }) {
      await ready(page, et("2026-12-08T17:00"));
      await expectText(page, "#dayCount", /^Day 1 of 12 ?tomorrow$/);
      await until(async () => (await inView(page)) === "2026-12-09", "Day 1 is in view");
      assert.equal(await text(page, D1 + " .tk-date > span:last-child"), "あと1日Valid tomorrow");
      assert.equal(await count(page, D1 + " .zc"), 0, "no clocks: Day 1 is not today");
      assert.equal(await text(page, D1 + " .zs-say"), "現地Times on this ticket are local, Eastern.");
      // The eve's rows judged by its own clock: the train next with its line, the inn to come.
      assert.equal(await has(page, row(TRAIN), "is-next"), true);
      assert.equal(await text(page, row(TRAIN) + " .r-lv"), "Next, in 10 min.");
      assert.equal(await has(page, row(TRAIN), "is-open"), true, "the eve's next stop is open");
      assert.equal(await has(page, row(INN), "is-done"), false);
      assert.equal(await has(page, row(SHUTTLE), "is-next"), false, "Day 1's rows wait for Day 1");
      // No departure board that evening (nothing to book in this trip).
      assert.equal(await board(page), null);
      const k = await keys(page);
      assert.ok(k.includes("tickets") && !k.includes("before"), "the Tickets key takes Before's place: " + k.join(","));
      await shot(page, "eve-1700.png");
      await page.click("#ticketsBtn");
      await until(() => page.evaluate(() => document.getElementById("vTickets").classList.contains("is-active") && !!document.querySelector("#vTickets .pc-case")), "the pass case shows");
      await expectText(page, "#pcWin .pc-tk .pc-title", "Evening train to Lakeport");
      // An eve stop's Edit opens the stop sheet reading 前夜, the day kept.
      await page.click('[data-tab="days"]');
      await until(() => page.evaluate(() => document.getElementById("vDays").classList.contains("is-active")), "back on Days");
      await page.click(row(TRAIN) + " .r-edit");
      await until(() => page.evaluate(() => document.getElementById("stop").classList.contains("is-open")), "the stop sheet opens");
      await expectText(page, "#stDay", "前夜 Tue Dec 8");
    },
  },
  {
    name: "Dec 7 23:00 Eastern: before the eve, Before is still in the bar, Day 1 is in 2 days",
    timezoneId: ET,
    async run({ page }) {
      await ready(page, et("2026-12-07T23:00"));
      await expectText(page, "#dayCount", /^Day 1 of 12 ?in 2 days$/);
      const k = await keys(page);
      assert.ok(!k.includes("tickets"), "no Tickets key yet: " + k.join(","));
      assert.equal(await has(page, row(TRAIN), "is-done"), false);
    },
  },
  {
    name: "offline from 11:45 to 12:50 Eastern: it turns over to Day 2 the same",
    timezoneId: ET,
    async run({ page }) {
      const backend = await ready(page, et("2026-12-09T11:45"));
      await expectText(page, "#dayCount", /^Day 1 of 12 ?today$/);
      backend.failWith = "network";
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await advance(page, backend, 64 * 60000);
      await expectText(page, "#dayCount", /^Day 1 of 12 ?today$/);
      assert.deepEqual(await clocks(page, D1), ["12:49", "02:49木 Thu"]);
      // The phone put away at 12:49 and taken out after 12:50, still with no signal.
      const shown = (v) => page.evaluate((v) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
        document.dispatchEvent(new Event("visibilitychange"));
      }, v);
      await shown("hidden");
      await advance(page, backend, 60000);
      await shown("visible");
      await expectText(page, "#dayCount", /^Day 2 of 12 ?today$/);
      assert.equal(await has(page, "#pager .sq[data-i='0']", "is-done"), true, "Day 1 is used");
      assert.equal(await count(page, D1 + " .insp"), 1, "Day 1 stamped");
      assert.equal(await count(page, D1 + " .zc"), 0, "no clocks once used");
      await until(async () => (await board(page)) !== null && (await board(page)).big === "16:35", "the board says Day 2's next");
      assert.equal((await board(page)).small, "次 Next");
      assert.equal(await visible(page, "#net"), true, "the no-signal strip");
      await until(async () => (await inView(page)) === "2026-12-10", "Day 2 is in view");
    },
  },
  {
    name: "the register: on Dec 9 Eastern it offers Dec 9 and rings up on it; on the eve it is Before",
    timezoneId: ET,
    async run({ page }) {
      const backend = await ready(page, et("2026-12-09T11:45"));
      await page.click("#ring");
      await until(() => page.evaluate(() => document.getElementById("reg").classList.contains("is-open")), "the register opens");
      await expectText(page, "#xDay", "Wed 9");
      await page.fill("#xWhat", "Shuttle tip");
      for (const k of ["5"]) await page.click('#pad .key[data-k="' + k + '"]');
      await until(() => page.evaluate(() => !document.getElementById("kGo").disabled), "#kGo enabled");
      await page.click("#kGo");
      const saved = () => backend.fake.primitives.readTable_("Expenses").map(P.expenseFromRow).filter((e) => e.title === "Shuttle tip");
      const line = await until(() => saved()[0], "the line is saved");
      assert.equal(line.day, "2026-12-09");
      await page.click("#dPrev");
      await expectText(page, "#xDay", "Before", undefined);
    },
  },
  {
    name: "the register on the eve (Dec 8 17:00 Eastern) is Before",
    timezoneId: ET,
    async run({ page }) {
      await ready(page, et("2026-12-08T17:00"));
      await page.click("#ring");
      await until(() => page.evaluate(() => document.getElementById("reg").classList.contains("is-open")), "the register opens");
      await expectText(page, "#xDay", "Before");
    },
  },
];

// The seed's 11-day trip at the same instants: no clocks, no strip, Japan's day.
const SAME = [
  { at: "2026-12-08T17:00", count: /^Day 1 of 11 ?tomorrow$/, day: "2026-12-10" },
  { at: "2026-12-09T07:00", count: /^Day 1 of 11 ?tomorrow$/, day: "2026-12-10" },
  { at: "2026-12-09T11:45", count: /^Day 1 of 11 ?today$/, day: "2026-12-10" },
  { at: "2026-12-09T12:50", count: /^Day 1 of 11 ?today$/, day: "2026-12-10" },
];
for (const t of SAME) {
  cases.push({
    name: "the seed's 11-day trip at " + t.at + " Eastern is unchanged: Japan's day, no clocks, no strip",
    timezoneId: ET,
    async run({ page }) {
      await open(page, { seed: SEED, tab: "days", nowMs: et(t.at) });
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the eleven tickets draw");
      await expectText(page, "#dayCount", t.count);
      await until(async () => (await inView(page)) === t.day, "Day 1 is in view");
      assert.equal(await count(page, "#rail .zs"), 0);
      assert.equal(await count(page, "#rail .eve"), 0);
      const b = await board(page);
      assert.ok(b === null || b.small === "次 Next" || b.small === "出発まで", JSON.stringify(b));
    },
  });
}

cases.push(
  {
    name: "a phone holding the 11-day trip that then loads the 12-day one keeps the day in view by its date",
    async run({ page }) {
      const at = Date.parse("2026-12-12T13:20:00+09:00");
      const backend = await open(page, { seed: SEED, tab: "days", nowMs: at });
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the eleven tickets draw");
      await expectText(page, "#dayCount", /^Day 3 of 11 ?today$/);
      // The Sheet gains the eve and Dec 9 (another backend with them, and a change so the rev moves).
      backend.fake = makeBackend(TWELVE, { now: at }).fake;
      const w = await backend.fake({ key: "test-key", actor: "Ajen", action: "setDay", args: { date: "2026-12-15", patch: { title: "Snow" } } });
      assert.equal(w.ok, true, JSON.stringify(w));
      await advance(page, backend, 20000);
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 12), "the twelve tickets draw", 8000);
      await expectText(page, "#dayCount", /^Day 4 of 12 ?today$/);
      await until(async () => (await inView(page)) === "2026-12-12", "Dec 12 is still in view");
      assert.equal(await count(page, "#pager .sq"), 12);
    },
  },
  {
    name: "320 wide at 07:00 Eastern on Dec 9: no sideways scroll, the clocks small",
    timezoneId: ET,
    viewport: { width: 320, height: 568 },
    async run({ page }) {
      await ready(page, et("2026-12-09T07:00"));
      await until(async () => (await clocks(page, D1)).length === 2, "the clocks draw");
      const n = await noSideways(page);
      assert.equal(n.doc, true, "the page does not scroll sideways");
      assert.deepEqual(n.over, []);
      const size = await page.evaluate((s) => {
        const svg = document.querySelector(s + " .zc svg").getBoundingClientRect();
        const b = getComputedStyle(document.querySelector(s + " .zc b")).fontSize;
        const zs = document.querySelector(s + " .zs").getBoundingClientRect();
        const kids = [...document.querySelectorAll(s + " .zc")].map((c) => c.getBoundingClientRect());
        return { w: svg.width, b, fits: kids.every((k) => k.right <= zs.right + 0.5 && k.left >= zs.left - 0.5) };
      }, D1);
      assert.deepEqual(size, { w: 34, b: "19px", fits: true });
      await shot(page, "day-320.png");
    },
  },
  {
    name: "1440 × 900 at 07:00 Eastern on Dec 9: the two panes carry the clocks and the strip",
    timezoneId: ET,
    viewport: { width: 1440, height: 900 },
    mobile: false,
    async run({ page }) {
      await ready(page, et("2026-12-09T07:00"));
      await expectText(page, "#dayCount", /^Day 1 of 12 ?today$/);
      assert.deepEqual(await clocks(page, D1), ["07:00", "21:00水 Wed"]);
      assert.equal(await count(page, D1 + " .eve .r"), 2);
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), true);
      await shot(page, "desktop.png");
    },
  },
);

module.exports = cases;
