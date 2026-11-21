/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// One day as a railway ticket: the line's band with the day number, the route
// in large type, the date, a perforation, the day's stops as printed rows and
// a fine-print footer. Ported from the mockup's ticket(), built node by node:
// every name, title and note from the Sheet goes in with textContent, and a
// link or photo from the Sheet becomes an href or src only through safeHref.
//
// ticketEl(model) -> HTMLElement (an <article class="tk">), where
// model = { day, number, count, state, header, stops, stays, total, mark,
//           stay, nextId, minutes, toGo, tripName, stampOpen }
// - day: the Days row ({ date, city, title, ... }); header: header(day) from
//   js/plan.js; stops: stopsFor(...) for the day, in order; stays: every stay;
//   number:
//   1-based; mark: the issuer's mark ("MAT"); tripName: printed when the day
//   has no route and no city.
// - state: dayState(...) ("used", "today", "ahead"); minutes: the trip zone's
//   minutes past midnight; nextId: today's next stop (nextStopId, which keeps
//   a stop just started for a while, R38), else null;
//   total: the day's logged yen (dayTotalYen), printed as the fare when above
//   zero; toGo: days until the trip starts (daysToGo), counted down on Day 1;
//   stampOpen: today's stamp in the stamp book is open and not yet pressed,
//   so the ticket carries a line, .tk-stampline, that opens the book.
// - ask: today's ticket asks, once, whether to use where the phone is
//   (.tk-ask under the date, with Use it and Not now; the Days view sees to
//   the taps). Without it the ticket is exactly as it was.
// - hereNext: leave-by from where you are (plan.js hereLine) for today's next
//   stop, or absent: a 現在地 line under its name (distance, minutes on
//   foot) and the leave line from the walking minutes, in vermilion when late.
//   Absent, the next stop reads exactly as it did.
// - near: { [stopId]: { dist, near } } (plan.js nearStops) on today's
//   ticket: each open stop gets its 現在地 distance, the nearest the 近い tag.
//   The order is never changed.
// - stay: the night's stay (stayShownFor: on today's ticket before 04:00,
//   last night's), or null. Drawn after the stops as one
//   button, .tk-stay[data-stay], that opens the hotel card; no stay, no row.
// After the stops (before the stay) every ticket has ＋ Add a stop, a button
// .tk-add[data-date]; each open stop has an Edit button, .r-edit, beside its
// links. Both open the stop sheet (the Days view sees to the taps).
// Every row is drawn closed: the Days view opens one (.is-open on the .r, and
// aria-expanded on its [role=button], and un-inerts its .r-more).
// A used day's gate stamp is made once per day, place and mark, and reused.
// - stayTag: { kind, label, saved, n, total, state } (js/tickets.js stayMark
//   and js/plan.js nightOf for that ticket's night) when the night's stay has
//   a booking: the 宿泊 line carries 券 and the night in plain type. Absent, the line
//   reads exactly as it did.
// - zone: on a day whose zone is not the trip's (T1 現地時刻), { word,
//   clocks } where word names the zone ("Eastern") and clocks, only while the
//   day is today, is { local, japan, japanDate } (js/plan.js zoneClocks): the
//   two clocks over a hotel desk, 現地 and 日本, at the end of .tk-head
//   (.zs > .zc ×2), then the line .zs-say "Times on this ticket are local,
//   Eastern." On any other day only that line. null on a day in the trip's
//   zone: the ticket is then node for node as it was.
// - eve: the evening before this day (前夜, a Days row of kind "eve"), when it
//   has stops: { date, local, stops, state, minutes, nextId, hereNext? }, a
//   strip between the band and .tk-head (.eve > .eve-h, .rows) whose rows are
//   drawn as any stop's, judged by its own state and minutes; local: its zone
//   is not the trip's (現地 on the right). No ＋ Add a stop for it.
// - tix: { [stopId]: { kind, label, saved } } (js/tickets.js ticketMark) for
//   the stops that have a ticket: the 券 box under the name (solid when every
//   picture is on this phone, dashed when one still needs signal) and, when
//   open, 切符 Show ticket (.r-tk) above the links. Absent, a stop reads
//   exactly as it did.

