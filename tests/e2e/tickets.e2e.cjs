// The real ticket on a stop, shown: the 券 box and 切符 Show ticket on the day
// ticket, and the stub torn off and held up (js/views/stub.js), at the four
// sizes Mo uses (a phone 393 x 852, a small phone 320 x 568, a phone sideways
// 844 x 390, a computer 1440 x 900). The plan is tests/fixtures/plan.json;
// it is 13:20 on Dec 12 in Japan. Every picture is drawn by the test
// (tests/e2e/pictures.cjs); nothing in them is real.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { WITH_PLAN, makeBackend, open, advance, until, text, expectText } = require("./helpers.cjs");
const { png } = require("./pictures.cjs");

const SHOTS = "/private/tmp/claude-501/mat-shots/tickets";
const D12 = "2026-12-12";
const SKY = "planstop1203"; // 14:00, the next stop: three per-person codes
const MEIJI = "planstop1201"; // 09:00: one code for all three
const LUNCH = "planstop1202"; // 12:30: a PDF's two pages
const DINNER = "planstop1204"; // 19:00: reference only
const NOON12 = Date.parse("2026-12-12T13:20:00+09:00");
const KEY = "test-key";
const JPEG = require("../fixtures/picture.json").jpeg;

const SIZES = [
  { tag: "393", viewport: { width: 393, height: 852 } },
  { tag: "320", viewport: { width: 320, height: 568 } },
  { tag: "844", viewport: { width: 844, height: 390 } },
  { tag: "1440", viewport: { width: 1440, height: 900 }, mobile: false },
];

let n = 0;
const tid = () => "tkt" + String(++n).padStart(9, "0");
const as = (backend, action, args, actor = "Ajen") => backend.fake({ key: KEY, actor, action, args });

// A backend with the four kinds of ticket on Dec 12, added from "another phone".
async function ticketed() {
  const backend = makeBackend(WITH_PLAN, { now: NOON12 });
  const add = async (stop, who, seat, page, data, mime = "image/png", w = 300, h = 300) => {
    const r = await as(backend, "addTicket", { ticket: { id: tid(), stop, who, seat, page, mime, w, h, data } });
    assert.equal(r.ok, true, r.message);
    return r.data.ticket;
  };
  await as(backend, "updateStop", { id: SKY, patch: { tkRef: "TEST-3001", tkName: "MO", tkPeople: "3 adults" } });
  await add(SKY, "Mo", "Car 7 · 10A", 1, png(300, 300, 11));
  await add(SKY, "Ajen", "Car 7 · 10B", 1, png(300, 300, 23));
  await add(SKY, "Trenton", "Car 7 · 10C", 1, png(300, 300, 37));
  await as(backend, "updateStop", { id: MEIJI, patch: { tkRef: "TEST-1101", tkName: "AJEN", tkPeople: "3", tkSeat: "Group 4" } });
  await add(MEIJI, "", "", 1, png(300, 300, 51));
  await as(backend, "updateStop", { id: LUNCH, patch: { tkRef: "TEST-1230", tkName: "TRENTON" } });
  await add(LUNCH, "", "", 1, png(300, 424, 61), "image/png", 300, 424);
  await add(LUNCH, "", "", 2, png(300, 424, 62), "image/png", 300, 424);
  await as(backend, "updateStop", { id: DINNER, patch: { tkRef: "0412", tkName: "MO", tkPeople: "3" } });
  return backend;
}

