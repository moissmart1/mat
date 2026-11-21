// The departure board's long line runs sideways (issue 75, look B): a line
// that fits never moves; a long one holds 2 s, slides to its end at 48 px a
// second, holds 2 s, goes dark for a quarter second, and is back at its first
// word; two long lines take turns; nothing runs when the board cannot be
// seen; with Reduce Motion nothing moves and the words wrap. The page's clock
// is paused by open(): the run's steps are timers, moved one at a time with
// advance() (it fires a due timer once and does not chain into the next).
// Every name, place and booking here is made up.

const assert = require("node:assert/strict");
const fs = require("fs");
const { WITH_PLAN, makeBackend, open, advance, until, text, visible } = require("./helpers.cjs");

const SHOTS = require("./shots.cjs")("picks");
const PLANNER_ID = "fakePlannerSheet_0123456789abcdefXYZ";
const BHEAD = ["#", "Item", "Who", "Book by", "Status", "Notes", "Booking link"];
const brow = (o) => BHEAD.map((h) => (o[h] === undefined ? "" : o[h]));
const CHEAD = ["#", "Date / time", "Agent / session", "Tab", "Cell(s)", "Item", "Old value", "New value", "Why", "Proof / source", "Verified?"];
const MIN = 60000;
const RUN = { hold: 2000, pxs: 48, end: 2000, dark: 250 };
// The same formula as js/board.js, written out so a wrong one there is caught here.
const runMs = (over) => Math.round((over / RUN.pxs) * 1000);

// 13:12 on Sat Dec 12 in Japan: Shibuya Sky at 14:00, Leave by 13:30 · in 18 min (both lines fit at 390).
const DAY12 = Date.parse("2026-12-12T13:12:00+09:00");
// 09:12: one stop at 14:00 that takes 150 min to reach: Leave by 11:30 · in 2 h 18 min (long at 390).
const MORNING = Date.parse("2026-12-12T09:12:00+09:00");
// Nov 23 in Toronto: the booking due Nov 20 is late, so its second line is long.
const BEFORE_LATE = Date.parse("2026-11-30T19:00:00Z");
const LONG_TITLE = "A very long name for a place that no board could ever hold on one line, not even on a wide screen, so it has to run sideways";
const MID_TITLE = "Lunch at the long noodle counter near the station";
const stopsOf = (list) => list.map((s, i) => ({ id: "bs" + i, date: "2026-12-12", time: "", title: "", ...s }));

const seedWith = (items, more = {}) => ({ ...WITH_PLAN, ...more, plannerId: PLANNER_ID, plannerTabs: { "Book Now": [["Before we go: bookings"], BHEAD, ...items.map(brow)], "Change Log": [CHEAD] } });
const ITEM = (name, o = {}) => ({ "#": 1, Item: name, "Book by": "2026-11-20", Status: "Not booked", ...o });
const tripSeed = (list) => ({ ...WITH_PLAN, stops: stopsOf(list) });

async function ready(page, { nowMs, seed, claims = {} } = {}) {
  const backend = makeBackend(seed, { now: nowMs });
  const call = (action, args, actor = "Mo") => backend.fake({ key: "test-key", actor, action, args });
  if (seed.plannerId) {
    backend.now = nowMs - 5 * MIN;
    assert.equal((await call("syncTodos", {})).ok, true);
    backend.now = nowMs;
  }
  for (const [id, who] of Object.entries(claims)) assert.equal((await call("claimTodo", { id, on: true }, who)).ok, true);
  await open(page, { backend, nowMs, tab: "days" });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
  await until(() => visible(page, "#vDays .brd"), "the board shows");
  await page.evaluate(() => document.fonts.ready);
  // Days rests on today's ticket, which on a short screen scrolls the board out of sight (and a board out of sight does not run): back to the top.
  await page.evaluate(() => (document.getElementById("vDays").scrollTop = 0));
  return backend;
}
// What the test reads of each line: is-long, data-phase, the strip's inline transform and transition, is-dark, and how far the words stick out.
const snap = (page) =>
  page.evaluate(() => {
    const out = {};
    for (const k of ["1", "2"]) {
      const L = document.querySelector("#vDays .brd .led-" + k);
      const r = L.querySelector(".led-run");
      out["l" + k] = {
        hidden: L.hidden,
        long: L.classList.contains("is-long"),
        phase: L.dataset.phase || "",
        tf: r.style.transform,
        tr: r.style.transition,
        dark: r.classList.contains("is-dark"),
        over: Math.max(0, Math.ceil(r.offsetWidth - L.clientWidth)),
      };
    }
    return out;
  });
