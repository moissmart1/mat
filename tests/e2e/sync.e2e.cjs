// Staying in step, working offline, installing (Task 13): two phones on one
// backend, the 20-second check, the #net strip, painting from the cache with
// no signal, and the service worker's offline shell.

const assert = require("node:assert/strict");
const { SEED, NOON12, open, advance, until, text, expectText, visible } = require("./helpers.cjs");

// ---- small tools for this file ----

const POLL_MS = 20000;
const NO_SIGNAL = "No signal. Showing what this phone last saw.";

const waitOpen = (page) =>
  until(
    () => page.evaluate(() => {
      const reg = document.getElementById("reg");
      return reg.classList.contains("is-open") && Math.abs(reg.getBoundingClientRect().bottom - innerHeight) < 1;
    }),
    "the register opens",
  );
const waitClosed = (page) => until(() => page.evaluate(() => !document.getElementById("reg").classList.contains("is-open")), "the register closes");
const rowCount = (page) => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length);
const waitRows = (page, n) => until(async () => (await rowCount(page)) === n, "expected " + n + " receipt rows");
const idle = (page) => page.evaluate(() => globalThis.__matTest.store.idle());

async function keys(page, seq) {
  for (const k of seq.split(" ")) await page.click('#pad .key[data-k="' + k + '"]');
}

// Rings a line up from the register and closes it again.
async function ringUp(page, title, seq) {
  await page.click("#ring");
  await waitOpen(page);
  await page.fill("#xWhat", title);
  await keys(page, seq);
  await until(() => page.evaluate(() => !document.getElementById("kGo").disabled), "#kGo enabled");
  await page.click("#kGo");
}

const rowOf = (page, title) =>
  page.evaluate((t) => {
    const r = [...document.querySelectorAll("#rc .rc-row[data-id]")].find((x) => x.querySelector(".rc-t").firstChild.textContent === t);
    return r ? { id: r.dataset.id, cls: r.className, text: r.textContent } : null;
  }, title);
const waitRow = (page, title, check = () => true, what = "") =>
  until(async () => {
    const r = await rowOf(page, title);
    return r && check(r) ? r : null;
  }, "row " + title + " " + what);
const waitNoRow = (page, title, what = "") => until(async () => !(await rowOf(page, title)), "row " + title + " gone " + what);

// Fires visibilitychange while the page stays visible (coming back to the app).
const comeBack = (page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
const signalBack = (page) => page.evaluate(() => window.dispatchEvent(new Event("online")));

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: SEED, nowMs: NOON12, ...opts });
  await waitRows(page, 8);
  return backend;
}

// Two phones on one backend: Mo on A, Ajen on B, who last looked a minute
// before NOON12 (so lines rung up now are new to him).
async function twoPhones(ctx) {
  const a = ctx.page;
  const backend = await ready(a);
  const b = await ctx.newPhone();
  await ready(b, { backend, me: "Ajen", storage: { "mat.seen": String(NOON12 - 60000) } });
  return { a, b, backend };
}

