// The owner's roll call (issue 96): who has opened MAT on their own link, and
// what each phone last said about no signal. One Script Property, SEEN, kept
// by the real backend code (Pure.js seenFrom / seenAfter / rollFrom, and
// Actions.js load_) through the fake backend. Every name and date is made up.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFakeBackend } = require("./fake-backend.cjs");
const P = require("../backend/Pure.js");

const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "seed.json"), "utf8"));
const PLAN = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "plan.json"), "utf8"));
const SHARED = "test-key";
const NAMES = ["Mo", "Ajen", "Trenton"];
const T = { t: "claude-token" };
const rpc = (name, args) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

// A backend whose clock the test moves (at.now), with links made for `linked`
// on the days given (as issueLinks would: PERSON_KEYS keeps each link's day).
function world({ linked = { Mo: "2026-11-20T09:00:00.000Z", Ajen: "2026-11-22T09:00:00.000Z" }, now = "2026-11-25T10:00:00.000Z" } = {}) {
  const at = { now };
  const fake = createFakeBackend({ ...SEED, ...PLAN }, { clock: () => at.now });
  const keys = {};
  for (const [name, day] of Object.entries(linked)) {
    at.now = day;
    keys[name] = fake.personKey(name);
  }
  at.now = now;
  const load = (key, args = {}) => fake({ key, action: "load", args });
  const seen = () => (fake.props.SEEN === undefined ? undefined : JSON.parse(fake.props.SEEN));
  return { fake, keys, at, load, seen };
}

// ---------- pure ----------

test("seenFrom: unreadable, an array, a wrong shape are all empty", () => {
  for (const raw of [null, undefined, "", "not json", "[1,2]", "3", "null", '"x"', JSON.stringify([{ o: "2026-11-25" }])]) assert.deepEqual(P.seenFrom(raw), {}, String(raw));
  assert.deepEqual(
    P.seenFrom(JSON.stringify({
      Mo: { o: "2026-11-25", r: 1, d: "2026-11-26" },
      Ajen: { o: "2026-11-25" },
      Trenton: { o: "yesterday" },
      Dean: "x",
      Lee: { o: "2026-11-25", r: 2, d: "2026-11-26" },
      Kim: { o: "2026-11-25", r: 1 },
      "": { o: "2026-11-25" },
      Ann: { o: "2026-11-25", r: 0, d: "2026-11-27", extra: "dropped", t: "10:00" },
    })),
    { Mo: { o: "2026-11-25", r: 1, d: "2026-11-26" }, Ajen: { o: "2026-11-25" }, Lee: { o: "2026-11-25" }, Kim: { o: "2026-11-25" }, Ann: { o: "2026-11-25", r: 0, d: "2026-11-27" } },
  );
  assert.equal(Object.prototype.hasOwnProperty.call(P.seenFrom('{"__proto__":{"o":"2026-11-25"}}'), "__proto__"), false);
});

test("seenAfter: a first load writes the opened day once and never moves it", () => {
  const a = P.seenAfter({}, "Ajen", "2026-11-25", undefined, NAMES);
  assert.deepEqual(a, { seen: { Ajen: { o: "2026-11-25" } }, changed: true });
  const b = P.seenAfter(a.seen, "Ajen", "2026-11-27", undefined, NAMES);
  assert.deepEqual(b, { seen: { Ajen: { o: "2026-11-25" } }, changed: false });
  const c = P.seenAfter(b.seen, "Trenton", "2026-11-27", undefined, NAMES);
  assert.deepEqual(c.seen, { Ajen: { o: "2026-11-25" }, Trenton: { o: "2026-11-27" } });
  assert.equal(c.changed, true);
  assert.notEqual(c.seen, b.seen, "a new object");
  assert.deepEqual(b.seen, { Ajen: { o: "2026-11-25" } }, "the one given is not changed");
});

