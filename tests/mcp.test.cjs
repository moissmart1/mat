// The Claude connector (backend/Mcp.js), through the fake backend, which runs
// the real Pure.js, Actions.js, Money.js and Mcp.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFakeBackend } = require("./fake-backend.cjs");

const plan = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "plan.json"), "utf8"));
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "seed.json"), "utf8"));
let money, dollars;
test.before(async () => {
  money = await import("../js/money.js");
  ({ dollars } = await import("../js/format.js"));
});

const T = { t: "claude-token" };
const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, params });
const body = (r) => JSON.parse(r.result.content[0].text);
const call = (fake, name, args, query = T) => fake.mcp(rpc("tools/call", { name, arguments: args }), query);
const ok = (fake, name, args, query) => {
  const r = call(fake, name, args, query);
  assert.ok(r.result, JSON.stringify(r));
  assert.notEqual(r.result.isError, true, r.result.content[0].text);
  return body(r);
};
const refusal = (fake, name, args) => {
  const r = call(fake, name, args);
  assert.equal(r.result && r.result.isError, true, JSON.stringify(r));
  return r.result.content[0].text;
};
const badArgs = (fake, name, args) => {
  const r = call(fake, name, args);
  assert.equal(r.error && r.error.code, -32602, JSON.stringify(r));
  return r.error.message;
};
// A phone on its own link (a personal key): e-Transfer addresses can only be
// changed that way (security, 2026-11-18).
const own = (fake, name) => {
  fake.keys = fake.keys || {};
  if (!fake.keys[name]) fake.keys[name] = fake.personKey(name);
  return fake.keys[name];
};
const app = (fake, action, args, actor = "Mo") => fake({ key: own(fake, actor), action, args });
const NAMES = ["Mo", "Ajen", "Trenton"];

// ---------- the brief's tests ----------

test("the handshake needs no token; everything else does", () => {
  const fake = createFakeBackend(plan);
  assert.equal(fake.mcp(rpc("initialize", {}), {}).result.serverInfo.name, "mat");
  assert.equal(fake.mcp(rpc("tools/list"), {}).error.code, -32001);
  assert.equal(fake.mcp(rpc("tools/list"), { t: "test-key" }).error.code, -32001); // the trip key is not the token
  assert.equal(fake.mcp(rpc("tools/list"), T).result.tools.length, 12);
  assert.equal(fake.mcp({ jsonrpc: "2.0", method: "notifications/initialized" }, T).error.code, -32600);
  assert.equal(fake.mcp(rpc("nope"), T).error.code, -32601);
});

test("every tool has a name, a description and a schema", () => {
  for (const t of createFakeBackend({}).mcp(rpc("tools/list"), T).result.tools) {
    assert.match(t.name, /^[a-z_]+$/);
    assert.ok(t.description.length > 20);
    assert.equal(t.inputSchema.type, "object");
  }
});

test("Claude adds a stop: validated, logged as Claude (as the owner, whatever `as` says), undoable", async () => {
  const fake = createFakeBackend({});
  const r = fake.mcp(rpc("tools/call", { name: "add_stop", arguments: { date: "2026-12-12", title: "Shibuya Sky", time: "14:00", travel_min: 30, sign_jp: "渋谷" } }), { ...T, as: "Ajen" });
  const stop = body(r).stop;
  assert.deepEqual([stop.title, stop.travelMin, stop.signJp], ["Shibuya Sky", 30, "渋谷"]);
  const log = fake.tables.Log.at(-1);
  assert.deepEqual([log.who, log.via], ["Mo", "claude"]);
  const u = fake.mcp(rpc("tools/call", { name: "undo", arguments: { log_id: body(r).log_id } }), T);
  assert.equal(body(u).stop.deleted, true);
});

test("a refusal comes back in the backend's words, as a tool error", () => {
  const fake = createFakeBackend({});
  const r = fake.mcp(rpc("tools/call", { name: "add_stop", arguments: { date: "2026-12-12", title: "x", link: "javascript:alert(1)" } }), T);
  assert.equal(r.result.isError, true);
  assert.equal(r.result.content[0].text, "That link has to start with https://.");
  assert.equal(fake.mcp(rpc("tools/call", { name: "nope", arguments: {} }), T).error.code, -32601);
});

test("get_trip and explain_debt agree with the app's own maths", () => {
  const fake = createFakeBackend(seed);
  const trip = body(fake.mcp(rpc("tools/call", { name: "get_trip", arguments: {} }), T));
  const people = ["Mo", "Ajen", "Trenton"];
  const expected = money.owedList(people, seed.expenses, seed.payments, true);
  assert.deepEqual(trip.owed, expected.map((x) => ({ from: x.from, to: x.to, amount: dollars(x.cents) })));
  assert.equal(JSON.stringify(trip).includes("etransfer"), false);
  const why = body(fake.mcp(rpc("tools/call", { name: "explain_debt", arguments: { from: expected[0].from, to: expected[0].to } }), T));
  assert.equal(why.simplified.amount, dollars(expected[0].cents));
  const w = money.working(expected[0].from, seed.expenses, seed.payments);
  assert.equal(why.from.paid, dollars(w.paid));
});

test("add_expense defaults: everyone shares it, and the day is today in Japan", () => {
  const fake = createFakeBackend({}, { clock: () => "2026-12-12T04:20:00.000Z" }); // 13:20 in Japan
  const e = body(fake.mcp(rpc("tools/call", { name: "add_expense", arguments: { title: "Ramen", amount: 3000, currency: "JPY", paid_by: "Mo" } }), T)).expense;
  assert.deepEqual([e.day, e.split.length, e.addedBy], ["2026-12-12", 3, "Mo"]);
});

test("no reply ever holds the trip key or the token", () => {
  const fake = createFakeBackend(plan);
  const all = ["get_trip", "get_history"].map((name) => JSON.stringify(fake.mcp(rpc("tools/call", { name, arguments: {} }), T))).join("");
  assert.equal(all.includes("test-key") || all.includes("claude-token"), false);
});

test("claudeLink hands the token only to the trip's first person, on their own link (security)", async () => {
  const fake = createFakeBackend({});
  assert.equal((await fake({ key: own(fake, "Mo"), action: "claudeLink", args: {} })).data.token, "claude-token");
  const other = await fake({ key: own(fake, "Ajen"), action: "claudeLink", args: {} });
  assert.deepEqual([other.ok, other.error, other.message, other.data], [false, "bad_input", "Only Mo can copy the Claude link.", undefined]);
  const shared = await fake({ key: "test-key", actor: "Mo", action: "claudeLink", args: {} });
  assert.deepEqual([shared.ok, shared.error, shared.data], [false, "bad_input", undefined]);
  const check = await fake({ key: fake.CHECK_KEY, action: "claudeLink", args: {} });
  assert.deepEqual([check.ok, check.error, check.data], [false, "bad_input", undefined]);
  assert.equal((await fake({ key: "wrong", action: "claudeLink", args: {} })).error, "bad_key");
  assert.equal(JSON.stringify([other, shared, check]).includes("claude-token"), false);
});

// ---------- the handshake, the token and malformed messages ----------

test("initialize answers the fixed handshake, the same with or without a token, and nothing about the trip", () => {
  const fake = createFakeBackend({ ...seed, ...plan });
  const want = { jsonrpc: "2.0", id: 7, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "mat", version: "1" } } };
  assert.deepEqual(fake.mcp(rpc("initialize", {}, 7), {}), want);
  assert.deepEqual(fake.mcp(rpc("initialize", {}, 7), T), want);
  delete fake.props.CLAUDE_TOKEN;
  assert.deepEqual(fake.mcp(rpc("initialize", {}, 7), {}), want);
  assert.deepEqual(fake.mcp(rpc("initialize", {}, "a"), {}).id, "a");
});

