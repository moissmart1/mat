// The strip behind the iPhone status bar: a Home Screen app draws under the clock, so
// the screens must not scroll visibly there. Chromium has no notch, so 47 px is stood in
// for through --inset-t. Pictures are taken only when MAT_TAB_SHOTS names an output folder.

const fs = require("fs");
const assert = require("node:assert/strict");
const { WITH_PLAN, NOON12, open, until } = require("./helpers.cjs");

const SHOTS = process.env.MAT_TAB_SHOTS || "";
const INSET = 47;

async function ready(page) {
  await open(page, { seed: WITH_PLAN, tab: "days", nowMs: NOON12 });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  await page.clock.resume(); // the sheets slide
  await page.evaluate((n) => document.documentElement.style.setProperty("--inset-t", n + "px"), INSET);
}
// What sits at a point in the top strip, named.
const topAt = (page, y) => page.evaluate((y) => {
  const el = document.elementFromPoint(100, y);
  const strip = getComputedStyle(document.querySelector(".phone"), "::before");
  return { inPhone: !!el && el.classList.contains("phone"), h: strip.height, z: strip.zIndex, bg: strip.backgroundColor, cls: el ? el.className : "" };
}, y);
const scrollDays = (page) => page.evaluate(() => {
  const v = document.getElementById("vDays");
  v.scrollTop = 400;
  return v.scrollTop;
});

module.exports = [
  {
    name: "with a 47 px top inset the strip covers the screens' top and the board no longer shows under the status bar",
    async run({ page }) {
      await ready(page);
      assert.ok((await scrollDays(page)) > 100, "Days scrolled");
      await page.waitForTimeout(250);
      // The strip takes no touches (so elementFromPoint looks through it): it is read from its style.
      const st = await page.evaluate(() => {
        const c = getComputedStyle(document.querySelector(".phone"), "::before");
        const ground = getComputedStyle(document.documentElement).getPropertyValue("--ground").trim();
        const probe = document.createElement("i");
        probe.style.background = ground;
        document.body.append(probe);
        const want = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const z = (s) => +getComputedStyle(document.querySelector(s)).zIndex;
        return { pos: c.position, top: c.top, h: c.height, w: c.width, phone: document.querySelector(".phone").getBoundingClientRect().width + "px", z: +c.zIndex, bg: c.backgroundColor, want, pe: c.pointerEvents, views: z(".views"), view: z("#vDays"), net: z("#net") };
      });
      assert.deepEqual([st.pos, st.top, st.h, st.bg === st.want, st.pe], ["absolute", "0px", INSET + "px", true, "none"], JSON.stringify(st));
      assert.equal(st.w, st.phone, "as wide as the phone");
      assert.ok(st.z > (st.views || 0) && st.z > (st.view || 0) && st.z < st.net, "above the screens, under the no-signal strip: " + JSON.stringify(st));
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: SHOTS + "/days-scrolled.png" });
      }
    },
  },
  {
    name: "with no top inset the strip has no height and takes no touches",
    async run({ page }) {
      await open(page, { seed: WITH_PLAN, tab: "days", nowMs: NOON12 });
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
      assert.equal((await topAt(page, 1)).h, "0px");
    },
  },
  {
    name: "an open hotel card and its scrim still cover the strip, and the stamp book and History stack above it",
    async run({ page }) {
      await ready(page);
      await page.click('#rail .pg[data-date="2026-12-12"] .tk-stay');
      await until(() => page.evaluate(() => document.getElementById("stay").classList.contains("is-open")), "the card opens");
      await page.waitForTimeout(700);
      const z = await page.evaluate(() => {
        const zi = (s) => +getComputedStyle(document.querySelector(s)).zIndex;
        return { strip: +getComputedStyle(document.querySelector(".phone"), "::before").zIndex, scrim: zi(".scrim"), card: zi("#stay"), net: zi("#net"), el: document.elementFromPoint(100, 20).className };
      });
      assert.ok(z.scrim > z.strip && z.card > z.strip && z.net > z.strip, "sheets, scrim and the no-signal strip stack above it: " + JSON.stringify(z));
      assert.ok(/scrim/.test(z.el), "the scrim is what is at the top while the card is open: " + z.el);
      await page.click("#stayDone");
      await until(() => page.evaluate(() => !document.getElementById("stay").classList.contains("is-open")), "the card closes");
      // The stamp book (opened by a button that shows only with stamps; its own test opens it) stacks above the strip too.
      const more = await page.evaluate(() => ({ strip: +getComputedStyle(document.querySelector(".phone"), "::before").zIndex, book: +getComputedStyle(document.getElementById("book")).zIndex, hist: +getComputedStyle(document.getElementById("hist")).zIndex }));
      assert.ok(more.book > more.strip && more.hist > more.strip, "the stamp book and History stack above the strip: " + JSON.stringify(more));
    },
  },
];
