const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../backend/Pure.js");
const NAMES = ["Mo", "Ajen", "Trenton"];
const good = { id: "a1b2c3d4e5", day: "2026-12-11", title: "Ramen", amount: 4200, currency: "JPY", paidBy: "Mo", split: NAMES };

test("cells that look like formulas are neutralised", () => {
  assert.equal(P.sanitizeCell("=1+1"), "'=1+1");
  assert.equal(P.sanitizeCell("+81 3"), "'+81 3");
  assert.equal(P.sanitizeCell("Ramen"), "Ramen");
  assert.equal(P.sanitizeCell(42), 42);
});

test("a good expense passes, yen is whole, and the defaults are filled", () => {
  const r = P.validateExpense({ ...good, amount: 4200.6 }, NAMES);
  assert.equal(r.ok, true);
  assert.equal(r.value.amount, 4201);
  assert.equal(r.value.splitMode, "equal");
  assert.deepEqual(r.value.splitVals, []);
  assert.equal(r.value.note, "");
  assert.equal(r.value.kind, "");
});

test("bad expenses are refused with a message", () => {
  for (const bad of [
    { title: "" }, { title: "x".repeat(81) }, { amount: 0 }, { amount: -5 }, { amount: 10000001 },
    { amount: NaN }, { currency: "USD" }, { paidBy: "Nobody" }, { split: [] }, { split: ["Mo", "Nobody"] },
    { split: ["Mo", "Mo"] }, { day: "tomorrow" }, { id: "short" }, { id: "has spaces in it" }, { id: "-abc12345" }, { id: "_abc12345" },
    { note: "x".repeat(201) }, { kind: "misc" }, { splitMode: "percent" },
    { splitMode: "parts", splitVals: [2, 3] }, { splitMode: "parts", splitVals: [2, 0, 3] },
    { splitMode: "parts", splitVals: [2, 1.5, 3] }, { splitMode: "parts", splitVals: [2, 100, 3] },
    { splitMode: "exact", splitVals: [2000, 1000, 1000] }, { splitMode: "exact", splitVals: [4200, 0, 0] },
  ]) {
    const r = P.validateExpense({ ...good, ...bad }, NAMES);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(typeof r.message, "string");
  }
  assert.equal(P.validateExpense({ ...good, day: "pre" }, NAMES).ok, true);
  assert.equal(P.validateExpense({ ...good, currency: "CAD", amount: 12.345 }, NAMES).value.amount, 12.35);
  assert.equal(P.validateExpense({ ...good, splitMode: "parts", splitVals: [2, 3, 3] }, NAMES).ok, true);
  assert.equal(P.validateExpense({ ...good, splitMode: "exact", splitVals: [2000, 1200, 1000] }, NAMES).ok, true);
  assert.equal(P.validateExpense({ ...good, currency: "CAD", amount: 100, splitMode: "exact", splitVals: [33.34, 33.33, 33.33] }, NAMES).ok, true);
  assert.equal(P.validateExpense({ ...good, kind: "food", note: "ref 8841" }, NAMES).value.kind, "food");
});

test("exact splits are rounded, each at least one unit, and must sum exactly", () => {
  const cad = { ...good, currency: "CAD", splitMode: "exact" };
  assert.equal(P.validateExpense({ ...cad, amount: 0.01, splitVals: [0.004, 0.004, 0.01] }, NAMES).ok, false);
  assert.equal(P.validateExpense({ ...cad, amount: 100, splitVals: [33.334, 33.333, 33.333] }, NAMES).ok, false);
  const r = P.validateExpense({ ...cad, amount: 100, splitVals: [33.334, 33.336, 33.33] }, NAMES);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.splitVals, [33.33, 33.34, 33.33]);
  const y = P.validateExpense({ ...good, amount: 100, splitMode: "exact", splitVals: [50.4, 49.6, 0.4] }, NAMES);
  assert.equal(y.ok, false);
  const y2 = P.validateExpense({ ...good, amount: 100, splitMode: "exact", splitVals: [50.4, 49.6, 0.6] }, NAMES);
  assert.equal(y2.ok, false);
  const y3 = P.validateExpense({ ...good, amount: 100, splitMode: "exact", splitVals: [50.4, 48.6, 1.2] }, NAMES);
  assert.equal(y3.ok, true);
  assert.deepEqual(y3.value.splitVals, [50, 49, 1]);
});

test("a day must be a real calendar date", () => {
  for (const day of ["2026-13-45", "2026-02-30", "2026-00-10", "2026-04-31", "2026-12-00", "2027-02-29"]) {
    assert.equal(P.validateExpense({ ...good, day }, NAMES).ok, false, day);
  }
  for (const day of ["2026-12-31", "2028-02-29", "pre"]) {
    assert.equal(P.validateExpense({ ...good, day }, NAMES).ok, true, day);
  }
});

test("an expense value carries exactly the client-settable fields, trimmed", () => {
  const r = P.validateExpense({ ...good, title: "  Ramen ", note: " n ", rate: 99, addedBy: "Ajen", addedAt: "t", deleted: true }, NAMES);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.value).sort(), ["amount", "currency", "day", "id", "kind", "note", "paidBy", "split", "splitMode", "splitVals", "title"]);
  assert.equal(r.value.title, "Ramen");
  assert.equal(r.value.note, "n");
});

test("odd input is refused with a message, never thrown", () => {
  for (const bad of [null, undefined, "text", 5, [], { ...good, split: "Mo" }, { ...good, title: 5 }, { ...good, paidBy: ["Mo"] }, { ...good, amount: "4200" }, { ...good, note: 7 }]) {
    let r;
    assert.doesNotThrow(() => { r = P.validateExpense(bad, NAMES); }, JSON.stringify(bad));
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(typeof r.message, "string");
    assert.ok(r.message.length > 0);
  }
});

test("payments need two different known people and a sane amount", () => {
  const pay = { id: "p1p2p3p4p5", from: "Ajen", to: "Mo", cad: 250.304, seed: 7, rot: -4.2 };
  assert.equal(P.validatePayment(pay, NAMES).value.cad, 250.3);
  assert.equal(P.validatePayment({ ...pay, to: "Ajen" }, NAMES).ok, false);
  assert.equal(P.validatePayment({ ...pay, cad: 0 }, NAMES).ok, false);
  assert.equal(P.validatePayment({ ...pay, cad: 100001 }, NAMES).ok, false);
});

test("a payment carries seed and rot, and refuses missing or odd ones", () => {
  const pay = { id: "p1p2p3p4p5", from: "Ajen", to: "Mo", cad: 250.304, seed: 7, rot: -4.2 };
  assert.deepEqual(P.validatePayment(pay, NAMES).value, { id: "p1p2p3p4p5", from: "Ajen", to: "Mo", cad: 250.3, seed: 7, rot: -4.2 });
  const { seed, ...noSeed } = pay;
  const { rot, ...noRot } = pay;
  for (const bad of [noSeed, noRot, { ...pay, seed: 0 }, { ...pay, seed: 1.5 }, { ...pay, seed: "7" }, { ...pay, rot: NaN }, { ...pay, rot: Infinity }, { ...pay, rot: "1" }, null, "x", { ...pay, id: "short" }, { ...pay, id: "-abc12345" }, { ...pay, id: "_abc12345" }, { ...pay, from: "Nobody" }]) {
    const r = P.validatePayment(bad, NAMES);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(typeof r.message, "string");
  }
  assert.equal(P.validatePayment({ ...pay, seed: 1, rot: 0 }, NAMES).ok, true);
});

test("a person can change only their e-Transfer address and Simplify", () => {
  assert.deepEqual(P.validatePersonPatch({ etransfer: "  mo@example.com ", simplify: false }).value, { etransfer: "mo@example.com", simplify: false });
  assert.equal(P.validatePersonPatch({ etransfer: "x".repeat(81) }).ok, false);
  assert.equal(P.validatePersonPatch({ simplify: "no" }).ok, false);
  assert.equal(P.validatePersonPatch({ initials: "XX" }).ok, false);
  assert.equal(P.validatePersonPatch({}).ok, false);
});

