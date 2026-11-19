/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The Tickets tab (定期入れ, the pass case; js/views/passcase.js): from the
// trip's first day its key stands in Before's place; the next ticket in the
// window opens the same stub a stop opens; every slot opens its stub; the
// three kinds of status; the Before slip and its sheet; empty; 320 px; the
// computer's two panes. It is 13:20 on Sat Dec 12 in Japan unless a case says
// otherwise. Every stop, booking, reference and picture here is made up
// (pictures drawn by tests/e2e/pictures.cjs).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { WITH_PLAN, NOON12, makeBackend, open, advance, until, text, expectText, visible } = require("./helpers.cjs");
const { png } = require("./pictures.cjs");

// Pictures of the case are taken only when MAT_TAB_SHOTS names an output folder.
const SHOTS = process.env.MAT_TAB_SHOTS || "";
const KEY = "test-key";
const SENSO = "planstop1101"; // Dec 11, 10:00: reference only (used)
const MEIJI = "planstop1201"; // 09:00: one code (used)
const LUNCH = "planstop1202"; // 12:30: a PDF's two pages (used)
const SKY = "planstop1203"; // 14:00, 30 min to get there: three per-person codes (the window)
const TEA = "planstop1206"; // 17:00: one code this phone cannot fetch (needs signal once)
const DINNER = "planstop1204"; // 19:00: reference only
const EXPRESS = "planstop1301"; // Dec 13, 10:08: one code (later days)

const PLANNER_ID = "fakePlannerSheet_passcase";
const BHEAD = ["#", "Item", "Who", "Book by", "Status", "Notes", "Booking link"];
const CHEAD = ["#", "Date / time", "Agent / session", "Tab", "Cell(s)", "Item", "Old value", "New value", "Why", "Proof / source", "Verified?"];
const ITEMS = [
  { "#": 1, Item: "Made-up snow park bus", "Book by": "2026-12-14", Status: "Not booked" },
  { "#": 2, Item: "Made-up tea class seats", "Book by": "2026-12-15", Status: "Pending" },
  { "#": 3, Item: "Made-up pocket wifi", "Book by": "2026-11-10", Status: "Booked" },
];
// Two minutes to midnight before the first day (Thu Dec 10) in Japan.
const EVE = Date.parse("2026-12-09T23:58:00+09:00");

const FIVE = ["days", "tickets", "ring", "money", "youBtn"];

let n = 0;
const tid = () => "tkp" + String(++n).padStart(9, "0");

function seed({ items = ITEMS, stops = true } = {}) {
  const s = JSON.parse(JSON.stringify(WITH_PLAN));
  if (stops) {
    s.stops.push({ id: TEA, date: "2026-12-12", time: "17:00", title: "Tea ceremony" });
    s.stops.push({ id: EXPRESS, date: "2026-12-13", time: "10:08", title: "Limited express to Nara", detail: "Platform 4" });
  }
  if (items) {
    s.plannerId = PLANNER_ID;
    s.plannerTabs = { "Book Now": [["Before we go: bookings"], BHEAD, ...items.map((o) => BHEAD.map((h) => (o[h] === undefined ? "" : o[h])))], "Change Log": [CHEAD] };
  }
  return s;
}

