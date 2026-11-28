// The register, the uneven split panel and the undo bar (Task 8).

const assert = require("node:assert/strict");
const P = require("../../backend/Pure.js");
const { SEED, NOON12, open, advance, until, atRest, text, expectText, visible } = require("./helpers.cjs");

// ---- small tools for this file ----

const isOpen = (page) => page.evaluate(() => document.getElementById("reg").classList.contains("is-open"));
// Open, and risen all the way (the sheet slides up over 500 ms).
const waitOpen = (page) => atRest(page, "#reg", { message: "the register opens" });
const waitClosed = (page) => atRest(page, "#reg", { open: false, message: "the register closes" });
const rowCount = (page) => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length);
const waitRows = (page, n) => until(async () => (await rowCount(page)) === n, "expected " + n + " receipt rows");
// What the backend holds, as the app would read it back.
const saved = (backend) => backend.fake.primitives.readTable_("Expenses").map(P.expenseFromRow);
const savedTitled = (backend, title) => saved(backend).filter((e) => e.title === title && !e.deleted);
const adds = (backend) => backend.requests.filter((r) => r.action === "addExpense");
// Everything the store has started has settled.
const idle = (page) => page.evaluate(() => globalThis.__matTest.store.idle());

async function keys(page, seq) {
  for (const k of seq.split(" ")) await page.click('#pad .key[data-k="' + k + '"]');
}
const seal = (group, name) => "#" + group + ' .seal[data-p="' + name + '"]';
const isOn = (page, sel) => page.evaluate((s) => document.querySelector(s).classList.contains("is-on"), sel);
const disabled = (page, sel) => page.evaluate((s) => document.querySelector(s).disabled, sel);
const waitGo = (page, enabled) => until(async () => (await disabled(page, "#kGo")) === !enabled, "#kGo " + (enabled ? "enabled" : "disabled"));

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: SEED, nowMs: NOON12, ...opts });
  await waitRows(page, 8);
  return backend;
}

async function ringOpen(page) {
  await page.click("#ring");
  await waitOpen(page);
}

// The register opens in dollars; this switches the entry in hand to yen.
async function ringOpenYen(page) {
  await ringOpen(page);
  await page.click("#kCur");
  await expectText(page, "#xAmt", "¥0");
}

// Types a line in and rings it up.
async function ringUp(page, { title, chip, seq }) {
  if (chip) await page.click('#xQuick .chip[data-q="' + chip + '"]');
  if (title !== undefined) await page.fill("#xWhat", title);
  await keys(page, seq);
  await waitGo(page, true);
  await page.click("#kGo");
}

const rowOf = (page, title) =>
  page.evaluate((t) => {
    const r = [...document.querySelectorAll("#rc .rc-row[data-id]")].find((x) => x.querySelector(".rc-t").firstChild.textContent === t);
    return r ? { id: r.dataset.id, day: r.closest(".rc-group").dataset.day, amt: r.querySelector(".rc-amt").textContent, cls: r.className, text: r.textContent, opacity: getComputedStyle(r).opacity } : null;
  }, title);
const waitRow = (page, title, check = () => true, what = "") =>
  until(async () => {
    const r = await rowOf(page, title);
    return r && check(r) ? r : null;
  }, "row " + title + " " + what);

