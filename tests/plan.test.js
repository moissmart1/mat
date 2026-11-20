import test from "node:test";
import assert from "node:assert/strict";
import { minutesOf, nowIn, instantOf, openDayIndex, dayState, daysToGo, stopsFor, nextStopId, isPast, nextLine, stayFor, stayShownFor, NEXT_GRACE_MIN, NIGHT_ENDS_MIN, safeHref, mapsUrl, stayMapsUrl, inkFor, header, dayTotalYen, gateDate, issueLine } from "../js/plan.js";

const TZ = "Asia/Tokyo";
const TRIP = { start: "2026-12-10", end: "2026-12-20", tz: TZ };
const DAYS = Array.from({ length: 11 }, (_, i) => ({ date: "2026-12-" + (10 + i) }));
const at = (iso) => Date.parse(iso);
const stop = (id, time, more = {}) => ({ id, date: "2026-12-12", time, title: id, place: "", travelMin: 0, deleted: false, ...more });

test("Japan time, whatever the phone thinks", () => {
  // 13:20 on Dec 12 in Japan is 23:20 on Dec 11 in Toronto.
  assert.deepEqual(nowIn(TZ, at("2026-12-12T13:20:00+09:00")), { date: "2026-12-12", minutes: 800 });
  assert.equal(instantOf(TZ, "2026-12-12", 800), at("2026-12-12T13:20:00+09:00"));
});
test("which day opens", () => {
  assert.equal(openDayIndex(TRIP, DAYS, at("2026-11-15T12:00:00+09:00")), 0);
  assert.equal(openDayIndex(TRIP, DAYS, at("2026-12-12T13:20:00+09:00")), 2);
  assert.equal(openDayIndex(TRIP, DAYS, at("2026-12-13T00:30:00+09:00")), 3); // just past midnight
  assert.equal(openDayIndex(TRIP, DAYS, at("2026-12-25T12:00:00+09:00")), 10);
});
test("days to go", () => {
  assert.equal(daysToGo(TRIP, at("2026-11-15T12:00:00+09:00")), 25);
  assert.equal(daysToGo(TRIP, at("2026-12-09T23:59:00+09:00")), 1);
  assert.equal(daysToGo(TRIP, at("2026-12-10T00:00:00+09:00")), 0);
});
test("a day's stops: timed in order, untimed last, deleted and bad times handled", () => {
  const all = [stop("c", "19:00"), stop("x", ""), stop("a", "09:00"), stop("gone", "10:00", { deleted: true }), stop("odd", "9:5"), stop("other", "08:00", { date: "2026-12-13" })];
  assert.deepEqual(stopsFor(all, "2026-12-12").map((s) => s.id), ["a", "c", "x", "odd"]);
});
test("next and past", () => {
  const day = [stop("a", "09:00"), stop("b", "14:00"), stop("late", "23:50"), stop("x", "")];
  assert.equal(nextStopId(day, 800), "b");
  assert.equal(nextStopId(day, 23 * 60 + 40), "late");
  // R38: a stop just started is still next (until midnight, for the last one).
  assert.equal(nextStopId(day, 23 * 60 + 55), "late");
  assert.deepEqual(day.map((s) => isPast(s, 800)), [true, false, false, false]);
});
test("the next stop's line", () => {
  assert.equal(nextLine(stop("b", "14:00", { travelMin: 30 }), 800), "Leave by 13:30, in 10 min.");
  assert.equal(nextLine(stop("b", "14:00", { travelMin: 30 }), 815), "Leave now.");
  // Minutes from an old cache made before the backend rounded them: never a fraction.
  assert.equal(nextLine(stop("b", "14:00", { travelMin: 12.5 }), 800), "Leave by 13:47, in 27 min.");
  assert.equal(nextLine(stop("b", "14:00", { travelMin: "20" }), 800), "Leave by 13:40, in 20 min.");
  assert.equal(nextLine(stop("b", "14:00", { travelMin: -10 }), 800), "Next, in 40 min.");
  assert.equal(nextLine(stop("b", "14:00"), 800), "Next, in 40 min.");
  assert.equal(nextLine(stop("b", "15:25"), 800), "Next, in 2 h 5 min.");
  assert.equal(nextLine(stop("b", "14:20"), 800), "Next, in 1 h.");
  assert.equal(nextLine(stop("b", "13:20"), 800), "Now.");
});
test("where you sleep", () => {
  const stays = [{ id: "s1", name: "Asakusa", firstNight: "2026-12-10", lastNight: "2026-12-12", deleted: false }, { id: "s2", name: "Niseko", firstNight: "2026-12-13", lastNight: "2026-12-15", deleted: false }, { id: "s0", name: "Gone", firstNight: "2026-12-10", lastNight: "2026-12-20", deleted: true }];
  assert.equal(stayFor(stays, "2026-12-12").name, "Asakusa");
  assert.equal(stayFor(stays, "2026-12-13").name, "Niseko");
  assert.equal(stayFor(stays, "2026-12-20"), null);
});
test("directions start from where the phone is: no origin, ever", () => {
  const day = [stop("Meiji Shrine", "09:00", { place: "Meiji Jingu" }), stop("Lunch", "12:30", { place: "https://maps.app.goo.gl/abc" }), stop("Sky", "14:00", { place: "Shibuya Sky" })];
  assert.equal(mapsUrl(day[0]), "https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=Meiji%20Jingu");
  assert.equal(mapsUrl(day[1]), "https://maps.app.goo.gl/abc");
  assert.equal(mapsUrl(day[2]), "https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=Shibuya%20Sky");
  assert.equal(mapsUrl(stop("Dinner", "19:00")), "https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=Dinner");
  // An origin passed by an old caller is ignored: Maps starts from the phone.
  assert.equal(mapsUrl(day[0], "Asakusa hotel Tokyo"), "https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=Meiji%20Jingu");
  for (const s of day) assert.equal(mapsUrl(s).includes("origin"), false);
  assert.equal(stayMapsUrl({ name: "Lodge", place: "", addressJp: "北海道虻田郡" }), "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("北海道虻田郡"));
});
test("links from the Sheet", () => {
  assert.equal(safeHref("https://example.test/a"), "https://example.test/a");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", " https://x.test", "https://x .test", "", null, 7]) assert.equal(safeHref(bad), "");
});
test("the header copes with a sparse or hand-edited day", () => {
  assert.deepEqual(header({ date: "2026-12-13", city: "Niseko" }), { line: null, colour: null, ink: null, route: null, city: "Niseko", title: "" });
  const full = header({ date: "2026-12-12", city: "Tokyo", title: "", lineJp: "山手線", lineEn: "Yamanote Line", lineColour: "#9ACD32", fromJp: "新宿", fromEn: "Shinjuku", toJp: "渋谷", toEn: "Shibuya" });
  assert.deepEqual([full.line.jp, full.colour, full.ink, full.route.toJp], ["山手線", "#9ACD32", "#15120F", "渋谷"]);
  assert.equal(header({ date: "2026-12-12", lineJp: "山手線", lineColour: "green" }).colour, null);
  assert.equal(header({ date: "2026-12-12", fromJp: "新宿" }).route, null);
  assert.equal(inkFor("#1A1A6E"), "#FFFFFF");
});
test("the fare and the small print", () => {
  const ex = [{ day: "2026-12-11", amount: 3000, currency: "JPY", rate: 111, deleted: false }, { day: "2026-12-11", amount: 10, currency: "CAD", rate: 111, deleted: false }, { day: "2026-12-11", amount: 999, currency: "JPY", rate: 111, deleted: true }];
  assert.equal(dayTotalYen(ex, "2026-12-11"), 4110);
  assert.equal(gateDate("2026-12-11"), "12.11");
  assert.equal(issueLine("2026-12-11", 2, "MAT"), "2026.12.11 MAT発行 00002-01");
});

test("a place from the Sheet is only a link when safeHref says so", () => {
  const evil = "javascript:alert(1)";
  const spaced = "http://x y";
  const url = mapsUrl(stop("Odd", "10:00", { place: evil }));
  assert.equal(url, "https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=" + encodeURIComponent(evil));
  assert.equal(mapsUrl(stop("Odd", "10:00", { place: spaced })), "https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=" + encodeURIComponent(spaced));
  assert.equal(stayMapsUrl({ name: "Inn", place: evil }), "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(evil));
  assert.equal(stayMapsUrl({ name: "Inn", place: spaced }), "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(spaced));
});
test("blank or missing fields never print undefined", () => {
  assert.equal(nextLine({ id: "x", time: "" }, 800), "");
  assert.equal(nextLine({ id: "x", time: "25:00" }, 800), "");
  assert.equal(minutesOf("25:00"), null);
  assert.equal(minutesOf("14:05"), 845);
  assert.equal(minutesOf(undefined), null);
  assert.equal(mapsUrl({ id: "x" }), "");
  assert.equal(stayMapsUrl({}), "");
  assert.deepEqual(header({}), { line: null, colour: null, ink: null, route: null, city: "", title: "" });
  assert.equal(stayFor([{ id: "s", name: "No dates" }], "2026-12-12"), null);
});
test("the open day when today is inside the trip but missing from the list", () => {
  const some = [{ date: "2026-12-10" }, { date: "2026-12-14" }];
  assert.equal(openDayIndex(TRIP, some, at("2026-12-12T12:00:00+09:00")), 0);
  assert.equal(openDayIndex(TRIP, some, at("2026-12-16T12:00:00+09:00")), 1);
  assert.equal(openDayIndex(TRIP, [{ date: "2026-12-15" }], at("2026-12-12T12:00:00+09:00")), 0);
  assert.equal(dayState("2026-12-11", "2026-12-12"), "used");
  assert.equal(dayState("2026-12-12", "2026-12-12"), "today");
  assert.equal(dayState("2026-12-13", "2026-12-12"), "ahead");
});

// R38: a late stop stays "next" for a while. One day: A 14:00, B 19:00 with
// 30 minutes to get there, C untimed.
const hm = (h, m) => h * 60 + m;
const lateDay = (bTime = "19:00", bTravel = 30) => [stop("A", "14:00"), stop("B", bTime, { travelMin: bTravel }), stop("C", "")];
const lineOf = (day, minutes) => {
  const id = nextStopId(day, minutes);
  return id ? nextLine(day.find((s) => s.id === id), minutes) : "";
};
test("R38: 13:59, A is next and counts down as before", () => {
  assert.equal(NEXT_GRACE_MIN, 30);
  assert.equal(nextStopId(lateDay(), hm(13, 59)), "A");
  assert.equal(lineOf(lateDay(), hm(13, 59)), "Next, in 1 min.");
});
test("R38: 14:00, A is next and reads Now.", () => {
  assert.equal(nextStopId(lateDay(), hm(14, 0)), "A");
  assert.equal(lineOf(lateDay(), hm(14, 0)), "Now.");
});
test("R38: 14:29, A is still next and reads Now.; it is not past", () => {
  assert.equal(nextStopId(lateDay(), hm(14, 29)), "A");
  assert.equal(lineOf(lateDay(), hm(14, 29)), "Now.");
  assert.equal(isPast(lateDay()[0], hm(14, 29), "A"), false);
});
test("R38: 14:30, B is next with its leave-by, and A is past", () => {
  assert.equal(nextStopId(lateDay(), hm(14, 30)), "B");
  assert.equal(lineOf(lateDay(), hm(14, 30)), "Leave by 18:30, in 4 h.");
  assert.equal(isPast(lateDay()[0], hm(14, 30), "B"), true);
});
test("R38: a started stop with minutes to get there reads Now., not Leave now.", () => {
  assert.equal(nextLine(stop("A", "14:00", { travelMin: 30 }), hm(14, 1)), "Now.");
  assert.equal(nextLine(stop("A", "14:00", { travelMin: 30 }), hm(13, 59)), "Leave now.");
});
test("R38: the grace ends when it is time to leave for the following stop", () => {
  assert.equal(nextStopId(lateDay("14:20", 5), hm(14, 14)), "A");
  assert.equal(lineOf(lateDay("14:20", 5), hm(14, 14)), "Now.");
  assert.equal(nextStopId(lateDay("14:20", 5), hm(14, 15)), "B");
  // The following stop with no minutes to get there: its own time.
  assert.equal(nextStopId(lateDay("14:20", 0), hm(14, 19)), "A");
  assert.equal(nextStopId(lateDay("14:20", 0), hm(14, 20)), "B");
});
test("R38: the grace never holds back a stop whose leave-by has come", () => {
  assert.equal(nextStopId(lateDay("14:10", 30), hm(13, 59)), "A");
  assert.equal(nextStopId(lateDay("14:10", 30), hm(14, 0)), "B");
});
test("R38: the last timed stop of the day", () => {
  assert.equal(nextStopId(lateDay(), hm(19, 29)), "B");
  assert.equal(lineOf(lateDay(), hm(19, 29)), "Now.");
  assert.equal(nextStopId(lateDay(), hm(19, 30)), null);
});
test("R38: untimed stops are never next", () => {
  assert.equal(nextStopId([stop("C", ""), stop("D", "9:5")], hm(10, 0)), null);
  assert.equal(nextStopId(lateDay(), hm(23, 0)), null);
});
test("R38: the grace does not cross midnight", () => {
  const all = [stop("late", "23:50"), stop("bus", "", { date: "2026-12-13" })];
  // At 00:10 on Dec 13 the 23:50 stop is on yesterday's ticket, not today's.
  assert.equal(nextStopId(stopsFor(all, "2026-12-13"), hm(0, 10)), null);
  // On its own day it is next until midnight.
  assert.equal(nextStopId(stopsFor(all, "2026-12-12"), hm(23, 59)), "late");
});

// R37: before 04:00, today's ticket shows last night's stay.
const X = { id: "X", name: "Asakusa", firstNight: "2026-12-11", lastNight: "2026-12-12", deleted: false };
const Y = { id: "Y", name: "Niseko", firstNight: "2026-12-13", lastNight: "2026-12-14", deleted: false };
const DEC13 = "2026-12-13";
test("R37: 00:30 on a hotel-change day shows last night's stay; 04:00 today's", () => {
  assert.equal(NIGHT_ENDS_MIN, 240);
  assert.equal(stayShownFor([X, Y], DEC13, { today: DEC13, minutes: hm(0, 30) }).id, "X");
  assert.equal(stayShownFor([X, Y], DEC13, { today: DEC13, minutes: hm(3, 59) }).id, "X");
  assert.equal(stayShownFor([X, Y], DEC13, { today: DEC13, minutes: hm(4, 0) }).id, "Y");
});
test("R37: the same stay both nights", () => {
  const Z = { id: "Z", name: "One", firstNight: "2026-12-11", lastNight: "2026-12-14", deleted: false };
  assert.equal(stayShownFor([Z], DEC13, { today: DEC13, minutes: hm(0, 30) }).id, "Z");
});
test("R37: no stay covers last night (first day, or a gap)", () => {
  assert.equal(stayShownFor([Y], DEC13, { today: DEC13, minutes: hm(0, 30) }).id, "Y");
  assert.equal(stayShownFor([X, Y], "2026-12-11", { today: "2026-12-11", minutes: hm(0, 30) }).id, "X");
});
test("R37: a stay covers last night but none tonight", () => {
  assert.equal(stayShownFor([X], DEC13, { today: DEC13, minutes: hm(0, 30) }).id, "X");
  assert.equal(stayShownFor([X], DEC13, { today: DEC13, minutes: hm(4, 0) }), null);
});
test("R37: a deleted stay never shows", () => {
  assert.equal(stayShownFor([{ ...X, deleted: true }, Y], DEC13, { today: DEC13, minutes: hm(0, 30) }).id, "Y");
  assert.equal(stayShownFor([{ ...X, deleted: true }], DEC13, { today: DEC13, minutes: hm(0, 30) }), null);
});
test("R37: other days' tickets are unchanged", () => {
  assert.equal(stayShownFor([X, Y], "2026-12-14", { today: DEC13, minutes: hm(0, 30) }).id, "Y");
  assert.equal(stayShownFor([X, Y], "2026-12-12", { today: DEC13, minutes: hm(0, 30) }).id, "X");
  assert.equal(stayShownFor([X, Y], DEC13, { today: "2026-12-14", minutes: hm(0, 30) }).id, "Y");
  assert.equal(stayShownFor([X, Y], DEC13, {}).id, "Y");
});

// ---- where you are (location build, items 5 to 8) ----
import { hereLine, nearStops, stayDistance, inPlace, NEAR_M, PLACE_M } from "../js/plan.js";
import { metres, walkMinutes } from "../js/geo.js";

const SKYAT = { lat: 35.6584421, lng: 139.7022205 };
// A point `m` metres north of p.
const north = (p, m) => ({ lat: p.lat + m / 111195, lng: p.lng });
const skyStop = (over = {}) => stop("Shibuya Sky", "14:00", { lat: String(SKYAT.lat), lng: String(SKYAT.lng), travelMin: 30, ...over });

test("leave-by from where you are: on time, close, late", () => {
  const here = north(SKYAT, 1200);
  const m = metres(here, SKYAT);
  const walk = walkMinutes(m);
  assert.equal(walk, 20); // 1200 m * 1.3 / 80 = 19.5, up
  // 13:20; leave at 13:40 -> in 20 min.
  assert.deepEqual(hereLine(skyStop(), 800, here), { dist: "1.2 km · 20 min on foot", lead: "Leave by 13:40, in 20 min.", late: false });
  // 13:35: 5 min to spare.
  assert.deepEqual(hereLine(skyStop(), 815, here), { dist: "1.2 km · 20 min on foot", lead: "Leave now. 5 min to spare.", late: false });
  assert.equal(hereLine(skyStop(), 819, here).lead, "Leave now. 1 min to spare.");
  assert.equal(hereLine(skyStop(), 814, here).lead, "Leave by 13:40, in 6 min.");
  assert.equal(hereLine(skyStop(), 820, here).lead, "Leave now.");
  // 13:46: six minutes late, in vermilion.
  assert.deepEqual(hereLine(skyStop(), 826, here), { dist: "1.2 km · 20 min on foot", lead: "About 6 min late. Leave now.", late: true });
  // Well ahead: hours.
  assert.equal(hereLine(skyStop(), 600, here).lead, "Leave by 13:40, in 3 h 40 min.");
});

test("leave-by falls back to today's line", () => {
  const near = north(SKYAT, 500);
  assert.equal(hereLine(skyStop(), 800, null), null, "no usable position");
  assert.equal(hereLine(skyStop({ lat: "", lng: "" }), 800, near), null, "no coordinates");
  assert.equal(hereLine(skyStop({ time: "" }), 800, near), null, "no time");
  assert.equal(hereLine(skyStop(), 840, near), null, "started: Now. stands");
  assert.equal(hereLine(skyStop(), 850, near), null);
  assert.equal(hereLine(skyStop(), 800, north(SKYAT, NEAR_M + 10)), null, "over 3 km: a train, not a walk");
  assert.ok(hereLine(skyStop(), 800, north(SKYAT, NEAR_M - 10)));
  // A stop the geocoder put in another city: far, so it falls back.
  assert.equal(hereLine(skyStop({ lat: "34.6937", lng: "135.5023" }), 800, near), null);
});

test("nearest stop: distances on open stops to come, the nearest tagged, the order kept", () => {
  const here = SKYAT;
  const stops = [
    stop("Train", "09:10", { lat: "35.66", lng: "139.70" }),
    stop("Bamboo", "", { id: "bam", lat: String(north(here, 900).lat), lng: String(here.lng) }),
    stop("Tenryu", "", { id: "ten", lat: String(north(here, 650).lat), lng: String(here.lng) }),
    stop("Far", "", { id: "far", lat: String(north(here, 5000).lat), lng: String(here.lng) }),
    stop("Nowhere", "", { id: "now" }),
    stop("Dinner", "18:30", { lat: String(north(here, 100).lat), lng: String(here.lng), fixed: true }),
  ];
  const out = nearStops(stops, here);
  assert.deepEqual(Object.keys(out).sort(), ["bam", "ten"]);
  assert.deepEqual(out.ten, { dist: "650 m · 11 min on foot", near: true });
  assert.deepEqual(out.bam, { dist: "900 m · 15 min on foot", near: false });
  // One alone is not "nearest".
  assert.deepEqual(nearStops([stops[1]], here), { bam: { dist: "900 m · 15 min on foot", near: false } });
  assert.deepEqual(nearStops(stops, null), {});
  assert.deepEqual(nearStops(stops.map((s) => ({ ...s, deleted: true })), here), {});
});

test("lodging distance", () => {
  const here = SKYAT;
  assert.equal(stayDistance({ lat: String(north(here, 2400).lat), lng: String(here.lng) }, here), "2.4 km from here");
  assert.equal(stayDistance({ lat: String(north(here, 33360).lat), lng: String(here.lng) }, here), "33 km from here");
  assert.equal(stayDistance({ lat: "", lng: "" }, here), "");
  assert.equal(stayDistance({ lat: "35", lng: "139" }, null), "");
  assert.equal(stayDistance(null, here), "");
});

test("the stamp in the place: within 15 km of the day's coordinates", () => {
  const here = SKYAT;
  assert.equal(inPlace({ lat: String(north(here, PLACE_M - 50).lat), lng: String(here.lng) }, here), true);
  assert.equal(inPlace({ lat: String(north(here, PLACE_M + 50).lat), lng: String(here.lng) }, here), false);
  assert.equal(inPlace({ lat: "", lng: "" }, here), false, "a day with no coordinates");
  assert.equal(inPlace({ lat: "35", lng: "139" }, null), false, "no usable position");
  assert.equal(inPlace(null, here), false, "no such day (the issue stamp)");
});

test("(b) lodging distance: nothing beyond 50 km", () => {
  assert.equal(stayDistance({ lat: String(north(SKYAT, 49000).lat), lng: String(SKYAT.lng) }, SKYAT), "49 km from here");
  assert.equal(stayDistance({ lat: String(north(SKYAT, 49900).lat), lng: String(SKYAT.lng) }, SKYAT), "50 km from here");
  assert.equal(stayDistance({ lat: String(north(SKYAT, 51000).lat), lng: String(SKYAT.lng) }, SKYAT), "");
});

import { nightOf, staySpan } from "../js/plan.js";

test("nightOf: which night of a stay is in force, the night ending at 04:00", () => {
  const inn = { firstNight: "2026-12-10", lastNight: "2026-12-12" };
  assert.deepEqual(nightOf(inn, { today: "2026-12-09", minutes: 1200 }), { total: 3, n: 0, state: "before" });
  assert.deepEqual(nightOf(inn, { today: "2026-12-10", minutes: 120 }), { total: 3, n: 0, state: "before" }, "at 02:00 on the first day it is still the night before");
  assert.deepEqual(nightOf(inn, { today: "2026-12-10", minutes: NIGHT_ENDS_MIN }), { total: 3, n: 1, state: "on" });
  assert.deepEqual(nightOf(inn, { today: "2026-12-11", minutes: 600 }), { total: 3, n: 2, state: "on" });
  assert.deepEqual(nightOf(inn, { today: "2026-12-12", minutes: 239 }), { total: 3, n: 2, state: "on" }, "03:59 is still last night");
  assert.deepEqual(nightOf(inn, { today: "2026-12-12", minutes: 240 }), { total: 3, n: 3, state: "on" });
  assert.deepEqual(nightOf(inn, { today: "2026-12-13", minutes: 60 }), { total: 3, n: 3, state: "on" }, "01:00 on the morning after the last night");
  assert.deepEqual(nightOf(inn, { today: "2026-12-13", minutes: 600 }), { total: 3, n: 3, state: "after" });
  assert.deepEqual(nightOf(inn, { today: "2026-12-20", minutes: 600 }), { total: 3, n: 3, state: "after" });
  const one = { firstNight: "2026-12-08", lastNight: "2026-12-08" };
  assert.deepEqual(nightOf(one, { today: "2026-12-08", minutes: 1300 }), { total: 1, n: 1, state: "on" });
  assert.deepEqual(nightOf(one, { today: "2026-12-09", minutes: 100 }), { total: 1, n: 1, state: "on" });
  assert.deepEqual(nightOf(one, { today: "2026-12-09", minutes: 300 }), { total: 1, n: 1, state: "after" });
  // Across a month, and nights typed badly.
  assert.deepEqual(nightOf({ firstNight: "2026-12-30", lastNight: "2027-01-01" }, { today: "2027-01-01", minutes: 600 }), { total: 3, n: 3, state: "on" });
  assert.deepEqual(nightOf({ firstNight: "soon", lastNight: "" }, { today: "2026-12-10", minutes: 600 }), { total: 0, n: 0, state: "before" });
});

test("staySpan: the first night to the morning after the last", () => {
  assert.equal(staySpan({ firstNight: "2026-12-10", lastNight: "2026-12-12" }), "Dec 10 to 13");
  assert.equal(staySpan({ firstNight: "2026-12-08", lastNight: "2026-12-08" }), "Dec 8 to 9");
  assert.equal(staySpan({ firstNight: "2026-12-30", lastNight: "2027-01-01" }), "Dec 30 to Jan 2");
  assert.equal(staySpan({ firstNight: "2026-11-29", lastNight: "2026-11-30" }), "Nov 29 to Dec 1");
  assert.equal(staySpan({ firstNight: "", lastNight: "2026-12-12" }), "");
});