const longNow = (page, k = 1) => page.evaluate((k) => document.querySelector("#vDays .brd .led-" + k).classList.contains("is-long"), k);
async function longUp(page, k = 1) {
  await until(() => longNow(page, k), "the line is measured long");
  await until(() => page.evaluate(() => document.fonts.status === "loaded"), "the fonts are in");
  await observed(page);
  return (await snap(page))["l" + k].over;
}
// Once the page's observers have reported on the board (a new one reports after the board's own, which was made first).
const observed = (page) => page.evaluate(() => new Promise((done) => new IntersectionObserver((_, o) => (o.disconnect(), done())).observe(document.querySelector("#vDays .brd"))));
const REST = { phase: "", tf: "", dark: false };
const atRest = (l) => ({ phase: l.phase, tf: l.tf, dark: l.dark });
// One long line's whole turn, a step at a time. Returns once its hold after the turn has begun (the next run is due 2 s on).
async function turn(page, backend, k) {
  const key = "l" + k;
  const over = (await snap(page))[key].over;
  const ms = runMs(over);
  assert.ok(over > 0, "line " + k + " is long");
  await advance(page, backend, RUN.hold);
  let s = (await snap(page))[key];
  assert.equal(s.phase, "run");
  assert.equal(s.tf, "translateX(-" + over + "px)");
  assert.equal(s.tr, "transform " + ms + "ms linear");
  await advance(page, backend, ms);
  s = (await snap(page))[key];
  assert.deepEqual([s.phase, s.tf, s.dark], ["end", "translateX(-" + over + "px)", false]);
  await advance(page, backend, RUN.end);
  s = (await snap(page))[key];
  assert.deepEqual([s.phase, s.dark], ["dark", true]);
  await advance(page, backend, RUN.dark);
  s = (await snap(page))[key];
  assert.deepEqual(atRest(s), REST, "back at its first word, lit, at once");
  assert.equal(s.tr, "none", "no slide back");
}
const lineRect = (page, k) => page.evaluate((k) => {
  const L = document.querySelector("#vDays .brd .led-" + k);
  const r = L.getBoundingClientRect();
  const s = L.querySelector(".led-run").getBoundingClientRect();
  const x = document.querySelector("#vDays .brd-x").getBoundingClientRect();
  return { l: r.left, r: r.right, t: r.top, b: r.bottom, sl: s.left, sr: s.right, xl: x.left };
}, k);
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/boardscroll-" + name + ".png" });
};

// Nothing sticks out sideways, and the board's lines agree with their own measure.
const sound = (page) =>
  page.evaluate(() => {
    const bad = [];
    if (document.documentElement.scrollWidth > innerWidth) bad.push("sideways scroll");
    const view = document.getElementById("vDays");
    if (view.scrollWidth > view.clientWidth) bad.push("Days scrolls sideways");
    const x = document.querySelector("#vDays .brd-x").getBoundingClientRect();
    if (x.width < 43.5 || x.height < 43.5) bad.push("the close is " + Math.round(x.width) + "x" + Math.round(x.height));
    for (const k of ["1", "2"]) {
      const L = document.querySelector("#vDays .brd .led-" + k);
      if (L.hidden) continue;
      if (L.getBoundingClientRect().right > x.left + 14) bad.push("line " + k + " runs into the close");
      const r = L.querySelector(".led-run");
      const over = Math.max(0, Math.ceil(r.offsetWidth - L.clientWidth));
      if ((over > 1) !== L.classList.contains("is-long")) bad.push("line " + k + " is-long disagrees with its width");
    }
    return bad;
  });

