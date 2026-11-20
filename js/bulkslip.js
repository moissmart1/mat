/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The slip (bulk C, 2026-11-20): what `You → Add tickets` shows on the
// owner's phone for the planner's list, worked out with no DOM and no store
// (js/views/bulkadd.js draws it and owns the taps).
//
// One paper slip: the sure tickets as cells, grouped by place (stays first,
// then day and time), each with a filled dot; the questions (every card the
// review would have held one at a time), each with its choices as dots and
// the likely one filled. Moving a dot is a pick (question key -> option id);
// tapping a cell is an out (its place key). Nothing here adds anything: the
// picks and outs are turned into the review's own `answers` and `lanswers`
// (toAnswers), the existing sorted() works out the rest, and slipModel reads
// the counts off that same result.
//
// - defaultPick(card) -> the option filled when the slip opens ("the likely
//   way"): a file's card its first choice, else "out"; a changed or cancelled
//   line its first act that does not take a picture off on its own.
// - toAnswers({ base, picks, outs, extras }) -> { answers, lanswers }.
// - extrasOf(base, result) -> [{ key, card }]: cards a moved dot brought up
//   (a stop now full), shown under the others with "Leave it out" filled.
// - slipModel({ base, picks, outs, state, listAt, rows, result, extras, aside })
//   -> { cells, will, questions, check, notes, now, after, add, off, button, canAdd, none, say, at }.
// - addedSlip({ items, state, at }) -> the read-only slip on the added screen.
// - skipsOf({ base, picks, outs, extras }) -> what Add remembers as left out
//   or kept on this phone: { items: [item keys], cards: [file card keys], keeps: [list card keys] }.

import { placeKey, placeOf, stopLabel, spanOf, monthDay, nightsOf } from "./bulk.js";
import { LIMITS } from "./tickets.js";
import { clock } from "./format.js";

const str = (v) => (typeof v === "string" ? v.trim() : "");
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const initial = (name) => ([...String(name || "")][0] || "").toUpperCase();
const isStay = (p) => !!(p && (p.stay || p.newStay));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- places ----------

// { d, when, title, stay } for a place: a stop as stopLabel gives it; a stay
// by its first night's day, its dates and its name; a stop to add by its own.
export function labelOf(p, state = {}) {
  const days = state.days || [];
  const dayNo = (date) => days.findIndex((x) => x && x.date === date) + 1;
  if (isStay(p)) {
    const st = p.stay ? (state.stays || []).find((x) => x && x.id === p.stay && !x.deleted) : p.newStay;
    if (!st) return { d: "", when: "", title: "A stay", stay: true };
    const n = dayNo(st.firstNight);
    return { d: n ? "D" + n : "", when: spanOf(st), title: str(st.name) || str(st.nameJp) || "A stay", stay: true };
  }
  if (p && p.newStop) return { ...stopLabel(p.newStop, days), stay: false };
  const st = p ? (state.stops || []).find((x) => x && x.id === p.stop && !x.deleted) : null;
  return { ...stopLabel(st || {}, days), stay: false };
}
// "D4 · Kogane Garden".
const where = (p, state) => {
  const l = labelOf(p, state);
  return [l.d, l.title].filter(Boolean).join(" · ");
};

// ---------- the cells ----------

// The sure items grouped by place: stays first, then in the items' own order (day and time).
export function cellsOf(items, state = {}) {
  const groups = new Map();
  for (const it of items || []) {
    const k = placeKey(it);
    if (!groups.has(k)) groups.set(k, { key: k, place: placeOf(it), items: [] });
    groups.get(k).items.push(it);
  }
  const all = [...groups.values()];
  const ordered = all.filter((g) => isStay(g.place)).concat(all.filter((g) => !isStay(g.place)));
  return ordered.map((g) => {
    const l = labelOf(g.place, state);
    const n = g.items.length;
    const line = l.stay ? [l.d, "stay"].filter(Boolean).join(" · ") : [l.d, l.when].filter(Boolean).join(" ");
    return {
      key: g.key, d: l.d, when: l.stay ? "stay" : l.when, title: l.title, stay: l.stay, tickets: n,
      who: [...new Set(g.items.map((i) => i.who).filter(Boolean))].map(initial),
      itemKeys: g.items.map((i) => i.key),
      small: line + (n > 1 ? " · " + n + " tickets" : ""),
    };
  });
}

