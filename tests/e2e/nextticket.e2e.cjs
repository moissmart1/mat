/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Your next ticket in the slot above the bar, and whose every ticket is
// (issue #83; js/views/nextticket.js, the whose marks in the pass case, the
// stub and on Days). The phone is Ajen's own link; Mo, Ajen and Trenton each
// have a picture drawn here. Every stop, seat, booking, reference and
// picture is made up (codes drawn by tests/e2e/pictures.cjs).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { WITH_PLAN, NOON12, makeBackend, open, advance, until, text, expectText, visible } = require("./helpers.cjs");
const { png } = require("./pictures.cjs");

// Pictures are taken only when MAT_TAB_SHOTS names an output folder.
const SHOTS = process.env.MAT_TAB_SHOTS || "";
const KEY = "test-key";
const MEIJI = "planstop1201"; // 09:00: Ajen's own code only, which this phone cannot fetch (needs signal once)
const LUNCH = "planstop1202"; // 12:30: a PDF's two pages (all of us)
const SKY = "planstop1203"; // 14:00, 30 min to get there: three per-person codes
const DINNER = "planstop1204"; // 19:00: reference only
const GLOVES = "planstop1205"; // no time: one code for all, which this phone cannot fetch
const TEA = "planstop1206"; // 17:00: one code for all of us
const EXPRESS = "planstop1301"; // Sun Dec 13, 10:08: three per-person codes
const SNOW = "planstop1401"; // Mon Dec 14, 09:30: only Mo and Trenton have codes
const KAISEKI = "planstop1501"; // Tue Dec 15, 18:00: one code for all of us

const BEFORE = Date.parse("2026-11-21T10:00:00+09:00");
const at = (iso) => Date.parse(iso + "+09:00");

const PLANNER_ID = "fakePlannerSheet_nextticket";
const BHEAD = ["#", "Item", "Who", "Book by", "Status", "Notes", "Booking link"];
const CHEAD = ["#", "Date / time", "Agent / session", "Tab", "Cell(s)", "Item", "Old value", "New value", "Why", "Proof / source", "Verified?"];

let n = 0;
const tid = () => "tkp" + String(++n).padStart(9, "0");