test("seenAfter: ready true or false is stored with its day only when it differs", () => {
  const a = P.seenAfter({}, "Ajen", "2026-11-25", false, NAMES);
  assert.deepEqual(a, { seen: { Ajen: { o: "2026-11-25", r: 0, d: "2026-11-25" } }, changed: true });
  const same = P.seenAfter(a.seen, "Ajen", "2026-11-26", false, NAMES);
  assert.deepEqual(same, { seen: { Ajen: { o: "2026-11-25", r: 0, d: "2026-11-25" } }, changed: false }, "the same answer a day later: its day stays");
  const yes = P.seenAfter(same.seen, "Ajen", "2026-11-26", true, NAMES);
  assert.deepEqual(yes, { seen: { Ajen: { o: "2026-11-25", r: 1, d: "2026-11-26" } }, changed: true });
  const no = P.seenAfter(yes.seen, "Ajen", "2026-11-27", false, NAMES);
  assert.deepEqual(no.seen.Ajen, { o: "2026-11-25", r: 0, d: "2026-11-27" });
  assert.equal(no.changed, true);
});

test("seenAfter: a non-boolean ready changes nothing", () => {
  const start = { Ajen: { o: "2026-11-25", r: 1, d: "2026-11-25" } };
  for (const ready of [undefined, null, "true", "false", 1, 0, {}, []]) {
    assert.deepEqual(P.seenAfter(start, "Ajen", "2026-11-27", ready, NAMES), { seen: start, changed: false }, JSON.stringify(ready));
  }
  assert.deepEqual(P.seenAfter({}, "Ajen", "2026-11-27", "true", NAMES).seen, { Ajen: { o: "2026-11-27" } }, "the open is noted, the string is not");
});

test("seenAfter: a name no longer on the trip is dropped", () => {
  const start = { Ajen: { o: "2026-11-25" }, Gone: { o: "2026-11-24", r: 1, d: "2026-11-24" } };
  assert.deepEqual(P.seenAfter(start, "Ajen", "2026-11-26", undefined, NAMES), { seen: { Ajen: { o: "2026-11-25" } }, changed: true });
  assert.deepEqual(P.seenAfter({ Ajen: { o: "2026-11-25" } }, "Ajen", "2026-11-26", undefined, NAMES).changed, false, "nothing dropped: unchanged");
  assert.deepEqual(P.seenAfter({}, "Stranger", "2026-11-26", true, NAMES), { seen: {}, changed: false }, "a name not on the trip is never added");
  assert.deepEqual(P.seenAfter({}, "Ajen", "not a day", true, NAMES), { seen: {}, changed: false });
});

test("rollFrom: one entry per person in trip order; a link's day only", () => {
  const seen = { Ajen: { o: "2026-11-25", r: 0, d: "2026-11-26" }, Mo: { o: "2026-11-20" } };
  const keys = { Mo: { hash: "h", at: "2026-11-20T09:00:00.000Z" }, Ajen: { hash: "h", at: "2026-11-22T09:00:00.000Z" }, Trenton: { hash: "h", at: "" } };
  assert.deepEqual(P.rollFrom(seen, NAMES, keys), [
    { name: "Mo", opened: "2026-11-20", ready: null, said: "", linkDay: "2026-11-20" },
    { name: "Ajen", opened: "2026-11-25", ready: false, said: "2026-11-26", linkDay: "2026-11-22" },
    { name: "Trenton", opened: "", ready: null, said: "", linkDay: "" },
  ]);
});

// ---------- through the backend ----------

test("a person's load writes SEEN once; a second load the same day writes nothing", async () => {
  const w = world();
  const writes = [];
  const realSet = w.fake.world.setProp_;
  w.fake.world.setProp_ = (k, v) => {
    writes.push(k);
    return realSet(k, v);
  };
  const r = await w.load(w.keys.Ajen);
  assert.equal(r.ok, true);
  assert.deepEqual(w.seen(), { Ajen: { o: "2026-11-25" } });
  assert.deepEqual(writes, ["SEEN"]);
  w.at.now = "2026-11-25T18:00:00.000Z";
  await w.load(w.keys.Ajen);
  await w.load(w.keys.Ajen, {});
  assert.deepEqual(writes, ["SEEN"], "nothing more written");
  w.at.now = "2026-11-28T08:00:00.000Z";
  await w.load(w.keys.Ajen);
  assert.deepEqual(w.seen(), { Ajen: { o: "2026-11-25" } }, "the first day stays");
  assert.deepEqual(writes, ["SEEN"]);
});

