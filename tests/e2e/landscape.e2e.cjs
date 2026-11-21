// The app held sideways (Task 14): at 667x375, 844x390 and 932x430 (and,
// for the frame, the rail and ringing up, a browser tab held sideways at
// 667x320) the app
// fills the screen's height as one block, a column with the bar turned into
// a rail on its right; every sheet's close control is on screen; turning the
// phone changes the layout only. Portrait keeps the phone exactly as before;
// tablets and desktop windows are Task 21's shapes (tests/e2e/desktop.e2e.cjs).

const assert = require("node:assert/strict");
const P = require("../../backend/Pure.js");
const { SEED, WITH_PLAN, NOON12, open, until, atRest, visible } = require("./helpers.cjs");

const SIZES = [
  { width: 667, height: 375 },
  { width: 844, height: 390 },
  { width: 932, height: 430 },
];
// A browser tab held sideways: Safari's bars leave 320 px.
const TAB = { width: 667, height: 320 };
const PORTRAIT = { width: 390, height: 844 };
const D12 = "2026-12-12";
const DINNER = "planstop1204";

// "ok", or why the element is not on screen and tappable. With `scroll`, it
// is first scrolled into view inside whatever scrolls it.
function reach(page, selector, scroll = false) {
  return page.evaluate(
    ([sel, scroll]) => {
      const el = document.querySelector(sel);
      if (!el) return "missing";
      if (scroll) el.scrollIntoView({ block: "center", inline: "nearest" });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return "not drawn";
      if (r.top < -0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5) {
        return "off screen: " + Math.round(r.left) + "," + Math.round(r.top) + " to " + Math.round(r.right) + "," + Math.round(r.bottom) + " of " + innerWidth + "x" + innerHeight;
      }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) return "covered by " + (hit ? hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") + "." + hit.className : "nothing");
      return "ok";
    },
    [selector, scroll],
  );
}

async function expectReach(page, selector, scroll) {
  // Sheets rise over half a second (real time, not the paused page clock): wait for it.
  let got;
  try {
    await until(async () => (got = await reach(page, selector, scroll)) === "ok", "");
  } catch {
    const size = page.viewportSize();
    throw new Error(selector + " is not on screen and tappable at " + size.width + "x" + size.height + ": " + got);
  }
}

const isOpen = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  return !!el && el.classList.contains("is-open");
}, id);
// Open and at rest: a tap is never aimed at a sheet still sliding up (helpers.cjs atRest).
const waitOpen = (page, id) => atRest(page, "#" + id);
const waitClosed = (page, id) => atRest(page, "#" + id, { open: false });
const activeView = (page) => page.evaluate(() => document.querySelector(".view.is-active").id);

// Taps a stop on the Days ticket and waits until it has opened all the way
// (0.2 s) and today's next stop has closed, so the ticket has stopped moving.
// A tap on Edit while it still moves fails Playwright's "stable" check, and
// its retry scrolls Edit into view aligned to the rail's end: the rail snaps
// to the day before, which un-chooses the stop and leaves Edit inert.
async function openStop(page, row) {
  await page.dispatchEvent(row + " .r-b", "click");
  await until(
    () => page.evaluate((sel) => {
      const r = document.querySelector(sel);
      return r.classList.contains("is-open") && [...r.closest(".tk").querySelectorAll(".r[data-id]")].every((x) => {
        const d = x.querySelector(".r-more > div");
        return !d || d.clientHeight === (x.classList.contains("is-open") ? d.scrollHeight : 0);
      });
    }, row),
    "the stop opens",
  );
}

async function keys(page, seq) {
  for (const k of seq.split(" ")) await page.click('#pad .key[data-k="' + k + '"]');
}

async function money(page) {
  const backend = await open(page, { seed: SEED, nowMs: NOON12 });
  await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length === 8), "the receipt draws");
  return backend;
}

async function days(page) {
  const backend = await open(page, { seed: WITH_PLAN, tab: "days", nowMs: NOON12 });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}