test("rows round-trip between sheet and API shapes", () => {
  const h = P.TABS.Expenses;
  const row = P.objToRow(h, { id: "x", title: "=evil", split: "Mo,Ajen", deleted_at: "" });
  assert.equal(row[h.indexOf("title")], "'=evil");
  const e = P.expenseFromRow({ id: "x", day: "pre", title: "T", amount: 80, currency: "CAD", rate: 111, paid_by: "Mo", split: "Mo,Ajen", split_mode: "parts", split_vals: "1,3", note: "n", kind: "food", added_by: "Mo", added_at: "t", deleted_at: "" });
  assert.deepEqual(e.split, ["Mo", "Ajen"]);
  assert.deepEqual(e.splitVals, [1, 3]);
  assert.equal(e.paidBy, "Mo");
  assert.equal(e.deleted, false);
  assert.equal(P.expenseFromRow({ id: "y", split: "Mo", split_mode: "", split_vals: "" }).splitMode, "equal");
  const who = P.personFromRow({ name: "Mo", initials: "MO", order: 1, etransfer: "mo@example.com", simplify: false, email: "private@example.com" });
  assert.deepEqual(who, { name: "Mo", initials: "MO", etransfer: "mo@example.com", simplify: false, photo: "" });
  assert.equal(P.personFromRow({ name: "Ajen", initials: "AJ", simplify: "" }).simplify, true);
});

// ---- Task 16: a picture in each person's seal ----
const JPEG = require("./fixtures/picture.json").jpeg;

test("a picture is a small JPEG data address, or \"\" to take it away", () => {
  assert.deepEqual(P.validatePersonPatch({ photo: JPEG }), { ok: true, value: { photo: JPEG } });
  assert.deepEqual(P.validatePersonPatch({ photo: "" }), { ok: true, value: { photo: "" } });
  const head = "data:image/jpeg;base64,";
  const bad = [
    "data:image/png;base64,iVBORw0KGgo=",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "javascript:alert(1)",
    "https://example.test/me.jpg",
    head,
    head + "AAAA\nAAAA",
    head + "AAAA\"AAAA",
    head + "AAAA'AAAA",
    head + "AAAA===",
    " " + JPEG,
    head + "A".repeat(12001 - head.length),
    head + "A",
    head + "AAAAA",
    head + "AA=",
    12,
    null,
    { src: JPEG },
  ];
  for (const photo of bad) {
    const v = P.validatePersonPatch({ photo });
    assert.equal(v.ok, false, String(photo).slice(0, 40));
    assert.equal(v.message, "That picture couldn’t be used. Try another.");
  }
  assert.equal(P.validatePersonPatch({ photo: head + "A".repeat(11976) }).ok, true, "11,999 characters, whole 4-character groups, is the most");
  assert.equal(P.validatePersonPatch({ photo: head + "A".repeat(11980) }).ok, false, "past 12,000 characters");
  assert.equal(P.validatePersonPatch({ photo: head + "AA==" }).ok, true);
  assert.deepEqual(P.validatePersonPatch({ etransfer: "a@example.com", photo: "" }).value, { etransfer: "a@example.com", photo: "" });
});

test("the People row keeps the picture, after email, as text", () => {
  const h = P.TABS.People;
  assert.equal(h.indexOf("photo"), h.indexOf("email") + 1);
  assert.equal(P.isTextColumn("People", "photo"), true);
  const row = P.objToRow(h, { name: "Mo", initials: "MO", order: 1, etransfer: "", simplify: true, email: "", photo: JPEG });
  const back = P.personFromRow(P.rowToObj(h, row));
  assert.equal(back.photo, JPEG);
  assert.equal(P.personFromRow({ name: "Ajen", initials: "AJ" }).photo, "", "an older row with no photo cell has none");
});

test("rows coped with as Sheets really hands them back", () => {
  const e = P.expenseFromRow({ id: "x", day: new Date(Date.UTC(2026, 11, 11, 12)), title: "T", amount: "80.5", currency: "CAD", rate: "111", paid_by: "Mo", split: "Mo", split_mode: "parts", split_vals: 3, note: "", kind: "", added_by: "Mo", added_at: new Date(Date.UTC(2026, 11, 11, 3, 4, 5)), deleted_at: new Date(Date.UTC(2026, 11, 12)) });
  assert.deepEqual(e.splitVals, [3]);
  assert.equal(e.amount, 80.5);
  assert.equal(e.rate, 111);
  assert.equal(e.day, "2026-12-11");
  assert.equal(e.addedAt, "2026-12-11T03:04:05.000Z");
  assert.equal(e.deleted, true);
  assert.equal(P.personFromRow({ name: "A", simplify: "FALSE" }).simplify, false);
  assert.equal(P.personFromRow({ name: "A", simplify: "TRUE" }).simplify, true);
  assert.equal(P.personFromRow({ name: "A", simplify: true }).simplify, true);
  const p = P.paymentFromRow({ id: "p", from: "Ajen", to: "Mo", cad: "250.3", stamped_by: "Ajen", stamped_at: new Date(Date.UTC(2026, 11, 13)), seed: "7", rot: "-4.2", removed_at: "" });
  assert.deepEqual(p, { id: "p", from: "Ajen", to: "Mo", cad: 250.3, stampedBy: "Ajen", stampedAt: "2026-12-13T00:00:00.000Z", seed: 7, rot: -4.2, removed: false });
  assert.equal(P.paymentFromRow({ id: "q", removed_at: "2026-12-14T00:00:00.000Z" }).removed, true);
});

test("expense and payment rows round-trip from the API shape", () => {
  const x = { id: "a1b2c3d4e5", day: "2026-12-11", title: "Taxi", amount: 3600, currency: "JPY", rate: 111, paidBy: "Ajen", split: ["Ajen", "Trenton"], splitMode: "parts", splitVals: [1, 2], note: "late", kind: "transport", addedBy: "Ajen", addedAt: "2026-12-11T01:00:00.000Z", deleted: true };
  const row = P.expenseToRow(x);
  assert.equal(row.paid_by, "Ajen");
  assert.equal(row.split, "Ajen,Trenton");
  assert.equal(row.split_vals, "1,2");
  for (const k of ["added_at", "deleted_at", "deleted", "paidBy"]) assert.equal(k in row, false, k);
  const back = P.expenseFromRow(row);
  for (const k of Object.keys(x)) if (k !== "addedAt" && k !== "deleted") assert.deepEqual(back[k], x[k], k);
  assert.equal(P.expenseToRow({ ...x, splitMode: "equal", splitVals: [] }).split_vals, "");
  assert.deepEqual(P.expenseFromRow(P.expenseToRow({ ...x, currency: "CAD", amount: 100, splitMode: "exact", splitVals: [33.34, 66.66] })).splitVals, [33.34, 66.66]);
  const noExtras = P.expenseToRow({ id: "a1b2c3d4e5", day: "pre", title: "T", amount: 1, currency: "JPY", paidBy: "Mo", split: ["Mo"], splitMode: "equal", splitVals: [], note: "", kind: "" });
  assert.equal("rate" in noExtras, false);
  assert.equal("added_by" in noExtras, false);

  const pay = { id: "p1p2p3p4p5", from: "Ajen", to: "Mo", cad: 250.3, stampedBy: "Ajen", stampedAt: "2026-12-13T00:00:00.000Z", seed: 7, rot: -4.2, removed: true };
  const prow = P.paymentToRow(pay);
  assert.equal(prow.stamped_by, "Ajen");
  for (const k of ["stamped_at", "removed_at", "removed"]) assert.equal(k in prow, false, k);
  const pback = P.paymentFromRow(prow);
  for (const k of Object.keys(pay)) if (k !== "stampedAt" && k !== "removed") assert.deepEqual(pback[k], pay[k], k);
});

test("the setup seed rows are the trip, three people and one day per date", () => {
  const s = P.setupSeedRows();
  assert.deepEqual(s.Trip.map((r) => r.key), ["name", "start", "end", "home", "currency", "tz"]);
  assert.deepEqual(s.People.map((r) => [r.name, r.initials, r.order, r.simplify]), [["Mo", "MO", 1, true], ["Ajen", "AJ", 2, true], ["Trenton", "TR", 3, true]]);
  assert.equal(s.Days.length, 11);
  assert.equal(s.Days[0].date, "2026-12-10");
  assert.equal(s.Days[10].date, "2026-12-20");
  assert.notEqual(P.setupSeedRows().People[0], s.People[0]);
});

