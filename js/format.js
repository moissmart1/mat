/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// How figures, days and sentences are written on screen. Pure: no DOM.

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WK = ["日", "月", "火", "水", "木", "金", "土"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// Whole yen: yen(14500) -> "¥14,500".
export function yen(n) {
  const v = Math.round(n);
  return (v < 0 ? "-" : "") + "¥" + grouped(Math.abs(v));
}

// Integer cents: dollars(13063) -> "$130.63".
export function dollars(cents) {
  const v = Math.round(cents);
  const abs = Math.abs(v);
  return (v < 0 ? "-" : "") + "$" + grouped(Math.floor(abs / 100)) + "." + String(abs % 100).padStart(2, "0");
}

// The figure as it was entered: yen for a yen line, dollars for a dollar line.
export function typed(e) {
  return e.currency === "CAD" ? dollars(Math.round(e.amount * 100)) : yen(e.amount);
}

const parts = (date) => date.split("-").map(Number); // "2026-12-11" -> [2026, 12, 11]
const weekday = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

// A receipt day heading: { jp, en, city }.
export function dayHead(day, days) {
  if (day === "pre") return { jp: "出発前", en: "Before the trip", city: "" };
  const [y, m, d] = parts(day);
  const w = weekday(y, m, d);
  const row = (days || []).find((x) => x.date === day);
  return { jp: m + "月" + d + "日(" + WK[w] + ")", en: WD[w] + " " + MON[m - 1] + " " + d, city: (row && row.city) || "" };
}

const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// A date's weekday: { jp: "水", en: "Wed", long: "Wednesday" }.
export function weekdayOf(day) {
  const [y, m, d] = parts(day);
  const w = weekday(y, m, d);
  return { jp: WK[w], en: WD[w], long: WD_LONG[w] };
}

// The register's day: "Sat 12", or "Before" for before the trip.
export function dayShort(day) {
  if (day === "pre") return "Before";
  const [y, m, d] = parts(day);
  return WD[weekday(y, m, d)] + " " + d;
}

// The trip's dates in short: "Dec 10 to 20", or "Dec 28 to Jan 3".
export function tripSpan(trip) {
  const [, m1, d1] = parts(trip.start);
  const [, m2, d2] = parts(trip.end);
  return MON[m1 - 1] + " " + d1 + " to " + (m1 === m2 ? "" : MON[m2 - 1] + " ") + d2;
}

// The issuer's mark: first letters of the names, in order ("MAT").
export function issuer(people) {
  return people.map((p) => [...String(p.name)][0] || "").join("").toUpperCase();
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// HTML for a figure, escaped first, with . , ¥ $ each in <span class="pt">.
export function pt(str) {
  return String(str)
    .replace(/[&<>"']/g, (c) => ESC[c])
    .replace(/[.,¥$]/g, '<span class="pt">$&</span>');
}

// "13:20" in the phone's own time zone.
export function clock(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// "Fri Dec 20, 14:12 Japan time": a moment in Japan's time (UTC+9, no summer
// time) whatever zone the phone is in; "" when ms is not a time.
export function japanTime(ms) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + 9 * 3600000);
  const two = (n) => String(n).padStart(2, "0");
  return WD[d.getUTCDay()] + " " + MON[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + two(d.getUTCHours()) + ":" + two(d.getUTCMinutes()) + " Japan time";
}

// The day of a moment in the phone's own time zone, as "YYYY-MM-DD" ("" when ms is not a time).
export function localDay(ms) {
  if (!isFinite(ms)) return "";
  const d = new Date(ms);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// "Up to date 13:20": how fresh the figures on screen are (the receipt and Settings both show it).
export function freshText(ms) {
  return "Up to date " + clock(ms);
}

// Who a change came through, after its sentence: " (through Claude)", " (from the planner)" or "".
export function viaText(via) {
  return via === "claude" ? " (through Claude)" : via === "planner" ? " (from the planner)" : "";
}

// A history entry as one sentence: "Ajen rang up Tempura ¥101".
export function historySentence(entry) {
  return entry.who + " " + entry.summary + viaText(entry.via);
}

// Where the viewer stands, from money.js standing().
export function sentence(s) {
  if (s.kind === "owed") return s.who ? s.who + " owes you " + dollars(s.cents) + "." : "You’re owed " + dollars(s.cents) + ".";
  if (s.kind === "owe") return s.who ? "You owe " + s.who + " " + dollars(s.cents) + "." : "You owe " + dollars(s.cents) + ".";
  if (s.kind === "even") return "You’re even overall.";
  return "You’re square.";
}

// The undo bar's line for the store's lastChange.
export function changeText(c) {
  const item = c.item || {};
  if (c.kind === "stop") {
    switch (c.action) {
      case "add": return "Added " + item.title + ".";
      case "edit": return "Changed " + item.title + ".";
      case "delete": return "Removed " + item.title + ".";
      case "restore": return "Put back " + item.title + ".";
      default: return "Undone.";
    }
  }
  // A stay: its booking edited (Edit stay), or one added by bulk add.
  if (c.kind === "stay") {
    switch (c.action) {
      case "add": return "Added " + item.name + ".";
      case "edit": return "Changed " + item.name + ".";
      case "delete": return "Removed " + item.name + ".";
      case "restore": return "Put back " + item.name + ".";
      default: return "Undone.";
    }
  }
  // A ticket picture on a stop (js/tickets.js).
  if (c.kind === "ticket") {
    if (c.action === "add") return "Added a ticket picture.";
    if (c.action === "remove") return "Removed a ticket picture.";
    return "Undone.";
  }
  if (c.kind === "todo") {
    switch (c.action) {
      case "tick": return "Ticked off " + item.item + ".";
      case "claim": return "You’re on " + item.item + ".";
      case "takeover": return "Took over " + item.item + ".";
      case "unclaim": return "Handed back " + item.item + ".";
      // An undone tick, with what it left in the planner (js/todos.js untickOutcome).
      default:
        if (c.planner === "pending") return "Undone. The planner couldn’t be changed back, so it may still say Booked.";
        if (c.planner === "kept") return "Undone. The planner’s Status was changed there since, so it was left as it is.";
        return "Undone.";
    }
  }
  switch (c.action) {
    case "add": return "Rang up " + item.title + " " + typed(item) + ".";
    case "edit": return "Changed " + item.title + ".";
    case "delete": return "Deleted " + item.title + ".";
    case "restore": return "Brought back " + item.title + ".";
    case "stamp": return "Stamped " + dollars(Math.round(item.cad * 100)) + " to " + item.to + ".";
    case "unstamp": return "Stamp removed.";
    case "restamp": return "Stamp put back.";
    default: return "Undone.";
  }
}
