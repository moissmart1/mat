/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The day logic for the Days screen. Pure: no DOM, no storage, no clock of
// its own (callers pass the instant). Every field of a stop, stay or day may
// be missing or blank, because a person can type into the Sheet by hand.

import { dateIn } from "./time.js";
import { jpyOf } from "./money.js";
import { metres, walkMinutes, distanceText } from "./geo.js";

const str = (v) => (typeof v === "string" ? v.trim() : "");
const list = (v) => (Array.isArray(v) ? v : []);

// "14:05" -> 845; anything that is not HH:MM (24 h) -> null.
export function minutesOf(time) {
  const m = /^(\d{2}):(\d{2})$/.exec(typeof time === "string" ? time : "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

// The wall-clock fields of an instant in a zone.
function wall(tz, nowMs) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(nowMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

// { date, minutes }: the zone's date and minutes past midnight at this instant.
export function nowIn(tz, nowMs) {
  const w = wall(tz, nowMs);
  return { date: dateIn(tz, nowMs), minutes: w.h * 60 + w.mi };
}

// The ms instant at which the zone's wall clock reads `date` + `minutes`.
export function instantOf(tz, date, minutes) {
  const [y, mo, d] = date.split("-").map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, 0, minutes);
  const offsetAt = (ms) => {
    const w = wall(tz, ms);
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
  };
  let guess = asUtc - offsetAt(asUtc);
  guess = asUtc - offsetAt(guess); // once more, in case the zone changed offset between the two
  return guess;
}

// `today`: the Days clock's date (tripNow), when the caller has it; else the trip zone's.
export function openDayIndex(trip, days, nowMs, today = dateIn(trip.tz, nowMs)) {
  const last = Math.max(0, days.length - 1);
  if (today < trip.start) return 0;
  if (today > trip.end) return last;
  const exact = days.findIndex((d) => d.date === today);
  if (exact >= 0) return exact;
  let found = 0;
  days.forEach((d, i) => { if (d.date < today) found = i; });
  return found;
}

export function dayState(date, today) {
  return date < today ? "used" : date === today ? "today" : "ahead";
}

const dayNumber = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

export function daysToGo(trip, nowMs, today = dateIn(trip.tz, nowMs)) {
  return Math.max(0, dayNumber(trip.start) - dayNumber(today));
}

// ---- a day that keeps its own clock (T1 現地時刻) ----
// A Days row may name its own time zone (Days.tz, typed in the Sheet). While
// such a day is in force, "today" and "now" are that place's. A trip with no
// such row reads exactly as nowIn(trip.tz) at every instant.

const HOME_TZ = "Asia/Tokyo";
const homeOf = (trip) => (trip && typeof trip.tz === "string" && trip.tz) || HOME_TZ;
const goodZones = new Map();
const realZone = (tz) => {
  if (!goodZones.has(tz)) {
    let ok = false;
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    goodZones.set(tz, ok);
  }
  return goodZones.get(tz);
};

// The zone a day's times are in: its own (Days.tz) when it names a real zone, else the trip's.
export function zoneOf(trip, row) {
  const own = row && typeof row.tz === "string" ? row.tz.trim() : "";
  return own && realZone(own) ? own : homeOf(trip);
}

// The eves, then the days: every loaded row with a date.
const rowsOf = (s) => list(s && s.eves).concat(list(s && s.days)).filter((d) => d && typeof d.date === "string" && DATE_RE.test(d.date));

// When a day in another zone is in force: { begins, ends } in ms, or null for
// a day in the trip's zone (or no row with that date). It begins at its own
// midnight. It ends at its own next midnight when the next date's row is in
// the same zone; otherwise NEXT_GRACE_MIN after its last timed stop, never
// before Japan's midnight ending that date (exactly then with no timed stop),
// never after its own next midnight.
export function daySpan(s, date) {
  const trip = s && s.trip;
  const home = homeOf(trip);
  const rows = rowsOf(s);
  const row = rows.find((d) => d.date === date);
  if (!row) return null;
  const zone = zoneOf(trip, row);
  if (zone === home) return null;
  const next = dayAfter(date);
  const begins = instantOf(zone, date, 0);
  const own = instantOf(zone, next, 0);
  const after = rows.find((d) => d.date === next);
  if (after && zoneOf(trip, after) === zone) return { begins, ends: own };
  let last = null;
  for (const x of list(s.stops)) {
    if (!x || x.date !== date || x.deleted) continue;
    const m = minutesOf(x.time);
    if (m !== null && (last === null || m > last)) last = m;
  }
  const japan = instantOf(home, next, 0);
  const held = last === null ? japan : Math.max(japan, instantOf(zone, date, last) + NEXT_GRACE_MIN * 60000);
  return { begins, ends: Math.min(own, held) };
}

// { date, minutes, zone, local }: the day in force at this instant, and the
// minutes past midnight there. Inside a zoned row's span, that row's zone.
// Else, when Japan's date is a zoned row's date that has not begun yet, that
// row's zone (local: true). Else the trip's zone (local: false).
export function tripNow(s, nowMs) {
  const trip = s && s.trip;
  const home = homeOf(trip);
  const zoned = rowsOf(s).filter((d) => zoneOf(trip, d) !== home);
  for (const row of zoned) {
    const span = daySpan(s, row.date);
    if (span && nowMs >= span.begins && nowMs < span.ends) {
      const zone = zoneOf(trip, row);
      return { ...nowIn(zone, nowMs), zone, local: true };
    }
  }
  if (zoned.length) {
    const japan = dateIn(home, nowMs);
    const row = zoned.find((d) => d.date === japan);
    const span = row ? daySpan(s, row.date) : null;
    if (span && nowMs < span.begins) {
      const zone = zoneOf(trip, row);
      return { ...nowIn(zone, nowMs), zone, local: true };
    }
  }
  return { ...nowIn(home, nowMs), zone: home, local: false };
}

export function stopsFor(stops, date) {
  const mine = stops.filter((s) => s.date === date && !s.deleted);
  const timed = mine.filter((s) => minutesOf(s.time) !== null).sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
  return timed.concat(mine.filter((s) => minutesOf(s.time) === null));
}

// A stop that has started stays the day's next stop for this long (R38).
export const NEXT_GRACE_MIN = 30;

// Whole minutes to get to a stop, even from an old cache made before the
// backend rounded them; 0 when there are none.
const travelOf = (stop) => {
  const raw = Number(stop.travelMin);
  return isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
};

// The day's next stop: the first timed stop still to come, or one that has
// started and is still in its grace (R38): NEXT_GRACE_MIN minutes after its
// time, or until it is time to leave for the following timed stop, whichever
// comes first. `dayStops` in stopsFor order.
export function nextStopId(dayStops, minutes) {
  const timed = dayStops.filter((x) => minutesOf(x.time) !== null);
  const s = timed.find((x, i) => {
    const m = minutesOf(x.time);
    if (m > minutes) return true;
    const after = timed[i + 1];
    const leave = after ? minutesOf(after.time) - travelOf(after) : Infinity;
    return minutes < Math.min(m + NEXT_GRACE_MIN, leave);
  });
  return s ? s.id : null;
}

// A timed stop whose time has gone, unless it is still the next stop (R38).
export function isPast(stop, minutes, nextId = null) {
  const m = minutesOf(stop.time);
  return m !== null && m < minutes && stop.id !== nextId;
}

const span = (n) => {
  if (n < 60) return n + " min";
  const h = Math.floor(n / 60);
  const r = n % 60;
  return r ? h + " h " + r + " min" : h + " h";
};
const clock = (n) => String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");

export function nextLine(stop, minutes) {
  const at = minutesOf(stop.time);
  if (at === null) return "";
  // Started and still next (R38): no countdown.
  if (minutes >= at) return "Now.";
  const travel = travelOf(stop);
  if (travel > 0) {
    const leave = Math.max(0, at - travel);
    return minutes >= leave ? "Leave now." : "Leave by " + clock(leave) + ", in " + span(leave - minutes) + ".";
  }
  return "Next, in " + span(at - minutes) + ".";
}

// The zone's word for people: its long generic name without " Time"
// ("Eastern"); failing that, the zone id's last part with spaces.
export function zoneWord(zone) {
  try {
    const part = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "longGeneric" }).formatToParts(new Date(0)).find((p) => p.type === "timeZoneName");
    const name = part ? part.value.replace(/ Time$/, "").trim() : "";
    if (name && !/^(GMT|UTC)/.test(name)) return name;
  } catch {
    // an engine without longGeneric: the id
  }
  return String(zone || "").split("/").pop().replace(/_/g, " ");
}

