// The line sheet (Task 9): your share, who rang it up, a note, that line's
// history, edit, delete, and the way out for a line that did not save.

const assert = require("node:assert/strict");
const P = require("../../backend/Pure.js");
const { SEED, NOON12, SEEDED_AT, open, advance, until, atRest, text, expectText, visible } = require("./helpers.cjs");

// ---- small tools for this file ----

const isOpen = (page, id) => page.evaluate((i) => document.getElementById(i).classList.contains("is-open"), id);
// Open, and risen all the way (the sheet slides up over 500 ms).
const waitSheet = (page) => atRest(page, "#line", { message: "the line sheet opens" });
const waitSheetClosed = (page) => atRest(page, "#line", { open: false, message: "the line sheet closes" });
// Open, and risen all the way: the register slides up over 500 ms, and a key tapped
// mid-slide can be missed.
const waitRegOpen = (page) => atRest(page, "#reg", { message: "the register opens" });
const rowCount = (page) => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length);
const waitRows = (page, n) => until(async () => (await rowCount(page)) === n, "expected " + n + " receipt rows");
const rowOf = (page, title) =>
  page.evaluate((t) => {
    const r = [...document.querySelectorAll("#rc .rc-row[data-id]")].find((x) => x.querySelector(".rc-t").firstChild.textContent === t);
    return r ? { id: r.dataset.id, cls: r.className, text: r.textContent, amt: r.querySelector(".rc-amt").textContent, index: [...r.parentNode.children].indexOf(r) } : null;
  }, title);
const waitRow = (page, title, check = () => true, what = "") =>
  until(async () => {
    const r = await rowOf(page, title);
    return r && check(r) ? r : null;
  }, "row " + title + " " + what);
const saved = (backend) => backend.fake.primitives.readTable_("Expenses").map(P.expenseFromRow);
const savedTitled = (backend, title) => saved(backend).filter((e) => e.title === title && !e.deleted);
const idle = (page) => page.evaluate(() => globalThis.__matTest.store.idle());
const sentences = (page) => page.$$eval("#lnLog .ln-ev span", (els) => els.map((e) => e.textContent));
const waitSentences = (page, check, what) =>
  until(async () => {
    const s = await sentences(page);
    return check(s) ? s : null;
  }, what);

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: SEED, nowMs: NOON12, ...opts });
  await waitRows(page, 8);
  return backend;
}

// Taps a receipt row and waits for its sheet.
async function openLine(page, title) {
  const row = await waitRow(page, title);
  await page.click('#rc .rc-row[data-id="' + row.id + '"]');
  await waitSheet(page);
  return row;
}

async function keys(page, seq) {
  for (const k of seq.split(" ")) await page.click('#pad .key[data-k="' + k + '"]');
}

// The seed lines were rung up at SEEDED_AT; the phone is on Japan time.
const SEEDED_DAY = (() => {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", weekday: "short", month: "short", day: "numeric" }).formatToParts(new Date(SEEDED_AT));
  const v = (t) => f.find((x) => x.type === t).value;
  return v("weekday") + " " + v("month") + " " + v("day");
})();
const idOfSeed = (title) => SEED.expenses.find((e) => e.title === title).id;
// What the backend's own wording says about a line, as another phone would cause it.
const otherPhone = (backend, action, args, via = "app") => backend.handle({ key: "test-key", actor: "Ajen", via, action, args });

