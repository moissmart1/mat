// The stub's tear and its pictures arriving (steady-tests, 2026-11-18): a
// picture that reaches the phone while the stub is still tearing off redraws
// the stub, and the tear carries on from where it was instead of jumping to
// the end. The plan is tests/fixtures/plan.json; it is 13:20 on Dec 12 in
// Japan. Every picture is drawn by the test (tests/e2e/pictures.cjs).

const assert = require("node:assert/strict");
const { WITH_PLAN, NOON12, makeBackend, open, advance, until } = require("./helpers.cjs");
const { png } = require("./pictures.cjs");

const KEY = "test-key";
const SKY = "planstop1203"; // 14:00, the next stop
const row = '#rail .pg[data-date="2026-12-12"] .r[data-id="' + SKY + '"]';

module.exports = [
  {
    name: "a picture that arrives mid-tear: the redrawn stub carries the tear on, not jumping to the end",
    async run({ page }) {
      const backend = makeBackend(WITH_PLAN, { now: NOON12 });
      let n = 0;
      for (const who of ["Mo", "Ajen", "Trenton"]) {
        const r = await backend.fake({ key: KEY, actor: "Ajen", action: "addTicket", args: { ticket: { id: "tkr" + String(++n).padStart(9, "0"), stop: SKY, who, seat: "", page: 1, mime: "image/png", w: 300, h: 300, data: png(300, 300, 11 * n) } } });
        assert.equal(r.ok, true, r.message);
      }
      // The pictures are held until the test lets them through.
      let release;
      const held = new Promise((r) => (release = r));
      const plain = backend.handle;
      backend.handle = async (body) => {
        if (body && body.action === "ticket") await held;
        return plain(body);
      };
      await open(page, { tab: "days", backend, storage: { "mat.tixFetch": "open" } });
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length > 0), "the tickets draw");
      await advance(page, backend, 21000);
      const isOpen = await page.evaluate((sel) => document.querySelector(sel).classList.contains("is-open"), row);
      if (!isOpen) await page.dispatchEvent(row + " .r-b", "click");
      await until(() => page.evaluate((sel) => !!document.querySelector(sel + " .r-tk"), row), "Show ticket shows");
      await page.dispatchEvent(row + " .r-tk", "click");
      await until(() => page.evaluate(() => !!document.querySelector("#tix:not([hidden]) .tstub")), "the stub is up");
      // Hold the tear a fifth of the way through, slowed so it is still going
      // whenever the pictures land, however slow this computer is.
      const tearing = await page.evaluate(() => {
        const a = document.querySelector("#tix .tstub").getAnimations().find((x) => x.animationName === "tear");
        if (!a) return false;
        a.currentTime = 100;
        a.playbackRate = 0.001;
        return true;
      });
      assert.equal(tearing, true, "the stub tears off");
      release();
      await until(() => page.evaluate(() => document.querySelectorAll("#tix .stub-code img").length === 3), "the three codes arrive");
      const after = await page.evaluate(() => {
        const s = document.querySelector("#tix .tstub");
        const a = s.getAnimations().find((x) => x.animationName === "tear");
        return { up: s.classList.contains("is-up"), at: a ? a.currentTime : null };
      });
      assert.equal(after.up, false, "the redrawn stub is still tearing");
      assert.ok(after.at !== null && after.at >= 100, "its tear goes on from where it was, not from the end or the start: " + after.at);
    },
  },
];
