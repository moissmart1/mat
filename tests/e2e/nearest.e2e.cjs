// Nearest stop (location build, item 6): on today's ticket each stop still to
// come with no time and coordinates within 3 km shows a 現在地 distance; the
// nearest is tagged 近い; the order never changes. 13:20 on Dec 12 in Japan;
// four untimed stops are added around a stood-in position.

const assert = require("node:assert/strict");
const fs = require("fs");
const { WITH_PLAN, open, advance, until } = require("./helpers.cjs");
const { geoStub, leaks, HERE } = require("./geostub.cjs");

const SHOTS = require("./shots.cjs")("loc");
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
};
const north = (m) => String(HERE.lat + m / 111195);
const D12 = '#rail .pg[data-date="2026-12-12"]';
const LOOSE = [
  { id: "loosestop001", title: "Bamboo grove path", m: 900, signJp: "竹林" },
  { id: "loosestop002", title: "Tenryu-ji garden", m: 650, signJp: "天龍寺" },
  { id: "loosestop003", title: "Monkey park Iwatayama", m: 1400 },
  { id: "loosestop004", title: "Togetsukyo bridge", m: 1100 },
  { id: "loosestop005", title: "A temple far out", m: 8000 },
];

function seed() {
  const s = JSON.parse(JSON.stringify(WITH_PLAN));
  for (const l of LOOSE) s.stops.push({ id: l.id, date: "2026-12-12", time: "", title: l.title, signJp: l.signJp || "", lat: north(l.m), lng: String(HERE.lng) });
  // A timed stop near by: never tagged, never given a distance.
  Object.assign(s.stops.find((x) => x.id === "planstop1204"), { lat: north(100), lng: String(HERE.lng) });
  return s;
}
async function ready(page, { where = "on", geo = {}, ...opts } = {}) {
  await geoStub(page, geo);
  const backend = await open(page, { seed: seed(), tab: "days", storage: where ? { "mat.where": where } : {}, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}
// Each row of today's ticket: its title, distance and tag.
const rows = (page) => page.evaluate((sel) => [...document.querySelectorAll(sel + " .r[data-id]")].map((r) => {
  const d = r.querySelector(".r-fx.at .dist");
  const tag = r.querySelector(".tag.near");
  return { id: r.dataset.id, dist: d ? d.textContent.replace(/ /g, " ") : "", near: tag ? tag.textContent : "" };
}), D12);

const SIZES = [
  { tag: "393", viewport: { width: 393, height: 852 } },
  { tag: "320", viewport: { width: 320, height: 568 } },
  { tag: "844-sideways", viewport: { width: 844, height: 390 } },
  { tag: "1440-wide", viewport: { width: 1440, height: 900 }, mobile: false },
];

module.exports = [
  ...SIZES.map(({ tag, viewport, mobile }) => ({
    name: "open stops get distances, the nearest is tagged, the order is kept, at " + tag,
    viewport,
    mobile,
    async run({ page }) {
      const backend = await ready(page);
      const before = ["planstop1201", "planstop1202", "planstop1203", "planstop1204", "planstop1205", ...LOOSE.map((l) => l.id)];
      await until(async () => (await rows(page)).some((r) => r.near), "a stop is tagged near");
      const got = await rows(page);
      assert.deepEqual(got.map((r) => r.id), before, "the order never changes");
      const by = Object.fromEntries(got.map((r) => [r.id, r]));
      assert.deepEqual(by.loosestop002, { id: "loosestop002", dist: "650 m · 11 min on foot", near: "近い" });
      assert.deepEqual(by.loosestop001, { id: "loosestop001", dist: "900 m · 15 min on foot", near: "" });
      assert.equal(by.loosestop003.dist, "1.4 km · 23 min on foot");
      assert.equal(by.loosestop004.dist, "1.1 km · 18 min on foot");
      assert.equal(by.loosestop005.dist, "", "over 3 km: no distance");
      assert.equal(by.planstop1204.dist, "", "a timed stop gets none");
      assert.equal(by.planstop1205.dist, "", "no coordinates, none");
      assert.equal(got.filter((r) => r.near).length, 1);
      const fit = await page.evaluate((sel) => {
        const tk = document.querySelector(sel + " .tk");
        const rowsEl = tk.querySelector(".rows");
        const edge = rowsEl.getBoundingClientRect().right - parseFloat(getComputedStyle(rowsEl).paddingRight);
        let max = 0;
        for (const d of tk.querySelectorAll(".r-fx.at .dist")) {
          const range = document.createRange();
          range.selectNodeContents(d);
          for (const x of range.getClientRects()) max = Math.max(max, x.right);
        }
        return { max, edge, sw: document.documentElement.scrollWidth, vw: innerWidth };
      }, D12);
      assert.ok(fit.max <= fit.edge + 0.5 && fit.sw <= fit.vw, JSON.stringify(fit));
      await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: "center" }), D12 + ' .r[data-id="loosestop002"]');
      await shot(page, "5-nearest-" + tag);
      assert.deepEqual(await leaks(page, backend, HERE, { latOnly: true }), [], "these places share the phone's longitude: its latitude is checked");
    },
  })),
  {
    name: "off, refused or far away: no distances, no tag, the same rows",
    async run({ page, newPhone }) {
      await ready(page, { where: "off" });
      const plain = await rows(page);
      for (const r of plain) assert.deepEqual([r.dist, r.near], ["", ""]);
      const other = await newPhone();
      await ready(other, { geo: { lat: HERE.lat + 1, lng: HERE.lng } });
      await new Promise((r) => setTimeout(r, 120));
      assert.deepEqual(await rows(other), plain, "far: as if off");
      const third = await newPhone();
      await ready(third, { geo: { mode: "refused" } });
      await new Promise((r) => setTimeout(r, 120));
      assert.deepEqual(await rows(third), plain);
    },
  },
  {
    name: "the phone moves: distances and the tag follow, an open stop stays open and is not redrawn",
    async run({ page }) {
      const backend = await ready(page);
      await until(async () => (await rows(page)).some((r) => r.near), "a stop is tagged near");
      const r3 = D12 + ' .r[data-id="loosestop003"]';
      await page.dispatchEvent(r3 + " .r-b", "click");
      await until(() => page.evaluate((sel) => document.querySelector(sel).classList.contains("is-open"), r3), "the monkey park opens");
      await page.evaluate((sel) => { document.querySelector(sel).__kept = 1; }, r3);
      // Walk 1.3 km north: the monkey park (1.4 km) is now nearest, 100 m off.
      await page.evaluate((lat) => window.__geoSet({ lat }), HERE.lat + 1300 / 111195);
      await advance(page, backend, 2 * 60000 + 1000);
      await until(async () => (await rows(page)).find((r) => r.id === "loosestop003").near === "近い", "the tag moves");
      const by = Object.fromEntries((await rows(page)).map((r) => [r.id, r]));
      assert.equal(by.loosestop003.dist, "100 m · 2 min on foot");
      assert.equal(by.loosestop002.near, "");
      assert.equal(await page.evaluate((sel) => document.querySelector(sel).classList.contains("is-open"), r3), true, "still open");
      // Its tag changed, so its row was drawn again; a row whose distance alone changed is kept.
      const r4 = D12 + ' .r[data-id="loosestop004"]';
      await page.evaluate((sel) => { document.querySelector(sel).__kept = 1; }, r4);
      await page.evaluate((lat) => window.__geoSet({ lat }), HERE.lat + 1310 / 111195);
      await advance(page, backend, 2 * 60000 + 1000);
      await until(async () => (await rows(page)).find((r) => r.id === "loosestop004").dist === "210 m · 4 min on foot", "the bridge's distance moves");
      assert.equal(await page.evaluate((sel) => document.querySelector(sel).__kept === 1, r4), true, "patched in place");
    },
  },
  {
    name: "only another day's ticket: nothing",
    async run({ page }) {
      await ready(page, { nowMs: Date.parse("2026-12-11T13:20:00+09:00") });
      await new Promise((r) => setTimeout(r, 120));
      assert.equal(await page.evaluate(() => document.querySelectorAll("#rail .r-fx.at, #rail .tag.near").length), 0, "Dec 12 is not today");
    },
  },
];
