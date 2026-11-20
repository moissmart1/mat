/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The hotel card: where you sleep, to hold up to a taxi driver. A sheet on
// the ticket's own stock, opened from a ticket's stay row.
//
// mountStayCard(root, store, { where }) -> { open(stayId), close(restoreFocus), isOpen() }
// root is the phone. The card draws from store.state.stays only, so it opens
// with no signal; nothing is fetched. It redraws on every store change while
// open, and closes itself when its stay is gone. The name and the address are
// large, in Japanese when there is Japanese; under them ここまでお願いします
// (Please take me here.), the note, a map link and the booking link. A stay's optional photo comes
// first, as a stop's does on its ticket. Text from
// the Sheet goes in with textContent; a link only through safeHref.
//
// 運転手さんへ Show to driver: when the stay has a Japanese name or address,
// the card's one bold key opens the driver's screen (#driver), the little
// card a ryokan gives you for taxis: paper-white, Japanese only, the name and
// the address as large as fits the width (fitted, never cut; a long address
// wraps between words) and ここまでお願いします。. No telephone: the Sheet has
// none. Done, Escape and the scrim close it, back to the card; driver-open
// is on the phone while it is up, so the self-updater waits. The screen is
// kept awake while it is up where the phone allows (Wake Lock); a refusal is
// silent, and only a screen really kept awake says so. On a computer it
// opens in the Days pane. Closing the card closes it too.
//
// With a usable position (js/where.js) and the stay's coordinates, the card
// also says how far (up to 50 km): 現在地 2.4 km from here. Otherwise nothing
// is added. While the card is open it looks again every 15 seconds, so a
// distance from a position no longer usable is taken off.
//
// The booking (S2 鍵札, the key tag): Edit is always the last key under the
// note (onEdit(stayId): the app closes the card and opens Edit stay). When
// the stay has a booking (js/tickets.js stayMark: pictures, or the facts
// alone), the small key tag hangs beside its name (js/views/keytag.js), and
// under 運転手さんへ is 鍵札 Show booking (onBooking(stayId, button): the app
// holds the booking up, js/views/stub.js) with the night (by clock, in the
// trip's zone) and a line saying whether its pictures are on this phone.
// Without a booking the card is as it was, plus Edit.

import { safeHref, stayMapsUrl, stayDistance, nowIn, nightOf } from "../plan.js";
import { stayMark } from "../tickets.js";
import { tagSmall, nightsLong } from "./keytag.js";

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
  // The name and the English name, with the key tag hung beside them.
  const nm = el("div", "sy-nm");
  if (big) nm.append(el("div", "sy-name", big));
  if (jp && en) nm.append(el("div", "sy-en", en));
  if (tag) {
    const hang = el("div", "sy-hang");
    hang.append(tagSmall(stay.tkRef, tag.night));
    nm.append(hang);
  }
  if (nm.childElementCount) nodes.push(nm);
  const address = str(stay.addressJp);
  if (address) nodes.push(el("div", "sy-ad", address));
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
    const key = el("button", "kt-line");
    key.type = "button";
    const words = el("span");
    words.append(el("b", "", "鍵札"), "Show booking");
    key.append(words, el("i", "", nightsLong(tag.night) + " ›"));
    key.setAttribute("aria-label", "Show booking, " + nightsLong(tag.night).toLowerCase());
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

// The driver's screen for one stay: the top bar (for the person holding the
// phone), then the Japanese for the driver.
function driverCard(stay) {
  const top = el("div", "dc-top");
  const label = el("div");
  label.append(el("i", "", "宿泊"), el("span", "", str(stay.name) || str(stay.nameJp)));
  const done = el("button", "", "Done");
  done.type = "button";
  done.id = "driverDone";
  top.append(label, done);
  const mid = el("div", "dc-mid");
  mid.append(el("div", "dc-to", "運転手さんへ"));
  const jp = str(stay.nameJp);
  if (jp) mid.append(el("div", "dc-name", jp));
  const address = str(stay.addressJp);
  if (address) mid.append(el("div", "dc-ad", address));
  const ask = el("div", "dc-ask");
  ask.append("ここまで", el("br"), "お願いします。");
  mid.append(ask);
  const bot = el("div", "dc-bot", "Hold the phone up to the driver.");
  return { nodes: [top, mid, bot], done, bot };
}