function sizeCase(size, mobile, tag) {
  return {
    name: tag + ": a line that fits there stands still, one that is still too long runs, and nothing sticks out",
    viewport: size,
    ...(mobile ? {} : { mobile: false }),
    async run({ page, newPhone }) {
      const backend = await ready(page, { nowMs: DAY12, seed: tripSeed([{ time: "14:00", title: "Shibuya Sky", travelMin: 30 }]) });
      assert.deepEqual(await sound(page), []);
      let s = await snap(page);
      assert.deepEqual([s.l1.long, s.l2.long], [false, false], "both lines fit");
      await advance(page, backend, RUN.hold);
      s = await snap(page);
      assert.deepEqual([atRest(s.l1), atRest(s.l2)], [REST, REST], "and stand still");
      const other = await newPhone();
      await other.setViewportSize(size);
      const b2 = await ready(other, { nowMs: DAY12, seed: tripSeed([{ time: "14:00", title: LONG_TITLE, travelMin: 30 }]) });
      const over = await longUp(other);
      assert.deepEqual(await sound(other), []);
      await advance(other, b2, RUN.hold);
      s = await snap(other);
      assert.equal(s.l1.phase, "run");
      assert.equal(s.l1.tf, "translateX(-" + over + "px)");
      assert.equal(s.l1.tr, "transform " + runMs(over) + "ms linear", "the same 48 px a second");
      assert.deepEqual(await sound(other), []);
    },
  };
}