test("every column is plain text except the numbers and the on/off flags", () => {
  const numbers = { Expenses: ["amount", "rate"], Settlements: ["cad", "seed", "rot"], Stamps: ["seed"], People: ["order"], Stops: ["travel_min"], Log: ["id", "undoes", "undone_by"] };
  const flags = { People: ["simplify"], Stops: ["fixed", "booked"] };
  for (const [tab, headers] of Object.entries(P.TABS)) {
    for (const h of headers) {
      const notText = (numbers[tab] || []).includes(h) || (flags[tab] || []).includes(h);
      assert.equal(P.isTextColumn(tab, h), !notText, tab + "." + h);
    }
  }
  assert.equal(P.isTextColumn("Expenses", "id"), true);
  assert.equal(P.isTextColumn("Settlements", "id"), true);
  assert.equal(P.isTextColumn("Expenses", "split_vals"), true);
  assert.equal(P.isTextColumn("Expenses", "title"), true);
});

test("rows read back from text columns still give numbers where the API wants them", () => {
  const e = P.expenseFromRow({ id: "x", day: "2026-12-11", title: "0012", amount: 4200, currency: "JPY", rate: 111, paid_by: "Mo", split: "Mo,Ajen", split_mode: "parts", split_vals: "1,3", note: "3-4", kind: "", added_by: "Mo", added_at: "t", deleted_at: "" });
  assert.deepEqual(e.splitVals, [1, 3]);
  assert.equal(P.expenseFromRow({ id: "x", split: "Mo", split_mode: "parts", split_vals: "3" }).splitVals[0], 3);
  assert.equal(e.title, "0012");
  assert.equal(e.note, "3-4");
  assert.equal(P.parseLogRow({ id: 7, undoes: 3, undone_by: "" }).undoes, 3);
});

test("unsanitizeCell drops only the escape apostrophe that sanitizeCell adds", () => {
  for (const typed of ["=probe", "-5% off", "+81 3", "@home", "\tx", "\rx"]) {
    assert.equal(P.unsanitizeCell(P.sanitizeCell(typed)), typed, JSON.stringify(typed));
    assert.equal(P.unsanitizeCell(typed), typed);
  }
  for (const v of ["'hello", "''", "'", "it's", "Ramen", "", 42, true, null]) assert.equal(P.unsanitizeCell(v), v, JSON.stringify(v));
  assert.equal(P.unsanitizeCell("''=x"), "''=x");
});

test("rowToObj reads escaped cells back as typed", () => {
  const h = ["id", "title", "note", "amount"];
  assert.deepEqual(P.rowToObj(h, ["a1", "'=probe", "'-probe", 5]), { id: "a1", title: "=probe", note: "-probe", amount: 5 });
  assert.deepEqual(P.rowToObj(h, P.objToRow(h, { id: "a1", title: "@home", note: "+81 3", amount: 5 })), { id: "a1", title: "@home", note: "+81 3", amount: 5 });
  assert.equal(P.rowToObj(h, ["a1", "'plain"]).title, "'plain");
});

test("the rate is fetched only when today's is missing and no failure in the last hour", () => {
  const now = "2026-12-10T12:00:00.000Z";
  assert.equal(P.shouldFetchRate(null, null, now), true);
  assert.equal(P.shouldFetchRate("", "", now), true);
  assert.equal(P.shouldFetchRate("108.4", null, now), false);
  assert.equal(P.shouldFetchRate("108.4", "2026-12-10T11:59:00.000Z", now), false);
  assert.equal(P.shouldFetchRate(null, "2026-12-10T11:30:00.000Z", now), false);
  assert.equal(P.shouldFetchRate(null, "2026-12-10T11:00:00.001Z", now), false);
  assert.equal(P.shouldFetchRate(null, "2026-12-10T11:00:00.000Z", now), true);
  assert.equal(P.shouldFetchRate(null, "2026-12-09T12:00:00.000Z", now), true);
  assert.equal(P.shouldFetchRate("0", null, now), true);
  assert.equal(P.shouldFetchRate("junk", null, now), true);
  assert.equal(P.shouldFetchRate(null, "junk", now), true);
  assert.equal(P.shouldFetchRate(null, "2026-12-10T13:00:00.000Z", now), true);
});

test("rateSource: today's stored rate is live, an earlier day's is last, none is the stand-in (F7)", () => {
  assert.equal(P.rateSource("108.4", "108.4"), "live");
  assert.equal(P.rateSource(null, "107.9"), "last");
  assert.equal(P.rateSource("", "107.9"), "last");
  assert.equal(P.rateSource(null, null), "fallback");
  assert.equal(P.rateSource("junk", "0"), "fallback");
});

test("sameKey compares whole keys and is false for any difference (F12)", () => {
  assert.equal(P.sameKey("abc123", "abc123"), true);
  assert.equal(P.sameKey("abc123", "abc124"), false);
  assert.equal(P.sameKey("abc123", "abc12"), false);
  assert.equal(P.sameKey("abc12", "abc123"), false);
  assert.equal(P.sameKey("", ""), false, "an empty key never matches");
  assert.equal(P.sameKey(null, "abc"), false);
  assert.equal(P.sameKey("abc", undefined), false);
});

test("every message the backend can show uses the curly apostrophe (R20, F10)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname, "..", "backend");
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const lit of src.match(/"(?:[^"\\\n]|\\.)*"/g) || []) {
      assert.equal(/[A-Za-z]'[A-Za-z]/.test(lit), false, f + ": " + lit);
    }
  }
});

const DATES = ["2026-12-10", "2026-12-11", "2026-12-12"];
const STOP = { id: "stopAAAA0001", date: "2026-12-12", title: " Shibuya Sky ", time: "14:00" };

