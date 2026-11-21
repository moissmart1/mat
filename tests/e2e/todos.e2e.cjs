/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Tasks 20 and 22: "Before we go" (出発前) on its own Before tab. The fake backend runs the
// real backend actions over a fake planner (tests/fake-backend.cjs): its Book
// Now tab is pulled into the Todos tab, a tick writes Booked back to it (or
// cannot: fake.planner.cellFails), and every write it receives is recorded.
// Every item, note, link and id here is made up.

const shotPath = require("./shots.cjs");
const assert = require("node:assert/strict");
const { SEED, NOON12, makeBackend, open, advance, until, text, expectText, visible } = require("./helpers.cjs");

const PLANNER_ID = "fakePlannerSheet_0123456789abcdefXYZ";
const BHEAD = ["#", "Item", "Who", "Book by", "Status", "Notes", "Booking link"];
const brow = (o) => BHEAD.map((h) => (o[h] === undefined ? "" : o[h]));
const CHEAD = ["#", "Date / time", "Agent / session", "Tab", "Cell(s)", "Item", "Old value", "New value", "Why", "Proof / source", "Verified?"];
const ITEMS = [
  { "#": 1, Item: "Rail pass seat reservations", "Book by": "2026-11-14", Status: "Not booked", Notes: "Window seats for three, both legs.", "Booking link": "https://rail.example.test/book?leg=1" },
  { "#": 2, Item: "Tea ceremony class", "Book by": "2026-11-18", Status: "Pending" },
  { "#": 3, Item: "Snow park day trip", "Book by": "Dec 5", Status: "Not booked", Notes: "Buses leave early." },
  { "#": 4, Item: "Airport bus tickets", Status: "" },
  { "#": 5, Item: "Pocket wifi pickup", "Book by": "2026-11-10", Status: "Booked" },
];
// 14:00 on Mon Nov 16 in Toronto (04:00 on the 17th in Japan): before the trip.
const BEFORE = Date.parse("2026-11-16T19:00:00Z");
// A minute to midnight before the trip's first day (Dec 10) in Japan: from
// midnight the Tickets key has Before's place (js/views/passcase.js).
const EVE = Date.parse("2026-12-09T23:59:00+09:00");
const MIN = 60000;

function seedWith(items = ITEMS) {
  return { ...SEED, plannerId: PLANNER_ID, plannerTabs: { "Book Now": [["Before we go: bookings"], BHEAD, ...items.map(brow)], "Change Log": [CHEAD] } };
}

// A backend whose list was pulled `ago` ms before `nowMs` (null: never pulled).
async function listBackend({ nowMs = BEFORE, items = ITEMS, ago = 5 * MIN, claims = {} } = {}) {
  const backend = makeBackend(seedWith(items), { now: nowMs });
  const call = (action, args, actor = "Mo") => backend.fake({ key: "test-key", actor, action, args });
  if (ago !== null) {
    backend.now = nowMs - ago;
    const r = await call("syncTodos", {});
    assert.equal(r.ok, true, JSON.stringify(r));
    backend.now = nowMs;
  }
  for (const [id, who] of Object.entries(claims)) assert.equal((await call("claimTodo", { id, on: true }, who)).ok, true);
  backend.requests.length = 0;
  backend.call = call;
  return backend;
}

// Opens the app and goes to the Before tab (opts.go = false: stay on Days).
async function ready(page, opts = {}) {
  const { nowMs = BEFORE, backend, go = true } = opts;
  const be = backend || (await listBackend(opts));
  await open(page, { backend: be, nowMs, tab: "days", own: opts.own || null });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
  if (go) await goBefore(page);
  return be;
}

// Taps the Before tab (once it is in the bar) and waits for the list to show.
async function goBefore(page) {
  await until(() => visible(page, "#beforeBtn"), "the Before tab is in the bar");
  await page.click('#nav button[data-tab="before"]');
  await until(() => visible(page, "#todos"), "the list shows");
}
const tabIsIn = (page) => visible(page, "#beforeBtn");
const onScreen = (page) => page.evaluate(() => document.querySelector(".view.is-active").id);

const rowIds = (page, box = "#bwOpen") => page.evaluate((b) => [...document.querySelectorAll(b + " > [data-id]")].map((r) => r.dataset.id), box);
const row = (id) => '#bwOpen .bw-r[data-id="' + id + '"]';
const sent = (backend, action) => backend.requests.filter((r) => r.action === action);
const stored = (backend, id) => backend.fake.tables.Todos.find((r) => r.id === id);
// The day of an instant in Japan (the test phone's own zone), as "Nov 17".
const phoneDay = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", month: "short", day: "numeric" }).format(new Date(ms));

// The thud's audio, counted: window.__thuds goes up each time it sounds.
function stubSound(page) {
  return page.evaluate(() => {
    window.__thuds = 0;
    window.AudioContext = function () {
      return { state: "running", currentTime: 0, destination: {}, createOscillator: () => ({ type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() { window.__thuds++; }, stop() {} }), createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }) };
    };
  });
}

// Book Now's row for item n in seedWith's tab (a title row, then the header).
const bookRow = (backend, n) => backend.fake.planner.tabs["Book Now"].find((r) => r[0] === n);

async function openRow(page, id) {
  await page.click(row(id) + " .bw-b");
  await until(() => page.evaluate((sel) => document.querySelector(sel).classList.contains("is-open"), row(id)), "row " + id + " opens");
}

// Taps Tick it off on an open row once, and checks the app took the tap: tick()
// draws the row stamped before anything is sent, so it is stamped at once.
// Not page.click: that sends the press and the release as two messages and the
// page runs in between; a redraw there that replaces the button loses the tap.
// On GitHub (PR 64, slice 3) a tap was lost that way or another: the case timed
// out on "ticked" with row 1 open and never stamped. Here the checks and the
// tap are one step in the page. What Playwright's click would check is checked
// first: the button is drawn, not inert, in the window, and it is what a finger
// at its centre touches (nothing covers it, the opening row no longer clips it).
async function tapTick(page, id) {
  let why = "";
  const tapped = await until(async () => {
    const r = await page.evaluate(([s, rowSel]) => {
      const b = document.querySelector(s);
      if (!b) return "no Tick it off";
      if (b.closest("[inert]")) return "Tick it off is inert";
      const box = b.getBoundingClientRect();
      if (!(box.width > 0 && box.height > 0) || getComputedStyle(b).visibility === "hidden") return "Tick it off is not drawn";
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return "Tick it off is out of the window";
      const hit = document.elementFromPoint(x, y);
      if (!hit || !b.contains(hit)) return "Tick it off is covered by " + (hit ? hit.tagName.toLowerCase() + [...hit.classList].map((c) => "." + c).join("") : "nothing");
      b.click();
      return { landed: document.querySelector(rowSel).classList.contains("is-landed") };
    }, [row(id) + " .bw-tick", row(id)]);
    if (typeof r === "string") why = r;
    return typeof r === "object" && r;
  }, "Tick it off on row " + id + " can be tapped").catch((e) => {
    throw new Error(e.message + " (" + why + ")");
  });
  // Tapped once, and never again: a tap the app drops is a failure here, not a retry.
  assert.equal(tapped.landed, true, "the app took the tap on row " + id + " (the row is stamped)");
}

// A finger on Tick it off, as pointer events sent from the page itself. Playwright's mouse
// sends down and up as separate messages and aims at where the button was measured; on a
// slow runner (the row is still opening, a font settles) the press can land beside the
// button and the case then proves nothing. Here the press goes to the button itself.
// The page clock is faked, so event time stamps only move when the case moves the clock.
async function pressTick(page, id) {
  await until(() => page.evaluate((s) => { const b = document.querySelector(s); return !!b && b.getBoundingClientRect().width > 0; }, row(id) + " .bw-tick"), "Tick it off is drawn on row " + id);
  await page.evaluate((s) => {
    const b = document.querySelector(s);
    const r = b.getBoundingClientRect();
    window.__finger = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const o = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, buttons: 1, clientX: window.__finger.x, clientY: window.__finger.y };
    b.dispatchEvent(new PointerEvent("pointerdown", o));
  }, row(id) + " .bw-tick");
}
// The finger comes up on whatever is now drawn where the button was.
async function releaseTick(page, id) {
  await page.evaluate((s) => {
    const b = document.querySelector(s);
    const f = window.__finger;
    (b || document.body).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, buttons: 0, clientX: f.x, clientY: f.y }));
  }, row(id) + " .bw-tick");
}