test("with no CLAUDE_TOKEN set, every method but initialize is Unauthorized, whatever t says", () => {
  const fake = createFakeBackend(plan);
  delete fake.props.CLAUDE_TOKEN;
  const unauthorized = { code: -32001, message: "Unauthorized" };
  for (const query of [{}, { t: undefined }, { t: "" }, { t: "null" }, { t: "undefined" }, { t: null }, T, { t: "test-key" }]) {
    for (const msg of [rpc("tools/list"), rpc("tools/call", { name: "get_trip", arguments: {} }), rpc("nope"), rpc("ping")]) {
      const r = fake.mcp(msg, query);
      assert.deepEqual(r, { jsonrpc: "2.0", id: 1, error: unauthorized }, JSON.stringify([msg.method, query]));
    }
  }
  fake.props.CLAUDE_TOKEN = "";
  assert.deepEqual(fake.mcp(rpc("tools/list"), { t: "" }).error, unauthorized, "an empty token is no token");
});

test("a set token must match whole; the trip key, a prefix, a longer string or another case do not", () => {
  const fake = createFakeBackend({});
  for (const t of ["test-key", "claude-toke", "claude-token2", "Claude-token", "claude-tokem", " claude-token", ["claude-token"], 1]) {
    assert.equal(fake.mcp(rpc("tools/list"), { t }).error.code, -32001, JSON.stringify(t));
  }
  assert.equal(fake.mcp(rpc("tools/list"), {}).error.code, -32001);
  assert.equal(fake.mcp(rpc("tools/list"), undefined).error.code, -32001);
  assert.equal(fake.mcp(rpc("tools/list"), T).result.tools.length, 12);
});

test("a message that is not a request is -32600 with id null, before any token check", () => {
  const fake = createFakeBackend({});
  const invalid = { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } };
  for (const msg of [null, [], "x", 3, { jsonrpc: "2.0", id: 1 }, { jsonrpc: "2.0", id: 1, method: 5 }, { jsonrpc: "2.0", method: "tools/list" }, { jsonrpc: "2.0", id: null, method: "tools/list" }, { jsonrpc: "2.0", id: {}, method: "tools/list" }, { jsonrpc: "2.0", method: "initialize" }]) {
    assert.deepEqual(fake.mcp(msg, T), invalid, JSON.stringify(msg));
    assert.deepEqual(fake.mcp(msg, {}), invalid, JSON.stringify(msg));
  }
});

test("method not found, unknown tool and bad tools/call params", () => {
  const fake = createFakeBackend({});
  assert.deepEqual(fake.mcp(rpc("resources/list"), T), { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } });
  assert.deepEqual(fake.mcp(rpc("tools/call", { name: "drop_tables", arguments: {} }), T).error, { code: -32601, message: "Unknown tool" });
  for (const params of [undefined, null, [], { name: 3 }, { name: "get_trip", arguments: [] }, { name: "get_trip", arguments: "x" }]) {
    assert.equal(fake.mcp(rpc("tools/call", params), T).error.code, -32602, JSON.stringify(params));
  }
  assert.ok(fake.mcp(rpc("tools/call", { name: "get_trip" }), T).result, "no arguments at all is the same as {}");
});

test("tools/list names the twelve tools in order, each schema listing its own arguments", () => {
  const tools = createFakeBackend({}).mcp(rpc("tools/list"), T).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ["get_trip", "explain_debt", "add_expense", "add_stop", "change_stop", "remove_stop", "save_stay", "remove_stay", "set_day", "get_history", "undo", "sync_payments"]);
  const props = Object.fromEntries(tools.map((t) => [t.name, Object.keys(t.inputSchema.properties).sort()]));
  assert.deepEqual(props.add_expense, ["amount", "currency", "day", "kind", "note", "paid_by", "split", "title"]);
  assert.deepEqual(props.add_stop, ["booked", "date", "detail", "fixed", "getting_there", "link", "note", "photo", "place", "sign_jp", "time", "title", "travel_min"]);
  assert.deepEqual(props.change_stop, [...props.add_stop, "id"].sort());
  assert.deepEqual(props.save_stay, ["address_jp", "first_night", "id", "last_night", "link", "name", "name_jp", "note", "photo", "place"]);
  assert.deepEqual(props.set_day, ["city", "date", "from_en", "from_jp", "line_colour", "line_en", "line_jp", "title", "to_en", "to_jp"]);
  assert.deepEqual(props.undo, ["log_id"]);
  assert.deepEqual(props.sync_payments, []);
  const req = Object.fromEntries(tools.map((t) => [t.name, (t.inputSchema.required || []).slice().sort()]));
  assert.deepEqual(req.add_expense, ["amount", "currency", "paid_by", "title"]);
  assert.deepEqual(req.add_stop, ["date", "title"]);
  assert.deepEqual(req.save_stay, [], "save_stay's needs depend on id, so its description says them");
  assert.match(tools.find((t) => t.name === "save_stay").description, /needs name, first_night and last_night, or with an id to change only the fields given/);
  const travel = tools.find((t) => t.name === "add_stop").inputSchema.properties.travel_min;
  assert.deepEqual([travel.type, travel.minimum, travel.maximum], ["integer", 0, 600]);
  assert.deepEqual(req.get_trip, []);
  for (const t of tools) {
    if (/^(add|change|remove|save|set)_|^undo$/.test(t.name)) assert.match(t.description, /History/, t.name + " says it shows in History");
    assert.ok(t.description.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length <= 2, t.name + ": one or two sentences");
    assert.equal(/[‘’“”]/.test(t.description) || !/'/.test(t.description), true, t.name + ": curly apostrophes");
  }
});

// ---------- bad arguments never reach the Sheet ----------

test("bad arguments are -32602 and write nothing", () => {
  const fake = createFakeBackend(plan);
  const logBefore = fake.tables.Log.length;
  const stopsBefore = JSON.stringify(fake.tables.Stops);
  const cases = [
    ["add_stop", { title: "x" }],
    ["add_stop", { date: "2026-12-12", title: "x", time: "9:30" }],
    ["add_stop", { date: "2026-12-12", title: "x", time: "25:00" }],
    ["add_stop", { date: "2026-12-12", title: "x", time: 1400 }],
    ["add_stop", { date: "2026-12-12", title: "x", travel_min: 1.5 }],
    ["add_stop", { date: "2026-12-12", title: "x", travel_min: -5 }],
    ["add_stop", { date: "2026-12-12", title: "x", travel_min: "30" }],
    ["add_stop", { date: "2026-12-12", title: "x", fixed: "yes" }],
    ["add_stop", { date: "2026-12-12", title: "x", colour: "red" }],
    ["add_stop", { date: "2026-12-12", title: 5 }],
    ["change_stop", { title: "x" }],
    ["change_stop", { id: "planstop1101", time: "noon" }],
    ["change_stop", { id: "planstop1101", travel_min: 2.5 }],
    ["remove_stop", {}],
    ["add_expense", { title: "x", amount: "3000", currency: "JPY", paid_by: "Mo" }],
    ["add_expense", { title: "x", amount: 3000, currency: "JPY", paid_by: "Mo", split: "Mo" }],
    ["add_expense", { title: "x", amount: 3000, currency: "JPY", paid_by: "Mo", split: [1] }],
    ["save_stay", { name: "x", first_night: "2026-12-12" }],
    ["set_day", { city: "Tokyo" }],
    ["undo", {}],
    ["undo", { log_id: "1" }],
    ["undo", { log_id: 1.5 }],
    ["get_history", { limit: "5" }],
    ["explain_debt", { from: "Mo" }],
    ["explain_debt", { from: "Mo", to: "Nobody" }],
    ["explain_debt", { from: "Mo", to: "Mo" }],
    ["get_trip", { extra: 1 }],
  ];
  for (const [name, args] of cases) {
    const msg = badArgs(fake, name, args);
    assert.match(msg, /^Invalid params/, name + " " + JSON.stringify(args));
    for (const n of NAMES.concat(["Japan", "2026-12-1"])) assert.equal(msg.includes(n), false, msg);
  }
  assert.equal(fake.tables.Log.length, logBefore);
  assert.equal(JSON.stringify(fake.tables.Stops), stopsBefore);
});