// The frame: no horizontal overflow, the block fills the height with square
// corners, the rail stands to the right of a column of at most 560 px.
async function frame(page) {
  return page.evaluate(() => {
    const phone = document.getElementById("phone");
    const views = document.querySelector(".views").getBoundingClientRect();
    const nav = document.getElementById("nav").getBoundingClientRect();
    const view = document.querySelector(".view.is-active");
    const p = phone.getBoundingClientRect();
    return {
      docOver: document.documentElement.scrollWidth - innerWidth,
      viewOver: view.scrollWidth - view.clientWidth,
      radius: getComputedStyle(phone).borderTopLeftRadius,
      shadow: getComputedStyle(phone).boxShadow,
      top: p.top,
      height: p.height,
      innerHeight,
      column: views.width,
      railBeside: nav.left >= views.right - 0.5 && nav.right <= p.right + 0.5,
      railTall: nav.top <= p.top + 0.5 && nav.bottom >= p.bottom - 0.5,
    };
  });
}

function expectFrame(f, where) {
  assert.ok(f.docOver <= 0, where + ": the page scrolls sideways by " + f.docOver);
  assert.ok(f.viewOver <= 0, where + ": the view scrolls sideways by " + f.viewOver);
  assert.equal(f.radius, "0px", where + ": no rounded corners");
  assert.equal(f.shadow, "none", where + ": no shadow");
  assert.equal(f.top, 0, where + ": the block starts at the top");
  assert.equal(f.height, f.innerHeight, where + ": the block fills the height");
  assert.ok(f.column <= 560, where + ": the column is at most 560 px, not " + f.column);
  assert.ok(f.railBeside, where + ": the rail is beside the column, on its right");
  assert.ok(f.railTall, where + ": the rail runs the block's height");
}