// A backend with every kind of ticket, its Before list pulled five minutes ago.
// The picture on the tea ceremony is refused when this phone asks for it, so it stays "needs signal once".
async function caseBackend({ nowMs = NOON12, items = ITEMS, tickets = true } = {}) {
  const backend = makeBackend(seed({ items }), { now: nowMs - 300000 });
  const as = (action, args, actor = "Ajen") => backend.fake({ key: KEY, actor, action, args });
  if (items) assert.equal((await as("syncTodos", {}, "Mo")).ok, true);
  let tea = null;
  if (tickets) {
    const add = async (stop, who, seat, page, data, w = 300, h = 300) => {
      const r = await as("addTicket", { ticket: { id: tid(), stop, who, seat, page, mime: "image/png", w, h, data } });
      assert.equal(r.ok, true, r.message);
      return r.data.ticket;
    };
    await as("updateStop", { id: SENSO, patch: { tkRef: "TEST-1100", tkName: "MO" } });
    await add(MEIJI, "", "", 1, png(300, 300, 51));
    await add(LUNCH, "", "", 1, png(300, 424, 61), 300, 424);
    await add(LUNCH, "", "", 2, png(300, 424, 62), 300, 424);
    await as("updateStop", { id: SKY, patch: { tkRef: "TEST-3001", tkName: "MO", tkPeople: "3 adults", tkSeat: "Car 7 · 10A–C" } });
    await add(SKY, "Mo", "Car 7 · 10A", 1, png(300, 300, 11));
    await add(SKY, "Ajen", "Car 7 · 10B", 1, png(300, 300, 23));
    await add(SKY, "Trenton", "Car 7 · 10C", 1, png(300, 300, 37));
    tea = (await add(TEA, "", "", 1, png(300, 300, 71))).id;
    await as("updateStop", { id: DINNER, patch: { tkRef: "TEST-0412", tkName: "MO", tkPeople: "3" } });
    await add(EXPRESS, "", "", 1, png(300, 300, 81));
  }
  backend.now = nowMs;
  backend.requests.length = 0;
  const handle = backend.handle;
  backend.handle = async (body) => (tea && body && body.action === "ticket" && body.args && body.args.id === tea ? { ok: false, error: "not_found", message: "That ticket picture is not here any more." } : handle(body));
  backend.call = as;
  return backend;
}

// Opens the app on Days and waits for the trip; on a trip day, for the Tickets key.
async function ready(page, opts = {}) {
  const backend = opts.backend || (await caseBackend(opts));
  await open(page, { backend, nowMs: opts.nowMs || NOON12, tab: "days" });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
  return backend;
}
const kept = (page, ids) => until(() => page.evaluate((ids) => ids.every((id) => document.querySelector('#rail .r[data-id="' + id + '"] .tk-mark b:not(.is-dash)')), ids), "the pictures reach this phone", 10000);
async function goTickets(page) {
  await until(() => visible(page, "#ticketsBtn"), "the Tickets key is in the bar");
  await page.click("#ticketsBtn");
  await until(() => page.evaluate(() => document.getElementById("vTickets").classList.contains("is-active") && !!document.querySelector("#vTickets .pc-case")), "the pass case shows");
}
// The Before pad is up as a sheet over the tab (a view put away still has a size, so visible() cannot say).
const sheetUp = (page) => page.evaluate(() => {
  const v = document.getElementById("vBefore");
  return v.classList.contains("as-sheet") && v.classList.contains("is-active") && !document.getElementById("todos").hidden;
});
const keys = (page) => page.evaluate(() => [...document.querySelectorAll("#nav button")].filter((b) => !b.hidden && b.getClientRects().length).map((b) => b.dataset.tab || b.id));
const stubUp = (page) => until(() => page.evaluate(() => {
  const t = document.getElementById("tix");
  return !!t && !t.hidden && !!t.querySelector(".tstub");
}), "the stub is up");
const stubTitle = (page) => text(page, "#tix .stub-t");
const closeStub = async (page) => {
  await page.click("#tix [data-close]");
  await until(() => page.evaluate(() => document.getElementById("tix").hidden), "the stub goes");
};
// The tear (or the sheet's rise) has stopped. Not `animation.finished`: that rejects with
// AbortError when the stub repaints and cancels the animation; a cancelled one is gone from
// getAnimations(), so waiting for none to be running is right either way.
const torn = (page) => until(() => page.evaluate(() => !document.getAnimations().some((a) => (a.animationName === "tear" || a.animationName === "bsUp") && a.playState !== "finished")), "the tear has finished");
const noSideways = (page) => page.evaluate(() => {
  const v = document.getElementById("vTickets");
  const over = [...v.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).map((e) => e.className);
  return { doc: document.scrollingElement.scrollWidth <= innerWidth, view: v.scrollWidth <= v.clientWidth, over };
});
// Whole-page screenshot of the case: the view laid out at its full height for the picture.
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  // The views fade over .16 s of real time: wait until the one leaving has gone.
  await until(() => page.evaluate(() => [...document.querySelectorAll(".view")].every((v) => getComputedStyle(v).opacity === (v.classList.contains("is-active") ? "1" : "0"))), "the views have faded");
  await page.screenshot({ path: SHOTS + "/" + name });
}

