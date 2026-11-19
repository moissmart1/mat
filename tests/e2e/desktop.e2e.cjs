/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The app on a computer (Task 21). Four shapes of screen:
//   1. phone upright, (max-width:480px): unchanged;
//   2. phone sideways, (orientation:landscape) and (max-height:520px): unchanged;
//   3. WIDE, (min-width:1000px) and (min-height:521px): two panes, like a
//      ticket counter: the day's ticket on the left, the money receipt on the
//      right, both usable at once, and the bar as a rail on the right edge
//      holding only what is not a pane (Before, Ring up, You). Before opens
//      over the Days pane, with the Days key in the rail as the way back;
//   4. BETWEEN (everything else): one column of at most 560 px, no phone drawn.
// These cases run as a computer: a mouse and a keyboard, no touch.

const assert = require("node:assert/strict");
const { SEED, WITH_PLAN, NOON12, makeBackend, open, advance, until, visible } = require("./helpers.cjs");

const BIG = { width: 1440, height: 900 };
const LAPTOP = { width: 1280, height: 720 };
const BETWEEN = { width: 800, height: 900 };
const PHONE = { width: 390, height: 844 };
const SIDEWAYS = { width: 844, height: 390 };
const D12 = "2026-12-12";
const SKY = "planstop1203";

const isOpen = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  return !!el && el.classList.contains("is-open");
}, id);
const waitOpen = (page, id) => until(() => isOpen(page, id), "#" + id + " opens");
const waitClosed = (page, id) => until(async () => !(await isOpen(page, id)), "#" + id + " closes");
// Sheets rise over half a second of real time (the page's clock is paused,
// so this looks twice, 120 ms apart, from here): wait until one stands still.
const still = (page, id) => until(async () => {
  const top = () => page.evaluate((i) => document.getElementById(i).getBoundingClientRect().top, id);
  const a = await top();
  await page.waitForTimeout(120);
  return (await isOpen(page, id)) && Math.abs((await top()) - a) < 0.5;
}, "#" + id + " stands still");

async function both(page, opts = {}) {
  const backend = await open(page, { seed: WITH_PLAN, nowMs: NOON12, tab: "money", ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0 && document.querySelectorAll("#rail .pg .tk").length === 11), "both panes draw");
  // The views fade in and out over .16 s of real time.
  await until(() => page.evaluate(() => [...document.querySelectorAll(".view")].every((v) => getComputedStyle(v).opacity === (v.classList.contains("is-active") ? "1" : "0"))), "the views have faded");
  return backend;
}

// Where things stand: the block, the two panes, the rail.
function layout(page) {
  return page.evaluate(() => {
    const R = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const phone = document.getElementById("phone");
    const days = document.getElementById("vDays");
    const money = document.getElementById("vMoney");
    const shown = (v) => getComputedStyle(v).opacity === "1" && getComputedStyle(v).pointerEvents !== "none";
    return {
      innerWidth,
      innerHeight,
      docOver: document.documentElement.scrollWidth - innerWidth,
      phone: R(phone),
      radius: getComputedStyle(phone).borderTopLeftRadius,
      shadow: getComputedStyle(phone).boxShadow,
      days: R(days),
      money: R(money),
      daysShown: shown(days),
      moneyShown: shown(money),
      daysInert: days.inert,
      moneyInert: money.inert,
      nav: R(document.getElementById("nav")),
      keys: [...document.querySelectorAll("#nav button")].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.dataset.tab || b.id),
    };
  });
}

// The rectangle is inside the pane (half a pixel of rounding allowed).
function inside(r, pane, what) {
  assert.ok(r.left >= pane.left - 0.5 && r.right <= pane.right + 0.5, what + " is inside its pane: " + JSON.stringify({ r, pane }));
}
const rect = (page, sel) => page.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
}, sel);