async function ready(page, opts) {
  const backend = await open(page, { tab: "days", ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}
const row = (id) => '#rail .pg[data-date="' + D12 + '"] .r[data-id="' + id + '"]';
const solid = (page, id) => page.evaluate((sel) => {
  const b = document.querySelector(sel + " .tk-mark b");
  return !!b && !b.classList.contains("is-dash");
}, row(id));
// Every picture of the day reached this phone's keep.
const allKept = (page) => until(async () => (await Promise.all([SKY, MEIJI, LUNCH].map((id) => solid(page, id)))).every(Boolean), "every picture is on this phone", 10000);

// Opens a stop (a dispatched click: a real one on a row still sliding open
// is retried with scrolls that move the strip) and waits for it to finish opening.
async function openRow(page, id) {
  const isOpen = await page.evaluate((sel) => document.querySelector(sel).classList.contains("is-open"), row(id));
  if (!isOpen) await page.dispatchEvent(row(id) + " .r-b", "click");
  await until(() => page.evaluate((sel) => {
    const r = document.querySelector(sel);
    const d = r.querySelector(".r-more > div");
    return r.classList.contains("is-open") && d && d.clientHeight === d.scrollHeight;
  }, row(id)), "the stop opens");
}
async function showTicket(page, id) {
  await openRow(page, id);
  await page.dispatchEvent(row(id) + " .r-tk", "click");
  await until(() => page.evaluate(() => {
    const t = document.getElementById("tix");
    return !!t && !t.hidden && !!t.querySelector(".tstub");
  }), "the stub is up");
  // Its pictures drawn (or their places said).
  await until(() => page.evaluate(() => [...document.querySelectorAll("#tix .stub-code")].every((c) => {
    const img = c.querySelector("img");
    return (img && img.complete && img.naturalWidth > 0) || c.querySelector(".miss");
  })), "the stub's pictures draw");
  await torn(page);
}
// The tear has finished (measuring or shooting mid-flight sees it scaled and tilted).
// A redraw (a picture arriving) replaces the stub and cancels the old one's
// tear (AbortError): wait on the tear of the stub that is up now.
const torn = (page) => page.evaluate(async () => {
  for (;;) {
    try {
      return await Promise.all(document.getElementById("tix").getAnimations({ subtree: true }).filter((a) => a.animationName === "tear").map((a) => a.finished));
    } catch (e) {
      if (e.name !== "AbortError") throw e;
    }
  }
});
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
};
const SHOT_DIR = process.env.MAT_TAB_SHOTS || "";
const shotTo = async (page, name) => {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: SHOT_DIR + "/" + name + ".png" });
};
const noSideways = async (page) => {
  const w = await page.evaluate(() => ({
    doc: document.scrollingElement.scrollWidth <= innerWidth,
    ov: (() => { const o = document.querySelector("#tix .ov"); return !o || o.scrollWidth <= o.clientWidth; })(),
    stub: (() => { const s = document.querySelector("#tix .tstub"); return !s || s.getBoundingClientRect().right <= innerWidth + 0.5; })(),
  }));
  assert.deepEqual(w, { doc: true, ov: true, stub: true });
};
const closeStub = async (page) => {
  await page.click("#tix [data-close]");
  await until(() => page.evaluate(() => document.getElementById("tix").hidden), "the stub goes");
};

