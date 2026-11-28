// The Claude connector: doPost (Code.js) hands a JSON-RPC 2.0 body here, and
// mcp_(msg, params) answers it as an MCP server whose tools are the trip's
// own actions. params is the address's query: t (the token, CLAUDE_TOKEN in
// Script Properties) and as (who the writes are made as).
//
// - initialize needs no token; every other method checks t with sameKey.
// - Every request goes through handleAs_ (Actions.js) as the holder
//   { kind: "claude" }, after the token check here: it is validated, logged
//   (via "claude") and undoable as the app's are, and it needs no trip key
//   (the shared key may be retired). Every write is made as the trip's first
//   person, the owner (security, 2026-11-18). Nothing here
//   touches the Sheet itself; the reads are handle_'s load and history, and
//   People for who the writes are made as.
// - A reply never holds the trip key, the token, the planner sheet's id, an
//   e-Transfer address or an email (mcpScrub_), and an error reply says
//   nothing about the trip.
// - Nothing here logs.
//
// One registry of tools (mcpTools_), read by tools/list and tools/call. It is
// built on call: Apps Script loads Mcp.js before Money.js and Pure.js.

var MCP_HIDDEN_ = "(hidden)";
var MCP_EMAIL_RE_ = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// Every write tool's description ends with this.
var MCP_UNDOABLE_ = "The change shows in the app’s History and can be undone.";
// How long one tool call may spend waiting for the write lock, in all. Each
// try waits up to MCP_LOCK_TRY_MS_ (withLock_'s own timeout) and a new try starts
// only while it can still end within this.
var MCP_BUSY_WAIT_MS_ = 20000;
var MCP_LOCK_TRY_MS_ = 8000;

function mcp_(msg, params) {
  var id = null;
  try {
    if (!isObj_(msg) || typeof msg.method !== "string" || !mcpIsId_(msg.id)) return mcpError_(null, -32600, "Invalid request");
    id = msg.id;
    if (msg.method === "initialize") {
      return mcpResult_(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "mat", version: "1" } });
    }
    var query = isObj_(params) ? params : {};
    if (!sameKey(query.t, claudeToken_())) return mcpError_(id, -32001, "Unauthorized");
    if (msg.method === "tools/list") {
      return mcpResult_(id, {
        tools: mcpTools_().map(function (t) {
          return { name: t.name, description: t.description, inputSchema: mcpSchema_(t) };
        }),
      });
    }
    if (msg.method === "tools/call") return mcpCall_(id, msg.params, query);
    if (msg.method === "ping") return mcpResult_(id, {});
    return mcpError_(id, -32601, "Method not found");
  } catch (e) {
    return mcpError_(id, -32603, "Internal error");
  }
}

function mcpIsId_(id) {
  return typeof id === "string" || (typeof id === "number" && isFinite(id));
}

function mcpResult_(id, result) {
  return { jsonrpc: "2.0", id: id, result: result };
}

function mcpError_(id, code, message) {
  return { jsonrpc: "2.0", id: id, error: { code: code, message: message } };
}

// An argument the tool cannot use: thrown by the argument readers, answered -32602.
function mcpBad_(why) {
  throw { mcpBadArgs: "Invalid params: " + why };
}

function mcpCall_(id, p, query) {
  if (!isObj_(p) || typeof p.name !== "string") return mcpError_(id, -32602, "Invalid params");
  var tool = null;
  mcpTools_().forEach(function (t) { if (t.name === p.name) tool = t; });
  if (!tool) return mcpError_(id, -32601, "Unknown tool");
  var raw = p.arguments === undefined || p.arguments === null ? {} : p.arguments;
  if (!isObj_(raw)) return mcpError_(id, -32602, "Invalid params: arguments has to be an object.");
  var people = peopleRows_().map(personFromRow);
  var names = people.map(function (x) { return x.name; });
  var out;
  try {
    var args = mcpArgs_(tool, raw);
    var actor = mcpActor_(query.as, names);
    if (actor === null && tool.write) mcpBad_("the name in this link (as) isn’t one of the people on this trip.");
    // Security (2026-11-18): the one token is the owner's, so every write is
    // made as the owner whatever `as` says; `as` only picks whose reads.
    out = tool.run(args, { actor: tool.write ? names[0] : actor === null ? names[0] : actor, names: names });
  } catch (e) {
    if (e && typeof e.mcpBadArgs === "string") return mcpError_(id, -32602, e.mcpBadArgs);
    throw e;
  }
  var hide = mcpSecrets_(people);
  if (!out.ok) return mcpResult_(id, { content: [{ type: "text", text: mcpScrub_(out.message, hide) }], isError: true });
  return mcpResult_(id, { content: [{ type: "text", text: JSON.stringify(mcpScrub_(out.value, hide)) }] });
}

