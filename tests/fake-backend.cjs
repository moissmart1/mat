// The real backend in memory. createFakeBackend(seed, { clock }) evaluates the
// actual backend/Pure.js, Actions.js, Money.js and Mcp.js source over
// in-memory versions of the storage primitives they use, so tests exercise
// the real action and connector code. The in-memory sheet helpers mirror backend/Sheets.js: same sanitising
// on write, only patched columns written, same return values, and cells read
// back the way Sheets hands them back (a stored "'=x" reads as "=x").
//
// seed = { expenses?, payments?, people?, days?, stops?, stays?, planner?,
// plannerId? } (see constraints R6). planner: the planner sheet's Payments tab
// as rows (row 1 its column names; null: the planner has no Payments tab);
// plannerId: PLANNER_ID in Script Properties; paymentProblems: { at, list, more }, kept as PAYMENT_PROBLEMS; todoProblems: the same, kept as TODO_PROBLEMS; missingColumns: ["Tab.column", ...]
// an older Sheet lacks until migrate (ensureColumns_) adds them; missingTabs:
// ["Tab", ...] an older Sheet lacks altogether until migrate adds them;
// trip: { key: value } patches to the Trip tab (start: "2026-12-09"); daysBefore:
// Days rows in the Sheet's column names put above the seeded days, in order
// (the 12-day trip of tests/fixtures/dec9.json);
// plannerTabs: { "Book Now": rows, "Change Log": rows } the planner's other
// tabs, as Sheets hands them back from A1 (a tab left out is not there).
// stops and stays are arrays in API shape (deleted: true marks
// one deleted), each logged as added by Mo; days is a per-date patch in the
// Sheet's own column names.
// The returned function takes a request body and resolves to the envelope.
// Options: clock (() => ISO string); test-only: lockFails (() => boolean;
// each true is a busy lock that made the caller wait 8 s: fake.lockWaitedMs()),
// keepsApostrophe (Sheets hands back a text cell's leading ' verbatim).
// Test handles: fake.tables (live rows per tab), fake.requests (every body
// received, including those the connector hands to handle_), fake.mcp(msg,
// params) (the Claude connector: mcp_, as doPost calls it for a JSON-RPC body),
// fake.beforeConnectorWrite (test-only: set it to run code just before a
// request the connector makes reaches handle_), fake.primitives (the in-memory helpers), fake.props (Script
// Properties), fake.propReads (every Script Properties key read, in order),
// fake.setRate(rate, source) (today's rate and where it came from: "live",
// "last" or "fallback"; default 111, "live"), fake.planner ({ rows, fails,
// reads }: the planner's Payments tab; fails makes reading it throw, with the
// planner's id in the error's text; reads counts the reads; also tabs (the
// other tabs by name, which its writes change as Sheets would), writes (every
// write the planner received, in order: { kind: "cell", tab, cell, value } or
// { kind: "append", tab, headerRow, values }), cellFails and appendFails (make
// that kind of write throw, received as nothing; cellFails may also be a
// function (cell, value) => boolean), lockFails (the planner lock
// can't be had), calls (every planner read or write, in order: { op, tab,
// appLock, plannerLock }: whether the app's lock and the planner lock were
// held at that moment), between (test-only: a function run once, just
// before the planner lock is taken: another hand editing the planner),
// formulas and spilled ({ tab: { cell: ... } }: cells the planner computes,
// by a formula in the cell or one spilled into it) and formulaFails (the
// computed check's read fails)),
// fake.desk ({ answer(payload) -> object | null | throws, calls }: the ticket
// shelf, the newsletter desk as deskPost_ reaches it; calls lists each payload
// it was sent, key included; set: TICKET_DESK_URL and TICKET_DESK_KEY present,
// from seed.desk === true), fake.cache (the script cache: { key: value }),
// fake.tableReads
// (readTable_ calls per tab), fake.geocoder ({ answer(query, region) }: the
// stand-in for Apps Script's geocoder; default finds nothing).

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const BACKEND = path.join(__dirname, "..", "backend");
const script = (name) => new vm.Script(fs.readFileSync(path.join(BACKEND, name), "utf8"), { filename: path.join(BACKEND, name) });
const PURE = script("Pure.js");
const ACTIONS = script("Actions.js");
const MONEY = script("Money.js");
const MCP = script("Mcp.js");
const KEYS = script("Keys.js");
const SETUP = script("Setup.js");

