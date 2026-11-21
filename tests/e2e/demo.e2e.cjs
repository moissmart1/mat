// The demo clock: from Settings, "Try another day" makes the Days screen
// behave as if it were a chosen trip day (07:00, running 120x, holding at
// 23:30). Only Days follows it: Money, the register's day, History times and
// everything sent to the backend use the real time (R28). Nothing is stored,
// so a reload ends it. The plan is tests/fixtures/plan.json over the seed; the
// real time is Nov 15, 12:00 in Japan, before the trip.

const assert = require("node:assert/strict");
const { WITH_PLAN, open, advance, until, atRest, text, expectText, visible } = require("./helpers.cjs");

const NOV15 = Date.parse("2026-11-15T12:00:00+09:00");
const row = (id) => '.r[data-id="' + id + '"]';
const MEIJI = "planstop1201";
const SKY = "planstop1203";
// Anything sent that is not a read (load, rev, history) counts as a write.
const READS = ["load", "rev", "history"];

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: WITH_PLAN, tab: "days", nowMs: NOV15, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}

// The app goes to the background (hidden true) or comes back.
const setHidden = (page, hidden) => page.evaluate((h) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}, hidden);
const demoDay = (page) => page.evaluate(() => globalThis.__matTest.clock.demoDay());
// A plan whose Dec 12 ticket is taller than the screen.
const LONG = { ...WITH_PLAN, stops: [...WITH_PLAN.stops, ...Array.from({ length: 16 }, (_, i) => ({ id: "longstop" + String(i).padStart(2, "0"), date: "2026-12-12", time: String(10 + (i % 12)).padStart(2, "0") + ":" + (i < 12 ? "10" : "40"), title: "Extra stop " + i }))] };

const waitYou = (page) => atRest(page, "#you", { message: "Settings opens" });

// Settings, Try another day, then the day's button ("Sat 12").
async function tryDay(page, label) {
  await page.click("#youBtn");
  await waitYou(page);
  await page.click("#setDemo");
  await until(() => visible(page, "#setDemoDays button"), "the days show");
  const date = await page.evaluate((l) => [...document.querySelectorAll("#setDemoDays button[data-date]")].find((b) => b.textContent === l).dataset.date, label);
  await page.click('#setDemoDays button[data-date="' + date + '"]');
  await expectText(page, "#demo", /^Pretending it’s /);
}

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
const klass = (page, sel) => page.evaluate((s) => (document.querySelector(s) || { className: "" }).className, sel);
const writes = (backend) => backend.requests.filter((r) => !READS.includes(r.action));

