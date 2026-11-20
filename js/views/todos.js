/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// "Before we go" (出発前): the bookings and prep from the planner's Book Now
// tab, printed on ticket stock on the Before tab (its own screen, between
// Days and Money).
//
// mountTodos(root, store, { clock, now, onState }) -> { el, shown() }
// - root: the Before screen (#vBefore); the list is drawn into it.
// - clock: the Days clock; before the trip's first day by it (in the trip's
//   zone) the tab is always there; from the first day on only while
//   something is open (showBeforeTab, js/todos.js). No planner linked, or no
//   items: no tab.
// - onState({ show, open }): told on every redraw whether the tab is in the
//   bar and how many items are open (a row just ticked, still stamped in
//   place, is not counted); the app draws the button and, when the tab goes
//   while it is showing, goes back to Days.
// - now(): the real time, for the due lines (counted on the Toronto
//   calendar, js/todos.js) and for when a fetch is due.
// - shown(): the app calls it each time the Before tab is shown: the done
//   group a tick opened is folded again, and the list is fetched quietly
//   when it is an hour old or more and the phone has signal (no spinner; a
//   notice only when that fails twice in a row). wake() does the fetch alone
//   (the app has started).
//
// Under the fetch line, "Not read from the planner": the items the last pull
// could not read (store.state.todoProblems), two lines each, hidden when
// there are none. Fetch says "Read 13:20" when the backend answered with
// the list it read then (a fetch within 30 seconds of the last).
//
// A row opens in place (as a ticket's stop does): the whole item, the note
// and the controls. Ticking is the settle stamp's moment: the same red 済
// lands where the tap was, with the same thud (and the same sound setting)
// once the store has taken the tick (never for one refused at once);
// the row stays where it was, stamped, until the backend has answered and a
// moment has passed, then moves to the done group, which opens to show it.
//
// The look is a pad of reservation slips (予約票): a binding across the top,
// each booking a slip with its counterfoil on the left (its number and who is
// on it, behind a dotted tear line), the done ones torn off below a dashed
// line (css/before.css). Only the look: every word and control is as before.
//
// Redrawing while someone is reading: a row that is drawn the same keeps its
// node, so the open row, focus and a stamp landing all survive a sync.
// Everything from the planner goes in with textContent; a link only through
// safeHref.

import { safeHref, tripNow } from "../plan.js";
import { fillSeal } from "../picture.js";
import { paidStampSVG } from "../stamp.js";
import { wetInk, rollingCount } from "../fx.js";
import { thud, primeSound } from "../sound.js";
import { clock as hhmm, localDay, dayHead } from "../format.js";
import { homeToday, slipNo, dueLine, byBookBy, doneTodos, isDone, plannerPending, tickedLine, isStale, showBeforeTab, todoProblemHead } from "../todos.js";

// How long a just-ticked row stays stamped in place, at the least.
const HOLD_MS = 1600;
// How long the Fetch control says how a fetch went.
const SAID_MS = 4000;
const FETCH = "Fetch";
const FETCHING = "Fetching…";
const FETCHED = "Up to date ✓";
const MORE = "More to fetch";
const NOT_FETCHED = "Not fetched";
const PROBLEMS = "Not read from the planner";
const PENDING = "The planner hasn’t been updated yet.";
const AUTO_FAILED = "Couldn’t fetch the list from the planner.";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function button(cls, text) {
  const b = el("button", cls, text);
  b.type = "button";
  return b;
}

const list = (v) => (Array.isArray(v) ? v : []);
const calm = () => !!(globalThis.matchMedia && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches);

// A whole number from an item's id, so its stamp looks the same every time.
function seedOf(id) {
  let h = 2166136261;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 999999) + 1;
}
const rotOf = (id) => (seedOf(id) % 201) / 10 - 13;

// What a row is drawn from, to tell whether a redraw changed it.
const drawn = new WeakMap();