import { minutesOf, issueLine, isPast, nextLine, mapsUrl, safeHref, gateDate } from "../plan.js";
import { dayHead, yen, weekdayOf } from "../format.js";
import { rng, gateStampSVG } from "../stamp.js";
import { nightsShort, nightsLong } from "../staywords.js";

const SVG = "http://www.w3.org/2000/svg";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const str = (v) => (typeof v === "string" ? v.trim() : "");

// The large type shrinks with the name's length, as the mockup's fsFor does.
// A Latin letter is about half as wide as a Japanese character, so it counts
// as a little over half of one. `wide`: the name has the ticket's whole width
// to itself (no arrow, no second station), so it may be twice as long.
export function fsFor(name, wide = false) {
  let n = 0;
  for (const c of name) n += c.codePointAt(0) < 0x2e80 ? 0.55 : 1;
  if (wide) n /= 2;
  return n <= 2 ? 46 : n <= 3 ? 38 : n <= 4 ? 31 : n <= 5 ? 26 : 22;
}

// A station: its name large (Japanese when there is one), English under it.
function station(jp, en, cls, wide = false) {
  const s = el("div", cls);
  const big = jp || en;
  const b = el("b", "", big);
  b.style.fontSize = fsFor(big, wide) + "px";
  s.append(b);
  if (jp && en) s.append(el("span", "", en));
  return s;
}

function arrow() {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "arr");
  svg.setAttribute("viewBox", "0 0 48 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", "M0 8h30V0l18 12-18 12v-8H0z");
  svg.append(path);
  return svg;
}

function band(h, number) {
  const b = el("div", "tk-band");
  if (h.line) {
    const name = el("span", "", h.line.jp || h.line.en);
    if (h.line.jp && h.line.en) name.append(el("i", "", h.line.en));
    b.append(name);
  } else if (h.city) {
    b.append(el("span", "", h.city));
  }
  const num = el("span", "num");
  num.append(el("small", "", "D"), " " + String(number).padStart(2, "0"));
  b.append(num);
  return b;
}

function route(h, tripName) {
  const r = el("div", "tk-route");
  if (h.route) {
    const { fromJp, fromEn, toJp, toEn } = h.route;
    r.append(station(fromJp, fromEn, "stn"), arrow(), station(toJp, toEn, "stn to"));
    return r;
  }
  // No route: the city alone, or the trip's name, across the whole ticket.
  r.classList.add("is-one");
  const name = h.city || str(tripName);
  if (name) r.append(station("", name, "stn", true));
  return r;
}

// A photo address that failed to load is not drawn again (this visit).
const failedPhotos = new Set();

// What shows when the stop is open: the photo, how to get there, the note,
// and the buttons (directions from here, and the stop's own link). Under the
// keys, drawn hidden, the line that says where directions start: the Days
// view shows it on the first stop opened in a visit (.r-why).
function more(stop, tix) {
  const wrap = el("div", "r-more");
  wrap.inert = true;
  const inner = el("div");
  const photo = safeHref(stop.photo);
  if (photo && !failedPhotos.has(photo)) {
    const img = el("img", "r-ph");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      failedPhotos.add(photo);
      img.remove();
    }, { once: true });
    img.src = photo;
    inner.append(img);
  }
  const go = str(stop.gettingThere);
  if (go) inner.append(el("div", "r-go", go));
  const note = str(stop.note);
  if (note) inner.append(el("div", "r-note", note));
  // 切符 Show ticket: a stub-shaped key (the Days view opens the stub).
  if (tix) {
    const show = el("button", "r-tk");
    show.type = "button";
    const w = el("span");
    w.append(el("b", "", "切符"), "Show ticket");
    show.append(w, el("i", "", tix.label));
    inner.append(show);
  }
  const btns = el("div", "r-btns");
  const link = (cls, text, href) => {
    const a = el("a", cls, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  };
  const map = mapsUrl(stop);
  if (map) btns.append(link("r-map", "地図 Directions from here ↗", map));
  const own = safeHref(stop.link);
  if (own) btns.append(link("r-map alt", "Ticket or booking ↗", own));
  // Opens the stop sheet on this stop (js/views/stopsheet.js).
  const edit = el("button", "r-edit", "Edit");
  edit.type = "button";
  btns.append(edit);
  inner.append(btns);
  if (map) {
    const why = el("p", "r-why", "Opens Maps from where your phone is, by train and bus.");
    why.hidden = true;
    inner.append(why);
  }
  wrap.append(inner);
  return wrap;
}

