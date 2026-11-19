/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The settlement slip (旅費精算書): who pays whom right now, the stamp spot on
// each open transfer, stamped payments (newest first, folded beyond two),
// show the working, the routing sentence, the e-Transfer address, Remind and
// the Simplify switch.
//
// mountSlip(el, store) draws into el and redraws on store changes, but only
// when what it shows has changed, so a stamp's hit is not restarted and a
// half-typed amount keeps its place. Names and addresses go in as
// textContent; the stamp's SVG is built from numbers only (js/stamp.js).
//
// remindText and sentCents are pure, and nothing here touches the DOM at
// import time, so tests import this module in Node.

import { owedList, direct, routedVia, balances } from "../money.js";
import { dollars, pt, dayHead, localDay, tripSpan, issuer } from "../format.js";
import { paidStampSVG, boxSealSVG } from "../stamp.js";
import { wetInk, WET_MS } from "../fx.js";
import { thud } from "../sound.js";
import { drawWorking, routeSentence } from "./working.js";
import { copyText } from "../clip.js";

const ARM_MS = 8000;
// Settling (mock-up 2B): the last stamp lands, SEAL_MS later the square seal
// lands on the head, FILE_MS after that the slip folds to its filed line.
const SEAL_MS = 520;
const FILE_MS = 1100;
const FOLD = 2;
const MAX_CENTS = 10000000; // $100,000, the backend's limit
const ASK = "Pay each person directly? You’ll make more payments. The totals are the same.";
const ENTER = "Enter what was sent.";
const SENDING = "Sending…";

// "250", "250.3", "250.30", "250,30" (a decimal comma, as some keypads type)
// or ".5" -> cents; anything else, zero or too much -> null. Read on the
// string: no floating point.
export function sentCents(str) {
  const m = /^(\d{0,6})(?:[.,](\d{1,2}))?$/.exec(String(str).trim());
  if (!m || (m[1] === "" && m[2] === undefined)) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0"));
  return cents > 0 && cents <= MAX_CENTS ? cents : null;
}

const plain = (cents) => Math.floor(cents / 100) + "." + String(cents % 100).padStart(2, "0");

// The message Remind hands to the share sheet.
export function remindText(me, transfer, people) {
  const mine = (people || []).find((p) => p.name === me);
  const address = mine && mine.etransfer ? String(mine.etransfer).trim() : "";
  return transfer.from + ", you owe me " + dollars(transfer.cents) + " for the Japan trip." + (address ? " e-Transfer: " + address : "");
}

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

// The slip is settled when nothing is left open and something was stamped:
// { count, cents, day, seed } (day: the newest stamp's, on the phone's own
// calendar; seed: its stamp's, for the seal), else null.
// `stamps`: the payments not removed, newest first.
export function settledOf(open, stamps) {
  if (open.length || !stamps.length) return null;
  const ms = Date.parse(stamps[0].stampedAt);
  return {
    count: stamps.length,
    cents: stamps.reduce((a, p) => a + Math.round(p.cad * 100), 0),
    day: localDay(isFinite(ms) ? ms : Date.now()),
    seed: stamps[0].seed,
  };
}

// The filed slip's one line: "Settled Sat Dec 19" / "2 payments, $500.00 in all".
export function filedText(st) {
  return {
    head: "Settled " + dayHead(st.day, []).en,
    sub: st.count + (st.count === 1 ? " payment, " : " payments, ") + dollars(st.cents) + " in all",
  };
}

const COUNT = ["", "One person", "Two people", "Three people", "Four people", "Five people", "Six people", "Seven people", "Eight people", "Nine people", "Ten people"];

// The voucher's 但 line (what it is for): "Japan, Dec 10 to 20, 2026. Three people."
// Text from the Sheet: it goes on the page with textContent only.
export function purposeLine(trip, people) {
  const n = people.length;
  const name = trip && trip.name ? String(trip.name) : "";
  const year = trip && trip.end ? trip.end.slice(0, 4) : "";
  // The year once: after the dates, unless the trip's name already has it.
  const when = trip && trip.start && trip.end ? tripSpan(trip) + (name.includes(year) ? "" : ", " + year) : "";
  const what = [name, when].filter(Boolean).join(", ");
  const who = COUNT[n] || n + " people";
  return (what ? what + ". " : "") + who + ".";
}

