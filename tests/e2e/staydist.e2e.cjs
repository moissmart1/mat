// Lodging distance (location build, item 7): the hotel card says "2.4 km from
// here" under its 現在地 box when a usable position and the stay's
// coordinates exist; otherwise the card is as it was. 13:20 on Dec 12 in Japan.

const assert = require("node:assert/strict");
const fs = require("fs");
const { WITH_PLAN, open, advance, until, atRest, text } = require("./helpers.cjs");
const { geoStub, leaks, HERE } = require("./geostub.cjs");

const SHOTS = require("./shots.cjs")("loc");
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
};
const D12 = '#rail .pg[data-date="2026-12-12"]';

function seed(at = true, over = {}) {
  const s = JSON.parse(JSON.stringify(WITH_PLAN));
  if (at) Object.assign(s.stays.find((x) => x.id === "planstay0001"), { lat: String(HERE.lat + 2400 / 111195), lng: String(HERE.lng), ...over });
  return s;
}
async function ready(page, { where = "on", geo = {}, at = true, over = {}, ...opts } = {}) {
  await geoStub(page, geo);
  const backend = await open(page, { seed: seed(at, over), tab: "days", storage: where ? { "mat.where": where } : {}, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}
async function openCard(page) {
  await page.dispatchEvent(D12 + " .tk-stay", "click");
  await atRest(page, "#stay", { message: "the card opens" });
  await until(() => page.evaluate(() => getComputedStyle(document.getElementById("stay")).transform === "none"), "the card has risen");
}
const dist = (page) => page.evaluate(() => {
  const d = document.querySelector("#stay .sy-dist");
  return d ? { box: d.querySelector(".here").textContent, text: d.querySelector(".dist").textContent } : null;
});

const SIZES = [
  { tag: "393", viewport: { width: 393, height: 852 } },
  { tag: "320", viewport: { width: 320, height: 568 } },
  { tag: "844-sideways", viewport: { width: 844, height: 390 } },
  { tag: "1440-wide", viewport: { width: 1440, height: 900 }, mobile: false },
];

module.exports = [
  ...SIZES.map(({ tag, viewport, mobile }) => ({
    name: "the hotel card says how far, at " + tag,
    viewport,
    mobile,
    async run({ page }) {
      const backend = await ready(page);
      await until(() => page.evaluate(() => window.__geoCalls.length > 0), "the phone was asked");
      await openCard(page);
      await until(async () => (await dist(page)) !== null, "the distance shows");
      assert.deepEqual(await dist(page), { box: "現在地", text: "2.4 km from here" });
      const lay = await page.evaluate(() => {
        const d = document.querySelector("#stay .sy-dist").getBoundingClientRect();
        const key = document.querySelector("#stay .drv").getBoundingClientRect();
        const s = document.getElementById("stay");
        return { under: d.top >= key.bottom - 0.5, sw: s.scrollWidth, cw: s.clientWidth };
      });
      assert.ok(lay.under && lay.sw <= lay.cw, JSON.stringify(lay));
      await page.evaluate(() => document.querySelector("#stay .sy-dist").scrollIntoView({ block: "center" }));
      await shot(page, "4-card-distance-" + tag);
      assert.deepEqual(await leaks(page, backend, HERE, { latOnly: true }), [], "these places share the phone's longitude: its latitude is checked");
    },
  })),
  ...[
    ["off", { where: "off" }],
    ["refused", { geo: { mode: "refused" } }],
    ["stale", { geo: { ageMs: 4 * 60000 } }],
    ["rough", { geo: { accuracy: 800 } }],
    ["no coordinates for the stay", { at: false }],
  ].map(([what, opts]) => ({
    name: "no distance on the card: " + what,
    async run({ page }) {
      await ready(page, opts);
      await new Promise((r) => setTimeout(r, 120));
      await openCard(page);
      assert.equal(await dist(page), null);
      assert.equal(await page.evaluate(() => document.querySelectorAll("#stay .here").length), 0);
    },
  })),
  {
    name: "far away still says how far, in whole kilometres",
    async run({ page }) {
      await ready(page, { over: { lat: String(HERE.lat + 0.3), lng: String(HERE.lng) } });
      await until(() => page.evaluate(() => window.__geoCalls.length > 0), "the phone was asked");
      await openCard(page);
      await until(async () => (await dist(page)) !== null, "the distance shows");
      assert.equal((await dist(page)).text, "33 km from here");
    },
  },
  {
    name: "(b) over 50 km: nothing said",
    async run({ page }) {
      await ready(page, { over: { lat: String(HERE.lat + 0.6), lng: String(HERE.lng) } });
      await until(() => page.evaluate(() => window.__geoCalls.length > 0), "the phone was asked");
      await openCard(page);
      await new Promise((r) => setTimeout(r, 120));
      assert.equal(await dist(page), null);
    },
  },
  {
    name: "(b) the card drops the distance once the position is no longer usable",
    async run({ page }) {
      const backend = await ready(page);
      await until(() => page.evaluate(() => window.__geoCalls.length > 0), "the phone was asked");
      await openCard(page);
      await until(async () => (await dist(page)) !== null, "the distance shows");
      await page.evaluate(() => window.__geoSet({ mode: "silent" }));
      await advance(page, backend, 3 * 60000 + 20000);
      await until(async () => (await dist(page)) === null, "the old distance goes");
      assert.equal(await page.evaluate(() => document.getElementById("stay").classList.contains("is-open")), true);
    },
  },
  {
    name: "a stay with no Japanese (no driver key) still says how far",
    async run({ page }) {
      await ready(page, { over: { nameJp: "", addressJp: "" } });
      await until(() => page.evaluate(() => window.__geoCalls.length > 0), "the phone was asked");
      await openCard(page);
      await until(async () => (await dist(page)) !== null, "the distance shows");
      assert.equal(await page.evaluate(() => document.querySelectorAll("#stay .drv").length), 0);
      assert.equal(await text(page, "#stay .sy-dist .dist"), "2.4 km from here");
    },
  },
];
