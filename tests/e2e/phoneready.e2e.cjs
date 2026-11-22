// Is this phone ready for no signal (issue 84, look A: the departure board
// says it). The line at the foot of the board, the sheet "This phone", the
// board's face from two days before, the strip at the top, and the
// never-loaded screen (調整中).
//
// Rule 4 (the app opens with no signal) is "a registration with an active
// worker and a mat-shell- cache". The runner blocks workers, so helpers.cjs
// open() gives every page a stand-in by default: MAT_TEST_SHELL = true, read
// by js/views/ready.js only beside the fake backend (MAT_FAKE_API). The cases
// here that test those states pass shell: false: "no worker yet" (Setting up)
// and the two that let the real worker register (serviceWorkers: "allow").
//
// Every name, place, item and picture here is made up (tests/e2e/pictures.cjs).
// Pictures of each state go to MAT_READY_SHOTS when it is set.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { WITH_PLAN, makeBackend, open, advance, until, atRest, text, expectText, visible } = require("./helpers.cjs");
const { png } = require("./pictures.cjs");

const KEY = "test-key";
const PLANNER_ID = "fakePlannerSheet_0123456789abcdefXYZ";
const BHEAD = ["#", "Item", "Who", "Book by", "Status", "Notes", "Booking link"];
const brow = (o) => BHEAD.map((h) => (o[h] === undefined ? "" : o[h]));
const CHEAD = ["#", "Date / time", "Agent / session", "Tab", "Cell(s)", "Item", "Old value", "New value", "Why", "Proof / source", "Verified?"];
const ITEMS = [{ "#": 1, Item: "Made-up pocket wifi", "Book by": "2026-12-01", Status: "Not booked" }];
const withPlanner = (items = ITEMS) => ({ ...WITH_PLAN, plannerId: PLANNER_ID, plannerTabs: { "Book Now": [["Before we go: bookings"], BHEAD, ...items.map(brow)], "Change Log": [CHEAD] } });

// 10:00 on Sun Nov 22 in Japan: 18 days before the trip (Thu Dec 10).
const WEEKS = Date.parse("2026-11-22T10:00:00+09:00");
// 10:00 on Tue Dec 8 in Japan: two days before.
const TWO = Date.parse("2026-12-08T10:00:00+09:00");
// 10:00 on Wed Dec 9: one day before. Mon Dec 7: three days before.
const ONE = Date.parse("2026-12-09T10:00:00+09:00");
const THREE = Date.parse("2026-12-07T10:00:00+09:00");
// 13:20 on Sat Dec 12: on the trip, the next stop Shibuya Sky at 14:00.
const DAY12 = Date.parse("2026-12-12T13:20:00+09:00");
const MIN = 60000;
const GREEN = "rgb(111, 224, 138)";
const AMBER = "rgb(255, 176, 74)";
const RED = "rgb(255, 106, 77)";

const SKY = "planstop1203";
const MEIJI = "planstop1201";
const LUNCH = "planstop1202";
const SENSO = "planstop1101";
const SHIBUYA = "planstop1102";
const DINNER = "planstop1204";
const INN = "planstay0001";
const LODGE = "planstay0002";

const SHOTS = process.env.MAT_READY_SHOTS || "";
async function shot(page, name) {
  if (!SHOTS) return;
  // The board's lines have finished filling in (a CSS animation).
  await until(() => page.evaluate(() => [...document.querySelectorAll(".led-wipe")].every((n) => !n.getClientRects().length)), "the board has filled in");
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + ".jpg"), type: "jpeg", quality: 88 });
}

let n = 0;
const tid = () => "tkt" + String(++n).padStart(9, "0");
const as = (backend, action, args, actor = "Ajen") => backend.fake({ key: KEY, actor, action, args });
async function addPic(backend, where, who = "", page = 1, seed = 1) {
  const ticket = { id: tid(), ...where, who, seat: "", page, mime: "image/png", w: 120, h: 120, data: png(120, 120, seed) };
  const r = await as(backend, "addTicket", { ticket });
  assert.equal(r.ok, true, r.message);
  return r.data.ticket.id;
}
// Twelve pictures, all still ahead before the trip: Shibuya Sky's three
// codes, one each for Meiji Shrine, Senso-ji, dinner in Shibuya and dinner,
// lunch's two pages, the Asakusa hotel's two booking pages and the lodge's one.
async function twelve(backend, { later = false } = {}) {
  const ids = [];
  if (later) return [await addPic(backend, { stay: INN }, "", 2, 28), await addPic(backend, { stop: SKY }, "Trenton", 1, 13), await addPic(backend, { stay: LODGE }, "", 1, 29)];
  for (const [i, who] of ["Mo", "Ajen", "Trenton"].entries()) ids.push(await addPic(backend, { stop: SKY }, who, 1, 11 + i));
  ids.push(await addPic(backend, { stop: MEIJI }, "", 1, 21));
  ids.push(await addPic(backend, { stop: SENSO }, "", 1, 22));
  ids.push(await addPic(backend, { stop: SHIBUYA }, "", 1, 23));
  ids.push(await addPic(backend, { stop: DINNER }, "", 1, 24));
  ids.push(await addPic(backend, { stop: LUNCH }, "", 1, 25));
  ids.push(await addPic(backend, { stop: LUNCH }, "", 2, 26));
  ids.push(await addPic(backend, { stay: INN }, "", 1, 27));
  ids.push(await addPic(backend, { stay: INN }, "", 2, 28));
  ids.push(await addPic(backend, { stay: LODGE }, "", 1, 29));
  return ids;
}
// Nine of the twelve (the three twelve({ later: true }) adds are left out).
async function nine(backend) {
  for (const [i, who] of ["Mo", "Ajen"].entries()) await addPic(backend, { stop: SKY }, who, 1, 11 + i);
  await addPic(backend, { stop: MEIJI }, "", 1, 21);
  await addPic(backend, { stop: SENSO }, "", 1, 22);
  await addPic(backend, { stop: SHIBUYA }, "", 1, 23);
  await addPic(backend, { stop: DINNER }, "", 1, 24);
  await addPic(backend, { stop: LUNCH }, "", 1, 25);
  await addPic(backend, { stop: LUNCH }, "", 2, 26);
  await addPic(backend, { stay: INN }, "", 1, 27);
}

