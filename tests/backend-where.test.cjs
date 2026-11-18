// Where things are (location build, item 3): Stops, Stays and Days gain lat
// and lng (numbers as text, "" when unknown); migrate adds them; `locate`
// geocodes what has none (at most 40 lookups a call); saveStop clears a
// stop's coordinates when its place changes; the app can set them from a
// pasted Maps link; the connector reads them but cannot set them.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const P = require("../backend/Pure.js");
const { createFakeBackend } = require("./fake-backend.cjs");

const KEY = "test-key";
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "seed.json"), "utf8"));
const PLAN = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "plan.json"), "utf8"));
const WITH_PLAN = { ...SEED, ...PLAN };

function client(seed = WITH_PLAN, opts) {
  const fake = createFakeBackend(JSON.parse(JSON.stringify(seed)), opts);
  const call = (action, args = {}, extra = {}) => fake({ key: KEY, actor: "Mo", action, args, ...extra });
  call.fake = fake;
  return call;
}

// A stand-in geocoder: answers from a table, counts the questions.
function geocoder(call, table) {
  const asked = [];
  call.fake.geocoder.answer = (q, region) => {
    asked.push({ q, region });
    return Object.prototype.hasOwnProperty.call(table, q) ? table[q] : null;
  };
  return asked;
}

const stopById = (d, id) => d.stops.find((s) => s.id === id);

test("the tabs have lat and lng", () => {
  for (const tab of ["Stops", "Stays", "Days"]) {
    assert.ok(P.TABS[tab].includes("lat") && P.TABS[tab].includes("lng"), tab);
    assert.equal(P.isTextColumn(tab, "lat"), true, "numbers as text");
  }
});

test("load returns lat and lng as text, \"\" when unknown or not a coordinate", async () => {
  const call = client();
  const d = (await call("load")).data;
  for (const s of d.stops) assert.deepEqual([s.lat, s.lng], ["", ""]);
  for (const s of d.stays) assert.deepEqual([s.lat, s.lng], ["", ""]);
  for (const day of d.days) assert.deepEqual([day.lat, day.lng], ["", ""]);
  // Typed by hand: good numbers read back as text; anything else as "".
  const row = call.fake.tables.Stops.find((r) => r.id === "planstop1203");
  row.lat = "35.6585";
  row.lng = 139.7023;
  const row2 = call.fake.tables.Stops.find((r) => r.id === "planstop1204");
  row2.lat = "north";
  row2.lng = "139";
  const d2 = (await call("load")).data;
  assert.deepEqual([stopById(d2, "planstop1203").lat, stopById(d2, "planstop1203").lng], ["35.6585", "139.7023"]);
  assert.deepEqual([stopById(d2, "planstop1204").lat, stopById(d2, "planstop1204").lng], ["", ""], "half a coordinate is none");
});

test("migrate adds the columns to an older Sheet and is safe to repeat", async () => {
  const call = client({ ...WITH_PLAN, missingColumns: ["Stops.lat", "Stops.lng", "Stays.lat", "Stays.lng", "Days.lat", "Days.lng"] });
  // Before migrate: load works, with no coordinates; locate is refused.
  const d = (await call("load")).data;
  assert.equal(stopById(d, "planstop1203").lat, "");
  const early = await call.fake({ key: KEY, action: "locate", args: {} });
  assert.deepEqual([early.ok, early.error], [false, "needs_migrate"]);
  const added = (await call.fake({ key: KEY, action: "migrate", args: {} })).data.added;
  assert.deepEqual(added.sort(), ["Days.lat", "Days.lng", "Stays.lat", "Stays.lng", "Stops.lat", "Stops.lng"]);
  assert.deepEqual((await call.fake({ key: KEY, action: "migrate", args: {} })).data.added, []);
});

