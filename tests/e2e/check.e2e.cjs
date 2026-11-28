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
//
// The roll call (issue 96): the owner's sheet also stamps who has opened MAT
// on their own link and whose phone said it is ready for no signal, and the
// line names who needs a nudge. The cases of part 1 open the others' links
// first (everyoneOpened), so the line there is about missing things alone.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { WITH_PLAN, NOON12, makeBackend, ownKey, open, advance, until, atRest, text, expectText, visible } = require("./helpers.cjs");
const { png } = require("./pictures.cjs");

const KEY = "test-key";
const D12 = "2026-12-12";
const SKY = "planstop1203";
const LUNCH = "planstop1202";
const INN = "planstay0001";
const LODGE = "planstay0002";
const EIGHT = ["stay-booking:" + INN, "place:" + LUNCH, "ticket:" + SKY, "place:planstop1204", "place:planstop1205", "stay-jp:" + LODGE, "stay-booking:" + LODGE, "night:2026-12-16"];

const SHOTS = process.env.MAT_CHECK_SHOTS || "";
// A picture at device scale 2 of the viewport the case runs in.
const scaled = new WeakMap(); // page -> its protocol session, with the override on
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  // Once per page, at the page's own size, and left on (clearing it would size the page to the window).
  if (!scaled.has(page)) {
    const session = await page.context().newCDPSession(page);
    scaled.set(page, session);
    const size = page.viewportSize();
    await session.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 2, mobile: true });
  }
  const cdp = scaled.get(page);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  // The board's lines have filled in (a CSS animation).
  await until(() => page.evaluate(() => [...document.querySelectorAll(".led-wipe")].every((n) => !n.getClientRects().length)), "the board has filled in");
  // Through the protocol, so the picture is at the override's device scale (page.screenshot would be at 1).
  const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 90 });
  fs.writeFileSync(path.join(SHOTS, name + ".jpg"), Buffer.from(data, "base64"));
}

const asOwner = { seed: WITH_PLAN, own: "Mo", tab: "days" };

// A backend on which Ajen and Trenton have each opened MAT once on their own
// link (as a phone's first load would): nobody needs a nudge.
async function everyoneOpened(seed = WITH_PLAN, nowMs = NOON12) {
  const backend = makeBackend(seed, { now: nowMs });
  for (const name of ["Ajen", "Trenton"]) {
    const r = await backend.fake({ key: ownKey(backend, name), action: "load", args: {} });
    assert.equal(r.ok, true, r.message);
  }
  return backend;
}

// The owner's phone on the plan; the line has drawn.
async function owner(page, over = {}) {
  const backend = await open(page, { ...asOwner, backend: over.backend || (await everyoneOpened(over.seed || WITH_PLAN)), ...over });
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
    await expectText(page, "#stay .sy-name", "Niseko lodge");
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
    await open(page, { backend: await everyoneOpened(seed), own: "Mo", tab: "days" });
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
    await expectText(page, "#setCheck", "点検Trip checkWhat the trip is still missing, and who has opened8 missing");
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
    // Neither line reaches into the other's visible part: the top of the green line is the green line's.
    assert.equal(await hit(x, box.rdy.t + 1), "ready", "the visible top of This phone goes to This phone");
    assert.equal(await hit(x, box.rdy.t + 3), "ready");
    assert.equal(await hit(x, box.rdy.t + 7), "ready");
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
  },
});

cases.push({
  name: "at 320 px nothing is wider than the sheet and every row is 44 px or more",
  viewport: { width: 320, height: 568 },
  async run({ page }) {
    await owner(page);
    await lineUp(page);
    const line = await page.evaluate(() => { const l = document.getElementById("ckLine"); const r = l.getBoundingClientRect(); const t = l.querySelector(".ck-t"); return { sw: l.scrollWidth, cw: l.clientWidth, h: r.height, rights: r.right <= innerWidth, tsw: t.scrollWidth, tcw: t.clientWidth, tsh: t.scrollHeight, tch: t.clientHeight }; });
    assert.ok(line.sw <= line.cw + 0.5, "the line does not run sideways");
    assert.ok(line.tsw <= line.tcw + 0.5 && line.tsh <= line.tch + 2, "no word of the count is clipped: " + JSON.stringify(line));
    assert.ok(line.rights, "the line is on the screen");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
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
    assert.ok(m.link >= 44, "the Sheet link is 44 px or more: " + m.link);
  },
});

