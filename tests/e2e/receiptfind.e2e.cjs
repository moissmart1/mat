// Find an item on the receipt (issue 26, look A): the 品名 Find line inside #rc.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SEED, NOON12, open, until, text, expectText, visible } = require("./helpers.cjs");

const rows = (page) => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length);
const waitRows = (page, n) => until(async () => (await rows(page)) === n, "expected " + n + " receipt rows");
const shot = async (page, name, fromHead = true) => {
  const dir = process.env.MAT_TAB_SHOTS;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  if (fromHead) await page.evaluate(() => { const h = document.querySelector("#rc > .rc-h"); h.scrollIntoView({ block: "start" }); window.scrollBy(0, -8); });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(dir, name) });
};
const active = (page) => page.evaluate(() => document.activeElement && document.activeElement.id);
const figures = (page) =>
  page.evaluate(() => ({
    say: document.getElementById("say").textContent,
    sayP: document.getElementById("sayP").textContent,
    no: document.querySelector("#rc .rc-no").textContent,
    tot: document.querySelector("#rc .rc-tot b").textContent,
    subs: [...document.querySelectorAll("#rc > .rc-sub b")].map((b) => b.textContent),
  }));
const emptyState = async (page) => {
  await waitRows(page, 8);
  assert.equal(await page.inputValue("#rcQuery"), "");
  assert.equal(await visible(page, "#rcClear"), false);
  assert.equal(await visible(page, "#rcFindN"), false);
  await expectText(page, "#rc .rc-tot span", "合計 Total");
};
const ready = async (page, extra = {}) => {
  const backend = await open(page, { seed: SEED, nowMs: NOON12, ...extra });
  await waitRows(page, 8);
  return backend;
};

