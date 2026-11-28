// Attaching a ticket from the stop's Edit sheet (js/views/ticketpart.js):
// pick pictures or a PDF, say who each is for, type the facts, Save; another
// phone sees it; Remove and Undo. Every file is made up by the test
// (tests/e2e/pictures.cjs). The plan is tests/fixtures/plan.json; 13:20 on Dec 12.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { WITH_PLAN, makeBackend, open, until, atRest, text, expectText } = require("./helpers.cjs");
const { pngBytes, pdfBytes, SVG } = require("./pictures.cjs");

const SHOTS = require("./shots.cjs")("tickets");
const D12 = "2026-12-12";
const SKY = "planstop1203";
const LUNCH = "planstop1202";
const NOON12 = Date.parse("2026-12-12T13:20:00+09:00");

const SIZES = [
  { tag: "393", viewport: { width: 393, height: 852 } },
  { tag: "320", viewport: { width: 320, height: 568 } },
  { tag: "844", viewport: { width: 844, height: 390 } },
  { tag: "1440", viewport: { width: 1440, height: 900 }, mobile: false },
];

const row = (id) => '#rail .pg[data-date="' + D12 + '"] .r[data-id="' + id + '"]';
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
};
const file = (name, mimeType, buffer) => ({ name, mimeType, buffer });

async function ready(page, opts) {
  const backend = await open(page, { tab: "days", ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}
async function openRow(page, id) {
  const isOpen = await page.evaluate((sel) => document.querySelector(sel).classList.contains("is-open"), row(id));
  if (!isOpen) await page.dispatchEvent(row(id) + " .r-b", "click");
  await until(() => page.evaluate((sel) => {
    const r = document.querySelector(sel);
    const d = r.querySelector(".r-more > div");
    return r.classList.contains("is-open") && d && d.clientHeight === d.scrollHeight;
  }, row(id)), "the stop opens");
}
async function edit(page, id) {
  await openRow(page, id);
  await page.dispatchEvent(row(id) + " .r-edit", "click");
  await atRest(page, "#stop", { message: "the stop sheet opens" });
}
const picked = (page) => page.evaluate(() => [...document.querySelectorAll("#stTix .tkp-picked .file")].map((r) => ({
  name: r.querySelector(".file-n").firstChild.textContent,
  for: (r.querySelector(".file-for .is-on") || {}).textContent,
})));
const waitPicked = (page, n) => until(async () => (await picked(page)).length === n, n + " pictures picked", 15000);
const sheetClosed = (page) => atRest(page, "#stop", { open: false, timeout: 15000, message: "the sheet closes" });
const scrollTo = (page, sel) => page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), sel);

const SHOT_DIR = process.env.MAT_TAB_SHOTS || "";
const shotTo = async (page, name) => {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: SHOT_DIR + "/" + name + ".png" });
};