// Three made-up faces, drawn by the page's own canvas: a sunset, a green hill, a red hat on blue.
async function faces(page) {
  return page.evaluate(() => {
    const draw = (paint) => {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 128;
      const g = c.getContext("2d");
      paint(g);
      return c.toDataURL("image/jpeg", 0.7);
    };
    const body = (g, skin, shirt) => {
      g.fillStyle = shirt;
      g.beginPath();
      g.ellipse(64, 128, 46, 34, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = skin;
      g.beginPath();
      g.arc(64, 64, 22, 0, Math.PI * 2);
      g.fill();
    };
    return {
      Ajen: draw((g) => {
        const s = g.createLinearGradient(0, 0, 0, 128);
        s.addColorStop(0, "#5a4a8a");
        s.addColorStop(0.55, "#f08a5d");
        s.addColorStop(1, "#2b2b45");
        g.fillStyle = s;
        g.fillRect(0, 0, 128, 128);
        g.fillStyle = "#ffd27a";
        g.beginPath();
        g.arc(96, 74, 14, 0, Math.PI * 2);
        g.fill();
        body(g, "#1b1a24", "#1b1a24");
      }),
      Mo: draw((g) => {
        g.fillStyle = "#8fc7e8";
        g.fillRect(0, 0, 128, 128);
        g.fillStyle = "#5f9e3f";
        g.beginPath();
        g.ellipse(64, 120, 90, 46, 0, 0, Math.PI * 2);
        g.fill();
        body(g, "#5a3a22", "#e2b33a");
      }),
      Trenton: draw((g) => {
        g.fillStyle = "#b9c7dc";
        g.fillRect(0, 0, 128, 128);
        g.fillStyle = "#7d8ea8";
        g.beginPath();
        g.moveTo(0, 100);
        g.lineTo(40, 50);
        g.lineTo(80, 96);
        g.lineTo(128, 60);
        g.lineTo(128, 128);
        g.lineTo(0, 128);
        g.fill();
        body(g, "#e8c4a0", "#2f4a7a");
        g.fillStyle = "#c8372d";
        g.fillRect(42, 38, 44, 12);
      }),
    };
  });
}

function seed({ photos = {}, items = true } = {}) {
  const s = JSON.parse(JSON.stringify(WITH_PLAN));
  s.stops.push({ id: TEA, date: "2026-12-12", time: "17:00", title: "Tea ceremony" });
  s.stops.push({ id: EXPRESS, date: "2026-12-13", time: "10:08", title: "Limited express to Nara", detail: "Platform 4" });
  s.stops.push({ id: SNOW, date: "2026-12-14", time: "09:30", title: "Snow park lift pass" });
  s.stops.push({ id: KAISEKI, date: "2026-12-15", time: "18:00", title: "Kaiseki dinner" });
  s.people = Object.fromEntries(Object.entries(photos).map(([k, v]) => [k, { photo: v }]));
  if (items) {
    s.plannerId = PLANNER_ID;
    s.plannerTabs = { "Book Now": [["Before we go: bookings"], BHEAD, [1, "Made-up snow park bus", "", "2026-12-14", "Not booked", "", ""]], "Change Log": [CHEAD] };
  }
  return s;
}

// A backend with every kind of whose. The pictures on Meiji Shrine and on the
// gloves are refused when this phone asks for them (they stay "needs signal once").
async function slotBackend(page, { nowMs = NOON12, photos = null, only = null } = {}) {
  const pics = photos || (await faces(page));
  const backend = makeBackend(seed({ photos: pics }), { now: nowMs - 300000 });
  const as = (action, args, actor = "Mo") => backend.fake({ key: KEY, actor, action, args });
  assert.equal((await as("syncTodos", {})).ok, true);
  const refused = new Set();
  const add = async (stop, who, seat, page_, data, { refuse = false } = {}) => {
    const r = await as("addTicket", { ticket: { id: tid(), stop, who, seat, page: page_, mime: "image/png", w: 300, h: 300, data } });
    assert.equal(r.ok, true, r.message);
    if (refuse) refused.add(r.data.ticket.id);
  };
  const want = (id) => !only || only.includes(id);
  if (want(MEIJI)) await add(MEIJI, "Ajen", "", 1, png(300, 300, 5), { refuse: true });
  if (want(LUNCH)) {
    await add(LUNCH, "", "", 1, png(300, 300, 61));
    await add(LUNCH, "", "", 2, png(300, 300, 62));
  }
  if (want(SKY)) {
    await as("updateStop", { id: SKY, patch: { tkRef: "TEST-3001", tkName: "MO", tkPeople: "3 adults", tkSeat: "Car 7 · 10A–C" } });
    await add(SKY, "Mo", "Car 7 · 10A", 1, png(300, 300, 11));
    await add(SKY, "Ajen", "Car 7 · 10B", 1, png(300, 300, 23));
    await add(SKY, "Trenton", "Car 7 · 10C", 1, png(300, 300, 37));
  }
  if (want(TEA)) await add(TEA, "", "", 1, png(300, 300, 71));
  if (want(DINNER)) await as("updateStop", { id: DINNER, patch: { tkRef: "TEST-0412", tkName: "MO", tkPeople: "3" } });
  if (want(GLOVES)) await add(GLOVES, "", "", 1, png(300, 300, 91), { refuse: true });
  if (want(EXPRESS)) {
    await add(EXPRESS, "Mo", "Car 5 · 3A", 1, png(300, 300, 81));
    await add(EXPRESS, "Ajen", "Car 5 · 3B", 1, png(300, 300, 82));
    await add(EXPRESS, "Trenton", "Car 5 · 3C", 1, png(300, 300, 83));
  }
  if (want(SNOW)) {
    await add(SNOW, "Mo", "", 1, png(300, 300, 41));
    await add(SNOW, "Trenton", "", 1, png(300, 300, 43));
  }
  if (want(KAISEKI)) await add(KAISEKI, "", "", 1, png(300, 300, 95));
  backend.now = nowMs;
  backend.requests.length = 0;
  const handle = backend.handle;
  backend.handle = async (body) => (body && body.action === "ticket" && body.args && refused.has(body.args.id) ? { ok: false, error: "not_found", message: "That ticket picture is not here any more." } : handle(body));
  backend.call = as;
  backend.photos = pics;
  return backend;
}

// Opens Ajen's phone on Days and waits for the tickets to draw.
async function ready(page, opts = {}) {
  const backend = opts.backend || (await slotBackend(page, opts));
  await open(page, { backend, nowMs: opts.nowMs || NOON12, tab: opts.tab === undefined ? "days" : opts.tab, own: "Ajen" });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
  return backend;
}
const kept = (page, ids) => until(() => page.evaluate((ids) => ids.every((id) => document.querySelector('#rail .r[data-id="' + id + '"] .tk-mark b:not(.is-dash)')), ids), "the pictures reach this phone", 10000);
const ALL_KEPT = [LUNCH, SKY, TEA, EXPRESS, SNOW, KAISEKI];

// The slot as the person sees it.
const slotShown = (page) => page.evaluate(() => {
  const n = document.getElementById("nextTicket");
  return !!n && !n.hidden && getComputedStyle(n).visibility === "visible" && n.getBoundingClientRect().height > 0;
});
const slotGone = (page) => page.evaluate(() => {
  const n = document.getElementById("nextTicket");
  return !n || n.hidden || getComputedStyle(n).visibility === "hidden";
});
const waitSlot = (page, msg = "the slot shows") => until(() => slotShown(page), msg);
const slot = (page) => page.evaluate(() => {
  const n = document.getElementById("nextTicket");
  const b = document.getElementById("ntBtn");
  const t = (s) => (n.querySelector(s) ? n.querySelector(s).textContent.replace(/\s+/g, " ").trim() : null);
  const seal = n.querySelector(".ntk-seal .wh-s");
  return {
    whose: n.dataset.whose,
    label: t(".ntk-l"),
    warn: n.querySelector(".ntk-w").hidden ? "" : t(".ntk-w"),
    tag: n.querySelector(".ntk-tag").hidden ? "" : t(".ntk-tag"),
    title: t(".ntk-tt"),
    line: t(".ntk-ln"),
    go: t(".ntk-go"),
    aria: b.getAttribute("aria-label"),
    seal: seal ? seal.className : "",
    sealText: seal ? seal.textContent : "",
    sealImg: seal && seal.querySelector("img") ? seal.querySelector("img").getAttribute("src") : "",
  };
});
const stubUp = (page) => until(() => page.evaluate(() => {
  const t = document.getElementById("tix");
  return !!t && !t.hidden && !!t.querySelector(".tstub");
}), "the stub is up");
const closeStub = async (page) => {
  await page.click("#tix [data-close]");
  await until(() => page.evaluate(() => document.getElementById("tix").hidden), "the stub goes");
};
const torn = (page) => until(() => page.evaluate(() => !document.getAnimations().some((a) => (a.animationName === "tear" || a.animationName === "bsUp") && a.playState !== "finished")), "the tear has finished");

// A settled page: the faces loaded, nothing sliding or fading, the layout still
// for three looks in a row (polled from Node: the page's clock is paused, so
// its own timers and animation frames do not run).
async function settle(page) {
  let last = "";
  let same = 0;
  let why = "";
  // Generous: a busy test machine can take a while to lay out and fade.
  const end = Date.now() + 20000;
  await page.evaluate(() => document.fonts.ready.then(() => true));
  while (same < 3) {
    const now = await page.evaluate(() => {
      const sig = document.fonts.status + "|" + [...document.querySelectorAll("#nextTicket, #rail .pg, .r.is-open, #tix .tstub, #vDays, #vTickets, .sheet.is-open, #ubar")].map((e) => { const b = e.getBoundingClientRect(); return [b.top, b.height, b.width].join(","); }).join(";") + "|" + document.getElementById("vDays").scrollTop;
      const run = document.getAnimations({ subtree: true }).filter((a) => a.playState === "running" && a.animationName !== "fan" && a.effect && a.effect.getTiming().iterations !== Infinity).map((a) => (a.animationName || a.transitionProperty || "?") + "@" + (a.effect.target ? a.effect.target.className : ""));
      const faded = [...document.querySelectorAll(".view")].every((v) => getComputedStyle(v).opacity === (v.classList.contains("is-active") ? "1" : "0"));
      return { sig, still: !run.length && faded && document.fonts.status === "loaded", run };
    });
    same = now.sig === last && now.still ? same + 1 : 0;
    last = now.sig;
    why = JSON.stringify(now.run);
    if (Date.now() > end) throw new Error("the page did not settle in 20 s (still moving: " + why + ", fonts " + (await page.evaluate(() => document.fonts.status)) + ")");
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await settle(page);
  await page.screenshot({ path: SHOTS + "/" + name, type: "jpeg", quality: 88 });
}

// Opens a stop's row on Days by keyboard (the slot may stand over it).
async function openRow(page, id) {
  await page.evaluate((i) => {
    const b = document.querySelector('#rail .r[data-id="' + i + '"] .r-b');
    b.scrollIntoView({ block: "center" });
    b.focus();
  }, id);
  const isOpen = () => page.evaluate((i) => document.querySelector('#rail .r[data-id="' + i + '"]').classList.contains("is-open"), id);
  if (!(await isOpen())) await page.keyboard.press("Enter");
  await until(isOpen, "the stop opens");
  await settle(page);
}
// The bottom edge of a stop's last button and the slot's top edge.
const lastButtonAndSlot = (page, id) => page.evaluate((i) => {
  const r = document.querySelector('#rail .r[data-id="' + i + '"]');
  const btns = [...r.querySelectorAll(".r-more button, .r-more a")].filter((b) => b.getClientRects().length);
  const last = btns[btns.length - 1];
  return { last: last.getBoundingClientRect().bottom, slot: document.getElementById("nextTicket").getBoundingClientRect().top, label: last.textContent };
}, id);

const cases = [];

cases.push({
  name: "before the trip: the slot on Days shows your next ticket with your picture, date, time and seat; one tap opens your code; focus comes back",
  async run({ page }) {
    const backend = await ready(page, { nowMs: BEFORE, only: [SKY, TEA, DINNER, EXPRESS, SNOW] });
    await kept(page, [SKY, TEA, EXPRESS, SNOW]);
    await waitSlot(page);
    const s = await slot(page);
    assert.deepEqual(
      { whose: s.whose, label: s.label, tag: s.tag, title: s.title, line: s.line, go: s.go, aria: s.aria },
      {
        whose: "mine",
        label: "あなたの切符 Your next ticket",
        tag: "",
        title: "Shibuya Sky",
        line: "Sat Dec 12 · 14:00 · Car 7 · 10B",
        go: "切符Show",
        aria: "Show your ticket: Shibuya Sky, Sat Dec 12 14:00, Car 7 · 10B",
      },
    );
    assert.equal(s.sealImg, backend.photos.Ajen, "your own picture in the seal");
    assert.ok(s.seal.includes("is-me"), "the vermilion ring");
    // It stands directly above the bar, 76 px high, one button.
    const g = await page.evaluate(() => {
      const n = document.getElementById("nextTicket").getBoundingClientRect();
      const nav = document.getElementById("nav").getBoundingClientRect();
      const b = document.getElementById("ntBtn").getBoundingClientRect();
      const hidden = [...document.querySelectorAll("#nextTicket [aria-hidden=true]")].map((e) => e.textContent);
      return { gap: Math.round(nav.top - n.bottom), h: Math.round(n.height), bh: b.height, buttons: document.querySelectorAll("#nextTicket button").length, hidden, ring: getComputedStyle(document.querySelector("#nextTicket .wh-s")).borderTopColor };
    });
    assert.deepEqual({ gap: g.gap, h: g.h, buttons: g.buttons }, { gap: 0, h: 76, buttons: 1 });
    assert.ok(g.bh >= 44, "a full tap target");
    assert.ok(g.hidden.includes("あなたの切符 ") && g.hidden.includes("切符"), "the Japanese is decoration");
    assert.equal(g.ring, "rgb(214, 60, 30)");
    // No rise: it simply shows.
    assert.equal(await page.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest("#nextTicket")).length), 0);
    // Before the trip the Before key is there, and the slot is on Days only.
    await until(() => visible(page, "#beforeBtn"), "the Before key");
    await page.click("#beforeBtn");
    await until(() => slotGone(page), "not on Before");
    await page.click('#nav [data-tab="days"]');
    await waitSlot(page, "back on Days");
    await shot(page, "slot-before.jpg");
    // One tap: the stub, on your own code.
    await page.click("#ntBtn");
    await stubUp(page);
    await expectText(page, "#tix .stub-t", "Shibuya Sky");
    const first = await page.evaluate(() => {
      const pp = document.querySelector("#tix [data-pp]");
      const pg = pp.querySelector(".pp-pg");
      return { who: pg.dataset.who, at: pp.scrollLeft, head: pg.querySelector(".stub-who").textContent.replace(/\s+/g, " ").trim() };
    });
    assert.deepEqual(first, { who: "Ajen", at: 0, head: "AJENあなたの券 Your codeCar 7 · 10B" });
    assert.equal(await slotGone(page), true, "the slot is not over the stub");
    await torn(page);
    await shot(page, "stub-yours.jpg");
    await closeStub(page);
    await waitSlot(page, "back after the stub");
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "ntBtn", "focus back on the slot");
  },
});