test("the check key, the shared key and the Claude connector write nothing and are answered no roll", async () => {
  const w = world();
  const check = await w.fake({ key: w.fake.CHECK_KEY, action: "load", args: { ready: true } });
  const shared = await w.fake({ key: SHARED, actor: "Mo", action: "load", args: { ready: true } });
  const claude = await w.fake.claude("load", { ready: true }, "Mo");
  for (const [who, r] of [["check", check], ["shared", shared], ["claude", claude]]) {
    assert.equal(r.ok, true, who);
    assert.equal("roll" in r.data, false, who + ": no roll key at all");
  }
  const trip = w.fake.mcp(rpc("get_trip", {}), T);
  assert.equal(JSON.stringify(trip).includes("roll"), false, "the connector's tools hand out nothing of it");
  assert.equal(JSON.stringify(trip).includes("linkDay"), false);
  assert.equal(w.fake.props.SEEN, undefined, "SEEN was never made");
});

test("only the first person's own link is answered roll; a friend's answer has no such key", async () => {
  const w = world();
  const ajen = await w.load(w.keys.Ajen, { ready: true });
  assert.equal("roll" in ajen.data, false);
  const mo = await w.load(w.keys.Mo);
  assert.equal(Array.isArray(mo.data.roll), true);
  assert.equal(mo.data.people[0].name, "Mo");
  // Trenton first on the trip: Mo is no longer the owner, and is answered no roll.
  w.fake.tables.People.find((r) => r.name === "Trenton").order = -1;
  const again = await w.load(w.keys.Mo);
  assert.equal(again.data.people[0].name, "Trenton");
  assert.equal("roll" in again.data, false);
});

test("a ready flag never changes rev and adds no History entry", async () => {
  const w = world();
  const before = (await w.fake({ key: w.keys.Ajen, action: "rev", args: {} })).rev;
  const logs = w.fake.tables.Log.length;
  for (const ready of [true, false, true]) {
    const r = await w.load(w.keys.Ajen, { ready });
    assert.equal(r.rev, before, "load's rev");
    w.at.now = new Date(Date.parse(w.at.now) + 86400000).toISOString();
  }
  assert.equal((await w.fake({ key: w.keys.Ajen, action: "rev", args: {} })).rev, before);
  assert.equal(w.fake.props.REV, "0");
  assert.equal(w.fake.tables.Log.length, logs, "no Log row");
  const hist = await w.fake({ key: w.keys.Mo, action: "history", args: {} });
  assert.equal(JSON.stringify(hist).includes("SEEN"), false);
  assert.equal(w.fake.logged.length + w.fake.consoleLines.length, 0, "nothing logged");
  assert.deepEqual(w.seen().Ajen, { o: "2026-11-25", r: 1, d: "2026-11-27" });
});

test("rev writes nothing", async () => {
  const w = world();
  const writes = [];
  w.fake.world.setProp_ = (k) => writes.push(k);
  for (const key of [w.keys.Ajen, w.keys.Mo, SHARED, w.fake.CHECK_KEY]) {
    const r = await w.fake({ key, actor: "Mo", action: "rev", args: { ready: true } });
    assert.equal(r.ok, true);
  }
  assert.deepEqual(writes, []);
  assert.equal(w.fake.props.SEEN, undefined);
});

