const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { createFakeBackend } = require("./fake-backend.cjs");
const { TABS } = require("../backend/Pure.js");

const KEY = "test-key";
const ALL = ["Mo", "Ajen", "Trenton"];
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "seed.json"), "utf8"));

// A caller bound to one fake: call(action, args, extra) sends { key, actor: "Mo", action, args, ...extra }.
function client(seed, opts) {
  const fake = createFakeBackend(seed, opts);
  const call = (action, args = {}, extra = {}) => fake({ key: KEY, actor: "Mo", action, args, ...extra });
  call.fake = fake;
  return call;
}

function ramen(over = {}) {
  return { id: "exp0000001", day: "2026-12-10", title: "Ramen", amount: 4200, currency: "JPY", paidBy: "Mo", split: ALL.slice(), ...over };
}

function stampOf(over = {}) {
  return { id: "pay0000001", from: "Ajen", to: "Mo", cad: 25, seed: 3, rot: -2.5, ...over };
}

// A request on person `name`'s own link (a personal key, security 2026-11-18).
const ownKey = (call, name) => {
  call.keys = call.keys || {};
  if (!call.keys[name]) call.keys[name] = call.fake.personKey(name);
  return call.keys[name];
};
const asOwn = (call, name) => (action, args = {}) => call.fake({ key: ownKey(call, name), action, args });

async function historyAll(call, args = {}) {
  const r = await call("history", args);
  assert.equal(r.ok, true);
  return r.data.entries;
}

// ---------- the brief's contract tests ----------

test("load returns the trip, three people with Simplify on and no email, no expenses, the rate and eleven days", async () => {
  const call = client();
  const r = await call("load");
  assert.equal(r.ok, true);
  assert.equal(r.rev, 0);
  const d = r.data;
  assert.deepEqual(d.trip, { name: "Japan 2026", start: "2026-12-10", end: "2026-12-20", home: "CAD", currency: "JPY", tz: "Asia/Tokyo" });
  assert.equal(d.people.length, 3);
  assert.deepEqual(d.people.map((p) => p.name), ALL);
  for (const p of d.people) {
    assert.equal(p.simplify, true);
    assert.equal("email" in p, false);
  }
  assert.deepEqual(d.expenses, []);
  assert.deepEqual(d.payments, []);
  assert.deepEqual(d.stops, []);
  assert.deepEqual(d.stays, []);
  assert.equal(d.rateToday, 111);
  assert.equal(d.sheetUrl, "https://example.test/sheet");
  assert.equal(d.days.length, 11);
  assert.equal(d.days[0].date, "2026-12-10");
  assert.equal(d.days[10].date, "2026-12-20");
});

test("a wrong or missing key is refused with bad_key and no data", async () => {
  const fake = createFakeBackend();
  const bodies = [
    { key: "nope", actor: "Mo", action: "load", args: {} },
    { actor: "Mo", action: "load", args: {} },
    { key: "", actor: "Mo", action: "rev", args: {} },
    { key: "nope", actor: "Mo", action: "addExpense", args: { expense: ramen() } },
    { key: null, actor: "Mo", action: "history", args: {} },
  ];
  for (const body of bodies) {
    const r = await fake(body);
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.equal(r.error, "bad_key");
    assert.equal("data" in r, false);
    assert.equal(typeof r.message, "string");
  }
  assert.equal(fake.tables.Expenses.length, 0);
  assert.equal(fake.tables.Log.length, 0);
});

test("addExpense stamps the rate and the actor, is live, gets a numeric logId and bumps rev by one", async () => {
  const call = client(undefined, { clock: () => "2026-12-10T05:00:00.000Z" });
  const before = (await call("rev")).rev;
  const r = await call("addExpense", { expense: ramen() }, { actor: "Ajen" });
  assert.equal(r.ok, true);
  const e = r.data.expense;
  assert.equal(e.rate, 111);
  assert.equal(e.addedBy, "Ajen");
  assert.equal(e.addedAt, "2026-12-10T05:00:00.000Z");
  assert.equal(e.deleted, false);
  assert.equal(e.title, "Ramen");
  assert.equal(e.amount, 4200);
  assert.equal(e.paidBy, "Mo");
  assert.equal(typeof r.data.logId, "number");
  assert.equal(r.rev, before + 1);
});

test("addExpense twice with the same id records it once and answers the same both times", async () => {
  const call = client();
  const a = await call("addExpense", { expense: ramen() });
  const b = await call("addExpense", { expense: ramen() });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.deepEqual(b.data.expense, a.data.expense);
  assert.equal(b.data.logId, a.data.logId);
  assert.equal(a.rev, 1);
  assert.equal(b.rev, 1);
  assert.equal((await call("load")).data.expenses.length, 1);
  assert.equal((await historyAll(call)).length, 1);
});

test("addExpense with a zero amount is bad_input and changes nothing", async () => {
  const call = client();
  const r = await call("addExpense", { expense: ramen({ amount: 0 }) });
  assert.equal(r.ok, false);
  assert.equal(r.error, "bad_input");
  assert.equal(typeof r.message, "string");
  assert.ok(r.message.length > 0);
  assert.equal(r.rev, 0);
  assert.equal((await call("rev")).rev, 0);
  assert.equal((await historyAll(call)).length, 0);
});

test("updateExpense changing the amount keeps the original rate and logs an edit with the arrow form", async () => {
  const call = client({ expenses: [ramen({ rate: 98 })] });
  const r = await call("updateExpense", { id: "exp0000001", patch: { amount: 4500 } });
  assert.equal(r.ok, true);
  assert.equal(r.data.expense.amount, 4500);
  assert.equal(r.data.expense.rate, 98);
  assert.equal(typeof r.data.logId, "number");
  const [top] = await historyAll(call);
  assert.equal(top.action, "edit");
  assert.equal(top.summary, "changed Ramen ¥4,200 → ¥4,500");
  assert.equal(top.id, r.data.logId);
});