// The pictures of the built screens: only when MAT_CHECK_SHOTS names a folder (otherwise these cases are not in the list).
if (SHOTS) {
  const atTop = async (page) => {
    await page.evaluate(() => { document.getElementById("vDays").scrollTop = 0; });
    await until(() => page.evaluate(() => document.getElementById("ckLine").getBoundingClientRect().top > 10), "Days is at its top");
  };
  cases.push({
    name: "pictures at 390 px: the board line and the sheet",
    async run({ page }) {
      await owner(page);
      await lineUp(page);
      await thisPhone(page);
      await atTop(page);
      await shot(page, "1-board-line");
      await openSheet(page);
      await shot(page, "1-sheet");
    },
  });
  cases.push({
    name: "pictures at 320 px: the board line and the sheet",
    viewport: { width: 320, height: 700 },
    async run({ page }) {
      await owner(page);
      await lineUp(page);
      await thisPhone(page);
      await atTop(page);
      await shot(page, "1-board-line-320");
      await openSheet(page);
      await shot(page, "1-sheet-320");
    },
  });
}

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
    // Raced against a navigation, so a wrong reload fails here instead of hanging the call.
    const navigated = new Promise((resolve) => page.once("framenavigated", () => resolve("reloaded")));
    const moved = await Promise.race([advance(page, backend, 10000).then(() => "waited"), navigated]);
    assert.equal(moved, "waited", "not while the sheet is open");
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

// ---------- the roll call (issue 96) ----------

// 10:00 on Sun Nov 22 in Toronto: before the trip a link is dated by the Toronto calendar (review I1).
const LINK_DAY = Date.parse("2026-11-22T10:00:00-05:00");
// Each row of the roll call as [name, words under the name, opened cell's label, the stamp's day, ready cell's label, ready box].
const rollRows = (page) => page.evaluate(() => [...document.querySelectorAll("#ckRoll .ck-p")].map((r) => {
  const cells = r.querySelectorAll(".ck-st");
  return [
    r.querySelector(".ck-n b").textContent,
    [...r.querySelectorAll(".ck-n small")].map((n) => (n.classList.contains("is-not") ? "!" : "") + n.textContent).join(" / "),
    cells[0].getAttribute("aria-label"),
    cells[0].querySelector(".ck-ds b") ? cells[0].querySelector(".ck-ds b").textContent : cells[0].querySelector(".ck-no") ? "empty " + cells[0].querySelector(".ck-no").textContent : "?",
    cells[1].getAttribute("aria-label"),
    cells[1].querySelector(".ck-ok") ? "済" : cells[1].querySelector(".ck-no") ? "empty" : "?",
  ];
}));
// The kind the line "This phone" shows on a page (its model's kind).
const kindOf = (page) => page.evaluate(() => { const n = document.querySelector("#vDays .rdy"); return n && !n.hidden && !n.classList.contains("is-pending") ? n.dataset.kind : null; });
const seen = (backend) => JSON.parse(backend.fake.props.SEEN || "{}");
// Mo's phone loads again (as after a change of rev, or Fetch): the roll call is what that load answered.
const moLoads = (page) => page.evaluate(() => globalThis.__matTest.store.refresh());
let picN = 0;
async function addPic(backend, where) {
  const ticket = { id: "tkt96" + String(++picN).padStart(5, "0"), ...where, who: "", seat: "", page: 1, mime: "image/png", w: 120, h: 120, data: png(120, 120, 40 + picN) };
  const r = await backend.fake({ key: KEY, actor: "Mo", action: "addTicket", args: { ticket } });
  assert.equal(r.ok, true, r.message);
}