test("a time is trimmed before it is handed on; an empty one is no time", () => {
  const fake = createFakeBackend({});
  assert.equal(ok(fake, "add_stop", { date: "2026-12-12", title: "a", time: " 14:00 " }).stop.time, "14:00");
  assert.equal(ok(fake, "add_stop", { date: "2026-12-12", title: "b", time: "" }).stop.time, "");
  assert.deepEqual(fake.tables.Stops.map((r) => r.time), ["14:00", ""]);
  assert.match(refusal(fake, "add_stop", { date: "2026-12-12", title: "c", travel_min: 601 }), /^Minutes to get there/);
});

// ---------- writes go through the app's own actions ----------

test("writes are made as the first person (the owner) whatever `as` names, always via claude, never with a key (R35, security)", () => {
  const fake = createFakeBackend({});
  for (const [as, who] of [["Trenton", "Mo"], ["ajen", "Mo"], [" Ajen ", "Mo"], [undefined, "Mo"]]) {
    ok(fake, "add_stop", { date: "2026-12-11", title: "With " + as }, as === undefined ? T : { ...T, as });
    const log = fake.tables.Log.at(-1);
    assert.deepEqual([log.who, log.via], [who, "claude"], String(as));
  }
  const viaApp = fake.requests.filter((r) => r.via === "claude");
  assert.equal(viaApp.length, 4, "each went through handleAs_ with via claude");
  assert.ok(viaApp.every((r) => r.key === undefined && r.holder === "claude" && r.actor === "Mo"), "as the connector, without a key");
});

test("the write tools map their arguments to the API and answer { <kind>, log_id }", () => {
  const fake = createFakeBackend(plan, { clock: () => "2026-12-11T01:00:00.000Z" });
  const s = ok(fake, "add_stop", { date: "2026-12-12", title: "Tower", getting_there: "Walk", fixed: true, booked: true, place: "Tokyo Tower", link: "https://example.test/t", photo: "https://example.test/p.jpg", note: "n", detail: "d" });
  assert.deepEqual(Object.keys(s).sort(), ["log_id", "stop"]);
  assert.match(s.stop.id, /^[A-Za-z][A-Za-z0-9]{19}$/);
  assert.deepEqual([s.stop.gettingThere, s.stop.fixed, s.stop.booked, s.stop.place, s.stop.detail], ["Walk", true, true, "Tokyo Tower", "d"]);
  assert.equal(typeof s.log_id, "number");

  const c = ok(fake, "change_stop", { id: s.stop.id, title: "Tokyo Tower", time: "18:00" });
  assert.deepEqual([c.stop.title, c.stop.time, c.stop.note], ["Tokyo Tower", "18:00", "n"]);
  assert.equal(c.log_id, s.log_id + 1);
  assert.equal(ok(fake, "remove_stop", { id: s.stop.id }).stop.deleted, true);
  assert.equal(refusal(fake, "change_stop", { id: s.stop.id, title: "x" }), "Bring it back first.");
  assert.equal(refusal(fake, "remove_stop", { id: "nosuchstop1" }), "That stop isn’t there any more.");

  const stay = ok(fake, "save_stay", { name: "Ryokan", first_night: "2026-12-14", last_night: "2026-12-15", name_jp: "旅館", address_jp: "住所", note: "late check-in" });
  assert.match(stay.stay.id, /^[A-Za-z][A-Za-z0-9]{19}$/);
  assert.deepEqual([stay.stay.nameJp, stay.stay.addressJp, stay.stay.firstNight], ["旅館", "住所", "2026-12-14"]);
  const again = ok(fake, "save_stay", { id: stay.stay.id, name: "Ryokan Two", first_night: "2026-12-14", last_night: "2026-12-16" });
  assert.deepEqual([again.stay.id, again.stay.name, again.stay.lastNight], [stay.stay.id, "Ryokan Two", "2026-12-16"]);
  assert.equal(ok(fake, "remove_stay", { id: stay.stay.id }).stay.deleted, true);
  assert.equal(refusal(fake, "save_stay", { name: "x", first_night: "2026-12-15", last_night: "2026-12-14" }), "The last night can’t be before the first.");

  const day = ok(fake, "set_day", { date: "2026-12-14", city: "Kyoto", line_jp: "東海道新幹線", line_en: "Tokaido Shinkansen", line_colour: "#0072BC", from_jp: "東京", from_en: "Tokyo", to_jp: "京都", to_en: "Kyoto", title: "West" });
  assert.deepEqual(day.day, { date: "2026-12-14", city: "Kyoto", title: "West", lineJp: "東海道新幹線", lineEn: "Tokaido Shinkansen", lineColour: "#0072BC", fromJp: "東京", fromEn: "Tokyo", toJp: "京都", toEn: "Kyoto", lat: "", lng: "" });
  assert.equal(refusal(fake, "set_day", { date: "2026-12-14", line_colour: "blue" }), "Use a colour like #2FB6E8.");
  assert.equal(refusal(fake, "set_day", { date: "2027-01-01", city: "x" }), "That day isn’t on this trip.");

  const e = ok(fake, "add_expense", { title: "Taxi", amount: 12.5, currency: "CAD", paid_by: "Ajen", split: ["Mo", "Ajen"], note: "airport", kind: "transport", day: "2026-12-13" });
  assert.deepEqual([e.expense.amount, e.expense.currency, e.expense.paidBy, e.expense.split, e.expense.note, e.expense.kind, e.expense.day, e.expense.rate], [12.5, "CAD", "Ajen", ["Mo", "Ajen"], "airport", "transport", "2026-12-13", 111]);
  assert.equal(refusal(fake, "add_expense", { title: "x", amount: 1, currency: "USD", paid_by: "Mo" }), "Use yen or Canadian dollars.");
  assert.equal(refusal(fake, "add_expense", { title: "x", amount: 1, currency: "JPY", paid_by: "Nobody" }), "Pick who paid.");
});

test("change_stop writes only the columns that changed (a hand-typed cell elsewhere is kept)", () => {
  const fake = createFakeBackend(plan);
  const row = fake.tables.Stops.find((r) => r.id === "planstop1101");
  row.time = "9:30"; // typed by hand; the reader shows it as no time
  row.link = "example.test/bare";
  ok(fake, "change_stop", { id: "planstop1101", note: "Arrive early" });
  assert.equal(row.time, "9:30");
  assert.equal(row.link, "example.test/bare");
  assert.equal(row.note, "Arrive early");
});