const cases = [];
for (const size of [...SIZES, TAB]) {
  const at = " (" + size.width + "x" + size.height + ")";
  const sized = [];
  sized.push(
    {
      name: "the frame: no sideways scroll on Days and Money, one square block the screen's height" + at,
      viewport: size,
      async run({ page }) {
        await days(page);
        expectFrame(await frame(page), "Days");
        // The next stop is brought into view only as far as needed: the rail
        // beside the column does not count as covering the view's foot.
        let sky;
        try {
          await until(async () => {
            sky = await page.evaluate(() => {
              const v = document.getElementById("vDays");
              const r = v.querySelector('#rail .pg[data-date="2026-12-12"] .r[data-id="planstop1203"]').getBoundingClientRect();
              return { top: r.top, bottom: r.bottom, viewBottom: v.getBoundingClientRect().bottom, scrollTop: v.scrollTop };
            });
            return sky.top >= 0 && sky.bottom <= sky.viewBottom && (sky.scrollTop === 0 || sky.viewBottom - sky.bottom <= 40);
          }, "");
        } catch {
          assert.fail("the next stop is not shown whole near the foot of the view: " + JSON.stringify(sky));
        }
        await page.click('#nav [data-tab="money"]');
        await until(async () => (await activeView(page)) === "vMoney", "Money shows");
        expectFrame(await frame(page), "Money");
      },
    },
    {
      name: "the rail: Days, Money and You do what they do in portrait, Ring up opens the keys" + at,
      viewport: size,
      async run({ page }) {
        await days(page);
        await until(() => page.evaluate(() => !document.getElementById("ticketsBtn").hidden), "the Tickets key");
        // Each rail button is a full tap target.
        const small = await page.evaluate(() =>
          [...document.querySelectorAll("#nav button")].filter((b) => !b.hidden).map((b) => b.getBoundingClientRect()).filter((r) => r.height < 44 || r.width < 44).length,
        );
        assert.equal(small, 0, "every rail button is at least 44 px each way");
        // The same keys as the portrait bar, stacked in the same order, Ring up in the middle (a trip day: Tickets has Before's place).
        const rail = await page.evaluate(() =>
          [...document.querySelectorAll("#nav button")].filter((b) => !b.hidden).map((b) => {
            const r = b.getBoundingClientRect();
            return { id: b.dataset.tab || b.id, top: r.top, bottom: r.bottom, h: r.height, vis: r.top >= 0 && r.bottom <= innerHeight };
          }),
        );
        const keys = await page.evaluate(() => [...document.querySelectorAll("#nav button")].filter((b) => !b.hidden).map((b) => b.dataset.tab || b.id));
        assert.deepEqual(keys, ["days", "tickets", "ring", "money", "youBtn"]);
        assert.equal(rail.length, 5);
        assert.ok(rail.every((r, i) => r.vis && r.h >= 44 && (i === 0 || r.top >= rail[i - 1].bottom - 0.5)), "stacked, in view, 44 px or more: " + JSON.stringify(rail));
        const ring = await page.evaluate(() => {
          const r = document.getElementById("ring");
          return { over: r.scrollWidth - r.clientWidth, text: r.innerText.replace(/\s+/g, " ").trim(), name: r.getAttribute("aria-label") };
        });
        assert.ok(ring.over <= 0, "Ring up's words fit inside it: " + JSON.stringify(ring));
        assert.deepEqual([ring.text, ring.name], ["＋ Ring up", "Ring up"]);
        await page.click('#nav [data-tab="money"]');
        await until(async () => (await activeView(page)) === "vMoney", "Money shows");
        assert.equal(await page.evaluate(() => document.querySelector('#nav [data-tab="money"]').classList.contains("is-active")), true, "Money is marked");
        await page.click('#nav [data-tab="days"]');
        await until(async () => (await activeView(page)) === "vDays", "Days shows");
        assert.equal(await page.evaluate(() => document.querySelector('#nav [data-tab="days"]').classList.contains("is-active")), true, "Days is marked");
        await page.click("#youBtn");
        await waitOpen(page, "you");
        await expectReach(page, "#youDone");
        await page.click("#youDone");
        await waitClosed(page, "you");
        await page.click("#ring");
        await waitOpen(page, "reg");
        // is-open is set at the start of the slide. Measure the controls
        // when the register has reached its final position.
        await until(() => page.locator("#reg").evaluate(el => getComputedStyle(el).transform === "none"), "the register slide finishes");
        for (const sel of ["#regDone", "#xWhat", '#pad .key[data-k="7"]', '#pad .key[data-k="0"]', "#kGo", '#xPayer .seal[data-p="Trenton"]', '#xSplit .seal[data-p="Trenton"]', "#xUneven"]) {
          await expectReach(page, sel);
        }
      },
    },
    {
      name: "ring up an expense end to end, then see it on Money" + at,
      viewport: size,
      async run({ page }) {
        const backend = await money(page);
        await page.click("#ring");
        await waitOpen(page, "reg");
        await page.fill("#xWhat", "Sideways tea");
        await keys(page, "8 0 0");
        await page.click('#xPayer .seal[data-p="Ajen"]');
        await until(() => page.evaluate(() => !document.getElementById("kGo").disabled), "Ring it up is on");
        await page.click("#kGo");
        await until(
          () => page.evaluate(() => [...document.querySelectorAll("#vMoney #rc .rc-row[data-id]")].some((r) => r.textContent.includes("Sideways tea"))),
          "the line is on the receipt",
        );
        await page.click("#regDone");
        await waitClosed(page, "reg");
        await page.evaluate(() => globalThis.__matTest.store.idle());
        const saved = backend.fake.primitives.readTable_("Expenses").map(P.expenseFromRow).filter((e) => e.title === "Sideways tea");
        assert.equal(saved.length, 1);
        assert.equal(saved[0].amount, 800);
        assert.equal(saved[0].paidBy, "Ajen");
        await expectReach(page, '#nav [data-tab="days"]');
      },
    },
    {
      name: "the uneven split, a line, the settle stamp: every control in reach" + at,
      viewport: size,
      async run({ page }) {
        await money(page);
        await page.click("#ring");
        await waitOpen(page, "reg");
        await keys(page, "3 0 0 0");
        await page.click("#xUneven");
        await until(() => visible(page, "#un"), "the panel opens");
        for (const mode of ["parts", "exact"]) {
          await page.click('#unMode [data-mode="' + mode + '"]');
          await expectReach(page, "#unDone");
          await expectReach(page, "#un .un-row:first-child", true);
          await expectReach(page, "#un .un-row:last-child", true);
          await expectReach(page, "#unDone");
          await expectReach(page, "#kGo");
        }
        await page.click("#unDone");
        await until(async () => !(await visible(page, "#un")), "Set split closes it");
        await page.click("#regDone");
        await waitClosed(page, "reg");
        await page.click('#rc .rc-row[data-id="seedexp001"]');
        await waitOpen(page, "line");
        await expectReach(page, "#lnDone");
        await expectReach(page, "#lnNote", true);
        await expectReach(page, "#lnDone");
        await page.click("#lnDone");
        await waitClosed(page, "line");
        await page.click('#slip button.spot[data-key="Trenton>Mo"]');
        await until(() => page.evaluate(() => !!document.querySelector("#slip .spot.is-armed")), "armed");
        await expectReach(page, "#stampAmt", true);
        await expectReach(page, "#slip .spot.is-armed", true);
        // Stamped, then the stamp tapped: Keep it, the control that dismisses the ask, is in reach.
        await page.click("#slip .spot.is-armed");
        await until(() => page.evaluate(() => !!document.querySelector("#slip .s-row.is-paid .spot")), "stamped");
        await page.click("#slip .s-row.is-paid .spot");
        await until(() => page.evaluate(() => !!document.querySelector("#slip .rm-keep")), "the remove ask shows");
        await expectReach(page, "#slip .rm-keep", true);
        await page.click("#slip .rm-keep");
        await until(() => page.evaluate(() => !document.querySelector("#slip .rm-keep")), "Keep it dismisses the ask");
      },
    },
    {
      name: "History opens and closes; You scrolls to its last row with Done in view" + at,
      viewport: size,
      async run({ page }) {
        await money(page);
        await page.click("#histBtn");
        await waitOpen(page, "hist");
        await until(() => page.evaluate(() => document.querySelectorAll("#tape .tp-row").length > 0), "the tape fills");
        await expectReach(page, "#histDone");
        await expectReach(page, "#tape .tp-row .tp-undo");
        await page.click("#histDone");
        await waitClosed(page, "hist");
        await page.click("#youBtn");
        await waitOpen(page, "you");
        await expectReach(page, "#youDone");
        await expectReach(page, "#setReport", true);
        await expectReach(page, "#youDone");
        await page.click("#youDone");
        await waitClosed(page, "you");
      },
    },
    {
      name: "a stop on the Days ticket: open it, Edit, close; the hotel card" + at,
      viewport: size,
      async run({ page }) {
        await days(page);
        const row = '#rail .pg[data-date="' + D12 + '"] .r[data-id="' + DINNER + '"]';
        // Opened all the way (0.2 s), so Edit is still where it was tapped.
        await openStop(page, row);
        await page.click(row + " .r-edit");
        await waitOpen(page, "stop");
        await expectReach(page, "#stDone");
        await expectReach(page, "#stWhat");
        await expectReach(page, "#stSave", true);
        await expectReach(page, "#stDone");
        await page.click("#stDone");
        await waitClosed(page, "stop");
        await page.click('#rail .pg[data-date="' + D12 + '"] .tk-stay');
        await waitOpen(page, "stay");
        await expectReach(page, "#stayDone");
        await page.click("#stayDone");
        await waitClosed(page, "stay");
      },
    },
    {
      name: "turned from portrait to sideways and back: the register stays open with its amount" + at,
      async run({ page }) {
        await money(page);
        await page.click("#ring");
        await waitOpen(page, "reg");
        await page.click("#kCur"); // dollars to yen
        await keys(page, "4 5 0");
        const amount = () => page.evaluate(() => document.getElementById("xAmt").textContent);
        assert.equal(await amount(), "¥450");
        await page.setViewportSize(size);
        for (const sel of ["#kGo", "#regDone"]) await expectReach(page, sel);
        assert.equal(await isOpen(page, "reg"), true, "still open sideways");
        assert.equal(await amount(), "¥450");
        await page.setViewportSize(PORTRAIT);
        for (const sel of ["#kGo", "#regDone"]) await expectReach(page, sel);
        assert.equal(await amount(), "¥450");
        // The uneven panel, opened in portrait where it has the most room.
        await page.click("#xUneven");
        await until(() => visible(page, "#un"), "the panel opens");
        await page.setViewportSize(size);
        assert.equal(await isOpen(page, "reg"), true, "still open sideways");
        assert.equal(await amount(), "¥450");
        assert.equal(await visible(page, "#un"), true, "the panel is still open sideways");
        for (const sel of ["#unDone", "#kGo", "#regDone"]) await expectReach(page, sel);
        await page.setViewportSize(PORTRAIT);
        for (const sel of ["#unDone", "#kGo", "#regDone"]) await expectReach(page, sel);
        assert.equal(await isOpen(page, "reg"), true, "still open in portrait");
        assert.equal(await amount(), "¥450");
        assert.equal(await visible(page, "#un"), true, "the panel is still open");
      },
    },
  );
  // The tab held sideways runs the frame, the rail and ringing up.
  const tabCases = ["the frame:", "the rail:", "ring up an expense"];
  cases.push(...(size === TAB ? sized.filter((c) => tabCases.some((t) => c.name.startsWith(t))) : sized));
}

