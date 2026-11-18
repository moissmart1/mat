// After the trip is taken off the phone (a refused key, Forget this phone),
// nothing of it stays in the page: not a stop title, not a person's
// e-Transfer address. While merely loading or offline, what is drawn stays.

const assert = require("node:assert/strict");
const { WITH_PLAN, NOON12, open, until, text, visible } = require("./helpers.cjs");

const line = (o) => ({ day: "2026-12-11", currency: "CAD", rate: 111, splitMode: "equal", splitVals: [], note: "", kind: "", deleted: false, ...o });
const SEED = {
  ...WITH_PLAN,
  expenses: [line({ id: "wipeexp001", title: "Izakaya", amount: 20, paidBy: "Ajen", split: ["Mo", "Ajen"] })],
  payments: [],
  people: { Ajen: { etransfer: "ajen.wipe@example.test" }, Mo: { etransfer: "mo.wipe@example.test" } },
};
const STOP = "Meiji Shrine";
const ADDRESS = "ajen.wipe@example.test";
const MINE = "mo.wipe@example.test";
const WORDS = [STOP, ADDRESS, MINE, "Senso-ji", "Dinner in Shibuya", "Asakusa hotel", "Izakaya", "Temples, then the view"];
const SIZES = [{ width: 393, height: 852 }, { width: 1440, height: 900 }];

const body = (page) => page.evaluate(() => document.body.textContent);

async function ready(page, desktop) {
  const backend = await open(page, { seed: SEED, nowMs: NOON12, tab: "days" });
  await until(() => page.evaluate((t) => document.body.textContent.includes(t), STOP), "the stop is drawn");
  // Arm the slip row so the e-Transfer address is drawn.
  await until(() => page.evaluate(() => !!document.querySelector('#slip .s-row[data-key="Mo>Ajen"] .spot')), "the slip row is drawn");
  await page.dispatchEvent('#slip .s-row[data-key="Mo>Ajen"] .spot', "click");
  await until(() => page.evaluate((a) => document.body.textContent.includes(a), ADDRESS), "the address is drawn");
  // Every sheet opened and closed once, so each has drawn what it holds.
  for (const [sel, sheet] of [["#dayCount", "#allDays"], [".tk-stay", "#stay"], ["#histBtn", "#hist"], ["#rc .rc-row", "#line"], ["#ring", "#reg"], ["#youBtn", "#you"], ["#stampBtn", "#book"]]) {
    const hit = await page.evaluate((q) => {
      const b = document.querySelector(q);
      if (!b || b.hidden) return false;
      b.click();
      return true;
    }, sel);
    if (!hit) continue;
    await page.evaluate(() => globalThis.__matTest.store.idle());
    await page.keyboard.press("Escape");
  }
  // A stop sheet open on Days.
  await page.evaluate(() => {
    const r = document.querySelector("#vDays .r[data-id]");
    if (r) r.click();
  });
  await page.evaluate(() => globalThis.__matTest.store.idle());
  return backend;
}

async function assertGone(page) {
  await until(() => visible(page, "#gate"), "the no-key screen shows");
  const left = async () => {
    const t = await body(page);
    return WORDS.filter((w) => t.includes(w));
  };
  await until(async () => (await left()).length === 0, "nothing of the trip is left in the page").catch(async (e) => {
    const where = await page.evaluate((ws) => ws.map((w) => [w, [...document.querySelectorAll("body, body *")].filter((n) => n.textContent.includes(w) && ![...n.children].some((c) => c.textContent.includes(w))).map((n) => n.tagName + "#" + n.id + "." + n.className)]), [STOP, ADDRESS, MINE]);
    throw new Error(e.message + ": " + JSON.stringify(where));
  });
  const t = await body(page);
  for (const word of WORDS) {
    assert.equal(t.includes(word), false, word + " is still in the page");
  }
  assert.equal(await page.evaluate(() => document.querySelectorAll("#vDays .r[data-id], #vDays .pg > *").length), 0, "no day ticket is drawn");
}

const cases = [];
for (const size of SIZES) {
  const mobile = size.width < 600;
  cases.push({
    name: "a refused key leaves nothing of the trip in the page at " + size.width + "x" + size.height,
    viewport: size,
    ...(mobile ? {} : { mobile: false }),
    async run({ page }) {
      const backend = await ready(page);
      backend.failWith = "bad_key";
      await page.evaluate(() => globalThis.__matTest.store.checkRev());
      await assertGone(page);
    },
  });
  cases.push({
    name: "Forget this phone leaves nothing of the trip in the page at " + size.width + "x" + size.height,
    viewport: size,
    ...(mobile ? {} : { mobile: false }),
    async run({ page }) {
      await ready(page);
      await page.dispatchEvent("#youBtn", "click");
      await until(() => page.evaluate(() => document.getElementById("you").classList.contains("is-open")), "settings open");
      await page.dispatchEvent("#setForget", "click");
      await page.dispatchEvent("#setForget", "click");
      await assertGone(page);
    },
  });
}

cases.push({
  name: "a plain network failure, and a load that has not landed yet, keep the drawn trip",
  async run({ page }) {
    const backend = await ready(page);
    backend.failWith = "network";
    await page.evaluate(() => globalThis.__matTest.store.checkRev());
    await page.evaluate(() => globalThis.__matTest.store.refresh && globalThis.__matTest.store.refresh());
    await page.evaluate(() => globalThis.__matTest.store.idle());
    assert.equal(await page.evaluate(() => globalThis.__matTest.store.state.status), "ready");
    let t = await body(page);
    assert.ok(t.includes(STOP), "the stop stays while offline");
    assert.ok(t.includes(ADDRESS), "the address stays while offline");
    assert.equal(await visible(page, "#gate"), false);
    // A slow load: the page reopens with the saved trip while the backend does not answer.
    await page.reload();
    await until(() => page.evaluate((s) => document.body.textContent.includes(s), STOP), "the saved trip draws on a reload with no signal");
    t = await body(page);
    assert.ok(t.includes(STOP) && t.includes(ADDRESS) === t.includes(ADDRESS));
    assert.equal(await visible(page, "#gate"), false);
  },
});

module.exports = cases;
