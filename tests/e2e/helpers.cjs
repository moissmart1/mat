// Shared tools for the click-through tests (*.e2e.cjs), run by run.cjs.
//
// The fake backend lives in Node (ruling R3): tests/fake-backend.cjs runs the
// real backend action code over in-memory tables, and the page reaches it
// through a function bridged in with page.exposeFunction. So data survives a
// reload, two pages can share one backend, and tests can look at the tables
// or act as "another phone" by calling backend.handle(...) directly.

const fs = require("fs");
const path = require("path");
const { createFakeBackend } = require("../fake-backend.cjs");

// MAT_PORT picks the port (default 4173). Two checkouts testing at once need two ports:
// on one port the second run would be served the first one's files.
const PORT = Number(process.env.MAT_PORT) || 4173;
const ORIGIN = "http://localhost:" + PORT;
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "seed.json"), "utf8"));
// A small plan (days, stops, stays) to lay over the seed: WITH_PLAN.
const PLAN = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "plan.json"), "utf8"));
const WITH_PLAN = { ...SEED, ...PLAN };
// 2026-12-12 13:20 in Japan.
const NOON12 = Date.parse("2026-12-12T13:20:00+09:00");
// When seed items without an addedAt / stampedAt were made: before the trip,
// so they are never "new" to a viewer who has looked since.
const SEEDED_AT = "2026-11-20T00:00:00.000Z";

const copy = (v) => JSON.parse(JSON.stringify(v));

// "YYYY-MM-DD" in Japan at this instant.
const japanDate = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

// backend = { handle(body) -> Promise<envelope>, fake, requests, failWith, now }.
// failWith: null (normal), "network" (handle rejects, so the page's call
// fails as if there were no signal), or any other string (handle resolves
// { ok: false, error: <that string>, message: "test" }).
// now: the backend's clock in ms (starts at `now`, default the real time).
// Every write is dated backend.now; it only moves when a test moves it, so
// use advance(page, backend, ms) to move it together with the page's clock.
// Seed items with no addedAt / stampedAt are dated SEEDED_AT instead.
// An explicit `clock` (() => ISO string) replaces backend.now for writes.
function makeBackend(seed, { clock, now = Date.now() } = {}) {
  let seeding = true;
  const backend = {
    fake: null,
    requests: null,
    failWith: null,
    now,
    async handle(body) {
      if (backend.failWith === "network") throw new Error("network");
      if (backend.failWith) return { ok: false, error: backend.failWith, message: "test" };
      return backend.fake(body);
    },
  };
  const writeTime = clock || (() => new Date(backend.now).toISOString());
  backend.fake = createFakeBackend(copy(seed || {}), { clock: () => (seeding ? SEEDED_AT : writeTime()) });
  backend.requests = backend.fake.requests;
  seeding = false;
  return backend;
}

// Opens the app on `page` against a fake backend and returns that backend.
// - seed / backend: build a backend from `seed`, or use the one given (pass
//   the same backend to two pages to share it).
// - key, me, how: put into localStorage as mat.key / mat.me / mat.how; null
//   leaves it unset. how defaults to "1" (the how-this-works lines already
//   seen), so only first-open tests see them.
// - storage: more localStorage keys. Every key is only written when not set
//   already, so a reload keeps whatever the app stored.
// - hash: appended to the address (for example "#k=test-key").
// - own: a person's name: the phone opens on that person's own link (a
//   personal key made on the backend, kept as backend.ownKeys[name], so two
//   pages on one backend share it) in place of the shared key; me is then
//   theirs (security, 2026-11-18).
// - tab: the screen the app last showed, put into localStorage as mat.tab,
//   with mat.tabDay the Japan date of nowMs (as if it was shown today), so
//   the app opens on it. Default "money"; "days" for the Days screen; null
//   writes neither (the app then decides, from whatever `storage` holds).
// Time: the page's clock is installed and paused at nowMs, and a backend
// built here starts its clock (backend.now) at nowMs too. Neither moves on
// its own: call advance(page, backend, ms) to move both together, so the
// backend never dates a write ahead of (or behind) what the page shows.
async function open(page, { seed = SEED, key = "test-key", me = "Mo", how = "1", nowMs = NOON12, storage = {}, backend, hash = "", tab = "money", own = null } = {}) {
  const be = backend || makeBackend(seed, { now: nowMs });
  if (own) {
    key = ownKey(be, own);
    me = own;
  }

  await page.exposeFunction("__matBridge", async (body) => {
    try {
      return { env: await be.handle(body) };
    } catch {
      return { network: true };
    }
  });
  await page.addInitScript(() => {
    globalThis.MAT_FAKE_API = async (body) => {
      const r = await globalThis.__matBridge(body);
      if (!r || r.network) throw new Error("No signal");
      return r.env;
    };
  });

  const kept = { "mat.key": key, "mat.me": me, "mat.how": how, "mat.tab": tab, "mat.tabDay": tab === null ? null : japanDate(nowMs) };
  const entries = Object.entries({ ...kept, ...storage })
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => [k, String(v)]);
  // Seeded once per tab (a sessionStorage mark): a reload after the app took
  // the trip off the phone (a refused key, Forget this phone) must not put
  // the key back.
  const mark = "e2e.seeded." + ++seedCount;
  await page.addInitScript(([pairs, mark]) => {
    try {
      if (sessionStorage.getItem(mark) !== null) return;
      sessionStorage.setItem(mark, "1");
    } catch {
      // no session storage: seed as before
    }
    try {
      for (const [k, v] of pairs) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    } catch {
      // about:blank and the like have no storage
    }
  }, [entries, mark]);

  // Install a minute early, then pause at nowMs: install starts the clock
  // running in real time, so installing at nowMs itself lets a slow machine
  // tick past nowMs before pauseAt and Playwright throws "Cannot fast-forward
  // to the past". The margin makes the order impossible to reverse.
  await page.clock.install({ time: nowMs - 60000 });
  await page.clock.pauseAt(nowMs);
  await page.goto(ORIGIN + "/" + hash);
  // Initial geometry is measured with the faces the page has requested.
  await page.evaluate(() => document.fonts.ready.then(() => true));
  return be;
}