test("validateStop fills the blanks and trims", () => {
  const v = P.validateStop(STOP, DATES);
  assert.deepEqual(v.value, { id: "stopAAAA0001", date: "2026-12-12", time: "14:00", title: "Shibuya Sky", detail: "", gettingThere: "", travelMin: 0, fixed: false, place: "", signJp: "", booked: false, link: "", photo: "", note: "", lat: "", lng: "", tkRef: "", tkName: "", tkPeople: "", tkSeat: "", nameJp: "", addressJp: "" });
});
test("validateStop refuses what it must", () => {
  const bad = (patch, message) => assert.deepEqual(P.validateStop({ ...STOP, ...patch }, DATES), { ok: false, message });
  bad({ date: "2026-12-25" }, "Pick a day of the trip.");
  bad({ title: "  " }, "Say what it is.");
  bad({ title: "x".repeat(81) }, "Keep the name under 80 letters.");
  bad({ time: "9:5" }, "Use a time like 14:30.");
  bad({ time: "25:00" }, "Use a time like 14:30.");
  bad({ travelMin: 12.5 }, "Minutes to get there must be a whole number from 0 to 600.");
  bad({ travelMin: 601 }, "Minutes to get there must be a whole number from 0 to 600.");
  bad({ link: "javascript:alert(1)" }, "That link has to start with https://.");
  bad({ photo: "data:image/png;base64,AAAA" }, "That photo link has to start with https://.");
  bad({ place: "http://" }, "That map link didn’t come through properly.");
  bad({ fixed: "yes" }, "Fixed has to be on or off.");
  bad({ id: "x" }, "That stop has a bad id.");
});
test("validateStop length limits", () => {
  const bad = (patch, message) => assert.deepEqual(P.validateStop({ ...STOP, ...patch }, DATES), { ok: false, message });
  bad({ detail: "x".repeat(121) }, "Keep the detail under 120 letters.");
  bad({ gettingThere: "x".repeat(301) }, "Keep the directions under 300 letters.");
  bad({ place: "x".repeat(201) }, "Keep the place under 200 letters.");
  bad({ signJp: "x".repeat(21) }, "Keep the sign name under 20 letters.");
  bad({ note: "x".repeat(301) }, "Keep the note under 300 letters.");
  bad({ booked: 1 }, "Booked has to be on or off.");
  assert.equal(P.validateStop({ ...STOP, detail: "x".repeat(120), note: "x".repeat(300) }, DATES).ok, true);
});
test("a stop's Japanese for a taxi driver (#95): taken trimmed, kept to the stay's limits", () => {
  const v = P.validateStop({ ...STOP, nameJp: " 炭火焼鳥 鳥花 湖畔店 ", addressJp: " 架空県湖畔市港町9-9-9 みどりビル3階 " }, DATES);
  assert.equal(v.ok, true);
  assert.deepEqual([v.value.nameJp, v.value.addressJp], ["炭火焼鳥 鳥花 湖畔店", "架空県湖畔市港町9-9-9 みどりビル3階"]);
  const bad = (patch, message) => assert.deepEqual(P.validateStop({ ...STOP, ...patch }, DATES), { ok: false, message });
  bad({ nameJp: "あ".repeat(81) }, "Keep the Japanese name under 80 letters.");
  bad({ addressJp: "あ".repeat(201) }, "Keep the address under 200 letters.");
  bad({ nameJp: 5 }, "That didn’t come through properly.");
  assert.equal(P.validateStop({ ...STOP, nameJp: "あ".repeat(80), addressJp: "あ".repeat(200) }, DATES).ok, true);
  // Both columns at the end of Stops, after the ticket's facts: an existing Sheet never shifts.
  assert.deepEqual(P.TABS.Stops.slice(-6), ["tk_ref", "tk_name", "tk_people", "tk_seat", "name_jp", "address_jp"]);
  // A row round-trips both; a row from before migrate (no columns) reads them as "".
  const s = P.validateStop({ ...STOP, nameJp: "鳥花", addressJp: "架空県湖畔市1-2-3" }, DATES).value;
  const row = P.stopToRow(s);
  assert.deepEqual([row.name_jp, row.address_jp], ["鳥花", "架空県湖畔市1-2-3"]);
  assert.deepEqual(P.stopFromRow(row), { ...s, deleted: false });
  const old = P.stopFromRow({ id: "h1", date: "2026-12-12", title: "x" });
  assert.deepEqual([old.nameJp, old.addressJp], ["", ""]);
});
test("a stop with no time is allowed, and a pasted Maps link is a place", () => {
  assert.equal(P.validateStop({ ...STOP, time: "" }, DATES).value.time, "");
  assert.equal(P.validateStop({ ...STOP, place: "https://maps.app.goo.gl/abc" }, DATES).value.place, "https://maps.app.goo.gl/abc");
});
test("stop rows round-trip, and a hand-typed row reads safely", () => {
  const s = { ...P.validateStop({ ...STOP, travelMin: 30, fixed: true, signJp: "渋谷" }, DATES).value };
  const back = P.stopFromRow(P.stopToRow(s));
  assert.deepEqual(back, { ...s, deleted: false });
  assert.equal("deleted_at" in P.stopToRow(s), false);
  const hand = P.stopFromRow({ id: "h1", date: new Date(Date.UTC(2026, 11, 12)), time: "9:5", title: 7, travel_min: "abc", fixed: "TRUE", link: "javascript:x", photo: "ftp://x", deleted_at: "2026-12-01T00:00:00Z" });
  assert.deepEqual([hand.time, hand.title, hand.travelMin, hand.fixed, hand.link, hand.photo, hand.deleted], ["", "7", 0, true, "", "", true]);
});
test("hand-typed stop times and minutes read as the app writes them (I5)", () => {
  const read = (cells) => P.stopFromRow({ id: "h1", date: "2026-12-12", title: "x", ...cells });
  assert.equal(read({ time: "9:30" }).time, "09:30");
  assert.equal(read({ time: "9:05" }).time, "09:05");
  assert.equal(read({ time: " 7:45 " }).time, "07:45");
  assert.equal(read({ time: "09:30" }).time, "09:30");
  for (const bad of ["9:5", "25:00", "9:60", "930", "nine", "19:30:00x", "-1:00"]) assert.equal(read({ time: bad }).time, "", bad);
  // A time cell Sheets hands back as a fraction of a day.
  assert.equal(read({ time: 0.5 }).time, "12:00");
  assert.equal(read({ time: 0.3958333333 }).time, "09:30");
  assert.equal(read({ time: 0 }).time, "00:00");
  assert.equal(read({ time: 0.99999 }).time, "", "rounds to 24:00: no time");
  for (const bad of [1, 1.5, -0.25, NaN]) assert.equal(read({ time: bad }).time, "", String(bad));
  // A time cell handed back as a Date: read only where the script's own zone
  // can be asked (Apps Script); here in Node there is none, so no time.
  assert.equal(read({ time: new Date(Date.UTC(1899, 11, 30, 0, 30)) }).time, "");
  // Minutes to get there: whole, from 0 up.
  assert.equal(read({ travel_min: 12.5 }).travelMin, 13);
  assert.equal(read({ travel_min: "12.4" }).travelMin, 12);
  assert.equal(read({ travel_min: 20 }).travelMin, 20);
  for (const bad of [-5, "-5", "abc", "", null, undefined, Infinity]) assert.equal(read({ travel_min: bad }).travelMin, 0, String(bad));
});

test("a Date time cell on Apps Script is read in the script's zone, and a seconds offset (an old zone's local mean time) counts as no time", () => {
  const saved = { U: global.Utilities, S: global.Session };
  try {
    global.Session = { getScriptTimeZone: () => "Asia/Tokyo" };
    global.Utilities = { formatDate: (d, tz, fmt) => {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d);
      const get = (t) => parts.find((p) => p.type === t).value;
      return fmt.replace("HH", get("hour")).replace("mm", get("minute")).replace("ss", get("second"));
    } };
    // 09:30 on Sheets' zero day in Tokyo.
    assert.equal(P.stopFromRow({ id: "h1", time: new Date(Date.UTC(1899, 11, 30, 0, 30)) }).time, "09:30");
    assert.equal(P.stopFromRow({ id: "h1", time: new Date(Date.UTC(1899, 11, 30, 0, 30, 28)) }).time, "");
    assert.equal(P.stopFromRow({ id: "h1", time: new Date(NaN) }).time, "");
  } finally {
    global.Utilities = saved.U;
    global.Session = saved.S;
  }
});