// ---------- the questions ----------

const rowOf = (rows, id) => (rows || []).find((r) => r && r.ticket_id === id) || null;
const lineName = (row) => (row ? str(row.title) || str(row.provider) : "");

// The likely way: the first choice of a file's card, else Leave it out; a
// changed or cancelled line's first act that does not take pictures off by
// itself. A "which stop is it for?" question, whose stops are only a guess,
// starts with no dot ("none", Mo's call in fix round 1): until it is
// answered its ticket is not added, and the key says how many are left.
export const GUESS = ["close", "ref", "several", "split", "norow"];
export function defaultPick(card) {
  if (card && GUESS.includes(card.kind)) return "none";
  if (card && card.lchoices) {
    const ch = card.lchoices.find((c) => c.act !== "off");
    return ch ? ch.act : card.lchoices[0] ? card.lchoices[0].act : "keep";
  }
  return card && card.choices && card.choices.length ? "c0" : "out";
}

// A file card's head and name: its line (id, day and time) or its file name.
function headOf(card, rows, state) {
  const ids = card.rowIds && card.rowIds.length ? card.rowIds : card.choices && card.choices[0] && card.choices[0].rowIds && card.choices[0].rowIds.length ? card.choices[0].rowIds : [];
  const row = ids.length ? rowOf(rows, ids[0]) : null;
  const fileName = card.file ? String(card.file.name || "") : "";
  if (!row) return { head: ids.length ? ids.join(" ") : fileName, name: fileName || ids.join(" "), row: null, id: ids.join(" ") };
  const l = stopLabel({ date: str(row.start_date), time: str(row.start_time) }, state.days || []);
  return { head: [ids.join(" "), [l.d, l.when].filter(Boolean).join(" ")].filter(Boolean).join(" · "), name: lineName(row) || fileName || ids.join(" "), row, id: ids.join(" ") };
}

const outOption = (id, small) => ({ id: "out", label: "Leave it out", small: small || (id ? "nothing is added for " + id : "nothing is added") });

// A choice of a file's card as an option.
function choiceOption(card, ch, i, state, row) {
  const id = "c" + i;
  if (ch.newStop) {
    const n = (state.days || []).findIndex((d) => d && d.date === ch.newStop.date) + 1;
    return { id, label: "Add a stop for it", small: ["Day " + n, ch.newStop.time].filter(Boolean).join(", ") + ", “" + ch.newStop.title + "”" };
  }
  if (ch.newStay) {
    const n = nightsOf(ch.newStay);
    return { id, label: "Add the stay and its booking", small: ch.newStay.name + " · " + (n === 1 ? "night of " + monthDay(ch.newStay.firstNight) : spanOf(ch.newStay)) };
  }
  const l = labelOf(ch, state);
  const forWho = ch.who ? " · for " + ch.who : "";
  if (card.kind === "limit") return { id, label: "Add the first " + plural(ch.pages || 0, "page", "pages"), small: where(ch, state) + forWho };
  if (l.stay) return { id, label: "Put it on " + l.title, small: l.when + forWho };
  if (card.kind === "far") {
    const st = (state.stops || []).find((x) => x && x.id === ch.stop);
    return { id, label: "Yes, put it on " + where(ch, state), small: "the list says " + str(row && row.start_time) + ", the stop is at " + str(st && st.time) + forWho };
  }
  if (card.kind === "stranger") return { id, label: "Add it for everyone, on " + where(ch, state), small: l.when };
  return { id, label: "Put it on " + where(ch, state), small: l.when + forWho };
}

