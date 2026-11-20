// The Before list drawn as a pad of reservation slips (mock-up 1A, 予約票): a
// bound pad, each booking a slip with its counterfoil (number and who is on
// it) on the left behind a dotted tear line, the done ones as torn-off slips.
// Every word and control the list had stays and works (tests/e2e/todos.e2e.cjs
// holds those); here it is the form, and that it fits at 393x852, 320x568,
// 844x390 and 1440x900. Every item here is made up.

const assert = require("node:assert/strict");
const fs = require("fs");
const { SEED, makeBackend, open, advance, until, text, expectText, visible } = require("./helpers.cjs");

const SHOTS = require("./shots.cjs")("picks");
const PLANNER_ID = "fakePlannerSheet_0123456789abcdefXYZ";
const BHEAD = ["#", "Item", "Who", "Book by", "Status", "Notes", "Booking link"];
const brow = (o) => BHEAD.map((h) => (o[h] === undefined ? "" : o[h]));
const CHEAD = ["#", "Date / time", "Agent / session", "Tab", "Cell(s)", "Item", "Old value", "New value", "Why", "Proof / source", "Verified?"];
const ITEMS = [
  { "#": 4, Item: "Rail pass seat reservations", "Book by": "2026-11-20", Status: "Not booked", Notes: "Window seats for three, both legs.", "Booking link": "https://rail.example.test/book?leg=1" },
  { "#": 5, Item: "Hot spring inn, two nights, with a very long name that has to wrap on a narrow phone", "Book by": "2026-11-20", Status: "Not booked", Notes: "Ask for the room with the bath." },
  { "#": 6, Item: "Lift passes, four days", "Book by": "2026-11-30", Status: "Not booked" },
  { "#": 7, Item: "Art museum, evening entry", "Book by": "2026-12-01", Status: "Not booked", Notes: "Timed entry." },
  { "#": 1, Item: "Flights", Status: "Booked" },
  { "#": 2, Item: "City hotel, two nights", Status: "Booked" },
  { "#": 3, Item: "Rail pass: not buying it", Status: "Booked" },
];
// 14:00 on Mon Nov 16 in Toronto: before the trip.
const BEFORE = Date.parse("2026-11-16T19:00:00Z");

async function ready(page, { claims = {}, go = true } = {}) {
  const backend = makeBackend({ ...SEED, plannerId: PLANNER_ID, plannerTabs: { "Book Now": [["Before we go: bookings"], BHEAD, ...ITEMS.map(brow)], "Change Log": [CHEAD] } }, { now: BEFORE });
  const call = (action, args, actor = "Mo") => backend.fake({ key: "test-key", actor, action, args });
  backend.now = BEFORE - 5 * 60000;
  assert.equal((await call("syncTodos", {})).ok, true);
  backend.now = BEFORE;
  for (const [id, who] of Object.entries(claims)) assert.equal((await call("claimTodo", { id, on: true }, who)).ok, true);
  backend.call = call;
  await open(page, { backend, nowMs: BEFORE, tab: "days" });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
  if (go) {
    await until(() => visible(page, "#beforeBtn"), "the Before tab is in the bar");
    await page.dispatchEvent('#nav button[data-tab="before"]', "click");
    await until(() => visible(page, "#todos"), "the list shows");
  }
  return backend;
}
const row = (id) => '#bwOpen .bw-r[data-id="' + id + '"]';
async function openRow(page, id) {
  await page.dispatchEvent(row(id) + " .bw-b", "click");
  await until(() => page.evaluate((s) => document.querySelector(s).classList.contains("is-open"), row(id)), "row " + id + " opens");
  await page.waitForTimeout(260);
}
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.getElementById("vBefore").scrollTo(0, 0));
  await page.waitForTimeout(80);
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
};

