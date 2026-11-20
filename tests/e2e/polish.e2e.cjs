// Wave B, the phone polish: small flaws parked by earlier reviews, each with a
// case that shows it (or shows it gone). Notices over the stop sheet and over
// History, the uneven panel on a very short screen, the stamp landing on the
// tap on a slow network, a hotel card left open, the Settings "Last updated"
// not read out every twenty seconds, the Invite hint's line break, a release
// found by looking at js/config.js, and the keys of a computer. Every name
// here is made up.

const assert = require("node:assert/strict");
const { SEED, WITH_PLAN, NOON12, open, advance, until, visible } = require("./helpers.cjs");

const PORTRAIT = { width: 390, height: 844 };
const SIDEWAYS = { width: 844, height: 390 };
const WIDE = { width: 1100, height: 700 };
const D12 = "2026-12-12";
const DINNER = "planstop1204";
// The longest notice the store says: two lines on a phone.
const LONG_NOTICE = "That was changed again since. Undo the newer change first.";

const isOpen = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  return !!el && el.classList.contains("is-open");
}, id);
const waitOpen = (page, id) => until(() => isOpen(page, id), "#" + id + " opens");
const rect = (page, sel) => page.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
}, sel);
const meet = (a, b) => a.top < b.bottom && a.bottom > b.top && a.left < b.right && a.right > b.left;

// "ok", or why the element is not on screen and tappable.
function reach(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return "missing";
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return "not drawn";
    if (r.top < -0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5) {
      return "off screen: " + Math.round(r.left) + "," + Math.round(r.top) + " to " + Math.round(r.right) + "," + Math.round(r.bottom) + " of " + innerWidth + "x" + innerHeight;
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(hit === el || el.contains(hit))) return "covered by " + (hit ? hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") + "." + hit.className : "nothing");
    return "ok";
  }, selector);
}
async function expectReach(page, selector) {
  let got;
  try {
    await until(async () => (got = await reach(page, selector)) === "ok", "");
  } catch {
    throw new Error(selector + " is not on screen and tappable: " + got);
  }
}

