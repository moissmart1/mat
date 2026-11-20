/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The Tickets tab (定期入れ, the pass case): which ticket stands in the
// window, what stands in each pocket, and the counts. Pure: no DOM, no
// storage, no clock of its own (callers pass the instant). It reads only what
// the phone already holds: the stops, the ticket rows and which pictures are
// kept on this phone (have). Nothing new is stored.
//
// A ticket is a stop with a 券 mark (js/tickets.js ticketMark): pictures, or
// the facts alone (reference only). A ticket is used when its stop is over by
// the Days screen's own rule: an earlier day, or today and past by isPast
// with the day's next stop (R38) kept. Untimed stops stand after the timed
// ones of their day (stopsFor) and are used only once their day is over.
//
// passCase(state, nowMs, { have, here }) ->
//   { on, date, next, today, later, used, toCome, todayLeft, empty, hook }
// - on: the trip has begun (tripStarted: from the eve when there is one): the
//   Tickets key is in the bar in Before's place.
// - date: today by the Days clock (plan.js tripNow: a day in its own zone
//   is that place's). An eve's tickets stand by date as any other (day 0).
// - next: the next ticket not yet used (soonest first), or null.
// - today / later: the other tickets not yet used, today's and later days',
//   soonest first (the window's is in neither).
// - used: the used ones, most recent first.
// - toCome: every ticket not yet used (the window's too).
// - todayLeft: today's not yet used (the window's too, when it is today's):
//   the key's badge.
// - empty: no stop has a ticket (or the tickets are not loaded yet).
// Each ticket: { id, date, time, title, detail, seat, day, line, colour,
//   status: { kind: "have" | "needs" | "ref", label, ref }, first, lead }
// - first: the first picture's id (this phone's person's first) when it is
//   on this phone, else null.
// - lead: the window's only: the leave line the departure board prints for
//   today's next stop (travel minutes, or where the phone is), else null.
// - hook: the stay shown tonight (stayShownFor, so before 04:00 last night's)
//   when it has a booking (stayMark), as { id, name, ref, n, total, state,
//   mark } (nightOf), else null. It changes nothing else: a stay's pictures
//   are never in the window, a pocket or a count.

import { tripNow, stopsFor, nextStopId, isPast, minutesOf, nextLine, hereLine, header, stayShownFor, nightOf } from "./plan.js";
import { ticketMark, ticketKinds, stayMark } from "./tickets.js";
import { tidyLine } from "./board.js";

const str = (v) => (typeof v === "string" ? v.trim() : "");
const list = (v) => (Array.isArray(v) ? v : []);
// The trip has begun by the Days clock (tripNow): from the evening before
// the first day when there is one (state.eves), else from the first day
// (and the trip is loaded).
export function tripStarted(s, nowMs) {
  if (!s || s.status !== "ready" || !s.trip || typeof s.trip.start !== "string" || !s.trip.start) return false;
  const eve = list(s.eves).find((d) => d && typeof d.date === "string" && d.date);
  return tripNow(s, nowMs).date >= (eve ? eve.date : s.trip.start);
}

// The status line of a ticket, from its 券 mark.
function statusOf(mark, stop) {
  if (mark.kind === "ref") return { kind: "ref", label: "Reference only", ref: str(stop.tkRef) };
  return { kind: mark.saved ? "have" : "needs", label: mark.label, ref: "" };
}

// The first picture: this phone's person's first, then by page.
function firstPicture(pics, me, have) {
  const k = ticketKinds(pics);
  if (!k.kind) return null;
  const sorted = k.list.slice().sort((a, b) => (a.who === me ? 0 : 1) - (b.who === me ? 0 : 1) || (Number(a.page) || 0) - (Number(b.page) || 0));
  const first = sorted[0];
  return first && have(first.id) ? first.id : null;
}

export function passCase(s, nowMs, { have = () => false, here = null } = {}) {
  const now = tripNow(s, nowMs);
  const out = { on: tripStarted(s, nowMs), date: now.date, next: null, today: [], later: [], used: [], toCome: 0, todayLeft: 0, empty: true, hook: null };
  if (!s || s.status !== "ready" || s.ticketsReady !== true) return out;

  const days = list(s.days).filter((d) => d && typeof d.date === "string");
  const stops = list(s.stops).filter((x) => x && typeof x.id === "string" && x.id && typeof x.date === "string" && x.date && !x.deleted);
  const tickets = list(s.tickets).filter((t) => t && typeof t.id === "string" && t.id);

  // The hook: tonight's stay, when it has a booking (before the case's own tickets, so it shows with none).
  const clock = { today: now.date, minutes: now.minutes };
  const stay = stayShownFor(list(s.stays).filter((x) => x && typeof x.id === "string" && x.id), now.date, clock);
  const stayM = stay ? stayMark(stay, tickets, have) : null;
  if (stayM) {
    const night = nightOf(stay, clock);
    out.hook = { id: stay.id, name: str(stay.name) || str(stay.nameJp), ref: str(stay.tkRef), n: night.n, total: night.total, state: night.state, mark: stayM };
  }
  const dates = [...new Set(stops.map((x) => x.date))].sort();

  // Every ticket, in the order of the trip: by day, then the Days screen's order.
  const all = [];
  for (const date of dates) {
    const dayStops = stopsFor(stops, date);
    const nextId = date === now.date ? nextStopId(dayStops, now.minutes) : null;
    const di = days.findIndex((d) => d.date === date);
    const h = header(di >= 0 ? days[di] : { date });
    for (const stop of dayStops) {
      const mark = ticketMark(stop, tickets, have);
      if (!mark) continue;
      const used = date < now.date || (date === now.date && isPast(stop, now.minutes, nextId));
      all.push({
        used,
        stop,
        t: {
          id: stop.id,
          date,
          time: minutesOf(stop.time) === null ? "" : stop.time,
          title: str(stop.title),
          detail: str(stop.detail),
          seat: str(stop.tkSeat),
          day: di >= 0 ? di + 1 : 0,
          line: h.line,
          colour: h.colour,
          ink: h.ink,
          status: statusOf(mark, stop),
          first: mark.kind === "ref" ? null : firstPicture(tickets.filter((p) => p.stop === stop.id), s.me, have),
          lead: null,
        },
      });
    }
  }
  if (!all.length) return out;
  out.empty = false;

  const ahead = all.filter((x) => !x.used);
  out.used = all.filter((x) => x.used).reverse().map((x) => x.t);
  out.toCome = ahead.length;
  out.todayLeft = ahead.filter((x) => x.t.date === now.date).length;
  if (ahead.length) {
    const first = ahead[0];
    if (first.t.date === now.date && first.t.time) {
      const h = here ? hereLine(first.stop, now.minutes, here) : null;
      const line = h ? h.lead : nextLine(first.stop, now.minutes);
      first.t.lead = line ? tidyLine(line) : null;
    }
    out.next = first.t;
    for (const x of ahead.slice(1)) (x.t.date === now.date ? out.today : out.later).push(x.t);
  }
  return out;
}