// A backend at `nowMs`, its planner list pulled (so "Book next" shows before the trip).
async function backendAt(nowMs, { planner = true } = {}) {
  const backend = makeBackend(planner ? withPlanner() : WITH_PLAN, { now: nowMs });
  if (planner) {
    backend.now = nowMs - 5 * MIN;
    assert.equal((await as(backend, "syncTodos", {}, "Mo")).ok, true);
    backend.now = nowMs;
  }
  return backend;
}

// The ticket reads held back until released: hold(backend) -> { release(), asked }.
function hold(backend, { refuse = () => false } = {}) {
  const real = backend.handle;
  let open = null;
  const gate = new Promise((r) => (open = r));
  const asked = [];
  backend.handle = async (body) => {
    if (body.action === "ticket") {
      asked.push(body.args.id);
      await gate;
      if (refuse(body.args.id)) return { ok: false, error: "notFound", message: "test" };
    }
    return real(body);
  };
  return { release: () => open(), asked, restore: () => (backend.handle = real) };
}

// Every kind the line has said since the page started, in order (window.__kinds).
const recordKinds = (page) =>
  page.addInitScript(() => {
    window.__kinds = [];
    new MutationObserver(() => {
      const l = document.querySelector("#vDays .rdy");
      const k = l && !l.hidden ? l.dataset.kind : null;
      if (k && window.__kinds[window.__kinds.length - 1] !== k) window.__kinds.push(k);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-kind", "hidden"] });
  });
const kinds = (page) => page.evaluate(() => window.__kinds.slice());

// Opens Days; shell: the stand-in for the offline shell (see the head of this file), false for the real answer.
async function openDays(page, { backend, nowMs, storage = {}, shell = true }) {
  await open(page, { backend, nowMs, tab: "days", storage, shell });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
}

const lineKind = (page) => page.evaluate(() => {
  const l = document.querySelector("#vDays .rdy");
  return l && !l.hidden ? l.dataset.kind : null;
});
const waitKind = (page, kind, timeout = 10000) => until(async () => (await lineKind(page)) === kind, "the line says " + kind + " (it says " + "…)", timeout).catch(async (e) => {
  throw new Error("the line says " + (await lineKind(page)) + ", not " + kind);
});
const lineText = (page) => text(page, "#vDays .rdy .rdy-w");
const colorOf = (page, sel) => page.evaluate((s) => {
  const n = document.querySelector(s);
  return n ? getComputedStyle(n).color : null;
}, sel);
const height = (page, sel) => page.evaluate((s) => {
  const n = document.querySelector(s);
  return n ? Math.round(n.getBoundingClientRect().height) : null;
}, sel);

// The sheet has come to rest, up or down (the shared atRest helper).
const sheetAtRest = (page, up = true) => atRest(page, "#rdy", { open: up });
const sheetRows = (page) => page.evaluate(() => [...document.querySelectorAll("#rdy .rdy-rows > *")].map((r) => r.innerText.replace(/\s+/g, " ").trim()));

// Nine pictures kept, then the phone set to "Only when I open one" and three more added by another phone.
async function nineThenThree(page, nowMs) {
  const backend = await backendAt(nowMs);
  await nine(backend);
  await openDays(page, { backend, nowMs });
  await waitKind(page, "ready");
  assert.equal(await text(page, "#vDays .rdy .rdy-r"), "trip · all 9 tickets");
  await page.evaluate(() => localStorage.setItem("mat.tixFetch", "open"));
  await twelve(backend, { later: true });
  await page.evaluate(() => globalThis.__matTest.store.checkRev());
  await waitKind(page, "missing");
  return backend;
}

// The backend refuses the ticket reads of `ids` (the picture was removed, or comes back broken) until restored.
function refuse(backend, ids) {
  const real = backend.handle;
  backend.handle = async (body) => (body.action === "ticket" && ids.includes(body.args.id) ? { ok: false, error: "notFound", message: "test" } : real(body));
  return () => (backend.handle = real);
}
// No signal: every call fails as if the network were gone, and the store finds out.
async function noSignal(page, backend) {
  backend.failWith = "network";
  await page.evaluate(() => globalThis.__matTest.store.checkRev().catch(() => {}));
  await until(() => page.evaluate(() => globalThis.__matTest.store.state.online === false), "the phone knows it has no signal");
}
// WCAG contrast of two "rgb(r, g, b)" colours.
function contrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = c.match(/\d+/g).slice(0, 3).map((v) => {
      const x = Number(v) / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const noSideways = (page) => page.evaluate(() => {
  const over = [...document.querySelectorAll("#vDays .rdy, #vDays .rdy *, #vDays .brd, #net, #net *")].filter((n) => n.getClientRects().length && n.getBoundingClientRect().right > innerWidth + 0.5);
  return document.scrollingElement.scrollWidth <= innerWidth && document.getElementById("vDays").scrollWidth <= document.getElementById("vDays").clientWidth + 0.5 && over.length === 0;
});
// What a tap 20 px above and below the middle of `sel` lands on is still `sel` (44 px to touch).
const touch44 = (page, sel) => page.evaluate((s) => {
  const n = document.querySelector(s);
  const r = n.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  return [y - 20, y + 20].every((yy) => {
    const hit = document.elementFromPoint(x, yy);
    return !!hit && (hit === n || n.contains(hit));
  });
}, sel);
const boardLines = (page) => page.evaluate(() => {
  const q = (s) => {
    const n = document.querySelector("#vDays .brd " + s);
    return n && !n.hidden ? n.textContent : null;
  };
  return { small: q(".led-big small"), big: q(".led-big b"), l1: q(".led-1"), l2: q(".led-2") };
});

module.exports = [
  {
    name: "every picture kept: the green line at the board's foot, no strip; the sheet opens, reads right, closes, focus back",
    async run({ page }) {
      const backend = await backendAt(WEEKS);
      await twelve(backend);
      await recordKinds(page);
      await openDays(page, { backend, nowMs: WEEKS });
      await waitKind(page, "ready");
      // A reload, every picture kept: nothing until IndexedDB has answered, then green (no amber flash, no jump).
      await page.evaluate(() => (window.__kinds.length = 0));
      await page.reload();
      await waitKind(page, "ready");
      assert.deepEqual(await kinds(page), ["ready"], "nothing said before IndexedDB answered");
      assert.equal(await text(page, "#vDays .rdy .rdy-jp"), "圏外OK");
      assert.equal(await text(page, "#vDays .rdy .rdy-t"), "Ready for no signal");
      assert.equal(await text(page, "#vDays .rdy .rdy-r"), "trip · all 12 tickets");
      assert.equal(await colorOf(page, "#vDays .rdy"), GREEN);
      assert.equal(await height(page, "#vDays .rdy"), 30);
      assert.equal(await visible(page, "#vDays .brd"), true, "the board shows Book next above it");
      assert.equal(await page.evaluate(() => document.querySelector("#vDays .brd").classList.contains("has-foot")), true);
      assert.equal(await visible(page, "#rdyKey"), false, "no key when ready");
      assert.equal(await visible(page, "#net"), false, "no strip");
      assert.equal(await page.getAttribute("#rdyWords", "aria-label"), "Ready for no signal. The trip and all 12 tickets are on this phone, in Safari. Details");
      await shot(page, "line-ready");

      await page.focus("#rdyWords");
      await page.keyboard.press("Enter");
      await sheetAtRest(page);
      assert.equal(await page.evaluate(() => document.activeElement.id), "rdyDone");
      assert.equal(await page.evaluate(() => document.getElementById("phone").classList.contains("rdy-open")), true);
      assert.equal(await text(page, "#rdy .sheet-top span"), "端末This phone");
      assert.equal(await text(page, "#rdyVerdict"), "Ready for no signal.");
      assert.deepEqual(await sheetRows(page), [
        "The trip on this phone",
        "Tickets all 12 pictures on this phone",
        "Here in Safari. Safari can clear a site it has not seen for a week, so open MAT now and then. The Home Screen app keeps its own copy: open it once with signal too.",
      ]);
      assert.equal(await visible(page, "#rdyGo"), false, "no key when ready");
      await shot(page, "sheet-ready");
      await page.keyboard.press("Escape");
      await sheetAtRest(page, false);
      assert.equal(await page.evaluate(() => document.activeElement.id), "rdyWords", "focus back on the words");
      // The scrim closes it too.
      await page.click("#rdyWords");
      await sheetAtRest(page);
      await page.mouse.click(200, 40);
      await sheetAtRest(page, false);
      assert.equal(await page.evaluate(() => document.getElementById("phone").classList.contains("rdy-open")), false);
    },
  },
  {
    name: "three pictures missing: the sheet lists them, says the setting and has the key",
    async run({ page }) {
      await nineThenThree(page, WEEKS);
      assert.equal(await text(page, "#vDays .rdy .rdy-t"), "3 pictures not on this phone yet");
      await shot(page, "line-missing");
      await page.click("#rdyWords");
      await sheetAtRest(page);
      assert.equal(await text(page, "#rdyVerdict"), "Not ready for no signal yet.");
      assert.deepEqual(await sheetRows(page), [
        "The trip on this phone",
        "Tickets Thu Dec 10 · Asakusa hotel, booking Sat Dec 12 · Shibuya Sky Sun Dec 13 · Niseko lodge, booking 9 of 12 pictures on this phone",
        "Here in Safari. Safari can clear a site it has not seen for a week, so open MAT now and then. The Home Screen app keeps its own copy: open it once with signal too.",
        "Ticket pictures are set to “Only when I open one”. Change it in You, Ticket pictures.",
      ]);
      assert.equal(await text(page, "#rdyGo"), "取込Fetch now");
      await shot(page, "sheet-missing");
      // The key in the sheet fetches; the sheet redraws while open.
      await page.click("#rdyGo");
      await until(async () => (await text(page, "#rdyVerdict")) === "Ready for no signal.", "the sheet says ready");
      assert.equal(await visible(page, "#rdyGo"), false);
      await page.click("#rdyDone");
      await sheetAtRest(page, false);
      await waitKind(page, "ready");
    },
  },
  {
    name: "“Only when I open one”: amber with the count, nothing fetches by itself; Fetch now brings them all; the You row still says the setting",
    async run({ page }) {
      const backend = await backendAt(WEEKS);
      await twelve(backend);
      await openDays(page, { backend, nowMs: WEEKS, storage: { "mat.tixFetch": "open" } });
      await waitKind(page, "missing");
      assert.equal(await text(page, "#vDays .rdy .rdy-t"), "12 pictures not on this phone yet");
      assert.equal(await colorOf(page, "#vDays .rdy"), AMBER);
      assert.equal(await height(page, "#vDays .rdy"), 44);
      assert.equal(await text(page, "#rdyKey"), "取込Fetch now");
      assert.equal(await page.getAttribute("#rdyKey", "aria-label"), "Fetch 12 ticket pictures now");
      await advance(page, backend, 2 * MIN);
      assert.equal(backend.requests.filter((b) => b.action === "ticket").length, 0, "nothing fetched by itself");

      // Three of them reach this phone by being opened (the stub fetches its own): here, by Fetch now with the rest held.
      const h = hold(backend);
      await page.click("#rdyKey");
      await waitKind(page, "fetching");
      assert.equal(await text(page, "#vDays .rdy .rdy-t"), "Fetching 1 of 12");
      assert.equal(await text(page, "#vDays .rdy .rdy-r"), "Keep MAT open");
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "rdyWords", "the key goes while it fetches: focus moves to the words, not to the page");
      await shot(page, "line-fetching");
      h.release();
      h.restore();
      await waitKind(page, "ready");
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.tixFetch")), "open", "the setting is not changed");
      await page.click("#youBtn");
      await expectText(page, "#setTixV", /Only when I open one/);
    },
  },
  {
    name: "two days before, not ready: the board's face with the red line and no ×, a board closed today is back, the paper key fetches; then Book next and the green foot",
    async run({ page }) {
      const backend = await backendAt(TWO);
      await nine(backend);
      await twelve(backend, { later: true });
      // A fresh phone set to "Only when I open one": all twelve missing; the board was closed earlier today.
      await openDays(page, { backend, nowMs: TWO, storage: { "mat.tixFetch": "open", "mat.board": "2026-12-08" } });
      await until(async () => (await boardLines(page)).l1 === "12 pictures not on this phone", "the board's face");
      assert.deepEqual(await boardLines(page), { small: "出発まで", big: "2日", l1: "12 pictures not on this phone", l2: "Set to “Only when I open one”" });
      assert.equal(await colorOf(page, "#vDays .brd .led-2"), RED);
      assert.ok(contrast(RED, "rgb(9, 8, 7)") >= 4.5, "the red line passes 4.5:1 on the board's black: " + contrast(RED, "rgb(9, 8, 7)").toFixed(2));
      assert.equal(await visible(page, "#vDays .brd-x"), false, "no ×");
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.board")), "2026-12-08", "nothing written to mat.board");
      assert.equal(await text(page, "#vDays .rdy .rdy-note"), "Each needs signal once. Fetch them now, on Wi‑Fi, and this phone works with no signal.");
      assert.equal(await text(page, "#rdyBigKey"), "取込Fetch all 12 now");
      assert.equal(await height(page, "#rdyBigKey"), 48);
      assert.equal(await visible(page, "#rdyWords"), false, "the tall foot in place of the small line");
      await shot(page, "two-days");
      // The sentence under the glass opens the sheet (fix round I4); Done gives focus back to it.
      assert.equal(await page.getAttribute("#rdyNote", "aria-label"), "Each needs signal once. Fetch them now, on Wi‑Fi, and this phone works with no signal. Details");
      await page.click("#rdyNote");
      await sheetAtRest(page);
      assert.equal(await text(page, "#rdyVerdict"), "Not ready for no signal yet.");
      assert.equal(await text(page, "#rdyGo"), "取込Fetch all 12 now");
      await page.click("#rdyDone");
      await sheetAtRest(page, false);
      assert.equal(await page.evaluate(() => document.activeElement.id), "rdyNote");

      const h = hold(backend);
      await page.click("#rdyBigKey");
      await until(async () => (await boardLines(page)).l1 === "Fetching 1 of 12", "the board says it is fetching");
      assert.equal((await boardLines(page)).l2, "Keep MAT open");
      assert.equal(await text(page, "#rdyBigKey"), "取込Fetching 1 of 12");
      assert.equal(await page.getAttribute("#rdyBigKey", "aria-disabled"), "true");
      assert.equal(await page.evaluate(() => document.activeElement.id), "rdyBigKey", "focus stays on the key");
      await shot(page, "two-days-fetching");
      // A second tap while it runs does nothing (dispatched: Playwright will not click an aria-disabled button).
      const askedBefore = h.asked.length;
      await page.dispatchEvent("#rdyBigKey", "click");
      assert.equal(h.asked.length, askedBefore, "no second pass");
      assert.equal((await boardLines(page)).l1, "Fetching 1 of 12");
      h.release();
      h.restore();
      await waitKind(page, "ready");
      assert.equal(await page.evaluate(() => document.querySelector("#rdySay").textContent), "Ready for no signal");
      // The board was closed today: it goes again, and the line stands alone.
      await until(async () => !(await visible(page, "#vDays .brd")), "the board closed for today again");
      assert.equal(await page.evaluate(() => document.querySelector("#vDays .rdy").classList.contains("is-alone")), true);
      // Not closed: Book next is back, with the green line at its foot.
      await page.evaluate(() => localStorage.removeItem("mat.board"));
      await page.evaluate(() => globalThis.__matTest.store.checkRev());
      await advance(page, backend, MIN);
      await until(async () => (await boardLines(page)).l1 === "Book next: Made-up pocket wifi", "Book next is back");
      assert.equal(await visible(page, "#vDays .brd-x"), true, "the × is back with it");
      assert.equal(await colorOf(page, "#vDays .brd .led-2"), GREEN);
      assert.equal(await page.evaluate(() => document.querySelector("#vDays .brd").classList.contains("has-foot")), true);
    },
  },
  {
    name: "three days before, not ready: the small amber line only, Book next keeps the board",
    async run({ page }) {
      const backend = await backendAt(THREE);
      await twelve(backend);
      await openDays(page, { backend, nowMs: THREE, storage: { "mat.tixFetch": "open" } });
      await waitKind(page, "missing");
      assert.equal((await boardLines(page)).l1, "Book next: Made-up pocket wifi");
      assert.equal(await visible(page, "#rdyBigKey"), false);
      assert.equal(await visible(page, "#vDays .brd-x"), true);
      assert.equal(await visible(page, "#net"), false, "no strip earlier than two days before");
    },
  },
  {
    name: "one picture missing, the fetch held back: amber, 1 picture is not on this phone yet, the key; tap: Fetching 1 of 1, then green",
    async run({ page }) {
      const backend = await backendAt(WEEKS);
      await nine(backend);
      await openDays(page, { backend, nowMs: WEEKS });
      await waitKind(page, "ready");
      // Another phone adds one; this phone only fetches when one is opened, so it waits for the key.
      await page.evaluate(() => localStorage.setItem("mat.tixFetch", "open"));
      await addPic(backend, { stay: LODGE }, "", 1, 29);
      await page.evaluate(() => globalThis.__matTest.store.checkRev());
      await waitKind(page, "missing");
      assert.equal(await text(page, "#vDays .rdy .rdy-t"), "1 picture is not on this phone yet");
      assert.equal(await text(page, "#rdyKey"), "取込Fetch now");
      assert.equal(await page.getAttribute("#rdyWords", "aria-label"), "1 ticket picture is not on this phone yet. Details");
      const h = hold(backend);
      await page.click("#rdyKey");
      await waitKind(page, "fetching");
      assert.equal(await text(page, "#vDays .rdy .rdy-t"), "Fetching 1 of 1");
      assert.equal(await page.evaluate(() => document.querySelector("#rdySay").textContent), "Fetching 1 ticket picture");
      h.release();
      h.restore();
      await waitKind(page, "ready");
      assert.equal(await text(page, "#vDays .rdy .rdy-r"), "trip · all 10 tickets");
      assert.equal(await page.evaluate(() => document.querySelector("#rdySay").textContent), "Ready for no signal");
    },
  },
  {
    name: "the background pass meets a refused picture: could not be fetched, with Try again",
    async run({ page }) {
      const backend = await backendAt(WEEKS);
      const ids = await twelve(backend);
      const back = refuse(backend, [ids[11]]);
      await openDays(page, { backend, nowMs: WEEKS });
      await waitKind(page, "failed");
      assert.equal(await text(page, "#vDays .rdy .rdy-t"), "1 picture could not be fetched");
      assert.equal(await text(page, "#rdyKey"), "取込Try again");
      assert.equal(await page.getAttribute("#rdyKey", "aria-label"), "Try again: fetch 1 ticket picture");
      await shot(page, "line-failed");
      // The 20-second store check: the refused one is backing off, nothing is asked, and the line, its focus and the strip stay as they are.
      await page.focus("#rdyKey");
      await page.evaluate(() => {
        window.__kinds = [document.querySelector("#vDays .rdy").dataset.kind];
        window.__say = 0;
        new MutationObserver(() => {
          const k = document.querySelector("#vDays .rdy").dataset.kind;
          if (window.__kinds[window.__kinds.length - 1] !== k) window.__kinds.push(k);
        }).observe(document.querySelector("#vDays .rdy"), { attributes: true, attributeFilter: ["data-kind"] });
        new MutationObserver(() => window.__say++).observe(document.getElementById("rdySay"), { childList: true, characterData: true, subtree: true });
      });
      const asked = backend.requests.filter((b) => b.action === "ticket").length;
      for (let i = 0; i < 3; i++) await advance(page, backend, 20000);
      await page.evaluate(() => globalThis.__matTest.store.checkRev());
      await advance(page, backend, 100);
      assert.equal(backend.requests.filter((b) => b.action === "ticket").length, asked, "nothing asked while it backs off");
      assert.deepEqual(await kinds(page), ["failed"], "no fetching and back");
      assert.equal(await page.evaluate(() => window.__say), 0, "nothing said again");
      assert.equal(await page.evaluate(() => document.activeElement.id), "rdyKey", "focus stays on Try again");
      back();
      await page.click("#rdyKey");
      await waitKind(page, "ready");
    },
  },
  {
    name: "Fetch now meets a refused picture: could not be fetched; refused again it stays so; Try again works once it answers",
    async run({ page }) {
      const backend = await backendAt(WEEKS);
      const ids = await twelve(backend);
      await openDays(page, { backend, nowMs: WEEKS, storage: { "mat.tixFetch": "open" } });
      await waitKind(page, "missing");
      // Eleven reach the phone; the twelfth is refused.
      const back = refuse(backend, [ids[0]]);
      await page.click("#rdyKey");
      await waitKind(page, "failed");
      assert.equal(await text(page, "#vDays .rdy .rdy-t"), "1 picture could not be fetched");
      assert.equal(await page.evaluate(() => document.querySelector("#rdySay").textContent), "1 picture could not be fetched");
      // Refused again: still failed, no toast, no alert.
      await page.click("#rdyKey");
      await until(async () => (await lineKind(page)) === "failed" && !(await page.evaluate(() => document.querySelector("#rdy.is-open"))), "failed again");
      back();
      await page.click("#rdyKey");
      await waitKind(page, "ready");
    },
  },
  {
    name: "no signal, ready: the green strip on Days and on Money, no red ring; no signal with pictures missing: the red-ring sentence",
    async run({ page }) {
      const backend = await backendAt(DAY12, { planner: false });
      const ids = await twelve(backend);
      await openDays(page, { backend, nowMs: DAY12 });
      await waitKind(page, "ready");
      await noSignal(page, backend);
      await waitKind(page, "ready-off");
      assert.equal(await text(page, "#vDays .rdy .rdy-w"), "圏外No signal · everything is on this phone");
      await expectText(page, "#net", "圏外No signal · everything is on this phone");
      assert.equal(await page.evaluate(() => document.getElementById("net").classList.contains("is-led")), true);
      const ring = await page.evaluate(() => {
        const b = getComputedStyle(document.getElementById("net"), "::before");
        return { border: b.borderTopWidth, bg: b.backgroundColor };
      });
      assert.deepEqual(ring, { border: "0px", bg: GREEN }, "a green lamp, not the red ring");
      await shot(page, "nosignal-ready-strip");
      await page.click('#nav button[data-tab="money"]');
      await expectText(page, "#net", "圏外No signal · everything is on this phone");
      await page.click('#nav button[data-tab="days"]');

      // Signal back; another phone adds three pictures; this phone is set to fetch only when one is opened... then no signal.
      backend.failWith = null;
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await until(() => page.evaluate(() => globalThis.__matTest.store.state.online !== false), "signal is back");
      await page.evaluate(() => localStorage.setItem("mat.tixFetch", "open"));
      await addPic(backend, { stop: SKY }, "Mo", 2, 41);
      await addPic(backend, { stop: SKY }, "Ajen", 2, 42);
      await addPic(backend, { stop: DINNER }, "", 2, 43);
      await page.evaluate(() => globalThis.__matTest.store.checkRev());
      await waitKind(page, "missing");
      await noSignal(page, backend);
      await waitKind(page, "wait");
      await expectText(page, "#net", "No signal. 3 ticket pictures are not on this phone.");
      assert.equal(await page.evaluate(() => document.getElementById("net").classList.contains("is-led")), false, "the red ring as today");
      assert.equal(await text(page, "#vDays .rdy .rdy-t"), "3 pictures need signal once");
      assert.equal(await visible(page, "#rdyKey"), false, "no key with no signal");
      await page.evaluate(() => localStorage.setItem("mat.tixFetch", "all"));
      await advance(page, backend, MIN); // the line reads everything again each minute
      await until(async () => (await text(page, "#vDays .rdy .rdy-t")) === "3 pictures come when signal is back", "mode all says they come by themselves");
      await page.evaluate(() => document.getElementById("vDays").scrollTo(0, 0));
      await shot(page, "nosignal-missing-strip");
      void ids;
    },
  },
  {
    name: "on the trip, signal, one missing: the day scrolled to its next stop shows the amber strip with its key; back at the top it goes",
    async run({ page }) {
      const backend = await backendAt(DAY12, { planner: false });
      const ids = await twelve(backend);
      const back = refuse(backend, [ids[0]]);
      await openDays(page, { backend, nowMs: DAY12 });
      await waitKind(page, "failed");
      await page.evaluate(() => document.getElementById("vDays").scrollTo(0, 0));
      // The observer reports at the next frame and its answer is held 300 ms on the page's paused clock: move it on until it settles.
      await until(async () => {
        await advance(page, backend, 400);
        return !(await visible(page, "#net"));
      }, "the line is in sight: no strip", 4000);
      await page.evaluate(() => document.getElementById("vDays").scrollTo(0, 700));
      await until(() => page.evaluate(() => document.querySelector("#vDays .rdy").getBoundingClientRect().bottom < 0), "the line is scrolled away");
      // The observer reports at the next frame, and its answer is held 300 ms (a timer, on the page's paused clock).
      await until(async () => {
        await advance(page, backend, 400);
        return page.evaluate(() => document.getElementById("net").classList.contains("is-amber") && !document.getElementById("net").hidden);
      }, "the amber strip comes", 4000);
      assert.equal(await text(page, "#netWords"), "1 picture could not be fetched");
      assert.equal(await text(page, "#netKey"), "取込Try again");
      assert.equal(await colorOf(page, "#net"), AMBER);
      await shot(page, "trip-strip-amber");
      // Its words open the sheet; Done gives focus back to them.
      await page.click("#netWords");
      await sheetAtRest(page);
      assert.equal(await text(page, "#rdyVerdict"), "Not ready for no signal yet.");
      await page.click("#rdyDone");
      await sheetAtRest(page, false);
      assert.equal(await page.evaluate(() => document.activeElement.id), "netWords");
      // On another screen the strip stays.
      await page.evaluate(() => document.getElementById("vDays").scrollTo(0, 0));
      await until(() => page.evaluate(() => document.querySelector("#vDays .rdy").getBoundingClientRect().top > 44), "the line is back in sight");
      await until(async () => {
        await advance(page, backend, 400);
        return !(await visible(page, "#net"));
      }, "back at the top: the strip goes", 4000);
      await page.click('#nav button[data-tab="money"]');
      await until(async () => {
        await advance(page, backend, 400);
        return visible(page, "#netWords");
      }, "on Money the strip says it", 4000);
      back();
      await page.click("#netKey");
      await until(async () => !(await visible(page, "#net")), "fetched: the strip goes");
      await page.click('#nav button[data-tab="days"]');
      await waitKind(page, "ready");
    },
  },
  {
    name: "the × closes the board's lines and leaves the line, alone in the glass",
    async run({ page }) {
      const backend = await backendAt(WEEKS);
      await twelve(backend);
      await openDays(page, { backend, nowMs: WEEKS });
      await waitKind(page, "ready");
      await page.click("#vDays .brd-x");
      await until(async () => !(await visible(page, "#vDays .brd")), "the board folds away");
      assert.equal(await visible(page, "#vDays .rdy"), true);
      assert.equal(await page.evaluate(() => document.querySelector("#vDays .rdy").classList.contains("is-alone")), true);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#vDays .rdy")).borderTopLeftRadius), "6px");
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.board")), "2026-11-22");
      await shot(page, "line-alone");
    },
  },
  {
    name: "no worker yet: Setting up for no signal, A moment",
    async run({ page }) {
      const backend = await backendAt(WEEKS);
      await twelve(backend);
      await openDays(page, { backend, nowMs: WEEKS, shell: false });
      await waitKind(page, "setup");
      assert.equal(await text(page, "#vDays .rdy .rdy-w"), "Setting up for no signal A moment".replace(" A", "A"));
    },
  },
  {
    name: "a first visit with the real worker: the line turns green once the worker takes the page",
    serviceWorkers: "allow",
    async run({ page }) {
      const backend = await backendAt(WEEKS);
      await twelve(backend);
      await openDays(page, { backend, nowMs: WEEKS, shell: false });
      await until(() => page.evaluate(() => !!navigator.serviceWorker.controller), "the worker takes the page", 20000);
      await waitKind(page, "ready");
    },
  },
  {
    name: "Forget this phone, then a pasted link: green only once the worker is back and its offline copy kept again (fix round C1)",
    serviceWorkers: "allow",
    async run({ page }) {
      const backend = await backendAt(WEEKS);
      await twelve(backend);
      await openDays(page, { backend, nowMs: WEEKS, shell: false });
      await until(() => page.evaluate(() => !!navigator.serviceWorker.controller), "the worker takes the page", 20000);
      await waitKind(page, "ready");
      await page.click("#youBtn");
      await atRest(page, "#you");
      await page.dispatchEvent("#setForget", "click");
      await page.dispatchEvent("#setForget", "click");
      await until(() => visible(page, "#gateGlass"), "the never-loaded screen", 10000);
      await atRest(page, "#you", { open: false, message: "Settings closed" });
      assert.deepEqual(await page.evaluate(async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).length, shell: (await caches.keys()).some((n) => n.startsWith("mat-shell-")) })), { regs: 0, shell: false });
      // From the paste on: each time the line turns green, look at once whether the worker and its offline copy are really there.
      await page.evaluate(() => {
        window.__greens = [];
        const l = document.querySelector("#vDays .rdy");
        let was = null;
        new MutationObserver(async () => {
          const k = !l.hidden ? l.dataset.kind : null;
          if (k === was) return;
          was = k;
          if (k !== "ready") return;
          const regs = await navigator.serviceWorker.getRegistrations();
          const shell = (await caches.keys()).some((n) => n.startsWith("mat-shell-"));
          window.__greens.push({ active: regs.length === 1 && !!regs[0].active, shell });
        }).observe(l, { attributes: true, attributeFilter: ["data-kind", "hidden"] });
      });
      await page.fill("#keyPaste", "http://localhost:" + process.env.MAT_PORT + "/#k=" + KEY);
      await page.click("#keyGo");
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the trip is back", 10000);
      assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true, "the page keeps its old controller all along: not proof of anything");
      await waitKind(page, "ready", 20000);
      await until(() => page.evaluate(() => window.__greens.length > 0), "the look at green has answered");
      assert.deepEqual(await page.evaluate(() => window.__greens), [{ active: true, shell: true }], "green only once the worker is back and its offline copy is kept again");
    },
  },
  {
    name: "never loaded, the Home Screen app: the board's glass reads 調整中 over the paper",
    async run({ page }) {
      await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));
      await open(page, { nowMs: WEEKS, key: null });
      await until(() => visible(page, "#gateGlass"), "the glass shows");
      assert.equal(await text(page, "#gateGlass"), "調整中Not set up yetNeeds your link and signal, once");
      assert.equal(await page.getAttribute("#gateGlass b", "aria-hidden"), "true");
      assert.equal(await text(page, "#gate p"), "Nothing of the trip is in this app yet. The Home Screen app keeps its own copy, apart from Safari. Find the email with your own MAT link, press and hold the link, tap Copy Link, then paste it here.");
      assert.equal(await text(page, "#gateNote"), "With signal it fetches the trip and every ticket picture, once.");
      assert.equal(await page.evaluate(() => document.body.innerText.includes("opens by itself")), false);
      assert.equal(await height(page, "#gateGlass"), 60);
      await shot(page, "gate-home");
    },
  },
  {
    name: "never loaded, Safari: the glass and Safari's paper; a refused key has no glass",
    async run({ page }) {
      const backend = await open(page, { nowMs: WEEKS, key: null });
      await until(() => visible(page, "#gateGlass"), "the glass shows");
      assert.equal(await text(page, "#gate p"), "Nothing of the trip is on this phone yet. Open your MAT link from your email again, or paste it here.");
      await shot(page, "gate-safari");
      await page.fill("#keyPaste", "wrong-key-0000");
      await page.click("#keyGo");
      await expectText(page, "#gate p", "That trip link didn’t work. Ask Mo for the current one.");
      assert.equal(await visible(page, "#gateGlass"), false);
      assert.equal(await visible(page, "#gateNote"), false);
      void backend;
    },
  },
  {
    name: "320 px: the words wrap to two rows without the Japanese mark, the key is 44 px to touch, nothing off the side",
    viewport: { width: 320, height: 568 },
    async run({ page }) {
      const backend = await backendAt(WEEKS);
      await twelve(backend);
      await openDays(page, { backend, nowMs: WEEKS, storage: { "mat.tixFetch": "open" } });
      await waitKind(page, "missing");
      assert.equal(await visible(page, "#vDays .rdy .rdy-jp"), false);
      assert.ok(await noSideways(page), "nothing off the side");
      assert.ok(await touch44(page, "#rdyKey"), "the key is 44 px to touch");
      await shot(page, "line-320");
    },
  },
  {
    name: "320 px, two days before: the board's face and the paper key fit",
    viewport: { width: 320, height: 568 },
    async run({ page }) {
      const backend = await backendAt(TWO);
      await twelve(backend);
      await openDays(page, { backend, nowMs: TWO, storage: { "mat.tixFetch": "open" } });
      await until(async () => (await boardLines(page)).l1 === "12 pictures not on this phone", "the board's face");
      assert.ok(await noSideways(page), "nothing off the side");
      await shot(page, "two-days-320");
      // Green at 320: one row, the mark left out, the green row 44 px to touch above and below.
      await page.click("#rdyBigKey");
      await waitKind(page, "ready");
      assert.ok(await noSideways(page));
      assert.ok(await touch44(page, "#rdyWords"), "the green words are 44 px to touch");
    },
  },
  {
    name: "sideways: the amber line stays one row, 30 px, the key 30 px high and 44 px to touch",
    viewport: { width: 844, height: 390 },
    async run({ page }) {
      const backend = await backendAt(WEEKS);
      await twelve(backend);
      await openDays(page, { backend, nowMs: WEEKS, storage: { "mat.tixFetch": "open" } });
      await waitKind(page, "missing");
      assert.equal(await height(page, "#vDays .rdy"), 30);
      assert.equal(await height(page, "#rdyKey"), 30);
      assert.ok(await touch44(page, "#rdyKey"));
      assert.ok(await noSideways(page));
      await shot(page, "sideways");
    },
  },
  {
    name: "two panes on a computer: the line is in the Days pane under the board; its sheet opens in that pane",
    viewport: { width: 1440, height: 900 },
    mobile: false,
    async run({ page }) {
      const backend = await backendAt(WEEKS);
      await twelve(backend);
      await openDays(page, { backend, nowMs: WEEKS });
      await waitKind(page, "ready");
      const box = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        return { line: r("#vDays .rdy"), brd: r("#vDays .brd"), days: r("#vDays") };
      });
      assert.ok(box.line.left >= box.days.left && box.line.right <= box.days.right, "inside the Days pane");
      assert.ok(Math.abs(box.line.top - box.brd.bottom) < 1.5, "right under the board");
      assert.ok(await noSideways(page));
      await shot(page, "wide");
      await page.click("#rdyWords");
      await sheetAtRest(page);
      const sh = await page.evaluate(() => document.getElementById("rdy").getBoundingClientRect().right);
      assert.ok(sh <= box.days.right + 1, "the sheet stands over the Days pane");
    },
  },
];
