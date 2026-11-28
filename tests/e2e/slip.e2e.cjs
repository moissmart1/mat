// The slip's other half (Task 10): Simplify (each person's own, asked once
// when turned off), show the working, the routing sentence, a payment made
// under one reading settling the other, and Remind.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const P = require("../../backend/Pure.js");
const { SEED: BASE, NOON12, open, until, text, expectText, visible } = require("./helpers.cjs");

// Pictures are taken only when MAT_TAB_SHOTS names an output folder.
const SHOTS = process.env.MAT_TAB_SHOTS || "";
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.evaluate(() => document.getElementById("slip").scrollIntoView({ block: "start" }));
  await page.screenshot({ path: SHOTS + "/" + name });
}

// Task 2's chain: Mo owes Ajen $10, Ajen owes Trenton $10.
const line = (o) => ({ day: "2026-12-11", currency: "CAD", rate: 111, splitMode: "equal", splitVals: [], note: "", kind: "", deleted: false, ...o });
const CHAIN = [
  line({ id: "chainexp001", title: "Izakaya", amount: 20, paidBy: "Ajen", split: ["Mo", "Ajen"] }),
  line({ id: "chainexp002", title: "Karaoke", amount: 20, paidBy: "Trenton", split: ["Ajen", "Trenton"] }),
];
const SEED = { expenses: CHAIN, payments: [] };
const ASK = "Pay each person directly? You’ll make more payments. The totals are the same.";
const ROUTE = "You pay Trenton because you owe Ajen and Ajen owes Trenton. Fewer payments, same totals.";

const openRows = (page) =>
  page.$$eval("#slip .s-row.is-open", (rows) => rows.map((r) => r.querySelector(".s-who").textContent + " " + r.querySelector(".s-amt").textContent));
const waitRows = (page, want) =>
  until(async () => JSON.stringify(await openRows(page)) === JSON.stringify(want), "slip rows " + JSON.stringify(want)).catch(async (e) => {
    throw new Error(e.message + ", got " + JSON.stringify(await openRows(page)));
  });
const person = (backend, name) => backend.fake.primitives.readTable_("People").map(P.personFromRow).find((p) => p.name === name);
const setPersonCalls = (backend) => backend.requests.filter((r) => r.action === "setPerson");
const idle = (page) => page.evaluate(() => globalThis.__matTest.store.idle());
const isOn = async (page) => (await page.getAttribute("#simp", "aria-checked")) === "true";
const row = (key) => '#slip .s-row[data-key="' + key + '"]';

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: SEED, nowMs: NOON12, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#slip .s-row").length > 0), "the slip draws");
  return backend;
}

// Records navigator.share calls; `how`: "ok", "reject" (the sheet was closed) or "none" (no share).
async function stubShare(page, how) {
  await page.addInitScript((h) => {
    globalThis.__shared = [];
    const share = h === "none" ? undefined : async (data) => {
      globalThis.__shared.push(data);
      if (h === "reject") throw new DOMException("Share canceled", "AbortError");
    };
    Object.defineProperty(Navigator.prototype, "share", { value: share, configurable: true, writable: true });
  }, how);
}

