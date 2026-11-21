/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The departure board (発車標) between Days' top line and its rail: amber LED
// lettering on black, the second line green (mock-up 4B). What it says comes
// from js/board.js; this only draws it.
//
// mountBoard({ storage }) -> { el, update(model, today), clear() }
// - el: the board's box (place it in Days, between the bar and the rail).
// - update(model, today): model is what boardFor gives, or null (no board);
//   today: the Days clock's date (plan.js tripNow, by the real clock). The
//   board is there when there is a model and it was not closed on that date
//   (mat.board keeps only the date it was closed on). Called on every Days redraw: a text that is the same is left
//   alone, so the lines fill in once, when the board appears, and never on a
//   minute's change. Under reduced motion there is no fill and no fold.
// - clear(): the trip was taken off the phone: out of the page at once with
//   every word taken off it (update(null) leaves the last words in the page).
// - The × closes it for today (44 px wide). A closed board is not in the
//   page's tab order.
// - A line whose words are wider than its window runs sideways, as on a
//   platform board (issue 75, look B). Each line holds one strip (.led-run)
//   with its words, once; a line that fits is never touched. With one or two
//   long lines the board runs, forever, while it can be seen: every line
//   stands at its first word (RUN.hold), the first long line (amber before
//   green) slides left at RUN.pxs, linear, until its last letter is at the
//   window's edge, stands there (RUN.end), goes dark (RUN.dark, opacity 0, so
//   the words stay in the page for a screen reader), and is back at its
//   first word at once, lit; after RUN.hold the next long line has its turn,
//   and after the last the first again. Only one line moves at a time.
//   Every step is a setTimeout (the tests' clock drives timers; a hidden tab
//   drops transition events). data-phase on the line (run, end, dark, or
//   absent) and is-long are what the tests read.
//   It is measured when a line's words change, the fonts arrive, the line's
//   box changes size (rotation, the desktop window) and Reduce Motion is
//   switched; it is stopped (everything at rest, first word, lit) when the
//   board is closed, cleared, hidden, scrolled out of sight or on another tab
//   of the app (its screen goes inert), and starts again from the hold when
//   seen. Under Reduce Motion nothing runs: the CSS wraps the words onto more
//   rows. Fonts arriving in pieces and the line box resizing only re-measure:
//   a line that is running carries on unless its overhang really changed.
//   mountBoard is called once per page, so the listeners on document and
//   matchMedia are never removed.
// Every word on it is set with textContent.

import { BOARD_KEY, closedDate, isClosed, RUN, overBy, runMs } from "../board.js";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const FOLD_MS = 220;