cases.push({
  name: "at 932x430 the block stands in the middle of the screen",
  viewport: { width: 932, height: 430 },
  async run({ page }) {
    await money(page);
    const p = await page.evaluate(() => {
      const r = document.getElementById("phone").getBoundingClientRect();
      return { left: r.left, right: innerWidth - r.right, width: r.width };
    });
    assert.ok(p.left > 0, "there is room either side: " + JSON.stringify(p));
    assert.ok(Math.abs(p.left - p.right) <= 1, "centred: " + JSON.stringify(p));
  },
});

cases.push({
  name: "with unequal side insets the block starts outside the larger one, on both sides",
  viewport: { width: 667, height: 375 },
  async run({ page }) {
    await money(page);
    // Chromium has no notch: the insets are stood in for by the properties the CSS reads them through.
    for (const [l, r] of [[60, 0], [0, 60], [44, 20]]) {
      const p = await page.evaluate(([l, r]) => {
        const root = document.documentElement.style;
        root.setProperty("--inset-l", l + "px");
        root.setProperty("--inset-r", r + "px");
        const b = document.getElementById("phone").getBoundingClientRect();
        return { left: b.left, right: innerWidth - b.right };
      }, [l, r]);
      const big = Math.max(l, r);
      assert.ok(p.left >= big - 0.5 && p.right >= big - 0.5, "insets " + l + "/" + r + ": the block is clear of both: " + JSON.stringify(p));
    }
  },
});

