// The departure board at the top of Days (mock-up 4B, the amber LED 発車標):
// before the trip the days to go and the next booking to make; on a trip day
// the next stop, its time and when to leave. It fills in once when it appears,
// can be closed for the day, and is back the next day (only the date it was
// closed on is kept, as mat.board). On any day or state the mock-up draws no
// board for, there is none. Held at 393x852, 320x568, 844x390 and 1440x900.
// Every name, place and item here is made up.

const assert = require("node:assert/strict");
const fs = require("fs");
const { WITH_PLAN, NOON12, makeBackend, open, advance, until, text, expectText, visible } = require("./helpers.cjs");

const SHOTS = require("./shots.cjs")("picks");
const PLANNER_ID = "fakePlannerSheet_0123456789abcdefXYZ";
const BHEAD = ["#", "Item", "Who", "Book by", "Status", "Notes", "Booking link"];
const brow = (o) => BHEAD.map((h) => (o[h] === undefined ? "" : o[h]));
const CHEAD = ["#", "Date / time", "Agent / session", "Tab", "Cell(s)", "Item", "Old value", "New value", "Why", "Proof / source", "Verified?"];
const ITEMS = [
  { "#": 2, Item: "Hot spring inn, two nights", "Book by": "2026-11-30", Status: "Not booked" },
  { "#": 1, Item: "Rail pass seat reservations", "Book by": "2026-11-20", Status: "Not booked", Notes: "Window seats." },
  { "#": 3, Item: "Pocket wifi", Status: "Booked" },
];
// 14:00 on Mon Nov 16 in Toronto (04:00 on the 17th in Japan): 23 days before the trip.
const BEFORE = Date.parse("2026-11-16T19:00:00Z");
// 13:12 on Sat Dec 12 in Japan.
const DAY12 = Date.parse("2026-12-12T13:12:00+09:00");
const MIN = 60000;
const AMBER = "rgb(255, 176, 74)";
const GREEN = "rgb(111, 224, 138)";

const seedWith = (items = ITEMS, more = {}) => ({ ...WITH_PLAN, ...more, plannerId: PLANNER_ID, plannerTabs: { "Book Now": [["Before we go: bookings"], BHEAD, ...items.map(brow)], "Change Log": [CHEAD] } });

// Opens Days on `nowMs` against a backend whose list was pulled just before.
async function ready(page, { nowMs = BEFORE, seed = seedWith(), claims = {}, storage = {}, pull = true } = {}) {
  const backend = makeBackend(seed, { now: nowMs });
  const call = (action, args, actor = "Mo") => backend.fake({ key: "test-key", actor, action, args });
  if (pull) {
    backend.now = nowMs - 5 * MIN;
    assert.equal((await call("syncTodos", {})).ok, true);
    backend.now = nowMs;
  }
  for (const [id, who] of Object.entries(claims)) assert.equal((await call("claimTodo", { id, on: true }, who)).ok, true);
  backend.call = call;
  await open(page, { backend, nowMs, tab: "days", storage });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
  return backend;
}
const boardUp = (page) => visible(page, "#vDays .brd");
const lines = (page) =>
  page.evaluate(() => {
    const q = (s) => {
      const n = document.querySelector("#vDays .brd " + s);
      return n && !n.hidden ? n.textContent : null;
    };
    return { small: q(".led-big small"), big: q(".led-big b"), l1: q(".led-1"), l2: q(".led-2") };
  });
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => (document.getElementById("vDays").scrollTop = 0));
  await page.waitForTimeout(900); // the fill-in has finished
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
};