// The pane is usable: the middle of it is the pane itself (nothing over it) and it scrolls.
async function scrollsAlone(page, id, otherId) {
  const hit = await page.evaluate((i) => {
    const v = document.getElementById(i);
    const r = v.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 3);
    return !!at && v.contains(at);
  }, id);
  assert.ok(hit, "#" + id + " is not covered");
  const before = await page.evaluate((o) => document.getElementById(o).scrollTop, otherId);
  const box = await rect(page, "#" + id);
  await page.mouse.move(box.left + box.width / 2, box.top + box.height / 3);
  await page.mouse.wheel(0, 240);
  await until(() => page.evaluate((i) => document.getElementById(i).scrollTop > 0, id), "#" + id + " scrolls");
  assert.equal(await page.evaluate((o) => document.getElementById(o).scrollTop, otherId), before, "#" + otherId + " stays where it was");
  await page.evaluate((i) => { document.getElementById(i).scrollTop = 0; }, id);
}

async function openSkyEdit(page) {
  const row = '#rail .pg[data-date="' + D12 + '"] .r[data-id="' + SKY + '"]';
  await until(() => page.evaluate((sel) => {
    const e = document.querySelector(sel + " .r-edit");
    return !!e && e.getBoundingClientRect().height > 0;
  }, row), "today's next stop is open, with its Edit");
  await page.click(row + " .r-edit");
  await waitOpen(page, "stop");
  await still(page, "stop");
}

