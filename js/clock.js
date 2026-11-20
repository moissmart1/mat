/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The one clock the Days screen reads. Normally the real time; a demo can
// pretend to be a trip day (07:00 in that day's zone, running 120x, holding
// at 23:30, or a minute before a zoned day ends when that is earlier). The demo
// lives in memory only, so a reload ends it.

import { instantOf } from "./plan.js";

const SPEED = 120;

// getTz(date): the zone of that day (its own, else the trip's). getSpan(date):
// plan.js daySpan for that day, or null (a day in the trip's zone).
export function createClock({ now = () => Date.now(), getTz, getSpan = () => null }) {
  let demo = null; // { date, realStart, base, cap }
  const listeners = new Set();
  const tell = () => listeners.forEach((fn) => fn());
  return {
    now() {
      if (!demo) return now();
      return Math.min(demo.base + (now() - demo.realStart) * SPEED, demo.cap);
    },
    demoDay: () => (demo ? demo.date : null),
    // A demo that has reached its end of day and stands still.
    holding: () => !!demo && demo.base + (now() - demo.realStart) * SPEED >= demo.cap,
    start(date) {
      const tz = getTz(date);
      const span = getSpan(date);
      // A day in its own zone holds at the earlier of 23:30 there and a minute before it ends.
      const cap = Math.min(instantOf(tz, date, 23 * 60 + 30), span ? span.ends - 60000 : Infinity);
      demo = { date, realStart: now(), base: instantOf(tz, date, 7 * 60), cap };
      tell();
    },
    stop() {
      demo = null;
      tell();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
