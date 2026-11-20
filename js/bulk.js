/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Bulk add of tickets, the part with no screen (js/views/bulkadd.js draws
// it): reading the list (a CSV of the planner's Tickets tab) and matching
// each dropped file to a line of the list and a stop. Pure: no DOM, no
// storage, no clock. The later auto-add reuses it.
//
// - parseList(text) -> { rows, error, warn }: the CSV read in full (quoted
//   fields, commas and line breaks inside quotes, "" for a quote, a UTF-8
//   BOM, CRLF). Column names are trimmed and lower-cased; unknown columns
//   are kept and ignored. A missing ticket_id or start_date column: rows []
//   and error, a sentence (the files are then matched without the list).
//   warn: sentences (a list cut short inside a quote; a ticket_id twice).
// - rowsForFile(name, rows, people) -> { rows, how, ref }: the list's lines a
//   file belongs to. how: "id" (the name starts with one or more ticket ids,
//   space-, _-, - or .-separated), "ref" (a usable confirmation or ticket_ref,
//   refUsable, is whole parts of the name, nameHasRef; several: the one whose
//   traveler is named too), "several" (still more than one), "none". Only
//   "id" can be sure; a file found by "ref" is always a card.
// - sortFiles({ files, rows, listError, state, answers, isThere }) -> the
//   sorting: what goes in (items), what needs a look (cards, in order), what
//   is left out (out, each with its kind and why), the list's lines with no
//   file (quiet), the trip's pictures now and after.
//   files: [{ key, name, kind, pages, sig }] (kind: the sniffed type or null;
//   pages: the pictures it makes, a PDF's page count; sig: { mime, w, h,
//   size, hash } of its first picture, for already-there).
//   answers: placement key -> { out: true, why } | { stop, who, rowIds, pages, cut }.
//   isThere(fileKey, stopId, who, place): the stop (or place.stay) already
//   has this picture for who.
// - factsFor(items, rows, stops) -> { stopId: patch }: the stop's ticket
//   facts from the list, only where the stop's own field is empty.
//   stayFactsFor(items, rows, stays) -> { stayId: patch }: the same for a
//   stay's booking (tkRef, tkName).
//
// A stay's booking (S2 鍵札): a `lodging` line is matched to a stay, not a
// stop, before the trip's days are looked at: the live stay whose first night
// is the line's start_date (one, or the one whose name shares a word with the
// line's title or provider), a card when two or more start that night and
// the name does not settle it, else a card that offers to add the stay
// (newStay: { name, firstNight, lastNight } from the line). Everywhere a
// place, choice or item has `stop` it may instead have `stay` or `newStay`,
// exactly one (placeKey tells them apart).
//
// A stop to add (bulk C, 2026-11-20): a line with no stop near it on its day
// offers to add one from the line itself (newStop: { date, time, title },
// newStopFrom), as a lodging line offers its stay. A newStop place holds no
// pictures yet; two files of one line share it (the same placeKey).

import { LIMITS } from "./tickets.js";
import { minutesOf } from "./plan.js";

export const REQUIRED = ["ticket_id", "start_date"];
export const NEAR_MIN = 90;
export const SURE_GAP_MIN = 30;
const KINDS = ["image/jpeg", "image/png", "application/pdf"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const str = (v) => (typeof v === "string" ? v.trim() : "");
const low = (v) => str(v).toLowerCase();
// Letters and digits only, lower case: "AB-12 34" -> "ab1234".
const squash = (v) => String(v || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const SKIP = new Set(["the", "and", "for", "ticket", "tickets", "booking", "order", "eticket", "confirmation", "pdf", "png", "jpg", "jpeg", "img", "adult", "adults", "with", "from"]);
const words = (v) => new Set(String(v || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !SKIP.has(w) && !/^\d+$/.test(w)));
const shares = (a, b) => {
  for (const w of a) if (b.has(w)) return true;
  return false;
};

// ---------- the list ----------

export function listRefused(col) {
  return "The list has no " + col + " column, so it wasn’t used. The files are matched without it.";
}

// The table, and whether the text ended inside a quoted cell (fix round 1,
// M2: a quote opens a quoted cell only at the start of a cell; one in the
// middle of a plain cell is a plain character, as spreadsheets write it).
function readCsv(text) {
  const s = String(text || "").replace(/^﻿/, "");
  const out = [];
  let row = [];
  let f = "";
  let q = false;
  let atStart = true;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"' && atStart) {
      q = true;
      atStart = false;
    } else if (c === ",") {
      row.push(f);
      f = "";
      atStart = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(f);
      out.push(row);
      row = [];
      f = "";
      atStart = true;
    } else {
      f += c;
      atStart = false;
    }
  }
  if (f !== "" || row.length) {
    row.push(f);
    out.push(row);
  }
  return { table: out.filter((r) => r.some((x) => x.trim() !== "")), open: q };
}

export function parseCsv(text) {
  return readCsv(text).table;
}

export const LIST_CUT = "The list ends inside a quoted cell, so its last lines may be missing. Check the file.";
export const listTwice = (ids) => (ids.length === 1 ? ids[0] + " is on the list twice; only its first line is used." : ids.join(", ") + " are on the list twice; only the first line of each is used.");

// { rows, error, warn }: warn, sentences about a list that was used but is
// odd (cut short inside a quote; a ticket_id twice, of which the first line
// is used and the rest dropped).
export function parseList(text) {
  const { table, open } = readCsv(text);
  if (!table.length) return { rows: [], error: listRefused("ticket_id"), warn: [] };
  const head = table[0].map((h) => low(h));
  for (const col of REQUIRED) if (!head.includes(col)) return { rows: [], error: listRefused(col), warn: [] };
  const seen = new Set();
  const twice = [];
  const rows = table.slice(1).map((cells) => {
    const r = {};
    head.forEach((h, i) => {
      if (h && !(h in r)) r[h] = str(cells[i]);
    });
    return r;
  }).filter((r) => {
    if (!r.ticket_id) return false;
    if (seen.has(r.ticket_id)) {
      if (!twice.includes(r.ticket_id)) twice.push(r.ticket_id);
      return false;
    }
    seen.add(r.ticket_id);
    return true;
  });
  const warn = [];
  if (open) warn.push(LIST_CUT);
  if (twice.length) warn.push(listTwice(twice));
  return { rows, error: null, warn };
}

// ---------- a file to the list ----------

// The ticket ids the name starts with, in order (the rows' own ids only).
export function idsAtStart(name, rows) {
  const ids = [...new Set(rows.map((r) => r.ticket_id).filter(Boolean))].sort((a, b) => b.length - a.length);
  const n = String(name || "");
  const found = [];
  let at = 0;
  for (;;) {
    const rest = n.slice(at).toLowerCase();
    const id = ids.find((x) => rest.startsWith(x.toLowerCase()) && /^[ _.\-]/.test(rest.slice(x.length)));
    if (!id) break;
    found.push(id);
    at += id.length;
    while (at < n.length && /[ _.\-]/.test(n[at])) at++;
  }
  return found;
}

const firstName = (p) => low(String(p && p.name).split(/\s+/)[0]);

// ---------- rule 2: a reference in the name (fix round 1, C1) ----------
// Only a reference that cannot be a placeholder, a word or a stamp is looked
// for, and only as whole parts of the name; a file found this way is always
// a card, never sure.
const COMMON = new Set(["eticket", "etickets", "ticket", "tickets", "booking", "bookings", "confirmation", "confirmed", "invoice", "receipt", "order", "orders", "voucher", "vouchers", "boarding", "boardingpass", "pass", "qrcode", "mobile", "onapp", "reservation", "itinerary", "page", "copy", "file", "document", "scan", "photo", "image", "img", "screenshot", "download", "print", "pdf", "number", "ref", "reference", "code"]);
const STAMP = /^(img|image|dsc|dscn|dcim|pxl|screenshot|screen|scan|photo|vid|mvimg|pic|whatsapp|signal|snapshot)\d/;
const YMD = /(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/;
const DMY = /(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(19|20)\d{2}|(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(19|20)\d{2}/;
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const WORDY_DATE = new RegExp("^(\\d{1,2}(" + MONTHS + ")\\d{2,4}|(" + MONTHS + ")\\d{1,2}\\d{4}|\\d{4}(" + MONTHS + ")\\d{1,2})$");

// A confirmation or ticket_ref worth looking for in a file name: 6 or more
// letters and digits, with both a letter and a digit, or 8 or more digits;
// never a common word (with or without a short number), a date, a time or a
// camera or screenshot stamp.
export function refUsable(v) {
  const raw = str(v);
  const s = squash(raw);
  if (s.length < 6) return false;
  if (/^\s*\d{1,4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,4}\s*$/.test(raw) || /^\s*\d{1,2}\s*[:.h]\s*\d{2}(\s*[:.]\s*\d{2})?\s*(am|pm)?\s*$/i.test(raw)) return false;
  if (STAMP.test(s) || WORDY_DATE.test(s) || /^\d{3,4}(am|pm)$/.test(s)) return false;
  const letters = s.replace(/\p{N}+/gu, "");
  const digits = s.replace(/[^\p{N}]+/gu, "");
  if (COMMON.has(s) || (COMMON.has(letters) && digits.length < 4)) return false;
  if (!letters) return digits.length >= 8 && !YMD.test(s) && !DMY.test(s);
  if (!digits) return false;
  if (YMD.test(s) && digits.length >= 8) return false;
  return true;
}

// The parts of a file name, its kind left off: "Sky QZ-48810.png" -> ["sky", "qz", "48810"].
const parts = (name) => String(name || "").replace(/\.[a-z0-9]{2,5}$/i, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// The reference is whole parts of the name, side by side (a number: one
// whole part, so it is never stitched from a date and a time).
export function nameHasRef(name, ref) {
  if (!refUsable(ref)) return false;
  const want = squash(ref);
  const p = parts(name);
  if (/^\p{N}+$/u.test(want)) return p.includes(want);
  for (let i = 0; i < p.length; i++) {
    let acc = "";
    for (let j = i; j < p.length && acc.length < want.length; j++) {
      acc += p[j];
      if (acc === want) return true;
    }
  }
  return false;
}

export function rowsForFile(name, rows, people = []) {
  const list = Array.isArray(rows) ? rows : [];
  const ids = idsAtStart(name, list);
  if (ids.length) return { rows: ids.map((id) => list.find((r) => r.ticket_id === id)), how: "id" };
  const refOf = (r) => [r.confirmation, r.ticket_ref].find((v) => nameHasRef(name, v)) || "";
  const hit = list.filter((r) => refOf(r));
  if (hit.length === 1) return { rows: hit, how: "ref", ref: str(refOf(hit[0])) };
  if (hit.length > 1) {
    // The traveler's name as a word of the file name (a one-letter name is not found inside other words).
    const tokens = new Set(String(name || "").toLowerCase().split(/[^\p{L}\p{N}]+/u));
    const named = hit.filter((r) => {
      const t = low(r.traveler);
      return t && t !== "all" && tokens.has(t);
    });
    if (named.length === 1) return { rows: named, how: "ref", ref: str(refOf(named[0])) };
    return { rows: named.length ? named : hit, how: "several" };
  }
  return { rows: [], how: "none" };
}

// ---------- stops ----------

function weekday(date) {
  const [y, m, d] = date.split("-").map(Number);
  return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// { d: "D5", when: "Mon 11:00", title } for a stop of the trip.
export function stopLabel(stop, days) {
  const i = (days || []).findIndex((x) => x && x.date === stop.date);
  return { d: i >= 0 ? "D" + (i + 1) : "", when: [stop.date ? weekday(stop.date) : "", str(stop.time)].filter(Boolean).join(" "), title: str(stop.title) || "A stop" };
}

const dayOf = (date, days) => (days || []).findIndex((x) => x && x.date === date) + 1;

// ---------- places: a stop, a stay, or a stay to add ----------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Dec 8".
export const monthDay = (date) => {
  const [, m, d] = String(date).split("-").map(Number);
  return MON[m - 1] + " " + d;
};
const shiftDay = (date, by) => {
  const [y, m, d] = String(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
};
// Nights from the first to the last, both counted.
export const nightsOf = (st) => Math.round((Date.parse(st.lastNight) - Date.parse(st.firstNight)) / 86400000) + 1;
// "Dec 8 to 9", "Dec 13 to 15", "Dec 30 to Jan 2": the first night to the morning after the last.
export function spanOf(st) {
  if (!st || !DATE.test(String(st.firstNight)) || !DATE.test(String(st.lastNight))) return "";
  const after = shiftDay(st.lastNight, 1);
  const [, m1] = st.firstNight.split("-").map(Number);
  const [, m2, d2] = after.split("-").map(Number);
  return monthDay(st.firstNight) + " to " + (m1 === m2 ? "" : MON[m2 - 1] + " ") + d2;
}

// The stay a lodging line would add: its name (the title, else the provider,
// at most 80 letters), its first night (start_date) and last (the day before
// end_date, else the first). null with no name or no usable date.
export function newStayFrom(row) {
  const name = [...(str(row && row.title) || str(row && row.provider))].slice(0, 80).join("").trim();
  const first = str(row && row.start_date);
  if (!name || !DATE.test(first)) return null;
  const end = str(row.end_date);
  const last = DATE.test(end) && end > first ? shiftDay(end, -1) : first;
  return { name, firstNight: first, lastNight: last };
}

// The stop a line with no stop would add: its day (start_date, a day of the
// trip), its time (start_time when it is a time like 14:30, else none) and
// its title (the title, else the provider, at most 80 letters). null when the
// date is not a day of the trip or there is no name.
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export function newStopFrom(row, days) {
  const title = [...(str(row && row.title) || str(row && row.provider))].slice(0, 80).join("").trim();
  const date = str(row && row.start_date);
  if (!title || !DATE.test(date) || !(days || []).some((d) => d && d.date === date)) return null;
  const time = str(row.start_time);
  return { date, time: TIME.test(time) ? time : "", title };
}

// What a place is, as a key: "stop:<id>", "stay:<id>", "new:<first night>:<name>" or "newstop:<date>:<time>:<title>".
export const placeKey = (p) => (p.stay ? "stay:" + p.stay : p.newStay ? "new:" + p.newStay.firstNight + ":" + p.newStay.name : p.newStop ? "newstop:" + p.newStop.date + ":" + p.newStop.time + ":" + p.newStop.title : "stop:" + p.stop);
// Only the place's own field: { stop }, { stay }, { newStay } or { newStop }.
export const placeOf = (p) => (p.stay ? { stay: p.stay } : p.newStay ? { newStay: p.newStay } : p.newStop ? { newStop: p.newStop } : { stop: p.stop });
const target = (got) => (got && got.sure ? (got.sure.stay ? { stay: got.sure.stay } : { stop: got.sure.id }) : null);

// A lodging line to a stay: { sure: { stay } } or { card }.
function stayForRow(row, s) {
  const date = str(row.start_date);
  const stays = (s.stays || []).filter((x) => x && !x.deleted && x.id);
  const near = new Set([...words(row.title), ...words(row.provider)]);
  // The line as its card shows it: its name and its night.
  const line = { title: str(row.title) || str(row.provider), date: DATE.test(date) ? date : "" };
  const starts = DATE.test(date) ? stays.filter((x) => x.firstNight === date) : [];
  // No stay starts that night: a stay that covers it (first night <= date <= last night) is the one.
  const covers = DATE.test(date) && !starts.length ? stays.filter((x) => DATE.test(String(x.firstNight)) && DATE.test(String(x.lastNight)) && x.firstNight <= date && date <= x.lastNight) : [];
  const on = starts.length ? starts : covers;
  const verb = starts.length ? "start" : "cover";
  if (on.length === 1) return { sure: { stay: on[0].id } };
  if (on.length > 1) {
    const named = on.filter((x) => shares(new Set([...words(x.name), ...words(x.nameJp)]), near));
    if (named.length === 1) return { sure: { stay: named[0].id } };
    const offer = named.length ? named : on;
    return { card: { kind: "stays", ask: (offer.length === 2 ? "Two stays" : offer.length + " stays") + " " + verb + " that night.", hint: "The list dates it " + monthDay(date) + ".", short: offer.length + " stays " + verb + " " + monthDay(date), choices: offer.map((x) => ({ stay: x.id })), line } };
  }
  const ns = newStayFrom(row);
  const nights = ns ? nightsOf(ns) : 0;
  const hint = ns ? "The list dates it " + monthDay(ns.firstNight) + ", " + (nights === 1 ? "one night" : nights + " nights") + ". No stay in MAT has that night." : DATE.test(date) ? "The list dates it " + monthDay(date) + " but gives it no name." : "The list gives it no date.";
  return { card: { kind: "newstay", ask: "A stay with no card yet: add it?", hint, short: "a stay with no card", choices: ns ? [{ newStay: ns }] : [], line } };
}

// Who a line is for: "" (everyone), a person's name, or { stranger } (a name not on the trip).
function whoOf(row, people) {
  const t = low(row && row.traveler);
  if (!t || t === "all") return "";
  const p = (people || []).find((x) => firstName(x) === t);
  return p ? p.name : { stranger: str(row.traveler) };
}

const active = (row) => !str(row.status) || low(row.status) === "active";
const timeText = (t) => (minutesOf(t) === null ? "" : t);

// A line of the list to a stop: { sure: stop } or { card: { kind, ask, hint, short, choices } }.
function stopForRow(row, s) {
  // A stay's booking, wherever its night falls.
  if (low(row.type) === "lodging") return stayForRow(row, s);
  const days = s.days || [];
  const stops = (s.stops || []).filter((x) => x && !x.deleted);
  const date = str(row.start_date);
  const n = dayOf(date, days);
  const near = new Set([...words(row.title), ...words(row.provider)]);
  const onDay = stops.filter((x) => x.date === date);
  const named = (list) => list.filter((x) => shares(words(x.title), near));
  if (!n) {
    return { card: { kind: "outside", ask: "Not in the trip’s days.", hint: date ? "The list dates it " + date + "." : "The list gives it no date.", short: "not in the trip’s days", choices: [] } };
  }
  const t = minutesOf(row.start_time);
  let close;
  if (t === null) close = named(onDay);
  else {
    close = onDay.filter((x) => minutesOf(x.time) !== null && Math.abs(minutesOf(x.time) - t) <= NEAR_MIN);
    // Untimed stops count only by name.
    close = close.concat(named(onDay.filter((x) => minutesOf(x.time) === null)));
  }
  if (close.length === 1) {
    // Fix round 1, M1: the only stop near the time is sure when it shares a
    // word with the line or is within half an hour; else it is checked.
    const c = close[0];
    const gap = t === null || minutesOf(c.time) === null ? 0 : Math.abs(minutesOf(c.time) - t);
    if (gap > SURE_GAP_MIN && !shares(words(c.title), near)) {
      return { card: { kind: "far", ask: "Is it this stop?", hint: "Day " + n + ": the list says " + row.start_time + ", the stop is at " + c.time + ".", short: "check the stop on D" + n, choices: [{ stop: c.id }] } };
    }
    return { sure: c };
  }
  if (close.length > 1) {
    const byName = named(close);
    if (byName.length === 1) return { sure: byName[0] };
    const offer = byName.length ? byName : close;
    return { card: { kind: "close", ask: (offer.length === 2 ? "Two stops" : offer.length + " stops") + " are close" + (t === null ? "." : " to " + row.start_time + "."), hint: "Day " + n + ".", short: offer.length + " stops on D" + n, choices: offer.map((x) => ({ stop: x.id })) } };
  }
  const at = t === null ? "" : " at " + row.start_time;
  // A stop to add from the line itself, when it has a name.
  const ns = newStopFrom(row, days);
  return { card: { kind: "nostop", ask: "No stop on Day " + n + at + ".", hint: onDay.length ? "Day " + n + " has " + onDay.length + (onDay.length === 1 ? " stop" : " stops") + ", none close." : "Day " + n + " has no stops.", short: "no stop on D" + n, choices: ns ? [{ newStop: ns }] : [] } };
}

const rowLabel = (rows) => {
  const ids = rows.map((r) => r.ticket_id).join(" ");
  const title = str(rows[0] && (rows[0].title || rows[0].provider));
  return [ids, title].filter(Boolean).join(" · ");
};

// The natural answer for one file, before any choice: { notTicket } |
// { inactive } | { places: [{ stop, who, rowIds }] } | { card }.
function natural(file, found, s) {
  if (!KINDS.includes(file.kind)) return { notTicket: true };
  const people = s.people || [];
  const stops = (s.stops || []).filter((x) => x && !x.deleted && dayOf(x.date, s.days));
  if (found.how === "several") {
    const opts = [];
    for (const r of found.rows) {
      const got = active(r) ? stopForRow(r, s) : null;
      const w = whoOf(r, people);
      const t = target(got);
      if (t && typeof w === "string") opts.push({ ...t, who: w, rowIds: [r.ticket_id] });
    }
    return { card: { kind: "several", ask: (found.rows.length === 2 ? "Two lines" : found.rows.length + " lines") + " on the list have this reference.", hint: found.rows.map((r) => r.ticket_id).join(", ") + ".", short: "several lines on the list", choices: opts, who: "", rowIds: [] } };
  }
  if (!found.rows.length) {
    const near = words(String(file.name || "").replace(/\.[a-z0-9]+$/i, ""));
    const offer = stops.filter((x) => shares(words(x.title), near));
    const ask = offer.length > 1 ? (offer.length === 2 ? "Two stops" : offer.length + " stops") + " have this name." : offer.length === 1 ? "Is it for this stop?" : "Which stop is it for?";
    return { card: { kind: "norow", ask, hint: "It isn’t on the list, so it has no date.", short: "not on the list", choices: offer.map((x) => ({ stop: x.id, who: "", rowIds: [] })), who: "", rowIds: [] } };
  }
  const rows = found.rows.filter(active);
  if (!rows.length) return { inactive: found.rows.map((r) => str(r.status)).filter(Boolean).join(", ") || "not active" };
  const rowIds = rows.map((r) => r.ticket_id);
  const whos = rows.map((r) => whoOf(r, people));
  const stranger = whos.find((w) => typeof w !== "string");
  const results = rows.map((r) => stopForRow(r, s));
  const odd = results.find((x) => x.card);
  // Found by a reference in its name (fix round 1, C1): said on the card.
  const byRef = found.how === "ref" ? "Its name has the reference of " + rowIds.join(" ") + " · check it." : "";
  // The places, each once, in the order met.
  const uniq = (list) => {
    const seen = new Map();
    for (const p of list) if (!seen.has(placeKey(p))) seen.set(placeKey(p), p);
    return [...seen.values()];
  };
  if (stranger) {
    const offer = uniq(results.map(target).filter(Boolean));
    return { card: { kind: "stranger", ask: "For " + stranger.stranger + ", who isn’t on the trip.", hint: (byRef ? byRef + " " : "") + "It can go in for everyone, or stay out.", short: "for " + stranger.stranger, choices: offer.map((p) => ({ ...p, who: "", rowIds })), who: "", rowIds } };
  }
  if (odd) {
    const extra = results.map(target).filter(Boolean);
    const places = uniq([...odd.card.choices, ...extra]);
    const who = whos.length === 1 ? whos[0] : "";
    return { card: { ...odd.card, hint: (byRef ? byRef + " " : "") + odd.card.hint, choices: places.map((p) => ({ ...p, who, rowIds })), who, rowIds } };
  }
  // Every line has its place. Grouped by place: one picture per stop or stay.
  const byStop = new Map();
  const placeAt = new Map();
  rows.forEach((r, i) => {
    const t = target(results[i]);
    const id = placeKey(t);
    placeAt.set(id, t);
    if (!byStop.has(id)) byStop.set(id, []);
    byStop.get(id).push(i);
  });
  const whoAt = (idx) => {
    const set = new Set(idx.map((i) => whos[i]));
    return set.size === 1 ? [...set][0] : "";
  };
  if (byStop.size > 1 && whos.some((w) => w)) {
    // The same picture as someone's own code on several stops: a person decides.
    return { card: { kind: "split", ask: "One file, lines on " + byStop.size + " stops.", hint: "It is someone’s own ticket, so it goes on one stop only.", short: "lines on " + byStop.size + " stops", choices: [...byStop.entries()].map(([id, idx]) => ({ ...placeAt.get(id), who: whoAt(idx), rowIds: idx.map((i) => rowIds[i]) })), who: "", rowIds } };
  }
  const places = [...byStop.entries()].map(([id, idx]) => ({ ...placeAt.get(id), who: whoAt(idx), rowIds: idx.map((i) => rowIds[i]) }));
  if (byRef) {
    // Never sure: the line's stop is the first choice.
    return { card: { kind: "ref", ask: byRef, hint: "“" + found.ref + "” is in the file’s name.", short: "found by its reference", choices: places, who: places.length === 1 ? places[0].who : "", rowIds } };
  }
  return { places };
}

const sigEq = (a, b) => !!a && !!b && a.mime === b.mime && a.w === b.w && a.h === b.h && a.size === b.size && (!a.hash || !b.hash || a.hash === b.hash);

export function sortFiles({ files = [], rows = [], listError = null, state = {}, answers = new Map(), isThere = () => false } = {}) {
  const s = state;
  const days = s.days || [];
  const stopsById = new Map((s.stops || []).filter((x) => x && !x.deleted).map((x) => [x.id, x]));
  const staysById = new Map((s.stays || []).filter((x) => x && !x.deleted && x.id).map((x) => [x.id, x]));
  const ans = answers instanceof Map ? answers : new Map(Object.entries(answers || {}));
  const live = (s.tickets || []).filter((t) => t && !t.gone);
  const onStop = (id) => live.filter((t) => t.stop === id).length;
  // The pictures on a place now: a stop's, a stay's, none on a stay or stop still to add.
  const onPlace = (p) => (p.stay ? live.filter((t) => t.stay === p.stay).length : p.newStay || p.newStop ? 0 : onStop(p.stop));
  // A place that is there: a live stop, a live stay, a stay to add with a name and a first night, or a stop to add on a day of the trip with a name.
  const isPlace = (p) => (p.stay ? staysById.has(p.stay) : p.newStay ? !!(p.newStay && str(p.newStay.name) && DATE.test(String(p.newStay.firstNight))) : p.newStop ? !!(str(p.newStop.title) && days.some((d) => d && d.date === p.newStop.date)) : stopsById.has(p.stop));
  const list = listError ? [] : rows;
  const out = { items: [], cards: [], out: [], quiet: 0, listError, now: live.length, after: live.length };
  const used = new Set();
  const placed = []; // { key, file, stop, who, rowIds, pages, from, label }
  const pending = []; // cards not answered, in file order

  for (const file of files) {
    const found = rowsForFile(file.name, list, s.people);
    for (const r of found.rows) used.add(r);
    const label = found.rows.length && found.how !== "several" ? rowLabel(found.rows) : String(file.name || "A file");
    const nat = natural(file, found, s);
    if (nat.notTicket) {
      out.out.push({ kind: "notTicket", file, label, why: "not a ticket file" });
      continue;
    }
    if (nat.inactive) {
      out.out.push({ kind: "inactive", file, label, why: "on the list as " + nat.inactive });
      continue;
    }
    const base = { file, label, pages: Math.max(1, Number(file.pages) || 1) };
    const take = (key, a, from, short) => {
      if (a.out) out.out.push({ kind: "leftOut", file, label, key, why: "left out" + (a.why ? ": " + a.why : short ? ": " + short : "") });
      else if (isPlace(a)) placed.push({ ...base, key, ...placeOf(a), who: a.who || "", rowIds: a.rowIds || [], want: a.pages || null, cut: a.cut || "", from });
      else return false;
      return true;
    };
    if (nat.card) {
      const key = file.key + "#0";
      const a = ans.get(key);
      if (a && take(key, a, "card", nat.card.short)) continue;
      pending.push({ ...nat.card, key, file, label, onList: found.rows.length > 0 && found.how !== "several", choices: nat.card.choices.filter(isPlace) });
      continue;
    }
    nat.places.forEach((p, i) => {
      const key = file.key + "#" + i;
      const a = ans.get(key);
      if (!(a && take(key, a, "sure"))) placed.push({ ...base, key, ...placeOf(p), who: p.who, rowIds: p.rowIds, want: null, cut: "", from: "sure" });
    });
  }

  // In the trip's order: day, time, then the file's name; a stay's at its first night, 15:00.
  const order = (p) => {
    if (p.stay || p.newStay) return (p.stay ? staysById.get(p.stay).firstNight : p.newStay.firstNight) + " 15:00 " + p.file.name;
    const st = p.newStop || stopsById.get(p.stop);
    return (st.date || "") + " " + (minutesOf(st.time) === null ? "99:99" : st.time) + " " + p.file.name;
  };
  placed.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));

  const extra = new Map(); // place -> pictures going in
  let trip = live.length;
  const limitCards = [];
  for (const p of placed) {
    const pk = placeKey(p);
    const onStay = !!(p.stay || p.newStay);
    // Fix round 1, M5: the same picture is already there only for the same person (two people's codes can share a cover page).
    const there = (!p.newStay && !p.newStop && isThere(p.file.key, p.stop || "", p.who, placeOf(p))) || out.items.some((q) => placeKey(q) === pk && q.who === p.who && sigEq(q.file.sig, p.file.sig));
    if (there) {
      out.out.push({ kind: "there", file: p.file, label: p.label, key: p.key, ...placeOf(p), why: "already there" });
      continue;
    }
    const has = onPlace(p) + (extra.get(pk) || 0);
    const room = Math.max(0, Math.min(LIMITS.perStop - has, LIMITS.perTrip - trip));
    const want = p.want && p.want <= p.pages ? p.want : p.pages;
    if (want > room) {
      const full = room === 0;
      const tripFull = LIMITS.perTrip - trip <= LIMITS.perStop - has;
      const title = p.stay ? str(staysById.get(p.stay).name) || "The stay" : p.newStay ? p.newStay.name : p.newStop ? p.newStop.title : stopLabel(stopsById.get(p.stop), days).title;
      const what = onStay ? "stay" : "stop";
      limitCards.push({
        kind: "limit", key: p.key, file: p.file, label: p.label, onList: p.rowIds.length > 0, who: p.who, rowIds: p.rowIds, place: placeOf(p), pages: p.pages, room,
        ask: full ? (tripFull ? "The trip is full: " + LIMITS.perTrip + " pictures." : title + " is full: " + LIMITS.perStop + " of " + LIMITS.perStop + ".") : p.pages + " pages, " + room + " fit.",
        hint: tripFull ? "A trip holds " + LIMITS.perTrip + " pictures." : "A " + what + " holds " + LIMITS.perStop + " pictures; " + title + " has " + has + ".",
        short: full ? (tripFull ? "trip full, " + LIMITS.perTrip + " of " + LIMITS.perTrip : what + " full, " + LIMITS.perStop + " of " + LIMITS.perStop) : p.pages + " pages, " + room + " fit",
        choices: room > 0 ? [{ ...placeOf(p), who: p.who, rowIds: p.rowIds, pages: room, cut: tripFull ? "trip" : what }] : [],
      });
      continue;
    }
    extra.set(pk, (extra.get(pk) || 0) + want);
    trip += want;
    out.items.push({ key: p.key, file: p.file, label: p.label, ...placeOf(p), who: p.who, rowIds: p.rowIds, pages: want, cut: want < p.pages ? p.cut || (onStay ? "stay" : "stop") : "", from: p.from });
  }
  out.cards = pending.concat(limitCards);
  out.after = trip;
  out.quiet = list.filter((r) => !used.has(r)).length;
  return out;
}

// The stop facts from the list's lines, only where the stop's field is empty
// (never overwritten): tkRef the confirmation (else the ticket_ref), tkName
// the holder, tkSeat the seat. Fix round 1, M6: these are the stop's shared
// fields, so they come from lines for everyone; a person's own line gives
// only the reference, and only when every person's line on that stop has
// the same one (a person's seat goes on their own picture).
export function factsFor(items, rows, stops) {
  const byId = new Map((rows || []).map((r) => [r.ticket_id, r]));
  const out = {};
  const want = new Map(); // stop -> { all: { k: v }, refs: Set of the persons' references, persons }
  for (const it of items) {
    const stop = (stops || []).find((x) => x && x.id === it.stop);
    if (!stop) continue;
    if (!want.has(it.stop)) want.set(it.stop, { stop, all: {}, refs: new Set(), persons: 0 });
    const w = want.get(it.stop);
    for (const id of it.rowIds || []) {
      const r = byId.get(id);
      if (!r) continue;
      const ref = str(r.confirmation) || str(r.ticket_ref);
      if (it.who) {
        w.persons += 1;
        w.refs.add(ref);
        continue;
      }
      for (const [k, v] of [["tkRef", ref], ["tkName", str(r.holder)], ["tkSeat", str(r.seat)]]) if (v && !w.all[k]) w.all[k] = v;
    }
  }
  for (const [id, w] of want) {
    const patch = { ...w.all };
    if (!patch.tkRef && w.persons && w.refs.size === 1 && [...w.refs][0]) patch.tkRef = [...w.refs][0];
    for (const [k, v] of Object.entries(patch)) {
      if (str(w.stop[k])) continue;
      out[id] = out[id] || {};
      out[id][k] = v.slice(0, LIMITS.fact);
    }
  }
  return out;
}

// A stay's booking from the list's lines on it, only where the stay's own
// field is empty (never overwritten): tkRef the confirmation (else the
// ticket_ref), tkName the holder. stays: the stays as the phone has them.
export function stayFactsFor(items, rows, stays) {
  const byId = new Map((rows || []).map((r) => [r.ticket_id, r]));
  const out = {};
  for (const it of items) {
    if (!it.stay) continue;
    const stay = (stays || []).find((x) => x && x.id === it.stay);
    if (!stay) continue;
    for (const id of it.rowIds || []) {
      const r = byId.get(id);
      if (!r) continue;
      for (const [k, v] of [["tkRef", str(r.confirmation) || str(r.ticket_ref)], ["tkName", str(r.holder)]]) {
        if (!v || str(stay[k]) || (out[it.stay] && out[it.stay][k])) continue;
        out[it.stay] = out[it.stay] || {};
        out[it.stay][k] = v.slice(0, LIMITS.fact);
      }
    }
  }
  return out;
}

// A person's seat from the list, for their own picture.
export function seatFor(item, rows) {
  if (!item.who) return "";
  const r = (rows || []).find((x) => (item.rowIds || []).includes(x.ticket_id) && str(x.seat));
  return r ? str(r.seat).slice(0, LIMITS.fact) : "";
}