module.exports = [
  {
    name: "tapping a line shows its title, amount, payer and your share",
    async run({ page }) {
      await ready(page);
      assert.equal(await isOpen(page, "line"), false);
      await openLine(page, "Shibuya dinner");
      const { expenseShares } = await import("../../js/money.js");
      const { dollars } = await import("../../js/format.js");
      const e = SEED.expenses.find((x) => x.title === "Shibuya dinner");
      const mine = dollars(expenseShares({ ...e, deleted: false })["Mo"]);
      assert.equal(mine, "$43.55");
      await expectText(page, "#lnShare", "Your share " + mine);
      const body = await text(page, "#lineBody");
      assert.ok(body.includes("Shibuya dinner"), body);
      assert.ok(body.includes("¥14,500"), body);
      assert.ok(body.includes("Trenton paid"), body);
      assert.equal(SEEDED_DAY, "Fri Nov 20");
      await expectText(page, "#lnBy", "Rung up by Trenton, " + SEEDED_DAY);
      // Focus moves to the sheet (not the note field), which is a modal dialog.
      assert.equal(await page.evaluate(() => document.activeElement.id), "lnDone");
      assert.equal(await page.evaluate(() => [document.getElementById("line").getAttribute("role"), document.getElementById("line").getAttribute("aria-modal")].join()), "dialog,true");
      assert.ok(await visible(page, "#lnEdit"));
      assert.ok(await visible(page, "#lnDel"));
      assert.equal(await visible(page, "#lnRetry"), false, "no Try again on a saved line");
    },
  },
  {
    name: "a line you are not in says so, and its figures are legible Zen Kaku Gothic",
    async run({ page }) {
      await ready(page);
      await openLine(page, "Taxi back");
      await expectText(page, "#lnShare", "You’re not in this one.");
      await expectText(page, "#lnBy", "Rung up by Ajen, " + SEEDED_DAY);
      const fonts = await page.evaluate(() =>
        ["#lineBody .ln-t", "#lineBody .ln-a", "#lnLog span", "#lnShare"].map((s) => {
          const el = document.querySelector(s);
          return el ? getComputedStyle(el).fontFamily : "";
        }),
      );
      for (const f of fonts) assert.ok(!f.includes("DotGothic16"), "no DotGothic16 in the sheet: " + f);
      assert.equal(await page.evaluate(() => document.getElementById("line").scrollWidth <= document.getElementById("line").clientWidth), true, "no sideways scroll");
    },
  },
  {
    name: "history lists that line's changes newest first; an edit through the register adds a sentence; Claude's are marked",
    async run({ page }) {
      const backend = await ready(page);
      await openLine(page, "Shibuya dinner");
      const first = await waitSentences(page, (s) => s.length >= 1 && s[0] !== "…", "history arrives");
      assert.equal(first.length, 1, "only the line's own history: " + first);
      assert.match(first[0], /^Trenton rang up Shibuya dinner/);

      // Through the UI: Edit, change the amount, Save.
      await page.click("#lnEdit");
      await waitSheetClosed(page);
      await waitRegOpen(page);
      await expectText(page, "#regTitle", "Change this line");
      assert.equal(await page.inputValue("#xWhat"), "Shibuya dinner");
      await keys(page, "del del del del del 1 5 0 0 0");
      await expectText(page, "#xAmt", "¥15,000");
      await page.click("#kGo");
      await atRest(page, "#reg", { open: false, message: "the register closes after Save" });
      await waitRow(page, "Shibuya dinner", (r) => r.amt === "¥15,000", "has the new amount");
      await page.evaluate(() => globalThis.__matTest.store.idle());

      await openLine(page, "Shibuya dinner");
      const after = await waitSentences(page, (s) => s.length === 2, "the edit shows in the line's history");
      assert.equal(after[0], "Mo changed Shibuya dinner ¥14,500 → ¥15,000", "newest first");
      assert.match(after[1], /^Trenton rang up /);

      // A change made through Claude, seen from another phone, is marked as such.
      // Through the connector's own path (it writes as the owner; a phone's via claude is ignored since the security fix round).
      const lastEdit = Number(backend.fake.tables.Log.filter((r) => r.ref === idOfSeed("Shibuya dinner")).at(-1).id);
      const u = await backend.fake.claude("undo", { logId: lastEdit });
      assert.equal(u.ok, true, JSON.stringify(u));
      await page.evaluate(() => document.getElementById("fresh").click());
      await waitSentences(page, (s) => s[0] && s[0].endsWith("(through Claude)") && s[0].startsWith("Mo undid"), "the Claude sentence appears");
    },
  },
  {
    name: "history says it needs a connection when there is no signal",
    async run({ page }) {
      const backend = await ready(page);
      backend.failWith = "network";
      await openLine(page, "Shibuya dinner");
      await expectText(page, "#lnLog", "History needs a connection.");
      backend.failWith = null;
    },
  },
  {
    name: "any other history error says it could not load, not that there is no connection",
    async run({ page }) {
      const backend = await ready(page);
      backend.failWith = "server";
      await openLine(page, "Shibuya dinner");
      await expectText(page, "#lnLog", "Couldn’t load the history.");
      backend.failWith = null;
    },
  },
  {
    name: "a note saves from the sheet: row, backend and undo bar all show it; 200 characters is the limit",
    async run({ page }) {
      const backend = await ready(page);
      await openLine(page, "Shibuya dinner");
      assert.equal(await page.evaluate(() => document.getElementById("lnNoteSave").disabled), true, "nothing to save yet");
      await page.fill("#lnNote", "ref 22");
      assert.equal(await page.evaluate(() => document.getElementById("lnNoteSave").disabled), false);
      await page.click("#lnNoteSave");
      await expectText(page, "#ubarT", "Changed Shibuya dinner.");
      await until(() => page.evaluate(() => [...document.querySelectorAll("#rc .rc-note")].some((n) => n.textContent === "ref 22")), "the receipt row shows the note");
      await idle(page);
      assert.equal(savedTitled(backend, "Shibuya dinner")[0].note, "ref 22");
      assert.equal(await page.inputValue("#lnNote"), "ref 22", "the field keeps what was saved");
      assert.equal(await isOpen(page, "line"), true, "the sheet stays open");

      await page.fill("#lnNote", "");
      await page.focus("#lnNote");
      await page.keyboard.type("x".repeat(250));
      assert.equal((await page.inputValue("#lnNote")).length, 200, "maxlength 200");
    },
  },
  {
    name: "a note whose save failed stays in the field with Save enabled, and a second Save stores it",
    async run({ page }) {
      const backend = await ready(page);
      await openLine(page, "Shibuya dinner");
      backend.failWith = "network";
      await page.fill("#lnNote", "ref 22");
      await page.click("#lnNoteSave");
      await idle(page);
      await expectText(page, "#ubarT", "Couldn’t confirm that. Checking…");
      assert.equal(await page.inputValue("#lnNote"), "ref 22", "what was typed is still there");
      assert.equal(await page.evaluate(() => document.getElementById("lnNoteSave").disabled), false, "Save is enabled");
      assert.equal(savedTitled(backend, "Shibuya dinner")[0].note, "");
      backend.failWith = null;
      await page.click("#lnNoteSave");
      await idle(page);
      await until(() => savedTitled(backend, "Shibuya dinner")[0].note === "ref 22", "the second Save stores it");
      assert.equal(await page.inputValue("#lnNote"), "ref 22");
      assert.equal(await page.evaluate(() => document.getElementById("lnNoteSave").disabled), true, "nothing left to save");
    },
  },
  {
    name: "Edit closes the sheet and opens the register on that line",
    async run({ page }) {
      await ready(page);
      await openLine(page, "Taxi back");
      await page.click("#lnEdit");
      await waitSheetClosed(page);
      await waitRegOpen(page);
      await expectText(page, "#regTitle", "Change this line");
      assert.equal(await page.inputValue("#xWhat"), "Taxi back");
      await expectText(page, "#xAmt", "¥3,600");
      assert.equal(await page.evaluate(() => document.querySelector('#xSplit .seal[data-p="Mo"]').classList.contains("is-on")), false, "Mo is not in this one");
    },
  },
  {
    name: "Delete closes the sheet, shows Deleted with Undo, and Undo brings the row back in the same place",
    async run({ page }) {
      const backend = await ready(page);
      const before = await rowOf(page, "Shibuya dinner");
      await openLine(page, "Shibuya dinner");
      await page.click("#lnDel");
      await waitSheetClosed(page);
      await until(async () => !(await rowOf(page, "Shibuya dinner")), "the row is gone");
      await expectText(page, "#ubarT", "Deleted Shibuya dinner.");
      assert.ok(await visible(page, "#ubarU"));
      await idle(page);
      assert.equal(savedTitled(backend, "Shibuya dinner").length, 0, "deleted on the backend");
      assert.equal(saved(backend).filter((e) => e.title === "Shibuya dinner").length, 1, "but never erased");

      await advance(page, backend, 5000);
      await page.click("#ubarU");
      const back = await waitRow(page, "Shibuya dinner", () => true, "comes back");
      assert.equal(back.index, before.index, "same place");
      assert.equal(back.id, before.id);
      await idle(page);
      assert.equal(savedTitled(backend, "Shibuya dinner").length, 1);
    },
  },
  {
    name: "after 6 seconds the bar is gone and the line stays deleted",
    async run({ page }) {
      const backend = await ready(page);
      await openLine(page, "Shibuya dinner");
      await page.click("#lnDel");
      await expectText(page, "#ubarT", "Deleted Shibuya dinner.");
      await advance(page, backend, 6100);
      await until(async () => !(await visible(page, "#ubar")), "the bar goes");
      await idle(page);
      assert.equal(await rowOf(page, "Shibuya dinner"), null);
      assert.equal(savedTitled(backend, "Shibuya dinner").length, 0);
    },
  },
  {
    name: "Done, a tap on the backdrop and Escape each close the sheet",
    async run({ page }) {
      await ready(page);
      await openLine(page, "Shibuya dinner");
      const row = await rowOf(page, "Shibuya dinner");
      await page.click("#lnDone");
      await waitSheetClosed(page);
      assert.equal(await page.evaluate(() => document.getElementById("line").inert), true);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.id), row.id, "focus goes back to the row that opened it");

      await openLine(page, "Shibuya dinner");
      await page.mouse.click(195, 40); // above the sheet
      await waitSheetClosed(page);

      await openLine(page, "Shibuya dinner");
      await page.keyboard.press("Escape");
      await waitSheetClosed(page);
      assert.equal(await visible(page, "#lineScrim"), false, "the backdrop goes with it");
    },
  },
  {
    name: "a line that did not save opens the same sheet with Try again, which sends it once",
    async run({ page }) {
      const backend = await ready(page);
      backend.failWith = "bad_input";
      await page.click("#ring");
      await waitRegOpen(page);
      await page.fill("#xWhat", "Bento");
      await keys(page, "1 2 0 0");
      await page.click("#kGo");
      const row = await waitRow(page, "Bento", (r) => r.cls.includes("is-failed"), "failed");
      await page.click("#regDone");
      await page.click('.rc-row[data-id="' + row.id + '"]');
      await waitSheet(page);
      assert.ok(await visible(page, "#lnRetry"), "Try again shows");
      assert.equal(await text(page, "#lnRetry"), "Try again");
      assert.equal(await visible(page, "#lnEdit"), false, "an unsaved line cannot be edited");
      assert.equal(await visible(page, "#lnNote"), false, "or noted");
      await expectText(page, "#lnLog", "Not saved yet.");
      await expectText(page, "#lnShare", /^Your share \$\d+\.\d\d$/);

      backend.failWith = null;
      await page.click("#lnRetry");
      await waitSheetClosed(page);
      await waitRow(page, "Bento", (r) => !r.cls.includes("is-failed") && !r.cls.includes("is-pending"), "normal again");
      await idle(page);
      assert.equal(savedTitled(backend, "Bento").length, 1, "exactly one copy on the backend");
    },
  },
  {
    name: "Delete on a line that was refused drops it for good: nothing on the backend, and the bar says Undone.",
    async run({ page }) {
      const backend = await ready(page);
      backend.failWith = "bad_input";
      await page.click("#ring");
      await waitRegOpen(page);
      await page.fill("#xWhat", "Bento");
      await keys(page, "1 2 0 0");
      await page.click("#kGo");
      const row = await waitRow(page, "Bento", (r) => r.cls.includes("is-failed"), "failed");
      await page.click("#regDone");
      await page.click('.rc-row[data-id="' + row.id + '"]');
      await waitSheet(page);
      await page.click("#lnDel");
      await waitSheetClosed(page);
      await until(async () => !(await rowOf(page, "Bento")), "the row is gone");
      await expectText(page, "#ubarT", "Undone.");
      assert.equal(await visible(page, "#ubarU"), false, "no Undo button for a line that is gone");
      backend.failWith = null;
      await idle(page);
      assert.equal(saved(backend).filter((e) => e.title === "Bento").length, 0, "never reached the backend");
      assert.equal(await page.evaluate(() => globalThis.__matTest.store.state.expenses.filter((e) => e.title === "Bento").length), 0);
    },
  },
  {
    name: "Delete on a line still waiting for signal drops it; it is not sent when signal returns",
    async run({ page }) {
      const backend = await ready(page);
      backend.failWith = "network";
      await page.click("#ring");
      await waitRegOpen(page);
      await page.fill("#xWhat", "Ferry");
      await keys(page, "9 0 0");
      await page.click("#kGo");
      const row = await waitRow(page, "Ferry", (r) => r.cls.includes("is-pending"), "pending");
      await page.click("#regDone");
      await page.click('.rc-row[data-id="' + row.id + '"]');
      await waitSheet(page);
      assert.equal(await visible(page, "#lnEdit"), false);
      assert.equal(await visible(page, "#lnRetry"), false, "pending, not failed: nothing to retry");
      await page.click("#lnDel");
      await waitSheetClosed(page);
      await until(async () => !(await rowOf(page, "Ferry")), "the row is gone");
      backend.failWith = null;
      await page.evaluate(() => document.getElementById("fresh").click());
      await idle(page);
      assert.equal(savedTitled(backend, "Ferry").length, 0, "not on the backend");
      assert.equal(await rowOf(page, "Ferry"), null);
    },
  },
  {
    name: "the sheet closes itself when its line is deleted on another phone and then synced",
    async run({ page }) {
      const backend = await ready(page);
      await openLine(page, "Taxi back");
      await otherPhone(backend, "deleteExpense", { id: idOfSeed("Taxi back") });
      assert.equal(await isOpen(page, "line"), true, "nothing changes until a sync");
      await page.evaluate(() => document.getElementById("fresh").click());
      await waitSheetClosed(page);
      await until(async () => !(await rowOf(page, "Taxi back")), "the row is gone");
    },
  },
  {
    name: "only one overlay at a time: the line sheet and the register close each other",
    async run({ page }) {
      await ready(page);
      await openLine(page, "Shibuya dinner");
      await page.evaluate(() => document.getElementById("ring").click());
      await waitRegOpen(page);
      await waitSheetClosed(page);

      const row = await rowOf(page, "Taxi back");
      await page.evaluate((id) => document.querySelector('#rc .rc-row[data-id="' + id + '"]').click(), row.id);
      await waitSheet(page);
      await atRest(page, "#reg", { open: false, message: "the register closes" });
      await expectText(page, "#lineBody .ln-t", "Taxi back");
    },
  },
  {
    name: "the undo bar sits at the top while the sheet is open, clear of its buttons",
    async run({ page }) {
      await ready(page);
      await openLine(page, "Shibuya dinner");
      await page.fill("#lnNote", "ref 22");
      await page.click("#lnNoteSave");
      await expectText(page, "#ubarT", "Changed Shibuya dinner.");
      const rects = await page.evaluate(() => {
        const bar = document.getElementById("ubar").getBoundingClientRect();
        const del = document.getElementById("lnDel").getBoundingClientRect();
        return { barBottom: bar.bottom, delTop: del.top };
      });
      assert.ok(rects.barBottom <= rects.delTop, "the bar does not cover Delete: " + JSON.stringify(rects));
    },
  },
];
