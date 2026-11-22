import test from "node:test";
import assert from "node:assert/strict";
import { phoneReady, sheetFor, track, NOTE } from "../js/ready.js";

// Made-up trip: Thu Dec 10 to Sun Dec 20, in Japan.
const DAYS = Array.from({ length: 11 }, (_, i) => ({ date: "2026-12-" + String(10 + i).padStart(2, "0") }));
const STOPS = [
  { id: "past0001", date: "2026-12-10", time: "09:00", title: "Old temple" },
  { id: "sky00001", date: "2026-12-12", time: "14:00", title: "Shibuya Sky" },
  { id: "meiji001", date: "2026-12-12", time: "09:00", title: "Meiji Shrine" },
  { id: "gone0001", date: "2026-12-13", time: "10:00", title: "Removed", deleted: true },
  { id: "late0001", date: "2026-12-14", time: "08:00", title: "Snow bus" },
];
const STAYS = [
  { id: "inn00001", name: "Asakusa hotel", firstNight: "2026-12-10", lastNight: "2026-12-12" },
  { id: "lodge001", name: "Niseko lodge", firstNight: "2026-12-13", lastNight: "2026-12-15" },
];
const T = (id, where, extra = {}) => ({ id, ...where, who: "", page: 1, mime: "image/png", ...extra });
const TICKETS = [
  T("p1", { stop: "past0001" }),
  T("s1", { stop: "sky00001" }, { who: "Mo" }),
  T("s2", { stop: "sky00001" }, { who: "Ajen" }),
  T("s3", { stop: "sky00001" }, { who: "Trenton" }),
  T("m1", { stop: "meiji001" }),
  T("g1", { stop: "gone0001" }),
  T("l1", { stop: "late0001" }),
  T("i1", { stay: "inn00001" }),
  T("i2", { stay: "inn00001" }, { page: 2 }),
  T("y1", { stay: "lodge001" }),
  T("w1", { stop: "late0001" }, { pending: true }),
  T("f1", { stop: "late0001" }, { failed: true }),
];
const state = (more = {}) => ({
  status: "ready",
  ticketsReady: true,
  loadedAt: 1,
  online: true,
  trip: { start: "2026-12-10", tz: "Asia/Tokyo" },
  days: DAYS,
  stops: STOPS,
  stays: STAYS,
  tickets: TICKETS,
  ...more,
});
const ALL = new Set(TICKETS.map((t) => t.id));
const env = (more = {}) => ({ have: (id) => ALL.has(id), lasting: true, mode: "all", shell: true, kept: true, standalone: false, fetching: false, progress: null, failed: false, ...more });
const lacking = (...ids) => (id) => ALL.has(id) && !ids.includes(id);
const at = (iso) => Date.parse(iso);
const WEEKS = at("2026-11-22T10:00:00+09:00");
const TWO = at("2026-12-08T10:00:00+09:00");
const ONE = at("2026-12-09T10:00:00+09:00");
const THREE = at("2026-12-07T10:00:00+09:00");
const DAY12 = at("2026-12-12T13:00:00+09:00");

test("null: not ready, before migrate, no trip start, or the trip over", () => {
  assert.equal(phoneReady(state({ status: "loading" }), WEEKS, env()), null);
  assert.equal(phoneReady(state({ ticketsReady: false }), WEEKS, env()), null);
  assert.equal(phoneReady(state({ trip: { tz: "Asia/Tokyo" } }), WEEKS, env()), null);
  assert.equal(phoneReady(state(), at("2026-12-21T09:00:00+09:00"), env()), null, "the day after the last day");
  assert.notEqual(phoneReady(state(), at("2026-12-20T23:00:00+09:00"), env()), null, "the last day itself");
});

test("rule 3: what is counted (weeks before: every stop and stay ahead, everyone's)", () => {
  const m = phoneReady(state(), WEEKS, env());
  // past0001 is Dec 10, still ahead weeks before; the deleted stop's, the pending and the failed are not counted.
  assert.equal(m.total, 9);
  assert.equal(m.kind, "ready");
  assert.equal(m.n, 0);
});