const cases = [];
cases.push({
  name: "the For choice shows a person's picture, or their letter when they have none",
  viewport: SIZES[0].viewport,
  async run({ page }) {
    const backend = makeBackend(WITH_PLAN, { now: NOON12 });
    backend.fake.primitives.updateWhere_("People", "name", "Mo", { photo: require("../fixtures/picture.json").jpeg });
    await ready(page, { backend });
    await edit(page, SKY);
    await page.setInputFiles("#stTkFile", [1, 2, 3].map((i) => file("IMG_" + i + ".PNG", "image/png", pngBytes(400, 400, 70 + i))));
    await waitPicked(page, 3);
    const seals = () => page.evaluate(() => [...document.querySelectorAll("#stTix .tkp-picked .file:nth-child(1) .file-for button[aria-label]")].map((b) => ({
      label: b.getAttribute("aria-label"), pic: b.querySelector(".mini").classList.contains("has-pic"), img: !!b.querySelector(".mini img"), text: b.textContent, on: b.classList.contains("is-on"), pressed: b.getAttribute("aria-pressed"),
    })));
    assert.deepEqual(await seals(), [
      { label: "For Mo", pic: true, img: true, text: "", on: true, pressed: "true" },
      { label: "For Ajen", pic: false, img: false, text: "A", on: false, pressed: "false" },
      { label: "For Trenton", pic: false, img: false, text: "T", on: false, pressed: "false" },
    ]);
    await expectText(page, "#stTix .tkp-picked .file:nth-child(1) .file-for button:first-of-type", "All three");
    await scrollTo(page, "#stTix .tkp-picked");
    await shotTo(page, "for-row");
  },
});
for (const size of SIZES) {
  cases.push({
    name: size.tag + ": three pictures, the three people in order, the facts; saved; another phone sees it; Remove and Undo",
    viewport: size.viewport,
    ...(size.mobile === false ? { mobile: false } : {}),
    async run({ page, newPhone }) {
      const backend = makeBackend(WITH_PLAN, { now: NOON12 });
      await ready(page, { backend });
      await edit(page, SKY);
      assert.equal(await page.evaluate(() => document.getElementById("stTix").hidden), false);
      await expectText(page, "#stTix .st-none", "No ticket on this stop yet.");
      await scrollTo(page, "#stTix");
      await shot(page, "attach-1-edit-" + size.tag);
      await page.setInputFiles("#stTkFile", [1, 2, 3].map((i) => file("IMG_" + i + ".PNG", "image/png", pngBytes(400, 400, 70 + i))));
      await waitPicked(page, 3);
      assert.deepEqual((await picked(page)).map((p) => p.for), ["M", "A", "T"]);
      // One tap changes it: the third is Ajen's, then Trenton's again.
      await page.click('#stTix .tkp-picked .file:nth-child(3) [aria-label="For Ajen"]');
      assert.deepEqual((await picked(page)).map((p) => p.for), ["M", "A", "A"]);
      await page.click('#stTix .tkp-picked .file:nth-child(3) [aria-label="For Trenton"]');
      await page.fill('#stTix .tkp-picked .file:nth-child(1) [data-seat]', "Car 7 · 10A");
      await page.fill("#stTkRef", "TEST-4401");
      await page.fill("#stTkName", "MO");
      await page.fill("#stTkPeople", "3 adults");
      await expectText(page, "#stTix .tkp-h i", "3 pictures");
      await scrollTo(page, "#stTix .tkp-picked");
      await shot(page, "attach-2-picked-" + size.tag);
      await page.dispatchEvent("#stSave", "click");
      await sheetClosed(page);
      const rows = backend.fake.tables.Tickets;
      assert.deepEqual(rows.map((r) => [r.who, r.seat, r.stop]), [["Mo", "Car 7 · 10A", SKY], ["Ajen", "", SKY], ["Trenton", "", SKY]]);
      const sky = backend.fake.tables.Stops.find((s) => s.id === SKY);
      assert.deepEqual([sky.tk_ref, sky.tk_name, sky.tk_people], ["TEST-4401", "MO", "3 adults"]);
      await expectText(page, row(SKY) + " .tk-mark", "券 MOYours · Car 7 · 10A");
      await shot(page, "attach-3-saved-" + size.tag);
      // History has each picture and the facts.
      const h = (await backend.fake({ key: "test-key", action: "history", args: {} })).data.entries.map((e) => e.who + " " + e.summary);
      assert.ok(h.includes("Mo added Trenton’s ticket to Shibuya Sky"), h.join("\n"));
      assert.ok(h.includes("Mo changed Shibuya Sky: ticket"), h.join("\n"));

      // Another phone, the same trip: it fetches the pictures and shows them.
      const other = await newPhone();
      await ready(other, { backend, me: "Trenton" });
      await until(() => other.evaluate((sel) => {
        const b = document.querySelector(sel + " .tk-mark b");
        return !!b && !b.classList.contains("is-dash");
      }, row(SKY)), "the other phone keeps the pictures", 10000);
      await openRow(other, SKY);
      await other.dispatchEvent(row(SKY) + " .r-tk", "click");
      await until(() => other.evaluate(() => {
        const img = document.querySelector("#tix .stub-code img");
        return !!img && img.naturalWidth > 0;
      }), "the other phone's stub shows the code");
      await expectText(other, "#tix .pp-pg .stub-who", "TTRENTONあなたの券 Your code");
      await expectText(other, "#tix .facts", /TEST-4401/);

      // Remove one on the first phone; Undo brings it back.
      await edit(page, SKY);
      await until(() => page.evaluate(() => document.querySelectorAll("#stTix .tkp-have .file").length === 3), "the three are listed");
      await scrollTo(page, "#stTix .tkp-have");
      await shot(page, "attach-4-have-" + size.tag);
      await page.click('#stTix [aria-label="Remove Ajen’s code"]');
      await until(() => backend.fake.tables.Tickets.find((r) => r.who === "Ajen").gone === "yes", "removed on the backend");
      await expectText(page, "#ubarT", "Removed a ticket picture.");
      await page.click("#ubarU");
      await until(() => backend.fake.tables.Tickets.find((r) => r.who === "Ajen").gone === "", "Undo brings it back");
      await until(() => page.evaluate(() => document.querySelectorAll("#stTix .tkp-have .file").length === 3), "listed again");
    },
  });
}