test("add_expense's default day follows the register: pre before the trip, today during, the last day after", () => {
  const at = (iso) => createFakeBackend({}, { clock: () => iso });
  const day = (fake) => ok(fake, "add_expense", { title: "x", amount: 100, currency: "JPY", paid_by: "Mo" }).expense.day;
  assert.equal(day(at("2026-12-09T14:59:00.000Z")), "pre"); // 23:59 on the 9th in Japan
  assert.equal(day(at("2026-12-09T15:00:00.000Z")), "2026-12-10"); // midnight in Japan
  assert.equal(day(at("2026-12-20T14:59:00.000Z")), "2026-12-20");
  assert.equal(day(at("2026-12-21T03:00:00.000Z")), "2026-12-20");
});

test("undo through the connector obeys the app's rules", async () => {
  const fake = createFakeBackend({});
  const a = ok(fake, "add_stop", { date: "2026-12-12", title: "Tea" });
  const c = ok(fake, "change_stop", { id: a.stop.id, title: "Matcha" });
  assert.equal(refusal(fake, "undo", { log_id: a.log_id }), "That was changed again since. Undo the newer change first.");
  const u = ok(fake, "undo", { log_id: c.log_id });
  assert.deepEqual(Object.keys(u).sort(), ["log_id", "stop"]);
  assert.equal(u.stop.title, "Tea");
  assert.equal(fake.tables.Log.at(-1).via, "claude");
  assert.equal(refusal(fake, "undo", { log_id: c.log_id }), "That’s already been undone.");
  assert.equal(refusal(fake, "undo", { log_id: 999 }), "That change isn’t in the history.");
  await app(fake, "setPerson", { name: "Mo", patch: { etransfer: "mo@example.com" } });
  const personLog = fake.tables.Log.at(-1).id;
  assert.equal(refusal(fake, "undo", { log_id: personLog }), "That change can’t be undone.");
  // An expense added in the app can be undone from Claude, and vice versa.
  const e = await app(fake, "addExpense", { expense: { id: "exp0000001", day: "2026-12-12", title: "Ramen", amount: 1200, currency: "JPY", paidBy: "Mo", split: NAMES } });
  assert.equal(ok(fake, "undo", { log_id: e.data.logId }).expense.deleted, true);
});

// ---------- reads ----------

test("get_trip gives the trip, names only, the days, and only live stops, stays, expenses and payments", async () => {
  const fake = createFakeBackend({ ...seed, ...plan, payments: [{ id: "pay0000001", from: "Ajen", to: "Mo", cad: 25, seed: 3, rot: 0 }, { id: "pay0000002", from: "Trenton", to: "Mo", cad: 5, seed: 3, rot: 0, removed: true }] });
  await app(fake, "deleteStop", { id: "planstop1102" });
  await app(fake, "deleteExpense", { id: "seedexp004" });
  const t = ok(fake, "get_trip", {});
  assert.deepEqual(Object.keys(t), ["trip", "people", "has_picture", "days", "stops", "stays", "expenses", "payments", "owed", "owed_direct", "todos"]);
  assert.deepEqual(t.todos, { open: [], done: 0 }, "no pull yet: nothing to do");
  assert.deepEqual(t.people, NAMES);
  assert.equal(t.trip.name, "Japan 2026");
  assert.equal(t.days.length, 11);
  assert.equal(t.stops.some((s) => s.id === "planstop1102"), false);
  assert.ok(t.stops.length > 0 && t.stops.every((s) => !s.deleted));
  assert.equal(t.expenses.some((e) => e.id === "seedexp004"), false);
  assert.deepEqual(t.payments.map((p) => p.id), ["pay0000001"]);
  const live = seed.expenses.filter((e) => e.id !== "seedexp004");
  const pays = [{ from: "Ajen", to: "Mo", cad: 25 }];
  assert.deepEqual(t.owed, money.owedList(NAMES, live, pays, true).map((x) => ({ from: x.from, to: x.to, amount: dollars(x.cents) })));
  assert.deepEqual(t.owed_direct, money.owedList(NAMES, live, pays, false).map((x) => ({ from: x.from, to: x.to, amount: dollars(x.cents) })));
  for (const o of t.owed.concat(t.owed_direct)) assert.match(o.amount, /^\$\d{1,3}(,\d{3})*\.\d{2}$/);
});

test("get_trip leaves out the lines the app sets aside, as the app's maths does", () => {
  const fake = createFakeBackend(seed);
  fake.tables.Expenses[0].paid_by = "Stranger"; // a hand edit
  const t = ok(fake, "get_trip", {});
  assert.equal(t.expenses.some((e) => e.id === "seedexp001"), false);
  const rest = seed.expenses.slice(1);
  assert.deepEqual(t.owed.map((o) => o.amount), money.owedList(NAMES, rest, [], true).map((x) => dollars(x.cents)));
});

test("explain_debt: each one's working, both readings, the routing and the lines they share", () => {
  const fake = createFakeBackend(seed);
  const list = money.owedList(NAMES, seed.expenses, [], true);
  const directList = money.owedList(NAMES, seed.expenses, [], false);
  for (const t of list) {
    const why = ok(fake, "explain_debt", { from: t.from, to: t.to });
    assert.deepEqual(Object.keys(why), ["from", "to", "simplified", "direct", "routed_via", "shared"]);
    for (const side of ["from", "to"]) {
      const w = money.working(why[side].name, seed.expenses, []);
      assert.deepEqual(why[side], { name: t[side], paid: dollars(w.paid), share: dollars(w.share), sent: dollars(w.sent), received: dollars(w.received) });
    }
    assert.deepEqual(why.simplified, { amount: dollars(t.cents) });
    const d = directList.find((x) => x.from === t.from && x.to === t.to);
    assert.deepEqual(why.direct, d ? { amount: dollars(d.cents) } : null);
    assert.equal(why.routed_via, money.routedVia(t, directList, NAMES));
    const both = seed.expenses.filter((e) => !e.deleted && e.split.includes(t.from) && e.split.includes(t.to));
    assert.deepEqual(why.shared.map((x) => x.title), both.map((e) => e.title));
    const s0 = money.expenseShares(both[0]);
    assert.deepEqual(why.shared[0], { title: both[0].title, day: both[0].day, paid_by: both[0].paidBy, total: dollars(money.cadCents(both[0])), from_share: dollars(s0[t.from]), to_share: dollars(s0[t.to]) });
  }
  // The other way round, nobody owes under either reading.
  const back = ok(fake, "explain_debt", { from: list[0].to, to: list[0].from });
  assert.deepEqual([back.simplified, back.routed_via], [null, null]);
});

test("get_history: newest first, 30 by default, at most 200, with id, when, who, the sentence and can_undo", () => {
  const fake = createFakeBackend({});
  for (let i = 0; i < 205; i++) ok(fake, "add_stop", { date: "2026-12-12", title: "Stop " + i });
  const h = ok(fake, "get_history", {});
  assert.deepEqual(Object.keys(h), ["entries"]);
  assert.equal(h.entries.length, 30);
  assert.deepEqual(h.entries[0], { id: 205, when: fake.tables.Log.at(-1).at, who: "Mo", sentence: "Mo added Stop 204 to Sat Dec 12 (through Claude)", can_undo: true });
  assert.equal(ok(fake, "get_history", { limit: 5 }).entries.length, 5);
  assert.equal(ok(fake, "get_history", { limit: 500 }).entries.length, 200);
  assert.equal(ok(fake, "get_history", { limit: 0 }).entries.length, 1);
});