cases.push({
  name: "Ajen opens: Mo's sheet stamps Ajen's opened day after Mo's next load",
  async run(ctx) {
    const { page } = ctx;
    const backend = makeBackend(WITH_PLAN, { now: NOON12 });
    ownKey(backend, "Ajen");
    await open(page, { ...asOwner, backend });
    await lineUp(page);
    await thisPhone(page);
    await expectText(page, "#ckLine .ck-t", "8 missing · 2 have not opened");
    assert.equal(await page.getAttribute("#ckLine", "aria-label"), "Trip check: 8 missing · 2 have not opened. Open the list");
    await openSheet(page);
    assert.equal(await visible(page, "#ckRoll"), true);
    assert.equal(await page.getAttribute("#ckRoll", "role"), "table");
    assert.equal(await page.getAttribute("#ckRoll", "aria-label"), "Roll call");
    await expectText(page, "#ckRoll .ck-rh", "点呼Roll call開封Opened圏外Ready");
    // The roll call sits above the missing list, the note under its last person.
    assert.deepEqual(await page.evaluate(() => [...document.getElementById("check").children].map((n) => n.id || n.className)), ["sheet-top", "ckRoll", "ckRollNote", "ckMissH", "ckRows", "ckNone", "ck-foot"]);
    await expectText(page, "#ckRollNote", "Each phone says two things only: that it opened, and whether it is ready for no signal.");
    assert.deepEqual(await rollRows(page), [
      ["Mo", "This phone", "Opened Dec 12", "12.12", "Ready", "済"],
      ["Ajen", "!Not opened yet / Link made Dec 12", "Not opened", "empty 開", "Nothing said yet", "empty"],
      ["Trenton", "!No link yet", "Not opened", "empty 開", "Nothing said yet", "empty"],
    ]);
    // The owner's seal is on (red); rows are not buttons: nothing in the roll call takes focus.
    assert.equal(await page.evaluate(() => document.querySelector("#ckRoll .ck-p .seal").classList.contains("is-on")), true);
    assert.equal(await page.evaluate(() => document.querySelectorAll("#ckRoll button, #ckRoll a, #ckRoll [tabindex]").length), 0);
    // Ajen opens MAT on his own link.
    const ajen = await ctx.newPhone();
    await open(ajen, { backend, own: "Ajen", tab: "days" });
    await until(() => seen(backend).Ajen, "Ajen's load is noted");
    assert.deepEqual(Object.keys(seen(backend).Ajen), ["o"]);
    // Mo's sheet is as it was until Mo's phone loads again (no rev bump, so no phone reloads for it).
    assert.equal((await rollRows(page))[1][1], "!Not opened yet / Link made Dec 12");
    await moLoads(page);
    await until(async () => (await rollRows(page))[1][3] === "12.12", "Ajen's row is stamped");
    assert.deepEqual((await rollRows(page))[1], ["Ajen", "Opened Dec 12 / Nothing said about no signal yet", "Opened Dec 12", "12.12", "Nothing said yet", "empty"]);
    await expectText(page, "#ckLine .ck-t", "8 missing · Trenton has not opened");
  },
});

cases.push({
  name: "Ajen's phone says ready: Mo sees 済; says not ready: the circle is empty and the line names him",
  async run(ctx) {
    const { page } = ctx;
    const backend = makeBackend(WITH_PLAN, { now: NOON12 });
    await backend.fake({ key: ownKey(backend, "Trenton"), action: "load", args: {} });
    // Ajen's phone fetches pictures only when he opens one: a picture added later is not on it.
    const ajen = await ctx.newPhone();
    await open(ajen, { backend, own: "Ajen", tab: "days", storage: { "mat.tixFetch": "open" } });
    await until(async () => (await kindOf(ajen)) === "ready", "Ajen's phone is ready (no pictures yet)");
    // Held 30 s: one load of its own says so.
    await advance(ajen, backend, 31000);
    await until(() => seen(backend).Ajen && seen(backend).Ajen.r === 1, "Ajen's phone said ready");
    assert.equal(await ajen.evaluate(() => localStorage.getItem("mat.readySaid")), "1");
    await open(page, { ...asOwner, backend });
    await lineUp(page);
    await thisPhone(page);
    await expectText(page, "#ckLine .ck-t", "8 things missing");
    await openSheet(page);
    assert.deepEqual((await rollRows(page))[1], ["Ajen", "Ready for no signal, said Dec 12", "Opened Dec 12", "12.12", "Ready", "済"]);
    await closeSheet(page);
    // A picture is added that Ajen's phone does not fetch by itself: not ready.
    await addPic(backend, { stay: LODGE });
    await advance(ajen, backend, 21000);
    await until(async () => (await kindOf(ajen)) === "missing", "Ajen's phone is missing a picture");
    await advance(ajen, backend, 31000);
    await until(() => seen(backend).Ajen.r === 0, "Ajen's phone said not ready");
    await moLoads(page);
    await expectText(page, "#ckLine .ck-t", /^\d+ missing · Ajen’s phone is not ready$/);
    assert.match(await page.getAttribute("#ckLine", "aria-label"), /^Trip check: \d+ missing · Ajen’s phone is not ready\. Open the list$/);
    await openSheet(page);
    assert.deepEqual((await rollRows(page))[1], ["Ajen", "!Not ready yet, said Dec 12", "Opened Dec 12", "12.12", "Not ready", "empty"]);
    await shot(page, "2-sheet");
  },
});