// Nothing sticks out of the pad or the screen; every control is at least 44 px; the foot clears the bar.
const fits = (page) =>
  page.evaluate(() => {
    const bad = [];
    const view = document.getElementById("vBefore");
    if (document.documentElement.scrollWidth > innerWidth) bad.push("sideways scroll");
    if (view.scrollWidth > view.clientWidth) bad.push("the view scrolls sideways");
    const list = document.getElementById("todos");
    if (list.scrollWidth > list.clientWidth) bad.push("the list is wider than its box (the binding?)");
    const card = document.getElementById("bwCard").getBoundingClientRect();
    for (const el of document.querySelectorAll("#bwCard .rv-h, #bwCard .bw-r, #bwCard .bw-d, #bwCard .bw-dn, #bwCard .bw-foot, #bwCard .bw-ctl > *")) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.left < card.left - 0.5 || r.right > card.right + 0.5)) bad.push(el.className + " leaves the pad");
    }
    for (const el of document.querySelectorAll("#bwCard .bw-b, #bwCard .bw-claim, #bwCard a.bw-link, #bwCard .bw-tick, #bwCard .bw-dn, #bwCard .bw-fetch")) {
      if (el.closest("[inert]") || !el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) bad.push(el.className + " is " + Math.round(r.width) + "x" + Math.round(r.height));
    }
    // The longest name wraps inside its slip and never under the counterfoil.
    for (const row of document.querySelectorAll("#bwOpen .bw-r")) {
      const stub = row.querySelector(".rv-stub").getBoundingClientRect();
      const n = row.querySelector(".bw-n").getBoundingClientRect();
      if (n.left < stub.right - 0.5) bad.push("a name runs under its counterfoil");
    }
    return bad;
  });
// The last thing on the pad can be scrolled clear of the bar (or, held sideways, of the rail).
const clearsBar = (page) =>
  page.evaluate(() => {
    const view = document.getElementById("vBefore");
    view.scrollTo(0, view.scrollHeight);
    const nav = document.getElementById("nav").getBoundingClientRect();
    const f = document.querySelector("#bwCard").getBoundingClientRect();
    const v = view.getBoundingClientRect();
    const under = nav.left < v.right && nav.right > v.left && nav.top < f.bottom && nav.bottom > f.top;
    view.scrollTo(0, 0);
    return !under;
  });

function sizeCase(size, mobile, tag) {
  return {
    name: tag + ": the pad fits, open, ticked and with the done slips out",
    viewport: size,
    ...(mobile ? {} : { mobile: false }),
    async run({ page }) {
      const backend = await ready(page, { claims: { 5: "Ajen", 4: "Mo" } });
      assert.deepEqual(await fits(page), []);
      assert.ok(await clearsBar(page), "the foot is under the bar");
      await shot(page, "1A-" + tag + "-pad");
      await openRow(page, "5");
      assert.deepEqual(await fits(page), []);
      await shot(page, "1A-" + tag + "-open");
      await page.dispatchEvent(row(5) + " .bw-tick", "click");
      await until(() => page.$(row(5) + ".is-landed .bw-spot .stamp"), "the stamp lands");
      await page.waitForTimeout(500);
      assert.deepEqual(await fits(page), []);
      await shot(page, "1A-" + tag + "-ticked");
      await advance(page, backend, 1700);
      await until(() => visible(page, "#bwDone"), "done opens");
      await page.waitForTimeout(300);
      assert.deepEqual(await fits(page), []);
      assert.ok(await clearsBar(page), "the foot is under the bar with done open");
      await shot(page, "1A-" + tag + "-done");
    },
  };
}

