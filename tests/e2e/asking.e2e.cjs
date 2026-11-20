// Asking (location build, item 4): the one-time line under the date on
// today's ticket, the phone's own prompt only after Use it, the 現在地
// Location row in You, and the rules that keep a position on the phone. The
// plan is tests/fixtures/plan.json over the seed; 13:20 on Dec 12 in Japan
// (Day 3, Shibuya Sky next). navigator.geolocation is stood in (geostub.cjs).

const assert = require("node:assert/strict");
const fs = require("fs");
const { WITH_PLAN, open, advance, until, text } = require("./helpers.cjs");
const { geoStub, leaks } = require("./geostub.cjs");

const SHOTS = require("./shots.cjs")("loc");
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
};
const D12 = '#rail .pg[data-date="2026-12-12"]';
const isOpen = (page, id) => page.evaluate((i) => !!document.getElementById(i) && document.getElementById(i).classList.contains("is-open"), id);

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: WITH_PLAN, tab: "days", ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}
const choice = (page) => page.evaluate(() => localStorage.getItem("mat.where"));
const calls = (page) => page.evaluate(() => window.__geoCalls.length);
const askShown = (page) => page.evaluate((sel) => !!document.querySelector(sel + " .tk-ask"), D12);
async function openYou(page) {
  await page.evaluate(() => document.getElementById("youBtn").click());
  await until(() => isOpen(page, "you"), "You opens");
  await until(() => page.evaluate(() => getComputedStyle(document.getElementById("you")).transform === "none"), "You has risen");
  await page.evaluate(() => document.getElementById("setWhere").scrollIntoView({ block: "center" }));
}

const SIZES = [
  { tag: "393", viewport: { width: 393, height: 852 } },
  { tag: "320", viewport: { width: 320, height: 568 } },
  { tag: "844-sideways", viewport: { width: 844, height: 390 } },
  { tag: "1440-wide", viewport: { width: 1440, height: 900 }, mobile: false },
];

