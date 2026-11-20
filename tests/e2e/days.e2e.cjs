// Days: a rail of eleven day tickets, the day counter and the squares.
// The plan is tests/fixtures/plan.json over the seed; the clock is 13:20 on
// Dec 12 in Japan, Day 3.

const assert = require("node:assert/strict");
const { WITH_PLAN, NOON12, makeBackend, open, advance, until, text, expectText } = require("./helpers.cjs");

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: WITH_PLAN, tab: "days", ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg").length === 11), "the tickets draw");
  return backend;
}

const tk = (date) => '#rail .pg[data-date="' + date + '"]';

// The date of the ticket the rail is showing (its middle nearest the rail's),
// once it sits squarely in view.
function inView(page) {
  return page.evaluate(() => {
    const rail = document.getElementById("rail").getBoundingClientRect();
    const mid = rail.left + rail.width / 2;
    let best = null;
    for (const pg of document.querySelectorAll("#rail .pg")) {
      const r = pg.getBoundingClientRect();
      const off = Math.abs(r.left + r.width / 2 - mid);
      if (!best || off < best.off) best = { date: pg.dataset.date, off, left: r.left };
    }
    return best && best.off < 2 && best.left >= rail.left && best.left < rail.right ? best.date : null;
  });
}

// The stop names, without the こんど tag the next stop carries.
const rowTitles = (page, date) => page.evaluate((sel) => [...document.querySelectorAll(sel + " .r[data-id] .r-n")].map((n) => n.lastChild.textContent), tk(date));
const rowText = (page, id) => text(page, '.r[data-id="' + id + '"]');

