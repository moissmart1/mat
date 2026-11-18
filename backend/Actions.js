// Every request is handled here: handle_(body) -> response envelope.
// This file reaches the outside world only through these primitives, defined
// elsewhere (Sheets.js, Env.js, Rate.js on Apps Script; in memory in
// tests/fake-backend.cjs):
//   readTable_, appendObj_, updateById_, updateWhere_, ensureColumns_, hasColumn_,
//   getProp_, setProp_, delProp_, withLock_, getRate_, getRateInfo_, tripKey_, nowIso_, sheetUrl_,
//   claudeToken_, ensureClaudeToken_, newId_, plannerId_, plannerRows_, holderOf_ (Keys.js),
//   hasTab_, plannerTab_, plannerSetCell_, plannerAppendRow_, torontoNow_, withPlannerLock_,
//   appendObjs_, columnValues_, cellsAt_, deleteRowsAt_ (ticket pictures)
// It also uses the pure helpers from Pure.js.

var MSG_ = {
  badRequest: "That request didn’t come through properly.",
  badKey: "This link’s trip key doesn’t match. Ask for a fresh invite link.",
  badAction: "The app asked for something the trip sheet doesn’t know how to do.",
  badActor: "Pick who you are first.",
  badId: "That didn’t say which line it meant.",
  badPatch: "That change didn’t come through properly.",
  patchKey: "Only a line’s details can be changed.",
  editDeleted: "Bring it back first.",
  noExpense: "That line isn’t there any more.",
  noPayment: "That payment isn’t there any more.",
  noPerson: "That person isn’t on this trip.",
  noStop: "That stop isn’t there any more.",
  noStay: "That stay isn’t there any more.",
  noDay: "That day isn’t on this trip.",
  stopPatchKey: "Only a stop’s details can be changed.",
  badLogId: "That didn’t say which change to undo.",
  noLog: "That change isn’t in the history.",
  undone: "That’s already been undone.",
  newer: "That was changed again since. Undo the newer change first.",
  cantUndo: "That change can’t be undone.",
  badHistory: "That history request didn’t come through properly.",
  server: "Something went wrong on our side. Try again.",
  noClaude: "The Claude link isn’t set up yet. Ask Mo to run migrate.",
  noPlanner: "No planner sheet is linked yet. Ask Mo to link it.",
  plannerUnreadable: "Couldn’t read the planner sheet. Ask Mo to check its permission.",
  needsMigrate: "The trip sheet needs updating first. Ask Mo to run migrate.",
  notInPlanner: "That payment isn’t in the planner any more.",
  twoLines: "Two lines carry this payment’s id.",
  notYourPicture: "You can only change your own picture.",
  noTodo: "That one isn’t on the list any more.",
  todoDone: "That one is already done.",
  tickTakenOff: "That number is another item in the planner now: its tick was taken off.",
  claimTakenOff: "That number is another item in the planner now: nobody is on it any more.",
  bothTakenOff: "That number is another item in the planner now: its tick was taken off and nobody is on it any more.",
  claudeTick: "Tick this one in the app.",
  claudeRetick: "Undo this one in the app.",
  claudeStamp: "Press this one in the app.",
  noStamp: "That stamp isn’t in the book.",
  stampNotOpen: "That stamp isn’t open yet.",
  stampClosed: "That stamp’s day has closed.",
  stampLate: "That press took too long to arrive.",
  stampFuture: "This phone’s clock is ahead of the trip’s. Check its date and time.",
  stampLifted: "That stamp was lifted in History.",
  notYourStamp: "You can only change your own stamp.",
  noTicket: "That ticket picture isn’t there any more.",
  ticketsPerStop: "A stop can hold at most 8 ticket pictures.",
  ticketsPerTrip: "The trip can hold at most 120 ticket pictures.",
  claudeTicket: "Ticket pictures are added and removed in the app.",
  ticketNeverSent: "That ticket picture never reached the trip sheet. Add it again.",
  // Security (2026-11-18).
  checkOnly: "This key can only read the trip.",
  claudeOwnerOnly: "Only {owner} can copy the Claude link.",
  notYours: "You can only change your own settings.",
  ownLink: "Open your own link to change an e-Transfer address.",
  notYourClaim: "Someone else is on this one. Ask them to hand it back first.",
};
var STAMP_REFUSALS_ = { not_open: "stampNotOpen", closed: "stampClosed", late: "stampLate", future: "stampFuture" };

// The most expenses one pull adds or changes (R40), so it never holds the lock long.
var PLANNER_MAX_WRITES_ = 10;
// "Before we go" (Task 19, R45, R49): a pull reads the planner at most once
// in 10 minutes unless forced, and never twice in 30 seconds; writes at most
// this many Todos rows; retries at most this many ticks the planner has not
// taken yet.
var TODO_PULL_GAP_MS_ = 10 * 60 * 1000;
var TODO_MAX_WRITES_ = 15;
var TODO_MAX_RETRIES_ = 2;
var TODO_FORCE_GAP_MS_ = 30 * 1000;

// The trip plan: stops, stays and day headers differ only in these. `key` is
// the column a row is found by (and the Log's ref); `fields` are the API
// fields a person can change; `deletable` ones have a deleted_at column.
// Built on call, not at load: Apps Script runs Actions.js before Pure.js.
// Any other kind gives null.
function planKind_(kind) {
  if (kind === "stop") {
    return {
      tab: "Stops", key: "id", deletable: true, fromRow: stopFromRow, toRow: stopToRow, missing: MSG_.noStop,
      fields: ["date", "time", "title", "detail", "gettingThere", "travelMin", "fixed", "place", "signJp", "booked", "link", "photo", "note", "lat", "lng", "tkRef", "tkName", "tkPeople", "tkSeat"],
    };
  }
  if (kind === "stay") {
    return {
      tab: "Stays", key: "id", deletable: true, fromRow: stayFromRow, toRow: stayToRow, missing: MSG_.noStay,
      fields: ["name", "nameJp", "addressJp", "firstNight", "lastNight", "note", "place", "link", "photo", "lat", "lng"],
    };
  }
  if (kind === "day") return { tab: "Days", key: "date", deletable: false, fromRow: dayFromRow, toRow: dayToRow, missing: MSG_.noDay, fields: DAY_PATCH_KEYS.concat(["lat", "lng"]) };
  return null;
}

var EXPENSE_PATCH_KEYS_ = ["title", "amount", "currency", "paidBy", "split", "splitMode", "splitVals", "day", "note", "kind"];

// Security (2026-11-18): who is calling is decided first, from the key alone
// (holderOf_, Keys.js), before anything else is read or done. A person's key
// makes the request theirs; the release check's key may only read; the old
// shared key works as before (with the e-Transfer rule in setPerson_) until
// it is retired. A request that is not one of these is bad_key, as before.
function handle_(body) {
  if (!isObj_(body)) return err_("bad_input", MSG_.badRequest);
  var holder;
  try {
    holder = holderOf_(body.key);
  } catch (e) {
    // PERSON_KEYS broken by hand (fix round 1): nobody in, and not bad_key,
    // which would make every phone clear itself.
    reportError_("holderOf_", e, [body.key]);
    return err_("server", MSG_.server);
  }
  if (!holder) return err_("bad_key", MSG_.badKey);
  return handleAs_(holder, body);
}

// The rest of a request once its holder is known: { kind: "person", name },
// { kind: "check" }, { kind: "shared" }, or { kind: "claude", name } (the
// Claude connector, Mcp.js, after its own token check: never reachable from
// outside, and it does not need the shared key to exist).
// A thrown error answers the plain server sentence only; its detail goes to
// the owner's log with anything secret blanked (reportError_).
function handleAs_(holder, body) {
  var env;
  try {
    // A person's key whose name is no longer on the trip opens nothing.
    if (holder.kind === "person" && peopleNames_().indexOf(holder.name) === -1) env = err_("bad_key", MSG_.badKey);
    else env = dispatch_(body, holder);
  } catch (e) {
    reportError_("handle_", e, [body && body.key]);
    env = err_("server", MSG_.server);
  }
  if (typeof env.rev !== "number") env.rev = rev_();
  return env;
}

// The detail of an error, for the owner only (the script's executions log),
// with every key, token and id blanked: the "anywhere" list the connector
// keeps out of its replies (mcpSecrets_ in Mcp.js) plus `extra` (the key
// that came with the request). Never in a reply.
function reportError_(where, e, extra) {
  try {
    var secrets = secretsAnywhere_().concat((extra || []).filter(function (x) { return typeof x === "string"; }));
    var text = blankSecrets(String((e && e.stack) || (e && e.message) || e), secrets);
    if (typeof console !== "undefined" && console.error) console.error(where + ": " + text);
  } catch (e2) {
    // the log is best effort: the reply is the same either way
  }
}

// What the check key and the connector may ask for; a person's key and the
// shared key may ask for anything. The check key reads only what a phone's
// start needs, and runs migrate.
var CHECK_ACTIONS_ = ["load", "rev", "history", "migrate"];
// The connector reads and writes through its tools only.
var CLAUDE_ACTIONS_ = ["load", "history", "syncPayments", "addExpense", "addStop", "updateStop", "deleteStop", "saveStay", "deleteStay", "setDay", "undo",
  // Listed only so they answer their own "do this one in the app" sentence.
  "pressStamp", "tickTodo"];

function dispatch_(body, holder) {
  var args = body.args === undefined || body.args === null ? {} : body.args;
  if (!isObj_(args)) return err_("bad_input", MSG_.badRequest);
  var action = body.action;
  if (holder.kind === "check" && CHECK_ACTIONS_.indexOf(action) === -1) return err_("bad_input", MSG_.checkOnly);
  if (holder.kind === "claude" && CLAUDE_ACTIONS_.indexOf(action) === -1) return err_("bad_input", MSG_.badAction);
  if (action === "load") return load_(holder);
  if (action === "rev") return ok_({}, rev_());
  if (action === "history") return history_(args);
  // One ticket picture's data, for a phone to keep: a read, no lock, no Log.
  // (The check key and the connector never get here: neither may ask for it.)
  if (action === "ticket") return ticket_(args);
  if (action === "migrate") {
    return withLock_(function () {
      var added = ensureColumns_();
      ensureClaudeToken_();
      return ok_({ added: added }, rev_());
    });
  }
  // Where things are: run from a terminal like migrate.
  if (action === "locate") return withLock_(locate_);
  // The Claude connector's token, for Settings to copy into a link. Never
  // logged. Only for the trip's first person (the owner), on their own key.
  if (action === "claudeLink") {
    var owner = peopleNames_()[0];
    if (holder.kind !== "person" || holder.name !== owner) return err_("bad_input", MSG_.claudeOwnerOnly.replace("{owner}", owner || "the trip’s organiser"));
    var token = claudeToken_();
    return token ? ok_({ token: token }, rev_()) : err_("not_found", MSG_.noClaude);
  }
  // (linkPlanner is gone: the owner sets PLANNER_ID in Script Properties.)

  var write;
  switch (action) {
    case "addExpense": write = addExpense_; break;
    case "updateExpense": write = updateExpense_; break;
    case "deleteExpense": write = function (a, c) { return setExpenseDeleted_(a, c, true); }; break;
    case "restoreExpense": write = function (a, c) { return setExpenseDeleted_(a, c, false); }; break;
    case "addPayment": write = addPayment_; break;
    case "removePayment": write = function (a, c) { return setPaymentRemoved_(a, c, true); }; break;
    case "restorePayment": write = function (a, c) { return setPaymentRemoved_(a, c, false); }; break;
    case "setPerson": write = setPerson_; break;
    case "addStop": write = addStop_; break;
    case "updateStop": write = updateStop_; break;
    case "deleteStop": write = function (a, c) { return setPlanDeleted_("stop", a, c, true); }; break;
    case "restoreStop": write = function (a, c) { return setPlanDeleted_("stop", a, c, false); }; break;
    case "saveStay": write = saveStay_; break;
    case "deleteStay": write = function (a, c) { return setPlanDeleted_("stay", a, c, true); }; break;
    case "restoreStay": write = function (a, c) { return setPlanDeleted_("stay", a, c, false); }; break;
    case "setDay": write = setDay_; break;
    case "undo": write = undo_; break;
    case "tickTodo": write = tickTodo_; break;
    case "claimTodo": write = claimTodo_; break;
    case "pressStamp": write = pressStamp_; break;
    case "addTicket": write = addTicket_; break;
    case "removeTicket": write = removeTicket_; break;
    case "syncPayments": write = null; break;
    case "syncTodos": write = null; break;
    default: return err_("bad_input", MSG_.badAction);
  }
  var names = peopleNames_();
  // Who the write is made as: a person's key is that person whatever the
  // phone says (an old phone's queued write still carries an actor: it is
  // written as the key's person); the connector is the name Mcp.js gives;
  // only the shared key still takes the phone's word, as before.
  var actor = holder.kind === "person" || holder.kind === "claude" ? holder.name : body.actor;
  if (typeof actor !== "string" || names.indexOf(actor) === -1) return err_("bad_input", MSG_.badActor);
  // Only the connector's own path is "through Claude" (fix round 1).
  var via = holder.kind === "claude" ? "claude" : "app";
  var ctx = { actor: actor, via: via, names: names, holder: holder.kind };
  // Reads the planner first, then takes the lock itself.
  if (action === "syncPayments") return syncPayments_(args, ctx);
  if (action === "syncTodos") return syncTodos_(args, ctx);
  // Fetching the day's rate can take a few seconds; do it before taking the lock.
  if (action === "addExpense") ctx.rate = getRate_();
  // A write's planner part (then_) runs after the app's lock is let go (R49).
  return thenOutsideLock_(withLock_(function () { return write(args, ctx); }));
}