// The voucher's number: the payments stamped so far, and this one.
export const voucherNo = (stamps) => "No." + String(stamps + 1).padStart(4, "0");

const keyOf = (t) => t.from + ">" + t.to;
const centsOf = (p) => Math.round(p.cad * 100);
const calm = () => !!(globalThis.matchMedia && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches);
const newestFirst = (a, b) => (a.stampedAt === b.stampedAt ? 0 : String(b.stampedAt || "") < String(a.stampedAt || "") ? -1 : 1);

// The viewer's reading of who owes whom, under their own Simplify setting:
// The one source for both the slip and
// the sentence at the top of Money (#say), so they cannot disagree.
export function viewerOwed(s) {
  const names = s.people.map((p) => p.name);
  const live = s.expenses.filter((e) => !e.deleted);
  const mine = s.people.find((p) => p.name === s.me);
  const simplify = mine ? mine.simplify !== false : true;
  const provisional = !!s.settlementProvisional;
  return { names, live, simplify, provisional, list: owedList(names, live, s.payments, simplify), bal: balances(names, live, s.payments) };
}

// What the slip shows, from the store's state. null: nothing to show yet.
function read(s) {
  if (!s.trip || !s.trip.start || !s.people.length) return null;
  const { names, live, simplify, provisional, list } = viewerOwed(s);
  const directList = simplify ? direct(names, live, s.payments) : list;
  const open = list.map((t) => ({ ...t, key: keyOf(t), via: simplify ? routedVia(t, directList, names) : null }));
  const stamps = s.payments.filter((p) => !p.removed).sort(newestFirst);
  const address = Object.fromEntries(s.people.map((p) => [p.name, p.etransfer ? String(p.etransfer).trim() : ""]));
  return { me: s.me, simplify, provisional, people: s.people, live, payments: s.payments, open, stamps, address, purpose: purposeLine(s.trip, s.people), mark: issuer(s.people) };
}

