/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Your next ticket, standing in the slot above the bar on Days (issue #83,
// option C, Mo's pick on 2026-11-21): the words for it. Pure: no DOM, no
// storage, no clock of its own (callers pass the instant).
//
// The ticket is the pass case's window ticket (js/passcase.js passCase(...).next):
// one source, so the slot and the Tickets tab never disagree. It is the next
// stop's ticket whatever its kind (your own code, one code for all of us, a
// reference, or a stop where others have a code and you have none). A used
// ticket is never in it; it works before the trip too.
//
// slotModel(state, nowMs, { have, here }) -> null, or
//   { id, whose, label: { jp, en }, tag, title, line, aria, colour, ink }
// - null: no trip key, the tickets not loaded, no ticket at all, every one
//   used (the trip over too).
// - whose: js/tickets.js whoseOf ({ kind, seat, holders, count }).
// - label: the small line over the title (jp is decoration, not read out).
// - tag: "こんど" on the trip when the ticket is today's, else "".
// - title: the stop's title ("Ticket" when it has none).
// - line: the second line: another day "Sat Dec 12 · 14:00 · Car 7 · 10B";
//   today, the case's leave line when there is one, else "14:00 · seat"
//   ("Today · seat" with no time); whose none says "none for you yet" in
//   place of the seat.
// - aria: the button's label, whose in words.
// - colour, ink: the day's line colour and the ink on it (the band).

import { passCase } from "./passcase.js";
import { dayHead } from "./format.js";

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
  const t = c.next;
  if (!t) return null;
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
  } else if (t.lead) {
    when = t.lead;
    line = join([t.lead, kind === "none" ? NONE_YET : ""], " · ");
  } else {
    when = t.time || "today";
    line = join([t.time || "Today", seat], " · ");
  }
  const aria = ARIA[kind] + join([title, when, kind === "none" ? "no code for you yet" : whose.seat], ", ");

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
  };
}