const cases = [];

cases.push({
  name: "the key: Before before the first day, Tickets from 00:00 on Day 1 in its place, Ring up still in the middle; a key by keyboard",
  async run({ page }) {
    const backend = await ready(page, { nowMs: EVE });
    await until(() => visible(page, "#beforeBtn"), "Before is in the bar before the trip");
    assert.equal(await visible(page, "#ticketsBtn"), false, "no Tickets key before the trip");
    assert.deepEqual(await keys(page), ["days", "before", "ring", "money", "youBtn"]);
    await advance(page, backend, 3 * 60 * 1000);
    await until(() => visible(page, "#ticketsBtn"), "Day 1: the Tickets key");
    assert.equal(await visible(page, "#beforeBtn"), false, "Before has given its place");
    assert.deepEqual(await keys(page), FIVE);
    // A key: label, small line, no badge (nothing today on Day 1 in this plan).
    await expectText(page, "#ticketsBtn", "Tickets定期入れ");
    assert.equal(await visible(page, "#ticketsN"), false, "no badge at zero");
    assert.equal(await page.evaluate(() => document.getElementById("ticketsBtn").getAttribute("aria-label")), "Tickets");
    // Reached by keyboard and opened with Enter.
    await page.focus('#nav [data-tab="days"]');
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "ticketsBtn");
    await page.keyboard.press("Enter");
    await until(() => page.evaluate(() => document.getElementById("vTickets").classList.contains("is-active")), "Enter opens Tickets");
    assert.equal(await page.evaluate(() => document.getElementById("ticketsBtn").getAttribute("aria-current")), "page");
    // The Tickets key is a key like the others.
    const k = await page.evaluate(() => {
      const css = (sel, p) => getComputedStyle(document.querySelector(sel))[p];
      return [css("#ticketsBtn", "height"), css("#ticketsBtn", "borderTopLeftRadius"), css("#ticketsBtn", "fontWeight"), css('#nav [data-tab="money"]', "fontSize") === css("#ticketsBtn", "fontSize"), getComputedStyle(document.querySelector("#ticketsBtn small")).fontSize];
    });
    assert.deepEqual(k, ["56px", "10px", "900", true, "10.5px"]);
    // Leaving the app on Tickets: it is not what it opens on next time.
    assert.notEqual(await page.evaluate(() => localStorage.getItem("mat.tab")), "tickets");
  },
});

cases.push({
  name: "the window holds the next ticket; the window and Show ticket open the same stub as the stop does; the head line and the badge count",
  async run({ page }) {
    await ready(page);
    await kept(page, [MEIJI, LUNCH, SKY, EXPRESS]);
    await until(() => visible(page, "#ticketsN"), "the badge shows");
    assert.equal(await text(page, "#ticketsN"), "3");
    assert.equal(await page.evaluate(() => document.getElementById("ticketsBtn").getAttribute("aria-label")), "Tickets, 3 still to come today");
    await goTickets(page);
    await expectText(page, "#pcTitle", "Tickets Sat Dec 12 · today");
    await expectText(page, ".pc-come", "4 to come");
    await expectText(page, ".pc-case > .pc-foil", "次 Next本日 Today · 3 left");
    await expectText(page, "#pcWin .pc-tk .pc-title", "Shibuya Sky");
    await expectText(page, "#pcWin .pc-kind", "切符Ticket14:00");
    await expectText(page, "#pcWin .pc-lv", "こんどLeave by 13:30 · in 10 min");
    await expectText(page, "#pcWin .pc-st", "券3 codes · on this phone");
    await expectText(page, "#pcWin .num", "D 03");
    await expectText(page, "#pcShow", "切符Show ticketCar 7 · 10A–C");
    // The first picture (this phone's person's) small in the window.
    await until(() => page.evaluate(() => {
      const img = document.querySelector("#pcWin .pc-th img");
      return img && img.complete && img.naturalWidth > 0 && img.src.startsWith("blob:");
    }), "the picture shows in the window");
    // The window opens the stub.
    await page.click("#pcWin .pc-tk");
    await stubUp(page);
    assert.equal(await stubTitle(page), "Shibuya Sky");
    assert.equal(await page.evaluate(() => document.querySelectorAll("#tix .pp-pg").length), 3, "the same stub: three codes, swiped");
    await torn(page);
    await closeStub(page);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.closest("#pcWin") !== null), true, "focus back on the window");
    // Show ticket opens it too.
    await page.click("#pcShow");
    await stubUp(page);
    assert.equal(await stubTitle(page), "Shibuya Sky");
    await torn(page);
    await closeStub(page);
    assert.equal(await page.evaluate(() => document.activeElement.id), "pcShow");
  },
});