function row(stop, model) {
  const { state, minutes, nextId } = model;
  const next = state === "today" && stop.id === nextId;
  const r = el("div", "r");
  r.dataset.id = stop.id;
  if (state === "used" || (state === "today" && isPast(stop, minutes, nextId))) r.classList.add("is-done");
  if (next) r.classList.add("is-next");

  // The name and the line under it: the part that opens and closes the stop.
  const body = el("div", "r-b");
  body.setAttribute("role", "button");
  body.tabIndex = 0;
  body.setAttribute("aria-expanded", "false");
  const title = str(stop.title);
  const near = model.near && model.near[stop.id] ? model.near[stop.id] : null;
  if (title || next) {
    const n = el("div", "r-n");
    if (next) n.append(el("span", "tag", "こんど"));
    else if (near && near.near) n.append(el("span", "tag near", "近い"));
    if (title) n.append(title);
    body.append(n);
  }
  // A time that cannot slip: 指定 beside the English, under the name.
  if (stop.fixed === true) {
    const fx = el("div", "r-fx");
    fx.append(el("b", "", "指定"), " ", el("span", "", "Fixed time"));
    body.append(fx);
  }
  const tix = model.tix && model.tix[stop.id] ? model.tix[stop.id] : null;
  if (tix) {
    const fx = el("div", "r-fx tk-mark");
    fx.append(el("b", tix.saved ? "" : "is-dash", "券"), " ", el("span", "", tix.kind === "ref" ? "Reference only, no file" : tix.label + " · " + (tix.saved ? "on this phone" : "needs signal once")));
    body.append(fx);
  }
  const here = next && model.hereNext ? model.hereNext : null;
  if (here) body.append(hereRow(here.dist));
  else if (near) body.append(hereRow(near.dist));
  const lead = here ? here.lead : next ? nextLine(stop, minutes) : "";
  const detail = str(stop.detail);
  if (lead || detail) {
    const s = el("div", "r-s");
    if (lead) s.append(el("b", here && here.late ? "r-lv is-late" : "r-lv", lead));
    if (lead && detail) s.append(" ");
    if (detail) s.append(detail);
    body.append(s);
  }
  r.append(el("div", "r-t", minutesOf(stop.time) === null ? "—" : stop.time), body, el("div", "r-j", str(stop.signJp)), more(stop, tix));
  return r;
}

// Drawn once per day, place and mark; a redraw reuses the string.
const stamps = new Map();

// A used day's gate stamp, the same on every phone: seeded from the date's
// digits; its place the day's last station, else the city.
function gate(day, h, mark) {
  const seed = Number(day.date.replace(/-/g, "")) || 1;
  const place = str(day.toJp) || h.city;
  const key = seed + "|" + place + "|" + mark;
  if (!stamps.has(key)) {
    stamps.set(key, { svg: gateStampSVG(seed, place, gateDate(day.date), mark), rot: (-14 + rng(seed)() * 22).toFixed(1) + "deg" });
  }
  const { svg, rot } = stamps.get(key);
  const insp = el("div", "insp");
  insp.style.setProperty("--rot", rot);
  insp.innerHTML = svg; // escaped by gateStampSVG
  return insp;
}

// The right-hand side of the date row: 当日限り有効, or on Day 1 before the
// trip how many days until it is valid.
function validity(number, toGo) {
  if (number === 1 && toGo > 0) {
    const s = el("span", "", "あと" + toGo + "日");
    s.append(el("i", "", toGo === 1 ? "Valid tomorrow" : "Valid in " + toGo + " days"));
    return s;
  }
  return el("span", "", "当日限り有効");
}

// Under the date, on the day whose stamp is open and not yet pressed: a line
// that opens the stamp book (the Days view sees to the tap).
function stampLine() {
  const b = el("button", "tk-stampline");
  b.type = "button";
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle class="d" cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="4.2"/></svg>';
  b.append(el("span", "", "Today’s stamp is open"), el("i", "", "›"));
  return b;
}

