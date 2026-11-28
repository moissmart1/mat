// The owner's trip check (issue 86): the line on the Days board that says how
// much the trip is still missing, the sheet it opens, the row in You, and what
// each row opens. Owner's phone only: the first person, on their own link.
// The plan is tests/fixtures/plan.json over the seed; the clock is 13:20 on
// Sat Dec 12 in Japan (the trip: Dec 10 to 20). Every name and place is made
// up. On that day the plan is missing 8 things:
//   Dec 12  Asakusa hotel: no booking          (stay-booking:planstay0001)
//   Dec 12  Lunch in Harajuku, 12:30: no place (place:planstop1202)
//   Dec 12  Shibuya Sky, 14:00: no ticket      (ticket:planstop1203)
//   Dec 12  Dinner, 19:00: no place            (place:planstop1204)
//   Dec 12  Buy gloves: no place               (place:planstop1205)
//   Dec 13  Niseko lodge: no Japanese name     (stay-jp:planstay0002)
//   Dec 13  Niseko lodge: no booking           (stay-booking:planstay0002)
//   Dec 16  four nights with no stay           (night:2026-12-16)
// Pictures of the built screens are taken only when MAT_CHECK_SHOTS names a
// folder (390 x 844 and 320 x 700 at device scale 2, invented data).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { WITH_PLAN, open, advance, until, atRest, text, expectText, visible } = require("./helpers.cjs");

const KEY = "test-key";
const D12 = "2026-12-12";
const SKY = "planstop1203";
const LUNCH = "planstop1202";
const INN = "planstay0001";
const LODGE = "planstay0002";
const EIGHT = ["stay-booking:" + INN, "place:" + LUNCH, "ticket:" + SKY, "place:planstop1204", "place:planstop1205", "stay-jp:" + LODGE, "stay-booking:" + LODGE, "night:2026-12-16"];

const SHOTS = process.env.MAT_CHECK_SHOTS || "";
// A picture at device scale 2 of the viewport the case runs in.
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: size.w, height: size.h, deviceScaleFactor: 2, mobile: true });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  // The board's lines have filled in (a CSS animation).
  await until(() => page.evaluate(() => [...document.querySelectorAll(".led-wipe")].every((n) => !n.getClientRects().length)), "the board has filled in");
  await page.screenshot({ path: path.join(SHOTS, name + ".jpg"), type: "jpeg", quality: 90 });
  await cdp.send("Emulation.clearDeviceMetricsOverride");
}

const asOwner = { seed: WITH_PLAN, own: "Mo", tab: "days" };

// The owner's phone on the plan; the line has drawn.
async function owner(page, over = {}) {
  const backend = await open(page, { ...asOwner, ...over });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}
const lineUp = (page) => until(() => visible(page, "#ckLine"), "the check line shows");
const thisPhone = (page) => until(() => page.evaluate(() => { const n = document.querySelector("#vDays .rdy"); return !!n && !n.hidden && !n.classList.contains("is-pending"); }), "the line This phone shows");
const rowIds = (page) => page.evaluate(() => [...document.querySelectorAll("#ckRows .ck-r")].map((r) => r.dataset.id));
const focusId = (page) => page.evaluate(() => document.activeElement && document.activeElement.id);
const openSheet = async (page) => {
  await page.click("#ckLine");
  await atRest(page, "#check");
};
const closeSheet = async (page) => {
  await page.click("#ckDone");
  await atRest(page, "#check", { open: false });
};
const isOpen = (page, id) => page.evaluate((i) => { const el = document.getElementById(i); return !!el && el.classList.contains("is-open"); }, id);
const lineWords = (page) => text(page, "#ckLine .ck-t");
const tk = (date) => '#rail .pg[data-date="' + date + '"]';

const cases = [];