const cases = [];
for (const size of SIZES) {
  const base = { viewport: size.viewport, ...(size.mobile === false ? { mobile: false } : {}) };

  cases.push({
    name: size.tag + ": three per-person codes, mine first; the seals and the facts follow; Put it back",
    ...base,
    async run({ page }) {
      const backend = await ticketed();
      // Mo has chosen a picture; Ajen and Trenton have not.
      backend.fake.primitives.updateWhere_("People", "name", "Mo", { photo: JPEG });
      await ready(page, { backend, me: "Ajen" });
      await allKept(page);
      await expectText(page, row(SKY) + " .tk-mark", "券 3 codes · on this phone");
      await openRow(page, SKY);
      await expectText(page, row(SKY) + " .r-tk", "切符Show ticket3 codes");
      // The booking link stays, beside it, quieter.
      assert.equal(await text(page, row(SKY) + " .r-map.alt"), "Ticket or booking ↗");
      await shot(page, "day-" + size.tag);
      await showTicket(page, SKY);
      assert.equal(await page.evaluate(() => document.getElementById("phone").classList.contains("stub-open")), true);
      // Opens on this phone's person (Ajen), then the others in trip order.
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#tix .pp-pg")].map((p) => p.dataset.who)), ["Ajen", "Mo", "Trenton"]);
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#tix .who3 button")].map((b) => b.textContent)), ["AYou", "Mo", "TTrenton"]);
      // Mo's seal is his picture; the others keep their letter.
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#tix .who3 .seal")].map((s) => [s.classList.contains("has-pic"), !!s.querySelector("img"), s.classList.contains("is-on")])), [[false, false, true], [true, true, false], [false, false, false]]);
      // A picture arriving while the stub is open redraws the seal (Ajen's, from another phone).
      backend.fake.primitives.updateWhere_("People", "name", "Ajen", { photo: JPEG });
      await page.evaluate(() => globalThis.__matTest.store.refresh());
      await until(() => page.evaluate(() => !!document.querySelector("#tix .who3 button:nth-child(1) .seal img")), "Ajen's picture redraws his seal");
      assert.equal(await page.evaluate(() => document.querySelector("#tix .who3 button:nth-child(1) .seal").classList.contains("is-on")), true);
      assert.equal(await text(page, "#tix .who3 button:nth-child(1)"), "You");
      if (size.tag === "393" || size.tag === "320") await shotTo(page, "switch" + (size.tag === "320" ? "-320" : ""));
      await expectText(page, "#tix .pp-pg .stub-who", "AJENCar 7 · 10B");
      await expectText(page, "#tix .facts", /予約番号Booking refTEST-3001.*名義Name on bookingMO.*人数People3 adults.*座席SeatCar 7 · 10B/);
      await expectText(page, "#tix .kept", "保存済On this phone. Works with no signal.");
      await expectText(page, "#tix .oa-top span", "切取 Torn off · Sat Dec 12");
      // The code on pure white, at least 280 px on a 393 phone.
      const code = await page.evaluate(() => {
        const box = document.querySelector("#tix .pp-pg .stub-code");
        const img = box.querySelector("img");
        return { w: img.getBoundingClientRect().width, bg: getComputedStyle(box).backgroundColor };
      });
      assert.equal(code.bg, "rgb(255, 255, 255)");
      if (size.tag === "393") assert.ok(code.w >= 280, "the code is " + code.w + " px");
      await noSideways(page);
      await shot(page, "stub-3codes-" + size.tag);
      // The third seal: Trenton's page, and his seat in the facts.
      await page.click("#tix .who3 button:nth-child(3)");
      await until(async () => /10C/.test(await text(page, "#tix .facts")), "the facts follow the seal");
      await until(() => page.evaluate(() => {
        const pp = document.querySelector("#tix .pp");
        return Math.abs(pp.scrollLeft - 2 * pp.clientWidth) < 2;
      }), "the pages slide to Trenton's");
      assert.equal(await page.evaluate(() => document.querySelector("#tix .who3 button:nth-child(3) .seal").classList.contains("is-on")), true);
      await shot(page, "stub-3codes-trenton-" + size.tag);
      await closeStub(page);
      assert.equal(await page.evaluate(() => document.getElementById("phone").classList.contains("stub-open")), false);
      // Focus is back on Show ticket.
      assert.equal(await page.evaluate((sel) => document.activeElement === document.querySelector(sel + " .r-tk"), row(SKY)), true);
    },
  });

  cases.push({
    name: size.tag + ": one code for all three, tap to enlarge; Escape puts it back",
    ...base,
    async run({ page }) {
      const backend = await ticketed();
      await ready(page, { backend });
      await allKept(page);
      await expectText(page, row(MEIJI) + " .tk-mark", "券 1 code · on this phone");
      await showTicket(page, MEIJI);
      await expectText(page, "#tix .stub-who", "3名 · ALL THREEGroup 4");
      assert.equal(await page.evaluate(() => document.querySelectorAll("#tix .who3").length), 0);
      await expectText(page, "#tix .facts", /座席SeatGroup 4/);
      await noSideways(page);
      await shot(page, "stub-1code-" + size.tag);
      await page.click("#tix .stub-code.can-zoom");
      await until(() => page.evaluate(() => !!document.querySelector("#tix .zoom img")), "it is enlarged");
      await shot(page, "stub-1code-zoom-" + size.tag);
      await page.keyboard.press("Escape");
      await until(() => page.evaluate(() => !document.querySelector("#tix .zoom") && !document.getElementById("tix").hidden), "Escape takes the enlarged picture away first");
      await page.keyboard.press("Escape");
      await until(() => page.evaluate(() => document.getElementById("tix").hidden), "Escape puts it back");
    },
  });

  cases.push({
    name: size.tag + ": a PDF's pages one under another; a tap on the dark puts it back",
    ...base,
    async run({ page }) {
      const backend = await ticketed();
      await ready(page, { backend });
      await allKept(page);
      await expectText(page, row(LUNCH) + " .tk-mark", "券 2 pages · on this phone");
      await showTicket(page, LUNCH);
      await expectText(page, "#tix .stub-who", "E-TICKETTap to enlarge");
      assert.equal(await page.evaluate(() => document.querySelectorAll("#tix .stub-code.is-page img").length), 2);
      const below = await page.evaluate(() => {
        const [a, b] = [...document.querySelectorAll("#tix .stub-code.is-page")].map((x) => x.getBoundingClientRect());
        return b.top >= a.bottom;
      });
      assert.equal(below, true);
      await noSideways(page);
      await shot(page, "stub-pdf-" + size.tag);
      await page.locator("#tix .stub-code.is-page").nth(1).click();
      await until(() => page.evaluate(() => !!document.querySelector("#tix .zoom img")), "the page is enlarged");
      await shot(page, "stub-pdf-zoom-" + size.tag);
      await page.click("#tix .zoom-x");
      await until(() => page.evaluate(() => !document.querySelector("#tix .zoom")), "Back");
      await page.dispatchEvent("#tix .ov", "click");
      await until(() => page.evaluate(() => document.getElementById("tix").hidden), "the dark puts it back");
    },
  });

  cases.push({
    name: size.tag + ": reference only, no picture",
    ...base,
    async run({ page }) {
      const backend = await ticketed();
      await ready(page, { backend });
      await expectText(page, row(DINNER) + " .tk-mark", "券 Reference only, no file");
      await showTicket(page, DINNER);
      await expectText(page, "#tix .ref-big", "予約番号 Reference0412MO の名前で、19:00に予約しています。We have a booking for 3 at 19:00 under MO.");
      await expectText(page, "#tix .kept", "文字Text only, always on this phone.");
      assert.equal(await page.evaluate(() => document.querySelectorAll("#tix .stub-code").length), 0);
      await noSideways(page);
      await shot(page, "stub-ref-" + size.tag);
      await closeStub(page);
    },
  });

  cases.push({
    name: size.tag + ": after one fetch it opens with no signal",
    ...base,
    async run({ page }) {
      const backend = await ticketed();
      await ready(page, { backend });
      await allKept(page);
      backend.failWith = "network";
      await page.reload();
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw from the cache");
      await until(() => solid(page, SKY), "the box is solid with no signal");
      await showTicket(page, SKY);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll("#tix .stub-code img")].every((i) => i.naturalWidth > 0)), true);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll("#tix img")].every((i) => i.src.startsWith("blob:"))), true);
      await expectText(page, "#tix .kept", "保存済On this phone. Works with no signal.");
      await shot(page, "stub-nosignal-" + size.tag);
    },
  });

  cases.push({
    name: size.tag + ": a picture not on this phone yet needs signal once, then saves",
    ...base,
    async run({ page }) {
      const backend = await ticketed();
      // Every ticket read fails as if there were no signal.
      let block = true;
      const real = backend.handle.bind(backend);
      backend.handle = async (body) => {
        if (block && body.action === "ticket") throw new Error("network");
        return real(body);
      };
      await ready(page, { backend });
      await until(() => page.evaluate((sel) => !!document.querySelector(sel + " .tk-mark b.is-dash"), row(MEIJI)), "the box is dashed");
      await expectText(page, row(MEIJI) + " .tk-mark", "券 1 code · needs signal once");
      await shot(page, "day-needs-signal-" + size.tag);
      await showTicket(page, MEIJI);
      await expectText(page, "#tix .miss", /The picture is not on this phone yet\..*Until then, show the booking ref below/);
      await expectText(page, "#tix .kept", "未保存Not on this phone yet. Needs signal once.");
      assert.equal(await page.evaluate(() => document.querySelector("#tix .kept b").classList.contains("is-dash")), true);
      await expectText(page, "#tix .facts", /TEST-1101/);
      await noSideways(page);
      await shot(page, "stub-needs-signal-" + size.tag);
      // Signal comes back: the next check finds it, and the stub saves the picture.
      block = false;
      await advance(page, backend, 21000);
      await until(() => page.evaluate(() => {
        const img = document.querySelector("#tix .stub-code img");
        return !!img && img.naturalWidth > 0;
      }), "the picture saves and shows", 10000);
      await expectText(page, "#tix .kept", "保存済On this phone. Works with no signal.");
      await until(() => solid(page, MEIJI), "the box turns solid");
    },
  });
}