test("rule 3 on the trip: a past stop is not counted, the stay you are in is, and its booking page counts", () => {
  const m = phoneReady(state(), DAY12, env({ have: lacking("p1", "i2", "s3", "g1", "w1") }));
  // Counted on Dec 12: the inn (you are in it), Sky (3), Meiji, the bus, the lodge: 8. The past temple is not.
  assert.equal(m.total, 8);
  assert.equal(m.n, 2, "the inn's second page and Trenton's code (another person's counts)");
  assert.deepEqual(m.items, ["Thu Dec 10 · Asakusa hotel, booking", "Sat Dec 12 · Shibuya Sky"]);
  assert.equal(phoneReady(state(), DAY12, env({ have: lacking("p1", "g1", "w1", "f1") })).kind, "ready", "a past, deleted, pending or failed picture missing is no matter");
});

test("the kind table, first match wins", () => {
  const two = lacking("s1", "s2");
  const k = (s, e, now = WEEKS) => phoneReady(state(s), now, env(e)).kind;
  assert.equal(k({}, { kept: false, have: two, fetching: true }), "nokeep");
  assert.equal(k({}, { lasting: false }), "nokeep");
  assert.equal(k({ loadedAt: null }, {}), "nokeep");
  assert.equal(k({}, { have: two, fetching: true, progress: { at: 1, of: 2, left: 2 } }), "fetching");
  assert.equal(k({ online: false }, { have: two, failed: true }), "wait");
  assert.equal(k({}, { have: two, failed: true }), "failed");
  assert.equal(k({}, { have: two }), "missing");
  assert.equal(k({}, { shell: false }), "setup");
  assert.equal(k({}, { shell: false, have: two }), "missing");
  assert.equal(k({ online: false }, {}), "ready-off");
  assert.equal(k({}, {}), "ready");
  assert.equal(k({}, { fetching: true }), "ready", "a pass with nothing missing is ready");
});

test("every line string, plural and singular", () => {
  const line = (s, e) => {
    const m = phoneReady(state(s), WEEKS, env(e));
    return [m.jp, m.l1, m.right, m.key];
  };
  const three = lacking("s1", "s2", "s3");
  const one = lacking("s1");
  assert.deepEqual(line({}, {}), ["圏外OK", "Ready for no signal", "trip · all 9 tickets", ""]);
  assert.deepEqual(line({ tickets: [T("m1", { stop: "meiji001" })] }, {}), ["圏外OK", "Ready for no signal", "trip · 1 ticket", ""]);
  assert.deepEqual(line({ tickets: [] }, {}), ["圏外OK", "Ready for no signal", "the trip", ""]);
  assert.deepEqual(line({ online: false }, {}), ["圏外", "No signal · everything is on this phone", "", ""]);
  assert.deepEqual(line({}, { have: three }), ["", "3 pictures not on this phone yet", "", "Fetch now"]);
  assert.deepEqual(line({}, { have: one }), ["", "1 picture is not on this phone yet", "", "Fetch now"]);
  assert.deepEqual(line({}, { have: three, mode: "open" }), ["", "3 pictures not on this phone yet", "", "Fetch now"]);
  assert.deepEqual(line({}, { have: three, fetching: true, progress: { at: 2, of: 3, left: 2 } }), ["", "Fetching 2 of 3", "Keep MAT open", ""]);
  assert.deepEqual(line({}, { have: three, failed: true }), ["", "3 pictures could not be fetched", "", "Try again"]);
  assert.deepEqual(line({}, { have: one, failed: true }), ["", "1 picture could not be fetched", "", "Try again"]);
  assert.deepEqual(line({ online: false }, { have: three }), ["", "3 pictures come when signal is back", "", ""]);
  assert.deepEqual(line({ online: false }, { have: one }), ["", "1 picture comes when signal is back", "", ""]);
  assert.deepEqual(line({ online: false }, { have: three, mode: "open" }), ["", "3 pictures need signal once", "", ""]);
  assert.deepEqual(line({ online: false }, { have: one, mode: "open" }), ["", "1 picture needs signal once", "", ""]);
  assert.deepEqual(line({}, { shell: false }), ["", "Setting up for no signal", "A moment", ""]);
  assert.deepEqual(line({}, { kept: false, noStore: true }), ["", "Nothing is kept in this window", "", ""]);
  // Storage that exists but did not answer, or the Home Screen app: never sent to Safari.
  assert.deepEqual(line({}, { lasting: false }), ["", "Pictures can’t be saved right now", "", ""]);
  assert.deepEqual(line({}, { kept: false, noStore: true, standalone: true }), ["", "Pictures can’t be saved right now", "", ""]);
});

