/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The stamp book without a screen: when a stamp is open (in Japan time,
// whatever zone the phone is in), how a stamp is drawn, and the small texts.
// Every definition here is invented.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INKS, MOTIFS, bookStampSVG, windowOf, stateOf, countText, tiltOf, usableDefs, spanText, lockedLine, japanClock, japanDay, esc, summary } from "../js/stampbook.js";

const D1 = { id: "d1", date: "2030-01-05", name_ja: "試験", name_en: "Testville", place: "Test Hall", motif: "lantern", ink: "shu", shape: "round" };
const D2 = { id: "d2", date: "2030-01-06", name_ja: "二", name_en: "Second", place: "Second Place", motif: "tower", ink: "ai", shape: "square" };
const ISS = { id: "iss", date: "", name_ja: "発行", name_en: "Issued", place: "", motif: "crest", ink: "shu", shape: "round" };
const DEFS = [D1, D2, ISS];
const OPENS = Date.UTC(2030, 0, 4, 15); // 00:00 Jan 5 in Japan

// The same checks in this process and in one whose zone is Toronto's.
function checks() {
  assert.equal(stateOf(D1, DEFS, [], OPENS), "open");
  assert.equal(stateOf(D1, DEFS, [], OPENS - 1), "soon");
  assert.equal(stateOf(D1, DEFS, [], Date.UTC(2030, 0, 5, 18) - 1), "open");
  assert.equal(stateOf(D1, DEFS, [], Date.UTC(2030, 0, 5, 18)), "missed");
  assert.equal(stateOf(D1, DEFS, ["d1"], Date.UTC(2030, 0, 5, 18)), "have", "a stamp you hold stays held");
  assert.deepEqual(windowOf(D1, DEFS), { opens: OPENS, closes: Date.UTC(2030, 0, 5, 18) });
  assert.deepEqual(windowOf(ISS, DEFS), { opens: 0, closes: Date.UTC(2030, 0, 6, 18) });
}

test("stateOf: open from 00:00 Japan time on the date, missed at 03:00 the next day", () => checks());

test("stateOf does not depend on the phone's zone (a phone still on Toronto time)", () => {
  const src = `
    import assert from "node:assert/strict";
    import { stateOf, windowOf, japanDay } from ${JSON.stringify(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "js", "stampbook.js"))};
    assert.notEqual(new Date(2030, 0, 5).getTimezoneOffset(), -540, "the phone is not on Japan time");
    const D1 = ${JSON.stringify(D1)}, DEFS = ${JSON.stringify(DEFS)};
    const OPENS = Date.UTC(2030, 0, 4, 15);
    assert.equal(stateOf(D1, DEFS, [], OPENS), "open");
    assert.equal(stateOf(D1, DEFS, [], OPENS - 1), "soon");
    assert.equal(stateOf(D1, DEFS, [], Date.UTC(2030, 0, 5, 18)), "missed");
    // 22:00 in Toronto on Jan 4 is 12:00 in Japan on Jan 5.
    assert.equal(japanDay(Date.UTC(2030, 0, 5, 3)), "2030-01-05");
    assert.equal(stateOf(D1, DEFS, [], Date.UTC(2030, 0, 5, 3)), "open");
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", src], { env: { ...process.env, TZ: "America/Toronto" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("stateOf: the issue stamp is open from the start until the last day closes; a bad date is never open", () => {
  assert.equal(stateOf(ISS, DEFS, [], 1), "open");
  assert.equal(stateOf(ISS, DEFS, [], Date.UTC(2030, 0, 6, 18) - 1), "open");
  assert.equal(stateOf(ISS, DEFS, [], Date.UTC(2030, 0, 6, 18)), "missed");
  assert.equal(stateOf({ id: "x", date: "someday" }, DEFS, [], Date.UTC(2030, 0, 5)), "soon");
  assert.equal(stateOf(ISS, [ISS], [], 4e12), "open", "no day stamps: it does not close");
});

test("stateOf takes who holds what as ids, stamps or a set", () => {
  assert.equal(stateOf(D1, DEFS, [{ def: "d1", who: "Mo" }], 0), "have");
  assert.equal(stateOf(D1, DEFS, new Set(["d1"]), 0), "have");
  assert.equal(stateOf(D1, DEFS, [{ def: "d2" }], 0), "soon");
  assert.equal(stateOf(D1, DEFS, undefined, 0), "soon");
});

test("bookStampSVG: the same seed and definition draw the same string; another seed wears differently", () => {
  assert.equal(bookStampSVG(7, D1, DEFS), bookStampSVG(7, D1, DEFS));
  assert.notEqual(bookStampSVG(7, D1, DEFS), bookStampSVG(8, D1, DEFS));
  assert.match(bookStampSVG(7, D1, DEFS), /^<svg /);
});

test("bookStampSVG: markup in a name is text, never markup", () => {
  for (const field of ["name_en", "name_ja", "place"]) {
    const svg = bookStampSVG(7, { ...D1, [field]: "<img src=x onerror=alert(1)>" }, DEFS);
    assert.equal(/<img/i.test(svg), false, field);
    if (field !== "place") assert.match(svg, /&lt;IMG|&lt;img/i, field);
  }
  assert.equal(esc('<a href="x">&\'</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  // an id with markup cannot break out of an attribute either
  assert.equal(/"[^"]*<script/.test(bookStampSVG(7, { ...D1, id: '"><script>x</script>' }, DEFS)), false);
});

test("bookStampSVG: an unknown drawing still draws the ring and the names; an unknown ink is vermilion", () => {
  const svg = bookStampSVG(9, { ...D1, motif: "no-such-drawing", ink: "no-such-ink" }, DEFS);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<circle cx="60" cy="60" r="55"/);
  assert.match(svg, /TESTVILLE/);
  assert.match(svg, new RegExp('color="' + INKS.shu + '"'));
  assert.equal(svg.includes(MOTIFS.lantern), false);
  // names that are keys of Object.prototype are not drawings or inks
  const odd = bookStampSVG(9, { ...D1, motif: "constructor", ink: "__proto__" }, DEFS);
  assert.match(odd, new RegExp('color="' + INKS.shu + '"'));
  assert.match(bookStampSVG(9, {}, DEFS), /^<svg /);
  assert.match(bookStampSVG(9, null, DEFS), /^<svg /);
});

test("bookStampSVG: a square has a rounded-square frame and no outer circle frame; the ink follows the definition", () => {
  const sq = bookStampSVG(3, D2, DEFS);
  assert.match(sq, /<rect x="5" y="5" width="110" height="110"/);
  assert.equal(/<circle cx="60" cy="60" r="55"/.test(sq), false);
  assert.match(sq, new RegExp('color="' + INKS.ai + '"'));
  const round = bookStampSVG(3, D1, DEFS);
  assert.match(round, /<circle cx="60" cy="60" r="55"/);
  assert.equal(/<rect x="5" y="5" width="110"/.test(round), false);
});

test("bookStampSVG: the date reads M.D on the bottom arc; the issue stamp shows the year of the first day stamp", () => {
  assert.match(bookStampSVG(3, D1, DEFS), /TESTVILLE · 1\.5</);
  assert.match(bookStampSVG(3, ISS, DEFS), /ISSUED · 2030</);
  assert.match(bookStampSVG(3, ISS, [ISS]), /ISSUED</);
});

test("bookStampSVG: a long name is made to fit its arc; every drawing in the library draws", () => {
  const long = bookStampSVG(5, { ...D1, name_en: "A very long station name indeed", name_ja: "とても長い駅の名前です" }, DEFS);
  assert.match(long, /font-size="[0-5]\.\d+"/);
  for (const key of ["lantern", "books", "onsen", "temple", "mountain", "snow", "lamp", "tower", "record", "sake", "plane", "crest"]) {
    assert.ok(MOTIFS[key] && MOTIFS[key].length > 20, key);
    assert.ok(bookStampSVG(1, { ...D1, motif: key }, DEFS).includes(MOTIFS[key]), key);
  }
  assert.equal(Object.keys(MOTIFS).length, 12);
  assert.match(MOTIFS.crest, />MAT</);
  assert.equal((MOTIFS.crest.match(/M[\d.]+ [\d.]+L/g) || []).length, 12, "twelve ticks");
});

test("the inks are exactly three", () => {
  assert.deepEqual(INKS, { shu: "#D63C1E", matsu: "#2B6A4C", ai: "#28408F" });
});

test("countText and tiltOf", () => {
  assert.equal(countText(3, 12), "3 of 12");
  assert.equal(countText(0, 12), "0 of 12");
  for (let s = 1; s <= 500; s++) {
    const t = tiltOf(s);
    assert.ok(t >= -6 && t <= 6, s + " -> " + t);
  }
  assert.equal(tiltOf(77), tiltOf(77));
  assert.equal(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(tiltOf)).size > 4, true, "different seeds tilt differently");
  assert.ok(Math.abs(tiltOf("nonsense")) <= 6);
});

test("usableDefs: day stamps by date, the issue stamp last; a repeat, no id or a bad date is left out", () => {
  const got = usableDefs([ISS, D2, { id: "", date: "2030-01-01" }, D1, { ...D1, name_en: "again" }, { id: "bad", date: "next week" }, null, "x", { id: "x2", date: "2030-02-30" }]);
  assert.deepEqual(got.map((d) => d.id), ["d1", "d2", "iss"]);
  assert.deepEqual(usableDefs(undefined), []);
  assert.deepEqual(usableDefs([]), []);
});

test("spanText comes from the definitions", () => {
  assert.equal(spanText(DEFS), "2030.01.05 → 01.06");
  assert.equal(spanText([D1]), "2030.01.05");
  assert.equal(spanText([ISS]), "");
});

test("lockedLine and Japan clock text", () => {
  assert.equal(lockedLine(D2, "soon"), "Jan 6 opens on the day.");
  assert.equal(lockedLine(D1, "missed"), "Jan 5 has closed.");
  assert.equal(lockedLine(ISS, "missed"), "The book has closed.");
  assert.equal(japanClock(Date.UTC(2030, 0, 5, 10, 2)), "19:02");
  assert.equal(japanClock(Date.UTC(2030, 0, 5, 15, 5)), "00:05");
  assert.equal(japanDay(Date.UTC(2030, 0, 5, 15, 5)), "2030-01-06");
});

test("summary: the count, and today's stamp only while it is open and not yet pressed", () => {
  const s = { stampDefs: DEFS, stamps: [{ def: "d2", who: "Ajen" }, { def: "iss", who: "Mo" }, { def: "d1", who: "Mo", gone: true }], me: "Mo" };
  const noon5 = Date.UTC(2030, 0, 5, 3); // noon in Japan on Jan 5
  assert.deepEqual(summary(s, noon5), { total: 3, n: 1, openToday: "2030-01-05" });
  // pressed: no line any more
  assert.equal(summary({ ...s, stamps: [{ def: "d1", who: "Mo" }] }, noon5).openToday, "");
  // another person's press is not mine
  assert.equal(summary({ ...s, stamps: [{ def: "d1", who: "Ajen" }] }, noon5).openToday, "2030-01-05");
  // 02:00 on Jan 6 in Japan: Jan 5 is still open (grace) but today is Jan 6
  assert.equal(summary(s, Date.UTC(2030, 0, 5, 17)).openToday, "2030-01-06");
  // a day with no stamp, before the trip, after it
  assert.equal(summary(s, Date.UTC(2029, 5, 1)).openToday, "");
  assert.equal(summary(s, Date.UTC(2030, 0, 8)).openToday, "");
  // nothing defined: nothing to show
  assert.deepEqual(summary({ stampDefs: [], stamps: [], me: "Mo" }, noon5), { total: 0, n: 0, openToday: "" });
  assert.deepEqual(summary({}, noon5), { total: 0, n: 0, openToday: "" });
});

test("summary: given the Days clock's day, today's stamp is that day's; its window stays Japan's", async () => {
  const { dec9State, et } = await import("./fixtures/dec9.js");
  const { tripNow } = await import("../js/plan.js");
  const defs = [{ id: "s9", date: "2026-12-09", name_ja: "空", name_en: "Air", motif: "plane" }, { id: "s10", date: "2026-12-10", name_ja: "東京", name_en: "Tokyo" }];
  const s = dec9State({ stampDefs: defs, stamps: [] });
  const t = et("2026-12-09T11:00"); // 01:00 on Dec 10 in Japan
  assert.equal(summary(s, t).openToday, "2026-12-10", "by Japan's day alone it names Dec 10's");
  assert.equal(summary(s, t, tripNow(s, t).date).openToday, "2026-12-09", "the Days clock's day: Dec 9's");
  // The window is Japan's: Dec 9's stamp is open from Dec 8 10:00 Eastern to Dec 9 13:00 Eastern.
  assert.equal(summary(s, et("2026-12-08T09:59"), "2026-12-09").openToday, "");
  assert.equal(summary(s, et("2026-12-08T10:00"), "2026-12-09").openToday, "2026-12-09");
  assert.equal(summary(s, et("2026-12-09T12:59"), "2026-12-09").openToday, "2026-12-09");
  assert.equal(summary(s, et("2026-12-09T13:00"), "2026-12-09").openToday, "");
});