cases.push({
  name: "the pockets: today, later days, the back pocket; a slot opens its stub; the three kinds of status",
  async run({ page }) {
    await ready(page);
    await kept(page, [MEIJI, LUNCH, SKY, EXPRESS]);
    await goTickets(page);
    const pockets = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".pc-slots")].map((p) => [p.dataset.pocket, [...p.querySelectorAll(".pc-pk")].map((b) => b.dataset.id)])));
    assert.deepEqual(pockets, { today: ["planstop1206", "planstop1204"], later: ["planstop1301"], used: ["planstop1202", "planstop1201", "planstop1101"] });
    const foils = await page.evaluate(() => [...document.querySelectorAll(".pc-case > .pc-foil")].map((f) => f.textContent));
    assert.deepEqual(foils, ["次 Next本日 Today · 3 left", "明日から Later days1 in this pocket", "使用済 Used, in the back pocket3"]);
    // Pictures this phone cannot fetch: the dashed outline, needs signal once.
    const slot = (id) => '.pc-pk[data-id="' + id + '"]';
    await until(() => page.evaluate((s) => document.querySelector(s).classList.contains("is-needs"), slot(TEA)), "the tea ceremony needs signal");
    await expectText(page, slot(TEA) + " .pc-st", "券1 code · needs signal once");
    assert.equal(await page.evaluate((s) => getComputedStyle(document.querySelector(s + " .pc-kb")).borderTopStyle, slot(TEA)), "dashed");
    assert.equal(await page.evaluate((s) => getComputedStyle(document.querySelector(s)).borderTopStyle, slot(TEA)), "dashed", "a dashed outline of a ticket");
    // Reference only: a cream slip, the number where a code would be.
    await expectText(page, slot(DINNER) + " .pc-st", "番号のみ Reference only");
    await expectText(page, slot(DINNER) + " .pc-refno", "TEST-0412予約番号");
    assert.equal(await page.evaluate((s) => document.querySelector(s).classList.contains("is-ref"), slot(DINNER)), true);
    // On this phone.
    await expectText(page, slot(EXPRESS) + " .pc-st", "券1 code · on this phone");
    await expectText(page, slot(EXPRESS) + " .pc-d", "13Sun");
    await expectText(page, slot(LUNCH) + " .pc-st", "券2 pages · on this phone");
    // The back pocket: struck through and dimmed.
    const used = await page.evaluate((s) => {
      const b = document.querySelector(s);
      return { line: getComputedStyle(b.querySelector(".pc-nt")).textDecorationLine, op: getComputedStyle(b).opacity };
    }, slot(MEIJI));
    assert.deepEqual(used, { line: "line-through", op: "0.55" });
    // Names that read sensibly.
    assert.equal(await page.evaluate((s) => document.querySelector(s).getAttribute("aria-label"), slot(DINNER)), "Show ticket: Dinner, 19:00, reference only, TEST-0412");
    assert.equal(await page.evaluate((s) => document.querySelector(s).getAttribute("aria-label"), slot(MEIJI)), "Used: Meiji Shrine, 09:00, 1 code, on this phone");
    // Every slot opens its own stub.
    for (const [id, title] of [[DINNER, "Dinner"], [EXPRESS, "Limited express to Nara"], [MEIJI, "Meiji Shrine"], [TEA, "Tea ceremony"]]) {
      await page.click(slot(id));
      await stubUp(page);
      assert.equal(await stubTitle(page), title);
      await torn(page);
      await closeStub(page);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.id), id, "focus back on the slot");
    }
    // The reference-only stub is the reference, large.
    await page.click(slot(DINNER));
    await stubUp(page);
    await expectText(page, "#tix .ref-big b", "TEST-0412");
    await torn(page);
    await closeStub(page);
  },
});