cases.push({
  name: "a trip day at 13:20: こんど and the leave line; past the stop, the next ticket; past the last, gone",
  async run({ page }) {
    const backend = await ready(page, { nowMs: NOON12 });
    await kept(page, ALL_KEPT);
    await waitSlot(page);
    const s = await slot(page);
    assert.deepEqual([s.whose, s.tag, s.title, s.line], ["mine", "こんど", "Shibuya Sky", "Leave by 13:30 · in 10 min"]);
    assert.equal(s.aria, "Show your ticket: Shibuya Sky, Leave by 13:30 · in 10 min, Car 7 · 10B");
    await shot(page, "slot-today.jpg");
    // The minute passes: the words change in place; focus stays on the button.
    await page.focus("#ntBtn");
    await page.evaluate(() => (window.__nt = document.getElementById("ntBtn")));
    await advance(page, backend, 2 * 60 * 1000);
    await until(async () => (await slot(page)).line === "Leave by 13:30 · in 8 min", "the line counts down");
    assert.equal(await page.evaluate(() => document.activeElement === window.__nt && window.__nt.isConnected), true);
    // 14:31: Sky is over; the tea ceremony (one code for all of us) is next.
    await advance(page, backend, 69 * 60 * 1000);
    await until(async () => (await slot(page)).title === "Tea ceremony", "the slot moves on");
    const t = await slot(page);
    assert.deepEqual([t.whose, t.label, t.tag, t.sealText], ["all", "全員 Next ticket · all of us", "こんど", "全"]);
    // 17:31: the dinner booking, reference only.
    await advance(page, backend, 180 * 60 * 1000);
    await until(async () => (await slot(page)).title === "Dinner", "the dinner booking");
    const d = await slot(page);
    assert.deepEqual([d.whose, d.label, d.sealText], ["ref", "番号のみ Next ticket · reference only", "全"]);
    assert.match(d.aria, /^Show the booking reference: Dinner, In .*min$/);
  },
});