const cases = [];
for (const size of [BIG, LAPTOP]) {
  const at = " (" + size.width + "x" + size.height + ")";
  cases.push(
    {
      name: "two panes: both views shown, neither inert, a centred square block, equal panes of at most 500 px, the rail holds Tickets (a trip day), Ring up and You" + at,
      viewport: size,
      mobile: false,
      async run({ page }) {
        await both(page);
        const l = await layout(page);
        assert.ok(l.docOver <= 0, "no sideways scroll");
        assert.ok(l.daysShown && l.moneyShown, "both views shown: " + JSON.stringify([l.daysShown, l.moneyShown]));
        assert.equal(l.daysInert, false, "Days is not inert");
        assert.equal(l.moneyInert, false, "Money is not inert");
        assert.equal(l.radius, "0px");
        assert.equal(l.shadow, "none");
        assert.equal(l.phone.top, 0);
        assert.equal(l.phone.height, l.innerHeight, "the block is the window's height");
        assert.ok(l.phone.width <= 1120, "at most 1120 px wide: " + l.phone.width);
        assert.ok(Math.abs(l.phone.left - (l.innerWidth - l.phone.right)) <= 1, "centred: " + JSON.stringify(l.phone));
        assert.ok(Math.abs(l.days.width - l.money.width) <= 1, "the panes are equal: " + l.days.width + " and " + l.money.width);
        assert.ok(l.days.width <= 500 && l.days.width >= 440, "a pane is at most 500 px: " + l.days.width);
        assert.ok(l.days.right <= l.money.left + 0.5, "Days on the left, Money on the right");
        assert.ok(l.money.right <= l.nav.left + 0.5 && l.nav.right <= l.phone.right + 0.5, "the rail on the right edge");
        assert.ok(l.nav.top <= l.phone.top + 0.5 && l.nav.bottom >= l.phone.bottom - 0.5, "the rail runs the block's height");
        // A trip day: Tickets has Before's place (the Days and Money keys are hidden, both panes are there).
        assert.deepEqual(l.keys, ["tickets", "ring", "youBtn"], "the rail shows Tickets, Ring up and You only");
        await scrollsAlone(page, "vMoney", "vDays");
        // The Days pane scrolls too when its ticket is longer than the window.
        const tall = await page.evaluate(() => { const v = document.getElementById("vDays"); return v.scrollHeight > v.clientHeight; });
        if (tall) await scrollsAlone(page, "vDays", "vMoney");
      },
    },
    {
      name: "ring up with the keyboard: digits into the register, Enter in the title rings it up, and the line is on the receipt beside the ticket" + at,
      viewport: size,
      mobile: false,
      async run({ page }) {
        const backend = await both(page);
        await page.click("#ring");
        await waitOpen(page, "reg");
        inside(await rect(page, "#reg"), await rect(page, "#vMoney"), "the register");
        assert.equal(await visible(page, "#nav #youBtn"), true, "the rail stays while the register is open");
        for (const k of ["1", "2", "5", "9", "Backspace", ".", "5"]) await page.keyboard.press(k);
        assert.equal((await page.textContent("#xAmt")).replace(/\s+/g, ""), "$125.5", "the keyboard typed the amount");
        await page.click("#xWhat");
        await page.keyboard.type("Desk tea");
        await page.keyboard.press("Enter");
        // As on a phone, the register stays open for the next one, its display cleared.
        await until(() => page.evaluate(() => [...document.querySelectorAll("#rc .rc-row")].some((r) => r.textContent.includes("Desk tea"))), "the line is on the receipt");
        assert.equal((await page.textContent("#xAmt")).replace(/\s+/g, ""), "$0");
        await until(() => backend.fake.tables.Expenses.some((e) => e.title === "Desk tea" && Number(e.amount) === 125.5), "the backend has it");
        const l = await layout(page);
        assert.ok(l.daysShown && l.moneyShown, "the ticket is still beside the receipt");
        // Enter with focus on no field does what Ring it up does (a quick chip gives the title).
        for (const k of ["8", "0", "0"]) await page.keyboard.press(k);
        await page.click('#xQuick .chip[data-q="Coffee"]');
        await page.keyboard.press("Enter");
        await until(() => backend.fake.tables.Expenses.filter((e) => Number(e.amount) === 800).length === 1, "the second line is sent");
        // Enter on a key reached with Tab presses that key instead (here Done).
        await page.focus("#regDone");
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.activeElement.id), "regDone");
        await page.keyboard.press("Enter");
        await waitClosed(page, "reg");
      },
    },
    {
      name: "a stop's form opens inside the Days pane and the Money pane still scrolls; Escape closes it" + at,
      viewport: size,
      mobile: false,
      async run({ page }) {
        await both(page, { tab: "days" });
        await openSkyEdit(page);
        inside(await rect(page, "#stop"), await rect(page, "#vDays"), "the stop's form");
        inside(await rect(page, "#stopScrim"), await rect(page, "#vDays"), "its scrim");
        await scrollsAlone(page, "vMoney", "stop");
        await page.keyboard.press("Escape");
        await waitClosed(page, "stop");
      },
    },
    {
      name: "History, You and an expense line open inside the Money pane, the Days pane stays usable; Escape closes each" + at,
      viewport: size,
      mobile: false,
      async run({ page }) {
        await both(page);
        const money = await rect(page, "#vMoney");
        await page.click("#histBtn");
        await waitOpen(page, "hist");
        await still(page, "hist");
        inside(await rect(page, "#hist"), money, "History");
        inside(await rect(page, "#histScrim"), money, "History's scrim");
        const daysHit = await page.evaluate(() => {
          const v = document.getElementById("vDays");
          const r = v.getBoundingClientRect();
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!at && v.contains(at);
        });
        assert.ok(daysHit, "the Days pane is not covered by History");
        await page.keyboard.press("Escape");
        await waitClosed(page, "hist");
        await page.click("#youBtn");
        await waitOpen(page, "you");
        await still(page, "you");
        inside(await rect(page, "#you"), money, "You");
        await page.keyboard.press("Escape");
        await waitClosed(page, "you");
        await page.click("#rc .rc-row");
        await waitOpen(page, "line");
        await still(page, "line");
        inside(await rect(page, "#line"), money, "the expense line");
        await page.keyboard.press("Escape");
        await waitClosed(page, "line");
      },
    },
    {
      name: "the day changes with a click on its square and with the arrow keys" + at,
      viewport: size,
      mobile: false,
      async run({ page }) {
        await both(page);
        const day = () => page.textContent("#dayCount span");
        assert.equal(await day(), "Day 3 of 11");
        await page.click("#pager .sq:nth-child(5)");
        await until(async () => (await day()) === "Day 5 of 11", "a click on the fifth square shows day 5");
        await page.keyboard.press("ArrowRight");
        await until(async () => (await day()) === "Day 6 of 11", "the right arrow shows the next day");
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("ArrowLeft");
        await until(async () => (await day()) === "Day 4 of 11", "the left arrow shows the day before");
        // The rail follows: the ticket in view is day 4's.
        await until(() => page.evaluate(() => {
          const rail = document.getElementById("rail");
          const pg = rail.children[3];
          return Math.abs(rail.scrollLeft - pg.offsetLeft + rail.offsetLeft) < pg.offsetWidth / 2;
        }), "the ticket strip shows day 4");
      },
    },
    {
      name: "a keyboard is enough: every control reached by Tab shows a ring in the app's ink, and hovering a key changes it" + at,
      viewport: size,
      mobile: false,
      async run({ page }) {
        await both(page);
        const seen = [];
        for (let i = 0; i < 40; i++) {
          await page.keyboard.press("Tab");
          const f = await page.evaluate(() => {
            const a = document.activeElement;
            if (!a || a === document.body) return null;
            const s = getComputedStyle(a);
            const ink = ["rgb(244, 240, 234)", "rgb(21, 18, 15)"];
            return { tag: a.tagName, id: a.id, ok: a.matches(":focus-visible") && s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2 && ink.includes(s.outlineColor), color: s.outlineColor };
          });
          if (f) seen.push(f);
        }
        assert.ok(seen.length >= 20, "Tab reaches the controls: " + seen.length);
        const bad = seen.filter((f) => !f.ok);
        assert.deepEqual(bad, [], "every focused control shows a ring in the app's ink");
        // On paper the ring is the print colour, on the dark ground the light ink.
        await page.focus("#histBtn");
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineColor), "rgb(244, 240, 234)");
        // Hover: a key on the rail changes under the mouse.
        const bg = () => page.evaluate(() => getComputedStyle(document.getElementById("youBtn")).backgroundColor);
        const plain = await bg();
        await page.hover("#youBtn");
        await until(async () => (await bg()) !== plain, "You changes under the mouse");
      },
    },
  );
}

