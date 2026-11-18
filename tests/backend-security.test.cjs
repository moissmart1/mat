// Security release (2026-11-18): a personal key per person, a read-only check
// key, the shared key retired by the owner. Through the fake backend, which
// runs the real Pure.js, Keys.js, Actions.js, Mcp.js and Setup.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { createFakeBackend, sha256 } = require("./fake-backend.cjs");
const P = require("../backend/Pure.js");

const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "seed.json"), "utf8"));
const PLAN = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "plan.json"), "utf8"));
const SHARED = "test-key";
const T = { t: "claude-token" };
const rpc = (name, args) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
const ramen = (id = "exp0000001", paidBy = "Mo") => ({ id, day: "2026-12-12", title: "Ramen", amount: 1200, currency: "JPY", paidBy, split: ["Mo", "Ajen", "Trenton"] });

// A backend with a personal key for each name given; keys[name] is the key.
function world(names = ["Mo", "Ajen", "Trenton"], seed = { ...SEED, ...PLAN }) {
  const fake = createFakeBackend(seed);
  const keys = {};
  for (const n of names) keys[n] = fake.personKey(n);
  const as = (key, action, args = {}, extra = {}) => fake({ key, action, args, ...extra });
  return { fake, keys, as };
}

// Every key and token the world knows, to look for in logs and replies.
const secretsOf = (w) => [SHARED, "claude-token", w.fake.CHECK_KEY, ...Object.values(w.keys)];
const holdsSecret = (w, text) => secretsOf(w).some((s) => String(text).includes(s));

// ---------- pure helpers ----------

test("hexOfBytes reads Apps Script's signed bytes as their low 8 bits", () => {
  assert.equal(P.hexOfBytes([0, 1, 15, 16, 127, -128, -1]), "00010f107f80ff");
  const digest = [...crypto.createHash("sha256").update("abc").digest()].map((b) => (b > 127 ? b - 256 : b));
  assert.equal(P.hexOfBytes(digest), sha256("abc"));
});

test("personKeysFrom keeps only well-formed entries; anything else is no keys", () => {
  const h = sha256("k");
  assert.deepEqual(P.personKeysFrom(JSON.stringify({ Mo: { hash: h, at: "2026-11-18T00:00:00Z" }, Ajen: { hash: "short" }, "": { hash: h }, Trenton: "x" })), { Mo: { hash: h, at: "2026-11-18T00:00:00Z" } });
  for (const raw of [null, "", "not json", "[1]", "3", "null"]) assert.deepEqual(P.personKeysFrom(raw), {}, String(raw));
});

test("keyHolder: person, check, shared or null; an empty key or a retired shared key never matches", () => {
  const people = { Mo: { hash: sha256("mo-key") }, Ajen: { hash: sha256("ajen-key") } };
  const check = sha256("check-key");
  const who = (k, shared = "shared-key") => P.keyHolder(k, sha256(k), shared, people, check);
  assert.deepEqual(who("mo-key"), { kind: "person", name: "Mo" });
  assert.deepEqual(who("ajen-key"), { kind: "person", name: "Ajen" });
  assert.deepEqual(who("check-key"), { kind: "check" });
  assert.deepEqual(who("shared-key"), { kind: "shared" });
  assert.equal(who("shared-key", null), null, "no TRIP_KEY: no shared key at all");
  assert.equal(who("", ""), null);
  assert.equal(P.keyHolder("", sha256(""), "", { X: { hash: sha256("") } }, sha256("")), null, "an empty key never matches, even an empty key's hash");
  assert.equal(who("nope"), null);
  assert.equal(P.keyHolder("mo-key", "nothex", "shared-key", people, check), null);
  assert.equal(P.keyHolder(undefined, undefined, "shared-key", people, check), null);
});

test("keyHolder compares every stored hash, whatever matches first (no early exit)", () => {
  const seen = [];
  const people = {};
  for (const n of ["A", "B", "C"]) people[n] = { get hash() { seen.push(n); return sha256(n + "-key"); } };
  P.keyHolder("A-key", sha256("A-key"), "", people, sha256("c"));
  assert.deepEqual(seen, ["A", "B", "C"]);
});