module.exports = [
  {
    name: "before the trip the list is on the Before tab: open items by book-by date, the due lines, the seals, done folded, the fetch line; Days shows none of it",
    async run({ page }) {
      const backend = await ready(page, { claims: { 2: "Ajen" } });
      assert.ok(await visible(page, "#todos"));
      assert.equal(await onScreen(page), "vBefore");
      assert.equal(await page.evaluate(() => document.getElementById("todos").closest("#vBefore") !== null), true, "the list is in the Before view");
      assert.equal(await page.$("#bwFold"), null, "no folded row any more");
      // Days has no list in it.
      assert.equal(await page.$("#vDays #todos, #vDays .bw"), null, "no list inside Days");
      await expectText(page, "#vDays #dayCount", /in 23 days/);
      await expectText(page, "#bwTitle", "予約票Reservation slips · Before we go");
      await expectText(page, "#bwCard .bw-band .num", "4open");
      assert.deepEqual(await rowIds(page), ["1", "2", "3", "4"]);
      await expectText(page, row(1) + " .bw-due", "was due Sat Nov 14 · 2 days late");
      assert.equal(await page.evaluate((s) => document.querySelector(s).classList.contains("is-late"), row(1) + " .bw-due"), true);
      const late = await page.evaluate((s) => getComputedStyle(document.querySelector(s)).color, row(1) + " .bw-due");
      assert.equal(late, "rgb(214, 60, 30)", "late is in the vermilion ink");
      await expectText(page, row(2) + " .bw-due", "by Wed Nov 18 · in 2 days");
      await expectText(page, row(2) + " .bw-due b", "Wed Nov 18");
      await expectText(page, row(3) + " .bw-due", "by Sat Dec 5 · in 19 days");
      assert.equal(await page.$(row(3) + " .bw-due b"), null, "not heavier 19 days out");
      assert.equal(await page.$(row(4) + " .bw-due"), null, "no date, no due line");
      // Ajen is on #2: his seal; nobody on the others: an empty ring.
      assert.equal(await page.evaluate((s) => document.querySelector(s).classList.contains("is-empty"), row(2) + " .bw-seal"), false);
      assert.ok((await text(page, row(2) + " .bw-seal")).length > 0);
      assert.equal(await page.evaluate((s) => document.querySelector(s).classList.contains("is-empty"), row(1) + " .bw-seal"), true);
      await expectText(page, row(2) + " .bw-b", /Ajen is on it/);
      await expectText(page, "#bwDoneB", "済 Torn off and done (1)");
      assert.equal(await visible(page, "#bwDone"), false, "done is folded");
      await expectText(page, "#bwAt", /^From the planner · fetched \d\d:\d\d$/);
      // Fetched 5 minutes ago: no fetch of its own.
      assert.equal(sent(backend, "syncTodos").length, 0);
      // Nothing opens by itself; the controls are out of reach while closed.
      assert.equal(await page.evaluate(() => document.querySelectorAll("#bwOpen .bw-r.is-open").length), 0);
      assert.equal(await page.evaluate((s) => document.querySelector(s).inert, row(1) + " .bw-more"), true);
      // The done group lists the planner's own booking, plainly.
      await page.click("#bwDoneB");
      await expectText(page, '#bwDone .bw-d[data-id="5"] .bw-n', "Pocket wifi pickup");
      await expectText(page, '#bwDone .bw-d[data-id="5"] .bw-due', "Booked in the planner");
      assert.equal(await page.$$eval("#bwDone button, #bwDone a", (n) => n.length), 0, "no controls in the done group");
    },
  },
  {
    name: "the Before tab: named with the count, the count matches the open rows and follows a tick, and focus and the screen are Days-like",
    async run({ page }) {
      const backend = await ready(page, { claims: { 2: "Ajen" } });
      const bar = () =>
        page.evaluate(() => {
          const b = document.getElementById("beforeBtn");
          const names = [...document.querySelectorAll("#nav [data-tab]")].filter((n) => !n.hidden).map((n) => n.dataset.tab);
          return {
            pill: document.getElementById("beforeN").hidden ? null : document.getElementById("beforeN").textContent,
            name: b.getAttribute("aria-label"),
            current: b.getAttribute("aria-current"),
            active: b.classList.contains("is-active"),
            order: names.join(","),
            rows: document.querySelectorAll("#bwOpen .bw-r:not(.is-landed)").length,
            band: document.querySelector("#bwCard .bw-band .num").textContent,
            small: b.querySelector("small").textContent,
          };
        });
      let b = await bar();
      assert.deepEqual({ ...b }, { pill: "4", name: "Before we go, 4 open", current: "page", active: true, order: "days,before,money", rows: 4, band: "4open", small: "出発前" });
      assert.equal(await page.evaluate(() => document.getElementById("vDays").inert), true, "Days is inert while Before shows");
      await openRow(page, "3");
      await tapTick(page, "3");
      await until(() => stored(backend, "3").ticked_by === "Mo", "ticked");
      b = await bar();
      assert.equal(b.pill, "3");
      assert.equal(b.name, "Before we go, 3 open");
      assert.equal(b.rows, 3, "the pill and the open rows agree");
      assert.equal(b.band, "3open");
      // Back on Days the tab is still there, and Days has no list.
      await page.click('#nav button[data-tab="days"]');
      assert.equal(await onScreen(page), "vDays");
      assert.ok(await tabIsIn(page));
      assert.equal(await page.$("#vDays #todos, #vDays .bw"), null);
    },
  },
  // Three cases, not one: as one case with four phones it took 13 s at the
  // median on GitHub (19 s at worst) and ran past the 30 s budget under load.
  {
    name: "before the trip the tab is there with 0 open; no planner or no items: no tab",
    async run({ page, newPhone }) {
      // Before the trip, everything done: still there, count 0 and no pill.
      await ready(page, { items: [ITEMS[4]] });
      assert.equal(await page.evaluate(() => document.getElementById("beforeBtn").getAttribute("aria-label")), "Before we go");
      assert.equal(await visible(page, "#beforeN"), false, "no pill at 0");
      // Never loaded (no planner): no tab.
      const other = await newPhone();
      const none = makeBackend(SEED, { now: BEFORE });
      await open(other, { backend: none, nowMs: BEFORE, tab: "days" });
      await until(() => other.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
      assert.equal(await visible(other, "#beforeBtn"), false, "no list, no tab");
      assert.equal(await other.evaluate(() => document.getElementById("beforeBtn").hidden), true);
    },
  },
  {
    name: "during the trip with nothing open: no Before key, Tickets has its place, and no slip on it",
    async run({ page: third }) {
      // During the trip with nothing open: no Before key; Tickets has its place, with no slip.
      await ready(third, { nowMs: NOON12, items: [ITEMS[4]], go: false });
      await third.evaluate(() => window.__matTest.store.idle());
      assert.equal(await tabIsIn(third), false, "trip on: no Before key");
      await until(() => visible(third, "#ticketsBtn"), "the Tickets key has its place");
      assert.equal(await third.$("#vDays #todos, #vDays .bw"), null, "and no list in Days");
      await third.click("#ticketsBtn");
      await until(() => third.evaluate(() => !!document.querySelector("#vTickets .pc-case")), "the case shows");
      assert.equal(await third.$("#pcSlip"), null, "nothing open: no slip");
    },
  },
  {
    name: "during the trip no Before key (Tickets has its place) and the open items are a slip on Tickets that goes with the last tick",
    async run({ page: fourth }) {
      // During the trip with one open: still no Before key; the slip on Tickets holds it.
      const backend = await ready(fourth, { nowMs: NOON12, items: [ITEMS[1], ITEMS[4]], go: false });
      await until(() => visible(fourth, "#ticketsBtn"), "Tickets in the bar");
      assert.equal(await tabIsIn(fourth), false, "no Before key on a trip day");
      assert.equal(await fourth.$("#vDays #todos, #vDays .bw"), null, "no list, no folded card, inside Days");
      assert.equal(await fourth.$("#bwFold"), null);
      await fourth.click("#ticketsBtn");
      await until(() => visible(fourth, "#pcSlip"), "the slip");
      await expectText(fourth, "#pcSlip", "予約票1 still to bookOpen");
      const asSheet = (p) => p.evaluate(() => document.getElementById("vBefore").classList.contains("as-sheet") && document.getElementById("vBefore").classList.contains("is-active"));
      await fourth.click("#pcSlip");
      await until(() => asSheet(fourth), "the pad as a sheet over Tickets");
      await expectText(fourth, row(2) + " .bw-due", /was due Wed Nov 18 · \d+ days late/);
      await openRow(fourth, "2");
      await tapTick(fourth, "2");
      await until(() => stored(backend, "2").ticked_by === "Mo", "ticked");
      assert.equal(await asSheet(fourth), true, "the stamp is seen first");
      await advance(fourth, backend, 1700);
      await until(async () => !(await asSheet(fourth)), "the sheet goes once all is done");
      await until(async () => !(await visible(fourth, "#pcSlip")), "and the slip with it");
      assert.equal(await onScreen(fourth), "vTickets", "ticking the last one leaves you on Tickets");
      assert.equal(await fourth.evaluate(() => document.activeElement && document.activeElement.id), "ticketsBtn", "focus goes to the Tickets key, not lost");
      // A later sync that brings an item back brings the slip back and does not take focus.
      assert.equal((await backend.call("undo", { logId: Number(backend.fake.tables.Log[backend.fake.tables.Log.length - 1].id) }, "Ajen")).ok, true);
      await fourth.evaluate(() => window.__matTest.store.checkRev());
      await until(() => visible(fourth, "#pcSlip"), "back, open again");
      assert.equal(await onScreen(fourth), "vTickets", "still on Tickets");
      assert.equal(await tabIsIn(fourth), false, "and still no Before key");
      assert.equal(await fourth.evaluate(() => document.activeElement && document.activeElement.id), "ticketsBtn", "focus left where it was");
    },
  },
  {
    name: "a row opens in place: the whole item, the note, the controls named with the item; the booking opens in a new tab",
    async run({ page, context }) {
      await ready(page, { claims: { 2: "Ajen" } });
      await openRow(page, "1");
      await expectText(page, row(1) + " .bw-note", "Window seats for three, both legs.");
      const link = await page.$eval(row(1) + " a.bw-link", (a) => ({ href: a.href, target: a.target, rel: a.rel, text: a.textContent, name: a.getAttribute("aria-label") }));
      assert.deepEqual(link, { href: "https://rail.example.test/book?leg=1", target: "_blank", rel: "noopener", text: "Open the booking ↗", name: "Open the booking for Rail pass seat reservations" });
      const names = await page.$$eval(row(1) + " button", (b) => b.map((x) => x.getAttribute("aria-label") || x.textContent.trim()));
      assert.ok(names.every((n) => n.includes("Rail pass seat reservations")), names.join(" | "));
      await expectText(page, row(1) + " .bw-claim", "I’ll do it");
      await expectText(page, row(1) + " .bw-tick", "Tick it off済");
      // Weight: the link is outlined like I’ll do it; the stamp spot alone is a solid vermilion ring.
      const look = await page.evaluate((s) => {
        const cs = (q) => getComputedStyle(document.querySelector(s + " " + q));
        const a = cs("a.bw-link");
        const c = cs(".bw-claim");
        const g = cs(".bw-tick .ghost");
        return { linkFill: a.backgroundColor, sameBorder: a.borderTopStyle === c.borderTopStyle && a.borderTopWidth === c.borderTopWidth && a.fontWeight === c.fontWeight, ring: g.borderTopStyle + " " + g.borderTopWidth, ringInk: g.borderTopColor };
      }, row(1));
      assert.deepEqual(look, { linkFill: "rgba(0, 0, 0, 0)", sameBorder: true, ring: "solid 2px", ringInk: "rgb(214, 60, 30)" });
      // No link: no link control.
      await openRow(page, "3");
      assert.equal(await page.evaluate((s) => document.querySelector(s).classList.contains("is-open"), row(1)), false, "opening one closes the other");
      assert.equal(await page.$(row(3) + " a"), null);
      await expectText(page, row(2) + " .bw-claim", "Take it over");
      // The link opens its address in a new tab.
      await openRow(page, "1");
      const [tab] = await Promise.all([context.waitForEvent("page"), page.click(row(1) + " a.bw-link")]);
      assert.equal(tab.url(), "https://rail.example.test/book?leg=1");
      await tab.close();
      // A sync while it is open leaves it open.
      await page.evaluate(() => window.__matTest.store.checkRev());
      assert.equal(await page.evaluate((s) => document.querySelector(s).classList.contains("is-open"), row(1)), true);
    },
  },
  {
    name: "I’ll do it, hand it back, take it over: shown at once, saved, said on the undo bar",
    async run({ page }) {
      const backend = await ready(page, { claims: { 2: "Ajen" } });
      await openRow(page, "3");
      await page.click(row(3) + " .bw-claim");
      await expectText(page, "#ubarT", "You’re on Snow park day trip.");
      await until(() => stored(backend, "3").claimed_by === "Mo", "saved as Mo's");
      assert.equal(await page.evaluate((s) => document.querySelector(s).classList.contains("is-empty"), row(3) + " .bw-seal"), false);
      await expectText(page, row(3) + " .bw-claim", "Hand it back");
      assert.equal(await page.evaluate((s) => document.querySelector(s).classList.contains("is-open"), row(3)), true, "still open");
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.act), "claim", "focus stays on the control");

      await page.click(row(3) + " .bw-claim");
      await expectText(page, "#ubarT", "Handed back Snow park day trip.");
      await until(() => stored(backend, "3").claimed_by === "", "handed back");
      assert.equal(await page.evaluate((s) => document.querySelector(s).classList.contains("is-empty"), row(3) + " .bw-seal"), true);

      await openRow(page, "2");
      await page.click(row(2) + " .bw-claim");
      await expectText(page, "#ubarT", "Took over Tea ceremony class.");
      await until(() => stored(backend, "2").claimed_by === "Mo", "taken over");
      await expectText(page, row(2) + " .bw-claim", "Hand it back");
      assert.deepEqual(sent(backend, "claimTodo").map((r) => r.args), [{ id: "3", on: true }, { id: "3", on: false }, { id: "2", on: true }]);

      // History: each kind of entry, the newest of each item with its Undo.
      await page.click("#youBtn");
      await page.click("#setHist");
      const tape = () => page.evaluate(() => [...document.querySelectorAll("#hist .tp-row")].map((r) => [r.querySelector(".tp-s").textContent, !!r.querySelector(".tp-undo")]));
      await until(async () => (await tape()).some(([s]) => s.startsWith("Mo took over")), "History lists the claims");
      const got = await tape();
      for (const want of [["Mo took over: Tea ceremony class, from Ajen", true], ["Mo handed back: Snow park day trip", true], ["Mo is on: Snow park day trip", false]]) {
        assert.ok(got.some((g) => g[0] === want[0] && g[1] === want[1]), JSON.stringify(want) + " in " + JSON.stringify(got));
      }
      await page.evaluate(() => {
        const r = [...document.querySelectorAll("#hist .tp-row")].find((x) => x.querySelector(".tp-s").textContent.startsWith("Mo took over"));
        r.querySelector(".tp-undo").click();
      });
      await until(() => stored(backend, "2").claimed_by === "Ajen", "the undo gives it back to Ajen");
    },
  },
  {
    name: "Tick it off: the stamp lands with its thud, the planner is written, the row moves to done; History has it and its Undo brings it back",
    async run({ page }) {
      const backend = await ready(page);
      await stubSound(page);
      await openRow(page, "3");
      await tapTick(page, "3");
      // Stamped in place, with the settle stamp's hit.
      await until(() => page.$(row(3) + ".is-landed .bw-spot .stamp.hit"), "the stamp lands on the row");
      assert.deepEqual(await rowIds(page), ["1", "2", "3", "4"], "still where it was");
      await until(() => page.evaluate(() => window.__thuds === 1), "the thud, once the tick is taken");
      await expectText(page, row(3) + " .bw-due", "済 Mo · " + phoneDay(BEFORE));
      await expectText(page, "#ubarT", "Ticked off Snow park day trip.");
      await until(() => stored(backend, "3").ticked_by === "Mo" && stored(backend, "3").planner_written === "yes", "ticked and written to the planner");
      assert.deepEqual(backend.fake.planner.writes.map((w) => [w.kind, w.tab, w.cell || "", w.value || ""]), [["cell", "Book Now", "E5", "Booked"], ["append", "Change Log", "", ""]]);
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("bw-tick")), true, "focus on the stamp");
      await expectText(page, "#bwCard .bw-band .num", "3open");

      await advance(page, backend, 1700);
      await until(async () => !(await rowIds(page)).includes("3"), "it moves to the done group");
      assert.ok(await visible(page, "#bwDone"), "the done group opens to show it");
      await expectText(page, "#bwDoneB", "済 Torn off and done (2)");
      assert.deepEqual(await rowIds(page, "#bwDone"), ["3", "5"], "newest first");
      await expectText(page, '#bwDone .bw-d[data-id="3"] .bw-n', "Snow park day trip");
      await expectText(page, '#bwDone .bw-d[data-id="3"] .bw-due', "済 Mo · " + phoneDay(BEFORE));
      assert.equal(await page.evaluate(() => document.querySelector('#bwDone .bw-d[data-id="3"] .bw-seal').classList.contains("is-empty")), false, "the ticker's seal");
      assert.equal(await page.$('#bwDone .bw-d[data-id="3"] .bw-pl'), null, "written: no pending line");
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "bwDoneB");

      await page.click("#youBtn");
      await page.click("#setHist");
      await until(() => page.evaluate(() => [...document.querySelectorAll("#hist .tp-row .tp-s")].some((s) => s.textContent === "Mo ticked off: Snow park day trip")), "History lists the tick");
      await page.evaluate(() => {
        const r = [...document.querySelectorAll("#hist .tp-row")].find((x) => x.querySelector(".tp-s").textContent === "Mo ticked off: Snow park day trip");
        r.querySelector(".tp-undo").click();
      });
      await until(() => stored(backend, "3").ticked_by === "", "undone on the backend");
      await page.click("#histDone");
      await until(async () => (await rowIds(page)).includes("3"), "back among the open items");
      await expectText(page, "#bwDoneB", "済 Torn off and done (1)");
      assert.ok(await visible(page, "#bwDone"), "still open while the Before tab stays the screen");
      // It does not stay open: the next time the Before tab is shown it is folded again.
      await page.click('#nav button[data-tab="money"]');
      await page.click('#nav button[data-tab="before"]');
      await until(async () => !(await visible(page, "#bwDone")), "folded again");
      assert.equal(await page.getAttribute("#bwDoneB", "aria-expanded"), "false");
    },
  },
  {
    name: "a tick the planner can’t take yet: done in the app, and a line says the planner hasn’t been updated yet",
    async run({ page }) {
      const backend = await ready(page);
      backend.fake.planner.cellFails = true;
      await openRow(page, "1");
      await tapTick(page, "1");
      await until(() => stored(backend, "1").ticked_by === "Mo", "ticked");
      await until(() => page.evaluate((s) => { const p = document.querySelector(s); return p && !p.hidden; }, row(1) + " .bw-pl"), "the pending line on the stamped row");
      await advance(page, backend, 1700);
      await until(() => page.$('#bwDone .bw-d[data-id="1"]'), "moved to done");
      await expectText(page, '#bwDone .bw-d[data-id="1"] .bw-pl', "The planner hasn’t been updated yet.");
      assert.equal(stored(backend, "1").planner_written, "");
      // The next fetch writes it, and the line goes.
      backend.fake.planner.cellFails = false;
      await page.click("#bwFetch");
      await until(() => stored(backend, "1").planner_written === "yes", "the fetch writes it");
      await until(async () => (await page.$('#bwDone .bw-d[data-id="1"] .bw-pl')) === null, "the line goes");
    },
  },
  {
    name: "a tick refused (another phone ticked it first) rolls back with the usual notice; offline it is not saved",
    async run({ page }) {
      const backend = await ready(page);
      await stubSound(page);
      assert.equal((await backend.call("tickTodo", { id: "4" }, "Ajen")).ok, true);
      await openRow(page, "4");
      await tapTick(page, "4");
      await expectText(page, "#ubarT", "That one is already done.");
      await until(() => page.evaluate((s) => { const r = document.querySelector(s); return !r || !r.classList.contains("is-landed"); }, row(4)), "no longer stamped");
      await advance(page, backend, 1700);
      assert.equal(await page.evaluate(() => window.__thuds), 0, "no thud for a tick refused");

      await page.context().setOffline(true);
      await openRow(page, "1");
      await tapTick(page, "1");
      await expectText(page, "#ubarT", "No signal. That wasn’t saved.");
      await until(async () => (await rowIds(page)).includes("1") && !(await page.$(row(1) + ".is-landed")), "back to open");
      assert.equal(stored(backend, "1").ticked_by, "");
      assert.equal(await page.evaluate(() => window.__thuds), 0, "no thud offline either");
      await page.context().setOffline(false);
    },
  },
  {
    name: "before the trip with everything done: all done, and the done group; no planner or no items: nothing",
    async run({ page, newPhone }) {
      await ready(page, { items: [ITEMS[4]] });
      await expectText(page, "#bwOpen", "済 All done. Nothing left to book.");
      await expectText(page, "#bwDoneB", "済 Torn off and done (1)");
      await expectText(page, "#bwCard .bw-band .num", "0open");

      const other = await newPhone();
      const be = makeBackend(SEED, { now: BEFORE });
      await open(other, { backend: be, nowMs: BEFORE, tab: "days" });
      await until(() => other.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
      assert.equal(await visible(other, "#todos"), false);
      assert.equal(await visible(other, "#beforeBtn"), false, "no planner: no tab");
      assert.equal(be.requests.filter((r) => r.action === "syncTodos").length, 0, "no planner: no fetch");
    },
  },
  {
    name: "fetched quietly once when an hour old, not when fresh; showing the Before tab again does not fetch a fresh list again",
    async run({ page, newPhone }) {
      const stale = await listBackend({ ago: 61 * MIN });
      await ready(page, { backend: stale });
      await until(() => sent(stale, "syncTodos").length === 1, "one fetch on start");
      assert.deepEqual(sent(stale, "syncTodos")[0].args, { force: false });
      await until(() => page.evaluate(() => /fetched/.test(document.getElementById("bwAt").textContent)), "fetched line");
      await page.click('#nav button[data-tab="money"]');
      await page.click('#nav button[data-tab="before"]');
      await page.evaluate(() => window.__matTest.store.idle());
      assert.equal(sent(stale, "syncTodos").length, 1, "fresh now: not again");
      assert.equal(await text(page, "#bwFetch"), "Fetch", "quietly: Fetch never said Fetching");

      const other = await newPhone();
      const fresh = await listBackend({ ago: 59 * MIN });
      await ready(other, { backend: fresh });
      await other.evaluate(() => window.__matTest.store.idle());
      await other.click('#nav button[data-tab="money"]');
      await other.click('#nav button[data-tab="before"]');
      await other.evaluate(() => window.__matTest.store.idle());
      assert.equal(sent(fresh, "syncTodos").length, 0);
    },
  },
  {
    name: "a first fetch of a long list asks again while more remain, then shows it all",
    async run({ page }) {
      const items = [];
      for (let i = 1; i <= 17; i++) items.push({ "#": i, Item: "Made-up booking " + i, "Book by": "2026-12-0" + ((i % 9) + 1), Status: "Not booked" });
      const backend = await ready(page, { items, ago: null });
      await until(() => page.evaluate(() => document.querySelectorAll("#bwOpen .bw-r").length === 17), "all 17 show");
      assert.deepEqual(sent(backend, "syncTodos").map((r) => r.args), [{ force: false }, { force: true }]);
    },
  },
  {
    name: "Fetch says Fetching… then how it went, in place; a quiet fetch that fails twice in a row says so",
    async run({ page }) {
      const backend = await listBackend({ ago: 2 * MIN });
      let release;
      const gate = new Promise((r) => (release = r));
      const handle = backend.handle;
      backend.handle = async (body) => {
        if (body.action === "syncTodos") await gate;
        return handle(body);
      };
      await ready(page, { backend });
      await advance(page, backend, 3 * MIN);
      await page.click("#bwFetch");
      await expectText(page, "#bwFetch", "Fetching…");
      assert.equal(await page.evaluate(() => document.getElementById("bwFetch").disabled), true);
      release();
      await expectText(page, "#bwFetch", "Up to date ✓");
      assert.deepEqual(sent(backend, "syncTodos").map((r) => r.args), [{ force: true }]);
      const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(BEFORE + 3 * MIN));
      await expectText(page, "#bwAt", "From the planner · fetched " + clock);
      await advance(page, backend, 4000);
      await expectText(page, "#bwFetch", "Fetch");

      // A forced fetch within 30 seconds of the last answers the stored list (R49 M3): go past that.
      await advance(page, backend, 30 * 1000);
      backend.fake.planner.fails = true;
      await page.click("#bwFetch");
      await expectText(page, "#bwFetch", "Not fetched");
      await expectText(page, "#ubarT", /planner/);

      // Quiet: an hour later, two failed fetches in a row before anything is said.
      await advance(page, backend, 61 * MIN);
      await page.evaluate(() => window.__matTest.store.clearNotice());
      await page.click('#nav button[data-tab="money"]');
      await page.click('#nav button[data-tab="before"]');
      await until(() => sent(backend, "syncTodos").length === 3, "a quiet fetch");
      await page.evaluate(() => window.__matTest.store.idle());
      assert.equal(await visible(page, "#ubar"), false, "first failure: nothing said");
      await page.click('#nav button[data-tab="money"]');
      await page.click('#nav button[data-tab="before"]');
      await until(() => sent(backend, "syncTodos").length === 4, "another quiet fetch");
      await expectText(page, "#ubarT", /planner/);
    },
  },
  {
    name: "sideways (844 × 390): the Before tab in the rail, a row opens and its controls fit",
    viewport: { width: 844, height: 390 },
    async run({ page }) {
      await ready(page, { claims: { 2: "Ajen" } });
      assert.ok(await visible(page, "#todos"));
      // The rail lists Days, Before, Ring up, Money, You, stacked, each 44 px or more.
      const rail = await railKeys(page);
      assert.deepEqual(rail.map((r) => r.id), FIVE);
      assert.ok(rail.every((r, i) => r.vis && r.h >= 44 && (i === 0 || r.top >= rail[i - 1].bottom - 0.5)), JSON.stringify(rail));
      await openRow(page, "1");
      const fit = await page.evaluate(() => {
        const view = document.getElementById("vBefore").getBoundingClientRect();
        const card = document.getElementById("bwCard").getBoundingClientRect();
        const tick = document.querySelector('#bwOpen .bw-r[data-id="1"] .bw-tick').getBoundingClientRect();
        const ctl = [...document.querySelectorAll('#bwOpen .bw-r[data-id="1"] .bw-ctl > *')].map((n) => n.getBoundingClientRect());
        const all = ctl.length === 3 && ctl.every((b) => b.left >= card.left && b.right <= card.right && b.width > 0);
        return { inside: card.left >= view.left && card.right <= view.right, tickIn: tick.right <= card.right, all, scroll: document.getElementById("vBefore").scrollWidth <= document.getElementById("vBefore").clientWidth };
      });
      assert.deepEqual(fit, { inside: true, tickIn: true, all: true, scroll: true });
    },
  },
  {
    name: "sideways (667 × 375): the five rail keys are in order, stacked and in view without scrolling",
    viewport: { width: 667, height: 375 },
    async run({ page }) {
      await ready(page, { claims: { 2: "Ajen" } });
      const rail = await railKeys(page);
      assert.deepEqual(rail.map((r) => r.id), FIVE);
      assert.ok(rail.every((r, i) => r.vis && r.h >= 44 && (i === 0 || r.top >= rail[i - 1].bottom - 0.5)), JSON.stringify(rail));
    },
  },
  {
    name: "sideways (844 × 390 and 667 × 375): with no Before or Tickets key (before the trip, no planner) the rail is Days, Money, You, Ring up, stacked and in view",
    viewport: { width: 667, height: 375 },
    async run({ page }) {
      await open(page, { backend: makeBackend(SEED, { now: BEFORE }), nowMs: BEFORE, tab: "days" });
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
      await page.evaluate(() => window.__matTest.store.idle());
      assert.equal(await tabIsIn(page), false);
      assert.equal(await visible(page, "#ticketsBtn"), false);
      const rail = await railKeys(page);
      assert.deepEqual(rail.map((r) => r.id), FOUR);
      assert.ok(rail.every((r, i) => r.vis && r.h >= 44 && (i === 0 || r.top >= rail[i - 1].bottom - 0.5)), JSON.stringify(rail));
      await page.setViewportSize({ width: 844, height: 390 });
      const wide = await railKeys(page);
      assert.deepEqual(wide.map((r) => r.id), FOUR);
      assert.ok(wide.every((r, i) => r.vis && r.h >= 44 && (i === 0 || r.top >= wide[i - 1].bottom - 0.5)), JSON.stringify(wide));
    },
  },
  {
    name: "portrait (390 × 844): the open row's controls fit the card and the Tick it off target is large",
    async run({ page }) {
      await ready(page);
      await openRow(page, "1");
      const box = await page.evaluate(() => {
        const card = document.getElementById("bwCard").getBoundingClientRect();
        const tick = document.querySelector('#bwOpen .bw-r[data-id="1"] .bw-tick').getBoundingClientRect();
        return { right: tick.right <= card.right, h: tick.height };
      });
      assert.equal(box.right, true);
      assert.ok(box.h >= 44, "tap target " + box.h);
    },
  },
  {
    name: "what the planner says is only ever text: markup is printed as written, a javascript: link is no link, a long word never pushes the page sideways",
    async run({ page }) {
      const items = [
        { "#": 1, Item: "<img src=x onerror=alert(1)>", "Book by": "2026-11-20", Status: "Not booked", Notes: "<b>bold?</b>", "Booking link": "javascript:alert(1)" },
        { "#": 2, Item: "A".repeat(300), "Book by": "2026-11-21", Status: "Not booked", "Booking link": "http://plain.example.test/x" },
      ];
      let dialogs = 0;
      page.on("dialog", (d) => {
        dialogs += 1;
        d.dismiss().catch(() => {});
      });
      await ready(page, { items });
      await expectText(page, row(1) + " .bw-n", "<img src=x onerror=alert(1)>");
      assert.equal(await page.$("#todos img"), null, "no image made from the item");
      await openRow(page, "1");
      await expectText(page, row(1) + " .bw-note", "<b>bold?</b>");
      assert.equal(await page.$(row(1) + " a"), null, "a javascript: link is no link");
      await openRow(page, "2");
      assert.equal(await page.$(row(2) + " a"), null, "an http: link is no link on the phone");
      const wide = await page.evaluate(() => {
        const v = document.getElementById("vBefore");
        const t = document.getElementById("todos");
        return { view: v.scrollWidth <= v.clientWidth, list: t.scrollWidth <= t.clientWidth };
      });
      assert.deepEqual(wide, { view: true, list: true });
      assert.equal(dialogs, 0, "no dialog fired");
    },
  },
  {
    name: "Fetch tapped while a quiet fetch is under way: that one finishes, then the tap gets its own forced fetch",
    async run({ page }) {
      const backend = await listBackend({ ago: 61 * MIN });
      let release;
      const gate = new Promise((r) => (release = r));
      const handle = backend.handle;
      let held = 0;
      backend.handle = async (body) => {
        if (body.action === "syncTodos" && held++ === 0) await gate;
        return handle(body);
      };
      await ready(page, { backend });
      await until(() => held === 1, "the quiet fetch is out");
      await page.click("#bwFetch");
      await expectText(page, "#bwFetch", "Fetching…");
      release();
      // Within 30 seconds of the last pull the backend answers the stored list: the line shows when that was,
      // and (wave A item 2) so does Fetch, in place of "Up to date ✓".
      await until(() => page.evaluate(() => window.__matTest.store.state.todosPulledAt), "pulled");
      const pulled = await page.evaluate(() => window.__matTest.store.state.todosPulledAt);
      const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Date.parse(pulled)));
      await expectText(page, "#bwFetch", "Read " + clock);
      assert.deepEqual(sent(backend, "syncTodos").map((r) => r.args), [{ force: false }, { force: true }]);
      await expectText(page, "#bwAt", "From the planner · fetched " + clock);
    },
  },
  {
    name: "the planner's own say: an undo that leaves the planner alone is no error; a pull that takes a tick off shows the item open again",
    async run({ page }) {
      const backend = await ready(page);
      const undos = [];
      const handle = backend.handle;
      backend.handle = async (body) => {
        const env = await handle(body);
        if (body.action === "undo") undos.push(env);
        return env;
      };
      // Ticked and written, then someone changes the planner's Status by hand.
      await openRow(page, "3");
      await tapTick(page, "3");
      await until(() => stored(backend, "3").planner_written === "yes", "written");
      bookRow(backend, 3)[4] = "Booked (paid at the desk)";
      await page.click("#ubarU");
      // Wave A item 5: the bar says what became of the planner (was: "Undone." alone).
      await expectText(page, "#ubarT", "Undone. The planner’s Status was changed there since, so it was left as it is.");
      await until(() => stored(backend, "3").ticked_by === "", "undone");
      assert.equal(backend.requests.filter((r) => r.action === "undo").length, 1);
      assert.deepEqual(undos.map((e) => [e.ok, e.data && e.data.planner]), [[true, "kept"]], "the backend answered kept");
      assert.deepEqual(backend.fake.planner.writes.map((w) => w.kind), ["cell", "append"], "the planner was left alone (kept)");
      assert.equal(bookRow(backend, 3)[4], "Booked (paid at the desk)");
      await page.evaluate(() => window.__matTest.store.idle());
      assert.equal(await page.evaluate(() => window.__matTest.store.state.notice), null, "no error said");

      // A tick the planner has not taken; then the planner gives that number to another item.
      backend.fake.planner.cellFails = true;
      await openRow(page, "1");
      await tapTick(page, "1");
      await until(() => stored(backend, "1").ticked_by === "Mo", "ticked");
      await advance(page, backend, 1700);
      await until(() => page.$('#bwDone .bw-d[data-id="1"]'), "done in the app");
      bookRow(backend, 1)[1] = "Rail pass return leg";
      backend.fake.planner.cellFails = false;
      await advance(page, backend, 31 * 1000);
      await page.click("#bwFetch");
      await until(async () => (await rowIds(page)).includes("1"), "open again");
      await expectText(page, row(1) + " .bw-n", "Rail pass return leg");
      assert.equal(await page.evaluate((s) => document.querySelector(s).classList.contains("is-empty"), row(1) + " .bw-seal"), true);
      assert.equal(await page.$('#bwDone .bw-d[data-id="1"]'), null);
    },
  },
];

