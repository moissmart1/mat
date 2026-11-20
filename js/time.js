/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Trip days judged in the trip's own time zone, and client-made ids.

// "YYYY-MM-DD" for this instant in the given IANA time zone.
export function dateIn(tz, nowMs) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(nowMs));
  const get = (type) => parts.find((p) => p.type === type).value;
  return get("year") + "-" + get("month") + "-" + get("day");
}

// `today`: the Days clock's date (plan.js tripNow), when the caller has it;
// else the trip zone's date at nowMs.
export function tripDay(trip, nowMs, today = dateIn(trip.tz, nowMs)) {
  if (today < trip.start) return "pre";
  if (today > trip.end) return "post";
  return today;
}

export function defaultRingDay(trip, nowMs, today) {
  const day = tripDay(trip, nowMs, today);
  return day === "post" ? trip.end : day;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// 20 characters from A-Za-z0-9, so it passes the backend's id rule.
export function newId() {
  let out = "";
  while (out.length < 20) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    for (const b of bytes) {
      // 248 = 4 * 62: drop the top bytes so every character is equally likely.
      if (b < 248 && out.length < 20) out += ALPHABET[b % 62];
    }
  }
  return out;
}