test("validateStay", () => {
  const stay = { id: "stayAAAA0001", name: "Asakusa hotel", firstNight: "2026-12-10", lastNight: "2026-12-12" };
  assert.deepEqual(P.validateStay(stay).value, { ...stay, nameJp: "", addressJp: "", note: "", place: "", link: "", photo: "", tkRef: "", tkName: "", tkPeople: "", tkRoom: "" });
  assert.equal(P.validateStay({ ...stay, lastNight: "2026-12-09" }).message, "The last night can’t be before the first.");
  assert.equal(P.validateStay({ ...stay, name: "" }).message, "Say where you’re staying.");
  assert.equal(P.validateStay({ ...stay, link: "javascript:x" }).message, "That link has to start with https://.");
  assert.equal(P.validateStay({ ...stay, id: "x" }).message, "That stay has a bad id.");
  assert.equal(P.validateStay({ ...stay, firstNight: "nope" }).message, "Pick the first and last night.");
  assert.equal(P.validateStay({ ...stay, name: "x".repeat(81) }).message, "Keep the name under 80 letters.");
  assert.equal(P.validateStay({ ...stay, nameJp: "x".repeat(81) }).message, "Keep the Japanese name under 80 letters.");
  assert.equal(P.validateStay({ ...stay, addressJp: "x".repeat(201) }).message, "Keep the address under 200 letters.");
});
test("a stay's booking: four facts at the end of Stays, both ways, each under 60 letters", () => {
  assert.deepEqual(P.TABS.Stays.slice(-4), ["tk_ref", "tk_name", "tk_people", "tk_room"]);
  for (const c of ["tk_ref", "tk_name", "tk_people", "tk_room"]) assert.equal(P.isTextColumn("Stays", c), true);
  const stay = { id: "stayAAAA0001", name: "Tsubame-so Guest House", firstNight: "2026-12-10", lastNight: "2026-12-12" };
  const v = P.validateStay({ ...stay, tkRef: " TSB-4827-KQ ", tkName: "M. EXAMPLE", tkPeople: "3", tkRoom: "Tatami room for 3" }).value;
  assert.deepEqual([v.tkRef, v.tkName, v.tkPeople, v.tkRoom], ["TSB-4827-KQ", "M. EXAMPLE", "3", "Tatami room for 3"]);
  const row = P.stayToRow(v);
  assert.deepEqual([row.tk_ref, row.tk_name, row.tk_people, row.tk_room], ["TSB-4827-KQ", "M. EXAMPLE", "3", "Tatami room for 3"]);
  const back = P.stayFromRow({ ...row, first_night: "2026-12-10", last_night: "2026-12-12" });
  assert.deepEqual([back.tkRef, back.tkName, back.tkPeople, back.tkRoom], ["TSB-4827-KQ", "M. EXAMPLE", "3", "Tatami room for 3"]);
  // A row before migrate (no such cells) reads them as empty.
  const old = P.stayFromRow({ id: "s", name: "N" });
  assert.deepEqual([old.tkRef, old.tkName, old.tkPeople, old.tkRoom], ["", "", "", ""]);
  // Absent fields leave the row alone (a patch).
  assert.equal("tk_room" in P.stayToRow({ id: "s" }), false);
  for (const f of ["tkRef", "tkName", "tkPeople", "tkRoom"]) {
    assert.equal(P.validateStay({ ...stay, [f]: "x".repeat(60) }).ok, true);
    assert.equal(P.validateStay({ ...stay, [f]: "x".repeat(61) }).message, "Keep each booking detail under 60 letters.");
    assert.equal(P.validateStay({ ...stay, [f]: 5 }).ok, false);
  }
});
test("summarize: an edited stay names its booking as a stop's ticket facts, never their values", () => {
  const stay = { id: "s", name: "Tsubame-so Guest House", tkRef: "", tkName: "", tkPeople: "", tkRoom: "", note: "" };
  assert.equal(P.summarize("edit", "stay", stay, { ...stay, tkRef: "TSB-4827-KQ" }), "changed the stay Tsubame-so Guest House: ticket");
  assert.equal(P.summarize("edit", "stay", stay, { ...stay, tkRoom: "Tatami" }), "changed the stay Tsubame-so Guest House: ticket");
  assert.equal(P.summarize("edit", "stay", stay, { ...stay, note: "Late" }), "changed the stay Tsubame-so Guest House");
  // An entry from before the booking existed (no such keys) reads as before.
  assert.equal(P.summarize("edit", "stay", { id: "s", name: "N" }, { id: "s", name: "N", tkRef: "" }), "changed the stay N");
});
test("validateTicket: a picture names a stop or a stay, exactly one", () => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");
  const base = { id: "tkt000000001", who: "", seat: "", page: 1, mime: "image/png", w: 10, h: 10, data: sig };
  const say = "That didn’t say which stop it is for.";
  const onStop = P.validateTicket({ ...base, stop: "planstop1203" }, []);
  assert.equal(onStop.ok, true);
  assert.equal(onStop.value.stop, "planstop1203");
  assert.equal(onStop.value.stay, "");
  const onStay = P.validateTicket({ ...base, stay: "planstay0001" }, []);
  assert.equal(onStay.ok, true);
  assert.equal(onStay.value.stay, "planstay0001");
  assert.equal(onStay.value.stop, "");
  assert.equal(P.validateTicket({ ...base, stop: "", stay: "planstay0001" }, []).ok, true);
  assert.equal(P.validateTicket({ ...base, stop: "planstop1203", stay: "planstay0001" }, []).message, say);
  assert.equal(P.validateTicket(base, []).message, say);
  assert.equal(P.validateTicket({ ...base, stop: "", stay: "" }, []).message, say);
  assert.equal(P.validateTicket({ ...base, stay: "bad" }, []).message, say);
  assert.equal(P.validateTicket({ ...base, stay: 12345678 }, []).message, say);
  // A Tickets row: stay only when the cell is filled.
  assert.equal("stay" in P.ticketFromRow({ id: "a", stop: "planstop1203" }), false);
  assert.equal("stay" in P.ticketFromRow({ id: "a", stop: "planstop1203", stay: "" }), false);
  assert.equal(P.ticketFromRow({ id: "a", stop: "", stay: "planstay0001" }).stay, "planstay0001");
  assert.deepEqual(P.TABS.Tickets.slice(-1), ["stay"]);
  // History: the stay's name where a stop's title goes, under the same field.
  const snap = P.ticketSnap_({ id: "a", stop: "", stay: "planstay0001", who: "" }, "Tsubame-so Guest House");
  assert.equal(snap.stopTitle, "Tsubame-so Guest House");
  assert.equal(snap.stay, "planstay0001");
  assert.equal(P.summarize("add", "ticket", null, snap), "added a ticket to Tsubame-so Guest House");
  assert.equal(P.summarize("remove", "ticket", snap, snap), "removed a ticket from Tsubame-so Guest House");
  assert.equal("stay" in P.ticketSnap_({ id: "a", stop: "s" }, "T"), false);
});
test("validateStay: an optional https photo, like a stop's", () => {
  const stay = { id: "stayAAAA0001", name: "Asakusa hotel", firstNight: "2026-12-10", lastNight: "2026-12-12" };
  assert.equal(P.validateStay({ ...stay, photo: "https://example.org/a.jpg" }).value.photo, "https://example.org/a.jpg");
  assert.equal(P.validateStay(stay).value.photo, "");
  const msg = "That photo link has to start with https://.";
  assert.equal(P.validateStay({ ...stay, photo: "http://example.org/a.jpg" }).message, msg);
  assert.equal(P.validateStay({ ...stay, photo: "javascript:alert(1)" }).message, msg);
  assert.equal(P.validateStay({ ...stay, photo: 5 }).message, msg);
  assert.equal(P.validateStay({ ...stay, photo: 5 }).message, P.validateStay({ ...stay, photo: "x" }).message);
  assert.equal(P.validateStay({ ...stay, link: 5 }).ok, false, "a non-string link is refused too");
});
test("stay photo: column after link, read through safeUrl, written by stayToRow", () => {
  const t = P.TABS.Stays;
  assert.equal(t[t.indexOf("link") + 1], "photo");
  // lat and lng came later: after deleted_at, where migrate adds them; the booking's four after those.
  assert.deepEqual(t.slice(-7, -4), ["deleted_at", "lat", "lng"]);
  assert.equal(P.isTextColumn("Stays", "photo"), P.isTextColumn("Stops", "photo"));
  assert.equal(P.stayFromRow({ id: "s", photo: "https://example.org/a.jpg" }).photo, "https://example.org/a.jpg");
  for (const bad of ["=HYPERLINK(\"https://example.org/a.jpg\")", "http://example.org/a.jpg", "javascript:x", undefined]) {
    assert.equal(P.stayFromRow({ id: "s", photo: bad }).photo, "", String(bad));
  }
  assert.equal(P.stayToRow({ id: "s", photo: "https://example.org/a.jpg" }).photo, "https://example.org/a.jpg");
});
test("stay rows round-trip and read safely", () => {
  const stay = P.validateStay({ id: "stayAAAA0001", name: "Asakusa hotel", firstNight: "2026-12-10", lastNight: "2026-12-12", link: "https://x.test" }).value;
  assert.deepEqual(P.stayFromRow(P.stayToRow(stay)), { ...stay, deleted: false, lat: "", lng: "" });
  assert.equal("deleted_at" in P.stayToRow(stay), false);
  assert.equal(P.stayFromRow({ id: "s", name: "N", link: "javascript:x", deleted_at: "x" }).link, "");
  assert.equal(P.stayFromRow({ id: "s", deleted_at: "x" }).deleted, true);
  assert.deepEqual(P.TABS.Stays.slice(-7, -4), ["deleted_at", "lat", "lng"]);
});
test("validateDayPatch", () => {
  assert.deepEqual(P.validateDayPatch({ city: " Tokyo ", lineColour: "#2fb6e8" }).value, { city: "Tokyo", lineColour: "#2fb6e8" });
  assert.equal(P.validateDayPatch({ lineColour: "blue" }).message, "Use a colour like #2FB6E8.");
  assert.equal(P.validateDayPatch({ date: "2026-12-11" }).message, "Only a day’s city, title, line and places can be changed.");
  assert.equal(P.validateDayPatch({}).message, "Nothing to change.");
  assert.equal(P.validateDayPatch({ city: "x".repeat(61) }).message, "Keep each line, city and place under 60 letters.");
  assert.equal(P.validateDayPatch({ title: "x".repeat(81) }).message, "Keep the title under 80 letters.");
  assert.equal(P.validateDayPatch({ title: "x".repeat(80) }).ok, true);
  assert.deepEqual(P.validateDayPatch({ lineColour: "" }).value, { lineColour: "" });
});
test("day rows, labels and links", () => {
  const d = { date: "2026-12-12", city: "Tokyo", title: "", lineJp: "山手線", lineEn: "Yamanote", lineColour: "#9ACD32", fromJp: "", fromEn: "", toJp: "", toEn: "", lat: "", lng: "", tz: "", kind: "" };
  assert.deepEqual(P.dayFromRow(P.dayToRow(d)), d);
  assert.equal(P.dayFromRow({ date: "2026-12-12", line_colour: "not a colour" }).lineColour, "");
  assert.equal(P.dayLabel("2026-12-12"), "Sat Dec 12");
  assert.equal(P.safeUrl("  https://a.test/x "), "https://a.test/x");
  assert.equal(P.safeUrl("javascript:alert(1)"), "");
  assert.equal(P.safeUrl("https://a b"), "");
  assert.equal(P.safeUrl("https://a.test/" + "x".repeat(500)), "");
  assert.equal(P.safeUrl(5), "");
});

