// Issue #85: a link pasted on the no-key screen with no signal. The screen
// says the link is kept and the field goes; when signal is back the trip
// opens by itself (the 20-second check, the return of signal, or a relaunch),
// with no further tap; a relaunch still without signal shows the kept screen
// again. A wrong link is still refused once the trip answers, and never kept.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ORIGIN, SEED, NOON12, open, advance, until, expectText, visible } = require("./helpers.cjs");

const KEPT = "Your link is kept. MAT opens by itself when signal is back.";
const NO_KEY_SAFARI = "Nothing of the trip is on this phone yet. Open your MAT link from your email again, or paste it here.";
const NO_KEY_HOME = "Nothing of the trip is in this app yet. The Home Screen app keeps its own copy, apart from Safari. Find the email with your own MAT link, press and hold the link, tap Copy Link, then paste it here.";
const REFUSED = "That trip link didn’t work. Ask Mo for the current one.";
const REFUSED_HOME = "That link no longer works here. Find the email with your own MAT link, press and hold the link, tap Copy Link, then paste it here.";
const CHECK_MS = 20000;
const CHECKING = "Checking your link…";
const KEPT_SHEET = "Your link is kept. The trip sheet isn’t answering yet. MAT keeps trying.";
const OTHER = "Use a different link";
const SAY_MS = 8000;

const rowCount = (page) => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length);
const waitRows = (page, n) => until(async () => (await rowCount(page)) === n, "expected " + n + " receipt rows");
const loads = (backend) => backend.requests.filter((r) => r.action === "load").length;
const shot = async (page, name) => {
  const dir = process.env.MAT_TAB_SHOTS;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name) });
};
// The next `n` loads wait (a network that hangs rather than fails) until release().
function holdLoads(backend, n = Infinity) {
  const orig = backend.handle;
  const held = [];
  backend.handle = (body) => {
    if (body.action !== "load" || held.length >= n) return orig(body);
    return new Promise((resolve, reject) => held.push(() => orig(body).then(resolve, reject)));
  };
  return {
    count: () => held.length,
    release: () => {
      backend.handle = orig;
      for (const go of held.splice(0)) go();
    },
  };
}
const homeScreen = (page) => page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));

// Pastes `link` with the backend unreachable and waits for the kept screen.
async function pasteWithNoSignal(page, backend, link, before) {
  await expectText(page, "#gate p", before);
  backend.failWith = "network";
  await page.fill("#keyPaste", link);
  await page.click("#keyGo");
  await expectText(page, "#gate p", KEPT);
  assert.equal(await page.getAttribute("#gate p", "role"), "status", "read out when it replaces the instructions");
  assert.ok(await visible(page, "#gate"));
  assert.equal(await visible(page, "#keyPaste"), false, "nothing more to paste: the field goes");
  assert.equal(await visible(page, "#keyGo"), false);
  assert.equal(await page.textContent("#keyOther"), OTHER);
  assert.ok(await visible(page, "#keyOther"), "a way to another link");
  await until(() => visible(page, "#net"), "the No signal strip");
  assert.equal(await page.evaluate(() => localStorage.getItem("mat.key") !== null), true, "the key is kept");
  assert.equal(await page.evaluate(() => document.body.innerText.includes("test-key")), false, "the key is not drawn");
  assert.equal(await rowCount(page), 0);
}

