// Issue #85: a link pasted on the no-key screen with no signal. The screen
// says the link is kept and the field goes; when signal is back the trip
// opens by itself (the 20-second check, the return of signal, or a relaunch),
// with no further tap. A wrong link is still refused once the trip answers.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ORIGIN, SEED, NOON12, open, advance, until, expectText, visible } = require("./helpers.cjs");

const KEPT = "Your link is kept. MAT opens by itself when signal is back.";
const NO_KEY_SAFARI = "This phone needs the trip link. Open it from your email again, or paste it here.";
const NO_KEY_HOME = "The Home Screen app keeps its own sign-in. Find the email with your own MAT link, press and hold the link, tap Copy Link, then paste it here.";
const REFUSED = "That trip link didn’t work. Ask Mo for the current one.";
const REFUSED_HOME = "That link no longer works here. Find the email with your own MAT link, press and hold the link, tap Copy Link, then paste it here.";
const CHECK_MS = 20000;

const rowCount = (page) => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length);
const waitRows = (page, n) => until(async () => (await rowCount(page)) === n, "expected " + n + " receipt rows");
const loads = (backend) => backend.requests.filter((r) => r.action === "load").length;
const shot = async (page, name) => {
  const dir = process.env.MAT_TAB_SHOTS;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name) });
};
const homeScreen = (page) => page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));

// Pastes `link` with the backend unreachable and waits for the kept screen.
async function pasteWithNoSignal(page, backend, link, before) {
  await expectText(page, "#gate p", before);
  backend.failWith = "network";
  await page.fill("#keyPaste", link);
  await page.click("#keyGo");
  await expectText(page, "#gate p", KEPT);
  assert.ok(await visible(page, "#gate"));
  assert.equal(await visible(page, "#keyPaste"), false, "nothing more to paste: the field goes");
  assert.equal(await visible(page, "#keyGo"), false);
  await until(() => visible(page, "#net"), "the No signal strip");
  assert.equal(await page.evaluate(() => localStorage.getItem("mat.key") !== null), true, "the key is kept");
  assert.equal(await page.evaluate(() => document.body.innerText.includes("test-key")), false, "the key is not drawn");
  assert.equal(await rowCount(page), 0);
}

module.exports = [
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