async function days(page, opts = {}) {
  const backend = await open(page, { seed: WITH_PLAN, tab: "days", nowMs: NOON12, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  // The strip has come to rest on today (Dec 12) before anything is tapped: a tap on a strip still gliding lands on another day.
  await until(() => page.evaluate(() => /^Day 3 of 11/.test(document.querySelector("#dayCount").textContent)), "the strip rests on today, Day 3 of 11");
  await until(async () => {
    const at = () => page.evaluate(() => document.querySelector("#rail").scrollLeft);
    const a = await at();
    await page.waitForTimeout(120);
    return a === (await at());
  }, "the strip is still");
  return backend;
}
async function money(page, opts = {}) {
  const backend = await open(page, { seed: SEED, nowMs: NOON12, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0), "the receipt draws");
  return backend;
}

// Chromium has no notch: a top inset is stood in for, for the sheets' cap and
// History's top (--inset-t) and for where a notice stands while a sheet is
// open (12 px + the inset, as css/sheet.css puts it).
async function standInNotch(page, inset) {
  await page.evaluate((inset) => {
    document.documentElement.style.setProperty("--inset-t", inset + "px");
    const bar = document.getElementById("ubar").style;
    bar.setProperty("top", 12 + inset + "px", "important");
    bar.setProperty("bottom", "auto", "important");
  }, inset);
}
async function raiseNotice(page) {
  await page.evaluate((t) => globalThis.__matTest.store.notify(t), LONG_NOTICE);
  await until(() => page.evaluate(() => !document.getElementById("ubar").hidden), "the notice shows");
  // It arrives over a fifth of a second and the sheets rise over half of one (real time).
  await page.waitForTimeout(800);
}

const cases = [];

// ---- 1. the stop form under a notch ----
for (const [name, size] of [["upright", PORTRAIT], ["sideways", SIDEWAYS]]) {
  for (const inset of [0, 47]) {
    cases.push({
      name: "the stop sheet " + name + " with a " + inset + " px top inset: a two-line notice leaves its Done clear and tappable",
      viewport: size,
      async run({ page }) {
        await days(page);
        await standInNotch(page, inset);
        const row = '#rail .pg[data-date="' + D12 + '"] .r[data-id="' + DINNER + '"]';
        // Getting to the stop sheet is not what this case is about, so the two taps on the way are
        // given to the page directly. A real pointer click on a row that is still opening is
        // retried by the browser driver with other scroll alignments, one of which slides the day
        // strip to the next day; the row is then never reached (seen about one run in two, on the
        // first case of a run only).
        const tap = (sel) => page.dispatchEvent(sel, "click");
        await tap(row + " .r-b");
        await until(() => page.evaluate((sel) => document.querySelector(sel).classList.contains("is-open"), row), "the stop opens");
        await until(() => page.evaluate((sel) => {
          const e = document.querySelector(sel + " .r-edit");
          return !!e && e.getBoundingClientRect().height > 0;
        }, row), "Edit shows");
        await tap(row + " .r-edit");
        await waitOpen(page, "stop");
        await raiseNotice(page);
        await expectReach(page, "#stDone");
        await expectReach(page, "#ubar");
        assert.equal(meet(await rect(page, "#ubar"), await rect(page, "#stDone")), false, "the notice does not touch Done");
        assert.ok((await rect(page, "#ubar")).bottom <= (await rect(page, "#stop")).top + 0.5 + 12, "the sheet stops short of the notice");
      },
    });
  }
}

// ---- 2. History's top bar under a notice ----
for (const [name, size, mobile] of [["upright", PORTRAIT, true], ["sideways", SIDEWAYS, true], ["on a computer", WIDE, false]]) {
  for (const inset of [0, 47]) {
    cases.push({
      name: "History " + name + " with a " + inset + " px top inset: a two-line notice leaves its Done clear and tappable",
      viewport: size,
      mobile,
      async run({ page }) {
        await money(page);
        await page.click("#histBtn");
        await waitOpen(page, "hist");
        await until(() => page.evaluate(() => document.querySelectorAll("#hist .tp-row").length > 0), "the tape fills");
        await standInNotch(page, inset);
        await raiseNotice(page);
        await expectReach(page, "#histDone");
        await expectReach(page, "#ubar");
        assert.equal(meet(await rect(page, "#ubar"), await rect(page, "#histDone")), false, "the notice does not touch Done");
      },
    });
  }
}

// ---- 3. the uneven panel on a very short screen ----
for (const size of [{ width: 667, height: 320 }, { width: 667, height: 280 }, { width: 390, height: 300 }, { width: 390, height: 240 }]) {
  cases.push({
    name: "the uneven panel at " + size.width + "x" + size.height + ": its top, title and Done are on screen and tappable",
    viewport: { width: size.width, height: 844 },
    async run({ page }) {
      await money(page);
      await page.click("#ring");
      await waitOpen(page, "reg");
      for (const k of ["3", "0", "0", "0"]) await page.click('#pad .key[data-k="' + k + '"]');
      await page.click("#xUneven");
      await until(() => visible(page, "#un"), "the panel opens");
      await page.setViewportSize(size);
      await expectReach(page, "#unDone");
      await expectReach(page, "#un .un-top span");
      const un = await rect(page, "#un");
      assert.ok(un.top >= 0 && un.left >= 0 && un.right <= size.width, "the panel is inside the screen: " + JSON.stringify(un));
    },
  });
}

// ---- 4. the stamp lands on the tap ----
// Counts the thuds: every one makes an oscillator.
async function countThuds(page) {
  await page.addInitScript(() => {
    globalThis.__thuds = 0;
    const AC = globalThis.AudioContext;
    if (!AC) return;
    const make = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function () {
      globalThis.__thuds++;
      return make.call(this);
    };
  });
}
const thuds = (page) => page.evaluate(() => globalThis.__thuds);
// The backend answers an addPayment only after `ms` (real time); `fail` makes it an error answer.
function slow(backend, ms, fail) {
  const handle = backend.handle;
  const log = { asked: 0, answered: 0 };
  backend.handle = async (body) => {
    if (body.action !== "addPayment") return handle(body);
    log.asked++;
    await new Promise((r) => setTimeout(r, ms));
    log.answered++;
    return fail ? { ok: false, error: "refused", message: "Not saved." } : handle(body);
  };
  return log;
}
async function armAndStamp(page) {
  await page.click('#slip button.spot[data-key="Ajen>Mo"]');
  await until(() => page.evaluate(() => !!document.querySelector("#slip .spot.is-armed")), "armed");
  await page.click('#slip button.spot[data-key="Ajen>Mo"]');
}
cases.push({
  name: "a money stamp on a slow network lands and thuds on the tap, not when the backend answers",
  async run({ page }) {
    await countThuds(page);
    const backend = await money(page);
    await until(() => page.evaluate(() => document.querySelectorAll("#slip .s-row.is-open").length === 2), "the slip draws");
    const log = slow(backend, 3000);
    await armAndStamp(page);
    await until(() => page.evaluate(() => !!document.querySelector("#slip .stamp.hit")), "the stamp lands");
    assert.equal(await thuds(page), 1, "one thud on the tap");
    assert.equal(log.answered, 0, "the backend has not answered yet");
    await until(() => log.answered === 1, "the backend answers", 6000);
    assert.equal(await thuds(page), 1, "and no second thud with the answer");
  },
});
cases.push({
  name: "a money stamp the backend refuses after the thud is taken back with a notice",
  async run({ page }) {
    await countThuds(page);
    const backend = await money(page);
    await until(() => page.evaluate(() => document.querySelectorAll("#slip .s-row.is-open").length === 2), "the slip draws");
    const log = slow(backend, 800, true);
    await armAndStamp(page);
    await until(() => page.evaluate(() => !!document.querySelector("#slip .stamp.hit")), "the stamp lands");
    await until(() => log.answered === 1, "the backend refuses", 6000);
    await until(() => page.evaluate(() => !document.querySelector("#slip .stamp") && document.querySelectorAll("#slip .s-row.is-open").length === 2), "the stamp is taken back");
    await until(() => page.evaluate(() => !document.getElementById("ubar").hidden), "and the notice says so");
  },
});

// ---- 5. a hotel card left open is shut when Days comes back ----
cases.push({
  name: "the hotel card, the all-days list and the stop sheet are shut when Days is shown again after another tab",
  async run({ page }) {
    await days(page);
    const back = async () => {
      await page.evaluate(() => document.querySelector('#nav [data-tab="money"]').click());
      await until(() => page.evaluate(() => document.getElementById("vMoney").classList.contains("is-active")), "Money shows");
      await page.evaluate(() => document.querySelector('#nav [data-tab="days"]').click());
      await until(() => page.evaluate(() => document.getElementById("vDays").classList.contains("is-active")), "Days shows");
    };
    await page.click('#rail .pg[data-date="' + D12 + '"] .tk-stay');
    await waitOpen(page, "stay");
    await back();
    assert.equal(await isOpen(page, "stay"), false, "the hotel card is shut");
    assert.equal(await page.evaluate(() => /stay-open/.test(document.getElementById("phone").className)), false, "the phone is not left marked");
    await page.click("#dayCount");
    await waitOpen(page, "allDays");
    await back();
    assert.equal(await isOpen(page, "allDays"), false, "the list is shut");
    // The card opens again afterwards, drawn afresh.
    await page.click('#rail .pg[data-date="' + D12 + '"] .tk-stay');
    await waitOpen(page, "stay");
  },
});

// ---- 6. the small words of Before ----
cases.push({
  name: "Before's due line and planner note are at least the ticket's detail-line size (12.5 px)",
  async run({ page }) {
    await money(page);
    const sizes = await page.evaluate(() => ["bw-due", "bw-pl"].map((c) => {
      const e = document.createElement("p");
      e.className = c;
      document.body.append(e);
      const s = parseFloat(getComputedStyle(e).fontSize);
      e.remove();
      return s;
    }));
    assert.ok(sizes.every((s) => s >= 12.5), "sizes " + sizes);
  },
});

// ---- 8. the Invite hint breaks cleanly ----
// The words on each line of an element's text, as the browser broke it.
const linesOf = (page, sel) => page.evaluate((s) => {
  const node = document.querySelector(s).firstChild;
  const text = node.textContent;
  const lines = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) {
    const r = document.createRange();
    r.setStart(node, m.index);
    r.setEnd(node, m.index + m[0].length);
    const top = Math.round(r.getClientRects()[0].top);
    if (!lines.length || lines[lines.length - 1].top !== top) lines.push({ top, words: [] });
    lines[lines.length - 1].words.push(m[0]);
  }
  return lines.map((l) => l.words.join(" "));
}, sel);
for (const size of [PORTRAIT, { width: 393, height: 852 }, { width: 402, height: 874 }, { width: 414, height: 896 }, { width: 320, height: 568 }]) {
  cases.push({
    name: "the Invite hint on You at " + size.width + " px has no one-word last line",
    viewport: size,
    async run({ page }) {
      await money(page);
      await page.click("#youBtn");
      await waitOpen(page, "you");
      await page.waitForTimeout(700);
      const lines = await linesOf(page, "#setInvite small");
      assert.ok(lines.length === 1 || lines[lines.length - 1].includes(" "), "the lines: " + JSON.stringify(lines));
    },
  });
}

// ---- 9. "Last updated" is not read out on every sync ----
cases.push({
  name: "Last updated: the changing time is not a live region; a spoken line says only what matters",
  async run({ page }) {
    const backend = await money(page);
    await page.click("#youBtn");
    await waitOpen(page, "you");
    const live = await page.evaluate(() => {
      const f = document.getElementById("setFresh");
      return { own: f.getAttribute("aria-live"), inside: !!f.closest('[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"]') };
    });
    assert.deepEqual(live, { own: null, inside: false }, "the time itself is not announced");
    const say = () => page.evaluate(() => {
      const s = document.getElementById("setFreshSay");
      return s ? { role: s.getAttribute("role"), text: s.textContent } : null;
    });
    assert.deepEqual(await say(), { role: "status", text: "" }, "a quiet status line waits");
    // A sync that brings nothing new, a minute later: still nothing said, though the time changed.
    await advance(page, backend, 60000);
    await page.evaluate(() => globalThis.__matTest.store.refresh());
    await until(() => page.evaluate(() => document.getElementById("setFresh").textContent === "Up to date 13:21"), "the time moved on");
    assert.equal((await say()).text, "", "nothing said for the tick");
    // New lines from another phone: said.
    await backend.handle({ key: "test-key", actor: "Ajen", via: "app", action: "addExpense", args: { expense: { id: "polishexp001", title: "Tea", amount: 500, currency: "JPY", rate: 111, paidBy: "Ajen", split: ["Mo", "Ajen"], splitMode: "equal", splitVals: [], day: "2026-12-12", note: "", kind: "" } } });
    await page.evaluate(() => globalThis.__matTest.store.refresh());
    await until(async () => (await say()).text === "New lines came in.", "new lines are said");
    // No signal after a tap: said.
    backend.failWith = "network";
    await page.click("#setFreshRow");
    await until(async () => (await say()).text === "No signal.", "no signal is said");
    backend.failWith = null;
  },
});

// ---- 10. a release found by looking at js/config.js ----
const CONFIG = (v) => '/* test */\nexport const API_URL = "";\nexport const APP_VERSION = "' + v + '";\n';
// What the running page was loaded with, then (from now on) a changed config.js.
async function serveVersion(page, version, log) {
  await page.route("**/js/config.js*", (route) => {
    log.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/javascript", body: CONFIG(version) });
  });
}
const comeBack = (page) => page.evaluate(() => {
  document.dispatchEvent(new Event("visibilitychange"));
});
const mark = (page) => page.evaluate(() => { window.__notReloaded = true; });
// The app is drawn again after the reload (a case that ends mid-reload leaves the browser closing a page that is loading).
const backAgain = (page) => until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0).catch(() => false), "the app is back");
const reloaded = (page) => page.evaluate(() => window.__notReloaded !== true).catch(() => true);
cases.push({
  name: "coming back on screen looks at js/config.js: a different APP_VERSION reloads the page once",
  async run({ page }) {
    await money(page);
    await mark(page);
    const asked = [];
    await serveVersion(page, "9999", asked);
    await comeBack(page);
    await until(() => reloaded(page), "the page reloads itself");
    await backAgain(page);
    // (The reloaded page then loads js/config.js itself, without a query: not a look.)
    const looks = asked.filter((u) => /config\.js\?look=/.test(u));
    assert.equal(looks.length, 1, "one look: " + asked);
    assert.ok(/config\.js\?/.test(looks[0]), "asked in a way the offline worker does not answer from its kept copy: " + looks[0]);
  },
});
cases.push({
  name: "a new version on the server that a reload would not reach yet (the worker still keeps this one) does not reload the page",
  async run({ page }) {
    await money(page);
    await mark(page);
    const running = await page.evaluate(async () => (await import("/js/config.js")).APP_VERSION);
    const asked = [];
    // The server has 9999; what a reload would be answered with is still the running version.
    await page.route("**/js/config.js*", (route) => {
      const url = route.request().url();
      asked.push(url);
      return route.fulfill({ status: 200, contentType: "text/javascript", body: CONFIG(/\?look=/.test(url) ? "9999" : running) });
    });
    await comeBack(page);
    await until(() => asked.filter((u) => !/\?look=/.test(u)).length >= 1, "the page asks what a reload would get");
    await page.waitForTimeout(600);
    assert.equal(await reloaded(page), false, "no reload that would land on the same version");
    assert.equal(asked.filter((u) => /\?look=/.test(u)).length, 1, "one look: " + asked);
  },
});
cases.push({
  name: "the same APP_VERSION, a failed answer or an odd one change nothing, and looks are at least 10 minutes apart",
  async run({ page }) {
    const backend = await money(page);
    await mark(page);
    const running = await page.evaluate(async () => (await import("/js/config.js")).APP_VERSION);
    // The page's looks are counted where they leave it; one can be made to fail (as a lost signal does, which the page's own fetch reports without a console error).
    await page.evaluate(() => {
      const real = globalThis.fetch;
      globalThis.__looks = 0;
      globalThis.__failLook = false;
      globalThis.fetch = function (url, ...rest) {
        if (/config\.js\?look=/.test(String(url))) {
          globalThis.__looks++;
          if (globalThis.__failLook) return Promise.reject(new TypeError("Failed to fetch"));
        }
        return real.call(this, url, ...rest);
      };
    });
    const looks = () => page.evaluate(() => globalThis.__looks);
    let answer = CONFIG(running);
    await page.route("**/js/config.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: answer }));
    const settle = () => page.waitForTimeout(250);
    await comeBack(page);
    await until(async () => (await looks()) === 1, "the first look");
    await settle();
    assert.equal(await reloaded(page), false, "the same version: nothing");
    // Inside ten minutes, no second look.
    await advance(page, backend, 5 * 60000);
    await comeBack(page);
    await settle();
    assert.equal(await looks(), 1, "not again within ten minutes");
    // Ten minutes on, with no answer: nothing, and the next return tries again (a failed look is not held against it).
    await advance(page, backend, 6 * 60000);
    await page.evaluate(() => { globalThis.__failLook = true; });
    await comeBack(page);
    await until(async () => (await looks()) === 2, "the second look");
    await settle();
    assert.equal(await reloaded(page), false, "no answer: nothing");
    await page.evaluate(() => { globalThis.__failLook = false; });
    answer = "<html>a captive page</html>";
    await comeBack(page);
    await until(async () => (await looks()) === 3, "a failed look is tried again at the next return");
    await settle();
    assert.equal(await reloaded(page), false, "an odd answer: nothing");
    // An odd answer counts as a look: ten minutes again, then a different version reloads.
    await comeBack(page);
    await settle();
    assert.equal(await looks(), 3, "an odd answer is not asked again at once");
    answer = CONFIG("9999");
    await advance(page, backend, 11 * 60000);
    await comeBack(page);
    await until(async () => (await looks()) === 4, "the fourth look");
    await until(() => reloaded(page), "a different version reloads");
    await backAgain(page);
  },
});
cases.push({
  name: "a different APP_VERSION while a sheet is open waits, and reloads once the sheet is closed",
  async run({ page }) {
    const backend = await money(page);
    await page.click("#youBtn");
    await waitOpen(page, "you");
    await mark(page);
    const asked = [];
    await serveVersion(page, "9999", asked);
    await comeBack(page);
    // The look, then what a reload would get (both answered with the new version here).
    await until(() => asked.filter((u) => /\?look=/.test(u)).length === 1 && asked.length >= 2, "the look and the second read");
    await advance(page, backend, 10000);
    assert.equal(await reloaded(page), false, "not while You is open");
    await page.click("#youDone");
    await until(() => page.evaluate(() => !document.getElementById("phone").classList.contains("you-open")), "You closes");
    // Not awaited: the reload it sets off happens inside this call, which then never answers.
    page.clock.fastForward(4000).catch(() => {});
    await until(() => reloaded(page), "then it reloads");
    await backAgain(page);
  },
});

// ---- 12. a computer's keys ----
const dayText = (page) => page.textContent("#dayCount span");
async function both(page) {
  const backend = await open(page, { seed: WITH_PLAN, nowMs: NOON12, tab: "money" });
  await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0 && document.querySelectorAll("#rail .pg .tk").length === 11), "both panes draw");
  return backend;
}
cases.push({
  name: "on a computer the arrow keys move the day with nothing focused, and not while a field or a sheet has focus",
  viewport: WIDE,
  mobile: false,
  async run({ page }) {
    await both(page);
    assert.equal(await dayText(page), "Day 3 of 11");
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, "nothing is focused");
    await page.keyboard.press("ArrowRight");
    await until(async () => (await dayText(page)) === "Day 4 of 11", "the right arrow shows the next day");
    await page.keyboard.press("ArrowLeft");
    await until(async () => (await dayText(page)) === "Day 3 of 11", "the left arrow goes back");
    // A field has focus: the arrow is the field's.
    await page.click("#ring");
    await waitOpen(page, "reg");
    await page.click("#xWhat");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250);
    assert.equal(await dayText(page), "Day 3 of 11", "not while a field has focus");
    // The register is open and nothing has focus: still not.
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250);
    assert.equal(await dayText(page), "Day 3 of 11", "not while the register is open");
    await page.keyboard.press("Escape");
    await until(async () => !(await isOpen(page, "reg")), "the register closes");
    // A Days sheet is open: not.
    // Opened without a click in the strip, so the browser's own arrow scrolling is not aimed at it.
    await page.evaluate((d) => document.querySelector('#rail .pg[data-date="' + d + '"] .tk-stay').click(), D12);
    await waitOpen(page, "stay");
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250);
    assert.equal(await dayText(page), "Day 3 of 11", "not while a sheet is open");
  },
});
cases.push({
  name: "on a computer a key that is not an arrow still does what the browser does with it: Tab moves focus off the page",
  viewport: WIDE,
  mobile: false,
  async run({ page }) {
    await both(page);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement !== document.body), true, "Tab focused a control");
  },
});
cases.push({
  name: "on a computer the arrow keys do nothing to Days while Before covers its pane",
  viewport: WIDE,
  mobile: false,
  async run({ page }) {
    await both(page);
    await page.evaluate(() => {
      document.getElementById("beforeBtn").hidden = false;
      document.querySelector('#nav button[data-tab="before"]').click();
    });
    await until(() => page.evaluate(() => !document.getElementById("vDays").classList.contains("is-active")), "Before covers Days");
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250);
    assert.equal(await dayText(page), "Day 3 of 11");
  },
});
cases.push({
  name: "on a computer the register takes the numpad's comma as the decimal point, as well as the full stop",
  viewport: WIDE,
  mobile: false,
  async run({ page }) {
    await both(page);
    await page.click("#ring");
    await waitOpen(page, "reg");
    const amt = async () => (await page.textContent("#xAmt")).replace(/\s+/g, "");
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press("1");
    // The numpad of a comma keyboard: key ",", code NumpadDecimal.
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: ",", code: "NumpadDecimal", bubbles: true, cancelable: true })));
    await page.keyboard.press("5");
    assert.equal(await amt(), "$1.5");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press(",");
    await page.keyboard.press("2");
    assert.equal(await amt(), "$0.2");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press(".");
    await page.keyboard.press("7");
    assert.equal(await amt(), "$0.7", "the full stop still does");
  },
});
cases.push({
  name: "Report a problem on the two-pane view says Days and Money",
  viewport: WIDE,
  mobile: false,
  async run({ page }) {
    await both(page);
    await page.click("#youBtn");
    await waitOpen(page, "you");
    await until(async () => (await rect(page, "#you")).bottom < 701, "the sheet has risen");
    await page.click("#setReport");
    await until(() => page.evaluate(() => document.getElementById("ubarT").textContent === "Copied. Paste it to Mo or Claude."), "copied");
    const note = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(note, /^Screen: Days and Money$/m);
  },
});