// ---- envelopes, rev, log ----

function ok_(data, rev) { return { ok: true, rev: rev, data: data }; }

function err_(code, message) { return { ok: false, error: code, message: message }; }

// REV from Script Properties. If the property is missing (properties were
// reset), start from the Log's highest id so rev never goes backwards.
function rev_() {
  var raw = getProp_("REV");
  var n = Number(raw);
  if (raw !== null && raw !== "" && isFinite(n) && n >= 0) return Math.floor(n);
  return maxLogId_();
}

function maxLogId_() {
  var max = 0;
  logRows_().forEach(function (r) {
    var id = Number(r.id);
    if (isFinite(id) && id > max) max = id;
  });
  return max;
}

function bumpRev_() {
  var n = rev_() + 1;
  setProp_("REV", String(n));
  return n;
}

// Appends one Log row and returns it as written. Called inside the write lock.
// The id is one above both LOGSEQ and the Log's highest id, so ids stay unique
// even if Script Properties were reset.
function appendLog_(ctx, action, kind, ref, summary, before, after, undoes) {
  var seq = Number(getProp_("LOGSEQ"));
  var id = Math.max(isFinite(seq) ? Math.floor(seq) : 0, maxLogId_()) + 1;
  setProp_("LOGSEQ", String(id));
  var row = {
    id: id, at: nowIso_(), who: ctx.actor, via: ctx.via, action: action, kind: kind, ref: ref, summary: summary,
    before: before ? JSON.stringify(before) : "", after: after ? JSON.stringify(after) : "",
    undoes: undoes === null || undoes === undefined ? "" : undoes, undone_by: "",
  };
  appendObj_("Log", row);
  return row;
}

function logRows_() {
  return readTable_("Log").filter(function (r) { return cellText_(r.id) !== ""; });
}

// The id of the Log row that first added this item (for a repeated add).
function firstLogId_(kind, ref, action) {
  var best = null;
  logRows_().forEach(function (r) {
    var id = Number(r.id);
    if (cellText_(r.kind) === kind && cellText_(r.ref) === ref && cellText_(r.action) === action && (best === null || id < best)) best = id;
  });
  return best;
}

// ---- table helpers ----

function peopleRows_() {
  return readTable_("People")
    .filter(function (r) { return cellText_(r.name) !== ""; })
    .sort(function (a, b) { return Number(a.order) - Number(b.order); });
}

function peopleNames_() {
  return peopleRows_().map(function (r) { return cellText_(r.name); });
}

function findRow_(tab, id) {
  var rows = readTable_(tab);
  for (var i = 0; i < rows.length; i++) if (cellText_(rows[i].id) === id) return rows[i];
  return null;
}

function idArg_(args) {
  return typeof args.id === "string" && args.id !== "" ? args.id : null;
}

// The fields of an expense a person can change, as a fresh object.
function editableOf_(e) {
  return {
    day: e.day, title: e.title, amount: e.amount, currency: e.currency, paidBy: e.paidBy,
    split: Array.isArray(e.split) ? e.split.slice() : undefined,
    splitMode: e.splitMode,
    splitVals: Array.isArray(e.splitVals) ? e.splitVals.slice() : undefined,
    note: e.note, kind: e.kind,
  };
}

function paymentEditableOf_(p) {
  return { from: p.from, to: p.to, cad: p.cad, seed: p.seed, rot: p.rot };
}

// ---- reads ----

// The Trip tab as { key: value }.
function tripInfo_() {
  var trip = {};
  readTable_("Trip").forEach(function (r) {
    var k = cellText_(r.key).trim();
    if (k) trip[k] = cellDate_(r.value);
  });
  return trip;
}

// holder: who asked (handle_). me is the key's person ("" for the shared or
// check key) and personal whether it is a person's own key, so a phone on
// its own link is that person and offers no choice. Under the check key
// the e-Transfer addresses are left out: it only checks a release.
function load_(holder) {
  var rev = rev_();
  var rate = getRateInfo_();
  var book = stampBook_();
  var data = {
    trip: tripInfo_(),
    people: peopleRows_().map(personFromRow).map(function (p) {
      if (holder && holder.kind === "check") p.etransfer = "";
      return p;
    }),
    me: holder && holder.kind === "person" ? holder.name : "",
    personal: !!holder && holder.kind === "person",
    days: readTable_("Days").filter(function (r) { return cellDate_(r.date) !== ""; }).map(dayFromRow),
    stops: readTable_("Stops").filter(function (r) { return cellText_(r.id) !== ""; }).map(stopFromRow).map(function (st) {
      // The release check's key reads no booking reference and no name on a booking (as no address).
      if (holder && holder.kind === "check") {
        st.tkRef = "";
        st.tkName = "";
      }
      return st;
    }),
    stays: readTable_("Stays").filter(function (r) { return cellText_(r.id) !== ""; }).map(stayFromRow),
    expenses: readTable_("Expenses").filter(function (r) { return cellText_(r.id) !== ""; }).map(expenseFromRow),
    payments: readTable_("Settlements").filter(function (r) { return cellText_(r.id) !== ""; }).map(paymentFromRow),
    rateToday: rate.rate,
    rateSource: rate.source,
    sheetUrl: sheetUrl_(),
    plannerLinked: plannerId_() !== null,
    todos: todosShown_(),
    todosPulledAt: getProp_("TODOS_PULLED_AT") || "",
    paymentsPulledAt: getProp_("PAYMENTS_PULLED_AT") || "",
    stampDefs: book.defs,
    stamps: book.stamps,
    paymentProblems: plannerProblemsStored_("PAYMENT_PROBLEMS"),
    todoProblems: plannerProblemsStored_("TODO_PROBLEMS"),
  };
  // The ticket pictures (never their data), once migrate has made the tabs;
  // until then the key is left out and the phones show no tickets.
  // Not those on a removed stop (minor 6): putting the stop back brings them back.
  var removed = {};
  data.stops.forEach(function (st) { if (st.deleted) removed[st.id] = true; });
  var tickets = ticketsShown_(removed);
  if (tickets !== null) data.tickets = tickets;
  return ok_(data, rev);
}

// The last planner pull's problems as stored in a Script Property
// (PAYMENT_PROBLEMS for payments, TODO_PROBLEMS for Book Now), or the empty
// shape when there are none yet or the property is not what we wrote.
function plannerProblemsStored_(key) {
  var none = { at: "", list: [], more: 0 };
  var v;
  try {
    v = JSON.parse(getProp_(key) || "");
  } catch (e) {
    return none;
  }
  if (!v || typeof v !== "object" || typeof v.at !== "string" || !Array.isArray(v.list) || typeof v.more !== "number") return none;
  var list = [];
  for (var i = 0; i < v.list.length; i++) {
    var p = v.list[i];
    if (!p || typeof p !== "object" || typeof p.id !== "string" || typeof p.message !== "string" || typeof p.what !== "string") return none;
    if (p.row !== null && typeof p.row !== "number") return none;
    list.push({ id: p.id, message: p.message, row: p.row, what: p.what });
  }
  return { at: v.at, list: list, more: v.more };
}

function history_(args) {
  var ref = args.ref;
  if (ref !== undefined && ref !== null && typeof ref !== "string") return err_("bad_input", MSG_.badHistory);
  var before = args.before === undefined || args.before === null ? null : Number(args.before);
  if (before !== null && !isFinite(before)) return err_("bad_input", MSG_.badHistory);
  var limit = Number(args.limit);
  if (args.limit === undefined || args.limit === null || args.limit === "" || !isFinite(limit)) limit = 200;
  limit = Math.max(1, Math.min(500, Math.floor(limit)));

  var rev = rev_();
  var all = logRows_().map(logShape_);
  var picked = all
    .filter(function (e) { return (ref === undefined || ref === null || e.ref === ref) && (before === null || e.id < before); })
    .sort(function (a, b) { return b.id - a.id; });
  var entries = picked.slice(0, limit).map(function (e) {
    e.canUndo = canUndo(e, all);
    return e;
  });
  return ok_({ entries: entries, more: picked.length > limit }, rev);
}

// ---- expenses ----

function addExpense_(args, ctx) {
  var v = validateExpense(args.expense, ctx.names);
  if (!v.ok) return err_("bad_input", v.message);
  var id = v.value.id;
  var existing = findRow_("Expenses", id);
  if (existing) return ok_({ expense: expenseFromRow(existing), logId: firstLogId_("expense", id, "add") }, rev_());

  var e = v.value;
  e.rate = ctx.rate;
  e.addedBy = ctx.actor;
  var row = expenseToRow(e);
  row.added_at = nowIso_();
  // A line a planner pull adds is tied to its payment (R40). Only the pull's
  // own ctx carries it; nothing a phone sends can.
  if (ctx.plannerId) row.planner_id = ctx.plannerId;
  appendObj_("Expenses", row);
  var saved = expenseFromRow(findRow_("Expenses", id));
  var log = appendLog_(ctx, "add", "expense", id, summarize("add", "expense", null, saved), null, saved);
  return ok_({ expense: saved, logId: log.id }, bumpRev_());
}

function updateExpense_(args, ctx) {
  var id = idArg_(args);
  if (!id) return err_("bad_input", MSG_.badId);
  var patch = args.patch;
  if (!isObj_(patch)) return err_("bad_input", MSG_.badPatch);
  var keys = Object.keys(patch);
  for (var i = 0; i < keys.length; i++) {
    if (EXPENSE_PATCH_KEYS_.indexOf(keys[i]) === -1) return err_("bad_input", MSG_.patchKey);
  }
  return editExpense_(id, patch, ctx, false);
}

// The edit itself, for updateExpense and the planner pull. The app's own
// edits write every editable column; onlyChanged (the pull) writes only the
// columns that change, so a hand-typed cell the change leaves alone stays.
function editExpense_(id, patch, ctx, onlyChanged) {
  var row = findRow_("Expenses", id);
  if (!row) return err_("not_found", MSG_.noExpense);
  var cur = expenseFromRow(row);
  if (cur.deleted) return err_("bad_input", MSG_.editDeleted);

  // Validate the whole line as it would be, not the patch alone.
  var merged = editableOf_(cur);
  Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
  merged.id = id;
  var v = validateExpense(merged, ctx.names);
  if (!v.ok) return err_("bad_input", v.message);

  var cols = expenseToRow(editableOf_(v.value));
  var was = expenseToRow(editableOf_(cur));
  if (same_(cols, was)) return ok_({ expense: cur, logId: null }, rev_());
  if (onlyChanged) Object.keys(was).forEach(function (k) { if (same_(cols[k], was[k])) delete cols[k]; });
  var saved = expenseFromRow(updateById_("Expenses", id, cols));
  var log = appendLog_(ctx, "edit", "expense", id, summarize("edit", "expense", cur, saved), cur, saved);
  return ok_({ expense: saved, logId: log.id }, bumpRev_());
}

function setExpenseDeleted_(args, ctx, deleted) {
  var id = idArg_(args);
  if (!id) return err_("bad_input", MSG_.badId);
  var row = findRow_("Expenses", id);
  if (!row) return err_("not_found", MSG_.noExpense);
  var cur = expenseFromRow(row);
  if (cur.deleted === deleted) return ok_({ expense: cur, logId: null }, rev_());
  var saved = expenseFromRow(updateById_("Expenses", id, { deleted_at: deleted ? nowIso_() : "" }));
  var action = deleted ? "delete" : "restore";
  var log = appendLog_(ctx, action, "expense", id, summarize(action, "expense", cur, saved), cur, saved);
  return ok_({ expense: saved, logId: log.id }, bumpRev_());
}

// ---- payments from the planner sheet (R39, R40) ----
// A pull reads the planner (never writes it), then, under the lock and
// against the Sheet as it is then, brings the planner's fields of each line
// tied to an included payment up to date and adds the payments with no line,
// through editExpense_ and addExpense_: validated, logged (via "planner") and
// undoable like any other change. At most PLANNER_MAX_WRITES_ of those per
// pull, changes first. A line is tied to its payment by its planner_id cell,
// which only a pull writes; a line rung up by hand whose note starts with a
// payment id in the planner is tied the first time (no Log row, no rev). A
// line deleted in the app stays deleted; nothing is deleted by a pull. The
// planner's id is never in a reply, and neither is a planner cell that is not
// part of a payment the app can use.

// A phone's own pull ({ auto: true }) within this long of the last pull reads
// nothing; Fetch and the connector always read the planner.
var PAYMENT_AUTO_GAP_MS_ = 10 * 60 * 1000;