test("blankSecrets hides each secret and anything shaped like a key, token or id", () => {
  const t = P.blankSecrets("boom k=abc12 and Requested entity was not found: 1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", ["abc12"]);
  assert.equal(t, "boom k=(hidden) and Requested entity was not found: (hidden)");
  assert.equal(P.blankSecrets("Cannot read properties of undefined (reading 'id')", []), "Cannot read properties of undefined (reading 'id')");
});

// ---------- the Apps Script glue ----------

test("Env.js: sha256Hex_ uses Utilities.computeDigest (SHA-256, UTF-8); newPersonKey_ is two UUIDs, 64 hex", () => {
  const asked = [];
  const ctx = vm.createContext({
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" },
      Charset: { UTF_8: "UTF_8" },
      computeDigest: (alg, text, cs) => { asked.push([alg, text, cs]); return [...crypto.createHash("sha256").update(text, "utf8").digest()].map((b) => (b > 127 ? b - 256 : b)); },
      getUuid: () => crypto.randomUUID(),
    },
  });
  for (const f of ["Pure.js", "Env.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "backend", f), "utf8"), ctx);
  assert.equal(ctx.sha256Hex_("café"), sha256("café"));
  assert.deepEqual(asked, [["SHA_256", "café", "UTF_8"]]);
  const k = ctx.newPersonKey_();
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.notEqual(k, ctx.newPersonKey_());
});

test("CheckKey.js holds only the hash, as given in the brief", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "backend", "CheckKey.js"), "utf8");
  assert.match(src, /^var CHECK_KEY_HASH = "f2f89b3b2b97f6b6cbdb1ffb78d6124b8f7394a1f8ba693e6ca1c3fe358a6aea";$/m);
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  assert.match(ctx.CHECK_KEY_HASH, /^[0-9a-f]{64}$/);
});

test("appsscript.json asks for no new permission (the three scopes as before)", () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "backend", "appsscript.json"), "utf8"));
  assert.deepEqual(m.oauthScopes, ["https://www.googleapis.com/auth/spreadsheets.currentonly", "https://www.googleapis.com/auth/script.external_request", "https://www.googleapis.com/auth/spreadsheets"]);
  for (const f of fs.readdirSync(path.join(__dirname, "..", "backend")).filter((f) => f.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(__dirname, "..", "backend", f), "utf8");
    assert.equal(/getUi\(|newTrigger\(|ScriptApp\.newTrigger/.test(src), false, f + " has no dialog and no trigger");
  }
});

// ---------- who is calling ----------

test("each holder kind: a person is that person, the shared key as before, the check key reads only, anything else bad_key", async () => {
  const w = world();
  const mine = await w.as(w.keys.Ajen, "load");
  assert.deepEqual([mine.ok, mine.data.me, mine.data.personal], [true, "Ajen", true]);
  const shared = await w.as(SHARED, "load");
  assert.deepEqual([shared.ok, shared.data.me, shared.data.personal], [true, "", false]);
  const check = await w.as(w.fake.CHECK_KEY, "load");
  assert.deepEqual([check.ok, check.data.me, check.data.personal], [true, "", false]);
  assert.ok(check.data.days.length > 0, "the check key sees the days (the release check waits for them)");
  for (const key of ["", undefined, null, 42, "wrong", w.keys.Ajen.slice(1), w.keys.Ajen + "0", w.keys.Ajen.toUpperCase(), sha256(w.keys.Ajen)]) {
    const r = await w.as(key, "load");
    assert.deepEqual([r.ok, r.error, r.data], [false, "bad_key", undefined], String(key));
  }
});

test("with TRIP_KEY missing there is no shared key at all; personal keys and the check key still work", async () => {
  const w = world();
  delete w.fake.props.TRIP_KEY;
  w.fake.primitives.forgetTripKey_();
  for (const key of [SHARED, "", undefined]) assert.equal((await w.as(key, "load")).error, "bad_key", String(key));
  assert.equal((await w.as(w.keys.Mo, "load")).ok, true);
  assert.equal((await w.as(w.fake.CHECK_KEY, "rev")).ok, true);
});

