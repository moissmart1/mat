/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The stamp book on a computer: the way in fits the Days pane's bar, and the
// open book stays inside the block with Done in reach. Every name and
// drawing here is invented; the dates are the fixture trip's own.

const assert = require("node:assert/strict");
const fs = require("fs");
const { WITH_PLAN, NOON12, makeBackend, open, until, atRest } = require("./helpers.cjs");

const HOUR = 3600000;
const FIRST = Date.parse("2026-12-10T00:00:00+09:00");
const MOTIF = ["record", "sake", "tower", "lamp", "books", "snow", "mountain", "lantern", "onsen", "temple", "plane"];
const DEFS = [
  ...MOTIF.map((motif, i) => ({
    id: "s" + String(i + 1).padStart(2, "0"),
    date: new Date(FIRST + i * 24 * HOUR + 9 * HOUR).toISOString().slice(0, 10),
    name_ja: "試" + (i + 1), name_en: "Testville " + (i + 1), place: "Place " + (i + 1),
    motif, ink: ["ai", "shu", "matsu"][i % 3], shape: i % 4 === 3 ? "square" : "round",
  })),
  { id: "iss", date: "", name_ja: "発行", name_en: "Issued", place: "", motif: "crest", ink: "shu", shape: "round" },
];
const SHOTS = require("./shots.cjs")("stamp-book");

async function ready(page) {
  const backend = makeBackend(WITH_PLAN, { now: NOON12 });
  for (const d of DEFS) backend.fake.tables.StampDefs.push({ ...d });
  await open(page, { backend, nowMs: NOON12, tab: "days" });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .tk").length > 0), "the tickets draw");
}
const box = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; }, sel);

module.exports = [
  {
    name: "on a computer the way in sits in the Days pane's bar and the book opens inside the Days pane",
    viewport: { width: 1440, height: 900 },
    mobile: false,
    async run({ page }) {
      await ready(page);
      const phone = await box(page, "#phone");
      const btn = await box(page, "#stampBtn");
      const days = await box(page, "#vDays");
      assert.ok(btn.w >= 44 && btn.h >= 44, "the stamp button is a full target: " + JSON.stringify(btn));
      assert.ok(btn.x >= days.x && btn.r <= days.r + 1, "the stamp button is inside the Days pane");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways scroll");
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: SHOTS + "/8-wide-days.png" });
      await page.click("#stampBtn");
      await atRest(page, "#book", { message: "the book opens" });
      await page.waitForTimeout(700);
      const book = await box(page, "#book");
      assert.ok(book.x >= days.x - 1 && book.r <= days.r + 1 && book.b <= phone.b + 1 && book.y >= phone.y - 1, "the book stays inside the Days pane: " + JSON.stringify({ book, days }));
      const money = await box(page, "#vMoney");
      assert.ok(book.r <= money.x + 1, "Money stays in view beside the open book");
      const ring = await page.evaluate(() => Math.max(...[...document.querySelectorAll("#book svg")].map((e) => e.getBoundingClientRect().width)));
      assert.ok(ring <= 180, "a ring is no bigger than on a phone held sideways: " + ring);
      const rings = await page.evaluate(() => [...document.querySelectorAll("#book .sb-ring, #book [data-def]")].filter((e) => e.getBoundingClientRect().width > 0).length);
      assert.ok(rings >= 12, "twelve rings are drawn: " + rings);
      const done = await page.evaluate(() => { const d = [...document.querySelectorAll("#book button")].find((b) => b.textContent.trim() === "Done"); if (!d) return null; const r = d.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { seen: r.width > 0 && r.y >= 0 && r.bottom <= innerHeight, onTop: top === d || d.contains(top) }; });
      assert.deepEqual(done, { seen: true, onTop: true }, "Done is in reach");
      await page.screenshot({ path: SHOTS + "/9-wide-book.png" });
      await page.keyboard.press("Escape");
      await atRest(page, "#book", { open: false, message: "Escape closes the book" });
    },
  },
];