cases.push({
  name: "whose: one code for all of us (全); a reference; none for you yet (dashed seal), which opens on Mo’s code, not yours; past the last ticket the slot goes",
  async run({ page }) {
    // 15:00 on Dec 12: the tea ceremony, one code for all of us.
    const backend = await ready(page, { nowMs: at("2026-12-12T15:00:00") });
    await kept(page, ALL_KEPT);
    await waitSlot(page);
    const all = await slot(page);
    assert.deepEqual([all.whose, all.label, all.title, all.sealText], ["all", "全員 Next ticket · all of us", "Tea ceremony", "全"]);
    assert.match(all.aria, /^Show the ticket for all of us: Tea ceremony, In 2 h/);
    await shot(page, "slot-all.jpg");
    // 17:31: Dinner, the booking reference only.
    await advance(page, backend, 151 * 60 * 1000);
    await until(async () => (await slot(page)).title === "Dinner", "the dinner booking is next");
    const ref = await slot(page);
    assert.deepEqual([ref.whose, ref.label, ref.sealText], ["ref", "番号のみ Next ticket · reference only", "全"]);
    await page.click("#ntBtn");
    await stubUp(page);
    await expectText(page, "#tix .ref-big b", "TEST-0412");
    await torn(page);
    await closeStub(page);
  },
});

cases.push({
  name: "yours first: the lift pass where only Mo and Trenton have codes is passed over for your next ticket, and said in vermilion in the label's place; past it, no warning",
  async run({ page }) {
    const backend = await ready(page, { nowMs: at("2026-12-13T12:00:00") });
    await kept(page, [SNOW, KAISEKI]);
    await waitSlot(page);
    const w = await slot(page);
    assert.deepEqual(
      [w.whose, w.warn, w.label, w.title, w.line, w.sealText],
      ["all", "No code for you at Snow park lift pass · Mon 14", "No code for you at Snow park lift pass · Mon 14", "Kaiseki dinner", "All of us · Tue Dec 15 · 18:00", "全"],
    );
    assert.equal(w.aria, "Show the ticket for all of us: Kaiseki dinner, Tue Dec 15 18:00. No code for you at Snow park lift pass, Mon Dec 14 09:30");
    const look = await page.evaluate(() => {
      const st = getComputedStyle(document.querySelector("#nextTicket .ntk-w"));
      return { colour: st.color, weight: st.fontWeight, jp: getComputedStyle(document.querySelector("#nextTicket .ntk-lj")).display };
    });
    assert.deepEqual(look, { colour: "rgb(184, 50, 24)", weight: "900", jp: "none" });
    await shot(page, "slot-none.jpg");
    // One tap opens your ticket, not the lift pass.
    await page.click("#ntBtn");
    await stubUp(page);
    await expectText(page, "#tix .stub-t", "Kaiseki dinner");
    await torn(page);
    await closeStub(page);
    // Dec 14, 10:31: the lift pass is used; the warning goes, your ticket stays.
    await advance(page, backend, (22 * 60 + 31) * 60 * 1000);
    await until(async () => (await slot(page)).warn === "", "the warning goes once the lift pass is past");
    const after = await slot(page);
    assert.deepEqual([after.title, after.label, after.line], ["Kaiseki dinner", "全員 Next ticket · all of us", "Tue Dec 15 · 18:00"]);
  },
});

cases.push({
  name: "none for you yet, with no ticket of yours at all: a dashed seal and the words; the stub opens on Mo’s code, not yours, in vermilion; past it the slot goes",
  async run({ page }) {
    const backend = await ready(page, { nowMs: at("2026-12-13T12:00:00"), only: [SNOW] });
    await kept(page, [SNOW]);
    await waitSlot(page);
    const none = await slot(page);
    assert.deepEqual(
      [none.whose, none.warn, none.label, none.title, none.line, none.aria],
      ["none", "", "つぎの切符 Next ticket", "Snow park lift pass", "Mon Dec 14 · 09:30 · none for you yet", "Show ticket: Snow park lift pass, Mon Dec 14 09:30, no code for you yet"],
    );
    assert.ok(none.seal.includes("is-none"), "the empty dashed seal");
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#nextTicket .wh-s")).borderTopStyle), "dashed");
    await page.click("#ntBtn");
    await stubUp(page);
    const head = await page.evaluate(() => {
      const pg = document.querySelector("#tix .pp-pg");
      const small = pg.querySelector(".wh-head small");
      const st = getComputedStyle(small);
      return { who: pg.dataset.who, words: small.textContent, colour: st.color, weight: st.fontWeight, size: parseFloat(st.fontSize), img: pg.querySelector(".wh-head .wh-s img").getAttribute("src") };
    });
    assert.deepEqual({ who: head.who, words: head.words, colour: head.colour, weight: head.weight }, { who: "Mo", words: "Mo’s code, not yours", colour: "rgb(184, 50, 24)", weight: "900" });
    assert.ok(head.size >= 12, "12 px or more");
    assert.equal(head.img, backend.photos.Mo, "Mo’s own picture by his name");
    await torn(page);
    await shot(page, "stub-none-for-you.jpg");
    await closeStub(page);
    // Dec 14, 10:31: the lift pass is used; no ticket is left.
    await advance(page, backend, (22 * 60 + 31) * 60 * 1000);
    await until(() => page.evaluate(() => document.getElementById("nextTicket").hidden), "after the last ticket the slot is gone");
    assert.equal(await page.evaluate(() => document.getElementById("phone").classList.contains("has-slot")), false);
  },
});

cases.push({
  name: "no seat and no time: the line ends at the time, or is the date alone; today with no time: Today",
  async run({ page, newPhone }) {
    await ready(page, { nowMs: BEFORE, only: [MEIJI] });
    await waitSlot(page);
    const s = await slot(page);
    assert.deepEqual([s.title, s.line, s.aria], ["Meiji Shrine", "Sat Dec 12 · 09:00", "Show your ticket: Meiji Shrine, Sat Dec 12 09:00"]);
    // The gloves: no time; one code for all of us, before the trip and on the day.
    const other = await newPhone();
    await ready(other, { nowMs: BEFORE, only: [GLOVES] });
    await waitSlot(other);
    const g = await slot(other);
    assert.deepEqual([g.title, g.line, g.aria], ["Buy gloves", "Sat Dec 12", "Show the ticket for all of us: Buy gloves, Sat Dec 12"]);
    const day = await newPhone();
    await ready(day, { nowMs: at("2026-12-12T10:00:00"), only: [GLOVES] });
    await waitSlot(day);
    const t = await slot(day);
    assert.deepEqual([t.title, t.tag, t.line, t.aria], ["Buy gloves", "こんど", "Today", "Show the ticket for all of us: Buy gloves, today"]);
  },
});

// Hidden: whether the slot can be seen and reached.
const reach = (page) => page.evaluate(() => {
  const n = document.getElementById("nextTicket");
  const st = getComputedStyle(n);
  return { seen: !n.hidden && st.visibility === "visible", focusable: (document.getElementById("ntBtn").focus(), document.activeElement && document.activeElement.id === "ntBtn") };
});

