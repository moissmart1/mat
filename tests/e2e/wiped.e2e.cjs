// After the trip is taken off the phone (a refused key, Forget this phone),
// nothing of it stays in the page: not a stop title, not a person's
// e-Transfer address. While merely loading or offline, what is drawn stays.

const assert = require("node:assert/strict");
const { WITH_PLAN, NOON12, makeBackend, open, advance, until, atRest, text, visible } = require("./helpers.cjs");
const { geoStub } = require("./geostub.cjs");
const { png } = require("./pictures.cjs");

const line = (o) => ({ day: "2026-12-11", currency: "CAD", rate: 111, splitMode: "equal", splitVals: [], note: "", kind: "", deleted: false, ...o });
const SEED = {
  ...WITH_PLAN,
  expenses: [line({ id: "wipeexp001", title: "Izakaya", amount: 20, paidBy: "Ajen", split: ["Mo", "Ajen"] })],
  payments: [],
  people: { Ajen: { etransfer: "ajen.wipe@example.test" }, Mo: { etransfer: "mo.wipe@example.test" } },
};
const STOP = "Meiji Shrine";
const ADDRESS = "ajen.wipe@example.test";
const MINE = "mo.wipe@example.test";
const WORDS = [STOP, ADDRESS, MINE, "Senso-ji", "Dinner in Shibuya", "Asakusa hotel", "Izakaya", "Temples, then the view"];
const SIZES = [{ width: 393, height: 852 }, { width: 1440, height: 900 }];

const body = (page) => page.evaluate(() => document.body.textContent);

async function ready(page, desktop) {
  const backend = await open(page, { seed: SEED, nowMs: NOON12, tab: "days" });
  await until(() => page.evaluate((t) => document.body.textContent.includes(t), STOP), "the stop is drawn");
  // Arm the slip row so the e-Transfer address is drawn.
  await until(() => page.evaluate(() => !!document.querySelector('#slip .s-row[data-key="Mo>Ajen"] .spot')), "the slip row is drawn");
  await page.dispatchEvent('#slip .s-row[data-key="Mo>Ajen"] .spot', "click");
  await until(() => page.evaluate((a) => document.body.textContent.includes(a), ADDRESS), "the address is drawn");
  // Every sheet opened and closed once, so each has drawn what it holds.
  for (const [sel, sheet] of [["#dayCount", "#allDays"], [".tk-stay", "#stay"], ["#histBtn", "#hist"], ["#rc .rc-row", "#line"], ["#ring", "#reg"], ["#youBtn", "#you"], ["#stampBtn", "#book"]]) {
    const hit = await page.evaluate((q) => {
      const b = document.querySelector(q);
      if (!b || b.hidden) return false;
      b.click();
      return true;
    }, sel);
    if (!hit) continue;
    await page.evaluate(() => globalThis.__matTest.store.idle());
    await page.keyboard.press("Escape");
  }
  // A stop sheet open on Days.
  await page.evaluate(() => {
    const r = document.querySelector("#vDays .r[data-id]");
    if (r) r.click();
  });
  await page.evaluate(() => globalThis.__matTest.store.idle());
  return backend;
}

async function assertGone(page) {
  await until(() => visible(page, "#gate"), "the no-key screen shows");
  const left = async () => {
    const t = await body(page);
    return WORDS.filter((w) => t.includes(w));
  };
  await until(async () => (await left()).length === 0, "nothing of the trip is left in the page").catch(async (e) => {
    const where = await page.evaluate((ws) => ws.map((w) => [w, [...document.querySelectorAll("body, body *")].filter((n) => n.textContent.includes(w) && ![...n.children].some((c) => c.textContent.includes(w))).map((n) => n.tagName + "#" + n.id + "." + n.className)]), [STOP, ADDRESS, MINE]);
    throw new Error(e.message + ": " + JSON.stringify(where));
  });
  const t = await body(page);
  for (const word of WORDS) {
    assert.equal(t.includes(word), false, word + " is still in the page");
  }
  assert.equal(await page.evaluate(() => document.querySelectorAll("#vDays .r[data-id], #vDays .pg > *").length), 0, "no day ticket is drawn");
}

