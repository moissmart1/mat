// Task 17: a tap in You shows that it worked. The word on the right of a row
// that copies or fetches answers at once and then says what happened; the
// notice it raises is seen above the open sheet.

const assert = require("node:assert/strict");
const { ORIGIN, SEED, NOON12, open, advance, until, atRest, text, expectText } = require("./helpers.cjs");

const PHEAD = ["payment_id", "date_paid", "payer", "description", "category", "vendor", "booking_ref", "amount", "currency", "amount_cad", "cad_is_exact", "split_between", "split_type", "status", "include_in_split", "source", "added_by", "notes"];
const prow = (o) => PHEAD.map((h) => (o[h] === undefined ? "" : o[h]));
const PLANNER_ID = "fakePlannerSheet_0123456789abcdefXYZ";
// As if a phone pulled a moment ago, so opening the app does not pull on its own and Fetch is what brings payments in.
const JUST_PULLED = new Date(NOON12).toISOString();
const PLANNER = [
  PHEAD,
  prow({ payment_id: "X7", date_paid: "2026-12-11", payer: "Mo", description: "Rail pass", category: "transport", amount: 24750, currency: "JPY", amount_cad: 221.52, cad_is_exact: "yes", split_between: "Mo, Ajen, Trenton", split_type: "equal", include_in_split: "yes" }),
  prow({ payment_id: "Q3", date_paid: "2026-12-12", payer: "Ajen", description: "Noodle bar", category: "food", amount: 3600, currency: "JPY", split_between: "Mo, Ajen", split_type: "equal", include_in_split: "yes" }),
];

const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());
const requests = (backend, action) => backend.requests.filter((r) => r.action === action).length;

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: SEED, nowMs: NOON12, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0), "the receipt draws");
  await page.click("#youBtn");
  await atRest(page, "#you", { message: "the settings sheet opens" });
  return backend;
}

// Every way of writing the clipboard fails, as on a phone that refuses it.
const denyClipboard = (page) =>
  page.evaluate(() => {
    const no = () => Promise.reject(new Error("denied"));
    navigator.clipboard.write = no;
    navigator.clipboard.writeText = no;
    document.execCommand = () => false;
  });

// Holds the backend's answer to `action` until release() is called.
function hold(backend, action) {
  let release;
  let asked = 0;
  const gate = new Promise((r) => (release = r));
  const handle = backend.handle;
  backend.handle = async (body) => {
    if (body.action === action) {
      asked++;
      await gate;
    }
    return handle(body);
  };
  return { release: () => release(), asked: () => asked, restore: () => (backend.handle = handle) };
}

// Where a tap at the middle of `sel` lands: inside it, or on what is drawn over it.
const onTop = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!hit && el.contains(hit);
  }, sel);
const inView = (page, sel) =>
  page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  }, sel);

async function noticeAboveSheet(page) {
  await page.click("#setInvite");
  await expectText(page, "#ubarT", "Link copied.");
  assert.ok(await inView(page, "#ubar"), "the notice is in the viewport");
  assert.ok(await onTop(page, "#ubar"), "the notice is drawn over the open sheet and its scrim");
  // The tap scrolled the sheet down to the row; scrolled back, Done is clear.
  await page.evaluate(() => (document.getElementById("you").scrollTop = 0));
  assert.ok(await onTop(page, "#youDone"), "Done is not covered by the notice");
  assert.ok(await inView(page, "#youDone"), "Done is in view");
  await page.click("#youDone");
  await atRest(page, "#you", { open: false, message: "Done closes the sheet" });
}