function syncPayments_(args, ctx) {
  if (args.auto !== undefined && typeof args.auto !== "boolean") return err_("bad_input", MSG_.badRequest);
  if (!plannerId_()) return err_("no_planner", MSG_.noPlanner);
  var started = nowIso_();
  if (args.auto === true) {
    var since = Date.parse(started) - Date.parse(getProp_("PAYMENTS_PULLED_AT") || "");
    if (since >= 0 && since < PAYMENT_AUTO_GAP_MS_) {
      return ok_({ added: 0, changed: 0, same: 0, removed: 0, notCounted: [], problems: [], more: false, capped: false, skipped: true }, rev_());
    }
  }
  if (!hasColumn_("Expenses", "planner_id")) return err_("needs_migrate", MSG_.needsMigrate);
  var rows;
  try {
    rows = plannerRows_();
  } catch (e) {
    return err_("planner_unreadable", MSG_.plannerUnreadable);
  }
  var read = paymentsFromRows(rows);
  if (read.missing) return err_("planner_columns", read.missing);
  var pull = { actor: ctx.actor, via: "planner", names: ctx.names };
  // As for addExpense: fetching the day's rate can take a few seconds.
  if (read.payments.some(function (p) { return p.include; })) pull.rate = getRate_();
  return withLock_(function () {
    // A pull that read the planner later has already landed: this read is the
    // older one and must not put old values back.
    var landed = Date.parse(getProp_("PAYMENTS_READ_AT") || "");
    if (isFinite(landed) && landed > Date.parse(started)) return ok_({ added: 0, changed: 0, same: 0, removed: 0, notCounted: [], problems: [], more: false, capped: false, skipped: true }, rev_());
    var done = pullPayments_(read, pull);
    if (done && done.ok) {
      setProp_("PAYMENTS_READ_AT", started);
      setProp_("PAYMENT_PROBLEMS", JSON.stringify(plannerProblemsToStore_(started, done.data.problems)));
      // A pull cut short (more to bring in) is not done: the next one carries on at once.
      if (!done.data.more) setProp_("PAYMENTS_PULLED_AT", started);
    }
    return done;
  });
}

// The problems of a pull (payments or Book Now) as kept for load: at most 20,
// a message cut to 160, and how many more there were.
function plannerProblemsToStore_(at, problems) {
  var list = problems.slice(0, 20).map(function (p) {
    return { id: p.id, message: plannerCut_(p.message, 160), row: p.row, what: p.what };
  });
  return { at: at, list: list, more: Math.max(0, problems.length - 20) };
}

function pullPayments_(read, ctx) {
  var dayDates = tripDates_();
  var inPlanner = {};
  read.payments.forEach(function (p) { inPlanner[p.id] = true; });
  // The Expenses tab, read once: each line with the payment it is tied to.
  var lines = readTable_("Expenses")
    .filter(function (r) { return cellText_(r.id) !== ""; })
    .map(function (r) { return { e: expenseFromRow(r), pid: cellText_(r.planner_id) }; });
  lines.forEach(function (l) {
    if (l.pid !== "") return;
    var pid = paymentIdOf(l.e.note);
    if (pid === null || !inPlanner[pid]) return;
    updateById_("Expenses", l.e.id, { planner_id: pid });
    l.pid = pid;
  });

  var out = { added: 0, changed: 0, same: 0, removed: 0, notCounted: [], problems: read.problems.slice(), more: false, capped: read.capped };
  // A tie to a payment the planner no longer lists (renamed or removed there).
  // Not said when the planner was cut at 300: the rest were not read.
  if (!read.capped) {
    lines.forEach(function (l) {
      if (l.pid !== "" && !l.e.deleted && !inPlanner[l.pid]) out.problems.push({ id: l.pid, message: MSG_.notInPlanner, row: null, what: plannerWhat_(l.e.title) });
    });
  }
  var edits = [];
  var adds = [];
  read.payments.forEach(function (p) {
    var tied = lines.filter(function (l) { return l.pid === p.id; });
    var live = tied.filter(function (l) { return !l.e.deleted; });
    if (!p.include) {
      if (live.length) out.notCounted.push(p.id);
      return;
    }
    var x = expenseFromPayment(p, ctx.names, dayDates);
    if (!x.ok) {
      out.problems.push({ id: p.id, message: x.message, row: p.row, what: plannerWhat_(p.description) });
      return;
    }
    if (live.length > 1) {
      out.problems.push({ id: p.id, message: MSG_.twoLines, row: p.row, what: plannerWhat_(p.description) });
      return;
    }
    if (live.length === 1) {
      var patch = plannerPatch_(live[0].e, x.value);
      if (Object.keys(patch).length === 0) out.same++;
      else edits.push({ id: p.id, row: p.row, what: plannerWhat_(p.description), line: live[0].e.id, patch: patch, who: x.value.paidBy });
      return;
    }
    if (tied.length) {
      out.removed++;
      return;
    }
    var e = x.value;
    e.id = newId_();
    adds.push({ id: p.id, row: p.row, what: plannerWhat_(p.description), expense: e });
  });

  var writes = 0;
  var tried = function (job, r, counted) {
    if (!r.ok) out.problems.push({ id: job.id, message: r.message, row: job.row, what: job.what });
    else if (r.data.logId === null) out.same++;
    else {
      out[counted]++;
      writes++;
    }
  };
  edits.forEach(function (job) {
    if (writes === PLANNER_MAX_WRITES_) {
      out.more = true;
      return;
    }
    // Credited to who paid, not to whichever phone happened to ask.
    var asPayer = { actor: job.who, via: ctx.via, names: ctx.names, rate: ctx.rate };
    tried(job, editExpense_(job.line, job.patch, asPayer, true), "changed");
  });
  adds.forEach(function (job) {
    if (writes === PLANNER_MAX_WRITES_) {
      out.more = true;
      return;
    }
    var withTie = { actor: job.expense.paidBy, via: ctx.via, names: ctx.names, rate: ctx.rate, plannerId: job.id };
    tried(job, addExpense_({ expense: job.expense }, withTie), "added");
  });
  return ok_(out, rev_());
}

// The fields the planner owns that differ: title, amount, currency, payer,
// note, and the split (the same people in any order is the same split). The
// planner's payments are equal splits: a line set to shares or exact amounts
// in the app is put back to equal.
function plannerPatch_(cur, v) {
  var patch = {};
  ["title", "amount", "currency", "paidBy", "note"].forEach(function (k) { if (cur[k] !== v[k]) patch[k] = v[k]; });
  if (!same_(cur.split.slice().sort(), v.split.slice().sort()) || cur.splitMode !== "equal") {
    patch.split = v.split;
    patch.splitMode = "equal";
  }
  return patch;
}

// ---- payments ----

function addPayment_(args, ctx) {
  var v = validatePayment(args.payment, ctx.names);
  if (!v.ok) return err_("bad_input", v.message);
  var id = v.value.id;
  var existing = findRow_("Settlements", id);
  if (existing) return ok_({ payment: paymentFromRow(existing), logId: firstLogId_("payment", id, "stamp") }, rev_());

  var p = v.value;
  p.stampedBy = ctx.actor;
  var row = paymentToRow(p);
  row.stamped_at = nowIso_();
  appendObj_("Settlements", row);
  var saved = paymentFromRow(findRow_("Settlements", id));
  var log = appendLog_(ctx, "stamp", "payment", id, summarize("stamp", "payment", null, saved), null, saved);
  return ok_({ payment: saved, logId: log.id }, bumpRev_());
}

function setPaymentRemoved_(args, ctx, removed) {
  var id = idArg_(args);
  if (!id) return err_("bad_input", MSG_.badId);
  var row = findRow_("Settlements", id);
  if (!row) return err_("not_found", MSG_.noPayment);
  var cur = paymentFromRow(row);
  if (cur.removed === removed) return ok_({ payment: cur, logId: null }, rev_());
  var saved = paymentFromRow(updateById_("Settlements", id, { removed_at: removed ? nowIso_() : "" }));
  var action = removed ? "unstamp" : "restamp";
  var log = appendLog_(ctx, action, "payment", id, summarize(action, "payment", cur, saved), cur, saved);
  return ok_({ payment: saved, logId: log.id }, bumpRev_());
}

// ---- people ----

function setPerson_(args, ctx) {
  if (typeof args.name !== "string") return err_("bad_input", MSG_.badRequest);
  var v = validatePersonPatch(args.patch);
  if (!v.ok) return err_("bad_input", v.message);
  // A picture is only ever set by its owner (Task 16), and needs its column.
  if ("photo" in v.value) {
    if (args.name !== ctx.actor) return err_("bad_input", MSG_.notYourPicture);
    if (!hasColumn_("People", "photo")) return err_("needs_migrate", MSG_.needsMigrate);
  }
  // Security (2026-11-18): on a person's own key, only their own row; on the
  // shared key, no e-Transfer address changes at all (open your own link).
  if (ctx.holder === "person" && args.name !== ctx.actor) return err_("bad_input", MSG_.notYours);
  var row = null;
  peopleRows_().forEach(function (r) { if (!row && cellText_(r.name) === args.name) row = r; });
  if (!row) return err_("not_found", MSG_.noPerson);
  var cur = personFromRow(row);
  if (ctx.holder !== "person" && "etransfer" in v.value && v.value.etransfer !== cur.etransfer) return err_("bad_input", MSG_.ownLink);
  var changed = Object.keys(v.value).some(function (k) { return cur[k] !== v.value[k]; });
  if (!changed) return ok_({ person: cur }, rev_());
  var saved = personFromRow(updateWhere_("People", "name", args.name, v.value));
  // A new e-Transfer address is where money gets sent: it goes in the Log.
  // The address itself is only in the snapshots (the Sheet), never the sentence.
  // A Simplify flip alone is a reading preference and is not logged.
  if (saved.etransfer !== cur.etransfer) {
    var was = { name: cur.name, etransfer: cur.etransfer };
    var now = { name: saved.name, etransfer: saved.etransfer };
    appendLog_(ctx, "edit", "person", saved.name, summarize("edit", "person", was, now), was, now);
  }
  // A picture change is its own entry, kind "picture", so it can be undone
  // without making an e-Transfer change undoable. Its snapshots hold the
  // picture so undo can put it back; History never sends them to the phones.
  if (saved.photo !== cur.photo) {
    var hadPic = { name: cur.name, photo: cur.photo };
    var hasPic = { name: saved.name, photo: saved.photo };
    appendLog_(ctx, "edit", "picture", saved.name, summarize("edit", "picture", hadPic, hasPic), hadPic, hasPic);
  }
  return ok_({ person: saved }, bumpRev_());
}

// Undoing a picture change puts back the picture that was there (or none),
// only when it passes the same check as a new one (validatePersonPatch).
// Only its owner may: nobody changes another person's picture (Task 16).
// Answers like any undo, with the person as the item.
function undoPicture_(entry, rows, ctx) {
  if (entry.ref !== ctx.actor) return err_("bad_input", MSG_.notYourPicture);
  if (entry.undoneBy !== null) return err_("stale", MSG_.undone);
  if (!canUndo(entry, rows.map(logShape_))) return err_("stale", MSG_.newer);
  if (!entry.before || !entry.after) return err_("stale", MSG_.cantUndo);
  var row = null;
  peopleRows_().forEach(function (r) { if (!row && cellText_(r.name) === entry.ref) row = r; });
  if (!row) return err_("not_found", MSG_.noPerson);
  if (!hasColumn_("People", "photo")) return err_("needs_migrate", MSG_.needsMigrate);
  var cur = personFromRow(row);
  var target = undoTarget(entry);
  // What is put back is checked like a new picture: a Log cell changed by
  // hand can never put anything else into the People tab.
  var photo = target.photo === undefined || target.photo === null ? "" : target.photo;
  if (!validatePersonPatch({ photo: photo }).ok) return err_("stale", MSG_.cantUndo); // "" (none) passes
  var saved = personFromRow(updateWhere_("People", "name", entry.ref, { photo: photo }));
  var log = appendLog_(ctx, "undo", "picture", entry.ref, "undid: " + entry.summary, { name: cur.name, photo: cur.photo }, { name: saved.name, photo: saved.photo }, entry.id);
  updateById_("Log", entry.id, { undone_by: log.id });
  var rev = bumpRev_();
  var shown = logShape_(log);
  shown.canUndo = true;
  return ok_({ entry: shown, logId: log.id, person: saved }, rev);
}

// ---- the trip plan: stops, stays, day headers ----

// The row whose key cell (an id, or a day's date) is ref. Dates go through
// cellDate_ in case Sheets hands a date cell back as a Date.
function findPlanRow_(plan, ref) {
  var rows = readTable_(plan.tab);
  for (var i = 0; i < rows.length; i++) if (cellDate_(rows[i][plan.key]) === ref) return rows[i];
  return null;
}

// The fields of an item a person can change, as a fresh object.
function planFields_(plan, item) {
  var out = {};
  plan.fields.forEach(function (f) { out[f] = item[f]; });
  return out;
}

// The columns of next that differ from cur, both cleaned items. Only these
// are written: a column the change leaves alone keeps whatever the Sheet
// holds, even a hand-typed value the reader cleans away (9:30, a bare link).
function changedCols_(plan, cur, next) {
  var was = plan.toRow(planFields_(plan, cur));
  var now = plan.toRow(planFields_(plan, next));
  var out = {};
  Object.keys(now).forEach(function (k) { if (!same_(now[k], was[k])) out[k] = now[k]; });
  return out;
}

function writePlan_(plan, ref, patch) {
  return plan.fromRow(updateWhere_(plan.tab, plan.key, ref, patch));
}

function tripDates_() {
  return readTable_("Days").map(function (r) { return cellDate_(r.date); }).filter(function (d) { return d !== ""; });
}

// Appends a new stop or stay, or returns the one already there with the id
// of the Log row that added it (a repeated add).
function addPlanItem_(kind, value, ctx) {
  var plan = planKind_(kind);
  var id = value.id;
  var existing = findPlanRow_(plan, id);
  if (existing) return ok_(planReply_(kind, plan.fromRow(existing), firstLogId_(kind, id, "add")), rev_());
  var row = plan.toRow(value);
  row.deleted_at = "";
  appendObj_(plan.tab, row);
  var saved = plan.fromRow(findPlanRow_(plan, id));
  var log = appendLog_(ctx, "add", kind, id, summarize("add", kind, null, saved), null, saved);
  return ok_(planReply_(kind, saved, log.id), bumpRev_());
}

