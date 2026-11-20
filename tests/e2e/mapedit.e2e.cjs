// Where a stop is (location build, item 3, the app's part): the stop sheet's
// one row, On the map / Not on the map, with a field to paste a Google Maps
// link; the position is read from the link (@lat,lng or !3d…!4d…) and sent as
// the stop's lat and lng. A new place takes the old position off. The plan is
// tests/fixtures/plan.json over the seed; 13:20 on Dec 12 in Japan.

const assert = require("node:assert/strict");
const fs = require("fs");
const { WITH_PLAN, open, until, text } = require("./helpers.cjs");

const SHOTS = require("./shots.cjs")("loc");
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
};

const SKY = "planstop1203";
const DINNER = "planstop1204";
const LINK = "https://www.google.com/maps/place/Shibuya+Sky/@35.6580,139.7016,17z/data=!3m1!4b1!4m6!3m5!8m2!3d35.6584421!4d139.7022205!16s";
const row = (id) => '.r[data-id="' + id + '"]';

function seedAt(id, lat, lng) {
  const seed = JSON.parse(JSON.stringify(WITH_PLAN));
  Object.assign(seed.stops.find((s) => s.id === id), { lat, lng });
  return seed;
}

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: WITH_PLAN, tab: "days", ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}
const isOpen = (page, id) => page.evaluate((i) => !!document.getElementById(i) && document.getElementById(i).classList.contains("is-open"), id);
const waitSheet = (page) => until(() => page.evaluate(() => {
  const s = document.getElementById("stop");
  return !!s && s.classList.contains("is-open") && Math.abs(s.getBoundingClientRect().bottom - innerHeight) < 1;
}), "the stop sheet opens");
async function openEdit(page, id) {
  if (!(await page.evaluate((sel) => document.querySelector(sel).classList.contains("is-open"), row(id)))) await page.dispatchEvent(row(id) + " .r-b", "click");
  await until(() => page.evaluate((sel) => {
    const r = document.querySelector(sel);
    const d = r.querySelector(".r-more > div");
    return r.classList.contains("is-open") && d.clientHeight === d.scrollHeight;
  }, row(id)), "the stop opens");
  await page.dispatchEvent(row(id) + " .r-edit", "click");
  await waitSheet(page);
}
const stored = (backend, id) => {
  const r = backend.fake.tables.Stops.find((x) => x.id === id);
  return [String(r.lat || ""), String(r.lng || "")];
};
const saved = (page) => until(async () => !(await isOpen(page, "stop")), "the sheet closes, saved");

