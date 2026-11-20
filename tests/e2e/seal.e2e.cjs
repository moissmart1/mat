// The settled seal (mock-up 2B): when the last open payment is stamped, a
// square 精算済 seal lands on the slip's head, then the slip folds to one
// filed line with two binder holes. Open shows the payments again; Undo
// brings the slip back as it was. Reduced motion: no fold, simply filed.
// The seal's thud is the stamp's own sound, under its own setting.

const assert = require("node:assert/strict");
const fs = require("fs");
const { SEED, NOON12, open, advance, until, text, expectText, visible } = require("./helpers.cjs");

const SHOTS = require("./shots.cjs")("money-trio");
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
};

// The seed's open transfers (Simplify on): Trenton → Mo $1,121.35, Ajen → Mo $221.73.
// TRENTON already stamped leaves Ajen's as the last one open.
const pay = (n, from, cad, at) => ({ id: "sealpay" + n + "aaaa", from, to: "Mo", cad, seed: 300 + n, rot: 3, stampedBy: "Mo", stampedAt: at, removed: false });
const TRENTON = pay(1, "Trenton", 1121.35, "2026-12-11T03:00:00.000Z");
const AJEN = pay(2, "Ajen", 221.73, "2026-12-12T03:00:00.000Z");
const LAST_OPEN = { ...SEED, payments: [TRENTON] };
const SETTLED = { ...SEED, payments: [TRENTON, AJEN] };
const SPOT = '#slip button.spot[data-key="Ajen>Mo"]';

async function countThuds(page) {
  await page.addInitScript(() => {
    globalThis.__thuds = 0;
    const AC = globalThis.AudioContext;
    if (!AC) return;
    const make = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function () {
      globalThis.__thuds++;
      return make.call(this);
    };
  });
}
const thuds = (page) => page.evaluate(() => globalThis.__thuds);

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: LAST_OPEN, nowMs: NOON12, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#slip .s-row").length > 0), "the slip draws");
  return backend;
}

async function stampLast(page) {
  await page.click(SPOT);
  await until(() => page.evaluate(() => !!document.querySelector("#slip .spot.is-armed")), "armed");
  await page.click(SPOT);
  await until(() => page.evaluate(() => document.querySelectorAll("#slip .s-row.is-open").length === 0), "nothing left open");
}

const state = (page) =>
  page.evaluate(() => {
    const slip = document.getElementById("slip");
    const seal = document.getElementById("seal");
    const inner = slip.querySelector(".fold > div");
    return {
      filed: slip.classList.contains("is-filed"),
      seal: seal ? [...seal.classList].filter((c) => c !== "big" && c !== "boxs").sort().join(" ") || "on" : null,
      fold: !!inner,
      inert: inner ? inner.inert : null,
      foldHeight: inner ? Math.round(inner.getBoundingClientRect().height) : null,
      open: slip.querySelectorAll(".s-row.is-open").length,
      paid: slip.querySelectorAll(".s-row.is-paid").length,
    };
  });
const foldShut = (page) => until(async () => (await state(page)).foldHeight === 0, "the slip folds shut");

function sizeCase(size, mobile, tag) {
  return {
    name: tag + ": the seal lands and the filed slip fits, with no sideways scroll",
    viewport: size,
    ...(mobile ? {} : { mobile: false }),
    async run({ page }) {
      const backend = await ready(page);
      await shot(page, "2B-" + tag + "-last-open");
      await stampLast(page);
      await advance(page, backend, 520);
      await until(async () => (await state(page)).seal !== null, "the seal lands");
      await page.waitForTimeout(350);
      await shot(page, "2B-" + tag + "-sealed");
      await advance(page, backend, 1100);
      await until(async () => (await state(page)).filed, "filed");
      await foldShut(page);
      await page.evaluate(() => document.getElementById("slip").scrollIntoView({ block: "center" }));
      await page.waitForTimeout(100);
      await shot(page, "2B-" + tag + "-filed");
      const fit = await page.evaluate(() => {
        const slip = document.getElementById("slip").getBoundingClientRect();
        const seal = document.getElementById("seal").getBoundingClientRect();
        // The title's own letters, not its block (a block runs the slip's width).
        const range = document.createRange();
        range.selectNodeContents(document.querySelector("#slip .cf-t b, #slip .slip-t b"));
        const title = range.getBoundingClientRect();
        const btn = document.getElementById("unfile").getBoundingClientRect();
        return {
          sideways: document.documentElement.scrollWidth > innerWidth,
          sealInside: seal.left >= slip.left - 8 && seal.right <= slip.right + 8,
          titleClear: title.right <= seal.left + 4 || title.bottom <= seal.top,
          titleOneLine: title.height < 40,
          btnInside: btn.right <= slip.right && btn.left >= slip.left,
        };
      });
      assert.deepEqual(fit, { sideways: false, sealInside: true, titleClear: true, titleOneLine: true, btnInside: true });
      await page.click("#unfile");
      await until(async () => !(await state(page)).filed, "opened");
      await page.waitForTimeout(500);
      await shot(page, "2B-" + tag + "-opened");
    },
  };
}