// The two clocks over a hotel desk on a day in its own zone:
// { local, japan, japanDate } (local and japan in minutes past midnight).
export function zoneClocks(s, nowMs, zone) {
  const home = homeOf(s && s.trip);
  const j = nowIn(home, nowMs);
  return { local: nowIn(zone, nowMs).minutes, japan: j.minutes, japanDate: j.date };
}

// The eve whose next day is `date` (the evening before it), or null.
export function eveBefore(eves, date) {
  return list(eves).find((e) => e && typeof e.date === "string" && DATE_RE.test(e.date) && dayAfter(e.date) === date) || null;
}

// ---- where you are (js/where.js gives the position; it never leaves the phone) ----

// Past this a straight line says nothing (you would take a train): the
// leave-by and the stops' distances fall back to today's lines.
export const NEAR_M = 3000;
// The stamp is pressed "in the place" within this of the day's coordinates.
export const PLACE_M = 15000;

// Leave by, from where you are: the next stop's 現在地 line and its leave
// line from the walking minutes, or null when today's line stands (no time,
// already started, no coordinates, no usable position, or over NEAR_M).
// `here`: a usable position (js/where.js current()), or null.
// -> { dist: "1.2 km · 20 min on foot", lead, late }
export function hereLine(stop, minutes, here) {
  const at = minutesOf(stop && stop.time);
  if (at === null || !here || minutes >= at) return null;
  const m = metres(here, stop);
  if (!Number.isFinite(m) || m > NEAR_M) return null;
  const walk = walkMinutes(m);
  const spare = at - walk - minutes;
  const dist = distanceText(m) + " · " + walk + " min on foot";
  if (spare > 5) return { dist, lead: "Leave by " + clock(at - walk) + ", in " + span(spare) + ".", late: false };
  if (spare > 0) return { dist, lead: "Leave now. " + spare + " min to spare.", late: false };
  if (spare === 0) return { dist, lead: "Leave now.", late: false };
  return { dist, lead: "About " + span(-spare) + " late. Leave now.", late: true };
}

