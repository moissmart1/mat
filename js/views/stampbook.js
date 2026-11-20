/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The stamp book: a page of twelve rings that each person presses by hand.
// A panel over the app like History: opened from the Days screen (the stamp
// button on its top bar, or the line on today's ticket), closed by Done, the
// scrim or Escape.
//
// mountStampBook(root, store, { now }) -> { open(), close(restoreFocus), isOpen() }
// - root is the phone. now() is the real time (the phone's clock; a press is
//   judged by it, so the demo clock is never used here).
// - A stamp is open, not yet open, closed or held: js/stampbook.js stateOf, in
//   Japan time whatever zone the phone is in. Tapping an open ring presses it
//   (store.pressStamp: shown at once, kept on the phone until the backend has
//   it); a held stamp is held up large; a ring that is not open says so in one
//   line under the page and shakes a little. Nothing is sent for those.
// - The landing is the app's own: the stamp's `hit`, the thud once the store
//   has taken the press, a small bump of the page and wet ink for half a
//   second. Under prefers-reduced-motion the stamp just appears.
// - Every name, place and person's name goes in with textContent; the
//   drawings come from bookStampSVG, which escapes its text.
// - 現地: pressed with a usable position within 15 km of that day's
//   coordinates (js/plan.js inPlace, js/where.js), the press carries here:
//   true and the stamp gets a small square vermilion chop on its corner;
//   held up it reads "pressed in <place>". No position, or elsewhere: no
//   mark and no comment. It never stops a press.
// - Redrawn only where something changed: a ring is replaced when its own
//   state or stamp did, so a press landing keeps its landing and a person
//   holding a stamp up is left alone.

import { bookStampSVG, countText, dayNumber, japanClock, japanDay, lockedLine, monthDay, spanText, stateOf, tiltOf, usableDefs, weekdayOf } from "../stampbook.js";
import { calm, wetInk } from "../fx.js";
import { thud, primeSound } from "../sound.js";
import { fillSeal } from "../picture.js";
import { inPlace, tripNow } from "../plan.js";

const RULE = "One stamp a day, pressed on the day, in the place.";
const STAMPED = "Stamped.";
const LOOK_BACK = "Tap to put it back";
// How often an open book asks again which stamps are open (the clock moves on).
const LOOK_MS = 20000;
// The landing's bump on the page, in ms.
const BUMP_MS = 220;
// A second tap this soon after a press is the same tap again, not a wish to hold the new stamp up.
const SETTLE_MS = 700;

const MARKUP = `
<div class="bk-top"><span class="bk-title"><i>スタンプ帳</i> Stamp book</span><span class="bk-n" id="bookN"></span><button type="button" id="bookDone">Done</button></div>
<div class="bk-scroll" id="bookScroll" tabindex="-1">
  <div class="bk-page" id="bookPage">
    <div class="bk-h"><b>MAT 記念スタンプ帳</b><span id="bookSpan"></span></div>
    <div class="bk-grid" id="bookGrid"></div>
  </div>
  <p class="bk-say" id="bookSay" role="status" aria-live="polite"></p>
  <p class="bk-rule">${RULE}</p>
  <div class="bk-today" id="bookToday">
    <div class="bk-th" id="bookTH"></div>
    <div class="bk-who" id="bookWho"></div>
  </div>
</div>`;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const list = (v) => (Array.isArray(v) ? v : []);
const isoMs = (iso) => Date.parse(iso);

// 現地: the second, small square chop pressed over a stamp's corner.
function chop() {
  const c = el("span", "chop");
  c.setAttribute("aria-hidden", "true");
  c.append(el("span", "", "現地"));
  return c;
}