test("locate needs the trip key, geocodes what has no coordinates, and says what it found", async () => {
  const call = client();
  const asked = geocoder(call, {
    "Shibuya Sky Tokyo": { lat: 35.6585, lng: 139.7023 },
    "Meiji Jingu Tokyo": { lat: 35.6764, lng: 139.6993 },
    "東京都台東区浅草1-1-1": { lat: 35.7119, lng: 139.7967 },
    Tokyo: { lat: 35.6812, lng: 139.7671 },
    "Dinner Tokyo": { lat: 35.68, lng: 139.77 },
  });
  assert.equal((await call.fake({ key: "wrong", action: "locate", args: {} })).error, "bad_key");
  const revBefore = (await call("load")).rev;
  const r = await call.fake({ key: KEY, action: "locate", args: {} });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(typeof r.data.found, "number");
  assert.equal(r.data.more, false);
  for (const a of asked) assert.equal(a.region, "jp");
  const d = (await call("load")).data;
  assert.deepEqual([stopById(d, "planstop1203").lat, stopById(d, "planstop1203").lng], ["35.6585", "139.7023"]);
  assert.equal(stopById(d, "planstop1201").lat, "35.6764");
  // A stop with no place: its title plus the day's city.
  assert.equal(stopById(d, "planstop1204").lat, "35.68");
  const asakusa = d.stays.find((s) => s.id === "planstay0001");
  assert.deepEqual([asakusa.lat, asakusa.lng], ["35.7119", "139.7967"], "a stay by its Japanese address");
  assert.equal(d.days.find((x) => x.date === "2026-12-12").lat, "35.6812", "a day by its city");
  // Nothing found for the rest: "" and counted as missing; asked again next call.
  assert.ok(r.data.missing > 0, JSON.stringify(r.data));
  assert.equal(r.data.found, 3 + 1 + 2, JSON.stringify(r.data)); // stops 1201, 1203, 1204; one stay; the two Tokyo days
  assert.ok(r.rev > revBefore, "phones learn the new coordinates on their next check");
  // Nothing is logged in History.
  assert.equal(call.fake.tables.Log.filter((x) => x.action === "locate").length, 0);
  const again = asked.length;
  const r2 = await call.fake({ key: KEY, action: "locate", args: {} });
  assert.equal(r2.data.found, 0);
  assert.ok(asked.length > again, "the missing ones are asked again");
  assert.ok(!asked.slice(again).some((a) => a.q === "Shibuya Sky Tokyo"), "a found one is not asked again");
});

test("locate: a stop's place first, then its title with the day's city; a stay's address, then its name with its place", async () => {
  const call = client();
  const asked = geocoder(call, { "Lunch in Harajuku Tokyo": { lat: 35.67, lng: 139.70 }, "Niseko lodge": null });
  await call.fake({ key: KEY, action: "locate", args: {} });
  const first = asked.map((a) => a.q);
  // Meiji: its place this call, its title with the day's city the next (one lookup a row a call).
  assert.ok(first.includes("Meiji Jingu Tokyo") && !first.includes("Meiji Shrine Tokyo"), first.join(" | "));
  await call.fake({ key: KEY, action: "locate", args: {} });
  const qs = asked.map((a) => a.q);
  assert.ok(qs.includes("Meiji Shrine Tokyo"), qs.join(" | "));
  assert.ok(qs.includes("Lunch in Harajuku Tokyo"), qs.join(" | "));
  // Niseko lodge has no address and no place: its name alone.
  assert.ok(qs.includes("Niseko lodge"), qs.join(" | "));
  // A deleted stop is not looked up.
  assert.equal(qs.some((q) => q.startsWith("undefined")), false);
});

test("locate: a place that is a Maps link with a position is read without a lookup", async () => {
  const seed = JSON.parse(JSON.stringify(WITH_PLAN));
  seed.stops.find((s) => s.id === "planstop1202").place = "https://www.google.com/maps/place/x/@35.1,139.1,17z/data=!3d35.6702!4d139.7027";
  const call = client(seed);
  const asked = geocoder(call, {});
  await call.fake({ key: KEY, action: "locate", args: {} });
  const d = (await call("load")).data;
  assert.deepEqual([stopById(d, "planstop1202").lat, stopById(d, "planstop1202").lng], ["35.6702", "139.7027"]);
  assert.equal(asked.some((a) => a.q.includes("maps")), false);
});

