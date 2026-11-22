// Whose turn (mock-up 3A, reworded by Mo): one quiet line in the register
// under the quick chips, "Paid the most so far: <name>", and on a tap each
// person's figures against their share. No ring on a seal, nothing that makes
// anyone the payer. Hidden with no lines, and while everyone is within $40.00
// of even. Held at 393x852, 320x568, 844x390 and 1440x900.

const assert = require("node:assert/strict");
const fs = require("fs");
const { SEED, NOON12, open, until, atRest, text, expectText, visible } = require("./helpers.cjs");

const SHOTS = require("./shots.cjs")("money-trio");
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
};

// "ok", or why the element is not on screen and tappable.
function reach(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return "missing";
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return "not drawn";
    if (r.top < -0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5) {
      return "off screen: " + Math.round(r.left) + "," + Math.round(r.top) + " to " + Math.round(r.right) + "," + Math.round(r.bottom) + " of " + innerWidth + "x" + innerHeight;
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(hit === el || el.contains(hit))) return "covered by " + (hit ? hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") + "." + hit.className : "nothing");
    return "ok";
  }, selector);
}
async function expectReach(page, selector) {
  let got;
  try {
    await until(async () => (got = await reach(page, selector)) === "ok", "");
  } catch {
    const s = page.viewportSize();
    throw new Error(selector + " is not on screen and tappable at " + s.width + "x" + s.height + ": " + got);
  }
}
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth);

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: SEED, nowMs: NOON12, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0 || document.querySelector("#say")), "Money draws");
  return backend;
}

// Open, and risen all the way (the sheet slides up over 500 ms of real time).
async function ringOpen(page) {
  await page.click("#ring");
  await atRest(page, "#reg", { message: "the register opens and stands still" });
}

const heads = (page) => page.$$eval("#xWhy .ws-r", (rows) => rows.map((r) => r.querySelector(".ws-n").textContent));
const subs = (page) => page.$$eval("#xWhy .ws-r", (rows) => rows.map((r) => (r.querySelector(".ws-s") || { textContent: "" }).textContent));
const line = (o) => ({ day: "2026-12-11", currency: "CAD", rate: 111, splitMode: "equal", splitVals: [], note: "", kind: "", deleted: false, split: ["Mo", "Ajen", "Trenton"], ...o });
const pay = (n, from, to, cad) => ({ id: "turnpay" + n + "aaaa", from, to, cad, seed: 100 + n, rot: 2, removed: false });

function sizeCase(size, mobile, tag) {
  return {
    name: tag + ": the line and its reasoning fit, with nothing off screen and no sideways scroll",
    viewport: size,
    ...(mobile ? {} : { mobile: false }),
    async run({ page }) {
      await ready(page);
      await ringOpen(page);
      await expectText(page, "#xTurn", "Paid the most so far: you");
      await expectReach(page, "#xTurn");
      await expectReach(page, "#kGo");
      assert.ok(await noSideways(page), "no sideways scroll with the line");
      await shot(page, "3A-" + tag + "-line");
      await page.click("#xTurn");
      await until(() => visible(page, "#xWhy"), "the reasoning opens");
      await page.waitForTimeout(300); // its roll-in
      await expectReach(page, "#xWhyX");
      await expectReach(page, "#regDone");
      const box = await page.evaluate(() => {
        const r = document.getElementById("xWhy").getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      });
      assert.ok(box.top >= 0 && box.bottom <= size.height + 0.5 && box.left >= 0 && box.right <= size.width + 0.5, "the reasoning is on screen: " + JSON.stringify(box));
      assert.ok(await noSideways(page), "no sideways scroll with the reasoning open");
      await shot(page, "3A-" + tag + "-why");
      await page.click("#xWhyX");
      await until(async () => !(await visible(page, "#xWhy")), "Close folds it");
      await expectReach(page, "#kGo");
      await expectReach(page, "#xTurn");
    },
  };
}