// Writes an edit of an existing item (cur) to the values in next, unless
// nothing changes. ref is the item's key (its id, or a day's date).
function editPlanItem_(kind, ref, cur, next, ctx) {
  var plan = planKind_(kind);
  var cols = changedCols_(plan, cur, next);
  if (Object.keys(cols).length === 0) return ok_(planReply_(kind, cur, null), rev_());
  var saved = writePlan_(plan, ref, cols);
  var log = appendLog_(ctx, "edit", kind, ref, summarize("edit", kind, cur, saved), cur, saved);
  return ok_(planReply_(kind, saved, log.id), bumpRev_());
}

function planReply_(kind, item, logId) {
  var data = { logId: logId };
  data[kind] = item;
  return data;
}

// Coordinates come only from the app (a pasted Maps link) or locate: the
// connector reads them but cannot set them.
function claudeCoords_(input, ctx) {
  return ctx.via === "claude" && isObj_(input) && (input.lat !== undefined || input.lng !== undefined);
}

function addStop_(args, ctx) {
  if (claudeCoords_(args.stop, ctx)) return err_("bad_input", MSG_.stopPatchKey);
  var v = validateStop(args.stop, tripDates_());
  if (!v.ok) return err_("bad_input", v.message);
  if (factsNeedMigrate_(v.value)) return err_("needs_migrate", MSG_.needsMigrate);
  return addPlanItem_("stop", v.value, ctx);
}

function updateStop_(args, ctx) {
  var plan = planKind_("stop");
  var id = idArg_(args);
  if (!id) return err_("bad_input", MSG_.badId);
  var patch = args.patch;
  if (!isObj_(patch)) return err_("bad_input", MSG_.badPatch);
  if (claudeCoords_(patch, ctx)) return err_("bad_input", MSG_.stopPatchKey);
  var keys = Object.keys(patch);
  for (var i = 0; i < keys.length; i++) {
    if (plan.fields.indexOf(keys[i]) === -1) return err_("bad_input", MSG_.stopPatchKey);
  }
  var row = findPlanRow_(plan, id);
  if (!row) return err_("not_found", plan.missing);
  var cur = plan.fromRow(row);
  if (cur.deleted) return err_("bad_input", MSG_.editDeleted);

  // Validate the whole stop as it would be, not the patch alone.
  var merged = planFields_(plan, cur);
  keys.forEach(function (k) { merged[k] = patch[k]; });
  merged.id = id;
  var v = validateStop(merged, tripDates_());
  if (!v.ok) return err_("bad_input", v.message);
  if (factsNeedMigrate_(v.value)) return err_("needs_migrate", MSG_.needsMigrate);
  // A new place: the old coordinates were for the old one (unless new ones came with it).
  if (v.value.place !== cur.place && patch.lat === undefined && patch.lng === undefined) {
    v.value.lat = "";
    v.value.lng = "";
  }
  return editPlanItem_("stop", id, cur, v.value, ctx);
}

// ---- where things are: locate ----
// For each stop, stay and day with no coordinates, asks Apps Script's own
// geocoder (Env.js geocode_, region jp). Each row has its forms of question:
// a stop its place with its day's city, then its title with its day's city
// (and when the day has coordinates, an answer more than LOCATE_NEAR_M from
// them counts as not found: a common name in another city); a stay its Japanese
// address, then its name with its place; a day its city. A stop whose place
// is a Maps link with a position is read without asking.
// Fair to every row: a row costs at most one lookup a call; rows never tried
// go first, rows tried before go last (the longest ago first), each trying
// its next form. Which rows found nothing, and how often, is kept in one
// Script Property, LOCATE_TRIED ({ "stop:<id>": { d: day, n: tries } }),
// pruned to rows still without coordinates. At most LOCATE_MAX_ lookups a
// call (the same question twice in a call is asked once). No History line;
// rev moves when something was found, so phones fetch it.
// -> { found, missing, more } (more: rows never tried remain).

var LOCATE_MAX_ = 40;
var LOCATE_KEY_ = "LOCATE_TRIED";
var LOCATE_NEAR_M_ = 30000;

function locate_() {
  var tabs = ["Stops", "Stays", "Days"];
  for (var t = 0; t < tabs.length; t++) {
    if (!hasColumn_(tabs[t], "lat") || !hasColumn_(tabs[t], "lng")) return err_("needs_migrate", MSG_.needsMigrate);
  }
  var tried = {};
  try {
    var kept = JSON.parse(getProp_(LOCATE_KEY_) || "{}");
    if (kept && typeof kept === "object" && !Array.isArray(kept)) tried = kept;
  } catch (e) {
    tried = {};
  }
  var placeText = function (v) { var s = cellText_(v).trim(); return safeUrl(s) ? "" : s; };
  var clean = function (list) {
    var out = [];
    list.forEach(function (q) {
      q = String(q || "").replace(/\s+/g, " ").trim();
      if (q !== "" && out.indexOf(q) === -1) out.push(q);
    });
    return out;
  };
  // Every row still without coordinates: { key, tab, col, ref, queries, pin }.
  var rows = [];
  var days = readTable_("Days");
  var cityOf = {};
  var dayAt = {}; // a day's coordinates, as known so far
  days.forEach(function (r) {
    cityOf[cellDate_(r.date)] = cellText_(r.city).trim();
    if (coordsOf_(r).lat !== "") dayAt[cellDate_(r.date)] = coordsOf_(r);
  });
  days.forEach(function (r) {
    var date = cellDate_(r.date);
    if (date === "" || coordsOf_(r).lat !== "") return;
    rows.push({ key: "day:" + date, tab: "Days", col: "date", ref: date, day: date, queries: clean([cityOf[date]]) });
  });
  readTable_("Stays").forEach(function (r) {
    var id = cellText_(r.id);
    if (id === "" || cellSet_(r.deleted_at) || coordsOf_(r).lat !== "") return;
    rows.push({ key: "stay:" + id, tab: "Stays", col: "id", ref: id, queries: clean([r.address_jp, cellText_(r.name) + " " + placeText(r.place)]) });
  });
  readTable_("Stops").forEach(function (r) {
    var id = cellText_(r.id);
    if (id === "" || cellSet_(r.deleted_at) || coordsOf_(r).lat !== "") return;
    var city = cityOf[cellDate_(r.date)] || "";
    var place = placeText(r.place);
    rows.push({
      key: "stop:" + id, tab: "Stops", col: "id", ref: id, pin: pointFromLink(cellText_(r.place)), on: cellDate_(r.date),
      queries: clean([place ? place + " " + city : "", cellText_(r.title).trim() + " " + city]),
    });
  });
  // Keep only rows still waiting; untried first (in sheet order), then the longest ago.
  var still = {};
  rows.forEach(function (row) { if (tried[row.key]) still[row.key] = tried[row.key]; });
  tried = still;
  var order = rows.map(function (row, i) { return { row: row, i: i, t: tried[row.key] || null }; });
  order.sort(function (x, y) {
    if (!x.t !== !y.t) return x.t ? 1 : -1;
    if (x.t && y.t && x.t.d !== y.t.d) return x.t.d < y.t.d ? -1 : 1;
    return x.i - y.i;
  });
  var left = LOCATE_MAX_;
  var asked = {};
  var found = 0;
  var missing = 0;
  var more = false;
  var day = today_();
  order.forEach(function (o) {
    var row = o.row;
    var p = row.pin || null;
    if (!p) {
      if (!row.queries.length) return;
      var n = o.t ? Number(o.t.n) || 0 : 0;
      var q = row.queries[n % row.queries.length];
      if (!Object.prototype.hasOwnProperty.call(asked, q)) {
        if (left <= 0) {
          if (!o.t) more = true;
          return;
        }
        left--;
        var got = null;
        try {
          got = geocode_(q, "jp");
        } catch (e) {
          got = null;
        }
        asked[q] = got ? coordsOf_(got) : null;
        if (asked[q] && asked[q].lat === "") asked[q] = null;
      }
      p = asked[q];
      // A stop's answer far from its day's place is another place of that name.
      if (p && row.on && dayAt[row.on] && !(metresBetween_(p, dayAt[row.on]) <= LOCATE_NEAR_M_)) p = null;
    }
    if (!p) {
      missing++;
      tried[row.key] = { d: day, n: (o.t ? Number(o.t.n) || 0 : 0) + 1 };
      return;
    }
    updateWhere_(row.tab, row.col, row.ref, { lat: p.lat, lng: p.lng });
    if (row.day) dayAt[row.day] = p;
    delete tried[row.key];
    found++;
  });
  setProp_(LOCATE_KEY_, JSON.stringify(tried));
  return ok_({ found: found, missing: missing, more: more }, found > 0 ? bumpRev_() : rev_());
}

// A new id adds the stay; a known one edits it. With merge: true (the Claude
// connector) the stay must already be there, and the fields given are laid
// over the row as it is now, under the lock, so a field left out keeps
// whatever another phone just saved. The merged stay is validated whole.
function saveStay_(args, ctx) {
  var plan = planKind_("stay");
  if (args.merge !== undefined && typeof args.merge !== "boolean") return err_("bad_input", MSG_.badRequest);
  var input = args.stay;
  if (args.merge === true && isObj_(input) && typeof input.id === "string") {
    var found = input.id === "" ? null : findPlanRow_(plan, input.id);
    if (!found) return err_("not_found", plan.missing);
    var was = plan.fromRow(found);
    if (was.deleted) return err_("bad_input", MSG_.editDeleted);
    var merged = planFields_(plan, was);
    plan.fields.forEach(function (k) { if (input[k] !== undefined) merged[k] = input[k]; });
    merged.id = was.id;
    input = merged;
  }
  var v = validateStay(input);
  if (!v.ok) return err_("bad_input", v.message);
  // An older Sheet has no photo column until migrate: refuse a photo rather than drop it.
  if (v.value.photo !== "" && !hasColumn_("Stays", "photo")) return err_("needs_migrate", MSG_.needsMigrate);
  var row = findPlanRow_(plan, v.value.id);
  if (!row) return addPlanItem_("stay", v.value, ctx);
  var cur = plan.fromRow(row);
  if (cur.deleted) return err_("bad_input", MSG_.editDeleted);
  // A new address or place: the old coordinates were for the old one. A new name alone is no move.
  if (v.value.addressJp !== cur.addressJp || v.value.place !== cur.place) {
    v.value.lat = "";
    v.value.lng = "";
  }
  return editPlanItem_("stay", cur.id, cur, v.value, ctx);
}

function setPlanDeleted_(kind, args, ctx, deleted) {
  var plan = planKind_(kind);
  var id = idArg_(args);
  if (!id) return err_("bad_input", MSG_.badId);
  var row = findPlanRow_(plan, id);
  if (!row) return err_("not_found", plan.missing);
  var cur = plan.fromRow(row);
  if (cur.deleted === deleted) return ok_(planReply_(kind, cur, null), rev_());
  var saved = writePlan_(plan, id, { deleted_at: deleted ? nowIso_() : "" });
  var action = deleted ? "delete" : "restore";
  var log = appendLog_(ctx, action, kind, id, summarize(action, kind, cur, saved), cur, saved);
  return ok_(planReply_(kind, saved, log.id), bumpRev_());
}

function setDay_(args, ctx) {
  var plan = planKind_("day");
  if (typeof args.date !== "string") return err_("bad_input", MSG_.badRequest);
  var v = validateDayPatch(args.patch);
  if (!v.ok) return err_("bad_input", v.message);
  var row = args.date === "" ? null : findPlanRow_(plan, args.date);
  if (!row) return err_("not_found", plan.missing);
  var cur = plan.fromRow(row);
  var next = planFields_(plan, cur);
  Object.keys(v.value).forEach(function (k) { next[k] = v.value[k]; });
  // A new city: the old coordinates were for the old one.
  if (next.city !== cur.city) {
    next.lat = "";
    next.lng = "";
  }
  return editPlanItem_("day", cur.date, cur, next, ctx);
}

// ---- "Before we go": the planner's Book Now tab (Task 19, R45, R46, R49) ----
// The list lives in the Todos tab, keyed by the planner's # (id). A pull
// reads the planner's Book Now tab (no lock held) and, under the app's lock,
// brings item, book_by, status, note and link up to date, appends new
// numbers and marks the ones no longer there gone; it never deletes a row
// and writes no History of its own. A tick or a claim is an ordinary logged,
// undoable change (kind "todo").
//
// The planner is the owner's working document: a wrong Booked there is the
// worst outcome (R49). So a tick is bound to the item's text when it was
// made (ticked_item): it is written to the planner, then or by a later
// pull, only to the row whose # is the id AND whose Item is that text, found
// on a read made just before the write. When a pull finds another Item
// under a # that carries a tick or a claim, it takes them off (one History
// line, not undoable) and never writes for it. Planner reads and writes run
// under their own lock, never while the app's lock is held: the app's lock
// covers only the app's own Sheet. Undo puts back what the planner held when
// the app wrote Booked (planner_was), and only while the planner still says
// exactly Booked: anything else is someone's later edit and is kept. Nothing
// done through the Claude connector writes to the planner. Nothing else is
// ever written to the planner. The planner's id is never in a reply.

var TODO_BOOK_TAB_ = "Book Now";
var TODO_LOG_TAB_ = "Change Log";
var TODO_TICK_WHY_ = "Ticked off in the MAT app";
var TODO_UNTICK_WHY_ = "Tick undone in the MAT app";
var TODO_UNRECORDED_WHY_ = "The MAT app couldn’t record the tick; put back";

// Item texts compared as the same item: runs of spaces (non-breaking ones
// too) count as one, and the ends are trimmed, on both sides.
function sameItem_(a, b) {
  var norm = function (s) { return cellText_(s).replace(/[\s\u00a0]+/g, " ").trim(); };
  return norm(a) === norm(b);
}

