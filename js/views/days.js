/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The Days screen: a rail of day tickets (js/views/ticket.js), one per trip
// day, swiped with the browser's own scroll snapping; a counter ("Day 3 of
// 11", then "today", "used" or how long until that day) and a row of squares,
// one per day, filled for used days, that jump to a day.
//
// mountDays(root, store, { clock, where, onStop, onAddStop, onStay, onAllDays })
//   -> { goDay(index, smooth), day() }  (goDay is a deliberate jump)
// - clock: the trip's clock (js/clock.js). Every "now" here comes from
//   clock.now(), never Date.now(), and is judged in the trip's time zone.
// - where: the phone's position (js/where.js), or null. While its choice is
//   unset, today's ticket with a next stop asks once (.tk-ask): Use it asks
//   the phone, Not now turns it off for good (You can turn it on).
// - onAllDays(): the counter was tapped. onStay(stayId): a ticket's stay row
//   was tapped. onAddStop(date): a ticket's ＋ Add a stop was tapped.
//   onStop(stopId): an open stop's Edit was tapped.
// - tickets: { mark(stop, state), stayMark(stay, state), subscribe(fn) } (the
//   券 box and Show ticket, and a stay's booking on its 宿泊 line,
//   js/tickets.js), or null; onTicket(stopId, button): Show ticket was tapped.
// - held(): true while a sheet over Days is in use (the stop sheet): coming
//   back to the screen then does not move the rail (R32).
// - goDay(index, smooth): bring that day's ticket into view. day(): the date
//   of the ticket in view.
// It opens on today (js/plan.js openDayIndex).
//
// Redrawing while someone is reading: the store changes on every sync and
// the clock is asked again every 15 seconds while the screen is in use. Only
// a ticket whose drawing changed is touched, and in it only the parts that
// changed (a stop row that is the same is kept as it is), so the stop that
// is open, the row that has focus, a height change under way and the gate
// stamp all survive. The day in view stays in view.
//
// The open stop: today's next stop is open by default. Once a person opens
// or closes a stop by hand, that choice holds (the next stop no longer opens
// itself) until the day in view changes. The first stop open in a visit
// (by itself or by hand) shows the line under its Directions key that says
// Maps starts from where the phone is (.r-why); no other stop does.
//
// The next stop in view: when Days opens, when the rail makes a deliberate
// jump (to today on coming back a later day, the demo starting or stopping, a
// day picked from the list, a square, the arrow keys) and when a swipe comes
// to rest on today's ticket, today's open next stop is scrolled into view if
// it is not all on screen (clear of the strip and demo banner at the top and
// the tab bar at the bottom). On any change of the day in view, if the screen
// is scrolled down past the end of the new ticket (its top off screen, blank
// ground under it), it goes back to the top. Never
// on a minute tick, a sync or a redraw.

import { openDayIndex, dayState, daysToGo, tripNow, zoneOf, zoneWord, zoneClocks, eveBefore, stopsFor, nextStopId, header, dayTotalYen, stayShownFor, hereLine, nearStops, nightOf, NIGHT_ENDS_MIN } from "../plan.js";
import { issuer, dayShort, dayHead } from "../format.js";
import { ticketEl } from "./ticket.js";
import { summary as bookSummary, countText } from "../stampbook.js";
import { isPhone, isWide } from "../shape.js";
import { mountBoard } from "./board.js";
import { boardFor } from "../board.js";

const TICK_MS = 15000;
// While a demo runs, a trip minute passes every half second.
const DEMO_MS = 500;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const list = (v) => (Array.isArray(v) ? v : []);
const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// A row's markup as it was drawn (before it was opened or closed), to tell
// whether a redrawn row is the same as the one on screen.
const drawn = new WeakMap();

// A row's markup without the text (and the late colour) of its leave-by
// line, and without its distances (they move as the phone does).
const LEAD = /(<b class="r-lv)(?: is-late)?(">)[^<]*(<\/b>)/;
const DIST = /(<span class="dist">)[^<]*(<\/span>)/g;
// And without its 券 line and the words on Show ticket's right (whose it is,
// a picture reaching this phone, a person's picture changed: issue #83), so a
// row keeps its node, and Show ticket the focus the stub hands back to it.
const MARK = /<div class="r-fx tk-mark[^"]*">[\s\S]*?<\/div>/;
const TKI = /(<button class="r-tk"[^>]*>[\s\S]*?<i>)[^<]*(<\/i>)/;
const withoutLead = (html) => html.replace(LEAD, "$1$2$3").replace(DIST, "$1$2").replace(MARK, "").replace(TKI, "$1$2");