test("updateExpense to an exact split that does not add up is bad_input", async () => {
  const call = client({ expenses: [ramen()] });
  const r = await call("updateExpense", { id: "exp0000001", patch: { splitMode: "exact", splitVals: [2000, 1000, 1000] } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "bad_input");
  assert.equal((await historyAll(call)).length, 1);
});

test("deleteExpense then restoreExpense toggles deleted and logs both; an unknown id is not_found", async () => {
  const call = client({ expenses: [ramen()] });
  const d = await call("deleteExpense", { id: "exp0000001" });
  assert.equal(d.ok, true);
  assert.equal(d.data.expense.deleted, true);
  const r = await call("restoreExpense", { id: "exp0000001" });
  assert.equal(r.ok, true);
  assert.equal(r.data.expense.deleted, false);
  const actions = (await historyAll(call)).map((e) => e.action);
  assert.deepEqual(actions, ["restore", "delete", "add"]);
  for (const action of ["deleteExpense", "restoreExpense", "updateExpense"]) {
    const n = await call(action, { id: "nosuchline1", patch: { amount: 5 } });
    assert.equal(n.ok, false, action);
    assert.equal(n.error, "not_found");
    assert.equal(typeof n.message, "string");
  }
});

test("addPayment, removePayment, restorePayment toggle removed and log stamp, unstamp, restamp; a repeat add is recorded once", async () => {
  const call = client();
  const a = await call("addPayment", { payment: stampOf() }, { actor: "Ajen" });
  assert.equal(a.ok, true);
  assert.equal(a.data.payment.removed, false);
  assert.equal(a.data.payment.stampedBy, "Ajen");
  assert.equal(a.data.payment.seed, 3);
  assert.equal(a.data.payment.rot, -2.5);
  const again = await call("addPayment", { payment: stampOf() }, { actor: "Ajen" });
  assert.deepEqual(again.data, a.data);
  const rm = await call("removePayment", { id: "pay0000001" });
  assert.equal(rm.data.payment.removed, true);
  const back = await call("restorePayment", { id: "pay0000001" });
  assert.equal(back.data.payment.removed, false);
  const hist = await historyAll(call);
  assert.deepEqual(hist.map((e) => e.action), ["restamp", "unstamp", "stamp"]);
  assert.equal(hist[2].summary, "stamped Ajen → Mo $25.00");
  assert.equal((await call("load")).data.payments.length, 1);
  assert.equal((await call("removePayment", { id: "nosuchpay1" })).error, "not_found");
});

test("setPerson turns Simplify off for Trenton, load shows it, rev rises and history gains nothing", async () => {
  const call = client();
  const r = await call("setPerson", { name: "Trenton", patch: { simplify: false } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.person, { name: "Trenton", initials: "TR", etransfer: "", simplify: false, photo: "" });
  assert.equal(r.rev, 1);
  const load = await call("load");
  assert.equal(load.data.people.find((p) => p.name === "Trenton").simplify, false);
  assert.equal(load.rev, 1);
  assert.equal((await historyAll(call)).length, 0);
});

test("history is newest first, records via claude, filters by ref, and pages with limit and before", async () => {
  const call = client();
  await call("addExpense", { expense: ramen() });
  await call.fake.claude("addExpense", { expense: ramen({ id: "exp0000002", title: "Coffee", amount: 600 }) });
  await call("deleteExpense", { id: "exp0000001" });
  const all = await historyAll(call);
  assert.deepEqual(all.map((e) => e.id), [3, 2, 1]);
  assert.equal(all[1].via, "claude");
  assert.equal(all[0].via, "app");
  assert.equal(all[2].via, "app");
  const one = await historyAll(call, { ref: "exp0000001" });
  assert.deepEqual(one.map((e) => e.action), ["delete", "add"]);
  const page1 = await call("history", { limit: 2 });
  assert.equal(page1.data.entries.length, 2);
  assert.equal(page1.data.more, true);
  const older = page1.data.entries[1].id;
  const page2 = await call("history", { limit: 2, before: older });
  assert.deepEqual(page2.data.entries.map((e) => e.id), [1]);
  assert.equal(page2.data.more, false);
});

test("undo an add: the line is deleted, the undo is logged, and the original can no longer be undone", async () => {
  const call = client();
  const add = await call("addExpense", { expense: ramen() });
  const u = await call("undo", { logId: add.data.logId });
  assert.equal(u.ok, true);
  assert.equal(u.data.expense.deleted, true);
  assert.equal(u.data.entry.action, "undo");
  assert.equal(u.data.entry.undoes, add.data.logId);
  assert.ok(u.data.entry.summary.startsWith("undid: rang up"));
  assert.equal(u.data.logId, u.data.entry.id);
  assert.equal(u.rev, 2);
  const hist = await historyAll(call);
  const original = hist.find((e) => e.id === add.data.logId);
  const undoEntry = hist.find((e) => e.id === u.data.logId);
  assert.equal(original.undoneBy, u.data.logId);
  assert.equal(original.canUndo, false);
  assert.equal(undoEntry.canUndo, true);
});

test("undo the undo brings the line back", async () => {
  const call = client();
  const add = await call("addExpense", { expense: ramen() });
  const u1 = await call("undo", { logId: add.data.logId });
  const u2 = await call("undo", { logId: u1.data.logId });
  assert.equal(u2.ok, true);
  assert.equal(u2.data.expense.deleted, false);
  assert.equal((await call("load")).data.expenses[0].deleted, false);
});

test("undo an edit puts the amount back and keeps the rate, adder and time it was added", async () => {
  const added = { rate: 98, addedBy: "Trenton", addedAt: "2026-12-09T01:00:00.000Z" };
  const call = client({ expenses: [ramen(added)] }, { clock: () => "2026-12-10T05:00:00.000Z" });
  const ed = await call("updateExpense", { id: "exp0000001", patch: { amount: 4500 } }, { actor: "Ajen" });
  assert.equal(ed.data.expense.amount, 4500);
  const u = await call("undo", { logId: ed.data.logId }, { actor: "Ajen" });
  assert.equal(u.ok, true);
  for (const e of [u.data.expense, (await call("load")).data.expenses[0]]) {
    assert.equal(e.amount, 4200);
    assert.equal(e.rate, 98);
    assert.equal(e.addedBy, "Trenton");
    assert.equal(e.addedAt, "2026-12-09T01:00:00.000Z");
  }
});

test("a repeat add with the same id but different content returns the first line and records nothing", async () => {
  const call = client();
  const first = await call("addExpense", { expense: ramen() });
  const logLen = call.fake.tables.Log.length;
  const again = await call("addExpense", { expense: ramen({ title: "Different", amount: 999, paidBy: "Ajen" }) }, { actor: "Trenton" });
  assert.equal(again.ok, true);
  assert.deepEqual(again.data.expense, first.data.expense);
  assert.equal(again.data.expense.title, "Ramen");
  assert.equal(again.data.expense.addedBy, "Mo");
  assert.equal(again.data.logId, first.data.logId);
  assert.equal(again.rev, first.rev);
  assert.equal(call.fake.tables.Log.length, logLen);
  assert.equal(call.fake.tables.Expenses.length, 1);
});

test("undoing an edit to an exact split restores the equal split and payer, and undoing that brings the exact split back", async () => {
  const call = client({ expenses: [ramen()] });
  const ed = await call("updateExpense", { id: "exp0000001", patch: { splitMode: "exact", splitVals: [2000, 1200, 1000], paidBy: "Ajen" } });
  assert.equal(ed.ok, true);
  assert.equal(ed.data.expense.splitMode, "exact");
  const u1 = await call("undo", { logId: ed.data.logId });
  assert.equal(u1.ok, true);
  for (const e of [u1.data.expense, (await call("load")).data.expenses[0]]) {
    assert.equal(e.splitMode, "equal");
    assert.deepEqual(e.splitVals, []);
    assert.equal(e.paidBy, "Mo");
    assert.deepEqual(e.split, ALL);
  }
  const u2 = await call("undo", { logId: u1.data.logId });
  assert.equal(u2.ok, true);
  for (const e of [u2.data.expense, (await call("load")).data.expenses[0]]) {
    assert.equal(e.splitMode, "exact");
    assert.deepEqual(e.splitVals, [2000, 1200, 1000]);
    assert.equal(e.paidBy, "Ajen");
  }
});

test("undo a stamp removes the payment", async () => {
  const call = client();
  const a = await call("addPayment", { payment: stampOf() });
  const u = await call("undo", { logId: a.data.logId });
  assert.equal(u.ok, true);
  assert.equal(u.data.payment.removed, true);
  assert.equal("expense" in u.data, false);
});

test("stale: an older change, an already undone change, and an unknown logId are refused and change nothing", async () => {
  const call = client({ expenses: [ramen()] });
  const e1 = await call("updateExpense", { id: "exp0000001", patch: { amount: 4500 } });
  const e2 = await call("updateExpense", { id: "exp0000001", patch: { amount: 4800 } });
  const revBefore = e2.rev;
  const logBefore = JSON.stringify(call.fake.tables.Log);
  const s = await call("undo", { logId: e1.data.logId });
  assert.equal(s.ok, false);
  assert.equal(s.error, "stale");
  assert.equal(typeof s.message, "string");
  assert.equal(s.rev, revBefore);
  assert.equal(JSON.stringify(call.fake.tables.Log), logBefore);
  assert.equal((await call("load")).data.expenses[0].amount, 4800);

  const u = await call("undo", { logId: e2.data.logId });
  assert.equal(u.ok, true);
  const again = await call("undo", { logId: e2.data.logId });
  assert.equal(again.error, "stale");

  const nf = await call("undo", { logId: 999 });
  assert.equal(nf.error, "not_found");
});

test("a fake built from the seed fixture has nine expenses, one deleted, and ten history entries", async () => {
  const call = client(SEED);
  const load = await call("load");
  assert.equal(load.data.expenses.length, 9);
  assert.equal(load.data.expenses.filter((e) => e.deleted).length, 1);
  assert.equal(load.data.expenses.find((e) => e.deleted).id, "seedexp005");
  const live = load.data.expenses.filter((e) => !e.deleted);
  assert.equal(live.reduce((s, e) => s + e.amount, 0), 438340);
  const lodge = load.data.expenses.find((e) => e.id === "seedexp001");
  assert.equal(lodge.note, "ref NK-4471");
  assert.equal(lodge.kind, "stay");
  assert.equal(lodge.rate, 111);
  assert.equal(lodge.addedBy, "Mo");
  assert.deepEqual(load.data.expenses.find((e) => e.id === "seedexp008").split, ["Ajen", "Trenton"]);
  const hist = await historyAll(call);
  assert.equal(hist.length, 10);
  const five = await historyAll(call, { ref: "seedexp005" });
  assert.deepEqual(five.map((e) => e.action), ["delete", "add"]);
  assert.equal(five[0].canUndo, true);
  assert.equal(five[1].canUndo, false);
});

// ---------- rulings ----------

test("updateExpense refuses patch keys it does not allow", async () => {
  const call = client({ expenses: [ramen()] });
  for (const patch of [{ rate: 1 }, { addedBy: "Ajen" }, { deleted: true }, { id: "other00001" }, { amount: 10, color: "red" }]) {
    const r = await call("updateExpense", { id: "exp0000001", patch });
    assert.equal(r.ok, false, JSON.stringify(patch));
    assert.equal(r.error, "bad_input");
  }
  for (const patch of [null, "x", [1]]) {
    assert.equal((await call("updateExpense", { id: "exp0000001", patch })).error, "bad_input");
  }
  assert.equal((await call("load")).data.expenses[0].rate, 111);
  assert.equal((await historyAll(call)).length, 1);
});

test("a deleted line must be brought back before it can be edited", async () => {
  const call = client({ expenses: [ramen({ deleted: true })] });
  const r = await call("updateExpense", { id: "exp0000001", patch: { amount: 10 } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "bad_input");
  assert.equal(r.message, "Bring it back first.");
});

test("repeat delete, restore of a live line, and the same for payments answer unchanged with no log and no rev bump", async () => {
  const call = client({
    expenses: [ramen(), ramen({ id: "exp0000002", deleted: true })],
    payments: [stampOf(), stampOf({ id: "pay0000002", removed: true })],
  });
  const logLen = call.fake.tables.Log.length;
  const cases = [
    ["restoreExpense", "exp0000001", "expense", "deleted", false],
    ["deleteExpense", "exp0000002", "expense", "deleted", true],
    ["restorePayment", "pay0000001", "payment", "removed", false],
    ["removePayment", "pay0000002", "payment", "removed", true],
  ];
  for (const [action, id, kind, flag, value] of cases) {
    const r = await call(action, { id });
    assert.equal(r.ok, true, action);
    assert.equal(r.data[kind].id, id);
    assert.equal(r.data[kind][flag], value);
    assert.equal(r.data.logId, null);
    assert.equal(r.rev, 0);
  }
  assert.equal(call.fake.tables.Log.length, logLen);
});

test("an edit that changes nothing answers unchanged with no log and no rev bump", async () => {
  const call = client({ expenses: [ramen({ note: "x" })] });
  for (const patch of [{ amount: 4200 }, { title: " Ramen " }, { note: "x", split: ALL.slice() }, {}]) {
    const r = await call("updateExpense", { id: "exp0000001", patch });
    assert.equal(r.ok, true, JSON.stringify(patch));
    assert.equal(r.data.logId, null);
    assert.equal(r.data.expense.amount, 4200);
    assert.equal(r.rev, 0);
  }
  assert.equal((await historyAll(call)).length, 1);
});

test("every write needs an actor who is on the trip", async () => {
  const call = client({ expenses: [ramen({ id: "exp0000009" })] });
  const writes = [
    ["addExpense", { expense: ramen() }],
    ["updateExpense", { id: "exp0000009", patch: { amount: 10 } }],
    ["deleteExpense", { id: "exp0000009" }],
    ["addPayment", { payment: stampOf() }],
    ["setPerson", { name: "Mo", patch: { simplify: false } }],
    ["undo", { logId: 1 }],
  ];
  for (const actor of ["Nobody", "", undefined, "mo"]) {
    for (const [action, args] of writes) {
      const r = await call(action, args, { actor });
      assert.equal(r.ok, false, action + " " + actor);
      assert.equal(r.error, "bad_input");
    }
  }
  assert.equal((await call("rev")).rev, 0);
  assert.equal((await call("load", {}, { actor: undefined })).ok, true);
});

test("via is claude only on the connector's own path; a phone saying so is ignored (security fix round)", async () => {
  const call = client();
  await call("addExpense", { expense: ramen({ id: "exp0000004" }) }, { via: "claude" });
  await call("addExpense", { expense: ramen({ id: "exp0000001" }) }, { via: "Claude" });
  await call("addExpense", { expense: ramen({ id: "exp0000002" }) }, { via: "web" });
  await call.fake.claude("addExpense", { expense: ramen({ id: "exp0000003" }) });
  const vias = (await historyAll(call)).map((e) => e.via);
  assert.deepEqual(vias, ["claude", "app", "app", "app"]);
  assert.equal(call.fake.tables.Log[0].via, "app");
});

test("history by ref covers either kind, newest first, and limit is clamped to 1..500", async () => {
  const expenses = [];
  for (let i = 0; i < 505; i++) expenses.push(ramen({ id: "bulk" + String(i).padStart(6, "0"), amount: 100 + i }));
  const call = client({ expenses, payments: [stampOf()] });
  await call("removePayment", { id: "pay0000001" });
  const pay = await historyAll(call, { ref: "pay0000001" });
  assert.deepEqual(pay.map((e) => e.action), ["unstamp", "stamp"]);
  const zero = await call("history", { limit: 0 });
  assert.equal(zero.data.entries.length, 1);
  assert.equal(zero.data.more, true);
  const big = await call("history", { limit: 1000 });
  assert.equal(big.data.entries.length, 500);
  assert.equal(big.data.more, true);
  const dflt = await call("history");
  assert.equal(dflt.data.entries.length, 200);
  const odd = await call("history", { limit: "lots" });
  assert.equal(odd.data.entries.length, 200);
  for (const e of dflt.data.entries) {
    assert.equal("before" in e, false);
    assert.equal("after" in e, false);
  }
});

test("load never returns email, the trip key or the Log", async () => {
  const call = client(SEED);
  call.fake.tables.People[0].email = "private@example.com";
  const r = await call("load");
  const text = JSON.stringify(r);
  assert.equal(text.includes("email"), false);
  assert.equal(text.includes("private@example.com"), false);
  assert.equal(text.includes(KEY), false);
  assert.equal("log" in r.data, false);
  assert.equal("history" in r.data, false);
  assert.equal(text.includes("rang up"), false);
});

test("rev is a number on reads, writes and errors", async () => {
  const call = client({ expenses: [ramen()] });
  const r0 = await call("rev");
  assert.deepEqual(r0, { ok: true, rev: 0, data: {} });
  await call("deleteExpense", { id: "exp0000001" });
  for (const [action, args] of [["load", {}], ["rev", {}], ["history", {}], ["addExpense", { expense: ramen({ amount: 0 }) }], ["deleteExpense", { id: "nosuchline1" }], ["undo", { logId: 1 }], ["nonsense", {}]]) {
    const r = await call(action, args);
    assert.equal(r.rev, 1, action);
  }
});

test("odd request bodies are refused with bad_input and a message", async () => {
  const fake = createFakeBackend();
  for (const body of [null, undefined, "load", 5, []]) {
    const r = await fake(body);
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.equal(r.error, "bad_input");
    assert.equal(typeof r.message, "string");
  }
  const call = client();
  for (const [action, args] of [["nonsense", {}], ["load", "x"], ["addExpense", { expense: null }], ["undo", { logId: "abc" }], ["undo", {}], ["setPerson", { name: "Trenton", patch: { initials: "XX" } }], ["history", { ref: 5 }], ["deleteExpense", { id: 7 }]]) {
    const r = await call(action, args);
    assert.equal(r.ok, false, action + " " + JSON.stringify(args));
    assert.equal(r.error, "bad_input", action + " " + JSON.stringify(args));
    assert.ok(r.message.length > 0);
  }
  assert.equal((await call("setPerson", { name: "Nobody", patch: { simplify: false } })).error, "not_found");
});

test("undo of a Log row with no before and no after is stale, never a crash", async () => {
  const call = client({ expenses: [ramen()] });
  call.fake.tables.Log.push({ id: 2, at: "2026-12-10T00:00:00.000Z", who: "Mo", via: "app", action: "edit", kind: "expense", ref: "exp0000001", summary: "x", before: "", after: "", undoes: "", undone_by: "" });
  const r = await call("undo", { logId: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "stale");
  assert.equal((await call("load")).data.expenses[0].deleted, false);
});

for (const keepsApostrophe of [false, true]) {
  test(`formula-looking text comes back as typed from load, history and undo (Sheets ${keepsApostrophe ? "keeps" : "drops"} the apostrophe)`, async () => {
    const call = client(undefined, { keepsApostrophe });
    const titles = ["=probe", "-5% off", "+81 3", "@home"];
    const adds = [];
    for (let i = 0; i < titles.length; i++) {
      const r = await call("addExpense", { expense: ramen({ id: "fx00000" + i, title: titles[i], note: titles[(i + 1) % titles.length] }) });
      assert.equal(r.data.expense.title, titles[i]);
      adds.push(r);
    }
    assert.equal(call.fake.tables.Expenses[0].title, "'=probe");
    assert.equal(call.fake.tables.Expenses[1].note, "'+81 3");
    const load = (await call("load")).data.expenses;
    assert.deepEqual(load.map((e) => e.title), titles);
    assert.deepEqual(load.map((e) => e.note), ["-5% off", "+81 3", "@home", "=probe"]);
    const hist = await historyAll(call);
    assert.deepEqual(hist.map((e) => e.summary).reverse(), titles.map((t) => "rang up " + t + " ¥4,200"));

    const ed = await call("updateExpense", { id: "fx000000", patch: { title: "-renamed" } });
    assert.equal(ed.data.expense.title, "-renamed");
    const u = await call("undo", { logId: ed.data.logId });
    assert.equal(u.data.expense.title, "=probe");
    assert.equal(u.data.expense.note, "-5% off");
    assert.equal(u.data.entry.summary, "undid: renamed =probe to -renamed");
    const ua = await call("undo", { logId: adds[3].data.logId });
    assert.equal(ua.data.expense.title, "@home");
    assert.equal(ua.data.expense.deleted, true);
    const after = (await call("load")).data.expenses;
    assert.deepEqual(after.map((e) => e.title), titles);
    assert.equal((await historyAll(call))[0].summary, "undid: rang up @home ¥4,200");
  });
}

test("the fake keeps every request, and requests and answers are copies", async () => {
  const fake = createFakeBackend();
  const body = { key: KEY, actor: "Mo", action: "addExpense", args: { expense: ramen() } };
  const r = await fake(body);
  body.args.expense.title = "Changed after sending";
  r.data.expense.title = "Changed after answering";
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0].args.expense.title, "Ramen");
  const load = await fake({ key: KEY, action: "load", args: {} });
  assert.equal(load.data.expenses[0].title, "Ramen");
  assert.equal(fake.requests.length, 2);
});

test("seed people and days are applied as patches, and seeded log rows use the seeded who and when", async () => {
  const call = client({
    people: { Trenton: { simplify: false, etransfer: "tr@example.com" } },
    days: { "2026-12-11": { city: "Tokyo", title: "Shibuya" } },
    expenses: [ramen({ addedBy: "Ajen", addedAt: "2026-12-10T03:00:00.000Z" })],
    payments: [stampOf({ stampedAt: "2026-12-12T03:00:00.000Z" })],
  });
  const d = (await call("load")).data;
  assert.deepEqual(d.people[2], { name: "Trenton", initials: "TR", etransfer: "tr@example.com", simplify: false, photo: "" });
  const day = d.days.find((x) => x.date === "2026-12-11");
  assert.equal(day.city, "Tokyo");
  assert.equal(day.title, "Shibuya");
  assert.equal(d.days.find((x) => x.date === "2026-12-10").city, "");
  assert.equal(d.expenses[0].addedBy, "Ajen");
  assert.equal(d.payments[0].stampedBy, "Ajen");
  assert.equal(d.payments[0].seed, 3);
  const hist = await historyAll(call);
  assert.deepEqual(hist.map((e) => [e.action, e.who, e.at]), [
    ["stamp", "Ajen", "2026-12-12T03:00:00.000Z"],
    ["add", "Ajen", "2026-12-10T03:00:00.000Z"],
  ]);
  const next = await call("addExpense", { expense: ramen({ id: "exp0000002" }) });
  assert.equal(next.data.logId, 3);
});

test("the in-memory sheet helpers behave like the real ones", () => {
  const fake = createFakeBackend();
  const p = fake.primitives;
  fake.tables.Expenses.push(Object.fromEntries(TABS.Expenses.map((h) => [h, ""])));
  p.appendObj_("Expenses", { id: "exp0000001", title: "Ramen", amount: 4200, note: "n" });
  assert.equal(p.updateById_("Expenses", "", { title: "hit" }), null);
  assert.equal(p.updateById_("Expenses", null, { title: "hit" }), null);
  assert.equal(fake.tables.Expenses[0].title, "");
  assert.equal(p.updateById_("Expenses", "nosuchline1", { title: "x" }), null);
  assert.equal(p.updateWhere_("Expenses", "nosuchcolumn", "x", { title: "x" }), null);
  const row = p.updateById_("Expenses", "exp0000001", { title: "-dash", note: undefined, nosuchcolumn: 1 });
  assert.equal(row.title, "-dash");
  assert.equal(row.note, "n");
  assert.equal(row.amount, 4200);
  assert.equal("nosuchcolumn" in row, false);
  assert.equal(fake.tables.Expenses[1].title, "'-dash");
  assert.equal(p.readTable_("Expenses")[1].title, "-dash");
  assert.equal(p.appendObj_("Expenses", { id: "exp0000002" }), undefined);
  assert.deepEqual(Object.keys(fake.tables.Expenses[2]), TABS.Expenses);
});

test("text that looks like a date or a number comes back exactly as typed", async () => {
  const call = client();
  const a = await call("addExpense", { expense: ramen({ id: "exp0000001", title: "1/2", note: "3-4" }) });
  const b = await call("addExpense", { expense: ramen({ id: "exp0000002", title: "0012" }) });
  assert.equal(a.data.expense.title, "1/2");
  assert.equal(a.data.expense.note, "3-4");
  assert.equal(b.data.expense.title, "0012");
  const load = (await call("load")).data.expenses;
  assert.deepEqual(load.map((e) => [e.title, e.note]), [["1/2", "3-4"], ["0012", ""]]);
  assert.equal(typeof load[0].amount, "number");
  assert.equal(typeof load[0].rate, "number");
  const hist = await historyAll(call);
  assert.deepEqual(hist.map((e) => e.summary), ["rang up 0012 ¥4,200", "rang up 1/2 ¥4,200"]);
  assert.deepEqual(hist.map((e) => e.id), [2, 1]);
  const u = await call("undo", { logId: b.data.logId });
  assert.equal(u.data.expense.title, "0012");
  assert.equal(u.data.entry.undoes, 2);
});

test("the in-memory sheet hands cells back the way Sheets does under the column formats", () => {
  const fake = createFakeBackend();
  const p = fake.primitives;
  p.appendObj_("Expenses", { id: "exp0000001", title: 12, note: true, amount: "0012", rate: "111.5", split_vals: 3 });
  const row = p.readTable_("Expenses")[0];
  assert.equal(row.title, "12");
  assert.equal(row.note, "TRUE");
  assert.equal(row.amount, 12);
  assert.equal(row.rate, 111.5);
  assert.equal(row.split_vals, "3");
  p.appendObj_("Log", { id: "5", undoes: "2", summary: 7 });
  const log = p.readTable_("Log")[0];
  assert.equal(log.id, 5);
  assert.equal(log.undoes, 2);
  assert.equal(log.summary, "7");
  assert.equal(p.readTable_("People")[0].simplify, true);
  assert.equal(p.readTable_("People")[0].order, 1);
});

test("log ids and rev carry on after Script Properties are wiped", async () => {
  const call = client({ expenses: [ramen({ id: "exp0000009" })] });
  await call("addExpense", { expense: ramen() });
  await call("updateExpense", { id: "exp0000001", patch: { amount: 4500 } });
  const last = await call("deleteExpense", { id: "exp0000009" });
  assert.equal(last.data.logId, 4);
  const revBefore = last.rev;
  for (const k of Object.keys(call.fake.props)) if (k !== "TRIP_KEY") delete call.fake.props[k];
  assert.ok((await call("rev")).rev >= 4);
  const next = await call("addExpense", { expense: ramen({ id: "exp0000002" }) });
  assert.equal(next.ok, true);
  assert.equal(next.data.logId, 5);
  assert.ok(next.rev > revBefore, `rev ${next.rev} after ${revBefore}`);
  const ids = call.fake.tables.Log.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  const u = await call("undo", { logId: 5 });
  assert.equal(u.ok, true);
  assert.equal(u.data.logId, 6);
});

test("a write that cannot get the lock answers busy, writes nothing and leaves rev alone", async () => {
  let locked = false;
  const fake = createFakeBackend({ expenses: [ramen({ id: "exp0000009" })] }, { lockFails: () => locked });
  const send = (action, args) => fake({ key: KEY, actor: "Mo", action, args });
  await send("deleteExpense", { id: "exp0000009" });
  const before = JSON.stringify(fake.tables);
  locked = true;
  for (const [action, args] of [["addExpense", { expense: ramen() }], ["restoreExpense", { id: "exp0000009" }], ["setPerson", { name: "Mo", patch: { simplify: false } }], ["undo", { logId: 2 }]]) {
    const r = await send(action, args);
    assert.equal(r.ok, false, action);
    assert.equal(r.error, "busy");
    assert.equal(typeof r.message, "string");
    assert.equal(r.rev, 1);
  }
  assert.equal(JSON.stringify(fake.tables), before);
  const load = await send("load", {});
  assert.equal(load.ok, true);
  assert.equal(load.rev, 1);
  locked = false;
  assert.equal((await send("addExpense", { expense: ramen() })).rev, 2);
});

// ---------- fix wave ----------

test("load says where today's rate came from: live by default, or what the fake is set to (F7)", async () => {
  const call = client();
  assert.equal((await call("load")).data.rateSource, "live");
  call.fake.setRate(111, "fallback");
  const r = await call("load");
  assert.equal(r.data.rateToday, 111);
  assert.equal(r.data.rateSource, "fallback");
  call.fake.setRate(109.5, "last");
  assert.deepEqual([(await call("load")).data.rateToday, (await call("load")).data.rateSource], [109.5, "last"]);
  assert.equal((await call("addExpense", { expense: ramen() })).data.expense.rate, 109.5, "an add takes the same rate");
});

test("changing an e-Transfer address is logged without the address; a Simplify flip alone is not (F9)", async () => {
  const base = client();
  const call = asOwn(base, "Trenton");
  const r = await call("setPerson", { name: "Trenton", patch: { etransfer: "t@example.com" } });
  assert.equal(r.ok, true);
  assert.equal(r.rev, 1);
  const [entry] = await historyAll(base);
  assert.deepEqual(
    { action: entry.action, kind: entry.kind, ref: entry.ref, who: entry.who, summary: entry.summary, canUndo: entry.canUndo },
    { action: "edit", kind: "person", ref: "Trenton", who: "Trenton", summary: "changed Trenton’s e-Transfer address", canUndo: false },
  );
  assert.equal(JSON.stringify(entry).includes("t@example.com"), false, "the address is not in what history returns");
  const row = base.fake.tables.Log[0];
  assert.deepEqual(JSON.parse(row.before), { name: "Trenton", etransfer: "" });
  assert.deepEqual(JSON.parse(row.after), { name: "Trenton", etransfer: "t@example.com" });

  await call("setPerson", { name: "Trenton", patch: { simplify: false } });
  await call("setPerson", { name: "Trenton", patch: { etransfer: "t@example.com", simplify: true } }); // same address
  assert.equal((await historyAll(base)).length, 1, "a Simplify flip writes no Log row");

  await call("setPerson", { name: "Trenton", patch: { etransfer: "new@example.com", simplify: false } });
  assert.equal((await historyAll(base)).length, 2);
});

test("a person entry can never be undone: undo answers stale and changes nothing (F9)", async () => {
  const call = client();
  await asOwn(call, "Ajen")("setPerson", { name: "Ajen", patch: { etransfer: "a@example.com" } });
  const [entry] = await historyAll(call);
  const r = await call("undo", { logId: entry.id });
  assert.equal(r.ok, false);
  assert.equal(r.error, "stale");
  assert.equal(r.message, "That change can’t be undone.");
  const load = await call("load");
  assert.equal(load.data.people.find((p) => p.name === "Ajen").etransfer, "a@example.com");
  assert.equal(call.fake.tables.Log.length, 1);
});

test("history for an expense is not mixed with a person of the same name (F9)", async () => {
  const call = client();
  await call("addExpense", { expense: ramen() });
  await call("setPerson", { name: "Mo", patch: { etransfer: "m@example.com" } });
  const forLine = await historyAll(call, { ref: "exp0000001" });
  assert.deepEqual(forLine.map((e) => e.kind), ["expense"]);
});

test("the key check compares whole keys and reads the shared key from Script Properties on every request (F12, superseded by the security fix round)", async () => {
  const fake = createFakeBackend();
  for (const key of ["test-key", "test-kez", "test-ke", "test-key2", ""]) {
    const r = await fake({ key, actor: "Mo", action: "rev", args: {} });
    assert.equal(r.ok, key === "test-key", key);
  }
  // The empty key is refused before anything is read; the other four each read it afresh.
  assert.equal(fake.propReads.filter((k) => k === "TRIP_KEY").length, 4);
});

// ---------- the trip side: stops, stays and day headers (Plan 2, Task 2) ----------

const AS = (actor) => ({ actor });

test("a stop: add, repeat, edit, delete, restore, each logged", async () => {
  const call = client({});
  const stop = { id: "stopAAAA0001", date: "2026-12-12", title: "Shibuya Sky", time: "14:00" };
  const a = await call("addStop", { stop });
  assert.equal(a.data.stop.title, "Shibuya Sky");
  const again = await call("addStop", { stop }, AS("Ajen"));
  assert.equal(again.data.logId, a.data.logId);
  assert.equal(call.fake.tables.Stops.length, 1);
  const e = await call("updateStop", { id: stop.id, patch: { time: "15:30" } }, AS("Ajen"));
  assert.equal(e.data.stop.time, "15:30");
  assert.equal((await call("updateStop", { id: stop.id, patch: { time: "15:30" } }, AS("Ajen"))).data.logId, null);
  assert.equal((await call("updateStop", { id: stop.id, patch: { time: "nope" } })).error, "bad_input");
  assert.equal((await call("updateStop", { id: stop.id, patch: { id: "other000001" } })).error, "bad_input");
  const d = await call("deleteStop", { id: stop.id });
  assert.equal(d.data.stop.deleted, true);
  assert.equal((await call("updateStop", { id: stop.id, patch: { time: "16:00" } })).message, "Bring it back first.");
  assert.equal((await call("restoreStop", { id: stop.id })).data.stop.deleted, false);
  const h = await call("history", {});
  assert.deepEqual(h.data.entries.map((x) => x.summary), ["put back Shibuya Sky on Sat Dec 12", "removed Shibuya Sky from Sat Dec 12", "moved Shibuya Sky to Sat Dec 12 15:30", "added Shibuya Sky to Sat Dec 12"]);
});

test("undo puts a stop back, and refuses once it changed again", async () => {
  const call = client({ stops: [{ id: "stopAAAA0001", date: "2026-12-12", title: "Shibuya Sky", time: "14:00" }] });
  const e1 = await call("updateStop", { id: "stopAAAA0001", patch: { time: "15:30" } });
  const e2 = await call("updateStop", { id: "stopAAAA0001", patch: { title: "Sky deck" } }, AS("Ajen"));
  assert.equal((await call("undo", { logId: e1.data.logId })).error, "stale");
  const u = await call("undo", { logId: e2.data.logId });
  assert.equal(u.data.stop.title, "Shibuya Sky");
  assert.equal(u.data.stop.time, "15:30");
});

test("undoing an added stop marks it deleted; nothing is erased", async () => {
  const call = client({});
  const a = await call("addStop", { stop: { id: "stopAAAA0001", date: "2026-12-12", title: "Shibuya Sky" } });
  const u = await call("undo", { logId: a.data.logId });
  assert.equal(u.data.stop.deleted, true);
  assert.equal(call.fake.tables.Stops.length, 1);
});

test("a stay: saved, changed, removed, undone", async () => {
  const call = client({});
  const stay = { id: "stayAAAA0001", name: "Asakusa hotel", firstNight: "2026-12-10", lastNight: "2026-12-12" };
  assert.equal((await call("saveStay", { stay })).data.stay.name, "Asakusa hotel");
  const e = await call("saveStay", { stay: { ...stay, nameJp: "浅草ホテル" } });
  assert.equal(e.data.stay.nameJp, "浅草ホテル");
  assert.equal(call.fake.tables.Stays.length, 1);
  assert.equal((await call("undo", { logId: e.data.logId })).data.stay.nameJp, "");
  assert.equal((await call("deleteStay", { id: stay.id })).data.stay.deleted, true);
});

test("a day header: set, logged, undone; an unknown day is refused", async () => {
  const call = client({});
  const s = await call("setDay", { date: "2026-12-12", patch: { city: "Tokyo", lineColour: "#9ACD32" } });
  assert.equal(s.data.day.city, "Tokyo");
  assert.equal((await call("undo", { logId: s.data.logId })).data.day.city, "");
  assert.equal((await call("setDay", { date: "2026-12-25", patch: { city: "x" } })).error, "not_found");
});

test("load returns the typed plan, and migrate is safe to repeat", async () => {
  const plan = require("./fixtures/plan.json");
  const call = client(plan);
  const l = await call("load", {});
  const sky = l.data.stops.find((s) => s.id === "planstop1203");
  assert.deepEqual([sky.travelMin, sky.fixed, sky.signJp, sky.deleted], [30, true, "渋谷", false]);
  assert.equal(l.data.days.find((d) => d.date === "2026-12-12").lineJp, "山手線");
  assert.equal(l.data.stays[0].firstNight, "2026-12-10");
  assert.deepEqual((await call("migrate", {}, AS(undefined))).data, { added: [] });
  assert.deepEqual((await call("migrate", {}, AS(undefined))).data, { added: [] });
});

test("every new write needs a known actor; nothing is written without one", async () => {
  const call = client({ stops: [{ id: "stopAAAA0001", date: "2026-12-12", title: "Shibuya Sky" }], stays: [{ id: "stayAAAA0001", name: "Lodge", firstNight: "2026-12-13", lastNight: "2026-12-15" }] });
  const writes = [
    ["addStop", { stop: { id: "stopAAAA0002", date: "2026-12-12", title: "Lunch" } }],
    ["updateStop", { id: "stopAAAA0001", patch: { time: "10:00" } }],
    ["deleteStop", { id: "stopAAAA0001" }],
    ["restoreStop", { id: "stopAAAA0001" }],
    ["saveStay", { stay: { id: "stayAAAA0002", name: "Hotel", firstNight: "2026-12-10", lastNight: "2026-12-12" } }],
    ["deleteStay", { id: "stayAAAA0001" }],
    ["restoreStay", { id: "stayAAAA0001" }],
    ["setDay", { date: "2026-12-12", patch: { city: "Tokyo" } }],
  ];
  const logBefore = call.fake.tables.Log.length;
  for (const [action, args] of writes) {
    for (const actor of [undefined, "Nobody", ""]) {
      const r = await call(action, args, AS(actor));
      assert.equal(r.error, "bad_input", action);
      assert.equal(r.message, "Pick who you are first.", action);
    }
  }
  assert.equal(call.fake.tables.Log.length, logBefore);
  assert.equal(call.fake.tables.Stops.length, 1);
  assert.equal(call.fake.tables.Stays.length, 1);
});

test("a stop written by Claude is logged with via claude", async () => {
  const call = client({});
  await call.fake.claude("addStop", { stop: { id: "stopAAAA0001", date: "2026-12-12", title: "Shibuya Sky" } });
  const [entry] = await historyAll(call);
  assert.equal(entry.via, "claude");
  assert.equal(entry.kind, "stop");
});

test("plan writes that find nothing answer not_found with their own words", async () => {
  const call = client({});
  for (const [action, args, message] of [
    ["updateStop", { id: "stopZZZZ0001", patch: { time: "10:00" } }, "That stop isn’t there any more."],
    ["deleteStop", { id: "stopZZZZ0001" }, "That stop isn’t there any more."],
    ["restoreStop", { id: "stopZZZZ0001" }, "That stop isn’t there any more."],
    ["deleteStay", { id: "stayZZZZ0001" }, "That stay isn’t there any more."],
    ["restoreStay", { id: "stayZZZZ0001" }, "That stay isn’t there any more."],
    ["setDay", { date: "2026-12-25", patch: { city: "x" } }, "That day isn’t on this trip."],
  ]) {
    const r = await call(action, args);
    assert.equal(r.error, "not_found", action);
    assert.equal(r.message, message, action);
  }
});

test("a stop or stay write that changes nothing logs nothing and keeps rev", async () => {
  const call = client({});
  const stay = { id: "stayAAAA0001", name: "Lodge", firstNight: "2026-12-13", lastNight: "2026-12-15" };
  await call("saveStay", { stay });
  await call("addStop", { stop: { id: "stopAAAA0001", date: "2026-12-12", title: "Sky" } });
  const before = await call("rev");
  const logs = call.fake.tables.Log.length;
  assert.equal((await call("saveStay", { stay })).data.logId, null);
  assert.equal((await call("deleteStop", { id: "stopAAAA0001" })).ok, true);
  assert.equal((await call("deleteStop", { id: "stopAAAA0001" })).data.logId, null);
  assert.equal((await call("setDay", { date: "2026-12-12", patch: { city: "" } })).data.logId, null);
  assert.equal(call.fake.tables.Log.length, logs + 1);
  assert.equal((await call("rev")).rev, before.rev + 1);
});

test("saveStay without merge replaces the whole stay, as the app sends it", async () => {
  const call = client({});
  const full = { id: "stayAAAA0001", name: "Ryokan", nameJp: "旅館", addressJp: "京都", firstNight: "2026-12-14", lastNight: "2026-12-15", note: "late", place: "Gion", link: "https://example.test/r" };
  await call("saveStay", { stay: full });
  const r = await call("saveStay", { stay: { id: full.id, name: "Ryokan", firstNight: "2026-12-14", lastNight: "2026-12-16" } });
  assert.deepEqual(r.data.stay, { id: full.id, name: "Ryokan", nameJp: "", addressJp: "", firstNight: "2026-12-14", lastNight: "2026-12-16", note: "", place: "", link: "", photo: "", deleted: false, lat: "", lng: "" });
  const fresh = await call("saveStay", { stay: { id: "stayAAAA0002", name: "Inn", firstNight: "2026-12-17", lastNight: "2026-12-17" } });
  assert.equal(fresh.data.stay.id, "stayAAAA0002", "an unknown id is a new stay");
  assert.equal((await call("saveStay", { stay: { id: full.id, name: "Ryokan", firstNight: "2026-12-16", lastNight: "2026-12-14" } })).message, "The last night can’t be before the first.");
});

test("saveStay with merge: true lays the given fields over the row as it is under the lock", async () => {
  const call = client({});
  const full = { id: "stayAAAA0001", name: "Ryokan", nameJp: "旅館", addressJp: "京都", firstNight: "2026-12-14", lastNight: "2026-12-15", note: "orig", place: "Gion", link: "https://example.test/r" };
  await call("saveStay", { stay: full });
  await call("saveStay", { stay: { ...full, note: "phone B edit" } }, AS("Ajen")); // just before Claude's call
  const m = await call("saveStay", { stay: { id: full.id, lastNight: "2026-12-16" }, merge: true });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.deepEqual(m.data.stay, { ...full, photo: "", note: "phone B edit", lastNight: "2026-12-16", deleted: false, lat: "", lng: "" });
  const log = call.fake.tables.Log.at(-1);
  const before = JSON.parse(log.before), after = JSON.parse(log.after);
  assert.deepEqual(Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])), ["lastNight"]);
  assert.deepEqual(call.fake.tables.Stays.map((r) => [r.note, r.last_night]), [["phone B edit", "2026-12-16"]]);
  // A resend changes nothing; undo puts back only the date.
  assert.equal((await call("saveStay", { stay: { id: full.id, lastNight: "2026-12-16" }, merge: true })).data.logId, null);
  const u = await call("undo", { logId: m.data.logId });
  assert.deepEqual([u.data.stay.lastNight, u.data.stay.note], ["2026-12-15", "phone B edit"]);
  // "" clears; the merged stay is validated whole.
  assert.equal((await call("saveStay", { stay: { id: full.id, note: "" }, merge: true })).data.stay.note, "");
  assert.equal((await call("saveStay", { stay: { id: full.id, lastNight: "2026-12-01" }, merge: true })).message, "The last night can’t be before the first.");
  assert.equal((await call("saveStay", { stay: { id: full.id, link: "javascript:1" }, merge: true })).message, "That link has to start with https://.");
});