const TRIP_KEY = "test-key";
// The release check's key in tests (the real one lives outside the repo):
// the fake's CHECK_KEY_HASH is this key's hash, not CheckKey.js's.
const CHECK_KEY = "test-check-key";
const sha256 = (t) => crypto.createHash("sha256").update(String(t), "utf8").digest("hex");
const CLAUDE_TOKEN = "claude-token";
const RATE = 111;
const SHEET_URL = "https://example.test/sheet";

const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// What Sheets hands back for a stored cell under setup()'s formatting (see
// isTextColumn in Pure.js). Which way Sheets treats a leading apostrophe in a
// plain-text cell is not yet verified, so both are modelled: by default it is
// the "treat as text" marker and is dropped; with keepsApostrophe a text cell
// hands it back verbatim. (rowToObj then undoes the escape either way.)
// A plain-text column gives back a string even when a number or boolean was
// written; any other column turns a string that looks like a number or
// TRUE/FALSE into a number or boolean.
function readCell(text, v, keepsApostrophe) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" && v.charAt(0) === "'") return text && keepsApostrophe ? v : v.slice(1);
  if (text) {
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    return String(v);
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (/^(true|false)$/i.test(t)) return t.toUpperCase() === "TRUE";
  }
  return v;
}

// "YYYY-MM-DD" at this ISO instant in the zone tz.
function dayIn(iso, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function createFakeBackend(seed, { clock, lockFails, keepsApostrophe = false } = {}) {
  const now = clock || (() => new Date().toISOString());
  const world = vm.createContext({});
  PURE.runInContext(world);
  const P = world;

  const tables = {};
  for (const tab of Object.keys(P.TABS)) tables[tab] = [];
  // Seeded Log rows are not writes, so REV starts at 0 even when seeded (an
  // unset REV would otherwise fall back to the Log's highest id).
  const props = { TRIP_KEY, CLAUDE_TOKEN, REV: "0" };
  if (seed && seed.plannerId) props.PLANNER_ID = seed.plannerId;
  // paymentsPulledAt: when the planner's payments were last pulled (as if a phone just had).
  if (seed && seed.paymentsPulledAt) props.PAYMENTS_PULLED_AT = seed.paymentsPulledAt;
  // paymentProblems: the last pull's list as load hands it back ({ at, list, more }).
  if (seed && seed.paymentProblems) props.PAYMENT_PROBLEMS = JSON.stringify(seed.paymentProblems);
  // todoProblems: the last Book Now pull's list as load hands it back ({ at, list, more }).
  if (seed && seed.todoProblems) props.TODO_PROBLEMS = JSON.stringify(seed.todoProblems);
  const planner = {
    rows: seed && seed.planner !== undefined ? copy(seed.planner) : [], fails: false, reads: 0,
    tabs: copy((seed && seed.plannerTabs) || {}), writes: [], cellFails: false, appendFails: false,
    lockFails: false, calls: [], between: null, formulas: {}, spilled: {}, formulaFails: false,
  };
  const held = { app: false, planner: false };
  const plannerCall = (op, tab, cell) => planner.calls.push({ op, tab, ...(cell ? { cell } : {}), appLock: held.app, plannerLock: held.planner });
  const missing = new Set((seed && seed.missingColumns) || []);
  const missingTabs = new Set((seed && seed.missingTabs) || []);
  const tableReads = {};
  const sheetCalls = { hasTab: 0, hasColumn: 0, orNull: 0 };
  const propReads = [];
  const rate = { rate: RATE, source: "live" };
  const cache = {}; // the script cache, for the trip key
  let lockWaited = 0; // ms the in-memory lock has made callers wait
  // The stand-in geocoder (Env.js geocode_): answer(query, region) -> { lat, lng } | null, or throws.
  const geocoder = { answer: () => null };
  // The ticket shelf (Env.js deskPost_): answer(payload) stands in for the desk's web app.
  const desk = { answer: () => null, calls: [] };
  if (seed && seed.desk) {
    props.TICKET_DESK_URL = "https://script.google.com/macros/s/desk-invented/exec";
    props.TICKET_DESK_KEY = "desk-key-invented-" + "5".repeat(46);
  }
  const scriptCache = {};
  // The owner's run log (Logger.log) and the executions log (console.error).
  const logged = [];
  const consoleLines = [];

  const headers = (tab) => {
    const h = P.TABS[tab];
    if (!h || missingTabs.has(tab)) throw new Error("Missing tab: " + tab + ". Run setup().");
    return h.filter((col) => !missing.has(tab + "." + col));
  };
  const cellOut = (tab, h, v) => readCell(P.isTextColumn(tab, h), v, keepsApostrophe);
  // Same path as the real readTable_: cells as Sheets hands them back, then rowToObj.
  const readRow = (tab, stored) => {
    const h = headers(tab);
    return P.rowToObj(h, h.map((col) => cellOut(tab, col, stored[col])));
  };

  const primitives = {
    readTable_(tab) {
      headers(tab);
      tableReads[tab] = (tableReads[tab] || 0) + 1;
      return tables[tab].map((r) => readRow(tab, r));
    },
    appendObj_(tab, obj, readBack) {
      const h = headers(tab);
      const cells = P.objToRow(h, obj);
      const stored = {};
      h.forEach((col, i) => { stored[col] = cells[i]; });
      tables[tab].push(stored);
      if (readBack) return readRow(tab, stored);
    },
    updateWhere_(tab, column, value, patch) {
      if (value === "" || value === null || value === undefined) return null;
      const h = headers(tab);
      if (h.indexOf(column) === -1) return null;
      for (const stored of tables[tab]) {
        if (P.cellDate_(P.unsanitizeCell(cellOut(tab, column, stored[column]))) !== String(value)) continue;
        for (const key of Object.keys(patch)) {
          if (h.indexOf(key) === -1 || patch[key] === undefined) continue;
          stored[key] = patch[key] === null ? "" : P.sanitizeCell(patch[key]);
        }
        return readRow(tab, stored);
      }
      return null;
    },
    updateById_(tab, id, patch) {
      return primitives.updateWhere_(tab, "id", id, patch);
    },
    // Same as Sheets.js: rows written below the last as one block.
    appendObjs_(tab, objs) {
      for (const obj of objs) primitives.appendObj_(tab, obj);
    },
    // Same as Sheets.js: one column's cells from row 2 down, as Sheets hands them back.
    columnValues_(tab, column) {
      const h = headers(tab);
      if (h.indexOf(column) === -1) return [];
      return tables[tab].map((r) => readRow(tab, r)[column]);
    },
    // Same as Sheets.js: one column's cells in the given sheet rows (2 is the first row under the header).
    cellsAt_(tab, column, rowNums) {
      headers(tab);
      return rowNums.map((n) => (tables[tab][n - 2] ? readRow(tab, tables[tab][n - 2])[column] : ""));
    },
    // Same as Sheets.js: deletes those sheet rows.
    deleteRowsAt_(tab, rowNums) {
      headers(tab);
      for (const n of [...rowNums].sort((x, y) => y - x)) tables[tab].splice(n - 2, 1);
    },
    // Adds the tabs and columns an older Sheet lacked (seed.missingTabs and
    // seed.missingColumns), in TABS order, a new tab's columns one by one.
    ensureColumns_() {
      const added = [];
      for (const tab of Object.keys(P.TABS)) for (const col of P.TABS[tab]) if (missingTabs.has(tab) || missing.has(tab + "." + col)) added.push(tab + "." + col);
      missing.clear();
      missingTabs.clear();
      return added;
    },
    hasColumn_(tab, col) {
      sheetCalls.hasColumn++;
      return headers(tab).indexOf(col) !== -1;
    },
    hasTab_(tab) {
      sheetCalls.hasTab++;
      return Boolean(P.TABS[tab]) && !missingTabs.has(tab);
    },
    // Same as Sheets.js: one lookup and one read of a tab, null when it is missing or lacks a column.
    readTableOrNull_(tab, columns) {
      sheetCalls.orNull++;
      if (!P.TABS[tab] || missingTabs.has(tab)) return null;
      const h = headers(tab);
      if (columns.some((c) => h.indexOf(c) === -1)) return null;
      tableReads[tab] = (tableReads[tab] || 0) + 1;
      return tables[tab].map((r) => readRow(tab, r));
    },
    getProp_(key) {
      propReads.push(key);
      return Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null;
    },
    // Same as Env.js: the cached key, Script Properties only on a miss.
    tripKey_() {
      if (cache.TRIP_KEY) return cache.TRIP_KEY;
      const key = Object.prototype.hasOwnProperty.call(props, "TRIP_KEY") ? props.TRIP_KEY : null;
      if (key) cache.TRIP_KEY = key;
      return key;
    },
    setProp_(key, value) {
      props[key] = String(value);
    },
    delProp_(key) {
      delete props[key];
    },
    // Test-only: lockFails() returning true plays a lock that never frees up
    // (same envelope as Env.js withLock_).
    // A lock that is not freed waits its 8 seconds first (lockWaited), as
    // tryLock(8000) does, so the connector's retry timing can be tested.
    withLock_(fn) {
      if (lockFails && lockFails()) {
        lockWaited += 8000;
        return { ok: false, error: "busy", message: "Someone else is saving right now. Try again in a moment." };
      }
      const was = held.app;
      held.app = true;
      try {
        return fn();
      } finally {
        held.app = was;
      }
    },
    // Same as Env.js: the planner lock, a different lock; null when busy.
    withPlannerLock_(fn) {
      if (typeof planner.between === "function") {
        const f = planner.between;
        planner.between = null;
        f();
      }
      if (planner.lockFails) return null;
      const was = held.planner;
      held.planner = true;
      try {
        return fn();
      } finally {
        held.planner = was;
      }
    },
    geocode_: (q, region) => geocoder.answer(q, region),
    // Same as Env.js: null when the desk is not set up or its answer is not an object; never throws.
    deskPost_(payload) {
      if (!props.TICKET_DESK_URL || !props.TICKET_DESK_KEY) return null;
      const body = { ...copy(payload), k: props.TICKET_DESK_KEY };
      desk.calls.push(copy(body));
      try {
        const got = desk.answer(copy(body));
        return got && typeof got === "object" ? copy(got) : null;
      } catch {
        return null;
      }
    },
    deskReady_: () => !!props.TICKET_DESK_URL && !!props.TICKET_DESK_KEY,
    cacheGet_: (key) => (Object.prototype.hasOwnProperty.call(scriptCache, key) ? scriptCache[key] : null),
    cachePut_(key, value) {
      scriptCache[key] = String(value);
    },
    clockMs_: () => Date.now() + lockWaited,
    getRate_: () => rate.rate,
    getRateInfo_: () => ({ rate: rate.rate, source: rate.source }),
    nowIso_: () => now(),
    sheetUrl_: () => SHEET_URL,
    // Same as Env.js: 20 letters and digits, starting with a letter.
    newId_: () => "m" + crypto.randomBytes(16).toString("hex").slice(0, 19),
    // Today in the Trip tab's zone, by this backend's clock.
    today_: () => dayIn(now(), world.tripInfo_().tz || "Asia/Tokyo"),
    claudeToken_: () => (Object.prototype.hasOwnProperty.call(props, "CLAUDE_TOKEN") && props.CLAUDE_TOKEN) || null,
    ensureClaudeToken_() {
      if (!primitives.claudeToken_()) props.CLAUDE_TOKEN = crypto.randomBytes(16).toString("hex");
    },
    // Same as Env.js: PLANNER_ID, and the planner's Payments tab as the
    // Sheets API hands it back. Reading throws when it cannot read.
    plannerId_: () => (Object.prototype.hasOwnProperty.call(props, "PLANNER_ID") && props.PLANNER_ID) || null,
    // Same as Env.js: SHA-256 in hex, a new 64-hex personal key, and the
    // cached shared key forgotten.
    sha256Hex_: (t) => sha256(t),
    newPersonKey_: () => crypto.randomBytes(32).toString("hex"),
    forgetTripKey_() {
      delete cache.TRIP_KEY;
    },
    plannerRows_() {
      plannerCall("read", "Payments");
      planner.reads++;
      if (planner.fails) throw new Error("boom: Requested entity was not found: " + props.PLANNER_ID);
      return planner.rows === null ? null : copy(planner.rows);
    },
    // Same as Env.js: another planner tab from A1, null when it is not there.
    plannerTab_(tab) {
      plannerCall("read", tab);
      planner.reads++;
      if (planner.fails) throw new Error("boom: Requested entity was not found: " + props.PLANNER_ID);
      return Object.prototype.hasOwnProperty.call(planner.tabs, tab) ? copy(planner.tabs[tab]) : null;
    },
    // Same as Env.js: one cell ("E4") of a planner tab, written as given (RAW).
    plannerSetCell_(tab, cell, value) {
      plannerCall("cell", tab, cell);
      const fails = typeof planner.cellFails === "function" ? planner.cellFails(cell, value) : planner.cellFails;
      if (fails || !planner.tabs[tab]) throw new Error("boom: The caller does not have permission " + props.PLANNER_ID);
      const m = /^([A-Z]+)(\d+)$/.exec(cell);
      if (!m) throw new Error("bad cell " + cell);
      const col = m[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const rows = planner.tabs[tab];
      const r = Number(m[2]) - 1;
      while (rows.length <= r) rows.push([]);
      while (rows[r].length <= col) rows[r].push("");
      rows[r][col] = value;
      // A plain value entered in the cell replaces any formula it held, as Sheets does.
      if (planner.formulas[tab]) delete planner.formulas[tab][cell];
      planner.writes.push({ kind: "cell", tab, cell, value: copy(value) });
    },
    // Same as Env.js: whether the planner computes a cell (row: the sheet's
    // row number, col: 0-based): a formula in it (planner.formulas[tab][cell]
    // = "=..."), or a value spilled into it by an array formula placed
    // elsewhere (planner.spilled[tab][cell] = true). A read that fails is
    // unknown (null), as in Env.js: the app then writes nothing and retries.
    plannerCellComputed_(tab, row, col) {
      const cell = P.colLetter(col) + row;
      plannerCall("formula", tab, cell);
      if (planner.fails || planner.formulaFails) return null;
      return Boolean((planner.formulas[tab] || {})[cell]) || Boolean((planner.spilled[tab] || {})[cell]);
    },
    // Same as Env.js: one row appended under the table whose header is
    // headerRow, as Sheets' own append with INSERT_ROWS does: a new row just
    // after the table's first run of filled rows below the header (so a blank
    // gap inside the sheet attracts it), inserted, never written over a row.
    // Like Sheets, it writes from the first non-empty cell of the header row
    // inside the given range, whatever column the range starts at.
    plannerAppendRow_(tab, headerRow, firstCol, values) {
      plannerCall("append", tab);
      if (planner.appendFails || !planner.tabs[tab]) throw new Error("boom: The caller does not have permission " + props.PLANNER_ID);
      const rows = planner.tabs[tab];
      let at = headerRow + 1;
      while (at <= rows.length && rows[at - 1] && rows[at - 1].some((c) => c !== "")) at++;
      while (rows.length < at - 1) rows.push([]);
      const head = rows[headerRow - 1] || [];
      let start = firstCol;
      while (start <= firstCol + values.length - 1 && (head[start] === undefined || head[start] === "")) start++;
      if (start > firstCol + values.length - 1) start = firstCol;
      rows.splice(at - 1, 0, new Array(start).fill("").concat(copy(values)));
      planner.writes.push({ kind: "append", tab, headerRow, values: copy(values) });
    },
    // Same as Env.js: now in Toronto, "YYYY-MM-DD HH:MM ET", by this backend's clock.
    torontoNow_() {
      const parts = {};
      for (const p of new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now()))) parts[p.type] = p.value;
      return parts.year + "-" + parts.month + "-" + parts.day + " " + parts.hour + ":" + parts.minute + " ET";
    },
  };
  Object.assign(world, primitives);
  world.CHECK_KEY_HASH = sha256(CHECK_KEY);
  world.Logger = { log: (t) => logged.push(String(t)) };
  world.console = { error: (t) => consoleLines.push(String(t)), log: (t) => consoleLines.push(String(t)), warn: (t) => consoleLines.push(String(t)) };
  KEYS.runInContext(world);
  SETUP.runInContext(world);
  ACTIONS.runInContext(world);
  MONEY.runInContext(world);
  MCP.runInContext(world);
  // A request the connector hands to handle_ is recorded like one from a phone.
  const handle = world.handle_;

  seedWorld(P, primitives, tables, props, seed || {}, now);

  const requests = [];
  const fake = (request) => {
    const body = copy(request);
    requests.push(copy(body));
    let env;
    try {
      env = handle(body);
    } catch (e) {
      // Same as doPost's last-resort catch.
      env = { ok: false, error: "server", message: "Something went wrong on our side. Try again." };
    }
    return Promise.resolve(copy(env));
  };
  // The connector reaches the actions through handleAs_ with the holder
  // { kind: "claude" } (never with a key): such a request is recorded like
  // one from a phone, as { via: "claude", actor, action, args, holder }.
  const handleAs = world.handleAs_;
  world.handleAs_ = (holder, body) => {
    if (holder && holder.kind === "claude") {
      const seen = { holder: "claude", actor: holder.name, via: "claude", action: body.action, args: copy(body.args) };
      requests.push(copy(seen));
      // Test-only: fake.beforeConnectorWrite(body) runs between whatever the
      // connector did first and its request reaching the actions (another
      // phone's write landing in that gap).
      if (typeof fake.beforeConnectorWrite === "function") fake.beforeConnectorWrite(copy(seen));
    }
    return handleAs(holder, body);
  };
  // Test-only: a request through the connector's own path (handleAs_ as the
  // holder { kind: "claude" }, as Mcp.js makes it after its token check),
  // as `actor` (default the trip's first person). A phone's via: "claude" is
  // ignored by the backend (fix round 1).
  fake.claude = (action, args = {}, actor) => Promise.resolve(copy(world.handleAs_({ kind: "claude", name: actor || world.peopleNames_()[0] }, { action, args: copy(args) })));
  fake.mcp = (msg, params) => copy(world.mcp_(copy(msg), copy(params)));
  fake.tables = tables;
  fake.requests = requests;
  fake.primitives = primitives;
  fake.geocoder = geocoder;
  fake.world = world; // test-only: replace a helper (e.g. make updateById_ throw)
  fake.lockWaitedMs = () => lockWaited;
  // Test-only: what the Plan 1 backend (0a66cbd) answered to load, for a
  // phone still holding that cache: days, stops and stays as plainRow_ made
  // them (the Sheet's columns camel-cased, a Date cell as its date, an empty
  // cell ""; stops with deletedAt and no deleted; stays with no deleted_at
  // column yet), and the rest as now.
  fake.plan1Load = async () => {
    const env = await fake({ key: TRIP_KEY, action: "load", args: {} });
    requests.pop();
    const camel = (k) => k.replace(/_([a-z])/g, (m, c) => c.toUpperCase());
    const plain = (o, drop = []) => {
      const out = {};
      for (const k of Object.keys(o)) {
        if (drop.includes(k)) continue;
        const v = o[k];
        out[camel(k)] = v instanceof Date ? P.cellDate_(v) : v === null || v === undefined ? "" : v;
      }
      return out;
    };
    const rows = (tab) => primitives.readTable_(tab).filter((r) => String(r[tab === "Days" ? "date" : "id"] || "") !== "");
    return {
      rev: env.rev,
      data: {
        ...env.data,
        days: rows("Days").map((r) => plain(r)),
        stops: rows("Stops").map((r) => plain(r)),
        stays: rows("Stays").map((r) => plain(r, ["deleted_at"])),
      },
    };
  };
  fake.props = props;
  fake.logged = logged;
  fake.consoleLines = consoleLines;
  // Test-only: gives person `name` a personal key (as issueLinks would) and
  // returns it; PERSON_KEYS holds only its hash.
  fake.personKey = (name) => {
    const key = crypto.randomBytes(32).toString("hex");
    const keys = world.personKeys_();
    keys[name] = { hash: sha256(key), at: now() };
    world.setPersonKeys_(keys);
    return key;
  };
  fake.CHECK_KEY = CHECK_KEY;
  fake.planner = planner;
  fake.desk = desk;
  fake.cache = scriptCache;
  fake.tableReads = tableReads;
  fake.sheetCalls = sheetCalls;
  fake.propReads = propReads;
  fake.setRate = (r, source) => {
    rate.rate = r;
    rate.source = source;
  };
  return fake;
}

