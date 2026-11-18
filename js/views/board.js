/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The departure board (発車標) between Days' top line and its rail: amber LED
// lettering on black, the second line green (mock-up 4B). What it says comes
// from js/board.js; this only draws it.
//
// mountBoard({ storage, now }) -> { el, update(model, tz), clear() }
// - el: the board's box (place it in Days, between the bar and the rail).
// - update(model, tz): model is what boardFor gives, or null (no board). The
//   board is there when there is a model and it was not closed today (the trip
//   zone's date, by the real clock: mat.board keeps only the date it was
//   closed on). Called on every Days redraw: a text that is the same is left
//   alone, so the lines fill in once, when the board appears, and never on a
//   minute's change. Under reduced motion there is no fill and no fold.
// - clear(): the trip was taken off the phone: out of the page at once with
//   every word taken off it (update(null) leaves the last words in the page).
// - The × closes it for today (44 px wide). A closed board is not in the
//   page's tab order. now(): the real time, never the demo's.
// Every word on it is set with textContent.

import { BOARD_KEY, closedDate, isClosed } from "../board.js";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const FOLD_MS = 220;

export function mountBoard({ storage = null, now = () => Date.now() } = {}) {
  const store = storage || (() => {
    try {
      return globalThis.localStorage;
    } catch {
      return null;
    }
  })();
  const get = () => {
    try {
      return store ? store.getItem(BOARD_KEY) : null;
    } catch {
      return null;
    }
  };
  const set = (v) => {
    try {
      if (store) store.setItem(BOARD_KEY, v);
    } catch {
      // nowhere to keep it: it is closed for this visit only
    }
  };

  const wrap = el("div", "brd-wrap");
  wrap.hidden = true;
  wrap.inert = true;
  const clip = el("div");
  const brd = el("div", "brd led");
  brd.setAttribute("role", "group");
  brd.setAttribute("aria-label", "Departure board");
  const inner = el("div", "led-in");
  const small = el("small");
  const big = el("b");
  const bigN = document.createTextNode("");
  const unit = el("em");
  big.append(bigN, unit);
  const lamp = el("div", "led-big");
  lamp.append(small, big);
  const txt = el("div", "led-txt");
  const l1 = el("span", "led-1");
  const l2 = el("span", "led-2");
  txt.append(l1, l2);
  inner.append(lamp, txt);
  const x = el("button", "brd-x", "×");
  x.type = "button";
  x.setAttribute("aria-label", "Close the board for today");
  brd.append(inner, x);
  clip.append(brd);
  wrap.append(clip);

  let shown = false;
  let tzNow = "Asia/Tokyo";
  let foldTimer = null;

  function fill() {
    inner.classList.remove("led-wipe");
    if (calm()) return;
    void inner.offsetWidth;
    inner.classList.add("led-wipe");
  }
  inner.addEventListener("animationend", () => inner.classList.remove("led-wipe"));

  function show(on) {
    if (on === shown) return;
    shown = on;
    clearTimeout(foldTimer);
    if (on) {
      wrap.hidden = false;
      wrap.inert = false;
      wrap.classList.remove("is-shut");
      fill();
      return;
    }
    wrap.inert = true;
    if (calm()) {
      wrap.hidden = true;
      return;
    }
    wrap.classList.add("is-shut");
    // Out of the page once folded: when the fold ends, or soon after if it never reports.
    foldTimer = setTimeout(() => {
      if (!shown) wrap.hidden = true;
    }, FOLD_MS + 200);
  }
  wrap.addEventListener("transitionend", (ev) => {
    if (ev.target === wrap && !shown) wrap.hidden = true;
  });

  const put = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };

  function update(model, tz) {
    tzNow = tz || "Asia/Tokyo";
    if (!model || isClosed(get(), tzNow, now())) {
      show(false);
      return;
    }
    brd.dataset.kind = model.kind;
    put(small, model.small);
    if (bigN.data !== model.big) bigN.data = model.big;
    put(unit, model.unit);
    unit.hidden = !model.unit;
    put(l1, model.l1);
    put(l2, model.l2);
    l2.hidden = !model.l2;
    show(true);
  }

  x.addEventListener("click", () => {
    set(closedDate(tzNow, now()));
    // Focus goes to Days' own first control, not into the page's end.
    const next = wrap.closest("section, .view");
    const count = next && next.querySelector("#dayCount");
    if (count && !count.hidden) count.focus({ preventScroll: true });
    show(false);
  });

  function clear() {
    clearTimeout(foldTimer);
    shown = false;
    wrap.inert = true;
    wrap.hidden = true;
    wrap.classList.add("is-shut");
    for (const n of [small, unit, l1, l2]) n.textContent = "";
    bigN.data = "";
  }

  return { el: wrap, update, clear };
}