// Puts the fresh rows into `rows` in order, keeping each old row that is
// drawn the same. A row that differs only in its leave-by line's words (the
// next stop, every minute) or its distances from where you are keeps its
// node, and only those words change, so
// focus, its photo, a height change under way and a screen reader are left
// alone. Only rows that changed otherwise, or moved, are touched.
function patchRows(rows, fresh) {
  const old = new Map();
  for (const r of rows.children) if (r.dataset.id) old.set(r.dataset.id, r);
  const want = [...fresh.children].map((r) => {
    const keep = r.dataset.id ? old.get(r.dataset.id) : null;
    if (!keep) return r;
    const was = drawn.get(keep);
    const now = drawn.get(r);
    if (was === now) return keep;
    const lead = keep.querySelector(".r-lv");
    const next = r.querySelector(".r-lv");
    if (!!lead === !!next && withoutLead(was) === withoutLead(now)) {
      if (lead) {
        lead.textContent = next.textContent;
        if (lead.className !== next.className) lead.className = next.className;
      }
      const mk = keep.querySelector(".tk-mark");
      const nmk = r.querySelector(".tk-mark");
      if (mk && nmk && mk.outerHTML !== nmk.outerHTML) mk.replaceWith(nmk);
      const ti = keep.querySelector(".r-tk i");
      const nti = r.querySelector(".r-tk i");
      if (ti && nti && ti.textContent !== nti.textContent) ti.textContent = nti.textContent;
      const from = r.querySelectorAll(".dist");
      keep.querySelectorAll(".dist").forEach((d, i) => {
        if (from[i] && d.textContent !== from[i].textContent) d.textContent = from[i].textContent;
      });
      drawn.set(keep, now);
      return keep;
    }
    return r;
  });
  want.forEach((node, i) => {
    const at = rows.children[i];
    if (at !== node) rows.insertBefore(node, at || null);
  });
  while (rows.children.length > want.length) rows.lastElementChild.remove();
}

// The 前夜 strip: its heading replaced when it changed, its rows patched as
// the ticket's own are.
function patchEve(old, fresh) {
  const h = old.querySelector(".eve-h");
  const nh = fresh.querySelector(".eve-h");
  if (h && nh && h.outerHTML !== nh.outerHTML) h.replaceWith(nh);
  const rows = old.querySelector(".rows");
  const nr = fresh.querySelector(".rows");
  if (rows && nr) patchRows(rows, nr);
  // The strip's 宿泊 row: replaced when it changed, added when new, gone when gone.
  const st = old.querySelector(":scope > .tk-stay");
  const ns = fresh.querySelector(":scope > .tk-stay");
  if (st && ns) {
    if (st.outerHTML !== ns.outerHTML) st.replaceWith(ns);
  } else if (ns) old.append(ns);
  else if (st) st.remove();
}

// A head that differs only in its two clocks (T1, every minute): only the
// clocks change, as a leave-by line does, so the rest of the head (the gate
// stamp, the stamp line, focus) is left alone. Returns whether it did so.
function onlyClocks(head, fresh) {
  const zs = head.querySelector(":scope > .zs");
  const nz = fresh.querySelector(":scope > .zs");
  if (!zs || !nz) return false;
  const bare = (n) => {
    const c = n.cloneNode(true);
    const z = c.querySelector(":scope > .zs");
    if (z) z.remove();
    return c.outerHTML;
  };
  if (bare(head) !== bare(fresh)) return false;
  if (zs.outerHTML !== nz.outerHTML) zs.replaceWith(nz);
  return true;
}

// Brings the ticket on screen (`old`) in line with a freshly drawn one,
// part by part. Returns the ticket now on screen.
function patchTicket(old, fresh) {
  const a = [...old.children];
  const b = [...fresh.children];
  const sameShape = a.length === b.length && a.every((n, i) => n.className === b[i].className && n.tagName === b[i].tagName);
  if (!sameShape) {
    old.replaceWith(fresh);
    return fresh;
  }
  if (old.getAttribute("style") !== fresh.getAttribute("style")) {
    const style = fresh.getAttribute("style");
    if (style === null) old.removeAttribute("style");
    else old.setAttribute("style", style);
  }
  a.forEach((n, i) => {
    if (n.classList.contains("rows")) patchRows(n, b[i]);
    else if (n.classList.contains("eve")) patchEve(n, b[i]);
    else if (n.outerHTML !== b[i].outerHTML && !onlyClocks(n, b[i])) n.replaceWith(b[i]);
  });
  return old;
}