test("another person's key makes the request theirs; body.actor is ignored under a personal key", async () => {
  const w = world();
  const r = await w.as(w.keys.Ajen, "addExpense", { expense: ramen("exp0000001", "Ajen") }, { actor: "Mo" });
  assert.equal(r.ok, true);
  assert.equal(r.data.expense.addedBy, "Ajen");
  assert.equal(w.fake.tables.Log.at(-1).who, "Ajen");
  // An old phone's queued line still names its own actor: written as the key's person.
  const old = await w.as(w.keys.Trenton, "addExpense", { expense: ramen("exp0000002") }, { actor: "Mo", via: "app" });
  assert.equal(old.data.expense.addedBy, "Trenton");
  // No actor at all is fine on a personal key; on the shared key it still needs one.
  assert.equal((await w.as(w.keys.Mo, "addExpense", { expense: ramen("exp0000003") })).ok, true);
  const noActor = await w.as(SHARED, "addExpense", { expense: ramen("exp0000004") });
  assert.deepEqual([noActor.ok, noActor.error], [false, "bad_input"]);
  // The shared key still takes the phone's word, as before.
  assert.equal((await w.as(SHARED, "addExpense", { expense: ramen("exp0000005") }, { actor: "Ajen" })).data.expense.addedBy, "Ajen");
});

test("a key whose person is no longer on the trip opens nothing", async () => {
  const w = world();
  const ghost = w.fake.personKey("Somebody");
  assert.equal((await w.as(ghost, "load")).error, "bad_key");
});

test("a cancelled link is refused on the very next request; a replaced link: the old one refused, the new one works", async () => {
  const w = world();
  assert.equal((await w.as(w.keys.Ajen, "rev")).ok, true);
  w.fake.world.cancelLinkForPerson2();
  assert.equal((await w.as(w.keys.Ajen, "rev")).error, "bad_key");
  assert.equal((await w.as(w.keys.Mo, "rev")).ok, true, "the others keep theirs");
  assert.deepEqual(w.fake.logged, ["Ajen: link cancelled."]);

  w.fake.logged.length = 0;
  w.fake.world.newLinkForPerson3();
  assert.equal((await w.as(w.keys.Trenton, "rev")).error, "bad_key", "the old link stops at once");
  const line = w.fake.logged.find((l) => l.startsWith("Trenton’s link: "));
  const fresh = /#k=([0-9a-f]{64})$/.exec(line)[1];
  assert.notEqual(fresh, w.keys.Trenton);
  const r = await w.as(fresh, "load");
  assert.deepEqual([r.ok, r.data.me], [true, "Trenton"]);
  assert.equal(w.fake.props.PERSON_KEYS.includes(fresh), false, "only its hash is stored");
});

// ---------- only yourself ----------

test("e-Transfer: your own on your link; anyone else's refused; any change refused on the shared key", async () => {
  const w = world();
  const self = await w.as(w.keys.Ajen, "setPerson", { name: "Ajen", patch: { etransfer: "a@example.com" } });
  assert.equal(self.ok, true);
  const other = await w.as(w.keys.Ajen, "setPerson", { name: "Mo", patch: { etransfer: "evil@example.com" } });
  assert.deepEqual([other.ok, other.error, other.message], [false, "bad_input", "You can only change your own settings."]);
  for (const actor of ["Mo", "Ajen"]) {
    const shared = await w.as(SHARED, "setPerson", { name: "Ajen", patch: { etransfer: "evil@example.com" } }, { actor });
    assert.deepEqual([shared.ok, shared.error, shared.message], [false, "bad_input", "Open your own link to change an e-Transfer address."], actor);
  }
  const cleared = await w.as(SHARED, "setPerson", { name: "Ajen", patch: { etransfer: "" } }, { actor: "Ajen" });
  assert.equal(cleared.ok, false, "clearing one is a change too");
  const people = (await w.as(SHARED, "load")).data.people;
  assert.deepEqual(people.map((p) => p.etransfer), ["", "a@example.com", ""]);
  // Simplify and the same address unchanged still go through on the shared key (as before).
  assert.equal((await w.as(SHARED, "setPerson", { name: "Ajen", patch: { simplify: false, etransfer: "a@example.com" } }, { actor: "Ajen" })).ok, true);
  // Under a personal key, nothing of another person's row: not their Simplify either.
  assert.equal((await w.as(w.keys.Mo, "setPerson", { name: "Ajen", patch: { simplify: true } })).error, "bad_input");
  assert.equal(w.fake.tables.People.find((p) => p.name === "Ajen").etransfer, "a@example.com");
});

test("the shared-key e-Transfer refusal holds before any personal link exists", async () => {
  const fake = createFakeBackend({ ...SEED });
  assert.equal(fake.props.PERSON_KEYS, undefined);
  const r = await fake({ key: SHARED, actor: "Mo", action: "setPerson", args: { name: "Mo", patch: { etransfer: "m@example.com" } } });
  assert.deepEqual([r.ok, r.message], [false, "Open your own link to change an e-Transfer address."]);
});