// ---- 7. every screen at 320x568 ----
// What is wrong on the screen showing, as sentences: sideways scroll, text off
// the screen's sides, clipped or ellipsised, set smaller than the smallest
// label (10.5 px, the bar's small words), or drawn over other text. Text that
// is covered by something on top (a sheet over Days, the bar over a scrolled
// view) is not looked at, and the day strip scrolls sideways by design.
const SMALLEST = 10.5;
async function trouble(page) {
  const ink = await page.evaluateHandle(require("./text-ink.cjs"));
  return page.evaluate(({ smallest, ink }) => {
    const out = [];
    const desc = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/).join(".") : "");
    const doc = document.documentElement;
    if (doc.scrollWidth > innerWidth + 0.5) out.push("the page scrolls sideways: " + doc.scrollWidth + " > " + innerWidth);
    for (const v of document.querySelectorAll(".view.is-active, .sheet.is-open, .hist.is-open, .reg.is-open, .un:not([hidden]) .un-rows")) {
      if (v.scrollWidth > v.clientWidth + 0.5) out.push("scrolls sideways: " + desc(v) + " " + v.scrollWidth + " > " + v.clientWidth);
    }
    const leaves = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode;
      const el = t.parentElement;
      if (!t.textContent.trim() || !el || el.closest("script, style, svg, [hidden], [inert], #rail")) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      let faded = false;
      for (let p = el; p; p = p.parentElement) if (Number(getComputedStyle(p).opacity) === 0) faded = true;
      if (faded) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      const rs = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      const r0 = rs.find((r) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth);
      if (!r0) continue;
      const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(1, r0.left + Math.min(r0.width / 2, 8))), Math.min(innerHeight - 1, Math.max(1, r0.top + r0.height / 2)));
      if (!hit || !(el.contains(hit) || hit.contains(el))) continue;
      leaves.push({ node: t, el, rs, text: t.textContent.trim().slice(0, 24) });
    }
    for (const l of leaves) {
      const fs = parseFloat(getComputedStyle(l.el).fontSize);
      if (fs < smallest) out.push("set at " + fs + " px: " + desc(l.el) + " " + JSON.stringify(l.text));
      const chips = l.el.closest(".chips");
      const scrollableChips = chips && ["auto", "scroll"].includes(getComputedStyle(chips).overflowX) && chips.scrollWidth > chips.clientWidth;
      if (!scrollableChips && l.rs.some((r) => r.right > innerWidth + 0.5 || r.left < -0.5)) out.push("off the screen's side: " + desc(l.el) + " " + JSON.stringify(l.text));
      for (let p = l.el; p && p.id !== "phone"; p = p.parentElement) {
        const cs = getComputedStyle(p);
        // The views, the day strip and the quick chips scroll sideways by design.
        if (p.classList.contains("view") || p.classList.contains("views") || p.classList.contains("chips")) break;
        if (["hidden", "clip", "auto", "scroll"].includes(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) {
          out.push("clipped by " + desc(p) + " (" + p.scrollWidth + " > " + p.clientWidth + "): " + JSON.stringify(l.text));
          break;
        }
      }
    }
    const inter = (a, b) => {
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return w > 1.5 && h > 1.5 ? w * h : 0;
    };
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i], b = leaves[j];
        if (a.el === b.el) continue;
        if ((a.el.closest("#nav") && b.el.closest(".view")) || (b.el.closest("#nav") && a.el.closest(".view"))) continue;
        if (!a.rs.some(ra => b.rs.some(rb => inter(ra, rb) > 6))) continue;
        a.ink ??= ink(a.node);
        b.ink ??= ink(b.node);
        if (a.ink.some(ra => b.ink.some(rb => inter(ra, rb) > 6))) out.push("overlap: " + JSON.stringify(a.text) + " (" + desc(a.el) + ") and " + JSON.stringify(b.text) + " (" + desc(b.el) + ")");
      }
    }
    return out;
  }, { smallest: SMALLEST, ink });
}
const SHOTS = require("./shots.cjs")("polish");
async function clean(page, name) {
  const fs = require("fs");
  fs.mkdirSync(SHOTS, { recursive: true });
  // The sheets rise and the views fade in real time.
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOTS + "/320-" + name + ".png" });
  const found = await trouble(page);
  assert.deepEqual(found, [], "at 320x568, " + name + ": " + found.join("; "));
}
const SMALL = { width: 320, height: 568 };
const PLANNER_ID = "fakePlannerSheet_0123456789abcdefXYZ";
const BHEAD = ["#", "Item", "Who", "Book by", "Status", "Notes", "Booking link"];
const BITEMS = [
  { "#": 1, Item: "Rail pass seat reservations", "Book by": "2026-11-14", Status: "Not booked", Notes: "Window seats for three, both legs." },
  { "#": 2, Item: "Tea ceremony class", "Book by": "2026-11-18", Status: "Pending" },
];
const stampDefs = () => ["s01", "s02", "s03", "s04"].map((id, i) => ({ id, date: "2026-12-1" + i, name_ja: "試" + i, name_en: "Testville " + i, place: "Place " + i, motif: "tower", ink: "ai", shape: "round" }));
const walk = {
  async days(page) { await days(page); },
  async "days-stop-open"(page) {
    await days(page);
    const row = '#rail .pg[data-date="' + D12 + '"] .r[data-id="' + DINNER + '"]';
    await page.evaluate((sel) => document.querySelector(sel + " .r-b").click(), row);
    await until(() => page.evaluate((sel) => document.querySelector(sel).classList.contains("is-open"), row), "the stop opens");
  },
  async "stop-sheet"(page) {
    await walk["days-stop-open"](page);
    const edit = '#rail .pg[data-date="' + D12 + '"] .r[data-id="' + DINNER + '"] .r-edit';
    await until(() => page.evaluate((sel) => { const e = document.querySelector(sel); return !!e && e.getBoundingClientRect().height > 0; }, edit), "Edit shows");
    await page.evaluate((sel) => document.querySelector(sel).click(), edit);
    await waitOpen(page, "stop");
  },
  async "all-days"(page) {
    await days(page);
    await page.click("#dayCount");
    await waitOpen(page, "allDays");
  },
  async lodging(page) {
    await days(page);
    await page.click('#rail .pg[data-date="' + D12 + '"] .tk-stay');
    await waitOpen(page, "stay");
  },
  async money(page) { await money(page); },
  async "ring-up"(page) {
    await money(page);
    await page.click("#ring");
    await waitOpen(page, "reg");
    for (const k of ["3", "0", "0", "0"]) await page.click('#pad .key[data-k="' + k + '"]');
  },
  async "ring-up-uneven"(page) {
    await walk["ring-up"](page);
    await page.click("#xUneven");
    await until(() => visible(page, "#un"), "the panel opens");
  },
  async "ring-up-uneven-exact"(page) {
    await walk["ring-up-uneven"](page);
    await page.click('#unMode [data-mode="exact"]');
    await until(() => page.evaluate(() => !!document.querySelector("#un input.un-val")), "exact amounts");
    await page.fill("#un .un-row:first-child input.un-val", "1000");
  },
  async you(page) {
    await money(page);
    await page.click("#youBtn");
    await waitOpen(page, "you");
  },
  async history(page) {
    await money(page);
    await page.click("#histBtn");
    await waitOpen(page, "hist");
    await until(() => page.evaluate(() => document.querySelectorAll("#hist .tp-row").length > 0), "the tape fills");
  },
  async before(page) {
    const { makeBackend } = require("./helpers.cjs");
    const now = Date.parse("2026-11-16T19:00:00Z");
    const backend = makeBackend({ ...SEED, plannerId: PLANNER_ID, plannerTabs: { "Book Now": [["Before we go: bookings"], BHEAD, ...BITEMS.map((o) => BHEAD.map((h) => (o[h] === undefined ? "" : o[h])))], "Change Log": [[]] } }, { now });
    backend.now = now - 5 * 60000;
    await backend.fake({ key: "test-key", actor: "Mo", action: "syncTodos", args: {} });
    backend.now = now;
    await open(page, { backend, nowMs: now, tab: "days" });
    await until(() => visible(page, "#beforeBtn"), "the Before tab is in the bar");
    await page.click('#nav button[data-tab="before"]');
    await until(() => visible(page, "#todos"), "the list shows");
  },
  async "stamp-book"(page) {
    const { makeBackend } = require("./helpers.cjs");
    const backend = makeBackend(WITH_PLAN, { now: NOON12 });
    for (const d of stampDefs()) backend.fake.tables.StampDefs.push(d);
    await open(page, { backend, nowMs: NOON12, tab: "days" });
    await until(() => visible(page, "#stampBtn"), "the stamp button shows");
    await page.click("#stampBtn");
    await waitOpen(page, "book");
  },
};
for (const name of Object.keys(walk)) {
  cases.push({
    name: "at 320x568 nothing is clipped, overlapping, off the side or under the smallest label: " + name,
    viewport: SMALL,
    async run({ page }) {
      await walk[name](page);
      await clean(page, name);
    },
  });
}

module.exports = cases;