cases.push({
  name: "the owner's board shows the line with the count; a friend's and the shared link's do not",
  async run(ctx) {
    const { page } = ctx;
    const backend = await owner(page);
    await lineUp(page);
    await expectText(page, "#ckLine .ck-t", "8 things missing");
    assert.equal(await page.getAttribute("#ckLine", "aria-label"), "Trip check: 8 things missing. Open the list");
    assert.equal(await text(page, "#ckLine .ck-jp"), "点検");
    assert.equal(await page.getAttribute("#ckLine .ck-jp", "aria-hidden"), "true");
    assert.equal(await page.evaluate(() => document.getElementById("ckLine").tagName), "BUTTON");
    // The line sits between the board and the line "This phone".
    assert.deepEqual(await page.evaluate(() => [...document.querySelector("#vDays").children].map((n) => (n.id === "ckLine" ? "check" : n.classList.contains("rdy") ? "ready" : n.classList.contains("brd-wrap") ? "board" : n.id === "rail" ? "rail" : "")).filter(Boolean)), ["board", "check", "ready", "rail"]);

    for (const who of ["Ajen", null]) {
      const other = await ctx.newPhone();
      // A friend on their own link; then Mo on the shared link (not a personal one).
      await open(other, { seed: WITH_PLAN, backend, tab: "days", ...(who ? { own: who } : { key: KEY, me: "Mo" }) });
      await until(() => other.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
      await thisPhone(other);
      assert.equal(await other.evaluate(() => ["ckLine", "check", "ckScrim", "ckRows"].map((id) => document.getElementById(id))).then((n) => n.every((x) => x === null)), true, "nothing of it in the page (" + (who || "shared link") + ")");
      assert.equal(await other.evaluate(() => document.querySelectorAll(".ck-line, .ck").length), 0);
      assert.equal(await other.evaluate(() => /Trip check|点検/.test(document.body.innerText)), false, "no word of it");
    }
  },
});

cases.push({
  name: "the line opens the sheet; Done, Escape and the scrim close it; focus goes back to the line",
  async run({ page }) {
    await owner(page);
    await lineUp(page);
    await page.click("#ckLine");
    await atRest(page, "#check");
    assert.equal(await focusId(page), "ckDone", "focus moves into the sheet");
    assert.equal(await page.evaluate(() => document.getElementById("phone").classList.contains("check-open")), true);
    assert.equal(await page.getAttribute("#check", "role"), "dialog");
    assert.equal(await page.getAttribute("#check", "aria-modal"), "true");
    assert.equal(await page.getAttribute("#check", "aria-label"), "Trip check");
    assert.equal(await page.evaluate(() => document.getElementById("check").inert), false);
    await expectText(page, "#check .sheet-top", "点検表Trip checkDone");
    await expectText(page, "#ckMissT", "Still missing: 8");
    await expectText(page, "#ckMissH em", "by date · tap to fix");
    assert.deepEqual(await rowIds(page), EIGHT);
    await expectText(page, "#check .ck-foot", "Read from the trip as this phone holds it. A stay’s nights, Japanese name and address are typed in the Google Sheet, on the Stays tab.Open the Sheet ↗");
    assert.equal(await page.getAttribute("#ckSheet", "href"), "https://example.test/sheet");
    assert.equal(await page.getAttribute("#ckSheet", "target"), "_blank");
    assert.equal(await page.getAttribute("#ckSheet", "rel"), "noopener");
    // Tab order: Done, the rows in order, the link.
    const order = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => { const a = document.activeElement; return a.id || a.dataset.id || a.tagName; }));
    }
    assert.deepEqual(order.slice(0, 9), [...EIGHT, "ckSheet"], "rows in order, then the link");
    // Done.
    await page.click("#ckDone");
    await atRest(page, "#check", { open: false });
    assert.equal(await focusId(page), "ckLine", "Done gives focus back to the line");
    assert.equal(await page.evaluate(() => document.getElementById("check").inert), true);
    assert.equal(await page.evaluate(() => document.getElementById("phone").classList.contains("check-open")), false);
    // Escape.
    await page.click("#ckLine");
    await atRest(page, "#check");
    await page.keyboard.press("Escape");
    await atRest(page, "#check", { open: false });
    assert.equal(await focusId(page), "ckLine", "Escape too");
    // The scrim.
    await page.click("#ckLine");
    await atRest(page, "#check");
    await page.mouse.click(195, 40);
    await atRest(page, "#check", { open: false });
    assert.equal(await focusId(page), "ckLine", "and the scrim");
  },
});