test("locate: at most 40 lookups a call, then more: true; a failing geocoder leaves \"\" and does not stop the call", async () => {
  const seed = JSON.parse(JSON.stringify(WITH_PLAN));
  for (let i = 0; i < 50; i++) seed.stops.push({ id: "bulkstop" + String(i).padStart(4, "0"), date: "2026-12-14", time: "", title: "Spot " + i });
  const call = client(seed);
  let n = 0;
  call.fake.geocoder.answer = (q) => {
    n++;
    if (q === "Spot 3") throw new Error("quota");
    return null;
  };
  const r = await call.fake({ key: KEY, action: "locate", args: {} });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(n, 40);
  assert.equal(r.data.more, true);
  const r2 = await call.fake({ key: KEY, action: "locate", args: {} });
  assert.equal(r2.ok, true);
});

test("saveStop clears a stop's coordinates when its place changes, and keeps them otherwise", async () => {
  const call = client();
  geocoder(call, { "Shibuya Sky Tokyo": { lat: 35.6585, lng: 139.7023 } });
  await call.fake({ key: KEY, action: "locate", args: {} });
  let r = await call("updateStop", { id: "planstop1203", patch: { note: "Floor 14" } });
  assert.equal(r.data.stop.lat, "35.6585", "an unrelated change keeps them");
  r = await call("updateStop", { id: "planstop1203", patch: { place: "Shibuya Scramble Square" } });
  assert.deepEqual([r.data.stop.lat, r.data.stop.lng], ["", ""], "a new place clears them");
  // Undo puts the old place and its coordinates back.
  const u = await call("undo", { logId: r.data.logId });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(u.data.stop.lat, "35.6585");
});

test("the app sets a stop's coordinates (from a pasted link); a place change with them keeps the new ones", async () => {
  const call = client();
  let r = await call("updateStop", { id: "planstop1204", patch: { lat: "35.6612", lng: "139.6990" } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.data.stop.lat, r.data.stop.lng], ["35.6612", "139.699"]);
  assert.match(call.fake.tables.Log.at(-1).summary, /changed Dinner: map/);
  r = await call("updateStop", { id: "planstop1204", patch: { place: "Uobei", lat: "35.66", lng: "139.70" } });
  assert.deepEqual([r.data.stop.lat, r.data.stop.lng], ["35.66", "139.7"]);
  // Taken off the map.
  r = await call("updateStop", { id: "planstop1204", patch: { lat: "", lng: "" } });
  assert.deepEqual([r.data.stop.lat, r.data.stop.lng], ["", ""]);
  for (const bad of [{ lat: "91", lng: "0" }, { lat: "35", lng: "" }, { lat: "x", lng: "y" }, { lat: 35, lng: 139 }]) {
    const e = await call("updateStop", { id: "planstop1204", patch: bad });
    assert.equal(e.error, "bad_input", JSON.stringify(bad));
  }
  // A new stop can carry them too.
  const add = await call("addStop", { stop: { id: "newstop00001", date: "2026-12-12", title: "Tea", lat: "35.0", lng: "135.7" } });
  assert.deepEqual([add.data.stop.lat, add.data.stop.lng], ["35", "135.7"]);
});