// The question of a file's card: one sentence, its options.
function fileQuestion(card, rows, state) {
  const h = headOf(card, rows, state);
  const opts = card.choices.map((ch, i) => choiceOption(card, ch, i, state, h.row));
  const stayChoice = card.choices.some(isStay);
  let title;
  let picker = !stayChoice;
  let outSmall = "";
  const day = h.row ? (state.days || []).findIndex((d) => d && d.date === str(h.row.start_date)) + 1 : 0;
  switch (card.kind) {
    case "nostop":
      title = "Day " + day + " has no stop for it";
      break;
    case "far":
      title = "is it this stop?";
      break;
    case "stranger":
      title = "it is for " + String(card.short || "").replace(/^for /, "") + ", who isn’t on the trip";
      picker = false;
      break;
    case "outside":
      title = "not in the trip’s days";
      if (h.row && DATE.test(str(h.row.start_date))) outSmall = "the list dates it " + monthDay(str(h.row.start_date));
      break;
    case "limit": {
      picker = false;
      const p = card.place || {};
      const what = isStay(p) ? "stay" : "stop";
      if (card.room > 0) {
        const cut = card.choices[0] && card.choices[0].cut === "trip" ? "trip" : what;
        title = plural(card.pages, "page", "pages") + ", " + card.room + " fit on the " + cut;
      } else if (/^trip full/.test(card.short || "")) title = "the trip is full (" + LIMITS.perTrip + " pictures)";
      else title = where(p, state) + " is full (" + LIMITS.perStop + " pictures)";
      break;
    }
    case "stays": {
      picker = false;
      const verb = /cover/.test(card.short || "") ? "cover" : "start";
      title = (card.choices.length === 2 ? "two" : String(card.choices.length)) + " stays " + verb + " that night";
      break;
    }
    case "newstay":
      picker = false;
      title = "no stay in MAT has that night";
      break;
    default:
      title = "which stop is it for?";
  }
  return { key: card.key, head: h.head, title: h.name + ": " + title, options: opts.concat([outOption(h.id, outSmall)]), hasPicker: picker, file: true };
}

