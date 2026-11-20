// The stamp in the place (location build, item 8): pressed with a usable
// position within 15 km of that day's coordinates, the press carries
// here: true and the stamp gets the small square 現地 chop; held up it reads
// "pressed in <place>". No position or elsewhere: no mark, no comment. It
// never blocks a press. 13:20 on Dec 12 in Japan; the day is given
// coordinates; the phone's position is stood in.

const assert = require("node:assert/strict");
const fs = require("fs");
const { WITH_PLAN, NOON12, makeBackend, open, until, text } = require("./helpers.cjs");
const { geoStub, leaks, HERE } = require("./geostub.cjs");

const SHOTS = require("./shots.cjs")("loc");
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
};
const HOUR = 3600000;
const KEY = "test-key";
const DEFS = [
  { id: "s02", date: "2026-12-11", name_ja: "東京", name_en: "Tokyo", place: "Asakusa", motif: "lantern", ink: "shu", shape: "round" },
  { id: "s03", date: "2026-12-12", name_ja: "渋谷", name_en: "Shibuya", place: "Shibuya", motif: "tower", ink: "ai", shape: "round" },
  { id: "iss", date: "", name_ja: "発行", name_en: "Issued", place: "", motif: "crest", ink: "shu", shape: "round" },
];
// The day's place: 9 km south of the phone (inside 15 km), on a different longitude.
const DAY_AT = { lat: String(HERE.lat - 9000 / 111195), lng: "135.7700" };

function backendWith({ dayAt = DAY_AT } = {}) {
  const seed = JSON.parse(JSON.stringify(WITH_PLAN));
  if (dayAt) Object.assign(seed.days["2026-12-12"], { lat: dayAt.lat, lng: dayAt.lng });
  const be = makeBackend(seed, { now: NOON12 });
  for (const d of DEFS) be.fake.tables.StampDefs.push({ ...d });
  return be;
}
async function ready(page, { where = "on", geo = {}, backend } = {}) {
  await geoStub(page, geo);
  const be = backend || backendWith();
  await open(page, { backend: be, nowMs: NOON12, tab: "days", storage: where ? { "mat.where": where } : {} });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
  return be;
}
const openBook = async (page) => {
  await page.click("#stampBtn");
  await until(() => page.evaluate(() => {
    const b = document.getElementById("book");
    return b.classList.contains("is-open") && Math.abs(b.getBoundingClientRect().bottom - innerHeight) < 1;
  }), "the book opens");
};
const cell = (id) => '#bookGrid .bk-cell[data-def="' + id + '"]';
const presses = (be) => be.requests.filter((r) => r.action === "pressStamp");
const idle = (page) => page.evaluate(() => globalThis.__matTest.store.idle());
const chops = (page) => page.evaluate(() => document.querySelectorAll("#bookGrid .chop").length);
const asked = (page) => until(() => page.evaluate(() => window.__geoCalls.length > 0), "the phone was asked");

const SIZES = [
  { tag: "393", viewport: { width: 393, height: 852 } },
  { tag: "320", viewport: { width: 320, height: 568 } },
  { tag: "844-sideways", viewport: { width: 844, height: 390 } },
  { tag: "1440-wide", viewport: { width: 1440, height: 900 }, mobile: false },
];

