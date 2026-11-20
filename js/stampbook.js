/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The stamp book, without a screen: the drawings, the three inks, how a
// stamp is drawn from its seed, and when each one is open. Pure: no DOM, safe
// to import in Node.
//
// Which day gets which name, drawing, ink and shape is data in the Sheet
// (the StampDefs tab, arriving on load as stampDefs); this file only holds
// the library of generic drawings and the inks.
//
// A definition: { id, date, name_ja, name_en, place, motif, ink, shape }.
// date is YYYY-MM-DD, or "" for the issue stamp (open from the start until
// the last day stamp closes). Every text here goes into markup only through
// esc(), so a name that holds markup is shown as text.
//
// When a stamp is open is decided in Japan time (fixed UTC+9), never in the
// phone's own zone, and by the same numbers as the backend's stampWindow
// (backend/Pure.js): 00:00 on its date until 03:00 the next day, 27 hours.

import { rng, wear } from "./stamp.js";

export const INKS = { shu: "#D63C1E", matsu: "#2B6A4C", ai: "#28408F" };

const JAPAN_MS = 9 * 3600000;
const OPEN_MS = 27 * 3600000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const has = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, (c) => ESC[c]);

// ---- the drawings ----
// Each is the inside of one drawing, in a 120-unit square, kept to x 38-82,
// y 36-78, strokes and fills in currentColor (the stamp sets the ink). They
// are drawn with a 2.6 round stroke and no fill (see DRAW below).
const F = 'fill="currentColor" stroke="none"';
const round2 = (n) => Math.round(n * 100) / 100;

// The issue crest: the letters MAT inside a ring of twelve short ticks.
function crest() {
  let ticks = "";
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ticks += "M" + round2(60 + c * 17) + " " + round2(57 + s * 17) + "L" + round2(60 + c * 21) + " " + round2(57 + s * 21);
  }
  return '<path stroke-width="2.2" d="' + ticks + '"/>' +
    '<text x="60" y="61.6" text-anchor="middle" font-family="Zen Kaku Gothic New,Hiragino Sans,sans-serif" font-weight="900" font-size="12.5" letter-spacing=".5" ' + F + ">MAT</text>";
}

export const MOTIFS = {
  lantern: '<path d="M60 31v6"/><rect x="52" y="37" width="16" height="4.5" ' + F + '/><circle cx="60" cy="57.5" r="15.5"/><path stroke-width="1.5" d="M46.4 51h27.2M44.6 57.5h30.8M46.4 64h27.2"/><rect x="53" y="73" width="14" height="4" ' + F + "/>",
  books: '<rect x="42" y="66" width="36" height="9.5"/><rect x="46" y="55.5" width="31" height="9.5"/><rect x="41" y="45" width="33" height="9.5"/><path stroke-width="1.6" d="M48.5 66v9.5M52.5 55.5V65M47.5 45v9.5M67 49.7h3M70 60.2h3M71 70.7h3"/>',
  onsen: '<path stroke-width="3.2" d="M43 59c0 19 34 19 34 0"/><path d="M51 62c-4.5-6 4.5-10 0-16-2-3 1-5.5.6-7.5M60 62c-4.5-7 4.5-11.5 0-18.5-2-3 1-6 .6-8.5M69 62c-4.5-6 4.5-10 0-16-2-3 1-5.5.6-7.5"/>',
  temple: '<path d="M60 34v6"/><path ' + F + ' d="M35 61q14-3 25-21 11 18 25 21z"/><path d="M45 61v15M55 61v15M65 61v15M75 61v15M40 77h40"/>',
  mountain: '<path d="M37 77l17-31q6-4 12 0l17 31z"/><path ' + F + ' d="M54 46q6-4 12 0l3.5 6.5-5-2.8-4.5 4-4.5-4-5 2.8z"/><circle cx="80" cy="41" r="4"/>',
  snow: [0, 60, 120, 180, 240, 300].map((a) => '<path transform="rotate(' + a + ' 60 57)" d="M60 57V36M60 43.5l-5-4.5M60 43.5l5-4.5M60 50l-4-3.6M60 50l4-3.6"/>').join(""),
  lamp: '<path d="M60 31v4"/><path ' + F + ' d="M49 45l11-9 11 9z"/><path d="M52.5 45h15l-2.5 15h-10z"/><circle cx="60" cy="52.5" r="2.7" ' + F + '/><path d="M60 60v18M53 78h14M56 66h8"/>',
  tower: '<path d="M60 29v8M60 37L48.5 78M60 37l11.5 41M51.5 67h17"/><rect x="53" y="50" width="14" height="8" ' + F + '/><path stroke-width="1.5" d="M52.8 59l15 8M67.2 59l-15 8M49.5 74h21"/>',
  record: '<circle cx="60" cy="57" r="20.5" stroke-width="3"/><circle cx="60" cy="57" r="14.5" stroke-width="1.2"/><circle cx="60" cy="57" r="10.5" stroke-width="1.2"/><path ' + F + ' fill-rule="evenodd" d="M53.5 57a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0zM58.5 57a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z"/>',
  sake: '<path d="M49 77c-7 0-8-14-2.5-20.5 2.5-3 2.5-6 2.5-10h8c0 4 0 7 2.5 10C65 63 64 77 57 77z"/><path stroke-width="3.2" d="M48 46.5h10"/><path d="M67 66h14l-2.5 11h-9z"/>',
  plane: '<path transform="rotate(45 60 56)" ' + F + ' d="M60 33c2.6 0 3.6 4 3.6 8v9L83 61.5v4.2L63.6 60v10.5l5.6 4.5v3.2L60 75.6l-9.2 2.6V75l5.6-4.5V60L37 65.7v-4.2L56.4 50v-9c0-4 1-8 3.6-8z"/>',
  crest: crest(),
};

