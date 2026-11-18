// The stamp in the place (location build, item 8), backend side: pressStamp
// may carry here: true (the phone was within 15 km of the day's place); the
// Stamps tab keeps "yes" in `here` and nothing else about where; load gives
// here: true on such a stamp. It never blocks a press; undo and History are
// unchanged.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../backend/Pure.js");
const { createFakeBackend } = require("./fake-backend.cjs");

const KEY = "test-key";
const DEFS = [
  { id: "d1", date: "2030-01-05", name_ja: "試験", name_en: "Testville", place: "Test Hall", motif: "lantern", ink: "shu", shape: "round" },
  { id: "d2", date: "2030-01-06", name_ja: "二", name_en: "Second", place: "Second Place", motif: "tower", ink: "ai", shape: "square" },
];
const IN_D1 = "2030-01-05T01:00:00.000Z";

function book(seed = {}) {
  const at = { now: IN_D1 };
  const fake = createFakeBackend(seed, { clock: () => at.now });
  for (const d of DEFS) fake.tables.StampDefs.push({ ...d });
  const call = (action, args = {}, actor = "Mo", extra = {}) => fake({ key: KEY, actor, action, args, ...extra });
  call.fake = fake;
  return call;
}

test("Stamps has a here column, and a stamp reads here: true only for yes", () => {
  assert.ok(P.TABS.Stamps.includes("here"));
  assert.equal(P.stampFromRow({ def: "d1", who: "Mo", at: IN_D1, seed: 3, here: "yes" }).here, true);
  for (const v of ["", "no", undefined, "YES "]) assert.equal("here" in P.stampFromRow({ def: "d1", who: "Mo", at: IN_D1, seed: 3, here: v }), false, String(v));
});

test("a press with here: true keeps yes, and load says so; without it, nothing", async () => {
  const call = book();
  const r = await call("pressStamp", { def: "d1", at: IN_D1, here: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.stamp.here, true);
  assert.equal(call.fake.tables.Stamps[0].here, "yes");
  const b = await call("pressStamp", { def: "d1", at: IN_D1 }, "Ajen");
  assert.equal("here" in b.data.stamp, false);
  assert.equal(call.fake.tables.Stamps[1].here, "");
  const stamps = (await call("load")).data.stamps;
  assert.deepEqual(stamps.map((s) => [s.who, s.here === true]), [["Mo", true], ["Ajen", false]]);
});

test("here that is not true is ignored, never refused; History and its snapshots say nothing of it", async () => {
  const call = book();
  for (const [who, here] of [["Mo", "yes"], ["Ajen", 1], ["Trenton", { lat: 35 }]]) {
    const r = await call("pressStamp", { def: "d1", at: IN_D1, here }, who);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal("here" in r.data.stamp, false);
  }
  const all = JSON.stringify(call.fake.tables.Stamps) + JSON.stringify(call.fake.tables.Log);
  assert.equal(all.includes("lat"), false);
  const h = (await call("history")).data.entries.map((e) => e.summary);
  assert.deepEqual(h, ["stamped Jan 5", "stamped Jan 5", "stamped Jan 5"]);
  const press = (await call("pressStamp", { def: "d2", at: IN_D1, here: true })).ok;
  assert.equal(press, false, "a closed day is refused as always, here or not");
});

test("undo lifts it as before; a press again sets here anew", async () => {
  const call = book();
  const first = (await call("pressStamp", { def: "d1", at: IN_D1, here: true })).data;
  const u = await call("undo", { logId: first.logId });
  assert.equal(u.ok, true);
  assert.equal((await call("load")).data.stamps.length, 0);
  assert.deepEqual(Object.keys(JSON.parse(call.fake.tables.Log.at(-1).after)).sort(), ["at", "day", "def", "gone", "seed", "who"]);
  const again = await call("pressStamp", { def: "d1", at: "2030-01-05T00:30:00.000Z" });
  assert.equal(again.ok, true);
  assert.equal("here" in again.data.stamp, false, "pressed elsewhere this time");
  assert.equal(call.fake.tables.Stamps[0].here, "");
});

test("an older Sheet with no here column: the press lands, with no mark", async () => {
  const call = book({ missingColumns: ["Stamps.here"] });
  const r = await call("pressStamp", { def: "d1", at: IN_D1, here: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal("here" in r.data.stamp, false);
  const m = await call.fake({ key: KEY, action: "migrate", args: {} });
  assert.deepEqual(m.data.added, ["Stamps.here"]);
});

test("through the connector a press is refused as before", async () => {
  const call = book();
  const r = await call.fake.claude("pressStamp", { def: "d1", at: IN_D1, here: true });
  assert.equal(r.ok, false);
});