cases.push({
  name: "turned sideways and back, a view keeps its scroll position",
  viewport: PORTRAIT,
  async run({ page }) {
    await money(page);
    const top = () => page.evaluate(() => document.getElementById("vMoney").scrollTop);
    await page.evaluate(() => (document.getElementById("vMoney").scrollTop = 300));
    const before = await top();
    assert.ok(before > 0, "the view scrolled");
    await page.setViewportSize({ width: 844, height: 390 });
    await until(() => page.evaluate(() => document.getElementById("nav").getBoundingClientRect().width < 200), "the rail stands");
    await page.setViewportSize(PORTRAIT);
    await until(() => page.evaluate(() => document.getElementById("nav").getBoundingClientRect().width > 200), "the bar is back");
    assert.equal(await top(), before, "the same scroll position after turning back");
  },
});

for (const size of [{ width: 667, height: 280 }, { width: 844, height: 220 }]) {
  cases.push({
    name: "on a very short screen the uneven panel comes down over the register, Done in reach (" + size.width + "x" + size.height + ")",
    viewport: { width: 844, height: 390 },
    async run({ page }) {
      await money(page);
      await page.click("#ring");
      await waitOpen(page, "reg");
      await keys(page, "3 0 0 0");
      await page.click("#xUneven");
      await until(() => visible(page, "#un"), "the panel opens");
      await page.setViewportSize(size);
      await expectReach(page, "#unDone");
      const top = await page.evaluate(() => document.getElementById("un").getBoundingClientRect().top);
      assert.ok(top >= 0, "the panel's top is on screen: " + top);
      // Back to a roomy screen: it stands above the register again.
      await page.setViewportSize({ width: 844, height: 390 });
      await until(() => page.evaluate(() => document.getElementById("un").style.bottom === ""), "the panel hangs from the register again");
      await expectReach(page, "#unDone");
    },
  });
}