const SPIC = "https://example.org/a.jpg";
const SPIC2 = "https://example.org/b.jpg";
const stayFull = () => ({ id: "stayAAAA0001", name: "Ryokan", nameJp: "旅館", addressJp: "京都", firstNight: "2026-12-14", lastNight: "2026-12-15", note: "orig", place: "Gion", link: "https://example.test/r" });
const stayPhoto = async (call) => (await call("load")).data.stays[0].photo;

test("a stay saved with a photo carries it through load", async () => {
  const call = client({});
  const r = await call("saveStay", { stay: { ...stayFull(), photo: SPIC } });
  assert.equal(r.data.stay.photo, SPIC);
  assert.equal(await stayPhoto(call), SPIC);
  assert.equal(call.fake.tables.Stays[0].photo, SPIC);
});

test("saveStay merge keeps, sets and clears the photo", async () => {
  const call = client({});
  await call("saveStay", { stay: { ...stayFull(), photo: SPIC } });
  const keep = await call("saveStay", { stay: { id: "stayAAAA0001", link: "https://example.test/other" }, merge: true });
  assert.equal(keep.ok, true, JSON.stringify(keep));
  assert.equal(keep.data.stay.photo, SPIC, "a merge without photo keeps it");
  const set = await call("saveStay", { stay: { id: "stayAAAA0001", photo: SPIC2 }, merge: true });
  assert.deepEqual(set.data.stay, { ...stayFull(), link: "https://example.test/other", photo: SPIC2, deleted: false, lat: "", lng: "" });
  const clear = await call("saveStay", { stay: { id: "stayAAAA0001", photo: "" }, merge: true });
  assert.equal(clear.data.stay.photo, "");
  assert.equal(await stayPhoto(call), "");
  assert.equal((await call("saveStay", { stay: { id: "stayAAAA0001", photo: "http://example.org/a.jpg" }, merge: true })).message, "That photo link has to start with https://.");
});

