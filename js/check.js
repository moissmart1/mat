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
//
// The roll call (issue 96), from state.roll (the owner's load only):
// peopleWords(roll, me): who needs a nudge, as the line says it ("" none).
// checkWords(n, people): the line's words, missing things and people.
// rollRow(entry, { owner, ownReady }): one person's row, as words.
// shortDay(date): "Nov 25"; stampDay(date): "11.25" (the date string alone).

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

// ---- the roll call (issue 96) ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDay = (date) => (DATE_RE.test(str(date)) ? MONTHS[Number(date.slice(5, 7)) - 1] + " " + Number(date.slice(8, 10)) : "");
export const stampDay = (date) => (DATE_RE.test(str(date)) ? date.slice(5).replace("-", ".") : "");

export const ROLL_NOTE = "Each phone says two things only: that it opened, and whether it is ready for no signal.";

const rollList = (roll) => list(roll).filter((e) => e && typeof e === "object" && str(e.name));

// Who needs a nudge, the owner never counted: someone who has not opened,
// else someone whose phone said it is not ready. Opened with nothing said
// is not a nudge.
export function peopleWords(roll, me) {
  const others = rollList(roll).filter((e) => !sameName(e.name, me));
  const shut = others.filter((e) => !str(e.opened));
  if (shut.length === 1) return str(shut[0].name) + " has not opened";
  if (shut.length > 1) return shut.length + " have not opened";
  const notReady = others.filter((e) => e.ready === false);
  if (notReady.length === 1) return str(notReady[0].name) + "’s phone is not ready";
  if (notReady.length > 1) return notReady.length + " phones not ready";
  return "";
}

// The line's words: missing things and people, either alone, or "" (hidden).
export function checkWords(n, people) {
  const p = str(people);
  if (n > 0 && p) return n + " missing · " + p;
  if (n > 0) return lineWords(n);
  return p;
}

// One person's row: { name, lines: [{ text, not }], opened: "11.25" | "",
// openedLabel, ready: "ok" | "no", readyLabel }. opened "" draws the empty
// circle; ready "no" the empty circle. The owner's ready box is this phone's
// own answer now (ownReady), never the stored one.
export function rollRow(e, { owner = false, ownReady = null } = {}) {
  const name = str(e && e.name);
  const opened = str(e && e.opened);
  const said = shortDay(e && e.said);
  const stamp = stampDay(opened);
  const out = {
    name,
    lines: [],
    opened: stamp,
    openedLabel: stamp ? "Opened " + shortDay(opened) : "Not opened",
    ready: "no",
    readyLabel: "Nothing said yet",
  };
  const readyIs = (r) => {
    out.ready = r === true ? "ok" : "no";
    out.readyLabel = r === true ? "Ready" : r === false ? "Not ready" : "Nothing said yet";
  };
  if (owner) {
    out.lines.push({ text: "This phone", not: false });
    readyIs(ownReady === true ? true : ownReady === false ? false : null);
    return out;
  }
  if (!stamp) {
    const link = shortDay(e && e.linkDay);
    if (link) out.lines.push({ text: "Not opened yet", not: true }, { text: "Link made " + link, not: false });
    else out.lines.push({ text: "No link yet", not: true });
    return out;
  }
  const r = e.ready === true ? true : e.ready === false ? false : null;
  readyIs(r);
  if (r === true) out.lines.push({ text: "Ready for no signal" + (said ? ", said " + said : ""), not: false });
  else if (r === false) out.lines.push({ text: "Not ready yet" + (said ? ", said " + said : ""), not: true });
  else out.lines.push({ text: "Opened " + shortDay(opened), not: false }, { text: "Nothing said about no signal yet", not: false });
  return out;
}