cases.push({
  name: "hidden on Money and Tickets, and under the stop sheet (keyboard up), the stay card, You, Ring up and the stub; back afterwards; not reachable by Tab while hidden",
  async run({ page }) {
    await ready(page);
    await kept(page, ALL_KEPT);
    await waitSlot(page);
    // Tab: the day, then the slot, then the bar.
    await page.focus("#ntBtn");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.closest("#nav") !== null), true, "after the slot, the bar");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "ntBtn");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement.closest("#vDays") !== null), true, "before the slot, the day");
    const away = async (what) => {
      await until(() => slotGone(page), "hidden: " + what);
      assert.deepEqual(await reach(page), { seen: false, focusable: false }, what + ": not seen, not reachable");
    };
    const back = async (what) => until(() => slotShown(page), "back after " + what);
    // Money and Tickets.
    await page.click('#nav [data-tab="money"]');
    await away("Money");
    await page.focus('#nav [data-tab="days"]');
    await page.keyboard.press("Shift+Tab");
    assert.notEqual(await page.evaluate(() => document.activeElement.id), "ntBtn");
    await page.click("#ticketsBtn");
    await away("Tickets");
    await page.click('#nav [data-tab="days"]');
    await back("Tickets");
    // The stop sheet, a field focused (the keyboard up).
    await openRow(page, SKY);
    await page.click('#rail .r[data-id="' + SKY + '"] .r-edit');
    await until(() => page.evaluate(() => document.getElementById("stop").classList.contains("is-open")), "the stop sheet opens");
    await page.focus("#stop input[type=text], #stop input:not([type]), #stop textarea");
    await away("the stop sheet with the keyboard up");
    await page.keyboard.press("Escape");
    await until(() => page.evaluate(() => !document.getElementById("stop").classList.contains("is-open")), "the stop sheet closes");
    await back("the stop sheet");
    // The stay card.
    await page.evaluate(() => document.querySelector('#rail .pg[data-date="2026-12-12"] .tk-stay').scrollIntoView({ block: "center" }));
    await page.click('#rail .pg[data-date="2026-12-12"] .tk-stay');
    await until(() => page.evaluate(() => document.getElementById("stay").classList.contains("is-open")), "the stay card opens");
    await away("the stay card");
    await page.keyboard.press("Escape");
    await until(() => page.evaluate(() => !document.getElementById("stay").classList.contains("is-open")), "the stay card closes");
    await back("the stay card");
    // You.
    await page.click("#youBtn");
    await until(() => page.evaluate(() => document.getElementById("you").classList.contains("is-open")), "You opens");
    await away("You");
    await page.keyboard.press("Escape");
    await until(() => page.evaluate(() => !document.getElementById("you").classList.contains("is-open")), "You closes");
    await back("You");
    // Ring up.
    await page.click("#ring");
    await until(() => page.evaluate(() => document.getElementById("phone").classList.contains("reg-open")), "the register opens");
    await away("Ring up");
    await page.keyboard.press("Escape");
    await until(() => page.evaluate(() => !document.getElementById("phone").classList.contains("reg-open")), "the register closes");
    await back("Ring up");
    // The stub.
    await page.click("#ntBtn");
    await stubUp(page);
    await away("the stub");
    await torn(page);
    await closeStub(page);
    await back("the stub");
  },
});

cases.push({
  name: "the undo line keeps its place over You and the stay card while the slot shows (at the top, its own height)",
  async run({ page }) {
    await ready(page);
    await kept(page, ALL_KEPT);
    await waitSlot(page);
    const change = async (what, n) => {
      await page.evaluate((note) => globalThis.__matTest.store.updateStop("planstop1102", { note }), "Made-up note " + n);
      await until(() => page.evaluate(() => !document.getElementById("ubar").hidden), "the undo line shows over " + what);
      await settle(page);
      const r = await page.evaluate(() => document.getElementById("ubar").getBoundingClientRect().toJSON());
      assert.ok(r.height < 80, what + ": the undo line is " + r.height + " px high");
      assert.ok(r.top < 120, what + ": the undo line stands at the top (" + r.top + ")");
    };
    await page.click("#youBtn");
    await until(() => page.evaluate(() => document.getElementById("you").classList.contains("is-open")), "You opens");
    await change("You", 1);
    await page.keyboard.press("Escape");
    await until(() => page.evaluate(() => !document.getElementById("you").classList.contains("is-open")), "You closes");
    await page.evaluate(() => document.querySelector('#rail .pg[data-date="2026-12-12"] .tk-stay').scrollIntoView({ block: "center" }));
    await page.click('#rail .pg[data-date="2026-12-12"] .tk-stay');
    await until(() => page.evaluate(() => document.getElementById("stay").classList.contains("is-open")), "the stay card opens");
    await change("the stay card", 2);
  },
});

// Nothing behind it: the last stop of a long day open and scrolled to its end,
// and today's next stop brought into view by the day itself; the undo line above it.
async function nothingBehind(page, name, picture = "") {
  await ready(page, { nowMs: at("2026-12-12T18:40:00") });
  await kept(page, ALL_KEPT);
  await waitSlot(page);
  assert.equal((await slot(page)).title, "Dinner");
  await settle(page);
  // The day scrolled itself to its next stop (Dinner, open by itself).
  await until(() => page.evaluate((i) => document.querySelector('#rail .r[data-id="' + i + '"]').classList.contains("is-open"), DINNER), "Dinner is open by itself");
  await settle(page);
  const auto = await lastButtonAndSlot(page, DINNER);
  assert.ok(auto.last <= auto.slot + 0.5, name + ": the next stop's last button (" + auto.label + ", " + auto.last + ") clears the slot (" + auto.slot + ")");
  if (picture) await shot(page, picture);
  // The last stop of the day, open, the day scrolled to its end.
  await openRow(page, GLOVES);
  await page.evaluate(() => {
    const v = document.getElementById("vDays");
    v.scrollTop = v.scrollHeight;
  });
  await settle(page);
  const end = await lastButtonAndSlot(page, GLOVES);
  assert.ok(end.last <= end.slot + 0.5, name + ": the last stop's last button (" + end.label + ", " + end.last + ") clears the slot (" + end.slot + ")");
  // The undo line stands above the slot.
  await page.evaluate(() => globalThis.__matTest.store.updateStop("planstop1102", { note: "Made-up note" }));
  await until(() => page.evaluate(() => !document.getElementById("ubar").hidden), "the undo line shows");
  await settle(page);
  const u = await page.evaluate(() => ({ bar: document.getElementById("ubar").getBoundingClientRect().bottom, slot: document.getElementById("nextTicket").getBoundingClientRect().top }));
  assert.ok(u.bar <= u.slot + 0.5, name + ": the undo line (" + u.bar + ") stands above the slot (" + u.slot + ")");
  // No sideways scroll; the slot's words end in an ellipsis rather than run off.
  const side = await page.evaluate(() => {
    const out = [...document.querySelectorAll("#nextTicket *")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 0.5).map((e) => e.className);
    return { doc: document.scrollingElement.scrollWidth <= innerWidth, out };
  });
  assert.deepEqual(side, { doc: true, out: [] });
}