test("a Sheet row whose photo cell is not an https link loads as no photo", async () => {
  const call = client({});
  await call("saveStay", { stay: { ...stayFull(), photo: SPIC } });
  for (const bad of ['=HYPERLINK("https://example.org/a.jpg")', "http://example.org/a.jpg"]) {
    call.fake.tables.Stays[0].photo = bad;
    assert.equal(await stayPhoto(call), "", bad);
  }
});

test("undo of a photo change puts the old photo back; the History sentence is the usual one", async () => {
  const call = client({});
  await call("saveStay", { stay: { ...stayFull(), photo: SPIC } });
  const c = await call("saveStay", { stay: { id: "stayAAAA0001", photo: SPIC2 }, merge: true });
  assert.equal(await stayPhoto(call), SPIC2);
  const entry = (await historyAll(call)).find((e) => e.id === c.data.logId);
  assert.equal(entry.summary, "changed the stay Ryokan");
  const u = await call("undo", { logId: c.data.logId });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(await stayPhoto(call), SPIC);
  const r = await call("saveStay", { stay: { id: "stayAAAA0001", photo: "" }, merge: true });
  await call("undo", { logId: r.data.logId });
  assert.equal(await stayPhoto(call), SPIC, "a removed photo comes back too");
});

test("an older Sheet with no Stays.photo: stays load with no photo, a photo is refused until migrate, other saves still work", async () => {
  const call = client({ missingColumns: ["Stays.photo"] });
  const ok = await call("saveStay", { stay: stayFull() });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(await stayPhoto(call), "");
  const logs = call.fake.tables.Log.length;
  const early = await call("saveStay", { stay: { ...stayFull(), photo: SPIC } });
  assert.deepEqual([early.ok, early.error, early.message], [false, "needs_migrate", "The trip sheet needs updating first. Ask Mo to run migrate."]);
  const earlyMerge = await call("saveStay", { stay: { id: "stayAAAA0001", photo: SPIC }, merge: true });
  assert.equal(earlyMerge.error, "needs_migrate");
  const earlyNew = await call("saveStay", { stay: { ...stayFull(), id: "stayAAAA0002", photo: SPIC } });
  assert.equal(earlyNew.error, "needs_migrate");
  assert.equal(call.fake.tables.Log.length, logs, "nothing logged, nothing half-saved");
  assert.equal(call.fake.tables.Stays.length, 1);
  assert.equal((await call("saveStay", { stay: { ...stayFull(), note: "edited" } })).ok, true, "a save without a photo keeps working");
  assert.equal((await call("saveStay", { stay: { ...stayFull(), photo: "" , note: "again" } })).ok, true, "an empty photo is not a photo");
  assert.deepEqual((await call.fake({ key: KEY, action: "migrate", args: {} })).data, { added: ["Stays.photo"] });
  assert.equal((await call("saveStay", { stay: { ...stayFull(), note: "again", photo: SPIC } })).ok, true);
  assert.equal(await stayPhoto(call), SPIC);
});