test("the connector reads coordinates but cannot set them", async () => {
  const call = client();
  geocoder(call, { "Shibuya Sky Tokyo": { lat: 35.6585, lng: 139.7023 } });
  await call.fake({ key: KEY, action: "locate", args: {} });
  const rpc = (name, args) => call.fake.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { t: "claude-token" });
  const trip = rpc("get_trip", {});
  assert.ok(JSON.stringify(trip).includes("35.6585"), "get_trip shows them: " + JSON.stringify(trip).slice(0, 300));
  // Asked to change a stop's lat/lng, the connector refuses: they are not its arguments.
  const refused = rpc("change_stop", { id: "planstop1203", note: "x", lat: "1", lng: "1" });
  assert.match(JSON.stringify(refused), /unknown argument lat/);
  const d = (await call("load")).data;
  assert.equal(stopById(d, "planstop1203").lat, "35.6585");
  // Straight through handle_ as the connector: refused.
  const e = await call.fake.claude("updateStop", { id: "planstop1203", patch: { lat: "1", lng: "1" } });
  assert.equal(e.error, "bad_input");
});

// ---- fix round ----

test("I1: undoing an older edit leaves coordinates found since; undoing an edit that set them puts the old ones back", async () => {
  const call = client();
  // An edit made before locate ran.
  const title = await call("updateStop", { id: "planstop1203", patch: { title: "Sky deck" } });
  geocoder(call, { "Shibuya Sky Tokyo": { lat: 35.6585, lng: 139.7023 }, "Shibuya Sky": { lat: 35.6585, lng: 139.7023 } });
  await call.fake({ key: KEY, action: "locate", args: {} });
  assert.equal(stopById((await call("load")).data, "planstop1203").lat, "35.6585");
  const u = await call("undo", { logId: title.data.logId });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(u.data.stop.title, "Shibuya Sky");
  assert.deepEqual([u.data.stop.lat, u.data.stop.lng], ["35.6585", "139.7023"], "the coordinates stay");
  // An edit that pasted a Maps link: its undo brings the old coordinates back.
  const pasted = await call("updateStop", { id: "planstop1203", patch: { lat: "35.6", lng: "139.6" } });
  const u2 = await call("undo", { logId: pasted.data.logId });
  assert.deepEqual([u2.data.stop.lat, u2.data.stop.lng], ["35.6585", "139.7023"]);
  // Undoing a stop's removal leaves coordinates alone too.
  const del = await call("deleteStop", { id: "planstop1203" });
  const u3 = await call("undo", { logId: del.data.logId });
  assert.equal(u3.data.stop.lat, "35.6585");
});

test("I1: the same for a day's edit made before locate", async () => {
  const call = client();
  const e = await call("setDay", { date: "2026-12-12", patch: { title: "Busy" } });
  geocoder(call, { Tokyo: { lat: 35.68, lng: 139.77 } });
  await call.fake({ key: KEY, action: "locate", args: {} });
  const u = await call("undo", { logId: e.data.logId });
  assert.equal(u.ok, true);
  assert.equal(u.data.day.lat, "35.68");
});

function withSpots(n, good = true) {
  const seed = JSON.parse(JSON.stringify(WITH_PLAN));
  for (let i = 0; i < n; i++) seed.stops.push({ id: "nowhere" + String(i).padStart(5, "0"), date: "2026-12-14", time: "", title: "Nowhere " + i, place: "Nowhere place " + i });
  if (good) seed.stops.push({ id: "goodstop0001", date: "2026-12-14", time: "", title: "Good", place: "Good place" });
  return seed;
}

test("I2: failed lookups do not starve the rest: one lookup a row a call, untried rows first", async () => {
  const call = client(withSpots(25));
  const asked = geocoder(call, { "Good place": { lat: 35.1, lng: 139.1 } });
  const r = await call.fake({ key: KEY, action: "locate", args: {} });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(stopById((await call("load")).data, "goodstop0001").lat, "35.1", "the good one on the first call");
  assert.equal(r.data.more, false, "every row was tried once");
  // Each row cost one lookup at most.
  const byStop = asked.filter((a) => /^Nowhere/.test(a.q));
  assert.equal(byStop.length, 25, byStop.map((a) => a.q).join(" | "));
  // The next call tries their other form (title with the day's city).
  const before = asked.length;
  await call.fake({ key: KEY, action: "locate", args: {} });
  const next = asked.slice(before).map((a) => a.q);
  assert.ok(next.includes("Nowhere 0"), "its title (Dec 14 has no city): " + next.join(" | "));
  assert.equal(next.includes("Nowhere place 0"), false);
  // What was tried is kept in one Script Property, only for rows still there.
  const tried = JSON.parse(call.fake.props.LOCATE_TRIED);
  assert.ok(Object.keys(tried).length > 0 && !Object.keys(tried).some((k) => k.includes("goodstop0001")));
});

