// Adding, changing and removing stops: the ＋ Add a stop row on each ticket,
// the Edit button on an open stop, the stop sheet (#stop) they open, the undo
// bar and History. The plan is tests/fixtures/plan.json over the seed; the
// clock is 13:20 on Dec 12 in Japan, Day 3 (Shibuya Sky at 14:00 is next).

const assert = require("node:assert/strict");
const { WITH_PLAN, open, advance, until, text, expectText, visible } = require("./helpers.cjs");

const D12 = "2026-12-12";
const SKY = "planstop1203";
const DINNER = "planstop1204";

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: WITH_PLAN, tab: "days", ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}

const tk = (date) => '#rail .pg[data-date="' + date + '"]';
const row = (id) => '.r[data-id="' + id + '"]';
const isOpen = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  return !!el && el.classList.contains("is-open");
}, id);
// The sheet is open and has risen all the way (it slides up over 500 ms).
const waitSheet = (page) =>
  until(
    () => page.evaluate(() => {
      const s = document.getElementById("stop");
      return !!s && s.classList.contains("is-open") && Math.abs(s.getBoundingClientRect().bottom - innerHeight) < 1;
    }),
    "the stop sheet opens",
  );
const waitSheetClosed = (page) => until(async () => !(await isOpen(page, "stop")), "the stop sheet closes");
const idle = (page) => page.evaluate(() => globalThis.__matTest.store.idle());
// Pictures are taken only when MAT_TAB_SHOTS names an output folder.
const SHOTS = process.env.MAT_TAB_SHOTS || "";
async function shot(page, name) {
  if (!SHOTS) return;
  require("node:fs").mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/" + name });
}

// The stop names on a ticket, without the こんど tag the next stop carries.
const rowTitles = (page, date) => page.evaluate((sel) => [...document.querySelectorAll(sel + " .r[data-id] .r-n")].map((n) => n.lastChild.textContent), tk(date));
const value = (page, sel) => page.evaluate((s) => document.querySelector(s).value, sel);
const disabled = (page, sel) => page.evaluate((s) => document.querySelector(s).disabled, sel);

async function openAdd(page, date = D12) {
  await page.click(tk(date) + " .tk-add");
  await waitSheet(page);
}

async function openEdit(page, id) {
  const opened = await page.evaluate((sel) => document.querySelector(sel).classList.contains("is-open"), row(id));
  if (!opened) await page.click(row(id) + " .r-b");
  // Opened all the way: on its ticket every stop's details have finished
  // sliding open or shut (0.2 s). Tapped while they still move, Playwright
  // finds Edit "not stable" and its retries scroll Edit into view with
  // inline "end" or "start", which snaps the rail to the next or previous day.
  await until(
    () => page.evaluate((sel) => {
      const r = document.querySelector(sel);
      return r.classList.contains("is-open") && [...r.closest(".tk").querySelectorAll(".r[data-id]")].every((x) => {
        const d = x.querySelector(".r-more > div");
        return !d || d.clientHeight === (x.classList.contains("is-open") ? d.scrollHeight : 0);
      });
    }, row(id)),
    "the stop opens",
  );
  await page.click(row(id) + " .r-edit");
  await waitSheet(page);
}

async function addTower(page, more = {}) {
  await openAdd(page);
  await page.fill("#stWhat", "Tower Records");
  await page.fill("#stTime", "16:00");
  for (const [sel, v] of Object.entries(more)) await page.fill(sel, v);
  await page.click("#stSave");
  await waitSheetClosed(page);
}

// The app goes to the background (hidden true) or comes back.
const setHidden = (page, hidden) => page.evaluate((h) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}, hidden);

// Network tricks on the shared fake backend, for one request of `action`:
// - hold: it reaches the backend, but the reply waits for release();
// - lose: it reaches the backend, but the reply never comes (no signal);
// - drop: it never reaches the backend (no signal); the body is kept in
//   `dropped`, so a test can make it land late with backend.handle(body).
function hold(backend, action) {
  const real = backend.handle;
  let release;
  const gate = new Promise((r) => (release = r));
  backend.handle = async (body) => {
    if (body.action !== action) return real(body);
    backend.handle = real;
    const env = await real(body);
    await gate;
    return env;
  };
  return release;
}
function lose(backend, action) {
  const real = backend.handle;
  backend.handle = async (body) => {
    if (body.action !== action) return real(body);
    backend.handle = real;
    await real(body);
    throw new Error("network");
  };
}
function drop(backend, action) {
  const real = backend.handle;
  const dropped = [];
  backend.handle = async (body) => {
    if (body.action !== action) return real(body);
    backend.handle = real;
    dropped.push(body);
    throw new Error("network");
  };
  return dropped;
}
const sentCount = (backend, action) => backend.requests.filter((r) => r.action === action).length;
const removeDay = (backend, date) => {
  const days = backend.fake.tables.Days;
  const i = days.findIndex((r) => String(r.date).slice(0, 10) === date);
  assert.ok(i >= 0, "the day is in the fake's Days tab");
  days.splice(i, 1);
};
// Everything in the sheet as typed, and whether each field can be changed.
const sheetFields = (page) => page.evaluate(() => ["stWhat", "stTime", "stDetail", "stGo", "stMin", "stPlace", "stLink", "stSign"].map((id) => [id, document.getElementById(id).value, document.getElementById(id).disabled]));
const TOWER = { "#stWhat": "Tower Records", "#stTime": "16:00", "#stDetail": "Seven floors", "#stGo": "Walk down Jingumae", "#stMin": "15", "#stPlace": "Tower Records Shibuya", "#stSign": "タワーレコード" };
async function typeTower(page) {
  await openAdd(page);
  for (const [sel, v] of Object.entries(TOWER)) await page.fill(sel, v);
}
async function typedIntact(page) {
  for (const [sel, v] of Object.entries(TOWER)) assert.equal(await value(page, sel), v, sel + " is kept");
}