module.exports = [
  ...SIZES.map(({ tag, viewport, mobile }) => ({
    name: "the ask on today's ticket, once, at " + tag,
    viewport,
    mobile,
    async run({ page }) {
      await geoStub(page);
      await ready(page);
      await until(() => askShown(page), "today's ticket asks");
      const ask = await page.evaluate((sel) => {
        const a = document.querySelector(sel + " .tk-ask");
        const date = document.querySelector(sel + " .tk-date");
        const tk = a.closest(".tk").getBoundingClientRect();
        const r = a.getBoundingClientRect();
        const btns = [...a.querySelectorAll("button")].map((b) => ({ t: b.textContent, h: b.getBoundingClientRect().height, l: b.getBoundingClientRect().left, r: b.getBoundingClientRect().right }));
        return { here: a.querySelector(".here").textContent, words: a.querySelector("p > span:not(.here)").firstChild.textContent, small: a.querySelector("small").textContent, btns, afterDate: date.nextElementSibling === a, inside: r.left >= tk.left && r.right <= tk.right + 0.5, sw: document.documentElement.scrollWidth, vw: innerWidth };
      }, D12);
      assert.equal(ask.here, "現在地");
      assert.equal(ask.words, "Leave-by times from where you are?");
      assert.equal(ask.small, "Your location stays on this phone.");
      assert.deepEqual(ask.btns.map((b) => b.t), ["Use it", "Not now"]);
      for (const b of ask.btns) assert.ok(b.h >= 44, "a key a finger can hit: " + JSON.stringify(b));
      assert.ok(ask.afterDate && ask.inside && ask.sw <= ask.vw, JSON.stringify(ask));
      // Only today's ticket asks; nothing was asked of the phone.
      assert.equal(await page.evaluate(() => document.querySelectorAll("#rail .tk-ask").length), 1);
      assert.equal(await calls(page), 0);
      await page.evaluate((sel) => document.querySelector(sel + " .tk-ask").scrollIntoView({ block: "center" }), D12);
      await shot(page, "6-ask-" + tag);
    },
  })),
  {
    name: "Use it asks the phone once; a yes hides the line for good",
    async run({ page }) {
      const backend = await geoStub(page).then(() => ready(page));
      await until(() => askShown(page), "today's ticket asks");
      await page.dispatchEvent(D12 + " .tk-ask .yes", "click");
      await until(async () => !(await askShown(page)), "the line goes");
      assert.equal(await calls(page), 1);
      assert.deepEqual(await page.evaluate(() => window.__geoCalls[0]), { enableHighAccuracy: false, maximumAge: 120000, timeout: 8000 });
      assert.equal(await choice(page), "on");
      assert.equal(await page.evaluate(() => window.__geoWatch), 0, "never watchPosition");
      await page.reload();
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw again");
      assert.equal(await askShown(page), false, "not asked again");
      assert.deepEqual(await leaks(page, backend), []);
    },
  },
  {
    name: "the phone's no: quiet, the line goes, You says so and where to change it",
    async run({ page }) {
      await geoStub(page, { mode: "refused" });
      await ready(page);
      await until(() => askShown(page), "today's ticket asks");
      await page.dispatchEvent(D12 + " .tk-ask .yes", "click");
      await until(async () => (await choice(page)) === "refused", "refused is kept");
      assert.equal(await askShown(page), false);
      // Not asked again in this visit, even after minutes on screen.
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      assert.equal(await calls(page), 1);
      await openYou(page);
      assert.equal(await text(page, "#setWhereV"), "Phone said no");
      assert.equal(await text(page, "#setWhereS"), "To change it: iPhone Settings, Apps, Safari, Location. Then tap here to try again.");
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("setWhereV")).color), "rgb(214, 60, 30)");
      await shot(page, "6-you-phone-said-no");
      // Nothing says no on the ticket or anywhere else: no notice.
      assert.equal(await page.evaluate(() => !!document.querySelector(".ubar:not([hidden])") && document.querySelector(".ubar").textContent.includes("location")), false);
    },
  },
  {
    name: "refused: Safari shows the Settings line; the Home Screen app says to go to Safari instead",
    async run({ page }) {
      await geoStub(page, { mode: "refused", permission: "denied" });
      await ready(page, { storage: { "mat.where": "refused" } });
      await openYou(page);
      assert.equal(await text(page, "#setWhereS"), "To change it: iPhone Settings, Apps, Safari, Location. Then tap here to try again.");
    },
  },
  {
    name: "refused on the Home Screen app: the row says iPhone will not ask again and how to allow it in Safari",
    async run({ page }) {
      await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));
      await geoStub(page, { mode: "refused", permission: "denied" });
      await ready(page, { storage: { "mat.where": "refused" } });
      await openYou(page);
      assert.equal(await text(page, "#setWhereV"), "Phone said no");
      assert.equal(
        await text(page, "#setWhereS"),
        "On the Home Screen app, iPhone won’t ask again here. Open your own link in Safari, go to You and tap Location. If Safari doesn’t ask, tap the page menu beside the address (aA), then Website Settings, Location, Allow. Then come back here and tap Location.",
      );
    },
  },
  {
    name: "refused, then allowed in Settings: tapping the row tries again and turns it On; coming back on screen alone never prompts",
    async run({ page }) {
      await geoStub(page, { mode: "refused", permission: "denied" });
      await ready(page, { storage: { "mat.where": "refused" } });
      await openYou(page);
      assert.equal(await text(page, "#setWhereV"), "Phone said no");
      assert.equal(await text(page, "#setWhereS"), "To change it: iPhone Settings, Apps, Safari, Location. Then tap here to try again.");
      // Back on screen with Settings still saying no: nothing is asked, nothing pops up.
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      assert.equal(await calls(page), 0, "the phone is never asked by itself");
      assert.equal(await text(page, "#setWhereV"), "Phone said no");
      assert.equal(await page.evaluate(() => !!document.querySelector(".ubar:not([hidden])")), false, "no notice");
      // Turned on in Settings, but the phone's permission reads "prompt" (Safari asks per site): the row's tap tries again.
      await page.evaluate(() => window.__geoSet({ mode: "granted", permission: "prompt" }));
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      assert.equal(await calls(page), 0);
      await page.dispatchEvent("#setWhere", "click");
      await until(async () => (await text(page, "#setWhereV")) === "On", "the row says On");
      assert.equal(await choice(page), "on");
      assert.equal(await calls(page), 1);
    },
  },
  {
    name: "refused: the row shows the phone's own answer as plain text, in memory only",
    async run({ page }) {
      await geoStub(page, { mode: "refused", message: "Denied <b>by</b> the user" });
      const backend = await ready(page);
      await openYou(page);
      assert.equal(await page.isHidden("#setWhereWhy"), true, "nothing before a refusal");
      await page.dispatchEvent("#setWhere", "click");
      await until(async () => (await text(page, "#setWhereV")) === "Phone said no", "refused");
      assert.equal(await text(page, "#setWhereWhy"), "Phone’s answer: Denied <b>by</b> the user (code 1)");
      assert.equal(await page.locator("#setWhereWhy b").count(), 0, "not markup");
      const kept = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
      assert.equal(kept.includes("Denied"), false, "never stored");
      assert.equal(JSON.stringify(backend.requests).includes("Denied"), false, "never sent");
    },
  },
  {
    name: "refused, then allowed in Settings (granted): coming back on screen turns it On without a tap",
    async run({ page }) {
      await geoStub(page, { mode: "granted", permission: "denied" });
      await ready(page, { storage: { "mat.where": "refused" } });
      await until(async () => (await choice(page)) === "refused", "still refused at start");
      await page.evaluate(() => window.__geoSet({ permission: "granted" }));
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await until(async () => (await choice(page)) === "on", "on once Settings says granted");
      assert.equal(await calls(page), 1, "a position is asked for");
    },
  },
  {
    name: "Not now hides it for good and asks nothing; You can still turn it on",
    async run({ page }) {
      await geoStub(page);
      await ready(page);
      await until(() => askShown(page), "today's ticket asks");
      await page.dispatchEvent(D12 + " .tk-ask .no", "click");
      await until(async () => !(await askShown(page)), "the line goes");
      assert.equal(await choice(page), "off");
      assert.equal(await calls(page), 0);
      await page.reload();
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw again");
      assert.equal(await askShown(page), false);
      await openYou(page);
      assert.equal(await text(page, "#setWhereV"), "Off");
      assert.equal(await text(page, "#setWhere > span"), "現在地Location" + "For leave-by, distances and the stamp. Your position stays on this phone. A stamp pressed in the day’s place gets a small mark the others can see.");
      await shot(page, "6-you-off");
      await page.click("#setWhere");
      await until(async () => (await text(page, "#setWhereV")) === "On", "On");
      assert.equal(await calls(page), 1, "turning it on asks the phone");
      assert.equal(await choice(page), "on");
      await shot(page, "6-you-on");
      await page.click("#setWhere");
      await until(async () => (await text(page, "#setWhereV")) === "Off", "Off again");
      assert.equal(await choice(page), "off");
    },
  },
  {
    name: "the You row at 320 wide fits",
    viewport: { width: 320, height: 568 },
    async run({ page }) {
      await geoStub(page);
      await ready(page, { storage: { "mat.where": "refused" } });
      await openYou(page);
      const fit = await page.evaluate(() => {
        const r = document.getElementById("setWhere");
        const b = document.getElementById("setWhereV").getBoundingClientRect();
        const box = r.getBoundingClientRect();
        return { sw: r.scrollWidth, cw: r.clientWidth, right: b.right, boxRight: box.right };
      });
      assert.ok(fit.sw <= fit.cw && fit.right <= fit.boxRight, JSON.stringify(fit));
      await shot(page, "6-you-320");
    },
  },
  {
    name: "on: asked at most every 2 minutes, never while the app is hidden",
    async run({ page }) {
      await geoStub(page);
      const backend = await ready(page, { storage: { "mat.where": "on" } });
      await until(async () => (await calls(page)) === 1, "asked once on opening");
      await advance(page, backend, 60000);
      assert.equal(await calls(page), 1, "not within 2 minutes");
      await advance(page, backend, 61000);
      await until(async () => (await calls(page)) === 2, "again after 2 minutes");
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await advance(page, backend, 10 * 60000);
      assert.equal(await calls(page), 2, "nothing while hidden");
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await until(async () => (await calls(page)) === 3, "back on screen: asked");
      assert.deepEqual(await leaks(page, backend), []);
    },
  },
  {
    name: "a phone with no location: no ask, no row",
    async run({ page }) {
      await geoStub(page, { mode: "none" });
      await ready(page);
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(await askShown(page), false);
      await openYou(page);
      assert.equal(await page.evaluate(() => document.getElementById("setWhere").hidden), true);
    },
  },
  {
    name: "off, the tickets are exactly today's",
    async run({ page, newPhone }) {
      await geoStub(page, { mode: "none" });
      await ready(page);
      const plain = await page.evaluate(() => [...document.querySelectorAll("#rail .tk")].map((t) => t.outerHTML));
      const other = await newPhone();
      await geoStub(other);
      await ready(other, { storage: { "mat.where": "off" } });
      const off = await other.evaluate(() => [...document.querySelectorAll("#rail .tk")].map((t) => t.outerHTML));
      assert.equal(off.length, plain.length);
      off.forEach((h, i) => assert.equal(h, plain[i], "ticket " + (i + 1) + " is the same"));
      assert.equal(await other.evaluate(() => window.__geoCalls.length), 0);
    },
  },
];
