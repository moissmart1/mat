/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The register: the sheet where an expense is rung up or changed. Its own
// number pad, quick chips, payer and split seals, a day stepper, and the
// uneven split panel (js/views/uneven.js).
//
// mountRegister(root, store, { now, storage, onClose }) -> { open(day?), edit(id), close(), isOpen() }
// onClose(): called each time the register closes.
// root is the phone; the register sits at its bottom over the Money view.
// Every new entry starts in dollars (CAD), also the next one after ringing up; the ¥/$ key
// switches the one in hand, and a half-typed entry keeps its currency when put away and reopened.
// storage is only used to clear the old mat.cur memory once.

import { defaultRingDay, newId } from "../time.js";
import { yen, dollars, pt, dayShort } from "../format.js";
import { mountUneven, splitOf, toUnits, fromUnits } from "./uneven.js";
import { isWide } from "../shape.js";
import { fillSeal } from "../picture.js";
import { paidMost, lineNames, reasonText, shareCard } from "../turn.js";

// Each quick pick carries a kind, stored with the line and never shown.
export const CHIPS = [
  { label: "Dinner", kind: "food" }, { label: "Lunch", kind: "food" }, { label: "Coffee", kind: "food" },
  { label: "Drinks", kind: "food" }, { label: "Groceries", kind: "food" },
  { label: "Train", kind: "transport" }, { label: "Taxi", kind: "transport" }, { label: "Flight", kind: "transport" },
  { label: "Stay", kind: "stay" },
  { label: "Tickets", kind: "activity" }, { label: "Onsen", kind: "activity" },
  { label: "Shopping", kind: "shopping" },
];

const MAX_DIGITS = 8;
// The biggest amount the backend takes (validateExpense in backend/Pure.js):
// 10,000,000 in either currency, in the register's units (yen, or cents).
export const MAX_UNITS = { JPY: 10000000, CAD: 1000000000 };
const HOLD_MS = 500;
const DAY_MS = 86400000;
// Below this much room above the register, the reasoning lies over the seals
// and keys instead of pushing the register up (a small phone, a Safari tab).
const WHY_MIN_ROOM = 200;
const SIDEWAYS = "(orientation:landscape) and (max-height:520px)";
const WHY_NOTE = "Each box is a tenth of a share. Counts what each of you paid for the group, plus what was sent on the slip. A hint, not a rule: whoever pays, the slip sorts it out.";
const FIELDS = ["title", "amount", "currency", "paidBy", "day", "kind"]; // split, splitMode, splitVals go together

// Fixed markup only: names and titles go in later with textContent.
const MARKUP = `
<div class="reg-top"><span id="regTitle">Ring up</span><button type="button" id="regDone">Done</button></div>
<div class="lcd">
  <div class="lcd-1"><input id="xWhat" type="text" maxlength="80" placeholder="what was it?" autocomplete="off" enterkeyhint="done" aria-label="What was it"><span id="xAmt">$0</span></div>
  <div class="lcd-2">
    <div class="step"><button type="button" id="dPrev" aria-label="Earlier day">‹</button><span id="xDay"></span><button type="button" id="dNext" aria-label="Later day">›</button></div>
    <span id="xConv"></span>
  </div>
</div>
<div class="chips" id="xQuick"></div>
<button type="button" class="turn" id="xTurn" aria-expanded="false" aria-controls="xWhy" hidden><span><u id="xTurnL"></u></span></button>
<div class="why-slip" id="xWhy" hidden></div>
<div class="who">
  <div><span class="who-l">paid</span><span class="seals" id="xPayer"></span></div>
  <div><span class="who-l who-split">split<button type="button" id="xUneven">Uneven</button></span><span class="seals" id="xSplit"></span></div>
</div>
<div class="pad" id="pad">
  <button type="button" class="key" data-k="7">7</button><button type="button" class="key" data-k="8">8</button><button type="button" class="key" data-k="9">9</button><button type="button" class="key" data-k="del" aria-label="Delete">⌫</button>
  <button type="button" class="key" data-k="4">4</button><button type="button" class="key" data-k="5">5</button><button type="button" class="key" data-k="6">6</button><button type="button" class="key" data-k="cur" id="kCur">$ → ¥</button>
  <button type="button" class="key" data-k="1">1</button><button type="button" class="key" data-k="2">2</button><button type="button" class="key" data-k="3">3</button><button type="button" class="key go" data-k="go" id="kGo" disabled>Ring<br>it up</button>
  <button type="button" class="key" data-k="0">0</button><button type="button" class="key" data-k="00">00</button><button type="button" class="key" data-k=".">.</button>
</div>`;

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