cases.push({
  name: "with no signal the case still shows everything from the phone, and a slot still opens its stub",
  async run({ page }) {
    const backend = await ready(page);
    await kept(page, [MEIJI, LUNCH, SKY, EXPRESS]);
    backend.failWith = "network";
    await page.context().setOffline(true);
    await goTickets(page);
    await expectText(page, "#pcWin .pc-st", "券3 codes · on this phone");
    await page.click("#pcShow");
    await stubUp(page);
    await until(() => page.evaluate(() => {
      const imgs = [...document.querySelectorAll("#tix .stub-code img")];
      return imgs.length === 3 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    }), "the three codes show with no signal");
    await torn(page);
    await closeStub(page);
    await page.context().setOffline(false);
  },
});

cases.push({
  name: "the Before slip: the count, Open shows the pad as a sheet over the tab, Done and Escape close it, it goes when the last is ticked",
  async run({ page }) {
    const backend = await ready(page);
    await goTickets(page);
    await until(() => visible(page, "#pcSlip"), "the slip is tucked behind the case");
    await expectText(page, "#pcSlip", "予約票2 still to bookOpen");
    assert.equal(await page.evaluate(() => document.getElementById("pcSlip").getAttribute("aria-label")), "Before we go: 2 still to book. Open");
    await page.click("#pcSlip");
    await until(() => sheetUp(page), "the pad shows");
    await torn(page);
    const sh = await page.evaluate(() => {
      const v = document.getElementById("vBefore");
      return { sheet: v.classList.contains("as-sheet"), active: v.classList.contains("is-active"), inert: v.inert, under: document.getElementById("vTickets").classList.contains("is-active"), underInert: document.getElementById("vTickets").inert, scrim: !document.getElementById("beforeScrim").hidden, focus: document.activeElement.id, tab: document.getElementById("ticketsBtn").classList.contains("is-active"), z: getComputedStyle(v).zIndex };
    });
    assert.deepEqual(sh, { sheet: true, active: true, inert: false, under: true, underInert: true, scrim: true, focus: "beforeDone", tab: true, z: "24" });
    // Done closes it, focus back on the slip.
    await page.click("#beforeDone");
    await until(async () => !(await sheetUp(page)), "the sheet goes");
    assert.equal(await page.evaluate(() => document.activeElement.id), "pcSlip");
    assert.equal(await page.evaluate(() => document.getElementById("vTickets").inert), false);
    // Escape closes it too; and the scrim.
    await page.click("#pcSlip");
    await until(() => sheetUp(page), "the pad shows");
    await page.keyboard.press("Escape");
    await until(async () => !(await sheetUp(page)), "Escape closes it");
    await page.click("#pcSlip");
    await until(() => sheetUp(page), "the pad shows");
    await torn(page);
    await page.mouse.click(200, 30);
    await until(async () => !(await sheetUp(page)), "the scrim closes it");
    // Tick both; the last one takes the sheet and the slip with it.
    await page.click("#pcSlip");
    await until(() => sheetUp(page), "the pad shows");
    for (const id of ["1", "2"]) {
      await page.dispatchEvent('#bwOpen .bw-r[data-id="' + id + '"] .bw-b', "click");
      await page.waitForTimeout(260);
      await page.dispatchEvent('#bwOpen .bw-r[data-id="' + id + '"] .bw-tick', "click");
      await until(() => backend.fake.tables.Todos.find((r) => r.id === id).ticked_by === "Mo", "ticked " + id);
      await advance(page, backend, 1700);
    }
    await until(async () => !(await visible(page, "#pcSlip")), "the slip goes once nothing is left to tick");
    await until(async () => !(await sheetUp(page)), "the sheet goes with it");
    assert.equal(await page.evaluate(() => document.getElementById("vTickets").classList.contains("is-active")), true, "still on Tickets");
    assert.equal(await page.evaluate(() => document.getElementById("beforeScrim").hidden), true);
    assert.equal(await visible(page, "#beforeBtn"), false, "and no Before key");
  },
});

