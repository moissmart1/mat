const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../backend/Pure.js");
const taxi = { id: "e1", title: "Taxi back", amount: 3600, currency: "JPY", paidBy: "Ajen", split: ["Ajen", "Trenton"], day: "2026-12-11", note: "", deleted: false };
const stamp = { id: "p1", from: "Ajen", to: "Mo", cad: 250, removed: false };

test("every kind of change reads as one plain sentence", () => {
  assert.equal(P.summarize("add", "expense", null, taxi), "rang up Taxi back ¥3,600");
  assert.equal(P.summarize("add", "expense", null, { ...taxi, amount: 12.5, currency: "CAD" }), "rang up Taxi back $12.50");
  assert.equal(P.summarize("edit", "expense", { ...taxi, amount: 13500 }, { ...taxi, amount: 14500 }), "changed Taxi back ¥13,500 → ¥14,500");
  assert.equal(P.summarize("edit", "expense", taxi, { ...taxi, title: "Taxi home" }), "renamed Taxi back to Taxi home");
  assert.equal(P.summarize("edit", "expense", taxi, { ...taxi, paidBy: "Mo", note: "late" }), "changed Taxi back: payer, note");
  assert.equal(P.summarize("edit", "expense", taxi, { ...taxi, split: ["Ajen"], day: "2026-12-12" }), "changed Taxi back: split, day");
  assert.equal(P.summarize("delete", "expense", taxi, { ...taxi, deleted: true }), "deleted Taxi back ¥3,600");
  assert.equal(P.summarize("restore", "expense", { ...taxi, deleted: true }, taxi), "brought back Taxi back ¥3,600");
  assert.equal(P.summarize("stamp", "payment", null, stamp), "stamped Ajen → Mo $250.00");
  assert.equal(P.summarize("unstamp", "payment", stamp, { ...stamp, removed: true }), "removed the stamp Ajen → Mo $250.00");
  assert.equal(P.summarize("restamp", "payment", { ...stamp, removed: true }, stamp), "put back the stamp Ajen → Mo $250.00");
});

test("edit sentences: kind-only, money precedence, currency change, thousands", () => {
  assert.equal(P.summarize("edit", "expense", taxi, { ...taxi, kind: "transport" }), "changed Taxi back");
  assert.equal(P.summarize("edit", "expense", taxi, { ...taxi, amount: 4000, title: "Taxi home", note: "x" }), "changed Taxi home ¥3,600 → ¥4,000");
  assert.equal(P.summarize("edit", "expense", taxi, { ...taxi, amount: 25, currency: "CAD" }), "changed Taxi back ¥3,600 → $25.00");
  assert.equal(P.summarize("edit", "expense", { ...taxi, amount: 25, currency: "CAD" }, { ...taxi, amount: 1250, currency: "CAD" }), "changed Taxi back $25.00 → $1,250.00");
  assert.equal(P.summarize("add", "expense", null, { ...taxi, amount: 1250, currency: "CAD" }), "rang up Taxi back $1,250.00");
  assert.equal(P.summarize("edit", "expense", taxi, { ...taxi, splitMode: "parts", splitVals: [1, 2] }), "changed Taxi back: split");
});

test("undoing puts the item back to how it was before that change", () => {
  assert.deepEqual(P.undoTarget({ kind: "expense", before: null, after: taxi }), { ...taxi, deleted: true });
  assert.deepEqual(P.undoTarget({ kind: "expense", before: { ...taxi, amount: 13500 }, after: taxi }), { ...taxi, amount: 13500 });
  assert.deepEqual(P.undoTarget({ kind: "expense", before: taxi, after: { ...taxi, deleted: true } }), taxi);
  assert.deepEqual(P.undoTarget({ kind: "payment", before: null, after: stamp }), { ...stamp, removed: true });
});

test("undoTarget returns a fresh object and never touches the entry", () => {
  const before = { ...taxi, split: ["Ajen", "Trenton"] };
  const after = { ...taxi, split: ["Ajen"] };
  const entry = { kind: "expense", before, after };
  const t1 = P.undoTarget(entry);
  assert.notEqual(t1, before);
  t1.title = "changed";
  t1.split.push("Mo");
  assert.equal(before.title, "Taxi back");
  assert.deepEqual(before.split, ["Ajen", "Trenton"]);
  const e2 = { kind: "expense", before: null, after };
  const t2 = P.undoTarget(e2);
  assert.notEqual(t2, after);
  assert.equal(after.deleted, false);
  assert.equal(t2.deleted, true);
  t2.split.push("Mo");
  assert.deepEqual(after.split, ["Ajen"]);
});

