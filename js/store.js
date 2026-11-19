/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The app's state: painted from the last load at once, kept in step with the
// backend, with every change shown before the backend confirms it.
//
// How it holds together:
// - `base` is the backend's data as last known: the last load plus the saved
//   result of every write since.
// - `ops` are changes not yet confirmed (sending, queued without signal,
//   refused, or an undo on its way). state.expenses/payments/people are
//   `base` with `ops` laid over it in order, each touched item flagged
//   `pending` or `failed`.
// - Writes to the same item go out one at a time, in the order they were
//   made (a per-item chain), so an edit waits for its add and an undo waits
//   for the write it undoes. A write whose item has nothing in flight starts
//   at once.
// - Adds of expenses are kept in mat.queue from the moment they are made
//   until the backend has them, and resent on the next contact. A stamp whose
//   reply never came is kept too (in memory only: a reload fetches the truth)
//   and resent with the same id on the next contact. (A stop add is not
//   queued: stop writes need a connection.) Any other write that
//   gets no reply is rolled back, said to be unconfirmed, and the next contact
//   reloads, so the screen shows whatever the backend holds. Only a write the
//   phone knows never left (it said it had no network) is said not saved.
// - An Undo of a write whose fate was unknown (or whose reply said it changed
//   nothing, because an earlier unconfirmed one had landed) waits for a load,
//   then undoes the backend's own record of it from the item's history.
// - An add (or stamp) that is undone after its request left the phone may
//   or may not be on the backend. It is kept in mat.queue as an undo to
//   finish, until the backend confirms it: resend the add (the backend
//   returns the first one, with its log id) and then undo that. A line that
//   provably never left the phone is simply forgotten.
//
// Who you are (security, 2026-11-18): when load says personal, the phone is
// the link's own person (me from the backend, no choice offered, and queued
// lines are written as that person). A key the backend refuses (bad_key)
// takes the trip off the phone: everything in memory, and every mat.* key
// in storage (clear, given to createStore; by default js/forget.js
// clearTrip), keeping only this person's own unsent lines in mat.queue.
//
// Everything outside comes in through createStore's arguments.

import { newId } from "./time.js";
import { untickOutcome } from "./todos.js";
import { LOST as TICKET_LOST } from "./tickets.js";
import { clearTrip } from "./forget.js";

const BUSY_RETRIES = 3;
const BUSY_DELAY_MS = 400;
const UNDO_FAILED = "Couldn’t undo that. Try again from History.";
// The request provably never left the phone.
const NOT_SAVED = "No signal. That wasn’t saved.";
// No reply: it may or may not be on the backend; the next contact shows which.
const UNCONFIRMED = "Couldn’t confirm that. Checking…";
const STALE = "That was changed again since. Undo the newer change first.";
const NO_SIGNAL = "No signal. Try again.";
// A pull from the planner writes a few rows at a time: asked again while more
// remain, up to this many calls in a row.
const TODO_PULLS = 4;

// How often an open phone asks for the planner's payments on its own.
const PAY_AUTO_MS = 10 * 60 * 1000;
const DATA_KEYS = ["trip", "people", "days", "stops", "stays", "expenses", "payments", "rateToday", "rateSource", "sheetUrl", "plannerLinked", "todos", "todosPulledAt", "paymentsPulledAt", "stampDefs", "stamps", "paymentProblems", "todoProblems", "tickets"];
// Every kind of item the store keeps, the field it is found by and the flag
// that marks it gone. Stays and day headers only ever change here through an
// undo from History (their writes come in later tasks). A todo is an item
// of the planner's Book Now list ("Before we go"): ticked and claimed here.
// A stamp of the book (js/stampbook.js) is one person's press of one stamp:
// found by its definition and who pressed it ("def|who", as the backend's Log
// names it), and marked gone when it is lifted from History.
// A ticket is one picture of a stop's ticket (js/tickets.js), marked gone when removed.
const LIST = { expense: "expenses", payment: "payments", person: "people", stop: "stops", stay: "stays", day: "days", todo: "todos", stamp: "stamps", ticket: "tickets" };
const KEY_FIELD = { expense: "id", payment: "id", person: "name", stop: "id", stay: "id", day: "date", todo: "id", ticket: "id" };
const FLAG = { expense: "deleted", payment: "removed", stop: "deleted", stay: "deleted", stamp: "gone", ticket: "gone" };
const keyOf = (kind, x) => (kind === "stamp" ? x.def + "|" + x.who : x[KEY_FIELD[kind]]);
// Adds kept in mat.queue and resent with the same id until the backend has
// them. A stop add is not one of them: stop writes need a connection, so
// with no reply it is rolled back like any other write (and never resent).
// A ticket picture is one too: its data stays in the phone's keep (IndexedDB),
// never in mat.queue, and is read back from there to send (ticketData).
const ADD_API = { expense: "addExpense", payment: "addPayment", stamp: "pressStamp", ticket: "addTicket" };
// Adds that wait on the phone when it knows it has no signal.
const QUEUED_API = ["addExpense", "addTicket"];
// A press still queued this long after the moment it was made is dropped:
// the backend would refuse it as late, and its day has closed.
const STAMP_DROP_MS = 48 * 3600000;
const STAMP_DROPPED = "That stamp’s day has closed.";

// A stop as the backend gives it back, before the fields are filled in.
const STOP_BLANK = { date: "", time: "", title: "", detail: "", gettingThere: "", travelMin: 0, fixed: false, place: "", signJp: "", booked: false, link: "", photo: "", note: "", lat: "", lng: "" };

const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const defaultWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const codeOf = (err) => (err && err.code) || "server";
// No usable reply: no signal, or a reply that was not an envelope (or the
// backend's own "server" error).
const noReply = (err) => codeOf(err) === "network" || codeOf(err) === "server";
// The request provably never left the phone.
const neverSent = (err) => !!(err && err.notSent);
// The backend may have saved it: no reply to a request that did leave. Only an
// explicit refusal (bad_input, not_found, stale, bad_key), busy (the lock was
// never taken) or a request that never left proves nothing was saved.
const fateUnknown = (err) => noReply(err) && !neverSent(err);
// Worth trying again on the next contact.
const transient = (err) => noReply(err) || codeOf(err) === "busy";
const refusedAsStale = (err) => codeOf(err) === "stale" || codeOf(err) === "not_found";

// s cut to max letters as the backend's plannerCut_ does: at max - 1, less a
// trailing part-word, then "…".
function cutText(s, max) {
  if (s.length <= max) return s;
  let t = s.slice(0, max - 1);
  if (s.charAt(max - 1) !== " " && t.charAt(t.length - 1) !== " " && t.lastIndexOf(" ") > 0) t = t.slice(0, t.lastIndexOf(" "));
  return t.replace(/\s+$/, "") + "…";
}

function bare(item) {
  if (!item) return item;
  const out = { ...item };
  delete out.pending;
  delete out.failed;
  return out;
}

const isName = (names, n) => typeof n === "string" && names.includes(n);
const positive = (n) => typeof n === "number" && isFinite(n) && n > 0;

// Why money.js cannot use a row from the Sheet, or null when it can: a name
// that is not one of the people, or an amount it cannot read.
function unreadable(kind, x, names) {
  if (kind === "expense") {
    if (!isName(names, x.paidBy)) return "name";
    if (!Array.isArray(x.split) || !x.split.length || !x.split.every((n) => isName(names, n))) return "name";
    if (!positive(x.amount) || (x.currency !== "JPY" && x.currency !== "CAD")) return "amount";
    if (x.currency === "JPY" && !positive(x.rate)) return "amount";
    if (x.splitMode === "parts" || x.splitMode === "exact") {
      if (!Array.isArray(x.splitVals) || x.splitVals.length !== x.split.length || !x.splitVals.every(positive)) return "amount";
    }
    return null;
  }
  if (!isName(names, x.from) || !isName(names, x.to)) return "name";
  if (!positive(x.cad)) return "amount";
  return null;
}

// What a pull from the planner says it did.
function plannerNotice(d) {
  const plural = (n, one, many) => (n === 1 ? one : many);
  let said;
  if (d.added && d.changed) said = "Added " + d.added + " and changed " + d.changed + " to match the planner.";
  else if (d.added) said = "Added " + d.added + plural(d.added, " payment", " payments") + " from the planner.";
  else if (d.changed) said = "Changed " + d.changed + plural(d.changed, " payment", " payments") + " to match the planner.";
  else said = "Nothing new in the planner.";
  const bad = Array.isArray(d.problems) ? d.problems.length : 0;
  if (bad) said += " " + bad + plural(bad, " payment needs a look in the planner.", " payments need a look in the planner.") + " See You for which.";
  if (d.capped) said += " Only the first 300 payments were read.";
  if (d.more) said += " More to bring in: tap Fetch again.";
  return said;
}