module.exports = [
  {
    name: "ring up opens on today, you paying, all three sharing",
    async run({ page }) {
      await ready(page);
      assert.equal(await isOpen(page), false);
      await ringOpen(page);
      await expectText(page, "#regTitle", "Ring up");
      await expectText(page, "#xDay", "Sat 12");
      await expectText(page, "#xAmt", "$0");
      await expectText(page, "#kCur", "$ → ¥");
      assert.equal(await isOn(page, seal("xPayer", "Mo")), true, "Mo paid");
      assert.equal(await isOn(page, seal("xPayer", "Ajen")), false);
      for (const n of ["Mo", "Ajen", "Trenton"]) assert.equal(await isOn(page, seal("xSplit", n)), true, n + " shares");
      assert.equal(await disabled(page, "#kGo"), true);
      assert.deepEqual(
        await page.$$eval("#xQuick .chip", (els) => els.map((e) => e.dataset.q)),
        ["Dinner", "Lunch", "Coffee", "Drinks", "Groceries", "Train", "Taxi", "Flight", "Stay", "Tickets", "Onsen", "Shopping"],
      );
    },
  },
  {
    name: "keys and a chip ring up a line; the register resets; the undo bar undoes it",
    async run({ page }) {
      const backend = await ready(page);
      await ringOpenYen(page);
      await keys(page, "1 4 5 00");
      await page.click('#xQuick .chip[data-q="Dinner"]');
      await expectText(page, "#xAmt", "¥14,500");
      const conv = await text(page, "#xConv");
      assert.ok(conv.includes("÷3") && conv.includes("≈ $"), "conversion: " + conv);
      await waitGo(page, true);

      const printed = await page.evaluate(() => {
        document.getElementById("kGo").click();
        const r = [...document.querySelectorAll("#rc .rc-row[data-id]")].find((x) => x.querySelector(".rc-t").firstChild.textContent === "Dinner");
        return !!r && r.classList.contains("print");
      });
      assert.equal(printed, true, "the new line prints (class print) as soon as it is rung up");
      const row = await waitRow(page, "Dinner");
      assert.equal(row.day, "2026-12-12");
      assert.equal(row.amt, "¥14,500");
      assert.equal(await isOpen(page), true, "the register stays open");
      await expectText(page, "#xAmt", "$0");
      await expectText(page, "#kCur", "$ → ¥");
      assert.equal(await page.inputValue("#xWhat"), "");
      assert.equal(await isOn(page, seal("xPayer", "Mo")), true, "Mo is still the payer");
      await expectText(page, "#xDay", "Sat 12");
      const stored = await until(() => savedTitled(backend, "Dinner")[0], "the backend has Dinner");
      assert.equal(stored.kind, "food");
      assert.equal(stored.amount, 14500);
      assert.equal(stored.currency, "JPY");

      // The newest line sits above the register.
      await until(
        () => page.evaluate(() => {
          const rows = document.querySelectorAll("#rc .rc-row");
          const last = [...rows].find((r) => r.querySelector(".rc-t").firstChild.textContent === "Dinner");
          return last.getBoundingClientRect().bottom <= document.getElementById("reg").getBoundingClientRect().top;
        }),
        "the new line's bottom edge is above the register's top edge",
      );

      // The undo bar.
      await expectText(page, "#ubarT", "Rang up Dinner ¥14,500.");
      assert.ok(await visible(page, "#ubar"));
      assert.ok(await visible(page, "#ubarU"));
      await page.click("#ubarU");
      await until(async () => !(await rowOf(page, "Dinner")), "undo removes the row");
      await expectText(page, "#ubarT", "Undone.");
      assert.equal(await visible(page, "#ubarU"), false, "no Undo on Undone.");
      await idle(page);
      assert.equal(savedTitled(backend, "Dinner").length, 0, "undone on the backend too");

      // Left alone, the bar goes after 6 seconds.
      await page.click("#kCur");
      await ringUp(page, { chip: "Lunch", seq: "9 0 0" });
      await expectText(page, "#ubarT", "Rang up Lunch ¥900.");
      await advance(page, backend, 5900);
      assert.ok(await visible(page, "#ubar"), "still there at 5.9 s");
      await advance(page, backend, 100);
      await until(async () => !(await visible(page, "#ubar")), "the bar hides after 6 s");
    },
  },
  {
    name: "the bar: a newer change restarts the 6 seconds, and a notice shows once",
    async run({ page }) {
      const backend = await ready(page);
      await ringOpenYen(page);
      await ringUp(page, { chip: "Lunch", seq: "9 0 0" });
      await expectText(page, "#ubarT", "Rang up Lunch ¥900.");
      await advance(page, backend, 4000);
      await page.click("#kCur");
      await ringUp(page, { chip: "Coffee", seq: "4 5 0" });
      await expectText(page, "#ubarT", "Rang up Coffee ¥450.");
      await advance(page, backend, 4000);
      assert.ok(await visible(page, "#ubar"), "the newer change has its own 6 seconds");
      await advance(page, backend, 2000);
      await until(async () => !(await visible(page, "#ubar")), "hidden 6 s after the newer change");

      await page.evaluate(() => globalThis.__matTest.store.notify("Link copied."));
      await expectText(page, "#ubarT", "Link copied.");
      assert.equal(await visible(page, "#ubarU"), false, "a notice has no Undo");
      assert.equal(await page.evaluate(() => globalThis.__matTest.store.state.notice), null, "the notice is cleared once shown");
      await advance(page, backend, 6000);
      await until(async () => !(await visible(page, "#ubar")), "the notice goes after 6 s");
    },
  },
  {
    name: "a kind comes only from a chip whose label still stands",
    async run({ page }) {
      const backend = await ready(page);
      await ringOpen(page);
      await ringUp(page, { title: "Ferry", seq: "2 0 0" });
      const ferry = await until(() => savedTitled(backend, "Ferry")[0], "Ferry saved");
      assert.equal(ferry.kind, "");

      await page.click('#xQuick .chip[data-q="Taxi"]');
      assert.equal(await page.inputValue("#xWhat"), "Taxi");
      assert.equal(await isOn(page, '#xQuick .chip[data-q="Taxi"]'), true);
      await page.fill("#xWhat", "Taxi to port");
      assert.equal(await isOn(page, '#xQuick .chip[data-q="Taxi"]'), false);
      await ringUp(page, { seq: "3 0 0" });
      const taxi = await until(() => savedTitled(backend, "Taxi to port")[0], "Taxi to port saved");
      assert.equal(taxi.kind, "");

      await ringUp(page, { chip: "Onsen", seq: "1 5 0" });
      assert.equal((await until(() => savedTitled(backend, "Onsen")[0], "Onsen saved")).kind, "activity");
      assert.equal(await page.getAttribute("#xWhat", "maxlength"), "80");
    },
  },
  {
    name: "a double tap on Ring it up makes one line",
    async run({ page }) {
      const backend = await ready(page);
      await ringOpen(page);
      await page.click('#xQuick .chip[data-q="Drinks"]');
      await keys(page, "3 2 0");
      await waitGo(page, true);
      await page.dblclick("#kGo");
      await waitRow(page, "Drinks");
      await idle(page);
      assert.equal(savedTitled(backend, "Drinks").length, 1, "one row on the backend");
      assert.equal(adds(backend).length, 1, "one addExpense request");
      assert.equal(await page.locator("#rc .rc-row", { hasText: "Drinks" }).count(), 1, "one row on the receipt");

      // Two clicks in the same task: the second finds the key disabled.
      await page.click('#xQuick .chip[data-q="Groceries"]');
      await keys(page, "5 0");
      await waitGo(page, true);
      await page.evaluate(() => {
        const go = document.getElementById("kGo");
        go.click();
        go.click();
      });
      await waitRow(page, "Groceries");
      await idle(page);
      assert.equal(adds(backend).length, 2, "two adds in all");
      assert.equal(savedTitled(backend, "Groceries").length, 1);
    },
  },
  {
    name: "dollars: two decimals at most",
    async run({ page }) {
      const backend = await ready(page);
      await ringOpen(page);
      await expectText(page, "#xAmt", "$0");
      await keys(page, "1 2 . 5 0");
      await expectText(page, "#xAmt", "$12.50");
      await keys(page, "7");
      await expectText(page, "#xAmt", "$12.50");
      await keys(page, "del");
      await expectText(page, "#xAmt", "$12.5");
      await keys(page, "00");
      await expectText(page, "#xAmt", "$12.50", undefined);
      const conv = await text(page, "#xConv");
      assert.ok(conv.includes("÷3") && conv.includes("≈ ¥1,388"), "conversion: " + conv);
      await page.fill("#xWhat", "Bus");
      await page.click("#kGo");
      const row = await waitRow(page, "Bus");
      assert.equal(row.amt, "$12.50");
      const bus = await until(() => savedTitled(backend, "Bus")[0], "Bus saved");
      assert.deepEqual([bus.amount, bus.currency], [12.5, "CAD"]);

      await page.click("#regDone");
      await waitClosed(page);
      await ringOpen(page);
      await expectText(page, "#xAmt", "$0");
      await expectText(page, "#kCur", "$ → ¥");

      await page.reload();
      await waitRows(page, 9);
      await ringOpen(page);
      await expectText(page, "#xAmt", "$0");
      await expectText(page, "#kCur", "$ → ¥");
      await page.click("#kCur");
      await expectText(page, "#xAmt", "¥0");
    },
  },
  {
    name: "a new expense always opens in dollars; an old mat.cur is cleared; editing keeps the line's own currency",
    async run({ page }) {
      const backend = await open(page, { seed: SEED, nowMs: NOON12, storage: { "mat.cur": "JPY" } });
      await waitRows(page, 8);
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.cur")), null, "the old memory is gone");
      await ringOpen(page);
      await expectText(page, "#xAmt", "$0");
      await expectText(page, "#kCur", "$ → ¥");
      await ringUp(page, { title: "Tea", seq: "1 2 . 3 4" });
      const tea = await waitRow(page, "Tea");
      assert.equal(tea.amt, "$12.34");
      assert.equal((await until(() => savedTitled(backend, "Tea")[0], "Tea saved")).currency, "CAD");
      await page.click("#regDone");
      await waitClosed(page);
      await ringOpen(page);
      await expectText(page, "#xAmt", "$0");
      await page.click("#kCur");
      await ringUp(page, { title: "Noodles", seq: "5 0 0" });
      await waitRow(page, "Noodles");
      await page.click("#regDone");
      await waitClosed(page);
      await ringOpen(page);
      await expectText(page, "#xAmt", "$0");
      await expectText(page, "#kCur", "$ → ¥");
      await page.click("#regDone");
      await waitClosed(page);
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.cur")), null, "the key never writes it");
      const noodles = await until(() => savedTitled(backend, "Noodles")[0], "Noodles saved");
      await page.evaluate((id) => globalThis.__matTest.register.edit(id), noodles.id);
      await waitOpen(page);
      await expectText(page, "#xAmt", "¥500");
      await expectText(page, "#kCur", "¥ → $");
    },
  },
  {
    name: "after ringing up in yen with the keypad open, the next entry is in dollars",
    async run({ page }) {
      const backend = await ready(page);
      await ringOpenYen(page);
      await ringUp(page, { title: "Ramen", seq: "5 0 0" });
      await waitRow(page, "Ramen");
      assert.equal(await isOpen(page), true);
      await expectText(page, "#xAmt", "$0");
      await expectText(page, "#kCur", "$ → ¥");
      await ringUp(page, { title: "Cab", seq: "1 2 . 3 4" });
      await waitRow(page, "Cab");
      const cab = await until(() => savedTitled(backend, "Cab")[0], "Cab saved");
      assert.deepEqual([cab.amount, cab.currency], [12.34, "CAD"]);
    },
  },
  {
    name: "a half-typed entry keeps its currency when put away; an entry with no amount reopens in dollars",
    async run({ page }) {
      await ready(page);
      await ringOpenYen(page);
      await keys(page, "5 0 0");
      await page.click("#regDone");
      await waitClosed(page);
      await ringOpen(page);
      await expectText(page, "#xAmt", "¥500");
      await expectText(page, "#kCur", "¥ → $");
      await keys(page, "del del del");
      await page.fill("#xWhat", "Snack");
      await page.click("#regDone");
      await waitClosed(page);
      await ringOpen(page);
      await expectText(page, "#xAmt", "$0");
      await expectText(page, "#kCur", "$ → ¥");
    },
  },
  {
    name: "the day steps back to Before the trip",
    async run({ page }) {
      const backend = await ready(page);
      await ringOpen(page);
      await page.click("#dPrev");
      await expectText(page, "#xDay", "Fri 11");
      await page.click("#dPrev");
      await expectText(page, "#xDay", "Thu 10");
      await ringUp(page, { title: "Locker", seq: "7 0" });
      const row = await waitRow(page, "Locker");
      assert.equal(row.day, "2026-12-10");
      assert.equal((await until(() => savedTitled(backend, "Locker")[0], "Locker saved")).day, "2026-12-10");
      await expectText(page, "#xDay", "Thu 10", undefined);
      await page.click("#dPrev");
      await expectText(page, "#xDay", "Before");
      assert.equal(await disabled(page, "#dPrev"), true, "nothing before Before");
      await page.click("#dNext");
      await expectText(page, "#xDay", "Thu 10");
    },
  },
  {
    name: "split seals: one off is ÷2, the last stays on",
    async run({ page }) {
      await ready(page);
      await ringOpen(page);
      await keys(page, "3 0 0 0");
      assert.ok((await text(page, "#xConv")).includes("÷3"));
      await page.click(seal("xSplit", "Ajen"));
      await until(async () => (await text(page, "#xConv")).includes("÷2"), "÷2");
      assert.equal(await isOn(page, seal("xSplit", "Ajen")), false);
      await page.click(seal("xSplit", "Trenton"));
      await until(async () => (await text(page, "#xConv")).includes("÷1"), "÷1");
      await page.click(seal("xSplit", "Mo"));
      assert.equal(await isOn(page, seal("xSplit", "Mo")), true, "the last seal cannot be turned off");
      await page.click(seal("xSplit", "Ajen"));
      await until(async () => (await text(page, "#xConv")).includes("÷2"), "back to ÷2");

      // A person who is out of the split has no row in the panel.
      await page.click("#xUneven");
      await until(() => visible(page, "#un"), "#un opens");
      assert.deepEqual(await page.$$eval("#un .un-row", (els) => els.map((e) => e.dataset.p)), ["Mo", "Ajen"]);
      await page.click(seal("xSplit", "Trenton"));
      await until(async () => (await page.locator("#un .un-row").count()) === 3, "Trenton's row comes back");
    },
  },
  {
    name: "parts: 2, 3, 3 of $80.00",
    async run({ page }) {
      const backend = await ready(page);
      await ringOpen(page);
      await keys(page, "8 0 . 0 0");
      await page.fill("#xWhat", "Karaoke");
      await page.click("#xUneven");
      await until(() => visible(page, "#un"), "#un opens");
      assert.equal(await isOn(page, '#unMode [data-mode="parts"]'), true, "parts mode first");
      assert.deepEqual(await page.$$eval("#un .un-val", (els) => els.map((e) => e.textContent)), ["1", "1", "1"]);

      // Cannot go below 1: the minus is disabled, and even a click that gets
      // through to the handler leaves 1.
      const minus = page.locator('#un .un-row[data-p="Mo"] .un-minus');
      assert.equal(await minus.evaluate((b) => b.disabled), true);
      await minus.evaluate((b) => {
        b.disabled = false;
        b.click();
      });
      await expectText(page, '#un .un-row[data-p="Mo"] .un-val', "1");
      assert.equal(await minus.evaluate((b) => b.disabled), true, "drawn disabled again");

      await page.click('#un .un-row[data-p="Mo"] .un-plus');
      for (const n of ["Ajen", "Trenton"]) {
        await page.click('#un .un-row[data-p="' + n + '"] .un-plus');
        await page.click('#un .un-row[data-p="' + n + '"] .un-plus');
      }
      assert.deepEqual(await page.$$eval("#un .un-val", (els) => els.map((e) => e.textContent)), ["2", "3", "3"]);
      assert.deepEqual(await page.$$eval("#un .un-amt", (els) => els.map((e) => e.textContent)), ["$20.00", "$30.00", "$30.00"]);
      await expectText(page, "#unLeft", "");

      await page.click("#unDone");
      await until(async () => !(await visible(page, "#un")), "#un closes");
      await expectText(page, "#xConv", "uneven");
      assert.equal(await isOn(page, "#xUneven"), true);
      await page.click("#kGo");
      await waitRow(page, "Karaoke");
      const k = await until(() => savedTitled(backend, "Karaoke")[0], "Karaoke saved");
      assert.equal(k.splitMode, "parts");
      assert.deepEqual(k.splitVals, [2, 3, 3]);
      // Uneven settings reset after ringing up.
      await expectText(page, "#xConv", "");
      assert.equal(await isOn(page, "#xUneven"), false);
    },
  },
  {
    name: "parts stop at 99",
    async run({ page }) {
      await ready(page);
      await ringOpen(page);
      await keys(page, "9 9 0 0");
      await page.click("#xUneven");
      await until(() => visible(page, "#un"), "#un opens");
      const plus = page.locator('#un .un-row[data-p="Ajen"] .un-plus');
      for (let i = 0; i < 100; i++) await plus.evaluate((b) => b.click());
      await expectText(page, '#un .un-row[data-p="Ajen"] .un-val', "99");
      assert.equal(await plus.evaluate((b) => b.disabled), true);
    },
  },
  {
    name: "exact amounts: what is left to assign, and no ringing up until it is zero",
    async run({ page }) {
      const backend = await ready(page);
      await ringOpen(page);
      await keys(page, "8 0 . 0 0");
      await page.fill("#xWhat", "Hotel bar");
      await page.click("#xUneven");
      await page.click('#unMode [data-mode="exact"]');
      assert.deepEqual(await page.$$eval("#un .un-val", (els) => els.map((e) => e.tagName)), ["INPUT", "INPUT", "INPUT"]);
      assert.deepEqual(await page.$$eval("#un .un-val", (els) => els.map((e) => e.inputMode)), ["decimal", "decimal", "decimal"]);
      await page.fill('#un .un-row[data-p="Mo"] .un-val', "50");
      await page.fill('#un .un-row[data-p="Ajen"] .un-val', "20");
      await expectText(page, "#unLeft", "$10.00 left to assign");
      await waitGo(page, false);
      await page.fill('#un .un-row[data-p="Trenton"] .un-val', "10");
      await expectText(page, "#unLeft", "");
      await waitGo(page, true);
      await expectText(page, "#unDone", "Set split");
      await page.click("#unDone");
      await page.click("#kGo");
      await waitRow(page, "Hotel bar");
      const h = await until(() => savedTitled(backend, "Hotel bar")[0], "saved");
      assert.equal(h.splitMode, "exact");
      assert.deepEqual(h.splitVals, [50, 20, 10]);
      assert.equal(h.amount, 80);
    },
  },
  {
    name: "exact amounts: a new amount or a seal turned off shows the gap again",
    async run({ page }) {
      const backend = await ready(page);
      await ringOpen(page);
      await keys(page, "8 0 . 0 0");
      await page.fill("#xWhat", "Hotel bar");
      await page.click("#xUneven");
      await page.click('#unMode [data-mode="exact"]');
      await page.fill('#un .un-row[data-p="Mo"] .un-val', "50");
      await page.fill('#un .un-row[data-p="Ajen"] .un-val', "20");
      await page.fill('#un .un-row[data-p="Trenton"] .un-val', "10");
      await waitGo(page, true);

      // Changing the amount brings the gap back, with the panel closed or not.
      await page.click("#unDone");
      await until(async () => !(await visible(page, "#un")), "#un closes");
      await keys(page, "del");
      await expectText(page, "#xAmt", "$80.0");
      await waitGo(page, true);
      await keys(page, "del del del del 9 0");
      await expectText(page, "#xAmt", "$90");
      await until(() => visible(page, "#unLeft"), "the panel reopens on what is left");
      await expectText(page, "#unLeft", "$10.00 left to assign");
      await waitGo(page, false);
      await page.fill('#un .un-row[data-p="Trenton"] .un-val', "20");
      await expectText(page, "#unLeft", "");
      await waitGo(page, true);

      // Turning someone off with the panel closed reopens it on the gap.
      await page.click("#unDone");
      await until(async () => !(await visible(page, "#un")), "#un closes");
      await page.click(seal("xSplit", "Trenton"));
      await until(() => visible(page, "#unLeft"), "the panel reopens after a seal is turned off");
      await expectText(page, "#unLeft", "$20.00 left to assign");
      await waitGo(page, false);
      await page.fill('#un .un-row[data-p="Ajen"] .un-val', "40");
      await waitGo(page, true);
      await page.click("#kGo");
      const h = await until(() => savedTitled(backend, "Hotel bar")[0], "saved");
      assert.deepEqual([h.amount, h.split, h.splitVals], [90, ["Mo", "Ajen"], [50, 40]]);
    },
  },
  {
    name: "exact amounts in yen are whole yen",
    async run({ page }) {
      const backend = await ready(page);
      await ringOpenYen(page);
      await keys(page, "8 0 0 0");
      await page.fill("#xWhat", "Okonomiyaki");
      await page.click("#xUneven");
      await page.click('#unMode [data-mode="exact"]');
      assert.equal(await page.locator("#un .un-val").first().evaluate((e) => e.inputMode), "numeric");
      await page.fill('#un .un-row[data-p="Mo"] .un-val', "5000.5");
      assert.equal(await page.inputValue('#un .un-row[data-p="Mo"] .un-val'), "50005", "no point in yen");
      await page.fill('#un .un-row[data-p="Mo"] .un-val', "5000");
      await page.fill('#un .un-row[data-p="Ajen"] .un-val', "2000");
      await page.fill('#un .un-row[data-p="Trenton"] .un-val', "1000");
      await expectText(page, "#unLeft", "");
      await waitGo(page, true);
      await page.click("#kGo");
      const o = await until(() => savedTitled(backend, "Okonomiyaki")[0], "saved");
      assert.deepEqual([o.splitMode, o.splitVals], ["exact", [5000, 2000, 1000]]);
    },
  },
  {
    name: "holding the split seals opens the panel",
    async run({ page }) {
      const backend = await ready(page);
      await ringOpen(page);
      const box = await page.locator(seal("xSplit", "Ajen")).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await advance(page, backend, 500);
      await page.mouse.up();
      await until(() => visible(page, "#un"), "#un opens after a 500 ms hold");
      assert.equal(await isOn(page, seal("xSplit", "Ajen")), true, "the hold did not turn Ajen off");
    },
  },
  {
    name: "edit mode changes a line, and the bar undoes the change",
    async run({ page }) {
      await ready(page);
      const sayBefore = await text(page, "#say");
      await page.evaluate(() => globalThis.__matTest.register.edit("seedexp006"));
      await waitOpen(page);
      await expectText(page, "#regTitle", "Change this line");
      await expectText(page, "#kGo", "Save");
      assert.equal(await page.inputValue("#xWhat"), "Shibuya dinner");
      await expectText(page, "#xAmt", "¥14,500");
      await expectText(page, "#kCur", "¥ → $");
      await expectText(page, "#xDay", "Fri 11");
      assert.equal(await isOn(page, seal("xPayer", "Trenton")), true);
      assert.equal(await isOn(page, seal("xPayer", "Mo")), false);
      for (const n of ["Mo", "Ajen", "Trenton"]) assert.equal(await isOn(page, seal("xSplit", n)), true);

      await keys(page, "del del del del del 1 5 0 0 0");
      await expectText(page, "#xAmt", "¥15,000");
      await page.click("#kGo");
      await waitClosed(page);
      await expectText(page, '.rc-row[data-id="seedexp006"] .rc-amt', "¥15,000");
      await until(async () => (await text(page, "#say")) !== sayBefore, "#say changes");
      await expectText(page, "#ubarT", "Changed Shibuya dinner.");
      await page.click("#ubarU");
      await expectText(page, '.rc-row[data-id="seedexp006"] .rc-amt', "¥14,500");
      await expectText(page, "#say", sayBefore);

      // After an edit the register opens fresh again.
      await ringOpen(page);
      await expectText(page, "#regTitle", "Ring up");
      await expectText(page, "#xAmt", "$0");
      assert.equal(await page.inputValue("#xWhat"), "");
      await expectText(page, "#xDay", "Sat 12");
      assert.equal(await isOn(page, seal("xPayer", "Mo")), true);
    },
  },
  {
    name: "editing only the amount leaves a split stored in another order alone",
    async run({ page }) {
      const seed = JSON.parse(JSON.stringify(SEED));
      seed.expenses.push({
        id: "seedexp011", day: "2026-12-11", title: "Izakaya", amount: 9000, currency: "JPY", rate: 111, paidBy: "Ajen",
        split: ["Trenton", "Mo", "Ajen"], splitMode: "parts", splitVals: [1, 2, 3], note: "", kind: "", addedBy: "Ajen", deleted: false,
      });
      const backend = await open(page, { seed, nowMs: NOON12 });
      await waitRows(page, 9);
      await page.evaluate(() => globalThis.__matTest.register.edit("seedexp011"));
      await waitOpen(page);
      await expectText(page, "#xConv", "uneven");
      await keys(page, "del del del del 1 2 0 0 0");
      await expectText(page, "#xAmt", "¥12,000");
      await page.click("#kGo");
      await waitClosed(page);
      await idle(page);
      const sent = backend.requests.filter((r) => r.action === "updateExpense");
      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0].args.patch, { amount: 12000 }, "only the amount is sent");
      const e = saved(backend).find((x) => x.id === "seedexp011");
      assert.deepEqual([e.amount, e.split, e.splitMode, e.splitVals], [12000, ["Trenton", "Mo", "Ajen"], "parts", [1, 2, 3]]);
      const log = backend.fake.primitives.readTable_("Log");
      assert.equal(log[log.length - 1].summary, "changed Izakaya ¥9,000 → ¥12,000");
    },
  },
  {
    name: "an empty day's button opens the register on that day; Done closes it",
    async run({ page }) {
      await ready(page);
      await page.click('[data-addday="2026-12-12"]');
      await waitOpen(page);
      await expectText(page, "#xDay", "Sat 12");
      assert.ok(await page.evaluate(() => document.getElementById("phone").classList.contains("reg-open")));
      await page.click("#regDone");
      await waitClosed(page);
      assert.equal(await page.evaluate(() => document.getElementById("reg").inert), true, "a closed register cannot be reached");
      assert.equal(await page.evaluate(() => document.getElementById("vMoney").style.paddingBottom), "", "the padding goes back");
    },
  },
  {
    name: "no signal: the line waits, dimmed, and goes once contact returns",
    async run({ page }) {
      const backend = await ready(page);
      backend.failWith = "network";
      await ringOpen(page);
      await ringUp(page, { title: "Ferry", seq: "2 0 0" });
      const row = await waitRow(page, "Ferry", (r) => r.cls.includes("is-pending") && r.text.includes("will send when signal returns"), "pending");
      assert.ok(Number(row.opacity) < 1, "drawn at reduced opacity: " + row.opacity);
      assert.equal(savedTitled(backend, "Ferry").length, 0);

      backend.failWith = null;
      await page.click("#regDone");
      await waitClosed(page);
      await page.click("#fresh");
      await waitRow(page, "Ferry", (r) => !r.cls.includes("is-pending") && !r.text.includes("will send"), "sent");
      await idle(page);
      assert.equal(savedTitled(backend, "Ferry").length, 1, "exactly one copy on the backend");
    },
  },
  {
    name: "a refused line says so, and a tap resends it once",
    async run({ page }) {
      const backend = await ready(page);
      backend.failWith = "bad_input";
      await ringOpen(page);
      await ringUp(page, { title: "Bento", seq: "1 2 0" });
      const row = await waitRow(page, "Bento", (r) => r.cls.includes("is-failed"), "failed");
      assert.ok(row.text.includes("not saved, tap to retry"));
      assert.equal(savedTitled(backend, "Bento").length, 0);

      backend.failWith = null;
      await page.click("#regDone");
      await waitClosed(page);
      await page.click('.rc-row[data-id="' + row.id + '"]'); // opens the line sheet (Task 9)
      await page.click("#lnRetry");
      await waitRow(page, "Bento", (r) => !r.cls.includes("is-failed") && !r.cls.includes("is-pending"), "normal again");
      await idle(page);
      assert.equal(savedTitled(backend, "Bento").length, 1, "exactly one copy on the backend");
    },
  },
  {
    name: "the keypad cannot zoom or select, and no field makes Safari zoom",
    async run({ page }) {
      await ready(page);
      await ringOpen(page);
      const keyStyle = await page.$$eval("#pad .key", (els) => els.map((e) => [getComputedStyle(e).touchAction, getComputedStyle(e).userSelect]));
      for (const [touch, select] of keyStyle) assert.deepEqual([touch, select], ["manipulation", "none"]);
      for (const sel of ["#xQuick .chip", "#xSplit .seal", "#xPayer .seal"]) {
        assert.equal(await page.locator(sel).first().evaluate((e) => getComputedStyle(e).touchAction), "manipulation", sel);
      }
      assert.ok(await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("xWhat")).fontSize) >= 16));
      await keys(page, "1 0 0 0");
      await page.click("#xUneven");
      await page.click('#unMode [data-mode="exact"]');
      const sizes = await page.$$eval("#un .un-val", (els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
      assert.ok(sizes.every((s) => s >= 16), "exact fields are 16 px or larger: " + sizes);
      // No sideways scroll with the register and the panel open.
      assert.equal(await page.evaluate(() => document.getElementById("reg").scrollWidth <= document.getElementById("reg").clientWidth), true);
    },
  },
];

