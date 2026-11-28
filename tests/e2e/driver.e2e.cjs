// Show to driver (location build, item 2): a 運転手さんへ key on the hotel
// card, shown when the stay has a Japanese name or address, opens the
// driver's screen: paper-white, Japanese only, the name and the address as
// large as fits the width (never cut), and ここまでお願いします。. Closed with
// Done, Escape or the scrim; driver-open on #phone while it is up; the screen
// kept awake where the phone allows. The plan is tests/fixtures/plan.json over
// the seed; 13:20 on Dec 12 in Japan (Day 3).

const assert = require("node:assert/strict");
const fs = require("fs");
const { WITH_PLAN, open, until, atRest, railOn, text } = require("./helpers.cjs");

const SHOTS = require("./shots.cjs")("loc");
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
};

const LONG = "北海道虻田郡倶知安町 字山田 204番地 ニセコひらふ 1条3丁目 ホテルニセコアルペンリゾート";
function seedWith(patch, id = "planstay0001") {
  const seed = JSON.parse(JSON.stringify(WITH_PLAN));
  Object.assign(seed.stays.find((s) => s.id === id), patch);
  return seed;
}

const tk = (date) => '#rail .pg[data-date="' + date + '"]';
const isOpen = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  return !!el && el.classList.contains("is-open");
}, id);

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: WITH_PLAN, tab: "days", ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}
async function openCard(page, date = "2026-12-12") {
  await page.dispatchEvent(tk(date) + " .tk-stay", "click");
  await atRest(page, "#stay", { message: "the hotel card opens" });
}
async function openDriver(page) {
  await page.evaluate(() => document.querySelector("#stay .drv").scrollIntoView({ block: "center" }));
  await page.click("#stay .drv");
  await atRest(page, "#driver", { message: "the driver's screen opens" });
  // Fitted once the fonts are in.
  await until(() => page.evaluate(() => document.getElementById("driver").dataset.fit === "1"), "the type is fitted");
}

// Each big line is whole: nothing runs past its box or the screen.
async function nothingCut(page) {
  const got = await page.evaluate(() => {
    const d = document.getElementById("driver").getBoundingClientRect();
    return [...document.querySelectorAll("#driver .dc-name, #driver .dc-ad, #driver .dc-ask, #driver .dc-to")].map((n) => {
      const r = n.getBoundingClientRect();
      return { cls: n.className, sw: n.scrollWidth, cw: n.clientWidth, left: r.left, right: r.right, dl: d.left, dr: d.right, size: parseFloat(getComputedStyle(n).fontSize) };
    });
  });
  for (const g of got) {
    assert.ok(g.sw <= g.cw + 0.5, g.cls + " is not cut: " + JSON.stringify(g));
    assert.ok(g.left >= g.dl - 0.5 && g.right <= g.dr + 0.5, g.cls + " is inside the screen: " + JSON.stringify(g));
  }
  return got;
}

// Where a line of the address breaks, the character before it is a space
// (or the break is at a word's own end): it never breaks inside a word.
const breaksBetweenWords = (page) => page.evaluate(() => {
  const n = document.querySelector("#driver .dc-ad");
  const t = n.firstChild;
  const tops = [];
  for (let i = 0; i < t.length; i++) {
    const range = document.createRange();
    range.setStart(t, i);
    range.setEnd(t, i + 1);
    const rs = range.getClientRects();
    tops.push(rs.length ? Math.round(rs[0].top) : null);
  }
  const bad = [];
  let lines = 1;
  let last = tops[0];
  for (let i = 1; i < t.length; i++) {
    if (tops[i] === null || t.data[i] === " ") continue;
    if (tops[i] > last + 2) {
      lines++;
      if (t.data[i - 1] !== " ") bad.push(t.data.slice(Math.max(0, i - 3), i) + "|" + t.data.slice(i, i + 3));
    }
    last = tops[i];
  }
  return { bad, lines };
});

const SIZES = [
  { tag: "393", viewport: { width: 393, height: 852 } },
  { tag: "320", viewport: { width: 320, height: 568 } },
  { tag: "844-sideways", viewport: { width: 844, height: 390 } },
  { tag: "1440-wide", viewport: { width: 1440, height: 900 }, mobile: false },
];

