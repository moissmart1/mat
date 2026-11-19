// The History tape (Task 11): every change anyone made, newest first, with
// Undo on the newest change to each item.

const assert = require("node:assert/strict");
const P = require("../../backend/Pure.js");
const { SEED, NOON12, makeBackend, open, advance, until, text, expectText, visible } = require("./helpers.cjs");

// ---- small tools for this file ----

const NAMES = ["Mo", "Ajen", "Trenton"];
const classOf = (page, id) => page.evaluate((i) => document.getElementById(i).className, id);
const isOpen = (page, id) => page.evaluate((i) => document.getElementById(i).classList.contains("is-open"), id);
// Open, and risen all the way (the sheet slides up over 500 ms).
const waitHist = (page) =>
  until(
    () => page.evaluate(() => {
      const s = document.getElementById("hist");
      // Risen and done sliding: measured mid-slide, a 40 px key reads 39.99998 px.
      return s.classList.contains("is-open") && Math.abs(s.getBoundingClientRect().bottom - innerHeight) < 1 && getComputedStyle(s).transform === "none";
    }),
    "the history sheet opens",
  );
const waitHistClosed = (page) => until(async () => !(await isOpen(page, "hist")), "the history sheet closes");
const waitCachedHistory = (page) =>
  until(() => page.evaluate(() => {
    const { entries, loading } = globalThis.__matTest.store.state.history;
    return entries.length > 0 && !loading;
  }), "History is cached");
const histRequests = (backend) => backend.requests.filter((r) => r.action === "history").length;
const undoRequests = (backend) => backend.requests.filter((r) => r.action === "undo").length;
const idle = (page) => page.evaluate(() => globalThis.__matTest.store.idle());

// The tape's rows, newest first.
const tape = (page) =>
  page.$$eval("#tape .tp-row", (rows) =>
    rows.map((r) => ({
      id: r.dataset.id,
      sentence: r.querySelector(".tp-s").textContent,
      time: r.querySelector("time").textContent,
      undone: r.classList.contains("is-undone"),
      undo: r.querySelector("button.tp-undo") !== null,
    })),
  );
const waitTape = (page, check, what) =>
  until(async () => {
    const rows = await tape(page);
    return check(rows) ? rows : null;
  }, what);
const waitRowsN = (page, n) => waitTape(page, (r) => r.length === n, "the tape shows " + n + " rows");
const rowFor = (rows, sentence) => rows.find((r) => r.sentence === sentence);
// Each heading as "English | Japanese".
const days = (page) => page.$$eval("#tape .tp-day", (els) => els.map((e) => e.querySelector("span").textContent + " | " + e.querySelector("i").textContent));
const undoBtn = (id) => '#tape .tp-row[data-id="' + id + '"] button.tp-undo';

const receiptTitles = (page) => page.$$eval("#rc .rc-row .rc-t", (els) => els.map((e) => e.firstChild.textContent));
const waitReceiptHas = (page, title, yes = true) =>
  until(async () => (await receiptTitles(page)).includes(title) === yes, "receipt " + (yes ? "has " : "no longer has ") + title);

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: SEED, nowMs: NOON12, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0), "the receipt draws");
  // The app fetches History once, quietly, after it starts: wait until that has landed.
  if (opts.bootHistory !== false) {
    await until(() => page.evaluate(() => { const h = globalThis.__matTest.store.state.history; return h.entries.length > 0 && !h.loading; }), "History is fetched after starting");
  }
  return backend;
}

// Taps History and waits until the entries are on the tape.
async function openTape(page, n) {
  await page.click("#histBtn");
  await waitHist(page);
  if (n !== undefined) await waitRowsN(page, n);
  else await waitTape(page, (r) => r.length > 0, "entries arrive");
}

// Holds every request of one action until release() is called.
function hold(backend, action) {
  const orig = backend.handle;
  let release;
  const gate = new Promise((r) => (release = r));
  backend.handle = async function (body) {
    if (body.action === action) await gate;
    return orig.call(backend, body);
  };
  return () => {
    backend.handle = orig;
    release();
  };
}

const otherPhone = (backend, action, args, { actor = "Ajen", via = "app" } = {}) => backend.handle({ key: "test-key", actor, via, action, args });
const idOfSeed = (title) => SEED.expenses.find((e) => e.title === title).id;
const tables = (backend) => JSON.stringify(["Expenses", "Settlements", "Log"].map((t) => backend.fake.primitives.readTable_(t)));
const savedExpense = (backend, id) => backend.fake.primitives.readTable_("Expenses").map(P.expenseFromRow).find((e) => e.id === id);