let seedCount = 0;

// Person `name`'s own key on this backend (made once, as issueLinks would).
function ownKey(backend, name) {
  backend.ownKeys = backend.ownKeys || {};
  if (!backend.ownKeys[name]) backend.ownKeys[name] = backend.fake.personKey(name);
  return backend.ownKeys[name];
}

// Moves the page's clock (running any timers due) and the backend's clock
// forward together by `ms`.
async function advance(page, backend, ms) {
  await page.clock.fastForward(ms);
  backend.now += ms;
}

// Polls `check` (sync or async, run in Node) until it returns something
// truthy, and returns that. Throws Error(message) after `timeout` ms.
// Uses Node's own timers, so it works whatever the page's clock is doing.
async function until(check, message, timeout = 5000) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      const v = await check();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(message + (last ? " (" + last.message + ")" : ""));
    await new Promise((r) => setTimeout(r, 40));
  }
}

// Waits until a sheet or panel (any element that slides in and out on a class)
// has come to rest: its class says open (or shut, with open: false), nothing
// on it or inside it is still running a finite transition or animation on
// the page's own timeline, and its box is the same on two looks in a row.
// Waiting for the class alone is not enough: the class goes on as the slide
// starts, and a tap aimed then lands where the control was, not where it is
// (the hotel card's Done was 415 px below where it comes to rest, under the
// screen; CI 2026-11-21, and the register's keys in line.e2e before that).
// Infinite animations and scroll-driven ones (the Days rail's fan) never end
// and are not the slide, so they are left out.
async function atRest(page, selector, { open: isOpen = true, cls = "is-open", timeout = 5000 } = {}) {
  let last = null;
  await until(async () => {
    const now = await page.evaluate(([sel, cls, isOpen]) => {
      const el = document.querySelector(sel);
      if (!el || el.classList.contains(cls) !== isOpen) return null;
      const moving = el.getAnimations({ subtree: true }).some((a) => a.playState === "running" && a.timeline === document.timeline && a.effect && a.effect.getTiming().iterations !== Infinity);
      if (moving) return null;
      const b = el.getBoundingClientRect();
      return [b.left, b.top, b.width, b.height].join(",");
    }, [selector, cls, isOpen]);
    const same = now !== null && now === last;
    last = now;
    return same;
  }, selector + (isOpen ? " opens" : " closes") + " and comes to rest", timeout);
}

// The trimmed textContent of the first match, or null when there is none.
function text(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.textContent.replace(/\s+/g, " ").trim() : null;
  }, selector);
}

// Waits for `selector`'s text to equal `expected` (a string) or match it (a RegExp).
async function expectText(page, selector, expected, timeout) {
  let got;
  const ok = (t) => (expected instanceof RegExp ? expected.test(t || "") : t === expected);
  try {
    await until(async () => ok((got = await text(page, selector))), "", timeout);
  } catch {
    throw new Error(selector + ": expected " + JSON.stringify(String(expected)) + ", got " + JSON.stringify(got));
  }
}

// Whether the first match is present and drawn (not hidden, has a size).
function visible(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.closest("[hidden]")) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }, selector);
}

module.exports = { PORT, ORIGIN, SEED, PLAN, WITH_PLAN, NOON12, SEEDED_AT, makeBackend, open, ownKey, advance, until, atRest, text, expectText, visible };