test("a picture is only ever your own; on your link the name you send must be yours", async () => {
  const JPEG = require("./fixtures/picture.json").jpeg;
  const w = world();
  assert.equal((await w.as(w.keys.Mo, "setPerson", { name: "Mo", patch: { photo: JPEG } })).ok, true);
  assert.equal((await w.as(w.keys.Ajen, "setPerson", { name: "Mo", patch: { photo: "" } })).ok, false);
  const log = w.fake.tables.Log.at(-1);
  assert.equal((await w.as(w.keys.Ajen, "undo", { logId: Number(log.id) })).ok, false, "nor undo someone else's");
  assert.equal(w.fake.tables.People[0].photo, JPEG);
});

test("a claim on a Before item: on your link you can't take over someone else's or undo their claim; the shared key keeps Take it over", async () => {
  const BOOK = [["#", "Item", "Book by", "Status"], [1, "JR pass", "2026-12-01", ""]];
  const w = world(["Mo", "Ajen", "Trenton"], { ...SEED, plannerId: "plannerid0000000000000000000x", plannerTabs: { "Book Now": BOOK, "Change Log": [["#", "Tab", "Old value", "New value"]] } });
  assert.equal((await w.as(w.keys.Mo, "syncTodos", { force: true })).ok, true);
  const mine = await w.as(w.keys.Ajen, "claimTodo", { id: "1", on: true });
  assert.equal(mine.ok, true);
  const over = await w.as(w.keys.Mo, "claimTodo", { id: "1", on: true });
  assert.deepEqual([over.ok, over.message], [false, "Someone else is on this one. Ask them to hand it back first."]);
  const undo = await w.as(w.keys.Mo, "undo", { logId: mine.data.logId });
  assert.equal(undo.ok, false);
  assert.equal(w.fake.tables.Todos[0].claimed_by, "Ajen");
  assert.equal((await w.as(w.keys.Ajen, "undo", { logId: mine.data.logId })).ok, true, "they can undo their own");
  assert.equal((await w.as(w.keys.Ajen, "claimTodo", { id: "1", on: true })).ok, true);
  const shared = await w.as(SHARED, "claimTodo", { id: "1", on: true }, { actor: "Mo" });
  assert.equal(shared.ok, true, "the shared key behaves as before");
  // Ticking off stays for everyone (a shared booking, not one person's own).
  assert.equal((await w.as(w.keys.Trenton, "tickTodo", { id: "1" })).ok, true);
});

test("stamps are pressed as the key's person only, whatever the phone says", async () => {
  const at = "2030-01-05T01:00:00.000Z";
  const fake = createFakeBackend({}, { clock: () => at });
  fake.tables.StampDefs.push({ id: "d1", date: "2030-01-05", name_ja: "試験", name_en: "Testville", place: "Test Hall", motif: "lantern", ink: "shu", shape: "round" });
  const key = fake.personKey("Ajen");
  const r = await fake({ key, actor: "Mo", action: "pressStamp", args: { def: "d1", at } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.data.stamp.who, fake.tables.Stamps[0].id], ["Ajen", "d1|Ajen"]);
  const undo = await fake({ key: fake.personKey("Mo"), action: "undo", args: { logId: r.data.logId } });
  assert.deepEqual([undo.ok, undo.message], [false, "You can only change your own stamp."]);
});

// ---------- the check key ----------

test("the check key may load, rev, history and migrate, and nothing else; its load hides e-Transfer addresses", async () => {
  const w = world();
  await w.as(w.keys.Mo, "setPerson", { name: "Mo", patch: { etransfer: "mo@example.com" } });
  const C = w.fake.CHECK_KEY;
  for (const a of ["load", "rev", "history", "migrate"]) assert.equal((await w.as(C, a)).ok, true, a);
  const before = JSON.stringify(w.fake.tables);
  const writes = ["addExpense", "updateExpense", "deleteExpense", "restoreExpense", "addPayment", "removePayment", "restorePayment", "setPerson", "addStop", "updateStop", "deleteStop", "restoreStop", "saveStay", "deleteStay", "restoreStay", "setDay", "undo", "tickTodo", "claimTodo", "pressStamp", "syncPayments", "syncTodos", "locate", "claudeLink", "linkPlanner", "nope"];
  for (const a of writes) {
    const r = await w.as(C, a, { expense: ramen("exp0000009"), name: "Mo", patch: { etransfer: "x@example.com" }, id: "seedexp001", logId: 1 }, { actor: "Mo" });
    assert.deepEqual([r.ok, r.error, r.message], [false, "bad_input", "This key can only read the trip."], a);
  }
  assert.equal(JSON.stringify(w.fake.tables), before, "nothing changed");
  const load = (await w.as(C, "load")).data;
  assert.deepEqual(load.people.map((p) => p.etransfer), ["", "", ""]);
  assert.equal(JSON.stringify(load).includes("mo@example.com"), false);
});