cases.push({
  name: "each kind of row opens its thing: the stop sheet, Edit stay, the hotel card, the day",
  async run({ page }) {
    await owner(page);
    await lineUp(page);
    const tap = async (id) => {
      await openSheet(page);
      await page.click('#ckRows .ck-r[data-id="' + id + '"]');
      await atRest(page, "#check", { open: false });
      assert.equal(await page.evaluate(() => document.getElementById("phone").classList.contains("check-open")), false);
    };
    // A ticket (and a place): the stop sheet, on that stop.
    await tap("ticket:" + SKY);
    await atRest(page, "#stop");
    assert.equal(await page.inputValue("#stWhat"), "Shibuya Sky");
    await page.click("#stDone");
    await atRest(page, "#stop", { open: false });
    await tap("place:" + LUNCH);
    await atRest(page, "#stop");
    assert.equal(await page.inputValue("#stWhat"), "Lunch in Harajuku");
    await page.click("#stDone");
    await atRest(page, "#stop", { open: false });
    // A booking: Edit stay.
    await tap("stay-booking:" + INN);
    await atRest(page, "#staySheet");
    await expectText(page, "#syDay b", "Asakusa hotel");
    assert.equal(await page.evaluate(() => document.getElementById("stay").classList.contains("is-open")), false);
    await page.click("#syDone");
    await atRest(page, "#staySheet", { open: false });
    // After Edit stay closes the hotel card opens, as it does today.
    await atRest(page, "#stay");
    await page.click("#stayDone");
    await atRest(page, "#stay", { open: false });
    // A Japanese name: the hotel card.
    await tap("stay-jp:" + LODGE);
    await atRest(page, "#stay");
    await expectText(page, "#stay .sy-name", /Niseko lodge|^$/);
    await page.click("#stayDone");
    await atRest(page, "#stay", { open: false });
    // Nights with no stay: that day, on Days.
    await tap("night:2026-12-16");
    await until(() => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return r.left >= -1 && r.left < 60; }, tk("2026-12-16")), "Dec 16's ticket is the one in view");
    assert.deepEqual(await page.evaluate(() => ["stop", "staySheet", "stay", "check"].map((id) => document.getElementById(id).classList.contains("is-open"))), [false, false, false, false]);
  },
});

cases.push({
  name: "filling in a place takes its row away and lowers the count on the line",
  async run({ page }) {
    await owner(page);
    await lineUp(page);
    await openSheet(page);
    await page.click('#ckRows .ck-r[data-id="place:' + LUNCH + '"]');
    await atRest(page, "#check", { open: false });
    await atRest(page, "#stop");
    await page.fill("#stPlace", "Takeshita Street cafe");
    await page.click("#stSave");
    await atRest(page, "#stop", { open: false });
    await expectText(page, "#ckLine .ck-t", "7 things missing");
    await openSheet(page);
    await expectText(page, "#ckMissT", "Still missing: 7");
    assert.deepEqual(await rowIds(page), EIGHT.filter((id) => id !== "place:" + LUNCH));
  },
});

cases.push({
  name: "the sheet redraws while open and keeps a row that has not changed; focus stays",
  async run({ page }) {
    const backend = await owner(page);
    await lineUp(page);
    await openSheet(page);
    await page.focus('#ckRows .ck-r[data-id="ticket:' + SKY + '"]');
    await page.evaluate(() => { document.querySelector('#ckRows .ck-r[data-id="ticket:planstop1203"]').dataset.mark = "kept"; document.querySelector('#ckRows .ck-r[data-id="stay-jp:planstay0002"]').dataset.mark = "kept"; });
    // Someone fills in lunch's place on another phone: the next check of the trip takes its row away.
    const r = await backend.fake({ key: KEY, actor: "Ajen", via: "app", action: "updateStop", args: { id: LUNCH, patch: { place: "Cafe Made-up" } } });
    assert.equal(r.ok, true, r.message);
    await advance(page, backend, 25000);
    await expectText(page, "#ckMissT", "Still missing: 7");
    assert.deepEqual(await rowIds(page), EIGHT.filter((id) => id !== "place:" + LUNCH));
    assert.equal(await page.evaluate(() => document.querySelector('#ckRows .ck-r[data-id="ticket:planstop1203"]').dataset.mark), "kept", "the row is the same node");
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.id), "ticket:" + SKY, "focus stays on it");
    // The row that held focus is the one that goes: focus goes to Done.
    const r2 = await backend.fake({ key: KEY, actor: "Ajen", via: "app", action: "updateStop", args: { id: SKY, patch: { tkRef: "MADE-UP-1" } } });
    assert.equal(r2.ok, true, r2.message);
    await advance(page, backend, 25000);
    await expectText(page, "#ckMissT", "Still missing: 6");
    assert.equal(await focusId(page), "ckDone");
  },
});