test("what a screen reader hears", () => {
  const m = (s, e) => phoneReady(state(s), WEEKS, env(e));
  assert.equal(m({}, {}).aria, "Ready for no signal. The trip and all 9 tickets are on this phone, in Safari. Details");
  assert.equal(m({}, { standalone: true }).aria, "Ready for no signal. The trip and all 9 tickets are on this phone, in the Home Screen app. Details");
  assert.equal(m({}, { have: lacking("s1", "s2", "s3") }).aria, "3 ticket pictures are not on this phone yet. Details");
  assert.equal(m({}, { have: lacking("s1") }).aria, "1 ticket picture is not on this phone yet. Details");
  assert.equal(m({}, { have: lacking("s1", "s2", "s3") }).keyAria, "Fetch 3 ticket pictures now");
  assert.equal(m({}, { have: lacking("s1", "s2", "s3"), fetching: true, progress: { at: 2, of: 9, left: 8 } }).aria, "Fetching 2 of 9 ticket pictures. Details");
});

test("where: Safari or the Home Screen app", () => {
  assert.equal(phoneReady(state(), WEEKS, env()).where, "safari");
  assert.equal(phoneReady(state(), WEEKS, env({ standalone: true })).where, "home");
});

test("the board's face: only two days and one day before, with signal, and missing, failed or fetching", () => {
  const three = lacking("s1", "s2", "s3");
  const big = (now, s, e) => phoneReady(state(s), now, env({ have: three, ...e })).big;
  assert.deepEqual(big(TWO, {}, {}), { l1: "3 pictures not on this phone", l2: "Flying in 2 days", note: NOTE, key: "Fetch all 3 now", busy: false });
  assert.equal(big(ONE, {}, {}).l2, "Flying tomorrow");
  assert.equal(big(TWO, {}, { have: lacking("s1") }).key, "Fetch it now");
  assert.equal(big(TWO, {}, { have: lacking("s1") }).l1, "1 picture not on this phone");
  assert.equal(big(TWO, {}, { mode: "open" }).l2, "Set to “Only when I open one”");
  assert.deepEqual(big(TWO, {}, { failed: true }), { l1: "3 pictures could not be fetched", l2: "Try again on Wi‑Fi", note: NOTE, key: "Try again", busy: false });
  assert.deepEqual(big(TWO, {}, { fetching: true, progress: { at: 2, of: 3, left: 2 } }), { l1: "Fetching 2 of 3", l2: "Keep MAT open", note: NOTE, key: "Fetching 2 of 3", busy: true });
  assert.equal(big(THREE, {}, {}), null, "three days before: the small line only");
  assert.equal(big(DAY12, {}, {}), null, "on the trip: never");
  assert.equal(big(TWO, { online: false }, {}), null, "no signal: wait, the small line");
  assert.equal(big(TWO, {}, { kept: false }), null, "nokeep never takes the face");
  assert.equal(phoneReady(state(), TWO, env({ shell: false })).big, null, "setup never takes the face");
  assert.equal(phoneReady(state(), TWO, env()).toGo, 2);
});

test("the strip: green with no signal when ready, the red sentence when missing, amber from two days before", () => {
  const three = lacking("s1", "s2", "s3");
  const strip = (now, s, e) => phoneReady(state(s), now, env(e)).strip;
  assert.deepEqual(strip(DAY12, { online: false }, {}), { tone: "green", jp: "圏外", text: "No signal · everything is on this phone" });
  assert.deepEqual(strip(DAY12, { online: false }, { have: three }), { tone: "red", text: "No signal. 3 ticket pictures are not on this phone." });
  assert.deepEqual(strip(DAY12, { online: false }, { have: lacking("s1") }), { tone: "red", text: "No signal. 1 ticket picture is not on this phone." });
  assert.deepEqual(strip(DAY12, {}, { have: three }), { tone: "amber", text: "3 pictures not on this phone yet", right: "", key: "Fetch now" });
  assert.deepEqual(strip(TWO, {}, { have: three, failed: true }), { tone: "amber", text: "3 pictures could not be fetched", right: "", key: "Try again" });
  assert.equal(strip(THREE, {}, { have: three }), null, "earlier than two days before: the line on Days only");
  assert.equal(strip(DAY12, {}, {}), null, "signal and ready: nothing");
  assert.equal(strip(DAY12, { online: false }, { kept: false }), null, "nokeep: the strip as today");
  assert.equal(strip(DAY12, { online: false }, { shell: false }), null, "setup: the strip as today");
});