module.exports = [
  ...SIZES.map(({ tag, viewport, mobile }) => ({
    name: "Show to driver at " + tag,
    viewport,
    mobile,
    async run({ page }) {
      await ready(page);
      await openCard(page);
      const key = await page.evaluate(() => {
        const b = document.querySelector("#stay .drv");
        const r = b.getBoundingClientRect();
        const s = document.getElementById("stay").getBoundingClientRect();
        const sp = b.querySelector("span");
        return { cut: sp.scrollWidth > sp.clientWidth, tag: b.tagName, jp: b.querySelector("b").textContent, text: b.textContent, name: b.getAttribute("aria-label"), h: r.height, inside: r.left >= s.left && r.right <= s.right + 0.5 };
      });
      assert.deepEqual([key.tag, key.jp, key.text, key.name], ["BUTTON", "運転手さんへ", "運転手さんへShow to driver›", "運転手さんへ Show to driver"]);
      assert.ok(key.h >= 44 && key.h <= 60 && key.inside && !key.cut, "one line, whole, inside the card: " + JSON.stringify(key));
      await until(() => page.evaluate(() => getComputedStyle(document.getElementById("stay")).transform === "none"), "the card has risen");
      await page.evaluate(() => document.querySelector("#stay .drv").scrollIntoView({ block: "center" }));
      await shot(page, "2-card-key-" + tag);
      await openDriver(page);
      assert.equal(await page.evaluate(() => document.getElementById("phone").classList.contains("driver-open")), true);
      assert.equal(await text(page, "#driver .dc-to"), "運転手さんへ");
      assert.equal(await text(page, "#driver .dc-name"), "浅草ホテル");
      assert.equal(await text(page, "#driver .dc-ad"), "東京都台東区浅草1-1-1");
      assert.equal(await text(page, "#driver .dc-ask"), "ここまでお願いします。");
      // Japanese only for the driver: no English in the middle of the screen.
      assert.equal(/[A-Za-z]/.test(await text(page, "#driver .dc-mid")), false);
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "driverDone", "focus on Done");
      const sizes = await nothingCut(page);
      const name = sizes.find((g) => g.cls === "dc-name");
      assert.ok(name.size >= 26, "the name is large: " + name.size);
      // The whole screen (or, on a computer, the Days pane) is the driver's.
      const box = await page.evaluate(() => {
        const d = document.getElementById("driver").getBoundingClientRect();
        const p = document.getElementById("phone").getBoundingClientRect();
        const days = document.getElementById("vDays").getBoundingClientRect();
        return { d: [d.left, d.top, d.right, d.bottom], p: [p.left, p.top, p.right, p.bottom], days: [days.left, days.right], bg: getComputedStyle(document.querySelector("#driver .dc-mid")).color };
      });
      if (tag === "1440-wide") {
        assert.ok(Math.abs(box.d[0] - box.days[0]) < 1 && Math.abs(box.d[2] - box.days[1]) < 1, "in the Days pane: " + JSON.stringify(box));
      } else {
        assert.deepEqual(box.d.map(Math.round), box.p.map(Math.round), "the whole screen");
      }
      await shot(page, "2-driver-" + tag);
      await page.click("#driverDone");
      await atRest(page, "#driver", { open: false, message: "Done closes it" });
      assert.equal(await isOpen(page, "stay"), true, "back on the hotel card");
      assert.equal(await page.evaluate(() => document.getElementById("phone").classList.contains("driver-open")), false);
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("drv")), true, "focus back on the key");
    },
  })),
  ...[
    { tag: "320", viewport: { width: 320, height: 568 } },
    { tag: "393", viewport: { width: 393, height: 852 } },
    { tag: "844-sideways", viewport: { width: 844, height: 390 } },
    { tag: "1440-wide", viewport: { width: 1440, height: 900 }, mobile: false },
  ].map(({ tag, viewport, mobile }) => ({
    name: "a long address wraps between words and is never cut, at " + tag,
    viewport,
    mobile,
    async run({ page }) {
      await ready(page, { seed: seedWith({ addressJp: LONG, nameJp: "ホテルニセコアルペンリゾートアンドスパ" }) });
      await openCard(page);
      await openDriver(page);
      await nothingCut(page);
      const b = await breaksBetweenWords(page);
      assert.deepEqual(b.bad, [], "breaks only between words: " + JSON.stringify(b));
      assert.ok(b.lines >= 2, "a long address takes more than one line: " + JSON.stringify(b));
      // The screen scrolls when it is taller than the phone, so nothing is out of reach.
      const reach = await page.evaluate(() => {
        const d = document.getElementById("driver");
        d.scrollTop = d.scrollHeight;
        const ask = document.querySelector("#driver .dc-ask").getBoundingClientRect();
        return { bottom: ask.bottom, vh: innerHeight };
      });
      assert.ok(reach.bottom <= reach.vh + 0.5, "the last line can be scrolled to: " + JSON.stringify(reach));
      await page.evaluate(() => { document.getElementById("driver").scrollTop = 0; });
      await shot(page, "2-driver-long-" + tag);
    },
  })),
  {
    name: "no Japanese name or address: no key",
    async run({ page }) {
      await ready(page);
      await page.click("#pager .sq:nth-child(4)");
      await railOn(page, 4);
      await openCard(page, "2026-12-13");
      assert.equal(await page.evaluate(() => document.querySelectorAll("#stay .drv").length), 0);
    },
  },
  {
    name: "only an address: the key, and no name line on the driver's screen",
    async run({ page }) {
      await ready(page, { seed: seedWith({ nameJp: "" }) });
      await openCard(page);
      await openDriver(page);
      assert.equal(await page.evaluate(() => document.querySelectorAll("#driver .dc-name").length), 0);
      assert.equal(await text(page, "#driver .dc-ad"), "東京都台東区浅草1-1-1");
      assert.equal(await text(page, "#driver .dc-top"), "宿泊Asakusa hotelDone");
    },
  },
  {
    name: "only a Japanese name: the key, and no address line",
    async run({ page }) {
      await ready(page, { seed: seedWith({ addressJp: "" }) });
      await openCard(page);
      await openDriver(page);
      assert.equal(await page.evaluate(() => document.querySelectorAll("#driver .dc-ad").length), 0);
      assert.equal(await text(page, "#driver .dc-name"), "浅草ホテル");
    },
  },
  {
    name: "Escape closes the driver's screen first, then the card; the scrim closes it too",
    viewport: { width: 1440, height: 900 },
    mobile: false,
    async run({ page }) {
      await ready(page);
      await openCard(page);
      await openDriver(page);
      await page.keyboard.press("Escape");
      await atRest(page, "#driver", { open: false, message: "Escape closes the driver's screen" });
      assert.equal(await isOpen(page, "stay"), true, "the card is still open");
      await page.keyboard.press("Escape");
      await atRest(page, "#stay", { open: false, message: "a second Escape closes the card" });
      await openCard(page);
      await openDriver(page);
      // The scrim: on a computer, over the Money pane.
      await page.mouse.click(1100, 450);
      await atRest(page, "#driver", { open: false, message: "the scrim closes it" });
      assert.equal(await isOpen(page, "stay"), true);
    },
  },
  {
    name: "the screen is kept awake while it is up, and let go after",
    async run({ page }) {
      await page.addInitScript(() => {
        window.__locks = [];
        Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: (type) => {
          const lock = { type, released: false, release() { this.released = true; return Promise.resolve(); }, addEventListener() {} };
          window.__locks.push(lock);
          return Promise.resolve(lock);
        } } });
      });
      await ready(page);
      await openCard(page);
      await openDriver(page);
      await until(() => page.evaluate(() => window.__locks.length === 1 && window.__locks[0].type === "screen"), "a screen wake lock");
      await until(async () => (await text(page, "#driver .dc-bot")) === "Hold the phone up to the driver. It stays on while this is open.", "it says the screen stays on");
      await page.click("#driverDone");
      await until(() => page.evaluate(() => window.__locks[0].released), "released on close");
    },
  },
  {
    name: "a phone that refuses to stay awake: no word about it, no error",
    async run({ page }) {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: () => Promise.reject(new DOMException("no", "NotAllowedError")) } });
      });
      await ready(page);
      await openCard(page);
      await openDriver(page);
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(await text(page, "#driver .dc-bot"), "Hold the phone up to the driver.");
      await page.click("#driverDone");
      await atRest(page, "#driver", { open: false, message: "closes" });
    },
  },
  {
    name: "a phone with no wake lock at all: the screen still opens",
    async run({ page }) {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
      });
      await ready(page);
      await openCard(page);
      await openDriver(page);
      assert.equal(await text(page, "#driver .dc-bot"), "Hold the phone up to the driver.");
    },
  },
  {
    name: "closing the Days sheets (a tab switch) closes the driver's screen too",
    async run({ page }) {
      await ready(page);
      await openCard(page);
      await openDriver(page);
      await page.click("#driverDone");
      await atRest(page, "#driver", { open: false, message: "closes" });
      await page.click("#stayDone");
      await atRest(page, "#stay", { open: false, message: "the card closes" });
      await openCard(page);
      await openDriver(page);
      // A tab switch is under the driver's screen: closing the card from elsewhere closes it too.
      await page.evaluate(() => document.querySelector('#nav [data-tab="money"]').click());
      await atRest(page, "#driver", { open: false, message: "a tab switch closes the driver's screen" });
      await atRest(page, "#stay", { open: false, message: "a tab switch closes the card" });
      assert.equal(await page.evaluate(() => /(^|\s)[a-z]+-open(\s|$)/.test(document.getElementById("phone").className)), false);
    },
  },
];