// Wave A: the items a pull could not read, under the fetch line; and Fetch within 30 seconds of the last.
module.exports.push(
  {
    name: "wave A: the items the last pull could not read show under the fetch line, as text, two lines each; gone once the planner is put right",
    viewport: { width: 393, height: 852 },
    async run({ page }) {
      // #2 and #3 are each in the tab twice (rows 8 and 9: a title row, the header, then five items).
      const items = [...ITEMS, { "#": 2, Item: "Made-up <b>second</b> tea class" }, { "#": 3, Item: "Made-up snow park repeat" }];
      const backend = await ready(page, { items });
      await until(() => visible(page, "#bwProblems"), "the block shows");
      const got = await page.evaluate(() => {
        const box = document.getElementById("bwProblems");
        const r = box.getBoundingClientRect();
        const foot = document.querySelector(".bw-foot").getBoundingClientRect();
        return {
          head: box.querySelector(".bw-pp-h").firstChild.textContent,
          entries: [...box.querySelectorAll(".bw-pp-i")].map((i) => [i.querySelector(".bw-pp-w").textContent, i.querySelector(".bw-pp-m").textContent]),
          bold: box.querySelectorAll("b").length,
          below: r.top >= foot.bottom - 1,
          fits: r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth,
        };
      });
      assert.deepEqual(got, {
        head: "Not read from the planner",
        entries: [["#2 · row 8 · Made-up <b>second</b> tea class", "That number is in the Book Now tab twice."], ["#3 · row 9 · Made-up snow park repeat", "That number is in the Book Now tab twice."]],
        bold: 0, below: true, fits: true,
      });
      await page.evaluate(() => document.getElementById("bwProblems").scrollIntoView({ block: "end" }));
      require("fs").mkdirSync(shotPath("ticks"), { recursive: true });
      await page.screenshot({ path: shotPath("ticks/before-problems.png") });
      // The planner put right: the next real pull clears the block.
      backend.fake.planner.tabs["Book Now"].splice(-2, 2);
      await advance(page, backend, 31 * 1000);
      await page.click("#bwFetch");
      await until(async () => !(await visible(page, "#bwProblems")), "the block goes");
    },
  },
  {
    name: "wave A: Fetch again within 30 seconds says when the planner was read, not Up to date",
    async run({ page }) {
      const backend = await ready(page, { ago: 2 * MIN });
      await advance(page, backend, 3 * MIN);
      await page.click("#bwFetch");
      await expectText(page, "#bwFetch", "Up to date ✓");
      await advance(page, backend, 10 * 1000);
      await page.click("#bwFetch");
      const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(BEFORE + 3 * MIN));
      await expectText(page, "#bwFetch", "Read " + clock);
      assert.equal(sent(backend, "syncTodos").length, 2);
      const bookReads = backend.fake.planner.calls.filter((c) => c.op === "read" && c.tab === "Book Now").length;
      assert.equal(bookReads, 2, "the second fetch read nothing (the backend's own first pull, then the first Fetch)");
    },
  },
);

