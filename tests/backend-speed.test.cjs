// Issue 16: what a request costs in Sheet and Script Properties reads,
// measured through the fake backend's call counts (fake.calls), and the
// behaviour the cuts must keep. Every value here is made up.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFakeBackend } = require("./fake-backend.cjs");

const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "seed.json"), "utf8"));
const PLAN = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "plan.json"), "utf8"));
const SHARED = "test-key";
const BHEAD = ["#", "Item", "Who", "Book by", "Status", "Notes", "Booking link"];
const CHEAD = ["#", "Date / time", "Agent / session", "Tab", "Cell(s)", "Item", "Old value", "New value", "Why", "Proof / source", "Verified?"];
const BOOK = [BHEAD, ...Array.from({ length: 26 }, (_, i) => [i + 1, "Made-up item " + (i + 1), "", "2026-11-30", "Not booked", "", ""])];

// The owner's busiest case: the planner linked (26 Book Now items), the
// ticket desk set up, a personal key each for Mo (the owner) and Ajen.
function world() {
  const at = { now: "2026-11-20T15:00:00.000Z" };
  const fake = createFakeBackend({ ...SEED, ...PLAN, plannerId: "fakePlanner_made_up", desk: true, plannerTabs: { "Book Now": BOOK, "Change Log": [CHEAD] } }, { clock: () => at.now });
  const keys = { Mo: fake.personKey("Mo"), Ajen: fake.personKey("Ajen") };
  return { fake, keys, at };
}

// What one request cost: Sheet tab reads (People apart), and Script
// Properties calls as Apps Script makes them (plannerId_ is one read,
// deskReady_ two; getRateInfo_'s one read is the same before and after and
// left out).
function cost(c) {
  const n = (k) => c[k] || 0;
  return {
    sheetReads: n("readTable_") + n("readTableOrNull_") + n("columnValues_") + n("cellsAt_"),
    peopleRows: n("readTable_:People"),
    peopleNames: n("columnValues_:People"),
    props: n("getProp_") + n("getProps_") + n("plannerId_") + 2 * n("deskReady_"),
  };
}

async function measured(fake, body) {
  fake.resetCalls();
  const env = await fake(body);
  assert.equal(env.ok, true, JSON.stringify(env));
  return { env, cost: cost(fake.calls) };
}

// Before issue 16 (measured on origin/dev ac1e2f2 with the same counts):
// load as the owner 12 Sheet reads (People twice) and 11 property reads;
// load on Ajen's key 12 and 8; rev on a personal key 1 (all of People, with
// its pictures) and 3; load on the shared key 11 and 8; a write on a
// personal key read People twice; a pull over 26 existing items made 32
// property reads (one TODO_WAS_<#> an item) and read People twice.
test("issue 16 budgets: load, the 20-second check, a write and a pull", async () => {
  const { fake, keys, at } = world();
  await measured(fake, { key: keys.Mo, action: "syncTodos", args: { force: true } });
  at.now = "2026-11-20T15:05:00.000Z";
  await measured(fake, { key: keys.Mo, action: "syncTodos", args: { force: true } }); // 15 rows a pull: the rest
  at.now = "2026-11-20T15:10:00.000Z";
  const pull = await measured(fake, { key: keys.Mo, action: "syncTodos", args: { force: true } });
  assert.deepEqual(pull.cost, { sheetReads: 5, peopleRows: 1, peopleNames: 0, props: 7 }, "a pull over 26 items");

  // Issue 96: a person's first load of all (or one whose ready answer
  // changed) writes SEEN, reading it once more inside the lock; every other
  // load costs what it did.
  const first = await measured(fake, { key: keys.Mo, action: "load", args: { ready: true } });
  assert.deepEqual(first.cost, { sheetReads: 11, peopleRows: 1, peopleNames: 0, props: 4 }, "the owner's first load: SEEN read again under the lock");
  const owner = await measured(fake, { key: keys.Mo, action: "load", args: { ready: true } });
  assert.equal(owner.env.data.ticketList, true, "the owner's busiest load");
  assert.deepEqual(owner.cost, { sheetReads: 11, peopleRows: 1, peopleNames: 0, props: 3 }, "load as the owner");
  await measured(fake, { key: keys.Ajen, action: "load", args: {} });
  const ajen = await measured(fake, { key: keys.Ajen, action: "load", args: {} });
  assert.deepEqual(ajen.cost, { sheetReads: 11, peopleRows: 1, peopleNames: 0, props: 3 }, "load on Ajen's key");
  const rev = await measured(fake, { key: keys.Ajen, action: "rev", args: {} });
  assert.deepEqual(rev.cost, { sheetReads: 1, peopleRows: 0, peopleNames: 1, props: 3 }, "the 20-second check: People's name column only");
  const shared = await measured(fake, { key: SHARED, actor: "Mo", action: "load", args: {} });
  assert.deepEqual(shared.cost, { sheetReads: 11, peopleRows: 1, peopleNames: 0, props: 3 }, "load on the shared key");
  const sharedRev = await measured(fake, { key: SHARED, actor: "Mo", action: "rev", args: {} });
  assert.deepEqual(sharedRev.cost, { sheetReads: 0, peopleRows: 0, peopleNames: 0, props: 3 }, "rev on the shared key reads no People, as before");
  const write = await measured(fake, { key: keys.Ajen, action: "claimTodo", args: { id: "3", on: true } });
  assert.deepEqual(write.cost, { sheetReads: 3, peopleRows: 1, peopleNames: 0, props: 4 }, "a write on a personal key");
});

