// Leave by, from where you are (location build, item 5). Shibuya Sky (14:00,
// next at 13:20 on Dec 12) is given coordinates; the phone is stood in 1.2 km
// north of it: 20 minutes on foot. With a usable position within 3 km the
// stop shows the 現在地 line and the leave line from the walking minutes;
// otherwise (off, refused, stale, rough, far) today's line, unchanged.

const assert = require("node:assert/strict");
const fs = require("fs");
const { WITH_PLAN, open, advance, until, text } = require("./helpers.cjs");
const { geoStub, leaks } = require("./geostub.cjs");

const SHOTS = require("./shots.cjs")("loc");
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
};
const SKY = "planstop1203";
const SKYAT = { lat: 35.6584421, lng: 139.7022205 };
const north = (m) => ({ lat: SKYAT.lat + m / 111195, lng: SKYAT.lng });
const row = (id) => '.r[data-id="' + id + '"]';
const jp = (hhmm) => Date.parse("2026-12-12T" + hhmm + ":00+09:00");

function seed() {
  const s = JSON.parse(JSON.stringify(WITH_PLAN));
  Object.assign(s.stops.find((x) => x.id === SKY), { lat: String(SKYAT.lat), lng: String(SKYAT.lng) });
  return s;
}
async function ready(page, { geo = {}, at = "13:20", where = "on", ...opts } = {}) {
  await geoStub(page, { ...north(1200), ...geo });
  const consoleText = [];
  page.on("console", (m) => consoleText.push(m.text()));
  const backend = await open(page, { seed: seed(), tab: "days", nowMs: jp(at), storage: where ? { "mat.where": where } : {}, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  backend.consoleText = consoleText;
  return backend;
}
const hereLine = (page) => page.evaluate((sel) => {
  const fx = document.querySelector(sel + " .r-fx.at");
  return fx ? { box: fx.querySelector(".here").textContent, dist: fx.querySelector(".dist").textContent.replace(/\u00a0/g, " ") } : null;
}, row(SKY));
const lead = (page) => text(page, row(SKY) + " .r-lv");

const SIZES = [
  { tag: "393", viewport: { width: 393, height: 852 } },
  { tag: "320", viewport: { width: 320, height: 568 } },
  { tag: "844-sideways", viewport: { width: 844, height: 390 } },
  { tag: "1440-wide", viewport: { width: 1440, height: 900 }, mobile: false },
];

module.exports = [
  ...SIZES.map(({ tag, viewport, mobile }) => ({
    name: "on time, from where you are, at " + tag,
    viewport,
    mobile,
    async run({ page }) {
      const backend = await ready(page);
      await until(async () => (await lead(page)) === "Leave by 13:40, in 20 min.", "the leave line from the walk");
      assert.deepEqual(await hereLine(page), { box: "現在地", dist: "1.2 km · 20 min on foot" });
      const lay = await page.evaluate((sel) => {
        const r = document.querySelector(sel);
        const fx = r.querySelector(".r-fx.at").getBoundingClientRect();
        const fixed = r.querySelector(".r-fx:not(.at)").getBoundingClientRect();
        const s = r.querySelector(".r-s").getBoundingClientRect();
        const tk = r.closest(".tk").getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(r.querySelector(".r-fx.at .dist"));
        const words = [...range.getClientRects()].map((x) => x.right);
        const rows = r.closest(".rows");
        const edge = rows.getBoundingClientRect().right - parseFloat(getComputedStyle(rows).paddingRight);
        const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
        return { underFixed: fx.top >= fixed.bottom - 0.5, aboveLead: fx.bottom <= s.top + 0.5, inside: Math.max(...words) <= edge + 0.5, lines, words, edge, sw: document.documentElement.scrollWidth, vw: innerWidth };
      }, row(SKY));
      assert.ok(lay.underFixed && lay.aboveLead && lay.inside && lay.sw <= lay.vw, JSON.stringify(lay));
      assert.equal(lay.lines, tag === "320" ? 2 : 1, "one line as drawn; two on a 320 phone: " + JSON.stringify(lay));
      await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: "center" }), row(SKY));
      await shot(page, "1-leave-on-time-" + tag);
      assert.deepEqual(await leaks(page, backend), []);
      assert.equal(backend.consoleText.some((t) => t.includes("35.6") || t.includes("139.7")), false, "nothing logged");
    },
  })),
  {
    name: "cutting it close, then late in vermilion, as the minutes pass",
    async run({ page }) {
      const backend = await ready(page);
      await until(async () => (await lead(page)) === "Leave by 13:40, in 20 min.", "on time");
      await page.evaluate((sel) => { document.querySelector(sel).__kept = 1; }, row(SKY));
      await advance(page, backend, 15 * 60000); // 13:35
      await until(async () => (await lead(page)) === "Leave now. 5 min to spare.", "close");
      await advance(page, backend, 11 * 60000); // 13:46
      await until(async () => (await lead(page)) === "About 6 min late. Leave now.", "late");
      assert.equal(await page.evaluate((sel) => getComputedStyle(document.querySelector(sel + " .r-lv")).color, row(SKY)), "rgb(214, 60, 30)");
      assert.equal(await page.evaluate((sel) => document.querySelector(sel).__kept === 1, row(SKY)), true, "the row is patched, not redrawn");
      await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: "center" }), row(SKY));
      await shot(page, "1-leave-late");
      // At 14:00 the stop has started: today's Now.
      await advance(page, backend, 14 * 60000);
      await until(async () => (await lead(page)) === "Now.", "started");
      assert.equal(await hereLine(page), null);
    },
  },
  ...[
    ["off", { where: "off" }],
    ["not asked yet", { where: null }],
    ["refused", { geo: { mode: "refused" } }],
    ["stale (4 minutes old)", { geo: { ageMs: 4 * 60000 } }],
    ["rough (500 m)", { geo: { accuracy: 500 } }],
    ["far (5 km away)", { geo: north(5000) }],
    ["no answer from the phone", { geo: { mode: "silent" } }],
  ].map(([what, opts]) => ({
    name: "falls back to today's line: " + what,
    async run({ page }) {
      await ready(page, opts);
      await new Promise((r) => setTimeout(r, 120));
      assert.equal(await lead(page), "Leave by 13:30, in 10 min.");
      assert.equal(await hereLine(page), null);
      assert.equal(await page.evaluate(() => document.querySelectorAll("#rail .r .here, #rail .r-lv.is-late").length), 0);
      if (what.startsWith("stale")) await shot(page, "1-leave-fallback-stale");
    },
  })),
  {
    name: "the position going away puts today's line back",
    async run({ page }) {
      const backend = await ready(page);
      await until(async () => (await lead(page)) === "Leave by 13:40, in 20 min.", "on time");
      await page.evaluate(() => window.__geoSet({ mode: "silent" }));
      // No new position comes: after 3 minutes the old one is not used.
      await advance(page, backend, 3 * 60000 + 1000);
      await until(async () => (await lead(page)) === "Leave by 13:30, in 7 min.", "today's line, a little later");
      assert.equal(await hereLine(page), null);
    },
  },
];