const FIVE = ["days", "before", "ring", "money", "youBtn"];
const FOUR = ["days", "money", "youBtn", "ring"];
// From the trip's first day: Tickets in Before's place.
const FIVE_T = ["days", "tickets", "ring", "money", "youBtn"];

// The rail's keys, top to bottom: id, top, bottom, height and whether the key is wholly on screen.
function railKeys(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("#nav button")].filter((b) => !b.hidden).map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset.tab || b.id, top: r.top, bottom: r.bottom, h: r.height, vis: r.top >= 0 && r.bottom <= innerHeight };
    }),
  );
}

// The bottom bar's keys, measured: on one line, apart, inside the bar, no text clipped or touching a key's edge, each at least 44 px tall.
async function barShape(page) {
  const ink = await page.evaluateHandle(require("./text-ink.cjs"));
  return page.evaluate((ink) => {
    const navEl = document.getElementById("nav");
    const nav = navEl.getBoundingClientRect();
    const items = [...document.querySelectorAll("#nav button")].filter((b) => !b.hidden);
    const rects = items.map((b) => b.getBoundingClientRect());
    const overlap = [];
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const c = rects[j];
        if (a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5) overlap.push(items[i].textContent + "/" + items[j].textContent);
      }
    const centres = rects.map((r) => r.top + r.height / 2);
    // Every text run inside a key is whole, on one line, and keeps 1.5 px from the key's edges.
    const tight = [];
    for (const [i, b] of items.entries()) {
      const r = rects[i];
      const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const tr = range.getBoundingClientRect();
        if (range.getClientRects().length > 1 || tr.left < r.left + 1.5 || tr.right > r.right - 1.5 || tr.top < r.top || tr.bottom > r.bottom) tight.push((b.id || b.dataset.tab) + ":" + n.textContent.trim() + " text " + Math.round(tr.width * 10) / 10 + " in key " + Math.round(r.width * 10) / 10 + " (" + Math.round((tr.left - r.left) * 10) / 10 + " / " + Math.round((r.right - tr.right) * 10) / 10 + ")");
      }
      const pill = b.querySelector(".pill");
      if (pill && pill.getClientRects().length) {
        const p = pill.getBoundingClientRect();
        if (p.left < r.left || p.right > r.right || p.top < r.top) tight.push("pill out of its key");
      }
    }
    const clipped = items.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent);
    // The pill never covers a word.
    const cover = [];
    const pill = document.getElementById("beforeN");
    if (pill && pill.getClientRects().length) {
      const p = pill.getBoundingClientRect();
      const walker = document.createTreeWalker(document.getElementById("beforeBtn"), NodeFilter.SHOW_TEXT);
      for (let q = walker.nextNode(); q; q = walker.nextNode()) {
        if (!q.textContent.trim() || pill.contains(q)) continue;
        if (ink(q).some(w => p.left < w.right - 0.5 && w.left < p.right - 0.5 &&
          p.top < w.bottom - 0.5 && w.top < p.bottom - 0.5)) cover.push(q.textContent.trim());
      }
    }
    const ring = document.getElementById("ring");
    const rr = ring.getBoundingClientRect();
    const lamp = (b) => ({ id: b.dataset.tab || b.id, bg: getComputedStyle(b, "::before").backgroundColor, display: getComputedStyle(b, "::before").display });
    return {
      ids: items.map((b) => b.dataset.tab || b.id),
      overlap,
      oneLine: Math.max(...centres) - Math.min(...centres) <= 3,
      inside: rects.every((r) => r.left >= nav.left - 0.5 && r.right <= nav.right + 0.5 && r.top >= nav.top && r.bottom <= nav.bottom),
      tall: rects.every((r) => r.height >= 44),
      clipped,
      tight,
      cover,
      pageWide: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      navScroll: [navEl.scrollWidth, navEl.clientWidth],
      ringText: ring.innerText.replace(/\s+/g, " ").trim(),
      ringName: ring.getAttribute("aria-label"),
      ringCentreOff: Math.abs(rr.left + rr.width / 2 - (nav.left + nav.width / 2)),
      tabWidths: items.filter((b) => b !== ring).map((b) => b.getBoundingClientRect().width),
      allWidths: rects.map((r) => r.width),
      gaps: rects.slice(1).map((r, i) => r.left - rects[i].right),
      edges: [rects[0].left - nav.left, nav.right - rects[rects.length - 1].right],
      tabHeights: items.filter((b) => b !== ring).map((b) => b.getBoundingClientRect().height),
      ringHeight: rr.height,
      lamps: items.map(lamp),
    };
  }, ink);
}