// ---------- what is never given out ----------

test("no tool gives out an e-Transfer address or an email; the History entry about one stays, without it", async () => {
  const fake = createFakeBackend({ ...seed, ...plan });
  await app(fake, "setPerson", { name: "Mo", patch: { etransfer: "mo.pays@example.com" } });
  await app(fake, "setPerson", { name: "Ajen", patch: { etransfer: "416-555-0123" } }, "Ajen");
  fake.tables.People[0].email = "mo.real@example.com";
  const s = ok(fake, "add_stop", { date: "2026-12-12", title: "Pay back", note: "Ajen takes 416-555-0123, or write to someone@example.org" });
  assert.equal(s.stop.note.includes("416-555-0123") || s.stop.note.includes("someone@example.org"), false, s.stop.note);
  const seen = [];
  for (const name of ["get_trip", "get_history"]) seen.push(JSON.stringify(call(fake, name, {})));
  seen.push(JSON.stringify(call(fake, "explain_debt", { from: "Ajen", to: "Mo" })));
  seen.push(JSON.stringify(call(fake, "undo", { log_id: 999 })));
  seen.push(JSON.stringify(fake.mcp(rpc("tools/list"), T)));
  const all = seen.join("");
  for (const secret of ["mo.pays@example.com", "416-555-0123", "mo.real@example.com", "someone@example.org", "etransfer", "email"]) {
    assert.equal(all.includes(secret), false, secret);
  }
  const h = ok(fake, "get_history", {}).entries;
  assert.ok(h.some((e) => e.sentence === "Mo changed Mo’s e-Transfer address"), "the entry is kept, as a sentence only");
  // A map link with an @ in it is not an email.
  const map = "https://www.google.com/maps/place/Tokyo+Tower/@35.6585,139.7454,17z";
  assert.equal(ok(fake, "add_stop", { date: "2026-12-12", title: "Tower", place: map }).stop.place, map);
});

test("the trip key and the token never reach a reply, an error, the Log, History or the Sheet", async () => {
  const fake = createFakeBackend({ ...seed, ...plan });
  const replies = [];
  const r = (x) => { replies.push(JSON.stringify(x)); return x; };
  r(fake.mcp(rpc("initialize", {}), T));
  r(fake.mcp(rpc("tools/list"), T));
  r(fake.mcp(rpc("tools/list"), { t: "test-key" }));
  r(fake.mcp(rpc("nope"), T));
  r(fake.mcp({ id: 1 }, T));
  for (const name of ["get_trip", "get_history"]) r(call(fake, name, {}));
  r(call(fake, "explain_debt", { from: "Mo", to: "Ajen" }));
  const added = r(call(fake, "add_stop", { date: "2026-12-12", title: "Tea house" }));
  r(call(fake, "add_stop", { date: "2026-12-12", title: "x", link: "javascript:1" }));
  r(call(fake, "change_stop", { id: body(added).stop.id, note: "n" }));
  r(call(fake, "undo", { log_id: body(added).log_id }));
  r(call(fake, "undo", { log_id: "x" }));
  r(call(fake, "add_expense", { title: "Tea", amount: 500, currency: "JPY", paid_by: "Mo" }));
  r(call(fake, "save_stay", { name: "Inn", first_night: "2026-12-14", last_night: "2026-12-14" }));
  r(call(fake, "set_day", { date: "2026-12-14", city: "Kyoto" }));
  r(await fake({ key: "test-key", action: "migrate", args: {} }));
  const all = replies.join("");
  assert.equal(all.includes("test-key"), false);
  assert.equal(all.includes("claude-token"), false);
  const stored = JSON.stringify([fake.tables, (await app(fake, "history", {})).data]);
  assert.equal(stored.includes("test-key") || stored.includes("claude-token"), false, "never in the Sheet, the Log or History");

  // Typed into a stop by someone, they are stored as typed; the reply hides them.
  const typed = call(fake, "add_stop", { date: "2026-12-12", title: "claude-token", note: "key test-key" });
  assert.deepEqual([body(typed).stop.title, body(typed).stop.note], ["(hidden)", "key (hidden)"]);
  assert.ok(fake.tables.Stops.some((s) => s.title === "claude-token"));
});

test("an action that throws is answered with the plain server sentence, and a throw in the connector with Internal error", () => {
  const fake = createFakeBackend(plan);
  delete fake.tables.Stops; // readTable_("Stops") now throws inside the action
  const text = refusal(fake, "add_stop", { date: "2026-12-12", title: "x" });
  assert.equal(text, "Something went wrong on our side. Try again.");
  delete fake.tables.People; // the connector itself reads People
  assert.deepEqual(call(fake, "get_trip", {}), { jsonrpc: "2.0", id: 1, error: { code: -32603, message: "Internal error" } });
});

test("the connector never logs: no console or Logger in Mcp.js, and setup never logs the token", () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, "..", "backend", f), "utf8");
  assert.equal(/\b(console|Logger)\s*\./.test(src("Mcp.js")), false);
  assert.equal(/Logger\.log\([^)]*CLAUDE/.test(src("Setup.js")), false);
  const env = src("Env.js");
  assert.equal(/\b(console|Logger)\s*\./.test(env), false);
  const origLog = console.log, origErr = console.error, origWarn = console.warn;
  const lines = [];
  console.log = console.error = console.warn = (...a) => lines.push(a.join(" "));
  try {
    const fake = createFakeBackend(plan);
    call(fake, "get_trip", {});
    call(fake, "add_stop", { date: "2026-12-12", title: "x" });
    fake.mcp(rpc("tools/list"), {});
  } finally {
    console.log = origLog;
    console.error = origErr;
    console.warn = origWarn;
  }
  assert.deepEqual(lines, []);
});

// ---------- claudeLink and the token's creation ----------

test("claudeLink needs no actor, says nothing of the token when there is none, and is not a write", async () => {
  const fake = createFakeBackend({});
  const r = await fake({ key: own(fake, "Mo"), action: "claudeLink" });
  assert.deepEqual([r.ok, r.data.token, r.rev], [true, "claude-token", 0]);
  assert.equal(fake.tables.Log.length, 0);
  delete fake.props.CLAUDE_TOKEN;
  const none = await fake({ key: own(fake, "Mo"), action: "claudeLink", args: {} });
  assert.deepEqual([none.ok, none.error, none.message], [false, "not_found", "The Claude link isn’t set up yet. Ask Mo to run migrate."]);
  assert.equal("CLAUDE_TOKEN" in fake.props, false, "asking does not make one");
});

test("migrate makes CLAUDE_TOKEN (32 hex) when it is missing, keeps one that is there, and never answers with it", async () => {
  const fake = createFakeBackend({});
  const keep = await fake({ key: "test-key", action: "migrate", args: {} });
  assert.deepEqual(keep.data, { added: [] });
  assert.equal(fake.props.CLAUDE_TOKEN, "claude-token");
  delete fake.props.CLAUDE_TOKEN;
  const made = await fake({ key: "test-key", action: "migrate", args: {} });
  assert.deepEqual(made.data, { added: [] });
  assert.match(fake.props.CLAUDE_TOKEN, /^[0-9a-f]{32}$/);
  assert.equal(JSON.stringify(made).includes(fake.props.CLAUDE_TOKEN), false);
  const t = fake.props.CLAUDE_TOKEN;
  await fake({ key: "test-key", action: "migrate", args: {} });
  assert.equal(fake.props.CLAUDE_TOKEN, t, "a second migrate keeps it");
  assert.equal(fake.mcp(rpc("tools/list"), { t }).result.tools.length, 12);
});

