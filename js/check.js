/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The owner's trip check (issue 86): what the trip is still missing. Pure: no
// DOM, no storage, no clock of its own (the caller gives the time).
//
// missing(state, nowMs) -> lines, each
//   { id, kind, date, time, label, title, why, open }
// Only what is still ahead counts (nothing dated before today, the trip's
// own zone, as js/ready.js reckons it). Six kinds:
//   night         a night with no stay (a run of them is one line)
//   stay-jp       a stay with neither a Japanese name nor an address
//   stay-booking  a stay with no booking number and no picture
//   ticket        a fixed-time stop with no picture and no facts
//   codes         a stop with per-person codes, some people holding none
//   place         a stop with no place and no position
// open says what a tap opens: { type: "day", date } | { type: "stay", id } |
// { type: "stay-edit", id } | { type: "stop", id }.
// ownerOf(state): this phone is on the first person's own link.
// lineWords(n): the board line's words.

import { tripNow, stayFor, nightOf, minutesOf } from "./plan.js";
import { ticketKinds, ticketMark, whoseOf, stayPictures, sameName } from "./tickets.js";
import { point } from "./geo.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v) => (typeof v === "string" ? v.trim() : "");
const list = (v) => (Array.isArray(v) ? v : []);

const dayPlus = (date, n) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export function ownerOf(s) {
  if (!s || s.personal !== true || typeof s.me !== "string" || !s.me) return false;
  const first = list(s.people)[0];
  return !!first && sameName(first.name, s.me);
}

export const lineWords = (n) => (!(n > 0) ? "" : n === 1 ? "1 thing missing" : n + " things missing");

const STAY_LABEL = "宿泊 Stay";
const TICKET_LABEL = "券 Ticket";
const PLACE_LABEL = "行先 Place";
// The order of one date's lines: the stays', then the stops'.
const RANK = { night: 1, "stay-jp": 2, "stay-booking": 3, ticket: 4, codes: 5, place: 6 };

// "A", "A and B", "A, B and C".
const nameList = (names) => (names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]);
const nameOf = (stay) => (stay ? str(stay.name) || str(stay.nameJp) : "");

export function missing(s, nowMs) {
  if (!s || typeof s !== "object") return [];
  const today = tripNow(s, nowMs).date;
  const out = [];
  const people = list(s.people).map((p) => (p && typeof p.name === "string" ? p.name.trim() : "")).filter(Boolean);
  const tickets = list(s.tickets);
  const stays = list(s.stays).filter((x) => x && typeof x === "object");

  // 1. Nights with no stay: every date from the first row (the eves too) to
  // the day before the last row, from today on.
  const dates = list(s.eves)
    .concat(list(s.days))
    .map((d) => (d && typeof d.date === "string" ? d.date : ""))
    .filter((d) => DATE_RE.test(d))
    .sort();
  if (dates.length > 1) {
    const last = dates[dates.length - 1];
    const bare = [];
    for (let d = dates[0]; d < last; d = dayPlus(d, 1)) if (d >= today && !stayFor(stays, d)) bare.push(d);
    for (let i = 0; i < bare.length; ) {
      let j = i;
      while (j + 1 < bare.length && bare[j + 1] === dayPlus(bare[j], 1)) j += 1;
      const run = bare.slice(i, j + 1);
      i = j + 1;
      const before = nameOf(stayFor(stays, dayPlus(run[0], -1)));
      const after = nameOf(stayFor(stays, dayPlus(run[run.length - 1], 1)));
      out.push({
        id: "night:" + run[0],
        kind: "night",
        date: run[0],
        time: "",
        label: STAY_LABEL,
        title: run.length === 1 ? "No stay for this night" : "No stay for " + run.length + " nights",
        why: before && after ? "Between " + before + " and " + after : before ? "After " + before : after ? "Before " + after : "No stays yet",
        open: { type: "day", date: run[0] },
      });
    }
  }

  // 2 and 3. Stays still ahead.
  for (const stay of stays) {
    if (stay.deleted || typeof stay.id !== "string" || !stay.id) continue;
    const first = str(stay.firstNight);
    const lastNight = str(stay.lastNight);
    if (!DATE_RE.test(first) || !DATE_RE.test(lastNight) || lastNight < first || lastNight < today) continue;
    const total = nightOf(stay, {}).total;
    const title = (nameOf(stay) || "A stay") + ", " + total + (total === 1 ? " night" : " nights");
    const date = first > today ? first : today;
    if (!str(stay.nameJp) && !str(stay.addressJp)) {
      out.push({ id: "stay-jp:" + stay.id, kind: "stay-jp", date, time: "", label: STAY_LABEL, title, why: "No Japanese name or address: nothing to show a driver", open: { type: "stay", id: stay.id } });
    }
    const pics = s.ticketsReady === true ? stayPictures(stay, tickets) : [];
    if (!str(stay.tkRef) && !pics.length) {
      out.push({ id: "stay-booking:" + stay.id, kind: "stay-booking", date, time: "", label: STAY_LABEL, title, why: "No booking number or page", open: { type: "stay-edit", id: stay.id } });
    }
  }

  // 4 to 6. Stops still ahead.
  for (const stop of list(s.stops)) {
    if (!stop || stop.deleted || typeof stop.id !== "string" || !stop.id || typeof stop.date !== "string" || stop.date < today) continue;
    const time = str(stop.time);
    const title = (str(stop.title) || "A stop") + (time ? ", " + time : "");
    const mine = tickets.filter((t) => t && t.stop === stop.id && typeof t.id === "string" && t.id && !t.gone);
    const base = { date: stop.date, time, title, open: { type: "stop", id: stop.id } };
    if (stop.fixed === true && !mine.length && !ticketMark(stop, tickets, () => true)) {
      out.push({ ...base, id: "ticket:" + stop.id, kind: "ticket", label: TICKET_LABEL, why: "Fixed time, no ticket or reference" });
    }
    const k = ticketKinds(mine);
    if (k.kind === "pp" && !k.list.some((t) => !str(t.who))) {
      const holders = whoseOf(stop, tickets, "", people).holders;
      const others = people.filter((n) => !holders.some((h) => sameName(h, n)));
      if (others.length) {
        const who = holders.length === 1 ? "A code for " + holders[0] : "Codes for " + nameList(holders);
        out.push({ ...base, id: "codes:" + stop.id, kind: "codes", label: TICKET_LABEL, why: who + ", none for " + nameList(others) });
      }
    }
    if (!str(stop.place) && !point(stop)) {
      out.push({ ...base, id: "place:" + stop.id, kind: "place", label: PLACE_LABEL, why: "No place: Directions has only the name to go on" });
    }
  }

  // By date; a date's stays first, then its stops by time (untimed last).
  const stayKind = (l) => l.kind === "night" || l.kind === "stay-jp" || l.kind === "stay-booking";
  const mins = (l) => {
    const m = minutesOf(l.time);
    return m === null || m === undefined ? Infinity : m;
  };
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return out.sort((a, b) => {
    if (a.date !== b.date) return cmp(a.date, b.date);
    const ga = stayKind(a) ? 0 : 1;
    const gb = stayKind(b) ? 0 : 1;
    if (ga !== gb) return ga - gb;
    if (ga === 0) return RANK[a.kind] - RANK[b.kind] || cmp(a.title, b.title) || cmp(a.id, b.id);
    const ma = mins(a);
    const mb = mins(b);
    if (ma !== mb) return ma < mb ? -1 : 1;
    return cmp(a.title, b.title) || cmp(a.open.id, b.open.id) || RANK[a.kind] - RANK[b.kind];
  });
}