export function mountBoard({ storage = null } = {}) {
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
  const s1 = el("span", "led-run");
  const s2 = el("span", "led-run");
  l1.append(s1);
  l2.append(s2);
  txt.append(l1, l2);
  inner.append(lamp, txt);
  const x = el("button", "brd-x", "×");
  x.type = "button";
  x.setAttribute("aria-label", "Close the board for today");
  brd.append(inner, x);
  clip.append(brd);
  wrap.append(clip);

  let shown = false;
  let seen = true; // on screen (an IntersectionObserver, when there is one)
  let view = null; // the app screen the board is in: another tab of the app makes it inert
  let todayNow = ""; // the Days clock's date at the last update
  let foldTimer = null;

  function fill() {
    inner.classList.remove("led-wipe");
    if (calm()) return;
    void inner.offsetWidth;
    inner.classList.add("led-wipe");
  }
  inner.addEventListener("animationend", () => inner.classList.remove("led-wipe"));

  // ---- the long line's run ----
  const lines = [
    { line: l1, strip: s1, over: 0 },
    { line: l2, strip: s2, over: 0 },
  ];
  let timer = null;
  const after = (ms, fn) => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
  function rest() {
    clearTimeout(timer);
    timer = null;
    for (const { line, strip } of lines) {
      strip.style.transition = "none";
      strip.style.transform = "";
      strip.classList.remove("is-dark");
      delete line.dataset.phase;
    }
  }
  // Measures every line (layout sizes: a transform or opacity never changes them, so a
  // moving line can be measured as it is). True when any line's overhang changed.
  function measure() {
    let changed = false;
    for (const L of lines) {
      const over = L.line.hidden || !shown ? 0 : overBy(L.strip.offsetWidth, L.line.clientWidth);
      if (over !== L.over) changed = true;
      L.over = over;
      L.line.classList.toggle("is-long", over > 0);
    }
    return changed;
  }
  function run(longs, i) {
    const L = longs[i];
    const ms = runMs(L.over);
    L.line.dataset.phase = "run";
    void L.strip.offsetWidth; // the transition below takes from the first word
    L.strip.style.transition = "transform " + ms + "ms linear";
    L.strip.style.transform = "translateX(-" + L.over + "px)";
    after(ms, () => {
      L.line.dataset.phase = "end";
      after(RUN.end, () => {
        L.line.dataset.phase = "dark";
        L.strip.classList.add("is-dark");
        after(RUN.dark, () => {
          L.strip.style.transition = "none";
          L.strip.style.transform = "";
          L.strip.classList.remove("is-dark");
          delete L.line.dataset.phase;
          after(RUN.hold, () => run(longs, (i + 1) % longs.length));
        });
      });
    });
  }
  function start() {
    rest();
    if (calm() || !shown || !seen || document.hidden || (view && view.inert)) return;
    const longs = lines.filter((L) => L.over > 0);
    if (!longs.length) return;
    after(RUN.hold, () => run(longs, 0));
  }
  // From the hold, at the first word: new words, the board appearing, Reduce Motion switched.
  const restart = () => {
    measure();
    start();
  };
  // Fonts arriving in pieces and the line box resizing: a line that is running is left
  // running unless its overhang really changed (or nothing is going and something should be).
  const remeasure = () => {
    if (measure() || (timer === null && lines.some((L) => L.over > 0))) start();
  };
  document.addEventListener("visibilitychange", () => (document.hidden ? rest() : start()));
  if (document.fonts) {
    document.fonts.ready.then(remeasure).catch(() => {});
    if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", remeasure);
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(remeasure).observe(txt);
  if (typeof matchMedia === "function") {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.addEventListener) mq.addEventListener("change", restart);
  }
  if (typeof IntersectionObserver === "function") {
    new IntersectionObserver((entries) => {
      const now = entries[entries.length - 1].isIntersecting;
      if (now === seen) return;
      seen = now;
      if (seen) start();
      else rest();
    }).observe(brd);
  }

  // Another tab of the app keeps this screen laid out but inert (and clear), so the
  // observer above does not see it go: watch the screen's inert.
  function watchView() {
    if (view || typeof MutationObserver !== "function") return;
    view = wrap.closest(".view");
    if (!view) return;
    new MutationObserver(() => (view.inert ? rest() : start())).observe(view, { attributes: true, attributeFilter: ["inert"] });
  }

  function show(on) {
    if (on === shown) return;
    shown = on;
    clearTimeout(foldTimer);
    if (on) {
      watchView();
      wrap.hidden = false;
      wrap.inert = false;
      wrap.classList.remove("is-shut");
      fill();
      restart();
      return;
    }
    rest();
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

  // Returns whether the words really changed.
  const put = (node, text) => {
    if (node.textContent === text) return false;
    node.textContent = text;
    return true;
  };

  function update(model, today) {
    todayNow = typeof today === "string" ? today : "";
    if (!model || isClosed(get(), todayNow)) {
      show(false);
      return;
    }
    brd.dataset.kind = model.kind;
    put(small, model.small);
    if (bigN.data !== model.big) bigN.data = model.big;
    put(unit, model.unit);
    unit.hidden = !model.unit;
    const was = l2.hidden;
    let changed = put(s1, model.l1);
    changed = put(s2, model.l2) || changed;
    l2.hidden = !model.l2;
    if (was !== l2.hidden) changed = true;
    const wasShown = shown;
    show(true);
    // show() measured when the board appeared; otherwise only when a line changed.
    if (changed && wasShown) restart();
  }

  x.addEventListener("click", () => {
    set(closedDate(todayNow));
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
    for (const n of [small, unit, s1, s2]) n.textContent = "";
    bigN.data = "";
    rest();
    for (const L of lines) {
      L.over = 0;
      L.line.classList.remove("is-long");
    }
  }

  return { el: wrap, update, clear };
}