test("I2: more is true only while untried rows remain; the next call takes those first", async () => {
  const call = client(withSpots(45));
  geocoder(call, { "Good place": { lat: 35.1, lng: 139.1 } });
  const r1 = await call.fake({ key: KEY, action: "locate", args: {} });
  assert.equal(r1.data.more, true);
  assert.equal(stopById((await call("load")).data, "goodstop0001").lat, "");
  const r2 = await call.fake({ key: KEY, action: "locate", args: {} });
  assert.equal(stopById((await call("load")).data, "goodstop0001").lat, "35.1", "untried rows go before rows tried already");
  assert.equal(r2.data.more, false);
  // A row that is gone is pruned from the tried list.
  call.fake.tables.Stops.find((x) => x.id === "nowhere00000").deleted_at = "2026-12-01T00:00:00Z";
  await call.fake({ key: KEY, action: "locate", args: {} });
  assert.equal("stop:nowhere00000" in JSON.parse(call.fake.props.LOCATE_TRIED), false);
});

test("I4: a stop's place is looked up with its day's city, and an answer far from the day counts as not found", async () => {
  const call = client();
  const asked = geocoder(call, {
    Tokyo: { lat: 35.6812, lng: 139.7671 },
    // A Shibuya Sky in another city: 400 km from the day.
    "Shibuya Sky Tokyo": { lat: 34.6937, lng: 135.5023 },
    // Meiji Jingu found close by.
    "Meiji Jingu Tokyo": { lat: 35.6764, lng: 139.6993 },
  });
  const r = await call.fake({ key: KEY, action: "locate", args: {} });
  const qs = asked.map((a) => a.q);
  assert.ok(qs.includes("Shibuya Sky Tokyo") && !qs.includes("Shibuya Sky"), qs.join(" | "));
  const d = (await call("load")).data;
  assert.equal(stopById(d, "planstop1203").lat, "", "400 km from the day: not taken");
  assert.equal(stopById(d, "planstop1201").lat, "35.6764");
  assert.ok(r.data.missing > 0);
});

test("I4: with the day not yet located, the answer is taken (nothing to check it against)", async () => {
  const call = client();
  geocoder(call, { "Shibuya Sky Tokyo": { lat: 34.6937, lng: 135.5023 } });
  await call.fake({ key: KEY, action: "locate", args: {} });
  assert.equal(stopById((await call("load")).data, "planstop1203").lat, "34.6937");
});

test("(c) a stay whose address, name or place changes loses its coordinates; other edits keep them; undo puts them back", async () => {
  const call = client();
  const at = () => { const r = call.fake.tables.Stays.find((x) => x.id === "planstay0001"); r.lat = "35.7119"; r.lng = "139.7967"; };
  const stay = async () => (await call("load")).data.stays.find((x) => x.id === "planstay0001");
  const base = async () => { const s = await stay(); const { deleted, lat, lng, ...rest } = s; return rest; };
  at();
  let r = await call("saveStay", { stay: { ...(await base()), note: "Late check-in" } });
  assert.equal(r.data.stay.lat, "35.7119", "a note keeps them");
  for (const change of [{ addressJp: "東京都台東区浅草2-2-2" }, { place: "Asakusa Inn Tokyo" }]) {
    at();
    r = await call("saveStay", { stay: { ...(await base()), ...change } });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual([r.data.stay.lat, r.data.stay.lng], ["", ""], JSON.stringify(change));
  }
  const u = await call("undo", { logId: r.data.logId });
  assert.equal(u.data.stay.lat, "35.7119", "undoing the change brings them back");
  // Through the connector (merge) too.
  at();
  const m = await call.fake.claude("saveStay", { stay: { id: "planstay0001", addressJp: "別の住所" }, merge: true });
  assert.equal(m.data.stay.lat, "");
});