test("Apps Script side: setup() and migrate make the token from Utilities.getUuid, newId_ is 20 letters and digits", () => {
  const vm = require("node:vm");
  const props = {};
  const ctx = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    Utilities: { getUuid: () => "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0", formatDate: (d, tz, f) => tz + "|" + f },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "backend", "Env.js"), "utf8"), ctx);
  ctx.ensureClaudeToken_();
  assert.equal(props.CLAUDE_TOKEN, "0f1e2d3c4b5a69788796a5b4c3d2e1f0");
  props.CLAUDE_TOKEN = "kept";
  ctx.ensureClaudeToken_();
  assert.equal(props.CLAUDE_TOKEN, "kept");
  assert.equal(ctx.claudeToken_(), "kept");
  assert.match(ctx.newId_(), /^[A-Za-z][A-Za-z0-9]{19}$/);
  const setup = fs.readFileSync(path.join(__dirname, "..", "backend", "Setup.js"), "utf8");
  assert.match(setup.slice(setup.indexOf("function setup()"), setup.indexOf("function seedIfEmpty_")), /ensureClaudeToken_\(\);/);
});

// ---------- fix round 1 ----------

test("R35: an `as` that names no one refuses every write with -32602 and stores nothing; reads still work", () => {
  const fake = createFakeBackend(plan);
  const before = JSON.stringify(fake.tables);
  const q = { ...T, as: "nobody" };
  for (const [name, args] of [
    ["add_expense", { title: "Tea", amount: 500, currency: "JPY", paid_by: "Mo" }],
    ["add_stop", { date: "2026-12-12", title: "Tea" }],
    ["remove_stop", { id: "planstop1101" }],
    ["undo", { log_id: 1 }],
    ["sync_payments", {}],
  ]) {
    const r = call(fake, name, args, q);
    assert.equal(r.error && r.error.code, -32602, name);
    assert.equal(r.error.message, "Invalid params: the name in this link (as) isn’t one of the people on this trip.");
    for (const n of NAMES) assert.equal(r.error.message.includes(n), false);
  }
  assert.equal(JSON.stringify(fake.tables), before, "nothing stored");
  assert.ok(ok(fake, "get_trip", {}, q).trip);
  assert.ok(ok(fake, "get_history", {}, q).entries);
  assert.ok(ok(fake, "explain_debt", { from: "Mo", to: "Ajen" }, q).from);
  // An empty as is no as: the first person.
  ok(fake, "add_stop", { date: "2026-12-12", title: "Tea" }, { ...T, as: " " });
  assert.equal(fake.tables.Log.at(-1).who, "Mo");
});

test("save_stay with an id changes only the fields given; an empty string clears one", () => {
  const fake = createFakeBackend(plan);
  const s = ok(fake, "save_stay", { name: "Ryokan", first_night: "2026-12-14", last_night: "2026-12-15", name_jp: "旅館", address_jp: "京都市東山区", note: "late check-in", place: "Gion", link: "https://example.test/r" }).stay;
  const moved = ok(fake, "save_stay", { id: s.id, last_night: "2026-12-16" }).stay;
  assert.deepEqual(moved, { ...s, lastNight: "2026-12-16" });
  const row = fake.tables.Stays.find((r) => r.id === s.id);
  assert.deepEqual([row.address_jp, row.note, row.link], ["京都市東山区", "late check-in", "https://example.test/r"]);
  const cleared = ok(fake, "save_stay", { id: s.id, note: "" }).stay;
  assert.deepEqual([cleared.note, cleared.addressJp, cleared.lastNight], ["", "京都市東山区", "2026-12-16"]);
  assert.equal(fake.tables.Log.at(-1).via, "claude");
});

test("save_stay takes a photo; a change without it keeps it, an empty string clears it", () => {
  const fake = createFakeBackend(plan);
  const s = ok(fake, "save_stay", { name: "Inn", first_night: "2026-12-14", last_night: "2026-12-14", photo: "https://example.org/a.jpg" }).stay;
  assert.equal(s.photo, "https://example.org/a.jpg");
  assert.equal(ok(fake, "save_stay", { id: s.id, note: "x" }).stay.photo, "https://example.org/a.jpg");
  assert.equal(refusal(fake, "save_stay", { id: s.id, photo: "http://example.org/a.jpg" }), "That photo link has to start with https://.");
  assert.equal(ok(fake, "save_stay", { id: s.id, photo: "" }).stay.photo, "");
});

test("save_stay: an id that names no stay is refused, a deleted stay is not revived, and without an id the three are needed", () => {
  const fake = createFakeBackend(plan);
  const stays = fake.tables.Stays.length;
  assert.equal(refusal(fake, "save_stay", { id: "nosuchstay01", name: "x", first_night: "2026-12-14", last_night: "2026-12-14" }), "That stay isn’t there any more.");
  assert.equal(fake.tables.Stays.length, stays, "no stay made with that id");
  const s = ok(fake, "save_stay", { name: "Inn", first_night: "2026-12-14", last_night: "2026-12-14" }).stay;
  ok(fake, "remove_stay", { id: s.id });
  assert.equal(refusal(fake, "save_stay", { id: s.id, note: "x" }), "Bring it back first.");
  assert.equal(fake.tables.Stays.find((r) => r.id === s.id).deleted_at !== "", true);
  for (const missing of ["name", "first_night", "last_night"]) {
    const args = { name: "Inn", first_night: "2026-12-14", last_night: "2026-12-14" };
    delete args[missing];
    assert.equal(badArgs(fake, "save_stay", args), "Invalid params: " + missing + " is missing.");
  }
});

test("a string argument holding (hidden) is refused, so leaving a field out keeps it, for stops and stays", () => {
  const fake = createFakeBackend(plan);
  const stop = ok(fake, "add_stop", { date: "2026-12-12", title: "Dinner", note: "confirm with bob@example.com" }).stop;
  assert.equal(stop.note, "confirm with (hidden)");
  const logs = fake.tables.Log.length;
  assert.equal(badArgs(fake, "change_stop", { id: stop.id, note: stop.note + " at 7" }), "Invalid params: note holds (hidden); leave that field out to keep it.");
  assert.equal(badArgs(fake, "add_expense", { title: "x", amount: 1, currency: "JPY", paid_by: "Mo", split: ["Mo", "(hidden)"] }), "Invalid params: split holds (hidden); leave that field out to keep it.");
  assert.equal(badArgs(fake, "add_stop", { date: "2026-12-12", title: "(hidden)" }), "Invalid params: title holds (hidden); leave that field out to keep it.");
  assert.equal(fake.tables.Log.length, logs);
  ok(fake, "change_stop", { id: stop.id, time: "19:00" });
  assert.equal(fake.tables.Stops.find((r) => r.id === stop.id).note, "confirm with bob@example.com", "left out, kept");

  const stay = ok(fake, "save_stay", { name: "Inn", first_night: "2026-12-14", last_night: "2026-12-14", note: "keys from ann@example.com" }).stay;
  assert.equal(badArgs(fake, "save_stay", { id: stay.id, note: stay.note }), "Invalid params: note holds (hidden); leave that field out to keep it.");
  ok(fake, "save_stay", { id: stay.id, last_night: "2026-12-15" });
  assert.equal(fake.tables.Stays.find((r) => r.id === stay.id).note, "keys from ann@example.com", "left out, kept");
});