// Whether the Sheet has the Todos tab with every column the actions write.
function todosReady_() {
  return hasTab_("Todos") && hasColumn_("Todos", "ticked_item") && hasColumn_("Todos", "planner_was");
}

// The Todos rows, [] while the tab is not there (before migrate).
function todoRows_() {
  if (!hasTab_("Todos")) return [];
  return readTable_("Todos").filter(function (r) { return cellText_(r.id) !== ""; });
}

function todosShown_() {
  return todoRows_().filter(function (r) { return cellText_(r.gone) !== "yes"; }).map(todoFromRow);
}

// The text a row's tick is bound to: what it was called when ticked.
function tickedItemOf_(row) {
  return cellText_(row.ticked_item) || cellText_(row.item);
}

// What a History entry keeps of an item (its Log row's before and after):
// enough to undo a tick or a claim.
function todoSnap_(t, row) {
  return { id: t.id, item: t.item, status: t.status, claimedBy: t.claimedBy, tickedBy: t.tickedBy, tickedAt: t.tickedAt, tickedItem: t.tickedBy ? tickedItemOf_(row) : "" };
}

function tripYear_() {
  var start = cellText_(tripInfo_().start);
  return DAY_RE_.test(start) ? Number(start.slice(0, 4)) : Number(nowIso_().slice(0, 4));
}

// Runs an env's then_ (the planner part of a write) once the app's lock is
// let go. The app's change is saved by then: a throw here only means the
// planner part is not known to have happened. A then_ sets data.planner only
// once that is known, and nothing after that can throw (afterTick_,
// afterUntick_), so "pending" here is never said over a known outcome.
function thenOutsideLock_(env) {
  if (!env || typeof env.then_ !== "function") return env;
  var next = env.then_;
  delete env.then_;
  try {
    return next(env);
  } catch (e) {
    env.data.planner = "pending";
    return env;
  }
}

function syncTodos_(args, ctx) {
  if (args.force !== undefined && typeof args.force !== "boolean") return err_("bad_input", MSG_.badRequest);
  if (!plannerId_()) return err_("no_planner", MSG_.noPlanner);
  if (!todosReady_()) return err_("needs_migrate", MSG_.needsMigrate);
  var last = getProp_("TODOS_PULLED_AT") || "";
  var since = Date.parse(nowIso_()) - Date.parse(last);
  // Within 10 minutes the stored list is the answer; a forced pull too, within 30 seconds.
  if (since >= 0 && (since < TODO_FORCE_GAP_MS_ || (args.force !== true && since < TODO_PULL_GAP_MS_))) {
    return ok_({ todos: todosShown_(), pulledAt: last, more: false, problems: [], stored: true }, rev_());
  }
  // A refusal still carries the list as stored, so a phone keeps showing it.
  var refuse = function (code, message) {
    var env = err_(code, message);
    env.data = { todos: todosShown_(), pulledAt: last, stored: true };
    return env;
  };
  var rows;
  try {
    rows = plannerTab_(TODO_BOOK_TAB_);
  } catch (e) {
    return refuse("planner_unreadable", MSG_.plannerUnreadable);
  }
  var read = todosFromRows(rows, tripYear_());
  if (read.missing) return refuse("planner_columns", read.missing);
  var pulled = withLock_(function () { return pullTodos_(read, ctx.actor); });
  if (!pulled.ok) return pulled;

  // The pull is complete once its row writes are: what the retries do never
  // holds it open (a tick that keeps failing must not keep every pull open).
  // Its problems are kept for load either way (a stored answer or a refusal
  // never gets here, so it leaves the last ones alone).
  var at = nowIso_();
  setProp_("TODO_PROBLEMS", JSON.stringify(plannerProblemsToStore_(at, pulled.problems)));
  var pulledAt = "";
  if (!pulled.more) {
    pulledAt = at;
    setProp_("TODOS_PULLED_AT", pulledAt);
  }
  // Ticks the planner has not taken yet, and undone ticks whose Booked it
  // still holds (planner_written "undo"): two a pull, the oldest tick first
  // and the owed put-backs after every tick (their keys start "|", which
  // sorts after a tick time's digits), going on each pull from after the
  // last one tried (TODOS_RETRY_AFTER) and round to the start, so one that
  // always fails starves no other. Each under the planner lock against a
  // fresh read, then recorded under the app's lock.
  var queue = pulled.retry.slice().sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
  var after = getProp_("TODOS_RETRY_AFTER") || "";
  var start = 0;
  while (start < queue.length && queue[start].key <= after) start++;
  queue = queue.slice(start).concat(queue.slice(0, start)).slice(0, TODO_MAX_RETRIES_);
  queue.forEach(function (job) {
    setProp_("TODOS_RETRY_AFTER", job.key);
    try {
      if (job.was !== undefined) settleUntick_(job.id, plannerUntick_(job.id, job.item, job.was, job.by), null, job.item);
      else settleTick_(job.id, job.item, job.by, plannerTick_(job.id, job.item, job.by));
    } catch (e) {
      // Best effort (R45): the tick stands and a later pull tries again.
    }
  });
  return ok_({ todos: todosShown_(), pulledAt: pulledAt, more: pulled.more, problems: pulled.problems }, rev_());
}

// The pull's writes to the app's own Sheet, under its lock: read is
// todosFromRows of the Book Now rows; by, who pulls (named in the Change Log
// for a put-back whose undo the Log does not name).
// -> { ok, more, problems, retry }.
function pullTodos_(read, by) {
  var byId = {};
  todoRows_().forEach(function (r) { byId[cellText_(r.id)] = r; });
  var inPlanner = {};
  var jobs = [];
  var problems = read.problems.slice();
  read.items.forEach(function (it) {
    inPlanner[it.id] = true;
    var cols = { item: it.item, book_by: it.bookBy, status: it.status, note: it.note, link: it.link };
    var r = byId[it.id];
    if (!r) {
      cols.id = it.id;
      jobs.push({ add: cols });
      return;
    }
    // An undone tick whose Booked the planner still holds: that Booked is the
    // app's own, so the row keeps the status it had before the tick.
    var owed = cellText_(r.planner_written) === "undo" && sameItem_(it.item, tickedItemOf_(r));
    if (owed && it.status === "Booked") cols.status = cellText_(r.planner_was);
    var patch = {};
    Object.keys(cols).forEach(function (k) { if (cellDate_(r[k]) !== cols[k]) patch[k] = cols[k]; });
    if (cellText_(r.gone) === "yes") patch.gone = "";
    // Another item under this # now: whatever was ticked or claimed was the old one (R49).
    var ticked = cellText_(r.ticked_by) !== "";
    var claimer = cellText_(r.claimed_by);
    var bound = ticked ? tickedItemOf_(r) : cellText_(r.item);
    var takeoff = null;
    var dropped = null;
    if ((ticked || claimer !== "") && !sameItem_(it.item, bound)) {
      ["ticked_by", "ticked_at", "ticked_item", "planner_written", "planner_was", "claimed_by"].forEach(function (k) { patch[k] = ""; });
      takeoff = { old: bound, ticked: ticked, claimer: claimer, row: r };
      problems.push({ id: it.id, message: ticked && claimer !== "" ? MSG_.bothTakenOff : ticked ? MSG_.tickTakenOff : MSG_.claimTakenOff, row: it.row, what: plannerWhat_(it.item) });
    } else if (cellText_(r.planner_written) === "undo" && !owed) {
      // Another item under this # now: the put-back was owed to the old one.
      // While that row still says exactly Booked, the app's Booked is left on
      // it: History says so (dropped).
      ["ticked_item", "planner_written", "planner_was"].forEach(function (k) { patch[k] = ""; });
      if (it.status === "Booked") dropped = tickedItemOf_(r);
    }
    // A true was kept aside (todoWas_) goes onto a row still ticked as
    // written; anywhere else it is just cleared.
    var keptWas = todoWas_(it.id);
    var dropWas = false;
    if (keptWas !== null) {
      if (!takeoff && cellText_(r.ticked_by) !== "" && cellText_(r.planner_written) === "yes") {
        patch.planner_was = keptWas;
        dropWas = true;
      } else dropTodoWas_(it.id);
    }
    if (Object.keys(patch).length) jobs.push({ id: it.id, patch: patch, takeoff: takeoff, dropped: dropped, dropWas: dropWas });
  });
  Object.keys(byId).forEach(function (id) {
    if (!inPlanner[id] && cellText_(byId[id].gone) !== "yes") {
      dropTodoWas_(id);
      jobs.push({ id: id, patch: { gone: "yes" } });
    }
  });

  // One Sheet write per row (the app's Sheet helpers write a row at a time),
  // so a pull is capped and says when more remain.
  var writes = 0;
  var more = false;
  jobs.forEach(function (job) {
    if (writes === TODO_MAX_WRITES_) {
      more = true;
      return;
    }
    if (job.add) appendObj_("Todos", job.add);
    else {
      var before = job.takeoff ? todoFromRow(job.takeoff.row) : null;
      var after = updateById_("Todos", job.id, job.patch);
      if (job.takeoff) logTakeoff_(job.takeoff, before, after);
      if (job.dropped !== null && job.dropped !== undefined) logDropped_(job.id, job.dropped);
      if (job.dropWas) dropTodoWas_(job.id);
    }
    writes++;
  });
  if (writes) bumpRev_();

  var undoers = null;
  var retry = todoRows_().filter(function (r) {
    if (cellText_(r.gone) === "yes") return false;
    if (cellText_(r.planner_written) === "undo") return true;
    return cellText_(r.ticked_by) !== "" && cellText_(r.planner_written) === "" && !isBooked(r.status);
  }).map(function (r) {
    var id = cellText_(r.id);
    if (cellText_(r.planner_written) === "undo") {
      // An owed put-back (no tick time: its key sorts after every tick's), by whoever undid the tick.
      if (!undoers) undoers = todoUndoers_();
      return { id: id, item: tickedItemOf_(r), was: cellText_(r.planner_was), by: undoers[id] || by, key: "|" + id };
    }
    // Oldest tick first; the key orders the retries and marks where they stopped.
    return { id: id, item: tickedItemOf_(r), by: cellText_(r.ticked_by), key: cellStamp_(r.ticked_at) + "|" + id };
  });
  return { ok: true, more: more, problems: problems, retry: retry };
}

// Who last undid something on each item: { id: name }, from the Log.
function todoUndoers_() {
  var who = {};
  var at = {};
  logRows_().forEach(function (r) {
    var id = cellText_(r.ref);
    var n = Number(r.id);
    if (cellText_(r.kind) === "todo" && cellText_(r.action) === "undo" && !(at[id] >= n)) {
      at[id] = n;
      who[id] = cellText_(r.who);
    }
  });
  return who;
}

// The one History line for a tick or claim a pull took off. Not undoable.
function logTakeoff_(t, beforeTodo, afterRow) {
  var after = todoFromRow(afterRow);
  var gone = [];
  if (t.ticked) gone.push("the tick was taken off");
  if (t.claimer !== "") gone.push(t.claimer + " is no longer on it");
  var said = "changed “" + plannerCut_(t.old, 60) + "”: " + gone.join(" and ");
  appendLog_({ actor: "The planner", via: "app" }, "takeoff", "todo", beforeTodo.id, said, todoSnap_(beforeTodo, t.row), todoSnap_(after, afterRow));
}

// History's one note that a put-back was dropped while the planner row,
// now another item, still says the Booked the app wrote. Not undoable.
function logDropped_(id, old) {
  appendLog_({ actor: "The planner", via: "app" }, "note", "planner", id, "changed “" + plannerCut_(old, 60) + "”: the Booked the app wrote there was left as it is", null, null);
}

// The Book Now item that is this tick's: the row whose # is id, if its Item
// is the text the tick is bound to. null otherwise (renumbered, renamed,
// removed).
function plannerTodo_(bookRows, id, item) {
  var items = todosFromRows(bookRows, tripYear_()).items;
  for (var i = 0; i < items.length; i++) if (items[i].id === id) return sameItem_(items[i].item, item) ? items[i] : null;
  return null;
}

// Under the planner lock: the Change Log as just read (logRows) and the
// Book Now row just found on a read made after it, so the row checked is the
// row written with the smallest gap. Writes `to` into found's Status cell,
// then appends one Change Log row; if the append fails, puts the old Status
// back (best effort, and only while the cell still says what was just
// written). Writes nothing when the Change Log has no header, nor when the
// planner computes the Status cell (a formula in it or spilled into it:
// "formula"), nor when the check could not tell ("pending": retried).
// -> "written" | "pending" | "formula"
function plannerWriteStatus_(logRows, found, to, why, actor) {
  var cell = colLetter(found.statusCol) + found.row;
  var log = changeLogRow(logRows, {
    "Date / time": torontoNow_(), "Agent / session": "MAT app (" + actor + ")", Tab: TODO_BOOK_TAB_, "Cell(s)": cell, Item: found.item,
    "Old value": found.status === "" ? "(empty)" : found.status, "New value": to === "" ? "(empty)" : to,
    Why: why, "Proof / source": "MAT app History", "Verified?": "By " + actor,
  });
  if (!log) return "pending";
  var computed = plannerCellComputed_(TODO_BOOK_TAB_, found.row, found.statusCol);
  if (computed === null) return "pending"; // could not tell: write nothing, try again later
  if (computed) return "formula";
  try {
    plannerSetCell_(TODO_BOOK_TAB_, cell, to);
  } catch (e) {
    return "pending";
  }
  try {
    plannerAppendRow_(TODO_LOG_TAB_, log.headerRow, log.firstCol, log.values);
  } catch (e) {
    try {
      var again = plannerTodo_(plannerTab_(TODO_BOOK_TAB_), found.id, found.item);
      if (again && again.row === found.row && again.statusCol === found.statusCol && again.status === to) plannerSetCell_(TODO_BOOK_TAB_, cell, found.status);
    } catch (e2) { /* best effort */ }
    return "pending";
  }
  return "written";
}

