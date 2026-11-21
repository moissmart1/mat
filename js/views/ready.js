/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Is this phone ready for no signal (issue 84, look A: the departure board
// says it). What is said comes from js/ready.js; this draws it.
//
// mountReady(phone, store, { keep, clock, storage, durable, onFetch, beforeOpen })
//   -> { el, update(quiet), model(), subscribe(fn), seen(), passStarted(forced), passSettled(again), open(from), close(restoreFocus), isOpen() }
// - el: the line (div role=group "This phone"): a lamp, the words (one
//   button, it opens the sheet) and, when it has one, the key 取込 (a second
//   button beside it, onFetch). Days puts it right after the board
//   (js/views/days.js): under a board that shows it is the board's foot,
//   with no board it stands alone in the same black glass. From two days
//   before, while pictures are missing with signal, it is the tall foot under
//   the board's face (model().big): the sentence and a paper key. It is not
//   one of the board's two lines and never runs sideways.
// - update(quiet): read everything again and redraw; listeners hear of it when
//   what is said changed (unless quiet: Days' own redraw asks that way).
//   Also on its own: the store, a picture kept, a minute, the worker taking
//   the page (controllerchange), online/offline, and a pass starting or
//   settling (passStarted, passSettled, from app.js's one fetch helper).
// - seen(): the line is in sight on Days (an IntersectionObserver, the
//   answer held 300 ms so a flick of the day does not flash the strip; Days
//   inert, on another tab, is out of sight).
// - The sheet "This phone" (a tap on the words, or the strip's): the app's
//   dark sheet, rows in the You sheet's row style. Done, Escape and the
//   scrim close it; focus goes back to what opened it. #phone has rdy-open
//   while it is up. It redraws while open.
// - One visually hidden status line says only when a pass the person asked
//   for starts ("Fetching 9 ticket pictures") and how it ended.
// Every word is set with textContent.

import { phoneReady, sheetFor, track, isAmber, KEY_JP } from "../ready.js";
import { aheadPictures, fetchMode, isFetching } from "../tickets.js";
import { standalone } from "./first.js";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
const put = (node, text) => {
  if (node.textContent !== text) node.textContent = text;
};
const HOLD_MS = 300;
const MINUTE_MS = 60000;

// Rule 4: the service worker controls this page. A click-through test with no
// worker can stand in for it (MAT_TEST_SHELL, only beside the fake backend).
function shellNow() {
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) return true;
  } catch {
    // no worker here
  }
  return typeof globalThis.MAT_FAKE_API === "function" && globalThis.MAT_TEST_SHELL === true;
}