test("an e-Transfer address that is an ordinary word hides only a field that is exactly it; a phone or email address is never returned", async () => {
  const fake = createFakeBackend({ ...seed, ...plan });
  await app(fake, "setPerson", { name: "Mo", patch: { etransfer: "Tokyo" } });
  await app(fake, "setPerson", { name: "Ajen", patch: { etransfer: "+1 (416) 555-0123" } }, "Ajen");
  await app(fake, "setPerson", { name: "Trenton", patch: { etransfer: "trent@example.net" } }, "Trenton");
  const s = ok(fake, "add_stop", { date: "2026-12-12", title: "Tokyo Tower", detail: "Tokyo", note: "Ajen: +1 (416) 555-0123, Trenton: trent@example.net" }).stop;
  assert.equal(s.title, "Tokyo Tower");
  assert.equal(s.detail, "(hidden)", "a field that is exactly the address");
  assert.equal(s.note, "Ajen: (hidden), Trenton: (hidden)");
  const all = [
    JSON.stringify(call(fake, "get_trip", {})),
    JSON.stringify(call(fake, "get_history", { limit: 200 })),
    JSON.stringify(call(fake, "explain_debt", { from: "Ajen", to: "Mo" })),
    JSON.stringify(call(fake, "change_stop", { id: s.id, link: "javascript:+1 (416) 555-0123" })),
    JSON.stringify(call(fake, "add_expense", { title: "x", amount: 1, currency: "JPY", paid_by: "trent@example.net" })),
  ].join("");
  assert.equal(all.includes("555-0123") || all.includes("trent@example.net"), false);
  assert.ok(all.includes("Tokyo Tower"));
});

// ---------- fix round 2: another phone's write between the connector's start and its write ----------

test("save_stay never undoes another phone's edit made while Claude's request is on its way", async () => {
  const fake = createFakeBackend(plan);
  const s = ok(fake, "save_stay", { name: "Ryokan", first_night: "2026-12-14", last_night: "2026-12-15", note: "orig", address_jp: "京都" }).stay;
  fake.beforeConnectorWrite = (body) => {
    if (body.action !== "saveStay") return;
    fake.beforeConnectorWrite = null;
    fake({ key: "test-key", actor: "Ajen", action: "saveStay", args: { stay: { id: s.id, name: "Ryokan", firstNight: "2026-12-14", lastNight: "2026-12-15", note: "phone B edit", addressJp: "京都" } } });
  };
  const moved = ok(fake, "save_stay", { id: s.id, last_night: "2026-12-16" }).stay;
  assert.deepEqual([moved.note, moved.lastNight, moved.addressJp], ["phone B edit", "2026-12-16", "京都"]);
  const loaded = (await app(fake, "load", {})).data.stays.find((x) => x.id === s.id);
  assert.deepEqual([loaded.note, loaded.lastNight], ["phone B edit", "2026-12-16"]);
  const log = fake.tables.Log.at(-1);
  assert.equal(log.via, "claude");
  const before = JSON.parse(log.before), after = JSON.parse(log.after);
  assert.deepEqual(Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])), ["lastNight"]);
  assert.equal(fake.requests.filter((r) => r.via === "claude" && r.action === "load").length, 0, "the connector reads nothing before writing");
});

test("change_stop never undoes another phone's edit made while Claude's request is on its way", async () => {
  const fake = createFakeBackend(plan);
  fake.beforeConnectorWrite = (body) => {
    if (body.action !== "updateStop") return;
    fake.beforeConnectorWrite = null;
    fake({ key: "test-key", actor: "Ajen", action: "updateStop", args: { id: "planstop1203", patch: { note: "phone B edit" } } });
  };
  const c = ok(fake, "change_stop", { id: "planstop1203", time: "15:00" }).stop;
  assert.deepEqual([c.note, c.time, c.detail], ["phone B edit", "15:00", "Booked for 14:00"]);
  const before = JSON.parse(fake.tables.Log.at(-1).before), after = JSON.parse(fake.tables.Log.at(-1).after);
  assert.deepEqual(Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])), ["time"]);
});

// ---------- final fix wave: M1 (busy) and M2 (add_expense's day) ----------

const stopsSent = (fake) => fake.requests.filter((r) => r.action === "addStop").length;

test("M1: a lock held, then free within the wait: the call is tried again and succeeds once", () => {
  let held = 1;
  const fake = createFakeBackend(plan, { lockFails: () => held-- > 0 });
  const rows = fake.tables.Stops.length;
  const got = ok(fake, "add_stop", { date: "2026-12-12", title: "Tokyu Hands" });
  assert.equal(got.stop.title, "Tokyu Hands");
  assert.equal(stopsSent(fake), 2, "busy once, then saved");
  assert.equal(fake.tables.Stops.length, rows + 1, "one stop");
});

test("M1: a lock held throughout: about 20 seconds of tries, then the busy sentence", () => {
  const fake = createFakeBackend(plan, { lockFails: () => true });
  const rows = fake.tables.Stops.length;
  const text = refusal(fake, "add_stop", { date: "2026-12-12", title: "Tokyu Hands" });
  assert.equal(text, "Someone else is saving right now. Try again in a moment.");
  // Each try waits up to 8 s for the lock (the helper's own timeout); a new
  // try starts only while it can still end within 20 s of the first.
  assert.equal(stopsSent(fake), 2);
  assert.ok(fake.lockWaitedMs() <= 20000, String(fake.lockWaitedMs()));
  assert.equal(fake.tables.Stops.length, rows);
});

test("M1: ping answers {} after the token check", () => {
  const fake = createFakeBackend(plan);
  assert.deepEqual(fake.mcp(rpc("ping"), T), { jsonrpc: "2.0", id: 1, result: {} });
  assert.equal(fake.mcp(rpc("ping"), {}).error.code, -32001);
  assert.equal(fake.mcp(rpc("ping"), { t: "wrong" }).error.code, -32001);
});

test("M2: add_expense refuses a day that is neither pre nor a trip day; pre and a trip day are stored", () => {
  const fake = createFakeBackend(plan);
  const rows = fake.tables.Expenses.length;
  const base = { title: "Ramen", amount: 1200, currency: "JPY", paid_by: "Mo" };
  for (const day of ["2030-01-01", "2026-12-09", "2026-12-21", "tomorrow", ""]) {
    assert.match(badArgs(fake, "add_expense", { ...base, day }), /day/, day);
  }
  assert.equal(fake.tables.Expenses.length, rows, "nothing stored");
  assert.equal(ok(fake, "add_expense", { ...base, day: "pre" }).expense.day, "pre");
  assert.equal(ok(fake, "add_expense", { ...base, day: "2026-12-12" }).expense.day, "2026-12-12");
  assert.equal(fake.tables.Expenses.length, rows + 2);
});

// ---------- payments from the planner sheet (Task 12, R39) ----------
// Made-up planner rows and id.

const PLANNER_ID = "fakePlannerSheet_0123456789abcdefXYZ";
const PHEAD = ["payment_id", "date_paid", "payer", "description", "category", "vendor", "booking_ref", "amount", "currency", "amount_cad", "cad_is_exact", "split_between", "split_type", "status", "include_in_split", "source", "added_by", "notes"];
const prow = (o) => PHEAD.map((h) => (o[h] === undefined ? "" : o[h]));
const PX7 = { payment_id: "X7", date_paid: "2026-12-11", payer: "Mo", description: "Rail pass", category: "transport", vendor: "North Rail", booking_ref: "AB12", amount: 24750, currency: "JPY", amount_cad: 221.52, cad_is_exact: "yes", split_between: "Mo, Ajen, Trenton", split_type: "equal", include_in_split: "yes" };
const PLANNER = [PHEAD, prow(PX7), prow({ ...PX7, payment_id: "P5", split_type: "personal" }), prow({ ...PX7, payment_id: "Z1", include_in_split: "no" })];