// ---------- payments from the planner sheet (Task 12, R39) ----------
// Every value here is made up: ids, vendors, refs and amounts.

const PLAN_HEAD = ["payment_id", "date_paid", "payer", "description", "category", "vendor", "booking_ref", "amount", "currency", "amount_cad", "cad_is_exact", "split_between", "split_type", "status", "include_in_split", "source", "added_by", "notes"];
// One planner row from named fields; the rest blank.
const planRow = (o, head = PLAN_HEAD) => head.map((h) => (o[h] === undefined ? "" : o[h]));
const X7 = { payment_id: "X7", date_paid: "2026-12-11", payer: "Mo", description: "Rail pass", category: "transport", vendor: "North Rail", booking_ref: "AB12", amount: 24750, currency: "JPY", amount_cad: 221.52, cad_is_exact: "yes", split_between: "Mo, Ajen, Trenton", split_type: "equal", include_in_split: "yes" };
const X9 = { payment_id: "X9", date_paid: "2026-11-02", payer: "Ajen", description: "Flight north", category: "flight", vendor: "Sky Air", booking_ref: "ZZ9", amount: 31500, currency: "JPY", amount_cad: 274.05, cad_is_exact: "no — est.", split_between: "Mo,Ajen,Trenton", split_type: "equal", include_in_split: "yes" };
const PLAN_DATES = ["2026-12-10", "2026-12-11", "2026-12-12", "2026-12-13"];
const payOf = (o) => {
  const r = P.paymentsFromRows([PLAN_HEAD, planRow(o)]);
  assert.equal(r.payments.length, 1, JSON.stringify(r.problems));
  return r.payments[0];
};
const convert = (o) => P.expenseFromPayment(payOf({ ...X7, ...o }), NAMES, PLAN_DATES);

test("paymentsFromRows reads each payment by column name, trimmed, numbers as numbers", () => {
  const r = P.paymentsFromRows([PLAN_HEAD, planRow({ ...X7, payer: "  Mo ", vendor: " North Rail ", notes: "x" })]);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.payments, [{
    id: "X7", row: 2, datePaid: "2026-12-11", payer: "Mo", description: "Rail pass", category: "transport", vendor: "North Rail", bookingRef: "AB12",
    amount: 24750, currency: "JPY", amountCad: 221.52, cadExact: "yes", splitBetween: ["Mo", "Ajen", "Trenton"], splitType: "equal", include: true,
  }]);
});

test("paymentsFromRows: row is the sheet's own row number (first data row 2, a blank row still counts); a problem carries row and what", () => {
  const long = "Ryokan deposit for the   whole\nfamily stay in the mountains near the lake";
  const r = P.paymentsFromRows([
    PLAN_HEAD,
    planRow(X7),
    [],
    planRow({ ...X9, payment_id: "bad id", description: "  Flight   north " }),
    planRow({ ...X7, description: long }),
    planRow({ ...X9, payment_id: "X9", description: "" }),
    planRow({ ...X9, payment_id: "X9", description: "Again" }),
  ]);
  assert.deepEqual(r.payments.map((p) => [p.id, p.row]), [["X7", 2], ["X9", 6]]);
  assert.deepEqual(r.problems, [
    { id: "", message: "That payment’s id isn’t usable.", row: 4, what: "Flight north" },
    { id: "X7", message: "That payment id is in the planner twice.", row: 5, what: "Ryokan deposit for the whole family stay in the mountains…" },
    { id: "X9", message: "That payment id is in the planner twice.", row: 7, what: "Again" },
  ]);
  assert.ok(r.problems[1].what.length <= 60);
});

test("paymentsFromRows finds columns in any order", () => {
  const head = PLAN_HEAD.slice().reverse();
  const r = P.paymentsFromRows([head, planRow(X7, head)]);
  assert.deepEqual(r.problems, []);
  assert.equal(r.payments[0].id, "X7");
  assert.equal(r.payments[0].amountCad, 221.52);
  assert.deepEqual(r.payments[0].splitBetween, ["Mo", "Ajen", "Trenton"]);
});

test("paymentsFromRows: a missing column gives one problem and no payments", () => {
  for (const name of ["payment_id", "payer", "description", "amount", "currency", "amount_cad", "split_between", "split_type", "include_in_split"]) {
    const head = PLAN_HEAD.filter((h) => h !== name);
    assert.deepEqual(P.paymentsFromRows([head, planRow(X7, head)]), { payments: [], problems: [], missing: "The planner’s Payments tab is missing the column " + name + ".", capped: false }, name);
  }
  // The others are optional.
  const head = PLAN_HEAD.filter((h) => !["date_paid", "category", "vendor", "booking_ref", "cad_is_exact", "status", "source", "added_by", "notes"].includes(h));
  const r = P.paymentsFromRows([head, planRow(X7, head)]);
  assert.deepEqual(r.problems, []);
  assert.deepEqual([r.payments[0].vendor, r.payments[0].datePaid, r.payments[0].cadExact], ["", "", ""]);
  assert.equal(r.missing, null);
  // R40 fix 6: an empty tab (or none, which the backend reads as no rows) has nothing to read.
  assert.deepEqual(P.paymentsFromRows([]), { payments: [], problems: [], missing: "The planner has no Payments tab to read.", capped: false });
  assert.equal(P.paymentsFromRows(null).missing, "The planner has no Payments tab to read.");
});

test("paymentsFromRows reads numbers given as text, and NaN when it can't", () => {
  const p = payOf({ ...X7, amount: "¥24,750", amount_cad: "CA$1,234.50" });
  assert.deepEqual([p.amount, p.amountCad], [24750, 1234.5]);
  assert.equal(payOf({ ...X7, amount_cad: " $ 12.30 " }).amountCad, 12.3);
  assert.equal(payOf({ ...X7, amount_cad: "" }).amountCad, null, "blank is not unreadable");
  assert.equal(payOf({ ...X7, amount_cad: "TBD" }).amountCad, NaN);
  assert.equal(payOf({ ...X7, amount: "about 5" }).amount, NaN);
});

test("paymentsFromRows: include_in_split is yes, trimmed, in any case", () => {
  assert.equal(payOf({ ...X7, include_in_split: "Yes" }).include, true);
  assert.equal(payOf({ ...X7, include_in_split: " yes " }).include, true);
  assert.equal(payOf({ ...X7, include_in_split: "no (until charged)" }).include, false);
  assert.equal(payOf({ ...X7, include_in_split: "" }).include, false);
  // Fix 11: a checkbox column.
  assert.equal(payOf({ ...X7, include_in_split: true }).include, true);
  assert.equal(payOf({ ...X7, include_in_split: "TRUE" }).include, true);
  assert.equal(payOf({ ...X7, include_in_split: false }).include, false);
  assert.equal(payOf({ ...X7, include_in_split: "FALSE" }).include, false);
});

