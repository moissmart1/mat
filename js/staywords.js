/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The words for a stay's booking (look A, 予約票): pure, no DOM. Used by the
// hotel card (js/views/staycard.js), the Tickets tab (js/views/passcase.js),
// the day's 宿泊 line (js/views/ticket.js) and the booking held up
// (js/views/stub.js).
//
// - nightsShort(night), nightsLong(night), nightLabel(night): the night in
//   Japanese-led short form ("2 / 3泊"), in English ("Night 2 of 3") and the
//   label word ("Night" / "Nights"). One night never reads "1 / 1".
// - stayArrow(stay), stayDots(stay): the dates, "Dec 10 → Dec 13" and
//   "12.10 → 12.13", from the first night to the morning after the last.
// - stayDayNums(stay, days): the trip's day numbers, "01–03".
// - peopleWord(v): the head count as typed, "3" as "3名".
// - cardCell(stay, mark): the hotel card form's left cell.
// night is js/plan.js nightOf's { total, n, state }.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const str = (v) => (typeof v === "string" ? v.trim() : "");
const two = (n) => String(n).padStart(2, "0");

const hasTotal = (night) => !!night && night.total > 0;

export function nightsShort(night) {
  if (!hasTotal(night)) return "";
  if (night.total === 1) return "1泊";
  return night.state === "on" ? night.n + " / " + night.total + "泊" : night.total + "泊";
}

export function nightsLong(night) {
  if (!hasTotal(night)) return "";
  if (night.total === 1) return "1 night";
  return night.state === "on" ? "Night " + night.n + " of " + night.total : night.total + " nights";
}

export function nightLabel(night) {
  return night && (night.state === "on" || night.total === 1) ? "Night" : "Nights";
}

const dayAfter = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

// [first night, morning after the last] as dates, or null.
function span(stay) {
  const first = str(stay && stay.firstNight);
  const last = str(stay && stay.lastNight);
  if (!DATE_RE.test(first) || !DATE_RE.test(last) || last < first) return null;
  return [first, dayAfter(last)];
}

export function stayArrow(stay) {
  const s = span(stay);
  if (!s) return "";
  const [a, b] = s.map((d) => d.split("-").map(Number));
  return MON[a[1] - 1] + " " + a[2] + " → " + MON[b[1] - 1] + " " + b[2];
}

export function stayDots(stay) {
  const s = span(stay);
  if (!s) return "";
  const [a, b] = s.map((d) => d.split("-").map(Number));
  return a[1] + "." + two(a[2]) + " → " + b[1] + "." + two(b[2]);
}

export function stayDayNums(stay, days) {
  const first = str(stay && stay.firstNight);
  const last = str(stay && stay.lastNight);
  const list = Array.isArray(days) ? days : [];
  const at = (date) => list.findIndex((d) => d && d.date === date);
  const i = DATE_RE.test(first) ? at(first) : -1;
  if (i < 0) return "";
  const j = DATE_RE.test(last) && last > first ? at(last) : -1;
  return j < 0 ? two(i + 1) : two(i + 1) + "–" + two(j + 1);
}

export function peopleWord(v) {
  const t = str(v);
  return /^\d+$/.test(t) ? t + "名" : t;
}

export function cardCell(stay, mark) {
  const ref = str(stay && stay.tkRef);
  if (ref) return { jp: "予約番号", en: "Booking no.", value: ref };
  if (mark && mark.kind === "pics") return { jp: "予約確認書", en: "Confirmation", value: mark.label };
  return { jp: "予約", en: "Booking", value: str(stay && stay.tkName) || "Booked" };
}
