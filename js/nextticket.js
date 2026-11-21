/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Your next ticket, standing in the slot above the bar on Days (issue #83,
// option C, Mo's pick on 2026-11-21): the words for it. Pure: no DOM, no
// storage, no clock of its own (callers pass the instant).
//
// The ticket is yours (fix round, the coordinator's rule after Mo's "Ajen
// should never be lost"): the first ticket not yet used, in the pass case's
// order (js/passcase.js), where you have a code of your own, or there is one
// for all of us, or it is a booking reference. A stop before it where others
// have codes and you have none is said in one line in place of the label
// ("No code for you at Shibuya Sky · Sat"), so you find out before the gate.
// With no such ticket of yours at all, the slot holds the next ticket as the
// pass case's window does (a stop where you have none says so). A used ticket
// is never in it; it works before the trip too.
//
// slotModel(state, nowMs, { have, here }) -> null, or
//   { id, whose, label: { jp, en }, tag, title, line, aria, colour, ink, warn }
// - null: no trip key, the tickets not loaded, no ticket at all, every one
//   used (the trip over too).
// - whose: js/tickets.js whoseOf ({ kind, seat, holders, count }).
// - label: the small line over the title (jp is decoration, not read out).
// - tag: "こんど" on the trip when the ticket is today's, else "".
// - title: the stop's title ("Ticket" when it has none).
// - line: the second line: another day "Sat Dec 12 · 14:00 · Car 7 · 10B";
//   today, the leave line when there is one (the case's own words), else
//   "14:00 · seat" ("Today · seat" with no time); whose none says "none for
//   you yet" in place of the seat.
// - warn: null, or { id, title, when, text } for the earlier stop where you
//   have no code: text "No code for you at <title> · <when>", when its
//   weekday ("Sat"), or today its time ("14:00", "today" with none).
// - aria: the button's label, whose in words, then the warning.
// - colour, ink: the day's line colour and the ink on it (the band).

import { passCase } from "./passcase.js";
import { dayHead } from "./format.js";
import { tripNow, nextLine, hereLine, minutesOf } from "./plan.js";
import { tidyLine } from "./board.js";

export const LABELS = {
  mine: { jp: "あなたの切符", en: "Your next ticket" },
  all: { jp: "全員", en: "Next ticket · all of us" },
  ref: { jp: "番号のみ", en: "Next ticket · reference only" },
  none: { jp: "つぎの切符", en: "Next ticket" },
};
const ARIA = {
  mine: "Show your ticket: ",
  all: "Show the ticket for all of us: ",
  ref: "Show the booking reference: ",
  none: "Show ticket: ",
};
export const NONE_YET = "none for you yet";

const join = (parts, by) => parts.filter(Boolean).join(by);

export function slotModel(s, nowMs, { have = () => false, here = null } = {}) {
  if (!s || s.status !== "ready") return null;
  const c = passCase(s, nowMs, { have, here });
  if (!c.next) return null;
  // Yours: the first not yet used that is not a stop where only others have codes.
  const ahead = [c.next, ...c.today, ...c.later];
  const at = ahead.findIndex((x) => !x.whose || x.whose.kind !== "none");
  const t = at === -1 ? c.next : ahead[at];
  const skipped = at > 0 ? ahead[0] : null;
  // Its leave line, when it is today's and not the window's (the case's own rule).
  let lead = t.lead;
  if (t !== c.next && t.date === c.date && t.time) {
    const stop = (Array.isArray(s.stops) ? s.stops : []).find((x) => x && x.id === t.id);
    const now = tripNow(s, nowMs);
    if (stop && minutesOf(stop.time) !== null) {
      const h = here ? hereLine(stop, now.minutes, here) : null;
      const raw = h ? h.lead : nextLine(stop, now.minutes);
      lead = raw ? tidyLine(raw) : null;
    }
  }
  const whose = t.whose || { kind: t.status.kind === "ref" ? "ref" : "all", seat: t.seat, holders: [], count: 0 };
  const kind = LABELS[whose.kind] ? whose.kind : "all";
  const today = t.date === c.date;
  const title = t.title || "Ticket";
  const seat = kind === "none" ? NONE_YET : whose.seat;

  let line;
  let when;
  if (!today) {
    when = join([dayHead(t.date, []).en, t.time], " ");
    line = join([dayHead(t.date, []).en, t.time, seat], " · ");
  } else if (lead) {
    when = lead;
    line = join([lead, kind === "none" ? NONE_YET : ""], " · ");
  } else {
    when = t.time || "today";
    line = join([t.time || "Today", seat], " · ");
  }
  let warn = null;
  if (skipped) {
    const wt = skipped.title || "Ticket";
    const wwhen = skipped.date === c.date ? skipped.time || "today" : dayHead(skipped.date, []).en.split(" ")[0];
    warn = { id: skipped.id, title: wt, when: wwhen, text: "No code for you at " + wt + " · " + wwhen };
  }
  const aria = ARIA[kind] + join([title, when, kind === "none" ? "no code for you yet" : whose.seat], ", ") +
    (skipped ? ". No code for you at " + warn.title + ", " + (skipped.date === c.date ? "today" + (skipped.time ? " " + skipped.time : "") : join([dayHead(skipped.date, []).en, skipped.time], " ")) : "");

  return {
    id: t.id,
    whose: { ...whose, kind },
    label: { ...LABELS[kind] },
    tag: c.on && today ? "こんど" : "",
    title,
    line,
    aria,
    colour: t.colour || "",
    ink: t.ink || "",
    warn,
  };
}