test("only the newest change to an item can be undone, and only once", () => {
  const log = [
    { id: 1, kind: "expense", ref: "e1", undoneBy: null },
    { id: 2, kind: "expense", ref: "e2", undoneBy: null },
    { id: 3, kind: "expense", ref: "e1", undoneBy: null },
    { id: 4, kind: "payment", ref: "e1", undoneBy: null },
    { id: 5, kind: "expense", ref: "e9", undoneBy: 6 },
    { id: 6, kind: "expense", ref: "e9", undoneBy: null },
  ];
  assert.equal(P.canUndo(log[0], log), false);
  assert.equal(P.canUndo(log[1], log), true);
  assert.equal(P.canUndo(log[2], log), true);
  assert.equal(P.canUndo(log[3], log), true);
  assert.equal(P.canUndo(log[4], log), false);
  assert.equal(P.canUndo(log[5], log), true);
});

test("a raw Log row becomes the API entry, with no snapshots", () => {
  const raw = (o) => ({ id: "", at: "", who: "", via: "", action: "", kind: "", ref: "", summary: "", before: "", after: "", undoes: "", undone_by: "", ...o });
  const rows = [
    raw({ id: "1", at: "2026-12-11T01:00:00.000Z", who: "Ajen", via: "claude", action: "add", kind: "expense", ref: "e1", summary: "rang up Taxi back ¥3,600", after: JSON.stringify(taxi) }),
    raw({ id: 2, at: "2026-12-11T02:00:00.000Z", who: "Mo", via: "", action: "edit", kind: "expense", ref: "e1", summary: "x", before: JSON.stringify(taxi), after: JSON.stringify({ ...taxi, note: "n" }), undoes: "", undone_by: "" }),
    raw({ id: 3, who: "Mo", via: "web", action: "add", kind: "payment", ref: "p1", undoes: "2", undone_by: 4 }),
    raw({ id: "4", kind: "payment", ref: "p1" }),
  ];
  const e1 = P.entryFromRow(rows[0], rows);
  assert.deepEqual(e1, { id: 1, at: "2026-12-11T01:00:00.000Z", who: "Ajen", via: "claude", action: "add", kind: "expense", ref: "e1", summary: "rang up Taxi back ¥3,600", undoes: null, undoneBy: null, canUndo: false });
  assert.equal("before" in e1, false);
  assert.equal("after" in e1, false);
  const e2 = P.entryFromRow(rows[1], rows);
  assert.equal(e2.id, 2);
  assert.equal(e2.via, "app");
  assert.equal(e2.canUndo, true);
  const e3 = P.entryFromRow(rows[2], rows);
  assert.equal(e3.via, "app");
  assert.equal(e3.undoes, 2);
  assert.equal(e3.undoneBy, 4);
  assert.equal(e3.canUndo, false);
  assert.equal(P.entryFromRow(rows[3], rows).canUndo, true);
});

test("parseLogRow adds parsed snapshots, null when the cell is empty", () => {
  const row = { id: "7", at: "t", who: "Mo", via: "", action: "edit", kind: "expense", ref: "e1", summary: "s", before: JSON.stringify(taxi), after: "", undoes: "", undone_by: "" };
  const p = P.parseLogRow(row);
  assert.equal(p.id, 7);
  assert.deepEqual(p.before, taxi);
  assert.equal(p.after, null);
  assert.equal(p.undoneBy, null);
  assert.equal(P.parseLogRow({ ...row, before: "", after: JSON.stringify(taxi) }).before, null);
  assert.deepEqual(P.undoTarget(P.parseLogRow({ ...row, before: "", after: JSON.stringify(taxi) })), { ...taxi, deleted: true });
});

test("log ids compare as numbers even when the sheet hands them back as text", () => {
  const log = [
    { id: "9", kind: "expense", ref: "e1", undoneBy: null },
    { id: "10", kind: "expense", ref: "e1", undoneBy: null },
  ];
  assert.equal(P.canUndo(log[0], log), false);
  assert.equal(P.canUndo(log[1], log), true);
});

test("a person's e-Transfer change reads as a sentence without the address, and is never undoable (F9)", () => {
  assert.equal(P.summarize("edit", "person", { name: "Ajen", etransfer: "" }, { name: "Ajen", etransfer: "a@example.com" }), "changed Ajen’s e-Transfer address");
  const entry = { id: 3, kind: "person", ref: "Ajen", undoneBy: null };
  assert.equal(P.canUndo(entry, [entry]), false);
});