module.exports = [
  {
    name: "the line sits under the chips and names who has paid the most; a tap shows everyone's figures; Close folds it",
    viewport: { width: 393, height: 852 },
    async run({ page }) {
      await ready(page);
      assert.equal(await visible(page, "#xTurn"), false, "nothing shows while the register is down");
      await ringOpen(page);
      await expectText(page, "#xTurn", "Paid the most so far: you");
      assert.equal(await text(page, "#xTurn b"), "you");
      const order = await page.evaluate(() => {
        const y = (id) => document.getElementById(id).getBoundingClientRect();
        return { chips: y("xQuick").bottom, line: y("xTurn").top, lineEnd: y("xTurn").bottom, who: document.querySelector("#reg .who").getBoundingClientRect().top };
      });
      assert.ok(order.chips <= order.line && order.lineEnd <= order.who, "under the chips, over the seals: " + JSON.stringify(order));
      assert.equal(await page.getAttribute("#xTurn", "aria-expanded"), "false");
      assert.equal(await visible(page, "#xWhy"), false);

      await page.click("#xTurn");
      await until(() => visible(page, "#xWhy"), "the reasoning opens");
      assert.equal(await page.getAttribute("#xTurn", "aria-expanded"), "true");
      await expectText(page, "#xWhy .ws-t span", "Paid so far, against each share");
      assert.deepEqual(await heads(page), ["You have paid $2,648.65 of a $1,305.57 share", "Ajen: $1,100.00 of $1,321.73", "Trenton: $200.36 of $1,321.71"]);
      assert.deepEqual(await subs(page), ["", "", ""], "nothing was sent or received yet");
      assert.deepEqual(await page.$$eval("#xWhy .ws-r .mini", (els) => els.map((e) => e.textContent)), ["MO", "AJ", "TR"]);
      // Ten boxes each; Mo is past his share (+10), Trenton has a box and a half.
      assert.deepEqual(await page.$$eval("#xWhy .ws-card", (cards) => cards.map((c) => [c.querySelectorAll("i.f").length, c.querySelectorAll("i.h").length, (c.querySelector("em") || { textContent: "" }).textContent])), [[10, 0, "+10"], [8, 1, ""], [1, 1, ""]]);
      assert.match(await text(page, "#xWhy .ws-x"), /^Each box is a tenth of a share\. .* A hint, not a rule: whoever pays, the slip sorts it out\.$/);
      // No ring on anyone's seal, and nothing that makes anyone the payer.
      assert.equal(await page.locator("#reg .seal.hint").count(), 0);
      assert.equal(await page.locator("#xWhy .ws-go, #xWhy [data-payer]").count(), 0);
      assert.deepEqual(await page.$$eval("#xWhy button", (els) => els.map((e) => e.textContent)), ["Close"]);
      assert.equal(await page.evaluate(() => document.querySelector('#xPayer .seal[data-p="Mo"]').classList.contains("is-on")), true, "the payer is still you");

      await page.click("#xWhyX");
      await until(async () => !(await visible(page, "#xWhy")), "Close folds it");
      assert.equal(await page.getAttribute("#xTurn", "aria-expanded"), "false");
      // A second tap on the line opens it again; closing the register folds it for next time.
      await page.click("#xTurn");
      await until(() => visible(page, "#xWhy"), "it opens again");
      await page.click("#regDone");
      await ringOpen(page);
      assert.equal(await visible(page, "#xWhy"), false, "the register opens with the reasoning folded");
    },
  },
  {
    name: "another viewer sees the name, and the payer stays the viewer",
    async run({ page }) {
      await ready(page, { me: "Ajen" });
      await ringOpen(page);
      await expectText(page, "#xTurn", "Paid the most so far: Mo");
      assert.equal(await page.evaluate(() => document.querySelector('#xPayer .seal[data-p="Ajen"]').classList.contains("is-on")), true);
      await page.click("#xTurn");
      await until(() => visible(page, "#xWhy"), "the reasoning opens");
      assert.deepEqual(await heads(page), ["Mo has paid $2,648.65 of a $1,305.57 share", "You: $1,100.00 of $1,321.73", "Trenton: $200.36 of $1,321.71"]);
    },
  },
  {
    name: "payments on the slip count: sent adds, received takes away",
    async run({ page }) {
      await ready(page, { seed: { ...SEED, payments: [pay(1, "Ajen", "Mo", 221.73)] } });
      await ringOpen(page);
      await expectText(page, "#xTurn", "Paid the most so far: you");
      await page.click("#xTurn");
      await until(() => visible(page, "#xWhy"), "the reasoning opens");
      assert.deepEqual(await heads(page), ["You have paid $2,426.92 of a $1,305.57 share", "Ajen: $1,321.73 of $1,321.73", "Trenton: $200.36 of $1,321.71"]);
      assert.deepEqual(await subs(page), ["$2,648.65 for the group, $221.73 back from Ajen", "$1,100.00 for the group, $221.73 sent to you", ""]);
    },
  },
  {
    name: "hidden with no lines yet",
    async run({ page }) {
      await ready(page, { seed: { expenses: [], payments: [] } });
      await ringOpen(page);
      assert.equal(await visible(page, "#xTurn"), false);
      assert.equal(await page.locator("#xTurn").getAttribute("hidden"), "");
    },
  },
  {
    name: "hidden while everyone is within $40.00 of even, shown one cent past it",
    async run({ page }) {
      // Mo +$40.00, Ajen -$40.00, Trenton even.
      const backend = await ready(page, { seed: { expenses: [line({ id: "turnexp0001", title: "Bento", amount: 80, paidBy: "Mo", split: ["Mo", "Ajen"] })], payments: [] } });
      await ringOpen(page);
      assert.equal(await visible(page, "#xTurn"), false);
      // Another phone rings up a cent more: the line comes up while the register is open.
      await backend.handle({ key: "test-key", actor: "Trenton", via: "app", action: "addExpense", args: { expense: { id: "turnexp0002", title: "Gum", amount: 0.02, currency: "CAD", rate: 111, paidBy: "Mo", split: ["Ajen"], splitMode: "equal", splitVals: [], day: "2026-12-12", note: "", kind: "" } } });
      await page.evaluate(() => globalThis.__matTest.store.refresh());
      await until(() => visible(page, "#xTurn"), "the line shows once someone is past $40.00");
      await expectText(page, "#xTurn", "Paid the most so far: you");
    },
  },
  sizeCase({ width: 393, height: 852 }, true, "393x852"),
  sizeCase({ width: 320, height: 568 }, true, "320x568"),
  sizeCase({ width: 844, height: 390 }, true, "844x390"),
  sizeCase({ width: 1440, height: 900 }, false, "1440x900"),
];
