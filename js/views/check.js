/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The owner's trip check (issue 86): one line on the Days board that says how
// much the trip is still missing, and the sheet it opens. What is missing
// comes from js/check.js; this draws it. Owner's phone only: on any other
// phone, and on the shared link, none of it exists in the page.
//
// mountCheck(phone, store, { clock, beforeOpen, onOpenLine })
//   -> { el, attach(root, before), update(), subscribe(fn), count(), owner(), open(from), close(restoreFocus), isOpen() }
// - el: the line, a button "点検 8 things missing ›", hidden unless this is
//   the owner's phone, the trip has loaded and the count is above 0. Days
//   places it with attach(root, before), between the board and the line "This
//   phone", and gives it is-top / is-last (the block of lines is one piece of
//   glass; js/views/days.js). Off the owner's phone it is not in the page.
// - The sheet "Trip check": paper, as the Before pad. Scrim, focus moved in,
//   Escape, Done and the scrim close it, focus goes back to what opened it;
//   #phone has check-open while it is up (a new release waits). It redraws
//   on every store change and keeps a row that has not changed (focus stays);
//   a row goes by itself once the thing is filled in. On a computer it is the
//   Days pane's.
// - A row's tap closes the sheet without giving focus back, then
//   onOpenLine({ type, id, date }) says what to open: "stop", "stay-edit",
//   "stay" (the hotel card) or "day" (js/app.js does it).
// - beforeOpen(): app.js closes the other sheets.
// - subscribe(fn): told when the line shows or hides (Days places its foot).
// Every word is set with textContent.

import { missing, ownerOf, lineWords } from "../check.js";
import { weekdayOf, dayHead } from "../format.js";
import { safeHref } from "../plan.js";

const MARKUP = `
<div class="sheet-top"><span><i class="ck-h" aria-hidden="true">点検表</i><i>Trip check</i></span><button type="button" id="ckDone">Done</button></div>
<div class="ck-sec" id="ckMissH"><i class="ck-jp" aria-hidden="true">未済</i><span id="ckMissT"></span><em id="ckMissE">by date · tap to fix</em></div>
<div class="ck-rows" id="ckRows" role="list"></div>
<p class="ck-none" id="ckNone" hidden>Nothing is missing from today on.</p>
<p class="ck-foot">Read from the trip as this phone holds it. A stay’s nights, Japanese name and address are typed in the Google Sheet, on the Stays tab.<a id="ckSheet" target="_blank" rel="noopener" hidden>Open the Sheet ↗</a></p>`;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const MINUTE = 60 * 1000;