module.exports = [
  {
    name: "try a day: Settings closes, Days shows that day at 07:00",
    async run({ page }) {
      await ready(page);
      await expectText(page, "#dayCount", /^Day 1 of 11 in 25 days/);
      assert.equal(await visible(page, "#demo"), false);
      await page.click("#youBtn");
      await waitYou(page);
      await expectText(page, "#setDemo", /^Try another day\s*See how a day will look before you go/);
      assert.equal(await visible(page, "#setDemoDays"), false, "the days are folded away");
      await page.click("#setDemo");
      const labels = await page.$$eval("#setDemoDays button[data-date]", (bs) => bs.map((b) => b.textContent));
      assert.equal(labels.length, 11);
      assert.equal(labels[2], "Sat 12");
      await page.click('#setDemoDays button[data-date="2026-12-12"]');
      await atRest(page, "#you", { open: false, message: "Settings closes" });
      await expectText(page, "#demo", "Pretending it’s Sat Dec 12, 07:00Stop");
      await expectText(page, "#dayCount", /^Day 3 of 11 today/);
      await until(async () => (await inView(page)) === "2026-12-12", "Dec 12 is in view");
      assert.ok((await klass(page, row(MEIJI))).includes("is-next"), "Meiji Shrine is next");
      await expectText(page, row(MEIJI) + " .r-s", /^Next, in 2 h\./);
      assert.equal(await visible(page, "#demo"), true);
    },
  },
  {
    name: "it runs fast, and Shibuya Sky is done by 15:00",
    async run({ page }) {
      const backend = await ready(page);
      await tryDay(page, "Sat 12");
      await advance(page, backend, 60000);
      await expectText(page, "#demo", /09:00/);
      await expectText(page, row(MEIJI) + " .r-s", /^Now\./);
      await advance(page, backend, 180000);
      await expectText(page, "#demo", /15:00/);
      await until(async () => (await klass(page, row(SKY))).includes("is-done"), "Shibuya Sky is done");
    },
  },
  {
    name: "it holds at the end of the day",
    async run({ page }) {
      const backend = await ready(page);
      await tryDay(page, "Sat 12");
      await advance(page, backend, 600000);
      await expectText(page, "#demo", /Sat Dec 12, 23:30/);
      await expectText(page, "#dayCount", /^Day 3 of 11 today/);
      await advance(page, backend, 600000);
      await expectText(page, "#demo", /Sat Dec 12, 23:30/);
    },
  },
  {
    name: "it touches nothing real: Ring up is dated with the real day, History times are real",
    async run({ page }) {
      const backend = await ready(page);
      await tryDay(page, "Sat 12");
      await advance(page, backend, 60000); // the demo says 09:00; the real time is 12:01 on Nov 15
      await page.click("#ring");
      await atRest(page, "#reg", { message: "the register opens" });
      await expectText(page, "#xDay", "Before");
      assert.equal(writes(backend).length, 0, "opening the register sends nothing");
      await page.fill("#xWhat", "Ramen");
      await page.click("#kCur"); // dollars to yen
      for (const k of "5 0 0".split(" ")) await page.click('#pad .key[data-k="' + k + '"]');
      await until(() => page.evaluate(() => !document.getElementById("kGo").disabled), "Ring it up is ready");
      await page.click("#kGo");
      const add = await until(() => backend.requests.find((r) => r.action === "addExpense"), "the line is sent");
      assert.equal(add.args.expense.day, "pre", "dated with the real day");
      assert.equal(writes(backend).length, 1);
      await page.click("#regDone");
      await expectText(page, "#demo", /Pretending it’s Sat Dec 12, 09:/);
      // History: the line was added at the real 12:01, not at the demo's time.
      await page.click("#youBtn");
      await waitYou(page);
      await page.click("#setHist");
      await until(() => page.evaluate(() => document.querySelectorAll("#tape .tp-row").length > 0), "History has rows");
      const first = await page.$eval("#tape .tp-row time", (t) => t.textContent);
      assert.equal(first, "12:01", "History shows the real time");
      assert.equal(await text(page, "#tape .tp-row .tp-s"), "Mo rang up Ramen ¥500");
    },
  },
  {
    name: "Stop ends it, with no signal too",
    async run({ page }) {
      const backend = await ready(page);
      await tryDay(page, "Sat 12");
      backend.failWith = "network";
      await page.click("#demoStop");
      await until(async () => !(await visible(page, "#demo")), "the banner goes");
      await expectText(page, "#dayCount", /^Day 1 of 11 in 25 days/);
      await until(async () => (await inView(page)) === "2026-12-10", "the rail is back on Day 1");
      assert.equal(await visible(page, "#demoStop"), false);
    },
  },
  {
    name: "a day browsed while the demo runs is left alone, then Stop goes back to the real today",
    async run({ page }) {
      const backend = await ready(page);
      await tryDay(page, "Sat 12");
      await page.click("#pager .sq:nth-child(6)");
      await until(async () => (await inView(page)) === "2026-12-15", "Dec 15 is in view");
      await advance(page, backend, 120000);
      await expectText(page, "#demo", /11:00/);
      assert.equal(await inView(page), "2026-12-15", "the rail stays where it was put");
      await page.click("#demoStop");
      await until(async () => (await inView(page)) === "2026-12-10", "Stop returns to Day 1");
    },
  },
  {
    name: "the all-days list follows the demo",
    async run({ page }) {
      const backend = await ready(page);
      await tryDay(page, "Sat 12");
      await page.click("#dayCount");
      await atRest(page, "#allDays", { message: "the list opens" });
      const stamps = () => page.$$eval("#allDaysList .ad-row", (rows) => rows.map((r) => (r.querySelector(".ad-st") || {}).textContent || ""));
      const s = await stamps();
      assert.deepEqual(s.slice(0, 4), ["used", "used", "today", ""]);
      await page.keyboard.press("Escape");
      await page.click("#demoStop");
      await page.click("#dayCount");
      await until(async () => (await stamps()).every((x) => x === "" ), "the list is back to the real day");
      void backend;
    },
  },
  {
    name: "a reload ends it",
    async run({ page }) {
      await ready(page);
      await tryDay(page, "Sat 12");
      await page.reload();
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw again");
      assert.equal(await visible(page, "#demo"), false);
      await expectText(page, "#dayCount", /^Day 1 of 11 in 25 days/);
      assert.equal(await page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter((k) => /demo|pretend/i.test(k)))), "[]", "nothing stored");
    },
  },
  {
    name: "started from Money: Days shows, and Money keeps the real day",
    async run({ page }) {
      await ready(page, { tab: "money" });
      await page.click("#youBtn");
      await waitYou(page);
      await page.click("#setDemo");
      await page.click('#setDemoDays button[data-date="2026-12-12"]');
      await expectText(page, "#demo", /Pretending it’s Sat Dec 12, 07:/);
      assert.equal(await page.evaluate(() => document.getElementById("vDays").classList.contains("is-active")), true);
      await expectText(page, "#dayCount", /^Day 3 of 11 today/);
      await until(async () => (await inView(page)) === "2026-12-12", "Dec 12 is in view");
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.tab")), "money", "the remembered screen is untouched");
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.tabDay")), "2026-11-15", "and so is the day it was remembered on (the real one)");
      await page.click('[data-tab="days"]');
      await page.click("#demoStop");
      await until(async () => !(await visible(page, "#demo")), "Stop works");
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.tab")), "days", "going to Days by hand remembers Days");
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.tabDay")), "2026-11-15", "after Stop the remembered day is still the real one");
    },
  },
  {
    name: "R34 a: the banner stays in view while Days is scrolled, covers no ticket at rest, moves no snap position",
    async run({ page }) {
      await ready(page, { seed: LONG });
      const snaps = () => page.evaluate(() => {
        const rail = document.getElementById("rail");
        return [...rail.querySelectorAll(".pg")].map((p) => p.offsetLeft - rail.offsetLeft);
      });
      const without = await snaps();
      await tryDay(page, "Sat 12");
      await until(async () => (await inView(page)) === "2026-12-12", "Dec 12 is in view");
      assert.deepEqual(await snaps(), without, "the rail's snap positions are the same with the banner on");
      const rest = await page.evaluate(() => ({ demo: document.getElementById("demo").getBoundingClientRect().bottom, rail: document.getElementById("rail").getBoundingClientRect().top }));
      assert.ok(rest.demo <= rest.rail, "at rest the banner covers no part of the ticket: " + JSON.stringify(rest));
      const tall = await page.evaluate(() => { const v = document.getElementById("vDays"); return v.scrollHeight > v.clientHeight + 200; });
      assert.equal(tall, true, "the ticket is taller than the screen");
      await page.evaluate(() => { const v = document.getElementById("vDays"); v.scrollTop = v.scrollHeight; });
      await until(() => page.evaluate(() => document.getElementById("vDays").scrollTop > 100), "Days scrolled");
      const at = await page.evaluate(() => {
        const r = document.getElementById("demoStop").getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { top: r.top, bottom: r.bottom, hit: hit && hit.id };
      });
      assert.ok(at.top >= 0 && at.bottom <= 844, "the banner is inside the viewport: " + JSON.stringify(at));
      assert.equal(at.hit, "demoStop", "Stop can be tapped");
      await page.click("#demoStop");
      await until(async () => !(await visible(page, "#demo")), "Stop works from down the ticket");
    },
  },
  {
    name: "R34 a: the sticky banner sits under an open sheet",
    async run({ page }) {
      await ready(page, { seed: LONG });
      await tryDay(page, "Sat 12");
      await page.click("#dayCount");
      await atRest(page, "#allDays", { message: "the list opens" });
      const hit = await page.evaluate(() => {
        const r = document.getElementById("demo").getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el && el.classList.contains("scrim") ? "scrim" : (el && (el.id || el.className));
      });
      assert.equal(hit, "scrim", "the dimmed area is over the banner, not the banner over it");
    },
  },
  {
    name: "R34 b: back after more than 10 minutes, the demo has ended like Stop",
    async run({ page }) {
      const backend = await ready(page);
      await tryDay(page, "Sat 12");
      await setHidden(page, true);
      await advance(page, backend, 11 * 60000);
      await setHidden(page, false);
      await until(async () => !(await visible(page, "#demo")), "the banner goes");
      assert.equal(await demoDay(page), null);
      await expectText(page, "#dayCount", /^Day 1 of 11 in 25 days/);
      await until(async () => (await inView(page)) === "2026-12-10", "the rail is on the real today's ticket");
    },
  },
  {
    name: "R34 b: back after 9 minutes, the demo goes on",
    async run({ page }) {
      const backend = await ready(page);
      await tryDay(page, "Sat 12");
      await setHidden(page, true);
      await advance(page, backend, 9 * 60000);
      await setHidden(page, false);
      assert.equal(await demoDay(page), "2026-12-12");
      assert.equal(await visible(page, "#demo"), true);
    },
  },
  {
    name: "R34 b: back on another real trip-zone day, the demo has ended",
    async run({ page }) {
      const backend = await ready(page, { nowMs: Date.parse("2026-11-15T23:55:00+09:00") });
      await tryDay(page, "Sat 12");
      await setHidden(page, true);
      await advance(page, backend, 8 * 60000); // 00:03 on Nov 16
      await setHidden(page, false);
      await until(async () => !(await visible(page, "#demo")), "the banner goes");
      assert.equal(await demoDay(page), null);
    },
  },
  {
    name: "R34 c: at the end of the day the fast tick goes back to the normal one",
    async run({ page }) {
      const backend = await ready(page);
      await page.evaluate(() => {
        const orig = window.setInterval.bind(window);
        window.__iv = [];
        window.setInterval = (f, d, ...a) => (window.__iv.push(d), orig(f, d, ...a));
      });
      await tryDay(page, "Sat 12");
      assert.equal((await page.evaluate(() => window.__iv)).pop(), 500, "fast while it runs");
      await advance(page, backend, 600000);
      await expectText(page, "#demo", /23:30/);
      await until(async () => (await page.evaluate(() => window.__iv)).pop() === 15000, "the normal tick is back");
    },
  },
  {
    name: "the You row says On while a demo runs, even over Money",
    async run({ page }) {
      await ready(page);
      await tryDay(page, "Sat 12");
      await page.click('[data-tab="money"]');
      await page.click("#youBtn");
      await waitYou(page);
      await expectText(page, "#setDemoV", "On");
    },
  },
  {
    name: "R34 b: exactly 10 minutes away keeps the demo",
    async run({ page }) {
      const backend = await ready(page);
      await tryDay(page, "Sat 12");
      await setHidden(page, true);
      await advance(page, backend, 10 * 60000);
      await setHidden(page, false);
      assert.equal(await demoDay(page), "2026-12-12");
      assert.equal(await visible(page, "#demo"), true);
    },
  },
  {
    name: "R34 b: a visible phone on Days ends the demo when the real day rolls over, and its timers stop",
    async run({ page }) {
      const backend = await ready(page, { nowMs: Date.parse("2026-11-15T23:55:00+09:00") });
      // Every interval set from here on, with how often its callback has run.
      await page.evaluate(() => {
        const orig = window.setInterval.bind(window);
        window.__iv = [];
        window.setInterval = (f, d, ...a) => {
          const rec = { d, fires: 0 };
          window.__iv.push(rec);
          return orig((...x) => { rec.fires += 1; return f(...x); }, d, ...a);
        };
      });
      await tryDay(page, "Sat 12");
      await advance(page, backend, 600000); // the demo holds at 23:30; the real time is 00:05 on Nov 16
      await until(async () => !(await visible(page, "#demo")), "the banner goes");
      assert.equal(await demoDay(page), null);
      await expectText(page, "#dayCount", /^Day 1 of 11 in 24 days/);
      await until(async () => (await inView(page)) === "2026-12-10", "the rail is on the real today's ticket");
      const ivs = () => page.evaluate(() => window.__iv.map((r) => ({ ...r })));
      assert.equal((await ivs()).pop().d, 15000, "the normal tick");
      const guards = (list) => list.filter((r) => r.d === 30000);
      const fast = (list) => list.filter((r) => r.d === 500);
      const before = await ivs();
      assert.ok(guards(before).length >= 1 && guards(before).some((r) => r.fires > 0), "the demo's guard ran while it lasted: " + JSON.stringify(before));
      // Nothing is left running for the demo: over a long wait no new timer
      // starts, and neither the guard nor the fast tick fires again.
      await advance(page, backend, 120000);
      const after = await ivs();
      assert.equal(after.length, before.length, "no new timer");
      assert.deepEqual(guards(after).map((r) => r.fires), guards(before).map((r) => r.fires), "the guard interval was cleared");
      assert.deepEqual(fast(after).map((r) => r.fires), fast(before).map((r) => r.fires), "the fast tick was cleared");
    },
  },
  {
    name: "R34 b: with Money showing on a visible page, the demo ends at the date change too",
    async run({ page }) {
      const backend = await ready(page, { nowMs: Date.parse("2026-11-15T23:55:00+09:00") });
      await tryDay(page, "Sat 12");
      await page.click('[data-tab="money"]');
      await advance(page, backend, 600000);
      await until(async () => (await demoDay(page)) === null, "the demo ended under Money");
      await page.click('[data-tab="days"]');
      assert.equal(await visible(page, "#demo"), false, "no banner on Days");
      await expectText(page, "#dayCount", /^Day 1 of 11 in 24 days/);
      await page.click('[data-tab="money"]');
      await page.click("#youBtn");
      await waitYou(page);
      await expectText(page, "#setDemoV", "Pick");
    },
  },
];