cases.push({ name: "nothing behind the slot, upright at 390", async run({ page }) { await nothingBehind(page, "390"); } });
cases.push({
  name: "nothing behind the slot at 320 × 568; seal 34 px, the Japanese label only for your own; words end in an ellipsis",
  viewport: { width: 320, height: 568 },
  async run({ page, newPhone }) {
    await nothingBehind(page, "320");
    const look = (p) => p.evaluate(() => ({ seal: document.querySelector("#nextTicket .wh-s").getBoundingClientRect().width, jp: getComputedStyle(document.querySelector("#nextTicket .ntk-lj")).display, h: document.getElementById("ntBtn").getBoundingClientRect().height }));
    const g = await look(page);
    assert.deepEqual({ seal: g.seal, jp: g.jp }, { seal: 34, jp: "none" }, "Dinner is a reference: no Japanese in the label");
    assert.ok(g.h >= 44);
    // Your own ticket at 320: the Japanese label stays; nothing runs off the side.
    const mine = await newPhone();
    await ready(mine, { nowMs: BEFORE, only: [SKY] });
    await kept(mine, [SKY]);
    await waitSlot(mine);
    assert.equal((await look(mine)).jp, "inline");
    const off = await mine.evaluate(() => [...document.querySelectorAll("#nextTicket *")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 0.5).map((e) => e.className));
    assert.deepEqual(off, []);
    await shot(mine, "slot-320.jpg");
    // The warning at 320: the stop's name ends in an ellipsis, its day always shows, nothing runs off.
    const warned = await newPhone();
    await ready(warned, { nowMs: at("2026-12-13T12:00:00") });
    await kept(warned, [SNOW, KAISEKI]);
    await waitSlot(warned);
    await settle(warned);
    const wf = await warned.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const go = r("#nextTicket .ntk-go");
      const w2 = document.querySelector("#nextTicket .ntk-w2");
      const lw = document.querySelector("#nextTicket .ntk-lw");
      return {
        day: document.querySelector("#nextTicket .ntk-w3").textContent,
        dayIn: r("#nextTicket .ntk-w3").right <= go.left + 0.5 && r("#nextTicket .ntk-w3").width > 0,
        h: r("#nextTicket .ntk-l").height,
        cut: w2.scrollWidth > w2.clientWidth,
        words: (() => { const w1 = document.querySelector("#nextTicket .ntk-w1"); return w1.textContent + (w1.scrollWidth <= w1.clientWidth + 0.5 ? "" : " (cut)"); })(),
        whose: lw.textContent,
        whoseWhole: lw.scrollWidth <= lw.clientWidth + 0.5 && r("#nextTicket .ntk-lw").right <= go.left + 0.5,
      };
    });
    assert.deepEqual({ day: wf.day, dayIn: wf.dayIn, words: wf.words, whose: wf.whose, whoseWhole: wf.whoseWhole }, { day: " · Mon 14", dayIn: true, words: "No code for you at ", whose: "All of us · ", whoseWhole: true });
    assert.ok(wf.h < 20, "one line");
    await shot(warned, "slot-warn-320.jpg");
  },
});
cases.push({
  name: "nothing behind the slot held sideways (844 × 390): one line, 52 px, beside the rail",
  viewport: { width: 844, height: 390 },
  async run({ page }) {
    await nothingBehind(page, "sideways", "slot-sideways.jpg");
    const g = await page.evaluate(() => {
      const n = document.getElementById("nextTicket").getBoundingClientRect();
      const nav = document.getElementById("nav").getBoundingClientRect();
      const t = document.querySelector("#nextTicket .ntk-t").getBoundingClientRect();
      const l = document.querySelector("#nextTicket .ntk-ln").getBoundingClientRect();
      return { h: n.height, right: Math.round(nav.left - n.right), bottom: Math.round(innerHeight - n.bottom), oneLine: Math.abs(t.top - l.top) < 8 && l.left > t.left, label: getComputedStyle(document.querySelector("#nextTicket .ntk-l")).display, bh: document.getElementById("ntBtn").getBoundingClientRect().height };
    });
    assert.deepEqual({ h: g.h, right: g.right, bottom: g.bottom, oneLine: g.oneLine, label: g.label }, { h: 52, right: 0, bottom: 0, oneLine: true, label: "none" });
    assert.ok(g.bh >= 44);
  },
});
cases.push({
  name: "sideways with a warning: your ticket's title and line stay whole, the warning gives way first, its day always shows",
  viewport: { width: 844, height: 390 },
  async run({ page }) {
    await ready(page, { nowMs: at("2026-12-13T12:00:00") });
    await kept(page, [SNOW, KAISEKI]);
    await waitSlot(page);
    await settle(page);
    const w = await page.evaluate(() => {
      const q = (s) => document.querySelector("#nextTicket " + s);
      const whole = (e) => e.scrollWidth <= e.clientWidth + 0.5;
      const go = q(".ntk-go").getBoundingClientRect();
      return {
        title: q(".ntk-t").textContent, line: q(".ntk-ln").textContent, warn: q(".ntk-w").textContent,
        titleWhole: whole(q(".ntk-t")), lineWhole: whole(q(".ntk-ld")),
        warnShown: getComputedStyle(q(".ntk-l")).display !== "none", dayIn: q(".ntk-w3").getBoundingClientRect().right <= go.left + 0.5,
      };
    });
    assert.deepEqual(w, { title: "Kaiseki dinner", line: "All of us · Tue Dec 15 · 18:00", warn: "No code for you at Snow park lift pass · Mon 14", titleWhole: true, lineWhole: true, warnShown: true, dayIn: true });
    await shot(page, "slot-warn-sideways.jpg");
  },
});
cases.push({
  name: "nothing behind the slot on a computer (1280 × 800): at the foot of the Days pane, gone while Tickets stands in it",
  viewport: { width: 1280, height: 800 },
  mobile: false,
  async run({ page }) {
    await nothingBehind(page, "two panes", "slot-wide.jpg");
    const g = await page.evaluate(() => {
      const n = document.getElementById("nextTicket").getBoundingClientRect();
      const d = document.getElementById("vDays").getBoundingClientRect();
      return { h: n.height, left: Math.round(n.left - d.left), right: Math.round(d.right - n.right), bottom: Math.round(d.bottom - n.bottom) };
    });
    assert.deepEqual(g, { h: 76, left: 0, right: 0, bottom: 0 });
    await page.click("#ticketsBtn");
    await until(() => slotGone(page), "gone while Tickets stands in the Days pane");
    await page.click('#nav [data-tab="days"]');
    await waitSlot(page, "back with Days");
  },
});