export function mountSlip(slip, store) {
  // What this phone is doing on the slip; never saved.
  // typed: the amount was changed by hand, so a sync must not overwrite it.
  const ui = { armed: null, amt: "", typed: false, err: false, work: null, lines: false, rm: null, older: false, ask: false };
  let fresh = new Set(); // payment ids to draw with the hit, once
  let armTimer = null;
  const notice = el("p", "slip-provisional", "Provisional. Some changes haven’t synced. Check the amount again before sending money.");
  notice.id = "slipProvisional";
  let shown = null; // signature of the last drawing
  let view = null;
  // The settled seal. phase: null (not settled), "stamped" (the last stamp
  // has just landed here; the seal is on its way), "sealed" (the seal is on
  // the head, the slip not filed yet) or "filed". unfiled: Open was tapped.
  // land: draw the seal landing, once.
  const seal = { phase: null, unfiled: false, land: false };
  let sealTimers = [];

  function disarm() {
    clearTimeout(armTimer);
    armTimer = null;
    ui.armed = null;
    ui.err = false;
  }

  function startTimer() {
    clearTimeout(armTimer);
    armTimer = setTimeout(() => {
      disarm();
      draw();
    }, ARM_MS);
  }

  function shake() {
    slip.classList.remove("shake");
    void slip.offsetWidth; // play the shake again
    slip.classList.add("shake");
  }

  function clearSeal() {
    sealTimers.forEach(clearTimeout);
    sealTimers = [];
  }

  // Follows the slip into and out of being settled. Settled when first drawn
  // (or after a reload): filed at once. Settled while on screen: the seal
  // lands, then the slip is filed; with reduced motion it is simply filed.
  function track(before, v) {
    const st = v && settledOf(v.open, v.stamps);
    if (!st) {
      clearSeal();
      Object.assign(seal, { phase: null, unfiled: false, land: false });
      return;
    }
    if (seal.phase) return;
    if (!(before && before.open.length) || calm()) {
      seal.phase = "filed";
      return;
    }
    seal.phase = "stamped";
    sealTimers.push(setTimeout(() => {
      seal.phase = "sealed";
      seal.land = true;
      draw();
      thud();
      shake();
      sealTimers.push(setTimeout(() => {
        seal.phase = "filed";
        fileClasses();
      }, FILE_MS));
    }, SEAL_MS));
  }

  // Filed or not is a class on the slip, so the fold plays between the two.
  function fileClasses() {
    const filed = seal.phase === "filed" && !seal.unfiled;
    slip.classList.toggle("is-filed", filed);
    const inner = slip.querySelector(".fold > div");
    if (inner) inner.inert = filed;
  }

  // ---- drawing ----

  const who = (v, name, cap) => (name === v.me ? (cap ? "You" : "you") : name);

  function paidDay(v, p) {
    const ms = Date.parse(p.stampedAt);
    // The day a stamp was made is the time of a change: the phone's own zone, not the trip's.
    if (!isFinite(ms)) return "Paid.";
    return "Paid " + dayHead(localDay(ms), []).en + ".";
  }

  function openRow(v, t) {
    const armed = ui.armed === t.key;
    const row = el("div", "s-row is-open");
    row.dataset.key = t.key;
    const left = el("div", "s-l");
    left.append(el("div", "s-who", who(v, t.from, true) + " → " + who(v, t.to)));
    if (armed) {
      const amt = el("label", "s-amt is-edit");
      const input = el("input");
      input.id = "stampAmt";
      input.type = "text";
      input.inputMode = "decimal";
      input.autocomplete = "off";
      input.setAttribute("aria-label", "Amount sent, in dollars");
      input.value = ui.amt;
      amt.append(el("span", "s-cur", "$"), input);
      left.append(amt);
      const sub = el("div", "s-sub");
      if (ui.err) sub.append(el("span", "s-err", ENTER));
      else sub.textContent = "Did " + (t.to === v.me ? "it land" : t.to + " get it") + "? Tap again to stamp.";
      left.append(sub);
    } else {
      const amt = button("s-amt");
      amt.innerHTML = pt(dollars(t.cents)); // pt() escapes before adding its spans
      amt.setAttribute("aria-expanded", String(ui.work === t.key));
      left.append(amt);
    }
    if (t.via) left.append(el("p", "s-route", routeSentence(t, t.via, v.me)));
    if (v.me && t.to === v.me && t.from !== v.me) {
      const r = button("remind", "Remind");
      r.dataset.key = t.key;
      left.append(r);
    }
    const spot = button("spot" + (armed ? " is-armed" : ""));
    spot.dataset.key = t.key;
    spot.setAttribute("aria-label", armed ? "Tap again to stamp it paid" : "Stamp " + t.from + " to " + t.to + " as paid");
    spot.append(el("span", "ghost", "済"));
    row.append(left, spot);

    const address = v.address[t.to];
    if (armed && address) {
      const send = el("div", "s-send");
      const to = el("span", "", address);
      to.id = "sendTo";
      const copy = button("", "Copy");
      copy.id = "copyTo";
      if (v.provisional) copy.setAttribute("aria-describedby", "slipProvisional");
      send.append(el("span", "s-send-l", "e-Transfer to"), to, copy);
      row.append(send);
    }
    if (ui.work === t.key) row.append(drawWorking(t.from, { me: v.me, live: v.live, payments: v.payments, linesOpen: ui.lines }));
    return row;
  }

  function paidRow(v, p, hit) {
    // A stamp the backend has not confirmed yet is drawn faded, "Sending…".
    const row = el("div", "s-row is-paid" + (p.pending ? " is-pending" : ""));
    row.dataset.pid = p.id;
    const left = el("div", "s-l");
    const amt = el("div", "s-amt");
    amt.innerHTML = pt(dollars(centsOf(p)));
    left.append(el("div", "s-who", who(v, p.from, true) + " → " + who(v, p.to)), amt, el("div", "s-sub", paidSub(v, p)));
    const spot = button("spot");
    spot.dataset.pid = p.id;
    spot.setAttribute("aria-label", "Stamped paid. Remove this stamp?");
    const stamp = el("div", hit ? "stamp hit" : "stamp");
    const rot = Number(p.rot);
    stamp.style.setProperty("--rot", (isFinite(rot) ? rot : 0) + "deg");
    // Built only from numbers and constants (js/stamp.js), so innerHTML is safe.
    stamp.innerHTML = paidStampSVG(p.seed);
    spot.append(stamp);
    if (hit) wetInk(stamp); // just landed: still wet (js/fx.js)
    row.append(left, spot);
    if (ui.rm === p.id) {
      const rm = el("div", "s-rm");
      const yes = button("rm-yes", "Remove this stamp");
      yes.dataset.rm = p.id;
      const keep = button("rm-keep", "Keep it");
      keep.dataset.keep = "";
      rm.append(yes, keep);
      row.append(rm);
    }
    return row;
  }

  function paidSub(v, p) {
    if (p.pending) return SENDING;
    const done = !v.open.some((t) => t.from === p.from && t.to === p.to);
    return paidDay(v, p) + (done ? " Nothing more to send." : "");
  }

  // A stamp going from sending to confirmed changes in place: redrawing the
  // row would play its hit again, or cut it short.
  function markPending(v) {
    for (const row of slip.querySelectorAll(".s-row.is-paid[data-pid]")) {
      const p = v.stamps.find((x) => x.id === row.dataset.pid);
      if (!p) continue;
      row.classList.toggle("is-pending", !!p.pending);
      const sub = row.querySelector(".s-sub");
      const want = paidSub(v, p);
      if (sub && sub.textContent !== want) sub.textContent = want;
    }
  }

  function simpBlock(v) {
    const box = el("div", "simp");
    const sw = button("simp-sw");
    sw.id = "simp";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", String(v.simplify));
    const track = el("span", "simp-t");
    track.append(el("i"));
    sw.append(el("span", "simp-l", "Simplify: fewest payments"), track);
    const ask = el("div", "simp-ask");
    ask.id = "simpAsk";
    ask.hidden = !ui.ask;
    const keep = button("simp-keep", "Keep it on");
    keep.id = "simpKeep";
    const off = button("simp-off", "Turn it off");
    off.id = "simpOff";
    const btns = el("div", "simp-b");
    btns.append(keep, off);
    ask.append(el("p", "simp-q", ASK), btns);
    box.append(sw, ask);
    return box;
  }

  // The settled slip (mock-up 2B): everything under the head in a fold, the
  // filed line with Open, the binder holes and the square seal.
  // The voucher (mock-up 1A): the carbon copy (控) of a 精算書 torn from a
  // pad, its form printed in indigo: a revenue-stamp box, the title, the copy
  // mark and its number, then the column heads.
  function voucherHead(v) {
    const h = el("div", "cf-h");
    const inshi = el("div", "cf-inshi");
    inshi.setAttribute("aria-hidden", "true");
    inshi.append(el("b", "", "収入"), el("b", "", "印紙"));
    const t = el("div", "slip-t cf-t");
    t.append(el("b", "", "旅費精算書"), el("span", "", "Trip settlement · " + v.mark));
    const no = el("div", "cf-no");
    no.append(el("b", "", "控"), el("i", "", voucherNo(v.stamps.length)));
    h.append(inshi, t, no);
    return h;
  }

  function cols() {
    const c = el("div", "cf-cols");
    c.setAttribute("aria-hidden", "true");
    c.append(el("span", "", "支払 → 受取\u3000From → to, amount"), el("span", "", "済 Paid"));
    return c;
  }

  function holes() {
    const h = el("div", "holes");
    h.setAttribute("aria-hidden", "true");
    h.append(el("i"), el("i"));
    return h;
  }

  function foldOf(body) {
    const fold = el("div", "fold");
    const inner = el("div");
    inner.append(...body);
    fold.append(inner);
    return fold;
  }

  function stubOf(st) {
    const t = filedText(st);
    const stub = el("div", "stub");
    const words = el("span");
    words.append(el("b", "", t.head), t.sub);
    const open = button("", "Open");
    open.id = "unfile";
    stub.append(words, open);
    return stub;
  }

  function sealOf(st) {
    const box = el("div", "big boxs");
    box.id = "seal";
    box.style.setProperty("--rot", "-4deg");
    // Built from digits and constants only (js/stamp.js boxSealSVG).
    box.innerHTML = boxSealSVG(st.seed, st.day);
    if (seal.land) {
      seal.land = false;
      box.classList.add("land", "wet");
      setTimeout(() => {
        box.classList.remove("wet");
        box.classList.add("dry");
      }, WET_MS);
    }
    return box;
  }

  // Which focused control to put focus back on after a redraw.
  function focusTarget() {
    const a = document.activeElement;
    if (!a || !slip.contains(a)) return null;
    if (a.id) return { sel: "#" + a.id, a };
    const row = a.closest(".s-row");
    const cls = a.classList[0];
    if (!row || !cls) return null;
    const attr = row.dataset.key !== undefined ? 'data-key="' + CSS.escape(row.dataset.key) + '"' : 'data-pid="' + CSS.escape(row.dataset.pid) + '"';
    return { sel: ".s-row[" + attr + "] ." + cls, a };
  }

  function draw(force) {
    const v = view;
    if (!v) {
      if (shown !== "") slip.replaceChildren();
      shown = "";
      return;
    }
    // Drop what no longer exists.
    if (ui.armed && !v.open.some((t) => t.key === ui.armed)) disarm();
    // Untouched, the armed amount follows the transfer as syncs change it.
    if (ui.armed && !ui.typed) ui.amt = plain(v.open.find((t) => t.key === ui.armed).cents);
    if (ui.work && !v.open.some((t) => t.key === ui.work)) ui.work = null;
    if (ui.rm && !v.stamps.some((p) => p.id === ui.rm)) ui.rm = null;
    if (!v.me) ui.ask = false;

    notice.hidden = !v.provisional;
    const copyButton = slip.querySelector("#copyTo");
    if (copyButton) {
      if (v.provisional) copyButton.setAttribute("aria-describedby", notice.id);
      else copyButton.removeAttribute("aria-describedby");
    }
    const hits = calm() ? new Set() : fresh;
    const sig = JSON.stringify([
      v.me, v.simplify, v.open, v.address, v.purpose, v.mark,
      v.stamps.map((p) => [p.id, p.from, p.to, p.cad, p.seed, p.rot, paidDay(v, p)]),
      ui.work ? [v.live.map((e) => [e.id, e.title, e.amount, e.currency, e.rate, e.paidBy, e.split, e.splitMode, e.splitVals, e.day]), v.payments.map((p) => [p.id, p.removed])] : 0,
      { ...ui, amt: undefined },
      seal.phase === "sealed" || seal.phase === "filed",
    ]);
    fresh = new Set();
    if (sig === shown && !force && !hits.size) {
      markPending(v);
      fileClasses();
      return;
    }
    shown = sig;

    const focus = focusTarget();
    const caret = focus && focus.a.id === "stampAmt" ? [focus.a.selectionStart, focus.a.selectionEnd] : null;

    const head = voucherHead(v);
    const rows = v.open.map((t) => openRow(v, t));
    const stamps = ui.older ? v.stamps : v.stamps.slice(0, FOLD);
    if (!rows.length && !v.stamps.length) rows.push(el("div", "s-row s-none", "Nobody owes anybody."));
    for (const p of stamps) rows.push(paidRow(v, p, hits.has(p.id)));
    if (stamps.length < v.stamps.length) {
      const n = v.stamps.length - stamps.length;
      const older = button("s-older", n + (n === 1 ? " earlier payment" : " earlier payments"));
      older.id = "older";
      rows.push(older);
    }
    const foot = el("div", "slip-f", "Stamp it the moment you send. What’s left is always what’s shown here.");
    const but = el("div", "cf-but");
    but.append(el("b", "", "但"), el("span", "", v.purpose));
    const body = [cols(), ...rows, but, foot, ...(v.me ? [simpBlock(v)] : [])];
    const st = seal.phase === "sealed" || seal.phase === "filed" ? settledOf(v.open, v.stamps) : null;
    if (st) slip.replaceChildren(holes(), head, notice, foldOf(body), stubOf(st), sealOf(st));
    else slip.replaceChildren(head, notice, ...body);
    fileClasses();

    if (focus) {
      const again = slip.querySelector(focus.sel);
      if (again) {
        again.focus({ preventScroll: true });
        if (caret && again.setSelectionRange) again.setSelectionRange(caret[0], caret[1]);
      }
    }
  }

  // ---- acting ----

  function stamp(key) {
    const t = view && view.open.find((x) => x.key === key);
    if (!t) return;
    const cents = sentCents(ui.amt);
    if (cents === null) {
      ui.err = true;
      startTimer();
      draw(true);
      return;
    }
    // Disarmed before the store draws anything, so a second tap finds no
    // armed spot: one payment per stamp.
    disarm();
    store.addPayment({ from: t.from, to: t.to, cad: cents / 100 });
    const lc = store.state.lastChange;
    if (lc && lc.action === "stamp" && lc.item) fresh.add(lc.item.id);
    draw(true);
    thud();
    if (!calm()) setTimeout(shake, 130);
  }

  function tapSpot(key) {
    if (ui.armed === key) return stamp(key);
    const t = view.open.find((x) => x.key === key);
    if (!t) return;
    ui.armed = key;
    ui.amt = plain(t.cents);
    ui.typed = false;
    ui.err = false;
    ui.rm = null;
    startTimer();
    draw();
  }

  function copy(text, done) {
    return copyText(text).then((ok) => store.notify(ok ? done : "Couldn’t copy that."));
  }

  function remind(key) {
    const t = view.open.find((x) => x.key === key);
    if (!t) return;
    const text = remindText(view.me, t, view.people);
    const nav = globalThis.navigator;
    const fallBack = () => copy(text, "Copied. Paste it in your chat.");
    if (!nav || typeof nav.share !== "function") return fallBack();
    try {
      const p = nav.share({ text });
      // Closing the share sheet rejects with AbortError: not an error.
      if (p && typeof p.catch === "function") p.catch((err) => (err && err.name === "AbortError" ? null : fallBack()));
    } catch {
      fallBack();
    }
  }

  function toggleSimp() {
    if (!view.me) return;
    if (ui.ask) {
      ui.ask = false;
      return draw();
    }
    if (view.simplify) {
      ui.ask = true;
      return draw();
    }
    store.setPerson(view.me, { simplify: true });
  }

  slip.addEventListener("click", (ev) => {
    if (!view) return;
    const t = ev.target;
    if (t.closest("#stampAmt")) return;
    if (t.closest("#unfile")) {
      seal.unfiled = true;
      fileClasses();
      const first = slip.querySelector(".fold button");
      if (first) first.focus({ preventScroll: true });
      return;
    }
    const spotBtn = t.closest("button.spot[data-key]");
    if (spotBtn) return tapSpot(spotBtn.dataset.key);
    if (t.closest("#copyTo")) {
      const armed = view.open.find((x) => x.key === ui.armed);
      return armed && copy(view.address[armed.to] || "", "Address copied.");
    }
    const r = t.closest("button.remind[data-key]");
    if (r) return remind(r.dataset.key);
    if (t.closest("[data-paid]")) {
      ui.lines = !ui.lines;
      return draw();
    }
    const amt = t.closest(".s-row.is-open button.s-amt");
    if (amt) {
      const key = amt.closest(".s-row").dataset.key;
      ui.work = ui.work === key ? null : key;
      ui.lines = false;
      return draw();
    }
    const rm = t.closest("[data-rm]");
    if (rm) {
      ui.rm = null;
      store.removePayment(rm.dataset.rm);
      return draw();
    }
    if (t.closest("[data-keep]")) {
      ui.rm = null;
      return draw();
    }
    const paid = t.closest(".s-row.is-paid[data-pid]");
    if (paid) {
      ui.rm = paid.dataset.pid;
      disarm();
      return draw();
    }
    if (t.closest("#older")) {
      ui.older = true;
      return draw();
    }
    if (t.closest("#simp")) return toggleSimp();
    if (t.closest("#simpKeep")) {
      ui.ask = false;
      return draw();
    }
    if (t.closest("#simpOff")) {
      ui.ask = false;
      draw();
      store.setPerson(view.me, { simplify: false });
    }
  });
  slip.addEventListener("input", (ev) => {
    if (ev.target.id !== "stampAmt") return;
    ui.amt = ev.target.value;
    ui.typed = true;
    startTimer(); // typing is not leaving it alone
  });
  slip.addEventListener("keydown", (ev) => {
    if (ev.target.id === "stampAmt" && ev.key === "Enter" && ui.armed) {
      ev.preventDefault();
      stamp(ui.armed);
    }
  });
  slip.addEventListener("animationend", (ev) => {
    if (ev.target === slip) slip.classList.remove("shake");
  });

  function render(s) {
    const before = view;
    view = read(s);
    track(before, view);
    draw();
  }

  render(store.state);
  store.subscribe(render);
}