module.exports = [
  ...SIZES.map(({ tag, viewport, mobile }) => ({
    name: "pressed in the place: the 現地 chop, and held up it says so, at " + tag,
    viewport,
    mobile,
    async run({ page }) {
      const be = await ready(page);
      await asked(page);
      await openBook(page);
      await page.click(cell("s03"));
      await until(async () => (await chops(page)) === 1, "the chop is on the stamp");
      await idle(page);
      const req = presses(be).at(-1);
      assert.deepEqual(Object.keys(req.args).sort(), ["at", "def", "here", "seed"]);
      assert.equal(req.args.here, true);
      assert.equal(be.fake.tables.Stamps[0].here, "yes");
      const c = await page.evaluate((sel) => {
        const ch = document.querySelector(sel + " .chop");
        const w = document.querySelector(sel + " .bk-well").getBoundingClientRect();
        const r = ch.getBoundingClientRect();
        const sp = ch.querySelector("span").getBoundingClientRect();
        return { text: ch.textContent, color: getComputedStyle(ch).color, w: [w.right, w.bottom], r: [r.right, r.bottom, r.width], fits: sp.height <= r.height + 0.5 && sp.width <= r.width + 0.5, sw: document.documentElement.scrollWidth, vw: innerWidth };
      }, cell("s03"));
      assert.equal(c.text, "現地");
      assert.equal(c.color, "rgb(214, 60, 30)");
      assert.ok(c.r[2] > 12 && c.fits && c.sw <= c.vw, "the chop and its two characters fit: " + JSON.stringify(c));
      // Held up (wait for the landing to settle, as a second tap at once is the same tap).
      await page.clock.fastForward(1000);
      await page.waitForTimeout(400); // the landing's own animation runs on real time
      await shot(page, "2-stamp-chop-" + tag);
      await page.click(cell("s03"));
      await until(() => page.locator("#book .bk-look").count().then((n) => n === 1), "held up");
      const lines = await page.evaluate(() => [...document.querySelectorAll(".bk-lt i")].map((i) => [i.textContent, i.className]));
      assert.deepEqual(lines.at(-1), ["pressed in Shibuya", "in"]);
      assert.equal(await page.evaluate(() => document.querySelectorAll(".bk-card .chop").length), 1);
      await shot(page, "2-stamp-held-" + tag);
      assert.deepEqual(await leaks(page, be), []);
    },
  })),
  ...[
    ["far (20 km away)", { geo: { lat: HERE.lat + 11000 / 111195 } }],
    ["off", { where: "off" }],
    ["refused", { geo: { mode: "refused" } }],
    ["stale", { geo: { ageMs: 4 * 60000 } }],
    ["rough", { geo: { accuracy: 600 } }],
    ["the day has no coordinates", { dayAt: null }],
  ].map(([what, { dayAt, ...opts }]) => ({
    name: "pressed elsewhere, no mark and no comment: " + what,
    async run({ page }) {
      const be = await ready(page, { ...opts, backend: dayAt === null ? backendWith({ dayAt: null }) : undefined });
      await page.waitForTimeout(100);
      await openBook(page);
      await page.click(cell("s03"));
      await until(() => page.evaluate((sel) => !!document.querySelector(sel + " .bk-st"), cell("s03")), "the stamp lands");
      await idle(page);
      assert.equal(await chops(page), 0);
      const req = presses(be).at(-1);
      assert.equal("here" in req.args, false, "nothing about where is sent");
      assert.equal(be.fake.tables.Stamps[0].here, "");
      await page.clock.fastForward(1000);
      await page.click(cell("s03"));
      await until(() => page.locator("#book .bk-look").count().then((n) => n === 1), "held up");
      assert.equal(await page.evaluate(() => [...document.querySelectorAll(".bk-lt i")].some((i) => i.textContent.startsWith("pressed in"))), false);
      if (what.startsWith("far")) await shot(page, "2-stamp-elsewhere");
    },
  })),
  {
    name: "the issue stamp never has the mark; another phone sees the chop; undo lifts it as before",
    async run({ page, newPhone }) {
      const be = await ready(page);
      await asked(page);
      await openBook(page);
      await page.click(cell("iss"));
      await until(() => page.evaluate((sel) => !!document.querySelector(sel + " .bk-st"), cell("iss")), "the book stamp lands");
      await idle(page);
      assert.equal("here" in presses(be).at(-1).args, false);
      await page.click(cell("s03"));
      await until(async () => (await chops(page)) === 1, "the day's chop");
      await idle(page);
      // Mo's stamp, seen from Ajen's phone (Ajen has no position at all).
      const other = await newPhone();
      await geoStub(other, { mode: "none" });
      await open(other, { backend: be, nowMs: NOON12, tab: "days", me: "Ajen" });
      await until(() => other.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "Ajen's tickets");
      const stamps = await other.evaluate(() => globalThis.__matTest.store.state.stamps.map((s) => [s.def, s.who, s.here === true]));
      assert.deepEqual(stamps.sort(), [["iss", "Mo", false], ["s03", "Mo", true]]);
      // Undo from History lifts it as always.
      const log = be.fake.tables.Log.filter((r) => r.kind === "stamp").at(-1);
      const u = await be.fake({ key: KEY, actor: "Mo", action: "undo", args: { logId: Number(log.id) } });
      assert.equal(u.ok, true);
      assert.equal(log.summary, "stamped Dec 12");
    },
  },
];
