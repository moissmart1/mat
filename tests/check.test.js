import test from "node:test";
import assert from "node:assert/strict";
import { missing, ownerOf, lineWords, peopleWords, checkWords, rollRow, shortDay, stampDay } from "../js/check.js";

// Made-up trip: Thu Dec 10 to Sun Dec 20, in Japan; the eve is Wed Dec 9.
const DAYS = Array.from({ length: 11 }, (_, i) => ({ date: "2026-12-" + String(10 + i).padStart(2, "0") }));
const EVES = [{ date: "2026-12-09", kind: "eve" }];
const NOW = Date.parse("2026-12-05T10:00:00+09:00");
const AT = (date, time = "10:00") => Date.parse(date + "T" + time + ":00+09:00");
const full = (id, first, last, more = {}) => ({ id, name: "Stay " + id, nameJp: "宿", addressJp: "住所", tkRef: "R1", firstNight: first, lastNight: last, ...more });
// Stays that cover every night from Dec 9 to Dec 19: nothing to report from the stays.
const COVER = [full("sA", "2026-12-09", "2026-12-14"), full("sB", "2026-12-15", "2026-12-19")];
const T = (id, where, extra = {}) => ({ id, ...where, who: "", page: 1, mime: "image/png", ...extra });
const st = (more = {}) => ({
  status: "ready",
  ticketsReady: true,
  personal: true,
  me: "Mo",
  people: [{ name: "Mo" }, { name: "Ajen" }, { name: "Trenton" }],
  trip: { start: "2026-12-10", tz: "Asia/Tokyo" },
  eves: EVES,
  days: DAYS,
  stops: [],
  stays: COVER,
  tickets: [],
  ...more,
});
const ids = (s, now = NOW) => missing(s, now).map((l) => l.id);
const stop = (id, more = {}) => ({ id, date: "2026-12-12", time: "10:00", title: "Stop " + id, place: "Somewhere", ...more });

test("not the owner: ownerOf is false on a friend's link, on the shared link, with nobody chosen", () => {
  assert.equal(ownerOf(st()), true);
  assert.equal(ownerOf(st({ me: "mo " })), true, "names match as the backend matches them");
  assert.equal(ownerOf(st({ me: "Ajen" })), false);
  assert.equal(ownerOf(st({ personal: false })), false);
  assert.equal(ownerOf(st({ me: null })), false);
  assert.equal(ownerOf(st({ people: [] })), false);
  assert.equal(ownerOf(null), false);
});

test("a night with no stay is one line; a run of nights is one line dated its first night", () => {
  const one = missing(st({ stays: [full("sA", "2026-12-09", "2026-12-12"), full("sB", "2026-12-14", "2026-12-19")] }), NOW);
  assert.deepEqual(one.map((l) => [l.id, l.date, l.title]), [["night:2026-12-13", "2026-12-13", "No stay for this night"]]);
  assert.equal(one[0].label, "宿泊 Stay");
  assert.deepEqual(one[0].open, { type: "day", date: "2026-12-13" });
  const run = missing(st({ stays: [full("sA", "2026-12-09", "2026-12-11"), full("sB", "2026-12-15", "2026-12-19")] }), NOW);
  assert.deepEqual(run.map((l) => [l.id, l.title]), [["night:2026-12-12", "No stay for 3 nights"]]);
  const two = missing(st({ stays: [full("sA", "2026-12-10", "2026-12-11"), full("sB", "2026-12-13", "2026-12-14"), full("sC", "2026-12-16", "2026-12-19")] }), NOW);
  assert.deepEqual(two.map((l) => l.id), ["night:2026-12-09", "night:2026-12-12", "night:2026-12-15"]);
});