// ---- fix wave ----

module.exports.push({
  name: "the keypad stops at the backend's limit: ¥10,000,000 and $10,000,000",
  async run({ page }) {
    const backend = await ready(page);
    await ringOpenYen(page);
    await keys(page, "9 9 9 9 9 9 9 9");
    await expectText(page, "#xAmt", "¥9,999,999", undefined);
    await keys(page, "del del del del del del del 1 0 0 0 0 0 0 1");
    await expectText(page, "#xAmt", "¥1,000,000");
    await keys(page, "0");
    await expectText(page, "#xAmt", "¥10,000,000");
    await page.click("#kCur");
    await expectText(page, "#xAmt", "$10,000,000");
    await keys(page, "del del del del del del del del 9 9 9 9 9 9 9 9");
    await expectText(page, "#xAmt", "$9,999,999");
    await keys(page, "del del del del del del del 1 0 0 0 0 0 0 1");
    await expectText(page, "#xAmt", "$1,000,000");
    await keys(page, "0");
    await expectText(page, "#xAmt", "$10,000,000");
    await page.fill("#xWhat", "Big");
    await waitGo(page, true);
    await page.click("#kGo");
    const big = await until(() => savedTitled(backend, "Big")[0], "saved, not refused");
    assert.deepEqual([big.amount, big.currency], [10000000, "CAD"]);
  },
});