// "pre", then every date of the trip.
function dayOptions(trip) {
  if (!trip || !trip.start || !trip.end) return ["pre"];
  const utc = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const out = ["pre"];
  for (let t = utc(trip.start), end = utc(trip.end); t <= end; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// The amount as stored, back as the keys would have typed it.
function typedAmount(e) {
  if (e.currency === "JPY") return String(Math.round(e.amount));
  const cents = Math.round(e.amount * 100);
  return cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Whether two lines split differently: who shares it, the mode, or anyone's
// part or amount. Order does not count (the Sheet may hold another order).
function splitDiffers(a, b) {
  const mode = (x) => (x.splitMode === "parts" || x.splitMode === "exact" ? x.splitMode : "equal");
  if (mode(a) !== mode(b) || a.split.length !== b.split.length) return true;
  const val = (x, n) => (mode(x) === "equal" ? null : x.splitVals[x.split.indexOf(n)]);
  return a.split.some((n) => !b.split.includes(n) || val(a, n) !== val(b, n));
}
const calm = () => globalThis.matchMedia && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function mountRegister(root, store, { now = () => Date.now(), storage = defaultStorage(), onClose = () => {} } = {}) {
  const reg = el("div", "reg");
  reg.id = "reg";
  reg.setAttribute("role", "dialog");
  reg.setAttribute("aria-label", "Ring up an expense");
  reg.inert = true;
  reg.innerHTML = MARKUP;
  root.append(reg);
  const $ = (id) => reg.querySelector("#" + id);
  const what = $("xWhat");
  const amtOut = $("xAmt");
  const go = $("kGo");
  const chips = $("xQuick");
  const payerSeals = $("xPayer");
  const splitSeals = $("xSplit");
  const unevenBtn = $("xUneven");
  const view = () => root.querySelector("#vMoney");

  chips.replaceChildren(
    ...CHIPS.map((c) => {
      const b = el("button", "chip", c.label);
      b.type = "button";
      b.dataset.q = c.label;
      return b;
    }),
  );

  // Older versions remembered the last currency here; a new expense now always
  // starts in dollars, so the leftover is cleared once.
  try {
    if (storage) storage.removeItem("mat.cur");
  } catch {
    // storage missing or blocked: nothing to clear
  }

  const names = () => store.state.people.map((p) => p.name);
  const me = () => store.state.me || names()[0] || "";
  const today = () => (store.state.trip && store.state.trip.start ? defaultRingDay(store.state.trip, now()) : "pre");

  // tagged: the label whose kind the line carries while its title still reads so.
  const blank = () => ({ amt: "", tagged: null, split: names(), mode: null, parts: {}, exact: {} });
  let draft = { ...blank(), editId: null, orig: null, cur: "CAD", payer: "", day: "pre", rate: null };
  let opened = false;
  let peopleShown = "";
  let whyOpen = false; // the reasoning under the whose-turn line
  let turnShown = null; // signature of the last drawing of the line

  const uneven = mountUneven(reg, { onChange: render });

  function resetLine() {
    Object.assign(draft, blank());
    what.value = "";
    uneven.close();
  }

  function startFresh(day) {
    resetLine();
    Object.assign(draft, { editId: null, orig: null, cur: "CAD", payer: me(), day: day || today() });
  }

  const kindNow = () => (draft.tagged && what.value.trim() === draft.tagged.label ? draft.tagged.kind : "");
  const rate = () => (draft.orig ? draft.orig.rate : store.state.rateToday);

  function drawSeals() {
    const people = store.state.people;
    const sig = JSON.stringify(people.map((p) => [p.name, p.initials, p.photo || ""]));
    if (sig === peopleShown) return;
    peopleShown = sig;
    const seals = (label) =>
      people.map((p) => {
        const b = fillSeal(el("button", "seal"), p);
        b.type = "button";
        b.dataset.p = p.name;
        b.setAttribute("aria-label", label(p.name));
        return b;
      });
    payerSeals.replaceChildren(...seals((n) => n + " paid"));
    splitSeals.replaceChildren(...seals((n) => "Split with " + n));
  }

  // The whose-turn line (js/turn.js): who has paid the most so far against
  // their share, and on a tap the reasoning. Names go in as textContent.
  function drawTurn() {
    const s = store.state;
    const res = paidMost(names(), s.expenses, s.payments);
    const line = $("xTurn");
    const why = $("xWhy");
    if (!res) whyOpen = false;
    const sig = JSON.stringify([res, s.me, s.people.map((p) => [p.name, p.initials, p.photo || ""]), whyOpen]);
    if (sig === turnShown) return;
    turnShown = sig;
    line.hidden = !res;
    line.setAttribute("aria-expanded", String(whyOpen));
    why.hidden = !whyOpen;
    if (!res) {
      $("xTurnL").replaceChildren();
      why.replaceChildren();
      return;
    }
    const shown = lineNames(res, s.me);
    const label = $("xTurnL");
    label.replaceChildren("Paid the most so far: ");
    shown.forEach((n, i) => label.append(...(i ? [" and "] : []), el("b", "", n)));
    if (!whyOpen) {
      why.replaceChildren();
      return;
    }
    const top = el("div", "ws-t");
    const close = el("button", "", "Close");
    close.type = "button";
    close.id = "xWhyX";
    top.append(el("span", "", "Paid so far, against each share"), close);
    const rows = res.rows.map((r, i) => {
      const row = el("div", "ws-r");
      const person = s.people.find((p) => p.name === r.name);
      const t = reasonText(r, s.me, i === 0, dollars);
      const body = el("div");
      body.append(el("div", "ws-n", t.head));
      if (t.sub) body.append(el("div", "ws-s", t.sub));
      const c = shareCard(r.put, r.share);
      if (c) {
        const card = el("div", "ws-card");
        card.setAttribute("aria-hidden", "true");
        for (let k = 0; k < 10; k++) card.append(el("i", k < c.full ? "f" : k === c.full && c.half ? "h" : ""));
        if (c.more) card.append(el("em", "", "+" + c.more));
        body.append(card);
      }
      row.append(fillSeal(el("span", "mini"), person, r.name, { named: true }), body);
      return row;
    });
    why.replaceChildren(top, ...rows, el("p", "ws-x", WHY_NOTE));
    fitWhy();
  }

  // The reasoning sits under the line and pushes the register up, as far as
  // there is room above it; its rows scroll past that. With too little room
  // it lies over the seals and keys instead. Held sideways it always takes
  // the keys' column (css/register.css).
  function fitWhy() {
    const why = $("xWhy");
    const phone = reg.parentElement;
    reg.classList.remove("why-over");
    why.style.removeProperty("--why-room");
    if (why.hidden || !phone || (globalThis.matchMedia && globalThis.matchMedia(SIDEWAYS).matches)) return;
    const base = reg.offsetHeight - why.offsetHeight - 8; // 8: its margin above
    const room = phone.clientHeight - base - 16;
    if (room >= WHY_MIN_ROOM) {
      why.style.setProperty("--why-room", room + "px");
      return;
    }
    const line = $("xTurn");
    reg.classList.add("why-over");
    reg.style.setProperty("--why-top", line.offsetTop + line.offsetHeight + 8 + "px");
  }

  function canGo() {
    const units = toUnits(draft.amt, draft.cur);
    return units > 0 && units <= MAX_UNITS[draft.cur] && what.value.trim() !== "" && splitOf(draft).ok;
  }

  function render() {
    drawSeals();
    drawTurn();
    draft.rate = rate();
    const units = toUnits(draft.amt, draft.cur);
    const sym = draft.cur === "JPY" ? "¥" : "$";
    const shown = draft.amt === "" ? "0" : draft.amt.replace(/^\d+/, (w) => String(Number(w)).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
    amtOut.innerHTML = pt(sym + shown);
    $("kCur").textContent = draft.cur === "JPY" ? "¥ → $" : "$ → ¥";
    $("xDay").textContent = dayShort(draft.day);
    const opts = dayOptions(store.state.trip);
    const i = opts.indexOf(draft.day);
    $("dPrev").disabled = i <= 0;
    $("dNext").disabled = i === -1 || i >= opts.length - 1;

    const split = splitOf(draft);
    let conv = "";
    if (units > 0 && split.mode !== "equal") conv = "uneven";
    else if (units > 0) {
      conv = "÷" + draft.split.length;
      if (draft.rate > 0) conv += "  ≈ " + (draft.cur === "JPY" ? dollars(Math.round((units / draft.rate) * 100)) : yen(Math.round((units / 100) * draft.rate)));
    }
    $("xConv").textContent = conv;
    unevenBtn.classList.toggle("is-on", split.mode !== "equal");

    const kind = kindNow();
    for (const b of chips.children) b.classList.toggle("is-on", !!kind && b.dataset.q === draft.tagged.label);
    for (const b of payerSeals.children) b.classList.toggle("is-on", b.dataset.p === draft.payer);
    for (const b of splitSeals.children) b.classList.toggle("is-on", draft.split.includes(b.dataset.p));

    $("regTitle").textContent = draft.editId ? "Change this line" : "Ring up";
    if (draft.editId) go.textContent = "Save";
    else go.replaceChildren("Ring", el("br"), "it up");
    go.disabled = !canGo();
    uneven.render(draft);
  }

  // ---- keys ----

  function press(k) {
    if (k === "go") return ringUp();
    if (k === "cur") {
      draft.cur = draft.cur === "JPY" ? "CAD" : "JPY";
      if (draft.cur === "JPY") {
        draft.amt = draft.amt.split(".")[0];
        for (const n of Object.keys(draft.exact)) draft.exact[n] = draft.exact[n].split(".")[0];
      }
    } else if (k === "del") {
      draft.amt = draft.amt.slice(0, -1);
    } else if (k === ".") {
      if (draft.cur === "CAD" && !draft.amt.includes(".")) draft.amt = (draft.amt || "0") + ".";
    } else {
      // Append as much of the key as fits: two decimals, eight digits.
      const dec = draft.amt.split(".")[1];
      let add = dec === undefined ? k : k.slice(0, 2 - dec.length);
      add = add.slice(0, MAX_DIGITS - draft.amt.replace(".", "").length);
      // Nothing past the backend's limit: as much of the key as stays within it.
      while (add && toUnits(draft.amt + add, draft.cur) > MAX_UNITS[draft.cur]) add = add.slice(0, -1);
      if (!add) return;
      draft.amt += add;
      if (/^0+$/.test(draft.amt)) draft.amt = "";
    }
    showGap();
    render();
  }

  // Exact amounts that no longer add up: open the panel on what is left to assign.
  function showGap() {
    if (draft.mode === "exact" && toUnits(draft.amt, draft.cur) > 0 && !splitOf(draft).ok) uneven.open();
  }

  // The line as the backend takes it.
  function fields() {
    const units = toUnits(draft.amt, draft.cur);
    const split = splitOf(draft);
    return {
      day: draft.day, title: what.value.trim(), amount: fromUnits(units, draft.cur), currency: draft.cur,
      paidBy: draft.payer, split: draft.split.slice(), splitMode: split.mode, splitVals: split.vals, kind: kindNow(),
    };
  }

  function ringUp() {
    if (!canGo()) return;
    const line = fields();
    if (draft.editId) {
      const patch = {};
      for (const k of FIELDS) if (!same(line[k], draft.orig[k])) patch[k] = line[k];
      if (splitDiffers(line, draft.orig)) Object.assign(patch, { split: line.split, splitMode: line.splitMode, splitVals: line.splitVals });
      try {
        if (Object.keys(patch).length) store.updateExpense(draft.editId, patch);
      } finally {
        close();
      }
      return;
    }
    // What stops a second tap is the reset: once the line is handed over the
    // amount is empty, so #kGo is disabled. It happens even if drawing the
    // line throws, so a retap can never send the same line twice.
    const id = newId();
    try {
      store.addExpense({ id, ...line, note: "" }); // draws the line before it returns
    } finally {
      resetLine();
      draft.cur = "CAD"; // the next entry is a new expense
      render();
    }
    printLine(id);
  }

  // ---- placing things in view ----

  // Scrolls the Money view so `bottom` (a y on screen) clears the register.
  function clear(bottom) {
    const v = view();
    if (!v) return;
    const regTop = v.getBoundingClientRect().bottom - reg.offsetHeight;
    const over = bottom - (regTop - 16);
    if (over > 0) v.scrollBy({ top: over, behavior: calm() ? "auto" : "smooth" });
  }

  function printLine(id) {
    const row = root.querySelector('#rc .rc-row[data-id="' + id + '"]');
    if (!row) return;
    const bottom = row.getBoundingClientRect().bottom; // before the reveal starts it at no height
    row.classList.add("print");
    clear(bottom);
  }

  function showDay(day) {
    const group = root.querySelector('#rc .rc-group[data-day="' + day + '"]');
    if (group) clear(group.getBoundingClientRect().bottom);
  }

  // ---- open and close ----

  function show() {
    opened = true;
    reg.inert = false;
    reg.classList.add("is-open");
    root.classList.add("reg-open");
    render();
    const v = view();
    if (v) v.style.paddingBottom = 96 + reg.offsetHeight + "px";
    showDay(draft.day);
  }

  function open(day) {
    if (draft.editId) startFresh(day);
    else {
      if (!names().includes(draft.payer)) draft.payer = me();
      if (!draft.split.length) draft.split = names();
      draft.day = day || today();
      // A half-typed entry put away with Done keeps its own currency, so its
      // digits never change meaning; an empty one starts in dollars.
      if (draft.amt === "") draft.cur = "CAD";
    }
    show();
  }

  function edit(id) {
    const e = store.state.expenses.find((x) => x.id === id && !x.deleted);
    if (!e) return false;
    resetLine();
    const mode = e.splitMode === "parts" || e.splitMode === "exact" ? e.splitMode : null;
    Object.assign(draft, {
      editId: id, orig: { ...e }, amt: typedAmount(e), cur: e.currency, payer: e.paidBy, day: e.day,
      split: names().filter((n) => e.split.includes(n)), tagged: { label: e.title, kind: e.kind || "" }, mode,
    });
    e.split.forEach((n, i) => {
      const v = e.splitVals[i];
      if (mode === "parts") draft.parts[n] = v;
      if (mode === "exact") draft.exact[n] = e.currency === "JPY" ? String(v) : typedAmount({ currency: "CAD", amount: v });
    });
    what.value = e.title;
    show();
    return true;
  }

  function close() {
    if (!opened) return;
    opened = false;
    stopHold();
    if (draft.editId) startFresh();
    uneven.close();
    whyOpen = false;
    drawTurn();
    reg.classList.remove("is-open");
    reg.inert = true;
    root.classList.remove("reg-open");
    const v = view();
    if (v) v.style.paddingBottom = "";
    if (reg.contains(document.activeElement)) document.activeElement.blur();
    onClose();
  }

  // ---- taps ----

  $("pad").addEventListener("click", (ev) => {
    const b = ev.target.closest(".key");
    if (b && !b.disabled) press(b.dataset.k);
  });
  $("regDone").addEventListener("click", close);
  $("xTurn").addEventListener("click", () => {
    whyOpen = !whyOpen;
    drawTurn();
  });
  $("xWhy").addEventListener("click", (ev) => {
    if (!ev.target.closest("#xWhyX")) return;
    whyOpen = false;
    drawTurn();
    $("xTurn").focus({ preventScroll: true });
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !opened) return;
    // WIDE: Escape is the top-most panel's Done, so the uneven panel's own first.
    if (isWide() && uneven.isOpen()) $("unDone").click();
    else close();
  });
  // WIDE: a computer's keyboard is the register's keys while it is open and
  // nothing is being typed into a field: digits, "." (or ","), Backspace (⌫) and Enter
  // (Ring it up). Enter on a button reached with Tab presses that button; on
  // one last clicked with the mouse (a chip, a key) it is still Ring it up.
  let tabbed = false; // the focus was last moved by Tab, not by a click
  document.addEventListener("pointerdown", () => {
    tabbed = false;
  }, true);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Tab") tabbed = true;
    // keyCode 229: an input method is at work (Safari confirms a conversion with Enter and isComposing false).
    if (!opened || ev.defaultPrevented || ev.isComposing || ev.keyCode === 229 || ev.ctrlKey || ev.metaKey || ev.altKey || !isWide()) return;
    const at = ev.target instanceof Element ? ev.target : null;
    if (at && at.closest("input, textarea, select, [contenteditable]")) return;
    let k = null;
    // The decimal point: "." or, from a numpad that types a comma, ",".
    if (/^[0-9]$/.test(ev.key) || ev.key === ".") k = ev.key;
    else if (ev.key === ",") k = ".";
    else if (ev.key === "Backspace") k = "del";
    else if (ev.key === "Enter" && !(tabbed && at && at.closest("button, a"))) k = "go";
    if (!k) return;
    ev.preventDefault();
    press(k);
  });
  what.addEventListener("input", render);
  what.addEventListener("keydown", (ev) => {
    // An Enter that confirms a Japanese conversion (isComposing, or keyCode 229
    // in Safari) belongs to the input method: no blur, no ring up.
    if (ev.key !== "Enter" || ev.isComposing || ev.keyCode === 229) return;
    what.blur();
    // WIDE: Enter after the title rings it up, as the keys' Ring it up would.
    if (isWide()) {
      ev.preventDefault();
      press("go");
    }
  });
  chips.addEventListener("click", (ev) => {
    const b = ev.target.closest(".chip");
    if (!b) return;
    const chip = CHIPS.find((c) => c.label === b.dataset.q);
    what.value = chip.label;
    draft.tagged = { ...chip };
    render();
  });
  payerSeals.addEventListener("click", (ev) => {
    const b = ev.target.closest(".seal");
    if (!b) return;
    draft.payer = b.dataset.p;
    render();
  });

  const stepDay = (n) => {
    const opts = dayOptions(store.state.trip);
    const i = opts.indexOf(draft.day) + n;
    if (i >= 0 && i < opts.length) draft.day = opts[i];
    render();
  };
  $("dPrev").addEventListener("click", () => stepDay(-1));
  $("dNext").addEventListener("click", () => stepDay(1));

  function openUneven() {
    if (!draft.mode) draft.mode = "parts";
    uneven.open();
    render();
  }
  unevenBtn.addEventListener("click", openUneven);

  // Split seals: a tap turns a person in or out (never the last one); a
  // 500 ms hold opens the uneven panel instead.
  let holdTimer = null;
  let held = false;
  const stopHold = () => {
    clearTimeout(holdTimer);
    holdTimer = null;
  };
  splitSeals.addEventListener("pointerdown", () => {
    held = false;
    stopHold();
    holdTimer = setTimeout(() => {
      holdTimer = null;
      held = true;
      openUneven();
    }, HOLD_MS);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) splitSeals.addEventListener(type, stopHold);
  splitSeals.addEventListener("contextmenu", (ev) => ev.preventDefault());
  splitSeals.addEventListener("click", (ev) => {
    if (held) {
      held = false;
      return;
    }
    const b = ev.target.closest(".seal");
    if (!b) return;
    const name = b.dataset.p;
    if (draft.split.includes(name)) {
      if (draft.split.length > 1) draft.split = draft.split.filter((n) => n !== name);
    } else {
      draft.split = names().filter((n) => n === name || draft.split.includes(n));
    }
    showGap();
    render();
  });

  // The trip was taken off this phone: the sheet closes, the line being typed
  // goes, and no person or turn stays drawn.
  let wiped = false;
  function wipe() {
    close();
    startFresh();
    peopleShown = "";
    payerSeals.replaceChildren();
    splitSeals.replaceChildren();
    turnShown = null;
    whyOpen = false;
    drawTurn();
  }

  store.subscribe(() => {
    if (store.state.status === "nokey") {
      if (!wiped) {
        wiped = true;
        wipe();
      }
      return;
    }
    wiped = false;
    if (opened) render();
  });
  startFresh();
  render();

  return { open, edit, close, isOpen: () => opened };
}