// The planner part of a tick, under the planner lock, never the app's.
// -> { result: "written", was } | { result: "already", status } | { result: "formula" } | { result: "pending" }
function plannerTick_(id, item, actor) {
  var out = withPlannerLock_(function () {
    try {
      var logRows = plannerTab_(TODO_LOG_TAB_);
      var found = plannerTodo_(plannerTab_(TODO_BOOK_TAB_), id, item);
      if (!found) return { result: "pending" };
      // Booked there already (by hand): nothing to write; the app takes its word.
      if (isBooked(found.status)) return { result: "already", status: found.status };
      var wrote = plannerWriteStatus_(logRows, found, "Booked", TODO_TICK_WHY_, actor);
      if (wrote === "formula") return { result: "formula" };
      return wrote === "written" ? { result: "written", was: found.status } : { result: "pending" };
    } catch (e) {
      return { result: "pending" };
    }
  });
  return out || { result: "pending" };
}

// The planner part of undoing a written tick, under the planner lock: puts
// back `was` only while the row still holds this item and says exactly
// Booked. -> "written" | "kept" (someone changed it since: left alone) |
// "pending" (could not; the planner may still say Booked)
function plannerUntick_(id, item, was, actor, why) {
  if (typeof was !== "string") return "pending";
  var out = withPlannerLock_(function () {
    try {
      var logRows = plannerTab_(TODO_LOG_TAB_);
      var found = plannerTodo_(plannerTab_(TODO_BOOK_TAB_), id, item);
      if (!found) return "pending";
      if (found.status !== "Booked") return "kept";
      var put = plannerWriteStatus_(logRows, found, was, why || TODO_UNTICK_WHY_, actor);
      return put === "formula" ? "kept" : put;
    } catch (e) {
      return "pending";
    }
  });
  return out || "pending";
}

// The status a tick's Booked replaced, kept aside in a Script Property
// (TODO_WAS_<id>) when the app could not write it into the row: the app's
// lock busy twice over while the row still held an older planner_was
// (second fix round, I1). Needs no lock. Undo uses it before the row's
// planner_was; the next pull (or that undo), under the lock, copies it onto
// the row and clears it; a row no longer ticked or gone just has it cleared.
function todoWas_(id) {
  var v = getProp_("TODO_WAS_" + id);
  return typeof v === "string" ? v : null;
}
function keepTodoWas_(id, was) { setProp_("TODO_WAS_" + id, was); }
function dropTodoWas_(id) { if (todoWas_(id) !== null) delProp_("TODO_WAS_" + id); }

// Records what the planner did with a tick, under the app's lock, only while
// the tick is still there and bound to the same text. A Booked the app
// cannot record (its lock busy, or the tick undone while the write was on
// its way) is taken back out of the planner (outside the lock), so every
// Booked the app wrote is one it knows of; if even that fails, History says
// so. A Status the planner computes (a formula) is recorded as
// planner_written "formula": the tick is settled, never retried, never
// written. -> "written" | "kept" | "pending"
function settleTick_(id, item, by, out) {
  if (out.result === "pending") return "pending";
  var rec;
  try {
    rec = withLock_(function () {
      var row = findRow_("Todos", id);
      var still = row && cellText_(row.ticked_by) !== "" && sameItem_(tickedItemOf_(row), item) && cellText_(row.gone) !== "yes";
      if (!still) return { ok: true, revert: out.result === "written", gone: true };
      if (out.result === "formula") {
        updateById_("Todos", id, { planner_written: "formula", planner_was: "" });
        bumpRev_();
      } else if (out.result === "written") {
        updateById_("Todos", id, { planner_written: "yes", planner_was: out.was, status: "Booked" });
        dropTodoWas_(id);
        bumpRev_();
      } else if (cellText_(row.status) !== out.status) {
        updateById_("Todos", id, { status: out.status });
        bumpRev_();
      }
      return { ok: true, revert: false };
    });
  } catch (e) {
    rec = { ok: false };
  }
  if (!rec || !rec.ok) {
    // The recording threw or the lock was busy. If the row already says the
    // planner was written (it got that far, or a tick of an owed row said so
    // up front) with the very status this write replaced, the app knows of
    // the Booked: the planner is left as it is. A planner_was that differs
    // (an owed row whose Status was changed by hand meanwhile) is put right
    // below (staleWas).
    var saved;
    var staleWas = false;
    try {
      var again = findRow_("Todos", id);
      saved = again ? cellText_(again.planner_written) : "";
      staleWas = saved === "yes" && out.result === "written" && cellText_(again.planner_was) !== out.was;
    } catch (e2) {
      saved = null; // not known: leave the planner alone rather than undo a recorded write
    }
    if (staleWas) {
      // Second fix round, I1: the row says yes but with an older planner_was
      // (an owed row whose Status was changed by hand meanwhile). Wait for
      // the lock once more and record the true one; if it is still busy,
      // keep the Booked and keep the true was aside (todoWas_), never take
      // the write back out.
      var second;
      try {
        second = withLock_(function () {
          var row = findRow_("Todos", id);
          var still = row && cellText_(row.ticked_by) !== "" && sameItem_(tickedItemOf_(row), item) && cellText_(row.gone) !== "yes" && cellText_(row.planner_written) === "yes";
          if (!still) return { ok: true, done: false };
          updateById_("Todos", id, { planner_was: out.was, status: "Booked" });
          dropTodoWas_(id);
          bumpRev_();
          return { ok: true, done: true };
        });
      } catch (e5) {
        second = { ok: false };
      }
      if (second && second.ok && second.done) return "written";
      if (!second || !second.ok) {
        keepTodoWas_(id, out.was);
        return "written";
      }
      // No longer ticked as written: taken back out as for a tick undone meanwhile.
      rec = { ok: true, revert: true };
    } else if (out.result === "written" && saved !== null && saved !== "") return "written";
    if (out.result === "written" && saved === null) {
      try { logBookedLeft_(id, item, by); } catch (e3) { /* best effort */ }
      return "pending";
    }
    if (!staleWas) rec = { ok: false };
  }
  if (out.result === "formula") {
    // The tick is settled either way: the History line is best effort, and
    // only for a tick still there (one undone meanwhile has nothing to note).
    if (rec.ok && !rec.gone) try { logFormulaLeft_(id, item, by); } catch (e4) { /* best effort */ }
    return rec.ok ? "kept" : "pending";
  }
  if (out.result === "written" && (!rec.ok || rec.revert)) {
    var back = plannerUntick_(id, item, out.was, by, rec.ok ? TODO_UNTICK_WHY_ : TODO_UNRECORDED_WHY_);
    if (back === "pending") logBookedLeft_(id, item, by);
    return "pending";
  }
  return rec.ok ? "written" : "pending";
}

// History's one note that the planner computed an item's Status when it was
// ticked, so the app left the planner alone (the tick stays in the app, and
// nothing writes it later, even if the formula is replaced by text: ruling
// 6a). Said once per item, however often a pull retries (the note's earlier
// wording counts too). Not undoable.
var FORMULA_NOTES_ = ["The planner computes this one’s Status, so it was left alone."];
function logFormulaLeft_(id, item, by) {
  var said = "The planner worked out this one’s Status itself when it was ticked, so the app left it alone.";
  withLock_(function () {
    var seen = logRows_().some(function (r) { return cellText_(r.kind) === "planner" && cellText_(r.ref) === id && (cellText_(r.summary) === said || FORMULA_NOTES_.indexOf(cellText_(r.summary)) !== -1); });
    if (!seen) {
      appendLog_({ actor: by, via: "app" }, "note", "planner", id, said, null, null);
      bumpRev_();
    }
    return { ok: true };
  });
}

// History's note that a Booked the app wrote is still in the planner and the
// app has no record of it (round 2): a person must look. Not undoable.
function logBookedLeft_(id, item, by) {
  withLock_(function () {
    var said = "left “" + plannerCut_(item, 60) + "” marked Booked in the planner: the app couldn’t record it";
    appendLog_({ actor: by, via: "app" }, "note", "planner", id, said, null, null);
    bumpRev_();
    return { ok: true };
  });
}

// The item an action names, when the Todos tab has it and it is not gone.
function liveTodo_(args) {
  var id = idArg_(args);
  if (!id) return { env: err_("bad_input", MSG_.badId) };
  if (!todosReady_()) return { env: err_("needs_migrate", MSG_.needsMigrate) };
  var row = findRow_("Todos", id);
  if (!row || cellText_(row.gone) === "yes") return { env: err_("not_found", MSG_.noTodo) };
  return { id: id, row: row, todo: todoFromRow(row) };
}

// Saved first under the app's lock (the tick stands on its own); the
// planner write follows once the lock is let go (then_, run by dispatch_).
function tickTodo_(args, ctx) {
  var got = liveTodo_(args);
  if (got.env) return got.env;
  var cur = got.todo;
  if (cur.done) return err_("bad_input", MSG_.todoDone);
  // The connector never makes a tick (R49 M1): a tick is what reaches the planner.
  if (ctx.via === "claude") return err_("bad_input", MSG_.claudeTick);
  var patch = { ticked_by: ctx.actor, ticked_at: nowIso_(), ticked_item: cur.item };
  // The planner still holds the app's own Booked from before the undo:
  // the tick has it already, nothing to write there.
  var owed = cellText_(got.row.planner_written) === "undo";
  if (owed) {
    patch.planner_written = "yes";
    patch.status = "Booked";
  }
  var row = updateById_("Todos", got.id, patch);
  var saved = todoFromRow(row);
  var log = appendLog_(ctx, "tick", "todo", got.id, summarize("tick", "todo", todoSnap_(cur, got.row), todoSnap_(saved, row)), todoSnap_(cur, got.row), todoSnap_(saved, row));
  var env = ok_({ todo: saved, planner: owed ? "kept" : "pending", logId: log.id }, bumpRev_());
  env.then_ = owed ? function (e) { return afterOwedTick_(e, got.id, cur.item, ctx.actor); } : function (e) { return afterTick_(e, got.id, cur.item, ctx.actor); };
  return env;
}

// A tick of a row whose put-back was owed: the row already says the planner
// holds the app's Booked. That is checked, not taken on trust: a put-back can
// have gone through without the app recording it (its lock busy), and then
// the planner says the old status again. Still Booked (by anyone's hand):
// nothing written, "kept". Not Booked any more: Booked is written and
// recorded as for any tick. Can't tell (planner busy or unreadable): the
// row stays as it was saved, "kept", as before this check.
function afterOwedTick_(env, id, item, by) {
  var out = plannerTick_(id, item, by);
  if (out.result === "pending") return env;
  env.data.planner = out.result === "already" ? "kept" : settleTick_(id, item, by, out);
  return withRowNow_(env, id);
}

function afterTick_(env, id, item, by) {
  env.data.planner = settleTick_(id, item, by, plannerTick_(id, item, by));
  return withRowNow_(env, id);
}

// The reply's todo and rev as they are now, best effort: when the read
// fails the reply keeps the todo and rev of the save, and the phone's next
// look at rev brings the rest.
function withRowNow_(env, id) {
  try {
    var row = findRow_("Todos", id);
    var rev = rev_();
    if (row) env.data.todo = todoFromRow(row);
    env.rev = rev;
  } catch (e) { /* best effort */ }
  return env;
}

function claimTodo_(args, ctx) {
  if (typeof args.on !== "boolean") return err_("bad_input", MSG_.badRequest);
  var got = liveTodo_(args);
  if (got.env) return got.env;
  var cur = got.todo;
  if (args.on && cur.done) return err_("bad_input", MSG_.todoDone);
  // Security (2026-11-18): on a person's own key, nobody takes over someone
  // else's claim (it is theirs); the shared key keeps "Take it over".
  if (args.on && ctx.holder === "person" && cur.claimedBy !== "" && cur.claimedBy !== ctx.actor) return err_("bad_input", MSG_.notYourClaim);
  // On: the actor takes it, from anyone. Off: only the one on it hands it back.
  var next = args.on ? ctx.actor : "";
  if (cur.claimedBy === next || (!args.on && cur.claimedBy !== ctx.actor)) return ok_({ todo: cur, logId: null }, rev_());
  var row = updateById_("Todos", got.id, { claimed_by: next });
  var saved = todoFromRow(row);
  var action = args.on ? "claim" : "unclaim";
  var log = appendLog_(ctx, action, "todo", got.id, summarize(action, "todo", todoSnap_(cur, got.row), todoSnap_(saved, row)), todoSnap_(cur, got.row), todoSnap_(saved, row));
  return ok_({ todo: saved, logId: log.id }, bumpRev_());
}