// Writes what setup() writes, then the seed's patches, items and Log rows.
// Not routed through handle_ (it must be able to set addedAt and the like),
// but every row goes through the same converters and sheet helpers.
function seedWorld(P, prim, tables, props, seed, now) {
  const rows = P.setupSeedRows();
  // daysBefore: Days rows (the Sheet's column names) above the seeded Dec 10 row, in order.
  for (const o of seed.daysBefore || []) prim.appendObj_("Days", o);
  for (const tab of ["Trip", "People", "Days"]) for (const o of rows[tab]) prim.appendObj_(tab, o);
  for (const [key, value] of Object.entries(seed.trip || {})) prim.updateWhere_("Trip", "key", key, { value });
  for (const [name, patch] of Object.entries(seed.people || {})) prim.updateWhere_("People", "name", name, patch);
  for (const [date, patch] of Object.entries(seed.days || {})) prim.updateWhere_("Days", "date", date, patch);

  const lastRow = (tab) => prim.readTable_(tab)[tables[tab].length - 1];
  const events = [];

  for (const given of seed.expenses || []) {
    const e = { rate: RATE, splitMode: "equal", splitVals: [], note: "", kind: "", deleted: false, ...copy(given) };
    if (e.addedBy === undefined) e.addedBy = e.paidBy;
    if (e.addedAt === undefined) e.addedAt = now();
    const row = P.expenseToRow(e);
    row.added_at = e.addedAt;
    if (e.deleted) row.deleted_at = e.addedAt;
    prim.appendObj_("Expenses", row);
    const saved = P.expenseFromRow(lastRow("Expenses"));
    const live = { ...saved, deleted: false };
    const base = { at: e.addedAt, who: e.addedBy, kind: "expense", ref: saved.id };
    events.push({ ...base, action: "add", summary: P.summarize("add", "expense", null, live), before: null, after: live });
    if (saved.deleted) events.push({ ...base, action: "delete", summary: P.summarize("delete", "expense", live, saved), before: live, after: saved });
  }

  for (const given of seed.payments || []) {
    const p = { seed: 1, rot: 0, removed: false, ...copy(given) };
    if (p.stampedBy === undefined) p.stampedBy = p.from;
    if (p.stampedAt === undefined) p.stampedAt = now();
    const row = P.paymentToRow(p);
    row.stamped_at = p.stampedAt;
    if (p.removed) row.removed_at = p.stampedAt;
    prim.appendObj_("Settlements", row);
    const saved = P.paymentFromRow(lastRow("Settlements"));
    const live = { ...saved, removed: false };
    const base = { at: p.stampedAt, who: p.stampedBy, kind: "payment", ref: saved.id };
    events.push({ ...base, action: "stamp", summary: P.summarize("stamp", "payment", null, live), before: null, after: live });
    if (saved.removed) events.push({ ...base, action: "unstamp", summary: P.summarize("unstamp", "payment", live, saved), before: live, after: saved });
  }

  for (const kind of ["stop", "stay"]) {
    const tab = kind === "stop" ? "Stops" : "Stays";
    const toRow = kind === "stop" ? P.stopToRow : P.stayToRow;
    const fromRow = kind === "stop" ? P.stopFromRow : P.stayFromRow;
    for (const given of seed[kind + "s"] || []) {
      const at = now();
      const row = toRow(given);
      row.deleted_at = given.deleted ? at : "";
      prim.appendObj_(tab, row);
      const saved = fromRow(lastRow(tab));
      const live = { ...saved, deleted: false };
      const base = { at, who: "Mo", kind, ref: saved.id };
      events.push({ ...base, action: "add", summary: P.summarize("add", kind, null, live), before: null, after: live });
      if (saved.deleted) events.push({ ...base, action: "delete", summary: P.summarize("delete", kind, live, saved), before: live, after: saved });
    }
  }

  // Log ids follow time order (a stable sort keeps each add before its delete).
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  events.forEach((ev, i) => {
    prim.appendObj_("Log", {
      id: i + 1, at: ev.at, who: ev.who, via: "app", action: ev.action, kind: ev.kind, ref: ev.ref, summary: ev.summary,
      before: ev.before ? JSON.stringify(ev.before) : "", after: JSON.stringify(ev.after), undoes: "", undone_by: "",
    });
  });
  if (events.length) props.LOGSEQ = String(events.length);
}

module.exports = { createFakeBackend, CHECK_KEY, sha256 };