module.exports = [
  {
    name: "the last stamp: the seal lands, then the slip is filed to one line; Open shows the payments",
    async run({ page }) {
      await countThuds(page);
      const backend = await ready(page);
      assert.deepEqual(await state(page), { filed: false, seal: null, fold: false, inert: null, foldHeight: null, open: 1, paid: 1 });
      await stampLast(page);
      assert.equal(await thuds(page), 1, "the stamp's thud");
      // The stamp lands first; the seal follows half a second later.
      assert.equal((await state(page)).seal, null);
      await advance(page, backend, 520);
      await until(async () => (await state(page)).seal !== null, "the seal lands");
      const sealed = await state(page);
      assert.equal(sealed.filed, false);
      assert.match(sealed.seal, /land/);
      assert.equal(await thuds(page), 2, "the seal thuds with the stamp's sound");
      const svg = await page.evaluate(() => document.getElementById("seal").innerHTML);
      assert.ok(svg.includes("精算済") && svg.includes("SETTLED 2026.12.12"), "精算済 and today's date");
      // Then the slip folds to its filed line.
      await advance(page, backend, 1100);
      await until(async () => (await state(page)).filed, "filed");
      await foldShut(page);
      const filed = await state(page);
      assert.equal(filed.inert, true, "the folded payments cannot be reached");
      assert.ok(await visible(page, "#unfile"));
      await expectText(page, "#slip .stub b", "Settled Sat Dec 12");
      await expectText(page, "#slip .stub > span", "Settled Sat Dec 122 payments, $1,343.08 in all");
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#slip .holes")).display), "flex");
      await expectText(page, "#say", "You’re square.");

      await page.click("#unfile");
      await until(async () => !(await state(page)).filed, "Open unfolds it");
      await until(async () => (await state(page)).foldHeight > 100, "the payments show again");
      assert.equal((await state(page)).inert, false);
      assert.equal(await visible(page, "#unfile"), false);
      assert.ok(await visible(page, "#seal"), "the seal stays on the head");
      assert.equal(await page.locator("#slip .s-row.is-paid").count(), 2);
    },
  },
  {
    name: "Undo takes the stamp off and the slip comes back as it was",
    async run({ page }) {
      const backend = await ready(page);
      await stampLast(page);
      await advance(page, backend, 520);
      await advance(page, backend, 1100);
      await until(async () => (await state(page)).filed, "filed");
      await expectText(page, "#ubarT", "Stamped $221.73 to Mo.");
      await page.click("#ubarU");
      await until(async () => (await state(page)).open === 1, "the open row is back");
      assert.deepEqual(await state(page), { filed: false, seal: null, fold: false, inert: null, foldHeight: null, open: 1, paid: 1 });
      assert.equal(await page.locator("#slip .holes, #slip .stub").count(), 0);
      await expectText(page, "#say", "Ajen owes you $221.73.");
    },
  },
  {
    name: "Undo before the seal lands: no seal comes",
    async run({ page }) {
      const backend = await ready(page);
      await stampLast(page);
      await page.click("#ubarU");
      await until(async () => (await state(page)).open === 1, "the open row is back");
      await advance(page, backend, 2000);
      assert.deepEqual(await state(page), { filed: false, seal: null, fold: false, inert: null, foldHeight: null, open: 1, paid: 1 });
    },
  },
  {
    name: "reduced motion: no seal landing, no fold, simply filed",
    async run({ page }) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await countThuds(page);
      await ready(page);
      await stampLast(page);
      const s = await state(page);
      assert.equal(s.filed, true, "filed at once");
      assert.equal(s.seal, "on", "the seal is simply there");
      assert.ok(parseFloat(await page.evaluate(() => getComputedStyle(document.querySelector("#slip .fold")).transitionDuration)) < 0.01, "no fold");
      assert.equal(await thuds(page), 1, "only the stamp's own thud");
      await shot(page, "2B-393x852-reduced-motion");
    },
  },
  {
    name: "with the sound off, the seal makes none",
    async run({ page }) {
      await countThuds(page);
      const backend = await ready(page, { storage: { "mat.sound": "off" } });
      await stampLast(page);
      await advance(page, backend, 520);
      await until(async () => (await state(page)).seal !== null, "the seal lands");
      assert.equal(await thuds(page), 0);
    },
  },
  {
    name: "a slip already settled when Money opens is drawn filed, without the seal landing",
    async run({ page }) {
      await ready(page, { seed: SETTLED });
      const s = await state(page);
      assert.equal(s.filed, true);
      assert.equal(s.seal, "on");
      await expectText(page, "#slip .stub b", "Settled Sat Dec 12");
    },
  },
  sizeCase({ width: 393, height: 852 }, true, "393x852"),
  sizeCase({ width: 320, height: 568 }, true, "320x568"),
  sizeCase({ width: 844, height: 390 }, true, "844x390"),
  sizeCase({ width: 1440, height: 900 }, false, "1440x900"),
];