cases.push({
  name: "while the stub is up, a new release waits; it reloads once the stub is put back",
  async run({ page }) {
    const backend = await ticketed();
    await ready(page, { backend });
    await allKept(page);
    await showTicket(page, SKY);
    // The updater's own rule (js/app.js safeToReload): any "-open" on #phone holds a reload.
    assert.equal(await page.evaluate(() => /(^|\s)[a-z]+-open(\s|$)/.test(document.getElementById("phone").className)), true);
    await closeStub(page);
    assert.equal(await page.evaluate(() => /(^|\s)[a-z]+-open(\s|$)/.test(document.getElementById("phone").className)), false);
  },
});

cases.push({
  name: "no ticket anywhere (or before migrate): no box, no Show ticket, the stop as it was",
  async run({ page, newPhone }) {
    const backend = makeBackend({ ...WITH_PLAN, missingTabs: ["Tickets", "TicketData"], missingColumns: ["Stops.tk_ref", "Stops.tk_name", "Stops.tk_people", "Stops.tk_seat"] }, { now: NOON12 });
    await ready(page, { backend });
    await openRow(page, SKY);
    assert.equal(await page.evaluate(() => document.querySelectorAll("#rail .tk-mark, #rail .r-tk").length), 0);
    assert.equal(await page.evaluate(() => document.getElementById("tix").hidden), true);
    assert.equal(backend.requests.some((b) => b.action === "ticket"), false);
    assert.equal(await page.evaluate(() => document.getElementById("setTix").hidden), true, "no Ticket pictures row in You");
    const fresh = makeBackend(WITH_PLAN, { now: NOON12 });
    const other = await newPhone();
    await ready(other, { backend: fresh });
    await openRow(other, SKY);
    assert.equal(await other.evaluate(() => document.querySelectorAll("#rail .tk-mark, #rail .r-tk").length), 0);
  },
});

