// The two screens: Days and Money, the bottom bar that switches them, and
// which one the app opens on.

const assert = require("node:assert/strict");
const { WITH_PLAN, open, until, expectText, visible } = require("./helpers.cjs");

const NOV15 = Date.parse("2026-11-15T12:00:00+09:00");

const isActive = (page, sel) => page.evaluate((s) => document.querySelector(s).classList.contains("is-active"), sel);
const isInert = (page, sel) => page.evaluate((s) => document.querySelector(s).inert === true, sel);
const stored = (page, k) => page.evaluate((key) => localStorage.getItem(key), k);
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());

// Waits until the app has loaded the trip and `view` is the screen showing.
async function showing(page, view) {
  const other = view === "#vDays" ? "#vMoney" : "#vDays";
  await until(() => page.evaluate(() => !!document.querySelector("#rail .pg")), "the tickets draw");
  await until(async () => (await isActive(page, view)) && !(await isActive(page, other)), view + " is the screen showing");
  assert.equal(await isInert(page, other), true, other + " is inert");
  assert.equal(await isInert(page, view), false, view + " is not inert");
}

// "ok", or why the bar's four controls are not all on screen and apart.
function barFits(page) {
  return page.evaluate(() => {
    const els = ['[data-tab="days"]', "#ring", '[data-tab="money"]', "#youBtn"].map((s) => document.querySelector(s));
    if (els.some((e) => !e)) return "a control is missing";
    const rs = els.map((e) => e.getBoundingClientRect());
    for (const [i, r] of rs.entries()) {
      if (r.width === 0 || r.height === 0) return "control " + i + " is not drawn";
      if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) return "control " + i + " is off screen";
    }
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) return "controls " + i + " and " + j + " overlap";
      }
    }
    return "ok";
  });
}

async function fits(page) {
  await open(page, { seed: WITH_PLAN, tab: "days" });
  await showing(page, "#vDays");
  assert.equal(await barFits(page), "ok");
  // The labels are one size, 15 px on a wide phone, scaled down only as far as a small one needs (never under 10.5 px, the small label).
  const sizes = await page.evaluate(() => [...document.querySelectorAll("#nav [data-tab], #youBtn")].filter((b) => !b.hidden).map((b) => getComputedStyle(b).fontSize));
  const px = sizes.map(parseFloat);
  // A trip day: Days, Tickets, Money and You.
  assert.ok(px.length === 4 && px.every((n) => n === px[0] && n >= 10.5 && n <= 15), sizes.join(" "));
}

module.exports = [
  {
    name: "opens on Days with nothing stored",
    async run({ page }) {
      await open(page, { seed: WITH_PLAN, tab: null });
      await showing(page, "#vDays");
      assert.equal(await isActive(page, '[data-tab="days"]'), true);
      assert.equal(await isActive(page, '[data-tab="money"]'), false);
    },
  },
  {
    name: "Money and back",
    async run({ page }) {
      await open(page, { seed: WITH_PLAN, tab: null });
      await showing(page, "#vDays");
      await page.click('[data-tab="money"]');
      await showing(page, "#vMoney");
      assert.equal(await isActive(page, '[data-tab="money"]'), true);
      await until(() => visible(page, "#say"), "the sentence shows");
      assert.equal(await stored(page, "mat.tab"), "money");
      assert.equal(await stored(page, "mat.tabDay"), "2026-12-12");
      await page.click('[data-tab="days"]');
      await showing(page, "#vDays");
      await until(() => visible(page, "#rail"), "the rail shows");
      assert.equal(await stored(page, "mat.tab"), "days");
    },
  },
  {
    name: "returns to the last screen",
    async run({ page }) {
      await open(page, { seed: WITH_PLAN, tab: null, storage: { "mat.tab": "money", "mat.tabDay": "2026-12-12" } });
      await showing(page, "#vMoney");
    },
  },
  {
    name: "a new day during the trip opens on the ticket",
    async run({ page }) {
      await open(page, { seed: WITH_PLAN, tab: null, storage: { "mat.tab": "money", "mat.tabDay": "2026-12-11" } });
      await showing(page, "#vDays");
    },
  },
  {
    name: "before the trip the last screen wins",
    async run({ page }) {
      await open(page, { seed: WITH_PLAN, nowMs: NOV15, tab: null, storage: { "mat.tab": "money", "mat.tabDay": "2026-11-14" } });
      await showing(page, "#vMoney");
    },
  },
  {
    name: "Ring up works from Days",
    async run({ page }) {
      await open(page, { seed: WITH_PLAN, tab: "days" });
      await showing(page, "#vDays");
      await page.click("#ring");
      await until(() => page.evaluate(() => document.getElementById("reg").classList.contains("is-open")), "the register opens");
      await expectText(page, "#xDay", "Sat 12");
    },
  },
  {
    name: "Ring up from Days shows the receipt while the register is open, then goes back to Days",
    async run({ page }) {
      await open(page, { seed: WITH_PLAN, tab: "days" });
      await showing(page, "#vDays");
      await page.click("#ring");
      await until(() => page.evaluate(() => document.getElementById("reg").classList.contains("is-open")), "the register opens");
      await showing(page, "#vMoney");
      assert.equal(await stored(page, "mat.tab"), "days");
      await page.click("#regDone");
      await until(() => page.evaluate(() => !document.getElementById("reg").classList.contains("is-open")), "the register closes");
      await showing(page, "#vDays");
      assert.equal(await stored(page, "mat.tab"), "days");
    },
  },
  {
    name: "Ring up from Money stays on Money",
    async run({ page }) {
      await open(page, { seed: WITH_PLAN, tab: "money" });
      await showing(page, "#vMoney");
      await page.click("#ring");
      await until(() => page.evaluate(() => document.getElementById("reg").classList.contains("is-open")), "the register opens");
      await page.click("#regDone");
      await until(() => page.evaluate(() => !document.getElementById("reg").classList.contains("is-open")), "the register closes");
      await showing(page, "#vMoney");
    },
  },
  {
    name: "the bar fits",
    run: ({ page }) => fits(page),
  },
  {
    name: "the bar fits on a small phone",
    viewport: { width: 320, height: 568 },
    run: ({ page }) => fits(page),
  },
  {
    name: "Report a problem names the screen",
    async run({ page }) {
      await open(page, { seed: WITH_PLAN, tab: "days" });
      await showing(page, "#vDays");
      await page.click("#youBtn");
      await until(() => page.evaluate(() => {
        const s = document.getElementById("you");
        return s.classList.contains("is-open") && Math.abs(s.getBoundingClientRect().bottom - innerHeight) < 1;
      }), "settings open");
      await page.click("#setReport");
      await expectText(page, "#ubarT", "Copied. Paste it to Mo or Claude.");
      assert.match(await clipboard(page), /^Screen: Days$/m);
    },
  },
];