cases.push({
  name: "empty: the case with an empty window and how to add one; no Show ticket, no pockets, no badge",
  async run({ page }) {
    await ready(page, { tickets: false, items: null });
    await goTickets(page);
    await expectText(page, "#pcWin .pc-none", "No tickets on any stop yet.Open a stop, tap Edit, then add it under 切符 Ticket.");
    assert.equal(await page.$("#pcShow"), null);
    assert.equal(await page.$(".pc-slots"), null);
    assert.equal(await page.$("#pcSlip"), null, "nothing open in Before: no slip");
    assert.equal(await visible(page, "#ticketsN"), false);
    assert.equal(await page.$(".pc-come"), null, "nothing to come: no count");
    await shot(page, "phone-empty.png");
  },
});

cases.push({
  name: "the picture of the tab at 390 wide, Before slip and every kind of slot",
  viewport: { width: 390, height: 844 },
  async run({ page }) {
    await ready(page);
    await kept(page, [MEIJI, LUNCH, SKY, EXPRESS]);
    await goTickets(page);
    await until(() => page.evaluate(() => document.querySelector('.pc-pk[data-id="planstop1206"]').classList.contains("is-needs")), "the tea ceremony needs signal");
    await until(() => page.evaluate(() => {
      const img = document.querySelector("#pcWin .pc-th img");
      return img && img.complete && img.naturalWidth > 0;
    }), "the window's picture");
    const w = await noSideways(page);
    assert.deepEqual(w, { doc: true, view: true, over: [] });
    // The whole case in one picture: a phone tall enough to hold it.
    const h = await page.evaluate(() => Math.ceil(document.querySelector("#vTickets .pc").getBoundingClientRect().height + 140));
    await page.setViewportSize({ width: 390, height: Math.max(844, h) });
    await page.waitForTimeout(200);
    await shot(page, "phone.png");
  },
});

for (const width of [320, 390]) {
  cases.push({
    name: "the bar at " + width + " px with the Tickets key: Days, Tickets, Ring up, Money, You on one line, nothing clipped, the badge inside its key",
    viewport: { width, height: 700 },
    async run({ page }) {
      await ready(page);
      await until(() => visible(page, "#ticketsN"), "the badge shows");
      for (const tab of ["days", "tickets"]) {
        await page.click('#nav button[data-tab="' + tab + '"]');
        const shape = await page.evaluate(() => {
          const items = [...document.querySelectorAll("#nav button")].filter((b) => !b.hidden);
          const nav = document.getElementById("nav").getBoundingClientRect();
          const rects = items.map((b) => b.getBoundingClientRect());
          const overlap = rects.some((a, i) => rects.some((c, j) => j > i && a.left < c.right - 0.5 && c.left < a.right - 0.5));
          const clipped = items.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.id || b.dataset.tab);
          const p = document.getElementById("ticketsN").getBoundingClientRect();
          const k = document.getElementById("ticketsBtn").getBoundingClientRect();
          // Each text run inside the Tickets key is on one line and inside it.
          const tight = [];
          const walker = document.createTreeWalker(document.getElementById("ticketsBtn"), NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent.trim()) continue;
            const r = document.createRange();
            r.selectNodeContents(n);
            const tr = r.getBoundingClientRect();
            if (r.getClientRects().length > 1 || tr.left < k.left + 1 || tr.right > k.right - 1) tight.push(n.textContent);
          }
          return { ids: items.map((b) => b.dataset.tab || b.id), overlap, clipped, tight, inside: rects.every((r) => r.left >= nav.left - 0.5 && r.right <= nav.right + 0.5), pill: p.left >= k.left - 0.5 && p.right <= k.right + 0.5 && p.top >= k.top - 0.5, page: document.documentElement.scrollWidth <= innerWidth };
        });
        assert.deepEqual(shape, { ids: FIVE, overlap: false, clipped: [], tight: [], inside: true, pill: true, page: true }, "on " + tab);
      }
    },
  });
}