cases.push({
  name: "another phone removes a picture while the stub is up: it goes from the stub",
  async run({ page }) {
    const backend = await ticketed();
    await ready(page, { backend });
    await allKept(page);
    await showTicket(page, SKY);
    const t = backend.fake.tables.Tickets.find((x) => x.who === "Trenton");
    await as(backend, "removeTicket", { id: t.id }, "Mo");
    await advance(page, backend, 21000);
    await until(() => page.evaluate(() => document.querySelectorAll("#tix .pp-pg").length === 2), "the stub shows two codes");
    await expectText(page, row(SKY) + " .tk-mark", "券 2 codes · on this phone");
  },
});

cases.push({
  name: "You: Ticket pictures says how it fetches, and one tap changes it (kept on the phone)",
  async run({ page }) {
    const backend = await ticketed();
    await ready(page, { backend });
    await page.dispatchEvent("#youBtn", "click");
    await until(() => page.evaluate(() => document.getElementById("you").classList.contains("is-open")), "You opens");
    await page.evaluate(() => document.getElementById("setTix").scrollIntoView({ block: "center" }));
    await expectText(page, "#setTix", "Ticket picturesEvery phone keeps every ticket, so they open with no signal. Up to about 50 MB in all.On Wi‑Fi and mobile");
    await shot(page, "you-tix-all-393");
    await page.dispatchEvent("#setTix", "click");
    await expectText(page, "#setTixV", "Only when I open one");
    await expectText(page, "#setTixS", "Fetched when you open one. Each needs signal once.");
    assert.equal(await page.evaluate(() => localStorage.getItem("mat.tixFetch")), "open");
    await shot(page, "you-tix-open-393");
    await page.dispatchEvent("#setTix", "click");
    await expectText(page, "#setTixV", "On Wi‑Fi and mobile");
    assert.equal(await page.evaluate(() => localStorage.getItem("mat.tixFetch")), "all");
  },
});