// Undoing a tick or a claim puts back who was on it and who ticked it, under
// the app's lock. A tick the planner took is then owed back to it
// (planner_written "undo", planner_was kept, the row showing planner_was)
// and taken back out of it (outside that lock, under the planner lock, and
// never through Claude: Claude's undo leaves it to the next pull); if that
// does not go through it stays owed and a pull retries it. Undoing that
// undo ticks it again, written the same way, or, while the put-back is
// still owed, takes back the planner's Booked as it is. Names come from the
// Log row: anyone not on the trip refuses the undo. planner: "written" (the
// planner was changed back or forward), "kept" (nothing to do there, or left
// alone on purpose), "pending" (the planner may still say Booked).
function undoTodo_(entry, rows, ctx) {
  if (entry.undoneBy !== null) return err_("stale", MSG_.undone);
  if (entry.action === "takeoff") return err_("stale", MSG_.cantUndo);
  if (!canUndo(entry, rows.map(logShape_))) return err_("stale", MSG_.newer);
  if (!entry.before || !entry.after) return err_("stale", MSG_.cantUndo);
  if (!todosReady_()) return err_("needs_migrate", MSG_.needsMigrate);
  var row = findRow_("Todos", entry.ref);
  if (!row) return err_("not_found", MSG_.noTodo);
  var cur = todoFromRow(row);
  var written = cellText_(row.planner_written) === "yes";
  var owed = cellText_(row.planner_written) === "undo";
  // A true was kept aside (todoWas_) comes before the row's own.
  var keptWas = todoWas_(entry.ref);
  var was = keptWas !== null && written ? keptWas : cellText_(row.planner_was);
  var boundItem = tickedItemOf_(row);
  var target = undoTarget(entry);
  var text = function (v) { return v === undefined || v === null ? "" : v; };
  var claimedBy = text(target.claimedBy), tickedBy = text(target.tickedBy), tickedAt = text(target.tickedAt), tickedItem = text(target.tickedItem);
  var known = function (v) { return v === "" || ctx.names.indexOf(v) !== -1; };
  if (!known(claimedBy) || !known(tickedBy) || typeof tickedAt !== "string" || typeof tickedItem !== "string") return err_("stale", MSG_.cantUndo);
  // Security (2026-11-18, fix round 1): on a person's own key, and through
  // the connector (the owner's), an undo may move a claim only between
  // nobody and the one asking: never take someone else's off, never put
  // someone else on, whatever kind of entry is undone.
  var others = function (v) { return v !== "" && v !== ctx.actor; };
  if ((ctx.holder === "person" || ctx.holder === "claude") && claimedBy !== cur.claimedBy && (others(claimedBy) || others(cur.claimedBy))) return err_("bad_input", MSG_.notYourClaim);
  if (tickedBy !== "" && tickedItem === "") tickedItem = cur.item;
  var untick = cur.tickedBy !== "" && tickedBy === "";
  var retick = cur.tickedBy === "" && tickedBy !== "";
  // Nor does it put one back (R49 M1); taking one off is fine.
  if (retick && ctx.via === "claude") return err_("bad_input", MSG_.claudeRetick);
  var patch = { claimed_by: claimedBy, ticked_by: tickedBy, ticked_at: tickedAt, ticked_item: tickedBy === "" ? "" : tickedItem };
  if (untick && written) {
    patch.planner_written = "undo";
    patch.status = was;
    patch.planner_was = was;
    patch.ticked_item = boundItem;
  } else if (untick) {
    patch.planner_written = "";
    patch.planner_was = "";
  } else if (retick && owed) {
    patch.planner_written = "yes";
    patch.status = "Booked";
  }
  var savedRow = updateById_("Todos", entry.ref, patch);
  if (untick && keptWas !== null) dropTodoWas_(entry.ref);
  var saved = todoFromRow(savedRow);
  var log = appendLog_(ctx, "undo", "todo", entry.ref, "undid: " + entry.summary, todoSnap_(cur, row), todoSnap_(saved, savedRow), entry.id);
  updateById_("Log", entry.id, { undone_by: log.id });
  var shown = logShape_(log);
  shown.canUndo = true;
  var env = ok_({ entry: shown, logId: log.id, todo: saved, planner: "kept" }, bumpRev_());
  if (ctx.via === "claude") {
    if (untick && written) {
      // Still under the app's lock here: the note is written directly.
      logOwed_(entry.ref, ctx);
      env.data.planner = "pending";
      env.rev = bumpRev_();
    }
    return env;
  }
  if (untick && written) {
    env.data.planner = "pending";
    env.then_ = function (e) { return afterUntick_(e, entry.ref, boundItem, was, ctx.actor); };
  } else if (retick && owed) {
    env.then_ = function (e) { return afterOwedTick_(e, entry.ref, tickedItem, ctx.actor); };
  } else if (retick && !isBooked(saved.status)) {
    env.data.planner = "pending";
    env.then_ = function (e) { return afterTick_(e, entry.ref, tickedItem, ctx.actor); };
  }
  return env;
}

function afterUntick_(env, id, item, was, by) {
  var said = plannerUntick_(id, item, was, by);
  // Recording it is best effort: a row left owed is settled by the next pull,
  // which finds the planner put back ("kept") or puts it back itself.
  try { settleUntick_(id, said, { actor: by, via: "app" }, item); } catch (e) { /* best effort */ }
  env.data.planner = said;
  return withRowNow_(env, id);
}

// Records what came of a put-back (plannerUntick_'s answer), under the app's
// lock. Written or kept: nothing is owed any more. Pending: it stays owed. A
// row ticked again while the put-back was on its way, which the put-back
// reached: the planner no longer says Booked, so the tick is owed to it
// instead (a stuck tick, retried by a pull). noteBy (the undo's ctx; not
// for a retry): when it stays owed, History's one note says so. item: the
// text the put-back was bound to. A row ticked again meanwhile is cleared
// only when the planner's cell is not exactly Booked: a re-tick that has
// already written Booked again keeps its "yes". That cell is read once,
// under the app's lock (the one planner read made there, ruling of the
// second fix round: read before the lock, a re-tick landing during the wait
// was wiped; plannerTab_ takes no planner lock, so no lock waits on
// another). When that read fails or no longer finds the item, the row is
// left alone.
// -> "owed" | "settled" | "busy"
function settleUntick_(id, said, noteBy, item) {
  // Whether the planner's cell says exactly Booked; null: not known.
  var plannerBooked = function () {
    if (typeof item !== "string") return null;
    try {
      var found = plannerTodo_(plannerTab_(TODO_BOOK_TAB_), id, item);
      return found ? found.status === "Booked" : null;
    } catch (e) {
      return null;
    }
  };
  var out = withLock_(function () {
    var row = findRow_("Todos", id);
    var pw = row ? cellText_(row.planner_written) : "";
    if (pw === "undo" && said !== "pending") {
      updateById_("Todos", id, { ticked_item: "", planner_written: "", planner_was: "" });
      bumpRev_();
    } else if (pw === "yes" && said === "written" && plannerBooked() === false) {
      updateById_("Todos", id, { planner_written: "", planner_was: "", status: cellText_(row.planner_was) });
      bumpRev_();
    }
    var owed = pw === "undo" && said === "pending";
    if (owed && noteBy) {
      logOwed_(id, noteBy);
      bumpRev_();
    }
    return { ok: true, owed: owed };
  });
  if (!out || !out.ok) return "busy";
  return out.owed ? "owed" : "settled";
}

// History's one note that an undone tick's Booked is still in the planner
// and a pull will put it back. Not undoable. Under the app's lock (the
// caller's).
function logOwed_(id, ctx) {
  appendLog_({ actor: ctx.actor, via: ctx.via }, "note", "planner", id, "The planner still says Booked for this one; the app will put it back at the next fetch.", null, null);
}

// ---- the stamp book ----

// The two tabs live only after migrate; until then the book is empty.
function stampsReady_() {
  return hasTab_("StampDefs") && hasTab_("Stamps") && hasColumn_("StampDefs", "shape") && hasColumn_("Stamps", "gone");
}

function stampDefs_() {
  if (!stampsReady_()) return [];
  return readTable_("StampDefs").filter(function (r) { return cellText_(r.id) !== ""; }).map(stampDefFromRow);
}

// What load shows of the book: the definitions, and everyone's stamps that are
// not lifted. Both empty until migrate has made the tabs; the tabs are checked
// and read once each.
function stampBook_() {
  // Each tab is found and read once, and is ready when that read's header has the columns: no separate checks.
  // A Sheet where migrate has not been run costs one lookup.
  var defs = readTableOrNull_("StampDefs", ["id", "date", "shape"]);
  if (defs === null) return { defs: [], stamps: [] };
  var stamps = readTableOrNull_("Stamps", ["def", "who", "at", "seed", "gone"]);
  return {
    defs: defs.filter(function (r) { return cellText_(r.id) !== ""; }).map(stampDefFromRow),
    stamps: (stamps || [])
      .filter(function (r) { return cellText_(r.def) !== "" && cellText_(r.who) !== "" && cellText_(r.gone) !== "yes"; })
      .map(stampFromRow),
  };
}

var STAMP_AT_RE_ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function randomStampSeed_() {
  return 1 + Math.floor(Math.random() * 4294967295);
}

function stampDefById_(defs, id) {
  for (var i = 0; i < defs.length; i++) if (defs[i].id === id) return defs[i];
  return null;
}

// The caller presses a stamp for themselves: { def, at } (at: the time on
// their phone when they pressed, ISO; seed: optional, how the ink wore, 1 to
// 4294967295). Whether it is open is judged by `at` (Japan time) and the
// backend's own clock for how late it arrived: see pressRefusal. Pressed
// twice, it is one stamp (a resend answers the first). A lifted stamp is
// pressed again, with a new time and seed, while its window is open. Never
// through Claude. here: true when the phone was in the day's place as it
// pressed (the app decides; no position is ever sent): kept as "yes" in
// `here`, which a later press sets anew. Anything else is no mark; it never
// refuses a press, and History and undo do not carry it.
function pressStamp_(args, ctx) {
  if (ctx.via === "claude") return err_("bad_input", MSG_.claudeStamp);
  if (!stampsReady_()) return err_("needs_migrate", MSG_.needsMigrate);
  var defs = stampDefs_();
  var def = stampDefById_(defs, typeof args.def === "string" ? args.def : "");
  if (!def) return err_("no_such_stamp", MSG_.noStamp);
  if (typeof args.at !== "string" || !STAMP_AT_RE_.test(args.at) || !isFinite(Date.parse(args.at))) return err_("bad_input", MSG_.badRequest);
  var atMs = Date.parse(args.at);
  var at = new Date(atMs).toISOString();
  var id = def.id + "|" + ctx.actor;
  var row = findRow_("Stamps", id);
  if (row && cellText_(row.gone) !== "yes") return ok_({ stamp: stampFromRow(row), logId: null }, rev_());
  // The resend of a press that was lifted since (the same moment and, when
  // the phone sends one, the same seed): not a new press.
  if (row && cellStamp_(row.at) === at && (args.seed === undefined || Number(row.seed) === args.seed)) return err_("stale", MSG_.stampLifted);
  var why = pressRefusal(def, defs, atMs, Date.parse(nowIso_()));
  if (why) return err_(why, MSG_[STAMP_REFUSALS_[why]]);

  var seed = typeof args.seed === "number" && args.seed % 1 === 0 && args.seed >= 1 && args.seed <= 4294967295 ? args.seed : randomStampSeed_();
  var before = row ? stampSnap_(stampFromRow(row), def.date) : null;
  if (before && before.seed === seed) seed = seed === 4294967295 ? 1 : seed + 1;
  var here = args.here === true ? "yes" : "";
  var savedRow;
  if (row) savedRow = updateById_("Stamps", id, { at: at, seed: seed, gone: "", here: here });
  else {
    appendObj_("Stamps", { id: id, def: def.id, who: ctx.actor, at: at, seed: seed, gone: "", here: here });
    savedRow = findRow_("Stamps", id);
  }
  var saved = stampFromRow(savedRow);
  var after = stampSnap_(saved, def.date);
  var log = appendLog_(ctx, "press", "stamp", id, summarize("press", "stamp", before, after), before, after);
  return ok_({ stamp: saved, logId: log.id }, bumpRev_());
}

// Lifts a press, or (undoing a lift) puts it back as it was. Putting it back
// is a press, so it needs the stamp's window to be open now, and never comes
// through Claude. Lifting is always allowed.
function undoStamp_(entry, rows, ctx) {
  // Nobody acts on someone else's stamp (as for a picture): the Log keeps whose it is, for a press and for a lift.
  if (!entry.after || entry.after.who !== ctx.actor) return err_("bad_input", MSG_.notYourStamp);
  if (entry.undoneBy !== null) return err_("stale", MSG_.undone);
  if (!canUndo(entry, rows.map(logShape_))) return err_("stale", MSG_.newer);
  if (!entry.after) return err_("stale", MSG_.cantUndo);
  if (!stampsReady_()) return err_("needs_migrate", MSG_.needsMigrate);
  var row = findRow_("Stamps", entry.ref);
  if (!row) return err_("not_found", MSG_.noStamp);
  var cur = stampFromRow(row);
  var target = entry.before ? entry.before : { def: entry.after.def, who: entry.after.who, at: entry.after.at, seed: entry.after.seed, gone: true, day: entry.after.day };
  var lift = target.gone === true;
  if (!lift) {
    if (ctx.via === "claude") return err_("bad_input", MSG_.claudeStamp);
    var defs = stampDefs_();
    var def = stampDefById_(defs, cur.def);
    if (!def) return err_("no_such_stamp", MSG_.noStamp);
    var nowMs = Date.parse(nowIso_());
    var why = pressRefusal(def, defs, nowMs, nowMs);
    if (why) return err_(why, MSG_[STAMP_REFUSALS_[why]]);
  }
  var day = entry.after.day;
  var savedRow = updateById_("Stamps", entry.ref, { at: String(target.at), seed: Number(target.seed), gone: lift ? "yes" : "" });
  var saved = stampFromRow(savedRow);
  var log = appendLog_(ctx, "undo", "stamp", entry.ref, "undid: " + entry.summary, stampSnap_(cur, day), stampSnap_(saved, day), entry.id);
  updateById_("Log", entry.id, { undone_by: log.id });
  var shown = logShape_(log);
  shown.canUndo = true;
  return ok_({ entry: shown, logId: log.id, stamp: saved }, bumpRev_());
}