// ---------- the Claude link and the connector ----------

test("the connector keeps working after TRIP_KEY is gone, and writes as the owner", () => {
  const w = world();
  delete w.fake.props.TRIP_KEY;
  w.fake.primitives.forgetTripKey_();
  const r = w.fake.mcp(rpc("add_stop", { date: "2026-12-12", title: "Tower" }), { ...T, as: "Trenton" });
  assert.notEqual(r.result.isError, true, JSON.stringify(r));
  assert.deepEqual([w.fake.tables.Log.at(-1).who, w.fake.tables.Log.at(-1).via], ["Mo", "claude"]);
  const trip = w.fake.mcp(rpc("get_trip", {}), T);
  assert.ok(JSON.parse(trip.result.content[0].text).days.length > 0);
  assert.equal(w.fake.mcp(rpc("get_trip", {}), { t: "wrong" }).error.code, -32001, "the token check is unchanged");
});

test("the connector cannot reach claudeLink, migrate or locate", () => {
  const w = world();
  for (const action of ["claudeLink", "migrate", "locate", "setPerson", "claimTodo"]) {
    const r = w.fake.world.handleAs_({ kind: "claude", name: "Mo" }, { action, args: {} });
    assert.equal(r.ok, false, action);
  }
});

// ---------- the owner functions ----------

