/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The departure board at the top of Days (発車標): what it says, and when it
// is closed. Pure: no DOM, no storage, no clock of its own (callers pass the
// instant). It reads only what the phone already holds (the store's state and,
// when there is one, where the phone is); nothing is asked of the backend.
//
// boardFor(state, nowMs, here) -> null, or one of
//   { kind: "before", small: "出発まで", big: "23", unit: "日", l1: "Book next: <item>", l2: "By Fri Nov 20 · You’re on it" }
//   { kind: "trip",   small: "次 Next",  big: "14:20", unit: "", l1: "<next stop's title>", l2: "Leave by 13:50 · in 38 min" }
// - before the trip: the days to go (the trip's zone) and the next booking
//   still open on the Before list (earliest book-by date; the same order and
//   the same date line as that list, counted on the Toronto calendar). No
//   planner linked or nothing open: no board.
// - on a trip day: today's next stop (plan.js nextStopId, R38), its time and
//   the leave line the ticket prints for it (from where the phone is when
//   that is usable, else from its travel minutes), tidied to one line. No
//   timed stop still to come today, a day the trip has no ticket for, or the
//   trip over: no board.
// - anything not ready (no trip, still loading): no board.
// l2 may be "" (a booking with no date and nobody on it): the line is left out.
//
// A closed board stays closed for the rest of that day by the Days clock (the
// trip's zone, or a zoned day's own) and is there again the next: the only
// thing kept is the date it was closed on.
// On a day in its own zone (plan.js tripNow) the small label is "次 Next · 現地".

import { tripNow, daysToGo, stopsFor, nextStopId, nextLine, hereLine } from "./plan.js";
import { homeToday, dueLine, openTodos } from "./todos.js";

const str = (v) => (typeof v === "string" ? v.trim() : "");

// "Leave by 13:50, in 38 min." -> "Leave by 13:50 · in 38 min". "Next, in 12
// min." -> "In 12 min" (the board's own label already says next).
export function tidyLine(line) {
  const t = str(line).replace(/\.$/, "").replace(/[.,] /g, " · ").replace(/^Next · /, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const onIt = (t, me) => (!str(t.claimedBy) ? "" : t.claimedBy === me ? "You’re on it" : t.claimedBy + " is on it");

// "By Fri Nov 20 · You’re on it"; late: "Was due Fri Nov 20 · 2 days late · …".
function bookLine(t, me, today) {
  const d = dueLine(t.bookBy, today);
  const due = !d ? "" : d.state === "late" ? "Was due " + d.date + " · " + d.tail : "By " + d.date;
  return [due, onIt(t, me)].filter(Boolean).join(" · ");
}

export function boardFor(s, nowMs, here = null) {
  if (!s || s.status !== "ready" || !s.trip || !s.trip.start) return null;
  const tz = s.trip.tz || "Asia/Tokyo";
  // The Days clock: on a day in its own zone, that place's date and time.
  const now = tripNow(s, nowMs);
  const toGo = daysToGo({ ...s.trip, tz }, nowMs, now.date);
  if (toGo > 0) {
    if (s.plannerLinked !== true) return null;
    const todos = (Array.isArray(s.todos) ? s.todos : []).filter((t) => t && typeof t.id === "string" && t.id && typeof t.item === "string");
    const next = openTodos(todos)[0];
    if (!next) return null;
    return { kind: "before", small: "出発まで", big: String(toGo), unit: "日", l1: "Book next: " + next.item.trim(), l2: bookLine(next, s.me, homeToday(nowMs)) };
  }
  const days = Array.isArray(s.days) ? s.days : [];
  if (!days.some((d) => d && d.date === now.date)) return null;
  const stops = (Array.isArray(s.stops) ? s.stops : []).filter((x) => x && typeof x.id === "string" && x.id && typeof x.date === "string");
  const day = stopsFor(stops, now.date);
  const id = nextStopId(day, now.minutes);
  const stop = id ? day.find((x) => x.id === id) : null;
  if (!stop) return null;
  const h = here ? hereLine(stop, now.minutes, here) : null;
  return { kind: "trip", small: now.local ? "次 Next · 現地" : "次 Next", big: stop.time, unit: "", l1: str(stop.title) || "Next stop", l2: tidyLine(h ? h.lead : nextLine(stop, now.minutes)) };
}

// ---- closed until tomorrow ----

export const BOARD_KEY = "mat.board";

// What to keep when the board is closed now: the Days clock's date (tripNow).
export const closedDate = (today) => (typeof today === "string" ? today : "");

// Whether what was kept says the board is closed on `today` (the Days clock's date).
export const isClosed = (kept, today) => typeof kept === "string" && kept !== "" && kept === closedDate(today);