test("(d) a stay's name-only change keeps its coordinates; an address change clears them", async () => {
  const call = client();
  const at = () => { const r = call.fake.tables.Stays.find((x) => x.id === "planstay0001"); r.lat = "35.7119"; r.lng = "139.7967"; };
  const base = async () => { const s = (await call("load")).data.stays.find((x) => x.id === "planstay0001"); const { deleted, lat, lng, ...rest } = s; return rest; };
  at();
  let r = await call("saveStay", { stay: { ...(await base()), name: "Asakusa Inn" } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.data.stay.name, r.data.stay.lat, r.data.stay.lng], ["Asakusa Inn", "35.7119", "139.7967"]);
  const u = await call("undo", { logId: r.data.logId });
  assert.deepEqual([u.data.stay.name, u.data.stay.lat], ["Asakusa hotel", "35.7119"], "undoing a name change keeps them too");
  r = await call("saveStay", { stay: { ...(await base()), addressJp: "東京都台東区浅草2-2-2" } });
  assert.deepEqual([r.data.stay.lat, r.data.stay.lng], ["", ""]);
});

test("(c) a day whose city changes loses its coordinates; another change keeps them", async () => {
  const call = client();
  const at = () => { const r = call.fake.tables.Days.find((x) => x.date === "2026-12-12"); r.lat = "35.68"; r.lng = "139.77"; };
  at();
  let r = await call("setDay", { date: "2026-12-12", patch: { title: "Busy" } });
  assert.equal(r.data.day.lat, "35.68");
  r = await call("setDay", { date: "2026-12-12", patch: { city: "Tokyo" } });
  assert.equal(r.data.day.lat, "35.68", "the same city is no change");
  r = await call("setDay", { date: "2026-12-12", patch: { city: "Yokohama" } });
  assert.deepEqual([r.data.day.lat, r.data.day.lng], ["", ""]);
  const u = await call("undo", { logId: r.data.logId });
  assert.equal(u.data.day.lat, "35.68");
});

test("(d) an expense edit never runs the coordinates check nor answers with a stop's message", async () => {
  const call = client();
  const add = await call("addExpense", { expense: { id: "exp0000001", day: "2026-12-10", title: "Ramen", amount: 4200, currency: "JPY", paidBy: "Mo", split: ["Mo", "Ajen", "Trenton"] } });
  assert.equal(add.ok, true, JSON.stringify(add));
  for (const via of ["app", "claude"]) {
    const e = await call("updateExpense", { id: "exp0000001", patch: { lat: "1", lng: "2" } }, { via });
    assert.deepEqual([e.ok, e.message], [false, "Only a line’s details can be changed."], via);
  }
  const ok = await call("updateExpense", { id: "exp0000001", patch: { title: "Ramen bar" } });
  assert.equal(ok.ok, true);
  // The connector has no expense edit (its tools don't make one).
  assert.equal((await call.fake.claude("updateExpense", { id: "exp0000001", patch: { title: "x" } })).ok, false);
});

// ---- undo of a position edit that locate has answered since ----