test("the reason names the stays either side: Between, After, Before, No stays yet", () => {
  const why = (stays) => missing(st({ stays }), NOW).filter((l) => l.kind === "night").map((l) => l.why);
  assert.deepEqual(why([full("sA", "2026-12-09", "2026-12-12", { name: "Asakusa hotel" }), full("sB", "2026-12-14", "2026-12-19", { name: "Niseko lodge" })]), ["Between Asakusa hotel and Niseko lodge"]);
  assert.deepEqual(why([full("sA", "2026-12-09", "2026-12-12", { name: "Asakusa hotel" })]), ["After Asakusa hotel"]);
  assert.deepEqual(why([full("sB", "2026-12-14", "2026-12-19", { name: "Niseko lodge" })]), ["Before Niseko lodge"]);
  assert.deepEqual(why([]), ["No stays yet"]);
  assert.deepEqual(why([full("sA", "2026-12-09", "2026-12-12", { name: "", nameJp: "浅草" }), full("sB", "2026-12-14", "2026-12-19")]), ["Between 浅草 and Stay sB"]);
});

test("eve rows count as nights; the last day has no night", () => {
  assert.deepEqual(ids(st({ stays: [full("sA", "2026-12-10", "2026-12-19")] })), ["night:2026-12-09"], "the eve's night");
  assert.deepEqual(ids(st({ stays: [full("sA", "2026-12-09", "2026-12-18")] })), ["night:2026-12-19"], "the night before the last day");
  assert.deepEqual(ids(st({ stays: [full("sA", "2026-12-09", "2026-12-19")] })), [], "Dec 20 has no night");
  assert.deepEqual(ids(st({ eves: [], stays: [full("sA", "2026-12-10", "2026-12-19")] })), []);
});

test("a stay with a Japanese name or an address is not missing either", () => {
  const stays = (extra) => [full("sA", "2026-12-09", "2026-12-14", extra), COVER[1]];
  const jp = (extra) => ids(st({ stays: stays(extra) })).filter((i) => i.startsWith("stay-jp"));
  assert.deepEqual(jp({ nameJp: "", addressJp: "" }), ["stay-jp:sA"]);
  assert.deepEqual(jp({ nameJp: "  ", addressJp: undefined }), ["stay-jp:sA"]);
  assert.deepEqual(jp({ nameJp: "", addressJp: "住所" }), []);
  assert.deepEqual(jp({ nameJp: "宿", addressJp: "" }), []);
  const line = missing(st({ stays: stays({ nameJp: "", addressJp: "", name: "Asakusa hotel" }) }), NOW)[0];
  assert.equal(line.title, "Asakusa hotel, 6 nights");
  assert.equal(line.why, "No Japanese name or address: nothing to show a driver");
  assert.deepEqual(line.open, { type: "stay", id: "sA" });
  assert.equal(line.date, "2026-12-09");
});

test("a stay with a booking ref, or a picture, has its booking; a link alone does not", () => {
  const book = (extra, more = {}) => ids(st({ stays: [full("sA", "2026-12-09", "2026-12-14", { tkRef: "", ...extra }), COVER[1]], ...more })).filter((i) => i.startsWith("stay-booking"));
  assert.deepEqual(book({}), ["stay-booking:sA"]);
  assert.deepEqual(book({ link: "https://example.test/b" }), ["stay-booking:sA"], "a link alone is no use with no signal");
  assert.deepEqual(book({ tkRef: "ABC123" }), []);
  assert.deepEqual(book({}, { tickets: [T("p1", { stay: "sA" })] }), []);
  assert.deepEqual(book({}, { tickets: [T("p1", { stay: "sA" }, { gone: true })] }), ["stay-booking:sA"]);
  assert.deepEqual(book({}, { tickets: [T("p1", { stay: "sA" })], ticketsReady: false }), ["stay-booking:sA"], "before migrate pictures count as none");
  const line = missing(st({ stays: [full("sA", "2026-12-09", "2026-12-10", { tkRef: "" }), full("sB", "2026-12-11", "2026-12-19")] }), NOW)[0];
  assert.equal(line.title, "Stay sA, 2 nights");
  assert.equal(line.why, "No booking number or page");
  assert.deepEqual(line.open, { type: "stay-edit", id: "sA" });
});