test("saveStay with merge: true never makes or revives a stay, and merge must be true or false", async () => {
  const call = client({ stays: [{ id: "stayAAAA0009", name: "Lodge", firstNight: "2026-12-13", lastNight: "2026-12-15", deleted: true }] });
  const none = await call("saveStay", { stay: { id: "stayAAAA0001", name: "Inn", firstNight: "2026-12-14", lastNight: "2026-12-14" }, merge: true });
  assert.deepEqual([none.error, none.message], ["not_found", "That stay isn’t there any more."]);
  assert.equal(call.fake.tables.Stays.length, 1);
  const dead = await call("saveStay", { stay: { id: "stayAAAA0009", note: "x" }, merge: true });
  assert.deepEqual([dead.error, dead.message], ["bad_input", "Bring it back first."]);
  for (const merge of ["yes", 1, null, {}]) {
    const r = await call("saveStay", { stay: { id: "stayAAAA0002", name: "Inn", firstNight: "2026-12-14", lastNight: "2026-12-14" }, merge });
    assert.deepEqual([r.error, r.message], ["bad_input", "That request didn’t come through properly."], JSON.stringify(merge));
  }
  assert.equal(call.fake.tables.Stays.length, 1);
  const off = await call("saveStay", { stay: { id: "stayAAAA0002", name: "Inn", firstNight: "2026-12-14", lastNight: "2026-12-14" }, merge: false });
  assert.equal(off.data.stay.id, "stayAAAA0002", "merge: false is the plain save");
  for (const bad of [{ lastNight: "2026-12-16" }, "x", null]) {
    assert.equal((await call("saveStay", { stay: bad, merge: true })).ok, false, JSON.stringify(bad));
  }
});

test("saving a removed stay is refused until it is brought back", async () => {
  const call = client({ stays: [{ id: "stayAAAA0001", name: "Lodge", firstNight: "2026-12-13", lastNight: "2026-12-15", deleted: true }] });
  const r = await call("saveStay", { stay: { id: "stayAAAA0001", name: "Lodge 2", firstNight: "2026-12-13", lastNight: "2026-12-15" } });
  assert.equal(r.error, "bad_input");
  assert.equal(r.message, "Bring it back first.");
  assert.equal((await call("restoreStay", { id: "stayAAAA0001" })).data.stay.deleted, false);
});

test("undoing a day edit writes back every header field, blanks included", async () => {
  const call = client({ days: { "2026-12-12": { city: "Tokyo", line_jp: "山手線" } } });
  const s = await call("setDay", { date: "2026-12-12", patch: { city: "Kyoto", title: "Temples", lineJp: "", lineColour: "#9ACD32" } });
  assert.equal(s.data.day.title, "Temples");
  const u = await call("undo", { logId: s.data.logId });
  assert.equal(u.ok, true);
  assert.deepEqual(
    [u.data.day.city, u.data.day.title, u.data.day.lineJp, u.data.day.lineColour],
    ["Tokyo", "", "山手線", ""],
  );
  assert.equal(u.data.entry.kind, "day");
  assert.equal(u.data.entry.ref, "2026-12-12");
});

test("a seeded stop or stay comes with its add in History", async () => {
  const call = client({ stops: [{ id: "stopAAAA0001", date: "2026-12-12", title: "Sky" }], stays: [{ id: "stayAAAA0001", name: "Lodge", firstNight: "2026-12-13", lastNight: "2026-12-15" }] });
  const entries = await historyAll(call);
  assert.deepEqual(entries.map((e) => [e.who, e.action, e.kind]).sort(), [["Mo", "add", "stay"], ["Mo", "add", "stop"]]);
});

// ---------- fix round 1: a plan edit writes only the columns it changes ----------

test("a hand-typed time and link survive a stop edit and its undo; changed and blanked fields are written", async () => {
  const call = client({ stops: [{ id: "stopAAAA0001", date: "2026-12-12", title: "Shibuya Sky", note: "Bring cash", detail: "Floor 14" }] });
  const row = call.fake.tables.Stops[0];
  row.time = "9:30"; // typed into the Sheet by hand
  row.link = "www.booking.com/x";
  const e = await call("updateStop", { id: "stopAAAA0001", patch: { title: "Sky deck", note: "" } });
  assert.equal(e.data.stop.title, "Sky deck");
  assert.deepEqual([row.title, row.note, row.detail, row.time, row.link], ["Sky deck", "", "Floor 14", "9:30", "www.booking.com/x"]);
  const u = await call("undo", { logId: e.data.logId });
  assert.equal(u.ok, true);
  assert.deepEqual([row.title, row.note, row.detail, row.time, row.link], ["Shibuya Sky", "Bring cash", "Floor 14", "9:30", "www.booking.com/x"]);
});

test("I5: a stop typed 9:30 with 12.5 minutes by hand reads 09:30 and 13; editing another field succeeds and leaves both cells as typed", async () => {
  const call = client({ stops: [{ id: "stopAAAA0001", date: "2026-12-12", title: "Shibuya Sky" }] });
  const row = call.fake.tables.Stops[0];
  row.time = "9:30";
  row.travel_min = 12.5;
  const loaded = (await call("load")).data.stops[0];
  assert.deepEqual([loaded.time, loaded.travelMin], ["09:30", 13]);
  const e = await call("updateStop", { id: "stopAAAA0001", patch: { detail: "Floor 14" } });
  assert.equal(e.ok, true, JSON.stringify(e));
  assert.deepEqual([e.data.stop.time, e.data.stop.travelMin, e.data.stop.detail], ["09:30", 13, "Floor 14"]);
  assert.deepEqual([row.time, row.travel_min, row.detail], ["9:30", 12.5, "Floor 14"]);
});

test("a hand-typed day colour survives a day edit and its undo; changed and blanked fields are written", async () => {
  const call = client({ days: { "2026-12-12": { city: "Tokyo", title: "Shrines", line_colour: "orange" } } });
  const row = call.fake.tables.Days.find((r) => r.date === "2026-12-12");
  const s = await call("setDay", { date: "2026-12-12", patch: { city: "Kyoto", title: "" } });
  assert.deepEqual([row.city, row.title, row.line_colour], ["Kyoto", "", "orange"]);
  const u = await call("undo", { logId: s.data.logId });
  assert.equal(u.ok, true);
  assert.deepEqual([row.city, row.title, row.line_colour], ["Tokyo", "Shrines", "orange"]);
});

test("a hand-typed stay link survives a name change", async () => {
  const stay = { id: "stayAAAA0001", name: "Lodge", firstNight: "2026-12-13", lastNight: "2026-12-15", note: "Late check-in" };
  const call = client({ stays: [stay] });
  const row = call.fake.tables.Stays[0];
  row.link = "www.booking.com/x";
  const e = await call("saveStay", { stay: { ...stay, name: "Niseko lodge", note: "" } });
  assert.equal(e.data.stay.name, "Niseko lodge");
  assert.deepEqual([row.name, row.note, row.link], ["Niseko lodge", "", "www.booking.com/x"]);
});

// ---------- pinned before the planner pull shared their code (Task 12) ----------

test("pinned: addExpense and updateExpense answer, store and log exactly as before", async () => {
  const call = client(undefined, { clock: () => "2026-12-11T02:00:00.000Z" });
  const added = { id: "pinexp0001", day: "2026-12-11", title: "Udon", amount: 980, currency: "JPY", rate: 111, paidBy: "Mo", split: ALL, splitMode: "equal", splitVals: [], note: "hot", kind: "food", addedBy: "Ajen", addedAt: "2026-12-11T02:00:00.000Z", deleted: false };
  const a = await call("addExpense", { expense: { id: "pinexp0001", day: "2026-12-11", title: " Udon ", amount: 980.4, currency: "JPY", paidBy: "Mo", split: ALL, note: " hot ", kind: "food" } }, { actor: "Ajen" });
  assert.deepEqual(a, { ok: true, rev: 1, data: { expense: added, logId: 1 } });
  const again = await call("addExpense", { expense: { id: "pinexp0001", day: "2026-12-11", title: "Other", amount: 1, currency: "JPY", paidBy: "Mo", split: ALL } }, { actor: "Ajen" });
  assert.deepEqual(again, a, "a repeated add answers the first");
  // A hand-typed split cell: the app's own edit writes every editable column, so it is rewritten.
  call.fake.tables.Expenses[0].split = "Mo, Ajen, Trenton";
  const edited = { ...added, amount: 1200 };
  const u = await call("updateExpense", { id: "pinexp0001", patch: { amount: 1200 } });
  assert.deepEqual(u, { ok: true, rev: 2, data: { expense: edited, logId: 2 } });
  assert.deepEqual(await call("updateExpense", { id: "pinexp0001", patch: { amount: 1200 } }), { ok: true, rev: 2, data: { expense: edited, logId: null } });
  assert.deepEqual(await call("updateExpense", { id: "pinexp0001", patch: { amount: -1 } }), { ok: false, error: "bad_input", message: "The amount has to be more than zero.", rev: 2 });
  assert.deepEqual(call.fake.tables.Expenses, [{ id: "pinexp0001", day: "2026-12-11", title: "Udon", amount: 1200, currency: "JPY", rate: 111, paid_by: "Mo", split: "Mo,Ajen,Trenton", split_mode: "equal", split_vals: "", note: "hot", kind: "food", receipt: "", added_by: "Ajen", added_at: "2026-12-11T02:00:00.000Z", deleted_at: "", planner_id: "" }], "R40 adds the planner_id column; the app's own writes leave it empty");
  assert.deepEqual(call.fake.tables.Log, [
    { id: 1, at: "2026-12-11T02:00:00.000Z", who: "Ajen", via: "app", action: "add", kind: "expense", ref: "pinexp0001", summary: "rang up Udon ¥980", before: "", after: JSON.stringify(added), undoes: "", undone_by: "" },
    { id: 2, at: "2026-12-11T02:00:00.000Z", who: "Mo", via: "app", action: "edit", kind: "expense", ref: "pinexp0001", summary: "changed Udon ¥980 → ¥1,200", before: JSON.stringify(added), after: JSON.stringify(edited), undoes: "", undone_by: "" },
  ]);
});

// ---------- payments from the planner sheet (Task 12, R39, R40) ----------
// Every planner value here is made up: ids, vendors, refs and amounts.

const PLANNER_ID = "fakePlannerSheet_0123456789abcdefXYZ";
const PHEAD = ["payment_id", "date_paid", "payer", "description", "category", "vendor", "booking_ref", "amount", "currency", "amount_cad", "cad_is_exact", "split_between", "split_type", "status", "include_in_split", "source", "added_by", "notes"];
const prow = (o) => PHEAD.map((h) => (o[h] === undefined ? "" : o[h]));
const PX7 = { payment_id: "X7", date_paid: "2026-12-11", payer: "Mo", description: "Rail pass", category: "transport", vendor: "North Rail", booking_ref: "AB12", amount: 24750, currency: "JPY", amount_cad: 221.52, cad_is_exact: "yes", split_between: "Mo, Ajen, Trenton", split_type: "equal", include_in_split: "yes" };
const PQ3 = { payment_id: "Q3", date_paid: "2026-12-12", payer: "ajen", description: "Noodle bar", category: "food", vendor: "Ramen Ya", amount: "¥3,600", currency: "JPY", split_between: "Mo, Ajen", split_type: "equal", include_in_split: "Yes" };
const PZ1 = { ...PX7, payment_id: "Z1", description: "Later tickets", include_in_split: "no (until charged)" };
const PP5 = { ...PX7, payment_id: "P5", description: "Own souvenir", split_type: "personal" };
const PU2 = { ...PX7, payment_id: "U2", payer: "Nadia" };
const PLANNER = [PHEAD, prow(PX7), [], prow(PQ3), prow(PZ1), prow(PP5), prow(PU2)];
const NOTE_X7 = "X7 · North Rail · ref AB12 · ¥24,750 charged";

function linked(over = {}, rows = PLANNER, opts = {}) {
  return client({ ...over, planner: rows, plannerId: PLANNER_ID }, { clock: () => "2026-12-12T03:00:00.000Z", ...opts });
}
// The Sheet's Expenses rows tied to payment pid by their planner_id.
const byPayment = (call, pid) => call.fake.primitives.readTable_("Expenses").filter((r) => r.planner_id === pid);
const stored = (call, id) => call.fake.tables.Expenses.find((r) => r.id === id);
const live = (call) => call.fake.primitives.readTable_("Expenses").filter((r) => !r.deleted_at);
const reply = (o = {}) => ({ added: 0, changed: 0, same: 0, removed: 0, notCounted: [], problems: [], more: false, capped: false, ...o });
const PROBLEMS = [
  { id: "P5", message: "Only payments split equally can be brought in.", row: 6, what: "Own souvenir" },
  { id: "U2", message: "The payer isn’t one of the people on this trip.", row: 7, what: "Rail pass" },
];
const HAND = { id: "handexp0001", day: "pre", title: "Rail pass", amount: 221.52, currency: "CAD", paidBy: "Mo", split: ["Trenton", "Mo", "Ajen"], note: NOTE_X7, kind: "" };