cases.push({
  name: "one picture is for all three; a PDF becomes pictures of its pages",
  async run({ page }) {
    const backend = makeBackend(WITH_PLAN, { now: NOON12 });
    await ready(page, { backend });
    await edit(page, LUNCH);
    await page.setInputFiles("#stTkFile", [file("one.png", "image/png", pngBytes(300, 300, 9))]);
    await waitPicked(page, 1);
    assert.equal((await picked(page))[0].for, "All three");
    // pdf.js waits on timers: let the page's clock run (it is paused for the other steps).
    await page.clock.resume();
    await page.setInputFiles("#stTkFile", [file("e-ticket.pdf", "application/pdf", pdfBytes(2))]);
    await waitPicked(page, 3);
    assert.deepEqual((await picked(page)).map((p) => p.name), ["one.png", "e-ticket.pdf · page 1", "e-ticket.pdf · page 2"]);
    await shot(page, "attach-pdf-picked-393");
    await page.dispatchEvent("#stSave", "click");
    await sheetClosed(page);
    const rows = backend.fake.tables.Tickets;
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.who === "" && (r.mime === "image/jpeg" || r.mime === "image/png")));
    await expectText(page, row(LUNCH) + " .tk-mark", "券 全3 pages for all of us");
  },
});

cases.push({
  name: "an oversize photo is made smaller before it is sent",
  async run({ page }) {
    const backend = makeBackend(WITH_PLAN, { now: NOON12 });
    await ready(page, { backend });
    await edit(page, SKY);
    const big = pngBytes(3000, 2000, 4, { noise: true });
    assert.ok(big.length > 450000 * 3);
    await page.setInputFiles("#stTkFile", [file("big.png", "image/png", big)]);
    await waitPicked(page, 1);
    await page.dispatchEvent("#stSave", "click");
    await sheetClosed(page);
    const r = backend.fake.tables.Tickets[0];
    assert.ok(Number(r.w) <= 1500 && Number(r.h) <= 1500, r.w + "x" + r.h);
    assert.equal(Math.max(Number(r.w), Number(r.h)), 1500);
    assert.ok(Number(r.size) <= 450000, r.size);
  },
});

cases.push({
  name: "an SVG is refused with a sentence, and nothing is sent",
  async run({ page }) {
    const backend = makeBackend(WITH_PLAN, { now: NOON12 });
    await ready(page, { backend });
    await edit(page, SKY);
    await page.setInputFiles("#stTkFile", [file("code.svg", "image/svg+xml", SVG)]);
    await expectText(page, "#stTix .tkp-say", "That file can’t be a ticket. Only a photo, a screenshot or a PDF can be a ticket.");
    assert.equal((await picked(page)).length, 0);
    assert.equal(await page.evaluate(() => document.querySelectorAll("#stTix img").length), 0);
    await shot(page, "attach-svg-refused-393");
    await page.dispatchEvent("#stSave", "click");
    await sheetClosed(page);
    assert.equal(backend.fake.tables.Tickets.length, 0);
    assert.equal(backend.requests.some((b) => b.action === "addTicket"), false);
  },
});

cases.push({
  name: "a 12-page PDF: only the first 8 are kept, said before Save",
  async run({ page }) {
    const backend = makeBackend(WITH_PLAN, { now: NOON12 });
    await ready(page, { backend });
    await edit(page, SKY);
    await page.clock.resume(); // pdf.js waits on timers
    await page.setInputFiles("#stTkFile", [file("long.pdf", "application/pdf", pdfBytes(12))]);
    await waitPicked(page, 8);
    await expectText(page, "#stTix .tkp-say", "This PDF has 12 pages; a stop holds 8 pictures, so only the first 8 pages will be kept.");
    assert.equal(backend.requests.some((b) => b.action === "addTicket"), false);
    await shot(page, "attach-12pages-393");
  },
});

