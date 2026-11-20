// Check the glyphs Chromium actually used. A declared CSS family, or a
// successful document.fonts.check(), can still mean a system fallback.
const assert = require("node:assert/strict");
const { open, until } = require("./helpers.cjs");

module.exports = [{
  name: "Latin and Japanese render with each web font and weight requested by the app",
  async run({ page }) {
    await open(page);
    const faces = [
      ["DotGothic16", 400], ["Zen Antique", 400],
      ["Zen Kaku Gothic New", 500], ["Zen Kaku Gothic New", 700], ["Zen Kaku Gothic New", 900],
    ];
    const session = await page.context().newCDPSession(page);
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument");
    for (const [family, weight] of faces) {
      const weights = await page.evaluate(async ([family, weight]) => {
        const sample = document.createElement("span");
        sample.id = "font-sample";
        sample.style.position = "fixed";
        sample.style.top = "0";
        sample.style.fontFamily = '"' + family + '"';
        sample.style.fontWeight = String(weight);
        sample.textContent = "Tokyo東京";
        document.body.append(sample);
        const loaded = await document.fonts.load(weight + ' 16px "' + family + '"', sample.textContent);
        sample.getBoundingClientRect();
        return loaded.map(face => face.weight);
      }, [family, weight]);
      const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#font-sample" });
      let fonts;
      await until(async () => {
        ({ fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId }));
        return fonts.length > 0;
      }, family + " was painted");
      assert.ok(fonts.every(f => f.isCustomFont && f.familyName.startsWith(family)),
        family + " " + weight + " rendered with " + JSON.stringify(fonts));
      assert.deepEqual([...new Set(weights)], [String(weight)], "the right weight loaded");
      await page.locator("#font-sample").evaluate(el => el.remove());
    }
  },
}];

module.exports.push({
  name: "overlap checks distinguish glyphs that touch from overlapping font boxes",
  async run({ page }) {
    await open(page);
    const ink = await page.evaluateHandle(require("./text-ink.cjs"));
    const result = await page.evaluate(async (ink) => {
      await document.fonts.load('700 20px "Zen Kaku Gothic New"', "M");
      const label = () => {
        const span = document.createElement("span");
        Object.assign(span.style, { position: "fixed", left: "10px", top: "10px", font: '700 20px "Zen Kaku Gothic New"' });
        span.textContent = "M";
        document.body.append(span);
        return span;
      };
      const upper = label(), lower = label();
      const line = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el.firstChild);
        return range.getBoundingClientRect();
      };
      const collides = () => ink(upper.firstChild)[0].bottom > ink(lower.firstChild)[0].top;
      lower.style.top = (10 + line(upper).height - 2) + "px";
      const boxesOverlap = line(upper).bottom > line(lower).top;
      const separatedInk = !collides();
      lower.style.top = upper.style.top;
      return { boxesOverlap, separatedInk, overprintedInk: collides() };
    }, ink);
    assert.deepEqual(result, { boxesOverlap: true, separatedInk: true, overprintedInk: true });
  },
});