cases.push({
  name: "nothing missing: no line; You's row says Open; the sheet says nothing is missing",
  async run({ page }) {
    const seed = {
      ...WITH_PLAN,
      stops: WITH_PLAN.stops.map((s) => ({ ...s, place: s.place || "Somewhere", tkRef: s.fixed ? "MADE-UP-1" : s.tkRef })),
      // Every stay named in Japanese and booked, and one for the nights from Dec 16 on, so no night is bare.
      stays: [...WITH_PLAN.stays, { id: "planstay0003", name: "Kyoto inn", firstNight: "2026-12-16", lastNight: "2026-12-19" }].map((s) => ({ ...s, nameJp: s.nameJp || "宿", addressJp: s.addressJp || "住所", tkRef: "R-1" })),
    };
    await open(page, { seed, own: "Mo", tab: "days" });
    await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
    await thisPhone(page);
    assert.equal(await visible(page, "#ckLine"), false, "no line");
    assert.equal(await page.evaluate(() => document.getElementById("ckLine") === null || document.getElementById("ckLine").hidden), true);
    await page.click("#youBtn");
    await atRest(page, "#you");
    assert.equal(await visible(page, "#setCheck"), true);
    await expectText(page, "#setCheckV", "Open");
    await page.click("#setCheck");
    await atRest(page, "#check");
    await expectText(page, "#ckMissT", "Still missing: nothing");
    assert.equal(await visible(page, "#ckNone"), true);
    await expectText(page, "#ckNone", "Nothing is missing from today on.");
    assert.equal(await visible(page, "#ckRows"), false);
    assert.equal(await visible(page, "#ckMissH em"), false);
    await shot(page, "1-empty");
  },
});

cases.push({
  name: "You, Trip check opens the sheet",
  async run({ page }) {
    await owner(page, { tab: "money" });
    await page.click("#youBtn");
    await atRest(page, "#you");
    assert.equal(await visible(page, "#setCheck"), true);
    await expectText(page, "#setCheck", "点検Trip checkWhat the trip is still missing8 missing");
    await page.evaluate(() => document.getElementById("setCheck").scrollIntoView({ block: "center" }));
    await shot(page, "1-you-row");
    await page.click("#setCheck");
    await atRest(page, "#you", { open: false });
    await atRest(page, "#check");
    await expectText(page, "#ckMissT", "Still missing: 8");
    assert.equal(await page.evaluate(() => document.getElementById("you").classList.contains("is-open")), false, "only one sheet is up");
    await page.click("#ckDone");
    await atRest(page, "#check", { open: false });
  },
});