cases.push(
  {
    name: "Before opens over the Days pane, the Days key in the rail is the way back, and what the app remembers is left alone",
    viewport: BIG,
    mobile: false,
    async run({ page }) {
      const BHEAD = ["#", "Item", "Who", "Book by", "Status", "Notes", "Booking link"];
      const CHEAD = ["#", "Date / time", "Agent / session", "Tab", "Cell(s)", "Item", "Old value", "New value", "Why", "Proof / source", "Verified?"];
      const items = [{ "#": 1, Item: "Rail pass seat reservations", "Book by": "2026-11-14", Status: "Not booked" }, { "#": 2, Item: "Tea ceremony class", "Book by": "2026-11-18", Status: "Pending" }];
      const nowMs = Date.parse("2026-11-16T19:00:00Z");
      const backend = makeBackend({ ...WITH_PLAN, plannerId: "fakePlannerSheet_desk", plannerTabs: { "Book Now": [["Before we go: bookings"], BHEAD, ...items.map((o) => BHEAD.map((h) => (o[h] === undefined ? "" : o[h])))], "Change Log": [CHEAD] } }, { now: nowMs - 300000 });
      assert.equal((await backend.fake({ key: "test-key", actor: "Mo", action: "syncTodos", args: {} })).ok, true);
      backend.now = nowMs;
      await open(page, { backend, nowMs, tab: "money" });
      await until(() => visible(page, "#beforeBtn"), "the Before key is in the rail");
      assert.deepEqual((await layout(page)).keys, ["before", "ring", "youBtn"], "Before, Ring up and You");
      await page.click("#beforeBtn");
      await until(() => visible(page, "#todos"), "the list shows");
      const l = await layout(page);
      const before = await rect(page, "#vBefore");
      assert.ok(Math.abs(before.left - l.days.left) < 1 && Math.abs(before.width - l.days.width) < 1, "Before stands where the Days pane stands");
      assert.equal(await page.evaluate(() => document.getElementById("vBefore").inert), false);
      assert.equal(l.moneyShown && !l.moneyInert, true, "Money is still shown and usable");
      assert.equal(await page.evaluate(() => document.getElementById("vDays").inert), true, "Days is put away under it");
      assert.deepEqual(l.keys, ["days", "before", "ring", "youBtn"], "the Days key is the way back");
      assert.equal(await page.evaluate(() => document.getElementById("beforeBtn").classList.contains("is-active")), true);
      await page.click('#nav [data-tab="days"]');
      await until(async () => (await layout(page)).daysShown, "Days is back");
      assert.deepEqual((await layout(page)).keys, ["before", "ring", "youBtn"]);
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.tab")), "money", "the remembered tab is left as it was");
      // A narrow window shows that tab.
      await page.setViewportSize(PHONE);
      await until(() => page.evaluate(() => document.querySelector(".view.is-active").id === "vMoney" && !document.getElementById("vDays").classList.contains("is-active")), "the phone shows Money");
    },
  },
  {
    name: "between (800x900): one column of at most 560 px, square, the window's height, the bar across its foot",
    viewport: BETWEEN,
    mobile: false,
    async run({ page }) {
      await both(page);
      const l = await layout(page);
      assert.ok(l.docOver <= 0);
      assert.equal(l.radius, "0px");
      assert.equal(l.shadow, "none");
      assert.equal(l.phone.top, 0);
      assert.equal(l.phone.height, l.innerHeight);
      assert.ok(l.phone.width <= 560 && l.phone.width >= 500, "a column of at most 560 px: " + l.phone.width);
      assert.ok(Math.abs(l.phone.left - (l.innerWidth - l.phone.right)) <= 1, "centred");
      assert.ok(Math.abs(l.nav.bottom - l.phone.bottom) < 1 && Math.abs(l.nav.width - l.phone.width) < 1 && l.nav.height < 120, "the bar across the foot: " + JSON.stringify(l.nav));
      assert.deepEqual(l.keys, ["days", "tickets", "ring", "money", "youBtn"], "the same keys as a phone (a trip day: Tickets in Before's place)");
      assert.equal(l.moneyShown && !l.daysShown, true, "one view at a time");
    },
  },
  {
    name: "resizing keeps what is open: 1440 to 390 and back with the register open and an amount typed",
    viewport: BIG,
    mobile: false,
    async run({ page }) {
      await both(page);
      await page.click("#ring");
      await waitOpen(page, "reg");
      for (const k of ["4", "2"]) await page.keyboard.press(k);
      await page.click("#xWhat");
      await page.keyboard.type("Half typed");
      const amt = () => page.evaluate(() => document.getElementById("xAmt").textContent.replace(/\s+/g, ""));
      assert.equal(await amt(), "$42");
      await page.setViewportSize(PHONE);
      await until(async () => (await rect(page, "#phone")).width === 390, "the phone fills the window");
      assert.equal(await isOpen(page, "reg"), true, "still open on the phone");
      assert.equal(await amt(), "$42");
      await page.setViewportSize(BIG);
      await until(async () => (await layout(page)).moneyShown && (await layout(page)).daysShown, "two panes again");
      assert.equal(await isOpen(page, "reg"), true, "still open");
      assert.equal(await amt(), "$42", "the amount is kept");
      assert.equal(await page.inputValue("#xWhat"), "Half typed", "the title is kept");
      inside(await rect(page, "#reg"), await rect(page, "#vMoney"), "the register lands in the Money pane");
    },
  },
  {
    name: "a new version waits while a sheet is open in either pane",
    viewport: BIG,
    mobile: false,
    async run({ page }) {
      const backend = await both(page, { tab: "days" });
      const announce = () => page.evaluate(() => new Promise((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => resolve(true);
        navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "mat-new-version" }, ports: [ch.port2] }));
        setTimeout(() => resolve(false), 500);
      }));
      await page.evaluate(() => { window.__notReloaded = true; });
      const reloaded = () => page.evaluate(() => window.__notReloaded !== true).catch(() => true);
      // A reload set off inside an awaited fast-forward would leave that call
      // unanswered (and the browser stuck): stop waiting as soon as the page navigates.
      const forward = (ms) => Promise.race([page.clock.fastForward(ms).catch(() => {}), page.waitForEvent("framenavigated").catch(() => {})]);
      await openSkyEdit(page);
      assert.equal(await announce(), true, "the page answers");
      await forward(10000);
      backend.now += 10000;
      assert.equal(await reloaded(), false, "not while the stop's form is open in the Days pane");
      // Moving from one pane's sheet to the other's: still waiting.
      await page.click("#histBtn");
      await waitOpen(page, "hist");
      await forward(10000);
      assert.equal(await reloaded(), false, "not while History is open in the Money pane");
      await page.click("#ring");
      await waitOpen(page, "reg");
      await forward(10000);
      assert.equal(await reloaded(), false, "not while the register is open in the Money pane");
      await page.click("#regDone");
      await waitClosed(page, "reg");
      page.clock.fastForward(4000).catch(() => {});
      await until(() => reloaded(), "then it reloads");
      // The new page is up before the case ends, so the browser is not closed mid-load.
      await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0).catch(() => false), "the app is back");
    },
  },
);