cases.push({
  name: "a person who has not opened shows the day the link was made",
  async run({ page }) {
    const backend = makeBackend(WITH_PLAN, { now: NOON12 });
    await backend.fake({ key: ownKey(backend, "Ajen"), action: "load", args: { ready: true } });
    backend.now = LINK_DAY;
    ownKey(backend, "Trenton");
    backend.now = NOON12;
    await open(page, { ...asOwner, backend });
    await lineUp(page);
    await thisPhone(page);
    await expectText(page, "#ckLine .ck-t", "8 missing · Trenton has not opened");
    await openSheet(page);
    assert.deepEqual((await rollRows(page))[2], ["Trenton", "!Not opened yet / Link made Nov 22", "Not opened", "empty 開", "Nothing said yet", "empty"]);
    // Its words are bold black, not red (the red is kept for the stamps and the margin rule).
    const ink = await page.evaluate(() => { const n = document.querySelector("#ckRoll .ck-p:nth-child(3) small.is-not"); const c = getComputedStyle(n); return [c.fontWeight, c.color]; });
    assert.deepEqual(ink, ["900", await page.evaluate(() => getComputedStyle(document.querySelector("#ckRoll .ck-n b")).color)]);
  },
});

cases.push({
  name: "the line shows for people alone, with nothing missing",
  async run({ page }) {
    const seed = {
      ...WITH_PLAN,
      stops: WITH_PLAN.stops.map((s) => ({ ...s, place: s.place || "Somewhere", tkRef: s.fixed ? "MADE-UP-1" : s.tkRef })),
      stays: [...WITH_PLAN.stays, { id: "planstay0003", name: "Kyoto inn", firstNight: "2026-12-16", lastNight: "2026-12-19" }].map((s) => ({ ...s, nameJp: s.nameJp || "宿", addressJp: s.addressJp || "住所", tkRef: "R-1" })),
    };
    const backend = makeBackend(seed, { now: NOON12 });
    await open(page, { backend, own: "Mo", tab: "days" });
    await lineUp(page);
    await thisPhone(page);
    await expectText(page, "#ckLine .ck-t", "2 have not opened");
    assert.equal(await page.getAttribute("#ckLine", "aria-label"), "Trip check: 2 have not opened. Open the list");
    await openSheet(page);
    await expectText(page, "#ckMissT", "Still missing: nothing");
    assert.equal(await visible(page, "#ckRoll"), true);
    await closeSheet(page);
    // Both open: nothing to nudge and nothing missing, the line goes.
    for (const name of ["Ajen", "Trenton"]) await backend.fake({ key: ownKey(backend, name), action: "load", args: {} });
    await moLoads(page);
    await until(async () => !(await visible(page, "#ckLine")), "the line goes");
    // You's row still opens the sheet, with the roll call.
    await page.click("#youBtn");
    await atRest(page, "#you");
    await expectText(page, "#setCheckS", "What the trip is still missing, and who has opened");
    await expectText(page, "#setCheckV", "Open");
  },
});