// ---- dates and Japan time ----

const validDay = (s) => {
  const m = typeof s === "string" ? DAY_RE.exec(s) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};
const dayStart = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) - JAPAN_MS;
const dateOf = (def) => (def && typeof def.date === "string" ? def.date : "");

// The Japan calendar day of a moment, "YYYY-MM-DD".
export function japanDay(ms) {
  const d = new Date(ms + JAPAN_MS);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}

// The Japan clock time of a moment, "19:02".
export function japanClock(ms) {
  const d = new Date(ms + JAPAN_MS);
  return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
}

// "Dec 13", "Sat Dec 12", "Sat", "12" and "12.13" (M.D) of a YYYY-MM-DD.
export const monthDay = (s) => MON[Number(s.slice(5, 7)) - 1] + " " + Number(s.slice(8, 10));
export const weekdayOf = (s) => WD[new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))).getUTCDay()];
export const dayNumber = (s) => String(Number(s.slice(8, 10)));
const dotted = (s) => Number(s.slice(5, 7)) + "." + Number(s.slice(8, 10));

// ---- the definitions ----

// The definitions the book can use, in book order: the day stamps by date,
// then the issue stamp. One with no id, an id seen already, or a date that is
// neither a day nor empty is left out.
export function usableDefs(defs) {
  const seen = new Set();
  const out = [];
  for (const d of Array.isArray(defs) ? defs : []) {
    if (!d || typeof d !== "object" || typeof d.id !== "string" || d.id === "" || seen.has(d.id)) continue;
    const date = dateOf(d);
    if (date !== "" && !validDay(date)) continue;
    seen.add(d.id);
    out.push(d);
  }
  const days = out.filter((d) => dateOf(d) !== "").sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : dateOf(a) > dateOf(b) ? 1 : 0));
  return days.concat(out.filter((d) => dateOf(d) === ""));
}

// When a stamp can be pressed, in epoch ms: { opens, closes }. The same
// numbers as the backend's stampWindow.
export function windowOf(def, defs) {
  const date = dateOf(def);
  if (date === "") {
    let latest = null;
    for (const d of Array.isArray(defs) ? defs : []) {
      const x = dateOf(d);
      if (x === "" || !validDay(x)) continue;
      const c = dayStart(x) + OPEN_MS;
      if (latest === null || c > latest) latest = c;
    }
    return { opens: 0, closes: latest === null ? Infinity : latest };
  }
  if (!validDay(date)) return { opens: Infinity, closes: -Infinity };
  const opens = dayStart(date);
  return { opens, closes: opens + OPEN_MS };
}

const holds = (mine, id) => {
  if (!mine) return false;
  if (mine instanceof Set) return mine.has(id);
  if (Array.isArray(mine)) return mine.some((x) => x === id || (x && x.def === id));
  return has(mine, id);
};

// "have" (this person has pressed it), "open" (it can be pressed now), "soon"
// (not yet) or "missed" (its window has closed and it was never pressed).
export function stateOf(def, defs, mine, nowMs) {
  if (holds(mine, def && def.id)) return "have";
  const w = windowOf(def, defs);
  if (nowMs < w.opens) return "soon";
  if (nowMs >= w.closes) return "missed";
  return "open";
}

export const countText = (n, total) => n + " of " + total;

// A stamp's small tilt, in degrees, from its seed: -6 to 6.
export function tiltOf(seed) {
  const n = Number.parseInt(seed, 10);
  const r = rng(n >= 1 && n <= 0xffffffff ? n : 1)();
  return Math.round((r * 12 - 6) * 10) / 10;
}

// "2026.12.10 → 12.20": the first and last day stamp's dates ("" with none).
export function spanText(defs) {
  const days = usableDefs(defs).filter((d) => dateOf(d) !== "").map(dateOf);
  if (!days.length) return "";
  const a = days[0];
  const b = days[days.length - 1];
  return a.slice(0, 4) + "." + a.slice(5, 7) + "." + a.slice(8, 10) + (a === b ? "" : " → " + b.slice(5, 7) + "." + b.slice(8, 10));
}

// The refusal line under the page for a stamp that cannot be pressed.
export function lockedLine(def, state) {
  const date = dateOf(def);
  if (date === "") return "The book has closed.";
  return state === "missed" ? monthDay(date) + " has closed." : monthDay(date) + " opens on the day.";
}