// ---------- the fix round after review ----------

// Which shape the page is in, read from the geometry, and what js/shape.js says.
async function shapeOf(page) {
  return page.evaluate(async () => {
    const m = await import("/js/shape.js");
    const phone = document.getElementById("phone").getBoundingClientRect();
    const nav = document.getElementById("nav").getBoundingClientRect();
    const days = document.getElementById("vDays").getBoundingClientRect();
    const money = document.getElementById("vMoney").getBoundingClientRect();
    const two = getComputedStyle(document.getElementById("vDays")).opacity !== "0" && getComputedStyle(document.getElementById("vMoney")).opacity !== "0" && days.right <= money.left + 0.5;
    const railRight = nav.left >= phone.right - nav.width - 0.5 && nav.height >= phone.height - 0.5;
    const barFoot = Math.abs(nav.bottom - phone.bottom) < 1 && Math.abs(nav.width - phone.width) < 1;
    let geo = "?";
    if (two && railRight) geo = "WIDE";
    else if (railRight) geo = "SIDEWAYS";
    else if (barFoot && phone.width === innerWidth && phone.width <= 480) geo = "PHONE";
    else if (barFoot && phone.width <= 560 && phone.height === innerHeight) geo = "BETWEEN";
    return { geo, isWide: m.isWide(), isPhone: m.isPhone() };
  });
}