const SHARED = (n) => ({ id: "bulk" + String(n).padStart(6, "0"), day: "pre", title: "Line " + n, amount: 100 + n, currency: "JPY", paidBy: "Mo", split: NAMES.slice() });

module.exports = [
  {
    name: "History opens from its button, titled 履歴 History, with … until the ten entries arrive, newest first under day headings",
    async run({ page }) {
      // Held from before the app starts, so nothing is on the phone yet when History opens.
      const backend = makeBackend(SEED, { now: NOON12 });
      const release = hold(backend, "history");
      await ready(page, { backend, bootHistory: false });
      assert.equal(await isOpen(page, "hist"), false);
      assert.equal(await page.evaluate(() => document.getElementById("hist").inert), true);

      await page.click("#histBtn");
      await waitHist(page);
      assert.equal(await page.getAttribute("#hist", "role"), "dialog");
      assert.equal(await page.getAttribute("#hist", "aria-modal"), "true");
      assert.equal(await text(page, "#hist .hist-top span"), "履歴 History");
      assert.equal(await page.evaluate(() => document.getElementById("hist").contains(document.activeElement)), true, "focus moves into the sheet");
      assert.equal(await text(page, "#tape"), "…");
      release();

      const rows = await waitRowsN(page, 10);
      assert.equal(histRequests(backend), 2, "the one after starting and the one for this opening");
      const ids = rows.map((r) => Number(r.id));
      assert.deepEqual(ids, ids.slice().sort((a, b) => b - a), "newest first");
      // Every seeded change was made on 2026-11-20 in Japan: one heading, in English beside the Japanese date.
      assert.deepEqual(await days(page), ["Fri Nov 20 | 11月20日(金)"]);
      assert.equal(rows[0].time, "09:00");

      assert.ok(rowFor(rows, "Ajen deleted Konbini snacks ¥1,200"), "the delete reads as a sentence");
      assert.ok(rowFor(rows, "Mo rang up Niseko lodge ¥288,000"), "so does the first add");
      assert.equal(await page.locator("#histMore").count(), 0, "ten entries: no Show older");
    },
  },
  {
    name: "an entry made through Claude ends with (through Claude); days are the day in Japan, newest day first",
    async run({ page }) {
      const backend = await ready(page);
      // 01:00 on Dec 13 in Japan, still Dec 12 in UTC.
      backend.now = Date.parse("2026-12-12T16:00:00Z");
      // Through the connector's own path (a phone saying via claude is ignored since the security fix round); it writes as the owner.
      await backend.fake.claude("addExpense", { expense: { ...SHARED(1), id: "claudeline01", title: "Late ramen", day: "2026-12-12", paidBy: "Mo", splitMode: "equal", splitVals: [], note: "", kind: "" } });
      await page.evaluate(() => globalThis.__matTest.store.refresh());
      await openTape(page, 11);
      const rows = await tape(page);
      assert.equal(rows[0].sentence, "Mo rang up Late ramen ¥101 (through Claude)");
      assert.equal(rows[0].time, "01:00");
      assert.ok(!rows[1].sentence.includes("through Claude"));
      assert.deepEqual(await days(page), ["Sun Dec 13 | 12月13日(日)", "Fri Nov 20 | 11月20日(金)"]);
    },
  },
  {
    name: "on a phone in Toronto a change made at 13:20 Japan time reads 23:20 under Fri Dec 11, here and in the line sheet",
    timezoneId: "America/Toronto",
    async run({ page }) {
      const backend = await ready(page);
      // 13:20 on Sat Dec 12 in Japan is 23:20 on Fri Dec 11 in Toronto.
      await otherPhone(backend, "addExpense", { expense: { ...SHARED(1), id: "torontoline1", title: "Tempura", day: "2026-12-11", paidBy: "Ajen", splitMode: "equal", splitVals: [], note: "", kind: "" } });
      await page.evaluate(() => globalThis.__matTest.store.refresh());
      await openTape(page, 11);
      const rows = await tape(page);
      assert.equal(rows[0].sentence, "Ajen rang up Tempura ¥101");
      assert.equal(rows[0].time, "23:20");
      assert.deepEqual(await days(page), ["Fri Dec 11 | 12月11日(金)", "Thu Nov 19 | 11月19日(木)"]);
      await page.click("#histDone");
      await waitHistClosed(page);

      const id = await page.evaluate(() => [...document.querySelectorAll("#rc .rc-row")].find((r) => r.querySelector(".rc-t").firstChild.textContent === "Tempura").dataset.id);
      await page.click('#rc .rc-row[data-id="' + id + '"]');
      await until(() => isOpen(page, "line"), "the line sheet opens");
      await expectText(page, "#lnBy", "Rung up by Ajen, Fri Dec 11");
      await until(() => page.evaluate(() => /Fri Dec 11/.test(document.getElementById("lnLog").textContent)), "its history date");
    },
  },
  {
    name: "only the newest change to an item has Undo",
    async run({ page }) {
      await ready(page);
      await openTape(page, 10);
      const rows = await tape(page);
      assert.equal(rowFor(rows, "Ajen deleted Konbini snacks ¥1,200").undo, true);
      assert.equal(rowFor(rows, "Ajen rang up Konbini snacks ¥1,200").undo, false, "older than the delete");
      assert.equal(rowFor(rows, "Mo rang up Niseko lodge ¥288,000").undo, true, "its only change");
      assert.equal(await text(page, "#tape .tp-row button.tp-undo"), "Undo");
      const box = await page.locator("#tape button.tp-undo").first().boundingBox();
      assert.ok(box.height >= 40 && box.width >= 40, "a thumb can hit it: " + JSON.stringify(box));
    },
  },
  {
    name: "Undo on a delete brings the line back, strikes the delete through, and adds an undid row with its own Undo; undoing that deletes it again",
    async run({ page }) {
      const backend = await ready(page);
      await openTape(page, 10);
      const sayBefore = await text(page, "#say");
      const del = rowFor(await tape(page), "Ajen deleted Konbini snacks ¥1,200");
      await page.click(undoBtn(del.id));

      const rows = await waitRowsN(page, 11);
      assert.equal(rows[0].sentence, "Mo undid: deleted Konbini snacks ¥1,200");
      assert.equal(rows[0].undo, true, "the undo can itself be undone");
      const struck = rows.find((r) => r.id === del.id);
      assert.equal(struck.undone, true);
      assert.equal(struck.undo, false);
      assert.match(await page.evaluate((id) => getComputedStyle(document.querySelector('.tp-row[data-id="' + id + '"] .tp-s')).textDecorationLine, del.id), /line-through/);
      await waitReceiptHas(page, "Konbini snacks");
      await until(async () => (await text(page, "#say")) !== sayBefore, "#say changes");
      await idle(page);
      assert.equal(savedExpense(backend, idOfSeed("Konbini snacks")).deleted, false);

      await page.click(undoBtn(rows[0].id));
      await waitRowsN(page, 12);
      await waitReceiptHas(page, "Konbini snacks", false);
      await idle(page);
      assert.equal(savedExpense(backend, idOfSeed("Konbini snacks")).deleted, true);
    },
  },
  {
    name: "Undo on a stamp entry takes the stamp off the slip",
    async run({ page }) {
      const pay = { id: "seedpay1aaaa", from: "Ajen", to: "Mo", cad: 221.73, seed: 777, rot: 4, stampedBy: "Ajen", removed: false };
      const backend = await ready(page, { seed: { ...SEED, payments: [pay] } });
      const stamps = () => page.locator("#slip .s-row.is-paid").count();
      await until(async () => (await stamps()) === 1, "the seeded stamp");
      await openTape(page, 11);
      const row = (await tape(page)).find((r) => r.sentence.startsWith("Ajen stamped"));
      assert.ok(row && row.undo, "the stamp entry has Undo");
      await page.click(undoBtn(row.id));
      await until(async () => (await stamps()) === 0, "the stamp comes off");
      await waitTape(page, (r) => r[0].sentence.startsWith("Mo undid"), "the undo is on the tape");
      await idle(page);
      assert.equal(backend.fake.primitives.readTable_("Settlements").map(P.paymentFromRow)[0].removed, true);
    },
  },
  {
    name: "an outdated Undo is refused with the plain message, changes nothing, and the tape shows the newer entry",
    async run({ page }) {
      const backend = await ready(page);
      const id = idOfSeed("Shibuya dinner");
      await otherPhone(backend, "updateExpense", { id, patch: { amount: 14600 } }); // Ajen, first edit
      await openTape(page, 11);
      const first = (await tape(page)).find((r) => r.sentence.startsWith("Ajen changed Shibuya dinner"));
      assert.equal(first.undo, true, "newest change to it when the tape loaded");

      await otherPhone(backend, "updateExpense", { id, patch: { amount: 15000 } }, { actor: "Trenton" }); // after the tape loaded
      const before = tables(backend);
      await page.click(undoBtn(first.id));
      await expectText(page, "#ubarT", "That was changed again since. Undo the newer change first.");
      await idle(page);
      assert.equal(tables(backend), before, "nothing on the backend changed: no row, no log entry, no undone mark");
      assert.equal(savedExpense(backend, id).amount, 15000);

      const rows = await waitRowsN(page, 12);
      assert.match(rows[0].sentence, /^Trenton changed Shibuya dinner/);
      assert.equal(rows[0].undo, true);
      assert.equal(rows.find((r) => r.id === first.id).undo, false, "the outdated one lost its Undo");
      assert.equal(rows.find((r) => r.id === first.id).undone, false);
    },
  },
  {
    name: "a double tap on Undo sends one undo",
    async run({ page }) {
      const backend = await ready(page);
      await openTape(page, 10);
      const del = rowFor(await tape(page), "Ajen deleted Konbini snacks ¥1,200");
      const release = hold(backend, "undo");
      await page.dblclick(undoBtn(del.id));
      assert.equal(await page.evaluate((s) => document.querySelector(s).disabled, undoBtn(del.id)), true, "disabled while it is sent");
      release();
      await waitRowsN(page, 11);
      await idle(page);
      assert.equal(undoRequests(backend), 1);
      assert.equal(savedExpense(backend, idOfSeed("Konbini snacks")).deleted, false);
    },
  },
  {
    name: "Show older adds the rest of a cached tape and stays stale until the first page refreshes",
    async run({ page }) {
      const expenses = [];
      for (let i = 0; i < 230; i++) expenses.push(SHARED(i));
      const backend = await open(page, { seed: { expenses, payments: [] }, nowMs: NOON12 });
      await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0), "the receipt draws");
      await waitCachedHistory(page);
      backend.failWith = "network";
      await openTape(page, 200);
      const stale = "Showing the last loaded history. History needs a connection.";
      await expectText(page, "#tape .tp-msg", stale);
      backend.failWith = null;
      assert.equal(await text(page, "#histMore"), "Show older");
      await page.click("#histMore");
      await waitRowsN(page, 230);
      await until(async () => !(await visible(page, "#histMore")), "Show older goes");
      assert.equal(await page.locator("#histMore").count(), 0);
      await expectText(page, "#tape .tp-msg", stale);
      assert.equal(await page.locator("#tape .tp-undo").count(), 0);
      await page.click("#histDone");
      await waitHistClosed(page);
      await openTape(page, 200);
      await until(async () => (await page.locator("#tape .tp-undo").count()) > 0, "Undo returns after a fresh first page");
      assert.equal(await page.locator("#tape .tp-msg").count(), 0);
    },
  },
  {
    name: "opening History clears the new count and remembers when it was seen",
    async run({ page }) {
      const seen = Date.parse("2026-12-01T00:00:00Z");
      const backend = await ready(page, { storage: { "mat.seen": String(seen) } });
      await otherPhone(backend, "addExpense", { expense: { ...SHARED(1), id: "freshline001", title: "Tempura", paidBy: "Ajen", splitMode: "equal", splitVals: [], note: "", kind: "" } });
      await page.evaluate(() => globalThis.__matTest.store.refresh());
      await expectText(page, "#histN", "1");
      assert.equal(await visible(page, "#histN"), true);
      await openTape(page);
      await until(async () => !(await visible(page, "#histN")), "the count clears");
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.seen")), String(NOON12));
    },
  },
  {
    name: "with no signal the tape keeps its last loaded entries; opening again refreshes them",
    async run({ page }) {
      const backend = await ready(page);
      await waitCachedHistory(page);
      backend.failWith = "network";
      await page.click("#histBtn");
      await waitHist(page);
      await expectText(page, "#tape .tp-msg", "Showing the last loaded history. History needs a connection.");
      assert.equal(await page.locator("#tape .tp-row").count(), 10);
      assert.equal(await page.locator("#tape .tp-undo").count(), 0);
      await page.click("#histDone");
      await waitHistClosed(page);

      backend.failWith = null;
      await openTape(page, 10);
      await until(async () => (await page.locator("#tape .tp-msg").count()) === 0, "the stale notice clears");
      assert.equal(histRequests(backend), 2, "the one after starting and this one: the failed one never reached the backend");
    },
  },
  {
    name: "any other trouble loading says so, not that there is no connection",
    async run({ page }) {
      const backend = await ready(page);
      await waitCachedHistory(page);
      backend.failWith = "server";
      await page.click("#histBtn");
      await waitHist(page);
      await expectText(page, "#tape .tp-msg", "Showing the last loaded history. Couldn’t load the history.");
    },
  },
  {
    name: "History is fetched each time it opens",
    async run({ page }) {
      const backend = await ready(page);
      await openTape(page, 10);
      await page.click("#histDone");
      await waitHistClosed(page);
      await otherPhone(backend, "updateExpense", { id: idOfSeed("Ramen"), patch: { amount: 4800 } });
      await page.click("#histBtn");
      await waitHist(page);
      await waitRowsN(page, 11);
      assert.equal(histRequests(backend), 3, "after starting, and once for each opening");
    },
  },
  {
    name: "Done, a tap above the sheet and Escape each close it, and focus returns to the History button",
    async run({ page }) {
      await ready(page);
      for (const how of ["done", "scrim", "escape"]) {
        await openTape(page, 10);
        if (how === "done") await page.click("#histDone");
        else if (how === "scrim") await page.mouse.click(195, 15);
        else await page.keyboard.press("Escape");
        await waitHistClosed(page);
        assert.equal(await page.evaluate(() => document.getElementById("hist").inert), true, how);
        assert.equal(await page.evaluate(() => document.activeElement.id), "histBtn", "focus after " + how);
      }
      assert.equal(await visible(page, "#histScrim"), false, "the backdrop goes with the sheet");
    },
  },
  {
    name: "one sheet at a time: History closes the line sheet and the register, and they close History",
    async run({ page }) {
      await ready(page);
      const row = await page.evaluate(() => document.querySelector("#rc .rc-row").dataset.id);
      await page.click('#rc .rc-row[data-id="' + row + '"]');
      await until(() => isOpen(page, "line"), "the line sheet opens");
      await page.evaluate(() => document.getElementById("histBtn").click());
      await waitHist(page);
      assert.equal(await isOpen(page, "line"), false, "the line sheet closed");

      await page.evaluate(() => document.getElementById("ring").click()); // the register (the sheet covers the real button)
      await until(() => isOpen(page, "reg"), "the register opens");
      await until(async () => !(await isOpen(page, "hist")), "History closed");

      await page.evaluate(() => document.getElementById("histBtn").click());
      await waitHist(page);
      assert.equal(await isOpen(page, "reg"), false, "the register closed");
      assert.equal(await page.locator(".phone.reg-open, .phone.line-open").count(), 0);
    },
  },
  {
    name: "no text on the tape uses the dot-matrix face, and the sentences are the Zen Kaku Gothic New face",
    async run({ page }) {
      await ready(page);
      await openTape(page, 10);
      const faces = await page.$$eval("#hist, #hist *", (els) => els.map((e) => getComputedStyle(e).fontFamily));
      assert.ok(faces.length > 30);
      assert.deepEqual(faces.filter((f) => /DotGothic/i.test(f)), []);
      const row = await page.evaluate(() => getComputedStyle(document.querySelector("#tape .tp-row")).fontFamily);
      assert.match(row, /^"?Zen Kaku Gothic New"?/);
    },
  },
  {
    name: "the sheet does not scroll the page sideways and the undo bar sits clear of it",
    async run({ page }) {
      const backend = await ready(page);
      await openTape(page, 10);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.getElementById("tape").scrollWidth > document.getElementById("tape").clientWidth);
      assert.equal(wide, false);
      const del = rowFor(await tape(page), "Ajen deleted Konbini snacks ¥1,200");
      await page.click(undoBtn(del.id));
      await expectText(page, "#ubarT", "Undone.");
      const top = await page.evaluate(() => document.getElementById("ubar").getBoundingClientRect().top);
      assert.ok(top < 60, "the bar is at the top while History is open: " + top);
      await advance(page, backend, 6100);
    },
  },
];

// ---- fix wave ----

module.exports.push({
  name: "a changed e-Transfer address shows on the tape as a sentence, without the address and with no Undo",
  async run({ page }) {
    const backend = await ready(page, { own: "Mo" });
    await page.click("#youBtn");
    await until(() => page.evaluate(() => document.getElementById("you").classList.contains("is-open")), "settings open");
    await page.fill("#setMail", "mo@example.test");
    await page.click("#setMailSave");
    await until(() => backend.fake.tables.Log.some((r) => r.kind === "person"), "logged");
    await page.click("#setHist");
    await waitHist(page);
    const rows = await waitTape(page, (r) => r.some((x) => x.sentence.includes("e-Transfer")), "the change on the tape");
    const row = rows.find((x) => x.sentence.includes("e-Transfer"));
    assert.equal(row.sentence, "Mo changed Mo’s e-Transfer address");
    assert.equal(row.undo, false, "no Undo button");
    assert.equal(await page.evaluate(() => document.getElementById("tape").textContent.includes("mo@example.test")), false);
  },
});