test("sync_payments brings the planner's payments in, each credited to who paid, logged as from the planner", () => {
  const fake = createFakeBackend({ planner: PLANNER, plannerId: PLANNER_ID });
  const tool = fake.mcp(rpc("tools/list"), T).result.tools.find((t) => t.name === "sync_payments");
  assert.equal(tool.description, "Use this to bring in what’s been paid from the planner sheet’s Payments tab: new payments are added and changed ones updated. The change shows in the app’s History and can be undone.");
  assert.deepEqual(tool.inputSchema, { type: "object", properties: {}, additionalProperties: false });
  const r = ok(fake, "sync_payments", {}, { ...T, as: " ajen " });
  assert.deepEqual(r, { added: 1, changed: 0, same: 0, removed: 0, not_counted: [], problems: [{ id: "P5", message: "Only payments split equally can be brought in.", row: 3, what: "Rail pass" }], more: false, capped: false });
  assert.deepEqual(fake.tables.Log.map((l) => [l.who, l.via]), [["Mo", "planner"]]); // credited to who paid, not the person in the link
  assert.deepEqual(ok(fake, "sync_payments", {}), { added: 0, changed: 0, same: 1, removed: 0, not_counted: [], problems: [{ id: "P5", message: "Only payments split equally can be brought in.", row: 3, what: "Rail pass" }], more: false, capped: false });
  const h = ok(fake, "get_history", {});
  assert.equal(h.entries[0].sentence, "Mo rang up Rail pass $221.52 (from the planner)");
  assert.equal(badArgs(fake, "sync_payments", { id: "x" }), "Invalid params: unknown argument id.");
  // R40: the tie to the planner is the backend's own business.
  const seen = JSON.stringify([call(fake, "get_trip", {}), call(fake, "get_history", { limit: 200 }), call(fake, "add_expense", { title: "Tea", amount: 300, currency: "JPY", paid_by: "Mo" })]);
  assert.equal(/planner_?[iI]d/.test(seen), false);
  assert.equal(fake.tables.Expenses[0].planner_id, "X7");
});

test("sync_payments says when more remain (10 a pull) and when the planner was cut at 300", () => {
  const many = [PHEAD];
  for (let i = 1; i <= 12; i++) many.push(prow({ ...PX7, payment_id: "R" + i, amount_cad: i }));
  const fake = createFakeBackend({ planner: many, plannerId: PLANNER_ID });
  assert.deepEqual([ok(fake, "sync_payments", {}).added, ok(fake, "sync_payments", {}).added], [10, 2]);
  fake.planner.rows.push(prow({ ...PX7, payment_id: "R13" }));
  for (let i = 14; i <= 25; i++) fake.planner.rows.push(prow({ ...PX7, payment_id: "R" + i }));
  assert.equal(ok(fake, "sync_payments", {}).more, true);
  const big = [PHEAD];
  for (let i = 1; i <= 301; i++) big.push(prow({ ...PX7, payment_id: "C" + i, include_in_split: "no" }));
  assert.equal(ok(createFakeBackend({ planner: big, plannerId: PLANNER_ID }), "sync_payments", {}).capped, true);
  const cols = createFakeBackend({ planner: [PHEAD.slice(1)], plannerId: PLANNER_ID });
  assert.equal(refusal(cols, "sync_payments", {}), "The planner’s Payments tab is missing the column payment_id.");
});

test("sync_payments needs the token and a known `as`; a refusal is the backend's sentence; the planner id is never in a reply", () => {
  const fake = createFakeBackend({ planner: PLANNER, plannerId: PLANNER_ID });
  assert.equal(call(fake, "sync_payments", {}, {}).error.code, -32001);
  const reads = fake.planner.reads;
  const r = call(fake, "sync_payments", {}, { ...T, as: "nobody" });
  assert.equal(r.error.code, -32602);
  assert.equal(fake.planner.reads, reads, "the planner is not read");
  assert.equal(fake.tables.Expenses.length, 0);

  const replies = [];
  fake.planner.fails = true;
  replies.push(call(fake, "sync_payments", {}));
  assert.equal(refusal(fake, "sync_payments", {}), "Couldn’t read the planner sheet. Ask Mo to check its permission.");
  fake.planner.fails = false;
  // A planner cell that holds the id itself is hidden too.
  fake.planner.rows = [PHEAD, prow({ ...PX7, vendor: PLANNER_ID }), prow({ ...PX7, payment_id: "N2", payer: PLANNER_ID })];
  replies.push(call(fake, "sync_payments", {}), call(fake, "get_trip", {}), call(fake, "get_history", {}));
  const text = JSON.stringify(replies);
  assert.equal(text.includes(PLANNER_ID), false);
  assert.ok(text.includes("(hidden)"));

  const unlinked = createFakeBackend({ planner: PLANNER });
  assert.equal(refusal(unlinked, "sync_payments", {}), "No planner sheet is linked yet. Ask Mo to link it.");
});

// ---------- Task 16: pictures ----------

test("get_trip says who has a picture, never the picture; undoing one answers without it; no tool sets one", async () => {
  const JPEG = require("./fixtures/picture.json").jpeg;
  const fake = createFakeBackend({ ...seed, ...plan });
  await app(fake, "setPerson", { name: "Ajen", patch: { photo: JPEG } }, "Ajen");
  const t = ok(fake, "get_trip", {});
  assert.deepEqual(t.people, NAMES);
  assert.deepEqual(t.has_picture, { Mo: false, Ajen: true, Trenton: false });
  const h = ok(fake, "get_history", {}).entries;
  assert.equal(h[0].sentence, "Ajen set a picture");
  // The connector always acts as the owner (security): even with as=Ajen it
  // cannot undo Ajen's picture, and it can undo the owner's.
  const theirs = call(fake, "undo", { log_id: h[0].id }, { ...T, as: "Ajen" });
  assert.equal(theirs.result.isError, true, "the connector, acting as Mo, cannot change Ajen's");
  assert.match(theirs.result.content[0].text, /own picture/);
  await app(fake, "setPerson", { name: "Mo", patch: { photo: JPEG } });
  const mine = ok(fake, "get_history", {}).entries[0];
  const u = ok(fake, "undo", { log_id: mine.id }, { ...T, as: "Ajen" });
  assert.deepEqual(u.person, { name: "Mo", has_picture: false });
  await app(fake, "setPerson", { name: "Mo", patch: { photo: JPEG } });
  const seen = [];
  for (const name of ["get_trip", "get_history"]) seen.push(JSON.stringify(call(fake, name, {})));
  seen.push(JSON.stringify(call(fake, "undo", { log_id: mine.id })));
  seen.push(JSON.stringify(fake.mcp(rpc("tools/list"), T)));
  const all = seen.join("");
  assert.equal(all.includes("data:image"), false);
  assert.equal(all.includes(JPEG.slice(30, 60)), false);
  assert.equal(all.includes("photo\":\"data"), false);
  assert.equal(fake.mcp(rpc("tools/list"), T).result.tools.length, 12, "no new tool");
});