cases.push({
  name: "a friend's phone has no roll call anywhere and its This phone sheet carries the line",
  async run(ctx) {
    const { page } = ctx;
    const backend = await everyoneOpened();
    const ajen = page;
    await open(ajen, { backend, own: "Ajen", tab: "days" });
    await thisPhone(ajen);
    assert.equal(await ajen.evaluate(() => globalThis.__matTest.store.state.roll), null);
    assert.equal(await ajen.evaluate(() => JSON.parse(localStorage.getItem("mat.cache")).data.roll === undefined), true, "not in the saved copy");
    assert.equal(await ajen.evaluate(() => document.querySelectorAll("#ckRoll, .ck-roll, .ck-rf, #check").length), 0);
    assert.equal(await ajen.evaluate(() => /Roll call|点呼/.test(document.body.innerText)), false);
    await ajen.click("#vDays .rdy-w");
    await atRest(ajen, "#rdy");
    const notes = await ajen.evaluate(() => [...document.querySelectorAll("#rdy .rdy-note-r")].map((n) => n.textContent));
    assert.equal(notes.at(-1), "Mo can see that you have opened MAT and whether this phone is ready for no signal. Nothing else.");
    await shot(ajen, "2-friend-line");
    await ajen.click("#rdyDone");
    await atRest(ajen, "#rdy", { open: false });
    // The owner's own sheet says it the other way; the shared link says nothing.
    const mo = await ctx.newPhone();
    await open(mo, { backend, own: "Mo", tab: "days" });
    await thisPhone(mo);
    await mo.click("#vDays .rdy-w");
    await atRest(mo, "#rdy");
    assert.equal(await mo.evaluate(() => [...document.querySelectorAll("#rdy .rdy-note-r")].at(-1).textContent), "The others’ phones tell you that they have opened MAT and whether they are ready for no signal. Nothing else.");
    const shared = await ctx.newPhone();
    await open(shared, { backend, key: KEY, me: "Mo", tab: "days" });
    await thisPhone(shared);
    await shared.click("#vDays .rdy-w");
    await atRest(shared, "#rdy");
    assert.equal(await shared.evaluate(() => [...document.querySelectorAll("#rdy .rdy-note-r")].some((n) => /can see|tell you/.test(n.textContent))), false);
    assert.equal(await shared.evaluate(() => globalThis.__matTest.store.state.roll), null);
  },
});

cases.push({
  name: "the roll call at 320 px: nothing wider than the sheet",
  viewport: { width: 320, height: 700 },
  async run({ page }) {
    const backend = makeBackend(WITH_PLAN, { now: NOON12 });
    await backend.fake({ key: ownKey(backend, "Ajen"), action: "load", args: { ready: false } });
    backend.now = LINK_DAY;
    ownKey(backend, "Trenton");
    backend.now = NOON12;
    await open(page, { ...asOwner, backend });
    await lineUp(page);
    await thisPhone(page);
    const line = await page.evaluate(() => { const l = document.getElementById("ckLine"); const t = l.querySelector(".ck-t"); return { sw: l.scrollWidth, cw: l.clientWidth, tsw: t.scrollWidth, tcw: t.clientWidth, tsh: t.scrollHeight, tch: t.clientHeight, right: l.getBoundingClientRect().right <= innerWidth }; });
    assert.ok(line.sw <= line.cw + 0.5 && line.tsw <= line.tcw + 0.5 && line.tsh <= line.tch + 2 && line.right, "the line's words fit: " + JSON.stringify(line));
    await openSheet(page);
    const m = await page.evaluate(() => {
      const s = document.getElementById("check");
      const right = s.getBoundingClientRect().right;
      const over = [...s.querySelectorAll("#ckRoll *, #ckRollNote")].filter((n) => n.getClientRects().length && n.getBoundingClientRect().right > right + 0.5).map((n) => n.className || n.tagName);
      return { fits: s.scrollWidth <= s.clientWidth, over, rows: [...s.querySelectorAll("#ckRoll .ck-p")].map((r) => r.getBoundingClientRect().height), boxes: [...s.querySelectorAll("#ckRoll .ck-ds, #ckRoll .ck-ok, #ckRoll .ck-no")].map((b) => Math.round(b.getBoundingClientRect().width)) };
    });
    assert.equal(m.fits, true, "scrollWidth <= clientWidth");
    assert.deepEqual(m.over, []);
    assert.equal(m.rows.length, 3);
    assert.ok(m.boxes.every((w) => w >= 44 && w <= 54), "every stamp whole in its column: " + m.boxes);
    await shot(page, "2-sheet-320");
  },
});

if (SHOTS) {
  cases.push({
    name: "pictures at 390 px: the line with a person to nudge",
    async run({ page }) {
      const backend = makeBackend(WITH_PLAN, { now: NOON12 });
      await backend.fake({ key: ownKey(backend, "Ajen"), action: "load", args: { ready: true } });
      backend.now = LINK_DAY;
      ownKey(backend, "Trenton");
      backend.now = NOON12;
      await open(page, { ...asOwner, backend });
      await lineUp(page);
      await thisPhone(page);
      await page.evaluate(() => { document.getElementById("vDays").scrollTop = 0; });
      await until(() => page.evaluate(() => document.getElementById("ckLine").getBoundingClientRect().top > 10), "Days is at its top");
      await shot(page, "2-board-line");
    },
  });
}

module.exports = cases;