// A loose day: each stop still to come with no time and coordinates within
// NEAR_M gets its distance; the nearest is tagged 近い when two or more have
// one. The order never changes. -> { [id]: { dist, near } }
export function nearStops(dayStops, here) {
  const out = {};
  if (!here) return out;
  let best = null;
  for (const s of dayStops || []) {
    if (!s || s.deleted || minutesOf(s.time) !== null) continue;
    const m = metres(here, s);
    if (!Number.isFinite(m) || m > NEAR_M) continue;
    out[s.id] = { dist: distanceText(m) + " · " + walkMinutes(m) + " min on foot", near: false, m };
    if (!best || m < out[best].m) best = s.id;
  }
  const ids = Object.keys(out);
  if (ids.length > 1) out[best].near = true;
  for (const id of ids) delete out[id].m;
  return out;
}

// Past this the card says nothing of how far (another city, another day's stay).
export const STAY_FAR_M = 50000;

// "2.4 km from here" for the stay card, or "".
export function stayDistance(stay, here) {
  if (!here || !stay) return "";
  const m = metres(here, stay);
  return Number.isFinite(m) && m <= STAY_FAR_M ? distanceText(m) + " from here" : "";
}

// Whether a stamp for this day is pressed in the place: a usable position
// within PLACE_M of the day's coordinates.
export function inPlace(day, here) {
  if (!here || !day) return false;
  const m = metres(here, day);
  return Number.isFinite(m) && m <= PLACE_M;
}

export function stayFor(stays, date) {
  let best = null;
  for (const s of stays) {
    if (s.deleted || !s.firstNight || !s.lastNight) continue;
    if (s.firstNight <= date && date <= s.lastNight && (!best || s.firstNight < best.firstNight)) best = s;
  }
  return best;
}

// The night ends at 04:00 in the trip's zone (R37).
export const NIGHT_ENDS_MIN = 240;