cases.push({
  name: "Only when I open one: nothing is fetched in the background; Show ticket fetches its own, and only those",
  async run({ page }) {
    const backend = await ticketed();
    await ready(page, { backend, storage: { "mat.tixFetch": "open" } });
    await advance(page, backend, 21000);
    await until(() => page.evaluate((sel) => !!document.querySelector(sel + " .tk-mark b.is-dash"), row(SKY)), "the box is dashed");
    assert.equal(backend.requests.filter((b) => b.action === "ticket").length, 0, "nothing in the background");
    await showTicket(page, SKY);
    await until(() => page.evaluate(() => [...document.querySelectorAll("#tix .stub-code img")].length === 3), "the stub fetches its three codes", 10000);
    const asked = backend.requests.filter((b) => b.action === "ticket").map((b) => b.args.id);
    const sky = backend.fake.tables.Tickets.filter((t) => t.stop === SKY).map((t) => t.id);
    assert.deepEqual(asked.sort(), sky.sort());
    await closeStub(page);
    await until(() => solid(page, SKY), "its box turns solid");
    assert.equal(await page.evaluate((sel) => !!document.querySelector(sel + " .tk-mark b.is-dash"), row(MEIJI)), true, "the others still need signal once");
  },
});

// What the phone's picture keep holds (opening it makes an empty one if it is gone).
const keptIds = (page) => page.evaluate(() => new Promise((resolve) => {
  const r = indexedDB.open("mat-tickets", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("pics");
  r.onsuccess = () => {
    const db = r.result;
    const q = db.transaction("pics", "readonly").objectStore("pics").getAllKeys();
    q.onsuccess = () => { db.close(); resolve(q.result.length); };
    q.onerror = () => { db.close(); resolve(-1); };
  };
  r.onerror = () => resolve(-1);
}));

cases.push({
  name: "version 28: a refused key takes every ticket picture off the phone",
  async run({ page }) {
    const backend = await ticketed();
    await ready(page, { backend, own: "Ajen" });
    await allKept(page);
    assert.equal(await keptIds(page), 6);
    backend.fake.world.cancelLinkForPerson2(); // Ajen
    await page.evaluate(() => globalThis.__matTest.store.checkRev());
    await until(() => page.evaluate(() => { const g = document.getElementById("gate"); return !!g && !g.hidden; }), "the no-key screen shows");
    await until(async () => (await keptIds(page)) === 0, "no picture is left on the phone");
    // No picture is drawn anywhere. (The Days rail under the no-key screen is
    // left as it was drawn: version 28's own behaviour, reported, not changed here.)
    assert.equal(await page.evaluate(() => document.querySelectorAll("img[src^='blob:']").length), 0);
    assert.equal(await page.evaluate(() => document.getElementById("tix").hidden), true);
  },
});

cases.push({
  name: "version 28: Forget this phone takes every ticket picture off, with the stub up",
  async run({ page }) {
    const backend = await ticketed();
    await ready(page, { backend, own: "Mo" });
    await allKept(page);
    await showTicket(page, SKY);
    await page.keyboard.press("Escape");
    await page.dispatchEvent("#youBtn", "click");
    await until(() => page.evaluate(() => document.getElementById("you").classList.contains("is-open")), "You opens");
    await page.dispatchEvent("#setForget", "click");
    await page.dispatchEvent("#setForget", "click");
    await until(() => page.evaluate(() => { const g = document.getElementById("gate"); return !!g && !g.hidden; }), "the no-key screen shows");
    await until(async () => (await keptIds(page)) === 0, "no picture is left on the phone");
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("mat.")).length), 0);
  },
});

module.exports = cases;