async function goTickets(page) {
  await until(() => visible(page, "#ticketsBtn"), "the Tickets key is in the bar");
  await page.click("#ticketsBtn");
  await until(() => page.evaluate(() => document.getElementById("vTickets").classList.contains("is-active") && !!document.querySelector("#vTickets .pc-case")), "the pass case shows");
}
const pk = (id) => '.pc-pk[data-id="' + id + '"]';
const attr = (page, sel, name) => page.evaluate(([s, n]) => document.querySelector(s).getAttribute(n), [sel, name]);
const srcs = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => (e.querySelector("img") ? e.querySelector("img").getAttribute("src") : "text:" + e.textContent)), sel);

cases.push({
  name: "the pass case says whose: the window's holder line, the seat under the code, Show ticket's words, a whose column in every slot; the stub's seals all in colour, Mo’s picture by his name",
  async run({ page }) {
    const backend = await ready(page);
    await kept(page, ALL_KEPT);
    await goTickets(page);
    // The window: Ajen's own code.
    await expectText(page, "#pcWin .wh-name", "AJEN様Car 7 · 10B");
    assert.equal(await page.evaluate(() => document.querySelector("#pcWin .wh-name").dataset.whose), "mine");
    assert.deepEqual(await srcs(page, "#pcWin .wh-name > .wh-s"), [backend.photos.Ajen]);
    assert.deepEqual(await srcs(page, "#pcWin .wh-oth .wh-s"), [backend.photos.Mo, backend.photos.Trenton], "the other holders, in trip order, in colour");
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#pcWin .wh-oth .wh-s img")).filter), "none");
    await expectText(page, "#pcWin .pc-seat", "Car 7 · 10B");
    await expectText(page, "#pcWin .pc-st", "券3 codes · on this phone");
    await expectText(page, "#pcShow", "切符Show ticketYours · Car 7 · 10B");
    assert.equal(await attr(page, "#pcShow", "aria-label"), "Show ticket: Shibuya Sky, yours, Car 7 · 10B");
    assert.equal(await attr(page, "#pcWin .pc-tk", "aria-label"), "Show ticket: Shibuya Sky, 14:00, 3 codes, on this phone, yours, Car 7 · 10B");
    // Every slot's whose column.
    await expectText(page, pk(TEA) + " .wh-col", "全All of us");
    assert.equal(await page.evaluate((s) => !!document.querySelector(s + " .wh-col"), pk(DINNER)), false, "a reference keeps its number");
    await expectText(page, pk(DINNER) + " .pc-refno", "TEST-0412予約番号");
    await expectText(page, pk(EXPRESS) + " .wh-col", "Yours");
    await expectText(page, pk(EXPRESS) + " .pc-t", "10:08Sun 13");
    assert.deepEqual(await srcs(page, pk(EXPRESS) + " .wh-col .wh-s"), [backend.photos.Ajen]);
    await expectText(page, pk(SNOW) + " .wh-col", "None yet");
    await expectText(page, pk(SNOW) + " .pc-t", "09:30Mon 14");
    assert.equal(await page.evaluate((s) => getComputedStyle(document.querySelector(s + " .wh-col .wh-s")).borderTopStyle, pk(SNOW)), "dashed");
    assert.equal(await attr(page, pk(SNOW), "aria-label"), "Show ticket: Snow park lift pass, Mon Dec 14 09:30, 2 codes, on this phone, no code for you yet, Mo and Trenton have theirs");
    assert.equal(await attr(page, pk(TEA), "aria-label"), "Show ticket: Tea ceremony, 17:00, 1 code, on this phone, one code for all of us");
    // Used slots carry the same mark.
    await expectText(page, pk(MEIJI) + " .wh-col", "Yours");
    await expectText(page, pk(LUNCH) + " .wh-col", "全All of us");
    assert.equal(await attr(page, pk(LUNCH), "aria-label"), "Used: Lunch in Harajuku, 12:30, 2 pages, on this phone, 2 pages for all of us");
    // Every whose seal is decoration: the words are in the labels.
    assert.equal(await page.evaluate(() => [...document.querySelectorAll("#vTickets .wh-s")].every((x) => x.getAttribute("aria-hidden") === "true" && [...x.querySelectorAll("img")].every((i) => i.alt === ""))), true);
    await shot(page, "case-marks.jpg");
    // The stub: every seal in colour; yours ringed in vermilion, the others in ink.
    await page.click("#pcShow");
    await stubUp(page);
    await torn(page);
    const seals = () => page.evaluate(() => [...document.querySelectorAll("#tix .who3 .seal")].map((x) => {
      const img = x.querySelector("img");
      const st = getComputedStyle(x);
      const is = img ? getComputedStyle(img) : null;
      return { on: x.classList.contains("is-on"), filter: is ? is.filter : "", opacity: is ? is.opacity : "", ring: st.borderTopColor, w: parseFloat(st.borderTopWidth) };
    }));
    const three = await seals();
    // (A border is drawn in whole device pixels: 2.5 px shows as 2, 1.5 as 1 here.)
    assert.ok(three[0].w > three[1].w && three[1].w === three[2].w, "the one in view has the heavier ring");
    assert.deepEqual(three.map(({ w, ...x }) => x), [
      { on: true, filter: "none", opacity: "1", ring: "rgb(214, 60, 30)" },
      { on: false, filter: "none", opacity: "1", ring: "rgba(21, 18, 15, 0.45)" },
      { on: false, filter: "none", opacity: "1", ring: "rgba(21, 18, 15, 0.45)" },
    ]);
    await expectText(page, "#tix .who3", "YouMoTrenton");
    // Mo's seal: his page, his picture by his name, not yours.
    await page.click('#tix .who3 button[data-k="1"]');
    await until(() => page.evaluate(() => {
      const pp = document.querySelector("#tix [data-pp]");
      return document.querySelectorAll("#tix .who3 .seal")[1].classList.contains("is-on") && Math.abs(pp.scrollLeft - pp.clientWidth) < 2;
    }), "Mo's page is in view");
    const mo = await page.evaluate(() => {
      const pg = document.querySelector('#tix .pp-pg[data-who="Mo"]');
      return { head: pg.querySelector(".stub-who").textContent.replace(/\s+/g, " ").trim(), img: pg.querySelector(".wh-head .wh-s img").getAttribute("src"), ring: getComputedStyle(pg.querySelector(".wh-head .wh-s")).borderTopColor };
    });
    assert.deepEqual(mo, { head: "MOMo’s code, not yoursCar 7 · 10A", img: backend.photos.Mo, ring: "rgb(21, 18, 15)" });
    assert.equal((await seals())[1].ring, "rgb(214, 60, 30)", "the one in view ringed in vermilion");
    await shot(page, "stub-friend.jpg");
    await closeStub(page);
    assert.equal(await page.evaluate(() => document.activeElement.id), "pcShow");
  },
});