module.exports = [
  {
    name: "eleven tickets, opening on today",
    async run({ page }) {
      await ready(page);
      assert.equal(await page.evaluate(() => document.querySelectorAll("#rail .pg").length), 11);
      await expectText(page, "#dayCount", /^Day 3 of 11/);
      const cur = await page.evaluate(() => [...document.querySelectorAll("#pager .sq")].map((b) => b.classList.contains("is-cur")));
      assert.equal(cur.length, 11);
      assert.deepEqual(cur.map((c, i) => (c ? i : -1)).filter((i) => i >= 0), [2]);
      await until(async () => (await inView(page)) === "2026-12-12", "the Dec 12 ticket is in view");
    },
  },
  {
    name: "a full header",
    async run({ page }) {
      await ready(page);
      const t = tk("2026-12-12");
      await expectText(page, t + " .tk-band", /山手線\s*Yamanote Line/);
      await expectText(page, t + " .num", "D 03");
      assert.equal(await page.evaluate((sel) => getComputedStyle(document.querySelector(sel + " .tk")).getPropertyValue("--line").trim(), t), "#9ACD32");
      const route = await text(page, t + " .tk-route");
      for (const s of ["新宿", "Shinjuku", "渋谷", "Shibuya"]) assert.ok(route.includes(s), "the route reads " + s + ": " + route);
      assert.equal(await page.evaluate((sel) => !!document.querySelector(sel + " .tk-route .arr"), t), true, "the arrow");
      const date = await text(page, t + " .tk-date");
      for (const s of ["12月12日(土)", "Sat Dec 12", "当日限り有効"]) assert.ok(date.includes(s), "the date row reads " + s + ": " + date);
      await expectText(page, t + " .tk-foot", /^2026\.12\.12 MAT発行 00003-01\s*Good for this day only$/);
    },
  },
  {
    name: "a day title prints when there is one",
    async run({ page }) {
      await ready(page);
      await expectText(page, tk("2026-12-11") + " .tk-title", "Temples, then the view");
      assert.equal(await page.evaluate((sel) => document.querySelector(sel + " .tk-title"), tk("2026-12-12")), null);
    },
  },
  {
    name: "a sparse day still prints",
    async run({ page }) {
      await ready(page);
      const d13 = tk("2026-12-13");
      await expectText(page, d13 + " .tk-band", /^Niseko\s*D 04$/);
      await expectText(page, d13 + " .tk-route", "Niseko");
      assert.equal(await page.evaluate((sel) => !!document.querySelector(sel + " .arr"), d13), false, "no arrow");
      const d14 = tk("2026-12-14");
      await expectText(page, d14 + " .tk-band", "D 05");
      await expectText(page, d14 + " .tk-route", "Japan 2026");
      for (const t of [d13, d14]) {
        const all = await text(page, t);
        assert.equal(/undefined|null|NaN/.test(all), false, t + ": " + all);
        await expectText(page, t + " .rows", "Nothing planned yet.");
        // The neutral band: the key colour (--key-hi), whatever it is.
        const band = await page.evaluate((sel) => {
          const css = (el, p) => getComputedStyle(el).getPropertyValue(p).trim();
          return { line: css(document.querySelector(sel + " .tk"), "--line"), keyHi: css(document.documentElement, "--key-hi") };
        }, t);
        assert.equal(band.line, band.keyHi, t + ": a neutral band");
      }
    },
  },
  {
    name: "stops in order, the untimed one last",
    async run({ page }) {
      await ready(page);
      assert.deepEqual(await rowTitles(page, "2026-12-12"), ["Meiji Shrine", "Lunch in Harajuku", "Shibuya Sky", "Dinner", "Buy gloves"]);
      await expectText(page, '.r[data-id="planstop1203"] .r-t', "14:00");
      await expectText(page, '.r[data-id="planstop1203"] .r-j', "渋谷");
      // On today's ticket the next stop's leave-by line comes first.
      await expectText(page, '.r[data-id="planstop1203"] .r-s', /^(Leave by 13:30, in 10 min\. )?Booked for 14:00$/);
      await expectText(page, '.r[data-id="planstop1205"] .r-t', "—");
      assert.equal(/undefined/.test(await rowText(page, "planstop1205")), false);
    },
  },
  {
    name: "the squares jump",
    async run({ page }) {
      await ready(page);
      await until(async () => (await inView(page)) === "2026-12-12", "today is in view");
      await page.click("#pager .sq:nth-child(6)");
      await expectText(page, "#dayCount", /^Day 6 of 11/);
      await until(async () => (await inView(page)) === "2026-12-15", "the Dec 15 ticket is in view");
      assert.equal(await page.evaluate(() => document.querySelector("#pager .sq:nth-child(6)").classList.contains("is-cur")), true);
    },
  },
  {
    name: "a mouse click on either exposed ticket centres it, including the first and last days",
    viewport: { width: 1440, height: 900 },
    mobile: false,
    async run({ page }) {
      await ready(page);
      const centred = (date) => until(async () => (await inView(page)) === date, date + " is centred");
      const clickEdge = async (date, side, day) => {
        const point = await page.evaluate(({ selector, side }) => {
          const paper = document.querySelector(selector + " .tk");
          const rail = document.getElementById("rail").getBoundingClientRect();
          const pane = document.getElementById("vDays").getBoundingClientRect();
          const x = side === "left" ? rail.left + 4 : rail.right - 4;
          // Click inside the exposed paper, clear of its moving, tilted tip.
          const strip = [];
          for (let y = Math.max(rail.top, pane.top) + 8; y < Math.min(rail.bottom, pane.bottom); y += 4) {
            if (paper.contains(document.elementFromPoint(x, y))) strip.push(y);
          }
          if (strip.length) return { x, y: strip[Math.floor(strip.length / 2)] };
        }, { selector: tk(date), side });
        assert.ok(point, "a strip of " + date + " is visible on the " + side);
        await page.mouse.click(point.x, point.y);
        await centred(date);
        await expectText(page, "#dayCount span", "Day " + day + " of 11");
        assert.equal(await page.getAttribute("#pager [aria-current=date]", "data-i"), String(day - 1));
      };
      await centred("2026-12-12");
      await clickEdge("2026-12-11", "left", 2);
      await clickEdge("2026-12-10", "left", 1);
      await clickEdge("2026-12-11", "right", 2);
      await page.click("#pager .sq:nth-child(10)");
      await centred("2026-12-19");
      await clickEdge("2026-12-20", "right", 11);
      await clickEdge("2026-12-19", "left", 10);
      await page.click(tk("2026-12-19") + " .tk-add");
      await until(() => page.locator("#stop").evaluate((s) => s.classList.contains("is-open")), "the selected ticket opens its stop editor");
    },
  },
  {
    name: "swiping moves one day",
    async run({ page }) {
      await ready(page);
      await until(async () => (await inView(page)) === "2026-12-12", "today is in view");
      const rail = await page.locator("#rail").boundingBox();
      const y = Math.max(rail.y, 0) + 40;
      const touch = await page.context().newCDPSession(page);
      for (let n = 8; n >= 2; n--) {
        const x = rail.x + rail.width * n / 10;
        await touch.send("Input.dispatchTouchEvent", { type: n === 8 ? "touchStart" : "touchMove", touchPoints: [{ x, y }] });
      }
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expectText(page, "#dayCount", /^Day 4 of 11/);
      await until(async () => (await inView(page)) === "2026-12-13", "the Dec 13 ticket is in view");
    },
  },
  {
    name: "another phone’s stop appears, and the day in view stays",
    async run({ page }) {
      const backend = await ready(page);
      await until(async () => (await inView(page)) === "2026-12-12", "today is in view");
      await page.click("#pager .sq:nth-child(6)");
      await until(async () => (await inView(page)) === "2026-12-15", "Day 6 is in view");
      const env = await backend.handle({ key: "test-key", actor: "Ajen", via: "app", action: "addStop", args: { stop: { id: "ajenstop0001", date: "2026-12-12", time: "16:00", title: "Tower Records" } } });
      assert.equal(env.ok, true, JSON.stringify(env));
      await advance(page, backend, 20000);
      await until(() => page.evaluate((sel) => document.querySelectorAll(sel + " .r[data-id]").length === 6, tk("2026-12-12")), "the new stop is on the Dec 12 ticket");
      await expectText(page, "#dayCount", /^Day 6 of 11/);
      assert.equal(await inView(page), "2026-12-15");
    },
  },
  {
    name: "no sideways scroll of the page",
    async run({ page }) {
      await ready(page);
      const flat = () => page.evaluate(() => {
        const s = document.scrollingElement;
        return s.scrollWidth === s.clientWidth;
      });
      assert.equal(await flat(), true, "on Days");
      await page.click('[data-tab="money"]');
      await until(() => page.evaluate(() => document.getElementById("vMoney").classList.contains("is-active")), "Money shows");
      assert.equal(await flat(), true, "on Money");
    },
  },
  {
    name: "a phone holding the Plan 1 cache: Days paints from it without error, and Money is the same once the load lands (M4)",
    async run({ page }) {
      const backend = makeBackend(WITH_PLAN, { now: NOON12 });
      const old = await backend.fake.plan1Load();
      // The load waits, so the first paint is the Plan 1 cache alone.
      const real = backend.handle;
      let release;
      const gate = new Promise((r) => (release = r));
      backend.handle = async (body) => {
        if (body.action === "load") await gate;
        return real(body);
      };
      await open(page, { backend, tab: "days", storage: { "mat.cache": JSON.stringify({ data: old.data, rev: old.rev, loadedAt: NOON12 }) } });
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw from the cache");
      await expectText(page, "#dayCount", /^Day 3 of 11/);
      assert.ok((await text(page, tk("2026-12-12"))).includes("Shibuya Sky"), "the cached stops are on the ticket");
      assert.ok((await text(page, tk("2026-12-11") + " .tk-stay")).includes("Asakusa hotel"), "the cached stay is on its night");
      await page.click('#nav button[data-tab="money"]');
      const money = () => page.evaluate(() => ["say", "slip", "rc", "asideNote"].map((id) => (document.getElementById(id) || { textContent: "" }).textContent.replace(/\s+/g, " ").trim()));
      const before = await money();
      assert.ok(before[2].length > 0, "the receipt prints");
      release();
      await page.evaluate(() => globalThis.__matTest.store.idle());
      assert.equal(backend.requests.filter((r) => r.action === "load").length, 1, "the load landed");
      assert.deepEqual(await money(), before);
    },
  },
];