module.exports = [
  {
    name: "Simplify is on: one routed row, Mo → Trenton $10.00, with its routing sentence",
    async run({ page }) {
      await ready(page);
      assert.equal(await isOn(page), true);
      await waitRows(page, ["You → Trenton $10.00"]);
      await expectText(page, "#say", "You owe Trenton $10.00.");
      await expectText(page, row("Mo>Trenton") + " .s-route", ROUTE);
      assert.equal(await page.locator(row("Mo>Trenton") + " button.remind").count(), 0, "Mo is not owed: no Remind");
    },
  },
  {
    name: "the working: tapping the amount prints paid, share and sent; tapping 'paid' lists the lines",
    async run({ page }) {
      await ready(page);
      await waitRows(page, ["You → Trenton $10.00"]);
      assert.equal(await page.locator(".s-work").count(), 0, "closed until asked");
      await page.click(row("Mo>Trenton") + " .s-amt");
      const lines = await until(async () => {
        const l = await page.$$eval(row("Mo>Trenton") + " .s-work .s-wl", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
        return l.length ? l : null;
      }, "the working opens");
      assert.deepEqual(lines, ["You paid $0.00", "Your share came to $10.00", "Already sent $0.00"]);
      assert.equal(await page.getAttribute(row("Mo>Trenton") + " .s-amt", "aria-expanded"), "true");
      await page.click(row("Mo>Trenton") + " .s-work [data-paid]");
      await expectText(page, row("Mo>Trenton") + " .s-lines", "Nothing yet.");
      // Tapping the amount again folds it away.
      await page.click(row("Mo>Trenton") + " .s-amt");
      assert.equal(await page.locator(".s-work").count(), 0);
    },
  },
  {
    name: "the working names the other person, lists what they paid, and shows what they received",
    async run({ page }) {
      const pay = { id: "chainpay001", from: "Mo", to: "Ajen", cad: 4, seed: 9, rot: 1 };
      await ready(page, { me: "Trenton", seed: { ...SEED, people: { Trenton: { simplify: false } }, payments: [pay] } });
      await waitRows(page, ["Mo → Ajen $6.00", "Ajen → you $10.00"]);
      await page.click(row("Ajen>Trenton") + " .s-amt");
      const lines = await until(async () => {
        const l = await page.$$eval(row("Ajen>Trenton") + " .s-work .s-wl", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
        return l.length ? l : null;
      }, "the working opens");
      assert.deepEqual(lines, ["Ajen paid $20.00", "Ajen’s share came to $20.00", "Already sent $0.00", "Already received $4.00"]);
      await page.click(row("Ajen>Trenton") + " .s-work [data-paid]");
      const paid = await page.$$eval(row("Ajen>Trenton") + " .s-lines li", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
      assert.deepEqual(paid, ["Izakaya $20.00"]);
    },
  },
  {
    name: "turning Simplify off asks once; Keep leaves it on; Turn off saves simplify false",
    async run({ page }) {
      const backend = await ready(page);
      await waitRows(page, ["You → Trenton $10.00"]);
      await page.click("#simp");
      await expectText(page, "#simpAsk .simp-q", ASK);
      assert.ok(await visible(page, "#simpAsk"));
      await page.click("#simpKeep");
      assert.equal(await visible(page, "#simpAsk"), false);
      assert.equal(await isOn(page), true);
      await idle(page);
      assert.equal(setPersonCalls(backend).length, 0, "nothing saved");

      await page.click("#simp");
      await page.click("#simpOff");
      await until(async () => !(await isOn(page)), "the switch is off");
      assert.equal(await visible(page, "#simpAsk"), false);
      await idle(page);
      assert.equal(person(backend, "Mo").simplify, false);
      assert.deepEqual(setPersonCalls(backend).map((r) => r.args), [{ name: "Mo", patch: { simplify: false } }]);

      // Off: each direct debt, no routing sentence.
      await waitRows(page, ["You → Ajen $10.00", "Ajen → Trenton $10.00"]);
      await expectText(page, "#say", "You owe Ajen $10.00.");
      assert.equal(await page.locator("#slip .s-route").count(), 0);

      // On again: no question, saved at once.
      await page.click("#simp");
      assert.equal(await visible(page, "#simpAsk"), false, "turning it on asks nothing");
      await until(() => isOn(page), "the switch is on");
      await idle(page);
      assert.equal(person(backend, "Mo").simplify, true);
      await waitRows(page, ["You → Trenton $10.00"]);
    },
  },
  {
    name: "Simplify is each person's own: Trenton still sees the routed row",
    async run({ page }) {
      await ready(page, { me: "Trenton", seed: { ...SEED, people: { Mo: { simplify: false } } } });
      assert.equal(await isOn(page), true);
      await waitRows(page, ["Mo → you $10.00"]);
      await expectText(page, row("Mo>Trenton") + " .s-route", "Mo pays you because Mo owes Ajen and Ajen owes you. Fewer payments, same totals.");
    },
  },
  {
    name: "a payment made under the routed reading settles Mo's direct reading too",
    async run({ page }) {
      const pay = { id: "chainpay002", from: "Mo", to: "Trenton", cad: 10, seed: 3, rot: -2, stampedBy: "Trenton" };
      await ready(page, { seed: { ...SEED, people: { Mo: { simplify: false } }, payments: [pay] } });
      assert.equal(await isOn(page), false);
      await until(async () => (await page.locator("#slip .s-row.is-paid").count()) === 1, "the stamped row");
      await waitRows(page, []);
      await expectText(page, "#say", "You’re square.");
      await expectText(page, "#slip .s-row.is-paid .s-sub", "Paid Fri Nov 20. Nothing more to send.");
    },
  },
  {
    name: "if turning Simplify off gets no reply, the switch goes back and the bar says it is checking",
    async run({ page }) {
      const backend = await ready(page);
      await waitRows(page, ["You → Trenton $10.00"]);
      backend.failWith = "network";
      await page.click("#simp");
      await page.click("#simpOff");
      await expectText(page, "#ubarT", "Couldn’t confirm that. Checking…");
      await until(() => isOn(page), "the switch is back on");
      await waitRows(page, ["You → Trenton $10.00"]);
      backend.failWith = null;
    },
  },
  {
    name: "Remind opens the share sheet with the ready message, only on rows owed to the viewer",
    async run({ page }) {
      await stubShare(page, "ok");
      await ready(page, { me: "Trenton", seed: { ...SEED, people: { Trenton: { etransfer: "t@example.com" } } } });
      await waitRows(page, ["Mo → you $10.00"]);
      assert.equal(await page.locator('#slip button.remind[data-key="Mo>Trenton"]').count(), 1);
      await page.click('#slip button.remind[data-key="Mo>Trenton"]');
      const shared = await until(async () => {
        const s = await page.evaluate(() => globalThis.__shared);
        return s.length ? s : null;
      }, "share is called");
      assert.deepEqual(shared, [{ text: "Mo, you owe me $10.00 for the Japan trip. e-Transfer: t@example.com" }]);
      assert.equal(await visible(page, "#ubar"), false, "a share says nothing on the bar");
    },
  },
  {
    name: "closing the share sheet is not an error and shows nothing",
    async run({ page }) {
      await stubShare(page, "reject");
      await ready(page, { me: "Trenton" });
      await waitRows(page, ["Mo → you $10.00"]);
      await page.click('#slip button.remind[data-key="Mo>Trenton"]');
      await until(() => page.evaluate(() => globalThis.__shared.length === 1), "share is called");
      await idle(page);
      assert.equal(await visible(page, "#ubar"), false);
    },
  },
  {
    name: "with no share sheet, Remind copies the message and says so",
    async run({ page }) {
      await stubShare(page, "none");
      await ready(page, { me: "Trenton" });
      await waitRows(page, ["Mo → you $10.00"]);
      await page.click('#slip button.remind[data-key="Mo>Trenton"]');
      await expectText(page, "#ubarT", "Copied. Paste it in your chat.");
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "Mo, you owe me $10.00 for the Japan trip.");
    },
  },
  {
    name: "no Remind where the viewer is not the one owed",
    async run({ page }) {
      await ready(page, { me: "Trenton", seed: { ...SEED, people: { Trenton: { simplify: false } } } });
      await waitRows(page, ["Mo → Ajen $10.00", "Ajen → you $10.00"]);
      assert.equal(await page.locator('#slip button.remind[data-key="Mo>Ajen"]').count(), 0);
      assert.equal(await page.locator('#slip button.remind[data-key="Ajen>Trenton"]').count(), 1);
      assert.equal(await page.locator("#slip button.remind").count(), 1);
    },
  },

  // ---- #89: 振込先, where to send it, on the row that is yours to pay ----
  {
    name: "your own open row shows where to send it before anything is tapped",
    async run({ page }) {
      await ready(page, { own: "Ajen", seed: { ...BASE, people: { Mo: { etransfer: "mo@example.com" } } } });
      const r = row("Ajen>Mo");
      await until(() => page.locator(r + " .s-pay").count(), "the field draws");
      assert.equal(await text(page, r + " .s-pay-l"), "振込先Send it to");
      assert.equal(await text(page, r + " .s-pay-a"), "mo@example.com" + "Mo’s e-Transfer address");
      assert.equal(await text(page, r + " .s-pay-c"), "Copy");
      assert.equal(await page.getAttribute(r + " .s-pay-c", "aria-label"), "Copy Mo’s e-Transfer address");
      assert.equal(await page.locator("#slip .spot.is-armed").count(), 0, "not armed");
      assert.equal((await page.locator(r + " .s-pay-c").boundingBox()).height >= 44, true, "Copy is a 44 px tap target");
      assert.equal(await page.locator("#stampAmt").count(), 0);
      assert.equal(await page.locator(r + " .s-send").count(), 0);
      const us = await page.evaluate(() => getComputedStyle(document.querySelector(".s-pay-a")).userSelect);
      assert.equal(us, "text");
      await shot(page, "pay-to-390.png");
    },
  },
  {
    name: "Copy puts the address on the clipboard and says so",
    async run({ page }) {
      await ready(page, { own: "Ajen", seed: { ...BASE, people: { Mo: { etransfer: "mo@example.com" } } } });
      await page.click(row("Ajen>Mo") + " .s-pay-c");
      await until(async () => (await page.evaluate(() => navigator.clipboard.readText())) === "mo@example.com", "the address is on the clipboard");
      await expectText(page, "#ubarT", "Address copied.");
      assert.equal(await page.locator("#slip .spot.is-armed").count(), 0, "Copy does not arm the stamp");
    },
  },
  {
    name: "only your own row carries it",
    async run({ page }) {
      await ready(page, { own: "Ajen", seed: { ...BASE, people: { Mo: { etransfer: "mo@example.com" } } } });
      await until(() => page.locator(row("Ajen>Mo") + " .s-pay").count(), "the field draws");
      assert.equal(await page.locator(row("Trenton>Mo")).count(), 1);
      assert.equal(await page.locator(row("Trenton>Mo") + " .s-pay").count(), 0);
      assert.equal(await page.locator("#slip .s-pay").count(), 1);
      await page.click('#slip button.spot[data-key="Trenton>Mo"]');
      await expectText(page, row("Trenton>Mo") + " #sendTo", "mo@example.com");
      assert.equal(await page.locator(row("Trenton>Mo") + " .s-pay").count(), 0);
      assert.equal(await page.locator(row("Ajen>Mo") + " .s-pay").count(), 1, "Ajen's own field stays");
    },
  },
  {
    name: "arming your own row keeps one address, not two; the second tap stamps and the field goes",
    async run({ page }) {
      const backend = await ready(page, { own: "Ajen", seed: { ...BASE, people: { Mo: { etransfer: "mo@example.com" } } } });
      const k = row("Ajen>Mo");
      await until(() => page.locator(k + " .s-pay").count(), "the field draws");
      await page.click('#slip button.spot[data-key="Ajen>Mo"]');
      await until(() => page.locator("#stampAmt").count(), "armed");
      assert.equal(await page.locator(k + " .s-pay").count(), 1);
      assert.equal(await page.locator(k + " .s-send").count(), 0);
      await expectText(page, k + " .s-sub", "Did Mo get it? Tap again to stamp.");
      await shot(page, "pay-to-armed-390.png");
      await page.click('#slip button.spot[data-key="Ajen>Mo"]');
      await until(async () => (await page.locator("#slip .s-row.is-paid").count()) === 1, "a stamped row");
      assert.equal(await page.locator(k).count(), 0, "the open row is gone");
      assert.equal(await page.locator("#slip .s-row.is-paid .s-pay").count(), 0, "paid rows carry no field");
      assert.equal(await page.evaluate(() => globalThis.__matTest.store.idle().then(() => true)), true);
      assert.equal(backend.requests.filter((r) => r.action === "addPayment").length, 1);
    },
  },
  {
    name: "no address saved: the row says so and has no Copy",
    async run({ page }) {
      await ready(page, { own: "Ajen", seed: { ...BASE, people: { Mo: { etransfer: "   " } } } });
      const r = row("Ajen>Mo");
      await until(() => page.locator(r + " .s-pay").count(), "the field draws");
      assert.equal(await text(page, r + " .s-pay-a"), "Mo hasn’t added an e-Transfer address yet. Ask Mo how to pay.");
      assert.equal(await page.locator(r + " .s-pay-c").count(), 0);
      await shot(page, "pay-to-none-390.png");
    },
  },
  {
    name: "the line under the form tells you to send first; for someone who owes nothing it is unchanged",
    async run(ctx) {
      const { page } = ctx;
      await ready(page, { own: "Ajen", seed: BASE });
      await expectText(page, "#slip .slip-f", "Send it from your bank, then stamp 済 here. What’s left is always what’s shown here.");
      const b = await ctx.newPhone();
      await ready(b, { me: "Mo", seed: BASE });
      await expectText(b, "#slip .slip-f", "Stamp it the moment you send. What’s left is always what’s shown here.");
      assert.equal(await b.locator("#slip .s-pay").count(), 0, "Mo is owed: nothing new");
      await shot(b, "pay-to-mo-view-390.png");
    },
  },
  {
    name: "an address added on another phone appears without a reload",
    async run({ page }) {
      const backend = await ready(page, { own: "Ajen", seed: BASE });
      const r = row("Ajen>Mo");
      await until(() => page.locator(r + " .s-pay-a.is-none").count(), "no address yet");
      backend.fake.primitives.updateWhere_("People", "name", "Mo", { etransfer: "mo@example.com" });
      await page.evaluate(() => globalThis.__matTest.store.refresh());
      await until(async () => (await text(page, r + " .s-pay-a")).startsWith("mo@example.com"), "the address appears");
      assert.equal(await page.locator(r + " .s-pay-c").count(), 1);
      // And a change to it.
      backend.fake.primitives.updateWhere_("People", "name", "Mo", { etransfer: "mo2@example.com" });
      await page.evaluate(() => globalThis.__matTest.store.refresh());
      await until(async () => (await text(page, r + " .s-pay-a")).startsWith("mo2@example.com"), "the change appears");
    },
  },
  {
    name: "tapping the field neither arms the stamp nor opens the working",
    async run({ page }) {
      await ready(page, { own: "Ajen", seed: { ...BASE, people: { Mo: { etransfer: "mo@example.com" } } } });
      const r = row("Ajen>Mo");
      await until(() => page.locator(r + " .s-pay").count(), "the field draws");
      await page.click(r + " .s-pay-a");
      await page.click(r + " .s-pay-l");
      await page.click(r + " .s-pay", { position: { x: 3, y: 3 } });
      assert.equal(await page.locator("#slip .spot.is-armed").count(), 0);
      assert.equal(await page.locator("#slip .s-work").count(), 0);
      assert.equal(await page.locator("#stampAmt").count(), 0);
    },
  },
  {
    name: "a half-typed amount in an armed row survives a new address arriving",
    async run({ page }) {
      const backend = await ready(page, { own: "Ajen", seed: { ...BASE, people: { Mo: { etransfer: "mo@example.com" } } } });
      await until(() => page.locator(row("Ajen>Mo") + " .s-pay").count(), "the field draws");
      await page.click('#slip button.spot[data-key="Ajen>Mo"]');
      await until(() => page.locator("#stampAmt").count(), "armed");
      await page.fill("#stampAmt", "12.5");
      backend.fake.primitives.updateWhere_("People", "name", "Mo", { etransfer: "mo3@example.com" });
      await page.evaluate(() => globalThis.__matTest.store.refresh());
      await until(async () => (await text(page, row("Ajen>Mo") + " .s-pay-a")).startsWith("mo3@example.com"), "the address changes");
      assert.equal(await page.inputValue("#stampAmt"), "12.5");
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "stampAmt");
    },
  },
  {
    name: "several rows of your own: each shows and copies its own payee's address",
    async run({ page }) {
      await ready(page, { own: "Trenton", seed: { ...BASE, people: { Trenton: { simplify: false }, Mo: { etransfer: "mo@example.com" }, Ajen: { etransfer: "ajen@example.com" } } } });
      const toMo = row("Trenton>Mo");
      const toAjen = row("Trenton>Ajen");
      await until(async () => (await page.locator("#slip .s-pay").count()) === 2, "two fields");
      assert.equal((await text(page, toMo + " .s-pay-a")).startsWith("mo@example.com"), true);
      assert.equal(await text(page, toMo + " .s-pay-a small"), "Mo’s e-Transfer address");
      assert.equal((await text(page, toAjen + " .s-pay-a")).startsWith("ajen@example.com"), true);
      assert.equal(await text(page, toAjen + " .s-pay-a small"), "Ajen’s e-Transfer address");
      assert.equal(await page.getAttribute(toAjen + " .s-pay-c", "aria-label"), "Copy Ajen’s e-Transfer address");
      await page.click(toAjen + " .s-pay-c");
      await until(async () => (await page.evaluate(() => navigator.clipboard.readText())) === "ajen@example.com", "Ajen's address is on the clipboard");
      await page.click(toMo + " .s-pay-c");
      await until(async () => (await page.evaluate(() => navigator.clipboard.readText())) === "mo@example.com", "Mo's address is on the clipboard");
      // Arming one row leaves the other's field in place, and no second address line anywhere.
      await page.click('#slip button.spot[data-key="Trenton>Ajen"]');
      await until(() => page.locator("#stampAmt").count(), "armed");
      assert.equal(await page.locator("#slip .s-pay").count(), 2);
      assert.equal(await page.locator("#slip .s-send").count(), 0);
      assert.equal((await text(page, toMo + " .s-pay-a")).startsWith("mo@example.com"), true);
    },
  },
  {
    name: "focus on Copy survives a new address arriving",
    async run({ page }) {
      const backend = await ready(page, { own: "Ajen", seed: { ...BASE, people: { Mo: { etransfer: "mo@example.com" } } } });
      const r = row("Ajen>Mo");
      await until(() => page.locator(r + " .s-pay-c").count(), "the field draws");
      await page.focus(r + " .s-pay-c");
      backend.fake.primitives.updateWhere_("People", "name", "Mo", { etransfer: "mo4@example.com" });
      await page.evaluate(() => globalThis.__matTest.store.refresh());
      await until(async () => (await text(page, r + " .s-pay-a")).startsWith("mo4@example.com"), "the address changes");
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.matches(".s-row[data-key='Ajen>Mo'] .s-pay-c")), true);
    },
  },
  {
    name: "at 320 nothing runs past the slip's edge, with a long address",
    viewport: { width: 320, height: 640 },
    async run({ page }) {
      const long = "a".repeat(40) + "@example.com";
      await ready(page, { own: "Ajen", seed: { ...BASE, people: { Mo: { etransfer: long } } } });
      const r = row("Ajen>Mo");
      await until(() => page.locator(r + " .s-pay").count(), "the field draws");
      const over = await page.evaluate(() => {
        const slip = document.getElementById("slip").getBoundingClientRect();
        return {
          doc: document.scrollingElement.scrollWidth <= innerWidth,
          out: [...document.querySelectorAll("#slip .s-pay, #slip .s-pay *")].filter((e) => e.getBoundingClientRect().width && e.getBoundingClientRect().right > slip.right + 0.5).map((e) => e.className),
        };
      });
      assert.deepEqual(over, { doc: true, out: [] });
      assert.equal((await page.locator(r + " .s-pay-c").boundingBox()).height >= 44, true, "Copy is a 44 px tap target");
      assert.equal(await page.locator(r + " .s-pay-c").isVisible(), true);
      await shot(page, "pay-to-320.png");
    },
  },
];