export function mountReady(phone, store, { keep, clock, storage, durable = true, onFetch = () => {}, beforeOpen = () => {} } = {}) {
  const now = () => (clock && clock.now ? clock.now() : Date.now());
  const read = (k) => {
    try {
      return storage ? storage.getItem(k) : null;
    } catch {
      return null;
    }
  };

  // ---- the line ----
  const line = el("div", "rdy");
  line.setAttribute("role", "group");
  line.setAttribute("aria-label", "This phone");
  line.hidden = true;
  const words = el("button", "rdy-w");
  words.type = "button";
  words.id = "rdyWords";
  const lamp = el("span", "rdy-lamp");
  lamp.setAttribute("aria-hidden", "true");
  const jp = el("span", "rdy-jp");
  jp.setAttribute("aria-hidden", "true");
  const t = el("span", "rdy-t");
  const right = el("span", "rdy-r");
  words.append(lamp, jp, t, right);
  const key = el("button", "rdy-key");
  key.type = "button";
  key.id = "rdyKey";
  const keyJp = el("i", "", KEY_JP);
  keyJp.setAttribute("aria-hidden", "true");
  const keyT = el("span");
  key.append(keyJp, keyT);
  // The tall foot, from two days before.
  const note = el("small", "rdy-note");
  const bigKey = el("button", "rdy-bigkey");
  bigKey.type = "button";
  bigKey.id = "rdyBigKey";
  const bigJp = el("i", "", KEY_JP);
  bigJp.setAttribute("aria-hidden", "true");
  const bigT = el("span");
  bigKey.append(bigJp, bigT);
  line.append(words, key, note, bigKey);

  // Said to a screen reader only, once at the start and once at the end of a pass someone asked for.
  const say = el("span", "rdy-say");
  say.id = "rdySay";
  say.setAttribute("role", "status");
  phone.append(say);

  // ---- the sheet ----
  const scrim = el("div", "scrim");
  scrim.id = "rdyScrim";
  scrim.hidden = true;
  const sheet = el("div", "sheet rdy-sheet");
  sheet.id = "rdy";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "This phone");
  sheet.inert = true;
  const top = el("div", "sheet-top");
  const title = el("span");
  const titleJp = el("i", "rdy-tjp", "端末");
  titleJp.setAttribute("aria-hidden", "true");
  title.append(titleJp, document.createTextNode("This phone"));
  const done = el("button", "", "Done");
  done.type = "button";
  done.id = "rdyDone";
  top.append(title, done);
  const body = el("div", "set rdy-set");
  const verdict = el("p", "rdy-v");
  verdict.id = "rdyVerdict";
  const rows = el("div", "rdy-rows");
  const sheetKey = el("button", "go-btn rdy-go");
  sheetKey.type = "button";
  sheetKey.id = "rdyGo";
  const goJp = el("i", "", KEY_JP);
  goJp.setAttribute("aria-hidden", "true");
  const goT = el("span");
  sheetKey.append(goJp, goT);
  body.append(verdict, rows, sheetKey);
  sheet.append(top, body);
  phone.append(scrim, sheet);

  // ---- state ----
  let current = null;
  let sig = "";
  let progress = null;
  let failed = false;
  let asked = false; // the pass running was asked for by a person (Fetch now)
  const subs = new Set();
  const env = () => ({
    have: (id) => keep.have(id),
    lasting: keep.lasting === true,
    mode: fetchMode(storage),
    shell: shellNow(),
    kept: durable && read("mat.key") !== null && read("mat.cache") !== null,
    standalone: standalone(),
    fetching: isFetching(store),
    progress,
    failed,
  });
  const missingNow = (s, at) => {
    if (!s || s.status !== "ready" || s.ticketsReady !== true || !s.trip) return 0;
    try {
      return aheadPictures(s, at).filter((x) => !keep.have(x.id)).length;
    } catch {
      return 0;
    }
  };

  function drawLine(m) {
    line.hidden = !m;
    if (!m) return;
    const amber = isAmber(m.kind);
    line.dataset.kind = m.kind;
    line.classList.toggle("is-amber", amber);
    line.classList.toggle("is-big", !!m.big);
    line.classList.toggle("is-busy", m.kind === "fetching");
    put(jp, m.jp);
    jp.hidden = !m.jp;
    put(t, m.l1);
    put(right, m.right);
    right.hidden = !m.right;
    words.setAttribute("aria-label", m.aria);
    put(keyT, m.key);
    const keyHad = document.activeElement === key;
    key.hidden = !m.key || !!m.big;
    // The key goes while a pass runs: focus that was on it goes to the words, not to the page.
    if (keyHad && key.hidden && !m.big) words.focus({ preventScroll: true });
    if (m.key) key.setAttribute("aria-label", m.keyAria);
    const hadFocus = document.activeElement === bigKey || document.activeElement === words || keyHad;
    words.hidden = !!m.big;
    note.hidden = !m.big;
    bigKey.hidden = !m.big;
    // The tall foot comes or goes: focus stays in the line.
    if (hadFocus && !line.contains(document.activeElement)) (m.big ? bigKey : m.key ? key : words).focus({ preventScroll: true });
    if (m.big) {
      put(note, m.big.note);
      put(bigT, m.big.key);
      bigKey.setAttribute("aria-disabled", m.big.busy ? "true" : "false");
      bigKey.setAttribute("aria-label", m.big.busy ? m.big.key + " ticket pictures" : m.kind === "failed" ? m.keyAria : "Fetch " + (m.n === 1 ? "1 ticket picture" : m.n + " ticket pictures") + " now");
    }
  }

  function drawSheet(m) {
    if (!opened) return;
    if (!m) {
      close(true);
      return;
    }
    const sh = sheetFor(m);
    put(verdict, sh.verdict);
    verdict.classList.toggle("is-ready", m.kind === "ready" || m.kind === "ready-off");
    const want = JSON.stringify([sh.rows, sh.notes]);
    if (rows.dataset.sig !== want) {
      rows.dataset.sig = want;
      const parts = sh.rows.map((r) => {
        const row = el("div", "set-r rdy-row");
        row.dataset.row = r.id;
        const left = el("span");
        left.append(el("span", "rdy-l", r.label));
        for (const x of r.lines || []) left.append(el("small", "", x));
        row.append(left, el("b", "", r.value));
        return row;
      });
      for (const n of sh.notes) parts.push(el("p", "set-r rdy-note-r", n));
      rows.replaceChildren(...parts);
    }
    sheetKey.hidden = !sh.key;
    put(goT, sh.key);
  }

  // The keep opens after the page starts (and again for a new link): read everything again once it has.
  let keepOpening = null;
  function update(quiet = false) {
    if (keep.ready !== keepOpening) {
      keepOpening = keep.ready;
      Promise.resolve(keepOpening).then(() => update(), () => update());
    }
    const s = store.state;
    const at = now();
    progress = track(progress, missingNow(s, at), isFetching(store));
    let m = null;
    try {
      m = phoneReady(s, at, env());
    } catch {
      m = null;
    }
    if (m && m.n === 0) failed = false;
    current = m;
    drawLine(m);
    drawSheet(m);
    const next = JSON.stringify(m);
    if (next === sig) return m;
    sig = next;
    if (!quiet) for (const f of subs) f(m);
    return m;
  }

  // ---- in sight ----
  let inView = true; // what the observer says now
  let held = true; // what seen() answers: inView, 300 ms later
  let holdTimer = null;
  let view = null;
  const sightNow = () => inView && !line.hidden && !(view && view.inert);
  function settleSight() {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      const v = sightNow();
      if (v === held) return;
      held = v;
      for (const f of subs) f(current);
    }, HOLD_MS);
  }
  if (typeof IntersectionObserver === "function") {
    // The strip at the top covers the screen's first 40 px or so: under it is out of sight.
    new IntersectionObserver(
      (entries) => {
        inView = entries[entries.length - 1].isIntersecting;
        settleSight();
      },
      { rootMargin: "-44px 0px 0px 0px" },
    ).observe(line);
  }
  function watchView() {
    if (view || typeof MutationObserver !== "function") return;
    view = line.closest(".view");
    if (view) new MutationObserver(settleSight).observe(view, { attributes: true, attributeFilter: ["inert"] });
  }

  // ---- the sheet's opening and closing ----
  let opened = false;
  let opener = null;
  function open(from) {
    if (!current) return;
    beforeOpen();
    opener = from || document.activeElement;
    opened = true;
    drawSheet(current);
    sheet.classList.add("is-open");
    sheet.inert = false;
    scrim.hidden = false;
    phone.classList.add("rdy-open");
    sheet.scrollTop = 0;
    done.focus({ preventScroll: true });
  }
  function close(restoreFocus = true) {
    if (!opened) return;
    opened = false;
    sheet.classList.remove("is-open");
    sheet.inert = true;
    scrim.hidden = true;
    phone.classList.remove("rdy-open");
    if (sheet.contains(document.activeElement)) document.activeElement.blur();
    const back = opener;
    opener = null;
    if (restoreFocus && back && back.isConnected && back.getClientRects().length) back.focus({ preventScroll: true });
  }
  words.addEventListener("click", () => open(words));
  done.addEventListener("click", () => close());
  scrim.addEventListener("click", () => close());
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !ev.isComposing && opened) close();
  });
  const fetchKey = (ev) => {
    if (ev.currentTarget.getAttribute("aria-disabled") === "true") return;
    onFetch();
  };
  key.addEventListener("click", fetchKey);
  bigKey.addEventListener("click", fetchKey);
  sheetKey.addEventListener("click", fetchKey);

  // ---- a pass, from app.js's helper ----
  function passStarted(forced) {
    failed = false;
    if (forced) {
      asked = true;
      const n = missingNow(store.state, now());
      put(say, "Fetching " + (n === 1 ? "1 ticket picture" : n + " ticket pictures"));
    }
    update();
  }
  // again: the pass ended only because the store was saving; it is tried again when it is idle.
  function passSettled(again = false) {
    const s = store.state;
    const n = missingNow(s, now());
    failed = !again && s.online !== false && n > 0 && !isFetching(store);
    const m = update();
    if (asked && !isFetching(store) && !again) {
      asked = false;
      put(say, !m ? "" : m.kind === "failed" ? m.l1 : m.n === 0 ? "Ready for no signal" : m.l1);
    }
  }

  // ---- redraws ----
  store.subscribe(() => update());
  keep.subscribe(() => update());
  window.addEventListener("online", () => update());
  window.addEventListener("offline", () => update());
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) navigator.serviceWorker.addEventListener("controllerchange", () => update());
  } catch {
    // no worker here
  }
  setInterval(() => {
    if (document.visibilityState !== "hidden") update();
  }, MINUTE_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") update();
  });

  return {
    el: line,
    update(quiet) {
      watchView();
      const m = update(quiet);
      settleSight();
      return m;
    },
    model: () => current,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    seen: () => held,
    passStarted,
    passSettled,
    open,
    close,
    isOpen: () => opened,
  };
}