test("issueLinks makes a link for each person without one, logs each once, and stores only hashes", async () => {
  const fake = createFakeBackend({ ...SEED });
  fake.props.SITE_URL = "https://example.test/mat/";
  fake.world.issueLinks();
  const lines = fake.logged.slice();
  assert.equal(lines.length, 3);
  const links = lines.map((l) => /^(\w+)’s link: https:\/\/example\.test\/mat\/#k=([0-9a-f]{64})$/.exec(l));
  assert.ok(links.every(Boolean), lines.join("\n"));
  assert.deepEqual(links.map((m) => m[1]), ["Mo", "Ajen", "Trenton"]);
  const stored = JSON.parse(fake.props.PERSON_KEYS);
  for (const m of links) {
    assert.equal(stored[m[1]].hash, sha256(m[2]));
    assert.equal(fake.props.PERSON_KEYS.includes(m[2]), false);
    assert.equal((await fake({ key: m[2], action: "load" })).data.me, m[1]);
  }
  fake.logged.length = 0;
  fake.world.issueLinks();
  assert.deepEqual(fake.logged.map((l) => l.replace(/\d{4}-\d{2}-\d{2}/, "D")), ["Mo: already has a link (issued D).", "Ajen: already has a link (issued D).", "Trenton: already has a link (issued D).", "Nobody needed a new link."]);
});

test("issueLinks without SITE_URL prints #k=<key> and says where to put it", () => {
  const fake = createFakeBackend({ ...SEED });
  fake.world.issueLinks();
  assert.match(fake.logged[0], /^Mo’s link: #k=[0-9a-f]{64}$/);
  assert.equal(fake.logged.length, 4, "three links and one hint");
  assert.match(fake.logged[3], /Put the app’s address in front of each link/);
});

test("linksStatus says who has a link and whether the shared link works; never a key", () => {
  const w = world(["Mo", "Ajen"]);
  w.fake.world.linksStatus();
  assert.deepEqual(w.fake.logged.map((l) => l.replace(/\d{4}-\d{2}-\d{2}/, "D")), ["1. Mo: has a link (issued D)", "2. Ajen: has a link (issued D)", "3. Trenton: no link yet", "The shared link still works."]);
});

test("retireSharedLink refuses while someone has no link; then deletes TRIP_KEY and its cached copy", async () => {
  const w = world(["Mo", "Ajen"]);
  assert.equal((await w.as(SHARED, "rev")).ok, true); // cached now
  w.fake.world.retireSharedLink();
  assert.deepEqual(w.fake.logged, ["Not retired: Trenton has no personal link yet. Run issueLinks first."]);
  assert.equal(w.fake.props.TRIP_KEY, SHARED);
  assert.equal((await w.as(SHARED, "rev")).ok, true);
  w.fake.logged.length = 0;
  w.keys.Trenton = w.fake.personKey("Trenton");
  w.fake.world.retireSharedLink();
  assert.deepEqual(w.fake.logged, ["The shared link is retired: it stops working now. Personal links, the check key and the Claude link still work."]);
  assert.equal("TRIP_KEY" in w.fake.props, false);
  assert.equal((await w.as(SHARED, "rev")).error, "bad_key", "refused on the next request, despite the cache");
  for (const n of ["Mo", "Ajen", "Trenton"]) assert.equal((await w.as(w.keys[n], "rev")).ok, true, n);
  assert.equal((await w.as(w.fake.CHECK_KEY, "rev")).ok, true);
  w.fake.logged.length = 0;
  w.fake.world.showInvite();
  assert.match(w.fake.logged[0], /^There is no shared link any more: personal links replace it\./);
});

test("showInvite prints the shared key only while it exists, saying personal links replace it", () => {
  const fake = createFakeBackend({});
  fake.world.showInvite();
  assert.equal(fake.logged.length, 1);
  assert.match(fake.logged[0], /^Shared trip key \(personal links replace it: .*\): test-key$/);
});

test("newLinkForPerson / cancelLinkForPerson beyond the trip's people say so and change nothing", () => {
  const w = world();
  const before = w.fake.props.PERSON_KEYS;
  w.fake.world.newLinkForPerson6();
  w.fake.world.cancelLinkForPerson4();
  assert.deepEqual(w.fake.logged, ["There is no person 6 on this trip.", "There is no person 4 on this trip."]);
  assert.equal(w.fake.props.PERSON_KEYS, before);
});

// ---------- errors and logs ----------

test("a thrown error answers the plain sentence; the owner's log gets the detail with every key blanked", async () => {
  const w = world();
  w.fake.world.history_ = () => { throw new Error("boom with " + w.keys.Ajen + " and test-key and claude-token"); };
  const r = await w.as(w.keys.Ajen, "history");
  assert.deepEqual([r.ok, r.error, r.message], [false, "server", "Something went wrong on our side. Try again."]);
  assert.equal(w.fake.consoleLines.length, 1);
  assert.match(w.fake.consoleLines[0], /^handle_: .*boom with \(hidden\) and \(hidden\) and \(hidden\)/);
  assert.equal(holdsSecret(w, w.fake.consoleLines[0]), false);
});

test("no key or token reaches a Log row, a History sentence, a reply or the owner's run log, except the new links", async () => {
  const w = world();
  w.fake.props.PLANNER_ID = "plannerid0000000000000000000x";
  const replies = [];
  for (const k of [w.keys.Mo, w.keys.Ajen, SHARED, w.fake.CHECK_KEY, "wrong"]) {
    replies.push(await w.as(k, "load"), await w.as(k, "history"), await w.as(k, "addExpense", { expense: ramen("exp" + Math.random().toString(36).slice(2, 9).padEnd(7, "0")) }, { actor: "Mo" }), await w.as(k, "claudeLink"));
  }
  w.fake.world.linksStatus();
  w.fake.world.retireSharedLink();
  w.fake.world.cancelLinkForPerson1();
  const text = JSON.stringify([replies.filter((r) => r.data && !r.data.token), w.fake.tables, w.fake.logged, w.fake.consoleLines]);
  assert.equal(holdsSecret(w, text), false);
  assert.equal(text.includes("plannerid0000000000000000000x"), false);
});

// ---------- fix round 1 (review 2026-11-18) ----------

test("I2: the shared key is read from Script Properties on every request, never from a cached copy", async () => {
  const w = world();
  assert.equal(w.fake.primitives.tripKey_(), SHARED); // a cached copy now exists
  delete w.fake.props.TRIP_KEY; // deleted by hand, cache left as it was
  assert.equal((await w.as(SHARED, "rev")).error, "bad_key", "refused at once");
  w.fake.props.TRIP_KEY = SHARED;
  assert.equal((await w.as(SHARED, "rev")).ok, true);
});

test("I3: a PERSON_KEYS that is there but not a JSON object lets nobody in and wipes nobody (the plain server sentence)", async () => {
  for (const raw of ["{bad", "[]", "null", '"x"', "3"]) {
    const w = world();
    w.fake.props.PERSON_KEYS = raw;
    const r = await w.as(w.keys.Mo, "load");
    assert.deepEqual([r.ok, r.error, r.message], [false, "server", "Something went wrong on our side. Try again."], raw);
    assert.equal((await w.as(SHARED, "load")).error, "server", "not even the shared key: nothing is decided on a broken property");
    w.fake.logged.length = 0;
    w.fake.world.linksStatus();
    assert.match(w.fake.logged[0], /^PERSON_KEYS can’t be read/, raw);
    w.fake.logged.length = 0;
    w.fake.world.issueLinks();
    assert.match(w.fake.logged[0], /^PERSON_KEYS can’t be read/);
    assert.equal(w.fake.props.PERSON_KEYS, raw, "issueLinks does not overwrite it");
  }
  const empty = world();
  empty.fake.props.PERSON_KEYS = "";
  assert.equal((await empty.as(SHARED, "rev")).ok, true, "an empty property is simply no personal keys");
});

test("minor: undoing someone else's undo can't move their claim; the connector follows the owner's own rule", async () => {
  const BOOK = [["#", "Item", "Book by", "Status"], [1, "JR pass", "2026-12-01", ""]];
  const w = world(["Mo", "Ajen", "Trenton"], { ...SEED, plannerId: "plannerid0000000000000000000x", plannerTabs: { "Book Now": BOOK, "Change Log": [["#", "Tab", "Old value", "New value"]] } });
  await w.as(w.keys.Mo, "syncTodos", { force: true });
  const claim = await w.as(w.keys.Ajen, "claimTodo", { id: "1", on: true });
  const undo = await w.as(w.keys.Ajen, "undo", { logId: claim.data.logId }); // Ajen takes her own back
  assert.equal(undo.ok, true);
  const again = await w.as(w.keys.Mo, "undo", { logId: undo.data.logId }); // would put Ajen back on it
  assert.equal(again.ok, false, "Mo can't put Ajen's claim back");
  assert.equal(w.fake.tables.Todos[0].claimed_by, "");
  const ajen2 = await w.as(w.keys.Ajen, "claimTodo", { id: "1", on: true });
  const viaClaude = w.fake.world.handleAs_({ kind: "claude", name: "Mo" }, { action: "undo", args: { logId: ajen2.data.logId } });
  assert.equal(viaClaude.ok, false, "the connector (the owner) can't undo Ajen's claim either");
  assert.equal(w.fake.tables.Todos[0].claimed_by, "Ajen");
});

test("minor: via claude from a phone is ignored; only the connector's own path sets it", async () => {
  const w = world();
  const r = await w.as(w.keys.Mo, "addExpense", { expense: ramen("exp0000071") }, { via: "claude" });
  assert.equal(r.ok, true);
  assert.equal(w.fake.tables.Log.at(-1).via, "app");
  const s = await w.as(SHARED, "addExpense", { expense: ramen("exp0000072") }, { actor: "Mo", via: "claude" });
  assert.equal(s.ok, true);
  assert.equal(w.fake.tables.Log.at(-1).via, "app");
});

test("minor: names are looked up as own properties; a name like constructor gets its link; __proto__ is refused", () => {
  const fake = createFakeBackend({ ...SEED, people: { Trenton: { name: "constructor" } } });
  fake.world.issueLinks();
  assert.ok(fake.logged.some((l) => /^constructor’s link: #k=[0-9a-f]{64}$/.test(l)), fake.logged.join("\n"));
  const odd = createFakeBackend({ ...SEED, people: { Trenton: { name: "__proto__" } } });
  odd.world.issueLinks();
  assert.ok(odd.logged.some((l) => l === "__proto__: no link made: that name can’t be used. Change it in the People tab."), odd.logged.join("\n"));
  odd.logged.length = 0;
  odd.world.retireSharedLink();
  assert.match(odd.logged[0], /^Not retired: __proto__ has no personal link yet/);
});

test("minor: retireSharedLink refuses when the People tab reads as empty", () => {
  const w = world();
  w.fake.tables.People.length = 0;
  w.fake.world.retireSharedLink();
  assert.deepEqual(w.fake.logged, ["Not retired: the People tab lists nobody."]);
  assert.equal(w.fake.props.TRIP_KEY, SHARED);
});

test("minor: links for names no longer on the trip are listed by linksStatus and removed by issueLinks (names only)", async () => {
  const w = world();
  const ghost = w.fake.personKey("Old name");
  w.fake.world.linksStatus();
  assert.ok(w.fake.logged.includes("Not on the trip any more, still has a link: Old name. Run issueLinks to remove it."), w.fake.logged.join("\n"));
  w.fake.logged.length = 0;
  w.fake.world.issueLinks();
  assert.ok(w.fake.logged.includes("Removed the link of someone no longer on the trip: Old name."), w.fake.logged.join("\n"));
  assert.equal(JSON.parse(w.fake.props.PERSON_KEYS)["Old name"], undefined);
  assert.equal(holdsSecret({ ...w, keys: { ...w.keys, ghost } }, w.fake.logged.join("\n")), false);
});

test("linksStatus with an empty People tab says it lists nobody and suggests nothing (issueLinks would refuse)", () => {
  const w = world();
  w.fake.personKey("Old name");
  w.fake.tables.People.length = 0;
  w.fake.logged.length = 0;
  w.fake.world.linksStatus();
  const said = w.fake.logged.join("\n");
  assert.match(said, /Still has a link: .*Old name\. The People tab lists nobody\./);
  assert.equal(/issueLinks/.test(said), false, said);
});

test("minor: once retired, setup never makes a shared key again, even with no personal keys left", () => {
  const w = world();
  w.fake.world.retireSharedLink();
  assert.equal(w.fake.props.SHARED_RETIRED, "yes");
  const src = fs.readFileSync(path.join(__dirname, "..", "backend", "Setup.js"), "utf8");
  assert.match(src, /getProperty\("SHARED_RETIRED"\)/, "setup checks the flag");
});

test("minor: an e-mail address in an error's text is blanked in the owner's log", async () => {
  const w = world();
  w.fake.world.history_ = () => { throw new Error("no row for someone@example.com"); };
  await w.as(w.keys.Mo, "history");
  assert.equal(w.fake.consoleLines[0].includes("someone@example.com"), false, w.fake.consoleLines[0]);
});

// ---------- fix round 2 ----------

test("round 2: issueLinks with an empty or unreadable People tab refuses and changes nothing", () => {
  const w = world();
  const before = w.fake.props.PERSON_KEYS;
  w.fake.tables.People.length = 0;
  w.fake.world.issueLinks();
  assert.deepEqual(w.fake.logged, ["Not done: the People tab lists nobody. Nothing was changed."]);
  assert.equal(w.fake.props.PERSON_KEYS, before);
  w.fake.logged.length = 0;
  w.fake.world.peopleNames_ = () => { throw new Error("Missing tab: People"); };
  w.fake.world.issueLinks();
  assert.deepEqual(w.fake.logged, ["Not done: the People tab can’t be read. Nothing was changed."]);
  assert.equal(w.fake.props.PERSON_KEYS, before);
});

test("round 2: the advice for a broken PERSON_KEYS says to mend it, and that deleting it cancels every link", () => {
  const w = world();
  w.fake.props.PERSON_KEYS = "{bad";
  w.fake.world.linksStatus();
  assert.match(w.fake.logged[0], /mend the text/);
  assert.match(w.fake.logged[0], /Deleting or emptying it cancels every personal link/);
  const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
  assert.match(readme, /mend the text/);
  assert.match(readme, /cancels every personal link/);
});

test("round 2: linksStatus lists an entry that is there but unusable as unreadable, not as no link", () => {
  const w = world();
  const keys = JSON.parse(w.fake.props.PERSON_KEYS);
  keys.Ajen.hash = keys.Ajen.hash.slice(1); // one character short
  w.fake.props.PERSON_KEYS = JSON.stringify(keys);
  w.fake.world.linksStatus();
  assert.ok(w.fake.logged.includes("2. Ajen: unreadable entry for Ajen (run newLinkForPerson2 to give a new link)"), w.fake.logged.join("\n"));
  assert.ok(w.fake.logged.some((l) => /^1\. Mo: has a link/.test(l)));
});