// Who the writes are made as (R35): the person `as` names, whatever its case
// and surrounding spaces; the first person when there is no `as`; null when
// it names no one (a write is then refused, a read goes ahead).
function mcpActor_(as, names) {
  var want = typeof as === "string" ? as.trim().toLowerCase() : "";
  if (want === "") return names[0];
  for (var i = 0; i < names.length; i++) if (names[i].trim().toLowerCase() === want) return names[i];
  return null;
}

// ---- arguments ----

// Checks raw against the tool's arguments (no others, the required ones
// there, each of its type) and gives them back as given.
function mcpArgs_(tool, raw) {
  var args = {};
  Object.keys(raw).forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(tool.args, k)) mcpBad_("unknown argument " + k + ".");
  });
  Object.keys(tool.args).forEach(function (k) {
    var spec = tool.args[k];
    var v = raw[k];
    if (v === undefined || v === null) {
      if (spec.required) mcpBad_(k + " is missing.");
      return;
    }
    var fine =
      spec.type === "string" ? typeof v === "string" :
      spec.type === "number" ? typeof v === "number" && isFinite(v) :
      spec.type === "integer" ? typeof v === "number" && isFinite(v) && v % 1 === 0 :
      spec.type === "boolean" ? typeof v === "boolean" :
      Array.isArray(v) && v.every(function (x) { return typeof x === "string"; });
    if (!fine) mcpBad_(k + " has to be " + { string: "text", number: "a number", integer: "a whole number", boolean: "true or false", array: "a list of names" }[spec.type] + ".");
    // What a reply hid can't come back as a value: sending it would store
    // "(hidden)" over the real text. Leaving the field out keeps it.
    var texts = typeof v === "string" ? [v] : Array.isArray(v) ? v : [];
    if (texts.some(function (x) { return x.indexOf(MCP_HIDDEN_) !== -1; })) mcpBad_(k + " holds " + MCP_HIDDEN_ + "; leave that field out to keep it.");
    args[k] = v;
  });
  return args;
}

// The stop fields given, in the API's names, with time and travel_min clean:
// a time is "HH:MM" or empty, minutes a whole number from 0.
function mcpStopFields_(args) {
  var out = {};
  if (args.time !== undefined) {
    var time = args.time.trim();
    if (time !== "" && !TIME_RE_.test(time)) mcpBad_("time has to look like 14:30, or be empty.");
    out.time = time;
  }
  if (args.travel_min !== undefined && args.travel_min < 0) mcpBad_("travel_min has to be 0 or more.");
  ["date", "title", "detail", "getting_there", "travel_min", "fixed", "place", "sign_jp", "booked", "link", "photo", "note", "name_jp", "address_jp"].forEach(function (k) {
    if (args[k] !== undefined) out[mcpCamel_(k)] = args[k];
  });
  return out;
}

function mcpCamel_(k) {
  return k.replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); });
}

// ---- talking to the actions ----

// One request through handleAs_, as the connector (never with a key), via "claude".
// Gives { ok: true, data } or { ok: false, message } (the backend's own
// sentence; a "server" error without the thrown error's text). Claude often
// calls tools side by side: a write that finds the lock held is tried again
// for up to about 20 seconds in all (each try is a request of its own, so
// the lock is never held across tools) before it answers busy.
function mcpAsk_(action, args, actor) {
  var start = clockMs_();
  var env;
  for (;;) {
    env = handleAs_({ kind: "claude", name: actor }, { action: action, args: args });
    if (env.ok || env.error !== "busy" || clockMs_() - start + MCP_LOCK_TRY_MS_ > MCP_BUSY_WAIT_MS_) break;
  }
  if (env.ok) return { ok: true, data: env.data };
  return { ok: false, message: env.error === "server" ? MSG_.server : env.message };
}

