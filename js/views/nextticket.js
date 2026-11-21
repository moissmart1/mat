/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Your next ticket in the slot above the bar (issue #83, option C, Mo's pick
// on 2026-11-21): a paper-white stub standing in a dark lip just above the
// bar, on Days only. One tap opens the same stub the stop's Show ticket
// opens. The words are js/nextticket.js slotModel; this only draws them.
// It simply shows: no rise (Mo dislikes decorative motion). An earlier stop
// where you have no code is said in the label's place, in vermilion:
// "No code for you at Shibuya Sky · Sat".
//
// mountNextTicket(phone, store, { clock, keep, where, onTicket }) -> { update, button }
// - The node (#nextTicket) stands just before #nav, so Tab goes day, slot, bar.
// - onTicket(stopId, button): the slot was tapped (the app opens the stub).
// - It looks again on every change of the store, the clock, the keep and
//   where the phone is, and every 30 s while the app is on screen. When only
//   the words change they are put in place, so focus stays on the button.
// - .phone gets has-slot while there is a ticket to show (css/nextticket.css
//   sets --slot-h from it: the Days view and the undo line make room). The
//   CSS hides it (visibility) when Days is not the screen or anything stands
//   over Days.
//
// sealFor(kind, person, name, cls): a whose seal (.wh-s), used by the slot,
// the pass case, the stub and the Days 券 line:
//   "me" your picture with the vermilion ring (initials with none), "other"
//   another holder's picture with an ink ring, "all" 全, "none" a dashed ring.
//   It is decoration inside a labelled button: alt="" and aria-hidden.

import { slotModel } from "../nextticket.js";
import { fillSeal } from "../picture.js";
import { sameName } from "../tickets.js";

const LOOK_MS = 30000;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function sealFor(kind, person, name, cls = "") {
  const s = el("span", "wh-s" + (kind === "me" ? " is-me" : kind === "other" ? " is-dim" : kind === "all" ? " is-all" : kind === "none" ? " is-none" : "") + (cls ? " " + cls : ""));
  s.setAttribute("aria-hidden", "true");
  if (kind === "me" || kind === "other") fillSeal(s, person || null, name || "");
  else if (kind === "all") s.textContent = "全";
  return s;
}

// The people's picture signature: a changed picture redraws a seal.
export const photoSig = (p) => (p && typeof p.photo === "string" && p.photo ? p.photo.length + ":" + p.photo.slice(-16) : "");

export function mountNextTicket(phone, store, { clock = null, keep = null, where = null, onTicket = () => {} } = {}) {
  const box = el("div", "ntk");
  box.id = "nextTicket";
  box.hidden = true;
  const b = el("button", "ntk-tk");
  b.type = "button";
  b.id = "ntBtn";
  const seal = el("span", "ntk-seal");
  const mid = el("span", "ntk-m");
  const label = el("small", "ntk-l");
  const lj = el("span", "ntk-lj");
  lj.setAttribute("aria-hidden", "true");
  const le = el("span", "ntk-le");
  // The warning in the label's place: an earlier stop where you have no code.
  const warn = el("span", "ntk-w");
  const w1 = el("span", "ntk-w1");
  const w2 = el("span", "ntk-w2");
  const w3 = el("span", "ntk-w3");
  warn.append(w1, w2, w3);
  warn.hidden = true;
  label.append(lj, le, warn);
  const title = el("b", "ntk-t");
  const tag = el("em", "ntk-tag");
  tag.setAttribute("aria-hidden", "true");
  const tt = el("span", "ntk-tt");
  title.append(tag, tt);
  // The second line: while warned, whose it is (kept whole) and then the details (they end in an ellipsis).
  const line = el("span", "ntk-ln");
  const lw = el("span", "ntk-lw");
  const ld = el("span", "ntk-ld");
  line.append(lw, ld);
  mid.append(label, title, line);
  const go = el("span", "ntk-go");
  const gj = el("b", "", "切符");
  gj.setAttribute("aria-hidden", "true");
  go.append(gj, el("span", "", "Show"));
  b.append(seal, mid, go);
  const lip = el("span", "ntk-lip");
  lip.setAttribute("aria-hidden", "true");
  box.append(b, lip);
  const nav = phone.querySelector("#nav");
  phone.insertBefore(box, nav);

  let id = null;
  let sealSig = "";

  const set = (node, v) => {
    if (node.textContent !== v) node.textContent = v;
  };

  function update() {
    const s = store.state;
    const nowMs = clock ? clock.now() : Date.now();
    const here = where && typeof where.current === "function" ? where.current() : null;
    const m = s && s.status !== "nokey" ? slotModel(s, nowMs, { have: (x) => !!keep && keep.have(x), here }) : null;
    if (!m) {
      id = null;
      if (!box.hidden) box.hidden = true;
      phone.classList.remove("has-slot");
      return;
    }
    id = m.id;
    const k = m.whose.kind;
    box.dataset.whose = k;
    if (m.colour) {
      box.style.setProperty("--line", m.colour);
      if (m.ink) box.style.setProperty("--line-ink", m.ink);
    } else {
      box.style.removeProperty("--line");
      box.style.removeProperty("--line-ink");
    }
    const warned = !!m.warn;
    set(lj, warned ? "" : m.label.jp + " ");
    set(le, warned ? "" : m.label.en);
    box.classList.toggle("has-warn", warned);
    lj.hidden = warned;
    le.hidden = warned;
    warn.hidden = !warned;
    set(w1, warned ? "No code for you at " : "");
    set(w2, warned ? m.warn.title : "");
    set(w3, warned ? " · " + m.warn.when : "");
    tag.hidden = !m.tag;
    set(tag, m.tag);
    set(tt, m.title);
    const head = m.lineWhose ? m.lineWhose + " · " : "";
    set(lw, head);
    set(ld, m.line.slice(head.length));
    if (b.getAttribute("aria-label") !== m.aria) b.setAttribute("aria-label", m.aria);
    // The seal: your picture (mine), 全 (all of us, a reference), an empty dashed ring (none).
    const me = typeof s.me === "string" ? s.me : "";
    const person = k === "mine" ? (s.people || []).find((p) => p && sameName(p.name, me)) || null : null;
    const want = JSON.stringify([k, me, photoSig(person)]);
    if (want !== sealSig) {
      sealSig = want;
      const kind = k === "mine" ? "me" : k === "none" ? "none" : "all";
      seal.replaceChildren(sealFor(kind, person, me));
    }
    if (box.hidden) box.hidden = false;
    phone.classList.add("has-slot");
  }

  b.addEventListener("click", () => {
    if (id) onTicket(id, b);
  });
  // iPhone Safari draws a pressed look (:active) on touch only when something listens.
  b.addEventListener("touchstart", () => {}, { passive: true });

  store.subscribe(update);
  if (clock && clock.subscribe) clock.subscribe(update);
  if (keep && keep.subscribe) keep.subscribe(update);
  if (where && where.subscribe) where.subscribe(update);
  let timer = null;
  const wake = () => {
    if (document.visibilityState !== "hidden" && !timer) {
      timer = setInterval(update, LOOK_MS);
      update();
    } else if (document.visibilityState === "hidden" && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  document.addEventListener("visibilitychange", wake);
  wake();
  update();

  return { update, button: b };
}