module.exports = [
  {
    name: "a line that fits never moves: no is-long, no phase, no transform, after a minute of clock",
    async run({ page }) {
      const backend = await ready(page, { nowMs: DAY12, seed: tripSeed([{ time: "14:00", title: "Shibuya Sky", travelMin: 30 }]) });
      for (let i = 0; i < 6; i++) {
        await advance(page, backend, 10000);
        const s = await snap(page);
        for (const l of [s.l1, s.l2]) assert.deepEqual([l.long, atRest(l), l.tr], [false, REST, "none"]);
      }
      assert.equal(await text(page, "#vDays .led-1"), "Shibuya Sky");
    },
  },
  {
    name: "a long first line: holds 2 s, runs to its end at 48 px a second, holds 2 s, goes dark for a quarter second, and is back at its first word",
    async run({ page }) {
      const backend = await ready(page, { nowMs: DAY12, seed: tripSeed([{ time: "14:00", title: LONG_TITLE, travelMin: 30 }]) });
      await longUp(page);
      let s = await snap(page);
      assert.deepEqual([atRest(s.l1), s.l2.long], [REST, false], "every line stands at its first word to begin with");
      await advance(page, backend, RUN.hold - 1);
      assert.equal((await snap(page)).l1.phase, "", "the hold is 2 s");
      await advance(page, backend, 1);
      s = await snap(page);
      assert.equal(s.l1.phase, "run");
      const style = await page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector("#vDays .brd .led-1 .led-run"));
        return { fn: cs.transitionTimingFunction, dur: cs.transitionDuration, prop: cs.transitionProperty };
      });
      assert.equal(style.fn, "linear");
      assert.equal(style.prop, "transform");
      assert.equal(style.dur, s.l1.over / 48 + "s", "over / 48 seconds");
      await advance(page, backend, runMs(s.l1.over));
      assert.equal((await snap(page)).l1.phase, "end");
      await advance(page, backend, RUN.end - 1);
      assert.equal((await snap(page)).l1.phase, "end", "it stands at its end for 2 s");
      await advance(page, backend, 1);
      assert.deepEqual([(await snap(page)).l1.phase, (await snap(page)).l1.dark], ["dark", true]);
      await advance(page, backend, RUN.dark);
      s = await snap(page);
      assert.deepEqual([atRest(s.l1), s.l1.tr], [REST, "none"]);
      // And it goes round again, after another 2 s hold.
      await advance(page, backend, RUN.hold - 1);
      assert.equal((await snap(page)).l1.phase, "");
      await advance(page, backend, 1);
      assert.equal((await snap(page)).l1.phase, "run");
    },
  },
  {
    name: "at its end the last letter is at the window's edge, and the line's box has not moved or passed the close",
    async run({ page }) {
      const backend = await ready(page, { nowMs: DAY12, seed: tripSeed([{ time: "14:00", title: LONG_TITLE, travelMin: 30 }]) });
      const over = await longUp(page);
      const first = await lineRect(page, 1);
      await advance(page, backend, RUN.hold);
      await advance(page, backend, runMs(over));
      // The slide itself runs on the real clock: wait for the strip to arrive.
      await until(async () => Math.abs((await lineRect(page, 1)).sr - first.r) <= 1.5, "the last letter reaches the window's edge", runMs(over) + 4000);
      const end = await lineRect(page, 1);
      assert.deepEqual([end.l, end.r, end.t, end.b], [first.l, first.r, first.t, first.b], "the line's box has not moved");
      assert.ok(end.r <= end.xl + 14, "and does not pass the close");
      assert.ok(end.sl < first.l, "the words slid left");
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#vDays .brd .led-1")).overflow), "hidden", "a hard clip");
      assert.deepEqual(await sound(page), []);
    },
  },
  {
    name: "two long lines take turns: amber first, then green, never both at once",
    // 360 wide: at 390 the made-up second line just fits its window, so it would not be long.
    viewport: { width: 360, height: 800 },
    async run({ page }) {
      // Before the trip, with a booking that is late: a long item and a long second line ("Was due ... late ...").
      const backend = await ready(page, { nowMs: BEFORE_LATE, seed: seedWith([ITEM("Reserved seats on the long coast express for everyone")]), claims: { 1: "Ajen" } });
      await longUp(page, 1);
      await longUp(page, 2);
      assert.match(await text(page, "#vDays .led-2"), /^Was due Fri Nov 20 · 10 days late · Ajen is on it$/);
      const phases = async () => {
        const s = await snap(page);
        assert.ok([s.l1, s.l2].filter((l) => l.phase).length <= 1, "never both at once: " + JSON.stringify([s.l1.phase, s.l2.phase]));
        return [s.l1.phase, s.l2.phase];
      };
      const first = await snap(page);
      assert.deepEqual(await phases(), ["", ""]);
      await advance(page, backend, RUN.hold);
      assert.deepEqual(await phases(), ["run", ""], "amber first");
      await advance(page, backend, runMs(first.l1.over));
      assert.deepEqual(await phases(), ["end", ""]);
      await advance(page, backend, RUN.end);
      assert.deepEqual(await phases(), ["dark", ""]);
      await advance(page, backend, RUN.dark);
      assert.deepEqual(await phases(), ["", ""]);
      await advance(page, backend, RUN.hold);
      assert.deepEqual(await phases(), ["", "run"], "then green");
      await shot(page, "390-two-lines-green");
      await advance(page, backend, runMs(first.l2.over));
      assert.deepEqual(await phases(), ["", "end"]);
      await advance(page, backend, RUN.end);
      assert.deepEqual(await phases(), ["", "dark"]);
      await advance(page, backend, RUN.dark);
      assert.deepEqual(await phases(), ["", ""]);
      await advance(page, backend, RUN.hold);
      assert.deepEqual(await phases(), ["run", ""], "and amber again");
    },
  },
  {
    name: "a redraw with the same words does not restart the run; new words put every line back at its first word and the hold starts again",
    async run({ page, newPhone }) {
      // Before the trip nothing on the board changes with the minute: a redraw leaves the run alone.
      const same = await ready(page, { nowMs: BEFORE_LATE, seed: seedWith([ITEM("Reserved seats on the long coast express for everyone")]) });
      const overA = await longUp(page);
      await advance(page, same, RUN.hold);
      assert.equal((await snap(page)).l1.phase, "run");
      const node = await page.evaluateHandle(() => document.querySelector("#vDays .brd .led-run"));
      await advance(page, same, 2 * MIN);
      let s = await snap(page);
      assert.equal(s.l1.phase, "end", "the run carried on (its own timer fired), not restarted");
      assert.equal(s.l1.tf, "translateX(-" + overA + "px)");
      assert.equal(await page.evaluate((n) => n === document.querySelector("#vDays .brd .led-run"), node), true);
      // On a trip day the second line's minutes change: every line goes back to its first word at once and the hold starts again.
      const other = await newPhone();
      const backend = await ready(other, { nowMs: MORNING, seed: tripSeed([{ time: "14:00", title: LONG_TITLE, travelMin: 150 }]) });
      const over = await longUp(other);
      await advance(other, backend, RUN.hold);
      assert.equal((await snap(other)).l1.phase, "run");
      await advance(other, backend, 3 * MIN);
      await until(async () => (await text(other, "#vDays .led-2")) === "Leave by 11:30 · in 2 h 15 min", "the minutes move");
      s = await snap(other);
      assert.deepEqual([atRest(s.l1), s.l1.long], [REST, true], "back at its first word, lit, at once");
      assert.equal(s.l1.over, over);
      await advance(other, backend, RUN.hold - 1);
      assert.equal((await snap(other)).l1.phase, "", "the hold starts again");
      await advance(other, backend, 1);
      assert.equal((await snap(other)).l1.phase, "run");
    },
  },
  {
    name: "new words that fit: the line stands still and is-long is gone",
    async run({ page }) {
      const backend = await ready(page, { nowMs: DAY12, seed: tripSeed([{ time: "13:20", title: LONG_TITLE }, { time: "19:00", title: "Dinner" }]) });
      await longUp(page);
      await advance(page, backend, RUN.hold);
      assert.equal((await snap(page)).l1.phase, "run");
      await advance(page, backend, 2 * 60 * MIN);
      await until(async () => (await text(page, "#vDays .led-1")) === "Dinner", "the next stop is Dinner");
      const s = await snap(page);
      assert.deepEqual([s.l1.long, atRest(s.l1), s.l1.tr], [false, REST, "none"]);
      await advance(page, backend, RUN.hold);
      assert.deepEqual(atRest((await snap(page)).l1), REST, "and stays still");
    },
  },
  {
    name: "closed, scrolled out of sight, on another tab of the app, or with the page hidden, nothing runs; back in sight it starts from the hold",
    async run({ page, newPhone }) {
      const seed = tripSeed([{ time: "14:00", title: LONG_TITLE, travelMin: 30 }]);
      const backend = await ready(page, { nowMs: DAY12, seed });
      await longUp(page);
      const stops = async (why) => {
        await until(async () => atRest((await snap(page)).l1).phase === "" && (await snap(page)).l1.tf === "", why);
      };
      // The page hidden.
      await advance(page, backend, RUN.hold);
      assert.equal((await snap(page)).l1.phase, "run");
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await stops("hidden: it stops");
      await advance(page, backend, 10000);
      assert.deepEqual(atRest((await snap(page)).l1), REST, "hidden: nothing runs");
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.equal((await snap(page)).l1.phase, "");
      await advance(page, backend, RUN.hold - 1);
      assert.equal((await snap(page)).l1.phase, "", "back in sight: the 2 s hold first");
      await advance(page, backend, 1);
      assert.equal((await snap(page)).l1.phase, "run");
      // On another tab of the app.
      await page.dispatchEvent('#nav button[data-tab="before"]', "click");
      await stops("another tab: it stops");
      await advance(page, backend, 10000);
      assert.deepEqual(atRest((await snap(page)).l1), REST, "another tab: nothing runs");
      await page.dispatchEvent('#nav button[data-tab="days"]', "click");
      await until(() => visible(page, "#vDays .brd"), "Days is back");
      await observed(page);
      await advance(page, backend, RUN.hold);
      assert.equal((await snap(page)).l1.phase, "run", "back on Days: it runs again, after the hold");
      // Closed with the ×: nothing runs, and it is not left running under the fold.
      const other = await newPhone();
      const b2 = await ready(other, { nowMs: DAY12, seed });
      await longUp(other);
      await advance(other, b2, RUN.hold);
      assert.equal((await snap(other)).l1.phase, "run");
      await other.dispatchEvent("#vDays .brd-x", "click");
      await until(async () => !(await visible(other, "#vDays .brd")), "closed");
      assert.deepEqual(atRest((await snap(other)).l1), REST);
      await advance(other, b2, 10000);
      assert.deepEqual(atRest((await snap(other)).l1), REST, "closed: nothing runs");
    },
  },
  {
    name: "scrolled out of sight: the run stops, and from the hold it starts again when the board is back",
    async run({ page }) {
      const stops = [];
      for (let i = 0; i < 12; i++) stops.push({ time: String(10 + i).padStart(2, "0") + ":00", title: "Stop number " + i });
      const backend = await ready(page, { nowMs: Date.parse("2026-12-12T09:12:00+09:00"), seed: tripSeed([{ time: "09:30", title: LONG_TITLE, travelMin: 10 }, ...stops]) });
      await longUp(page);
      await advance(page, backend, RUN.hold);
      assert.equal((await snap(page)).l1.phase, "run");
      const scrolled = await page.evaluate(() => {
        // The board's own box leaves the screen when Days is scrolled up by more than the board's height, or when a tab hides Days.
        const v = document.getElementById("vDays");
        v.scrollTop = v.scrollHeight;
        const b = document.querySelector("#vDays .brd").getBoundingClientRect();
        const r = v.getBoundingClientRect();
        return b.bottom <= r.top || b.top >= r.bottom;
      });
      if (!scrolled) {
        // Days does not scroll far enough to take the board out on this plan: push the board out with a spacer in Days' own column.
        await page.evaluate(() => {
          const sp = document.createElement("div");
          sp.id = "testSpacer";
          sp.style.height = "3000px";
          document.getElementById("vDays").append(sp);
          document.getElementById("vDays").scrollTop = 3000;
        });
      }
      await until(async () => (await snap(page)).l1.phase === "" && (await snap(page)).l1.tf === "", "out of sight: it stops");
      await advance(page, backend, 10000);
      assert.deepEqual(atRest((await snap(page)).l1), REST);
      await page.evaluate(() => (document.getElementById("vDays").scrollTop = 0));
      await observed(page);
      await advance(page, backend, RUN.hold - 1);
      assert.equal((await snap(page)).l1.phase, "", "back in sight: the 2 s hold first");
      await advance(page, backend, 1);
      assert.equal((await snap(page)).l1.phase, "run");
    },
  },
  {
    name: "Reduce Motion: nothing moves, the long line is on two rows with every word showing, the board is taller, and a board that fits is 52 px as before",
    async run({ page, newPhone }) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const backend = await ready(page, { nowMs: MORNING, seed: tripSeed([{ time: "14:00", title: LONG_TITLE, travelMin: 150 }]) });
      await until(() => page.evaluate(() => document.querySelector("#vDays .brd .led-1").getBoundingClientRect().height > 40), "the long line goes onto more rows");
      const info = await page.evaluate(() => {
        const o = { h: document.querySelector("#vDays .brd").getBoundingClientRect().height };
        for (const k of ["1", "2"]) {
          const L = document.querySelector("#vDays .brd .led-" + k);
          o["w" + k] = L.scrollWidth <= L.clientWidth;
          // 3 px: the last row's text box reaches 2 px below its line-height (the same on the board before this change).
          o["v" + k] = L.scrollHeight <= L.clientHeight + 3;
          o["long" + k] = L.classList.contains("is-long");
        }
        return o;
      });
      assert.ok(info.h > 52, "the board is taller: " + info.h);
      assert.deepEqual([info.w1, info.v1, info.w2, info.v2, info.long1, info.long2], [true, true, true, true, false, false]);
      assert.equal(await text(page, "#vDays .led-1"), LONG_TITLE, "every word is there");
      await advance(page, backend, RUN.hold + 5000);
      const s = await snap(page);
      assert.deepEqual([atRest(s.l1), atRest(s.l2)], [REST, REST]);
      assert.deepEqual(await sound(page), []);
      await shot(page, "390-reduce-motion");
      const calm = await newPhone();
      await calm.emulateMedia({ reducedMotion: "reduce" });
      await ready(calm, { nowMs: DAY12, seed: tripSeed([{ time: "14:00", title: "Shibuya Sky", travelMin: 30 }]) });
      assert.equal(await calm.evaluate(() => document.querySelector("#vDays .brd").getBoundingClientRect().height), 52, "a board that fits is 52 px as before");
      // Switched on mid-run: it stops at once.
      const live = await newPhone();
      const b3 = await ready(live, { nowMs: DAY12, seed: tripSeed([{ time: "14:00", title: LONG_TITLE, travelMin: 30 }]) });
      await longUp(live);
      await advance(live, b3, RUN.hold);
      assert.equal((await snap(live)).l1.phase, "run");
      await live.emulateMedia({ reducedMotion: "reduce" });
      await until(async () => (await snap(live)).l1.phase === "" && !(await snap(live)).l1.long, "Reduce Motion switched on: it stops");
    },
  },
  {
    name: "the words are in the page once: no aria-hidden, no aria-label on the lines, and the dark step keeps them in the page",
    async run({ page }) {
      const backend = await ready(page, { nowMs: DAY12, seed: tripSeed([{ time: "14:00", title: LONG_TITLE, travelMin: 30 }]) });
      await longUp(page);
      const count = () => page.evaluate((t) => (document.querySelector("#vDays .brd").textContent.split(t).length - 1), LONG_TITLE);
      assert.equal(await count(), 1);
      const attrs = () =>
        page.evaluate(() => [".led-1", ".led-2", ".led-run"].flatMap((q) => [...document.querySelectorAll("#vDays .brd " + q)].map((n) => n.hasAttribute("aria-hidden") || n.hasAttribute("aria-label") || n.hasAttribute("role") || n.hasAttribute("aria-live"))));
      assert.deepEqual((await attrs()).filter(Boolean), []);
      const over = (await snap(page)).l1.over;
      await advance(page, backend, RUN.hold);
      await advance(page, backend, runMs(over));
      await advance(page, backend, RUN.end);
      assert.equal((await snap(page)).l1.dark, true);
      const dark = await page.evaluate(() => {
        const r = document.querySelector("#vDays .brd .led-1 .led-run");
        const cs = getComputedStyle(r);
        return { hidden: r.hidden, vis: cs.visibility, op: cs.opacity, line: document.querySelector("#vDays .brd .led-1").hidden };
      });
      assert.deepEqual([dark.hidden, dark.vis, dark.line], [false, "visible", false]);
      assert.equal(await count(), 1, "still once, and still in the page");
      assert.deepEqual((await attrs()).filter(Boolean), []);
    },
  },
  {
    name: "320x568: the long first line runs; on a trip day the second line wraps as before",
    viewport: { width: 320, height: 568 },
    async run({ page, newPhone }) {
      // Before the trip, late booking: both lines are long and take their turns.
      const backend = await ready(page, { nowMs: BEFORE_LATE, seed: seedWith([ITEM("Reserved seats on the long coast express for everyone")]), claims: { 1: "Ajen" } });
      await longUp(page, 1);
      await longUp(page, 2);
      assert.deepEqual(await sound(page), []);
      const s0 = await snap(page);
      await shot(page, "320-before");
      await advance(page, backend, RUN.hold);
      assert.deepEqual([(await snap(page)).l1.phase, (await snap(page)).l2.phase], ["run", ""]);
      await advance(page, backend, runMs(s0.l1.over));
      await advance(page, backend, RUN.end);
      await advance(page, backend, RUN.dark);
      await advance(page, backend, RUN.hold);
      assert.deepEqual([(await snap(page)).l1.phase, (await snap(page)).l2.phase], ["", "run"], "then the second line");
      // On a trip day the second line wraps (the board is taller) and is never long; the first still runs.
      const other = await newPhone();
      const b2 = await ready(other, { nowMs: MORNING, seed: tripSeed([{ time: "14:00", title: LONG_TITLE, travelMin: 150 }]) });
      await longUp(other, 1);
      const t = await other.evaluate(() => ({
        white: getComputedStyle(document.querySelector("#vDays .brd .led-2")).whiteSpace,
        long: document.querySelector("#vDays .brd .led-2").classList.contains("is-long"),
        h: document.querySelector("#vDays .brd").getBoundingClientRect().height,
      }));
      assert.deepEqual([t.white, t.long], ["normal", false]);
      assert.ok(t.h >= 52, "the board is at least 52 px: " + t.h);
      await shot(other, "320-trip");
      await advance(other, b2, RUN.hold);
      assert.equal((await snap(other)).l1.phase, "run");
      assert.deepEqual(await sound(other), []);
    },
  },
  sizeCase({ width: 844, height: 390 }, true, "844x390"),
  sizeCase({ width: 1440, height: 900 }, false, "1440x900"),
  {
    name: "turning the phone re-measures: long upright, still when it fits on its side",
    async run({ page }) {
      const backend = await ready(page, { nowMs: DAY12, seed: tripSeed([{ time: "14:00", title: MID_TITLE, travelMin: 30 }]) });
      await longUp(page);
      await advance(page, backend, RUN.hold);
      assert.equal((await snap(page)).l1.phase, "run");
      await page.setViewportSize({ width: 844, height: 390 });
      await until(async () => !(await longNow(page)), "on its side the line fits: no is-long");
      let s = await snap(page);
      assert.deepEqual(atRest(s.l1), REST);
      await advance(page, backend, RUN.hold + 3000);
      assert.deepEqual(atRest((await snap(page)).l1), REST, "and it stands still");
      assert.deepEqual(await sound(page), []);
      await page.setViewportSize({ width: 390, height: 844 });
      const over = await longUp(page);
      assert.ok(over > 0);
      assert.deepEqual(atRest((await snap(page)).l1), REST, "upright again: from the hold");
      await advance(page, backend, RUN.hold);
      assert.equal((await snap(page)).l1.phase, "run");
    },
  },
];