// The measured bar in its five-key or four-key state. Returns the id of the one lit lamp.
function checkBar(shape, where, five, ids = null) {
  assert.deepEqual(shape.ids, ids || (five ? FIVE : FOUR), "order " + where);
  assert.deepEqual(shape.overlap, [], "overlap " + where);
  assert.equal(shape.oneLine, true, "one line " + where);
  assert.equal(shape.inside, true, "inside the bar " + where);
  assert.equal(shape.tall, true, "44 px tall " + where);
  assert.deepEqual(shape.clipped, [], "clipped " + where);
  assert.deepEqual(shape.tight, [], "text touching a key's edge or wrapped " + where);
  assert.deepEqual(shape.cover, [], "the pill covers a word " + where);
  assert.equal(shape.pageWide, true, "page wider than the screen " + where);
  assert.equal(shape.navScroll[0], shape.navScroll[1], "the bar scrolls sideways " + where);
  assert.equal(shape.ringName, "Ring up");
  assert.equal(shape.ringText, "＋ Ring up", "Ring up reads ＋ over Ring up " + where);
  assert.ok(shape.gaps.every((g) => Math.abs(g - 6) <= 0.5), "6 px gaps " + where + " " + shape.gaps);
  assert.ok(shape.edges.every((e) => Math.abs(e - 10) <= 0.5), "10 px side padding " + where + " " + shape.edges);
  assert.ok(shape.tabHeights.every((h) => h === 56) && shape.ringHeight === 64, "key heights " + where);
  if (five) {
    assert.ok(shape.ringCentreOff <= 2, "Ring up is " + shape.ringCentreOff + " px off the bar's centre " + where);
    assert.ok(Math.max(...shape.tabWidths) - Math.min(...shape.tabWidths) <= 1, "tab keys are of equal width " + where + " " + shape.tabWidths);
  } else {
    assert.ok(Math.max(...shape.allWidths) - Math.min(...shape.allWidths) <= 1, "all four keys are of equal width " + where + " " + shape.allWidths);
  }
  const lit = shape.lamps.filter((l) => l.display !== "none" && l.bg === "rgb(244, 240, 234)");
  assert.equal(lit.length, 1, "one lamp lit " + where + " " + JSON.stringify(shape.lamps));
  assert.equal(shape.lamps.find((l) => l.id === "ring").display, "none", "Ring up has no lamp");
  assert.ok(shape.lamps.filter((l) => l.id !== "ring" && l.bg !== "rgb(244, 240, 234)").every((l) => l.bg === "rgb(74, 64, 59)"), "off lamps are the lamp-off grey");
  return lit[0].id;
}