module.exports = [
  {
    name: "find: empty line, label, placeholder, accessible name",
    async run({ page }) {
      await ready(page);
      assert.equal(await text(page, "label[for=rcQuery]"), "品名Find");
      assert.equal(await page.getAttribute("label[for=rcQuery] i", "aria-hidden"), "true");
      assert.equal(await page.getAttribute("#rcQuery", "placeholder"), "an item, like ramen");
      assert.equal(await page.getAttribute("#rcQuery", "aria-label"), "Find an item on the receipt");
      assert.equal(await page.locator("[role=search] #rcQuery").count(), 1);
      await emptyState(page);
      await shot(page, "find-empty.png");
    },
  },
  {
    name: "find: focus and the very same field are kept while typing",
    async run({ page }) {
      await ready(page);
      await page.focus("#rcQuery");
      await page.evaluate(() => { document.getElementById("rcQuery").dataset.same = "1"; });
      for (const ch of "ramen") {
        await page.keyboard.type(ch, { delay: 30 });
        assert.equal(await active(page), "rcQuery");
      }
      await waitRows(page, 1);
      const st = await page.evaluate(() => { const q = document.getElementById("rcQuery"); return { v: q.value, s: q.selectionStart, same: q.dataset.same }; });
      assert.deepEqual(st, { v: "ramen", s: 5, same: "1" });
      await expectText(page, "#rcFindN", "Showing 1 of 8 items");
      assert.ok(await visible(page, "#rcClear"));
      await page.keyboard.type(" l");
      assert.equal(await page.inputValue("#rcQuery"), "ramen l");
      assert.equal(await active(page), "rcQuery");
    },
  },
  {
    name: "find: focus, caret and words are kept across a sync",
    async run({ page }) {
      const backend = await ready(page);
      await page.focus("#rcQuery");
      await page.evaluate(() => { document.getElementById("rcQuery").dataset.same = "1"; });
      await page.keyboard.type("ramen");
      await waitRows(page, 1);
      await expectText(page, "#rcFindN", "Showing 1 of 8 items");
      const env = await backend.handle({ key: "test-key", actor: "Ajen", via: "app", action: "addExpense", args: { expense: { id: "findexp00001", title: "Ramen supper", amount: 800, currency: "JPY", rate: 111, paidBy: "Ajen", split: ["Mo", "Ajen"], splitMode: "equal", splitVals: [], day: "2026-12-12", note: "", kind: "" } } });
      assert.ok(env.ok, JSON.stringify(env));
      await page.evaluate(() => globalThis.__matTest.store.refresh());
      await expectText(page, "#rcFindN", "Showing 2 of 9 items");
      await waitRows(page, 2);
      const st = await page.evaluate(() => { const q = document.getElementById("rcQuery"); return { a: document.activeElement === q, v: q.value, s: q.selectionStart, same: q.dataset.same }; });
      assert.deepEqual(st, { a: true, v: "ramen", s: 5, same: "1" });
    },
  },
  {
    name: "find: nothing found says so and no figure moves",
    async run({ page }) {
      await ready(page);
      const before = await figures(page);
      await page.fill("#rcQuery", "Sushi");
      await expectText(page, "#rc .rc-none span", "No item says “Sushi”.");
      assert.equal(await page.locator("#rc .rc-group").count(), 0);
      assert.equal(await text(page, "#rcShowAll"), "Show all");
      await expectText(page, "#rcFindN", "Showing 0 of 8 items");
      await expectText(page, "#rc .rc-tot span", "合計 Trip total");
      assert.deepEqual(await figures(page), before);
      await shot(page, "find-none.png");
    },
  },
  {
    name: "find: Show all and Clear, by mouse and keyboard",
    async run({ page }) {
      await ready(page);
      await page.fill("#rcQuery", "Sushi");
      await page.click("#rcShowAll");
      await emptyState(page);
      assert.equal(await active(page), "rcQuery");

      await page.fill("#rcQuery", "ramen");
      await waitRows(page, 1);
      await page.click("#rcClear");
      await emptyState(page);
      assert.equal(await active(page), "rcQuery");
      await shot(page, "find-cleared.png");

      await page.focus("#rcQuery");
      await page.keyboard.type("ramen");
      await waitRows(page, 1);
      await page.keyboard.press("Tab");
      assert.equal(await active(page), "rcClear");
      await page.keyboard.press("Enter");
      await emptyState(page);
      assert.equal(await active(page), "rcQuery");
    },
  },
  {
    name: "find: Escape clears, Enter puts the keyboard away, only spaces is nothing",
    async run({ page }) {
      await ready(page);
      await page.focus("#rcQuery");
      await page.keyboard.press("Escape");
      await emptyState(page);
      assert.equal(await active(page), "rcQuery");
      await page.keyboard.type("ramen");
      await waitRows(page, 1);
      await page.keyboard.press("Escape");
      await emptyState(page);
      assert.equal(await active(page), "rcQuery");
      await page.keyboard.type("ramen");
      await waitRows(page, 1);
      await page.keyboard.press("Enter");
      assert.notEqual(await active(page), "rcQuery");
      assert.equal(await page.inputValue("#rcQuery"), "ramen");
      assert.equal(await rows(page), 1);
      await page.fill("#rcQuery", "   ");
      await waitRows(page, 8);
      assert.equal(await visible(page, "#rcClear"), false);
      assert.equal(await visible(page, "#rcFindN"), false);
      await expectText(page, "#rc .rc-tot span", "合計 Total");
    },
  },
  {
    name: "find: what is typed is text",
    async run({ page }) {
      await ready(page);
      let dialogs = 0;
      page.on("dialog", (d) => { dialogs++; d.dismiss(); });
      await page.fill("#rcQuery", "<img src=x onerror=alert(1)>");
      await expectText(page, "#rc .rc-none span", "No item says “<img src=x onerror=alert(1)>”.");
      assert.equal(await page.locator("#rc img").count(), 0);
      await page.waitForTimeout(200);
      assert.equal(dialogs, 0);
    },
  },
  {
    name: "find: a filtered line still opens, and the words stay after it closes",
    async run({ page }) {
      await ready(page);
      await page.fill("#rcQuery", "ramen");
      await waitRows(page, 1);
      await page.click("#rc .rc-row");
      await until(() => page.evaluate(() => { const s = document.getElementById("line"); return s.classList.contains("is-open") && Math.abs(s.getBoundingClientRect().bottom - innerHeight) < 1; }), "the line sheet opens");
      assert.match(await text(page, "#lineBody"), /Ramen/);
      await page.click("#lnDone");
      await until(() => page.evaluate(() => !document.getElementById("line").classList.contains("is-open")), "the line sheet closes");
      assert.equal(await page.inputValue("#rcQuery"), "ramen");
      assert.equal(await rows(page), 1);
    },
  },
  {
    name: "find at 320x568: one line, no sideways scroll, Clear on the paper",
    viewport: { width: 320, height: 568 },
    async run({ page }) {
      await ready(page);
      const flat = () => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth);
      assert.ok(await flat(), "empty");
      assert.ok(await page.evaluate(() => { const q = document.getElementById("rcQuery"); return q.scrollWidth <= q.clientWidth; }), "placeholder whole");
      await shot(page, "find-320-empty.png");
      await page.click("#rcQuery"); // a tap brings the field into view, as on a phone
      await page.keyboard.type("ramen");
      await waitRows(page, 1);
      assert.ok(await flat(), "ramen");
      const geo = await page.evaluate(() => {
        const rc = document.getElementById("rc").getBoundingClientRect();
        const c = document.getElementById("rcClear").getBoundingClientRect();
        const q = document.getElementById("rcQuery").getBoundingClientRect();
        return { rowH: document.querySelector("#rcFind .rc-find-row").getBoundingClientRect().height, cIn: c.left >= rc.left && c.right <= rc.right, qIn: q.top >= 0 && q.bottom <= innerHeight };
      });
      assert.ok(geo.rowH < 50, "one line: " + geo.rowH);
      assert.ok(geo.cIn, "Clear inside the paper");
      assert.ok(geo.qIn, "field inside the viewport");
      await shot(page, "find-320-typed.png");
      await page.fill("#rcQuery", "q".repeat(60));
      await expectText(page, "#rcFindN", "Showing 0 of 8 items");
      assert.ok(await flat(), "60 letters");
      const c = await page.evaluate(() => { const rc = document.getElementById("rc").getBoundingClientRect(); const c = document.getElementById("rcClear").getBoundingClientRect(); return c.left >= rc.left && c.right <= rc.right; });
      assert.ok(c);
      await page.fill("#rcQuery", "Sushi");
      await expectText(page, "#rcFindN", "Showing 0 of 8 items");
      await shot(page, "find-320-none.png");
    },
  },
  {
    name: "find in landscape 844x390",
    viewport: { width: 844, height: 390 },
    async run({ page }) {
      await ready(page);
      await page.fill("#rcQuery", "ramen");
      await waitRows(page, 1);
      assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth));
      await shot(page, "find-landscape.png");
    },
  },
  {
    name: "find at 1440x900: inside the receipt, typing filters",
    viewport: { width: 1440, height: 900 },
    mobile: false,
    async run({ page }) {
      await ready(page);
      assert.ok(await page.evaluate(() => document.getElementById("rc").contains(document.getElementById("rcQuery"))));
      await page.fill("#rcQuery", "ramen");
      await waitRows(page, 1);
      assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth));
      await shot(page, "find-desktop.png");
    },
  },
  {
    name: "find: the trip not ready shows no field and no paper",
    async run({ page }) {
      await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await expectText(page, "#gate p", "This phone needs the trip link. Open it from your email again, or paste it here.");
      assert.equal(await visible(page, "#rcQuery"), false);
      assert.equal(await visible(page, "#rc"), false);
    },
  },
  {
    name: "find: picture of the typed state (ramen, the field focused)",
    async run({ page }) {
      await ready(page);
      await page.focus("#rcQuery");
      await page.keyboard.type("ramen");
      await waitRows(page, 1);
      await shot(page, "find-typed.png");
    },
  },
];