test("a first pull adds each included payment as an expense, as addExpense would, tied by planner_id, logged as from the planner", async () => {
  const call = linked();
  const rev = (await call("rev")).rev;
  const r = await call("syncPayments", {}, { actor: "Trenton" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data, reply({ added: 2, problems: PROBLEMS }));
  assert.equal(r.rev, rev + 2);
  const exps = (await call("load")).data.expenses;
  const x7 = exps.find((e) => e.note === NOTE_X7);
  assert.match(x7.id, /^[A-Za-z0-9]{20}$/);
  assert.deepEqual({ ...x7, id: "" }, { id: "", day: "2026-12-11", title: "Rail pass", amount: 221.52, currency: "CAD", rate: 111, paidBy: "Mo", split: ALL, splitMode: "equal", splitVals: [], note: NOTE_X7, kind: "transport", addedBy: "Mo", addedAt: "2026-12-12T03:00:00.000Z", deleted: false }); // credited to who paid
  assert.equal(stored(call, x7.id).planner_id, "X7");
  const q3 = exps.find((e) => e.note === "Q3 · Ramen Ya");
  assert.equal(stored(call, q3.id).planner_id, "Q3");
  assert.deepEqual([q3.title, q3.amount, q3.currency, q3.paidBy, q3.split, q3.day, q3.kind], ["Noodle bar", 3600, "JPY", "Ajen", ["Mo", "Ajen"], "2026-12-12", "food"]);
  assert.equal(exps.length, 2, "nothing for the personal, the unknown payer or the not-included rows");
  const log = call.fake.tables.Log;
  assert.deepEqual(log.map((l) => [l.who, l.via, l.action, l.kind]), [["Mo", "planner", "add", "expense"], ["Ajen", "planner", "add", "expense"]]);
  assert.deepEqual(log.map((l) => l.summary), ["rang up Rail pass $221.52", "rang up Noodle bar ¥3,600"]);
  const hist = await historyAll(call);
  assert.deepEqual(hist.map((e) => e.via), ["planner", "planner"]);
  const u = await call("undo", { logId: hist[0].id });
  assert.equal(u.ok, true);
  assert.equal(u.data.expense.deleted, true);
  assert.equal(stored(call, q3.id).planner_id, "Q3", "Undo of the add keeps the tie");
});

test("R40: planner_id is never in load, History, a Log row's before/after or an undo reply", async () => {
  const call = linked();
  await call("syncPayments");
  const x7 = byPayment(call, "X7")[0];
  const e = await call("updateExpense", { id: x7.id, patch: { title: "Rail pass 7d" } });
  const u = await call("undo", { logId: e.data.logId });
  const seen = JSON.stringify([await call("load"), await call("history"), e, u, call.fake.tables.Log]);
  assert.equal(/planner_?[iI]d/.test(seen), false);
});

test("a second pull straight after writes nothing and rev stays", async () => {
  const call = linked();
  await call("syncPayments");
  const rows = JSON.stringify(call.fake.tables);
  const rev = (await call("rev")).rev;
  const r = await call("syncPayments");
  assert.deepEqual(r.data, reply({ same: 2, problems: PROBLEMS }));
  assert.equal(r.rev, rev);
  assert.equal(JSON.stringify(call.fake.tables), rows);
});

test("fix 1 (the review's probe): a note edited in the app keeps the expense tied; the next pull adds nothing", async () => {
  const call = linked();
  await call("syncPayments");
  const id = byPayment(call, "X7")[0].id;
  await call("updateExpense", { id, patch: { note: "paid on Mo’s card" } });
  assert.equal(stored(call, id).planner_id, "X7", "an app edit leaves planner_id alone");
  const r = await call("syncPayments");
  assert.equal(r.data.added, 0);
  assert.equal(r.data.changed, 1, "the planner owns the note");
  assert.equal(live(call).filter((x) => x.planner_id === "X7").length, 1);
  const undo = await call("undo", { logId: call.fake.tables.Log.at(-1).id });
  assert.equal(undo.ok, true);
  assert.equal(stored(call, id).planner_id, "X7", "Undo of an edit keeps the tie");
});

test("a changed amount_cad changes that one expense: one edit, before/after differ only in amount, only that column written; Undo works", async () => {
  const call = linked();
  await call("syncPayments");
  const id = byPayment(call, "X7")[0].id;
  stored(call, id).split = "Mo, Ajen, Trenton"; // typed by hand: left as it is
  const logs = call.fake.tables.Log.length;
  call.fake.planner.rows = [PHEAD, prow({ ...PX7, amount_cad: 230.1 }), prow(PQ3)];
  const r = await call("syncPayments", {}, { actor: "Ajen" });
  assert.deepEqual(r.data, reply({ changed: 1, same: 1 }));
  assert.equal(call.fake.tables.Log.length, logs + 1);
  const edit = call.fake.tables.Log.at(-1);
  assert.deepEqual([edit.who, edit.via, edit.action, edit.ref, edit.summary], ["Mo", "planner", "edit", id, "changed Rail pass $221.52 → $230.10"] /* who paid, not the phone that asked */);
  const before = JSON.parse(edit.before);
  const after = JSON.parse(edit.after);
  assert.deepEqual(Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])), ["amount"]);
  assert.deepEqual([before.amount, after.amount], [221.52, 230.1]);
  assert.equal(stored(call, id).amount, 230.1);
  assert.equal(stored(call, id).split, "Mo, Ajen, Trenton", "a column the pull did not change is not written");
  const u = await call("undo", { logId: edit.id });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(u.data.expense.amount, 221.52);
});

test("each planner-owned field that differs is changed; day and kind are the app's and stay", async () => {
  const call = linked();
  await call("syncPayments");
  const id = byPayment(call, "X7")[0].id;
  await call("updateExpense", { id, patch: { day: "2026-12-13", kind: "activity" } });
  call.fake.planner.rows = [PHEAD, prow({ ...PX7, description: "Rail pass (7 days)", payer: "Ajen", split_between: "Trenton, Mo, Ajen", vendor: "North Rail Co", date_paid: "2026-12-10", category: "food" }), prow(PQ3)];
  const r = await call("syncPayments");
  assert.equal(r.data.changed, 1);
  const e = (await call("load")).data.expenses.find((x) => x.id === id);
  assert.deepEqual([e.title, e.paidBy, e.split, e.note, e.day, e.kind], ["Rail pass (7 days)", "Ajen", ALL, "X7 · North Rail Co · ref AB12 · ¥24,750 charged", "2026-12-13", "activity"]);
  assert.deepEqual(JSON.parse(call.fake.tables.Log.at(-1).after).split, ALL, "the same people in another order is the same split");
});

test("fix 9: a line set to exact amounts or shares is put back to an equal split, with or without a change of names", async () => {
  const call = linked();
  await call("syncPayments");
  const id = byPayment(call, "X7")[0].id;
  await call("updateExpense", { id, patch: { splitMode: "exact", splitVals: [100, 100, 21.52] } });
  let r = await call("syncPayments");
  assert.equal(r.data.changed, 1, JSON.stringify(r.data));
  let e = (await call("load")).data.expenses.find((x) => x.id === id);
  assert.deepEqual([e.splitMode, e.splitVals, e.split], ["equal", [], ALL]);

  await call("updateExpense", { id, patch: { splitMode: "parts", splitVals: [1, 2, 3] } });
  call.fake.planner.rows = [PHEAD, prow({ ...PX7, split_between: "Mo, Ajen" }), prow(PQ3)];
  r = await call("syncPayments");
  assert.deepEqual(r.data.problems, []);
  e = (await call("load")).data.expenses.find((x) => x.id === id);
  assert.deepEqual([e.splitMode, e.splitVals, e.split], ["equal", [], ["Mo", "Ajen"]]);
});

test("an expense deleted in the app is not brought back, nor changed, and counts as removed", async () => {
  const call = linked();
  await call("syncPayments");
  const id = byPayment(call, "X7")[0].id;
  await call("deleteExpense", { id });
  const logs = call.fake.tables.Log.length;
  call.fake.planner.rows = [PHEAD, prow({ ...PX7, amount_cad: 999 }), prow(PQ3)];
  const r = await call("syncPayments");
  assert.deepEqual(r.data, reply({ same: 1, removed: 1 }));
  assert.equal(call.fake.tables.Log.length, logs);
  assert.equal(byPayment(call, "X7").length, 1);
  assert.equal(byPayment(call, "X7")[0].amount, 221.52);
});

test("a payment no longer included leaves its expense as it is and is listed in notCounted", async () => {
  const call = linked();
  await call("syncPayments");
  const rows = JSON.stringify(call.fake.tables);
  call.fake.planner.rows = [PHEAD, prow({ ...PX7, include_in_split: "no", amount_cad: 5 }), prow(PQ3), prow(PZ1)];
  const r = await call("syncPayments");
  assert.deepEqual(r.data, reply({ same: 1, notCounted: ["X7"] }));
  assert.equal(JSON.stringify(call.fake.tables), rows);
});

test("R40 back-fill: a hand-rung line whose note starts with a payment id in the planner is tied once, that column only, with no Log row and no rev", async () => {
  const call = linked({ expenses: [HAND] }, [PHEAD, prow(PX7)]);
  const before = { ...call.fake.tables.Expenses[0] };
  const logs = call.fake.tables.Log.length;
  const rev = (await call("rev")).rev;
  const r = await call("syncPayments");
  assert.deepEqual(r.data, reply({ same: 1 }));
  assert.deepEqual(call.fake.tables.Expenses[0], { ...before, planner_id: "X7" });
  assert.equal(call.fake.tables.Log.length, logs);
  assert.equal(r.rev, rev);
  // Tied now: a note changed by hand afterwards does not untie it.
  await call("updateExpense", { id: HAND.id, patch: { note: "card" } });
  const again = await call("syncPayments");
  assert.deepEqual([again.data.added, again.data.changed], [0, 1]);
  assert.equal(live(call).length, 1);
});

test("R40 back-fill: a deleted hand-rung line is tied too (and stays deleted); a note naming an id the planner does not have is not tied", async () => {
  const call = linked({ expenses: [{ ...HAND, deleted: true }, { ...HAND, id: "handexp0002", note: "K9 · from a friend" }] }, [PHEAD, prow(PX7)]);
  const r = await call("syncPayments");
  assert.deepEqual(r.data, reply({ removed: 1 }));
  assert.equal(stored(call, "handexp0001").planner_id, "X7");
  assert.equal(stored(call, "handexp0002").planner_id, "");
  assert.equal(live(call).length, 1, "nothing added for X7");
  // An id that is in the planner but not included is back-filled as well.
  const two = linked({ expenses: [HAND] }, [PHEAD, prow({ ...PX7, include_in_split: "no" })]);
  assert.deepEqual((await two("syncPayments")).data, reply({ notCounted: ["X7"] }));
  assert.equal(stored(two, HAND.id).planner_id, "X7");
});

test("fix 2 (the review's probe): a payment renamed in the planner is added as new and the old line is listed as no longer in the planner", async () => {
  const call = linked({}, [PHEAD, prow(PX7)]);
  await call("syncPayments");
  call.fake.planner.rows = [PHEAD, prow({ ...PX7, payment_id: "X7b2" })];
  const r = await call("syncPayments");
  assert.deepEqual(r.data, reply({ added: 1, problems: [{ id: "X7", message: "That payment isn’t in the planner any more.", row: null, what: "Rail pass" }] }));
  // A deleted line no longer in the planner is not news.
  await call("deleteExpense", { id: byPayment(call, "X7")[0].id });
  assert.deepEqual((await call("syncPayments")).data, reply({ same: 1 }));
});

test("fix 3 (the review's probe): two live lines carrying one payment's id: a problem, and neither is changed", async () => {
  const call = linked({ expenses: [HAND, { ...HAND, id: "handexp0002", title: "Rail pass again" }] }, [PHEAD, prow({ ...PX7, amount_cad: 300 })]);
  const before = JSON.stringify(call.fake.tables.Log);
  const r = await call("syncPayments");
  assert.deepEqual(r.data, reply({ problems: [{ id: "X7", message: "Two lines carry this payment’s id.", row: 2, what: "Rail pass" }] }));
  assert.equal(JSON.stringify(call.fake.tables.Log), before);
  assert.deepEqual(call.fake.tables.Expenses.map((x) => x.amount), [221.52, 221.52]);
});

test("fix 4: a planner cannot be relinked from outside, and no problem repeats a planner cell's text", async () => {
  const call = linked();
  const other = "anotherSheetId_ABCDEFGHIJKLMNOP0123";
  assert.deepEqual(await call.fake({ key: KEY, action: "linkPlanner", args: { id: other } }), { ok: false, error: "bad_input", message: "The app asked for something the trip sheet doesn’t know how to do.", rev: 0 });
  assert.equal(call.fake.props.PLANNER_ID, PLANNER_ID);

  call.fake.planner.rows = [PHEAD, prow({ ...PX7, payer: "Secretname" }), prow({ ...PX7, payment_id: "Q4", split_between: "Mo, Othername" }), prow({ ...PX7, payment_id: "Has Space Hidden" }), prow({ ...PX7, payment_id: "W1", split_type: "Privatetype" })];
  const r = await call("syncPayments");
  const text = JSON.stringify(r);
  for (const cell of ["Secretname", "Othername", "Has Space", "Hidden", "Privatetype"]) assert.equal(text.includes(cell), false, cell);
  assert.deepEqual(r.data.problems.map((p) => p.id), ["", "X7", "Q4", "W1"]);
});