// ---- drawing a stamp ----

// A short id for the parts of one stamp's drawing, from its definition id.
function tag(id) {
  let h = 0;
  for (const ch of String(id)) h = (Math.imul(h, 31) + ch.codePointAt(0)) >>> 0;
  return h.toString(36);
}

// How much a line of n letters has to shrink to fit `room` units of arc.
const fit = (n, each, room) => Math.min(1, room / Math.max(1, n * each));

// One stamp as an <svg> string: a ring (shape "round") or a rounded square
// ("square"), the name in Japanese on the top arc, the name in English and
// the date (M.D) on the bottom arc, one drawing in the middle, in the
// definition's ink (an unknown ink is vermilion), worn by the seed so it
// looks the same on every phone. The issue stamp (no date) shows the year of
// the first day stamp in `defs` in place of a date. An unknown drawing draws
// none. Every text is escaped, so the string may be set with innerHTML.
export function bookStampSVG(seed, def, defs) {
  const d = def && typeof def === "object" ? def : {};
  const n = Number.parseInt(seed, 10);
  const sid = n >= 1 && n <= 0xffffffff ? n : 1;
  const id = "b" + sid + tag(d.id);
  const r = rng(sid);
  const ink = has(INKS, d.ink) ? INKS[d.ink] : INKS.shu;
  const motif = has(MOTIFS, d.motif) ? MOTIFS[d.motif] : "";
  const mask = wear(id, r, 120);

  const frame = d.shape === "square"
    ? '<rect x="5" y="5" width="110" height="110" rx="13" fill="none" stroke="currentColor" stroke-width="3.2"/><rect x="10.5" y="10.5" width="99" height="99" rx="9" fill="none" stroke="currentColor" stroke-width="1"/>'
    : '<circle cx="60" cy="60" r="55" fill="none" stroke="currentColor" stroke-width="3.2"/><circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" stroke-width="1"/>';

  const ja = String(d.name_ja === undefined || d.name_ja === null ? "" : d.name_ja).trim();
  const jaN = [...ja].length;
  const jaK = fit(jaN, 17, 96);
  const date = dateOf(d);
  let when = "";
  if (date !== "" && validDay(date)) when = dotted(date);
  else if (date === "") {
    const first = usableDefs(defs).find((x) => dateOf(x) !== "");
    when = first ? dateOf(first).slice(0, 4) : "";
  }
  const en = (String(d.name_en === undefined || d.name_en === null ? "" : d.name_en).trim().toUpperCase() + (when ? " · " + when : "")).trim();
  const enK = fit([...en].length, 6.4, 128);

  const top = ja
    ? '<text font-family="Zen Antique,Hiragino Mincho ProN,serif" font-size="' + round2(13.5 * jaK) + '" letter-spacing="' + round2(3.5 * jaK) + '" fill="currentColor"><textPath href="#ta' + id + '" startOffset="50%" text-anchor="middle">' + esc(ja) + "</textPath></text>"
    : "";
  const bottom = en
    ? '<text font-family="Zen Kaku Gothic New,Hiragino Sans,sans-serif" font-weight="900" font-size="' + round2(6.8 * enK) + '" letter-spacing="' + round2(1.3 * enK) + '" fill="currentColor"><textPath href="#tb' + id + '" startOffset="50%" text-anchor="middle">' + esc(en) + "</textPath></text>"
    : "";
  const art = motif
    ? '<g transform="translate(0 3)" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' + motif + "</g>"
    : "";
  return '<svg class="bk-st" viewBox="0 0 120 120" width="100%" height="100%" color="' + ink + '" aria-hidden="true" focusable="false" overflow="visible"><defs>' + mask +
    '<path id="ta' + id + '" d="M27 60A33 33 0 0 1 93 60" fill="none"/><path id="tb' + id + '" d="M13.5 60A46.5 46.5 0 0 0 106.5 60" fill="none"/></defs>' +
    '<g mask="url(#pm' + id + ')">' + frame + top + bottom + art + "</g></svg>";
}

// What the Days screen shows of the book, from the store's state and the real
// time: { total, n, openToday } where total is the stamps the book has (0:
// nothing to show), n how many of them this person has, and openToday the
// date of today's stamp when it is open and not pressed yet (else "").
// Today is `today` when given (the Days clock's day, plan.js tripNow: on a day
// in its own zone, that place's), else the Japan calendar day, whatever zone
// the phone is in. The stamp's window is Japan time either way (windowOf).
export function summary(s, nowMs, today = japanDay(nowMs)) {
  const defs = usableDefs(s && s.stampDefs);
  const mine = new Set();
  for (const x of Array.isArray(s && s.stamps) ? s.stamps : []) if (x && x.who === s.me && !x.gone) mine.add(x.def);
  const day = defs.find((d) => dateOf(d) === today);
  return {
    total: defs.length,
    n: defs.filter((d) => mine.has(d.id)).length,
    openToday: day && stateOf(day, defs, mine, nowMs) === "open" ? today : "",
  };
}