// ---- "Yen or dollars?" (issue #90, look A, $500) ----
// The plan fixture at 20:40 on Sat Dec 12 in Japan, on Ajen's phone. Ring it
// up on whole dollars of $500 or more on a day in Japan asks once first.
// Pictures only when MAT_TAB_SHOTS names a folder.

const fs = require("node:fs");
const { WITH_PLAN, makeBackend } = require("./helpers.cjs");

const SHOTS = process.env.MAT_TAB_SHOTS || "";
const AT = Date.parse("2026-12-12T20:40:00+09:00");
const DEC9 = JSON.parse(fs.readFileSync(require("node:path").join(__dirname, "..", "fixtures", "dec9.json"), "utf8"));
const et = (iso) => Date.parse(iso + ":00-05:00");

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  const left = () => page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && a.timeline === document.timeline && a.effect && a.effect.getComputedTiming().iterations !== Infinity).length);
  await until(async () => (await left()) === 0, "the animations have finished", 3000);
  await page.screenshot({ path: SHOTS + "/" + name });
}

async function askReady(page, opts = {}) {
  const backend = await open(page, { seed: WITH_PLAN, nowMs: AT, own: "Ajen", ...opts });
  await waitRows(page, opts.rows || 8);
  return backend;
}

const asking = (page) => visible(page, "#xAsk");
const waitAsk = (page) => until(() => asking(page), "the question shows");
const noAsk = async (page) => {
  assert.equal(await asking(page), false, "no question");
  assert.equal(await visible(page, "#pad"), true, "the keys are there");
};

