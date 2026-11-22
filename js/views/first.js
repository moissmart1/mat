/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// First open: the gate (no key, or no backend yet), "Which one are you?" and
// the three "how this works" lines. mountFirst(root, store, opts) adds them to
// root and keeps them in step with the store.
// opts: connected (false: say the app is not connected yet; the store is never
// booted), storage (where mat.how is kept; default localStorage), onKey(key)
// (a trip key pasted on the no-key screen: keep it and start again).
//
// Never loaded (no key, nothing refused): the board's glass reads 調整中 above
// the paper, which says nothing of the trip is here yet (issue 84).
//
// The no-key screen also takes a pasted trip link (or the bare key): an app
// opened from the Home Screen has storage of its own, without the key Safari
// kept, and Safari itself clears a site's storage after a week without a
// visit. The pasted key is never drawn anywhere else and never logged.

import { fillSeal } from "../picture.js";

export const HOW_LINES = ["Ring up what you paid.", "The slip says who pays whom.", "Stamp it the moment you send."];
// Under the three lines, only in Safari (not from the Home Screen).
const HOW_HOME = "Add it to your Home Screen from You 設定. The Home Screen app asks for your link once: paste it from your email.";
const NO_KEY = "This phone needs the trip link. Open it from your email again, or paste it here.";
// The Home Screen app keeps its own storage, so opening the link elsewhere never signs it in.
const HOME_STEPS = "Find the email with your own MAT link, press and hold the link, tap Copy Link, then paste it here.";
const NO_KEY_HOME = "The Home Screen app keeps its own sign-in. " + HOME_STEPS;
const KEY_REFUSED_HOME = "That link no longer works here. " + HOME_STEPS;
const KEY_REFUSED = "That trip link didn’t work. Ask Mo for the current one.";
// After a refused key the trip is taken off the phone (js/store.js), and the screen says so.
const CLEARED = "The trip was taken off this phone.";
export function clearedText(kept) {
  if (!(kept > 0)) return CLEARED;
  return CLEARED + (kept === 1 ? " Your unsent line is kept: it goes out once you open your new link." : " Your " + kept + " unsent lines are kept: they go out once you open your new link.");
}
// With no key, unsent changes the phone could not save are only in this page's
// memory (js/store.js takeTripOff): pasting the link here keeps them; the Home
// Screen app's steps (version 36) send people to their email, so this says not
// to close the app rather than to keep it open (#20 review).
const MEMORY_ONLY = "Unsent changes are only in this app’s memory: don’t close it while you copy your link.";
const NOT_CONNECTED = "This app isn’t connected yet.";
// A key with no trip loaded yet that could not reach it (pasted with no signal,
// or the app reopened still without it): the key is kept and the app opens by
// itself when a check gets through (issue #85, js/store.js linkKept). The field
// is hidden: nothing more to paste.
export const LINK_KEPT = "Your link is kept. MAT opens by itself when signal is back.";
// Kept, but the trip sheet answered with an error (the phone has signal).
export const LINK_KEPT_SHEET = "Your link is kept. The trip sheet isn’t answering yet. MAT keeps trying.";
// Right after Open (or a start with a key and no trip), until the load answers
// or CHECK_SAY_MS pass with no answer; then the kept sentence.
export const CHECKING = "Checking your link…";
const CHECK_SAY_MS = 8000;
// Under the kept sentence: the field again, for another link (it replaces the kept one).
export const OTHER_LINK = "Use a different link";
// With issue 84's glass (調整中) on this screen, its two small lines say this.
export const GLASS_KEPT = { mark: "調整中", top: "Link kept", under: "Waiting for signal" };
const MEMORY_KEPT = "Unsent changes are only in this app’s memory: don’t close it until the trip opens.";
// Never loaded (issue 84): no key and nothing refused. The board's glass reads
// 調整中 (a machine not yet in service) above the paper. Its two small lines
// come from GLASS_NEW alone, so issue 85's branch (a link kept, waiting for
// signal) only passes other words to setGlass.
export const GLASS_NEW = { mark: "調整中", top: "Not set up yet", under: "Needs your link and signal, once" };
export const NEW_HOME = { head: "Nothing of the trip is in this app yet.", text: "The Home Screen app keeps its own copy, apart from Safari. " + HOME_STEPS };
export const NEW_SAFARI = { head: "Nothing of the trip is on this phone yet.", text: "Open your MAT link from your email again, or paste it here." };
// True since issue 85: a link pasted with no signal is kept and the app opens by itself.
export const NEW_NOTE = "With signal it fetches the trip and every ticket picture, once. No signal? Paste anyway: it keeps the link and opens by itself when signal is back.";
// The never-loaded paper: { head, text } for the Home Screen app or Safari.
export const newPaper = (home) => (home ? NEW_HOME : NEW_SAFARI);
const BAD_PASTE = "That doesn’t look like a trip link.";
const KEY_SHAPE = /^[A-Za-z0-9_-]{6,200}$/;