test("a fixed-time stop with no picture and no facts is missing a ticket; a reference alone is enough", () => {
  const fixed = (more = {}, extra = {}) => st({ stops: [stop("x1", { fixed: true, ...more })], ...extra });
  const line = missing(fixed(), NOW)[0];
  assert.deepEqual([line.id, line.kind, line.title, line.why, line.label], ["ticket:x1", "ticket", "Stop x1, 10:00", "Fixed time, no ticket or reference", "券 Ticket"]);
  assert.deepEqual(line.open, { type: "stop", id: "x1" });
  assert.deepEqual(ids(fixed({ tkRef: "R-77" })), []);
  assert.deepEqual(ids(fixed({}, { tickets: [T("p1", { stop: "x1" })] })), []);
  assert.deepEqual(ids(fixed({ fixed: false })), []);
  assert.equal(missing(fixed({ time: "" }), NOW)[0].title, "Stop x1");
});

test("codes for some: names the holders and the others in trip order; a picture for everyone clears it", () => {
  const s = (tickets, people) => st({ stops: [stop("c1")], tickets, ...(people ? { people } : {}) });
  const why = (state) => missing(state, NOW).filter((l) => l.kind === "codes").map((l) => l.why);
  assert.deepEqual(why(s([T("a", { stop: "c1" }, { who: "Mo" })])), ["A code for Mo, none for Ajen and Trenton"]);
  assert.deepEqual(why(s([T("a", { stop: "c1" }, { who: "Trenton" }), T("b", { stop: "c1" }, { who: "Mo" })])), ["Codes for Mo and Trenton, none for Ajen"]);
  assert.deepEqual(why(s([T("a", { stop: "c1" }, { who: "Mo" }), T("b", { stop: "c1" }, { who: "Ajen" })], [{ name: "Mo" }, { name: "Ajen" }, { name: "Trenton" }, { name: "Kenji" }])), ["Codes for Mo and Ajen, none for Trenton and Kenji"]);
  assert.deepEqual(why(s([T("a", { stop: "c1" }, { who: "Mo" }), T("b", { stop: "c1" }, { who: "Ajen" }), T("c", { stop: "c1" }, { who: "trenton" })])), [], "all three hold one (any case)");
  assert.deepEqual(why(s([T("a", { stop: "c1" }, { who: "Mo" }), T("b", { stop: "c1" }, { who: "" })])), [], "one for everyone");
  assert.deepEqual(why(s([T("a", { stop: "c1" }, { who: "" })])), [], "a plain picture is not per person");
  assert.equal(missing(s([T("a", { stop: "c1" }, { who: "Mo" })]), NOW).find((l) => l.kind === "codes").label, "券 Ticket");
});

test("a stop with a place, a Maps link as its place, or a position has its place", () => {
  const place = (more) => ids(st({ stops: [stop("p1", { place: "", ...more })] })).filter((i) => i.startsWith("place"));
  assert.deepEqual(place({}), ["place:p1"]);
  assert.deepEqual(place({ place: "  " }), ["place:p1"]);
  assert.deepEqual(place({ place: "Meiji Jingu" }), []);
  assert.deepEqual(place({ place: "https://maps.example.test/x" }), []);
  assert.deepEqual(place({ lat: 35.67, lng: 139.7 }), []);
  assert.deepEqual(place({ lat: "35.67", lng: "139.7" }), []);
  assert.deepEqual(place({ lat: 35.67 }), ["place:p1"], "half a position is none");
  assert.deepEqual(place({ lat: "", lng: "" }), ["place:p1"]);
  const line = missing(st({ stops: [stop("p1", { place: "" })] }), NOW)[0];
  assert.equal(line.why, "No place: Directions has only the name to go on");
  assert.equal(line.label, "行先 Place");
});

test("nothing dated before today counts; a stay that began before today is dated today", () => {
  const stays = [full("sA", "2026-12-09", "2026-12-14", { nameJp: "", addressJp: "" }), full("sB", "2026-12-15", "2026-12-19")];
  const base = (more) => st({ stays, stops: [stop("old", { date: "2026-12-11", place: "" }), stop("new", { date: "2026-12-13", place: "" })], ...more });
  assert.deepEqual(ids(base(), NOW), ["stay-jp:sA", "place:old", "place:new"], "before the trip: all of it");
  const mid = AT("2026-12-12");
  assert.deepEqual(missing(base(), mid).map((l) => [l.id, l.date]), [["stay-jp:sA", "2026-12-12"], ["place:new", "2026-12-13"]]);
  assert.deepEqual(ids(base(), AT("2026-12-15")), [], "the stay's last night has passed");
  assert.deepEqual(ids(base(), AT("2026-12-14")), ["stay-jp:sA"], "its last night is tonight");
  // Nights: only from today on.
  const gap = st({ stays: [full("sA", "2026-12-09", "2026-12-10"), full("sB", "2026-12-15", "2026-12-19")] });
  assert.deepEqual(ids(gap, AT("2026-12-13")), ["night:2026-12-13"]);
  assert.deepEqual(ids(gap, AT("2026-12-21")), [], "after the trip nothing is ahead");
});

