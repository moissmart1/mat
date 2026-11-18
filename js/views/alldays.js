/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The shape of the trip: a sheet listing every day, opened from the day
// counter on Days. Each day is a stub of its ticket: the day number, the
// date, the city, the day's title, and "today" or "used".
//
// mountAllDays(root, store, { clock, onPick(index) })
//   -> { open(), close(restoreFocus), isOpen() }
// root is the phone. clock: the trip's clock (js/clock.js); today and used are
// judged by it in the trip's time zone, each time the sheet opens and on every
// store change while it is open. The rows are rebuilt only when what they
// print changed (a sync with nothing new leaves them, and a tap or a screen
// reader on them, alone). Tapping a day closes the sheet and calls
// onPick with that day's index. Text from the Sheet goes in with textContent.

import { dayState, nowIn, header } from "../plan.js";
import { dayHead } from "../format.js";

const MARKUP = `
<div class="sheet-top"><span>All days</span><button type="button" id="allDaysDone">Done</button></div>
<div class="ad" id="allDaysList"></div>`;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const list = (v) => (Array.isArray(v) ? v : []);

function dayRow(day, i, state) {
  const h = header(day);
  const b = el("button", "ad-row");
  b.type = "button";
  b.dataset.i = String(i);
  if (h.colour) b.style.setProperty("--line", h.colour);
  if (state === "used") b.classList.add("is-used");
  if (state === "today") {
    b.classList.add("is-today");
    b.setAttribute("aria-current", "date");
  }
  const num = el("span", "num");
  num.append(el("small", "", "D"), " " + String(i + 1).padStart(2, "0"));
  const main = el("span", "ad-main");
  const top = el("span", "ad-top");
  top.append(el("b", "", dayHead(day.date).en));
  if (h.city) top.append(el("span", "ad-city", h.city));
  main.append(top);
  if (h.title) main.append(el("span", "ad-title", h.title));
  b.append(num, main);
  if (state === "today" || state === "used") b.append(el("i", "ad-st", state));
  return b;
}

export function mountAllDays(root, store, { clock, onPick = () => {} } = {}) {
  const scrim = el("div", "scrim");
  scrim.id = "allDaysScrim";
  scrim.hidden = true;
  const sheet = el("div", "sheet");
  sheet.id = "allDays";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "All days");
  sheet.inert = true;
  sheet.innerHTML = MARKUP;
  root.append(scrim, sheet);

  const rows = sheet.querySelector("#allDaysList");
  const done = sheet.querySelector("#allDaysDone");
  const isOpen = () => sheet.classList.contains("is-open");
  let shown = ""; // what the rows were last drawn from

  function draw() {
    const s = store.state;
    const days = list(s.days).filter((d) => d && typeof d.date === "string" && d.date);
    const tz = (s.trip && s.trip.tz) || "Asia/Tokyo";
    const today = nowIn(tz, clock.now()).date;
    // Everything a row prints: its number and date, city, title, colour, today/used.
    const sig = JSON.stringify(days.map((d) => {
      const h = header(d);
      return [d.date, h.city, h.title, h.colour, dayState(d.date, today)];
    }));
    if (sig === shown) return;
    shown = sig;
    const hadFocus = rows.contains(document.activeElement) ? document.activeElement.dataset.i : null;
    rows.replaceChildren(...days.map((d, i) => dayRow(d, i, dayState(d.date, today))));
    if (hadFocus !== null) {
      const again = rows.querySelector('.ad-row[data-i="' + hadFocus + '"]');
      if (again) again.focus({ preventScroll: true });
    }
  }

  function open() {
    draw();
    sheet.classList.add("is-open");
    sheet.inert = false;
    scrim.hidden = false;
    root.classList.add("days-open");
    sheet.scrollTop = 0;
    done.focus({ preventScroll: true });
  }

  // restoreFocus: give focus back to the day counter.
  function close(restoreFocus = true) {
    if (!isOpen()) return;
    sheet.classList.remove("is-open");
    sheet.inert = true;
    scrim.hidden = true;
    root.classList.remove("days-open");
    if (sheet.contains(document.activeElement)) document.activeElement.blur();
    if (restoreFocus === true) {
      const btn = document.getElementById("dayCount");
      if (btn && !btn.hidden) btn.focus({ preventScroll: true });
    }
  }

  done.addEventListener("click", () => close());
  scrim.addEventListener("click", () => close());
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") close();
  });
  rows.addEventListener("click", (ev) => {
    const b = ev.target.closest(".ad-row");
    if (!b) return;
    close();
    onPick(Number(b.dataset.i));
  });
  store.subscribe(() => {
    // The trip was taken off this phone: the sheet closes and its rows go.
    if (store.state.status === "nokey") {
      close(false);
      rows.replaceChildren();
      shown = "";
      return;
    }
    if (isOpen()) draw();
  });
  // A demo started or stopped changes today and which days are used.
  if (clock.subscribe) {
    clock.subscribe(() => {
      if (isOpen()) draw();
    });
  }

  return { open, close: (restoreFocus) => close(restoreFocus), isOpen };
}
