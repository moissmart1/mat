/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Task 24: small effects. Paper has weight (shadows and grain), the table has a
// lamp, the current day is lit, the register's display is glass, keys have an
// edge and travel, a stamp that has just landed is wet, tickets are notched,
// a count that changes rolls in, and nothing costs scrolling (no backdrop
// filter, no CSS filter inside a list). Every item and name here is made up.

const assert = require("node:assert/strict");
const { SEED, WITH_PLAN, NOON12, makeBackend, open, advance, until, atRest, visible } = require("./helpers.cjs");

const PLANNER_ID = "fakePlannerSheet_0123456789abcdefXYZ";
const BHEAD = ["#", "Item", "Who", "Book by", "Status", "Notes", "Booking link"];
const brow = (o) => BHEAD.map((h) => (o[h] === undefined ? "" : o[h]));
const CHEAD = ["#", "Date / time", "Agent / session", "Tab", "Cell(s)", "Item", "Old value", "New value", "Why", "Proof / source", "Verified?"];
const ITEMS = [
  { "#": 1, Item: "Rail pass seat reservations", "Book by": "2026-11-14", Status: "Not booked", Notes: "Window seats for three." },
  { "#": 2, Item: "Tea ceremony class", "Book by": "2026-11-18", Status: "Pending" },
  { "#": 3, Item: "Snow park day trip", "Book by": "Dec 5", Status: "Not booked" },
  { "#": 5, Item: "Pocket wifi pickup", "Book by": "2026-11-10", Status: "Booked" },
];
// 14:00 on Mon Nov 16 in Toronto: before the trip, so the Before tab is there.
const BEFORE = Date.parse("2026-11-16T19:00:00Z");

// The Days screen over a plan, with the planner's list pulled in (3 open, 1 done).
async function daysReady(page) {
  const seed = { ...WITH_PLAN, plannerId: PLANNER_ID, plannerTabs: { "Book Now": [["Before we go: bookings"], BHEAD, ...ITEMS.map(brow)], "Change Log": [CHEAD] } };
  const backend = makeBackend(seed, { now: BEFORE });
  await backend.fake({ key: "test-key", actor: "Mo", action: "syncTodos", args: {} });
  await open(page, { backend, nowMs: BEFORE, tab: "days" });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
  await until(() => visible(page, "#beforeBtn"), "the Before tab is in the bar");
  return backend;
}

async function moneyReady(page, opts = {}) {
  const backend = await open(page, { seed: SEED, nowMs: NOON12, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0), "the receipt draws");
  await until(() => page.evaluate(() => document.querySelectorAll("#slip .spot").length > 0), "the slip draws");
  return backend;
}

