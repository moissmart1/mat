/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The hotel card: where you sleep, to hold up to a taxi driver. A sheet on
// the ticket's own stock, opened from a ticket's stay row.
//
// mountStayCard(root, store, { driver, where }) -> { open(stayId), close(restoreFocus), isOpen() }
// root is the phone. The card draws from store.state.stays only, so it opens
// with no signal; nothing is fetched. It redraws on every store change while
// open, and closes itself when its stay is gone. The name and the address are
// large, in Japanese when there is Japanese; under them ここまでお願いします
// (Please take me here.), the note, a map link and the booking link. A stay's optional photo comes
// first, as a stop's does on its ticket. Text from
// the Sheet goes in with textContent; a link only through safeHref.
//
// 運転手さんへ Show to driver: when the stay has a Japanese name or address,
// the card's one bold key opens the driver's screen (js/views/driver.js,
// mounted once by the app and handed in as `driver`) with 宿泊 and the stay's
// name in its dark bar. Done, Escape and the scrim close it, back to the card
// (inert while the screen is up). Closing the card closes it too; a stay that
// loses its Japanese closes it.
//
// With a usable position (js/where.js) and the stay's coordinates, the card
// also says how far (up to 50 km): 現在地 2.4 km from here. Otherwise nothing
// is added. While the card is open it looks again every 15 seconds, so a
// distance from a position no longer usable is taken off.
//
// The booking (look A, 予約票): Edit is always the last key under the note
// (onEdit(stayId): the app closes the card and opens Edit stay). When the stay
// has a booking (js/tickets.js stayMark: pictures, or the facts alone), a
// ruled form closes the name and address block: 予約 Booking, the dates, the
// booking number (or the pages, or the name on it) and the night (by clock, in
// the trip's zone). Under 運転手さんへ is 予約票 Show booking
// (onBooking(stayId, button): the app holds the booking up, js/views/stub.js)
// and a line saying whether its pictures are on this phone. Only rules and
// type, no drawn objects. Without a booking the card is as it was, plus Edit.

import { safeHref, stayMapsUrl, stayDistance, tripNow, nightOf, staySpan } from "../plan.js";
import { stayMark } from "../tickets.js";
import { nightsShort, nightsLong, nightLabel, stayArrow, cardCell } from "../staywords.js";

const MARKUP = `
<div class="sheet-top"><span>Where you sleep<i>宿泊</i></span><button type="button" id="stayDone">Done</button></div>
<div class="sy" id="stayBody"></div>`;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const str = (v) => (typeof v === "string" ? v.trim() : "");

