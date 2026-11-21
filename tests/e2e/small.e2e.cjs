// A Safari tab on a standard iPhone (390x664, the bars showing): every
// overlay's key controls are on screen and can be tapped. The other files run
// at 390x844, the Home Screen app's size.

const assert = require("node:assert/strict");
const { SEED, NOON12, open, until, atRest, visible } = require("./helpers.cjs");

const VIEWPORT = { width: 390, height: 664 };

// "ok", or why the element is not on screen and tappable. With `scroll`, it is
// first scrolled into view inside whatever scrolls it (a sheet, the panel's rows).
function reach(page, selector, scroll = false) {
  return page.evaluate(
    ([sel, scroll]) => {
      const el = document.querySelector(sel);
      if (!el) return "missing";
      if (scroll) el.scrollIntoView({ block: "center", inline: "nearest" });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return "not drawn";
      if (r.top < -0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5) {
        return "off screen: top " + Math.round(r.top) + ", bottom " + Math.round(r.bottom) + " of " + innerHeight;
      }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) return "covered by " + (hit ? hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") + "." + hit.className : "nothing");
      return "ok";
    },
    [selector, scroll],
  );
}

async function expectReach(page, selector, scroll) {
  // Sheets rise over half a second (real time, not the paused page clock): wait for it.
  let got;
  try {
    await until(async () => (got = await reach(page, selector, scroll)) === "ok", "");
  } catch {
    throw new Error(selector + " is not on screen and tappable at 390x664: " + got);
  }
}

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: SEED, nowMs: NOON12, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length === 8), "the receipt draws");
  return backend;
}

const isOpen = (page, id) => page.evaluate((i) => document.getElementById(i).classList.contains("is-open"), id);

async function keys(page, seq) {
  for (const k of seq.split(" ")) await page.click('#pad .key[data-k="' + k + '"]');
}

async function ringOpen(page) {
  await page.click("#ring");
  await atRest(page, "#reg", { message: "the register opens" });
}

module.exports = [
  {
    name: "the register: Ring it up, Done and the name field",
    viewport: VIEWPORT,
    async run({ page }) {
      await ready(page);
      await ringOpen(page);
      for (const sel of ["#kGo", "#regDone", "#xWhat"]) await expectReach(page, sel);
    },
  },
  {
    name: "the uneven split panel, in parts and in exact amounts: its title, Set split, the modes and every row",
    viewport: VIEWPORT,
    async run({ page }) {
      await ready(page);
      await ringOpen(page);
      await keys(page, "3 0 0 0");
      await page.click("#xUneven");
      await until(() => visible(page, "#un"), "the panel opens");
      for (const mode of ["parts", "exact"]) {
        await page.click('#unMode [data-mode="' + mode + '"]');
        await until(() => page.evaluate((m) => document.querySelector('#unMode [data-mode="' + m + '"]').classList.contains("is-on"), mode), mode);
        for (const sel of ["#unDone", "#unMode"]) await expectReach(page, sel);
        await expectReach(page, "#un .un-row:first-child", true);
        await expectReach(page, "#un .un-row:last-child", true);
        // The title and Set split stay in view after the rows are scrolled.
        await expectReach(page, "#unDone");
        assert.equal(await reach(page, "#un .un-top span"), "ok", mode + ": the title");
      }
      await page.click("#unDone");
      await until(async () => !(await visible(page, "#un")), "Set split closes it");
    },
  },
  {
    name: "the line sheet: Done, Delete and the note",
    viewport: VIEWPORT,
    async run({ page }) {
      await ready(page);
      await page.click('#rc .rc-row[data-id="seedexp001"]');
      await atRest(page, "#line", { message: "the line sheet opens" });
      await expectReach(page, "#lnDone");
      await expectReach(page, "#lnDel", true);
      await expectReach(page, "#lnNote", true);
    },
  },
  {
    name: "History: Done and the first row's Undo",
    viewport: VIEWPORT,
    async run({ page }) {
      await ready(page);
      await page.click("#histBtn");
      await until(() => page.evaluate(() => document.querySelectorAll("#tape .tp-row").length > 0), "the tape fills");
      await expectReach(page, "#histDone");
      await expectReach(page, "#tape .tp-row .tp-undo");
    },
  },
  {
    name: "Settings: Done, and Report a problem by scrolling inside the sheet",
    viewport: VIEWPORT,
    async run({ page }) {
      await ready(page);
      await page.click("#youBtn");
      await atRest(page, "#you", { message: "settings open" });
      await expectReach(page, "#youDone");
      await expectReach(page, "#setReport", true);
    },
  },
  {
    name: "an armed slip row: the amount field and the armed spot",
    viewport: VIEWPORT,
    async run({ page }) {
      await ready(page);
      await page.click('#slip button.spot[data-key="Trenton>Mo"]');
      await until(() => page.evaluate(() => !!document.querySelector("#slip .spot.is-armed")), "armed");
      await expectReach(page, "#stampAmt", true);
      await expectReach(page, "#slip .spot.is-armed", true);
    },
  },
  {
    name: "the no-key screen: the paste field and Open",
    viewport: VIEWPORT,
    async run({ page }) {
      await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await until(() => visible(page, "#keyPaste"), "the paste field");
      await expectReach(page, "#keyPaste");
      await expectReach(page, "#keyGo");
    },
  },
];