test("deleted stops and stays, and stops off the plan, give nothing", () => {
  const s = st({
    stays: [...COVER, full("dead", "2026-12-12", "2026-12-13", { deleted: true, nameJp: "", addressJp: "", tkRef: "" })],
    stops: [stop("d1", { deleted: true, place: "", fixed: true }), null, { id: "", date: "2026-12-12" }, { date: "2026-12-12", title: "No id" }, stop("ok1")],
  });
  assert.deepEqual(ids(s), []);
  const gone = st({ stays: [full("sA", "2026-12-09", "2026-12-19", { deleted: true })] });
  assert.equal(missing(gone, NOW).filter((l) => l.kind === "night").length, 1, "a deleted stay covers no night");
});

test("order: by date, stays first, then stops by time, untimed last", () => {
  const s = st({
    stays: [full("sA", "2026-12-09", "2026-12-12", { nameJp: "", addressJp: "", tkRef: "" }), full("sB", "2026-12-14", "2026-12-19")],
    stops: [
      stop("z", { date: "2026-12-12", time: "", title: "Untimed", place: "" }),
      stop("y", { date: "2026-12-12", time: "15:00", title: "Late", place: "" }),
      stop("x", { date: "2026-12-12", time: "09:00", title: "Early", place: "" }),
      stop("w", { date: "2026-12-10", time: "09:00", title: "First day", place: "" }),
      stop("v", { date: "2026-12-12", time: "09:00", title: "Another early", place: "" }),
    ],
  });
  assert.deepEqual(ids(s), ["stay-jp:sA", "stay-booking:sA", "place:w", "place:v", "place:x", "place:y", "place:z", "night:2026-12-13"]);
});

test("one stop can give two lines; ids are stable", () => {
  const s = st({ stops: [stop("two", { fixed: true, place: "" })] });
  assert.deepEqual(ids(s), ["ticket:two", "place:two"], "kind order 4 then 6");
  const again = ids(st({ stops: [stop("two", { fixed: true, place: "", title: "Renamed" })] }), AT("2026-12-06"));
  assert.deepEqual(again, ["ticket:two", "place:two"], "a rename and a later day keep the ids");
  assert.deepEqual(ids(st({ stays: [full("sA", "2026-12-09", "2026-12-12"), full("sB", "2026-12-14", "2026-12-19")] })), ["night:2026-12-13"]);
});

test("lineWords: 0, 1, many", () => {
  assert.equal(lineWords(0), "");
  assert.equal(lineWords(1), "1 thing missing");
  assert.equal(lineWords(8), "8 things missing");
  assert.equal(lineWords(-1), "");
});

test("a state with nothing loaded gives nothing and does not throw", () => {
  assert.deepEqual(missing(null, NOW), []);
  assert.deepEqual(missing({}, NOW), []);
  assert.deepEqual(missing({ trip: null, days: "x", stops: {}, stays: null }, NOW), []);
});

// ---------- the roll call (issue 96) ----------

const R = (name, more = {}) => ({ name, opened: "2026-11-25", ready: null, said: "", linkDay: "2026-11-22", ...more });