// A write: { <kind>: the saved item, log_id }.
function mcpWrite_(kind, action, args, who) {
  var r = mcpAsk_(action, args, who.actor);
  if (!r.ok) return r;
  var value = {};
  value[kind] = r.data[kind];
  value.log_id = r.data.logId;
  return { ok: true, value: value };
}

// ---- what a reply may never hold ----

// What a reply must not hold. anywhere: the trip key, the token, and each
// e-Transfer address that looks like an email or a phone number (hidden
// wherever it appears). whole: every stored e-Transfer address, hidden when a
// whole text is that address (an address like "Tokyo" must not hide the word
// in "Tokyo Tower").
// The secrets hidden wherever they appear, in a connector reply or in the
// owner's error log (reportError_ in Actions.js): the shared key while it
// exists, the token and the planner's id.
function secretsAnywhere_() {
  // The ticket desk's address and key too (auto-add), so neither can reach a reply or a log.
  return [tripKey_(), claudeToken_(), plannerId_(), getProp_("TICKET_DESK_KEY"), getProp_("TICKET_DESK_URL")].filter(function (s) { return typeof s === "string" && s !== ""; });
}

function mcpSecrets_(people) {
  var anywhere = secretsAnywhere_();
  var whole = [];
  people.forEach(function (p) {
    var a = String(p.etransfer || "").trim();
    if (!a) return;
    whole.push(a);
    if (a.indexOf("@") !== -1 || (/^[+()\d\s.\/-]+$/.test(a) && a.replace(/\D/g, "").length >= 7)) anywhere.push(a);
  });
  return { anywhere: anywhere.filter(function (s) { return typeof s === "string" && s.length >= 5; }), whole: whole };
}

// value with every secret and every email in its text hidden.
function mcpScrub_(value, secrets) {
  if (typeof value === "string") {
    if (secrets.whole.indexOf(value.trim()) !== -1) return MCP_HIDDEN_;
    var s = value;
    secrets.anywhere.forEach(function (x) { s = s.split(x).join(MCP_HIDDEN_); });
    return s.replace(MCP_EMAIL_RE_, MCP_HIDDEN_);
  }
  if (Array.isArray(value)) return value.map(function (v) { return mcpScrub_(v, secrets); });
  if (isObj_(value)) {
    var out = {};
    Object.keys(value).forEach(function (k) { out[k] = mcpScrub_(value[k], secrets); });
    return out;
  }
  return value;
}

// ---- reading the trip ----

function mcpDollars_(cents) {
  var v = Math.round(cents);
  var abs = Math.abs(v);
  var c = String(abs % 100);
  return (v < 0 ? "-" : "") + "$" + String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + (c.length < 2 ? "0" + c : c);
}

function mcpPositive_(n) {
  return typeof n === "number" && isFinite(n) && n > 0;
}

// The lines the money maths can use, as the app decides (js/store.js
// unreadable): live, every name one of the people, amounts it can read.
// The others are set aside, as on the phones.
function mcpMoneyLines_(d, names) {
  var isName = function (n) { return typeof n === "string" && names.indexOf(n) !== -1; };
  var expenses = d.expenses.filter(function (x) {
    if (x.deleted || !isName(x.paidBy) || !Array.isArray(x.split) || !x.split.length || !x.split.every(isName)) return false;
    if (!mcpPositive_(x.amount) || (x.currency !== "JPY" && x.currency !== "CAD")) return false;
    if (x.currency === "JPY" && !mcpPositive_(x.rate)) return false;
    if (x.splitMode === "parts" || x.splitMode === "exact") {
      if (!Array.isArray(x.splitVals) || x.splitVals.length !== x.split.length || !x.splitVals.every(mcpPositive_)) return false;
    }
    return true;
  });
  var payments = d.payments.filter(function (x) {
    return !x.removed && isName(x.from) && isName(x.to) && mcpPositive_(x.cad);
  });
  return { expenses: expenses, payments: payments };
}