module.exports = [
  {
    name: "a stop not on the map says so; a pasted Maps link puts it there",
    async run({ page }) {
      const backend = await ready(page);
      await openEdit(page, SKY);
      assert.equal(await text(page, "#stAtW"), "Not on the map");
      await page.evaluate(() => document.getElementById("stPin").scrollIntoView({ block: "center" }));
      await shot(page, "3-edit-not-on-map");
      await page.fill("#stPin", LINK);
      assert.equal(await text(page, "#stAtW"), "On the map");
      assert.equal(await text(page, "#stAtS"), "From the pasted link.");
      await page.click("#stSave");
      await saved(page);
      assert.deepEqual(stored(backend, SKY), ["35.6584421", "139.7022205"], "the pin, not the map's centre");
      const req = backend.requests.filter((b) => b.action === "updateStop").at(-1);
      assert.deepEqual(req.args.patch, { lat: "35.6584421", lng: "139.7022205" });
      await openEdit(page, SKY);
      assert.equal(await text(page, "#stAtW"), "On the map");
      assert.equal(await page.evaluate(() => document.getElementById("stPin").value), "", "the field starts empty");
      await page.evaluate(() => document.getElementById("stPin").scrollIntoView({ block: "center" }));
      await shot(page, "3-edit-on-map");
    },
  },
  {
    name: "a link with no position in it says so and changes nothing",
    viewport: { width: 320, height: 568 },
    async run({ page }) {
      const backend = await ready(page);
      await openEdit(page, DINNER);
      await page.fill("#stPin", "https://maps.app.goo.gl/AbCd123");
      assert.equal(await text(page, "#stAtW"), "Not on the map");
      assert.equal(await text(page, "#stAtS"), "No position in that link. Copy the long link from Google Maps’ address bar.");
      await page.evaluate(() => document.getElementById("stPin").scrollIntoView({ block: "center" }));
      const fit = await page.evaluate(() => {
        const s = document.getElementById("stop");
        return { sw: s.scrollWidth, cw: s.clientWidth };
      });
      assert.ok(fit.sw <= fit.cw, "nothing runs off the sheet at 320: " + JSON.stringify(fit));
      await shot(page, "3-edit-no-position-320");
      // Save is still Save only when something else changed.
      await page.fill("#stDetail", "Counter seats");
      await page.click("#stSave");
      await saved(page);
      const req = backend.requests.filter((b) => b.action === "updateStop").at(-1);
      assert.deepEqual(req.args.patch, { detail: "Counter seats" });
      assert.deepEqual(stored(backend, DINNER), ["", ""]);
    },
  },
  {
    name: "a new place takes the old position off the map; the geocoder's wrong city can be put right",
    async run({ page }) {
      const backend = await ready(page, { seed: seedAt(SKY, "34.70", "135.50") });
      await openEdit(page, SKY);
      assert.equal(await text(page, "#stAtW"), "On the map");
      await page.fill("#stPlace", "Shibuya Scramble Square");
      await page.click("#stSave");
      await saved(page);
      assert.deepEqual(stored(backend, SKY), ["", ""]);
      await openEdit(page, SKY);
      assert.equal(await text(page, "#stAtW"), "Not on the map");
      await page.fill("#stPin", LINK);
      await page.click("#stSave");
      await saved(page);
      assert.deepEqual(stored(backend, SKY), ["35.6584421", "139.7022205"]);
    },
  },
  {
    name: "a directions link is refused and nothing is sent; a bare map view is not read either",
    async run({ page }) {
      const backend = await ready(page);
      await openEdit(page, DINNER);
      await page.fill("#stPin", "https://www.google.com/maps/dir/35.6612,139.6990/Uobei/@35.66,139.70,16z/data=!3d35.66!4d139.70");
      assert.equal(await text(page, "#stAtW"), "Not on the map");
      assert.equal(await text(page, "#stAtS"), "That’s a directions link. Paste the place’s own link.");
      await page.fill("#stPin", "https://www.google.com/maps/@35.6612,139.6990,16z");
      assert.equal(await text(page, "#stAtW"), "Not on the map");
      await page.fill("#stDetail", "Counter seats");
      await page.click("#stSave");
      await saved(page);
      const req = backend.requests.filter((b) => b.action === "updateStop").at(-1);
      assert.deepEqual(req.args.patch, { detail: "Counter seats" });
      assert.equal(JSON.stringify(backend.requests).includes("35.6612"), false, "nothing of the link is sent");
    },
  },
  {
    name: "a new stop can be put on the map as it is added",
    async run({ page }) {
      const backend = await ready(page);
      await page.dispatchEvent('#rail .pg[data-date="2026-12-12"] .tk-add', "click");
      await waitSheet(page);
      assert.equal(await text(page, "#stAtW"), "Not on the map");
      await page.fill("#stWhat", "Tea");
      await page.fill("#stPin", "https://www.google.com/maps/place/Tea+house/@35.0037,135.7788,16z");
      await page.click("#stSave");
      await saved(page);
      const r = backend.fake.tables.Stops.find((x) => x.title === "Tea");
      assert.deepEqual([String(r.lat), String(r.lng)], ["35.0037", "135.7788"]);
    },
  },
];