export function mountCheck(phone, store, { clock, beforeOpen = () => {}, onOpenLine = () => {} } = {}) {
  // ---- the line ----
  const line = el("button", "ck-line");
  line.type = "button";
  line.id = "ckLine";
  line.hidden = true;
  const jp = el("i", "ck-jp", "点検");
  jp.setAttribute("aria-hidden", "true");
  const words = el("span", "ck-t");
  const more = el("span", "ck-more", "›");
  more.setAttribute("aria-hidden", "true");
  line.append(jp, words, more);

  // ---- the sheet ----
  const scrim = el("div", "scrim");
  scrim.id = "ckScrim";
  scrim.hidden = true;
  const sheet = el("div", "sheet ck");
  sheet.id = "check";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Trip check");
  sheet.inert = true;
  sheet.innerHTML = MARKUP;

  const $ = (id) => sheet.querySelector("#" + id);
  const done = $("ckDone");
  const head = $("ckMissT");
  const headNote = $("ckMissE");
  const rows = $("ckRows");
  const none = $("ckNone");
  const sheetLink = $("ckSheet");

  const subs = [];
  let lines = [];
  let sig = "";
  let shownWas = false;
  let opened = false;
  let opener = null;
  const nodes = new Map(); // id -> { node, sig }
  let home = null; // where Days puts the line: { root, before }

  // Nothing of this is in the page except on the owner's phone: the line and
  // the sheet are put in when it is, and taken out when it stops being.
  function sync(on) {
    if (on) {
      if (!sheet.isConnected) phone.append(scrim, sheet);
      if (home && !line.isConnected) home.root.insertBefore(line, home.before);
      return;
    }
    if (opened) close(false);
    line.remove();
    sheet.remove();
    scrim.remove();
  }

  const owner = () => ownerOf(store.state);
  const now = () => (clock && clock.now ? clock.now() : Date.now());
  const compute = () => {
    const s = store.state;
    return ownerOf(s) && s.status === "ready" && s.trip ? missing(s, now()) : [];
  };
  // The count the You row shows: null when this is not the owner's phone.
  const count = () => (owner() ? compute().length : null);

  function row(l) {
    const date = el("span", "ck-d");
    const wd = weekdayOf(l.date);
    date.append(el("i", "", l.date.slice(5).replace("-", ".")), el("small", "", wd.jp + " " + wd.en));
    date.setAttribute("aria-hidden", "true");
    const body = el("span", "ck-b");
    body.append(el("span", "ck-l", l.label), el("b", "", l.title), el("span", "ck-w", l.why));
    const go = el("span", "ck-go", "›");
    go.setAttribute("aria-hidden", "true");
    const b = el("button", "ck-r");
    b.type = "button";
    b.dataset.id = l.id;
    b.setAttribute("aria-label", dayHead(l.date, []).en + ". " + l.title + ". " + l.why + ". Open to fix");
    b.append(date, body, go);
    b.addEventListener("click", () => {
      close(false);
      onOpenLine(l.open);
    });
    // The list item is the wrapper: the button keeps its own role for a screen reader.
    const li = el("div", "ck-li");
    li.setAttribute("role", "listitem");
    li.append(b);
    return li;
  }

  function drawSheet() {
    head.textContent = "Still missing: " + (lines.length ? lines.length : "nothing");
    headNote.hidden = !lines.length;
    rows.hidden = !lines.length;
    none.hidden = lines.length > 0;
    const url = safeHref(store.state.sheetUrl);
    sheetLink.hidden = !url;
    if (url) sheetLink.href = url;
    else sheetLink.removeAttribute("href");

    const hadFocus = rows.contains(document.activeElement);
    const wanted = lines.map((l) => {
      const key = JSON.stringify([l.date, l.label, l.title, l.why]);
      const had = nodes.get(l.id);
      if (had && had.sig === key) return had.node;
      const node = row(l);
      nodes.set(l.id, { node, sig: key });
      return node;
    });
    for (const id of [...nodes.keys()]) if (!lines.some((l) => l.id === id)) nodes.delete(id);
    // What went comes out first; then only what moved is moved: a row left where it is keeps its focus.
    for (const child of [...rows.children]) if (!wanted.includes(child)) rows.removeChild(child);
    let cur = rows.firstChild;
    for (const node of wanted) {
      if (node === cur) cur = cur.nextSibling;
      else rows.insertBefore(node, cur);
    }
    if (hadFocus && !rows.contains(document.activeElement) && opened) done.focus({ preventScroll: true });
  }

  function drawLine() {
    const n = lines.length;
    const on = n > 0;
    if (on) {
      words.textContent = lineWords(n);
      line.setAttribute("aria-label", "Trip check: " + lineWords(n) + ". Open the list");
    }
    line.hidden = !on;
    if (on !== shownWas) {
      shownWas = on;
      for (const f of subs) f(on);
    }
  }

  function update() {
    const s = store.state;
    if (s.status === "nokey" || !owner()) {
      lines = [];
      sig = "";
      sync(false);
      drawLine();
      return;
    }
    sync(true);
    // Not loaded: no line (an open sheet keeps what it shows until the trip is back).
    if (s.status !== "ready" || !s.trip) {
      lines = [];
      sig = "";
      drawLine();
      return;
    }
    const next = missing(s, now());
    const key = JSON.stringify(next) + "|" + safeHref(s.sheetUrl);
    if (key === sig) return;
    sig = key;
    lines = next;
    drawLine();
    if (opened) drawSheet();
  }

  function open(from) {
    if (!owner()) return;
    beforeOpen();
    update();
    opener = from || document.activeElement;
    opened = true;
    drawSheet();
    sheet.classList.add("is-open");
    sheet.inert = false;
    scrim.hidden = false;
    phone.classList.add("check-open");
    sheet.scrollTop = 0;
    done.focus({ preventScroll: true });
  }
  function close(restoreFocus = true) {
    if (!opened) return;
    opened = false;
    sheet.classList.remove("is-open");
    sheet.inert = true;
    scrim.hidden = true;
    phone.classList.remove("check-open");
    if (sheet.contains(document.activeElement)) document.activeElement.blur();
    const back = opener;
    opener = null;
    if (restoreFocus === true && back && back.isConnected && back.getClientRects().length) back.focus({ preventScroll: true });
  }

  line.addEventListener("click", () => open(line));
  done.addEventListener("click", () => close());
  scrim.addEventListener("click", () => close());
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !ev.isComposing && opened) close();
  });

  store.subscribe(update);
  if (clock && typeof clock.subscribe === "function") clock.subscribe(update);
  // The trip's day turns over with nobody touching the phone: the minute's look.
  setInterval(update, MINUTE);
  update();

  return {
    el: line,
    // Days says where the line goes (before `before`, in `root`); it is there only while this is the owner's phone.
    attach: (root, before) => {
      home = { root, before };
      sync(owner() && store.state.status !== "nokey");
    },
    update,
    subscribe: (fn) => subs.push(fn),
    count,
    owner,
    open,
    close: (restoreFocus) => close(restoreFocus),
    isOpen: () => opened,
  };
}