function mcpOwed_(list) {
  return list.map(function (t) { return { from: t.from, to: t.to, amount: mcpDollars_(t.cents) }; });
}

function mcpLoad_(who) {
  var r = mcpAsk_("load", {}, who.actor);
  if (!r.ok) return r;
  var d = r.data;
  var names = d.people.map(function (p) { return p.name; });
  var lines = mcpMoneyLines_(d, names);
  return { ok: true, d: d, names: names, expenses: lines.expenses, payments: lines.payments };
}

// Whether each person has a picture in their seal, by name. The picture
// itself is never given out: it would flood the model's context (Task 16).
function mcpHasPicture_(people) {
  var out = {};
  people.forEach(function (p) { out[p.name] = !!p.photo; });
  return out;
}

function mcpGetTrip_(args, who) {
  var t = mcpLoad_(who);
  if (!t.ok) return t;
  var live = function (x) { return !x.deleted; };
  return {
    ok: true,
    value: {
      trip: t.d.trip,
      people: t.names,
      has_picture: mcpHasPicture_(t.d.people),
      days: t.d.days,
      stops: t.d.stops.filter(live),
      stays: t.d.stays.filter(live),
      expenses: t.expenses,
      payments: t.payments,
      owed: mcpOwed_(owedList(t.names, t.expenses, t.payments, true)),
      owed_direct: mcpOwed_(owedList(t.names, t.expenses, t.payments, false)),
      todos: mcpTodos_(t.d.todos || []),
    },
  };
}

// "Before we go" (Task 19): each item still open, and how many are done.
function mcpTodos_(todos) {
  var open = todos.filter(function (x) { return !x.done; }).map(function (x) {
    return { id: x.id, item: x.item, book_by: x.bookBy, claimed_by: x.claimedBy };
  });
  return { open: open, done: todos.length - open.length };
}

function mcpExplainDebt_(args, who) {
  var from = args.from, to = args.to;
  if (who.names.indexOf(from) === -1 || who.names.indexOf(to) === -1 || from === to) mcpBad_("from and to have to be two different people on the trip.");
  var t = mcpLoad_(who);
  if (!t.ok) return t;
  var side = function (name) {
    var w = working(name, t.expenses, t.payments);
    return { name: name, paid: mcpDollars_(w.paid), share: mcpDollars_(w.share), sent: mcpDollars_(w.sent), received: mcpDollars_(w.received) };
  };
  var pick = function (list) {
    for (var i = 0; i < list.length; i++) if (list[i].from === from && list[i].to === to) return list[i];
    return null;
  };
  var directList = owedList(t.names, t.expenses, t.payments, false);
  var simplified = pick(owedList(t.names, t.expenses, t.payments, true));
  var direct = pick(directList);
  var shared = [];
  t.expenses.forEach(function (e) {
    var s = expenseShares(e);
    if (!(from in s) || !(to in s)) return;
    shared.push({ title: e.title, day: e.day, paid_by: e.paidBy, total: mcpDollars_(cadCents(e)), from_share: mcpDollars_(s[from]), to_share: mcpDollars_(s[to]) });
  });
  return {
    ok: true,
    value: {
      from: side(from),
      to: side(to),
      simplified: simplified ? { amount: mcpDollars_(simplified.cents) } : null,
      direct: direct ? { amount: mcpDollars_(direct.cents) } : null,
      routed_via: simplified ? routedVia(simplified, directList, t.names) : null,
      shared: shared,
    },
  };
}