test("paymentsFromRows skips blank rows, leaves out unusable and repeated ids, and reads 300 at most", () => {
  const r = P.paymentsFromRows([
    PLAN_HEAD, [], planRow({}), ["", " ", null],
    planRow(X7), planRow({ ...X7, payment_id: "" }), planRow({ ...X7, payment_id: "has space" }), planRow({ ...X7, payment_id: "-dash" }),
    planRow({ ...X7, payment_id: "x".repeat(21) }), planRow({ ...X7, description: "again" }), planRow(X9),
  ]);
  assert.deepEqual(r.payments.map((p) => p.id), ["X7", "X9"]);
  assert.equal(r.payments[0].description, "Rail pass", "the first of a repeated id is kept");
  assert.deepEqual(r.problems, [
    { id: "", message: "That payment’s id isn’t usable.", row: 6, what: "Rail pass" },
    { id: "", message: "That payment’s id isn’t usable.", row: 7, what: "Rail pass" },
    { id: "", message: "That payment’s id isn’t usable.", row: 8, what: "Rail pass" },
    { id: "", message: "That payment’s id isn’t usable.", row: 9, what: "Rail pass" },
    { id: "X7", message: "That payment id is in the planner twice.", row: 10, what: "again" },
  ]);
  assert.equal(payOf({ ...X7, payment_id: "A_b-9" }).id, "A_b-9");
  assert.equal(payOf({ ...X7, payment_id: "P005" }).id, "P005");
  // Fix 7: an id holds a letter and a digit.
  for (const id of ["Taxi", "42", 42, "abc_def", "3"]) {
    assert.deepEqual(P.paymentsFromRows([PLAN_HEAD, planRow({ ...X7, payment_id: id })]).problems, [{ id: "", message: "That payment’s id isn’t usable.", row: 2, what: "Rail pass" }], String(id));
  }

  const many = [PLAN_HEAD];
  for (let i = 0; i < 301; i++) many.push(planRow({ ...X7, payment_id: "P" + i }), []);
  const capped = P.paymentsFromRows(many);
  assert.equal(capped.payments.length, 300);
  assert.equal(capped.payments[299].id, "P299");
  assert.deepEqual(capped.problems, [], "the cap is not a row that couldn’t be read");
  assert.equal(capped.capped, true);
  many.pop();
  many.pop();
  assert.equal(P.paymentsFromRows(many).capped, false);
});

test("expenseFromPayment: the two note examples, word for word", () => {
  const a = P.expenseFromPayment(payOf(X7), NAMES, PLAN_DATES);
  assert.deepEqual(a, { ok: true, value: { title: "Rail pass", amount: 221.52, currency: "CAD", paidBy: "Mo", split: ["Mo", "Ajen", "Trenton"], day: "2026-12-11", kind: "transport", note: "X7 · North Rail · ref AB12 · ¥24,750 charged" } });
  const b = P.expenseFromPayment(payOf(X9), NAMES, PLAN_DATES);
  assert.equal(b.value.note, "X9 · Sky Air · ref ZZ9 · ¥31,500 charged · CAD amount is an estimate");
  assert.deepEqual([b.value.amount, b.value.currency, b.value.day, b.value.kind, b.value.paidBy], [274.05, "CAD", "pre", "transport", "Ajen"]);
});

test("expenseFromPayment: only equal splits, only the trip's people, in their own spelling", () => {
  assert.deepEqual(convert({ split_type: "personal" }), { ok: false, message: "Only payments split equally can be brought in." });
  assert.deepEqual(convert({ split_type: "" }), { ok: false, message: "Only payments split equally can be brought in." });
  assert.equal(convert({ split_type: " Equal " }).ok, true);
  // Fix 4: no cell text in a message.
  assert.deepEqual(convert({ payer: "Nadia" }), { ok: false, message: "The payer isn’t one of the people on this trip." });
  assert.deepEqual(convert({ split_between: "Mo, Nadia" }), { ok: false, message: "Someone in the split isn’t one of the people on this trip." });
  assert.deepEqual(convert({ split_between: " , " }), { ok: false, message: "That payment has nobody to split it between." });
  assert.deepEqual(convert({ payer: "" }), { ok: false, message: "The payer isn’t one of the people on this trip." });
  const v = convert({ payer: " ajen ", split_between: "MO,trenton " }).value;
  assert.deepEqual([v.paidBy, v.split], ["Ajen", ["Mo", "Trenton"]]);
});

test("expenseFromPayment: the amount is amount_cad when there is one, else yen or dollars as charged", () => {
  assert.deepEqual([convert({ amount_cad: 10.005 }).value.amount, convert({ amount_cad: 10.005 }).value.currency], [10.01, "CAD"]);
  const yen = convert({ amount_cad: "", amount: 4200.6 }).value;
  assert.deepEqual([yen.amount, yen.currency, yen.note], [4201, "JPY", "X7 · North Rail · ref AB12"]);
  const cad = convert({ amount_cad: 0, amount: 12.345, currency: " cad " }).value;
  assert.deepEqual([cad.amount, cad.currency], [12.35, "CAD"]);
  // Fix 8: a CAD amount that is there but can't be read is not passed over for the yen.
  assert.deepEqual(convert({ amount_cad: "TBD" }), { ok: false, message: "That payment’s CAD amount can’t be read." });
  assert.equal(convert({ amount_cad: "", amount: 500 }).value.currency, "JPY");
  assert.equal(convert({ amount_cad: "", amount: "" }).ok, false);
  for (const o of [{ amount_cad: "", currency: "USD", amount: 30 }, { amount_cad: -5, amount: 0 }, { amount_cad: "", amount: "" }]) {
    assert.deepEqual(convert(o), { ok: false, message: "That payment has no usable amount." }, JSON.stringify(o));
  }
});

test("expenseFromPayment: the title is the description, whitespace collapsed, at most 80 letters", () => {
  assert.equal(convert({ description: "  Rail \n pass   north " }).value.title, "Rail pass north");
  assert.deepEqual(convert({ description: "  " }), { ok: false, message: "That payment has no description." });
  const long = convert({ description: "word ".repeat(30) }).value.title;
  assert.ok(long.length <= 80, long.length);
  assert.equal(long, "word ".repeat(16).trim() + "…", "the 79th letter ends a whole word: it stays");
  assert.equal(convert({ description: "abc ".repeat(19) + "abcdefgh more" }).value.title, "abc ".repeat(19).trim() + "…", "a part-word at the cut is dropped");
  assert.equal(convert({ description: "x".repeat(100) }).value.title, "x".repeat(79) + "…");
  assert.equal(convert({ description: "y".repeat(80) }).value.title, "y".repeat(80));
});

test("expenseFromPayment: the day, the kind and the note's other parts", () => {
  assert.equal(convert({ date_paid: "2026-12-13" }).value.day, "2026-12-13");
  for (const d of ["", "soon", "2026-11-30", "12/11/2026"]) assert.equal(convert({ date_paid: d }).value.day, "pre", d);
  assert.equal(convert({ date_paid: "2026-12-25" }).value.day, "2026-12-13");
  const kinds = { lodging: "stay", Transport: "transport", flight: "transport", food: "food", shopping: "shopping", tickets: "activity", "": "activity" };
  for (const [c, k] of Object.entries(kinds)) assert.equal(convert({ category: c }).value.kind, k, c);
  assert.equal(convert({ vendor: "", booking_ref: "" }).value.note, "X7 · ¥24,750 charged");
  assert.equal(convert({ currency: "USD", amount: 45.5 }).value.note, "X7 · North Rail · ref AB12 · 45.5 USD");
  assert.equal(convert({ currency: "CAD", amount: 221.52 }).value.note, "X7 · North Rail · ref AB12");
  assert.equal(convert({ cad_is_exact: "" }).value.note, "X7 · North Rail · ref AB12 · ¥24,750 charged · CAD amount is an estimate");
  assert.equal(convert({ cad_is_exact: "Yes, from the statement" }).value.note, "X7 · North Rail · ref AB12 · ¥24,750 charged");
  const long = convert({ vendor: "Vendor ".repeat(40) }).value.note;
  assert.ok(long.length <= 200, long.length);
  assert.match(long, /^X7 · Vendor Vendor .*Vendor…$/);
});