function link(cls, text, href) {
  const a = el("a", cls, text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

// A photo address that failed to load is not drawn again (this visit).
const failedPhotos = new Set();

const RECHECK_MS = 15000;

// The booking form on the card: a ruled block, the dates and the booking's
// number, and the night.
function bookingForm(stay, tag) {
  const form = el("div", "bk-form");
  form.setAttribute("role", "group");
  form.setAttribute("aria-label", "Booking");
  const head = el("div", "bk-hd");
  const title = el("span");
  const jpTitle = el("span", "", "予約");
  jpTitle.setAttribute("aria-hidden", "true");
  title.append(jpTitle, " Booking");
  head.append(title);
  const arrow = stayArrow(stay);
  if (arrow) {
    const dates = el("i");
    const seen = el("span", "", arrow);
    seen.setAttribute("aria-hidden", "true");
    dates.append(seen, el("span", "bk-vh", staySpan(stay)));
    head.append(dates);
  }
  const short = nightsShort(tag.night);
  const grid = el("div", "bk-g" + (short ? "" : " is-one"));
  const cell = cardCell(stay, tag.mark);
  const left = el("div");
  const lsmall = el("small");
  const ljp = el("span", "", cell.jp);
  ljp.setAttribute("aria-hidden", "true");
  lsmall.append(ljp, el("i", "", cell.en));
  left.append(lsmall, el("b", "", cell.value));
  grid.append(left);
  if (short) {
    const right = el("div");
    const rsmall = el("small", "", "泊");
    rsmall.setAttribute("aria-hidden", "true");
    rsmall.append(el("i", "", nightLabel(tag.night)));
    const rb = el("b", "", short);
    rb.setAttribute("aria-hidden", "true");
    right.append(rsmall, rb, el("span", "bk-vh", nightsLong(tag.night)));
    grid.append(right);
  }
  form.append(head, grid);
  return form;
}

// The card's contents for one stay. far: "2.4 km from here", or "".
// tag: { mark, night } when the stay has a booking, else null.
function card(stay, far = "", tag = null) {
  const nodes = [];
  const photo = safeHref(stay.photo);
  if (photo && !failedPhotos.has(photo)) {
    const img = el("img", "sy-ph");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      failedPhotos.add(photo);
      img.remove();
    }, { once: true });
    img.src = photo;
    nodes.push(img);
  }
  const jp = str(stay.nameJp);
  const en = str(stay.name);
  const big = jp || en;
  if (big) nodes.push(el("div", "sy-name", big));
  if (jp && en) nodes.push(el("div", "sy-en", en));
  const address = str(stay.addressJp);
  if (address) nodes.push(el("div", "sy-ad", address));
  if (tag) nodes.push(bookingForm(stay, tag));
  const ask = el("div", "sy-ask");
  ask.append(el("b", "", "ここまでお願いします"), el("span", "", "Please take me here."));
  nodes.push(ask);
  const note = str(stay.note);
  if (note) nodes.push(el("div", "sy-note", note));
  const btns = el("div", "r-btns");
  const map = stayMapsUrl(stay);
  if (map) btns.append(link("r-map sy-map", "地図 Map ↗", map));
  const booking = safeHref(stay.link);
  if (booking) btns.append(link("r-map alt", "Booking ↗", booking));
  // Edit stay: always the last key, so the row is always drawn.
  const edit = el("button", "r-edit", "Edit");
  edit.type = "button";
  edit.setAttribute("aria-label", "Edit stay");
  btns.append(edit);
  nodes.push(btns);
  if (jp || address) {
    const drv = el("button", "drv");
    drv.type = "button";
    const words = el("span");
    words.append(el("b", "", "運転手さんへ"), "Show to driver");
    const arrow = el("i", "", "›");
    arrow.setAttribute("aria-hidden", "true");
    drv.append(words, arrow);
    drv.setAttribute("aria-label", "運転手さんへ Show to driver");
    nodes.push(drv);
  }
  if (tag) {
    const key = el("button", "bk-key");
    key.type = "button";
    const words = el("span");
    const jpKey = el("b", "", "予約票");
    jpKey.setAttribute("aria-hidden", "true");
    words.append(jpKey, "Show booking");
    const nl = nightsLong(tag.night);
    const goes = el("i", "", nl ? nl + " ›" : "›");
    goes.setAttribute("aria-hidden", "true");
    key.append(words, goes);
    key.setAttribute("aria-label", "Show booking" + (nl ? ", " + nl.toLowerCase() : ""));
    nodes.push(key);
    const line = el("div", "sy-tkline");
    const m = tag.mark;
    line.append(el("b", m.kind === "pics" && !m.saved ? "is-dash" : "", "券"), el("span", "", m.kind === "ref" ? "Reference only" : m.label + " · " + (m.saved ? "on this phone" : "needs signal once")));
    nodes.push(line);
  }
  if (far) {
    const d = el("div", "sy-dist");
    d.append(el("span", "here", "現在地"), el("span", "dist", far));
    nodes.push(d);
  }
  return nodes;
}

// What the driver's screen (js/views/driver.js) shows for one stay.
const driverWhat = (stay) => ({ mark: "宿泊", title: str(stay.name) || str(stay.nameJp), nameJp: stay.nameJp, addressJp: stay.addressJp });