export function mountStampBook(root, store, { now = () => Date.now(), where = null } = {}) {
  const scrim = el("div", "scrim");
  scrim.id = "bookScrim";
  scrim.hidden = true;
  const panel = el("div", "bk");
  panel.id = "book";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Stamp book");
  panel.inert = true;
  panel.innerHTML = MARKUP;
  root.append(scrim, panel);

  const $ = (id) => panel.querySelector("#" + id);
  const grid = $("bookGrid");
  const page = $("bookPage");
  const say = $("bookSay");
  const done = $("bookDone");
  const scroll = $("bookScroll");

  let opened = false;
  let hitId = null; // the ring whose stamp is landing right now (drawn once with its hit)
  let landed = { id: null, at: 0 }; // the last ring pressed, and when
  let held = null; // the def id of the stamp held up
  let look = null; // the held-up overlay
  let timer = null;
  const sigs = new Map(); // def id -> what its ring was drawn from

  // ---- what the book shows ----

  function model(s) {
    const defs = usableDefs(s.stampDefs);
    const mine = new Map();
    for (const x of list(s.stamps)) if (x && x.who === s.me && !x.gone) mine.set(x.def, x);
    const t = now();
    return { s, defs, mine, t, state: (d) => stateOf(d, defs, mine.has(d.id) ? [d.id] : [], t) };
  }

  function label(d, st) {
    const date = d.date ? monthDay(d.date) : "";
    if (!d.date) return st === "have" ? "The book, stamped. Hold it up." : st === "open" ? "Press the book's stamp" : "The book, closed";
    if (st === "have") return date + ", " + (d.name_en || d.place || "stamp") + ", stamped. Hold it up.";
    if (st === "open") return "Press the stamp for " + date;
    return st === "soon" ? date + ", not open yet" : date + ", closed";
  }

  function ghost(d, st) {
    const g = el("span", "bk-ghost");
    const big = d.date ? dayNumber(d.date) : [...String(d.name_ja || "")].slice(0, 2).join("") || "MAT";
    const small = st === "open" ? "PRESS" : d.date ? weekdayOf(d.date) : "";
    g.append(el("b", "", big));
    if (small) g.append(el("small", "", small));
    return g;
  }

  function cellEl(d, st, stamp, defs, hit) {
    const b = el("button", "bk-cell is-" + st);
    b.type = "button";
    b.dataset.def = d.id;
    b.setAttribute("aria-label", label(d, st));
    const well = el("span", "bk-well");
    if (st === "have" && stamp) {
      const seed = stamp.seed;
      well.style.setProperty("--rot", tiltOf(seed) + "deg");
      well.innerHTML = bookStampSVG(seed, d, defs); // escaped by bookStampSVG
      const svg = well.firstElementChild;
      if (stamp.here === true) well.append(chop());
      if (hit && !calm()) {
        svg.classList.add("hit");
        wetInk(svg); // just landed: still wet (js/fx.js)
      }
    } else {
      well.append(ghost(d, st));
    }
    const cap = el("span", "bk-cap");
    cap.append(d.date ? monthDay(d.date) : "The book");
    if (d.place) cap.append(el("i", "", d.place));
    b.append(well, cap);
    return b;
  }

  function drawGrid(m) {
    const want = [];
    for (const d of m.defs) {
      const st = m.state(d);
      const stamp = m.mine.get(d.id) || null;
      // Everything the ring prints: its state, its stamp and the definition. Not whether
      // the press is still on its way: the drawing is the same.
      const sig = JSON.stringify([st, stamp ? [stamp.seed, stamp.at, stamp.here === true] : null, d.date, d.name_ja, d.name_en, d.place, d.motif, d.ink, d.shape]);
      let node = grid.querySelector('.bk-cell[data-def="' + CSS.escape(d.id) + '"]');
      if (node && sigs.get(d.id) === sig) {
        want.push(node);
        continue;
      }
      const hit = d.id === hitId;
      if (hit) hitId = null;
      const fresh = cellEl(d, st, stamp, m.defs, hit);
      const hadFocus = node && node === document.activeElement;
      sigs.set(d.id, sig);
      if (node) node.replaceWith(fresh);
      node = fresh;
      if (hadFocus) fresh.focus({ preventScroll: true });
      want.push(node);
    }
    want.forEach((node, i) => {
      if (grid.children[i] !== node) grid.insertBefore(node, grid.children[i] || null);
    });
    while (grid.children.length > want.length) grid.lastElementChild.remove();
    for (const id of [...sigs.keys()]) if (!m.defs.some((d) => d.id === id)) sigs.delete(id);
  }

  function drawToday(m) {
    const issue = m.defs.find((d) => !d.date) || null;
    const today = tripNow(m.s, m.t).date;
    const day = m.defs.find((d) => d.date === today) || null;
    const d = day || issue;
    const row = $("bookToday");
    row.hidden = !d;
    if (!d) return;
    const head = $("bookTH");
    head.replaceChildren(el("i", "", day ? "今日" : "発行"), " " + (day ? "Today" : "The book"));
    const people = list(m.s.people);
    const who = $("bookWho");
    const nodes = people.map((p) => {
      const x = list(m.s.stamps).find((st) => st && st.def === d.id && st.who === p.name && !st.gone);
      const item = el("div", "bk-p" + (x ? " is-in" : ""));
      const seal = el("i", "bk-seal");
      fillSeal(seal, p, p.name);
      const text = el("span");
      text.append(el("b", "", p.name === m.s.me ? "You" : p.name), el("i", "", x && isFinite(isoMs(x.at)) ? japanClock(isoMs(x.at)) : "not yet"));
      item.append(seal, text);
      return item;
    });
    who.replaceChildren(...nodes);
  }

  function render(s) {
    if (!opened) return;
    const m = model(s);
    drawGrid(m);
    $("bookSpan").textContent = spanText(m.defs);
    $("bookN").textContent = countText(m.mine.size, m.defs.length);
    drawToday(m);
    // A held stamp that is no longer mine (lifted from History on another phone) is put back.
    if (held && !m.mine.has(held)) closeLook(false);
  }

  // ---- acting ----

  function bump() {
    if (calm()) return;
    page.classList.remove("thump");
    void page.offsetWidth; // play the bump again
    page.classList.add("thump");
    setTimeout(() => page.classList.remove("thump"), BUMP_MS + 80);
  }

  function press(d) {
    primeSound();
    hitId = d.id;
    // In the place? Only a yes goes with the press, never where.
    const day = d.date ? (store.state.days || []).find((x) => x && x.date === d.date) : null;
    const here = !!(where && day && inPlace(day, where.current()));
    const token = store.pressStamp(d.id, { here });
    if (!token) {
      hitId = null;
      return;
    }
    // The store has taken the press: now the thud and the bump.
    landed = { id: d.id, at: now() };
    say.textContent = STAMPED;
    thud();
    bump();
  }

  function refuse(cell, d, st) {
    say.textContent = lockedLine(d, st);
    if (calm()) return;
    cell.classList.remove("nope");
    void cell.offsetWidth; // play the shake again
    cell.classList.add("nope");
  }

  function openLook(d, stamp) {
    closeLook(false);
    held = d.id;
    const b = el("button", "bk-look");
    b.type = "button";
    b.setAttribute("aria-label", "Put the stamp back");
    const card = el("span", "bk-card");
    const well = el("span", "bk-well");
    well.innerHTML = bookStampSVG(stamp.seed, d, usableDefs(store.state.stampDefs)); // escaped by bookStampSVG
    if (stamp.here === true) well.append(chop());
    card.append(well);
    const t = el("span", "bk-lt");
    t.append([d.name_ja, d.name_en].filter(Boolean).join(" ") || "Stamp");
    if (d.place) t.append(el("i", "", d.place));
    const at = isoMs(stamp.at);
    const day = d.date || (isFinite(at) ? japanDay(at) : ""); // own day: the pressed stamp's own date, not "today"
    const when = (day ? weekdayOf(day) + " " + monthDay(day) : "") + (isFinite(at) ? (day ? " · " : "") + "stamped " + japanClock(at) : "");
    if (when) t.append(el("i", "", when));
    if (stamp.here === true) t.append(el("i", "in", "pressed in " + (d.place || "the place")));
    card.append(t);
    b.append(card, el("span", "bk-lx", LOOK_BACK));
    b.addEventListener("click", () => closeLook(true));
    panel.append(b);
    look = b;
    // The rest of the book is not for reading while a stamp is held.
    scroll.inert = true;
    done.inert = true;
    b.focus({ preventScroll: true });
  }

  function closeLook(restoreFocus) {
    if (!look) return false;
    const id = held;
    look.remove();
    look = null;
    held = null;
    scroll.inert = false;
    done.inert = false;
    if (restoreFocus) {
      const cell = grid.querySelector('.bk-cell[data-def="' + CSS.escape(id) + '"]');
      if (cell) cell.focus({ preventScroll: true });
    }
    return true;
  }

  grid.addEventListener("click", (ev) => {
    const cell = ev.target.closest(".bk-cell");
    if (!cell) return;
    const m = model(store.state);
    const d = m.defs.find((x) => x.id === cell.dataset.def);
    if (!d) return;
    const st = m.state(d);
    if (st === "have") {
      if (landed.id === d.id && now() - landed.at < SETTLE_MS) return;
      const stamp = m.mine.get(d.id);
      if (stamp) openLook(d, stamp);
    } else if (st === "open") press(d);
    else refuse(cell, d, st);
  });

  // ---- opening and closing ----

  function open() {
    if (opened) return;
    opened = true;
    say.textContent = "";
    render(store.state);
    panel.classList.add("is-open");
    panel.inert = false;
    scrim.hidden = false;
    root.classList.add("book-open");
    scroll.scrollTop = 0;
    done.focus({ preventScroll: true });
    clearInterval(timer);
    timer = setInterval(() => render(store.state), LOOK_MS);
  }

  // restoreFocus: give focus back to the Days stamp button.
  function close(restoreFocus = true) {
    if (!opened) return;
    closeLook(false);
    opened = false;
    clearInterval(timer);
    timer = null;
    panel.classList.remove("is-open");
    panel.inert = true;
    scrim.hidden = true;
    root.classList.remove("book-open");
    if (panel.contains(document.activeElement)) document.activeElement.blur();
    if (restoreFocus === true) {
      const btn = document.getElementById("stampBtn");
      if (btn && !btn.hidden) btn.focus({ preventScroll: true });
    }
  }

  done.addEventListener("click", () => close());
  scrim.addEventListener("click", () => close());
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !opened) return;
    // A held stamp is put back first.
    if (!closeLook(true)) close();
  });
  store.subscribe((s) => {
    // The trip was taken off this phone: the book closes and nothing of it stays drawn.
    if (s && s.status === "nokey") {
      close(false);
      grid.replaceChildren();
      sigs.clear();
      hitId = null;
      landed = { id: null, at: 0 };
      for (const id of ["bookSpan", "bookN", "bookSay", "bookTH", "bookWho"]) $(id).replaceChildren();
      $("bookToday").hidden = true;
      return;
    }
    render(s);
  });

  return { open, close: (restoreFocus) => close(restoreFocus), isOpen: () => opened };
}