test("paymentIdOf: the note's first part when it is an id", () => {
  assert.equal(P.paymentIdOf("X7 · North Rail · ref AB12 · ¥24,750 charged"), "X7");
  assert.equal(P.paymentIdOf("X7"), "X7");
  assert.equal(P.paymentIdOf("ref NK-4471"), null);
  assert.equal(P.paymentIdOf(""), null);
  assert.equal(P.paymentIdOf("Dinner at 8 · tip"), null);
  // Fix 7: plain words and plain numbers are not ids.
  assert.equal(P.paymentIdOf("dinner · tip"), null);
  assert.equal(P.paymentIdOf("Taxi"), null);
  assert.equal(P.paymentIdOf("3 · shared"), null);
  assert.equal(P.paymentIdOf("P005 · North Rail"), "P005");
  assert.equal(P.paymentIdOf(undefined), null);
  assert.equal(P.paymentIdOf("x".repeat(21) + " · a"), null);
});

// ---------- the stamp book: when a stamp is open ----------

const SDEFS = [{ id: "d1", date: "2030-01-05" }, { id: "d2", date: "2030-01-06" }, { id: "iss", date: "" }];
const [SD1, , SISS] = SDEFS;

test("stampWindow: a day stamp is open 27 hours from 00:00 Japan time; the issue stamp until the last day closes", () => {
  assert.deepEqual(P.stampWindow(SD1, SDEFS), { opens: Date.UTC(2030, 0, 4, 15), closes: Date.UTC(2030, 0, 5, 18) });
  assert.deepEqual(P.stampWindow(SISS, SDEFS), { opens: 0, closes: Date.UTC(2030, 0, 6, 18) });
  // no day stamps at all: the issue stamp does not close
  assert.equal(P.stampWindow(SISS, [SISS]).closes, Infinity);
  // a date that is not a day is never open
  const bad = P.stampWindow({ id: "x", date: "someday" }, SDEFS);
  assert.ok(bad.opens > bad.closes);
});

test("pressRefusal: the window edges, in Japan time", () => {
  const at = (h, m = 0, s = 0, day = 5) => Date.UTC(2030, 0, day, h, m, s);
  const same = (ms) => P.pressRefusal(SD1, SDEFS, ms, ms);
  assert.equal(same(at(17, 59, 59)), "");
  assert.equal(same(at(18)), "closed");
  assert.equal(same(Date.UTC(2030, 0, 4, 14, 59, 59)), "not_open");
  assert.equal(same(Date.UTC(2030, 0, 4, 15)), "");
});

test("pressRefusal: late after 48 hours, future past 5 minutes", () => {
  const at = Date.UTC(2030, 0, 5, 10);
  assert.equal(P.pressRefusal(SD1, SDEFS, at, Date.UTC(2030, 0, 7, 10, 0, 1)), "late");
  assert.equal(P.pressRefusal(SD1, SDEFS, at, Date.UTC(2030, 0, 7, 10)), "");
  assert.equal(P.pressRefusal(SD1, SDEFS, at + 6 * 60000, at), "future");
  assert.equal(P.pressRefusal(SD1, SDEFS, at + 5 * 60000, at), "");
  assert.equal(P.pressRefusal(SD1, SDEFS, NaN, at), "future");
});

test("pressRefusal: the issue stamp is open from the start until the last day closes", () => {
  assert.equal(P.pressRefusal(SISS, SDEFS, Date.UTC(2029, 5, 1), Date.UTC(2029, 5, 1)), "");
  assert.equal(P.pressRefusal(SISS, SDEFS, Date.UTC(2030, 0, 6, 17, 59), Date.UTC(2030, 0, 6, 17, 59)), "");
  assert.equal(P.pressRefusal(SISS, SDEFS, Date.UTC(2030, 0, 6, 18), Date.UTC(2030, 0, 6, 18)), "closed");
});

test("stamp rows and the History sentence", () => {
  assert.deepEqual(P.stampFromRow({ id: "d1|Mo", def: "d1", who: "Mo", at: "2030-01-05T01:00:00.000Z", seed: 7, gone: "" }), { def: "d1", who: "Mo", at: "2030-01-05T01:00:00.000Z", seed: 7 });
  assert.equal(P.stampFromRow({ def: "d1", who: "Mo", at: "", seed: 7, gone: "yes" }).gone, true);
  assert.equal(P.summarize("press", "stamp", null, { day: "2030-01-05" }), "stamped Jan 5");
  assert.equal(P.summarize("press", "stamp", null, { day: "" }), "stamped the book");
});

test("wave A 9: a stay's photo link over 500 letters says it is too long, not that it isn't https", () => {
  const stay = { id: "stayMadeUp0001", name: "Made-up inn", firstNight: "2026-12-10", lastNight: "2026-12-11" };
  const long = "https://photos.example.test/" + "a".repeat(480);
  assert.ok(long.length > 500);
  assert.equal(P.validateStay({ ...stay, photo: long }).message, "That picture link is too long.");
  assert.equal(P.validateStay({ ...stay, photo: "  " + long.slice(0, 498) + "  " }).ok, true, "500 letters once trimmed is fine");
  assert.equal(P.validateStay({ ...stay, photo: "http://photos.example.test/a.jpg" }).message, "That photo link has to start with https://.");
});

test("I3: the backend's pointFromLink never reads a directions link, and the map's centre only from a place or search link", () => {
  const dir = "https://www.google.com/maps/dir/35.0036,135.7787/Kyoto+Station/@35.0,135.76,14z/data=!3d34.9858!4d135.7588";
  assert.equal(P.pointFromLink(dir), null);
  assert.equal(P.pointFromLink("https://www.google.com/maps/@34.9858,135.7588,15z"), null);
  assert.deepEqual(P.pointFromLink("https://www.google.com/maps/place/Kyoto+Station/@34.9858,135.7588,15z"), { lat: "34.9858", lng: "135.7588" });
  assert.deepEqual(P.pointFromLink("https://www.google.com/maps/search/ramen/@34.9858,135.7588,15z"), { lat: "34.9858", lng: "135.7588" });
  assert.deepEqual(P.pointFromLink("https://www.google.com/maps/place/x/@1,2,3z/data=!3d35.5!4d139.5"), { lat: "35.5", lng: "139.5" });
  assert.deepEqual(P.pointFromLink("https://www.google.com/maps/@1,2,3z/data=!3d35.5!4d139.5"), { lat: "35.5", lng: "139.5" });
});

test("Days.tz and Days.kind: read from the Sheet, never written by an action", () => {
  assert.deepEqual(P.TABS.Days.slice(-2), ["tz", "kind"], "at the end, after lat and lng");
  const tz = (v) => P.dayFromRow({ date: "2026-12-09", tz: v }).tz;
  assert.equal(tz("America/New_York"), "America/New_York");
  assert.equal(tz(" America/New_York "), "America/New_York");
  assert.equal(tz("America/Argentina/Buenos_Aires"), "America/Argentina/Buenos_Aires");
  assert.equal(tz("Etc/GMT+5"), "Etc/GMT+5");
  for (const bad of ["", undefined, null, "UTC", "America", "America/New York", "America/a/b/c", "=IMPORTXML(1)", "<b>x</b>/y", "/Tokyo", 5, "A/" + "b".repeat(39)]) assert.equal(tz(bad), "", String(bad));
  assert.equal(tz("A/" + "b".repeat(38)), "A/" + "b".repeat(38), "40 letters");
  const kind = (v) => P.dayFromRow({ date: "2026-12-08", kind: v }).kind;
  assert.equal(kind("eve"), "eve");
  assert.equal(kind(" Eve "), "eve");
  for (const other of ["", undefined, "evening", "day", 1]) assert.equal(kind(other), "", String(other));
  const day = P.dayFromRow({ date: "2026-12-09", city: "Lakeport", tz: "America/New_York", kind: "eve" });
  const row = P.dayToRow(day);
  assert.equal("tz" in row, false, "dayToRow leaves tz out");
  assert.equal("kind" in row, false, "dayToRow leaves kind out");
  assert.equal(P.DAY_PATCH_KEYS.includes("tz") || P.DAY_PATCH_KEYS.includes("kind"), false);
  assert.equal(P.validateDayPatch({ tz: "America/New_York" }).message, "Only a day’s city, title, line and places can be changed.");
  assert.equal(P.validateDayPatch({ kind: "eve" }).message, "Only a day’s city, title, line and places can be changed.");
});