module.exports = [
  {
    name: "the pad's form: a binding, 予約票 under a double rule in indigo, a counterfoil per slip with its number and seal, 予約するもの on each slip, torn-off slips below a dashed tear",
    async run({ page }) {
      await ready(page, { claims: { 5: "Ajen" } });
      assert.equal(await page.evaluate(() => document.getElementById("bwCard").classList.contains("rv")), true);
      assert.equal(await page.$$eval("#bwCard > .rv-bind > i", (n) => n.length), 6, "six holes in the binding");
      await expectText(page, "#bwTitle", "予約票Reservation slips · Before we go");
      const head = await page.evaluate(() => {
        const h = getComputedStyle(document.querySelector("#bwCard .bw-band"));
        const t = getComputedStyle(document.querySelector("#bwTitle span"));
        const card = getComputedStyle(document.getElementById("bwCard"));
        return { rule: h.borderBottomStyle + " " + h.borderBottomWidth, ink: t.color, bg: h.backgroundColor, paper: card.backgroundColor };
      });
      assert.deepEqual(head, { rule: "double 3px", ink: "rgb(40, 64, 143)", bg: "rgba(0, 0, 0, 0)", paper: "rgb(244, 241, 232)" });
      // The counterfoil: the planner's number, then who is on it; a dotted tear line between it and the slip.
      const nos = await page.$$eval("#bwOpen .bw-r .rv-no", (n) => n.map((x) => x.textContent));
      assert.deepEqual(nos, ["No.04", "No.05", "No.06", "No.07"]);
      const stub = await page.evaluate(() => {
        const s = document.querySelector('#bwOpen .bw-r[data-id="5"] .rv-stub');
        const cs = getComputedStyle(s);
        const r = s.getBoundingClientRect();
        const row = s.closest(".bw-r").getBoundingClientRect();
        return { w: Math.round(r.width), tear: cs.borderRightStyle + " " + cs.borderRightWidth, full: Math.abs(r.height - row.height) < 1.5, seal: !!s.querySelector(".bw-seal"), sealText: s.querySelector(".bw-seal").textContent.length > 0 };
      });
      assert.deepEqual(stub, { w: 62, tear: "dotted 2px", full: true, seal: true, sealText: true });
      assert.equal(await page.evaluate(() => document.querySelector('#bwOpen .bw-r[data-id="6"] .bw-seal').classList.contains("is-empty")), true, "nobody on it: the empty ring");
      await expectText(page, row(6) + " .rv-l", "予約するもの Booking");
      assert.equal(await page.evaluate((s) => document.querySelector(s).getAttribute("aria-hidden"), row(6) + " .rv-l"), "true", "the label is print, not part of the button's name");
      assert.equal(await page.evaluate((s) => document.querySelector(s).textContent.includes("予約"), row(6) + " .bw-b"), true);
      // The done slips: numbered, sealed, below the dashed tear.
      await page.dispatchEvent("#bwDoneB", "click");
      await until(() => visible(page, "#bwDone"), "done opens");
      assert.deepEqual(await page.$$eval("#bwDone .bw-d .rv-no", (n) => n.map((x) => x.textContent)), ["No.01", "No.02", "No.03"]);
      const tear = await page.evaluate(() => {
        const p = getComputedStyle(document.querySelector("#bwCard .bw-perf"));
        const b = document.getElementById("bwDoneB").getBoundingClientRect();
        const rows = document.getElementById("bwOpen").getBoundingClientRect();
        return { line: p.borderTopStyle + " " + p.borderTopWidth, below: b.top >= rows.bottom - 0.5 };
      });
      assert.deepEqual(tear, { line: "dashed 2px", below: true });
      await expectText(page, "#bwDoneB", "済 Torn off and done (3)");
    },
  },
  {
    name: "the open slip's counterfoil is tinted, and a counterfoil is as tall as its slip, open or shut",
    async run({ page }) {
      await ready(page);
      await openRow(page, "5");
      const tint = await page.evaluate(() => getComputedStyle(document.querySelector('#bwOpen .bw-r[data-id="5"] .rv-stub')).backgroundColor);
      assert.notEqual(tint, "rgba(0, 0, 0, 0)", "the open stub is tinted");
      const shut = await page.evaluate(() => getComputedStyle(document.querySelector('#bwOpen .bw-r[data-id="6"] .rv-stub')).backgroundColor);
      assert.equal(shut, "rgba(0, 0, 0, 0)");
      // Open and shut, the stub is as tall as its slip.
      for (const id of ["5", "6"]) {
        const same = await page.evaluate((s) => {
          const r = document.querySelector(s);
          return Math.abs(r.querySelector(".rv-stub").getBoundingClientRect().height - r.getBoundingClientRect().height) < 1.5;
        }, row(id));
        assert.ok(same, "stub of " + id);
      }
    },
  },
  {
    name: "the stamped row and the pending states wear the pad too: counterfoil on the landed slip, a pending claim dimmed, the planner's pending line inside the slip",
    async run({ page }) {
      const backend = await ready(page);
      await openRow(page, "6");
      // The backend holds its answer: the claim stays pending, as it does on a slow signal.
      const handle = backend.handle.bind(backend);
      let release;
      const held = new Promise((r) => (release = r));
      backend.handle = async (body) => (body.action === "claimTodo" ? (await held, handle(body)) : handle(body));
      await page.dispatchEvent(row(6) + " .bw-claim", "click");
      await until(() => page.evaluate((s) => document.querySelector(s).classList.contains("is-pending"), row(6)), "the claim is pending");
      assert.ok((await page.$$eval(row(6) + " .rv-stub", (n) => n.length)) === 1);
      await shot(page, "1A-393x852-pending");
      release();
      backend.handle = handle;
      backend.fake.planner.cellFails = true;
      await openRow(page, "4");
      await page.dispatchEvent(row(4) + " .bw-tick", "click");
      await until(() => page.$(row(4) + ".is-landed .rv-stub .bw-seal"), "the landed slip has its counterfoil");
      await expectText(page, row(4) + " .rv-no", "No.04");
      await until(() => page.evaluate((s) => { const p = document.querySelector(s); return p && !p.hidden; }, row(4) + " .bw-pl"), "the pending line");
      await page.waitForTimeout(400);
      assert.deepEqual(await fits(page), []);
      await shot(page, "1A-393x852-planner-pending");
      await advance(page, backend, 1700);
      await until(() => page.$('#bwDone .bw-d[data-id="4"] .bw-pl'), "the done slip carries the pending line");
      assert.ok(await page.$('#bwDone .bw-d[data-id="4"] .rv-stub .bw-seal'));
      assert.deepEqual(await fits(page), []);
      await shot(page, "1A-393x852-done-pending");
    },
  },
  {
    name: "text from the planner stays text: markup in an item's name is printed as written",
    async run({ page }) {
      const be = makeBackend({ ...SEED, plannerId: PLANNER_ID, plannerTabs: { "Book Now": [["Before we go: bookings"], BHEAD, brow({ "#": 4, Item: "<b>bold</b> <img src=x>", "Book by": "2026-11-20", Status: "Not booked" })], "Change Log": [CHEAD] } }, { now: BEFORE });
      be.now = BEFORE - 5 * 60000;
      await be.fake({ key: "test-key", actor: "Mo", action: "syncTodos", args: {} });
      be.now = BEFORE;
      await open(page, { backend: be, nowMs: BEFORE, tab: "days" });
      await until(() => visible(page, "#beforeBtn"), "the Before tab is in the bar");
      await page.dispatchEvent('#nav button[data-tab="before"]', "click");
      await until(() => visible(page, "#todos"), "the list shows");
      assert.equal(await text(page, "#bwOpen .bw-n"), "<b>bold</b> <img src=x>");
      assert.equal(await page.$("#bwOpen .bw-n b, #bwOpen .bw-n img"), null);
    },
  },
  sizeCase({ width: 393, height: 852 }, true, "393x852"),
  sizeCase({ width: 320, height: 568 }, true, "320x568"),
  sizeCase({ width: 844, height: 390 }, true, "844x390"),
  sizeCase({ width: 1440, height: 900 }, false, "1440x900"),
];
