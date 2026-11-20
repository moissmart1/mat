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

// What the worker sends each open page when a new release takes over (as tests/e2e/update.e2e.cjs).
const announce = (page) => page.evaluate(() => new Promise((resolve) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => resolve(true);
  navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "mat-new-version" }, ports: [ch.port2] }));
  setTimeout(() => resolve(false), 500);
}));
const markPage = (page) => page.evaluate(() => { window.__notReloaded = true; });
const reloaded = (page) => page.evaluate(() => window.__notReloaded !== true).catch(() => true);
const failQueueWrites = (page) => page.evaluate(() => {
  const save = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === "mat.queue") throw new DOMException("Storage full", "QuotaExceededError");
    return save.call(this, key, value);
  };
});
const MEMORY_ONLY = "Unsent changes are only in this app’s memory: don’t close it while you copy your link.";

// With no signal a line is rung up; then the key is refused, the trip comes
// off the phone and the no-key screen shows, the line kept for the new link.
async function refusedWithOneUnsent(page, backend) {
  backend.failWith = "network";
  await advance(page, backend, POLL_MS);
  await expectText(page, "#net", /^No signal\./);
  await ringUp(page, "Onigiri", "4 5 0");
  await page.click("#regDone");
  await waitClosed(page);
  backend.failWith = "bad_key";
  await page.evaluate(() => globalThis.__matTest.store.checkRev());
  await until(() => visible(page, "#gate"), "the no-key screen shows", 10000);
  assert.equal(await page.evaluate(() => globalThis.__matTest.store.outbox().unsent), 0, "nothing left in the outbox: only the memory copy holds the line");
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
}

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
    name: "the signal strip warns when the phone cannot save the queue",
    async run({ page }) {
      const backend = await ready(page);
      await page.evaluate(() => {
        const save = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === "mat.queue") throw new DOMException("Storage full", "QuotaExceededError");
          return save.call(this, key, value);
        };
      });

      backend.failWith = "network";
      await advance(page, backend, POLL_MS);
      await expectText(page, "#net", NO_SIGNAL);
      await ringUp(page, "Onigiri", "4 5 0");
      await page.click("#regDone");
      await waitClosed(page);
      await expectText(page, "#net", "No signal. Couldn’t save unsent changes on this device. Keep the app open to avoid losing them. 1 to send.");

      backend.failWith = null;
      await signalBack(page);
      await waitRow(page, "Onigiri", (r) => !r.cls.includes("is-pending"), "sent");
      await until(async () => !(await visible(page, "#net")), "the queue warning goes away");
    },
  },
  {
    name: "a check cut off while the page is hidden is not no signal; back on screen it asks again and the strip stays away",
    async run({ page }) {
      const backend = await ready(page);
      const hide = (hidden) =>
        page.evaluate((h) => {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
          document.dispatchEvent(new Event("visibilitychange"));
        }, hidden);
      await hide(true);
      backend.failWith = "network";
      await page.evaluate(() => globalThis.__matTest.store.checkRev());
      assert.equal(await visible(page, "#net"), false, "a failure while hidden is not no signal");
      backend.failWith = null;
      const revs = backend.requests.filter((r) => r.action === "rev").length;
      await hide(false);
      await until(() => backend.requests.filter((r) => r.action === "rev").length > revs, "it asks again at once");
      await idle(page);
      assert.equal(await visible(page, "#net"), false, "still no strip once the backend answers");
    },
  },
  {
    name: "a check that fails while the page is on screen still shows No signal, and the next answer clears it",
    async run({ page }) {
      const backend = await ready(page);
      backend.failWith = "network";
      await page.evaluate(() => globalThis.__matTest.store.checkRev());
      await expectText(page, "#net", NO_SIGNAL);
      backend.failWith = null;
      await comeBack(page);
      await until(async () => !(await visible(page, "#net")), "#net goes away when the backend answers");
    },
  },
  {
    name: "a check the app's own timer started that hangs while the page goes hidden: coming back asks again at once",
    async run({ page }) {
      const backend = await ready(page);
      let revs = 0;
      const handle = backend.handle;
      backend.handle = (body) => {
        if (body.action !== "rev") return handle(body);
        revs++;
        if (revs === 1) return new Promise(() => {}); // the first never answers
        return handle(body);
      };
      const hide = (hidden) =>
        page.evaluate((h) => {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
          document.dispatchEvent(new Event("visibilitychange"));
        }, hidden);
      await advance(page, backend, POLL_MS);
      await until(() => revs >= 1, "the timer's check goes out and hangs");
      await hide(true);
      await hide(false);
      await until(() => revs >= 2, "asks again at once, not joins the cut-off check");
      await idle(page);
      assert.equal(await visible(page, "#net"), false);
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
  {
    name: "a refused key while the queue cannot be saved: the no-key screen says not to close the app, and a new release waits",
    async run({ page }) {
      const backend = await ready(page);
      await failQueueWrites(page);
      await refusedWithOneUnsent(page, backend);
      assert.equal(await page.evaluate(() => globalThis.__matTest.store.state.queueStorageFailed), true);
      const said = await text(page, "#gate p");
      assert.ok(said.endsWith(" " + MEMORY_ONLY), "the screen ends with the memory-only sentence: " + said);
      assert.equal(said.includes("Keep the app open"), false, "no 'Keep the app open' on the no-key screen");
      await markPage(page);
      assert.equal(await announce(page), true, "the page answers");
      await advance(page, backend, 7000);
      assert.equal(await reloaded(page), false, "not while the unsent line is only in memory");
    },
  },
  {
    name: "a refused key with the queue saved: no memory-only sentence, and a new release reloads",
    async run({ page }) {
      const backend = await ready(page);
      await refusedWithOneUnsent(page, backend);
      assert.equal(await page.evaluate(() => globalThis.__matTest.store.state.queueStorageFailed), false);
      assert.equal((await text(page, "#gate p")).includes(MEMORY_ONLY), false);
      await markPage(page);
      // Safe at once, so it reloads straight away (as update.e2e's first case).
      const answered = announce(page).catch(() => true);
      await until(() => reloaded(page), "it reloads", 10000);
      await answered;
    },
  },
];