function mcpGetHistory_(args, who) {
  var limit = args.limit === undefined ? 30 : Math.max(1, Math.min(200, args.limit));
  var r = mcpAsk_("history", { limit: limit }, who.actor);
  if (!r.ok) return r;
  return {
    ok: true,
    value: {
      entries: r.data.entries.map(function (e) {
        // The sentence the app's History shows (js/format.js historySentence).
        // An e-Transfer change is kept, as its sentence only: the address is
        // never in a sentence (summarize in Pure.js).
        var by = e.via === "claude" ? " (through Claude)" : e.via === "planner" ? " (from the planner)" : "";
        return { id: e.id, when: e.at, who: e.who, sentence: e.who + " " + e.summary + by, can_undo: e.canUndo };
      }),
    },
  };
}

// ---- writing ----

// The expense's day when none is given, as the app's register picks it:
// "pre" before the trip, today during it, the last day after it.
function mcpDefaultDay_() {
  var trip = tripInfo_();
  var today = today_();
  if (!trip.start || !trip.end || today < trip.start) return "pre";
  return today > trip.end ? trip.end : today;
}

function mcpAddExpense_(args, who) {
  // The app's own register only offers these; the backend takes any real date.
  if (args.day !== undefined && args.day !== "pre" && moneyDates_().indexOf(args.day) === -1) {
    mcpBad_("day has to be pre or one of the trip’s days, as YYYY-MM-DD.");
  }
  var expense = {
    id: newId_(),
    day: args.day === undefined ? mcpDefaultDay_() : args.day,
    title: args.title,
    amount: args.amount,
    currency: args.currency,
    paidBy: args.paid_by,
    split: args.split === undefined ? who.names.slice() : args.split,
    splitMode: "equal",
    note: args.note,
    kind: args.kind,
  };
  return mcpWrite_("expense", "addExpense", { expense: expense }, who);
}

function mcpAddStop_(args, who) {
  var stop = mcpStopFields_(args);
  stop.id = newId_();
  return mcpWrite_("stop", "addStop", { stop: stop }, who);
}

function mcpChangeStop_(args, who) {
  return mcpWrite_("stop", "updateStop", { id: args.id, patch: mcpStopFields_(args) }, who);
}

// With an id, only the fields given, sent with merge: true so saveStay lays
// them over the stay as it is under the lock (a field left out keeps its
// value; "" clears it; an unknown or removed stay is refused). Without one,
// a new stay.
function mcpSaveStay_(args, who) {
  var stay = { id: args.id === undefined ? newId_() : args.id };
  if (args.id === undefined) {
    ["name", "first_night", "last_night"].forEach(function (k) { if (args[k] === undefined) mcpBad_(k + " is missing."); });
  }
  ["name", "first_night", "last_night", "name_jp", "address_jp", "note", "place", "link", "photo", "tk_ref", "tk_name", "tk_people", "tk_room"].forEach(function (k) {
    if (args[k] !== undefined) stay[mcpCamel_(k)] = args[k];
  });
  var request = { stay: stay };
  if (args.id !== undefined) request.merge = true;
  return mcpWrite_("stay", "saveStay", request, who);
}

function mcpSetDay_(args, who) {
  var patch = {};
  Object.keys(args).forEach(function (k) { if (k !== "date") patch[mcpCamel_(k)] = args[k]; });
  return mcpWrite_("day", "setDay", { date: args.date, patch: patch }, who);
}

// A pull from the planner sheet: its counts, the problems it met, whether
// more remain to bring in (more) and whether it read only the first 300 (capped).
function mcpSyncPayments_(args, who) {
  var r = mcpAsk_("syncPayments", {}, who.actor);
  if (!r.ok) return r;
  var d = r.data;
  return { ok: true, value: { added: d.added, changed: d.changed, same: d.same, removed: d.removed, not_counted: d.notCounted, problems: d.problems, more: d.more, capped: d.capped } };
}

function mcpUndo_(args, who) {
  var r = mcpAsk_("undo", { logId: args.log_id }, who.actor);
  if (!r.ok) return r;
  var kind = r.data.entry.kind;
  var value = {};
  // A picture's undo answers with the person: only whether they now have one.
  if (kind === "picture") value.person = { name: r.data.person.name, has_picture: !!r.data.person.photo };
  else value[kind] = r.data[kind];
  // A "Before we go" undo through Claude never touches the planner (R49):
  // "pending" when it took off a tick the planner had taken (the put-back is
  // left to the next pull), "kept" otherwise.
  if (kind === "todo") value.planner = r.data.planner;
  value.log_id = r.data.logId;
  return { ok: true, value: value };
}