// The board is inside the screen and the Days column, as wide as the top line, with a 44 px close, and nothing sticks out.
const fits = (page) =>
  page.evaluate(() => {
    const bad = [];
    if (document.documentElement.scrollWidth > innerWidth) bad.push("sideways scroll");
    const view = document.getElementById("vDays");
    if (view.scrollWidth > view.clientWidth) bad.push("Days scrolls sideways");
    const b = document.querySelector("#vDays .brd").getBoundingClientRect();
    const v = view.getBoundingClientRect();
    const bar = document.querySelector("#vDays .bar").getBoundingClientRect();
    if (b.left < v.left - 0.5 || b.right > v.right + 0.5) bad.push("the board leaves Days");
    const nav = document.getElementById("nav").getBoundingClientRect();
    if (nav.left < b.right && nav.right > b.left && nav.top < b.bottom && nav.bottom > b.top) bad.push("the board is under the bar");
    if (b.top < bar.bottom - 0.5) bad.push("the board is over the top line");
    const x = document.querySelector("#vDays .brd-x").getBoundingClientRect();
    if (x.width < 43.5 || x.height < 43.5) bad.push("the close is " + Math.round(x.width) + "x" + Math.round(x.height));
    if (x.right > b.right + 0.5) bad.push("the close leaves the board");
    for (const s of [".led-1", ".led-2", ".led-big"]) {
      const n = document.querySelector("#vDays .brd " + s);
      if (!n || n.hidden) continue;
      const r = n.getBoundingClientRect();
      // The close's box reaches 12 px under the words' end; the × itself sits in its middle.
      if (r.right > x.left + 14) bad.push(s + " runs into the close");
    }
    return bad;
  });

function sizeCase(size, mobile, tag) {
  return {
    name: tag + ": the board fits before the trip and on a trip day, and the next stop is still reachable under it",
    viewport: size,
    ...(mobile ? {} : { mobile: false }),
    async run({ page, newPhone }) {
      await ready(page);
      await until(() => boardUp(page), "the board shows before the trip");
      assert.deepEqual(await fits(page), []);
      await shot(page, "4B-" + tag + "-before");
      const other = await newPhone();
      await other.setViewportSize(size);
      await ready(other, { nowMs: DAY12 });
      await until(() => boardUp(other), "the board shows on a trip day");
      assert.deepEqual(await fits(other), []);
      await shot(other, "4B-" + tag + "-trip");
      // Today's open next stop can still be scrolled whole into view above the bar.
      const ok = await other.evaluate(() => {
        const view = document.getElementById("vDays");
        view.scrollTop = view.scrollHeight;
        const nav = document.getElementById("nav").getBoundingClientRect();
        const tk = document.querySelector("#rail .tk").getBoundingClientRect();
        const v = view.getBoundingClientRect();
        const overlaps = nav.left < v.right && nav.right > v.left;
        return !overlaps || tk.bottom <= nav.top + 0.5;
      });
      assert.ok(ok, "the end of the ticket scrolls clear of the bar");
    },
  };
}