cases.push({
  name: "the window's holder line for all of us and for none for you yet; a person with no picture shows initials",
  async run({ page, newPhone }) {
    // 15:00: the tea ceremony, one code for all of us.
    await ready(page, { nowMs: at("2026-12-12T15:00:00") });
    await kept(page, ALL_KEPT);
    await goTickets(page);
    await expectText(page, "#pcWin .wh-name", "全ALL OF US");
    await expectText(page, "#pcShow", "切符Show ticketAll of us");
    assert.equal(await attr(page, "#pcShow", "aria-label"), "Show ticket: Tea ceremony, one code for all of us");
    // Dec 13, 12:00: the lift pass, only Mo and Trenton have codes; Trenton has no picture.
    const other = await newPhone();
    const faces3 = await faces(other);
    await ready(other, { nowMs: at("2026-12-13T12:00:00"), photos: { Mo: faces3.Mo, Ajen: faces3.Ajen } });
    await kept(other, [SNOW]);
    await goTickets(other);
    await expectText(other, "#pcWin .wh-name", "NONE FOR YOU YETTR");
    assert.deepEqual(await srcs(other, "#pcWin .wh-oth .wh-s"), [faces3.Mo, "text:TR"], "Mo’s picture, Trenton’s initials");
    await expectText(other, "#pcShow", "切符Show ticketNot yours");
    assert.equal(await attr(other, "#pcShow", "aria-label"), "Show ticket: Snow park lift pass, no code for you yet, Mo and Trenton have theirs");
    await other.click("#pcShow");
    await stubUp(other);
    await torn(other);
    assert.deepEqual(await srcs(other, "#tix .who3 .seal"), [faces3.Mo, "text:T"]);
    await expectText(other, '#tix .pp-pg[data-who="Trenton"] .wh-head', "TTRENTONTrenton’s code, not yours");
  },
});

cases.push({
  name: "Days: the 券 line and Show ticket say whose, for every kind",
  async run({ page }) {
    const backend = await ready(page, { nowMs: at("2026-12-12T15:00:00") });
    await kept(page, ALL_KEPT);
    const mark = (id) => text(page, '#rail .r[data-id="' + id + '"] .tk-mark');
    await until(async () => (await mark(GLOVES)) === "券 全All of us · needs signal once", "the gloves still need signal");
    assert.equal(await mark(MEIJI), "券 Yours · needs signal once");
    assert.equal(await mark(LUNCH), "券 全2 pages for all of us");
    assert.equal(await mark(SKY), "券 Yours · Car 7 · 10B");
    assert.equal(await mark(TEA), "券 全One code for all of us");
    assert.equal(await mark(DINNER), "券 Reference only, no file");
    assert.equal(await mark(EXPRESS), "券 Yours · Car 5 · 3B");
    assert.equal(await mark(SNOW), "券 None for you yet");
    const seal = (id) => page.evaluate((i) => {
      const x = document.querySelector('#rail .r[data-id="' + i + '"] .tk-mark .wh-s');
      return x ? { cls: x.className, img: x.querySelector("img") ? x.querySelector("img").getAttribute("src") : "", w: x.getBoundingClientRect().width, style: getComputedStyle(x).borderTopStyle } : null;
    }, id);
    const sky = await seal(SKY);
    // Your picture, from a short blob: address (never the picture's data in the day's markup).
    assert.match(sky.img, /^blob:/);
    assert.equal(sky.w, 20);
    assert.equal(await page.evaluate((i) => {
      const img = document.querySelector('#rail .r[data-id="' + i + '"] .tk-mark .wh-s img');
      return img.complete && img.naturalWidth > 0 && !document.getElementById("rail").innerHTML.includes("data:image/jpeg");
    }, SKY), true, "it draws, and no picture data is in the day");
    assert.ok(sky.cls.includes("is-me"));
    assert.equal((await seal(SNOW)).style, "dashed");
    assert.equal(await seal(DINNER), null, "a reference has no seal");
    assert.equal(await page.evaluate((i) => document.querySelector('#rail .r[data-id="' + i + '"] .tk-mark b').classList.contains("is-dash"), MEIJI), true, "the box dashed while it needs signal");
    // Show ticket's right side.
    const key = (id) => text(page, '#rail .r[data-id="' + id + '"] .r-tk i');
    assert.equal(await key(SKY), "Yours · 1 of 3");
    assert.equal(await key(TEA), "1 code");
    assert.equal(await key(LUNCH), "2 pages");
    assert.equal(await key(DINNER), "Reference");
    assert.equal(await key(SNOW), "Not yours · 2 codes");
    assert.equal(await key(EXPRESS), "Yours · 1 of 3");
    await openRow(page, SKY);
    await page.evaluate((i) => document.querySelector('#rail .r[data-id="' + i + '"]').scrollIntoView({ block: "start" }), MEIJI);
    await shot(page, "days-marks.jpg");
  },
});

cases.push({
  name: "320 × 568: the pass case with whose marks fits without sideways scroll; the holder line ends in an ellipsis rather than run off",
  viewport: { width: 320, height: 568 },
  async run({ page }) {
    await ready(page);
    await kept(page, ALL_KEPT);
    await goTickets(page);
    await settle(page);
    const r = await page.evaluate(() => {
      const v = document.getElementById("vTickets");
      const over = [...v.querySelectorAll("*")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 0.5).map((e) => e.className);
      const nm = document.querySelector("#pcWin .wh-name");
      const kids = [...nm.children].map((c) => c.getBoundingClientRect().right <= nm.getBoundingClientRect().right + 0.5);
      return { doc: document.scrollingElement.scrollWidth <= innerWidth, view: v.scrollWidth <= v.clientWidth, over, kids };
    });
    assert.deepEqual(r, { doc: true, view: true, over: [], kids: [true, true, true, true] });
    await shot(page, "case-320.jpg");
  },
});

module.exports = cases;