for (const width of [320, 375, 390, 430]) {
  module.exports.push({
    name: "the bar at " + width + " px: Days, Before, Ring up, Money, You in that order, Ring up in the centre, equal tab keys, nothing clipped, one lamp lit on the current key",
    viewport: { width, height: 760 },
    async run({ page }) {
      await ready(page, { claims: { 2: "Ajen" }, go: false });
      await until(() => tabIsIn(page), "the Before tab is in the bar");
      for (const tab of ["days", "before"]) {
        await page.click('#nav button[data-tab="' + tab + '"]');
        assert.equal(checkBar(await barShape(page), "on " + tab, true), tab, "the lit lamp is the current key's");
      }
      const pill = await page.evaluate(() => {
        const p = document.getElementById("beforeN").getBoundingClientRect();
        const n = document.getElementById("nav").getBoundingClientRect();
        return { in: p.left >= n.left && p.right <= n.right && p.top >= n.top, text: document.getElementById("beforeN").textContent };
      });
      assert.deepEqual(pill, { in: true, text: "4" });
    },
  });
  module.exports.push({
    name: "the bar at " + width + " px with no Before or Tickets key (before the trip, no planner): Days, Money, You, Ring up, four equal keys, nothing clipped, then at midnight on Day 1 it re-lays to five with Tickets",
    viewport: { width, height: 760 },
    async run({ page }) {
      const backend = await open(page, { backend: makeBackend(SEED, { now: EVE }), nowMs: EVE, tab: "days" });
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
      await page.evaluate(() => window.__matTest.store.idle());
      assert.equal(checkBar(await barShape(page), "four keys before the trip", false), "days");
      await advance(page, backend, 90 * 1000);
      await until(() => visible(page, "#ticketsBtn"), "Day 1: five keys, no reload");
      assert.equal(checkBar(await barShape(page), "five keys with Tickets", true, FIVE_T), "days");
      await page.click("#ticketsBtn");
      assert.equal(checkBar(await barShape(page), "on Tickets", true, FIVE_T), "tickets");
    },
  });
}