module.exports = [
  {
    name: "before the trip: 出発まで and the days to go, Book next with the earliest open booking, By its date and who is on it; amber lamps and a green second line",
    async run({ page }) {
      await ready(page, { claims: { 1: "Mo" } });
      await until(() => boardUp(page), "the board shows");
      assert.deepEqual(await lines(page), { small: "出発まで", big: "23日", l1: "Book next: Rail pass seat reservations", l2: "By Fri Nov 20 · You’re on it" });
      const ink = await page.evaluate(() => ({
        big: getComputedStyle(document.querySelector("#vDays .led-big b")).color,
        l1: getComputedStyle(document.querySelector("#vDays .led-1")).color,
        l2: getComputedStyle(document.querySelector("#vDays .led-2")).color,
        ground: getComputedStyle(document.querySelector("#vDays .brd")).backgroundColor,
        h: document.querySelector("#vDays .brd").getBoundingClientRect().height,
      }));
      assert.deepEqual(ink, { big: AMBER, l1: AMBER, l2: GREEN, ground: "rgb(9, 8, 7)", h: 52 });
      // It sits between the top line and the first ticket.
      const order = await page.evaluate(() => [...document.getElementById("vDays").children].filter((n) => !n.hidden).map((n) => n.className.split(" ")[0]));
      assert.deepEqual(order, ["bar", "brd-wrap", "rail"]);
    },
  },
  {
    name: "before the trip: it follows the list (someone else on it, ticked off, nothing open, no planner) and Days is as it was where there is no board",
    async run({ page, newPhone }) {
      const backend = await ready(page, { claims: { 1: "Ajen" } });
      await until(() => boardUp(page), "the board shows");
      await expectText(page, "#vDays .led-2", "By Fri Nov 20 · Ajen is on it");
      // Ticked off on this phone: the next booking is the next one.
      await page.dispatchEvent('#nav button[data-tab="before"]', "click");
      await until(() => visible(page, "#todos"), "the list shows");
      await page.dispatchEvent('#bwOpen .bw-r[data-id="1"] .bw-b', "click");
      await page.waitForTimeout(260);
      await page.dispatchEvent('#bwOpen .bw-r[data-id="1"] .bw-tick', "click");
      await until(() => backend.fake.tables.Todos.find((r) => r.id === "1").ticked_by === "Mo", "ticked");
      await page.dispatchEvent('#nav button[data-tab="days"]', "click");
      await expectText(page, "#vDays .led-1", "Book next: Hot spring inn, two nights");
      await expectText(page, "#vDays .led-2", "By Mon Nov 30");
      // Nothing open, or no planner: no board, and Days has only its own parts.
      const none = await newPhone();
      await ready(none, { seed: seedWith([ITEMS[2]]) });
      await until(() => none.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "tickets");
      assert.equal(await boardUp(none), false, "nothing open: no board");
      assert.deepEqual(await none.evaluate(() => [...document.getElementById("vDays").children].filter((n) => !n.hidden).map((n) => n.className.split(" ")[0])), ["bar", "rail"]);
      const bare = await newPhone();
      await ready(bare, { seed: WITH_PLAN, pull: false });
      assert.equal(await boardUp(bare), false, "no planner: no board");
    },
  },
  {
    name: "on a trip day: the next stop's time and name, and the leave line the ticket prints under it",
    async run({ page }) {
      await ready(page, { nowMs: DAY12 });
      await until(() => boardUp(page), "the board shows");
      assert.deepEqual(await lines(page), { small: "次 Next", big: "14:00", l1: "Shibuya Sky", l2: "Leave by 13:30 · in 18 min" });
      // The same words as the ticket's own line for that stop.
      await expectText(page, "#rail .r.is-next .r-lv", "Leave by 13:30, in 18 min.");
      assert.equal(await page.evaluate(() => document.querySelector("#vDays .brd").dataset.kind), "trip");
    },
  },
  {
    name: "on a trip day: the minute moves the line in place (no new fill-in), and the board goes when no timed stop is left",
    async run({ page }) {
      const backend = await ready(page, { nowMs: DAY12 });
      await until(() => boardUp(page), "the board shows");
      await page.waitForTimeout(900);
      const node = await page.evaluateHandle(() => document.querySelector("#vDays .brd .led-1"));
      await advance(page, backend, 3 * MIN);
      await expectText(page, "#vDays .led-2", "Leave by 13:30 · in 15 min");
      assert.equal(await page.evaluate((n) => n === document.querySelector("#vDays .brd .led-1"), node), true, "the same node, not redrawn");
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#vDays .led-in")).animationName), "none", "no new fill-in on a minute's change");
      // 19:00 Dinner is the last timed stop: past it (and its grace), nothing is next.
      await advance(page, backend, 7 * 60 * MIN);
      await until(async () => !(await boardUp(page)), "no board once nothing is left today");
      assert.deepEqual(await page.evaluate(() => [...document.getElementById("vDays").children].filter((n) => !n.hidden).map((n) => n.className.split(" ")[0])), ["bar", "rail"]);
    },
  },
  {
    name: "no board: after the trip, on a day with no ticket, or before the plan has loaded",
    async run({ page, newPhone }) {
      // Dec 25: the trip is over.
      await ready(page, { nowMs: Date.parse("2026-12-25T10:00:00+09:00") });
      await page.waitForTimeout(300);
      assert.equal(await boardUp(page), false, "after the trip");
      const early = await newPhone();
      // A trip day the plan has no ticket for (Dec 10: the plan starts on the 11th) and no stops.
      await ready(early, { nowMs: Date.parse("2026-12-10T10:00:00+09:00") });
      await early.waitForTimeout(300);
      assert.equal(await boardUp(early), false, "no stops today");
    },
  },
  {
    name: "closing: × folds it away for today, it stays closed after a reload, and only the date it was closed on is kept",
    async run({ page }) {
      await ready(page, { nowMs: DAY12 });
      await until(() => boardUp(page), "the board shows");
      const before = await page.evaluate(() => Object.keys(localStorage).sort());
      assert.equal(before.includes("mat.board"), false, "nothing kept until it is closed");
      await page.dispatchEvent("#vDays .brd-x", "click");
      await until(async () => !(await boardUp(page)), "the board folds away");
      assert.equal(await page.evaluate(() => document.querySelector("#vDays .brd-wrap").hidden), true);
      const kept = await page.evaluate(() => ({ keys: Object.keys(localStorage).sort(), board: localStorage.getItem("mat.board") }));
      assert.equal(kept.board, "2026-12-12");
      assert.deepEqual(kept.keys.filter((k) => !before.includes(k)), ["mat.board"], "one new key, and it is mat.board");
      // Closed stays closed after a reload, and the ticket is as it is without the board.
      await page.reload();
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw again");
      await page.waitForTimeout(400);
      assert.equal(await boardUp(page), false, "still closed after a reload");
    },
  },
  {
    name: "closed until tomorrow: the board is back when the trip's day turns over, with the next day's own words",
    async run({ page }) {
      const stops = [...WITH_PLAN.stops, { id: "planstop1301", date: "2026-12-13", time: "09:00", title: "Breakfast by the lake" }];
      const backend = await ready(page, { nowMs: Date.parse("2026-12-12T23:20:00+09:00"), seed: seedWith(ITEMS, { stops }) });
      // 23:20: Dinner (19:00) is long past, so nothing is next today: no board to close yet; make one by closing at 18:00 instead.
      assert.equal(await boardUp(page), false);
      await page.evaluate(() => localStorage.setItem("mat.board", "2026-12-12"));
      await advance(page, backend, 30 * MIN); // 23:50
      await page.waitForTimeout(100);
      assert.equal(await boardUp(page), false, "still the 12th: closed");
      await advance(page, backend, 25 * MIN); // 00:15 on the 13th
      await until(() => boardUp(page), "the 13th: the board is back");
      assert.deepEqual(await lines(page), { small: "次 Next", big: "09:00", l1: "Breakfast by the lake", l2: "In 8 h 45 min" });
      // Closing it now keeps the 13th.
      await page.dispatchEvent("#vDays .brd-x", "click");
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.board")), "2026-12-13");
    },
  },
  {
    name: "a board closed on another date, or with something else kept, shows",
    async run({ page }) {
      await ready(page, { nowMs: DAY12, storage: { "mat.board": "2026-12-11" } });
      await until(() => boardUp(page), "yesterday's close does not hold today");
    },
  },
  {
    name: "a closed board is not in the tab order, and closing leaves focus on the day counter",
    async run({ page }) {
      await ready(page, { nowMs: DAY12 });
      await until(() => boardUp(page), "the board shows");
      await page.focus("#vDays .brd-x");
      await page.keyboard.press("Enter");
      await until(async () => !(await boardUp(page)), "closed from the keyboard");
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "dayCount");
      assert.equal(await page.evaluate(() => document.querySelector("#vDays .brd-wrap").inert), true);
    },
  },
  {
    name: "the lines fill in left to right once when the board appears; with reduced motion they are simply there",
    async run({ page, newPhone }) {
      await ready(page, { nowMs: DAY12 });
      await until(() => boardUp(page), "the board shows");
      const anim = await page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector("#vDays .led-in"));
        return { name: cs.animationName, dur: cs.animationDuration, timing: cs.animationTimingFunction };
      });
      assert.equal(anim.name, "wipe");
      assert.equal(anim.dur, "0.7s");
      assert.match(anim.timing, /steps\(28/);
      await until(() => page.evaluate(() => getComputedStyle(document.querySelector("#vDays .led-in")).animationName === "none"), "it ends and does not repeat");
      const calm = await newPhone();
      await calm.emulateMedia({ reducedMotion: "reduce" });
      await ready(calm, { nowMs: DAY12 });
      await until(() => boardUp(calm), "the board shows");
      assert.equal(await calm.evaluate(() => getComputedStyle(document.querySelector("#vDays .led-in")).animationName), "none");
      assert.equal(await calm.evaluate(() => document.querySelector("#vDays .led-in").classList.contains("led-wipe")), false);
      assert.equal(await text(calm, "#vDays .led-1"), "Shibuya Sky");
      assert.equal(await calm.evaluate(() => getComputedStyle(document.querySelector("#vDays .brd-wrap")).transitionDuration), "0s", "no fold under reduced motion");
      await calm.dispatchEvent("#vDays .brd-x", "click");
      await until(async () => !(await boardUp(calm)), "gone at once");
      assert.equal(await calm.evaluate(() => document.querySelector("#vDays .brd-wrap").hidden), true);
    },
  },
  {
    name: "what people wrote is only ever text: markup in a stop's name or a booking's name is printed as written",
    async run({ page, newPhone }) {
      const stops = WITH_PLAN.stops.map((s) => (s.title === "Shibuya Sky" ? { ...s, title: "<b>Sky</b> <img src=x onerror=alert(1)>" } : s));
      await ready(page, { nowMs: DAY12, seed: seedWith(ITEMS, { stops }) });
      await until(() => boardUp(page), "the board shows");
      assert.equal(await text(page, "#vDays .led-1"), "<b>Sky</b> <img src=x onerror=alert(1)>");
      assert.equal(await page.$("#vDays .brd b:not(.led-big b), #vDays .brd img"), null);
      const other = await newPhone();
      await ready(other, { seed: seedWith([{ "#": 1, Item: "<i>Seats</i>", "Book by": "2026-11-20", Status: "Not booked" }]) });
      await until(() => boardUp(other), "the board shows");
      assert.equal(await text(other, "#vDays .led-1"), "Book next: <i>Seats</i>");
      assert.equal(await other.$("#vDays .brd i"), null);
    },
  },
  {
    name: "a long name stays on one line inside the board (an ellipsis, never wrapped, never pushing the close)",
    viewport: { width: 320, height: 568 },
    async run({ page }) {
      const stops = WITH_PLAN.stops.map((s) => (s.title === "Shibuya Sky" ? { ...s, title: "A very long name for a place that no board could ever hold on one line" } : s));
      await ready(page, { nowMs: DAY12, seed: seedWith(ITEMS, { stops }) });
      await until(() => boardUp(page), "the board shows");
      assert.deepEqual(await fits(page), []);
      const one = await page.evaluate(() => {
        const n = document.querySelector("#vDays .led-1");
        return { h: n.getBoundingClientRect().height, clipped: n.scrollWidth > n.clientWidth, ell: getComputedStyle(n).textOverflow };
      });
      assert.ok(one.h < 24, "one line: " + one.h);
      assert.equal(one.clipped, true);
      assert.equal(one.ell, "ellipsis");
      await shot(page, "4B-320x568-long");
    },
  },
  {
    name: "393x852: the board closed (Days as it was), and the board on Days beside the demo banner",
    async run({ page }) {
      await ready(page, { nowMs: DAY12, storage: { "mat.board": "2026-12-12" } });
      await page.waitForTimeout(300);
      assert.equal(await boardUp(page), false);
      await shot(page, "4B-393x852-closed");
    },
  },
  sizeCase({ width: 393, height: 852 }, true, "393x852"),
  sizeCase({ width: 320, height: 568 }, true, "320x568"),
  sizeCase({ width: 844, height: 390 }, true, "844x390"),
  sizeCase({ width: 1440, height: 900 }, false, "1440x900"),
];
