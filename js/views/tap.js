/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// A tap that survives a redraw. When a picture arrives between finger down and
// finger up, the screen is drawn again and what the finger went down on is
// replaced; the browser then sends no click to it, or one to the wrong thing.
// This does the tap on finger up in that case, and says to ignore the click.
//
// tapOnRelease(host, { pick, act }) -> { skip(ev), clear() }
// - pick(target): what the finger went down on means, or null for "nothing
//   here to rescue". Called on finger down.
// - act(what): done on finger up, only when the pressed element was replaced.
// - Only the primary pointer and the left button count; the same pointer must
//   come up, within MOVED px of where it went down (a swipe or a drag is not a tap).
// - skip(ev): call first in the click handler; true when the tap was already
//   done on finger up. A click with detail 0 (Enter, Space, an assistive
//   technology) is never skipped. It also forgets the finger.
// - clear(): forget the finger (the screen went away).

const MOVED = 10;
// MAT differs from the Chicago copy here: a rescued tap must come up within HELD ms
// of going down (a long press is not a tap), and the finger's record is dropped
// STALE ms after a rescue so it cannot swallow a later click (losttap review M1, M2).
const HELD = 1000;
const STALE = 500;

export function tapOnRelease(host, { pick, act }) {
  let down = null; // { el, what, id, x, y, done }
  host.addEventListener("pointerdown", (ev) => {
    down = null;
    if (!ev.isPrimary || ev.button !== 0) return;
    const what = pick(ev.target);
    if (what === null || what === undefined) return;
    down = { el: ev.target, what, id: ev.pointerId, x: ev.clientX, y: ev.clientY, at: ev.timeStamp, done: false };
  });
  host.addEventListener("pointerup", (ev) => {
    const d = down;
    if (!d || d.done || d.el.isConnected) return;
    d.done = true; // a click that does come is not a second tap, tap or not
    setTimeout(() => {
      if (down === d) down = null;
    }, STALE);
    if (ev.pointerId === d.id && ev.timeStamp - d.at <= HELD && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < MOVED) act(d.what);
  });
  host.addEventListener("pointercancel", () => {
    down = null;
  });
  return {
    skip(ev) {
      const d = down;
      down = null;
      return !!d && d.done && ev.detail !== 0;
    },
    clear() {
      down = null;
    },
  };
}
