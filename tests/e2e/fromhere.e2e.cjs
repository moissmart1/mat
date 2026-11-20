// Directions from here (location build, item 1): the stop's Directions key
// opens Google Maps with no starting point, so Maps starts from wherever the
// phone is; the first stop opened in a visit says so in one line under the
// keys. MAT asks the phone for nothing for this. The plan is
// tests/fixtures/plan.json over the seed; 13:20 on Dec 12 in Japan (Day 3),
// where Shibuya Sky is the next stop and open by itself.

const assert = require("node:assert/strict");
const fs = require("fs");
const { WITH_PLAN, open, until } = require("./helpers.cjs");

const SHOTS = require("./shots.cjs")("loc");
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
};

const SKY = "planstop1203";
const MEIJI = "planstop1201";
const DINNER = "planstop1204";
const WHY = "Opens Maps from where your phone is, by train and bus.";
const row = (id) => '.r[data-id="' + id + '"]';

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: WITH_PLAN, tab: "days", ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}

// The stop's open part has finished sliding open.
const openDone = (page, id) => until(() => page.evaluate((sel) => {
  const r = document.querySelector(sel);
  const inner = r && r.querySelector(".r-more > div");
  return !!inner && r.classList.contains("is-open") && Math.abs(inner.getBoundingClientRect().height - inner.scrollHeight) < 1;
}, row(id)), id + " has opened");

// The why-line of a stop: whether it shows, and its words.
const why = (page, id) => page.evaluate((sel) => {
  const p = document.querySelector(sel + " .r-why");
  return p ? { shown: p.getClientRects().length > 0, text: p.textContent } : null;
}, row(id));

// The key and the line sit inside the ticket, on screen sideways, and do not overlap.
async function laidOut(page, id, maxLines = 1) {
  const got = await page.evaluate((sel) => {
    const r = document.querySelector(sel);
    const tk = r.closest(".tk").getBoundingClientRect();
    const a = r.querySelector("a.r-map").getBoundingClientRect();
    const p = r.querySelector(".r-why").getBoundingClientRect();
    const btns = r.querySelector(".r-btns").getBoundingClientRect();
    return { tk: [tk.left, tk.right], a: [a.left, a.right, a.top, a.bottom], p: [p.left, p.right, p.top], btnsBottom: btns.bottom, vw: innerWidth, sw: document.documentElement.scrollWidth };
  }, row(id));
  assert.ok(got.a[0] >= got.tk[0] && got.a[1] <= got.tk[1] + 0.5, "the key is inside the ticket: " + JSON.stringify(got));
  assert.ok(got.p[0] >= got.tk[0] && got.p[1] <= got.tk[1] + 0.5, "the line is inside the ticket: " + JSON.stringify(got));
  assert.ok(got.p[2] >= got.btnsBottom - 0.5, "the line is under the keys: " + JSON.stringify(got));
  assert.ok(got.sw <= got.vw, "no sideways scroll: " + JSON.stringify(got));
  // The key's words stay on one line.
  const lines = await page.evaluate((sel) => {
    const a = document.querySelector(sel + " a.r-map");
    const range = document.createRange();
    range.selectNodeContents(a);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  }, row(id));
  // On a 320 phone the stop's column is narrower than the words: two even lines, never cut.
  assert.ok(lines <= maxLines, "地図 Directions from here ↗ is on " + lines + " line(s), at most " + maxLines);
}

const SIZES = [
  { tag: "393", viewport: { width: 393, height: 852 } },
  { tag: "320", viewport: { width: 320, height: 568 } },
  { tag: "844-sideways", viewport: { width: 844, height: 390 } },
  { tag: "1440-wide", viewport: { width: 1440, height: 900 }, mobile: false },
];

module.exports = [
  ...SIZES.map(({ tag, viewport, mobile }) => ({
    name: "Directions from here, with its line, at " + tag,
    viewport,
    mobile,
    async run({ page }) {
      await ready(page);
      await openDone(page, SKY);
      const link = await page.evaluate((sel) => {
        const a = document.querySelector(sel + " a.r-map");
        return { text: a.textContent, href: a.getAttribute("href"), target: a.target, rel: a.rel };
      }, row(SKY));
      assert.deepEqual(link, { text: "地図 Directions from here ↗", href: "https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=Shibuya%20Sky", target: "_blank", rel: "noopener" });
      assert.deepEqual(await why(page, SKY), { shown: true, text: WHY });
      await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: "center" }), row(SKY) + " .r-why");
      await laidOut(page, SKY, tag === "320" ? 2 : 1);
      await shot(page, "1-directions-" + tag);
    },
  })),
  {
    name: "the line shows on the first stop opened in a visit, not on the next one",
    async run({ page }) {
      await ready(page);
      await openDone(page, SKY);
      assert.equal((await why(page, SKY)).shown, true);
      // Another stop, opened by hand: the same key, no line.
      await page.dispatchEvent(row(DINNER) + " .r-b", "click");
      await openDone(page, DINNER);
      assert.equal(await page.evaluate((sel) => document.querySelector(sel + " a.r-map").textContent, row(DINNER)), "地図 Directions from here ↗");
      assert.equal((await why(page, DINNER)).shown, false, "no line on the second stop opened");
      await page.dispatchEvent(row(MEIJI) + " .r-b", "click");
      await openDone(page, MEIJI);
      assert.equal((await why(page, MEIJI)).shown, false, "nor on the third");
      const href = await page.evaluate((sel) => document.querySelector(sel + " a.r-map").getAttribute("href"), row(MEIJI));
      assert.equal(href, "https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=Meiji%20Jingu", "the day's first stop starts from the phone too");
      // A reload is a new visit: the line is back on the first stop opened.
      await page.reload();
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw again");
      await openDone(page, SKY);
      assert.equal((await why(page, SKY)).shown, true, "a new visit says it again");
    },
  },
  {
    name: "with no next stop, the first stop a person opens carries the line",
    async run({ page }) {
      await ready(page, { nowMs: Date.parse("2026-12-12T23:00:00+09:00") });
      assert.equal(await page.evaluate(() => document.querySelectorAll("#rail .r.is-open").length), 0, "nothing opens by itself");
      await page.dispatchEvent(row(DINNER) + " .r-b", "click");
      await openDone(page, DINNER);
      assert.equal((await why(page, DINNER)).shown, true);
      await page.dispatchEvent(row(SKY) + " .r-b", "click");
      await openDone(page, SKY);
      assert.equal((await why(page, SKY)).shown, false);
    },
  },
  {
    name: "Directions asks the phone for nothing",
    async run({ page }) {
      await page.addInitScript(() => {
        window.__asked = 0;
        const g = navigator.geolocation;
        if (g) {
          g.getCurrentPosition = () => { window.__asked++; };
          g.watchPosition = () => { window.__asked++; return 0; };
        }
      });
      await ready(page);
      await openDone(page, SKY);
      assert.equal(await page.evaluate(() => window.__asked), 0);
    },
  },
];