cases.push({
  name: "You's row is only on the owner's phone",
  async run(ctx) {
    const backend = await owner(ctx.page);
    const other = await ctx.newPhone();
    await open(other, { seed: WITH_PLAN, backend, tab: "days", own: "Ajen" });
    await until(() => other.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
    await other.click("#youBtn");
    await atRest(other, "#you");
    assert.equal(await visible(other, "#setCheck"), false);
  },
});

cases.push({
  name: "the board closed with ×: the line stays, corners round",
  async run({ page }) {
    await owner(page);
    await lineUp(page);
    await thisPhone(page);
    const corners = () => page.evaluate(() => {
      const r = (sel) => { const n = document.querySelector(sel); return n ? getComputedStyle(n).borderRadius : null; };
      return { line: r("#ckLine"), rdy: r("#vDays .rdy"), cls: document.getElementById("ckLine").className };
    });
    // With the board above: the line is square at the top, and is not last (This phone is under it).
    assert.equal(await visible(page, "#vDays .brd"), true, "the board shows");
    let c = await corners();
    assert.equal(c.line, "0px", "square: the board is above and This phone below");
    assert.equal(/is-top/.test(c.cls), false);
    assert.equal(/is-last/.test(c.cls), false);
    assert.equal(await page.evaluate(() => document.querySelector("#vDays .brd-wrap, #vDays .brd").classList.contains("has-foot") || !!document.querySelector("#vDays .has-foot")), true, "the board keeps its foot");
    await page.click('button[aria-label="Close the board for today"]');
    await until(() => page.evaluate(() => !document.querySelector("#vDays .brd") || !document.querySelector("#vDays .brd").getClientRects().length || document.querySelector("#vDays .brd-wrap.is-shut") !== null), "the board shuts");
    await until(async () => /is-top/.test((await corners()).cls), "the line is first and rounds its top");
    c = await corners();
    assert.equal(c.line, "6px 6px 0px 0px");
    assert.equal(await visible(page, "#ckLine"), true, "× does not hide the line");
    assert.equal(await page.evaluate(() => document.querySelector("#vDays .rdy").classList.contains("is-alone")), false, "This phone is not alone: the check line is above it");
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#vDays .rdy")).borderRadius), "0px 0px 6px 6px");
  },
});

cases.push({
  name: "the line and This phone under it each take their own tap",
  async run({ page }) {
    await owner(page);
    await lineUp(page);
    await thisPhone(page);
    await page.evaluate(() => { document.getElementById("vDays").scrollTop = 0; });
    await until(() => page.evaluate(() => document.getElementById("ckLine").getBoundingClientRect().top > 10), "Days is at its top");
    const hit = (x, y) => page.evaluate(([x, y]) => { const n = document.elementFromPoint(x, y); return n ? (n.closest("#ckLine") ? "check" : n.closest(".rdy") ? "ready" : n.closest(".brd") ? "board" : n.className || n.tagName) : null; }, [x, y]);
    const box = await page.evaluate(() => { const c = document.getElementById("ckLine").getBoundingClientRect(); const r = document.querySelector("#vDays .rdy").getBoundingClientRect(); return { ck: { t: c.top, b: c.bottom, h: c.height, x: c.left + c.width / 2 }, rdy: { t: r.top, b: r.bottom, h: r.height } }; });
    assert.ok(box.ck.h >= 33.5 && box.ck.h <= 34.5, "the line is 34 px tall, got " + box.ck.h);
    assert.ok(Math.abs(box.ck.b - box.rdy.t) < 1, "This phone sits right under it");
    const x = box.ck.x;
    // The line's 44 px: 5 above its top and 5 below its foot.
    assert.equal(await hit(x, box.ck.t - 4), "check", "its reach above " + JSON.stringify(box));
    assert.equal(await hit(x, box.ck.t + 3), "check");
    assert.equal(await hit(x, box.ck.b - 3), "check");
    assert.equal(await hit(x, box.ck.b + 3), "check", "its reach below");
    // Under that, This phone's own.
    assert.equal(await hit(x, box.rdy.t + 7), "ready", "the line below keeps its own part");
    assert.equal(await hit(x, box.rdy.b - 3), "ready");
    // Real taps: each opens its own sheet and not the other.
    await page.click("#ckLine");
    await atRest(page, "#check");
    assert.equal(await isOpen(page, "rdy"), false);
    await page.click("#ckDone");
    await atRest(page, "#check", { open: false });
    await page.click("#vDays .rdy-w");
    await atRest(page, "#rdy");
    assert.equal(await isOpen(page, "check"), false);
    await page.click("#rdyDone");
    await atRest(page, "#rdy", { open: false });
    // Opening one closes the other (one sheet at a time).
    await openSheet(page);
    await page.evaluate(() => document.querySelector("#vDays .rdy-w").click());
    await atRest(page, "#rdy");
    await atRest(page, "#check", { open: false });
  },
});

cases.push({
  name: "the line and This phone: the board's foot is kept while either shows",
  async run({ page }) {
    await owner(page);
    await lineUp(page);
    await thisPhone(page);
    assert.equal(await page.evaluate(() => !!document.querySelector("#vDays .has-foot")), true);
    await page.evaluate(() => { document.getElementById("vDays").scrollTop = 0; });
    await until(() => page.evaluate(() => document.getElementById("ckLine").getBoundingClientRect().top > 10), "Days is at its top");
    await shot(page, "1-board-line");
  },
});

cases.push({
  name: "at 320 px nothing is wider than the sheet and every row is 44 px or more",
  viewport: { width: 320, height: 568 },
  async run({ page }) {
    await owner(page);
    await lineUp(page);
    const line = await page.evaluate(() => { const l = document.getElementById("ckLine"); const r = l.getBoundingClientRect(); return { w: r.width, sw: l.scrollWidth, cw: l.clientWidth, h: r.height, rights: r.right <= innerWidth, t: l.querySelector(".ck-t").getClientRects().length }; });
    assert.ok(line.sw <= line.cw + 0.5, "the line does not run sideways");
    assert.ok(line.rights, "the line is on the screen");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(() => { document.getElementById("vDays").scrollTop = 0; });
    await until(() => page.evaluate(() => document.getElementById("ckLine").getBoundingClientRect().top > 10), "Days is at its top");
    await shot(page, "1-board-line-320");
    await openSheet(page);
    const m = await page.evaluate(() => {
      const s = document.getElementById("check");
      const over = [...s.querySelectorAll("*")].filter((n) => n.getClientRects().length && n.getBoundingClientRect().right > s.getBoundingClientRect().right + 0.5).map((n) => n.className || n.tagName);
      return { fits: s.scrollWidth <= s.clientWidth, over, rows: [...s.querySelectorAll(".ck-r")].map((r) => r.getBoundingClientRect().height), done: document.getElementById("ckDone").getBoundingClientRect().height, link: document.getElementById("ckSheet").getBoundingClientRect().height };
    });
    assert.equal(m.fits, true, "scrollWidth <= clientWidth");
    assert.deepEqual(m.over, []);
    assert.equal(m.rows.length, 8);
    assert.ok(m.rows.every((h) => h >= 44), "every row 44 px or more: " + m.rows);
    assert.ok(m.done >= 44, "Done is 44 px");
    assert.ok(m.link >= 44 - 0.5 || m.link >= 36, "the Sheet link has its padding: " + m.link);
  },
});

cases.push({
  name: "the sheet at 390 and 320 px: pictures",
  viewport: { width: 320, height: 700 },
  async run({ page }) {
    if (!SHOTS) return;
    await owner(page);
    await lineUp(page);
    await openSheet(page);
    await shot(page, "1-sheet-320");
  },
});

cases.push({
  name: "the sheet at 390 px: picture",
  async run({ page }) {
    if (!SHOTS) return;
    await owner(page);
    await lineUp(page);
    await openSheet(page);
    await shot(page, "1-sheet");
  },
});

cases.push({
  name: "a new release waits while the sheet is open",
  async run({ page }) {
    const backend = await owner(page);
    await lineUp(page);
    await openSheet(page);
    await page.evaluate(() => { window.__notReloaded = true; });
    const answered = await page.evaluate(() => new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve(true);
      navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "mat-new-version" }, ports: [ch.port2] }));
      setTimeout(() => resolve(false), 500);
    }));
    assert.equal(answered, true, "the page answers");
    await advance(page, backend, 10000);
    assert.equal(await page.evaluate(() => window.__notReloaded !== true).catch(() => true), false, "not while the sheet is open");
    await page.click("#ckDone");
    await atRest(page, "#check", { open: false });
    // Not awaited: the reload it sets off happens inside this call, which then never answers.
    page.clock.fastForward(4000).catch(() => {});
    await until(() => page.evaluate(() => window.__notReloaded !== true).catch(() => true), "then it reloads");
  },
});

cases.push({
  name: "the trip's day turns over: what is behind us goes",
  async run({ page }) {
    const backend = await owner(page);
    await lineUp(page);
    await expectText(page, "#ckLine .ck-t", "8 things missing");
    // Midnight into Sun Dec 13: Dec 12's stops and Asakusa hotel are behind us; 3 things are left that day-or-later, and the night run.
    await advance(page, backend, 11 * 3600 * 1000);
    await expectText(page, "#ckLine .ck-t", "3 things missing");
    await openSheet(page);
    assert.deepEqual(await rowIds(page), ["stay-jp:" + LODGE, "stay-booking:" + LODGE, "night:2026-12-16"]);
  },
});

module.exports = cases;