cases.push({
  name: "the stop sheet under a notch: a notice raised while it is open leaves its Done clear",
  async run({ page }) {
    await open(page, { seed: WITH_PLAN, tab: "days", nowMs: NOON12 });
    await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
    // Chromium has no notch: a 47 px top inset is stood in for, for the sheets'
    // cap (--inset-t) and for where the notice stands while a sheet is open.
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--inset-t", "47px");
      const bar = document.getElementById("ubar").style;
      bar.setProperty("top", "59px", "important"); // 12 px + the inset, as css/sheet.css puts it
      bar.setProperty("bottom", "auto", "important");
    });
    const row = '#rail .pg[data-date="' + D12 + '"] .r[data-id="' + DINNER + '"]';
    await openStop(page, row);
    // Opening the editor is setup here. An actionability scroll on this
    // partly visible row can snap the rail to yesterday before the click.
    await page.dispatchEvent(row + " .r-edit", "click");
    await waitOpen(page, "stop");
    await page.evaluate(() => globalThis.__matTest.store.notify("A notice."));
    await until(() => page.evaluate(() => !document.getElementById("ubar").hidden), "the notice shows");
    await expectReach(page, "#stDone");
    await expectReach(page, "#ubar");
    const caps = await page.evaluate(() => ["stop", "you", "line"].map((id) => getComputedStyle(document.getElementById(id)).maxHeight));
    // The stop sheet's cap is the others' less the keyboard (0 here): "calc(0px + <the same>)".
    assert.ok(caps[0].includes(caps[1]) && caps[1] === caps[2], "the stop sheet has the same cap as the others: " + caps);
  },
});

cases.push({
  name: "the uneven panel is never squeezed below 120 px",
  viewport: { width: 844, height: 390 },
  async run({ page }) {
    await money(page);
    await page.click("#ring");
    await waitOpen(page, "reg");
    await keys(page, "3 0 0 0");
    await page.click("#xUneven");
    await until(() => visible(page, "#un"), "the panel opens");
    // As a keyboard would: the layout viewport shrinks to almost nothing.
    await page.setViewportSize({ width: 844, height: 140 });
    await until(() => page.evaluate(() => document.getElementById("un").style.getPropertyValue("--un-room") === "120px"), "the panel keeps 120 px");
  },
});

cases.push({
  // A desktop window is no longer a framed phone (Task 21, tests/e2e/desktop.e2e.cjs): it is WIDE, two panes and the rail.
  name: "a desktop window is the two panes, and a phone in portrait keeps the phone as it was",
  viewport: { width: 1024, height: 768 },
  async run({ page }) {
    await money(page);
    const box = () => page.evaluate(() => {
      const phone = document.getElementById("phone");
      const r = phone.getBoundingClientRect();
      return { width: r.width, height: r.height, radius: getComputedStyle(phone).borderTopLeftRadius };
    });
    assert.deepEqual(await box(), { width: 1024, height: 768, radius: "0px" });
    await page.setViewportSize(PORTRAIT);
    await until(async () => (await box()).width === 390, "the phone fills the width");
    assert.deepEqual(await box(), { width: 390, height: 844, radius: "0px" });
  },
});

module.exports = cases;