test("a picture change reads as a sentence with no pronoun and no picture in it, and can be undone (Task 16)", () => {
  const pic = "data:image/jpeg;base64,AAAA";
  const pic2 = "data:image/jpeg;base64,BBBB";
  assert.equal(P.summarize("edit", "picture", { name: "Mo", photo: "" }, { name: "Mo", photo: pic }), "set a picture");
  assert.equal(P.summarize("edit", "picture", { name: "Mo", photo: pic }, { name: "Mo", photo: pic2 }), "changed the picture");
  assert.equal(P.summarize("edit", "picture", { name: "Mo", photo: pic }, { name: "Mo", photo: "" }), "removed the picture");
  for (const [before, after] of [["", pic], [pic, pic2], [pic, ""]]) {
    const entry = { id: 4, kind: "picture", ref: "Mo", before: { name: "Mo", photo: before }, after: { name: "Mo", photo: after }, undoneBy: null };
    assert.deepEqual(P.undoTarget(entry), { name: "Mo", photo: before }, "undo puts back what was there");
    assert.equal(P.canUndo(entry, [entry]), true);
    assert.equal(P.canUndo(entry, [entry, { id: 5, kind: "picture", ref: "Mo" }]), false, "a newer picture change comes first");
    assert.equal(P.canUndo(entry, [entry, { id: 5, kind: "person", ref: "Mo" }, { id: 6, kind: "picture", ref: "Ajen" }]), true, "an e-Transfer change or another person's picture does not block it");
  }
});

const A = { id: "s1", date: "2026-12-12", time: "14:00", title: "Shibuya Sky", detail: "", gettingThere: "", travelMin: 0, fixed: false, place: "", signJp: "", booked: false, link: "", photo: "", note: "", deleted: false };
test("stop sentences", () => {
  assert.equal(P.summarize("add", "stop", null, A), "added Shibuya Sky to Sat Dec 12");
  assert.equal(P.summarize("delete", "stop", A, { ...A, deleted: true }), "removed Shibuya Sky from Sat Dec 12");
  assert.equal(P.summarize("restore", "stop", { ...A, deleted: true }, A), "put back Shibuya Sky on Sat Dec 12");
  assert.equal(P.summarize("edit", "stop", A, { ...A, title: "Sky deck" }), "renamed Shibuya Sky to Sky deck");
  assert.equal(P.summarize("edit", "stop", A, { ...A, time: "15:30" }), "moved Shibuya Sky to Sat Dec 12 15:30");
  assert.equal(P.summarize("edit", "stop", A, { ...A, date: "2026-12-13", time: "" }), "moved Shibuya Sky to Sun Dec 13");
  assert.equal(P.summarize("edit", "stop", A, { ...A, gettingThere: "Walk", travelMin: 5, link: "https://x.test" }), "changed Shibuya Sky: directions, travel time, link");
  // The Japanese for a taxi driver (#95), in History's own words; the words themselves never go in a sentence.
  assert.equal(P.summarize("edit", "stop", { ...A, nameJp: "", addressJp: "" }, { ...A, nameJp: "鳥花", addressJp: "架空県湖畔市1-2-3" }), "changed Shibuya Sky: Japanese name, Japanese address");
});
test("stay and day sentences", () => {
  const stay = { id: "y1", name: "Asakusa hotel" };
  assert.equal(P.summarize("add", "stay", null, stay), "added the stay Asakusa hotel");
  assert.equal(P.summarize("edit", "stay", stay, stay), "changed the stay Asakusa hotel");
  assert.equal(P.summarize("delete", "stay", stay, stay), "removed the stay Asakusa hotel");
  assert.equal(P.summarize("restore", "stay", stay, stay), "put back the stay Asakusa hotel");
  assert.equal(P.summarize("edit", "day", { date: "2026-12-12" }, { date: "2026-12-12" }), "changed the ticket for Sat Dec 12");
});
test("undo rules hold for the new kinds", () => {
  const add = { id: 5, kind: "stop", ref: "s1", before: null, after: A, undoneBy: null };
  assert.equal(P.undoTarget(add).deleted, true);
  assert.equal(P.canUndo(add, [add, { id: 6, kind: "stop", ref: "s1" }]), false);
  assert.equal(P.canUndo(add, [add, { id: 6, kind: "expense", ref: "s1" }]), true);
});