test("roll gives opened, ready, said and linkDay per person in trip order; nothing else", async () => {
  const w = world();
  await w.load(w.keys.Ajen, { ready: false });
  w.at.now = "2026-11-26T23:30:00.000Z";
  const mo = await w.load(w.keys.Mo, { ready: true });
  assert.deepEqual(mo.data.roll, [
    { name: "Mo", opened: "2026-11-26", ready: true, said: "2026-11-26", linkDay: "2026-11-20" },
    { name: "Ajen", opened: "2026-11-25", ready: false, said: "2026-11-25", linkDay: "2026-11-22" },
    { name: "Trenton", opened: "", ready: null, said: "", linkDay: "" },
  ]);
  for (const e of mo.data.roll) assert.deepEqual(Object.keys(e), ["name", "opened", "ready", "said", "linkDay"]);
  assert.equal(JSON.stringify(mo.data.roll).includes(w.keys.Mo), false);
  // What is stored: two facts a person, days only.
  assert.deepEqual(w.seen(), { Ajen: { o: "2026-11-25", r: 0, d: "2026-11-25" }, Mo: { o: "2026-11-26", r: 1, d: "2026-11-26" } });
  assert.equal(/T\d|:\d\d/.test(w.fake.props.SEEN), false, "no time of day");
});

test("a broken SEEN does not fail load and is put right by the next write", async () => {
  const w = world();
  for (const broken of ["not json", "[1]", '{"Ajen":"x"}', "{"]) {
    w.fake.props.SEEN = broken;
    const r = await w.load(w.keys.Mo);
    assert.equal(r.ok, true, broken);
    assert.equal(Array.isArray(r.data.roll), true);
    assert.deepEqual(JSON.parse(w.fake.props.SEEN), { Mo: { o: "2026-11-25" } }, "overwritten: " + broken);
  }
  // The write itself failing, or the lock busy: the load still answers, and the next load writes.
  w.fake.props.SEEN = "broken";
  const realSet = w.fake.world.setProp_;
  w.fake.world.setProp_ = () => {
    throw new Error("Service invoked too many times");
  };
  const failed = await w.load(w.keys.Ajen, { ready: true });
  assert.equal(failed.ok, true);
  assert.equal(w.fake.props.SEEN, "broken");
  w.fake.world.setProp_ = realSet;
  const realLock = w.fake.world.withLock_;
  w.fake.world.withLock_ = () => ({ ok: false, error: "busy", message: "Someone else is saving right now. Try again in a moment." });
  const busy = await w.load(w.keys.Ajen, { ready: true });
  assert.equal(busy.ok, true);
  assert.equal(w.fake.props.SEEN, "broken");
  w.fake.world.withLock_ = realLock;
  await w.load(w.keys.Ajen, { ready: true });
  assert.deepEqual(JSON.parse(w.fake.props.SEEN), { Ajen: { o: "2026-11-25", r: 1, d: "2026-11-25" } });
  assert.equal(w.fake.consoleLines.join("\n").includes("SEEN"), false, "nothing about SEEN is logged");
});

test("two loads at once keep both people's entries", async () => {
  const w = world({ linked: { Mo: "2026-11-20T09:00:00.000Z", Ajen: "2026-11-22T09:00:00.000Z", Trenton: "2026-11-23T09:00:00.000Z" } });
  // Ajen's load has read SEEN (empty) and is waiting for the lock while
  // Trenton's load, which read the same empty SEEN, writes first.
  const realLock = w.fake.world.withLock_;
  let once = true;
  w.fake.world.withLock_ = (fn) => {
    if (once) {
      once = false;
      w.fake.world.handle_({ key: w.keys.Trenton, action: "load", args: { ready: false } });
    }
    return realLock(fn);
  };
  const r = await w.load(w.keys.Ajen, { ready: true });
  assert.equal(r.ok, true);
  assert.deepEqual(w.seen(), { Trenton: { o: "2026-11-25", r: 0, d: "2026-11-25" }, Ajen: { o: "2026-11-25", r: 1, d: "2026-11-25" } });
  w.fake.world.withLock_ = realLock;
});

test("a friend cannot write another person's entry: the name is the key's, never the actor's", async () => {
  const w = world();
  await w.fake({ key: w.keys.Ajen, actor: "Trenton", action: "load", args: { ready: true, name: "Trenton", who: "Trenton" } });
  assert.deepEqual(Object.keys(w.seen()), ["Ajen"]);
});