// History's rows, newest first.
const tape = (page) => page.$$eval("#tape .tp-row", (rows) => rows.map((r) => ({
  id: r.dataset.id,
  sentence: r.querySelector(".tp-s").textContent,
  undo: r.querySelector("button.tp-undo") !== null,
})));
async function openHistory(page) {
  await page.click('#nav button[data-tab="money"]');
  await page.click("#histBtn");
  await until(async () => (await tape(page)).length > 0, "History shows its entries");
}

// "ok", or why the element is not on screen and tappable (as in small.e2e.cjs).
function reach(page, selector, scroll = false) {
  return page.evaluate(
    ([sel, scroll]) => {
      const el = document.querySelector(sel);
      if (!el) return "missing";
      if (scroll) el.scrollIntoView({ block: "center", inline: "nearest" });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return "not drawn";
      if (r.top < -0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5) {
        return "off screen: top " + Math.round(r.top) + ", bottom " + Math.round(r.bottom) + " of " + innerHeight;
      }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) return "covered by " + (hit ? hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") + "." + hit.className : "nothing");
      return "ok";
    },
    [selector, scroll],
  );
}

module.exports = [
  {
    name: "a failed stop edit survives closing and reloading, says so at the top, until Discard draft",
    async run({ page }) {
      const backend = await ready(page);
      await openEdit(page, SKY);
      const original = await value(page, "#stDetail");
      await page.fill("#stDetail", "Draft meeting point");
      // Typing in an ordinary edit: no Discard draft and no line yet.
      assert.equal(await visible(page, "#stDiscard"), false, "no Discard draft while typing");
      assert.equal(await visible(page, "#stBack"), false, "no brought-back line while typing");
      backend.failWith = "network";
      await page.click("#stSave");
      await until(async () => !(await disabled(page, "#stDone")), "Done is available after the failed save");
      assert.equal(await visible(page, "#stDiscard"), false, "a failed save brings nothing back, so no Discard draft");
      await page.click("#stDone");
      await waitSheetClosed(page);
      backend.failWith = null;
      await page.reload();
      await until(() => visible(page, row(SKY)), "the stop is back");
      await openEdit(page, SKY);
      assert.equal(await value(page, "#stDetail"), "Draft meeting point");
      assert.equal(await visible(page, "#stBack"), true, "the line says the typing is back");
      assert.equal(await text(page, "#stBack"), "Your unsaved changes are back.");
      assert.equal(await visible(page, "#stDiscard"), true);
      assert.equal(await text(page, "#stDiscard"), "Discard draft");
      // The line is the first thing in the sheet, above the day.
      const order = await page.evaluate(() => document.getElementById("stBack").getBoundingClientRect().bottom <= document.getElementById("stDay").getBoundingClientRect().top + 0.5);
      assert.ok(order, "the line sits at the top of the sheet");
      // Discard draft is drawn as the sheet's secondary button (as Remove), not the browser's.
      const look = await page.evaluate(() => {
        const pick = (id) => {
          const c = getComputedStyle(document.getElementById(id));
          return [c.borderTopWidth, c.borderTopStyle, c.borderTopColor, c.backgroundColor, c.color, c.borderRadius, c.fontWeight, c.height];
        };
        return { discard: pick("stDiscard"), remove: pick("stDel") };
      });
      assert.deepEqual(look.discard, look.remove);
      // Pictures: the top (the line) and the foot (Discard draft above Save), 390 and 320 wide.
      const foot = (to) => page.evaluate((end) => {
        const sh = document.getElementById("stop");
        sh.scrollTop = end ? sh.scrollHeight : 0;
      }, to);
      for (const [w, h] of [[390, 844], [320, 700]]) {
        await page.setViewportSize({ width: w, height: h });
        await foot(false);
        await shot(page, "stop-draft-restored-" + w + ".png");
        await foot(true);
        await shot(page, "stop-draft-restored-" + w + "-foot.png");
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await foot(false);
      await page.click("#stDiscard");
      assert.equal(await value(page, "#stDetail"), original);
      assert.equal(await visible(page, "#stBack"), false, "the line goes with the draft");
      assert.equal(await visible(page, "#stDiscard"), false);
      await page.click("#stDone");
      await openEdit(page, SKY);
      assert.equal(await visible(page, "#stDiscard"), false);
      assert.equal(await visible(page, "#stBack"), false);
    },
  },
  {
    name: "a new stop whose save failed comes back on that day with its first id, and Discard draft clears it",
    async run({ page }) {
      const backend = await ready(page);
      await openAdd(page);
      await page.fill("#stWhat", "Walk");
      backend.failWith = "network";
      await page.click("#stSave");
      await until(async () => !(await disabled(page, "#stDone")), "Done is available after the failed save");
      await page.click("#stDone");
      await waitSheetClosed(page);
      backend.failWith = null;
      const firstId = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("mat.stopDraft.")).map((k) => JSON.parse(k.slice(14)).at(-1)));
      assert.equal(firstId.length, 1);
      await page.reload();
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
      await openAdd(page);
      assert.equal(await value(page, "#stWhat"), "Walk", "the typing is back");
      assert.equal(await text(page, "#stBack"), "Your unsaved changes are back.");
      assert.equal(await visible(page, "#stDiscard"), true);
      await page.click("#stDiscard");
      assert.equal(await value(page, "#stWhat"), "");
      assert.equal(await visible(page, "#stBack"), false);
      assert.equal(await visible(page, "#stDiscard"), false);
      await page.click("#stDone");
      await waitSheetClosed(page);
      await openAdd(page);
      assert.equal(await value(page, "#stWhat"), "", "nothing comes back after Discard draft");
      assert.equal(await visible(page, "#stDiscard"), false);
      const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("mat.stopDraft.")).length);
      assert.equal(left, 0, "no draft is left on the phone");
      // Typed again, closed, and saved on the next opening: one stop, with the kept id.
      await page.fill("#stWhat", "Walk");
      await page.click("#stDone");
      await waitSheetClosed(page);
      const keptId = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("mat.stopDraft.")).map((k) => JSON.parse(k.slice(14)).at(-1))[0]);
      await openAdd(page);
      assert.equal(await value(page, "#stWhat"), "Walk");
      await page.click("#stSave");
      await waitSheetClosed(page);
      await idle(page);
      const sent = backend.requests.filter((r) => r.action === "addStop");
      assert.equal(sent.length, 1);
      assert.equal(sent[0].args.stop.id, keptId, "the retry reuses the draft's id");
      assert.equal((await rowTitles(page, D12)).filter((t) => t === "Walk").length, 1);
      const after = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("mat.stopDraft.")).length);
      assert.equal(after, 0, "a saved stop leaves no draft");
    },
  },
  {
    name: "new stops abandoned on the same day: the newest comes back and the older drafts are taken off",
    async run({ page }) {
      await ready(page);
      for (const title of ["Walk", "Lunch"]) {
        await openAdd(page);
        // The second opening brings Walk back; Lunch replaces it.
        await page.fill("#stWhat", title);
        await page.click("#stDone");
        await waitSheetClosed(page);
      }
      // An older orphan from before (another try's id) on the same day, and one on a day the trip doesn't have.
      await page.evaluate(([day]) => {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith("mat.stopDraft."));
        const scope = JSON.parse(keys[0].slice(14));
        localStorage.setItem("mat.stopDraft." + JSON.stringify([...scope.slice(0, 4), day, "orphan001"]), JSON.stringify({ fields: { stWhat: "Old" }, base: { stWhat: "" }, savedAt: 1 }));
        localStorage.setItem("mat.stopDraft." + JSON.stringify([...scope.slice(0, 4), "2025-01-01", "orphan002"]), JSON.stringify({ fields: { stWhat: "Gone day" }, base: { stWhat: "" }, savedAt: 2 }));
      }, [D12]);
      await page.reload();
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
      await until(() => page.evaluate(() => !Object.keys(localStorage).some((k) => k.includes("orphan002"))), "the draft on a day the trip doesn't have is pruned at load");
      await openAdd(page);
      assert.equal(await value(page, "#stWhat"), "Lunch", "the newest draft comes back");
      const drafts = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("mat.stopDraft.")).map((k) => JSON.parse(localStorage.getItem(k)).fields.stWhat));
      assert.deepEqual(drafts, ["Lunch"], "one draft for the day: the older ones are gone");
    },
  },
  {
    name: "add a stop",
    async run({ page }) {
      const backend = await ready(page);
      await expectText(page, tk(D12) + " .tk-add", "＋ Add a stop");
      const rows = backend.fake.tables.Stops.length;
      await addTower(page);
      await until(async () => (await rowTitles(page, D12)).includes("Tower Records"), "Tower Records is on the ticket");
      assert.deepEqual(await rowTitles(page, D12), ["Meiji Shrine", "Lunch in Harajuku", "Shibuya Sky", "Tower Records", "Dinner", "Buy gloves"]);
      await expectText(page, "#ubarT", "Added Tower Records.");
      await idle(page);
      assert.equal(backend.fake.tables.Stops.length, rows + 1);
      const added = backend.fake.tables.Stops.at(-1);
      assert.equal(added.date, D12);
      assert.equal(added.title, "Tower Records");
      assert.equal(added.time, "16:00");
    },
  },
  {
    name: "undo from the bar",
    async run({ page }) {
      const backend = await ready(page);
      await addTower(page);
      await idle(page);
      await until(async () => (await rowTitles(page, D12)).includes("Tower Records"), "Tower Records is on the ticket");
      await page.click("#ubarU");
      await until(async () => !(await rowTitles(page, D12)).includes("Tower Records"), "the row is gone");
      await expectText(page, "#ubarT", "Undone.");
      await idle(page);
      const added = backend.fake.tables.Stops.find((r) => r.title === "Tower Records");
      assert.ok(added, "the Sheet row is still there");
      assert.ok(added.deleted_at, "marked deleted: " + JSON.stringify(added));
    },
  },
  {
    name: "edit a stop",
    async run({ page }) {
      const backend = await ready(page);
      await openEdit(page, SKY);
      assert.equal(await value(page, "#stWhat"), "Shibuya Sky");
      assert.equal(await page.evaluate(() => document.getElementById("stFixed").checked), true, "the time can’t slip is on");
      assert.equal(await text(page, "#stSave"), "Save");
      assert.equal(await text(page, "#stDel"), "Remove");
      await page.fill("#stTime", "15:00");
      await page.fill("#stMin", "20");
      await page.click("#stSave");
      await waitSheetClosed(page);
      await expectText(page, row(SKY) + " .r-t", "15:00");
      await expectText(page, row(SKY) + " .r-lv", "Leave by 14:40, in 1 h 20 min.");
      await expectText(page, "#ubarT", "Changed Shibuya Sky.");
      await idle(page);
      const saved = backend.fake.tables.Stops.find((r) => r.id === SKY);
      assert.deepEqual([saved.time, Number(saved.travel_min), saved.title], ["15:00", 20, "Shibuya Sky"]);
      assert.equal(backend.requests.filter((r) => r.action === "updateStop").length, 1);
      assert.deepEqual(Object.keys(backend.requests.find((r) => r.action === "updateStop").args.patch).sort(), ["time", "travelMin"], "only what changed is sent");
    },
  },
  {
    name: "remove a stop, and bring it back from History",
    async run({ page }) {
      await ready(page);
      await openEdit(page, DINNER);
      await page.click("#stDel");
      await waitSheetClosed(page);
      await until(async () => !(await rowTitles(page, D12)).includes("Dinner"), "Dinner is gone");
      await expectText(page, "#ubarT", "Removed Dinner.");
      await idle(page);
      await openHistory(page);
      const top = (await tape(page))[0];
      assert.equal(top.sentence, "Mo removed Dinner from Sat Dec 12");
      assert.equal(top.undo, true);
      await page.click('#tape .tp-row[data-id="' + top.id + '"] button.tp-undo');
      await until(async () => (await tape(page)).some((r) => r.sentence.startsWith("Mo undid")), "the undo is on the tape");
      await page.click("#histDone");
      await page.click('#nav button[data-tab="days"]');
      await until(async () => (await rowTitles(page, D12)).includes("Dinner"), "Dinner is back on the ticket");
    },
  },
  {
    name: "a stop added by Claude says so in History",
    async run({ page }) {
      const backend = await ready(page);
      // The connector's own path (a phone saying via claude is ignored since the security fix round).
      const env = await backend.fake.claude("addStop", { stop: { id: "claudestop01", date: D12, time: "16:30", title: "Tokyu Hands" } });
      assert.equal(env.ok, true, JSON.stringify(env));
      await openHistory(page);
      const top = (await tape(page))[0];
      assert.ok(top.sentence.endsWith("(through Claude)"), top.sentence);
      assert.ok(top.sentence.startsWith("Mo added Tokyu Hands"), top.sentence);
    },
  },
  {
    name: "no name, no save",
    async run({ page }) {
      await ready(page);
      await openAdd(page);
      assert.equal(await text(page, "#stSave"), "Add stop");
      assert.equal(await page.evaluate(() => !!document.getElementById("stDel") && !document.getElementById("stDel").hidden), false, "no Remove when adding");
      assert.equal(await disabled(page, "#stSave"), true);
      await page.fill("#stWhat", "   ");
      assert.equal(await disabled(page, "#stSave"), true);
      await page.fill("#stWhat", "Tower Records");
      assert.equal(await disabled(page, "#stSave"), false);
      await page.fill("#stWhat", "");
      assert.equal(await disabled(page, "#stSave"), true);
      // The keyboard's Next moves on to the next field; nothing is saved.
      await page.fill("#stWhat", "Tower Records");
      await page.press("#stWhat", "Enter");
      assert.equal(await page.evaluate(() => document.activeElement.id), "stTime");
      assert.equal(await isOpen(page, "stop"), true);
    },
  },
  {
    name: "no signal",
    async run({ page }) {
      const backend = await ready(page);
      backend.failWith = "network";
      await advance(page, backend, 20000);
      await until(() => page.evaluate(() => globalThis.__matTest.store.state.online === false), "the app learns it is offline");
      await openAdd(page);
      await page.fill("#stWhat", "Tower Records");
      assert.equal(await disabled(page, "#stSave"), true);
      assert.ok((await text(page, "#stop")).includes("No signal. Stops need a connection."), await text(page, "#stop"));
      // Signal back: Save comes on, and the words go.
      backend.failWith = null;
      await advance(page, backend, 20000);
      await until(async () => !(await disabled(page, "#stSave")), "Save comes on with signal");
      assert.equal((await text(page, "#stop")).includes("No signal."), false);
    },
  },
  {
    name: "a bad link is refused in the backend's words, with everything typed kept (R33 b)",
    async run({ page }) {
      const backend = await ready(page);
      const rows = backend.fake.tables.Stops.length;
      await openAdd(page);
      const typed = {
        "#stWhat": "Tower Records", "#stTime": "16:00", "#stDetail": "Seven floors of records", "#stGo": "Walk from Shibuya Sky",
        "#stMin": "15", "#stPlace": "Tower Records Shibuya", "#stLink": "javascript:alert(1)", "#stSign": "タワーレコード",
      };
      for (const [sel, v] of Object.entries(typed)) await page.fill(sel, v);
      await page.click("#stFixed");
      await page.click("#stSave");
      await expectText(page, "#stMsg", "That link has to start with https://.");
      assert.equal(await isOpen(page, "stop"), true, "the sheet stays open");
      for (const [sel, v] of Object.entries(typed)) assert.equal(await value(page, sel), v, sel + " is kept");
      assert.equal(await page.evaluate(() => document.getElementById("stFixed").checked), true);
      assert.equal(await page.evaluate(() => document.activeElement.id), "stLink", "the field to correct has focus");
      await idle(page);
      assert.equal((await rowTitles(page, D12)).includes("Tower Records"), false);
      assert.equal(backend.fake.tables.Stops.length, rows);
      assert.equal(backend.requests.filter((r) => r.action === "addStop").length, 0, "nothing sent, so nothing in History");
      // Minutes past what the backend takes are refused in its words too.
      await page.fill("#stLink", "https://example.test/tower");
      assert.equal(await text(page, "#stMsg"), "", "correcting a field clears the reason");
      await page.fill("#stMin", "700");
      await page.click("#stSave");
      await expectText(page, "#stMsg", "Minutes to get there must be a whole number from 0 to 600.");
      await page.fill("#stMin", "15");
      await page.click("#stSave");
      await waitSheetClosed(page);
      await idle(page);
      const added = backend.fake.tables.Stops.at(-1);
      assert.deepEqual([added.title, added.link, Number(added.travel_min)], ["Tower Records", "https://example.test/tower", 15]);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll("#rail a")].some((a) => /^javascript:/i.test(a.getAttribute("href") || ""))), false);
    },
  },
  {
    name: "a place that starts like a link must be a good one",
    async run({ page }) {
      await ready(page);
      await openAdd(page);
      await page.fill("#stWhat", "Tower Records");
      await page.fill("#stPlace", "https://maps example");
      await page.click("#stSave");
      await expectText(page, "#stMsg", "That map link didn’t come through properly.");
      assert.equal(await isOpen(page, "stop"), true);
      assert.equal(await page.evaluate(() => document.getElementById("stLink").maxLength), 500, "the ticket link is kept to the backend's 500");
    },
  },
  {
    name: "a tap outside closes the sheet only when nothing was changed (R33 a)",
    async run({ page }) {
      await ready(page);
      const outside = () => page.click("#stopScrim", { position: { x: 195, y: 20 } });
      await openAdd(page);
      await outside();
      await waitSheetClosed(page);
      await openAdd(page);
      await page.fill("#stWhat", "Tower Records");
      await outside();
      await page.waitForTimeout(100);
      assert.equal(await isOpen(page, "stop"), true, "a changed sheet stays open");
      await page.fill("#stWhat", "");
      await outside();
      await waitSheetClosed(page);
      // Editing: the same, and the switch counts as a change.
      await openEdit(page, SKY);
      await page.click("#stFixed");
      await outside();
      await page.waitForTimeout(100);
      assert.equal(await isOpen(page, "stop"), true);
      await page.click("#stFixed");
      await outside();
      await waitSheetClosed(page);
      // Done still closes a changed sheet.
      await openAdd(page);
      await page.fill("#stWhat", "Tower Records");
      await page.click("#stDone");
      await waitSheetClosed(page);
    },
  },
  {
    name: "Next goes through every field, and Enter in the directions is left alone",
    async run({ page }) {
      await ready(page);
      await openAdd(page);
      await page.press("#stDetail", "Enter");
      assert.equal(await page.evaluate(() => document.activeElement.id), "stGo");
      await page.fill("#stGo", "Walk");
      await page.press("#stGo", "Enter");
      assert.equal(await page.evaluate(() => document.activeElement.id), "stGo", "Enter stays in the directions");
      assert.equal(await value(page, "#stGo"), "Walk\n");
      await page.press("#stMin", "Enter");
      assert.equal(await page.evaluate(() => document.activeElement.id), "stPlace");
    },
  },
  {
    name: "Escape while composing Japanese does not close the sheet",
    async run({ page }) {
      await ready(page);
      await openAdd(page);
      await page.fill("#stSign", "たわ");
      await page.evaluate(() => document.getElementById("stSign").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true })));
      await page.waitForTimeout(100);
      assert.equal(await isOpen(page, "stop"), true);
      assert.equal(await value(page, "#stSign"), "たわ");
      await page.press("#stSign", "Escape");
      await waitSheetClosed(page);
    },
  },
  {
    name: "the stop being changed is removed on another phone: the sheet says so and keeps what was typed",
    async run({ page }) {
      const backend = await ready(page);
      await openEdit(page, SKY);
      await page.fill("#stDetail", "Gate B");
      let env = await backend.handle({ key: "test-key", actor: "Ajen", via: "app", action: "deleteStop", args: { id: SKY } });
      assert.equal(env.ok, true, JSON.stringify(env));
      await advance(page, backend, 20000);
      await expectText(page, "#stMsg", "Someone removed this stop, so it can’t be saved.");
      assert.equal(await isOpen(page, "stop"), true);
      assert.equal(await value(page, "#stDetail"), "Gate B");
      assert.equal(await disabled(page, "#stSave"), true);
      assert.equal(await disabled(page, "#stDel"), true);
      // Put back on that phone: the sheet can save again.
      env = await backend.handle({ key: "test-key", actor: "Ajen", via: "app", action: "restoreStop", args: { id: SKY } });
      assert.equal(env.ok, true, JSON.stringify(env));
      await advance(page, backend, 20000);
      await until(async () => !(await disabled(page, "#stSave")), "Save comes back on");
      assert.equal(await text(page, "#stMsg"), "");
    },
  },
  {
    name: "the field being typed in is kept in view when the visible area scrolls",
    async run({ page }) {
      await ready(page);
      await openAdd(page);
      await page.focus("#stSign");
      await page.evaluate(() => { document.getElementById("stop").scrollTop = 0; });
      const below = () => page.evaluate(() => {
        const f = document.getElementById("stSign").getBoundingClientRect();
        return f.bottom > document.getElementById("stop").getBoundingClientRect().bottom;
      });
      assert.equal(await below(), true, "the field starts out of the sheet's view");
      await page.evaluate(() => visualViewport.dispatchEvent(new Event("scroll")));
      await until(async () => !(await below()), "a visual-viewport scroll brings it back into view");
    },
  },
  {
    name: "a sync does not wipe what you are typing",
    async run({ page }) {
      const backend = await ready(page);
      await openAdd(page);
      await page.fill("#stWhat", "Half a na");
      await page.focus("#stWhat");
      const env = await backend.handle({ key: "test-key", actor: "Ajen", via: "app", action: "addStop", args: { stop: { id: "ajenstop0001", date: D12, time: "16:00", title: "Tower Records" } } });
      assert.equal(env.ok, true, JSON.stringify(env));
      await advance(page, backend, 20000);
      await until(() => page.evaluate(() => !!document.querySelector('.r[data-id="ajenstop0001"]')), "Ajen’s stop is on the ticket");
      assert.equal(await value(page, "#stWhat"), "Half a na");
      assert.equal(await isOpen(page, "stop"), true);
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "stWhat", "the field keeps focus");
      await expectText(page, "#dayCount", /^Day 3 of 11/);
    },
  },
  {
    name: "editing: another phone's change to the same stop does not wipe what you typed",
    async run({ page }) {
      const backend = await ready(page);
      await openEdit(page, SKY);
      await page.fill("#stDetail", "Booked for 14:00, gate B");
      const env = await backend.handle({ key: "test-key", actor: "Ajen", via: "app", action: "updateStop", args: { id: SKY, patch: { note: "Bring the QR code." } } });
      assert.equal(env.ok, true, JSON.stringify(env));
      await advance(page, backend, 20000);
      await idle(page);
      assert.equal(await isOpen(page, "stop"), true);
      assert.equal(await value(page, "#stDetail"), "Booked for 14:00, gate B");
      await page.click("#stSave");
      await waitSheetClosed(page);
      await idle(page);
      const saved = backend.fake.tables.Stops.find((r) => r.id === SKY);
      assert.equal(saved.detail, "Booked for 14:00, gate B");
      assert.equal(saved.note, "Bring the QR code.", "Ajen’s note is kept: only the changed field was sent");
    },
  },
  {
    name: "another phone sees it",
    async run(ctx) {
      const { page } = ctx;
      const backend = await ready(page);
      const b = await ctx.newPhone();
      await ready(b, { backend, me: "Ajen" });
      await addTower(page);
      await idle(page);
      await advance(b, backend, 20000);
      await until(async () => (await rowTitles(b, D12)).includes("Tower Records"), "the other phone shows Tower Records");
    },
  },
  {
    name: "closing gives focus back, and one sheet at a time",
    async run({ page }) {
      await ready(page);
      await openAdd(page);
      assert.equal(await page.evaluate(() => document.getElementById("vDays").contains(document.activeElement)), false, "focus is in the sheet");
      await page.click("#stDone");
      await waitSheetClosed(page);
      assert.equal(await page.evaluate((sel) => document.activeElement === document.querySelector(sel + " .tk-add"), tk(D12)), true, "focus back on ＋ Add a stop");
      await openAdd(page);
      await page.keyboard.press("Escape");
      await waitSheetClosed(page);
      // The hotel card closes the stop sheet, and the stop sheet the hotel card.
      await page.click(tk(D12) + " .tk-stay");
      await until(() => isOpen(page, "stay"), "the hotel card opens");
      await page.click("#stayDone");
      await until(async () => !(await isOpen(page, "stay")), "the hotel card closes");
      await openAdd(page);
      await page.evaluate(() => document.getElementById("dayCount").click());
      await until(() => isOpen(page, "allDays"), "the all-days list opens");
      assert.equal(await isOpen(page, "stop"), false, "the stop sheet closed for it");
    },
  },
  {
    name: "the add row and Edit are kept as the minute moves on",
    async run({ page }) {
      const backend = await ready(page);
      await page.evaluate(([t, s]) => {
        document.querySelector(t + " .tk-add").__kept = 1;
        document.querySelector(s).__kept = 1;
        document.querySelector(s + " .r-edit").__kept = 1;
      }, [tk(D12), row(SKY)]);
      await advance(page, backend, 60000);
      await until(async () => (await text(page, row(SKY) + " .r-lv")) === "Leave by 13:30, in 9 min.", "the line moves on");
      const kept = await page.evaluate(([t, s]) => ({
        add: document.querySelectorAll(t + " .tk-add").length === 1 && document.querySelector(t + " .tk-add").__kept === 1,
        row: document.querySelector(s).__kept === 1,
        edit: document.querySelectorAll(s + " .r-edit").length === 1 && document.querySelector(s + " .r-edit").__kept === 1,
      }), [tk(D12), row(SKY)]);
      assert.deepEqual(kept, { add: true, row: true, edit: true });
      assert.equal(await page.evaluate(() => document.querySelectorAll("#rail .tk-add").length), 11, "one add row per ticket");
    },
  },
  {
    name: "back after a night away with the stop sheet open: the rail and the sheet stay (R32)",
    async run({ page }) {
      const backend = await ready(page, { nowMs: Date.parse("2026-12-12T23:40:00+09:00") });
      await expectText(page, "#dayCount", /^Day 3 of 11 ?today$/);
      await openAdd(page);
      await page.fill("#stWhat", "Late ramen");
      await setHidden(page, true);
      await advance(page, backend, 50 * 60000);
      await setHidden(page, false);
      await advance(page, backend, 1000);
      await expectText(page, "#dayCount", /^Day 3 of 11 ?used$/);
      assert.equal(await page.evaluate(() => document.querySelector("#pager .sq.is-cur").dataset.i), "2", "Dec 12 is still the day in view");
      assert.equal(await isOpen(page, "stop"), true);
      assert.equal(await value(page, "#stWhat"), "Late ramen");
      await page.click("#stSave");
      await waitSheetClosed(page);
      await idle(page);
      assert.equal(backend.fake.tables.Stops.at(-1).date, D12, "added to the day it was opened on");
    },
  },
  {
    name: "reachable in a Safari tab",
    viewport: { width: 390, height: 664 },
    async run({ page }) {
      await ready(page);
      await openEdit(page, SKY);
      let got;
      try {
        await until(async () => (got = await reach(page, "#stSave", true)) === "ok", "");
      } catch {
        throw new Error("#stSave is not on screen and tappable at 390x664: " + got);
      }
      await page.click("#stSave");
      await waitSheetClosed(page);
    },
  },
  {
    name: "R36: Save waits for a slow reply: the sheet says Saving…, is inert, then closes with the stop on the ticket",
    async run({ page }) {
      const backend = await ready(page);
      const rows = backend.fake.tables.Stops.length;
      await typeTower(page);
      const release = hold(backend, "addStop");
      await page.click("#stSave");
      await until(() => sentCount(backend, "addStop") === 1, "the add reaches the backend");
      await expectText(page, "#stSave", "Saving…");
      assert.equal(await isOpen(page, "stop"), true);
      assert.equal(await disabled(page, "#stSave"), true);
      assert.equal(await disabled(page, "#stDone"), true);
      assert.ok((await sheetFields(page)).every(([, , off]) => off), "no field can be changed while saving");
      // Done, Escape and a tap outside do not close it.
      await page.evaluate(() => document.getElementById("stDone").click());
      await page.keyboard.press("Escape");
      await page.click("#stopScrim", { position: { x: 195, y: 20 } });
      await page.waitForTimeout(100);
      assert.equal(await isOpen(page, "stop"), true, "still open while saving");
      assert.equal(await page.evaluate(() => document.getElementById("ubar").hidden), true, "nothing on the bar yet");
      release();
      await waitSheetClosed(page);
      await until(async () => (await rowTitles(page, D12)).includes("Tower Records"), "Tower Records is on the ticket");
      await expectText(page, "#ubarT", "Added Tower Records.");
      await idle(page);
      assert.equal(backend.fake.tables.Stops.length, rows + 1);
      assert.equal(sentCount(backend, "addStop"), 1);
    },
  },
  {
    name: "R36: a double tap on Save sends one request",
    async run({ page }) {
      const backend = await ready(page);
      await typeTower(page);
      const release = hold(backend, "addStop");
      await page.evaluate(() => {
        const b = document.getElementById("stSave");
        b.click();
        b.click();
        b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await until(() => sentCount(backend, "addStop") === 1, "the add reaches the backend");
      release();
      await waitSheetClosed(page);
      await idle(page);
      assert.equal(sentCount(backend, "addStop"), 1);
      assert.equal(backend.fake.tables.Stops.filter((r) => r.title === "Tower Records").length, 1);
    },
  },
  {
    name: "R36: refused by the backend only (the day was removed): the sheet stays, typing intact, reason shown, nothing stored",
    async run({ page }) {
      const backend = await ready(page);
      const rows = backend.fake.tables.Stops.length;
      removeDay(backend, D12);
      await typeTower(page);
      await page.click("#stSave");
      await expectText(page, "#stMsg", "Pick a day of the trip.");
      assert.equal(await isOpen(page, "stop"), true);
      await typedIntact(page);
      assert.ok((await sheetFields(page)).every(([, , off]) => !off), "the fields can be corrected");
      assert.equal(await disabled(page, "#stSave"), false, "Save works again");
      await idle(page);
      assert.equal(backend.fake.tables.Stops.length, rows, "nothing stored");
      assert.equal((await rowTitles(page, D12)).includes("Tower Records"), false);
    },
  },
  {
    name: "R36: an edit refused by the backend only keeps what was typed and shows the reason",
    async run({ page }) {
      const backend = await ready(page);
      removeDay(backend, D12);
      await openEdit(page, SKY);
      await page.fill("#stDetail", "Gate B");
      await page.click("#stSave");
      await expectText(page, "#stMsg", "Pick a day of the trip.");
      assert.equal(await isOpen(page, "stop"), true);
      assert.equal(await value(page, "#stDetail"), "Gate B");
      await idle(page);
      assert.notEqual(backend.fake.tables.Stops.find((r) => r.id === SKY).detail, "Gate B");
    },
  },
  {
    name: "R36: no reply and the stop did not land: the sheet says so, keeps the typing, and Save again makes exactly one stop",
    async run({ page }) {
      const backend = await ready(page);
      const rows = backend.fake.tables.Stops.length;
      await typeTower(page);
      const releaseRev = hold(backend, "rev"); // before drop: each puts back the handler it found
      drop(backend, "addStop");
      await page.click("#stSave");
      await expectText(page, "#stMsg", "No answer from the trip sheet yet. Checking whether it was saved…");
      assert.equal(await isOpen(page, "stop"), true);
      releaseRev();
      await expectText(page, "#stMsg", "That wasn’t saved. Tap Add stop to try again.");
      assert.equal(await isOpen(page, "stop"), true);
      await typedIntact(page);
      assert.equal((await text(page, "#stop")).includes("Someone removed"), false);
      assert.equal(await disabled(page, "#stSave"), false);
      assert.equal(backend.fake.tables.Stops.length, rows);
      await page.click("#stSave");
      await waitSheetClosed(page);
      await idle(page);
      assert.equal(backend.fake.tables.Stops.length, rows + 1, "exactly one stop");
      await until(async () => (await rowTitles(page, D12)).includes("Tower Records"), "Tower Records is on the ticket");
    },
  },
  {
    name: "R36: no reply and the stop did land: the sheet closes as saved, one stop",
    async run({ page }) {
      const backend = await ready(page);
      const rows = backend.fake.tables.Stops.length;
      await typeTower(page);
      lose(backend, "addStop");
      await page.click("#stSave");
      await waitSheetClosed(page);
      await until(async () => (await rowTitles(page, D12)).includes("Tower Records"), "Tower Records is on the ticket");
      await expectText(page, "#ubarT", "Added Tower Records.");
      await idle(page);
      assert.equal(backend.fake.tables.Stops.length, rows + 1);
      assert.equal(sentCount(backend, "addStop"), 1);
    },
  },
  {
    name: "R36: a retry after the first try landed late keeps one stop, with what was typed since",
    async run({ page }) {
      const backend = await ready(page);
      const rows = backend.fake.tables.Stops.length;
      await typeTower(page);
      const dropped = drop(backend, "addStop");
      await page.click("#stSave");
      await expectText(page, "#stMsg", "That wasn’t saved. Tap Add stop to try again.");
      // The first request reaches the Sheet after the check.
      const late = await backend.handle(dropped[0]);
      assert.equal(late.ok, true, JSON.stringify(late));
      await page.fill("#stDetail", "Seven floors of records");
      await page.click("#stSave");
      await waitSheetClosed(page);
      await idle(page);
      assert.equal(backend.fake.tables.Stops.length, rows + 1, "one stop");
      assert.equal(backend.fake.tables.Stops.at(-1).detail, "Seven floors of records");
      await expectText(page, '.r[data-id="' + dropped[0].args.stop.id + '"] .r-n', /Tower Records/);
    },
  },
  {
    name: "R36: an edit with no reply: landed closes as saved; not landed says so and Save again saves it",
    async run({ page }) {
      const backend = await ready(page);
      await openEdit(page, SKY);
      await page.fill("#stTime", "15:00");
      lose(backend, "updateStop");
      await page.click("#stSave");
      await waitSheetClosed(page);
      await expectText(page, row(SKY) + " .r-t", "15:00");
      await idle(page);
      assert.equal(backend.fake.tables.Stops.find((r) => r.id === SKY).time, "15:00");
      await openEdit(page, SKY);
      await page.fill("#stTime", "15:30");
      drop(backend, "updateStop");
      await page.click("#stSave");
      await expectText(page, "#stMsg", "That wasn’t saved. Tap Save to try again.");
      assert.equal(await value(page, "#stTime"), "15:30");
      assert.equal(backend.fake.tables.Stops.find((r) => r.id === SKY).time, "15:00");
      await page.click("#stSave");
      await waitSheetClosed(page);
      await expectText(page, row(SKY) + " .r-t", "15:30");
      await idle(page);
      assert.equal(backend.fake.tables.Stops.find((r) => r.id === SKY).time, "15:30");
    },
  },
  {
    name: "R36: closed with Done while it checks, and it did not land: the bar says so",
    async run({ page }) {
      const backend = await ready(page);
      await typeTower(page);
      const releaseRev = hold(backend, "rev");
      drop(backend, "addStop");
      await page.click("#stSave");
      await expectText(page, "#stMsg", "No answer from the trip sheet yet. Checking whether it was saved…");
      assert.equal(await disabled(page, "#stDone"), false, "Done works while it checks");
      await page.click("#stDone");
      await waitSheetClosed(page);
      releaseRev();
      await expectText(page, "#ubarT", "That stop wasn’t saved.");
      assert.equal((await rowTitles(page, D12)).includes("Tower Records"), false);
    },
  },
];
