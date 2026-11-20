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