test("fix 5: at most 10 expenses written per pull, changes first then adds; Expenses read once per pull", async () => {
  const many = [PHEAD];
  for (let i = 1; i <= 25; i++) many.push(prow({ ...PX7, payment_id: "R" + i, description: "Row " + i, amount_cad: i }));
  const call = linked({}, many);
  const reads = () => call.fake.tableReads.Expenses || 0;
  const counts = [];
  for (let n = 0; n < 3; n++) {
    const was = reads();
    const r = await call("syncPayments");
    counts.push([r.data.added, r.data.more, reads() - was]);
  }
  // Read once to match, then twice per add inside addExpense_ (its own repeat check and read-back).
  assert.deepEqual(counts, [[10, true, 21], [10, true, 21], [5, false, 11]]);
  assert.equal(live(call).length, 25);
  const was = reads();
  assert.deepEqual((await call("syncPayments")).data, reply({ same: 25 }));
  assert.equal(reads() - was, 1, "a pull with nothing to write reads Expenses once");

  // Changes come before adds, in planner order.
  const next = many.map((row, i) => (i === 0 ? row : i === 25 ? prow({ ...PX7, payment_id: "R25", description: "Row 25", amount_cad: 99 }) : row));
  for (let i = 26; i <= 37; i++) next.push(prow({ ...PX7, payment_id: "R" + i, description: "Row " + i, amount_cad: i }));
  call.fake.planner.rows = next;
  const r = await call("syncPayments");
  assert.deepEqual([r.data.changed, r.data.added, r.data.more, r.data.same], [1, 9, true, 24]);
  assert.equal(byPayment(call, "R34").length, 1);
  assert.deepEqual(byPayment(call, "R35"), [], "the tenth write was the last");
});

test("fix 6: a tab with a missing column, an empty tab or none is refused as planner_columns; 300 rows read says capped", async () => {
  const call = linked();
  call.fake.planner.rows = [PHEAD.filter((h) => h !== "amount_cad"), prow(PX7)];
  assert.deepEqual(await call("syncPayments"), { ok: false, error: "planner_columns", message: "The planner’s Payments tab is missing the column amount_cad.", rev: 0 });
  for (const rows of [[], null]) {
    call.fake.planner.rows = rows;
    assert.deepEqual(await call("syncPayments"), { ok: false, error: "planner_columns", message: "The planner has no Payments tab to read.", rev: 0 });
  }
  assert.equal(call.fake.tables.Expenses.length, 0);

  const big = [PHEAD];
  for (let i = 1; i <= 301; i++) big.push(prow({ ...PX7, payment_id: "C" + i, include_in_split: "no" }));
  const capped = linked({}, big);
  assert.deepEqual((await capped("syncPayments")).data, reply({ capped: true }));
});

test("R40 migrate: an older Sheet gets Expenses.planner_id; until then a pull is refused rather than add untied lines", async () => {
  const call = linked({ missingColumns: ["Expenses.planner_id"] });
  assert.deepEqual(await call("syncPayments"), { ok: false, error: "needs_migrate", message: "The trip sheet needs updating first. Ask Mo to run migrate.", rev: 0 });
  assert.equal(call.fake.tables.Expenses.length, 0);
  const m = await call.fake({ key: KEY, action: "migrate", args: {} });
  assert.deepEqual(m.data, { added: ["Expenses.planner_id"] });
  assert.equal((await call("syncPayments")).data.added, 2);
  assert.equal(byPayment(call, "X7").length, 1);
});

test("a row the app's validation refuses is a problem, never stored, and the other rows still come in", async () => {
  const call = linked({}, [PHEAD, prow({ ...PX7, amount_cad: 20000000 }), prow({ ...PQ3, split_between: "Mo, mo" }), prow({ ...PX7, payment_id: "F1", description: "=SUM(1)", amount_cad: 12 })]);
  const r = await call("syncPayments");
  assert.deepEqual(r.data, reply({ added: 1, problems: [{ id: "X7", message: "That amount is too big.", row: 2, what: "Rail pass" }, { id: "Q3", message: "Someone is in the split twice.", row: 3, what: "Noodle bar" }] }));
  const f1 = byPayment(call, "F1")[0];
  assert.equal(stored(call, f1.id).title, "'=SUM(1)", "a formula-looking description is stored as text");
  assert.equal((await call("load")).data.expenses[0].title, "=SUM(1)");
  assert.equal((await call("syncPayments")).data.same, 1, "and reads back the same");
});

test("syncPayments: not linked, unreadable, no actor, the lock busy", async () => {
  const none = client({ planner: PLANNER });
  assert.deepEqual(await none("syncPayments"), { ok: false, error: "no_planner", message: "No planner sheet is linked yet. Ask Mo to link it.", rev: 0 });

  const call = linked();
  call.fake.planner.fails = true;
  const r = await call("syncPayments");
  assert.deepEqual(r, { ok: false, error: "planner_unreadable", message: "Couldn’t read the planner sheet. Ask Mo to check its permission.", rev: 0 });
  assert.equal(JSON.stringify(r).includes(PLANNER_ID), false);
  assert.equal(JSON.stringify(r).includes("boom"), false, "no exception text");
  assert.equal(call.fake.tables.Expenses.length, 0);
  call.fake.planner.fails = false;

  assert.equal((await call.fake({ key: KEY, action: "syncPayments", args: {} })).message, "Pick who you are first.");
  assert.equal((await call.fake({ key: "nope", actor: "Mo", action: "syncPayments", args: {} })).error, "bad_key");

  let busy = true;
  const locked = client({ planner: PLANNER, plannerId: PLANNER_ID }, { lockFails: () => busy });
  const reads = locked.fake.planner.reads;
  assert.equal((await locked("syncPayments")).error, "busy");
  assert.equal(locked.fake.planner.reads, reads + 1, "the planner is read before the lock is taken");
  assert.equal(locked.fake.tables.Expenses.length, 0);
  busy = false;
  assert.equal((await locked("syncPayments")).data.added, 2);
});

test("Log rows from a pull say planner whoever started it; an app body cannot claim planner, nor set planner_id", async () => {
  const call = linked();
  await call.fake.claude("syncPayments", {});
  assert.deepEqual(call.fake.tables.Log.map((l) => l.via), ["planner", "planner"]);
  await call("addExpense", { expense: { ...ramen(), plannerId: "X7", planner_id: "X7" } }, { via: "planner" });
  assert.equal(call.fake.tables.Log.at(-1).via, "app");
  assert.equal(stored(call, "exp0000001").planner_id, "");
  await call("updateExpense", { id: "exp0000001", patch: { planner_id: "X7" } });
  assert.equal(stored(call, "exp0000001").planner_id, "");
});

test("linkPlanner is gone (security): no key can set PLANNER_ID; the owner sets it in Script Properties", async () => {
  const call = client();
  for (const key of [KEY, ownKey(call, "Mo"), call.fake.CHECK_KEY]) {
    const r = await call.fake({ key, actor: "Mo", action: "linkPlanner", args: { id: PLANNER_ID } });
    assert.equal(r.ok, false);
    assert.equal(r.error, "bad_input");
  }
  assert.equal(call.fake.props.PLANNER_ID, undefined);
  assert.equal((await call("load")).data.plannerLinked, false);
  call.fake.props.PLANNER_ID = PLANNER_ID; // as the owner does in the script editor
  const load = await call("load");
  assert.equal(load.data.plannerLinked, true);
  assert.equal(JSON.stringify(load).includes(PLANNER_ID), false);
  assert.equal(call.fake.tables.Log.length, 0);
});

test("the planner id is never in a reply, a Log row or a History sentence", async () => {
  const call = linked();
  const replies = [await call("syncPayments"), await call("syncPayments"), await call("load"), await call("history")];
  call.fake.planner.rows = [PHEAD, prow({ ...PX7, amount_cad: 1 })];
  replies.push(await call("syncPayments"), await call("history"));
  call.fake.planner.fails = true;
  replies.push(await call("syncPayments"));
  assert.equal(JSON.stringify(replies).includes(PLANNER_ID), false);
  assert.equal(JSON.stringify(call.fake.tables).includes(PLANNER_ID), false);
});

// ---------- Task 16: a picture in each person's seal ----------

const JPEG = require("./fixtures/picture.json").jpeg;
const JPEG2 = JPEG.replace(/.{4}$/, "AAA="); // a second, different address of the same shape

test("migrate adds People.photo to an older Sheet once; until then a picture is refused, not lost", async () => {
  const call = client({ missingColumns: ["People.photo"] });
  assert.equal((await call("load")).data.people[0].photo, "");
  const early = await call("setPerson", { name: "Mo", patch: { photo: JPEG } });
  assert.deepEqual([early.ok, early.error, early.message], [false, "needs_migrate", "The trip sheet needs updating first. Ask Mo to run migrate."]);
  assert.equal(call.fake.tables.Log.length, 0);
  assert.equal((await asOwn(call, "Mo")("setPerson", { name: "Mo", patch: { etransfer: "m@example.com" } })).ok, true, "other details still change");
  assert.deepEqual((await call.fake({ key: KEY, action: "migrate", args: {} })).data, { added: ["People.photo"] });
  assert.deepEqual((await call.fake({ key: KEY, action: "migrate", args: {} })).data, { added: [] });
  assert.equal((await call("setPerson", { name: "Mo", patch: { photo: JPEG } })).ok, true);
  assert.equal((await call("load")).data.people[0].photo, JPEG);
});

test("each person sets, changes and removes their own picture: one History sentence each, load carries it", async () => {
  for (const name of ALL) {
    const call = client();
    const as = { actor: name };
    const set = await call("setPerson", { name, patch: { photo: JPEG } }, as);
    assert.equal(set.ok, true, JSON.stringify(set));
    assert.equal(set.data.person.photo, JPEG);
    assert.equal((await call("load")).data.people.find((p) => p.name === name).photo, JPEG);
    assert.equal((await call("setPerson", { name, patch: { photo: JPEG } }, as)).rev, 1, "the same picture again changes nothing");
    await call("setPerson", { name, patch: { photo: JPEG2 } }, as);
    await call("setPerson", { name, patch: { photo: "" } }, as);
    assert.equal((await call("load")).data.people.find((p) => p.name === name).photo, "");
    const h = await historyAll(call);
    assert.deepEqual(h.map((e) => [e.who, e.kind, e.ref, e.summary, e.canUndo]), [
      [name, "picture", name, "removed the picture", true],
      [name, "picture", name, "changed the picture", false],
      [name, "picture", name, "set a picture", false],
    ]);
    assert.equal(JSON.stringify(h).includes("data:image"), false, "history never carries the picture");
    const log = call.fake.tables.Log;
    assert.deepEqual(JSON.parse(log[0].before), { name, photo: "" });
    assert.deepEqual(JSON.parse(log[0].after), { name, photo: JPEG });
    assert.equal(call.fake.tables.People.find((p) => p.name === name).photo, "", "the cell is emptied, the row kept");
  }
});

test("nobody sets another person's picture; a name not on the trip is refused; a bad picture is refused", async () => {
  const call = client();
  const other = await call("setPerson", { name: "Ajen", patch: { photo: JPEG } });
  assert.deepEqual([other.ok, other.error, other.message], [false, "bad_input", "You can only change your own picture."]);
  const both = await call("setPerson", { name: "Ajen", patch: { etransfer: "a@example.com", photo: "" } });
  assert.equal(both.ok, false, "not even alongside an address");
  assert.equal((await call("setPerson", { name: "Nobody", patch: { photo: JPEG } }, { actor: "Nobody" })).error, "bad_input", "an actor not on the trip");
  const png = await call("setPerson", { name: "Mo", patch: { photo: "data:image/png;base64,iVBORw0KGgo=" } });
  assert.deepEqual([png.ok, png.error, png.message], [false, "bad_input", "That picture couldn’t be used. Try another."]);
  assert.equal(call.fake.tables.Log.length, 0);
  assert.ok(call.fake.tables.People.every((p) => !p.photo));
});

test("undo of a picture puts back what was there: none, the earlier picture, or the removed one", async () => {
  const call = client();
  const photoOf = async () => (await call("load")).data.people.find((p) => p.name === "Mo").photo;
  const top = async () => (await historyAll(call))[0];
  await call("setPerson", { name: "Mo", patch: { photo: JPEG } });
  let u = await call("undo", { logId: (await top()).id });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(u.data.person.photo, "");
  assert.equal(u.data.entry.summary, "undid: set a picture");
  assert.equal(await photoOf(), "");

  await call("setPerson", { name: "Mo", patch: { photo: JPEG } });
  await call("setPerson", { name: "Mo", patch: { photo: JPEG2 } });
  u = await call("undo", { logId: (await top()).id });
  assert.equal(u.data.person.photo, JPEG, "change undone: the earlier picture");
  assert.equal(await photoOf(), JPEG);

  await call("setPerson", { name: "Mo", patch: { photo: "" } });
  u = await call("undo", { logId: (await top()).id });
  assert.equal(await photoOf(), JPEG, "removal undone: the picture is back");
  assert.equal((await top()).canUndo, true, "and that undo can itself be undone");
  assert.equal(JSON.stringify(u).includes("undid: removed the picture"), true);
});

