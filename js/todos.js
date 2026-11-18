/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// "Before we go": the bookings and prep from the planner's Book Now tab, as
// the Days screen lists them. Pure: no DOM, no storage, no clock of its own
// (callers pass the instant).
//
// Days to a book-by date are counted on the Toronto calendar: the friends are
// at home when they use this list. A tick's day is the phone's own (R21).

import { dateIn } from "./time.js";
import { dayHead, localDay } from "./format.js";

export const HOME_TZ = "America/Toronto";
// Within this many days (not late) the date is printed heavier.
const SOON_DAYS = 3;
// Older than this, the list is fetched again by itself.
export const STALE_MS = 60 * 60 * 1000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// "YYYY-MM-DD" -> whole days since 1970, or null when it is not a real date.
function dayNumber(date) {
  const m = DATE_RE.exec(typeof date === "string" ? date : "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms / 86400000;
}

// Today on the Toronto calendar.
export function homeToday(nowMs) {
  return dateIn(HOME_TZ, nowMs);
}

// The due line of a book-by date, seen on `today` (both "YYYY-MM-DD"):
// { state, lead, date, tail, strong } or null when there is no date.
// state: "later", "soon" (within 3 days), "tomorrow", "today" or "late".
// strong: the date is printed heavier (within 3 days, or late).
export function dueLine(bookBy, today) {
  const due = dayNumber(bookBy);
  const now = dayNumber(today);
  if (due === null || now === null) return null;
  const n = due - now;
  const date = dayHead(bookBy, []).en;
  if (n < 0) return { state: "late", lead: "was due", date, tail: -n + (n === -1 ? " day late" : " days late"), strong: true };
  const tail = n === 0 ? "today" : n === 1 ? "tomorrow" : "in " + n + " days";
  const state = n === 0 ? "today" : n === 1 ? "tomorrow" : n <= SOON_DAYS ? "soon" : "later";
  return { state, lead: "by", date, tail, strong: n <= SOON_DAYS };
}

// "by Sat Dec 5 · in 19 days", or "" for no due line.
export function dueText(d) {
  return d ? d.lead + " " + d.date + " · " + d.tail : "";
}

const str = (v) => (typeof v === "string" ? v.trim() : "");

// The planner's word for done (the backend's isBooked).
export const isBooked = (status) => /^booked\b/i.test(str(status));

// Done: someone ticked it, or the planner says booked.
export function isDone(t) {
  return !!t && (t.done === true || str(t.tickedBy) !== "" || isBooked(t.status));
}

// A tick the planner has not taken yet (not while the tick is on its way;
// never one whose Status the planner computes itself).
export function plannerPending(t) {
  return !!t && !t.pending && t.plannerComputes !== true && str(t.tickedBy) !== "" && !isBooked(t.status);
}

// The items still open: earliest book-by date first; undated last. Items
// with the same date, and the undated ones, keep the planner's order.
export function openTodos(todos) {
  return byBookBy((Array.isArray(todos) ? todos : []).filter((t) => t && !isDone(t)));
}

// The same order for any items (the open ones, and one just ticked that is
// still shown among them).
export function byBookBy(list) {
  const key = (t) => {
    const n = dayNumber(t.bookBy);
    return n === null ? Infinity : n;
  };
  return list.map((t, i) => ({ t, i })).sort((a, b) => key(a.t) - key(b.t) || a.i - b.i).map((x) => x.t);
}

// The done items: ticked ones newest first, then those booked in the planner
// by hand, in the planner's order.
export function doneTodos(todos) {
  const list = (Array.isArray(todos) ? todos : []).filter((t) => t && isDone(t));
  const at = (t) => {
    const ms = Date.parse(t.tickedAt);
    return str(t.tickedBy) !== "" && isFinite(ms) ? ms : -Infinity;
  };
  return list.map((t, i) => ({ t, i })).sort((a, b) => (at(b.t) === at(a.t) ? a.i - b.i : at(b.t) > at(a.t) ? 1 : -1)).map((x) => x.t);
}

// "済 Mo · Dec 3" (the day in the phone's own zone), or "Booked in the planner",
// or for a tick whose Status the planner computes, that it works it out.
export function tickedLine(t) {
  const who = str(t && t.tickedBy);
  if (!who) return "Booked in the planner";
  // True for as long as the row stays so, formula or not by now: nothing writes it later (ruling 6a).
  if (t.plannerComputes === true) return "Ticked by " + who + ". The planner worked this one out itself, so the app left it as it was.";
  const day = localDay(Date.parse(t.tickedAt));
  if (!day) return "済 " + who;
  return "済 " + who + " · " + dayHead(day, []).en.split(" ").slice(1).join(" ");
}

// What an undone tick left in the planner, worth saying on the undo bar,
// from the item as shown before the undo and the backend's reply to it
// ({ planner, todo }): "pending" (the app's Booked could not be taken back
// out: a pull retries it, or drops it when the # holds another item now),
// "kept" (the app had written Booked, and the planner's Status was
// changed there since, so it was left alone), or null (put back, never
// written, or not an undone tick: nothing more to say).
export function untickOutcome(before, data) {
  const after = data && data.todo;
  if (!after || str(after.tickedBy) !== "") return null;
  if (data.planner === "pending") return "pending";
  const wasWritten = !!before && str(before.tickedBy) !== "" && before.plannerComputes !== true && isBooked(before.status);
  if (data.planner === "kept" && wasWritten && !isBooked(after.status)) return "kept";
  return null;
}

// The number printed on a slip's counterfoil in the pad (the Before list's
// look): the planner's own # (two digits at the least), or, for an id that
// is not a short whole number, the slip's place in the pad (`position`, from 0).
export function slipNo(id, position = 0) {
  const s = typeof id === "string" ? id.trim() : String(id == null ? "" : id);
  return "No." + (/^\d{1,3}$/.test(s) ? s : String(position + 1)).padStart(2, "0");
}

// The first line of a Book Now item a pull could not read: "#4 · row 7 ·
// Made-up item". Each part is left out when the backend had none.
export function todoProblemHead({ id, row, what } = {}) {
  const parts = [];
  if (typeof id === "string" && id !== "") parts.push("#" + id);
  if (typeof row === "number" && Number.isFinite(row)) parts.push("row " + row);
  if (typeof what === "string" && what !== "") parts.push(what);
  return parts.length ? parts.join(" · ") : "A Book Now row";
}

// The list is due a fetch: never fetched, or fetched an hour ago or more.
export function isStale(pulledAt, nowMs) {
  const ms = Date.parse(typeof pulledAt === "string" ? pulledAt : "");
  return !isFinite(ms) || nowMs - ms >= STALE_MS;
}

// Whether the Before tab is in the bar. `loaded`: the list has come in (a
// planner is linked and it has items); `beforeTrip`: the trip's first day has
// not begun; `openCount`: items still open. Before the trip it shows even with
// nothing open; from the first day on only while something is.
export function showBeforeTab({ loaded = false, beforeTrip = false, openCount = 0 } = {}) {
  if (!loaded) return false;
  return beforeTrip || openCount > 0;
}

// The tab button's accessible name.
export function tabName(openCount) {
  return openCount > 0 ? "Before we go, " + openCount + " open" : "Before we go";
}