module.exports = [
  {
    name: "a delayed clock setup starts at the requested instant and each phone owns its timers",
    async run({ page, newPhone }) {
      // Simulate a slow round trip between install and pause without sleeping.
      const install = page.clock.install.bind(page.clock);
      page.clock.install = async (options) => {
        await install(options);
        await page.clock.fastForward(1500);
      };
      const other = await newPhone();
      await open(page);
      await open(other, { nowMs: NOON12 + 3600000 });
      for (const phone of [page, other]) {
        await phone.evaluate(() => { window.fired = false; setTimeout(() => { window.fired = true; }, 100); });
      }
      const state = (phone) => phone.evaluate(() => [Date.now(), window.fired]);
      await page.clock.fastForward(100);
      assert.deepEqual(await state(page), [NOON12 + 100, true]);
      assert.deepEqual(await state(other), [NOON12 + 3600000, false]);
      await other.clock.fastForward(100);
      assert.deepEqual(await state(other), [NOON12 + 3600100, true]);
    },
  },
  {
    name: "a line rung up on one phone shows on the other at its next check, marked new",
    async run(ctx) {
      const { a, b } = await twoPhones(ctx);
      await ringUp(a, "Yakitori", "1 2 0 0");
      await waitRow(a, "Yakitori", (r) => !r.cls.includes("is-pending"), "saved on A");
      await idle(a);
      assert.equal(await rowOf(b, "Yakitori"), null, "B has not checked yet");

      await b.clock.fastForward(POLL_MS - 1000);
      await idle(b);
      assert.equal(await rowOf(b, "Yakitori"), null, "no check before 20 seconds");
      await b.clock.fastForward(1000);
      const row = await waitRow(b, "Yakitori", () => true, "on B after 20 seconds");
      assert.ok(row.cls.includes("is-new"), "marked as new on B: " + row.cls);
      const seedRow = await rowOf(b, "Skyliner");
      assert.ok(seedRow && !seedRow.cls.includes("is-new"), "a line from before B last looked is not new: " + (seedRow && seedRow.cls));
    },
  },
  {
    name: "coming back to the app checks at once",
    async run(ctx) {
      const { a, b } = await twoPhones(ctx);
      await ringUp(a, "Gyoza", "8 0 0");
      await waitRow(a, "Gyoza", (r) => !r.cls.includes("is-pending"), "saved on A");
      await idle(a);
      await comeBack(b);
      const row = await waitRow(b, "Gyoza", () => true, "on B when it comes back");
      assert.ok(row.cls.includes("is-new"));
    },
  },
  {
    name: "an undo on one phone takes the line off the other at its next check",
    async run(ctx) {
      const { a, b } = await twoPhones(ctx);
      await ringUp(a, "Taxi", "3 0 0 0");
      await waitRow(a, "Taxi", (r) => !r.cls.includes("is-pending"), "saved on A");
      await idle(a);
      await comeBack(b);
      await waitRow(b, "Taxi", () => true, "on B");

      await a.click("#regDone");
      await waitClosed(a);
      await a.click("#ubarU");
      await expectText(a, "#ubarT", "Undone.");
      await waitNoRow(a, "Taxi", "on A");
      await idle(a);
      await b.clock.fastForward(POLL_MS);
      await waitNoRow(b, "Taxi", "on B at its next check");
    },
  },
  {
    name: "no signal: #net says so and counts what is waiting; signal back sends it and the strip goes",
    async run({ page }) {
      const backend = await ready(page);
      assert.equal(await visible(page, "#net"), false, "no strip with signal");
      backend.failWith = "network";
      await advance(page, backend, POLL_MS);
      await expectText(page, "#net", NO_SIGNAL);
      assert.equal(await visible(page, "#net"), true);

      await ringUp(page, "Onigiri", "4 5 0");
      await waitRow(page, "Onigiri", (r) => r.cls.includes("is-pending"), "pending");
      await expectText(page, "#net", NO_SIGNAL + " 1 to send.");
      await page.click("#regDone");
      await waitClosed(page);

      // The strip never covers the sentence or the bottom bar.
      const boxes = await page.evaluate(() => {
        document.getElementById("vMoney").scrollTop = 0;
        const r = (id) => document.getElementById(id).getBoundingClientRect();
        return { net: r("net"), say: r("say"), nav: r("nav") };
      });
      assert.ok(boxes.net.bottom <= boxes.say.top, "above the sentence: " + JSON.stringify(boxes));
      assert.ok(boxes.net.bottom <= boxes.nav.top, "clear of the bottom bar");

      backend.failWith = null;
      await signalBack(page);
      await waitRow(page, "Onigiri", (r) => !r.cls.includes("is-pending"), "sent");
      await until(async () => !(await visible(page, "#net")), "#net goes away");
      await idle(page);
      assert.equal(backend.requests.filter((r) => r.action === "addExpense").length, 1, "sent once");
    },
  },
  {
    name: "one check at a time: a check that never answers is not joined by more",
    async run({ page }) {
      const backend = await ready(page);
      let revs = 0;
      const handle = backend.handle;
      backend.handle = (body) => {
        if (body.action !== "rev") return handle(body);
        revs++;
        return new Promise(() => {}); // the backend never answers
      };
      await advance(page, backend, 60000);
      await until(() => revs >= 1, "the first check goes out");
      await comeBack(page); // coming back while the check hangs adds none either
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(revs, 1, "one rev request in 60 seconds, not three");
    },
  },
  {
    name: "no signal on a phone that has never loaded anything: #net says just No signal.",
    async run({ page }) {
      const { makeBackend } = require("./helpers.cjs");
      const backend = makeBackend(SEED, { now: NOON12 });
      backend.failWith = "network";
      await open(page, { backend, nowMs: NOON12 });
      await expectText(page, "#net", "No signal.");
      assert.equal(await rowCount(page), 0);
    },
  },
  {
    name: "a reload with no signal paints the receipt from the cache, dated by the last good load",
    async run({ page }) {
      const backend = await ready(page);
      await expectText(page, "#fresh", "Up to date 13:20");
      backend.failWith = "network";
      await advance(page, backend, 60 * 60 * 1000);
      await page.reload();
      await waitRows(page, 8);
      await expectText(page, "#fresh", "Up to date 13:20");
      assert.equal(await page.evaluate(() => new Date(Date.now()).getHours()), 14, "the phone's clock has moved on");
      await expectText(page, "#net", NO_SIGNAL);
    },
  },
  {
    name: "the service worker takes over after one reload and the shell opens with no network",
    serviceWorkers: "allow",
    async run({ page, context }) {
      await ready(page);
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.reload();
      await waitRows(page, 8);
      assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true, "controlled after one reload");

      // Ask for a real face while controlled so the worker caches both its
      // stylesheet and its bytes before we disconnect.
      const receiptFont = () => page.evaluate(async () => {
        const faces = await document.fonts.load('700 16px "Zen Kaku Gothic New"', "Tokyo東京");
        return faces.length > 0 && faces.every((face) => face.status === "loaded");
      });
      assert.ok(await receiptFont(), "the receipt font loaded online");
      const kept = await page.evaluate(async () => {
        const cache = await caches.open("mat-fonts");
        return (await cache.keys()).map((r) => new URL(r.url).hostname);
      });
      assert.ok(kept.includes("fonts.googleapis.com"), "the font stylesheet is kept: " + JSON.stringify(kept));
      assert.ok(kept.includes("fonts.gstatic.com"), "the worker kept font bytes");

      // Nothing but the fake api (bridged, not on the network) gets through.
      await context.route("**/*", (route) => route.abort());
      await page.reload();
      await waitRows(page, 8);
      assert.ok(await text(page, "#say"), "the sentence draws");
      assert.equal(await visible(page, "#ring"), true);
      assert.ok(await receiptFont(), "the receipt font loads with no network");
    },
  },
  {
    name: "with nothing kept and no network, opening the app says so plainly",
    serviceWorkers: "allow",
    async run({ page, context }) {
      await ready(page);
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.reload();
      await waitRows(page, 8);
      // The phone lost its kept shell (storage cleared) and has no signal.
      await page.evaluate(async () => {
        for (const name of await caches.keys()) if (name.startsWith("mat-shell-")) await caches.delete(name);
      });
      await context.route("**/*", (route) => route.abort());
      await page.reload();
      await expectText(page, "body", "No signal. Open again when you have some.");
    },
  },
];
