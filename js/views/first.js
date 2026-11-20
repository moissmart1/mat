/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// First open: the gate (no key, or no backend yet), "Which one are you?" and
// the three "how this works" lines. mountFirst(root, store, opts) adds them to
// root and keeps them in step with the store.
// opts: connected (false: say the app is not connected yet; the store is never
// booted), storage (where mat.how is kept; default localStorage), onKey(key)
// (a trip key pasted on the no-key screen: keep it and start again).
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
const NO_KEY_HOME = "The Home Screen app keeps its own sign-in. Find the email with your own MAT link, press and hold the link, tap Copy Link, then paste it here.";
const KEY_REFUSED = "That trip link didn’t work. Ask Mo for the current one.";
// After a refused key the trip is taken off the phone (js/store.js), and the screen says so.
const CLEARED = "The trip was taken off this phone.";
export function clearedText(kept) {
  if (!(kept > 0)) return CLEARED;
  return CLEARED + (kept === 1 ? " Your unsent line is kept: it goes out once you open your new link." : " Your " + kept + " unsent lines are kept: they go out once you open your new link.");
}
const NOT_CONNECTED = "This app isn’t connected yet.";
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
  gate.append(gateText, paste);

  function usePaste() {
    const key = keyFromPaste(pasteField.value);
    if (!key) {
      pasteMsg.textContent = BAD_PASTE;
      return;
    }
    pasteField.value = ""; // the key is not left on screen
    pasteMsg.textContent = "";
    pasteField.blur();
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
    const refused = s.keyRefused ? KEY_REFUSED + (s.cleared ? " " + clearedText(s.cleared.kept) : "") : standalone() ? NO_KEY_HOME : NO_KEY;
    const blocked = !connected ? NOT_CONNECTED : keyless ? refused : null;
    gate.hidden = !blocked;
    if (blocked) gateText.textContent = blocked;
    paste.hidden = !keyless;
    const needMe = !blocked && s.status === "ready" && !s.me && s.people.length > 0;
    if (needMe) drawPeople(s.people);
    setOpen(first, needMe);
    setOpen(how, !blocked && !needMe && !!s.me && get("mat.how") !== "1");
  }

  render(store.state);
  store.subscribe(render);
}