export function mountDays(root, store, { clock, where = null, storage = null, ready = null, onAllDays = () => {}, onStay = () => {}, onStop = () => {}, onAddStop = () => {}, onStampBook = () => {}, held = () => false, tickets = null, onTicket = () => {} } = {}) {
  const count = el("button", "bar-t");
  count.type = "button";
  count.id = "dayCount";
  const pager = el("div", "pager");
  pager.id = "pager";
  // The stamp book's way in: a small ring and how many stamps this person has.
  // Only while the book has stamps (the Sheet's definitions); see showStamps.
  const stampBtn = el("button", "bar-stamp");
  stampBtn.type = "button";
  stampBtn.id = "stampBtn";
  stampBtn.hidden = true;
  const stampN = el("span", "bar-stamp-n");
  stampBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle class="d" cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="4.2"/></svg>';
  stampBtn.append(stampN);
  const left = el("div", "bar-l");
  left.append(count, stampBtn);
  const bar = el("div", "bar");
  bar.append(left, pager);
  const rail = el("div", "rail");
  rail.id = "rail";
  // The demo banner: plain ground and text, above the bar, only while a demo
  // runs. Stop is local (the clock forgets the demo), so it works with no signal.
  const demo = el("div", "demo");
  demo.id = "demo";
  const demoText = el("span", "demo-t");
  const demoTime = el("b", "demo-time");
  const demoStop = el("button", "demo-stop", "Stop");
  demoStop.type = "button";
  demoStop.id = "demoStop";
  demo.append(demoText, demoStop);
  demo.hidden = true;
  demoStop.addEventListener("click", () => clock.stop());
  // The departure board (js/views/board.js): between the top line and the rail.
  // The line "This phone" (js/views/ready.js, issue 84) right after it: the
  // board's foot when the board shows, alone in the same glass when not.
  const board = mountBoard({ storage, onToggle: (on) => joinFoot(on) });
  function joinFoot(on = board.isShown()) {
    if (!ready) return;
    // The line's place counts while it is being decided too (js/views/ready.js is-pending).
    board.foot(on && !ready.el.hidden);
    ready.el.classList.toggle("is-alone", !on);
  }
  root.replaceChildren(demo, bar, board.el, ...(ready ? [ready.el] : []), rail);

  let dates = []; // the dates of the drawn tickets, in order
  let states = []; // each one's dayState
  let ahead = []; // before the trip: days until each one, else 0
  const sigs = new Map(); // date -> what its ticket was drawn from
  let cur = -1; // the index of the day in view
  let opened = false; // has it been put on today yet
  let seen = null; // { date, minutes } in the trip's zone when last drawn
  let autoId = null; // today's next stop: open unless a person chose
  let chosen = false; // a person has opened or closed a stop by hand
  let openId = null; // the stop they left open, or null
  let whyId = null; // the first stop open in this visit: it carries the directions line

  const step = () => {
    const pg = rail.firstElementChild;
    if (!pg) return 1;
    const gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
    return pg.offsetWidth + gap || 1;
  };
  const clamp = (i) => Math.max(0, Math.min(dates.length - 1, i));

  // Where an element is in the Days view's own scrolled content (transforms,
  // such as a ticket's tilt, are left out).
  function offsetIn(n) {
    let y = 0;
    while (n && n !== root) {
      y += n.offsetTop;
      n = n.offsetParent;
    }
    return y;
  }

  // The part of the Days view a row can be read in, in the same terms: below
  // the status bar and no-signal strip (the view's top padding) and the demo
  // banner, above the tab bar and the next ticket's slot (js/views/nextticket.js).
  function readable() {
    const pad = parseFloat(getComputedStyle(root).paddingTop) || 0;
    const banner = demo.hidden ? 0 : demo.offsetHeight;
    const nav = document.getElementById("nav");
    const box = root.getBoundingClientRect();
    // Held sideways the bar is a rail beside the view, not over its foot.
    const bar = nav && nav.offsetHeight ? nav.getBoundingClientRect() : null;
    const slot = document.getElementById("nextTicket");
    const st = slot && !slot.hidden && slot.offsetHeight ? slot.getBoundingClientRect() : null;
    const over = (r) => (r && r.left < box.right && r.right > box.left ? Math.max(0, box.bottom - r.top) : 0);
    const under = Math.max(over(bar), over(st));
    const top = root.scrollTop + pad + banner + 8;
    return { top, bottom: Math.max(top, root.scrollTop + root.clientHeight - under - 8) };
  }

  // Today's open next stop, all of it on screen if it is not (its full open
  // height, even while it is still sliding open).
  function revealNext() {
    if (cur < 0 || !autoId || (chosen && openId !== autoId)) return;
    const pg = rail.children[cur];
    const r = pg ? pg.querySelector('.r[data-id="' + CSS.escape(autoId) + '"]') : null;
    if (!r) return;
    const inner = r.querySelector(".r-more > div");
    const y = offsetIn(r);
    const h = r.offsetHeight + (inner ? Math.max(0, inner.scrollHeight - inner.clientHeight) : 0);
    const w = readable();
    let by = 0;
    if (y + h > w.bottom) by = y + h - w.bottom;
    if (y - by < w.top) by = y - w.top;
    if (by) root.scrollTop += by;
  }

  // Scrolled down past the end of the ticket in view (blank ground below
  // it, its top off screen above): back to the top, so the ticket shows.
  function unblank() {
    const pg = rail.children[cur];
    const tk = pg ? pg.firstElementChild : null;
    if (!tk) return;
    const w = readable();
    const top = offsetIn(tk);
    if (w.top > top && w.bottom > top + tk.offsetHeight) root.scrollTop = 0;
  }

  // The day in view is settled (a jump, or a swipe at rest).
  let settledOn = -1;
  function settle() {
    settledOn = cur;
    unblank();
    revealNext();
  }

  // A deliberate jump to a day.
  let aim = null; // the day a smooth jump is gliding to, until the strip comes to rest
  function jump(index, smooth = false) {
    if (!dates.length) return;
    goDay(index, smooth);
    aim = smooth && !calm() ? cur : null;
    settle();
  }

  function applyOpen() {
    const id = chosen ? openId : autoId;
    if (id && !whyId) whyId = id;
    for (const r of rail.querySelectorAll(".r[data-id]")) {
      const on = r.dataset.id === id;
      if (r.classList.contains("is-open") !== on) r.classList.toggle("is-open", on);
      const b = r.querySelector(".r-b");
      if (b) b.setAttribute("aria-expanded", String(on));
      const more = r.querySelector(".r-more");
      if (more) more.inert = !on;
      const why = r.querySelector(".r-why");
      if (why && why.hidden !== (r.dataset.id !== whyId)) why.hidden = r.dataset.id !== whyId;
    }
  }

  // The day in view changed: a choice made by hand no longer holds.
  function setCur(i) {
    if (i === cur) return;
    cur = i;
    if (chosen) {
      chosen = false;
      openId = null;
      applyOpen();
    }
  }

  function showDay() {
    const word = !dates.length ? "" : states[cur] === "today" ? "today" : states[cur] === "used" ? "used" : ahead[cur] === 1 ? "tomorrow" : ahead[cur] > 1 ? "in " + ahead[cur] + " days" : "";
    const parts = [];
    if (dates.length) parts.push(el("span", "", "Day " + (cur + 1) + " of " + dates.length));
    if (word) parts.push(" ", el("i", "", word));
    count.replaceChildren(...parts);
    count.hidden = !dates.length;
    rail.querySelectorAll(".pg[data-date]").forEach(page => {
      page.classList.toggle("is-neighbor", page.dataset.date === dates[cur - 1] || page.dataset.date === dates[cur + 1]);
    });
    pager.querySelectorAll(".sq").forEach((b, i) => {
      b.classList.toggle("is-cur", i === cur);
      b.classList.toggle("is-done", states[i] === "used");
      if (i === cur) b.setAttribute("aria-current", "date");
      else b.removeAttribute("aria-current");
    });
  }

  function goDay(index, smooth = false) {
    if (!dates.length) return;
    setCur(clamp(index));
    showDay();
    rail.scrollTo({ left: cur * step(), behavior: smooth && !calm() ? "smooth" : "auto" });
  }

  // The day in view is kept when the strip changes width (crossing into or
  // out of the two panes): the scroll position is in pixels, so it would land
  // on a neighbouring day. A phone turned sideways already keeps its day, so
  // a change from one phone shape to the other is left alone.
  let knownW = 0;
  let knownPhone = isPhone();
  const resizing = () => knownW > 0 && rail.clientWidth !== knownW && !(knownPhone && isPhone());
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => {
      const w = rail.clientWidth;
      if (w === knownW) return;
      const was = knownW;
      const wasPhone = knownPhone;
      knownW = w;
      knownPhone = isPhone();
      if (!was || !w || !dates.length || (wasPhone && knownPhone)) return;
      rail.scrollTo({ left: cur * step(), behavior: "auto" });
    }).observe(rail);
  }

  // The day in view follows the rail as it is swiped.
  rail.addEventListener("scroll", () => {
    if (!dates.length || resizing()) return;
    const i = clamp(Math.round(rail.scrollLeft / step()));
    if (i !== cur) {
      setCur(i);
      showDay();
    }
    if (!("onscrollend" in rail)) {
      clearTimeout(restTimer);
      restTimer = setTimeout(atRest, 150);
    }
  }, { passive: true });
  // A swipe has come to rest on another day.
  let restTimer = null;
  const atRest = () => {
    aim = null;
    if (dates.length && cur !== settledOn) settle();
  };
  rail.addEventListener("scrollend", atRest);
  pager.addEventListener("click", (ev) => {
    const b = ev.target.closest(".sq");
    if (b) jump(Number(b.dataset.i), true);
  });
  count.addEventListener("click", () => onAllDays());
  stampBtn.addEventListener("click", () => onStampBook());
  root.addEventListener("keydown", (ev) => {
    if (ev.target.closest("input, textarea, select")) return;
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.classList.contains("r-b")) {
      ev.preventDefault();
      toggle(ev.target.closest(".r"));
      return;
    }
    arrow(ev);
  });
  // The arrow keys move the days.
  function arrow(ev) {
    // Not on a phone: from the day the strip is gliding to, so two quick presses move two days.
    const from = aim === null || isPhone() ? cur : aim;
    if (ev.key === "ArrowRight") jump(from + 1, true);
    if (ev.key === "ArrowLeft") jump(from - 1, true);
  }
  // On a computer they also work with nothing focused (focus on the page
  // itself), so a person does not have to click into Days first. Never while
  // a field, the register or a sheet is in use, nor while Before covers the
  // ticket's pane.
  document.addEventListener("keydown", (ev) => {
    if (ev.target !== document.body && ev.target !== document.documentElement) return;
    if (!isWide() || ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
    if (!root.classList.contains("is-active")) return;
    const phone = root.closest(".phone");
    if (phone && /(^|\s)[a-z]+-open(\s|$)/.test(phone.className)) return;
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return; // Tab and the rest are the browser's
    ev.preventDefault(); // its own arrow scrolling would move the strip a second time
    arrow(ev);
  });

  // Opening a stop closes the one that was open; tapping the open one closes it.
  function toggle(r) {
    if (!r || !r.dataset.id) return;
    const was = chosen ? openId : autoId;
    chosen = true;
    openId = was === r.dataset.id ? null : r.dataset.id;
    applyOpen();
  }
  // A mouse press on a neighboring control must not focus it and scroll
  // the strip before the click has a chance to select its day.
  // The day a jump is gliding to is never a neighbor: until the strip is half
  // way there, the scroll above puts cur back on the day it left, which marks
  // the chosen day a neighbor again, and a click on its stay row or a stop
  // only selected the day it was already going to (CI 2026-11-27, stay.e2e).
  const neighborPaper = (ev) => {
    const paper = ev.target.closest(".pg.is-neighbor .tk");
    return paper && !(aim !== null && paper.closest(".pg").dataset.date === dates[aim]) ? paper : null;
  };
  rail.addEventListener("pointerdown", (ev) => {
    if (ev.button === 0 && ev.pointerType === "mouse" && neighborPaper(ev)) ev.preventDefault();
  });
  rail.addEventListener("click", (ev) => {
    // Older browsers deliver clicks as MouseEvents, without a pointer type.
    const mouse = ev.detail > 0 && (ev.pointerType ? ev.pointerType === "mouse" : matchMedia("(hover: hover) and (pointer: fine)").matches);
    const paper = mouse && neighborPaper(ev);
    if (paper) {
      ev.preventDefault();
      jump(dates.indexOf(paper.closest(".pg").dataset.date), true);
      return;
    }
    if (where && ev.target.closest(".tk-ask .yes")) {
      where.ask();
      return;
    }
    if (where && ev.target.closest(".tk-ask .no")) {
      where.turnOff();
      return;
    }
    if (ev.target.closest(".tk-stampline")) {
      onStampBook();
      return;
    }
    const stay = ev.target.closest(".tk-stay");
    if (stay) {
      onStay(stay.dataset.stay);
      return;
    }
    const add = ev.target.closest(".tk-add");
    if (add) {
      onAddStop(add.dataset.date);
      return;
    }
    const show = ev.target.closest(".r-tk");
    if (show) {
      const r = show.closest(".r[data-id]");
      if (r) onTicket(r.dataset.id, show);
      return;
    }
    const edit = ev.target.closest(".r-edit");
    if (edit) {
      const r = edit.closest(".r[data-id]");
      if (r) onStop(r.dataset.id);
      return;
    }
    if (ev.target.closest("a, button")) return;
    toggle(ev.target.closest(".r[data-id]"));
  });

  function drawPager() {
    pager.replaceChildren(...dates.map((date, i) => {
      const b = el("button", "sq");
      b.type = "button";
      b.dataset.i = String(i);
      b.setAttribute("aria-label", dayShort(date));
      return b;
    }));
  }

  // Where focus is in the rail, to put it back if a redraw took it away.
  function focusSpot() {
    const a = document.activeElement;
    if (!a || !rail.contains(a)) return null;
    const r = a.closest(".r[data-id]");
    // A ticket's own buttons, found again by their day.
    const own = ["tk-stay", "tk-add"].find((c) => a.classList.contains(c));
    const pg = own ? a.closest(".pg") : null;
    return { node: a, id: r ? r.dataset.id : null, cls: a.className, on: pg ? pg.dataset.date : null, own, stay: own === "tk-stay" ? a.dataset.stay : null, inEve: !!a.closest(".eve") };
  }
  function restoreFocus(spot) {
    if (!spot || document.activeElement === spot.node) return;
    let target = spot.node.isConnected ? spot.node : null;
    if (!target && spot.id) {
      const r = rail.querySelector('.r[data-id="' + CSS.escape(spot.id) + '"]');
      target = r && ((spot.cls && r.getElementsByClassName(spot.cls.split(" ")[0])[0]) || r.querySelector(".r-b"));
    }
    if (!target && spot.on) {
      const pg = rail.querySelector('.pg[data-date="' + CSS.escape(spot.on) + '"]');
      // A ticket can hold two stay rows (the strip's and its own): the same one.
      if (pg && spot.stay) target = [...pg.querySelectorAll(".tk-stay")].find((x) => x.dataset.stay === spot.stay && !!x.closest(".eve") === spot.inEve);
      if (!target && pg) target = pg.querySelector("." + spot.own);
    }
    if (target) target.focus({ preventScroll: true });
  }

  // "Pretending it’s Sat Dec 12, 07:00", the demo's day and trip-zone time.
  function showDemo() {
    const date = clock.demoDay();
    demo.hidden = !date;
    if (!date) return;
    const m = tripNow(store.state, clock.now()).minutes;
    const hhmm = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
    // The time is kept with the date: it never wraps onto a line alone.
    const head = "Pretending it’s " + dayHead(date, []).en + ", ";
    if (demoText.firstChild && demoText.firstChild.textContent === head && demoTime.textContent === hhmm) return;
    demoTime.textContent = hhmm;
    demoText.replaceChildren(head, demoTime);
  }

  // The stamp button and its count; the date of today's open stamp for the ticket's line.
  function showStamps(s) {
    // The real time (never the demo's), and the Days clock's day at it.
    const real = Date.now();
    const b = bookSummary(s, real, tripNow(s, real).date);
    const on = s.status === "ready" && b.total > 0;
    stampBtn.hidden = !on;
    bar.classList.toggle("has-stamp", on);
    if (on) {
      const text = countText(b.n, b.total);
      stampN.textContent = b.n + "/" + b.total;
      stampBtn.setAttribute("aria-label", "Stamp book, " + text);
    }
    return on ? b.openToday : "";
  }

  // The trip was taken off this phone (a refused key, Forget this phone: the
  // store says status "nokey"): nothing of it stays in the page. Merely
  // loading or offline is not this: those keep what is drawn.
  function wipe() {
    board.clear();
    if (ready) ready.update(true);
    joinFoot();
    dates = [];
    states = [];
    ahead = [];
    sigs.clear();
    cur = -1;
    opened = false;
    seen = null;
    autoId = null;
    openId = null;
    chosen = false;
    rail.replaceChildren();
    pager.replaceChildren();
    count.replaceChildren();
    count.hidden = true;
    stampBtn.hidden = true;
    stampN.textContent = "";
    bar.classList.remove("has-stamp");
    stampBtn.removeAttribute("aria-label");
  }

  function render(s) {
    showDemo();
    if (s.status === "nokey") {
      wipe();
      return;
    }
    const stampToday = showStamps(s);
    const ok = s.status === "ready" && s.trip && s.trip.start && list(s.days).length;
    if (ready) ready.update(true);
    if (!ok) {
      board.update(null);
      joinFoot();
      if (!dates.length) {
        count.hidden = true;
        rail.replaceChildren();
        pager.replaceChildren();
      }
      return;
    }
    const days = list(s.days).filter((d) => d && typeof d.date === "string" && d.date);
    const tz = s.trip.tz || "Asia/Tokyo";
    const nowMs = clock.now();
    // The Days clock: on a day in its own zone, that place's date and time.
    const now = tripNow(s, nowMs);
    seen = now;
    const toGo = daysToGo({ ...s.trip, tz }, nowMs, now.date);
    const mark = issuer(list(s.people));
    // A row typed into the Sheet by hand may be blank or have no id.
    const stops = list(s.stops).filter((x) => x && typeof x.id === "string" && x.id && typeof x.date === "string");
    const stays = list(s.stays).filter((x) => x && typeof x === "object");
    const expenses = list(s.expenses).filter((x) => x && typeof x === "object");
    const inView = cur >= 0 ? dates[cur] : null;
    const home = zoneOf(s.trip, null);
    // Where the phone is, when usable (js/where.js): memory only.
    const here = where ? where.current() : null;
    // Closed until the Days clock's next day; during a demo, the real one's.
    // From two days before, a phone not ready for no signal takes the board's face (issue 84, section 5).
    const rm = ready ? ready.model() : null;
    const face = rm && rm.big ? { kind: "ready", small: "出発まで", big: String(rm.toGo), unit: "日", l1: rm.big.l1, l2: rm.big.l2, red: true, open: true } : null;
    board.update(face || boardFor(s, nowMs, here), clock.demoDay() ? tripNow(s, Date.now()).date : now.date);
    joinFoot();
    const left = rail.scrollLeft;
    const spot = focusSpot();

    const sameDays = days.length === dates.length && days.every((d, i) => d.date === dates[i]);
    if (!sameDays) {
      dates = days.map((d) => d.date);
      sigs.clear();
      rail.replaceChildren(...dates.map((date) => {
        const pg = el("div", "pg");
        pg.dataset.date = date;
        return pg;
      }));
      drawPager();
    }
    states = days.map((d) => dayState(d.date, now.date));
    ahead = days.map((d) => (toGo > 0 ? daysToGo({ start: d.date, tz }, nowMs, now.date) : 0));

    autoId = null;
    days.forEach((day, i) => {
      const state = states[i];
      const dayStops = stopsFor(stops, day.date);
      const nextId = state === "today" ? nextStopId(dayStops, now.minutes) : null;
      if (nextId) autoId = nextId;
      const model = {
        day,
        number: i + 1,
        count: days.length,
        state,
        header: header(day),
        stops: dayStops,
        stays,
        total: dayTotalYen(expenses, day.date),
        mark,
        // Before 04:00, today's ticket shows last night's stay (R37).
        stay: stayShownFor(stays, day.date, { today: now.date, minutes: now.minutes }),
        nextId,
        // Only today's ticket changes with the minute; only Day 1 counts down.
        minutes: state === "today" ? now.minutes : null,
        toGo: i === 0 ? toGo : 0,
        tripName: s.trip.name,
        // Today's stamp is open and not yet pressed: the ticket says so.
        stampOpen: stampToday === day.date,
      };
      // A day in its own zone (T1 現地時刻): its word, and the two clocks while it is today.
      const zone = zoneOf(s.trip, day);
      model.zone = zone === home ? null : { word: zoneWord(zone), clocks: state === "today" ? zoneClocks(s, nowMs, zone) : null };
      // 前夜: the evening before this day, with its stops, judged by its own day.
      const eve = eveBefore(s.eves, day.date);
      const eveStops = eve ? stopsFor(stops, eve.date) : [];
      if (eveStops.length) {
        const eveState = dayState(eve.date, now.date);
        const eveNext = eveState === "today" ? nextStopId(eveStops, now.minutes) : null;
        if (eveNext) autoId = eveNext;
        model.eve = { date: eve.date, local: zoneOf(s.trip, eve) !== home, stops: eveStops, state: eveState, minutes: eveState === "today" ? now.minutes : null, nextId: eveNext };
        if (eveNext && here) {
          const hl = hereLine(eveStops.find((x) => x.id === eveNext), now.minutes, here);
          if (hl) model.eve.hereNext = hl;
        }
        // That night's stay ends the strip, as every ticket ends with its own (#93).
        const eveStay = stayShownFor(stays, eve.date);
        if (eveStay && typeof eveStay.id === "string" && eveStay.id) {
          model.eve.stay = eveStay;
          // Before 04:00 the day's own last row is this same stay (R37): never twice,
          // unless it really covers both nights.
          const own = stayShownFor(stays, day.date);
          if (model.stay && model.stay.id === eveStay.id && !(own && own.id === eveStay.id)) model.stay = null;
        }
      }
      // Leave by, from where you are: only with a usable position near the next stop.
      if (nextId && here) {
        const hl = hereLine(dayStops.find((x) => x.id === nextId), now.minutes, here);
        if (hl) model.hereNext = hl;
      }
      // A loose day: the open stops' distances and the nearest, order kept.
      if (state === "today" && here) {
        const near = nearStops(dayStops, here);
        if (Object.keys(near).length) model.near = near;
      }
      // The stops with a ticket: the 券 box and Show ticket. None, no key at all.
      if (tickets) {
        const tix = {};
        for (const st of model.eve ? eveStops.concat(dayStops) : dayStops) {
          const m = tickets.mark(st, s);
          if (m) tix[st.id] = m;
        }
        if (Object.keys(tix).length) model.tix = tix;
        // The night's stay with a booking: 券 and the key-tag chip on its line,
        // with that ticket's own night (today's, before 04:00, last night's).
        const m = model.stay && tickets.stayMark ? tickets.stayMark(model.stay, s) : null;
        if (m) model.stayTag = { ...m, ...nightOf(model.stay, { today: day.date, minutes: day.date === now.date ? now.minutes : NIGHT_ENDS_MIN }) };
        const em = model.eve && model.eve.stay && tickets.stayMark ? tickets.stayMark(model.eve.stay, s) : null;
        if (em) model.eve.stayTag = { ...em, ...nightOf(model.eve.stay, { today: model.eve.date, minutes: model.eve.state === "today" ? now.minutes : NIGHT_ENDS_MIN }) };
      }
      // Asked once, on today's ticket, the first time a day has a next stop.
      if (nextId && where && where.supported() && where.state() === "unset") model.ask = true;
      const sig = JSON.stringify(model);
      if (sigs.get(day.date) === sig) return;
      sigs.set(day.date, sig);
      const fresh = ticketEl(model);
      for (const r of fresh.querySelectorAll(".r[data-id]")) drawn.set(r, r.outerHTML);
      const pg = rail.children[i];
      const old = pg.firstElementChild;
      if (old) patchTicket(old, fresh);
      else pg.append(fresh);
    });
    applyOpen();
    restoreFocus(spot);

    if (!opened) {
      opened = true;
      // Put on today while Days is not the screen showing (the app opened on
      // Money, or in the background): Days counts as last seen today, so
      // coming to it on a later day moves the rail on (R32).
      if (!timer) leftOn = now.date;
      jump(openDayIndex({ ...s.trip, tz }, days, nowMs, now.date));
      return;
    }
    // Keep the day in view where it was, without animation.
    const keep = inView ? dates.indexOf(inView) : -1;
    if (!sameDays) goDay(keep >= 0 ? keep : cur);
    else {
      if (rail.scrollLeft !== left) rail.scrollLeft = left;
      showDay();
    }
  }

  const tzOf = (s) => s.trip.tz || "Asia/Tokyo";
  const tripReady = (s) => s.status === "ready" && s.trip && s.trip.start;

  // Ask the clock again: redraw when the trip zone's minute or day moved on.
  function tick() {
    showDemo();
    if (timer && period() !== running) retime();
    const s = store.state;
    if (!tripReady(s)) return;
    const now = tripNow(s, clock.now());
    if (!seen || now.date !== seen.date || now.minutes !== seen.minutes) render(s);
  }

  // The clock is asked only while the app is on screen and Days is the
  // screen showing; at once when either comes back. Coming back on a later
  // trip day than Days was last seen on, the rail moves to today's ticket
  // (R32); it never moves while the screen is being looked at.
  let timer = null;
  // Fast only while a demo runs; at its end of day it stands still.
  const period = () => (clock.demoDay() && !clock.holding() ? DEMO_MS : TICK_MS);
  let running = TICK_MS; // the period the timer was set with
  function retime() {
    if (!timer) return;
    clearInterval(timer);
    running = period();
    timer = setInterval(tick, running);
  }
  let leftOn = null; // the trip-zone date when Days was last on screen
  function wake() {
    const live = document.visibilityState !== "hidden" && root.classList.contains("is-active");
    const s = store.state;
    if (live && !timer) {
      running = period();
      timer = setInterval(tick, running);
      tick();
      const back = leftOn;
      leftOn = null;
      // A sheet over Days still in use counts as being looked at.
      if (back && tripReady(s) && dates.length && !held()) {
        const nowMs = clock.now();
        const today = tripNow(s, nowMs).date;
        if (today > back) jump(openDayIndex({ ...s.trip, tz: tzOf(s) }, dates.map((date) => ({ date })), nowMs, today));
      }
    } else if (!live && timer) {
      clearInterval(timer);
      timer = null;
      leftOn = tripReady(s) ? tripNow(s, clock.now()).date : null;
    }
  }
  document.addEventListener("visibilitychange", wake);
  new MutationObserver(wake).observe(root, { attributes: true, attributeFilter: ["class"] });
  // The next ticket's slot comes up over the foot of the day (its tickets
  // arrive after the day is drawn): today's next stop is brought clear of it.
  const phoneEl = root.closest(".phone");
  if (phoneEl) {
    let slotWas = phoneEl.classList.contains("has-slot");
    new MutationObserver(() => {
      const on = phoneEl.classList.contains("has-slot");
      if (on === slotWas) return;
      slotWas = on;
      // Never under something standing over the day (any sheet, the stub, the register, the book).
      const covered = !!phoneEl.querySelector(".sheet.is-open") || /(^|\s)[a-z]+-open(\s|$)/.test(phoneEl.className);
      if (on && root.classList.contains("is-active") && dates.length && settledOn === cur && !held() && !covered) revealNext();
    }).observe(phoneEl, { attributes: true, attributeFilter: ["class"] });
  }

  render(store.state);
  store.subscribe(render);
  // What the line says changed (a picture kept, signal, a pass): the board may give or take back its face.
  if (ready) ready.subscribe(() => render(store.state));
  if (where) where.subscribe(() => render(store.state));
  // A picture reaching this phone turns its 券 box solid.
  if (tickets && tickets.subscribe) tickets.subscribe(() => render(store.state));
  // Starting or stopping a demo is a deliberate jump: the rail goes to the
  // day the clock now says is today, whatever R32 would otherwise hold.
  let demoWas = clock.demoDay();
  if (clock.subscribe) {
    clock.subscribe(() => {
      const now = clock.demoDay();
      retime();
      render(store.state);
      if (now === demoWas) return;
      demoWas = now;
      const s = store.state;
      if (tripReady(s) && dates.length) {
        const nowMs = clock.now();
        jump(openDayIndex({ ...s.trip, tz: tzOf(s) }, dates.map((date) => ({ date })), nowMs, tripNow(s, nowMs).date));
      }
    });
  }
  wake();

  return {
    goDay: jump,
    day: () => (cur >= 0 ? dates[cur] : null),
  };
}