module.exports = [
  {
    name: "#85 M6: right after Open with a hanging network: 'Checking your link…', then the kept sentence after 8 s, then the trip when it answers",
    async run({ page }) {
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await expectText(page, "#gate p", NO_KEY_SAFARI);
      const hold = holdLoads(backend);
      await page.fill("#keyPaste", ORIGIN + "/#k=test-key");
      await page.click("#keyGo");
      await expectText(page, "#gate p", CHECKING);
      assert.equal(await visible(page, "#keyPaste"), false, "not the instructions with an emptied field");
      assert.equal(await visible(page, "#keyOther"), false);
      await until(() => hold.count() === 1, "the load is out");
      await advance(page, backend, SAY_MS - 1000);
      await expectText(page, "#gate p", CHECKING);
      await advance(page, backend, 1000);
      await expectText(page, "#gate p", KEPT);
      assert.ok(await visible(page, "#keyOther"));
      await shot(page, "pasteoffline-checking-then-kept.png");
      hold.release();
      await waitRows(page, 8);
      assert.equal(await visible(page, "#gate"), false);
    },
  },
  {
    name: "#85 M2: Use a different link opens the field under the kept sentence; a new link replaces the kept one and opens",
    async run({ page }) {
      await homeScreen(page);
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await pasteWithNoSignal(page, backend, "wrong-key-123", NO_KEY_HOME);
      await page.click("#keyOther");
      assert.ok(await visible(page, "#keyPaste"));
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "keyPaste", "the field has focus");
      assert.equal(await visible(page, "#keyOther"), false);
      await expectText(page, "#gate p", KEPT);
      await shot(page, "pasteoffline-other-link.png");
      backend.failWith = null;
      await page.fill("#keyPaste", ORIGIN + "/#k=test-key");
      await page.click("#keyGo");
      await waitRows(page, 8);
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.key")), "test-key");
    },
  },
  {
    name: "#85 M2/M4: a wrong link still hanging, replaced by the right one: its late refusal leaves the right link open",
    async run({ page }) {
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      const hold = holdLoads(backend, 1);
      await page.fill("#keyPaste", "wrong-key-123");
      await page.click("#keyGo");
      await until(() => hold.count() === 1, "the wrong key's load is out");
      await advance(page, backend, SAY_MS);
      await expectText(page, "#gate p", KEPT);
      await page.click("#keyOther");
      await page.fill("#keyPaste", ORIGIN + "/#k=test-key");
      await page.click("#keyGo");
      await waitRows(page, 8);
      hold.release(); // the wrong key is refused now
      await until(() => backend.requests.filter((r) => r.action === "load").length >= 2, "the late answer");
      await page.evaluate(() => globalThis.__matTest.store.idle());
      assert.equal(await visible(page, "#gate"), false);
      assert.equal(await rowCount(page), 8);
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.key")), "test-key");
      assert.equal(await page.evaluate(() => globalThis.__matTest.store.state.keyRefused), false);
    },
  },
  {
    name: "#85 M1: the trip sheet answering with an error (signal is fine) says so, and opens when it answers",
    async run({ page }) {
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      backend.failWith = "server";
      await page.fill("#keyPaste", ORIGIN + "/#k=test-key");
      await page.click("#keyGo");
      await expectText(page, "#gate p", KEPT_SHEET);
      assert.ok(await visible(page, "#keyOther"));
      assert.equal(await visible(page, "#net"), false, "no No signal strip: the phone has signal");
      backend.failWith = null;
      await advance(page, backend, CHECK_MS);
      await waitRows(page, 8);
    },
  },
  {
    name: "#85 M7: a check that fails again does not rewrite the spoken sentence",
    async run({ page }) {
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await pasteWithNoSignal(page, backend, ORIGIN + "/#k=test-key", NO_KEY_SAFARI);
      await page.evaluate(() => {
        globalThis.__gateWrites = 0;
        new MutationObserver((list) => {
          globalThis.__gateWrites += list.length;
        }).observe(document.querySelector("#gate p"), { childList: true, characterData: true, subtree: true });
      });
      await advance(page, backend, CHECK_MS);
      await advance(page, backend, CHECK_MS);
      await page.evaluate(() => globalThis.__matTest.store.idle());
      await expectText(page, "#gate p", KEPT);
      assert.equal(await page.evaluate(() => globalThis.__gateWrites), 0);
    },
  },
  {
    name: "#85 M3: signal coming back while a link is kept loads first; a waiting line goes out only after the load",
    async run({ page }) {
      // A line made with no signal and kept on this phone after an earlier
      // link was refused: in mat.queue, no key, no trip.
      const line = { id: "queuedtaxi01", day: "2026-12-12", title: "Queued taxi", amount: 3000, currency: "JPY", paidBy: "Mo", split: ["Mo", "Ajen", "Trenton"], splitMode: "equal", splitVals: [], note: "", kind: "" };
      const queue = JSON.stringify([{ expense: line, addedAt: new Date(NOON12 - 60000).toISOString(), rate: 111, addedBy: "Mo", failed: false, sent: false }]);
      const other = page;
      const backend = await open(other, { seed: SEED, nowMs: NOON12, key: null, storage: { "mat.queue": queue } });
      await pasteWithNoSignal(other, backend, ORIGIN + "/#k=test-key", NO_KEY_SAFARI);
      const from = backend.requests.length;
      backend.failWith = null;
      await other.evaluate(() => window.dispatchEvent(new Event("online")));
      await until(() => backend.fake.tables.Expenses.some((e) => e.title === "Queued taxi"), "the line is sent");
      const order = backend.requests.slice(from).map((r) => r.action);
      const firstWrite = order.indexOf("addExpense");
      assert.ok(order.indexOf("load") >= 0 && order.indexOf("load") < firstWrite, "loaded before sending: " + order.join(", "));
      await waitRows(other, 9);
    },
  },
  {
    name: "#85 Safari: a link pasted with no signal is kept; the 20-second check opens the trip with no tap",
    async run({ page }) {
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await pasteWithNoSignal(page, backend, ORIGIN + "/#k=test-key", NO_KEY_SAFARI);
      await shot(page, "pasteoffline-safari-kept.png");
      // Still no signal at the next check: still the same screen.
      await advance(page, backend, CHECK_MS);
      await expectText(page, "#gate p", KEPT);
      assert.equal(await visible(page, "#keyPaste"), false);
      // Signal back: the next check opens the trip. No click from here on.
      backend.failWith = null;
      await advance(page, backend, CHECK_MS);
      await waitRows(page, 8);
      assert.equal(await visible(page, "#gate"), false);
      await until(async () => !(await visible(page, "#net")), "the No signal strip goes");
      assert.equal(await page.evaluate(() => globalThis.__matTest.store.state.linkKept), false);
    },
  },
  {
    name: "#85 Home Screen: a link pasted with no signal is kept; signal coming back opens the trip with no tap",
    async run({ page }) {
      await homeScreen(page);
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await pasteWithNoSignal(page, backend, ORIGIN + "/#k=test-key", NO_KEY_HOME);
      await shot(page, "pasteoffline-home-kept.png");
      backend.failWith = null;
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await waitRows(page, 8);
      assert.equal(await visible(page, "#gate"), false);
      await shot(page, "pasteoffline-home-opened.png");
    },
  },
  {
    name: "#85: a link kept with no signal opens on a relaunch with signal",
    async run({ page }) {
      await homeScreen(page);
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await pasteWithNoSignal(page, backend, ORIGIN + "/#k=test-key", NO_KEY_HOME);
      backend.failWith = null;
      await page.reload();
      await waitRows(page, 8);
      assert.equal(await visible(page, "#gate"), false);
    },
  },
  ...[
    ["Safari", NO_KEY_SAFARI, false],
    ["Home Screen", NO_KEY_HOME, true],
  ].map(([form, before, home]) => ({
    name: "#85 " + form + ": pasted with no signal, closed and opened again still without signal: the kept screen, then it opens by itself",
    async run({ page }) {
      if (home) await homeScreen(page);
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await pasteWithNoSignal(page, backend, ORIGIN + "/#k=test-key", before);
      // Relaunch, still no signal: not an empty app, the same kept screen.
      await page.reload();
      await expectText(page, "#gate p", KEPT);
      assert.ok(await visible(page, "#gate"));
      assert.equal(await visible(page, "#keyPaste"), false);
      assert.equal(await page.evaluate(() => globalThis.__matTest.store.state.linkKept), true);
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.cache")), null, "no trip has loaded here");
      assert.equal(await rowCount(page), 0);
      await shot(page, "pasteoffline-" + (home ? "home" : "safari") + "-relaunch-kept.png");
      // A check still without signal: unchanged.
      await advance(page, backend, CHECK_MS);
      await expectText(page, "#gate p", KEPT);
      // Signal back: the next check opens it, no tap.
      backend.failWith = null;
      await advance(page, backend, CHECK_MS);
      await waitRows(page, 8);
      assert.equal(await visible(page, "#gate"), false);
    },
  })),
  {
    name: "#85: a phone that loaded the trip before still opens on it with no signal (never the kept screen)",
    async run({ page }) {
      const backend = await open(page, { seed: SEED, nowMs: NOON12 });
      await waitRows(page, 8);
      backend.failWith = "network";
      await page.reload();
      await waitRows(page, 8);
      assert.equal(await visible(page, "#gate"), false);
      assert.equal(await page.evaluate(() => globalThis.__matTest.store.state.linkKept), false);
    },
  },
  {
    name: "#85 Safari: a wrong link pasted with no signal is refused when signal returns, and the field is back",
    async run({ page }) {
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await pasteWithNoSignal(page, backend, "wrong-key-123", NO_KEY_SAFARI);
      backend.failWith = null;
      await advance(page, backend, CHECK_MS);
      await expectText(page, "#gate p", REFUSED);
      assert.ok(await visible(page, "#keyPaste"), "the field is back for the right link");
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.key")), null, "the refused key comes off");
      assert.equal(await rowCount(page), 0);
      // Opened again with no signal after the refusal: the plain no-key screen, never kept.
      backend.failWith = "network";
      await page.reload();
      await expectText(page, "#gate p", NO_KEY_SAFARI);
      assert.ok(await visible(page, "#keyPaste"));
      assert.equal(await page.evaluate(() => globalThis.__matTest.store.state.linkKept), false);
      backend.failWith = null;
      // And the right link, with signal, opens at once.
      await page.fill("#keyPaste", ORIGIN + "/#k=test-key");
      await page.click("#keyGo");
      await waitRows(page, 8);
    },
  },
  {
    name: "#85 Home Screen: a wrong link pasted with signal is refused at once, never kept",
    async run({ page }) {
      await homeScreen(page);
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await expectText(page, "#gate p", NO_KEY_HOME);
      await page.fill("#keyPaste", "wrong-key-123");
      await page.click("#keyGo");
      await until(() => loads(backend) > 0, "it tries the key");
      await expectText(page, "#gate p", REFUSED_HOME);
      assert.ok(await visible(page, "#keyPaste"));
      assert.equal(await page.evaluate(() => globalThis.__matTest.store.state.linkKept), false);
    },
  },
];