cases.push({
  name: "one picture refused: the others are saved and the sheet says which",
  async run({ page }) {
    const backend = makeBackend(WITH_PLAN, { now: NOON12 });
    // The backend refuses the second picture it is sent.
    let n = 0;
    const real = backend.handle.bind(backend);
    backend.handle = async (body) => {
      if (body.action === "addTicket" && ++n === 2) return { ok: false, error: "bad_input", message: "That picture couldn’t be used. Try another." };
      return real(body);
    };
    await ready(page, { backend });
    await edit(page, SKY);
    await page.setInputFiles("#stTkFile", [1, 2, 3].map((i) => file("IMG_" + i + ".PNG", "image/png", pngBytes(200, 200, i))));
    await waitPicked(page, 3);
    await page.dispatchEvent("#stSave", "click");
    await expectText(page, "#stTix .tkp-say", "One picture wasn’t saved. The rest are on the stop.", 15000);
    assert.equal(backend.fake.tables.Tickets.length, 2);
    assert.deepEqual((await picked(page)).map((p) => p.name), ["IMG_2.PNG"]);
    await expectText(page, "#stTix .tkp-picked .file-n i", "That picture couldn’t be used. Try another.");
    assert.equal(await page.evaluate(() => document.getElementById("stop").classList.contains("is-open")), true);
    await shot(page, "attach-one-failed-393");
  },
});

cases.push({
  name: "before migrate the Edit sheet has no Ticket part and saves as before",
  async run({ page }) {
    const backend = makeBackend({ ...WITH_PLAN, missingTabs: ["Tickets", "TicketData"], missingColumns: ["Stops.tk_ref", "Stops.tk_name", "Stops.tk_people", "Stops.tk_seat"] }, { now: NOON12 });
    await ready(page, { backend });
    await edit(page, SKY);
    assert.equal(await page.evaluate(() => document.getElementById("stTix").hidden), true);
    await page.fill("#stDetail", "Changed");
    await page.dispatchEvent("#stSave", "click");
    await sheetClosed(page);
    const sent = backend.requests.filter((b) => b.action === "updateStop").map((b) => Object.keys(b.args.patch));
    assert.deepEqual(sent, [["detail"]]);
  },
});

cases.push({
  name: "fix round 1, I3: an IndexedDB that never answers does not hold up Save; the picture is still on the stop",
  async run({ page }) {
    // A known WebKit fault: indexedDB.open never says success, error or blocked.
    await page.addInitScript(() => {
      const hung = () => ({ result: null, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null });
      try {
        Object.defineProperty(indexedDB, "open", { value: hung, configurable: true });
      } catch {
        // nothing to do
      }
    });
    const backend = makeBackend(WITH_PLAN, { now: NOON12 });
    await ready(page, { backend });
    await edit(page, SKY);
    await page.setInputFiles("#stTkFile", [file("one.png", "image/png", pngBytes(200, 200, 5))]);
    await waitPicked(page, 1);
    await page.dispatchEvent("#stSave", "click");
    await sheetClosed(page);
    assert.equal(backend.fake.tables.Tickets.length, 1);
    assert.equal(await page.evaluate(() => globalThis.__matTest.store.busy()), false, "nothing left waiting (the updater can reload)");
  },
});

cases.push({
  name: "minor 1: Enter on the last field (the Japanese address since #95) puts the keyboard away before migrate, and goes on to the ticket's facts after",
  async run({ page, newPhone }) {
    const old = makeBackend({ ...WITH_PLAN, missingTabs: ["Tickets", "TicketData"], missingColumns: ["Stops.tk_ref", "Stops.tk_name", "Stops.tk_people", "Stops.tk_seat"] }, { now: NOON12 });
    await ready(page, { backend: old });
    await edit(page, SKY);
    assert.equal(await page.evaluate(() => document.getElementById("stAddrJp").enterKeyHint), "done");
    await page.focus("#stAddrJp");
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.matches("input, textarea")), false, "the keyboard goes away");

    const other = await newPhone();
    await ready(other, { backend: makeBackend(WITH_PLAN, { now: NOON12 }) });
    await edit(other, SKY);
    assert.equal(await other.evaluate(() => document.getElementById("stAddrJp").enterKeyHint), "next");
    await other.focus("#stAddrJp");
    await other.keyboard.press("Enter");
    assert.equal(await other.evaluate(() => document.activeElement.id), "stTkRef");
    await other.focus("#stTkSeat");
    await other.keyboard.press("Enter");
    assert.equal(await other.evaluate(() => document.activeElement && document.activeElement.matches("input, textarea")), false);
  },
});

module.exports = cases;
