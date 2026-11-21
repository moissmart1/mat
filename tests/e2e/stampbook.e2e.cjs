/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The stamp book on the phone: the way in from Days, twelve rings, pressing,
// the refusals, holding a stamp up, History and undo, an older Sheet with no
// stamp tabs, a phone on another time zone, and no sideways scroll. The
// fake backend runs the real backend code. Every name and drawing here is
// invented; the dates are the fixture trip's own (the eleven days of the seed).

const shotPath = require("./shots.cjs");
const assert = require("node:assert/strict");
const { WITH_PLAN, NOON12, makeBackend, open, advance, until, atRest, text, expectText, visible } = require("./helpers.cjs");

const HOUR = 3600000;
const KEY = "test-key";
const FIRST = Date.parse("2026-12-10T00:00:00+09:00");
// An arbitrary spread of drawings and inks over the eleven days (invented).
const MOTIF = ["record", "sake", "tower", "lamp", "books", "snow", "mountain", "lantern", "onsen", "temple", "plane"];
const INK = ["ai", "shu", "matsu"];
const NAME = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo"];

// Eleven day stamps (s01 on Dec 10, s03 on Dec 12 ...) and the issue stamp.
const DEFS = [
  ...MOTIF.map((motif, i) => ({
    id: "s" + String(i + 1).padStart(2, "0"),
    date: new Date(FIRST + i * 24 * HOUR + 9 * HOUR).toISOString().slice(0, 10),
    name_ja: "試" + (i + 1),
    name_en: "Testville " + NAME[i],
    place: "Place " + NAME[i],
    motif,
    ink: INK[i % 3],
    shape: i % 4 === 3 ? "square" : "round",
  })),
  { id: "iss", date: "", name_ja: "発行", name_en: "Issued", place: "", motif: "crest", ink: "shu", shape: "round" },
];
const TODAY = "s03"; // Dec 12, the fixture clock's day

async function backendWith(defs = DEFS, seed = WITH_PLAN, nowMs = NOON12) {
  const backend = makeBackend(seed, { now: nowMs });
  for (const d of defs) backend.fake.tables.StampDefs.push({ ...d });
  return backend;
}

async function ready(page, { defs = DEFS, backend, nowMs = NOON12, seed } = {}) {
  const be = backend || (await backendWith(defs, seed || WITH_PLAN, nowMs));
  await open(page, { backend: be, nowMs, tab: "days" });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
  return be;
}

const press = (be, action = "pressStamp") => be.requests.filter((r) => r.action === action);
const isOpen = (page) => page.evaluate(() => document.getElementById("book").classList.contains("is-open"));
// Open, and risen all the way (the panel slides up over half a second of real time).
const waitBook = (page) => atRest(page, "#book", { message: "the book opens" });
const openBook = async (page) => {
  await page.click("#stampBtn");
  await waitBook(page);
};
const cell = (id) => '#bookGrid .bk-cell[data-def="' + id + '"]';
const cellClass = (page, id) => page.evaluate((s) => document.querySelector(s).className, cell(id));
const idle = (page) => page.evaluate(() => globalThis.__matTest.store.idle());
const count = (page) => text(page, "#bookN");
// A person's row in the Today row: "name|time" (the seal's letters are left out).
const who = (page, n) => page.evaluate((i) => {
  const p = document.querySelector("#bookWho .bk-p:nth-child(" + i + ")");
  return p ? p.querySelector("b").textContent + "|" + p.querySelector("span i").textContent : null;
}, n);
// Everything on the page that is a stamp drawn in a ring.
const stampsDrawn = (page) => page.locator("#bookGrid .bk-st").count();