test("issue 16: the 20-second check still refuses a key whose person left the trip, and a blank name row counts for nobody", async () => {
  const { fake, keys } = world();
  assert.equal((await fake({ key: keys.Ajen, action: "rev", args: {} })).ok, true);
  fake.tables.People.find((r) => r.name === "Ajen").name = "";
  const gone = await fake({ key: keys.Ajen, action: "rev", args: {} });
  assert.deepEqual([gone.ok, gone.error], [false, "bad_key"]);
  assert.equal(typeof gone.rev, "number");
  const load = await fake({ key: keys.Ajen, action: "load", args: {} });
  assert.deepEqual([load.ok, load.error], [false, "bad_key"], "load the same");
  assert.equal((await fake({ key: keys.Mo, action: "rev", args: {} })).ok, true, "everyone else still in");
});

test("issue 16: load's rev is read before People, so it is never newer than the people it hands back", async () => {
  const { fake, keys } = world();
  const realRead = fake.world.readTable_;
  let wrote = false;
  // A change to People lands just after load has read it (another phone's
  // setPerson, as its lock would let it): People changes and REV moves on.
  fake.world.readTable_ = (tab) => {
    const rows = realRead(tab);
    if (tab === "People" && !wrote) {
      wrote = true;
      fake.tables.People.find((r) => r.name === "Ajen").initials = "ZZ";
      fake.props.REV = String(Number(fake.props.REV) + 1);
    }
    return rows;
  };
  const before = Number(fake.props.REV);
  const load = await fake({ key: keys.Mo, action: "load", args: {} });
  fake.world.readTable_ = realRead;
  assert.equal(load.ok, true);
  assert.equal(wrote, true);
  // Old people with the new rev would leave the phone on them until the next write.
  const seen = load.data.people.find((p) => p.name === "Ajen").initials;
  assert.ok(seen === "ZZ" || load.rev === before, "people from before the change come with a rev from before it (the phone's next check fetches again)");
  const again = await fake({ key: keys.Mo, action: "load", args: {} });
  assert.equal(again.data.people.find((p) => p.name === "Ajen").initials, "ZZ");
  assert.equal(again.rev, before + 1);
});

test("issue 16: load reads its Script Properties in one getProperties(), with the same answers", async () => {
  const { fake, keys } = world();
  fake.props.TODOS_PULLED_AT = "2026-11-20T14:00:00.000Z";
  fake.props.PAYMENTS_PULLED_AT = "2026-11-20T13:00:00.000Z";
  fake.props.TODO_PROBLEMS = JSON.stringify({ at: "2026-11-20T14:00:00.000Z", list: [{ id: "4", message: "Made-up problem.", row: 7, what: "x" }], more: 0 });
  fake.props.PAYMENT_PROBLEMS = "not json";
  fake.props.REV = "41";
  await fake({ key: keys.Mo, action: "load", args: {} }); // the first load writes SEEN (issue 96)
  fake.resetCalls();
  const load = await fake({ key: keys.Mo, action: "load", args: {} });
  assert.equal(fake.calls.getProps_, 1);
  assert.deepEqual(Object.keys(fake.calls).filter((k) => k.startsWith("getProp_:")).sort(), ["getProp_:PERSON_KEYS", "getProp_:TRIP_KEY"], "only the key check's own");
  assert.equal(load.rev, 41);
  assert.equal(load.data.plannerLinked, true);
  assert.equal(load.data.todosPulledAt, "2026-11-20T14:00:00.000Z");
  assert.equal(load.data.paymentsPulledAt, "2026-11-20T13:00:00.000Z");
  assert.deepEqual(load.data.todoProblems, { at: "2026-11-20T14:00:00.000Z", list: [{ id: "4", message: "Made-up problem.", row: 7, what: "x" }], more: 0 });
  assert.deepEqual(load.data.paymentProblems, { at: "", list: [], more: 0 });
  delete fake.props.REV; // properties reset: the Log's highest id, as rev_ does
  const noRev = await fake({ key: keys.Mo, action: "load", args: {} });
  assert.equal(noRev.rev, (await fake({ key: keys.Mo, action: "rev", args: {} })).rev);
  delete fake.props.TICKET_DESK_KEY;
  assert.equal((await fake({ key: keys.Mo, action: "load", args: {} })).data.ticketList, undefined, "no desk, no list");
  delete fake.props.PLANNER_ID;
  assert.equal((await fake({ key: keys.Mo, action: "load", args: {} })).data.plannerLinked, false);
});