// The big lines as large as fits: from the drawn size down, one pixel at a
// time, until no word runs past the line (they wrap only between words). A
// word too long even at the smallest size may then break anywhere.
const FIT = [
  [".dc-name", 46, 18],
  [".dc-ad", 30, 16],
  [".dc-ask", 30, 18],
];
function fitType(box) {
  for (const [sel, max, min] of FIT) {
    const n = box.querySelector(sel);
    if (!n) continue;
    n.style.overflowWrap = "";
    let size = max;
    n.style.fontSize = size + "px";
    while (size > min && n.scrollWidth > n.clientWidth + 0.5) {
      size -= 1;
      n.style.fontSize = size + "px";
    }
    if (n.scrollWidth > n.clientWidth + 0.5) n.style.overflowWrap = "anywhere";
  }
}

export function mountStayCard(root, store, { where = null, keep = null, clock = null, onEdit = () => {}, onBooking = () => {} } = {}) {
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

  // The driver's screen, over the card.
  const dScrim = el("div", "scrim");
  dScrim.id = "driverScrim";
  dScrim.hidden = true;
  const driver = el("div", "drvcard");
  driver.id = "driver";
  driver.setAttribute("role", "dialog");
  driver.setAttribute("aria-modal", "true");
  driver.setAttribute("aria-label", "Show to driver");
  driver.lang = "ja";
  driver.hidden = true;
  driver.inert = true;
  root.append(dScrim, driver);
  let driverSig = "";
  let lock = null; // the wake lock while one is held
  let wantLock = false;
  const driverOpen = () => driver.classList.contains("is-open");

  function holdAwake() {
    if (!wantLock || lock || document.visibilityState === "hidden") return;
    let req;
    try {
      req = navigator.wakeLock && typeof navigator.wakeLock.request === "function" ? navigator.wakeLock.request("screen") : null;
    } catch {
      req = null;
    }
    if (!req) return;
    Promise.resolve(req).then((l) => {
      if (!l) return;
      if (!wantLock) {
        Promise.resolve(l.release()).catch(() => {});
        return;
      }
      lock = l;
      if (typeof l.addEventListener === "function") l.addEventListener("release", () => {
        if (lock === l) lock = null;
        sayAwake();
      });
      sayAwake();
    }, () => {});
  }
  function letGo() {
    wantLock = false;
    const l = lock;
    lock = null;
    if (l) {
      try {
        Promise.resolve(l.release()).catch(() => {});
      } catch {
        // already gone
      }
    }
  }
  // The foot says the screen stays on only while it really does.
  let foot = null;
  function sayAwake() {
    if (!foot) return;
    const words = "Hold the phone up to the driver." + (lock && driverOpen() ? " It stays on while this is open." : "");
    if (foot.textContent !== words) foot.textContent = words;
  }
  // Coming back on screen: the phone let go of the lock while hidden.
  document.addEventListener("visibilitychange", holdAwake);

  function drawDriver(stay) {
    const sig = JSON.stringify([stay.name, stay.nameJp, stay.addressJp]);
    if (sig === driverSig) return;
    driverSig = sig;
    const d = driverCard(stay);
    foot = d.bot;
    driver.replaceChildren(...d.nodes);
    d.done.addEventListener("click", () => closeDriver());
    sayAwake();
    fit();
  }
  function fit() {
    if (!driverOpen()) return;
    fitType(driver);
    driver.dataset.fit = "1";
  }
  if (typeof ResizeObserver === "function") {
    let w = 0;
    new ResizeObserver(() => {
      if (driver.clientWidth === w) return;
      w = driver.clientWidth;
      fit();
    }).observe(driver);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit, () => {});

  function openDriver() {
    const stay = current();
    if (!stay || driverOpen()) return;
    driverSig = "";
    driver.hidden = false;
    driver.inert = false;
    dScrim.hidden = false;
    driver.classList.add("is-open");
    root.classList.add("driver-open");
    sheet.inert = true;
    drawDriver(stay);
    driver.scrollTop = 0;
    wantLock = true;
    holdAwake();
    const d = driver.querySelector("#driverDone");
    if (d) d.focus({ preventScroll: true });
  }
  // restoreFocus: back to the card's key.
  function closeDriver(restoreFocus = true) {
    if (!driverOpen()) return;
    letGo();
    driver.classList.remove("is-open");
    driver.hidden = true;
    driver.inert = true;
    dScrim.hidden = true;
    delete driver.dataset.fit;
    root.classList.remove("driver-open");
    if (driver.contains(document.activeElement)) document.activeElement.blur();
    sheet.inert = !isOpen();
    if (restoreFocus && isOpen()) {
      const key = sheet.querySelector(".drv");
      if (key) key.focus({ preventScroll: true });
    }
  }
  dScrim.addEventListener("click", () => closeDriver());
  body.addEventListener("click", (ev) => {
    if (ev.target.closest(".drv")) openDriver();
    else if (ev.target.closest(".r-edit") && stayId) onEdit(stayId);
    else if (ev.target.closest(".kt-line") && stayId) onBooking(stayId, ev.target.closest(".kt-line"));
  });
  // Escape closes the driver's screen first (the card stays).
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !driverOpen()) return;
    ev.stopPropagation();
    closeDriver();
  }, true);

  const current = () => (store.state.stays || []).find((s) => s && s.id === stayId && !s.deleted) || null;
  const isOpen = () => sheet.classList.contains("is-open");
  // The key tag: { mark, night } when the stay has a booking (pictures or
  // facts), else null. The night by the trip's clock, in its zone.
  function tagOf(stay) {
    const s = store.state;
    const mark = s.ticketsReady === false ? null : stayMark(stay, s.tickets, (id) => !!keep && keep.have(id));
    if (!mark) return null;
    const tz = (s.trip && s.trip.tz) || "Asia/Tokyo";
    const now = nowIn(tz, clock ? clock.now() : Date.now());
    return { mark, night: nightOf(stay, { today: now.date, minutes: now.minutes }) };
  }

  function render() {
    // The trip was taken off this phone: the card closes and nothing of it stays drawn.
    if (store.state.status === "nokey") {
      close(false);
      body.replaceChildren();
      driver.replaceChildren();
      shown = "";
      driverSig = "";
      foot = null;
      return;
    }
    if (!isOpen()) return;
    const stay = current();
    if (!stay) {
      close(false);
      return;
    }
    if (driverOpen()) {
      if (str(stay.nameJp) || str(stay.addressJp)) drawDriver(stay);
      else closeDriver(false);
    }
    const far = where ? stayDistance(stay, where.current()) : "";
    const tag = tagOf(stay);
    // The pictures, whether each is on this phone, and the night redraw it too.
    const pics = (store.state.tickets || []).filter((t) => t && t.stay === stay.id && !t.gone).map((t) => [t.id, !!keep && keep.have(t.id)]);
    const sig = JSON.stringify([stay, far, tag, pics]);
    if (sig === shown) return;
    shown = sig;
    // A key keeps focus across a redraw.
    const a = document.activeElement;
    const had = a && sheet.contains(a) ? [".drv", ".kt-line", ".r-edit"].find((c) => a.matches(c)) : null;
    body.classList.toggle("has-tag", !!tag);
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
    closeDriver(false);
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