module.exports = [
  {
    name: "with no definitions the Days bar has no stamp button and today's ticket has no line; the rest of Days is as it was",
    async run({ page }) {
      await ready(page, { defs: [] });
      assert.equal(await visible(page, "#stampBtn"), false);
      assert.equal(await page.locator(".tk-stampline").count(), 0);
      assert.equal(await visible(page, "#dayCount"), true);
      assert.ok((await page.locator("#rail .tk").count()) > 0);
    },
  },
  {
    name: "a Sheet where migrate has not been run: no button, no line, Days works, and the book is simply absent",
    async run({ page }) {
      const be = await ready(page, { defs: [], seed: { ...WITH_PLAN, missingTabs: ["StampDefs", "Stamps"] } });
      assert.equal(await visible(page, "#stampBtn"), false);
      assert.equal(await page.locator(".tk-stampline").count(), 0);
      assert.equal(await page.evaluate(() => globalThis.__matTest.store.state.status), "ready");
      assert.deepEqual(await page.evaluate(() => [globalThis.__matTest.store.state.stampDefs, globalThis.__matTest.store.state.stamps]), [[], []]);
      // everything else still writes: a stop add reaches the backend
      assert.ok(be.requests.some((r) => r.action === "load"));
    },
  },
  {
    name: "the Days bar button reads the count and opens the book: twelve cells, today's ring open, the rest not",
    async run({ page }) {
      await ready(page);
      await until(() => visible(page, "#stampBtn"), "the stamp button shows");
      assert.equal(await page.getAttribute("#stampBtn", "aria-label"), "Stamp book, 0 of 12");
      assert.equal(await text(page, "#stampBtn"), "0/12");
      assert.equal((await page.locator("#stampBtn").boundingBox()).height >= 44, true, "a 44 px tap target");
      await openBook(page);
      assert.equal(await page.locator("#bookGrid .bk-cell").count(), 12);
      assert.equal(await text(page, "#bookN"), "0 of 12");
      assert.equal(await text(page, "#bookSpan"), "2026.12.10 → 12.20");
      assert.equal(await text(page, ".bk-rule"), "One stamp a day, pressed on the day, in the place.");
      assert.equal(await text(page, ".bk-title"), "スタンプ帳 Stamp book");
      assert.equal(await text(page, ".bk-h b"), "MAT 記念スタンプ帳");
      assert.match(await cellClass(page, TODAY), /is-open/);
      assert.match(await cellClass(page, "s02"), /is-missed/);
      assert.match(await cellClass(page, "s04"), /is-soon/);
      assert.match(await cellClass(page, "iss"), /is-open/, "the issue stamp is open from the start");
      // an open ring: the day number over PRESS; a ring not open: the day number over the weekday
      assert.equal(await text(page, cell(TODAY) + " .bk-ghost"), "12PRESS");
      assert.equal(await text(page, cell("s04") + " .bk-ghost"), "13Sun");
      assert.equal(await stampsDrawn(page), 0, "nothing is drawn until it is pressed");
      assert.equal(await page.locator("#bookGrid .bk-cell").evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 44)), true);
    },
  },
  {
    name: "pressing today's ring draws its stamp, raises the count, shows the time in the Today row, and two fast taps send one request",
    async run({ page }) {
      const be = await ready(page);
      await openBook(page);
      // two taps in the same instant
      await page.locator(cell(TODAY)).click();
      await page.locator(cell(TODAY)).click();
      await until(() => stampsDrawn(page).then((n) => n === 1), "the stamp is drawn");
      await idle(page);
      assert.equal(press(be).length, 1, "one pressStamp for two taps");
      assert.equal(await text(page, "#bookSay"), "Stamped.");
      assert.equal(await text(page, "#bookN"), "1 of 12");
      assert.equal(await page.getAttribute("#stampBtn", "aria-label"), "Stamp book, 1 of 12");
      assert.equal(await isOpen(page), true);
      assert.equal(await page.locator("#book .bk-look").count(), 0, "the second tap did not hold the stamp up");
      assert.match(await cellClass(page, TODAY), /is-have/);
      // the Today row: me at 13:20 Japan time, the others not yet
      assert.equal(await text(page, "#bookTH"), "今日 Today");
      assert.equal(await who(page, 1), "You|13:20");
      assert.equal(await who(page, 2), "Ajen|not yet");
      assert.equal(await page.locator("#bookWho .bk-p.is-in").count(), 1);
      // one row, one History line, in the backend
      assert.equal(be.fake.tables.Stamps.length, 1);
      assert.deepEqual([be.fake.tables.Stamps[0].id, be.fake.tables.Stamps[0].who], [TODAY + "|Mo", "Mo"]);
      assert.equal(be.fake.tables.Log.filter((r) => r.kind === "stamp").map((r) => r.summary)[0], "stamped Dec 12");
      // it stays across a reload
      await page.reload();
      await until(() => visible(page, "#stampBtn"), "the button again");
      assert.equal(await text(page, "#stampBtn"), "1/12");
    },
  },
  {
    name: "a ring not open yet and a ring that has closed each say so in one line and send nothing",
    async run({ page }) {
      const be = await ready(page);
      await openBook(page);
      await page.click(cell("s04"));
      assert.equal(await text(page, "#bookSay"), "Dec 13 opens on the day.");
      await until(() => page.evaluate((s) => document.querySelector(s).classList.contains("nope"), cell("s04")), "the small shake");
      await page.click(cell("s02"));
      assert.equal(await text(page, "#bookSay"), "Dec 11 has closed.");
      assert.equal(press(be).length, 0);
      assert.equal(await stampsDrawn(page), 0);
      assert.equal(be.fake.tables.Stamps.length, 0);
      assert.equal(await text(page, "#bookN"), "0 of 12");
    },
  },
  {
    name: "the issue stamp can be pressed before any day (and shows the book's year); the Today row then follows it",
    async run({ page }) {
      // Dec 1 in Japan: before the trip
      const nowMs = Date.parse("2026-12-01T12:00:00+09:00");
      const be = await ready(page, { nowMs });
      await openBook(page);
      assert.equal(await text(page, "#bookTH"), "発行 The book");
      assert.match(await cellClass(page, "s01"), /is-soon/);
      assert.match(await cellClass(page, "iss"), /is-open/);
      await page.click(cell("iss"));
      await until(() => stampsDrawn(page).then((n) => n === 1), "the issue stamp is drawn");
      assert.match(await page.locator("#bookGrid .bk-st").innerHTML(), /2026/);
      assert.equal(await who(page, 1), "You|12:00");
      await idle(page);
      assert.equal(be.fake.tables.Log.find((r) => r.kind === "stamp").summary, "stamped the book");
    },
  },
  {
    name: "a held stamp opens on tap, shows its name, place, day and time, and closes on tap and on Escape with focus back on its ring",
    async run({ page }) {
      const be = await backendWith();
      assert.equal((await be.fake({ key: KEY, actor: "Mo", action: "pressStamp", args: { def: TODAY, at: new Date(NOON12 - HOUR).toISOString(), seed: 4242 } })).ok, true);
      await ready(page, { backend: be });
      await openBook(page);
      assert.equal(await stampsDrawn(page), 1);
      await page.click(cell(TODAY));
      await until(() => page.locator("#book .bk-look").count().then((n) => n === 1), "the stamp is held up");
      const t = await text(page, ".bk-lt");
      assert.match(t, /試3 Testville Charlie/);
      assert.match(t, /Place Charlie/);
      assert.match(t, /Sat Dec 12 · stamped 12:20/);
      assert.equal(await text(page, ".bk-lx"), "Tap to put it back");
      assert.equal(await page.evaluate(() => document.activeElement.className), "bk-look");
      assert.equal(await page.evaluate(() => document.getElementById("bookScroll").inert), true, "the page behind is not reachable");
      await page.click(".bk-look");
      assert.equal(await page.locator("#book .bk-look").count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.def), TODAY, "focus is back on its ring");
      // Escape puts it back first, then closes the book
      await page.click(cell(TODAY));
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#book .bk-look").count(), 0);
      assert.equal(await isOpen(page), true);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.def), TODAY);
      await page.keyboard.press("Escape");
      await atRest(page, "#book", { open: false, message: "the book closes" });
      assert.equal(await page.evaluate(() => document.activeElement.id), "stampBtn", "focus returns to the Days button");
    },
  },
  {
    name: "a stamp lands with its hit and wet ink, the page bumps, and the ink dries within 3 seconds",
    async run({ page }) {
      await ready(page);
      await openBook(page);
      await page.click(cell(TODAY));
      await until(() => page.locator("#bookGrid .bk-st.hit.wet").count().then((n) => n === 1), "it lands wet");
      assert.equal(await page.locator("#bookPage.thump").count(), 1, "the page's small bump");
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector(".bk-st.wet")).filter), "none");
      await page.clock.fastForward(3000);
      await until(() => page.locator("#bookGrid .bk-st.wet").count().then((n) => n === 0), "dry within 3 s");
      assert.equal(await page.locator("#bookPage.thump").count(), 0);
      // drawn on load: never wet
      await page.reload();
      await until(() => visible(page, "#stampBtn"), "the button again");
      await openBook(page);
      assert.equal(await page.locator("#bookGrid .bk-st").count(), 1);
      assert.equal(await page.locator("#bookGrid .bk-st.wet, #bookGrid .bk-st.hit").count(), 0);
    },
  },
  {
    name: "under reduced motion the stamp is there at once, without the hit, the wet ink or the bump",
    async run({ page }) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await ready(page);
      await openBook(page);
      await page.click(cell(TODAY));
      await until(() => stampsDrawn(page).then((n) => n === 1), "the stamp is drawn");
      assert.equal(await page.locator("#bookGrid .bk-st.hit").count(), 0);
      assert.equal(await page.locator("#bookGrid .bk-st.wet").count(), 0);
      assert.equal(await page.locator("#bookPage.thump").count(), 0);
      await page.click(cell("s04"));
      assert.equal(await page.locator(cell("s04") + ".nope").count(), 0, "no shake");
      assert.equal(await text(page, "#bookSay"), "Dec 13 opens on the day.");
    },
  },
  {
    name: "the line on today's ticket opens the book, and goes once today's stamp is pressed",
    async run({ page }) {
      await ready(page);
      await until(() => page.locator(".tk-stampline").count().then((n) => n === 1), "the line is on today's ticket only");
      assert.equal(await text(page, ".tk-stampline"), "Today’s stamp is open›");
      assert.equal((await page.locator(".tk-stampline").boundingBox()).height >= 44, true);
      await page.click(".tk-stampline");
      await waitBook(page);
      await page.click(cell(TODAY));
      await until(() => stampsDrawn(page).then((n) => n === 1), "pressed");
      await page.click("#bookDone");
      await atRest(page, "#book", { open: false, message: "the book closes" });
      await until(() => page.locator(".tk-stampline").count().then((n) => n === 0), "the line goes");
      assert.equal(await text(page, "#stampBtn"), "1/12");
    },
  },
  {
    name: "History shows the press; undoing it there empties the ring, and the day can be pressed again while it is open",
    async run({ page }) {
      const be = await ready(page);
      await openBook(page);
      await page.click(cell(TODAY));
      await until(() => stampsDrawn(page).then((n) => n === 1), "pressed");
      await idle(page);
      await page.click("#bookDone");
      await atRest(page, "#book", { open: false, message: "closed" });
      await page.click("#youBtn");
      await page.click("#setHist");
      await until(() => page.locator("#tape .tp-row").count().then((n) => n >= 1), "the tape shows");
      assert.match(await text(page, "#tape .tp-row .tp-s"), /^Mo stamped Dec 12$/);
      await page.click("#tape .tp-row button.tp-undo");
      await until(() => page.locator("#tape .tp-row.is-undone").count().then((n) => n === 1), "undone");
      await page.click("#histDone");
      await page.click("#stampBtn");
      await waitBook(page);
      assert.equal(await stampsDrawn(page), 0, "the ring is empty");
      assert.match(await cellClass(page, TODAY), /is-open/);
      assert.equal(await text(page, "#bookN"), "0 of 12");
      assert.equal(be.fake.tables.Stamps[0].gone, "yes");
      // while the window is open it can be pressed again
      await advance(page, be, 60000);
      await page.click(cell(TODAY));
      await until(() => stampsDrawn(page).then((n) => n === 1), "pressed again");
      await idle(page);
      assert.equal(be.fake.tables.Stamps.length, 1);
      assert.equal(be.fake.tables.Stamps[0].gone, "");
      assert.equal(press(be).length, 2);
    },
  },
  {
    name: "undoing a press after its window has closed lifts it for good: the book shows the empty ring and refuses a second press",
    async run({ page }) {
      const be = await ready(page);
      await openBook(page);
      await page.click(cell(TODAY));
      await until(() => stampsDrawn(page).then((n) => n === 1), "pressed");
      await idle(page);
      await page.click("#bookDone");
      await atRest(page, "#book", { open: false, message: "closed" });
      // 03:20 on Dec 13 in Japan: Dec 12's window closed at 03:00
      await advance(page, be, 14 * HOUR);
      await page.click("#youBtn");
      await page.click("#setHist");
      await until(() => page.locator("#tape .tp-row button.tp-undo").count().then((n) => n >= 1), "the tape shows");
      await page.click("#tape .tp-row button.tp-undo");
      await until(() => page.locator("#tape .tp-row.is-undone").count().then((n) => n === 1), "undone");
      await page.click("#histDone");
      await page.click("#stampBtn");
      await waitBook(page);
      assert.equal(await stampsDrawn(page), 0);
      assert.match(await cellClass(page, TODAY), /is-missed/, "an empty ring, no PRESS");
      assert.equal(await text(page, cell(TODAY) + " .bk-ghost"), "12Sat");
      const before = press(be).length;
      await page.click(cell(TODAY));
      assert.equal(await text(page, "#bookSay"), "Dec 12 has closed.");
      assert.equal(press(be).length, before, "nothing sent");
      assert.equal(be.fake.tables.Stamps[0].gone, "yes");
      assert.equal(await text(page, "#bookN"), "0 of 12");
    },
  },
  {
    name: "a press with no signal shows at once, waits on the phone, and goes out when signal returns; the backend keeps the time it was pressed",
    async run({ page }) {
      const be = await ready(page);
      await openBook(page);
      be.failWith = "network";
      await page.click(cell(TODAY));
      await until(() => stampsDrawn(page).then((n) => n === 1), "shown at once");
      await idle(page);
      assert.equal(be.fake.tables.Stamps.length, 0);
      assert.equal(await page.evaluate(() => globalThis.__matTest.store.outbox().waiting), 1);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("mat.queue")).length), 1);
      await advance(page, be, 5 * 60000);
      be.failWith = null;
      await page.evaluate(() => globalThis.__matTest.store.flush());
      await idle(page);
      assert.equal(be.fake.tables.Stamps.length, 1);
      assert.equal(be.fake.tables.Stamps[0].at, new Date(NOON12).toISOString(), "stamped with the time it was pressed, not when it arrived");
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("mat.queue")).length), 0);
    },
  },
  {
    name: "another phone's press shows in the Today row on the next check; only the other person's own book is not browsable",
    async run({ page }) {
      const be = await ready(page);
      await openBook(page);
      const r = await be.fake({ key: KEY, actor: "Ajen", action: "pressStamp", args: { def: TODAY, at: new Date(NOON12 - 2 * 60000).toISOString() } });
      assert.equal(r.ok, true);
      await page.evaluate(() => globalThis.__matTest.store.checkRev());
      await until(async () => (await who(page, 2)) === "Ajen|13:18", "Ajen's time shows");
      assert.equal(await page.locator("#bookWho .bk-p.is-in").count(), 1);
      assert.equal(await stampsDrawn(page), 0, "Ajen's drawing is not on my page");
      assert.equal(await text(page, "#bookN"), "0 of 12");
    },
  },
  {
    name: "a name holding markup shows as text; an unknown drawing draws the ring and the names; the app does not break",
    async run({ page }) {
      const odd = DEFS.map((d) => (d.id === TODAY ? { ...d, name_en: "<img src=x onerror=window.__pwn=1>", name_ja: "<b>x</b>", place: "<i>p</i>", motif: "no-such-drawing" } : d));
      const be = await backendWith(odd);
      assert.equal((await be.fake({ key: KEY, actor: "Mo", action: "pressStamp", args: { def: TODAY, at: new Date(NOON12).toISOString(), seed: 99 } })).ok, true);
      await ready(page, { backend: be });
      await openBook(page);
      assert.equal(await stampsDrawn(page), 1, "the ring is drawn");
      assert.equal(await page.locator("#book img, #book b > b, #book i > i").count(), 0);
      assert.equal(await page.evaluate(() => window.__pwn), undefined);
      assert.match(await text(page, cell(TODAY) + " .bk-cap"), /<i>p<\/i>/, "the place is plain text");
      await advance(page, be, 1000);
      await page.click(cell(TODAY));
      await until(() => page.locator("#book .bk-look").count().then((n) => n === 1), "held up");
      assert.match(await text(page, ".bk-lt"), /<b>x<\/b> <img src=x onerror=window.__pwn=1>/);
      assert.equal(await page.locator(".bk-look img, .bk-look b").count(), 0);
      assert.equal(await page.evaluate(() => window.__pwn), undefined);
      assert.match(await page.locator(".bk-look .bk-st").innerHTML(), /&lt;IMG/);
    },
  },
  {
    name: "a phone still on Toronto time: today's stamp is the Japan day's, not the phone's",
    timezoneId: "America/Toronto",
    async run({ page }) {
      // 20:00Z Dec 12 is 15:00 on Dec 12 in Toronto and 05:00 on Dec 13 in Japan.
      const nowMs = Date.parse("2026-12-12T20:00:00Z");
      const be = await ready(page, { nowMs });
      await openBook(page);
      assert.match(await cellClass(page, "s04"), /is-open/, "Dec 13 is open");
      assert.match(await cellClass(page, TODAY), /is-missed/, "Dec 12 closed at 03:00 in Japan");
      assert.equal(await text(page, "#bookTH"), "今日 Today");
      await page.click(cell(TODAY));
      assert.equal(await text(page, "#bookSay"), "Dec 12 has closed.");
      await page.click(cell("s04"));
      await until(() => stampsDrawn(page).then((n) => n === 1), "Dec 13's stamp is pressed");
      await idle(page);
      assert.equal(be.fake.tables.Stamps[0].id, "s04|Mo");
      // the time shown is Japan time
      assert.equal(await who(page, 1), "You|05:00");
    },
  },
  {
    name: "History: nobody acts on someone else's stamp: Ajen's line has no Undo for Mo, Mo's own has",
    async run({ page }) {
      const be = await backendWith();
      const at = new Date(NOON12 - 60000).toISOString();
      assert.equal((await be.fake({ key: KEY, actor: "Ajen", action: "pressStamp", args: { def: TODAY, at } })).ok, true);
      await ready(page, { backend: be });
      await openBook(page);
      await page.click(cell(TODAY));
      await until(() => stampsDrawn(page).then((n) => n === 1), "pressed");
      await idle(page);
      await page.click("#bookDone");
      await atRest(page, "#book", { open: false, message: "closed" });
      await page.click("#youBtn");
      await page.click("#setHist");
      await until(() => page.locator("#tape .tp-row").count().then((n) => n >= 2), "the tape shows both");
      const rows = await page.$$eval("#tape .tp-row", (rs) => rs.map((r) => [r.querySelector(".tp-s").textContent, r.querySelector("button.tp-undo") !== null]));
      assert.deepEqual(rows.filter((r) => /stamped/.test(r[0])).sort(), [["Ajen stamped Dec 12", false], ["Mo stamped Dec 12", true]]);
    },
  },
  {
    name: "a small phone (320 x 568) with stamps: the Days bar fits, the button is a 44 px target, every square shows, today's ticket top is in view",
    viewport: { width: 320, height: 568 },
    async run({ page }) {
      await ready(page);
      await until(() => visible(page, "#stampBtn"), "the button shows");
      await page.evaluate(() => { document.getElementById("vDays").scrollTop = 0; });
      const m = await page.evaluate(() => {
        const days = document.getElementById("vDays");
        const btn = document.getElementById("stampBtn").getBoundingClientRect();
        const sq = [...document.querySelectorAll("#pager .sq")].map((e) => e.getBoundingClientRect());
        const tk = document.querySelector('#rail .pg[data-date="2026-12-12"] .tk').getBoundingClientRect();
        const count = document.getElementById("dayCount").getBoundingClientRect();
        return {
          docScroll: document.documentElement.scrollWidth > innerWidth,
          daysScroll: days.scrollWidth > days.clientWidth,
          btn: [Math.round(btn.width), Math.round(btn.height)],
          btnIn: btn.left >= 0 && btn.right <= innerWidth,
          squares: sq.length,
          squaresIn: sq.every((r) => r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight),
          countIn: count.left >= 0 && count.right <= innerWidth,
          ticketTop: Math.round(tk.top),
          ticketIn: tk.top >= 0 && tk.top < innerHeight - 150,
        };
      });
      assert.equal(m.docScroll, false, JSON.stringify(m));
      assert.equal(m.daysScroll, false, JSON.stringify(m));
      assert.ok(m.btn[0] >= 43.5 && m.btn[1] >= 43.5, "button size " + JSON.stringify(m));
      assert.equal(m.btnIn && m.countIn, true, JSON.stringify(m));
      assert.equal(m.squares, 11);
      assert.equal(m.squaresIn, true, JSON.stringify(m));
      assert.equal(m.ticketIn, true, JSON.stringify(m));
      await page.screenshot({ path: shotPath("stamp-book/7-narrow-320-days.png") });
    },
  },
  ...[
    { name: "390 x 844", viewport: { width: 390, height: 844 } },
    { name: "844 x 390 held sideways", viewport: { width: 844, height: 390 } },
    { name: "1280 x 800", viewport: { width: 1280, height: 800 } },
  ].map(({ name, viewport }) => ({
    name: "no sideways scroll, and Done and every ring reachable, at " + name,
    viewport,
    async run({ page }) {
      const be = await backendWith();
      assert.equal((await be.fake({ key: KEY, actor: "Mo", action: "pressStamp", args: { def: TODAY, at: new Date(NOON12).toISOString(), seed: 31337 } })).ok, true);
      await ready(page, { backend: be });
      await openBook(page);
      const fit = await page.evaluate(() => {
        const sc = document.getElementById("bookScroll");
        const page = document.getElementById("bookPage").getBoundingClientRect();
        const done = document.getElementById("bookDone").getBoundingClientRect();
        const phone = document.getElementById("phone").getBoundingClientRect();
        return {
          doc: document.documentElement.scrollWidth <= innerWidth,
          scroll: sc.scrollWidth <= sc.clientWidth,
          page: page.left >= phone.left - 0.5 && page.right <= phone.right + 0.5,
          done: done.top >= 0 && done.bottom <= innerHeight && done.right <= innerWidth && done.width >= 43.5 && done.height >= 43.5,
          doneBox: [done.left, done.top, done.right, done.bottom].map(Math.round),
          cols: getComputedStyle(document.getElementById("bookGrid")).gridTemplateColumns.split(" ").length,
        };
      });
      assert.deepEqual([fit.doc, fit.scroll, fit.page, fit.done], [true, true, true, true], JSON.stringify(fit));
      assert.equal(fit.cols, viewport.height < 520 && viewport.width > viewport.height ? 6 : 3);
      // the last ring can be scrolled to and is tappable
      await page.locator(cell("iss")).scrollIntoViewIfNeeded();
      const box = await page.locator(cell("iss")).boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= viewport.width);
      await page.click("#bookDone");
      await atRest(page, "#book", { open: false, message: "closed" });
    },
  })),
];