// How many layers a computed box-shadow has: every layer has exactly one colour, and a computed colour is rgb( or rgba(.
const layers = (v) => (String(v).match(/rgba?\(/g) || []).length;
const style = (page, sel, pseudo = null) => page.evaluate(([s, p]) => {
  const c = getComputedStyle(document.querySelector(s), p);
  return { shadow: c.boxShadow, bg: c.backgroundImage, filter: c.filter, backdrop: c.backdropFilter, content: c.content, width: c.width, pos: c.position, anim: c.animationName, transform: c.transform };
}, [sel, pseudo]);

module.exports = [
  {
    name: "paper sits on the table: tickets, the Before paper, the slip and the receipt have four or more shadow layers and the grain; the day stubs and hotel card too",
    async run({ page }) {
      await daysReady(page);
      const tk = await style(page, "#rail .tk");
      assert.ok(layers(tk.shadow) >= 4, "ticket: " + tk.shadow);
      assert.match(tk.bg, /url\("data:image\/svg\+xml/, "the ticket has the grain");
      assert.match(tk.bg, /linear-gradient/, "the ticket has its sheen");
      // The fan motion is still on the ticket where the browser has it.
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#rail .tk")).animationName !== undefined), true);
      await page.click('#nav button[data-tab="before"]');
      await until(() => visible(page, "#bwCard"), "the Before paper shows");
      const bw = await style(page, "#bwCard");
      assert.ok(layers(bw.shadow) >= 4, "Before paper: " + bw.shadow);
      assert.match(bw.bg, /url\("data:image\/svg\+xml/);
      // The all-days stubs.
      await page.click('#nav button[data-tab="days"]');
      await page.click("#dayCount");
      await until(() => visible(page, ".ad-row"), "the all-days list shows");
      const ad = await style(page, ".ad-row");
      assert.ok(layers(ad.shadow) >= 4, "day stub: " + ad.shadow);
      assert.match(ad.bg, /url\("data:image\/svg\+xml/);
    },
  },
  {
    name: "the slip, the receipt, the History tape and the hotel card have weight and grain",
    async run({ page }) {
      await moneyReady(page);
      const slip = await style(page, ".slip");
      assert.ok(layers(slip.shadow) >= 4, "slip: " + slip.shadow);
      assert.match(slip.bg, /url\("data:image\/svg\+xml/);
      const rc = await style(page, ".rc");
      assert.ok(layers(rc.shadow) >= 4, "receipt: " + rc.shadow);
      assert.match(rc.bg, /url\("data:image\/svg\+xml/);
      // The receipt keeps its serrated edges.
      for (const p of ["::before", "::after"]) assert.equal((await style(page, ".rc", p)).content, '""', "serration " + p);
      // History tape.
      await page.click("#youBtn");
      await until(() => visible(page, "#setHist"), "Settings opens");
      await page.click("#setHist");
      await until(() => visible(page, "#tape"), "the tape shows");
      const tape = await style(page, "#tape");
      assert.ok(layers(tape.shadow) >= 4, "tape: " + tape.shadow);
      assert.match(tape.bg, /url\("data:image\/svg\+xml/);
    },
  },
  {
    name: "the hotel card has the grain and the paper's weight",
    async run({ page }) {
      await daysReady(page);
      await page.click("#rail .tk-stay");
      await atRest(page, "#stay", { message: "the hotel card opens" });
      const s = await style(page, "#stay");
      assert.ok(layers(s.shadow) >= 4, "hotel card: " + s.shadow);
      assert.match(s.bg, /url\("data:image\/svg\+xml/);
    },
  },
  {
    name: "the lamp sits on the table behind the screens, not on the content, and does not scroll",
    async run({ page }) {
      await moneyReady(page);
      const phone = await style(page, "#phone");
      assert.match(phone.bg, /radial-gradient/, "the phone has the lamp");
      for (const sel of ["#vMoney", "#vDays", ".slip"]) {
        const s = await style(page, sel);
        assert.doesNotMatch(s.bg, /radial-gradient/, sel + " has no lamp of its own, so it does not scroll");
      }
      // A sheet is opaque ground: the lamp is not over it.
      const sheet = await page.evaluate(() => getComputedStyle(document.querySelector(".sheet")).backgroundImage);
      assert.doesNotMatch(sheet, /radial-gradient/);
    },
  },
  {
    name: "the current day's square is lit; the others have no shadow",
    async run({ page }) {
      await daysReady(page);
      const sq = await page.evaluate(() => [...document.querySelectorAll("#pager .sq")].map((b) => [b.classList.contains("is-cur"), getComputedStyle(b, "::before").boxShadow, getComputedStyle(b).boxShadow]));
      assert.ok(sq.length >= 3);
      assert.equal(sq.filter((s) => s[0]).length, 1, "one current square");
      for (const [cur, before, own] of sq) {
        assert.equal(own, "none", "the button itself has no shadow");
        if (cur) {
          assert.equal(layers(before), 2, "lit: " + before);
          assert.match(before, /10px/, "the glow is 10 px");
        } else assert.equal(before, "none", "the others are not lit");
      }
    },
  },
  {
    name: "the register's display is glass: an outer glow, the inset sheen and the amount's shadow",
    async run({ page }) {
      await moneyReady(page);
      await page.click("#ring");
      await atRest(page, "#reg", { message: "the register opens" });
      const lcd = await style(page, ".lcd");
      const parts = lcd.shadow.split(/,\s*(?=rgba?\()/).map((p) => p.trim());
      assert.ok(parts.some((p) => !/inset/.test(p) && /rgb/.test(p)), "an outer shadow layer: " + lcd.shadow);
      assert.ok(parts.some((p) => /inset/.test(p)), "an inset layer: " + lcd.shadow);
      assert.match(lcd.bg, /linear-gradient/, "the top sheen");
      const amt = await page.evaluate(() => getComputedStyle(document.getElementById("xAmt")).textShadow);
      assert.match(amt, /1\.5px 1\.5px/, "the amount's shadow: " + amt);
    },
  },
  {
    name: "keys have an edge and move down 1.5 px when pressed, without moving their neighbours; the main key is paper with a paper edge",
    async run({ page }) {
      await moneyReady(page);
      await page.click("#ring");
      await atRest(page, "#reg", { message: "the register opens" });
      await until(() => page.evaluate(() => getComputedStyle(document.getElementById("reg")).transform === "none" || /matrix\(1, 0, 0, 1, 0, 0\)/.test(getComputedStyle(document.getElementById("reg")).transform)), "the register has settled");
      const rects = () => page.evaluate(() => [...document.querySelectorAll("#pad .key")].map((k) => { const r = k.getBoundingClientRect(); return [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }));
      const key = await style(page, '.key[data-k="5"]');
      assert.match(key.shadow, /inset/, "an inset layer: " + key.shadow);
      assert.ok(layers(key.shadow) >= 3);
      assert.equal(key.transform, "none");
      const go = await style(page, "#kGo");
      assert.ok(layers(go.shadow) >= 3 && /inset/.test(go.shadow), "main key edge: " + go.shadow);
      const chip = await style(page, "#xQuick .chip");
      assert.match(chip.shadow, /inset/, "chip: " + chip.shadow);
      const before = await rects();
      const box = await (await page.$('.key[data-k="5"]')).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await until(async () => (await style(page, '.key[data-k="5"]')).transform === "matrix(1, 0, 0, 1, 0, 1.5)", "the key moves down 1.5 px");
      const pressed = await style(page, '.key[data-k="5"]');
      assert.notEqual(pressed.shadow, key.shadow, "the pressed edge differs");
      const during = await rects();
      before.forEach((r, i) => {
        if (i !== 5) assert.deepEqual(during[i], r, "a neighbour did not move (key " + i + ")");
      });
      await page.mouse.up();
    },
  },
  {
    name: "a stamp that has just landed is wet and dries within 3 s: the money stamp and the to-do stamp; one drawn on load never is",
    async run({ page, newPhone }) {
      // Money stamp.
      await moneyReady(page);
      assert.equal(await page.locator(".stamp.wet").count(), 0, "nothing wet on load");
      await page.click('#slip button.spot[data-key="Ajen>Mo"]');
      await until(() => page.locator('#slip button.spot.is-armed').count().then((n) => n === 1), "armed");
      await page.click('#slip button.spot[data-key="Ajen>Mo"]');
      await until(() => page.locator("#slip .s-row.is-paid .stamp.hit.wet").count().then((n) => n === 1), "the stamp lands wet");
      const f = await page.evaluate(() => getComputedStyle(document.querySelector("#slip .stamp.wet")).filter);
      assert.match(f, /saturate\(1\.35\)/);
      assert.match(f, /brightness\(1\.1\)/);
      assert.match(f, /drop-shadow/);
      await page.clock.fastForward(3000);
      assert.equal(await page.locator("#slip .stamp.wet").count(), 0, "dry within 3 s");
      // Drawn on load: a reload shows the stamp, never wet.
      await page.reload();
      await until(() => page.locator("#slip .s-row.is-paid .stamp").count().then((n) => n === 1), "the stamp is drawn again");
      assert.equal(await page.locator(".stamp.wet").count(), 0, "not wet on a reload");

      // To-do stamp, on a second phone.
      const p2 = await newPhone();
      await daysReady(p2);
      await p2.click('#nav button[data-tab="before"]');
      await until(() => visible(p2, "#todos"), "the list shows");
      assert.equal(await p2.locator(".stamp.wet").count(), 0);
      await p2.click('#bwOpen .bw-r[data-id="3"] .bw-b');
      await p2.click('#bwOpen .bw-r[data-id="3"] .bw-tick');
      await until(() => p2.locator(".bw-r.is-landed .stamp.hit.wet").count().then((n) => n === 1), "the to-do stamp lands wet");
      await p2.clock.fastForward(1000);
      assert.equal(await p2.locator(".stamp.wet").count(), 0, "dry within 3 s");
    },
  },
  {
    name: "under reduced motion a stamp is never wet",
    async run({ page, newPhone }) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await moneyReady(page);
      await page.click('#slip button.spot[data-key="Ajen>Mo"]');
      await until(() => page.locator('#slip button.spot.is-armed').count().then((n) => n === 1), "armed");
      await page.click('#slip button.spot[data-key="Ajen>Mo"]');
      await until(() => page.locator("#slip .s-row.is-paid .stamp").count().then((n) => n === 1), "the stamp");
      assert.equal(await page.locator(".stamp.wet").count(), 0);
      const p2 = await newPhone();
      await p2.emulateMedia({ reducedMotion: "reduce" });
      await daysReady(p2);
      await p2.click('#nav button[data-tab="before"]');
      await until(() => visible(p2, "#todos"), "the list shows");
      await p2.click('#bwOpen .bw-r[data-id="3"] .bw-b');
      await p2.click('#bwOpen .bw-r[data-id="3"] .bw-tick');
      await until(() => p2.locator(".bw-r.is-landed .stamp").count().then((n) => n === 1), "the to-do stamp");
      assert.equal(await p2.locator(".stamp.wet").count(), 0);
    },
  },
  {
    name: "every tear line has two notches: half-moons 14 px across, in the table's colour, shaded on their upper inside; the Before paper too",
    async run({ page }) {
      await daysReady(page);
      const perfs = await page.$$eval("#rail .tk-perf", (els) => els.map((e) => ["::before", "::after"].map((p) => { const c = getComputedStyle(e, p); return [c.content, c.width, c.height, c.backgroundColor, c.boxShadow, c.position]; })));
      assert.ok(perfs.length >= 3, "tear lines on the tickets");
      for (const [a, b] of perfs) for (const n of [a, b]) {
        assert.equal(n[0], '""');
        assert.deepEqual([n[1], n[2], n[5]], ["14px", "14px", "absolute"]);
        assert.equal(n[3], "rgb(26, 22, 20)", "the table's colour");
        assert.match(n[4], /inset/);
      }
      // Centred on the paper's side edges: the notch's centre is on the ticket's left and right edge.
      const geo = await page.evaluate(() => {
        const perf = document.querySelector("#rail .tk-perf");
        const tk = perf.closest(".tk").getBoundingClientRect();
        const pr = perf.getBoundingClientRect();
        // The circle is 14 px wide, its left (right) edge 16 px outside the line's.
        return { left: pr.left - 16 + 7 - tk.left, right: tk.right - (pr.right + 16 - 7) };
      });
      assert.ok(Math.abs(geo.left) < 0.6 && Math.abs(geo.right) < 0.6, "centred on the edges: " + JSON.stringify(geo));
      await page.click('#nav button[data-tab="before"]');
      await until(() => visible(page, "#bwCard"), "the Before paper shows");
      assert.ok(await visible(page, ".bw-perf"), "a tear line in the Before paper");
      const bw = await page.$$eval(".bw-perf", (els) => els.map((e) => ["::before", "::after"].map((p) => { const c = getComputedStyle(e, p); return [c.content, c.width, c.backgroundColor]; })));
      for (const pair of bw) for (const n of pair) assert.deepEqual(n, ['""', "14px", "rgb(26, 22, 20)"]);
    },
  },
  {
    name: "the Before count rolls in when it changes (on the key and in the list), and not on load",
    async run({ page }) {
      const backend = await daysReady(page);
      const pill = () => page.evaluate(() => [getComputedStyle(document.getElementById("beforeN")).animationName, document.getElementById("beforeN").textContent]);
      assert.deepEqual(await pill(), ["none", "3"], "no roll on load");
      await page.click('#nav button[data-tab="before"]');
      await until(() => visible(page, "#todos"), "the list shows");
      const num = () => page.evaluate(() => [getComputedStyle(document.querySelector("#bwCard .bw-band .num")).animationName, document.querySelector("#bwCard .bw-band .num").textContent]);
      assert.deepEqual(await num(), ["none", "3open"], "no roll on load in the list");
      // A count still settling (the list arrives in steps) does not roll; one that has been up for a couple of seconds does.
      await advance(page, backend, 2500);
      await page.click('#bwOpen .bw-r[data-id="3"] .bw-b');
      await page.click('#bwOpen .bw-r[data-id="3"] .bw-tick');
      await until(async () => (await pill())[1] === "2", "the count goes down");
      assert.equal((await pill())[0], "roll", "the key's count rolls");
      assert.deepEqual(await num(), ["roll", "2open"], "the list's count rolls");
    },
  },
  {
    name: "under reduced motion the count does not roll",
    async run({ page }) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await daysReady(page);
      await page.click('#nav button[data-tab="before"]');
      await until(() => visible(page, "#todos"), "the list shows");
      await page.click('#bwOpen .bw-r[data-id="3"] .bw-b');
      await page.click('#bwOpen .bw-r[data-id="3"] .bw-tick');
      await until(() => page.evaluate(() => document.getElementById("beforeN").textContent === "2"), "the count goes down");
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("beforeN")).animationName), "none");
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#bwCard .bw-band .num")).animationName), "none");
    },
  },
  {
    name: "a seal with a picture has a thin ring set over it",
    async run({ page }) {
      await moneyReady(page);
      await page.evaluate((p) => globalThis.__matTest.store.setPerson("Mo", { photo: p }), require("../fixtures/picture.json").jpeg);
      await page.click("#ring");
      await atRest(page, "#reg", { message: "the register opens" });
      await until(() => page.evaluate(() => !!document.querySelector("#xPayer .seal.has-pic")), "the seal shows the picture");
      const ring = await style(page, "#xPayer .seal.has-pic", "::after");
      assert.equal(ring.pos, "absolute");
      assert.equal(layers(ring.shadow), 2, ring.shadow);
      assert.match(ring.shadow, /inset/);
      const plain = await style(page, '#xPayer .seal[data-p="Ajen"]', "::after");
      assert.equal(plain.content === "none" || plain.content === "normal", true, "no ring on initials");
    },
  },
  {
    name: "scrolling stays cheap: no backdrop-filter anywhere, and no CSS filter inside the rail, the receipt, the tape or the list except a stamp that has just landed",
    async run({ page }) {
      await daysReady(page);
      const scan = () =>
        page.evaluate(() => {
          const bad = { backdrop: [], filter: [] };
          const inList = (e) => e.closest("#rail, #rc, #tape, #todos");
          for (const e of document.querySelectorAll("*")) {
            for (const p of [null, "::before", "::after"]) {
              const c = getComputedStyle(e, p);
              if (c.backdropFilter && c.backdropFilter !== "none") bad.backdrop.push(e.tagName + "." + e.className + (p || ""));
              if (p === null && inList(e) && c.filter !== "none" && !e.matches(".stamp.wet")) bad.filter.push(e.tagName + "." + e.className + " " + c.filter);
            }
          }
          return bad;
        });
      assert.deepEqual(await scan(), { backdrop: [], filter: [] }, "Days");
      await page.click('#nav button[data-tab="before"]');
      await until(() => visible(page, "#todos"), "the list shows");
      assert.deepEqual(await scan(), { backdrop: [], filter: [] }, "Before");
      await page.click('#nav button[data-tab="money"]');
      await until(() => page.evaluate(() => document.getElementById("vMoney").classList.contains("is-active")), "Money");
      assert.deepEqual(await scan(), { backdrop: [], filter: [] }, "Money");
      await page.click("#youBtn");
      await until(() => visible(page, "#setHist"), "Settings opens");
      await page.click("#setHist");
      await until(() => visible(page, "#tape"), "the tape shows");
      assert.deepEqual(await scan(), { backdrop: [], filter: [] }, "History");
    },
  },
];