// 現在地, "you are here": the red box printed wherever the phone's position was used.
export function hereBox() {
  return el("span", "here", "現在地");
}

// 現在地 and a distance, boxed under a stop's name like 指定. Where it has to
// wrap (a narrow phone), only after the dot: "1.2 km ·" / "20 min on foot".
function hereRow(text) {
  const fx = el("div", "r-fx at");
  const kept = text.replace(/ /g, "\u00a0").replace("\u00a0·\u00a0", "\u00a0· ");
  fx.append(hereBox(), el("span", "dist", kept));
  return fx;
}

// The one-time line under the date on today's ticket: may MAT use where you are?
function askLine() {
  const d = el("div", "tk-ask");
  const p = el("p");
  const words = el("span", "", "Leave-by times from where you are?");
  words.append(el("small", "", "Your location stays on this phone."));
  p.append(hereBox(), words);
  const yes = el("button", "yes", "Use it");
  yes.type = "button";
  const no = el("button", "no", "Not now");
  no.type = "button";
  const btns = el("div");
  btns.append(yes, no);
  d.append(p, btns);
  return d;
}

// 宿泊 Tonight and the stay's name: a button that opens the hotel card.
// tag: { kind, label, saved, n, total, state } when the stay has a booking
// (look A, 予約票): 券 and how it stands under the name, and the night in
// plain type on the right ("1 / 3泊"). Without it the row is as it always was.
function stayRow(stay, tag = null) {
  const b = el("button", "tk-stay");
  b.type = "button";
  b.dataset.stay = stay.id;
  const label = el("span", "tk-stay-l");
  label.append(el("b", "", "宿泊"), el("span", "", "Tonight"));
  b.append(label);
  const name = str(stay.name) || str(stay.nameJp);
  if (!tag) {
    if (name) b.append(el("span", "tk-stay-n", name));
    return b;
  }
  b.classList.add("has-bk");
  const mid = el("span");
  if (name) mid.append(el("span", "tk-stay-n", name));
  const fx = el("span", "r-fx");
  const pics = tag.kind === "pics";
  fx.append(el("b", pics && !tag.saved ? "is-dash" : "", "券"), el("span", "", !pics ? "Reference only" : "Booking · " + (tag.saved ? "on this phone" : "needs signal once")));
  mid.append(fx);
  const nt = el("span", "tk-stay-nt", nightsShort(tag));
  nt.setAttribute("aria-hidden", "true");
  b.append(mid, nt);
  const nights = nightsLong(tag).toLowerCase();
  b.setAttribute("aria-label", "Tonight: " + name + ". Booking, " + nights + ".");
  return b;
}

const hhmm = (n) => String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");

// A clock face at this many minutes past midnight (numbers only, no text).
function clockFace(minutes) {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const ha = ((hh % 12) + mm / 60) * 30;
  const ma = mm * 6;
  let ticks = "";
  for (let i = 0; i < 12; i++) ticks += '<path d="M22 4.5v' + (i % 3 ? 2.2 : 4) + '" transform="rotate(' + i * 30 + ' 22 22)"/>';
  const wrap = el("span", "zc-face");
  wrap.innerHTML = '<svg viewBox="0 0 44 44" aria-hidden="true" focusable="false"><circle cx="22" cy="22" r="20" fill="#fff" stroke="#15120F" stroke-width="2.4"/><g stroke="#15120F" stroke-width="1.5">' + ticks +
    '</g><path d="M22 22V11.5" stroke="#15120F" stroke-width="3" stroke-linecap="round" transform="rotate(' + ha + ' 22 22)"/><path d="M22 22V6.5" stroke="#15120F" stroke-width="1.8" stroke-linecap="round" transform="rotate(' + ma + ' 22 22)"/><circle cx="22" cy="22" r="2.2" fill="#D63C1E"/></svg>';
  return wrap.firstChild;
}