function isData(d) {
  return !!d && typeof d === "object" && Array.isArray(d.expenses) && Array.isArray(d.payments) && Array.isArray(d.people);
}

// A key that came in the address and the trip refused (the phone keeps its own).
const ADDRESS_KEY_REFUSED = "That link didn’t work. This phone stays on the link it already had.";

// ticketData(id) -> Promise<base64 | null>: a ticket picture's data from the
// phone's keep, to send one that was queued (its data is never in mat.queue).
// afterLoad(): called after every load that answered (js/tickets.js
// fetchMissing hangs here).
export function createStore({ api, storage, now = () => Date.now(), wait = defaultWait, clear = (queue) => clearTrip(storage, { queue }), ticketData = async () => null, afterLoad = null }) {
  // Set once the trip was taken off this phone: nothing more is written to
  // storage or sent with the refused key until boot() starts again.
  let wiped = false;
  // How many times the trip was taken off (fix round 1, I1): a reply that
  // left before a wipe and lands after it is dropped, never drawn.
  let wipes = 0;
  // ---- storage, never allowed to throw ----
  const getItem = (k) => {
    try {
      const v = storage.getItem(k);
      return v === undefined ? null : v;
    } catch {
      return null;
    }
  };
  const setItem = (k, v) => {
    if (wiped) return;
    try {
      storage.setItem(k, v);
    } catch {
      // private mode or full: the app keeps working without it
    }
  };
  const getJson = (k) => {
    const raw = getItem(k);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const state = {
    status: "boot", online: true, rev: null, me: null,
    trip: null, people: [], days: [], stops: [], stays: [], expenses: [], payments: [], rateToday: null, rateSource: null, sheetUrl: "", plannerLinked: false, todos: [], todosPulledAt: "", paymentsPulledAt: "", stampDefs: [], stamps: [], paymentProblems: { at: "", list: [], more: 0 }, todoProblems: { at: "", list: [], more: 0 }, tickets: [], ticketsReady: false,
    loadedAt: null, seenAt: null, lastChange: null, notice: null, setAside: [], keyRefused: false,
    // personal: this phone opened its own person's link (load said so); me is then theirs.
    // cleared: the trip was taken off this phone after its key was refused ({ kept: own unsent lines kept }).
    personal: false, cleared: null,
    history: { entries: [], more: false, loading: false, error: null },
  };

  const subs = new Set();
  let base = null;
  let myName = null;
  let ops = []; // unconfirmed changes, in the order they were made
  let resolving = []; // undone adds/stamps whose backend side is not settled yet
  const writes = new Map(); // token -> write op, for undo(token)
  const chains = new Map(); // "kind:id" -> tail promise of that item's writes (never rejects)
  const background = new Set(); // flushes and probes started on their own
  let settled = []; // { seq, kind, item } confirmed by a write, newest last
  let writeSeq = 0;
  let loadCount = 0;
  let appliedLoad = 0;
  let flushing = null;
  let historyLoaded = false;
  // A write got no reply: the first load started after this many loads shows
  // the truth (null when none is owed).
  let reloadAfter = null;
  let contactReload = null;
  let unsureUndos = []; // undos of unconfirmed writes, waiting for a contact
  let loadWaiters = []; // { after, resolve }: waiting for a load started after `after` loads

  // ---- deriving and telling ----

  // One view that throws must not stop the others, or the store.
  function emit() {
    for (const fn of [...subs]) {
      try {
        fn(state);
      } catch (err) {
        if (typeof globalThis.reportError === "function") globalThis.reportError(err);
      }
    }
  }

  function derive() {
    if (base) for (const k of DATA_KEYS) state[k] = base[k];
    // A cache or a backend from before the book has neither list.
    if (!Array.isArray(state.stampDefs)) state.stampDefs = [];
    // A backend where migrate has not made the ticket tabs sends no tickets at all.
    state.ticketsReady = !!base && Array.isArray(base.tickets);
    const lists = {};
    // A cache kept before the plan existed has no stops, stays or days.
    for (const kind of Object.keys(LIST)) lists[kind] = base && Array.isArray(base[LIST[kind]]) ? base[LIST[kind]].slice() : [];
    // Rows from the Sheet the money maths cannot read (a hand edit with a
    // name the app does not know, say) are kept out of it and listed.
    const names = lists.person.map((x) => x.name);
    const aside = [];
    for (const kind of ["expense", "payment"]) {
      lists[kind] = lists[kind].filter((x) => {
        const reason = unreadable(kind, x, names);
        if (!reason) return true;
        aside.push({ kind, id: x.id, title: kind === "expense" ? x.title : x.from + " \u2192 " + x.to, reason });
        return false;
      });
    }
    state.setAside = aside;
    // Undo keeps a separate operation while it reconciles a possibly landed add.
    state.settlementProvisional = resolving.some((op) =>
      (op.kind === "expense" || op.kind === "payment") && (op.lost || op.delayed)
    );
    for (const op of ops) {
      if (op.kind === "expense" || op.kind === "payment") {
        // Once delayed, a retry remains provisional until the write is acknowledged.
        if (op.status === "queued" || op.status === "failed" || op.lost || !state.online) op.delayed = true;
        if (op.delayed) state.settlementProvisional = true;
      }
      const list = lists[op.kind];
      const i = list.findIndex((x) => keyOf(op.kind, x) === op.id);
      const next = op.view(i >= 0 ? bare(list[i]) : null);
      if (!next) continue;
      const shown = bare(next);
      if (op.kind !== "person") {
        if (op.status === "failed") shown.failed = true;
        else shown.pending = true;
      }
      if (i >= 0) list[i] = shown;
      else list.push(shown);
    }
    for (const kind of Object.keys(LIST)) state[LIST[kind]] = lists[kind];
    state.me = myName && state.people.some((p) => p.name === myName) ? myName : null;
  }

  function changed() {
    dropStalePresses();
    derive();
    emit();
  }

  function find(kind, id) {
    return state[LIST[kind]].find((x) => keyOf(kind, x) === id) || null;
  }

  function track(promise) {
    background.add(promise);
    promise.finally(() => background.delete(promise));
    return promise;
  }

  // ---- persistence ----

  function saveCache() {
    if (!base) return;
    setItem("mat.cache", JSON.stringify({ data: base, rev: state.rev, loadedAt: state.loadedAt }));
  }

  const isAdd = (op) => op.api === ADD_API[op.kind];
  const isLiveAdd = (op) => isAdd(op) && !op.undone && ops.includes(op);
  const isLiveQueuedAdd = (op) => op.api === "addExpense" && isLiveAdd(op);
  // The request may have reached the backend.
  const mayHaveLanded = (op) => op.inFlight || op.lost || op.logId !== null;

  function saveQueue() {
    const live = ops.filter(isLiveAdd).map((op) =>
      op.kind === "payment"
        ? { payment: op.args.payment, stampedAt: op.after.stampedAt, stampedBy: op.after.stampedBy, sent: op.inFlight || op.lost }
        : op.kind === "stamp"
        ? { stamp: op.args, who: op.after.who, sent: op.inFlight || op.lost }
        : op.kind === "ticket"
        ? { ticket: ticketMeta(op.args.ticket), by: op.after.by, at: op.after.at, size: op.after.size, sent: op.inFlight || op.lost }
        : {
            expense: op.args.expense,
            addedAt: op.after.addedAt,
            rate: op.after.rate,
            addedBy: op.after.addedBy,
            failed: op.status === "failed",
            sent: op.inFlight || op.lost,
          },
    );
    const undos = resolving.map((op) => ({ undo: true, kind: op.kind, args: op.kind === "ticket" ? { ticket: ticketMeta(op.args.ticket) } : op.args, logId: op.logId, actor: op.actor || null }));
    setItem("mat.queue", JSON.stringify(live.concat(undos)));
  }

  // ---- talking to the backend ----

  async function call(action, args, opts) {
    if (wiped) throw refusedError();
    const wipesAt = wipes;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = opts ? await api(action, args, opts) : await api(action, args);
        if (wipes !== wipesAt) throw lateError();
        state.online = true;
        // Contact after a write that got no reply: show what the backend has.
        // (refresh and checkRev see to it themselves.)
        if (reloadAfter !== null && action !== "load" && action !== "rev") reloadOnContact();
        return r;
      } catch (err) {
        if (err && err.late) throw err; // the trip was taken off meanwhile: nothing more to do with it
        if (wipes !== wipesAt) throw lateError();
        const code = err && err.code;
        if (code === "busy" && attempt < BUSY_RETRIES) {
          await wait(BUSY_DELAY_MS);
          continue;
        }
        if (code === "network") state.online = false;
        if (code === "bad_key") {
          state.status = "nokey";
          state.keyRefused = true; // a key was tried and the trip said no
          takeTripOff();
        }
        throw err;
      }
    }
  }

  function lateError() {
    const err = refusedError();
    err.late = true;
    return err;
  }

  function refusedError() {
    const err = new Error("This link’s trip key doesn’t match. Ask for a fresh invite link.");
    err.code = "bad_key";
    return err;
  }

  // Who an entry of mat.queue was made by (null when it does not say).
  function queuedBy(q) {
    if (!q || typeof q !== "object") return null;
    const who = q.undo === true ? q.actor : q.stamp ? q.who : q.payment ? q.stampedBy : q.addedBy;
    return typeof who === "string" ? who : null;
  }

  // The backend refused this phone's key (a definitive bad_key: never a
  // network failure or busy). The trip comes off the phone: memory and
  // storage, except this person's own unsent entries, which stay in mat.queue
  // for when they open their new link. The no-key screen then shows.
  function takeTripOff({ keep = true } = {}) {
    if (wiped && keep) return;
    const queue = keep ? getJson("mat.queue") : null;
    // With nobody known (an earlier refusal already took mat.me off), the
    // queue is already only this person's: kept as it is (fix round 1, C2).
    // Never a ticket picture: every one comes off the phone, unsent ones too.
    const notPicture = (q) => q && typeof q === "object" && !q.ticket && !(q.undo === true && q.kind === "ticket");
    const mine = !Array.isArray(queue) ? [] : myName ? queue.filter((q) => notPicture(q) && queuedBy(q) === myName) : queue.filter(notPicture);
    // Only say the trip was taken off when there was one here (a wrong key
    // pasted on an empty phone has nothing to take off).
    const had = base !== null || getItem("mat.cache") !== null || (Array.isArray(queue) && queue.length > 0);
    wiped = true;
    wipes++;
    try {
      clear(mine.length ? JSON.stringify(mine) : null);
    } catch {
      // storage that cannot be cleared: memory is cleared all the same
    }
    base = null;
    ops = [];
    resolving = [];
    writes.clear();
    settled = [];
    unsureUndos = [];
    myName = null;
    for (const k of DATA_KEYS) state[k] = Array.isArray(state[k]) ? [] : null;
    Object.assign(state, {
      rev: null, me: null, personal: false, sheetUrl: "", plannerLinked: false, todosPulledAt: "", paymentsPulledAt: "",
      paymentProblems: { at: "", list: [], more: 0 }, todoProblems: { at: "", list: [], more: 0 },
      loadedAt: null, lastChange: null, notice: null, setAside: [],
      history: { entries: [], more: false, loading: false, error: null },
      cleared: had ? { kept: mine.length } : null,
      settlementProvisional: false,
    });
    historyLoaded = false;
    emit();
  }

  // The link's own person, when load says so (also from the saved trip, so a
  // phone with no signal is still that person). A line queued earlier under
  // another name is still sent: the backend writes it as this link's person,
  // who is the one holding the phone.
  function takeIdentity(data) {
    const personal = !!data && data.personal === true && typeof data.me === "string" && data.me !== "";
    state.personal = personal;
    if (personal && myName !== data.me) {
      myName = data.me;
      setItem("mat.me", myName);
    }
  }

  // Our own write moved the backend on by exactly one: keep rev in step so
  // checkRev does not reload for it. Anything else leaves rev for checkRev.
  function stepRev(rev) {
    if (typeof rev === "number" && typeof state.rev === "number" && rev === state.rev + 1) state.rev = rev;
  }

  // Runs fn after everything already queued for this item; at once (in the
  // same tick) when nothing is.
  function enqueue(key, fn) {
    const prev = chains.get(key);
    const run = prev ? prev.then(fn) : (async () => fn())();
    const tail = run.catch(() => {});
    chains.set(key, tail);
    tail.then(() => {
      if (chains.get(key) === tail) chains.delete(key);
    });
    return run;
  }

  const chainKey = (kind, id) => kind + ":" + id;

  function removeOp(op) {
    ops = ops.filter((o) => o !== op);
  }

  function putBase(kind, item) {
    if (!base) return;
    const list = Array.isArray(base[LIST[kind]]) ? base[LIST[kind]].slice() : [];
    const i = list.findIndex((x) => keyOf(kind, x) === keyOf(kind, item));
    if (i >= 0) list[i] = item;
    else list.push(item);
    base = { ...base, [LIST[kind]]: list };
  }

  // A write's confirmed result: into base now, and kept so that a load sent
  // before it settled cannot wipe it.
  function confirm(kind, item) {
    writeSeq += 1;
    settled.push({ seq: writeSeq, kind, item: copy(item) });
    putBase(kind, copy(item));
  }

  // ---- reading ----

  // Proof of contact: send anything that is waiting, and finish undos of
  // unconfirmed writes against what was just loaded.
  function afterContact() {
    const waiting = resolving.length > 0 || ops.some((op) => isLiveAdd(op) && op.status === "queued");
    if (waiting) track(flush());
    for (const op of unsureUndos.splice(0)) track(enqueue(chainKey(op.kind, op.id), () => undoUnsure(op, false)));
  }

  function reloadOnContact() {
    if (contactReload) return;
    contactReload = track(refresh().finally(() => {
      contactReload = null;
    }));
  }

  // A write got no reply: the next contact reloads.
  function wantReload() {
    reloadAfter = loadCount;
  }

  async function refresh() {
    const startSeq = writeSeq;
    const mine = ++loadCount;
    let r;
    try {
      r = await call("load", {});
    } catch (err) {
      if (state.status !== "nokey") state.status = base ? "ready" : "error";
      changed();
      return false;
    }
    if (reloadAfter !== null && mine > reloadAfter) reloadAfter = null;
    if (mine < appliedLoad) return true; // a newer load already landed
    appliedLoad = mine;
    const data = copy(r.data);
    base = data;
    takeIdentity(data);
    for (const s of settled) if (s.seq > startSeq) putBase(s.kind, copy(s.item));
    settled = settled.filter((s) => s.seq > startSeq);
    state.rev = r.rev;
    state.loadedAt = now();
    state.status = "ready";
    saveCache();
    changed();
    afterContact();
    wakeLoadWaiters(mine);
    if (typeof afterLoad === "function") {
      try {
        afterLoad();
      } catch {
        // the hook's own trouble
      }
    }
    return true;
  }

  // Resolves once a load started after `after` loads has been applied.
  function nextLoad(after) {
    return new Promise((resolve) => loadWaiters.push({ after, resolve }));
  }

  function wakeLoadWaiters(upTo) {
    const due = loadWaiters.filter((w) => w.after < upTo);
    loadWaiters = loadWaiters.filter((w) => w.after >= upTo);
    for (const w of due) w.resolve();
  }

  async function checkRev() {
    let r;
    try {
      r = await call("rev", {});
    } catch {
      changed();
      return;
    }
    if (r.rev !== state.rev || reloadAfter !== null) {
      await refresh();
      return;
    }
    changed();
    afterContact();
  }

  // After the backend refused an undo as stale or gone: say so and show what
  // the backend has now.
  async function showBackendAfterRefusedUndo(err) {
    state.notice = (err && err.message) || STALE;
    changed();
    await refresh();
    if (historyLoaded) await loadHistory();
  }

  function restoreQueue() {
    const queue = getJson("mat.queue");
    if (!Array.isArray(queue)) return;
    for (const q of queue) {
      if (!q || typeof q !== "object") continue;
      if (q.undo === true) {
        const kind = q.kind;
        // A press carries { def, at, seed }; the press is found by its definition and who made it.
        const who = typeof q.actor === "string" ? q.actor : myName;
        const item = q.args && typeof q.args === "object" ? (kind === "stamp" ? (typeof q.args.def === "string" && who ? { id: q.args.def + "|" + who } : null) : q.args[kind]) : null;
        if (!ADD_API[kind] || !item || typeof item.id !== "string") continue;
        if (resolving.some((o) => o.kind === kind && o.id === item.id)) continue;
        const op = {
          token: newId(), kind, id: item.id, action: kind === "expense" || kind === "ticket" ? "add" : "stamp", api: ADD_API[kind],
          args: copy(q.args), before: null, after: copy(item), view: () => null,
          status: "queued", undone: true, inFlight: false, lost: true,
          logId: typeof q.logId === "number" ? q.logId : null,
          actor: typeof q.actor === "string" ? q.actor : null,
        };
        startResolving(op);
        continue;
      }
      if (q.stamp && typeof q.stamp === "object" && typeof q.stamp.def === "string" && typeof q.stamp.at === "string") {
        const who = typeof q.who === "string" ? q.who : myName;
        if (!who || ops.some((o) => o.kind === "stamp" && o.id === q.stamp.def + "|" + who)) continue;
        const op = pressOp({ def: q.stamp.def, at: q.stamp.at, seed: q.stamp.seed, here: q.stamp.here === true }, who);
        op.status = "queued";
        op.lost = q.sent !== false;
        writes.set(op.token, op);
        ops.push(op);
        continue;
      }
      if (q.ticket && typeof q.ticket === "object" && typeof q.ticket.id === "string") {
        if (ops.some((o) => o.kind === "ticket" && o.id === q.ticket.id)) continue;
        const op = ticketOp(q.ticket, { by: typeof q.by === "string" ? q.by : myName, at: typeof q.at === "string" ? q.at : undefined, size: q.size });
        op.status = "queued";
        op.lost = q.sent !== false;
        writes.set(op.token, op);
        ops.push(op);
        continue;
      }
      if (q.payment && typeof q.payment === "object" && typeof q.payment.id === "string") {
        if (ops.some((o) => o.kind === "payment" && o.id === q.payment.id)) continue;
        const op = stampOp(q.payment, {
          stampedBy: typeof q.stampedBy === "string" ? q.stampedBy : myName,
          stampedAt: typeof q.stampedAt === "string" ? q.stampedAt : undefined,
        });
        op.status = "queued";
        op.lost = q.sent !== false;
        writes.set(op.token, op);
        ops.push(op);
        continue;
      }
      if (!q.expense || typeof q.expense.id !== "string") continue;
      if (ops.some((o) => o.kind === "expense" && o.id === q.expense.id)) continue;
      const op = addOp(q.expense, {
        addedBy: typeof q.addedBy === "string" ? q.addedBy : myName,
        addedAt: typeof q.addedAt === "string" ? q.addedAt : undefined,
        rate: typeof q.rate === "number" ? q.rate : undefined,
      });
      op.status = q.failed ? "failed" : "queued";
      op.lost = q.sent !== false;
      writes.set(op.token, op);
      ops.push(op);
    }
  }

  // candidate: a key that came in the address while another key is stored
  // (fix round 1, C1). It is tried once, for this visit only, and kept only
  // when the backend takes it AND it is a personal key or the stored key is
  // not one (known from the saved trip). Refused, it is dropped and the
  // phone carries on with its own key: only a refusal of the stored key
  // takes the trip off. No signal: dropped, nothing stored.
  async function tryCandidate(candidate) {
    const storedPersonal = base ? base.personal === true : null;
    let r;
    try {
      r = await api("load", {}, { key: candidate });
    } catch (err) {
      if (err && err.code === "bad_key") state.notice = ADDRESS_KEY_REFUSED;
      return;
    }
    const personal = !!(r && r.data && r.data.personal === true);
    if (!(personal || storedPersonal === false) || wiped) return;
    setItem("mat.key", candidate);
    // Fix round 2: the reply it already has is the phone's trip at once, so
    // the saved trip says who this is even if the next load fails (else the
    // old shared link could replace the key again from a stale saved trip).
    if (isData(r.data)) {
      base = copy(r.data);
      takeIdentity(base);
      state.rev = r.rev;
      state.loadedAt = now();
      state.status = "ready";
      saveCache();
      changed();
    }
  }

  async function boot({ candidate = null } = {}) {
    state.keyRefused = false;
    wiped = false;
    state.cleared = null;
    const key = getItem("mat.key");
    myName = getItem("mat.me");
    const seen = Number(getItem("mat.seen"));
    state.seenAt = getItem("mat.seen") !== null && isFinite(seen) ? seen : null;
    if (!key) {
      state.status = "nokey";
      changed();
      return;
    }
    const cache = getJson("mat.cache");
    if (cache && typeof cache === "object" && isData(cache.data)) {
      base = cache.data;
      state.rev = typeof cache.rev === "number" ? cache.rev : null;
      state.loadedAt = typeof cache.loadedAt === "number" ? cache.loadedAt : null;
      state.status = "ready";
    }
    // Who you are, from the saved trip, until the load says again.
    if (base) takeIdentity(base);
    // Whatever painting the cache does, the load still goes out.
    try {
      restoreQueue();
      changed();
    } catch {
      // a broken cache or queue: the load below replaces it
    }
    if (typeof candidate === "string" && candidate !== "" && candidate !== key) await tryCandidate(candidate);
    if (await refresh()) await flush();
  }

  // ---- writes ----

  // op: { token, kind, id, action, api, args, before, after, view, status,
  //       undone, logId, inFlight, lost, resolving, uop }
  function addOp(expense, { addedBy, addedAt, rate } = {}) {
    const after = {
      ...copy(expense),
      rate: rate !== undefined ? rate : base ? base.rateToday : state.rateToday,
      addedBy: addedBy || null,
      addedAt: addedAt || new Date(now()).toISOString(),
      deleted: false,
    };
    return {
      token: newId(), kind: "expense", id: expense.id, action: "add", api: "addExpense",
      args: { expense: copy(expense) }, before: null, after,
      view: (cur) => ({ ...(cur || {}), ...after }),
      status: "sending", undone: false, logId: null, inFlight: false, lost: false,
      actor: after.addedBy,
    };
  }

  function begin(op) {
    writes.set(op.token, op);
    ops.push(op);
    // A write its caller waits on (op.quiet) is shown on the bar once saved.
    if (op.quiet) op.outcome = new Promise((resolve) => { op.finish = resolve; });
    else if (!op.silent) showChange(op, op.after);
    if (QUEUED_API.includes(op.api) && !state.online) {
      // Known to be without signal: keep it on the phone (so it provably never
      // left) and check for signal; the next contact sends it.
      op.status = "queued";
      settleTicket(op, { saved: false, reason: "queued" });
      saveQueue();
      changed();
      track(checkRev());
      return op.token;
    }
    if (isAdd(op)) saveQueue();
    changed();
    send(op);
    return op.token;
  }

  function send(op) {
    return enqueue(chainKey(op.kind, op.id), () => runWrite(op));
  }

  async function runWrite(op) {
    // An undone add is only ever sent by finishUndo.
    if (op.undone && isAdd(op)) return;
    // A queued picture's data comes back from the keep; lost there, it is dropped and said.
    // One whose request may have landed is asked about without its data
    // (fix round 1, I5): the backend answers the first add, or that it never had it.
    if (op.kind === "ticket" && isAdd(op) && !(await fillTicket(op)) && !op.lost) {
      removeOp(op);
      state.notice = TICKET_LOST;
      settleTicket(op, { saved: false, reason: "lost" });
      saveQueue();
      changed();
      return;
    }
    op.status = "sending";
    op.inFlight = true;
    if (isAdd(op)) saveQueue();
    try {
      const r = await call(op.api, op.args, isAdd(op) && op.actor ? { actor: op.actor } : undefined);
      op.inFlight = false;
      const item = r.data[op.kind];
      op.logId = r.data.logId === undefined ? null : r.data.logId;
      op.status = "done";
      removeOp(op);
      confirm(op.kind, item);
      // A resent add is answered with the backend's current rev, which may
      // hold other phones' changes: never take it as this write's own step.
      if (op.lost) track(checkRev());
      else if (op.logId !== null) stepRev(r.rev);
      if (op.logId === null && !isAdd(op)) op.noop = true; // the backend already had it so
      settleTicket(op, { saved: true, item: copy(item) });
      const lc = state.lastChange;
      if (op.quiet) {
        showChange(op, item);
        op.finish({ saved: true, item: copy(item) });
      } else if (lc && lc.token === op.token) state.lastChange = { ...lc, item: copy(item) };
    } catch (err) {
      op.inFlight = false;
      if (fateUnknown(err)) op.lost = true;
      if (op.undone && isAdd(op)) {
        // finishUndo decides what still has to happen
      } else if (isAdd(op) && (noReply(err) || (op.kind === "ticket" && transient(err)))) {
        // A picture that met a busy trip sheet waits too (fix round 1, I1): nothing else could send it again.
        op.status = "queued"; // the same id resent later is safe
        settleTicket(op, { saved: false, reason: "queued", busy: codeOf(err) === "busy" });
      } else if (op.api === "addTicket") {
        // Refused: gone from the screen. The sheet that sent it says why;
        // one that was waiting on the phone (the sheet long closed) is said here.
        removeOp(op);
        if (op.settled) state.notice = (err && err.message) || UNCONFIRMED;
        settleTicket(op, { saved: false, reason: "refused", message: (err && err.message) || UNCONFIRMED });
      } else if (op.api === "addExpense") {
        op.status = "failed";
      } else if (op.quiet) {
        removeOp(op);
        settleQuiet(op, err);
      } else {
        removeOp(op);
        state.notice = failNotice(err);
        // A stop or a todo (a tick, a claim) with no reply is asked about at
        // once, not at the next 20-second check, so one that did land (a slow
        // tick outlasting the 30-second wait) is back on screen before anyone
        // taps it again. (A reload only: the write is never resent.)
        if ((op.kind === "stop" || op.kind === "todo") && fateUnknown(err)) track(checkRev());
      }
    }
    saveQueue();
    saveCache();
    changed();
  }

  // The undo bar's line for a write (`item` as it is now).
  function showChange(op, item) {
    state.lastChange = { token: op.token, action: op.action, kind: op.kind, item: bare(copy(item)), canUndo: true };
    if (op.action === "edit") state.lastChange.before = bare(op.before);
  }

  // A write its caller waits on did not go through: the caller is told how
  // (op.finish) and says it itself, so no notice. With no reply, the caller
  // hears at once that it is unsure (op.onUnsure), and the outcome follows
  // the first load after it: saved when the backend has it, else not landed.
  function settleQuiet(op, err) {
    if (neverSent(err)) {
      op.finish({ saved: false, reason: "notSent" });
      return;
    }
    if (!noReply(err)) {
      op.finish({ saved: false, reason: "refused", message: (err && err.message) || UNCONFIRMED });
      return;
    }
    if (typeof op.onUnsure === "function") {
      try {
        op.onUnsure();
      } catch {
        // the caller's own trouble
      }
    }
    wantReload();
    nextLoad(loadCount).then(() => {
      const item = (base && Array.isArray(base[LIST[op.kind]]) ? base[LIST[op.kind]] : []).find((x) => keyOf(op.kind, x) === op.id) || null;
      const landed = !!item && (!op.before || sameAs(item, op.patch));
      if (!landed) {
        op.finish({ saved: false, reason: "notLanded" });
        return;
      }
      showChange(op, item);
      changed();
      op.finish({ saved: true, item: copy(item) });
    });
    track(checkRev());
  }

  // What a write that did not go through says. A write with no reply is
  // rolled back for now, and the next contact reloads to show the truth.
  function failNotice(err) {
    if (neverSent(err)) return NOT_SAVED;
    if (noReply(err)) {
      wantReload();
      return UNCONFIRMED;
    }
    return (err && err.message) || UNCONFIRMED;
  }

  // opts.quiet: the caller waits on store.outcome(token) and tells the
  // person itself (a stop sheet); opts.onUnsure: called when no reply came.
  // opts.args: what to send, when it is not { id } (or { id, patch } for an edit).
  function change(kind, id, action, apiAction, patch, { quiet = false, onUnsure = null, args: given = null } = {}) {
    const before = find(kind, id);
    if (!before) return null;
    const after = { ...bare(before), ...patch };
    const args = given ? copy(given) : action === "edit" ? { id, patch: copy(patch) } : { id };
    return begin({
      token: newId(), kind, id, action, api: apiAction, args, patch: copy(patch),
      before: bare(before), after,
      view: (cur) => (cur ? { ...cur, ...patch } : null),
      status: "sending", undone: false, logId: null, inFlight: false, lost: false, actor: myName,
      quiet, onUnsure,
    });
  }

  function addExpense(draft) {
    const expense = { id: newId(), ...copy(draft) };
    return begin(addOp(expense, { addedBy: myName }));
  }

  // A new stop, shown at once and sent as addStop. Not queued: with no
  // signal, or no reply, it is rolled back like an edit (see runWrite).
  // opts.id: the id to use (a retry passes the first try's, so the backend
  // keeps one stop); opts.quiet and opts.onUnsure as for change().
  function addStop(draft, { id, quiet = false, onUnsure = null } = {}) {
    const stop = { ...copy(draft), id: typeof id === "string" && id ? id : newId() };
    const after = { ...STOP_BLANK, ...copy(stop), deleted: false };
    return begin({
      token: newId(), kind: "stop", id: stop.id, action: "add", api: "addStop",
      args: { stop: copy(stop) }, before: null, after,
      view: (cur) => ({ ...(cur || {}), ...after }),
      status: "sending", undone: false, logId: null, inFlight: false, lost: false, actor: myName,
      quiet, onUnsure,
    });
  }

  // How a write made with opts.quiet ended: { saved: true, item } (item as
  // the backend has it), or { saved: false, reason } with reason "refused"
  // (and the backend's message), "notSent" (it provably never left the
  // phone) or "notLanded" (no reply, and the backend does not have it).
  // With no reply it resolves only after a load, however long that takes.
  function outcome(token) {
    const op = writes.get(token);
    return op && op.outcome ? op.outcome : Promise.resolve(null);
  }

  function addPayment({ from, to, cad }) {
    const rnd = new Uint32Array(2);
    globalThis.crypto.getRandomValues(rnd);
    const payment = {
      id: newId(), from, to, cad,
      seed: 1 + (rnd[0] % 999999),
      rot: (rnd[1] % 201) / 10 - 13, // -13.0 to 7.0
    };
    payment.rot = Math.round(payment.rot * 10) / 10;
    return begin(stampOp(payment, { stampedBy: myName }));
  }

  function stampOp(payment, { stampedBy, stampedAt } = {}) {
    const after = { ...copy(payment), stampedBy: stampedBy || null, stampedAt: stampedAt || new Date(now()).toISOString(), removed: false };
    return {
      token: newId(), kind: "payment", id: payment.id, action: "stamp", api: "addPayment",
      args: { payment: copy(payment) }, before: null, after,
      view: (cur) => ({ ...(cur || {}), ...after }),
      status: "sending", undone: false, logId: null, inFlight: false, lost: false, actor: after.stampedBy,
    };
  }

  // ---- ticket pictures ----

  // What is kept of a picture's add on the phone: everything but its data.
  function ticketMeta(t) {
    const out = { ...(t || {}) };
    delete out.data;
    return out;
  }

  // A picture to add: shown at once (pending), sent as addTicket { ticket },
  // kept in mat.queue (without its data) until the backend has it. Silent:
  // no undo bar line per picture (the stop sheet shows each one's progress);
  // History has each one.
  function ticketOp(t, { by, at, size } = {}) {
    const meta = { id: t.id, stop: t.stop, who: t.who || "", seat: t.seat || "", page: t.page, mime: t.mime, w: t.w, h: t.h };
    const chars = typeof t.data === "string" ? t.data.length : Number(size) || 0;
    const after = { ...meta, size: chars, chunks: Math.max(1, Math.ceil(chars / 45000)), by: by || null, at: at || new Date(now()).toISOString() };
    const op = {
      token: newId(), kind: "ticket", id: t.id, action: "add", api: "addTicket",
      args: { ticket: typeof t.data === "string" ? { ...meta, data: t.data } : meta }, before: null, after,
      view: (cur) => ({ ...(cur || {}), ...after }),
      status: "sending", undone: false, logId: null, inFlight: false, lost: false, actor: by || null, silent: true,
      settled: false,
    };
    op.outcome = new Promise((resolve) => {
      op.finish = resolve;
    });
    return op;
  }

  // The first word on how a picture went: saved, refused, lost, or waiting on the phone. Once only.
  function settleTicket(op, out) {
    if (op.kind !== "ticket" || op.settled || typeof op.finish !== "function") return;
    op.settled = true;
    op.finish(out);
  }

  async function fillTicket(op) {
    if (typeof op.args.ticket.data === "string" && op.args.ticket.data) return true;
    let data = null;
    try {
      data = await ticketData(op.id);
    } catch {
      data = null;
    }
    if (typeof data !== "string" || !data) return false;
    op.args = { ticket: { ...op.args.ticket, data } };
    return true;
  }

  // t: { id?, stop, who, seat, page, mime, w, h, data }. Returns the token
  // (ticketOutcome(token) says how it went); the caller keeps the picture in
  // the keep first, under t.id, so a resend after a reload can find it.
  function addTicket(t) {
    const pic = { ...copy(t), id: typeof t.id === "string" && t.id ? t.id : newId() };
    return begin(ticketOp(pic, { by: myName }));
  }

  // { saved: true, item } | { saved: false, reason: "queued" (waiting on the
  // phone for signal) | "refused" (with the backend's message) | "lost" }.
  function ticketOutcome(token) {
    const op = writes.get(token);
    return op && op.kind === "ticket" ? op.outcome : Promise.resolve(null);
  }

  // One picture's data, { id, mime, data }, straight from the backend (a read, never queued).
  async function fetchTicket(id) {
    const r = await call("ticket", { id });
    return r.data;
  }

  // ---- the stamp book ----

  // A press: shown at once (a stamp of mine, with the seed that wears its
  // ink), sent as pressStamp { def, at, seed }. Kept in mat.queue like a line
  // until the backend has it, resent with the same def (the backend answers a
  // second press of the same stamp with the first), and never shown on the
  // undo bar: it is lifted from History.
  // here: the phone was in the day's place as it was pressed (a yes only; no position).
  function pressOp({ def, at, seed, here }, who) {
    const after = { def, who, at, seed, gone: false };
    const args = { def, at, seed };
    if (here === true) {
      after.here = true;
      args.here = true;
    }
    return {
      token: newId(), kind: "stamp", id: def + "|" + who, action: "press", api: "pressStamp",
      args, before: null, after,
      view: (cur) => ({ ...(cur || {}), ...after }),
      status: "sending", undone: false, logId: null, inFlight: false, lost: false, actor: who, silent: true,
    };
  }

  // Returns the press's token, or null when there is nothing to press: no
  // such stamp, nobody chosen yet, one of mine already shown, or this one's
  // press still on its way (a second tap is not a second request).
  // opts.here: true when the phone is in the day's place (js/plan.js inPlace).
  function pressStamp(defId, { here = false } = {}) {
    if (!myName || !state.stampDefs.some((d) => d && d.id === defId)) return null;
    const id = defId + "|" + myName;
    if (ops.some((o) => o.kind === "stamp" && o.id === id && !o.undone)) return null;
    const held = find("stamp", id);
    if (held && !held.gone) return null;
    const rnd = new Uint32Array(1);
    globalThis.crypto.getRandomValues(rnd);
    const seed = 1 + (rnd[0] % 4294967295);
    return begin(pressOp({ def: defId, at: new Date(now()).toISOString(), seed, here: here === true }, myName));
  }

  // A press still queued more than 48 hours after the moment it was made is
  // dropped, with a line saying so: its day has closed. (One that may have
  // landed is checked against the next load.)
  function dropStalePresses() {
    const t = now();
    const stale = ops.filter((o) => o.kind === "stamp" && isLiveAdd(o) && o.status === "queued" && t - Date.parse(o.after.at) > STAMP_DROP_MS);
    if (!stale.length) return false;
    for (const op of stale) {
      removeOp(op);
      if (mayHaveLanded(op)) wantReload();
    }
    saveQueue();
    state.notice = STAMP_DROPPED;
    return true;
  }

  // Removing (or deleting) an item whose add the backend has not confirmed:
  // never a request about an item it may not have. The add is taken back,
  // as Undo does: forgotten if it provably never left, otherwise resent and
  // undone on the next contact. null when there is no such add.
  function takeBackLive(kind, id) {
    const op = ops.find((o) => o.kind === kind && o.id === id && isLiveAdd(o));
    if (!op) return null;
    op.undone = true;
    state.lastChange = { token: newId(), action: "undo", kind, item: bare(undoneView(op, bare(find(kind, id)))), canUndo: false };
    takeBack(op);
    return state.lastChange.token;
  }

  // What an item looks like once `op` is undone.
  function undoneView(op, cur) {
    if (!op.before) return { ...(cur || op.after), [FLAG[op.kind]]: true };
    return { ...(cur || {}), ...op.before };
  }

  // ---- undoing an add or a stamp ----

  // Remember (in mat.queue too) that this add must end up undone on the
  // backend, and show it gone meanwhile.
  function startResolving(op) {
    op.resolving = true;
    op.uop = { kind: op.kind, id: op.id, status: "sending", view: (cur) => (cur ? { ...cur, [FLAG[op.kind]]: true } : null) };
    ops.push(op.uop);
    resolving.push(op);
    saveQueue();
  }

  function stopResolving(op) {
    op.resolving = false;
    resolving = resolving.filter((o) => o !== op);
    removeOp(op.uop);
    saveQueue();
  }

  // Makes the backend agree that `op` is undone. Returns "done", "wait" (the
  // add's fate is unknown and there is no proof of signal yet) or "offline".
  async function finishUndo(op, contact) {
    if (!op.resolving) return "done";
    try {
      if (op.logId === null) {
        if (!op.lost) {
          // refused outright, never on the backend
          stopResolving(op);
          return "done";
        }
        if (!contact) return "wait";
        let r;
        // A picture's data from the keep; lost there, the backend never had more than its id.
        // Without its data, a picture that may have landed is still asked about
        // (fix round 1, I5): not_found below means it never did.
        if (op.kind === "ticket" && !(await fillTicket(op)) && !op.lost) {
          stopResolving(op);
          return "done";
        }
        try {
          r = await call(op.api, op.args, op.actor ? { actor: op.actor } : undefined); // same id: the backend returns the first one
        } catch (err) {
          if (transient(err)) return "offline";
          stopResolving(op); // refused: it is not on the backend
          return "done";
        }
        op.logId = r.data.logId === undefined ? null : r.data.logId;
        confirm(op.kind, r.data[op.kind]);
        saveQueue();
        if (op.logId === null) {
          stopResolving(op);
          return "done";
        }
      }
      let r;
      try {
        r = await call("undo", { logId: op.logId });
      } catch (err) {
        if (transient(err)) {
          op.uop.delayed = true;
          return "offline";
        }
        stopResolving(op);
        if (refusedAsStale(err)) {
          // Already undone (an earlier undo whose reply was lost) is fine;
          // anything else is told.
          changed();
          await refresh();
          const item = find(op.kind, op.id);
          if (!(item && item[FLAG[op.kind]])) state.notice = (err && err.message) || STALE;
          if (historyLoaded) await loadHistory();
        } else {
          state.notice = UNDO_FAILED;
          await refresh();
        }
        return "done";
      }
      confirm(op.kind, r.data[op.kind]);
      stepRev(r.rev);
      stopResolving(op);
      return "done";
    } finally {
      saveCache();
      changed();
    }
  }

  // Takes an add back: forgotten when it provably never left the phone,
  // otherwise resolved as add-then-undo on the next contact.
  function takeBack(op) {
    removeOp(op);
    if (!mayHaveLanded(op)) {
      saveQueue();
      changed();
      return Promise.resolve();
    }
    startResolving(op);
    changed();
    return enqueue(chainKey(op.kind, op.id), () => finishUndo(op, false));
  }

  // A settled write whose effect on the backend this phone cannot tell from
  // its reply: no reply at all, or "nothing changed" (an earlier unconfirmed
  // write, or another phone, had already done it).
  const unsure = (op) => !isAdd(op) && op.logId === null && (op.lost || op.noop);

  function undo(token) {
    const op = writes.get(token);
    if (!op || op.undone) return Promise.resolve();
    op.undone = true;
    if (isAdd(op)) {
      state.lastChange = { token: newId(), action: "undo", kind: op.kind, item: bare(undoneView(op, bare(find(op.kind, op.id)))), canUndo: false };
      return takeBack(op);
    }
    if (!ops.includes(op) && unsure(op)) {
      // Nothing is shown as undone until the backend says what there is to undo.
      return enqueue(chainKey(op.kind, op.id), () => undoUnsure(op, true));
    }
    const shownBefore = bare(find(op.kind, op.id));
    state.lastChange = { token: newId(), action: "undo", kind: op.kind, item: bare(undoneView(op, shownBefore)), canUndo: false };
    const uop = { kind: op.kind, id: op.id, status: "sending", view: (cur) => undoneView(op, cur) };
    ops.push(uop);
    changed();
    return enqueue(chainKey(op.kind, op.id), async () => {
      if (op.logId === null) {
        removeOp(uop);
        changed();
        // The write turned out unsure: settle it against the backend.
        if (unsure(op)) return undoUnsure(op, true);
        // the write never landed: nothing to undo
        return;
      }
      try {
        const r = await call("undo", { logId: op.logId });
        removeOp(uop);
        confirm(op.kind, r.data[op.kind]);
        stepRev(r.rev);
        saveCache();
        // An undone tick that left something in the planner says so (a new line on the bar).
        const left = op.kind === "todo" ? untickOutcome(shownBefore, r.data) : null;
        if (left) state.lastChange = { token: newId(), action: "undo", kind: "todo", item: copy(r.data.todo), canUndo: false, planner: left };
      } catch (err) {
        removeOp(uop);
        op.undone = false;
        if (refusedAsStale(err)) {
          await showBackendAfterRefusedUndo(err);
          return;
        }
        if (fateUnknown(err)) wantReload();
        state.notice = fateUnknown(err) ? UNCONFIRMED : refusedWords(err);
      }
      changed();
    });
  }

  // An undo the backend refused with its own sentence says that sentence
  // (tickets, fix round 1, minor 12: "A stop can hold at most 8 …").
  function refusedWords(err) {
    return err && err.code === "bad_input" && typeof err.message === "string" && err.message ? err.message : UNDO_FAILED;
  }

  const plainVal = (v) => JSON.stringify(typeof v === "string" ? v.trim() : v);
  const sameAs = (item, fields) => Object.keys(fields).every((k) => plainVal(item[k]) === plainVal(fields[k]));

  // Undo of an unsure write (runs on the item's chain). With `load`, first
  // loads so the screen and the decision use what the backend holds; without
  // a contact it waits for the next one (afterContact calls back with
  // load = false, just after a load).
  async function undoUnsure(op, load) {
    if (load && !(await refresh())) {
      unsureUndos.push(op);
      return;
    }
    const item = base ? (base[LIST[op.kind]] || []).find((x) => keyOf(op.kind, x) === op.id) || null : null;
    // A stop add (the only add that comes here: it is not resent like a
    // queued one) has no patch: it landed when the backend has its id, which
    // only this phone could have made.
    const isNew = !op.before;
    const landed = !!item && (isNew || sameAs(item, op.patch));
    if (isNew ? !item : item && !landed && sameAs(item, pick(op.before, op.patch))) {
      // The change is not on the backend: there is nothing to undo.
      done(item || { ...op.after, [FLAG[op.kind]]: true });
      return;
    }
    let entries;
    try {
      entries = (await call("history", { ref: op.id })).data.entries;
    } catch (err) {
      if (transient(err)) unsureUndos.push(op);
      else failed();
      return;
    }
    const top = entries.filter((e) => e.kind === op.kind).sort((a, b) => b.id - a.id)[0];
    const ours = landed && top && top.action === op.action && top.who === op.actor && top.undoneBy === null && top.canUndo;
    if (!ours) {
      failed();
      return;
    }
    let r;
    try {
      r = await call("undo", { logId: top.id });
    } catch (err) {
      op.undone = false;
      if (refusedAsStale(err)) {
        await showBackendAfterRefusedUndo(err);
        return;
      }
      if (fateUnknown(err)) wantReload();
      failed();
      return;
    }
    confirm(op.kind, r.data[op.kind]);
    stepRev(r.rev);
    saveCache();
    done(r.data[op.kind]);
    if (historyLoaded) await loadHistory();

    function done(shown) {
      state.lastChange = { token: newId(), action: "undo", kind: op.kind, item: copy(shown), canUndo: false };
      changed();
    }
    function failed() {
      op.undone = false;
      state.notice = UNDO_FAILED;
      changed();
    }
  }

  function pick(from, keysOf) {
    const out = {};
    for (const k of Object.keys(keysOf)) out[k] = from ? from[k] : undefined;
    return out;
  }

  function retry(id) {
    const op = ops.find((o) => o.api === "addExpense" && o.id === id && o.status === "failed" && !o.undone);
    if (!op) return Promise.resolve();
    op.status = "sending";
    saveQueue();
    changed();
    return send(op);
  }

  const unsavedAdd = (id) => ops.find((o) => isLiveQueuedAdd(o) && o.id === id);

  // Lines and stamps the backend does not have yet: `unsent` counts every
  // one still to go (sending or waiting, not refused); `waiting` those held
  // on the phone for the next contact.
  // Something is on its way to the backend, or waiting its turn: an edit, an
  // undo, a stop, a picture, a line. A reload now could drop it (only lines
  // and stamps are kept on the phone until they land).
  function busy() {
    return chains.size > 0 || flushing !== null || ops.some((o) => o.status === "sending");
  }

  function outbox() {
    const live = ops.filter((o) => isLiveAdd(o) && o.status !== "failed");
    return { unsent: live.length, waiting: live.filter((o) => o.status === "queued").length };
  }

  // A line that is still pending or failed, with no way forward: take it back
  // and say "Undone." on the undo bar, as undo does. A confirmed line is left
  // alone (false).
  function discard(id) {
    const op = unsavedAdd(id);
    if (!op) return false;
    op.undone = true;
    const lc = state.lastChange;
    if (lc && lc.token === op.token) {
      state.lastChange = { token: newId(), action: "undo", kind: op.kind, item: bare(op.after), canUndo: false };
    }
    takeBack(op);
    return true;
  }

  // Sends queued lines, then finishes undos left open. One pass at a time.
  function flush() {
    if (flushing) return flushing;
    if (dropStalePresses()) changed();
    flushing = (async () => {
      for (const op of ops.slice()) {
        if (!isAdd(op) || op.status !== "queued") continue;
        if (op.undone || !ops.includes(op)) continue; // undone since the pass began
        await send(op);
        if (op.status === "queued" && !op.undone) return; // still no signal
      }
      for (const op of resolving.slice()) {
        if (!op.resolving) continue;
        const result = await enqueue(chainKey(op.kind, op.id), () => finishUndo(op, true));
        if (result === "offline") return;
      }
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  async function setPerson(name, patch) {
    const before = find("person", name);
    if (!before) return false;
    const op = { kind: "person", id: name, status: "sending", view: (cur) => (cur ? { ...cur, ...patch } : null) };
    ops.push(op);
    changed();
    return enqueue(chainKey("person", name), async () => {
      let ok = false;
      try {
        const r = await call("setPerson", { name, patch: copy(patch) });
        confirm("person", r.data.person);
        if (Object.keys(patch).some((k) => before[k] !== patch[k])) stepRev(r.rev);
        saveCache();
        ok = true;
      } catch (err) {
        state.notice = failNotice(err);
      }
      removeOp(op);
      changed();
      return ok;
    });
  }

  // The Claude connector's token, for Settings to put into a link. Resolves
  // with it, or rejects with the call's error (.code "network" for no
  // signal). Kept nowhere: not in state, storage or the cache.
  async function claudeToken() {
    const r = await call("claudeLink", {});
    const token = r && r.data ? r.data.token : null;
    if (typeof token === "string" && token) return token;
    const err = new Error("The trip sheet sent back something unexpected.");
    err.code = "server";
    throw err;
  }

  // ---- payments from the planner sheet ----

  // Asks the backend to bring in the planner's payments (R39): a plain call,
  // never queued. On success it reloads, so the lines are on the receipt, and
  // says what came in; resolves with the counts, or null when it did not
  // go through (the notice says why).
  async function syncPayments() {
    let r;
    try {
      r = await call("syncPayments", {});
    } catch (err) {
      state.notice = neverSent(err) ? NO_SIGNAL : failNotice(err);
      changed();
      return null;
    }
    const d = r.data;
    await refresh();
    state.notice = plannerNotice(d);
    changed();
    return { added: d.added, changed: d.changed, same: d.same, removed: d.removed, notCounted: d.notCounted, problems: d.problems, more: !!d.more, capped: !!d.capped };
  }

  // The planner's payments, asked for on their own while the app is open
  // (Mo, 2026-11-17: "needs to be updated more often"): at most once every
  // PAY_AUTO_MS on this phone, and not while the last pull by any phone (load
  // says when) is that recent; the backend holds to the same gap. Quiet: it
  // says something only when lines came in or changed. Resolves with the
  // counts, or null when it did not ask or it did not go through.
  let autoBusy = false;
  let autoAt = -Infinity;
  async function autoPayments() {
    if (autoBusy || state.status !== "ready" || state.plannerLinked !== true) return null;
    const t = now();
    const last = Date.parse(state.paymentsPulledAt || "");
    if (t - autoAt < PAY_AUTO_MS) return null;
    if (Number.isFinite(last) && t - last >= 0 && t - last < PAY_AUTO_MS) return null;
    autoBusy = true;
    autoAt = t;
    try {
      let r;
      try {
        r = await call("syncPayments", { auto: true });
      } catch (err) {
        // Never sent (no signal): ask again on the next look, not in 10 minutes.
        if (neverSent(err)) autoAt = -Infinity;
        return null;
      }
      const d = (r && r.data) || {};
      if (d.skipped) return null;
      // Cut short (ten at a time): carry on at the next look, not in 10 minutes.
      if (d.more) autoAt = -Infinity;
      // The list under Planner payments on You: brought up to date when it differs, without a word.
      const shown = (state.paymentProblems && state.paymentProblems.list) || [];
      const key = (l) => l.slice(0, 20).map((x) => x.id + "|" + x.row + "|" + x.message).join("\n");
      const stale = Array.isArray(d.problems) && (d.problems.length !== shown.length + ((state.paymentProblems && state.paymentProblems.more) || 0) || key(d.problems) !== key(shown));
      if (d.added || d.changed || stale) {
        await refresh();
        // Never over something already being said (a failed save matters more).
        if (!state.notice && (d.added || d.changed)) state.notice = plannerNotice(d);
        changed();
      }
      return { added: d.added, changed: d.changed, same: d.same, removed: d.removed, notCounted: d.notCounted, problems: d.problems, more: !!d.more, capped: !!d.capped };
    } finally {
      autoBusy = false;
    }
  }

  // ---- "Before we go": the planner's Book Now list ----

  // Brings the list in from the planner: a plain call, never queued. While
  // the backend says more rows remain it is asked again (force), up to
  // TODO_PULLS calls in a row. Resolves { ok: true, more, pulledAt, stored }
  // (stored: the backend answered with its stored list, read from the
  // planner at pulledAt) or { ok: false, code, message }; unless quiet, a
  // failure is said the usual way. An unfinished pull keeps the last fetched
  // time.
  async function syncTodos({ force = false, quiet = false } = {}) {
    let r = null;
    let more = false;
    // What the backend answered: into base (an unfinished pull keeps the last
    // fetched time). A real pull's problems replace the ones shown, kept as
    // the backend keeps them (at most 20, and how many more); a stored answer
    // leaves them alone.
    const keep = (got) => {
      const d = (got && got.data) || {};
      if (!base || !Array.isArray(d.todos)) return;
      const pulledAt = typeof d.pulledAt === "string" && d.pulledAt ? d.pulledAt : base.todosPulledAt || "";
      base = { ...base, todos: copy(d.todos), todosPulledAt: pulledAt };
      if (!d.stored && Array.isArray(d.problems)) {
        // This fetch's time (a pull cut short keeps the old pulledAt), each message cut to 160 as the backend stores it.
        const list = copy(d.problems.slice(0, 20)).map((p) => (p && typeof p.message === "string" ? { ...p, message: cutText(p.message, 160) } : p));
        base.todoProblems = { at: (typeof d.pulledAt === "string" && d.pulledAt) || new Date(now()).toISOString(), list, more: Math.max(0, d.problems.length - 20) };
      }
      saveCache();
    };
    try {
      for (let n = 0; n < TODO_PULLS; n++) {
        r = await call("syncTodos", { force: n === 0 ? force : true });
        more = !!(r.data && r.data.more);
        if (!more) break;
      }
    } catch (err) {
      // A later call failed: what the earlier ones brought in still counts.
      if (r) keep(r);
      if (!quiet) state.notice = neverSent(err) ? NO_SIGNAL : failNotice(err);
      changed();
      return { ok: false, code: codeOf(err), message: (err && err.message) || "" };
    }
    keep(r);
    changed();
    return { ok: true, more, pulledAt: state.todosPulledAt || "", stored: !!(r && r.data && r.data.stored) };
  }

  // A tick, shown at once (done, by me, now); the backend then tries to
  // write Booked into the planner.
  function tickTodo(id) {
    return change("todo", id, "tick", "tickTodo", { tickedBy: myName, tickedAt: new Date(now()).toISOString(), done: true });
  }

  // on: I take it (from anyone: "claim", or "takeover" from someone else);
  // off: I hand it back ("unclaim").
  function claimTodo(id, on) {
    const cur = find("todo", id);
    if (!cur) return null;
    const action = !on ? "unclaim" : cur.claimedBy && cur.claimedBy !== myName ? "takeover" : "claim";
    return change("todo", id, action, "claimTodo", { claimedBy: on ? myName : "" }, { args: { id, on: !!on } });
  }

  // ---- history ----

  let historySeq = 0; // numbers each first-page load
  // Resolves with what this load itself fetched, { entries, more, error },
  // even when a newer load has since replaced state.history (null when an
  // older page was asked for and there is none).
  async function loadHistory({ older = false } = {}) {
    const h = state.history;
    if (older && (!h.more || !h.entries.length)) return null;
    const seq = older ? historySeq : ++historySeq;
    // A first-page load starts clean: an error left by an earlier fetch is not shown over it.
    state.history = { ...h, loading: true, error: older ? h.error : null };
    emit();
    const args = older ? { before: h.entries[h.entries.length - 1].id } : {};
    let got;
    try {
      const r = await call("history", args);
      got = { entries: r.data.entries, more: !!r.data.more, error: null };
      // A first-page load started after this one has the newer say.
      if (seq !== historySeq) {
        changed();
        return got;
      }
      state.history = { entries: older ? h.entries.concat(r.data.entries) : r.data.entries, more: !!r.data.more, loading: false, error: null };
      historyLoaded = true;
    } catch (err) {
      got = { entries: [], more: false, error: codeOf(err) };
      if (seq !== historySeq) {
        changed();
        return got;
      }
      state.history = { ...state.history, loading: false, error: codeOf(err) };
    }
    changed();
    return got;
  }

  async function historyFor(ref) {
    try {
      const r = await call("history", { ref });
      return r.data.entries;
    } finally {
      changed();
    }
  }

  function undoEntry(logId) {
    const entry = state.history.entries.find((e) => e.id === logId);
    // A picture change belongs to its person: it waits behind their other changes.
    const key = entry ? chainKey(entry.kind === "picture" ? "person" : entry.kind, entry.ref) : "log:" + logId;
    return enqueue(key, async () => {
      const shownBefore = entry && entry.kind === "todo" ? bare(find("todo", entry.ref)) : null;
      let r;
      try {
        r = await call("undo", { logId });
      } catch (err) {
        if (refusedAsStale(err)) {
          await showBackendAfterRefusedUndo(err);
          return false;
        }
        // No reply: it may have been undone; the next contact shows which.
        state.notice = noReply(err) ? failNotice(err) : refusedWords(err);
        changed();
        return false;
      }
      // The kind the reply names: an expense, a payment, a stop, a stay or a
      // day; a picture's undo answers with its person (found by the second rule).
      const kind = r.data.entry && LIST[r.data.entry.kind] ? r.data.entry.kind : Object.keys(LIST).find((k) => r.data[k]);
      const item = r.data[kind];
      confirm(kind, item);
      stepRev(r.rev);
      saveCache();
      state.lastChange = { token: newId(), action: "undo", kind, item: copy(item), canUndo: false };
      // An undone tick that left something in the planner says so.
      const left = kind === "todo" ? untickOutcome(shownBefore, r.data) : null;
      if (left) state.lastChange.planner = left;
      const top = r.data.entry;
      const rest = state.history.entries.map((e) => {
        if (e.id === logId) return { ...e, undoneBy: r.data.logId, canUndo: false };
        if (e.kind === kind && e.ref === keyOf(kind, item)) return { ...e, canUndo: false };
        return e;
      });
      state.history = { ...state.history, entries: top ? [top, ...rest] : rest };
      changed();
      await loadHistory(); // the tape starts again from its first page, with whatever others did meanwhile
      return true;
    });
  }

  // ---- small settings ----

  function setMe(name) {
    // A phone on its own link is that person: no choice (security).
    if (state.personal) return;
    myName = name;
    setItem("mat.me", name);
    changed();
  }

  // You → Forget this phone (after app.js cleared the storage, the caches
  // and the worker): the same as a refused key, keeping nothing, and the
  // no-key screen says only that the phone needs a link.
  // How many entries not sent yet this phone holds (Forget this phone says so).
  function unsentCount() {
    return ops.filter(isLiveAdd).length + resolving.length;
  }

  function forgot() {
    takeTripOff({ keep: false });
    state.keyRefused = false;
    state.cleared = null;
    state.status = "nokey";
    emit();
  }

  function markSeen() {
    state.seenAt = now();
    setItem("mat.seen", String(state.seenAt));
    emit();
  }

  function notify(text) {
    state.notice = text;
    emit();
  }

  function clearNotice() {
    state.notice = null;
    emit();
  }

  // Resolves once every write, undo, flush and probe started so far has settled.
  async function idle() {
    const live = () => [...chains.values(), flushing, ...background].filter(Boolean);
    for (;;) {
      const pending = live();
      if (!pending.length) return;
      await Promise.all(pending);
      const after = live();
      if (after.length === pending.length && after.every((p, i) => p === pending[i])) return;
    }
  }

  return {
    state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    boot, refresh, checkRev, flush, idle,
    setMe, setPerson, markSeen, forgot, unsentCount, notify, clearNotice, claudeToken, syncPayments, autoPayments,
    syncTodos, tickTodo, claimTodo,
    pressStamp,
    addTicket, ticketOutcome, fetchTicket,
    removeTicket: (id) => takeBackLive("ticket", id) || change("ticket", id, "remove", "removeTicket", { gone: true }),
    addExpense,
    updateExpense: (id, patch) => change("expense", id, "edit", "updateExpense", patch),
    deleteExpense: (id) => takeBackLive("expense", id) || change("expense", id, "delete", "deleteExpense", { deleted: true }),
    restoreExpense: (id) => change("expense", id, "restore", "restoreExpense", { deleted: false }),
    addPayment,
    removePayment: (id) => takeBackLive("payment", id) || change("payment", id, "unstamp", "removePayment", { removed: true }),
    restorePayment: (id) => change("payment", id, "restamp", "restorePayment", { removed: false }),
    addStop,
    updateStop: (id, patch, opts) => change("stop", id, "edit", "updateStop", patch, opts),
    outcome,
    deleteStop: (id) => change("stop", id, "delete", "deleteStop", { deleted: true }),
    restoreStop: (id) => change("stop", id, "restore", "restoreStop", { deleted: false }),
    retry, discard, unsaved: (id) => !!unsavedAdd(id), outbox, busy, undo, undoEntry, loadHistory, historyFor,
  };
}