test("track: a pass's progress", () => {
  assert.equal(track(null, 9, false), null);
  let p = track(null, 9, true);
  assert.deepEqual([p.at, p.of], [1, 9]);
  p = track(p, 9, true);
  assert.deepEqual([p.at, p.of], [1, 9]);
  p = track(p, 8, true);
  assert.deepEqual([p.at, p.of], [2, 9]);
  p = track(p, 9, true); // a ticket added meanwhile: of grows with n
  assert.deepEqual([p.at, p.of], [2, 10]);
  p = track(p, 0, true);
  assert.deepEqual([p.at, p.of], [10, 10], "never above of");
  assert.equal(track(p, 0, false), null);
});

test("the sheet: verdict, rows, notes and key for each kind", () => {
  const sh = (now, s, e) => sheetFor(phoneReady(state(s), now, env(e)));
  const ready = sh(WEEKS, {}, {});
  assert.equal(ready.verdict, "Ready for no signal.");
  assert.deepEqual(ready.rows.map((r) => [r.label, r.value]), [["The trip", "on this phone"], ["Tickets", "all 9 pictures on this phone"]]);
  assert.deepEqual(ready.notes, ["Here in Safari. Safari can clear a site it has not seen for a week, so open MAT now and then. The Home Screen app keeps its own copy: open it once with signal too."]);
  assert.equal(ready.key, "");
  assert.equal(sh(WEEKS, { tickets: [] }, {}).rows[1].value, "no tickets yet");
  assert.deepEqual(sh(WEEKS, {}, { standalone: true }).notes, ["Here in the Home Screen app. Safari keeps its own copy."]);

  const miss = sh(WEEKS, {}, { have: lacking("s1", "s2", "s3"), mode: "open" });
  assert.equal(miss.verdict, "Not ready for no signal yet.");
  assert.deepEqual(miss.rows[1], { id: "tix", label: "Tickets", value: "6 of 9 pictures on this phone", lines: ["Sat Dec 12 · Shibuya Sky"] });
  assert.equal(miss.notes[1], "Ticket pictures are set to “Only when I open one”. Change it in You, Ticket pictures.");
  assert.equal(miss.key, "Fetch now");
  // Up to five lines, then "and N more".
  const many = Array.from({ length: 8 }, (_, i) => ({ id: "x" + i, date: "2026-12-1" + (i + 1 > 9 ? 9 : i + 1), time: "10:00", title: "Made-up stop " + i }));
  const lots = sh(WEEKS, { stops: many, tickets: many.map((x) => T("t" + x.id, { stop: x.id })) }, { have: () => false });
  assert.deepEqual(lots.rows[1].lines, ["Fri Dec 11 · Made-up stop 0", "Sat Dec 12 · Made-up stop 1", "Sun Dec 13 · Made-up stop 2", "Mon Dec 14 · Made-up stop 3", "Tue Dec 15 · Made-up stop 4", "and 3 more"]);

  assert.equal(sh(WEEKS, {}, { have: lacking("s1"), failed: true }).notes[1], "Some pictures would not fetch. This phone may be full, or the signal dropped. Try again on Wi‑Fi.");
  assert.equal(sh(WEEKS, {}, { have: lacking("s1"), failed: true }).key, "Try again");
  assert.equal(sh(WEEKS, {}, { kept: false, noStore: true }).notes[1], "This window keeps nothing after it is closed (a private window, or storage is off). Open your link in an ordinary Safari window.");
  assert.equal(sh(WEEKS, {}, { lasting: false }).notes[1], "Pictures can’t be saved on this phone right now. Close MAT and open it again.");
  assert.equal(sh(WEEKS, {}, { kept: false, noStore: true, standalone: true }).notes[1], "Pictures can’t be saved on this phone right now. Close MAT and open it again.", "never Safari in the Home Screen app");
  assert.equal(sh(WEEKS, {}, { shell: false }).notes[1], "The app is still saving itself to this phone. It takes a moment with signal.");
  assert.equal(sh(WEEKS, { online: false }, { have: lacking("s1") }).notes[1], "No signal now. The missing pictures come by themselves when it is back.");
  assert.equal(sh(WEEKS, { online: false }, { have: lacking("s1"), mode: "open" }).notes[2], "No signal now. Fetch them when it is back.");
  assert.equal(sh(TWO, {}, { have: lacking("s1", "s2", "s3") }).key, "Fetch all 3 now", "two days before, the sheet's key says what the board's does");
  assert.equal(sh(WEEKS, { online: false }, { have: lacking("s1") }).key, "", "no key with no signal");
});
