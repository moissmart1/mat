// Task 22: the You sheet says which planner payment was not brought in, and
// why, under the Planner payments row. Everything here is made up.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { SEED, NOON12, open, until } = require("./helpers.cjs");

const PLANNER_ID = "fakePlannerSheet_0123456789abcdefXYZ";
const SHOTS = require("./shots.cjs")("problems");
const JUST_PULLED = new Date(NOON12).toISOString();

const TWO = {
  at: JUST_PULLED,
  list: [
    { id: "P011", message: "Only payments split equally can be brought in.", row: 14, what: "Ryokan deposit" },
    { id: "", message: "That payment’s id isn’t usable.", row: 22, what: "Taxi from the airport to the hotel with the long luggage" },
  ],
  more: 0,
};

async function openYou(page, paymentProblems, extra = {}) {
  // paymentsPulledAt: as if a phone pulled a moment ago, so opening does not pull again.
  await open(page, { seed: { ...SEED, plannerId: PLANNER_ID, paymentsPulledAt: JUST_PULLED, paymentProblems }, nowMs: NOON12, ...extra });
  await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0), "the receipt draws");
  await page.click("#youBtn");
  await until(
    () => page.evaluate(() => {
      const s = document.getElementById("you");
      return s.classList.contains("is-open") && Math.abs(s.getBoundingClientRect().bottom - innerHeight) < 1;
    }),
    "the settings sheet opens",
  );
}

const blocks = (page) =>
  page.evaluate(() => [...document.querySelectorAll("#setPlannerP .set-pp-i")].map((b) => [...b.children].map((c) => c.textContent)));
const noSideways = (page) =>
  page.evaluate(() => {
    const sheet = document.getElementById("you");
    return { sheet: [sheet.scrollWidth, sheet.clientWidth], page: [document.documentElement.scrollWidth, document.documentElement.clientWidth] };
  });

module.exports = [
  {
    name: "You: two problems show as two blocks, each with its id, row, words and reason; the pull time shows",
    viewport: { width: 393, height: 852 },
    async run({ page }) {
      await openYou(page, TWO);
      assert.equal(await page.isHidden("#setPlannerP"), false);
      assert.deepEqual(await blocks(page), [
        ["P011 · row 14 · Ryokan deposit", "Only payments split equally can be brought in."],
        ["row 22 · Taxi from the airport to the hotel with the long luggage", "That payment’s id isn’t usable."],
      ]);
      const head = await page.textContent("#setPlannerP .set-pp-h");
      assert.ok(head.startsWith("Not brought in from the planner"), head);
      assert.match(head, /Dec 12/);
      // It sits right under the Planner payments row.
      assert.equal(await page.evaluate(() => document.getElementById("setPlanner").nextElementSibling.id), "setPlannerP");
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.locator("#setPlannerP").scrollIntoViewIfNeeded();
      await page.screenshot({ path: SHOTS + "/problems-393.png" });
    },
  },
  {
    name: "You: more than 20 says how many more",
    async run({ page }) {
      await openYou(page, { ...TWO, more: 3 });
      assert.equal(await page.textContent("#setPlannerP .set-pp-more"), "and 3 more");
    },
  },
  {
    name: "You: with no problems the block is hidden",
    async run({ page }) {
      await openYou(page, { at: JUST_PULLED, list: [], more: 0 });
      assert.equal(await page.isHidden("#setPlannerP"), true);
    },
  },
  {
    name: "You: at 320 wide the sheet does not scroll sideways, and a long word wraps",
    viewport: { width: 320, height: 640 },
    async run({ page }) {
      const long = { id: "P012", message: "That payment has nobody to split it between, so it can’t be brought in until a name is added.", row: 3, what: "Averyveryveryverylongdescriptionwithoutanyspacesatall123456789" };
      await openYou(page, { ...TWO, list: [...TWO.list, long] });
      const w = await noSideways(page);
      assert.ok(w.sheet[0] <= w.sheet[1], "the sheet: " + JSON.stringify(w));
      assert.ok(w.page[0] <= w.page[1], "the page: " + JSON.stringify(w));
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.locator("#setPlannerP").scrollIntoViewIfNeeded();
      await page.screenshot({ path: SHOTS + "/problems-320.png" });
    },
  },
  {
    name: "You: planner text that looks like HTML shows as text",
    async run({ page }) {
      const evil = "<img src=x onerror=alert(1)>";
      await openYou(page, { at: JUST_PULLED, list: [{ id: "P013", message: "Why.", row: 5, what: evil }], more: 0 });
      assert.deepEqual(await blocks(page), [["P013 · row 5 · " + evil, "Why."]]);
      assert.equal(await page.locator("#setPlannerP img").count(), 0);
    },
  },
];