// ---- the tools ----

function mcpSchema_(tool) {
  var props = {};
  var required = [];
  Object.keys(tool.args).forEach(function (k) {
    var a = tool.args[k];
    var p = { type: a.type, description: a.description };
    if (a.type === "array") p.items = { type: "string" };
    if (a.enum) p["enum"] = a.enum;
    if (a.minimum !== undefined) p.minimum = a.minimum;
    if (a.maximum !== undefined) p.maximum = a.maximum;
    props[k] = p;
    if (a.required) required.push(k);
  });
  var schema = { type: "object", properties: props, additionalProperties: false };
  if (required.length) schema.required = required;
  return schema;
}

function mcpTools_() {
  var arg = function (type, description, required, values) {
    return { type: type, description: description, required: !!required, "enum": values };
  };
  var stopArgs = function (needed) {
    return {
      date: arg("string", "The day, YYYY-MM-DD, one of the trip’s days.", needed),
      title: arg("string", "What it is, under 80 letters.", needed),
      time: arg("string", "When, 24-hour HH:MM like 14:30; empty for no time."),
      detail: arg("string", "A short line under the name, under 120 letters."),
      getting_there: arg("string", "How to get there, under 300 letters."),
      travel_min: { type: "integer", description: "Minutes it takes to get there, 0 to 600.", required: false, minimum: 0, maximum: 600 },
      fixed: arg("boolean", "True when the time can’t move (a booking)."),
      place: arg("string", "A place name or a Google Maps link."),
      sign_jp: arg("string", "The place name in Japanese, as on the signs."),
      booked: arg("boolean", "True when it is booked."),
      link: arg("string", "A https:// link, such as the booking."),
      photo: arg("string", "A https:// link to a photo."),
      note: arg("string", "A note, under 300 letters."),
      name_jp: arg("string", "The place’s full name in Japanese, to show a taxi driver."),
      address_jp: arg("string", "The address in Japanese, to show a taxi driver."),
    };
  };
  var changeArgs = stopArgs(false);
  changeArgs.id = arg("string", "The stop’s id, from get_trip.", true);
  return [
    {
      name: "get_trip",
      description: "Use this first to see the whole trip: its days, stops (each with its ticket details as text in tkRef, tkName, tkPeople and tkSeat, but never the ticket pictures, which only the app can add, read or remove), stays (each with its booking details as text in tkRef, tkName, tkPeople and tkRoom, but never its booking pictures, which only the app can add, read or remove), expenses and payments, who owes whom now, and the bookings still to make before the trip. Amounts owed are in Canadian dollars.",
      args: {},
      run: mcpGetTrip_,
    },
    {
      name: "explain_debt",
      description: "Use this when someone asks why one person owes another: it gives each one’s paid, share, sent and received, both readings of the debt and the expenses they share.",
      args: { from: arg("string", "The name of the one who owes.", true), to: arg("string", "The name of the one who is owed.", true) },
      run: mcpExplainDebt_,
    },
    {
      name: "add_expense",
      write: true,
      description: "Use this to ring up something someone paid for, shared equally by everyone unless split names fewer people. " + MCP_UNDOABLE_,
      args: {
        title: arg("string", "What it was for, under 80 letters.", true),
        amount: arg("number", "The amount, in the currency given.", true),
        currency: arg("string", "JPY for yen or CAD for Canadian dollars.", true, ["JPY", "CAD"]),
        paid_by: arg("string", "The name of the one who paid.", true),
        day: arg("string", "The day, YYYY-MM-DD, or pre for before the trip. Left out, it is today’s date in Japan."),
        split: arg("array", "The names of those who share it; by default everyone."),
        note: arg("string", "A note, under 200 letters."),
        kind: arg("string", "food, transport, stay, activity or shopping.", false, ["food", "transport", "stay", "activity", "shopping"]),
      },
      run: mcpAddExpense_,
    },
    { name: "add_stop", write: true, description: "Use this to add a stop to one day of the plan. " + MCP_UNDOABLE_, args: stopArgs(true), run: mcpAddStop_ },
    { name: "change_stop", write: true, description: "Use this to change some fields of a stop already in the plan; the others stay as they are. " + MCP_UNDOABLE_, args: changeArgs, run: mcpChangeStop_ },
    { name: "remove_stop", write: true, description: "Use this to take a stop out of the plan. " + MCP_UNDOABLE_, args: { id: arg("string", "The stop’s id, from get_trip.", true) }, run: function (a, w) { return mcpWrite_("stop", "deleteStop", { id: a.id }, w); } },
    {
      name: "save_stay",
      description: "Use this to add a place to stay, which needs name, first_night and last_night, or with an id to change only the fields given on one already there. " + MCP_UNDOABLE_,
      write: true,
      args: {
        name: arg("string", "The name of the hotel or place, under 80 letters. Needed without an id."),
        first_night: arg("string", "The first night, YYYY-MM-DD. Needed without an id."),
        last_night: arg("string", "The last night, YYYY-MM-DD. Needed without an id."),
        id: arg("string", "The stay’s id, from get_trip, to change that stay; fields left out keep their values."),
        name_jp: arg("string", "The name in Japanese."),
        address_jp: arg("string", "The address in Japanese, to show a taxi driver."),
        note: arg("string", "A note, under 300 letters."),
        place: arg("string", "A place name or a Google Maps link."),
        link: arg("string", "A https:// link, such as the booking."),
        photo: arg("string", "A https:// link to a photo."),
        tk_ref: arg("string", "The booking reference (tkRef), under 60 letters."),
        tk_name: arg("string", "The name the booking is under (tkName), under 60 letters."),
        tk_people: arg("string", "How many people are in the room (tkPeople), under 60 letters."),
        tk_room: arg("string", "The room, such as Tatami room for 3 (tkRoom), under 60 letters."),
      },
      run: mcpSaveStay_,
    },
    { name: "remove_stay", write: true, description: "Use this to take a stay out of the plan. " + MCP_UNDOABLE_, args: { id: arg("string", "The stay’s id, from get_trip.", true) }, run: function (a, w) { return mcpWrite_("stay", "deleteStay", { id: a.id }, w); } },
    {
      name: "set_day",
      write: true,
      description: "Use this to change a day’s ticket: its city, title, train line and the stations it runs from and to. " + MCP_UNDOABLE_,
      args: {
        date: arg("string", "The day, YYYY-MM-DD, one of the trip’s days.", true),
        city: arg("string", "The city."),
        title: arg("string", "The day’s title, under 80 letters."),
        line_jp: arg("string", "The train line in Japanese."),
        line_en: arg("string", "The train line in English."),
        line_colour: arg("string", "The line’s colour, like #2FB6E8."),
        from_jp: arg("string", "The station it starts from, in Japanese."),
        from_en: arg("string", "The station it starts from, in English."),
        to_jp: arg("string", "The station it ends at, in Japanese."),
        to_en: arg("string", "The station it ends at, in English."),
      },
      run: mcpSetDay_,
    },
    {
      name: "get_history",
      description: "Use this to see the latest changes, newest first, with the id undo needs. Each says who made it and whether it can still be undone.",
      args: { limit: arg("integer", "How many, from 1 to 200; 30 by default.") },
      run: mcpGetHistory_,
    },
    {
      name: "undo",
      write: true,
      description: "Use this to undo one change from get_history, as the app’s Undo does; only the newest change to an item can be undone. The undo shows in the app’s History too.",
      args: { log_id: arg("integer", "The change’s id, from get_history or a write’s log_id.", true) },
      run: mcpUndo_,
    },
    {
      name: "sync_payments",
      write: true,
      description: "Use this to bring in what’s been paid from the planner sheet’s Payments tab: new payments are added and changed ones updated. " + MCP_UNDOABLE_,
      args: {},
      run: mcpSyncPayments_,
    },
  ];
}
