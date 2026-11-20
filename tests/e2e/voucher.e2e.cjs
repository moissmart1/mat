// The slip drawn as a 精算書 voucher (mock-up 1A): the carbon copy (控) of a
// settlement form, printed in indigo, with a revenue-stamp box, the copy
// mark and its number, column heads and a 但 line. Every word, figure and
// button the slip had stays and still works: Remind, the stamp, the
// e-Transfer address, the working, Simplify. Held at 393x852, 320x568,
// 844x390 and 1440x900.

const assert = require("node:assert/strict");
const fs = require("fs");
const { SEED, NOON12, open, until, text, expectText, visible } = require("./helpers.cjs");

const SHOTS = require("./shots.cjs")("money-trio");
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.getElementById("slip").scrollIntoView({ block: "start" }));
  await page.waitForTimeout(60);
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
};
const SPOT = (key) => '#slip button.spot[data-key="' + key + '"]';
const WITH_ADDRESS = { ...SEED, people: { Mo: { etransfer: "mo@example.com" } } };

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: WITH_ADDRESS, nowMs: NOON12, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#slip .s-row.is-open").length === 2), "the slip draws");
  return backend;
}

// Nothing sticks out of the voucher or the screen, and no figure runs into the 済 column.
const fits = (page) =>
  page.evaluate(() => {
    const slip = document.getElementById("slip").getBoundingClientRect();
    const bad = [];
    if (document.documentElement.scrollWidth > innerWidth) bad.push("sideways scroll");
    for (const el of document.querySelectorAll("#slip .cf-h > *, #slip .cf-cols, #slip .s-row, #slip .cf-but, #slip .slip-f, #slip .simp")) {
      const r = el.getBoundingClientRect();
      if (r.left < slip.left - 0.5 || r.right > slip.right + 0.5) bad.push(el.className + " leaves the voucher");
    }
    for (const row of document.querySelectorAll("#slip .s-row")) {
      const spot = row.querySelector(".spot");
      if (!spot) continue;
      const s = spot.getBoundingClientRect();
      for (const el of row.querySelectorAll(".s-who, .s-amt, .remind")) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const r = el.tagName === "BUTTON" ? el.getBoundingClientRect() : range.getBoundingClientRect();
        if (r.right > s.left + 0.5) bad.push(el.className + " " + JSON.stringify(el.textContent || el.value) + " runs into the 済 column by " + Math.round(r.right - s.left) + " px");
      }
    }
    const title = document.querySelector("#slip .cf-t b").getBoundingClientRect();
    if (title.height > 40) bad.push("the title wraps");
    return bad;
  });

function sizeCase(size, mobile, tag) {
  return {
    name: tag + ": the voucher fits, open, armed, with the working, and stamped",
    viewport: size,
    ...(mobile ? {} : { mobile: false }),
    async run({ page }) {
      await ready(page);
      assert.deepEqual(await fits(page), []);
      await shot(page, "1A-" + tag + "-voucher");
      await page.click(SPOT("Ajen>Mo"));
      await until(() => visible(page, "#sendTo"), "armed, with the address");
      assert.deepEqual(await fits(page), []);
      await shot(page, "1A-" + tag + "-armed");
      await page.click('#slip .s-row[data-key="Trenton>Mo"] button.s-amt');
      await until(() => visible(page, "#slip .s-work"), "the working opens");
      assert.deepEqual(await fits(page), []);
      await shot(page, "1A-" + tag + "-working");
      await page.click(SPOT("Ajen>Mo"));
      await until(() => page.evaluate(() => document.querySelectorAll("#slip .s-row.is-paid").length === 1), "stamped");
      await page.waitForTimeout(400);
      assert.deepEqual(await fits(page), []);
      await shot(page, "1A-" + tag + "-stamped");
    },
  };
}

module.exports = [
  {
    name: "the voucher's form: stamp box, 旅費精算書, 控 and its number, column heads, the 但 line",
    async run({ page }) {
      await ready(page);
      assert.equal(await page.evaluate(() => document.getElementById("slip").classList.contains("cf")), true);
      await expectText(page, "#slip .cf-inshi", "収入印紙");
      await expectText(page, "#slip .slip-t b", "旅費精算書");
      await expectText(page, "#slip .cf-t span", "Trip settlement · MAT");
      await expectText(page, "#slip .cf-no", "控No.0001");
      await expectText(page, "#slip .cf-cols", "支払 → 受取 From → to, amount済 Paid");
      await expectText(page, "#slip .cf-but", "但Japan 2026, Dec 10 to 20. Three people.");
      await expectText(page, "#slip .slip-f", "Stamp it the moment you send. What’s left is always what’s shown here.");
      // The form is printed in indigo; what is written on it stays black.
      const ink = await page.evaluate(() => ({
        title: getComputedStyle(document.querySelector("#slip .cf-t b")).color,
        who: getComputedStyle(document.querySelector("#slip .s-who")).color,
      }));
      assert.deepEqual(ink, { title: "rgb(40, 64, 143)", who: "rgb(21, 18, 15)" });
      // Order: head, column heads, the rows, 但, the foot, Simplify.
      const order = await page.$$eval("#slip > *", (els) => els.map((e) => e.className.split(" ")[0]));
      assert.deepEqual(order, ["cf-h", "cf-cols", "s-row", "s-row", "cf-but", "slip-f", "simp"]);
    },
  },
  {
    name: "everything the slip did still works on the voucher: Remind, arming with the address, the working, the stamp, Simplify",
    async run({ page }) {
      await page.addInitScript(() => {
        globalThis.__shared = [];
        Object.defineProperty(Navigator.prototype, "share", { value: async (d) => globalThis.__shared.push(d), configurable: true, writable: true });
      });
      await ready(page);
      assert.deepEqual(await page.$$eval("#slip .s-row.is-open .s-who", (els) => els.map((e) => e.textContent)), ["Trenton → you", "Ajen → you"]);
      await page.click('#slip .s-row[data-key="Ajen>Mo"] button.remind');
      await until(() => page.evaluate(() => globalThis.__shared.length === 1), "Remind shares");
      assert.equal(await page.evaluate(() => globalThis.__shared[0].text), "Ajen, you owe me $221.73 for the Japan trip. e-Transfer: mo@example.com");
      await page.click('#slip .s-row[data-key="Trenton>Mo"] button.s-amt');
      await until(() => visible(page, "#slip .s-work"), "the working opens");
      await page.click(SPOT("Ajen>Mo"));
      await expectText(page, "#sendTo", "mo@example.com");
      await page.click(SPOT("Ajen>Mo"));
      await until(() => page.evaluate(() => document.querySelectorAll("#slip .s-row.is-paid").length === 1), "stamped");
      await expectText(page, "#slip .cf-no i", "No.0002");
      await page.click("#simp");
      assert.ok(await visible(page, "#simpAsk"));
      await page.click("#simpKeep");
      assert.equal(await visible(page, "#simpAsk"), false);
    },
  },
  sizeCase({ width: 393, height: 852 }, true, "393x852"),
  sizeCase({ width: 320, height: 568 }, true, "320x568"),
  sizeCase({ width: 844, height: 390 }, true, "844x390"),
  sizeCase({ width: 1440, height: 900 }, false, "1440x900"),
];