module.exports.push({
  name: "Ring up keeps focus when the bar re-lays between four and five keys (midnight on Day 1)",
  async run({ page }) {
    const backend = await open(page, { backend: makeBackend(SEED, { now: EVE }), nowMs: EVE, tab: "days" });
    await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
    await page.focus("#ring");
    assert.equal(await page.evaluate(() => document.activeElement.id), "ring");
    await advance(page, backend, 90 * 1000);
    await until(() => visible(page, "#ticketsBtn"), "five keys");
    assert.equal(await page.evaluate(() => document.getElementById("ring").nextElementSibling.dataset.tab), "money", "Ring up moved to the middle");
    assert.equal(await page.evaluate(() => document.activeElement.id), "ring", "focus stayed on Ring up");
  },
});

module.exports.push({
  name: "the bar is a strip of keys: a black top border, an inset highlight, no outer shadow, no gradient or pseudo-element painting on it, tokens for the new greys",
  async run({ page }) {
    await ready(page, { go: false });
    const edge = await page.evaluate(() => {
      const nav = document.getElementById("nav");
      const cs = getComputedStyle(nav);
      const root = getComputedStyle(document.documentElement);
      const pseudo = (w) => ({ content: getComputedStyle(nav, w).content, image: getComputedStyle(nav, w).backgroundImage, shadow: getComputedStyle(nav, w).boxShadow });
      return {
        before: pseudo("::before"),
        after: pseudo("::after"),
        top: cs.borderTopWidth + " " + cs.borderTopStyle + " " + cs.borderTopColor,
        shadow: cs.boxShadow,
        bg: cs.backgroundImage,
        height: nav.getBoundingClientRect().height,
        barTop: root.getPropertyValue("--bar-top").trim().toLowerCase(),
        lampOff: root.getPropertyValue("--lamp-off").trim().toLowerCase(),
      };
    });
    for (const w of ["before", "after"]) {
      assert.equal(edge[w].content, "none", "no ::" + w + " on the bar");
      assert.equal(edge[w].image, "none");
      assert.equal(edge[w].shadow, "none");
    }
    assert.equal(edge.top, "1px solid rgb(0, 0, 0)");
    assert.equal(edge.shadow, "rgba(255, 255, 255, 0.06) 0px 1px 0px 0px inset", "an inset highlight and no outer shadow");
    assert.ok(/linear-gradient\(rgb\(35, 29, 26\), rgb\(26, 22, 20\) 60%\)/.test(edge.bg), edge.bg);
    assert.equal(edge.height, 82);
    assert.equal(edge.barTop, "#231d1a");
    assert.equal(edge.lampOff, "#4a403b");
  },
});

module.exports.push({
  name: "a tab key is a key: 56 px, 10 px radius, 15 px / 900 label, 10.5 px small label, pressed it moves down 1.5 px; Ring up is paper with a ＋ about 22 px over 10.5 px words",
  viewport: { width: 430, height: 760 },
  async run({ page }) {
    await ready(page, { go: false });
    const k = await page.evaluate(() => {
      const css = (sel, p) => getComputedStyle(document.querySelector(sel))[p];
      const small = document.querySelector('#nav [data-tab="days"] small');
      return {
        h: css('#nav [data-tab="days"]', "height"),
        r: css('#nav [data-tab="days"]', "borderTopLeftRadius"),
        fs: css('#nav [data-tab="days"]', "fontSize"),
        fw: css('#nav [data-tab="days"]', "fontWeight"),
        sfs: getComputedStyle(small).fontSize,
        sfw: getComputedStyle(small).fontWeight,
        shadow: css('#nav [data-tab="money"]', "boxShadow"),
        offBg: css('#nav [data-tab="money"]', "backgroundColor"),
        offFg: css('#nav [data-tab="money"]', "color"),
        onBg: css('#nav [data-tab="days"]', "backgroundColor"),
        onFg: css('#nav [data-tab="days"]', "color"),
        lampSize: getComputedStyle(document.querySelector('#nav [data-tab="money"]'), "::before").width,
        lampTop: getComputedStyle(document.querySelector('#nav [data-tab="money"]'), "::before").top,
        onLamp: getComputedStyle(document.querySelector('#nav [data-tab="days"]'), "::before").boxShadow,
        ringBg: css("#ring", "backgroundColor"),
        ringFg: css("#ring", "color"),
        ringShadow: css("#ring", "boxShadow"),
        ringPlus: getComputedStyle(document.querySelector("#ring .ring-p")).fontSize,
        ringWords: getComputedStyle(document.querySelector("#ring .ring-w")).fontSize,
      };
    });
    assert.deepEqual([k.h, k.r, k.fs, k.fw, k.sfs, k.sfw], ["56px", "10px", "15px", "900", "10.5px", "700"]);
    assert.equal(k.shadow, "rgba(255, 255, 255, 0.1) 0px 1px 0px 0px inset, rgba(0, 0, 0, 0.4) 0px -2px 0px 0px inset, rgba(0, 0, 0, 0.5) 0px 2px 3px 0px");
    assert.deepEqual([k.offBg, k.offFg], ["rgb(44, 38, 35)", "rgb(161, 150, 142)"]);
    assert.deepEqual([k.onBg, k.onFg], ["rgb(59, 51, 47)", "rgb(244, 240, 234)"]);
    assert.deepEqual([k.lampSize, k.lampTop], ["5px", "6px"]);
    assert.equal(k.onLamp, "rgba(244, 240, 234, 0.12) 0px 0px 0px 2px, rgba(244, 240, 234, 0.8) 0px 0px 8px 0px");
    assert.deepEqual([k.ringBg, k.ringFg], ["rgb(242, 243, 239)", "rgb(21, 18, 15)"]);
    assert.equal(k.ringShadow, "rgb(255, 255, 255) 0px 1px 0px 0px inset, rgba(0, 0, 0, 0.22) 0px -2px 0px 0px inset, rgba(0, 0, 0, 0.5) 0px 2px 3px 0px");
    assert.deepEqual([k.ringPlus, k.ringWords], ["22px", "10.5px"]);
    // Pressed: down 1.5 px, the drop shadow flattened.
    const box = await page.locator('#nav [data-tab="money"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // A transition may not yet exist on the first frame after mouse-down.
    // Observe the pressed geometry and the flattened shadow together.
    const pressed = await until(async () => {
      const state = await page.locator('#nav [data-tab="money"]').evaluate(b => ({
        active: b.matches(":active"), y: b.getBoundingClientRect().y, shadow: getComputedStyle(b).boxShadow,
      }));
      return state.active && Math.abs(state.y - box.y - 1.5) < 0.3 && !state.shadow.includes("3px") && state;
    }, "the key moves down 1.5 px and its drop shadow flattens");
    await page.mouse.move(2, 2);
    await page.mouse.up();
    assert.ok(Math.abs(pressed.y - box.y - 1.5) < 0.3, "moved down " + (pressed.y - box.y));
    assert.ok(!pressed.shadow.includes("3px"), "the drop shadow flattens: " + pressed.shadow);
  },
});

module.exports.push({
  name: "reduced motion: the keys have no transition",
  async run({ page }) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page, { go: false });
    const t = await page.evaluate(() => [...document.querySelectorAll("#nav button")].filter((b) => !b.hidden).map((b) => getComputedStyle(b).transitionDuration));
    assert.ok(t.length >= 4 && t.every((d) => d === "0s"), t.join(" "));
  },
});