// Dinner, typed in (default $12,000), and Ring it up: the question.
async function dinner(page, seq = "1 2 0 0 0") {
  await ringOpen(page);
  await page.click('#xQuick .chip[data-q="Dinner"]');
  await keys(page, seq);
  await waitGo(page, true);
  await page.click("#kGo");
}

// The question's texts, as drawn.
const askShown = (page) =>
  page.evaluate(() => {
    const t = (s) => (document.querySelector(s) ? document.querySelector(s).textContent : "");
    return {
      amt: t("#xAmt"), conv: t("#xConv"),
      yen: [t("#askYen b"), t("#askYen span").replace(t("#askYen span i") || "", ""), document.querySelector("#askYen i") ? t("#askYen i") : null],
      cad: [t("#askCad b"), t("#askCad span").replace(t("#askCad span i") || "", ""), document.querySelector("#askCad i") ? t("#askCad i") : null],
      yenLabel: document.getElementById("askYen").getAttribute("aria-label"),
      cadLabel: document.getElementById("askCad").getAttribute("aria-label"),
      back: t("#askBack"), off: t("#askOff"),
    };
  });

module.exports.push(
  {
    name: "12000 in dollars on a day in Japan asks, yen first, and saves nothing yet",
    async run({ page }) {
      const backend = await askReady(page);
      const sent = backend.requests.length;
      await dinner(page);
      await waitAsk(page);
      await atRest(page, "#reg", { message: "the register at rest" });
      assert.deepEqual(await askShown(page), {
        amt: "?12,000", conv: "Yen or dollars?",
        yen: ["¥12,000", "yen", "about $108.11"], cad: ["$12,000", "dollars", "about ¥1,332,000"],
        yenLabel: "Ring up 12,000 yen, about $108.11", cadLabel: "Ring up 12,000 dollars, about ¥1,332,000",
        back: "‹ Back to the keys", off: "Ringit up",
      });
      assert.equal(await visible(page, "#pad"), false, "the keys are put away");
      assert.equal(await page.evaluate(() => document.activeElement.id), "xAsk", "focus on the question, not on an answer");
      assert.deepEqual(
        await page.evaluate(() => [document.getElementById("xWhat"), document.querySelector(".step"), document.getElementById("xQuick"), document.querySelector(".who")].map((n) => n.inert)),
        [true, true, true, true],
        "the entry cannot change while it asks",
      );
      await expectText(page, "#xDay", "Sat 12");
      assert.equal(await page.inputValue("#xWhat"), "Dinner");
      await expectText(page, "#regTitle", "Ring up");
      await idle(page);
      assert.equal(backend.requests.length, sent, "no request to the backend");
      assert.equal(await rowOf(page, "Dinner"), null, "nothing on the receipt");
      await shot(page, "ask-390.png");
    },
  },
  {
    name: "the yen answer rings up ¥12,000",
    async run({ page }) {
      const backend = await askReady(page);
      await dinner(page);
      await waitAsk(page);
      await advance(page, backend, 400);
      await page.click("#askYen");
      const row = await waitRow(page, "Dinner");
      assert.equal(row.amt, "¥12,000");
      const d = await until(() => savedTitled(backend, "Dinner")[0], "Dinner saved");
      assert.deepEqual([d.amount, d.currency, d.rate, d.paidBy, d.day, d.kind, d.splitMode], [12000, "JPY", 111, "Ajen", "2026-12-12", "food", "equal"]);
      assert.equal(adds(backend).length, 1);
      await expectText(page, "#ubarT", "Rang up Dinner ¥12,000.");
      assert.ok(await visible(page, "#ubarU"), "Undo is offered");
      // R42: the next entry opens in dollars.
      await expectText(page, "#xAmt", "$0");
      await expectText(page, "#kCur", "$ → ¥");
      await noAsk(page);
      assert.equal(await page.evaluate(() => document.getElementById("xWhat").inert), false, "the title takes typing again");
      await shot(page, "after-yen-390.png");
      // The next one asks again: the key was not pressed in it (the pad is live again after 400 ms).
      await advance(page, backend, 400);
      await ringUp(page, { chip: "Drinks", seq: "6 0 0" });
      await waitAsk(page);
    },
  },
  {
    name: "the dollar answer rings up $12,000",
    async run({ page }) {
      const backend = await askReady(page);
      await dinner(page);
      await waitAsk(page);
      await advance(page, backend, 400);
      await page.click("#askCad");
      const row = await waitRow(page, "Dinner");
      assert.equal(row.amt, "$12,000.00");
      const d = await until(() => savedTitled(backend, "Dinner")[0], "Dinner saved");
      assert.deepEqual([d.amount, d.currency, d.rate], [12000, "CAD", 111]);
      await idle(page);
      assert.equal(adds(backend).length, 1, "one line");
      await expectText(page, "#xAmt", "$0");
      await noAsk(page);
    },
  },
  {
    name: "Back returns the keys with the amount still typed, and asking again works",
    async run({ page }) {
      const backend = await askReady(page);
      await dinner(page);
      await waitAsk(page);
      await advance(page, backend, 400);
      await page.click("#askBack");
      await noAsk(page);
      await expectText(page, "#xAmt", "$12,000");
      await expectText(page, "#xConv", "÷3 ≈ ¥1,332,000");
      assert.equal(await page.evaluate(() => [document.getElementById("xWhat"), document.querySelector(".who")].some((n) => n.inert)), false);
      await idle(page);
      assert.equal(adds(backend).length, 0, "nothing saved");
      // Typing goes on (400 ms after Back): the amount can be put right before ringing up.
      await advance(page, backend, 400);
      await keys(page, "del");
      await expectText(page, "#xAmt", "$1,200");
      await page.click("#kGo");
      await waitAsk(page);
      await expectText(page, "#askYen b", "¥1,200");
      await advance(page, backend, 400);
      await page.click("#askYen");
      await waitRow(page, "Dinner");
      assert.deepEqual((await until(() => savedTitled(backend, "Dinner")[0], "saved")).currency, "JPY");
    },
  },
  {
    name: "an answer tapped in the first 400 ms is ignored",
    async run({ page }) {
      const backend = await askReady(page);
      await dinner(page);
      await waitAsk(page);
      await page.click("#askYen");
      await page.click("#askCad");
      await page.click("#askBack");
      await advance(page, backend, 399);
      await page.click("#askYen");
      await idle(page);
      assert.equal(adds(backend).length, 0, "nothing saved");
      assert.equal(await asking(page), true, "still asking");
      await advance(page, backend, 1);
      await page.click("#askYen");
      await waitRow(page, "Dinner");
      await idle(page);
      assert.equal(adds(backend).length, 1, "saved once");
      assert.equal(savedTitled(backend, "Dinner")[0].currency, "JPY");
    },
  },
  {
    name: "a double tap on Ring it up answers nothing",
    async run({ page }) {
      const backend = await askReady(page);
      await ringOpen(page);
      await page.click('#xQuick .chip[data-q="Dinner"]');
      await keys(page, "1 2 0 0 0");
      await waitGo(page, true);
      // The second tap lands where Ring it up was: on the dimmed copy.
      const go = await page.locator("#kGo").boundingBox();
      await page.dblclick("#kGo");
      await waitAsk(page);
      const off = await page.locator("#askOff").boundingBox();
      const mid = { x: go.x + go.width / 2, y: go.y + go.height / 2 };
      assert.ok(mid.x >= off.x && mid.x <= off.x + off.width && mid.y >= off.y && mid.y <= off.y + off.height, "the dimmed copy sits where Ring it up was");
      assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y).id, [mid.x, mid.y]), "askOff");
      await advance(page, backend, 400);
      await page.mouse.click(mid.x, mid.y);
      // Two clicks in one task on Ring it up: the second finds the keys put away.
      await page.click("#askBack");
      await advance(page, backend, 400);
      await page.evaluate(() => {
        const g = document.getElementById("kGo");
        g.click();
        g.click();
      });
      await waitAsk(page);
      await idle(page);
      assert.equal(adds(backend).length, 0, "nothing answered, nothing saved");
      assert.equal(await asking(page), true);
    },
  },
  {
    name: "$499 rings up without a question and $500 asks",
    async run({ page }) {
      const backend = await askReady(page);
      await ringOpen(page);
      await ringUp(page, { chip: "Dinner", seq: "4 9 9" });
      await waitRow(page, "Dinner");
      await noAsk(page);
      assert.deepEqual((await until(() => savedTitled(backend, "Dinner")[0], "saved")).currency, "CAD");
      await ringUp(page, { chip: "Lunch", seq: "5 0 0" });
      await waitAsk(page);
      await expectText(page, "#askYen b", "¥500");
      await expectText(page, "#askCad b", "$500");
    },
  },
  {
    name: "cents typed: no question",
    async run({ page }) {
      const backend = await askReady(page);
      await ringOpen(page);
      await ringUp(page, { chip: "Dinner", seq: "5 0 0 . 0 0" });
      await waitRow(page, "Dinner");
      await noAsk(page);
      assert.deepEqual((await until(() => savedTitled(backend, "Dinner")[0], "saved")).amount, 500);
    },
  },
  {
    name: "the currency key pressed and pressed back: no question",
    async run({ page }) {
      const backend = await askReady(page);
      await ringOpen(page);
      await page.click("#kCur");
      await page.click("#kCur");
      await expectText(page, "#kCur", "$ → ¥");
      await ringUp(page, { chip: "Dinner", seq: "1 2 0 0 0" });
      await waitRow(page, "Dinner");
      await noAsk(page);
      assert.deepEqual((await until(() => savedTitled(backend, "Dinner")[0], "saved")).currency, "CAD");
      // The next entry is new: the key is untouched in it, so it asks.
      await ringUp(page, { chip: "Lunch", seq: "1 2 0 0 0" });
      await waitAsk(page);
    },
  },
  {
    name: "\"before the trip\" never asks",
    async run({ page }) {
      const backend = await askReady(page);
      await ringOpen(page);
      for (const d of ["Fri 11", "Thu 10", "Before"]) {
        await page.click("#dPrev");
        await expectText(page, "#xDay", d);
      }
      await ringUp(page, { title: "Rail passes top-up", seq: "1 2 0 0 0" });
      await waitRow(page, "Rail passes top-up");
      await noAsk(page);
      const s = await until(() => savedTitled(backend, "Rail passes top-up")[0], "saved");
      assert.deepEqual([s.day, s.currency], ["pre", "CAD"]);
    },
  },
  {
    name: "Dec 9 never asks",
    timezoneId: "America/New_York",
    async run({ page }) {
      const backend = await open(page, { seed: { ...SEED, ...DEC9 }, nowMs: et("2026-12-09T11:45"), own: "Ajen" });
      await ringOpen(page);
      await expectText(page, "#xDay", "Wed 9");
      await ringUp(page, { title: "Lakeport parking", seq: "1 2 0 0 0" });
      await waitRow(page, "Lakeport parking");
      await noAsk(page);
      const s = await until(() => savedTitled(backend, "Lakeport parking")[0], "saved");
      assert.deepEqual([s.day, s.currency, s.amount], ["2026-12-09", "CAD", 12000]);
      // Dec 10 on the same trip is in Japan: it asks.
      await page.click("#dNext");
      await expectText(page, "#xDay", "Thu 10");
      await ringUp(page, { chip: "Dinner", seq: "1 2 0 0 0" });
      await waitAsk(page);
    },
  },
  {
    name: "an exact split in whole figures: the yen answer keeps each person's figure as yen",
    async run({ page }) {
      const backend = await askReady(page);
      await ringOpen(page);
      await page.click('#xQuick .chip[data-q="Dinner"]');
      await keys(page, "1 2 0 0 0");
      await page.click("#xUneven");
      await page.click('#unMode [data-mode="exact"]');
      await page.fill('#un .un-row[data-p="Mo"] .un-val', "6000");
      await page.fill('#un .un-row[data-p="Ajen"] .un-val', "4000");
      await page.fill('#un .un-row[data-p="Trenton"] .un-val', "2000");
      await expectText(page, "#unLeft", "");
      await page.click("#unDone");
      await until(async () => !(await visible(page, "#un")), "#un closes");
      await waitGo(page, true);
      await page.click("#kGo");
      await waitAsk(page);
      await advance(page, backend, 400);
      await page.click("#askYen");
      await waitRow(page, "Dinner");
      const d = await until(() => savedTitled(backend, "Dinner")[0], "saved");
      assert.deepEqual([d.amount, d.currency, d.splitMode, d.split, d.splitVals], [12000, "JPY", "exact", ["Mo", "Ajen", "Trenton"], [6000, 4000, 2000]]);
    },
  },
  {
    name: "an edit asks only when the amount was changed",
    async run({ page }) {
      const seed = JSON.parse(JSON.stringify(WITH_PLAN));
      seed.expenses.push({
        id: "seedexp012", day: "2026-12-12", title: "Torihana", amount: 650, currency: "CAD", rate: 111, paidBy: "Ajen",
        split: ["Mo", "Ajen", "Trenton"], splitMode: "equal", splitVals: [], note: "", kind: "food", addedBy: "Ajen", deleted: false,
      });
      const backend = await askReady(page, { seed, rows: 9 });
      const patches = () => backend.requests.filter((r) => r.action === "updateExpense").map((r) => r.args.patch);

      // Only the payer: saved at once.
      await page.evaluate(() => globalThis.__matTest.register.edit("seedexp012"));
      await waitOpen(page);
      await expectText(page, "#xAmt", "$650");
      await page.click(seal("xPayer", "Mo"));
      await page.click("#kGo");
      await waitClosed(page);
      await idle(page);
      assert.deepEqual(patches(), [{ paidBy: "Mo" }]);

      // The amount changed: it asks, and says Save.
      await page.evaluate(() => globalThis.__matTest.register.edit("seedexp012"));
      await waitOpen(page);
      await keys(page, "del del del 1 2 0 0 0");
      await expectText(page, "#xAmt", "$12,000");
      await page.click("#kGo");
      await waitAsk(page);
      await atRest(page, "#reg", { message: "the register at rest" });
      const shown = await askShown(page);
      assert.deepEqual([shown.off, shown.yenLabel, shown.cadLabel], ["Save", "Save as 12,000 yen, about $108.11", "Save as 12,000 dollars, about ¥1,332,000"]);
      await expectText(page, "#regTitle", "Change this line");
      await shot(page, "ask-edit-390.png");
      await advance(page, backend, 400);
      await page.click("#askYen");
      await waitClosed(page);
      await idle(page);
      assert.deepEqual(patches()[1], { amount: 12000, currency: "JPY" }, "the currency and the amount both in the patch");
      const e = saved(backend).find((x) => x.id === "seedexp012");
      assert.deepEqual([e.amount, e.currency, e.rate, e.paidBy], [12000, "JPY", 111, "Mo"]);
      await expectText(page, '.rc-row[data-id="seedexp012"] .rc-amt', "¥12,000");
      // The next opening is a new entry, in dollars.
      await ringOpen(page);
      await expectText(page, "#regTitle", "Ring up");
      await expectText(page, "#xAmt", "$0");
      await noAsk(page);
    },
  },
  {
    name: "with no signal the question still comes and the line waits to be sent",
    async run({ page }) {
      const backend = await askReady(page);
      backend.failWith = "network";
      await dinner(page);
      await waitAsk(page);
      await advance(page, backend, 400);
      await page.click("#askYen");
      const row = await waitRow(page, "Dinner", (r) => r.cls.includes("is-pending") && r.text.includes("will send when signal returns"), "pending");
      assert.equal(row.amt, "¥12,000");
      await expectText(page, "#net", /1 to send\./);
      assert.equal(savedTitled(backend, "Dinner").length, 0);
      backend.failWith = null;
      await page.click("#regDone");
      await waitClosed(page);
      await page.click("#fresh");
      await waitRow(page, "Dinner", (r) => !r.cls.includes("is-pending"), "sent");
      await idle(page);
      const d = savedTitled(backend, "Dinner");
      assert.equal(d.length, 1, "exactly one copy");
      assert.deepEqual([d[0].amount, d[0].currency], [12000, "JPY"]);
    },
  },
  {
    name: "Done while it asks saves nothing and the question is gone on reopening",
    async run({ page }) {
      const backend = await askReady(page);
      await dinner(page);
      await waitAsk(page);
      await page.click("#regDone");
      await waitClosed(page);
      await advance(page, backend, 400);
      await idle(page);
      assert.equal(adds(backend).length, 0, "nothing saved");
      await ringOpen(page);
      await noAsk(page);
      await expectText(page, "#xAmt", "$12,000");
      await expectText(page, "#kCur", "$ → ¥");
      assert.equal(await page.inputValue("#xWhat"), "Dinner");
      assert.equal(await page.evaluate(() => document.getElementById("xWhat").inert), false);
      // Something else closing it (a Days sheet, the trip taken off) clears it the same.
      await page.click("#kGo");
      await waitAsk(page);
      await page.evaluate(() => globalThis.__matTest.register.close());
      await waitClosed(page);
      await ringOpen(page);
      await noAsk(page);
    },
  },
  {
    name: "Enter on a computer does not answer, Escape is Back",
    viewport: { width: 1440, height: 900 },
    mobile: false,
    async run({ page }) {
      const backend = await askReady(page);
      await ringOpen(page);
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      for (const k of ["1", "2", "0", "0", "0"]) await page.keyboard.press(k);
      await page.click('#xQuick .chip[data-q="Dinner"]');
      await page.keyboard.press("Enter");
      await waitAsk(page);
      const inside = await page.evaluate(() => {
        const r = document.getElementById("reg").getBoundingClientRect();
        return [...document.querySelectorAll("#xAsk *")].every((n) => { const b = n.getBoundingClientRect(); return b.left >= r.left - 0.5 && b.right <= r.right + 0.5 && b.bottom <= innerHeight + 0.5; });
      });
      assert.equal(inside, true, "the question fits the Money pane");
      await page.keyboard.press("Enter");
      await advance(page, backend, 400);
      for (const k of ["Enter", "5", "Backspace", "."]) await page.keyboard.press(k);
      await idle(page);
      assert.equal(adds(backend).length, 0, "Enter answered nothing");
      assert.equal(await asking(page), true);
      await expectText(page, "#xAmt", "?12,000");
      await page.keyboard.press("Escape");
      await noAsk(page);
      assert.equal(await isOpen(page), true, "Escape is Back, the register stays");
      await expectText(page, "#xAmt", "$12,000");
      // Enter rings up again: it asks again.
      await page.keyboard.press("Enter");
      await waitAsk(page);
      await page.keyboard.press("Escape");
      await noAsk(page);
      await idle(page);
      assert.equal(adds(backend).length, 0);
    },
  },
  {
    name: "at 320 the question fits",
    viewport: { width: 320, height: 640 },
    async run({ page }) {
      await askReady(page);
      await dinner(page);
      await waitAsk(page);
      await atRest(page, "#reg", { message: "the register at rest" });
      const fit = await page.evaluate(() => {
        const reg = document.getElementById("reg");
        const r = reg.getBoundingClientRect();
        const over = [...reg.querySelectorAll("#xAsk *, .lcd *")].filter((n) => { const b = n.getBoundingClientRect(); return b.width && (b.left < r.left - 0.5 || b.right > r.right + 0.5); }).map((n) => n.id || n.className);
        const ask = document.getElementById("xAsk").getBoundingClientRect();
        return { over, sideways: reg.scrollWidth <= reg.clientWidth, bottom: ask.bottom <= innerHeight + 0.5, amt: document.getElementById("xAmt").getBoundingClientRect().right <= document.querySelector(".lcd").getBoundingClientRect().right };
      });
      assert.deepEqual(fit, { over: [], sideways: true, bottom: true, amt: true });
      await shot(page, "ask-320.png");
    },
  },
  {
    name: "held sideways the question takes the keys' column",
    viewport: { width: 844, height: 390 },
    async run({ page }) {
      await askReady(page);
      await dinner(page);
      await waitAsk(page);
      await atRest(page, "#reg", { message: "the register at rest" });
      const fit = await page.evaluate(() => {
        const reg = document.getElementById("reg").getBoundingClientRect();
        const lcd = document.querySelector(".lcd").getBoundingClientRect();
        const ask = document.getElementById("xAsk").getBoundingClientRect();
        const parts = [...document.querySelectorAll("#xAsk *")].every((n) => { const b = n.getBoundingClientRect(); return b.left >= ask.left - 0.5 && b.right <= ask.right + 0.5; });
        return { right: ask.left >= lcd.right, inReg: ask.right <= reg.right + 0.5 && ask.bottom <= innerHeight + 0.5 && ask.top >= reg.top, parts };
      });
      assert.deepEqual(fit, { right: true, inReg: true, parts: true });
      await shot(page, "ask-sideways.png");
    },
  },
  {
    name: "with no rate the question leaves out the about figures",
    async run({ page }) {
      const backend = makeBackend(WITH_PLAN, { now: AT });
      backend.fake.setRate(null, "none");
      await askReady(page, { backend });
      await dinner(page);
      await waitAsk(page);
      await atRest(page, "#reg", { message: "the register at rest" });
      const shown = await askShown(page);
      assert.deepEqual([shown.yen, shown.cad, shown.yenLabel, shown.cadLabel], [["¥12,000", "yen", null], ["$12,000", "dollars", null], "Ring up 12,000 yen", "Ring up 12,000 dollars"]);
      await shot(page, "ask-no-rate-390.png");
      // Dollars (a yen line with no rate at all cannot be totalled on the receipt, before and after this change).
      await advance(page, backend, 400);
      await page.click("#askCad");
      await waitRow(page, "Dinner");
      const d = await until(() => savedTitled(backend, "Dinner")[0], "saved");
      assert.deepEqual([d.amount, d.currency], [12000, "CAD"]);
    },
  },
);