const cases = [];
for (const size of SIZES) {
  const mobile = size.width < 600;
  cases.push({
    name: "a refused key leaves nothing of the trip in the page at " + size.width + "x" + size.height,
    viewport: size,
    ...(mobile ? {} : { mobile: false }),
    async run({ page }) {
      const backend = await ready(page);
      backend.failWith = "bad_key";
      await page.evaluate(() => globalThis.__matTest.store.checkRev());
      await assertGone(page);
    },
  });
  cases.push({
    name: "Forget this phone leaves nothing of the trip in the page at " + size.width + "x" + size.height,
    viewport: size,
    ...(mobile ? {} : { mobile: false }),
    async run({ page }) {
      await ready(page);
      await page.dispatchEvent("#youBtn", "click");
      await atRest(page, "#you", { message: "settings open" });
      await page.dispatchEvent("#setForget", "click");
      await page.dispatchEvent("#setForget", "click");
      await assertGone(page);
    },
  });
}

cases.push({
  name: "a plain network failure, and a load that has not landed yet, keep the drawn trip",
  async run({ page }) {
    const backend = await ready(page);
    backend.failWith = "network";
    await page.evaluate(() => globalThis.__matTest.store.checkRev());
    await page.evaluate(() => globalThis.__matTest.store.refresh && globalThis.__matTest.store.refresh());
    await page.evaluate(() => globalThis.__matTest.store.idle());
    assert.equal(await page.evaluate(() => globalThis.__matTest.store.state.status), "ready");
    let t = await body(page);
    assert.ok(t.includes(STOP), "the stop stays while offline");
    assert.ok(t.includes(ADDRESS), "the address stays while offline");
    assert.equal(await visible(page, "#gate"), false);
    // A slow load: the page reopens with the saved trip while the backend does not answer.
    await page.reload();
    await until(() => page.evaluate((s) => document.body.textContent.includes(s), STOP), "the saved trip draws on a reload with no signal");
    t = await body(page);
    assert.ok(t.includes(STOP) && t.includes(ADDRESS) === t.includes(ADDRESS));
    assert.equal(await visible(page, "#gate"), false);
  },
});

// ---- a stop with a ticket picture and a booking reference ----
const MEIJI = "planstop1201";
const REF = "WIPE-REF-7731";
const D12 = "2026-12-12";
const mrow = '#rail .pg[data-date="' + D12 + '"] .r[data-id="' + MEIJI + '"]';

async function ticketed() {
  const backend = makeBackend(WITH_PLAN, { now: NOON12 });
  const as = (action, args) => backend.fake({ key: "test-key", actor: "Ajen", action, args });
  assert.equal((await as("updateStop", { id: MEIJI, patch: { tkRef: REF, tkName: "WIPE NAME", tkPeople: "3" } })).ok, true);
  const r = await as("addTicket", { ticket: { id: "tktwipe00001", stop: MEIJI, who: "", seat: "", page: 1, mime: "image/png", w: 300, h: 300, data: png(300, 300, 51) } });
  assert.equal(r.ok, true, r.message);
  return backend;
}
const hasRef = (page) =>
  page.evaluate((ref) => document.body.textContent.includes(ref) || [...document.querySelectorAll("input, textarea")].some((n) => n.value.includes(ref)), REF);
const blobImages = (page) => page.evaluate(() => [...document.querySelectorAll("img")].filter((i) => (i.getAttribute("src") || "").startsWith("blob:")).length);

async function openTicketed(page, how) {
  const backend = await ticketed();
  await open(page, { backend, tab: "days" });
  await until(() => page.evaluate((sel) => !!document.querySelector(sel), mrow), "the stop is drawn");
  await until(() => page.evaluate((sel) => { const b = document.querySelector(sel + " .tk-mark b"); return !!b && !b.classList.contains("is-dash"); }, mrow), "the picture is on this phone", 10000);
  await page.dispatchEvent(mrow + " .r-b", "click");
  await until(() => page.evaluate((sel) => document.querySelector(sel).classList.contains("is-open"), mrow), "the stop opens");
  if (how === "stub") {
    await page.dispatchEvent(mrow + " .r-tk", "click");
    await until(() => page.evaluate(() => { const t = document.getElementById("tix"); return !!t && !t.hidden && !!t.querySelector("img"); }), "the stub is up with its picture");
    assert.ok((await blobImages(page)) > 0, "the stub holds a blob: picture");
  } else {
    await page.dispatchEvent(mrow + " .r-edit", "click");
    await atRest(page, "#stop", { message: "the edit sheet opens" });
    await until(() => blobImages(page).then((n) => n > 0), "the sheet shows the thumbnail");
  }
  assert.equal(await hasRef(page), true, "the reference is in the page before the wipe");
  return backend;
}