for (const [size, want] of [
  [{ width: 999, height: 768 }, { geo: "BETWEEN", isWide: false, isPhone: false }],
  [{ width: 1000, height: 520 }, { geo: "SIDEWAYS", isWide: false, isPhone: true }],
  [{ width: 1000, height: 521 }, { geo: "WIDE", isWide: true, isPhone: false }],
  [{ width: 480, height: 900 }, { geo: "PHONE", isWide: false, isPhone: true }],
  [{ width: 481, height: 900 }, { geo: "BETWEEN", isWide: false, isPhone: false }],
]) {
  cases.push({
    name: "the boundaries: " + size.width + "x" + size.height + " is " + want.geo + ", and isWide()/isPhone() agree",
    viewport: size,
    mobile: false,
    async run({ page }) {
      await both(page);
      assert.deepEqual(await shapeOf(page), want);
    },
  });
}

cases.push(
  {
    // Ruling: width decides, not pointer type. A touch tablet this size gets the two panes.
    name: "a touch tablet at 1024x768 (no hover) gets the two panes",
    viewport: { width: 1024, height: 768 },
    async run({ page }) {
      await both(page);
      assert.equal(await page.evaluate(() => matchMedia("(hover:hover)").matches), false, "a touch device, no hover");
      const l = await layout(page);
      assert.ok(l.daysShown && l.moneyShown && !l.daysInert && !l.moneyInert, "both panes in use");
      assert.deepEqual(l.keys, ["tickets", "ring", "youBtn"]);
      assert.equal((await shapeOf(page)).geo, "WIDE");
    },
  },
  {
    name: "on a phone the keyboard is not the register's keys: digits and Enter on the page do nothing",
    viewport: PHONE,
    async run({ page }) {
      const backend = await both(page);
      await page.click("#ring");
      await waitOpen(page, "reg");
      await page.click("#xQuick .chip[data-q=\"Coffee\"]");
      await page.evaluate(() => {
        for (const key of ["7", "0", "Enter"]) document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      });
      for (const k of ["7", "0", "Enter"]) await page.keyboard.press(k);
      assert.equal((await page.textContent("#xAmt")).replace(/\s+/g, ""), "$0", "nothing typed");
      const n = backend.fake.tables.Expenses.length;
      await page.waitForTimeout(300);
      assert.equal(backend.fake.tables.Expenses.length, n, "nothing rung up");
    },
  },
  {
    name: "WIDE: no keys from a field, with a modifier, mid-conversion (keyCode 229), or Enter on a ticket row",
    viewport: BIG,
    mobile: false,
    async run({ page }) {
      const backend = await both(page);
      const count = () => backend.fake.tables.Expenses.length;
      const n = count();
      const amt = () => page.evaluate(() => document.getElementById("xAmt").textContent.replace(/\s+/g, ""));
      await page.click("#ring");
      await waitOpen(page, "reg");
      for (const k of ["1", "2"]) await page.keyboard.press(k);
      assert.equal(await amt(), "$12");
      // From a field: the digit is the field's.
      await page.click("#xWhat");
      await page.keyboard.type("Tea 5");
      assert.equal(await amt(), "$12", "a digit typed in the title stays in the title");
      assert.equal(await page.inputValue("#xWhat"), "Tea 5");
      // A conversion being confirmed: Safari sends Enter with keyCode 229.
      await page.evaluate(() => {
        const w = document.getElementById("xWhat");
        w.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(300);
      assert.equal(count(), n, "a confirming Enter rings nothing up");
      assert.equal(await page.evaluate(() => document.activeElement.id), "xWhat", "and the title keeps focus");
      assert.equal(await amt(), "$12");
      await page.evaluate(() => {
        document.activeElement.blur();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(300);
      assert.equal(count(), n, "nor on the page");
      // With a modifier: the browser's, not the register's.
      for (const k of ["Meta+3", "Control+3", "Alt+3"]) await page.keyboard.press(k);
      assert.equal(await amt(), "$12", "no digit with a modifier");
      // Enter on a ticket row opens or closes the row, nothing else.
      await page.evaluate(() => document.querySelector('#rail .pg[data-date="2026-12-12"] .r[data-id="planstop1204"] .r-b').focus());
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      assert.equal(count(), n, "Enter on a ticket row rings nothing up");
      assert.equal(await amt(), "$12");
    },
  },
  {
    name: "the day in view is kept across a resize: 1440 to 390 and back, and a phone turned sideways and back",
    viewport: BIG,
    mobile: false,
    async run({ page }) {
      await both(page);
      const day = () => page.textContent("#dayCount span");
      const shown = () => page.evaluate(() => {
        const rail = document.getElementById("rail");
        return Math.round(rail.scrollLeft / (rail.firstElementChild.offsetWidth + (parseFloat(getComputedStyle(rail).columnGap) || 0))) + 1;
      });
      await page.click("#pager .sq:nth-child(7)");
      await until(async () => (await day()) === "Day 7 of 11" && (await shown()) === 7, "day 7");
      for (const size of [PHONE, SIDEWAYS, PHONE, BIG]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(400);
        assert.equal(await day(), "Day 7 of 11", "the count at " + size.width + "x" + size.height);
        assert.equal(await shown(), 7, "the ticket in view at " + size.width + "x" + size.height);
      }
    },
  },
  {
    name: "WIDE: only a key that shows is marked current, and when Before goes (Tickets takes its place on Day 1) focus lands on a key that shows",
    viewport: BIG,
    mobile: false,
    async run({ page }) {
      const BHEAD = ["#", "Item", "Who", "Book by", "Status", "Notes", "Booking link"];
      const CHEAD = ["#", "Date / time", "Agent / session", "Tab", "Cell(s)", "Item", "Old value", "New value", "Why", "Proof / source", "Verified?"];
      const items = [{ "#": 2, Item: "Tea ceremony class", "Book by": "2026-11-18", Status: "Pending" }, { "#": 5, Item: "Pocket wifi pickup", "Book by": "2026-11-10", Status: "Booked" }];
      // A minute to midnight before the first day (Dec 10) in Japan: the last minute Before has its key.
      const EVE = Date.parse("2026-12-09T23:59:00+09:00");
      const backend = makeBackend({ ...WITH_PLAN, plannerId: "fakePlannerSheet_desk", plannerTabs: { "Book Now": [["Before we go: bookings"], BHEAD, ...items.map((o) => BHEAD.map((h) => (o[h] === undefined ? "" : o[h])))], "Change Log": [CHEAD] } }, { now: EVE - 300000 });
      assert.equal((await backend.fake({ key: "test-key", actor: "Mo", action: "syncTodos", args: {} })).ok, true);
      backend.now = EVE;
      await open(page, { backend, nowMs: EVE, tab: "money" });
      await until(() => visible(page, "#beforeBtn"), "the Before key is in the rail");
      const marked = () => page.evaluate(() => [...document.querySelectorAll("#nav [aria-current]")].map((b) => (b.getBoundingClientRect().width > 0 ? "" : "hidden:") + (b.dataset.tab || b.id)));
      assert.deepEqual(await marked(), [], "nothing hidden is marked");
      await page.click("#beforeBtn");
      await until(() => page.evaluate(() => document.getElementById("vBefore").classList.contains("is-active") && !document.getElementById("todos").hidden), "the list shows");
      assert.deepEqual(await marked(), ["before"]);
      await page.focus("#beforeBtn");
      // Midnight: Day 1. Before gives its place to Tickets while it has focus.
      await advance(page, backend, 90 * 1000);
      await until(async () => !(await visible(page, "#beforeBtn")), "the key goes");
      await until(() => visible(page, "#ticketsBtn"), "Tickets takes its place");
      const f = await page.evaluate(() => {
        const a = document.activeElement;
        return { body: a === document.body, shows: !!a && a.getBoundingClientRect().width > 0 };
      });
      assert.deepEqual(f, { body: false, shows: true }, "focus is on something that shows");
      assert.deepEqual(await marked(), [], "nothing hidden is marked");
      // Tickets in the rail is marked current once it is the tab.
      await page.click("#ticketsBtn");
      assert.deepEqual(await marked(), ["tickets"]);
    },
  },
);

// The two phone shapes compute what they did before this task.
for (const [size, want] of [
  [PHONE, { phone: [0, 0, 390, 844], radius: "0px", shadow: "none", views: [0, 0, 390, 844], nav: [0, 762, 390, 82], pad: "96px" }],
  [SIDEWAYS, { phone: [90, 0, 664, 390], radius: "0px", shadow: "none", views: [90, 0, 560, 390], nav: [650, 0, 104, 390], pad: "24px" }],
]) {
  cases.push({
    name: "a phone at " + size.width + "x" + size.height + " is laid out as before",
    viewport: size,
    async run({ page }) {
      await open(page, { seed: SEED, nowMs: NOON12 });
      await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0), "the receipt draws");
      const got = await page.evaluate(() => {
        const R = (e) => {
          const r = e.getBoundingClientRect();
          return [r.left, r.top, r.width, r.height];
        };
        const ph = document.getElementById("phone");
        return { phone: R(ph), radius: getComputedStyle(ph).borderTopLeftRadius, shadow: getComputedStyle(ph).boxShadow, views: R(document.querySelector(".views")), nav: R(document.getElementById("nav")), pad: getComputedStyle(document.getElementById("vMoney")).paddingBottom };
      });
      assert.deepEqual(got, want);
    },
  });
}

module.exports = cases;