module.exports.push({
  name: "the list's last row can be scrolled clear above the bar",
  async run({ page }) {
    const items = [];
    for (let i = 1; i <= 14; i++) items.push({ "#": i, Item: "Made-up booking " + i, "Book by": "2026-12-0" + ((i % 9) + 1), Status: "Not booked" });
    await ready(page, { items });
    const gap = await page.evaluate(() => {
      const v = document.getElementById("vBefore");
      v.scrollTop = v.scrollHeight;
      const foot = document.querySelector("#bwCard .bw-foot").getBoundingClientRect();
      return document.getElementById("nav").getBoundingClientRect().top - foot.bottom;
    });
    assert.ok(gap >= 0, "the foot ends " + gap + " px above the bar");
  },
});

// Counts: 7, 18 (about the real list) and 99 (the most the pill is asked to hold).
const manyItems = (n) => Array.from({ length: n }, (_, i) => ({ "#": i + 1, Item: "Made-up booking " + (i + 1), "Book by": "2026-12-0" + ((i % 9) + 1), Status: "Not booked" }));

for (const n of [7, 18, 99]) {
  for (const width of [320, 340, 360, 375, 390, 430]) {
    module.exports.push({
      name: "the bar with " + n + " open items at " + width + " px: five keys on one line, no overlap, nothing clipped or wrapped, the pill reads " + n,
      viewport: { width, height: 760 },
      async run({ page }) {
        await ready(page, { items: manyItems(n), go: false });
        await until(() => tabIsIn(page), "the Before tab is in the bar");
        // The planner read stops short of 99 rows: put the number on the pill itself (it is the pill's room under test).
        const put = () => page.evaluate((n) => { document.getElementById("beforeN").textContent = String(n); }, n);
        for (const tab of ["days", "before"]) {
          await page.click('#nav button[data-tab="' + tab + '"]');
          if (n === 99) await put();
          assert.equal(checkBar(await barShape(page), "on " + tab, true), tab);
          assert.equal(await page.evaluate(() => document.getElementById("beforeN").textContent), String(n));
        }
      },
    });
  }
}

module.exports.push({
  name: "tapping the Before tab while on it does nothing: the done group stays open and no extra fetch goes out",
  async run({ page }) {
    const backend = await ready(page);
    await page.click("#bwDoneB");
    await until(() => visible(page, "#bwDone"), "the done group opens");
    const before = sent(backend, "syncTodos").length;
    await page.click('#nav button[data-tab="before"]');
    await page.waitForTimeout(300);
    assert.equal(await visible(page, "#bwDone"), true, "still open");
    assert.equal(sent(backend, "syncTodos").length, before, "no extra syncTodos");
  },
});

module.exports.push({
  name: "the Before tab goes while focus is on it (midnight on Day 1, Tickets takes its place): focus moves to the Days tab",
  async run({ page }) {
    const backend = await ready(page, { nowMs: EVE, items: [ITEMS[1], ITEMS[4]] });
    await page.focus('#nav button[data-tab="before"]');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), "before");
    await advance(page, backend, 90 * 1000);
    await until(async () => !(await tabIsIn(page)), "the tab goes");
    assert.equal(await onScreen(page), "vDays", "being on it lands on Days");
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.tab), "days", "focus is on Days, not the body");
  },
});

// Security (2026-11-18): on your own link someone else's claim is theirs.
module.exports.push({
  name: "on your own link there is no Take it over on someone else's item; I'll do it and Tick it off stay",
  async run({ page }) {
    const backend = await ready(page, { claims: { 2: "Ajen" }, own: "Mo" });
    await page.dispatchEvent(row(2) + " .bw-b", "click");
    await until(() => page.evaluate((sel) => document.querySelector(sel).classList.contains("is-open"), row(2)), "row 2 opens");
    assert.equal(await page.$(row(2) + " .bw-claim"), null, "no Take it over");
    assert.ok(await page.$(row(2) + " .bw-tick"), "Tick it off is still there");
    await page.dispatchEvent(row(1) + " .bw-b", "click");
    await expectText(page, row(1) + " .bw-claim", "I’ll do it");
    const r = await backend.handle({ key: backend.ownKeys.Mo, action: "claimTodo", args: { id: "2", on: true } });
    assert.equal(r.ok, false, "the backend refuses it too");
  },
});

// Issue #77: a finger down on Tick it off, the row drawn again before the finger
// comes up (a sync, another phone's claim): the button the finger went down on is
// gone and the browser sends no click. The tap is done on finger up (js/views/tap.js).
module.exports.push({
  name: "a redraw between the press and the release of Tick it off still ticks the item",
  async run({ page }) {
    const backend = await ready(page);
    await openRow(page, "3");
    await pressTick(page, "3");
    // The row is drawn again under the finger: a new button, the old one gone.
    const swapped = await page.evaluate((s) => {
      const b = document.querySelector(s);
      const fresh = b.cloneNode(true);
      b.replaceWith(fresh);
      return !b.isConnected && fresh.isConnected;
    }, row(3) + " .bw-tick");
    assert.equal(swapped, true, "the button was replaced between press and release");
    await releaseTick(page, "3");
    await until(() => page.evaluate((s) => document.querySelector(s).classList.contains("is-landed"), row(3)), "row 3 is stamped");
    await until(() => stored(backend, "3").ticked_by === "Mo", "ticked");
    assert.equal(sent(backend, "tickTodo").length, 1, "ticked once");
  },
});

// Review of the #77 fix (I1): the rescue ticks the item pressed, not the # pressed.
module.exports.push({
  name: "a pull that puts another item under the pressed # between press and release: no tick, no stamp",
  async run({ page }) {
    const backend = await ready(page);
    await openRow(page, "3");
    await pressTick(page, "3");
    // Mo renumbers his planner: #3 is another item now. A pull lands under the finger.
    bookRow(backend, 3)[1] = "Buy a different thing entirely";
    // Through the store, not a click: a click would go through the list's own handler, which clears the press.
    await page.evaluate(() => { globalThis.__lt = globalThis.__matTest.store.syncTodos({ force: true }); });
    await until(() => page.evaluate(() => !document.querySelector('#bwOpen .bw-r[data-id="3"] .bw-n') || document.querySelector('#bwOpen .bw-r[data-id="3"] .bw-n').textContent.includes("different thing")), "row 3 shows the new item");
    await releaseTick(page, "3");
    await page.waitForTimeout(600);
    assert.equal(sent(backend, "tickTodo").length, 0, "no tick sent");
    assert.equal(stored(backend, "3").ticked_by || "", "", "not ticked");
    assert.equal(await page.evaluate((s) => !!document.querySelector(s + ".is-landed"), row(3)), false, "not stamped");
  },
});

// Review M1: a press held past a second is not a tap, so a redraw during it does not tick on release.
module.exports.push({
  name: "a press held over a second with a redraw under it does not tick on release",
  async run({ page }) {
    const backend = await ready(page);
    await openRow(page, "3");
    await pressTick(page, "3");
    await page.evaluate((s) => { const b = document.querySelector(s); b.replaceWith(b.cloneNode(true)); }, row(3) + " .bw-tick");
    await page.clock.fastForward(1200); // the page clock is faked: event times follow it
    await releaseTick(page, "3");
    await page.waitForTimeout(400);
    assert.equal(sent(backend, "tickTodo").length, 0, "no tick sent");
  },
});