// The trip key in a pasted invite link (its #k= value) or a bare key; null
// when there is none that could be one.
export function keyFromPaste(text) {
  const t = String(text === undefined || text === null ? "" : text).trim();
  if (!t) return null;
  let key = t;
  const hash = t.indexOf("#");
  if (hash >= 0) {
    const found = t.slice(hash + 1).split("&").find((p) => p.startsWith("k="));
    if (found === undefined) return null;
    try {
      key = decodeURIComponent(found.slice(2)).trim();
    } catch {
      return null;
    }
  }
  return KEY_SHAPE.test(key) ? key : null;
}

// Already opened from the Home Screen (or as an installed app).
export function standalone() {
  try {
    if (globalThis.navigator && globalThis.navigator.standalone === true) return true;
    return typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

// A dimmed layer with a sheet that rises from the bottom.
function veil(id, label, title) {
  const layer = el("div", "veil");
  layer.id = id;
  layer.hidden = true;
  const sheet = el("div", "sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", label);
  const top = el("div", "sheet-top");
  top.append(el("span", "", title));
  sheet.append(top);
  layer.append(sheet);
  return { layer, sheet };
}

function setOpen(v, open) {
  if (open === !v.layer.hidden) return;
  v.layer.hidden = !open;
  if (!open) {
    v.sheet.classList.remove("is-open");
    return;
  }
  void v.sheet.offsetWidth; // start from below, so the sheet rises
  v.sheet.classList.add("is-open");
}

export function mountFirst(root, store, { connected = true, storage = defaultStorage(), onKey = () => {} } = {}) {
  const get = (k) => {
    try {
      return storage ? storage.getItem(k) : null;
    } catch {
      return null;
    }
  };
  const set = (k, v) => {
    try {
      if (storage) storage.setItem(k, v);
    } catch {
      // private mode: it will just ask again
    }
  };

  const gate = el("div", "gate");
  gate.id = "gate";
  gate.hidden = true;
  const gateText = el("p");
  // Polite live region: the kept sentence after a paste (issue #85), and a
  // refusal, are read out when they replace the instructions.
  gateText.setAttribute("role", "status");
  // A way in when the key is missing: paste the trip link.
  // The sentence above says what the field is for; no label of its own.
  const paste = el("div", "gate-key");
  const pasteRow = el("div", "gate-key-r");
  const pasteField = el("input");
  pasteField.id = "keyPaste";
  pasteField.type = "text";
  pasteField.setAttribute("aria-label", "Trip link");
  pasteField.placeholder = "Trip link";
  for (const [k, v] of Object.entries({ autocapitalize: "none", autocorrect: "off", autocomplete: "off", spellcheck: "false", enterkeyhint: "go", inputmode: "url" })) {
    pasteField.setAttribute(k, v);
  }
  const pasteGo = el("button", "", "Open");
  pasteGo.type = "button";
  pasteGo.id = "keyGo";
  const pasteMsg = el("div", "gate-key-m");
  pasteMsg.id = "keyMsg";
  pasteMsg.setAttribute("role", "alert");
  pasteRow.append(pasteField, pasteGo);
  paste.append(pasteRow, pasteMsg);
  const other = el("button", "gate-other", OTHER_LINK);
  other.type = "button";
  other.id = "keyOther";
  other.hidden = true;
  // The kept screen's field, opened by "Use a different link".
  let choosing = false;
  // When the "Checking your link…" wait began (null: not checking).
  let checkingSince = null;
  let checkTimer = null;
  // The sentence last written: the status region is only written when it changes.
  let said = null;
  other.addEventListener("click", () => {
    choosing = true;
    render(store.state);
    pasteField.focus();
  });
  // The never-loaded screen's glass and the line under the field (issue 84).
  const glass = el("div", "rdy-gboard led");
  glass.id = "gateGlass";
  glass.hidden = true;
  const glassMark = el("b");
  glassMark.setAttribute("aria-hidden", "true");
  const glassWords = el("span");
  const glassTop = document.createTextNode("");
  const glassUnder = el("i");
  glassWords.append(glassTop, glassUnder);
  glass.append(glassMark, glassWords);
  const setGlass = ({ mark, top, under }) => {
    glassMark.textContent = mark;
    glassTop.data = top;
    glassUnder.textContent = under;
  };
  setGlass(GLASS_NEW);
  const gateNote = el("div", "rdy-g-note", NEW_NOTE);
  gateNote.id = "gateNote";
  gateNote.hidden = true;
  gate.append(glass, gateText, paste, other, gateNote);

  function usePaste() {
    const key = keyFromPaste(pasteField.value);
    if (!key) {
      pasteMsg.textContent = BAD_PASTE;
      return;
    }
    pasteField.value = ""; // the key is not left on screen
    pasteMsg.textContent = "";
    pasteField.blur();
    choosing = false;
    checkingSince = null; // a new key: a new wait
    onKey(key);
  }
  pasteGo.addEventListener("click", usePaste);
  pasteField.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      usePaste();
    }
  });
  pasteField.addEventListener("input", () => {
    pasteMsg.textContent = "";
  });

  const first = veil("first", "Which one are you?", "Which one are you?");
  const pick = el("div", "who-pick");
  first.sheet.append(pick);

  const how = veil("how", "How this works", "How this works");
  const lines = el("div", "how");
  for (const text of HOW_LINES) lines.append(el("div", "how-l", text)); // numbered by CSS
  const home = el("p", "how-x", HOW_HOME);
  home.id = "howHome";
  home.hidden = standalone();
  lines.append(home);
  const ok = el("button", "go-btn", "Got it");
  ok.type = "button";
  ok.id = "howOk";
  how.sheet.append(lines, ok);

  root.append(first.layer, how.layer, gate);

  // "How this works" shows once you are someone, until you tap "Got it" (R19).
  let shownPeople = "";

  pick.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-me]");
    if (!b) return;
    store.setMe(b.dataset.me);
  });
  ok.addEventListener("click", () => {
    set("mat.how", "1");
    render(store.state);
  });

  function drawPeople(people) {
    const sig = JSON.stringify(people.map((p) => [p.name, p.initials, p.photo || ""]));
    if (sig === shownPeople) return;
    shownPeople = sig;
    pick.replaceChildren(
      ...people.map((p) => {
        const b = el("button");
        b.type = "button";
        b.dataset.me = p.name;
        b.append(fillSeal(el("span", "seal"), p), document.createTextNode(p.name));
        return b;
      }),
    );
  }

  function render(s) {
    const keyless = connected && s.status === "nokey";
    const refused = s.keyRefused ? (standalone() ? KEY_REFUSED_HOME : KEY_REFUSED) + (s.cleared ? " " + clearedText(s.cleared.kept) : "") : standalone() ? NO_KEY_HOME : NO_KEY;
    const blocked = !connected ? NOT_CONNECTED : keyless ? refused : null;
    const waiting = keyless && !s.keyRefused && s.linkChecking === true;
    if (!waiting) {
      checkingSince = null;
      clearTimeout(checkTimer);
    } else if (checkingSince === null) {
      checkingSince = Date.now();
      clearTimeout(checkTimer);
      checkTimer = setTimeout(() => render(store.state), CHECK_SAY_MS);
    }
    const checking = waiting && Date.now() - checkingSince < CHECK_SAY_MS;
    const kept = !checking && keyless && !s.keyRefused && (s.linkKept === true || waiting);
    if (!kept) choosing = false;
    let say = blocked;
    if (checking) say = CHECKING;
    else if (kept) {
      const why = s.linkKept === true && s.linkFault === "sheet" ? LINK_KEPT_SHEET : LINK_KEPT;
      say = s.queueStorageFailed ? why + " " + MEMORY_KEPT : why;
    } else if (blocked && keyless && s.queueStorageFailed) say = blocked + " " + MEMORY_ONLY;
    gate.hidden = !blocked;
    // Never loaded: no key, nothing refused, nothing held only in memory.
    const fresh = keyless && !s.keyRefused && !s.queueStorageFailed;
    // The new paper is only for a phone that holds no link at all; a kept or checking link has its own words.
    const showNew = fresh && !checking && !kept;
    const glassOn = fresh || kept || checking;
    glass.hidden = !glassOn;
    gateNote.hidden = !showNew;
    gate.classList.toggle("rdy-gate", glassOn);
    setGlass(kept ? GLASS_KEPT : GLASS_NEW);
    const sayKey = showNew ? (standalone() ? "new-home" : "new-safari") : say;
    if (sayKey && sayKey !== said) {
      if (showNew) {
        const paper = newPaper(standalone());
        gateText.replaceChildren(el("b", "", paper.head), document.createTextNode(" " + paper.text));
      } else gateText.textContent = say;
      said = sayKey;
    }
    paste.hidden = !keyless || checking || (kept && !choosing);
    other.hidden = !kept || choosing;
    const needMe = !blocked && s.status === "ready" && !s.me && s.people.length > 0;
    if (needMe) drawPeople(s.people);
    setOpen(first, needMe);
    setOpen(how, !blocked && !needMe && !!s.me && get("mat.how") !== "1");
  }

  render(store.state);
  store.subscribe(render);
}