module.exports = [
  {
    name: "Invite link: Copy, Copied ✓ for two seconds, Copy again; with the clipboard refused, Not copied for three",
    async run({ page }) {
      const backend = await ready(page);
      assert.equal(await text(page, "#setInviteV"), "Copy");
      assert.equal(await page.getAttribute("#setInviteV", "aria-live"), "polite");
      await page.click("#setInvite");
      await expectText(page, "#setInviteV", "Copied ✓");
      assert.equal(await clipboard(page), ORIGIN + "/#k=test-key", "the same link as before");
      await advance(page, backend, 1900);
      assert.equal(await text(page, "#setInviteV"), "Copied ✓");
      await advance(page, backend, 200);
      await expectText(page, "#setInviteV", "Copy");

      await denyClipboard(page);
      await page.click("#setInvite");
      await expectText(page, "#setInviteV", "Not copied");
      await expectText(page, "#ubarT", "Couldn’t copy. Try again.");
      await advance(page, backend, 2900);
      assert.equal(await text(page, "#setInviteV"), "Not copied");
      await advance(page, backend, 200);
      await expectText(page, "#setInviteV", "Copy");
    },
  },
  {
    name: "Claude link: Getting… while the token comes, then Copied ✓, then Copy; a second tap meanwhile asks nothing; no signal says Not copied",
    async run({ page }) {
      const backend = await ready(page, { own: "Mo" });
      assert.equal(await page.getAttribute("#setClaudeV", "aria-live"), "polite");
      const h = hold(backend, "claudeLink");
      await page.click("#setClaude");
      await expectText(page, "#setClaudeV", "Getting…");
      await page.evaluate(() => document.getElementById("setClaude").click());
      h.release();
      await expectText(page, "#setClaudeV", "Copied ✓");
      assert.match(await clipboard(page), /\?t=claude-token&as=Mo$/);
      assert.equal(h.asked(), 1, "one token for two taps");
      h.restore();
      await advance(page, backend, 2000);
      await expectText(page, "#setClaudeV", "Copy");

      await page.evaluate(() => navigator.clipboard.writeText("before"));
      backend.failWith = "network";
      await page.click("#setClaude");
      await expectText(page, "#setClaudeV", "Not copied");
      assert.equal(await clipboard(page), "before");
      backend.failWith = null;
      await advance(page, backend, 3000);
      await expectText(page, "#setClaudeV", "Copy");
    },
  },
  {
    name: "Report a problem: Copied ✓ then Copy; with the clipboard refused, Not copied then Copy",
    async run({ page }) {
      const backend = await ready(page);
      assert.equal(await page.getAttribute("#setReportV", "aria-live"), "polite");
      await page.click("#setReport");
      await expectText(page, "#setReportV", "Copied ✓");
      assert.match(await clipboard(page), /^MAT: a problem to look at\nWho: Mo\n/);
      await advance(page, backend, 2000);
      await expectText(page, "#setReportV", "Copy");

      await denyClipboard(page);
      await page.click("#setReport");
      await expectText(page, "#setReportV", "Not copied");
      await advance(page, backend, 3000);
      await expectText(page, "#setReportV", "Copy");
    },
  },
  {
    name: "Last updated: Fetching… while it loads (a second tap starts nothing), Up to date ✓, then the time; a failed fetch says No signal and comes back",
    async run({ page }) {
      const backend = await ready(page);
      // The time changes under every sync, so it is not a live region; what a tap said is in the status line (tests/e2e/polish.e2e.cjs).
      assert.equal(await page.getAttribute("#setFresh", "aria-live"), null);
      assert.equal(await page.getAttribute("#setFreshSay", "role"), "status");
      const time = await text(page, "#setFresh");
      assert.match(time, /^Up to date \d\d:\d\d$/);
      const before = requests(backend, "load");
      const h = hold(backend, "load");
      await page.click("#setFreshRow");
      await expectText(page, "#setFresh", "Fetching…");
      await page.evaluate(() => document.getElementById("setFreshRow").click());
      h.release();
      await expectText(page, "#setFresh", "Up to date ✓");
      assert.equal(requests(backend, "load") - before, 1, "one load for two taps");
      h.restore();
      await advance(page, backend, 2000);
      await expectText(page, "#setFresh", /^Up to date \d\d:\d\d$/);

      backend.failWith = "network";
      await page.click("#setFreshRow");
      await expectText(page, "#setFresh", "No signal");
      backend.failWith = null;
      await advance(page, backend, 2000);
      await expectText(page, "#setFresh", /^Up to date \d\d:\d\d$/);
    },
  },
  {
    name: "Planner payments: Added 2, then Fetch; Nothing new; a failed pull says Not fetched; a second tap while busy does nothing",
    async run({ page }) {
      const backend = await ready(page, { seed: { ...SEED, planner: PLANNER, plannerId: PLANNER_ID, paymentsPulledAt: JUST_PULLED } });
      assert.equal(await page.getAttribute("#setPlannerV", "aria-live"), "polite");
      const h = hold(backend, "syncPayments");
      await page.click("#setPlanner");
      await expectText(page, "#setPlannerV", "Fetching…");
      await page.evaluate(() => document.getElementById("setPlanner").click());
      h.release();
      await expectText(page, "#setPlannerV", "Added 2");
      await expectText(page, "#ubarT", "Added 2 payments from the planner.");
      assert.equal(h.asked(), 1, "one pull for two taps");
      h.restore();
      await advance(page, backend, 3900);
      assert.equal(await text(page, "#setPlannerV"), "Added 2");
      await advance(page, backend, 200);
      await expectText(page, "#setPlannerV", "Fetch");

      await page.click("#setPlanner");
      await expectText(page, "#setPlannerV", "Nothing new");
      await advance(page, backend, 4000);
      await expectText(page, "#setPlannerV", "Fetch");

      backend.failWith = "network";
      await page.click("#setPlanner");
      await expectText(page, "#setPlannerV", "Not fetched");
      backend.failWith = null;
      await advance(page, backend, 4000);
      await expectText(page, "#setPlannerV", "Fetch");
    },
  },
  {
    name: "a row that throws never stays busy",
    async run({ page }) {
      const backend = await ready(page, { seed: { ...SEED, planner: PLANNER, plannerId: PLANNER_ID, paymentsPulledAt: JUST_PULLED } });
      await page.evaluate(() => {
        globalThis.__matTest.store.syncPayments = () => Promise.reject(new Error("test"));
        globalThis.__matTest.store.refresh = () => Promise.reject(new Error("test"));
      });
      await page.click("#setPlanner");
      await expectText(page, "#setPlannerV", "Not fetched");
      await page.click("#setFreshRow");
      await expectText(page, "#setFresh", "No signal");
      await advance(page, backend, 4000);
      await expectText(page, "#setPlannerV", "Fetch");
      await expectText(page, "#setFresh", /^Up to date \d\d:\d\d$/);
      assert.equal(await page.isDisabled("#setPlanner"), false);
    },
  },
  {
    name: "a row looks pressed while it is held down",
    async run({ page }) {
      await ready(page);
      const look = () => page.evaluate(() => {
        const s = getComputedStyle(document.getElementById("setInvite"));
        return s.backgroundColor + "|" + s.transform;
      });
      await page.hover("#setInvite");
      const up = await look();
      await page.mouse.down();
      await until(async () => (await look()) !== up, "the row looks pressed while held");
      await page.mouse.up();
      await until(async () => (await look()) === up, "and lets go after");
    },
  },
  {
    name: "with You open, a notice is drawn in view over the sheet, and Done is still reachable",
    async run({ page }) {
      await ready(page);
      await noticeAboveSheet(page);
    },
  },
  {
    name: "held sideways at 844 × 390, a notice is drawn in view over the open sheet, and Done is still reachable",
    viewport: { width: 844, height: 390 },
    async run({ page }) {
      await ready(page);
      await noticeAboveSheet(page);
    },
  },
];