cases.push({
  name: "320 × 568: the case fits without sideways scroll, long names wrap or ellipsis, Show ticket and every slot a full tap target",
  viewport: { width: 320, height: 568 },
  async run({ page }) {
    const backend = await caseBackend();
    await backend.call("updateStop", { id: SKY, patch: { title: "Shibuya Sky observation deck, sunset entry for three" } });
    await ready(page, { backend });
    await kept(page, [MEIJI, LUNCH, SKY, EXPRESS]);
    await goTickets(page);
    await until(() => page.evaluate(() => document.querySelector('.pc-pk[data-id="planstop1206"]').classList.contains("is-needs")), "the tea ceremony needs signal");
    assert.deepEqual(await noSideways(page), { doc: true, view: true, over: [] });
    const small = await page.evaluate(() => [...document.querySelectorAll("#vTickets button")].map((b) => b.getBoundingClientRect()).filter((r) => r.height < 44 || r.width < 44).length);
    assert.equal(small, 0, "every control at least 44 px each way");
    // The head line's date and count never run into each other; the status lines are whole.
    const head = await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById("pcTitle"));
      const a = [...range.getClientRects()].filter((r) => r.width > 0);
      const c = document.querySelector(".pc-come").getBoundingClientRect();
      const st = [...document.querySelectorAll("#vTickets .pc-st")].filter((e) => e.scrollWidth > e.clientWidth + 1).length;
      return { apart: a.every((r) => r.right <= c.left + 0.5 || r.top >= c.bottom - 0.5 || r.bottom <= c.top + 0.5), cut: st };
    });
    assert.deepEqual(head, { apart: true, cut: 0 });
    await shot(page, "phone-320.png");
  },
});

cases.push({
  name: "reduced motion: the case's keys and the Before sheet do not move",
  async run({ page }) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page);
    await goTickets(page);
    const t = await page.evaluate(() => ["#pcShow", "#pcWin .pc-tk", "#pcSlip"].map((s) => getComputedStyle(document.querySelector(s)).transitionDuration));
    assert.ok(t.every((d) => parseFloat(d) <= 0.0001), t.join(" "));
    await page.click("#pcSlip");
    await until(() => sheetUp(page), "the pad shows");
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("vBefore")).animationName), "none");
  },
});

cases.push({
  name: "on a computer (1440 × 900): the case stands in the Days pane, the rail's Tickets key opens it, Days is the way back, Money stays",
  viewport: { width: 1440, height: 900 },
  mobile: false,
  async run({ page }) {
    await open(page, { backend: await caseBackend(), nowMs: NOON12, tab: "money" });
    await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0 && document.querySelectorAll("#rail .pg .tk").length > 0), "both panes draw");
    await kept(page, [MEIJI, LUNCH, SKY, EXPRESS]);
    await until(() => visible(page, "#ticketsBtn"), "the Tickets key is in the rail");
    assert.deepEqual(await keys(page), ["tickets", "ring", "youBtn"]);
    await page.click("#ticketsBtn");
    await until(() => page.evaluate(() => document.getElementById("vTickets").classList.contains("is-active") && !!document.querySelector("#vTickets .pc-case")), "the case shows");
    const r = await page.evaluate(() => {
      const R = (id) => document.getElementById(id).getBoundingClientRect().toJSON();
      const v = (id) => getComputedStyle(document.getElementById(id));
      return { t: R("vTickets"), d: R("vDays"), m: R("vMoney"), tShown: v("vTickets").pointerEvents !== "none", mShown: v("vMoney").opacity === "1" && !document.getElementById("vMoney").inert, dInert: document.getElementById("vDays").inert };
    });
    assert.ok(Math.abs(r.t.left - r.d.left) < 1 && Math.abs(r.t.width - r.d.width) < 1, "the case stands where the Days pane stands");
    assert.equal(r.mShown, true, "Money is still shown and usable");
    assert.equal(r.dInert, true);
    assert.deepEqual(await keys(page), ["days", "tickets", "ring", "youBtn"], "the Days key is the way back");
    // The stub opens in the Days pane.
    await page.click("#pcShow");
    await stubUp(page);
    const stub = await page.evaluate(() => document.getElementById("tix").getBoundingClientRect().toJSON());
    assert.ok(stub.right <= r.t.right + 60, "the stub stays over the Days pane");
    await torn(page);
    await closeStub(page);
    // The Before sheet opens over the Days pane only.
    await page.click("#pcSlip");
    await until(() => sheetUp(page), "the pad shows");
    await torn(page);
    const bs = await page.evaluate(() => ({ b: document.getElementById("vBefore").getBoundingClientRect().toJSON(), s: document.getElementById("beforeScrim").getBoundingClientRect().toJSON() }));
    assert.ok(Math.abs(bs.b.left - r.t.left) < 1 && Math.abs(bs.b.width - r.t.width) < 1, "the sheet over the Days pane");
    assert.ok(bs.s.right <= r.m.left + 60, "the scrim leaves Money alone");
    await page.click("#beforeDone");
    await until(async () => !(await sheetUp(page)), "the sheet goes");
    await page.waitForTimeout(250);
    await shot(page, "desktop.png");
    await page.click('#nav [data-tab="days"]');
    await until(() => page.evaluate(() => document.getElementById("vDays").classList.contains("is-active")), "Days is back");
    assert.deepEqual(await keys(page), ["tickets", "ring", "youBtn"]);
    assert.equal(await page.evaluate(() => localStorage.getItem("mat.tab")), "money", "what the app remembers is left alone");
  },
});