// ---- fix round (review I1, M1, M2, M3) ----

// A point inside `sel`: fx, fy are fractions of its width and height.
const pointIn = async (page, sel, fx, fy) => {
  const b = await page.locator(sel).boundingBox();
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
};
// Two taps at one point, the second at once (no clock moves between them).
const doubleTapAt = async (page, p) => {
  await page.mouse.click(p.x, p.y);
  await page.mouse.click(p.x, p.y);
};
// The key of the pad under a point, once the pad is back.
const keyAt = (page, p) => page.evaluate(([x, y]) => { const k = document.elementFromPoint(x, y).closest(".key"); return k ? k.dataset.k : null; }, [p.x, p.y]);

module.exports.push(
  {
    name: "a double tap on Yen presses nothing on the pad that comes back: not the currency key, not a digit",
    async run({ page }) {
      const backend = await askReady(page);
      // Right quarter, lower half: the "$ → ¥" key is under it.
      await dinner(page);
      await waitAsk(page);
      await advance(page, backend, 400);
      const right = await pointIn(page, "#askYen", 0.88, 0.75);
      await doubleTapAt(page, right);
      await waitRow(page, "Dinner");
      assert.equal(await keyAt(page, right), "cur", "the currency key is under the second tap");
      await expectText(page, "#xAmt", "$0");
      await expectText(page, "#kCur", "$ → ¥");
      // Left side: the digits 7 8 9 / 4 5 6 are under it.
      await advance(page, backend, 400);
      await ringUp(page, { chip: "Lunch", seq: "1 2 0 0 0" });
      await waitAsk(page);
      await advance(page, backend, 400);
      const left = await pointIn(page, "#askYen", 0.3, 0.75);
      await doubleTapAt(page, left);
      await waitRow(page, "Lunch");
      assert.equal(await keyAt(page, left), "5", "a digit is under the second tap");
      await expectText(page, "#xAmt", "$0");
      await expectText(page, "#kCur", "$ → ¥");
      await idle(page);
      assert.deepEqual(saved(backend).filter((e) => ["Dinner", "Lunch"].includes(e.title)).map((e) => [e.title, e.amount, e.currency]), [["Dinner", 12000, "JPY"], ["Lunch", 12000, "JPY"]]);
      // The next entry is untouched: it is in dollars and it asks; after 400 ms the pad works.
      await advance(page, backend, 400);
      await ringUp(page, { chip: "Drinks", seq: "6 0 0" });
      await waitAsk(page);
      await expectText(page, "#askCad b", "$600");
    },
  },
  {
    name: "a double tap on Dollars presses nothing on the pad that comes back",
    async run({ page }) {
      const backend = await askReady(page);
      await dinner(page);
      await waitAsk(page);
      await advance(page, backend, 400);
      const p = await pointIn(page, "#askCad", 0.5, 0.5);
      await doubleTapAt(page, p);
      await waitRow(page, "Dinner");
      assert.equal(await keyAt(page, p), "2", "a digit is under the second tap");
      await expectText(page, "#xAmt", "$0");
      await expectText(page, "#kCur", "$ → ¥");
      await idle(page);
      assert.deepEqual(savedTitled(backend, "Dinner").map((e) => [e.amount, e.currency]), [[12000, "CAD"]]);
      await advance(page, backend, 400);
      await ringUp(page, { chip: "Lunch", seq: "7 0 0" });
      await waitAsk(page);
    },
  },
  {
    name: "a double tap on Back leaves the kept amount as it was, and the keys work 400 ms later",
    async run({ page }) {
      const backend = await askReady(page);
      await dinner(page);
      await waitAsk(page);
      await advance(page, backend, 400);
      for (const [fx, k] of [[0.15, "0"], [0.5, "00"], [0.85, "."]]) {
        const p = await pointIn(page, "#askBack", fx, 0.5);
        await doubleTapAt(page, p);
        await noAsk(page);
        assert.equal(await keyAt(page, p), k, k + " is under the second tap");
        await expectText(page, "#xAmt", "$12,000");
        await expectText(page, "#kCur", "$ → ¥");
        // Ring it up, 400 ms later, still asks (no cents were typed by the second tap).
        await advance(page, backend, 400);
        await page.click("#kGo");
        await waitAsk(page);
        await advance(page, backend, 400);
      }
      await page.click("#askBack");
      await advance(page, backend, 400);
      await keys(page, "del");
      await expectText(page, "#xAmt", "$1,200");
      await idle(page);
      assert.equal(adds(backend).length, 0, "nothing saved");
    },
  },
  {
    name: "a day's own Ring up on the receipt does not change the day under the question",
    async run({ page }) {
      const backend = await askReady(page);
      await ringOpen(page);
      await page.click("#dPrev");
      await expectText(page, "#xDay", "Fri 11");
      await page.click('#xQuick .chip[data-q="Dinner"]');
      await keys(page, "1 2 0 0 0");
      await page.click("#kGo");
      await waitAsk(page);
      // Sat Dec 12's own "Ring up" on the receipt, above the register.
      await page.click('[data-addday="2026-12-12"]');
      await expectText(page, "#xDay", "Fri 11");
      assert.equal(await asking(page), true, "still asking");
      await advance(page, backend, 400);
      await page.click("#askYen");
      const d = await until(() => savedTitled(backend, "Dinner")[0], "saved");
      assert.deepEqual([d.day, d.currency], ["2026-12-11", "JPY"]);
    },
  },
  {
    name: "a sync redraw while it asks keeps the question, with the about figures at the new rate",
    async run({ page }) {
      const backend = await askReady(page);
      await dinner(page);
      await waitAsk(page);
      await expectText(page, "#askYen i", "about $108.11");
      backend.fake.setRate(120, "live");
      await page.evaluate(() => globalThis.__matTest.store.refresh());
      await idle(page);
      await expectText(page, "#askYen i", "about $100.00");
      await expectText(page, "#askCad i", "about ¥1,440,000");
      await expectText(page, "#xAmt", "?12,000");
      await expectText(page, "#xConv", "Yen or dollars?");
      assert.equal(await visible(page, "#pad"), false);
      await advance(page, backend, 400);
      await page.click("#askYen");
      const d = await until(() => savedTitled(backend, "Dinner")[0], "saved");
      assert.deepEqual([d.amount, d.currency, d.rate], [12000, "JPY", 120]);
    },
  },
  {
    name: "an edit answered Dollars sends only the amount",
    async run({ page }) {
      const seed = JSON.parse(JSON.stringify(WITH_PLAN));
      seed.expenses.push({
        id: "seedexp012", day: "2026-12-12", title: "Torihana", amount: 650, currency: "CAD", rate: 111, paidBy: "Ajen",
        split: ["Mo", "Ajen", "Trenton"], splitMode: "equal", splitVals: [], note: "", kind: "food", addedBy: "Ajen", deleted: false,
      });
      const backend = await askReady(page, { seed, rows: 9 });
      await page.evaluate(() => globalThis.__matTest.register.edit("seedexp012"));
      await waitOpen(page);
      await keys(page, "del del del 1 2 0 0 0");
      await page.click("#kGo");
      await waitAsk(page);
      await advance(page, backend, 400);
      await page.click("#askCad");
      await waitClosed(page);
      await idle(page);
      assert.deepEqual(backend.requests.filter((r) => r.action === "updateExpense").map((r) => r.args.patch), [{ amount: 12000 }]);
      const e = saved(backend).find((x) => x.id === "seedexp012");
      assert.deepEqual([e.amount, e.currency, e.rate], [12000, "CAD", 111]);
    },
  },
);