export function mountStayCard(root, store, { driver = null, where = null, keep = null, clock = null, onEdit = () => {}, onBooking = () => {} } = {}) {
  const scrim = el("div", "scrim");
  scrim.id = "stayScrim";
  scrim.hidden = true;
  const sheet = el("div", "sheet stay");
  sheet.id = "stay";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Where you sleep");
  sheet.inert = true;
  sheet.innerHTML = MARKUP;
  root.append(scrim, sheet);

  const body = sheet.querySelector("#stayBody");
  const done = sheet.querySelector("#stayDone");
  let stayId = null;
  let shown = ""; // what the card was last drawn from
  let recheck = null; // while open: is the distance still from a usable position?

  // The driver's screen, over the card (js/views/driver.js, mounted once by
  // the app). mine: it is up for this card, which stays inert under it.
  let mine = false;
  if (driver) driver.onChange((on) => {
    if (!mine) return; // a stop's screen: not this card's business
    if (!on) mine = false;
    sheet.inert = !isOpen() || on;
  });
  const driverOpen = () => mine && !!driver && driver.isOpen();
  function openDriver() {
    const stay = current();
    if (!stay || !driver || driver.isOpen()) return;
    mine = true;
    // Done, Escape or the scrim: back to the card's key (as it is drawn then).
    if (!driver.open(driverWhat(stay), () => (isOpen() ? sheet.querySelector(".drv") : null))) mine = false;
  }
  const closeDriver = () => {
    if (driverOpen()) driver.close(false);
  };
  body.addEventListener("click", (ev) => {
    if (ev.target.closest(".drv")) openDriver();
    else if (ev.target.closest(".r-edit") && stayId) onEdit(stayId);
    else if (ev.target.closest(".bk-key") && stayId) onBooking(stayId, ev.target.closest(".bk-key"));
  });

  const current = () => (store.state.stays || []).find((s) => s && s.id === stayId && !s.deleted) || null;
  const isOpen = () => sheet.classList.contains("is-open");
  // The booking: { mark, night } when the stay has a booking (pictures or
  // facts), else null. The night by the trip's clock, in its zone.
  function tagOf(stay) {
    const s = store.state;
    const mark = s.ticketsReady === false ? null : stayMark(stay, s.tickets, (id) => !!keep && keep.have(id));
    if (!mark) return null;
    // By the Days clock (a day in its own zone is that place's).
    const now = tripNow(s, clock ? clock.now() : Date.now());
    return { mark, night: nightOf(stay, { today: now.date, minutes: now.minutes }) };
  }

  function render() {
    // The trip was taken off this phone: the card closes and nothing of it stays drawn.
    if (store.state.status === "nokey") {
      close(false);
      body.replaceChildren();
      shown = "";
      return;
    }
    if (!isOpen()) return;
    const stay = current();
    if (!stay) {
      close(false);
      return;
    }
    // Redrawn with the stay's words; closed when it lost its Japanese.
    if (driverOpen()) driver.update(driverWhat(stay));
    const far = where ? stayDistance(stay, where.current()) : "";
    const tag = tagOf(stay);
    // The pictures, whether each is on this phone, and the night redraw it too.
    const pics = (store.state.tickets || []).filter((t) => t && t.stay === stay.id && !t.gone).map((t) => [t.id, !!keep && keep.have(t.id)]);
    const sig = JSON.stringify([stay, far, tag, pics]);
    if (sig === shown) return;
    shown = sig;
    // A key keeps focus across a redraw.
    const a = document.activeElement;
    const had = a && sheet.contains(a) ? [".drv", ".bk-key", ".r-edit"].find((c) => a.matches(c)) : null;
    body.replaceChildren(...card(stay, far, tag));
    if (had) {
      const key = body.querySelector(had);
      if (key) key.focus({ preventScroll: true });
    }
  }

  function open(id) {
    stayId = id;
    if (!current()) {
      stayId = null;
      return false;
    }
    shown = "";
    sheet.classList.add("is-open");
    sheet.inert = false;
    scrim.hidden = false;
    root.classList.add("stay-open");
    if (where && !recheck) recheck = setInterval(render, RECHECK_MS);
    sheet.scrollTop = 0;
    render();
    done.focus({ preventScroll: true });
    return true;
  }

  // restoreFocus: give focus back to the stay row on the ticket in view.
  function close(restoreFocus = true) {
    if (!isOpen()) return;
    closeDriver();
    clearInterval(recheck);
    recheck = null;
    const id = stayId;
    stayId = null;
    sheet.classList.remove("is-open");
    sheet.inert = true;
    scrim.hidden = true;
    root.classList.remove("stay-open");
    if (sheet.contains(document.activeElement)) document.activeElement.blur();
    if (restoreFocus === true) {
      const rows = [...root.querySelectorAll(".tk-stay")].filter((b) => b.dataset.stay === id);
      const rail = root.querySelector("#rail");
      // The row on the ticket in view: the one nearest the rail's middle.
      const mid = rail ? rail.getBoundingClientRect().left + rail.getBoundingClientRect().width / 2 : 0;
      const off = (b) => Math.abs(b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2 - mid);
      rows.sort((a, b) => off(a) - off(b));
      if (rows[0]) rows[0].focus({ preventScroll: true });
    }
  }

  done.addEventListener("click", () => close());
  scrim.addEventListener("click", () => close());
  document.addEventListener("keydown", (ev) => {
    // The booking held up over the card closes first (js/views/stub.js).
    if (ev.key === "Escape" && !root.classList.contains("stub-open")) close();
  });
  store.subscribe(render);
  if (where) where.subscribe(render);
  if (keep && keep.subscribe) keep.subscribe(render);
  if (clock && clock.subscribe) clock.subscribe(render);

  return { open, close: (restoreFocus) => close(restoreFocus), isOpen };
}