cases.push({
  name: "the window's band: a light line colour gets the dark ink the stub uses, not white",
  async run({ page }) {
    await ready(page);
    await goTickets(page);
    const band = () => page.evaluate(() => {
      const b = document.querySelector("#pcWin .pc-band");
      const w = document.querySelector("#pcWin .pc-tk");
      return { colour: w.style.getPropertyValue("--line"), ink: w.style.getPropertyValue("--line-ink"), text: getComputedStyle(b).color };
    });
    const w = await band();
    assert.equal(w.colour.toLowerCase(), "#9acd32", "Day 3 is a light green line");
    assert.equal(w.text, "rgb(21, 18, 15)", "dark text on the light band");
    await page.click("#pcWin .pc-tk");
    await stubUp(page);
    const stubInk = await page.evaluate(() => document.querySelector("#tix .tstub").style.getPropertyValue("--line-ink"));
    assert.equal(w.ink, stubInk, "the same ink as the stub");
    await torn(page);
    await closeStub(page);
  },
});

cases.push({
  name: "a minute passing changes the lead line in place: focus returns to the opener after the stub, and the picture is not redrawn",
  async run({ page }) {
    const backend = await ready(page);
    await goTickets(page);
    await expectText(page, "#pcWin .pc-lv", "こんどLeave by 13:30 · in 10 min");
    await until(() => page.evaluate(() => {
      const img = document.querySelector("#pcWin .pc-th img");
      return img && img.complete && img.naturalWidth > 0;
    }), "the window's picture");
    await page.evaluate(() => {
      window.__pcKeep = { btn: document.querySelector("#pcShow"), win: document.querySelector("#pcWin .pc-tk"), img: document.querySelector("#pcWin .pc-th img") };
    });
    await page.click("#pcShow");
    await stubUp(page);
    await torn(page);
    await advance(page, backend, 2 * 60 * 1000);
    await until(() => page.evaluate(() => document.querySelector("#pcWin .pc-lv").textContent.includes("in 8 min")), "the line counts down");
    await closeStub(page);
    const r = await page.evaluate(() => ({
      focus: document.activeElement === window.__pcKeep.btn,
      sameWin: document.querySelector("#pcWin .pc-tk") === window.__pcKeep.win,
      sameImg: document.querySelector("#pcWin .pc-th img") === window.__pcKeep.img && window.__pcKeep.img.isConnected,
    }));
    assert.deepEqual(r, { focus: true, sameWin: true, sameImg: true });
  },
});

module.exports = cases;