// The question of a changed or cancelled line from the list.
function listQuestion(card, rows, state) {
  const row = card.row || rowOf(rows, card.rowIds[0]) || null;
  const id = card.rowIds.join(" ");
  const name = lineName(row) || (card.got && card.got[0] ? card.got[0].name : "") || id;
  let head = id;
  if (row) {
    const l = stopLabel({ date: str(row.start_date), time: str(row.start_time) }, state.days || []);
    head = [id, [l.d, l.when].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  }
  const olds = card.drop.length;
  const word = card.stay ? "stay" : "stop";
  const opt = (act, label, small) => ({ id: act, label, small });
  const leaveOn = opt("keep", "Leave its pictures on", "nothing changes");
  const takeOff = opt("off", "Take its " + plural(olds, "picture", "pictures") + " off", "they can be put back from History");
  let title;
  let options;
  switch (card.slip) {
    case "placeGone":
      title = "its " + word + " is no longer on the trip";
      options = [opt("keep", "Leave it", "add its new file by hand if you need it")];
      break;
    case "replace":
    case "first":
      title = "the list has a newer file";
      options = [card.slip === "replace"
        ? opt("replace", "Replace the old pictures with the new file", "the " + plural(olds, "old one", "old ones") + " can be put back from History")
        : opt("first", "Take the old pictures off, then add the new file", "the " + word + " holds " + LIMITS.perStop + " pictures; the old ones can be put back from History"),
      opt("keep", "Keep the old pictures", "the new file stays out")];
      break;
    case "another":
      title = "the list has one more file";
      options = (card.lchoices.some((c) => c.act === "add") ? [opt("add", "Add it too", plural(card.newPages, "page", "pages") + "; the other pictures stay")] : []).concat([opt("keep", "Leave it out", "nothing changes")]);
      break;
    case "cancelled":
      title = (str(card.status) || "not active").toLowerCase() + " in the list";
      options = [leaveOn, takeOff];
      break;
    case "offList":
      title = "no longer on the list";
      options = [leaveOn, takeOff];
      break;
    default: // a file gone from the list
      title = "a file is gone from the list";
      options = [leaveOn, takeOff];
  }
  return { key: card.key, head, title: name + ": " + title, options, hasPicker: false, file: false };
}

export function questionOf(card, { rows = [], state = {} } = {}) {
  return card.lchoices ? listQuestion(card, rows, state) : fileQuestion(card, rows, state);
}

// ---------- picks and outs into the review's answers ----------

// The answer one option of a file's card gives, exactly as the review's taps did.
function answerOf(card, pick) {
  if (pick === "out") return { out: true, why: card.short };
  if (typeof pick === "string" && pick.startsWith("pick:")) return { stop: pick.slice(5), who: card.who || "", rowIds: card.rowIds || [] };
  const ch = typeof pick === "string" && /^c\d+$/.test(pick) ? card.choices[Number(pick.slice(1))] : null;
  if (!ch) return { out: true, why: card.short };
  return { ...placeOf(ch), who: ch.who, rowIds: ch.rowIds, pages: ch.pages || null };
}
const pickOf = (picks, key, card, extra) => {
  const p = picks && picks.get(key);
  return p !== undefined ? p : extra ? "out" : defaultPick(card);
};

export function toAnswers({ base, picks = new Map(), outs = new Set(), extras = [] }) {
  const answers = new Map();
  const lanswers = new Map();
  for (const it of base.items || []) if (outs.has(placeKey(it))) answers.set(it.key, { out: true });
  for (const card of base.cards || []) {
    const p = pickOf(picks, card.key, card, false);
    if (card.lchoices) lanswers.set(card.key, card.lchoices.some((c) => c.act === p) ? p : defaultPick(card));
    else if (p !== "none") answers.set(card.key, answerOf(card, p));
  }
  for (const { key, card } of extras) answers.set(card.key, answerOf(card, pickOf(picks, key, card, true)));
  return { answers, lanswers };
}

// The cards still open once every question has its answer: brought up by a
// moved dot (a question with no dot yet is not one of them).
export function extrasOf(base, result, picks = new Map()) {
  const keys = new Set((base.cards || []).map((c) => c.key));
  const open = new Set((base.cards || []).filter((c) => !c.lchoices && pickOf(picks, c.key, c, false) === "none").map((c) => c.key));
  return (result.cards || []).filter((c) => !c.lchoices && !open.has(c.key)).map((card) => ({ key: keys.has(card.key) ? "more:" + card.key : card.key, card }));
}

// What Add remembers on this phone: the items of the cells tapped out, the
// file questions tapped to Leave it out, the list questions tapped to keep.
// A dot that was filled when the slip opened is never remembered (fix round
// 1, Mo's call): only what he chose himself.
export function skipsOf({ base, picks = new Map(), outs = new Set(), extras = [] }) {
  const items = (base.items || []).filter((it) => outs.has(placeKey(it))).map((it) => it.key);
  const cards = [];
  const keeps = [];
  for (const card of base.cards || []) {
    const p = picks.get(card.key);
    if (card.lchoices) {
      if (p === "keep") keeps.push(card.key);
    } else if (p === "out") cards.push(card.key);
  }
  for (const { key, card } of extras) if (picks.get(key) === "out") cards.push(card.key);
  return { items, cards: [...new Set(cards)], keeps };
}

// ---------- the slip ----------

// The button's first line, by the review's counts; open: questions with no dot yet.
export function buttonText(n, offs, open = 0) {
  let t;
  if (n && offs) t = "Add " + plural(n, "ticket", "tickets") + ", take " + plural(offs, "picture", "pictures") + " off";
  else if (n) t = "Add " + plural(n, "ticket", "tickets");
  else if (offs) t = "Take " + plural(offs, "picture", "pictures") + " off";
  else t = "Nothing to add";
  return open ? t + " · " + open + " to check" : t;
}

const placesText = (stops, stays) => [stops ? plural(stops, "stop", "stops") : "", stays ? plural(stays, "stay", "stays") : ""].filter(Boolean).join(" and ");

export function slipModel({ base, picks = new Map(), outs = new Set(), state = {}, listAt = "", rows = [], result, extras = [], aside = {} }) {
  const r = result;
  const cells = cellsOf(base.items || [], state).map((c) => ({ ...c, out: outs.has(c.key) }));
  for (const c of cells) c.aria = [c.title, c.small.replace(/ · (\d+ tickets)$/, ", $1")].join(", ") + ", " + (c.out ? "left out" : "will be added");
  // The tickets whose cell is in (and still go in as they are).
  const inKeys = new Set(cells.filter((c) => !c.out).flatMap((c) => c.itemKeys));
  const goes = (r.items || []).filter((i) => inKeys.has(i.key));
  // A cell whose ticket a moved dot pushed out (its stop now full) shows a ring (fix round 1, M7).
  const going = new Set((r.items || []).map((i) => i.key));
  for (const c of cells) if (!c.out && !c.itemKeys.some((k) => going.has(k))) {
    c.held = true;
    c.aria = c.aria.replace(/will be added$/, "left out");
  }
  const stops = new Set(goes.filter((i) => !isStay(i)).map(placeKey)).size;
  const stays = new Set(goes.filter(isStay).map(placeKey)).size;
  const will = cells.length ? { left: "Will add · " + (goes.length ? plural(goes.length, "ticket", "tickets") : "nothing"), right: goes.length ? "on " + placesText(stops, stays) : "" } : null;

  const qs = (base.cards || []).map((card) => ({ card, key: card.key, extra: false })).concat(extras.map((e) => ({ card: e.card, key: e.key, extra: true })));
  const questions = qs.map(({ card, key, extra }) => {
    const q = questionOf(card, { rows, state });
    const pick = pickOf(picks, key, card, extra);
    const picked = typeof pick === "string" && pick.startsWith("pick:") ? pick.slice(5) : "";
    return {
      ...q, key, card: card.key, extra, picked,
      options: q.options.map((o) => ({ ...o, on: o.id === pick })),
      pickOn: !!picked,
    };
  });
  const open = questions.filter((q) => !q.options.some((o) => o.on) && !q.pickOn).length;
  const check = questions.length ? { left: questions.length === 1 ? "Check this 1" : "Check these " + questions.length, right: "the likely answer is picked" } : null;

  // The notes: one short sentence each, only those that apply.
  const notes = [];
  const out = r.out || [];
  const there = out.filter((o) => o.kind === "there").length;
  if (there) notes.push({ text: there + " already there, not added twice" });
  const handPlaces = new Set(out.filter((o) => o.kind === "hand").map((o) => placeKey(o)).concat((aside.hand || []).map((h) => placeKey(h)))).size;
  if (handPlaces) notes.push({ text: plural(handPlaces, "stop was", "stops were") + " filled by hand; the list’s tickets for them are left out" });
  const failed = aside.failed || [];
  const unread = failed.filter((x) => x.why === "couldn’t be read on this phone");
  const notFetched = failed.filter((x) => x.why !== "couldn’t be read on this phone");
  if (notFetched.length) notes.push({ text: plural(notFetched.length, "file", "files") + " couldn’t be fetched: " + notFetched.map((x) => x.label + " (" + x.why + ")").join(", "), warn: true });
  if (unread.length) notes.push({ text: plural(unread.length, "file", "files") + " couldn’t be read on this phone: " + unread.map((x) => x.label).join(", ") });
  const inactive = out.filter((o) => o.kind === "inactive").length;
  if (inactive) notes.push({ text: inactive + (inactive === 1 ? " is" : " are") + " not active on the list, left out" });
  const qd = aside.quiet || null;
  if (qd) {
    const bits = [];
    if (qd.noFile) bits.push(plural(qd.noFile, "line has", "lines have") + " no file yet");
    if (qd.outside) bits.push(qd.outside + (qd.outside === 1 ? " is" : " are") + " outside the trip’s days");
    if (qd.unlisted) bits.push(plural(qd.unlisted, "file in the folder isn’t", "files in the folder aren’t") + " on the list");
    if (bits.length) notes.push({ text: "On the list: " + bits.join(", ") });
    if (qd.skipped) notes.push({ text: qd.skipped + " left out before on this phone. ", unskip: true });
  }

  // The counts: today's formula on the review's own result.
  const done = r.listDone || [];
  const add = (r.items || []).length + done.filter((d) => d.act === "replace" || d.act === "first" || d.act === "add").length;
  const off = done.filter((d) => d.act === "off").reduce((k, d) => k + d.card.drop.length, 0);
  const none = !(base.items || []).length && !(base.cards || []).length;
  const sure = cells.reduce((n, c) => n + c.tickets, 0);
  const say = none ? "Nothing new on the list." : [sure || !questions.length ? plural(sure, "ticket", "tickets") + " ready to add" : "", questions.length ? questions.length + " to check" : ""].filter(Boolean).join(", ") + ".";
  const ms = Date.parse(listAt);
  return {
    at: isFinite(ms) ? "read at " + clock(ms) : "",
    cells, will, questions, check, notes, none, say,
    now: r.now, after: r.after, add, off,
    open, button: buttonText(add, off, open), canAdd: add > 0 || off > 0,
  };
}

// ---------- the added screen ----------

// items: the adding's items ({ key, stop|stay, who, saved, waiting, made: "stop"|"stay", replaced }).
// One cell per place that got something, every dot filled.
export function addedSlip({ items = [], state = {}, at = "" }) {
  const ok = items.filter((i) => i.saved + i.waiting > 0);
  // In the trip's order: the day, then the time (the questions' tickets came after the sure ones).
  const when = (i) => {
    if (isStay(i)) return "";
    const st = i.newStop || (state.stops || []).find((x) => x && x.id === i.stop) || {};
    return String(st.date || "") + " " + (/^\d\d:\d\d$/.test(String(st.time || "")) ? st.time : "99:99");
  };
  const sorted = ok.map((i, n) => ({ i, n, w: when(i) })).sort((a, b) => (a.w < b.w ? -1 : a.w > b.w ? 1 : a.n - b.n)).map((x) => x.i);
  const cells = cellsOf(sorted, state).map((c) => {
    const mine = ok.filter((i) => c.itemKeys.includes(i.key));
    const waiting = mine.reduce((n, i) => n + i.waiting, 0);
    const how = [];
    if (mine.some((i) => i.replaced)) how.push("old pictures replaced");
    if (mine.some((i) => i.made === "stop")) how.push("stop added");
    if (mine.some((i) => i.made === "stay")) how.push("stay added");
    if (waiting) how.push(plural(waiting, "picture", "pictures") + " waiting for signal");
    return { ...c, out: false, how: how.join(" · ") };
  });
  const stops = new Set(ok.filter((i) => !isStay(i)).map(placeKey)).size;
  const stays = new Set(ok.filter(isStay).map(placeKey)).size;
  const ms = Date.parse(at);
  return {
    at: isFinite(ms) ? "added at " + clock(ms) : "",
    left: "Added · " + plural(ok.length, "ticket", "tickets"),
    right: ok.length ? "on " + placesText(stops, stays) : "",
    cells,
  };
}