test("undo: a stop's place changed with no coordinates, located at the new place, then undone: coordinates cleared, the old place found again", async () => {
  const call = client();
  geocoder(call, { "Shibuya Sky Tokyo": { lat: 35.6585, lng: 139.7023 }, "New spot Tokyo": { lat: 35.1, lng: 139.1 } });
  const e = await call("updateStop", { id: "planstop1203", patch: { place: "New spot" } });
  await call.fake({ key: KEY, action: "locate", args: {} });
  assert.equal(stopById((await call("load")).data, "planstop1203").lat, "35.1");
  const u = await call("undo", { logId: e.data.logId });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(u.data.stop.place, "Shibuya Sky");
  assert.deepEqual([u.data.stop.lat, u.data.stop.lng], ["", ""]);
  await call.fake({ key: KEY, action: "locate", args: {} });
  const s = stopById((await call("load")).data, "planstop1203");
  assert.deepEqual([s.lat, s.lng], ["35.6585", "139.7023"]);
});

test("undo: the same for a stay's address and a stay's place; a stay's name is not a position", async () => {
  const call = client();
  const asked = geocoder(call, { "別の住所": { lat: 35.1, lng: 139.1 }, "東京都台東区浅草1-1-1": { lat: 35.7119, lng: 139.7967 } });
  const stay = async () => (await call("load")).data.stays.find((x) => x.id === "planstay0001");
  const base = async () => { const s = await stay(); const { deleted, lat, lng, ...rest } = s; return rest; };
  const e = await call("saveStay", { stay: { ...(await base()), addressJp: "別の住所" } });
  assert.equal(e.ok, true, JSON.stringify(e));
  await call.fake({ key: KEY, action: "locate", args: {} });
  assert.equal((await stay()).lat, "35.1", asked.map((a) => a.q).join(" | "));
  const u = await call("undo", { logId: e.data.logId });
  assert.equal(u.data.stay.addressJp, "東京都台東区浅草1-1-1");
  assert.deepEqual([u.data.stay.lat, u.data.stay.lng], ["", ""]);
  await call.fake({ key: KEY, action: "locate", args: {} });
  assert.equal((await stay()).lat, "35.7119");
  // A place (the address is blank, so locate asks for the place).
  const call2 = client();
  const row = call2.fake.tables.Stays.find((x) => x.id === "planstay0001");
  row.addressJp = ""; row.address_jp = "";
  geocoder(call2, { "Asakusa hotel Other inn": { lat: 35.2, lng: 139.2 }, "Asakusa hotel Asakusa hotel Tokyo": { lat: 35.7, lng: 139.8 } });
  const stay2 = async () => (await call2("load")).data.stays.find((x) => x.id === "planstay0001");
  const b2 = async () => { const s = await stay2(); const { deleted, lat, lng, ...rest } = s; return rest; };
  const e2 = await call2("saveStay", { stay: { ...(await b2()), place: "Other inn" } });
  await call2.fake({ key: KEY, action: "locate", args: {} });
  assert.equal((await stay2()).lat, "35.2");
  const u2 = await call2("undo", { logId: e2.data.logId });
  assert.equal(u2.data.stay.place, "Asakusa hotel Tokyo");
  assert.deepEqual([u2.data.stay.lat, u2.data.stay.lng], ["", ""]);
  await call2.fake({ key: KEY, action: "locate", args: {} });
  assert.equal((await stay2()).lat, "35.7");
});

test("undo: the same for a day's city", async () => {
  const call = client();
  geocoder(call, { Yokohama: { lat: 35.44, lng: 139.64 }, Tokyo: { lat: 35.68, lng: 139.77 } });
  const e = await call("setDay", { date: "2026-12-12", patch: { city: "Yokohama" } });
  await call.fake({ key: KEY, action: "locate", args: {} });
  const day = async () => (await call("load")).data.days.find((x) => x.date === "2026-12-12");
  assert.equal((await day()).lat, "35.44");
  const u = await call("undo", { logId: e.data.logId });
  assert.equal(u.data.day.city, "Tokyo");
  assert.deepEqual([u.data.day.lat, u.data.day.lng], ["", ""]);
  await call.fake({ key: KEY, action: "locate", args: {} });
  assert.equal((await day()).lat, "35.68");
});