// The stay a ticket shows: the night's stay (stayFor), except on today's
// ticket before NIGHT_ENDS_MIN, when it is the stay of the night just begun
// (last night's) if there is one and it differs from tonight's (R37).
// `today` and `minutes`: the Days clock in the trip's zone.
export function stayShownFor(stays, date, { today, minutes } = {}) {
  const tonight = stayFor(stays, date);
  if (date !== today || !(minutes < NIGHT_ENDS_MIN)) return tonight;
  const last = stayFor(stays, dayBefore(date));
  return last && last !== tonight ? last : tonight;
}

// Which night of a stay is in force (S2 鍵札): { total, n, state }. total:
// the nights from firstNight to lastNight. The night in force is today's, or
// the day before's until NIGHT_ENDS_MIN (the night just begun). state is
// "before" (n 0), "on" (n 1 to total) or "after" (n = total).
export function nightOf(stay, { today, minutes } = {}) {
  const first = str(stay && stay.firstNight);
  const last = str(stay && stay.lastNight);
  if (!DATE_RE.test(first) || !DATE_RE.test(last) || last < first) return { total: 0, n: 0, state: "before" };
  const total = dayNumber(last) - dayNumber(first) + 1;
  const night = typeof today === "string" && DATE_RE.test(today) ? (minutes < NIGHT_ENDS_MIN ? dayBefore(today) : today) : "";
  if (!night || night < first) return { total, n: 0, state: "before" };
  if (night > last) return { total, n: total, state: "after" };
  return { total, n: dayNumber(night) - dayNumber(first) + 1, state: "on" };
}

// A stay's dates in short, from the first night to the morning after the
// last: "Dec 10 to 13", "Dec 30 to Jan 2". "" when its nights are not dates.
export function staySpan(stay) {
  const first = str(stay && stay.firstNight);
  const last = str(stay && stay.lastNight);
  if (!DATE_RE.test(first) || !DATE_RE.test(last)) return "";
  const [, m1, d1] = first.split("-").map(Number);
  const [, m2, d2] = dayAfter(last).split("-").map(Number);
  return SHORT_MON[m1 - 1] + " " + d1 + " to " + (m1 === m2 ? "" : SHORT_MON[m2 - 1] + " ") + d2;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHORT_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayAfter = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

export function safeHref(v) {
  return typeof v === "string" && /^https?:\/\/\S+$/i.test(v) ? v : "";
}

// A place that is text (not a link), else "".
const placeText = (v) => (safeHref(v) ? "" : str(v));

const dayBefore = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
};

// Directions from here: Google Maps with no starting point, so Maps starts
// from wherever the phone is (MAT never sees that position). By train and
// bus. A place that is a link is opened as it is.
export function mapsUrl(stop) {
  const link = safeHref(stop.place);
  if (link) return link;
  const dest = str(stop.place) || str(stop.title);
  if (!dest) return "";
  return "https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=" + encodeURIComponent(dest);
}

export function stayMapsUrl(stay) {
  const link = safeHref(stay.place);
  if (link) return link;
  const q = str(stay.place) || str(stay.addressJp) || str(stay.name);
  return q ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q) : "";
}

export function inkFor(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const lin = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
  return lum > 0.4 ? "#15120F" : "#FFFFFF";
}

export function header(day) {
  const d = day || {};
  const jp = str(d.lineJp);
  const en = str(d.lineEn);
  const ink = inkFor(d.lineColour);
  const fromJp = str(d.fromJp), fromEn = str(d.fromEn), toJp = str(d.toJp), toEn = str(d.toEn);
  return {
    line: jp || en ? { jp, en } : null,
    colour: ink ? d.lineColour : null,
    ink,
    route: (fromJp || fromEn) && (toJp || toEn) ? { fromJp, fromEn, toJp, toEn } : null,
    city: str(d.city),
    title: str(d.title),
  };
}

export function dayTotalYen(expenses, date) {
  let sum = 0;
  for (const e of expenses) {
    if (e.day !== date || e.deleted) continue;
    const v = jpyOf(e);
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}

export function gateDate(date) {
  return date.slice(5).replace("-", ".");
}

export function issueLine(date, dayNumber, mark) {
  return date.replace(/-/g, ".") + " " + mark + "発行 " + String(dayNumber).padStart(5, "0") + "-01";
}