test("undo refuses to put back a picture a hand in the Log has spoiled", async () => {
  const call = client();
  await call("setPerson", { name: "Mo", patch: { photo: JPEG } });
  await call("setPerson", { name: "Mo", patch: { photo: JPEG2 } });
  const log = call.fake.tables.Log;
  const row = log[log.length - 1];
  for (const spoiled of ["javascript:alert(1)", "data:image/png;base64,iVBORw0KGgo=", "data:image/jpeg;base64,A", 12]) {
    row.before = JSON.stringify({ name: "Mo", photo: spoiled });
    const u = await call("undo", { logId: row.id });
    assert.deepEqual([u.ok, u.error, u.message], [false, "stale", "That change can’t be undone."], String(spoiled));
    assert.equal((await call("load")).data.people.find((p) => p.name === "Mo").photo, JPEG2, "the picture is left as it was");
  }
  row.before = JSON.stringify({ name: "Mo", photo: "" });
  const none = await call("undo", { logId: row.id });
  assert.equal(none.ok, true, "an empty picture can be put back: " + JSON.stringify(none));
  assert.equal((await call("load")).data.people.find((p) => p.name === "Mo").photo, "");
});

test("an older picture change cannot be undone over a newer one, and only its owner can undo it", async () => {
  const call = client();
  await call("setPerson", { name: "Mo", patch: { photo: JPEG } });
  const first = (await historyAll(call))[0];
  await call("setPerson", { name: "Mo", patch: { photo: JPEG2 } });
  assert.equal((await call("undo", { logId: first.id })).error, "stale");
  const last = (await historyAll(call))[0];
  const theirs = await call("undo", { logId: last.id }, { actor: "Ajen" });
  assert.deepEqual([theirs.ok, theirs.message], [false, "You can only change your own picture."]);
  assert.equal((await call("load")).data.people.find((p) => p.name === "Mo").photo, JPEG2);
});

// ---------- payments pulled on their own (Mo, 2026-11-17: "needs to be updated more often") ----------
// A phone asks with { auto: true } when it opens and every so often. Within 10
// minutes of the last pull the planner is not read again; the Fetch button and
// the connector (no auto) always read it.

test("auto pull: reads the planner, records when, and load says when", async () => {
  const at = { now: "2026-12-12T03:00:00.000Z" };
  const call = linked({}, PLANNER, { clock: () => at.now });
  assert.equal((await call("load")).data.paymentsPulledAt, "", "never pulled");
  const r = await call("syncPayments", { auto: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data, reply({ added: 2, problems: PROBLEMS }));
  assert.equal((await call("load")).data.paymentsPulledAt, "2026-12-12T03:00:00.000Z");
});

test("auto pull within 10 minutes of the last pull: the planner is not read, nothing is written, and the answer says skipped", async () => {
  const at = { now: "2026-12-12T03:00:00.000Z" };
  const call = linked({}, PLANNER, { clock: () => at.now });
  await call("syncPayments");
  const rev = (await call("rev")).rev;
  const reads = call.fake.planner.reads;
  at.now = "2026-12-12T03:09:59.000Z";
  // A new payment in the planner is not seen yet.
  call.fake.planner.rows.push(prow({ ...PX7, payment_id: "N9", description: "Late add" }));
  const r = await call("syncPayments", { auto: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { ...reply(), skipped: true });
  assert.equal(r.rev, rev, "nothing written");
  assert.equal(live(call).length, 2);
  assert.equal(call.fake.planner.reads, reads, "the planner was not read");
  assert.equal((await call("load")).data.paymentsPulledAt, "2026-12-12T03:00:00.000Z", "the time is the last real pull");
  // Ten minutes on, it reads again and brings the new one in.
  at.now = "2026-12-12T03:10:00.000Z";
  const again = await call("syncPayments", { auto: true });
  assert.equal(again.data.added, 1);
  assert.equal(again.data.skipped, undefined, "a real pull has no skipped field");
  assert.equal((await call("load")).data.paymentsPulledAt, "2026-12-12T03:10:00.000Z");
});

test("Fetch (no auto) always reads the planner, even a minute after a pull", async () => {
  const at = { now: "2026-12-12T03:00:00.000Z" };
  const call = linked({}, PLANNER, { clock: () => at.now });
  await call("syncPayments", { auto: true });
  at.now = "2026-12-12T03:01:00.000Z";
  call.fake.planner.rows.push(prow({ ...PX7, payment_id: "N9", description: "Late add" }));
  const r = await call("syncPayments");
  assert.equal(r.data.added, 1);
  assert.equal((await call("load")).data.paymentsPulledAt, "2026-12-12T03:01:00.000Z");
});

test("a pull that fails does not count as a pull: the next auto pull reads again", async () => {
  const at = { now: "2026-12-12T03:00:00.000Z" };
  const call = linked({}, [["payment_id"]], { clock: () => at.now });
  const bad = await call("syncPayments", { auto: true });
  assert.equal(bad.ok, false, "the planner is missing columns");
  assert.equal((await call("load")).data.paymentsPulledAt, "");
  const reads = call.fake.planner.reads;
  at.now = "2026-12-12T03:01:00.000Z";
  await call("syncPayments", { auto: true });
  assert.equal(call.fake.planner.reads, reads + 1, "a minute later it reads the planner again");
});

test("auto has to be true or false", async () => {
  const call = linked();
  const r = await call("syncPayments", { auto: "yes" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "bad_input");
});


// ---------- planner payments: loose ends from the review (2026-11-17) ----------

test("a planner line is credited to who paid, not to whichever phone asked", async () => {
  const call = linked();
  const r = await call("syncPayments", { auto: true }, { actor: "Trenton" });
  assert.equal(r.data.added, 2);
  const exps = (await call("load")).data.expenses;
  assert.equal(exps.find((e) => e.title === "Rail pass").addedBy, "Mo", "X7 was paid by Mo");
  assert.equal(exps.find((e) => e.title === "Noodle bar").addedBy, "Ajen", "Q3 was paid by Ajen");
  assert.deepEqual(call.fake.tables.Log.map((l) => [l.who, l.via]), [["Mo", "planner"], ["Ajen", "planner"]]);
});

test("a planner change is credited to who paid", async () => {
  const call = linked();
  await call("syncPayments", {}, { actor: "Trenton" });
  call.fake.planner.rows[1] = prow({ ...PX7, amount_cad: 230 });
  const r = await call("syncPayments", {}, { actor: "Ajen" });
  assert.equal(r.data.changed, 1);
  const last = call.fake.tables.Log[call.fake.tables.Log.length - 1];
  assert.deepEqual([last.who, last.via, last.action], ["Mo", "planner", "edit"]);
});

test("a pull cut short does not count as done: the next auto pull carries on at once", async () => {
  const at = { now: "2026-12-12T03:00:00.000Z" };
  const many = [PHEAD];
  for (let i = 1; i <= 14; i++) many.push(prow({ ...PX7, payment_id: "M" + i, description: "Thing " + i }));
  const call = linked({}, many, { clock: () => at.now });
  const first = await call("syncPayments", { auto: true });
  assert.deepEqual([first.data.added, first.data.more], [10, true]);
  assert.equal((await call("load")).data.paymentsPulledAt, "", "not recorded while more remain");
  at.now = "2026-12-12T03:00:20.000Z";
  const second = await call("syncPayments", { auto: true });
  assert.deepEqual([second.data.added, second.data.more, second.data.skipped], [4, false, undefined]);
  assert.equal((await call("load")).data.paymentsPulledAt, "2026-12-12T03:00:20.000Z");
});

test("a pull whose read is older than one that already landed writes nothing", async () => {
  // Pull A read the planner at 03:00:04; before A got the lock, pull B (read at 03:00:05) landed.
  const at = { now: "2026-12-12T03:00:00.000Z" };
  const call = linked({}, PLANNER, { clock: () => at.now });
  await call("syncPayments");
  const logged = call.fake.tables.Log.length;
  call.fake.planner.rows[1] = prow({ ...PX7, amount_cad: 199 }); // what A read: the old value
  call.fake.props.PAYMENTS_READ_AT = "2026-12-12T03:00:05.000Z"; // B has landed
  at.now = "2026-12-12T03:00:04.000Z";
  const a = await call("syncPayments", {}, { actor: "Trenton" });
  assert.equal(a.ok, true);
  assert.equal(a.data.skipped, true, "A's older read is dropped");
  assert.equal(call.fake.tables.Log.length, logged, "nothing written");
  assert.equal(call.fake.props.PAYMENTS_READ_AT, "2026-12-12T03:00:05.000Z");
  // A read made after B's goes through.
  at.now = "2026-12-12T03:00:06.000Z";
  const c = await call("syncPayments", {}, { actor: "Trenton" });
  assert.equal(c.data.changed, 1);
  assert.equal(call.fake.props.PAYMENTS_READ_AT, "2026-12-12T03:00:06.000Z");
});


// ---------- which payment needs a look (Task 22) ----------
// The last pull's problems are kept in PAYMENT_PROBLEMS so every phone gets
// them from load. Rows and descriptions here are made up.

const NOPROB = { at: "", list: [], more: 0 };
const badRows = (n) => {
  const rows = [PHEAD];
  for (let i = 1; i <= n; i++) rows.push(prow({ ...PX7, payment_id: "B" + i, description: "Bad " + i, payer: "Nadia" }));
  return rows;
};

test("a pull with one bad row stores it, and load hands it to any phone", async () => {
  const call = linked({}, [PHEAD, prow(PX7), prow({ ...PX7, payment_id: "U9", description: "Hotel   deposit", payer: "Nadia" })]);
  assert.deepEqual((await call("load")).data.paymentProblems, NOPROB, "never pulled");
  await call("syncPayments", {}, { actor: "Trenton" });
  const want = { at: "2026-12-12T03:00:00.000Z", list: [{ id: "U9", message: "The payer isn’t one of the people on this trip.", row: 3, what: "Hotel deposit" }], more: 0 };
  assert.deepEqual((await call("load", {}, { actor: "Ajen" })).data.paymentProblems, want);
  assert.deepEqual(JSON.parse(call.fake.props.PAYMENT_PROBLEMS), want);
});

test("a later clean pull stores an empty list, which clears the old one", async () => {
  let t = "2026-12-12T03:00:00.000Z";
  const call = linked({}, badRows(1), { clock: () => t });
  await call("syncPayments");
  assert.equal((await call("load")).data.paymentProblems.list.length, 1);
  call.fake.planner.rows = [PHEAD, prow(PX7)];
  t = "2026-12-12T04:00:00.000Z";
  await call("syncPayments");
  assert.deepEqual((await call("load")).data.paymentProblems, { at: t, list: [], more: 0 });
});

test("23 bad rows store the first 20 and more: 3; a message is cut to 160", async () => {
  const call = linked({}, badRows(23));
  await call("syncPayments");
  const got = (await call("load")).data.paymentProblems;
  assert.equal(got.list.length, 20);
  assert.equal(got.more, 3);
  assert.deepEqual(got.list.map((p) => p.id), Array.from({ length: 20 }, (_, i) => "B" + (i + 1)));
  assert.equal(got.list[19].row, 21);
  const raw = JSON.parse(call.fake.props.PAYMENT_PROBLEMS);
  assert.ok(raw.list.every((p) => p.message.length <= 160));
});

test("a skipped auto pull leaves the stored list alone", async () => {
  const call = linked({}, badRows(2));
  await call("syncPayments", { auto: true });
  const kept = call.fake.props.PAYMENT_PROBLEMS;
  assert.equal(JSON.parse(kept).list.length, 2);
  call.fake.planner.rows = [PHEAD, prow(PX7)];
  const r = await call("syncPayments", { auto: true });
  assert.equal(r.data.skipped, true);
  assert.equal(call.fake.props.PAYMENT_PROBLEMS, kept);
});

test("a pull cut short by the ten-write limit still stores what it found", async () => {
  const many = [PHEAD, prow({ ...PX7, payment_id: "U1", payer: "Nadia" })];
  for (let i = 1; i <= 12; i++) many.push(prow({ ...PX7, payment_id: "R" + i, description: "Row " + i, amount_cad: i }));
  const call = linked({}, many);
  const r = await call("syncPayments");
  assert.equal(r.data.more, true);
  assert.deepEqual((await call("load")).data.paymentProblems.list.map((p) => p.id), ["U1"]);
});

test("garbage in PAYMENT_PROBLEMS loads as the empty shape and never throws", async () => {
  const call = linked();
  for (const bad of ["{{not json", "null", "[]", '{"list":"x"}', '{"at":1,"list":[]}', '"text"', ""]) {
    call.fake.props.PAYMENT_PROBLEMS = bad;
    const r = await call("load");
    assert.equal(r.ok, true, bad);
    assert.deepEqual(r.data.paymentProblems, NOPROB, bad);
  }
});

test("a seeded paymentProblems comes back from load", async () => {
  const seeded = { at: "2026-12-12T01:00:00.000Z", list: [{ id: "Q1", message: "Why.", row: 9, what: "Thing" }], more: 2 };
  const call = linked({ paymentProblems: seeded });
  assert.deepEqual((await call("load")).data.paymentProblems, seeded);
});

test("an add writes no row onto the expense, and the problem list is not in the expense", async () => {
  const call = linked();
  await call("syncPayments");
  const x7 = stored(call, byPayment(call, "X7")[0].id);
  assert.equal("row" in x7, false);
  assert.equal(JSON.stringify(call.fake.tables.Expenses).includes('"row"'), false);
  assert.equal("row" in (await call("load")).data.expenses.find((e) => e.id === x7.id), false);
  const edit = call.fake.planner.rows;
  call.fake.planner.rows = edit.map((r) => (r[0] === "X7" ? r.map((c, i) => (PHEAD[i] === "amount_cad" ? 230.1 : c)) : r));
  await call("syncPayments");
  assert.equal(JSON.stringify(call.fake.tables.Log).includes('"row"'), false);
});