// ---- the real ticket on a stop ----
// The four facts (booking ref, name, people, seat) are stop fields, saved by
// addStop / updateStop like the others. The pictures are rows of the Tickets
// tab (no data) with their base64 in TicketData, one cell per chunk; load
// reads Tickets only. A picture is added with the phone's own id (a resend
// answers the first), its chunks written before its row, so a failure in
// between leaves chunks no row names; the next add sweeps those. Removing is
// a soft delete (gone), undoable; its data rows stay. Never through Claude.

function ticketsReady_() {
  return hasTab_("Tickets") && hasTab_("TicketData") && hasColumn_("Tickets", "gone") && hasColumn_("TicketData", "data") && hasColumn_("Stops", "tk_seat");
}

// A stop with any fact filled on a Sheet whose Stops tab lacks the columns: refused rather than dropped.
function factsNeedMigrate_(stop) {
  var any = stop.tkRef !== "" || stop.tkName !== "" || stop.tkPeople !== "" || stop.tkSeat !== "";
  return any && !hasColumn_("Stops", "tk_seat");
}

// What load shows: every picture not removed, or null before migrate. One lookup and one read.
function ticketsShown_(removedStops) {
  var rows = readTableOrNull_("Tickets", ["id", "stop", "chunks", "gone"]);
  if (rows === null) return null;
  var off = removedStops || {};
  return rows.filter(function (r) {
    return cellText_(r.id) !== "" && cellText_(r.gone) !== "yes" && !Object.prototype.hasOwnProperty.call(off, cellText_(r.stop));
  }).map(ticketFromRow);
}

// The ids of removed stops, for the limits: their pictures do not count (minor 6).
function removedStops_() {
  var out = {};
  readTable_("Stops").forEach(function (r) { if (cellText_(r.id) !== "" && cellSet_(r.deleted_at)) out[cellText_(r.id)] = true; });
  return out;
}

// Pictures that count: not removed, and not on a removed stop.
function countedTickets_(rows, removed) {
  return rows.filter(function (r) {
    return cellText_(r.id) !== "" && cellText_(r.gone) !== "yes" && !Object.prototype.hasOwnProperty.call(removed, cellText_(r.stop));
  });
}

function liveTickets_() {
  return countedTickets_(readTable_("Tickets"), removedStops_());
}

// Deletes TicketData rows whose ticket no Tickets row names (a failed add's), bottom up.
function sweepTicketChunks_(known) {
  var ids = columnValues_("TicketData", "ticket");
  var gone = [];
  for (var i = 0; i < ids.length; i++) {
    var t = cellText_(ids[i]);
    if (t === "" || !Object.prototype.hasOwnProperty.call(known, t)) gone.push(i + 2);
  }
  if (gone.length) deleteRowsAt_("TicketData", gone);
}

// { ticket: { id, stop, who, seat, page, mime, w, h, data } } -> { ticket, logId }.
function addTicket_(args, ctx) {
  if (ctx.via === "claude") return err_("bad_input", MSG_.claudeTicket);
  if (!ticketsReady_()) return err_("needs_migrate", MSG_.needsMigrate);
  // The id first (fix round 1, I5): a phone that no longer holds a picture's
  // data can still resend its add to learn whether it landed.
  var given = isObj_(args.ticket) ? args.ticket : null;
  if (!given || typeof given.id !== "string" || !ID_RE_.test(given.id)) return err_("bad_input", "That ticket picture has a bad id.");
  var all = readTable_("Tickets");
  var known = {};
  var existing = null;
  all.forEach(function (r) {
    var id = cellText_(r.id);
    if (id === "") return;
    known[id] = true;
    if (id === given.id) existing = r;
  });
  if (existing) return ok_({ ticket: ticketFromRow(existing), logId: firstLogId_("ticket", given.id, "add") }, rev_());
  if (given.data === undefined || given.data === null) return err_("not_found", MSG_.ticketNeverSent);
  var v = validateTicket(given, ctx.names);
  if (!v.ok) return err_("bad_input", v.message);
  var t = v.value;
  var stopRow = findPlanRow_(planKind_("stop"), t.stop);
  if (!stopRow || cellSet_(stopRow.deleted_at)) return err_("not_found", MSG_.noStop);
  var live = countedTickets_(all, removedStops_());
  if (live.length >= TICKET_LIMITS.perTrip) return err_("bad_input", MSG_.ticketsPerTrip);
  if (live.filter(function (r) { return cellText_(r.stop) === t.stop; }).length >= TICKET_LIMITS.perStop) return err_("bad_input", MSG_.ticketsPerStop);

  sweepTicketChunks_(known);
  var chunks = ticketChunks(t.data);
  appendObjs_("TicketData", chunks.map(function (c, i) { return { ticket: t.id, n: String(i), data: c }; }));
  appendObj_("Tickets", {
    id: t.id, stop: t.stop, who: t.who, seat: t.seat, page: String(t.page), mime: t.mime, w: String(t.w), h: String(t.h),
    size: String(t.data.length), chunks: String(chunks.length), by: ctx.actor, at: nowIso_(), gone: "",
  });
  var saved = ticketFromRow(findRow_("Tickets", t.id));
  var after = ticketSnap_(saved, cellText_(stopRow.title));
  var log = appendLog_(ctx, "add", "ticket", t.id, summarize("add", "ticket", null, after), null, after);
  return ok_({ ticket: saved, logId: log.id }, bumpRev_());
}

// { id } -> { id, mime, data }: the chunks joined in order. Refused for a removed or unknown one.
function ticket_(args) {
  if (!ticketsReady_()) return err_("needs_migrate", MSG_.needsMigrate);
  var id = idArg_(args);
  if (!id) return err_("bad_input", MSG_.badId);
  var row = findRow_("Tickets", id);
  if (!row || cellText_(row.gone) === "yes") return err_("not_found", MSG_.noTicket);
  var t = ticketFromRow(row);
  var ids = columnValues_("TicketData", "ticket");
  var at = [];
  for (var i = 0; i < ids.length; i++) if (cellText_(ids[i]) === id) at.push(i + 2);
  var ns = cellsAt_("TicketData", "n", at);
  var parts = cellsAt_("TicketData", "data", at);
  var cells = at.map(function (r, k) { return { n: ns[k], data: parts[k] }; });
  var data = joinTicketChunks(cells, t.chunks, t.size);
  if (data === null) return err_("not_found", MSG_.noTicket);
  return ok_({ id: id, mime: t.mime, data: data }, rev_());
}

function stopTitle_(stopId) {
  var row = findPlanRow_(planKind_("stop"), stopId);
  return row ? cellText_(row.title) : "";
}

function removeTicket_(args, ctx) {
  if (ctx.via === "claude") return err_("bad_input", MSG_.claudeTicket);
  if (!ticketsReady_()) return err_("needs_migrate", MSG_.needsMigrate);
  var id = idArg_(args);
  if (!id) return err_("bad_input", MSG_.badId);
  var row = findRow_("Tickets", id);
  if (!row) return err_("not_found", MSG_.noTicket);
  var cur = ticketFromRow(row);
  if (cur.gone) return ok_({ ticket: cur, logId: null }, rev_());
  var saved = ticketFromRow(updateById_("Tickets", id, { gone: "yes" }));
  var title = stopTitle_(cur.stop);
  var log = appendLog_(ctx, "remove", "ticket", id, summarize("remove", "ticket", ticketSnap_(cur, title), ticketSnap_(saved, title)), ticketSnap_(cur, title), ticketSnap_(saved, title));
  return ok_({ ticket: saved, logId: log.id }, bumpRev_());
}

// Undoing an add or a remove (or an undo) puts the picture where the entry
// found it: removed, or back. Coming back, it still has to fit on its stop.
function undoTicket_(entry, rows, ctx) {
  if (ctx.via === "claude") return err_("bad_input", MSG_.claudeTicket);
  if (entry.undoneBy !== null) return err_("stale", MSG_.undone);
  if (!canUndo(entry, rows.map(logShape_))) return err_("stale", MSG_.newer);
  if (!entry.after) return err_("stale", MSG_.cantUndo);
  if (!ticketsReady_()) return err_("needs_migrate", MSG_.needsMigrate);
  var row = findRow_("Tickets", entry.ref);
  if (!row) return err_("not_found", MSG_.noTicket);
  var cur = ticketFromRow(row);
  var gone = entry.before ? entry.before.gone === true : true;
  if (!gone && cur.gone) {
    var others = liveTickets_();
    if (others.length >= TICKET_LIMITS.perTrip) return err_("bad_input", MSG_.ticketsPerTrip);
    if (others.filter(function (r) { return cellText_(r.stop) === cur.stop; }).length >= TICKET_LIMITS.perStop) return err_("bad_input", MSG_.ticketsPerStop);
  }
  var saved = ticketFromRow(updateById_("Tickets", entry.ref, { gone: gone ? "yes" : "" }));
  var title = stopTitle_(cur.stop) || cellText_(entry.after.stopTitle);
  var log = appendLog_(ctx, "undo", "ticket", entry.ref, "undid: " + entry.summary, ticketSnap_(cur, title), ticketSnap_(saved, title), entry.id);
  updateById_("Log", entry.id, { undone_by: log.id });
  var shown = logShape_(log);
  shown.canUndo = true;
  return ok_({ entry: shown, logId: log.id, ticket: saved }, bumpRev_());
}

// ---- undo ----

// Whether a logged change moved an item's coordinates (both sides known and different).
function movedCoords_(entry) {
  var b = entry.before, a = entry.after;
  if (!b || !a || b.lat === undefined || a.lat === undefined) return false;
  return b.lat !== a.lat || b.lng !== a.lng;
}

function undo_(args, ctx) {
  var raw = args.logId;
  var logId = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!isFinite(logId)) return err_("bad_input", MSG_.badLogId);
  var rows = logRows_();
  var row = null;
  for (var i = 0; i < rows.length; i++) if (Number(rows[i].id) === logId) { row = rows[i]; break; }
  if (!row) return err_("not_found", MSG_.noLog);

  var entry = parseLogRow(row);
  if (entry.kind === "picture") return undoPicture_(entry, rows, ctx);
  if (entry.kind === "todo") return undoTodo_(entry, rows, ctx);
  if (entry.kind === "stamp") return undoStamp_(entry, rows, ctx);
  if (entry.kind === "ticket") return undoTicket_(entry, rows, ctx);
  var plan = planKind_(entry.kind);
  if (entry.kind !== "expense" && entry.kind !== "payment" && !plan) return err_("stale", MSG_.cantUndo);
  if (entry.undoneBy !== null) return err_("stale", MSG_.undone);
  if (!canUndo(entry, rows.map(logShape_))) return err_("stale", MSG_.newer);
  if (!entry.before && !entry.after) return err_("stale", MSG_.cantUndo);

  var isExpense = entry.kind === "expense";
  var tab = isExpense ? "Expenses" : "Settlements";
  var curRow = plan ? findPlanRow_(plan, entry.ref) : findRow_(tab, entry.ref);
  if (!curRow) return err_("not_found", plan ? plan.missing : isExpense ? MSG_.noExpense : MSG_.noPayment);
  var target = undoTarget(entry);
  var cur, patch, saved;
  // Every editable column plus deleted_at / removed_at; never rate, added_by/at or stamped_by/at.
  // An item that is already marked keeps its original timestamp (undefined is not written).
  // A plan item writes back every field that differs from now, blanks included.
  if (plan) {
    cur = plan.fromRow(curRow);
    patch = changedCols_(plan, cur, target);
    // Coordinates are written back only when that change itself moved them:
    // an older entry (or one from before locate ran) must not wipe them.
    if (!movedCoords_(entry)) {
      delete patch.lat;
      delete patch.lng;
      // But a restored place, address or city is not where the coordinates now
      // are (locate may have found the new one since): clear them so locate asks again.
      var posCols = { stop: ["place"], stay: ["address_jp", "place"], day: ["city"] }[entry.kind] || [];
      if (posCols.some(function (c) { return patch[c] !== undefined; })) {
        patch.lat = "";
        patch.lng = "";
      }
    }
    if (plan.deletable) patch.deleted_at = target.deleted ? (cur.deleted ? undefined : nowIso_()) : "";
    saved = writePlan_(plan, entry.ref, patch);
  } else if (isExpense) {
    cur = expenseFromRow(curRow);
    patch = expenseToRow(editableOf_(target));
    patch.deleted_at = target.deleted ? (cur.deleted ? undefined : nowIso_()) : "";
    saved = expenseFromRow(updateById_(tab, entry.ref, patch));
  } else {
    cur = paymentFromRow(curRow);
    patch = paymentToRow(paymentEditableOf_(target));
    patch.removed_at = target.removed ? (cur.removed ? undefined : nowIso_()) : "";
    saved = paymentFromRow(updateById_(tab, entry.ref, patch));
  }

  var log = appendLog_(ctx, "undo", entry.kind, entry.ref, "undid: " + entry.summary, entry.after || cur, saved, entry.id);
  updateById_("Log", entry.id, { undone_by: log.id });
  var rev = bumpRev_();
  var shown = logShape_(log);
  shown.canUndo = true;
  var data = { entry: shown, logId: log.id };
  data[entry.kind] = saved;
  return ok_(data, rev);
}