// One clock and its words: 現地 Eastern 07:00, or 日本 Japan 21:00 水 Wed.
function zoneClock(jp, en, minutes, wd, dim) {
  const c = el("div", dim ? "zc is-dim" : "zc");
  c.setAttribute("aria-hidden", "true");
  const words = el("div");
  const small = el("small", "", jp);
  small.append(el("i", "", en));
  const b = el("b", "", hhmm(minutes));
  if (wd) b.append(el("em", "", wd));
  words.append(small, b);
  c.append(clockFace(minutes), words);
  return c;
}

// T1 現地時刻: the two clocks (only while the day is today) and the line.
function zoneStrip(zone) {
  const zs = el("div", "zs");
  const c = zone.clocks;
  if (c) {
    const wd = weekdayOf(c.japanDate);
    zs.append(zoneClock("現地", zone.word, c.local, "", false), zoneClock("日本", "Japan", c.japan, wd.jp + " " + wd.en, true));
    zs.append(el("span", "zs-vh", "Local time " + hhmm(c.local) + ", " + zone.word + ". Japan " + hhmm(c.japan) + ", " + wd.long + "."));
  } else {
    zs.classList.add("is-say");
  }
  const say = el("p", "zs-say");
  say.append(el("b", "", "現地"), "Times on this ticket are local, " + zone.word + ".");
  zs.append(say);
  return zs;
}

// 前夜: the evening before, a strip at the head of the day after it.
function eveStrip(eve, model) {
  const d = el("div", "eve");
  const h = el("div", "eve-h");
  const left = el("span");
  left.append(el("b", "", "前夜"), "The evening before · " + dayHead(eve.date).en);
  h.append(left);
  if (eve.local) h.append(el("span", "", "現地"));
  const rows = el("div", "rows");
  const judged = { state: eve.state, minutes: eve.minutes, nextId: eve.nextId, tix: model.tix, hereNext: eve.hereNext || null };
  rows.append(...eve.stops.map((stop) => row(stop, judged)));
  d.append(h, rows);
  return d;
}

export function ticketEl(model) {
  const { day, number, header: h, stops, mark, tripName, state, total, toGo } = model;
  const date = day.date;
  const tk = el("article", "tk");
  // The line's colour; without a valid one the band stays neutral (css/days.css).
  if (h.colour) {
    tk.style.setProperty("--line", h.colour);
    tk.style.setProperty("--line-ink", h.ink);
  }

  const head = el("div", "tk-head");
  const kind = el("div", "tk-kind");
  const k = el("span", "", "一日乗車券");
  k.append(el("i", "", "1-Day Ticket"));
  kind.append(k, el("span", "fare", total > 0 ? yen(total) : ""));
  head.append(kind, route(h, tripName));
  if (h.title) head.append(el("div", "tk-title", h.title));
  const dh = dayHead(date);
  const when = el("span", "", dh.jp);
  when.append(el("i", "", dh.en));
  const dateRow = el("div", "tk-date");
  dateRow.append(when, validity(number, toGo));
  head.append(dateRow);
  if (model.ask) head.append(askLine());
  if (model.stampOpen) head.append(stampLine());
  if (model.zone) head.append(zoneStrip(model.zone));
  if (state === "used") head.append(gate(day, h, mark));

  const rows = el("div", "rows");
  if (stops.length) rows.append(...stops.map((stop) => row(stop, model)));
  else rows.append(el("div", "r-none", "Nothing planned yet."));

  const foot = el("div", "tk-foot");
  foot.append(el("span", "", issueLine(date, number, mark)), el("span", "", "Good for this day only"));

  // A used day is punched on the perforation, clear of the print.
  const perf = el("div", "tk-perf");
  if (state === "used") perf.append(el("span", "punch"));
  tk.append(band(h, number));
  if (model.eve && model.eve.stops.length) tk.append(eveStrip(model.eve, model));
  tk.append(head, perf, rows);
  // A stay typed into the Sheet by hand with no id cannot be opened: no row.
  const stay = model.stay;
  // ＋ Add a stop: after the day's stops, before the night's stay.
  const add = el("button", "tk-add", "＋ Add a stop");
  add.type = "button";
  add.dataset.date = date;
  tk.append(add);
  if (stay && typeof stay.id === "string" && stay.id) tk.append(stayRow(stay, model.stayTag || null));
  tk.append(foot);
  return tk;
}
