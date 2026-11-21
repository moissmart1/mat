// The next stop in view (final review I3 b and c): on a long day the open
// next stop is brought on screen when Days opens and on a deliberate jump,
// never on a minute tick or a sync; a swipe to a short day after scrolling
// down a long one shows the new ticket's top, not blank ground.
// Dec 12 has ten stops; at 13:20 in Japan the next is the 8th (13:30).
// Dec 11 has two.

const assert = require("node:assert/strict");
const { WITH_PLAN, open, advance, until, atRest, expectText } = require("./helpers.cjs");

const D11 = "2026-12-11";
const D12 = "2026-12-12";
const TIMES = ["06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:30", "15:00", "17:00"];
const TEN = TIMES.map((time, i) => ({
  id: "tenstop" + String(i + 1).padStart(5, "0"),
  date: D12,
  time,
  title: "Stop " + (i + 1),
  detail: "A line of detail for stop " + (i + 1),
  gettingThere: "Take the Yamanote line two stops, then walk five minutes.",
  travelMin: 10,
}));
const NEXT = TEN[7].id;
const LONG_DAY = { ...WITH_PLAN, stops: [...WITH_PLAN.stops.filter((s) => s.date !== D12), ...TEN] };

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: LONG_DAY, tab: "days", ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}

// Where the row is against what covers the Days view: "ok", or why not.
const readable = (page, id) =>
  page.evaluate((i) => {
    const r = document.querySelector('.r[data-id="' + i + '"]');
    if (!r) return "missing";
    const view = document.getElementById("vDays");
    const box = view.getBoundingClientRect();
    let top = box.top + parseFloat(getComputedStyle(view).paddingTop);
    const demo = document.getElementById("demo");
    if (!demo.hidden) top = Math.max(top, demo.getBoundingClientRect().bottom);
    const bottom = Math.min(box.bottom, document.getElementById("nav").getBoundingClientRect().top);
    const rr = r.getBoundingClientRect();
    return rr.top >= top - 0.5 && rr.bottom <= bottom + 0.5 ? "ok" : "row " + Math.round(rr.top) + "-" + Math.round(rr.bottom) + ", readable " + Math.round(top) + "-" + Math.round(bottom);
  }, id);
const scrollTop = (page) => page.evaluate(() => document.getElementById("vDays").scrollTop);
const setScroll = (page, y) => page.evaluate((v) => { document.getElementById("vDays").scrollTop = v; }, y);
// The rail has stopped and every row has finished sliding open or shut.
const still = (page) =>
  until(() => page.evaluate(() => [...document.querySelectorAll("#rail .r[data-id]")].every((x) => {
    const d = x.querySelector(".r-more > div");
    return !d || d.clientHeight === (x.classList.contains("is-open") ? d.scrollHeight : 0);
  })), "the rows are still");

module.exports = [
  {
    name: "on open, the next stop (the 8th of ten) is on screen and open",
    async run({ page }) {
      await ready(page);
      await expectText(page, "#dayCount", /^Day 3 of 11 ?today$/);
      await until(() => page.evaluate((i) => document.querySelector('.r[data-id="' + i + '"]').classList.contains("is-open"), NEXT), "the next stop is open");
      await still(page);
      let got;
      await until(async () => (got = await readable(page, NEXT)) === "ok", "").catch(() => { throw new Error("the next stop is not on screen: " + got); });
      assert.ok((await scrollTop(page)) > 0, "the view was scrolled down to it");
    },
  },
  {
    name: "a 15-second tick and a sync do not move the view",
    async run({ page }) {
      const backend = await ready(page);
      await still(page);
      await setScroll(page, 0);
      await advance(page, backend, 15000);
      assert.equal(await scrollTop(page), 0, "not on the tick");
      const env = await backend.handle({ key: "test-key", actor: "Ajen", via: "app", action: "updateStop", args: { id: TEN[2].id, patch: { detail: "Changed on another phone" } } });
      assert.equal(env.ok, true, JSON.stringify(env));
      await advance(page, backend, 20000);
      await expectText(page, '.r[data-id="' + TEN[2].id + '"] .r-s', /Changed on another phone/);
      assert.equal(await scrollTop(page), 0, "not on a sync");
    },
  },
  {
    name: "a square tap back to today brings the next stop on screen",
    async run({ page }) {
      await ready(page);
      await still(page);
      await page.click('#pager .sq[data-i="1"]');
      await expectText(page, "#dayCount", /^Day 2 of 11/);
      await setScroll(page, 0);
      await page.click('#pager .sq[data-i="2"]');
      await expectText(page, "#dayCount", /^Day 3 of 11/);
      await still(page);
      let got;
      await until(async () => (got = await readable(page, NEXT)) === "ok", "").catch(() => { throw new Error("the next stop is not on screen: " + got); });
    },
  },
  {
    name: "scrolled to the bottom of the long day, a swipe to a two-stop day shows that ticket's top",
    async run({ page }) {
      await ready(page);
      await still(page);
      await page.evaluate(() => { const v = document.getElementById("vDays"); v.scrollTop = v.scrollHeight; });
      await page.evaluate(() => {
        const rail = document.getElementById("rail");
        rail.scrollBy({ left: -rail.querySelector(".pg").offsetWidth, behavior: "instant" });
      });
      await expectText(page, "#dayCount", /^Day 2 of 11/);
      await until(() => page.evaluate((d) => {
        const v = document.getElementById("vDays");
        const tk = document.querySelector('#rail .pg[data-date="' + d + '"] .tk').getBoundingClientRect();
        const top = v.getBoundingClientRect().top + parseFloat(getComputedStyle(v).paddingTop);
        return tk.top >= top - 0.5 && tk.top < innerHeight;
      }, D11), "the two-stop ticket's top is in view");
      // And a swipe back to today brings the next stop on screen.
      await page.evaluate(() => {
        const rail = document.getElementById("rail");
        rail.scrollBy({ left: rail.querySelector(".pg").offsetWidth, behavior: "instant" });
      });
      await expectText(page, "#dayCount", /^Day 3 of 11/);
      await still(page);
      let got;
      await until(async () => (got = await readable(page, NEXT)) === "ok", "").catch(() => { throw new Error("the next stop is not on screen: " + got); });
    },
  },
  {
    name: "the demo banner does not cover the next stop brought into view",
    async run({ page }) {
      const backend = await ready(page);
      await page.click("#youBtn");
      await atRest(page, "#you", { message: "Settings opens" });
      await page.click("#setDemo");
      await page.click('#setDemoDays button[data-date="' + D12 + '"]');
      await expectText(page, "#demo", /^Pretending it’s Sat Dec 12, 07:00/);
      await advance(page, backend, 190000); // 380 trip minutes: 13:20
      await expectText(page, "#demo", /13:20/);
      await still(page);
      await setScroll(page, 0);
      await page.click('#pager .sq[data-i="2"]');
      await still(page);
      let got;
      await until(async () => (got = await readable(page, NEXT)) === "ok", "").catch(() => { throw new Error("the next stop is not on screen: " + got); });
      await page.click("#demoStop");
    },
  },
];