export function mountTodos(root, store, { clock, now = () => Date.now(), onState = () => {} } = {}) {
  const section = el("section", "bw");
  section.id = "todos";
  section.hidden = true;
  section.setAttribute("aria-labelledby", "bwTitle");

  const card = el("div", "bw-card");
  card.id = "bwCard";
  const band = el("div", "bw-band");
  const title = el("h2", "bw-title");
  title.id = "bwTitle";
  title.append(el("span", "", "予約票"), el("i", "", "Reservation slips · Before we go"));
  const count = el("span", "num");
  band.append(title, count);
  const rows = el("div", "bw-rows");
  rows.id = "bwOpen";
  const perf = el("div", "bw-perf");
  const doneB = button("bw-dn");
  doneB.id = "bwDoneB";
  doneB.setAttribute("aria-controls", "bwDone");
  const doneBox = el("div", "bw-done");
  doneBox.id = "bwDone";
  const foot = el("div", "bw-foot");
  const at = el("span", "bw-at");
  at.id = "bwAt";
  const fetchB = button("bw-fetch", FETCH);
  fetchB.id = "bwFetch";
  fetchB.setAttribute("aria-live", "polite");
  foot.append(at, fetchB);
  const probs = el("div", "bw-pp");
  probs.id = "bwProblems";
  probs.hidden = true;
  const bind = el("div", "rv-bind");
  bind.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 6; i++) bind.append(el("i"));
  card.classList.add("rv");
  card.append(bind, band, rows, perf, doneB, doneBox, foot, probs);
  section.append(card);
  root.replaceChildren(section);

  let me = null;
  let personal = false; // on your own link nobody else's claim can be taken over (security, 2026-11-18)
  let people = [];
  let openId = null; // the row opened by hand
  let doneOpen = false;
  const landed = new Map(); // id -> { at } : ticked here, still shown stamped in place
  const openRoll = rollingCount(count); // "N open": a change after it has settled rolls in
  let hitId = null; // the row whose stamp is landing right now (drawn once with .hit)
  let focusLanded = null; // after a tick: where focus goes once the row is redrawn

  // ---- drawing ----

  function seal(name, empty = false) {
    const s = el("span", "bw-seal");
    s.setAttribute("aria-hidden", "true");
    if (empty || !name) {
      s.classList.add("is-empty");
      return s;
    }
    fillSeal(s, people.find((p) => p.name === name) || null, name);
    return s;
  }
  // The counterfoil: the slip's number, and who is on it.
  function stub(id, position, sealEl) {
    const st = el("div", "rv-stub");
    const no = el("i", "rv-no", slipNo(id, position));
    no.setAttribute("aria-hidden", "true");
    st.append(no, sealEl);
    return st;
  }
  const picKey = (name) => {
    const p = people.find((x) => x.name === name);
    const v = p && typeof p.photo === "string" ? p.photo : "";
    return v ? v.length + v.slice(-24) : "";
  };

  function dueEl(t, today) {
    const d = dueLine(t.bookBy, today);
    if (!d) return null;
    const line = el("span", "bw-due" + (d.state === "late" ? " is-late" : ""));
    line.dataset.due = d.state;
    line.append(d.lead + " ", d.strong ? el("b", "", d.date) : d.date, " · " + d.tail);
    return line;
  }

  const onText = (t) => (!t.claimedBy ? "" : t.claimedBy === me ? ", you’re on it" : ", " + t.claimedBy + " is on it");

  function openRow(t, today, position) {
    const r = el("div", "bw-r" + (t.pending ? " is-pending" : ""));
    r.dataset.id = t.id;
    const moreId = "bwm-" + t.id;
    const head = button("bw-b");
    head.dataset.act = "open";
    head.setAttribute("aria-controls", moreId);
    const label = el("span", "rv-l", "予約するもの Booking");
    label.setAttribute("aria-hidden", "true");
    head.append(label, el("span", "bw-n", t.item));
    const due = dueEl(t, today);
    if (due) head.append(due);
    if (t.claimedBy) head.append(el("span", "bw-vh", onText(t)));

    const more = el("div", "bw-more");
    more.id = moreId;
    const inner = el("div");
    if (t.note) inner.append(el("p", "bw-note", t.note));
    const ctl = el("div", "bw-ctl");
    // On the phone only a plain https address becomes a link.
    const safe = safeHref(t.link);
    const href = /^https:\/\//i.test(safe || "") ? safe : "";
    if (href) {
      const a = el("a", "r-map alt bw-link", "Open the booking ↗");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      a.setAttribute("aria-label", "Open the booking for " + t.item);
      ctl.append(a);
    }
    const mine = t.claimedBy && t.claimedBy === me;
    const word = mine ? "Hand it back" : t.claimedBy ? "Take it over" : "I’ll do it";
    const claim = button("r-edit bw-claim", word);
    claim.dataset.act = "claim";
    claim.dataset.on = mine ? "0" : "1";
    claim.setAttribute("aria-label", word + ": " + t.item);
    const tick = button("bw-tick");
    tick.dataset.act = "tick";
    tick.setAttribute("aria-label", "Tick it off: " + t.item);
    const spot = el("span", "bw-spot");
    spot.append(el("span", "ghost", "済"));
    tick.append(el("span", "bw-tick-t", "Tick it off"), spot);
    // On your own link someone else's claim is theirs: no Take it over.
    if (personal && t.claimedBy && !mine) ctl.append(tick);
    else ctl.append(claim, tick);
    inner.append(ctl);
    more.append(inner);
    r.append(stub(t.id, position, seal(t.claimedBy, !t.claimedBy)), head, more);
    drawn.set(r, JSON.stringify(["o", t.id, slipNo(t.id, position), t.item, t.bookBy, today, t.note, href, t.claimedBy, me, personal, picKey(t.claimedBy), !!t.pending]));
    return r;
  }

  // A row just ticked here: stamped where the tap was, open, no controls.
  function landedRow(t, position) {
    const r = el("div", "bw-r is-open is-landed");
    r.dataset.id = t.id;
    const head = el("div", "bw-b");
    head.append(el("span", "bw-n", t.item), el("span", "bw-due", tickedLine(t)));
    const more = el("div", "bw-more");
    const inner = el("div");
    const ctl = el("div", "bw-ctl");
    const pl = el("p", "bw-pl", PENDING);
    pl.hidden = !plannerPending(t);
    const spot = el("span", "bw-tick is-stamped");
    spot.tabIndex = -1;
    spot.setAttribute("role", "img");
    spot.setAttribute("aria-label", "Ticked off: " + t.item);
    const box = el("span", "bw-spot");
    const stamp = el("div", hitId === t.id && !calm() ? "stamp hit" : "stamp");
    stamp.style.setProperty("--rot", rotOf(t.id) + "deg");
    // Built only from numbers and constants (js/stamp.js), so innerHTML is safe.
    stamp.innerHTML = paidStampSVG(seedOf(t.id));
    box.append(stamp);
    if (stamp.classList.contains("hit")) wetInk(stamp); // just landed: still wet (js/fx.js)
    spot.append(box);
    ctl.append(pl, spot);
    inner.append(ctl);
    more.append(inner);
    r.append(stub(t.id, position, seal(t.tickedBy)), head, more);
    // Drawn once: only the pending line changes in place after that.
    drawn.set(r, JSON.stringify(["l", t.id, slipNo(t.id, position)]));
    return r;
  }

  function doneRow(t, position) {
    const r = el("div", "bw-d");
    r.dataset.id = t.id;
    const main = el("div", "bw-dm");
    main.append(el("span", "bw-n", t.item), el("span", "bw-due", tickedLine(t)));
    if (plannerPending(t)) main.append(el("p", "bw-pl", PENDING));
    const mark = t.tickedBy ? seal(t.tickedBy) : el("span", "bw-seal is-booked", "済");
    mark.setAttribute("aria-hidden", "true");
    r.append(stub(t.id, position, mark), main);
    drawn.set(r, JSON.stringify(["d", t.id, slipNo(t.id, position), t.item, tickedLine(t), plannerPending(t), picKey(t.tickedBy)]));
    return r;
  }

  // Puts `fresh` into `box` in order, keeping each node drawn the same. A
  // stamped row keeps its node; only its pending line follows the data.
  function patch(box, fresh) {
    const old = new Map();
    for (const n of box.children) if (n.dataset.id) old.set(n.dataset.id + (n.classList.contains("bw-d") ? ":d" : ""), n);
    const want = fresh.map((n) => {
      const keep = n.dataset.id ? old.get(n.dataset.id + (n.classList.contains("bw-d") ? ":d" : "")) : null;
      if (!keep || drawn.get(keep) !== drawn.get(n)) return n;
      if (keep.classList.contains("is-landed")) {
        const was = keep.querySelector(".bw-pl");
        const now = n.querySelector(".bw-pl");
        if (was && now) was.hidden = now.hidden;
      }
      return keep;
    });
    want.forEach((node, i) => {
      const here = box.children[i];
      if (here !== node) box.insertBefore(node, here || null);
    });
    while (box.children.length > want.length) box.lastElementChild.remove();
  }

  function applyOpen() {
    for (const r of rows.querySelectorAll(".bw-r:not(.is-landed)")) {
      const on = r.dataset.id === openId;
      if (r.classList.contains("is-open") !== on) r.classList.toggle("is-open", on);
      const b = r.querySelector(".bw-b");
      if (b) b.setAttribute("aria-expanded", String(on));
      const more = r.querySelector(".bw-more");
      if (more) more.inert = !on;
    }
  }

  // Where focus is in the list, to put it back if a redraw replaced its node.
  function focusSpot() {
    const a = document.activeElement;
    if (!a || !section.contains(a)) return null;
    const r = a.closest("[data-id]");
    return { node: a, id: r ? r.dataset.id : null, act: a.dataset.act || null };
  }
  function restoreFocus(spot) {
    if (!spot || spot.node.isConnected) return;
    let target = null;
    if (spot.id) {
      const r = rows.querySelector('[data-id="' + CSS.escape(spot.id) + '"]');
      if (r) target = (spot.act && r.querySelector('[data-act="' + spot.act + '"]')) || r.querySelector(".bw-b, .bw-tick");
    }
    if (target && typeof target.focus === "function") target.focus({ preventScroll: true });
  }

  // Before the trip's first day, by the Days clock (plan.js tripNow).
  function beforeTrip(s) {
    const trip = s.trip;
    if (!trip || typeof trip.start !== "string" || !trip.start) return true;
    return tripNow(s, clock ? clock.now() : now()).date < trip.start;
  }

  // "13:20" today, "Dec 3, 13:20" another day: the phone's own clock.
  function whenText(ms) {
    const day = localDay(ms);
    return day === localDay(now()) ? hhmm(ms) : dayHead(day, []).en.split(" ").slice(1).join(" ") + ", " + hhmm(ms);
  }

  function fetchedText(s) {
    const ms = Date.parse(typeof s.todosPulledAt === "string" ? s.todosPulledAt : "");
    if (!isFinite(ms)) return "From the planner";
    return "From the planner · fetched " + whenText(ms);
  }

  // The items the last pull could not read. Planner text is untrusted:
  // textContent only. Redrawn only when the list changes, so a screen
  // reader is not read it again on every store change.
  let shownProblems = null;
  function drawProblems(s) {
    const tp = s.todoProblems && typeof s.todoProblems === "object" ? s.todoProblems : {};
    const all = list(tp.list).filter((p) => p && typeof p === "object");
    const more = Number.isFinite(tp.more) && tp.more > 0 ? tp.more : 0;
    const key = all.length ? JSON.stringify([tp.at, all, more]) : "";
    probs.hidden = !all.length;
    if (key === shownProblems) return;
    shownProblems = key;
    probs.replaceChildren();
    if (!all.length) return;
    const head = el("div", "bw-pp-h", PROBLEMS);
    const ms = Date.parse(typeof tp.at === "string" ? tp.at : "");
    if (isFinite(ms)) head.append(el("small", "", whenText(ms)));
    probs.append(head);
    for (const p of all) {
      const one = el("div", "bw-pp-i");
      one.append(el("div", "bw-pp-w", todoProblemHead(p)), el("div", "bw-pp-m", typeof p.message === "string" ? p.message : ""));
      probs.append(one);
    }
    if (more) probs.append(el("div", "bw-pp-more", "and " + more + " more"));
  }

  function render() {
    const s = store.state;
    me = s.me;
    personal = s.personal === true;
    people = list(s.people);
    const todos = list(s.todos).filter((t) => t && typeof t.id === "string" && t.id && typeof t.item === "string");
    // A row put back (a refused tick, an undo) is no longer stamped.
    for (const id of [...landed.keys()]) {
      const t = todos.find((x) => x.id === id);
      if (!t || !isDone(t)) landed.delete(id);
    }
    // The trip was taken off this phone: the list goes, with every word of it.
    if (s.status === "nokey") {
      landed.clear();
      openId = null;
      hitId = null;
      doneOpen = false;
      shownProblems = null;
      for (const box of [rows, doneBox, probs, count]) box.replaceChildren();
      doneB.textContent = "";
      at.textContent = "";
    }
    const ready = s.status === "ready" && s.plannerLinked === true && todos.length > 0;
    const before = ready && beforeTrip(s);
    const shownOpen = byBookBy(todos.filter((t) => !isDone(t) || landed.has(t.id)));
    const stillOpen = shownOpen.filter((t) => !landed.has(t.id)).length;
    // A row still stamped in place counts as shown, so the tab stays until its stamp has moved on.
    const show = showBeforeTab({ loaded: ready, beforeTrip: before, openCount: shownOpen.length });
    // The app puts the person on Days if this was their screen, then focus can follow.
    onState({ show, open: stillOpen });
    if (!show) {
      // Focus in the list goes to the day counter before the list goes.
      if (!section.hidden && section.contains(document.activeElement)) {
        const head = document.getElementById("dayCount");
        if (head) head.focus({ preventScroll: true });
      }
      section.hidden = true;
      focusLanded = null;
      return;
    }
    const spot = focusSpot();
    section.hidden = false;
    count.replaceChildren(String(stillOpen), el("small", "", "open"));
    openRoll.set(stillOpen);

    const today = homeToday(now());
    const fresh = shownOpen.map((t, i) => (landed.has(t.id) ? landedRow(t, i) : openRow(t, today, i)));
    if (!fresh.length) {
      const none = el("div", "bw-none");
      none.dataset.id = "-";
      none.append(el("b", "", "済"), " All done. Nothing left to book.");
      drawn.set(none, "none");
      fresh.push(none);
    }
    patch(rows, fresh);
    hitId = null;
    if (openId && !shownOpen.some((t) => t.id === openId && !landed.has(t.id))) openId = null;
    applyOpen();

    const done = doneTodos(todos.filter((t) => !landed.has(t.id)));
    doneB.hidden = !done.length;
    perf.hidden = !done.length;
    doneB.textContent = "済 Torn off and done (" + done.length + ")";
    doneB.setAttribute("aria-expanded", String(doneOpen && done.length > 0));
    doneBox.hidden = !(doneOpen && done.length);
    patch(doneBox, done.map((t, i) => doneRow(t, i)));

    at.textContent = fetchedText(s);
    drawProblems(s);
    restoreFocus(spot);
    if (focusLanded) {
      const target = focusLanded === "done" ? doneB : rows.querySelector('[data-id="' + CSS.escape(focusLanded) + '"] .bw-tick');
      if (target && !target.hidden) target.focus({ preventScroll: true });
      focusLanded = null;
    }
  }

  // A stamped row moves on once the backend has answered and HOLD_MS passed.
  function release() {
    const s = store.state;
    let moved = false;
    for (const [id, l] of landed) {
      const t = list(s.todos).find((x) => x && x.id === id);
      // The store has taken the tick: now the thud.
      if (l.sound && t && isDone(t) && !t.pending) {
        l.sound = false;
        thud();
      }
      if (t && !t.pending && now() - l.at >= HOLD_MS) {
        landed.delete(id);
        moved = true;
      }
    }
    if (moved) {
      doneOpen = true;
      const a = document.activeElement;
      if (a && rows.contains(a)) focusLanded = "done";
    }
    return moved;
  }

  function draw() {
    release();
    render();
  }

  // ---- acting ----

  function tick(id) {
    const t = list(store.state.todos).find((x) => x && x.id === id);
    if (!t || isDone(t)) return;
    landed.set(id, { at: now(), sound: true });
    primeSound();
    hitId = id;
    focusLanded = id;
    openId = null;
    const token = store.tickTodo(id); // draws the row stamped (via the store's change)
    if (!token) {
      landed.delete(id);
      hitId = null;
      focusLanded = null;
      render();
      return;
    }
    setTimeout(draw, HOLD_MS);
  }

  section.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t.closest("#bwDoneB")) {
      doneOpen = !doneOpen;
      render();
      return;
    }
    if (t.closest("#bwFetch")) {
      fetchNow();
      return;
    }
    const act = t.closest("[data-act]");
    if (!act || !rows.contains(act)) return;
    const r = act.closest(".bw-r[data-id]");
    if (!r) return;
    const id = r.dataset.id;
    if (act.dataset.act === "open") {
      openId = openId === id ? null : id;
      applyOpen();
    } else if (act.dataset.act === "claim") {
      store.claimTodo(id, act.dataset.on === "1");
    } else if (act.dataset.act === "tick") {
      tick(id);
    }
  });
  // iPhone Safari draws a pressed look (:active) on touch only when something listens.
  section.addEventListener("touchstart", () => {}, { passive: true });

  // ---- fetching ----

  let pull = null; // the fetch under way, if any
  let fails = 0; // quiet fetches failed in a row
  let sayTimer = null;
  function say(text, ms = 0) {
    clearTimeout(sayTimer);
    fetchB.textContent = text;
    if (ms) sayTimer = setTimeout(() => (fetchB.textContent = FETCH), ms);
  }

  async function fetchNow() {
    if (fetchB.disabled) return;
    fetchB.disabled = true;
    say(FETCHING);
    let r;
    try {
      // A quiet fetch under way finishes first; the tap still gets its own.
      if (pull) await pull;
      r = await store.syncTodos({ force: true });
    } catch {
      r = { ok: false };
    }
    fetchB.disabled = false;
    if (r.ok) fails = 0;
    // The backend's stored list (read within the last 30 seconds): when it was read, not "Up to date".
    const readAt = r.ok && r.stored ? Date.parse(r.pulledAt || "") : NaN;
    say(!r.ok ? NOT_FETCHED : r.more ? MORE : isFinite(readAt) ? "Read " + whenText(readAt) : FETCHED, SAID_MS);
  }

  const online = (s) => s.online !== false && !(globalThis.navigator && globalThis.navigator.onLine === false);

  // Fetch quietly when the list is an hour old or more (once per call).
  function wake() {
    const s = store.state;
    if (pull || s.status !== "ready" || s.plannerLinked !== true || !online(s)) return;
    if (!isStale(s.todosPulledAt, now())) return;
    pull = store.syncTodos({ quiet: true });
    pull.then((r) => {
      pull = null;
      if (r && r.ok) {
        fails = 0;
        return;
      }
      fails += 1;
      if (fails >= 2) {
        fails = 0;
        const refused = r && r.code && r.code !== "network" && r.code !== "server" && r.message;
        store.notify(refused ? r.message : AUTO_FAILED);
      }
    });
  }

  // Each time the Before tab is shown (js/app.js).
  function shown() {
    // The done group a tick opened is folded again on coming back.
    if (doneOpen) {
      doneOpen = false;
      render();
    }
    wake();
  }

  store.subscribe(draw);
  if (clock && clock.subscribe) clock.subscribe(draw);
  draw();

  return { el: section, wake, shown };
}