test("people words: one not opened, two, one not ready, two; opened with nothing said is no nudge; the owner never counted", () => {
  assert.equal(peopleWords([R("Mo"), R("Ajen", { opened: "" }), R("Trenton")], "Mo"), "Ajen has not opened");
  assert.equal(peopleWords([R("Mo"), R("Ajen", { opened: "" }), R("Trenton", { opened: "", linkDay: "" })], "Mo"), "2 have not opened");
  assert.equal(peopleWords([R("Mo"), R("Ajen", { ready: false, said: "2026-11-26" }), R("Trenton", { ready: true })], "Mo"), "Ajen’s phone is not ready");
  assert.equal(peopleWords([R("Mo"), R("Ajen", { ready: false }), R("Trenton", { ready: false })], "Mo"), "2 phones not ready");
  assert.equal(peopleWords([R("Mo"), R("Ajen", { opened: "" }), R("Trenton", { ready: false })], "Mo"), "Ajen has not opened", "not opened comes first");
  assert.equal(peopleWords([R("Mo"), R("Ajen"), R("Trenton")], "Mo"), "", "opened, nothing said: no nudge");
  assert.equal(peopleWords([R("Mo", { opened: "", ready: false }), R("Ajen"), R("Trenton", { ready: true })], "Mo"), "", "the owner never counted");
  assert.equal(peopleWords(null, "Mo"), "");
  assert.equal(peopleWords([R("Mo"), null, { name: "" }, R("Ajen", { opened: "" })], "mo"), "Ajen has not opened", "junk is skipped; names match in any case");
});

test("the line's words: missing and people, either alone, or nothing", () => {
  assert.equal(checkWords(8, "Ajen has not opened"), "8 missing · Ajen has not opened");
  assert.equal(checkWords(8, ""), "8 things missing");
  assert.equal(checkWords(1, ""), "1 thing missing");
  assert.equal(checkWords(0, "2 phones not ready"), "2 phones not ready");
  assert.equal(checkWords(0, ""), "");
});

test("the six row states", () => {
  const words = (r) => r.lines.map((l) => (l.not ? "!" : "") + l.text);
  // The owner (this phone): the stamp of the day, the ready box from this phone's own answer now.
  const me = rollRow(R("Mo", { ready: false, said: "2026-11-24" }), { owner: true, ownReady: true });
  assert.deepEqual([words(me), me.opened, me.openedLabel, me.ready, me.readyLabel], [["This phone"], "11.25", "Opened Nov 25", "ok", "Ready"]);
  assert.deepEqual([rollRow(R("Mo"), { owner: true, ownReady: false }).ready, rollRow(R("Mo"), { owner: true, ownReady: false }).readyLabel], ["no", "Not ready"]);
  assert.deepEqual([rollRow(R("Mo"), { owner: true }).ready, rollRow(R("Mo"), { owner: true }).readyLabel], ["no", "Nothing said yet"]);
  // Not opened, with a link.
  const shut = rollRow(R("Trenton", { opened: "" }));
  assert.deepEqual([words(shut), shut.opened, shut.openedLabel, shut.ready, shut.readyLabel], [["!Not opened yet", "Link made Nov 22"], "", "Not opened", "no", "Nothing said yet"]);
  // Not opened, no link.
  const none = rollRow(R("Trenton", { opened: "", linkDay: "" }));
  assert.deepEqual([words(none), none.opened, none.ready], [["!No link yet"], "", "no"]);
  // Opened, nothing said.
  const quiet = rollRow(R("Ajen"));
  assert.deepEqual([words(quiet), quiet.opened, quiet.openedLabel, quiet.ready, quiet.readyLabel], [["Opened Nov 25", "Nothing said about no signal yet"], "11.25", "Opened Nov 25", "no", "Nothing said yet"]);
  // Opened, ready.
  const yes = rollRow(R("Ajen", { ready: true, said: "2026-11-26" }));
  assert.deepEqual([words(yes), yes.ready, yes.readyLabel], [["Ready for no signal, said Nov 26"], "ok", "Ready"]);
  // Opened, not ready.
  const no = rollRow(R("Ajen", { ready: false, said: "2026-11-26" }));
  assert.deepEqual([words(no), no.opened, no.ready, no.readyLabel], [["!Not ready yet, said Nov 26"], "11.25", "no", "Not ready"]);
});

test("dates from the date string alone: Nov 25 and 11.25", () => {
  assert.equal(shortDay("2026-11-25"), "Nov 25");
  assert.equal(shortDay("2026-12-01"), "Dec 1");
  assert.equal(shortDay("2027-01-09"), "Jan 9");
  assert.equal(stampDay("2026-11-05"), "11.05");
  assert.equal(shortDay(""), "");
  assert.equal(stampDay("soon"), "");
});