async function assertTicketsGone(page) {
  await until(() => visible(page, "#gate"), "the no-key screen shows");
  await until(async () => !(await hasRef(page)) && (await blobImages(page)) === 0, "no reference and no blob picture is left");
  assert.equal(await page.evaluate(() => document.body.textContent.includes("WIPE NAME")), false, "the name on the booking is gone");
  assert.equal(await page.evaluate(() => document.querySelectorAll(".tk-mark, .r-tk, #tix .tstub, #stTix .file").length), 0, "no 券 box, show-ticket button, stub or thumbnail row");
  assert.equal(await page.evaluate(() => document.getElementById("tix").hidden), true);
  assert.equal(await page.evaluate(() => document.getElementById("stop").classList.contains("is-open")), false);
  assert.equal(await page.evaluate(() => document.getElementById("phone").classList.contains("stub-open")), false);
  const dbs = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : []));
  assert.equal(dbs.includes("mat-tickets"), false, "no mat-tickets database after the wipe");
}

for (const size of SIZES) {
  const mobile = size.width < 600;
  cases.push({
    name: "a refused key takes the stub and its picture out of the page at " + size.width + "x" + size.height,
    viewport: size,
    ...(mobile ? {} : { mobile: false }),
    async run({ page }) {
      const backend = await openTicketed(page, "stub");
      backend.failWith = "bad_key";
      await page.evaluate(() => globalThis.__matTest.store.checkRev());
      await assertTicketsGone(page);
    },
  });
  cases.push({
    name: "Forget this phone takes the Edit sheet's ticket part and thumbnails out of the page at " + size.width + "x" + size.height,
    viewport: size,
    ...(mobile ? {} : { mobile: false }),
    async run({ page }) {
      await openTicketed(page, "edit");
      await page.dispatchEvent("#youBtn", "click");
      await atRest(page, "#you", { message: "settings open" });
      await page.dispatchEvent("#setForget", "click");
      await page.dispatchEvent("#setForget", "click");
      await assertTicketsGone(page);
    },
  });
}

// ---- Location after the trip is taken off (review of mat#109, Important 1) ----
// Location on, a request still on its way (held by the test), then the trip
// comes off: its late answers write nothing back into the emptied storage, and
// the phone is not asked again, also when the app comes back on screen.
async function locationHeld(page) {
  await geoStub(page, { mode: "silent", permission: "granted" });
  await page.addInitScript(() => {
    window.__geoHeld = [];
    const g = navigator.geolocation;
    g.getCurrentPosition = (ok, no, opts) => {
      window.__geoCalls.push(opts || null);
      window.__geoHeld.push({ ok, no });
    };
  });
  const backend = await open(page, { seed: WITH_PLAN, nowMs: NOON12, tab: "days", storage: { "mat.where": "on" } });
  await until(() => page.evaluate(() => window.__geoCalls.length === 1), "Location on: asked once on opening");
  return backend;
}
async function assertLocationGone(page, backend) {
  await page.evaluate(() => {
    const h = window.__geoHeld[0];
    h.no({ code: 1, message: "User denied Geolocation" });
    h.ok({ coords: { latitude: 35.0036612, longitude: 135.7787213, accuracy: 20 }, timestamp: Date.now() });
  });
  await advance(page, backend, 3 * 60000);
  await page.evaluate(() => {
    for (const v of ["hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
  await advance(page, backend, 3 * 60000);
  assert.equal(await page.evaluate(() => window.__geoCalls.length), 1, "the phone is not asked again");
  assert.equal(await page.evaluate(() => localStorage.getItem("mat.where")), null, "nothing written back into the emptied storage");
}

cases.push({
  name: "Forget this phone with Location on: a late answer writes nothing back and nothing asks again",
  async run({ page }) {
    const backend = await locationHeld(page);
    await page.dispatchEvent("#youBtn", "click");
    await atRest(page, "#you", { message: "settings open" });
    await page.dispatchEvent("#setForget", "click");
    await page.dispatchEvent("#setForget", "click");
    await until(() => page.evaluate(() => globalThis.__matTest.store.state.status === "nokey" && localStorage.getItem("mat.key") === null), "the trip is off the phone");
    await assertLocationGone(page, backend);
  },
});

cases.push({
  name: "a refused key with Location on: a late answer writes nothing back and nothing asks again",
  async run({ page }) {
    const backend = await locationHeld(page);
    backend.failWith = "bad_key";
    await page.evaluate(() => globalThis.__matTest.store.checkRev());
    await until(() => page.evaluate(() => globalThis.__matTest.store.state.status === "nokey" && localStorage.getItem("mat.key") === null), "the trip is off the phone");
    assert.equal(await page.evaluate(() => localStorage.getItem("mat.where")), null);
    await assertLocationGone(page, backend);
  },
});

module.exports = cases;
