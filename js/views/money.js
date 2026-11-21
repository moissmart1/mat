/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The Money screen: where you stand, the settlement slip (js/views/slip.js)
// and the till receipt.
// mountMoney(root, store, { onRing(day), onLine(id), onHistory() }) draws into
// root and redraws on every store change. Every figure comes from money.js and
// format.js; text from people or the Sheet goes in with textContent only.

import { standing, jpyOf, cadCents, shares } from "../money.js";
import { tripDay } from "../time.js";
import { tripNow } from "../plan.js";
import { mountSlip, viewerOwed } from "./slip.js";
import { yen, dollars, typed, dayHead, issuer, pt, freshText, sentence, tripSpan } from "../format.js";
import { fillSeal } from "../picture.js";

const UNREACHABLE = "Couldn’t reach the trip sheet.";
const STAND_IN_RATE = "Yen is being converted at a stand-in rate of 111. Tell Mo.";

// The one line about Sheet rows the app has left out (store.state.setAside).
export function setAsideText(list) {
  if (!list || !list.length) return "";
  const why = [...new Set(list.map((x) => (x.reason === "name" ? "a name the app doesn’t know" : "an amount the app can’t read")))].join(", or ");
  return list.length === 1
    ? "1 line in the Sheet can’t be read (" + why + "). It’s left out of the totals. Tell Mo."
    : list.length + " lines in the Sheet can’t be read (" + why + "). They’re left out of the totals. Tell Mo.";
}

// Find an item on the receipt (issue 26): pure helpers, no DOM.
export function findQuery(raw) {
  return String(raw ?? "").trim();
}
export function findLines(lines, q) {
  if (!q) return lines;
  const low = q.toLowerCase();
  return lines.filter((e) => String(e.title ?? "").toLowerCase().includes(low));
}
export function findCount(shown, total) {
  return "Showing " + shown + " of " + total + (total === 1 ? " item" : " items");
}
export function noItemText(q) {
  return "No item says \u201c" + q + "\u201d.";
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// An element whose content is a figure: pt() escapes it before adding spans.
function fig(tag, cls, str) {
  const n = el(tag, cls);
  n.innerHTML = pt(str);
  return n;
}

const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
const after = (iso, ms) => ms !== null && typeof iso === "string" && Date.parse(iso) > ms;

// Added by someone else since the viewer last looked.
export function isNewLine(e, me, seenAt) {
  return !!e.addedBy && e.addedBy !== me && after(e.addedAt, seenAt);
}

function isNewStamp(p, me, seenAt) {
  return !p.removed && !!p.stampedBy && p.stampedBy !== me && after(p.stampedAt, seenAt);
}

// Each trip day up to today (all of them after the trip) and any later day
// that already has a line, newest first; then "pre", the oldest, at the bottom.
function receiptDays(s, live, nowMs) {
  const today = tripDay(s.trip, nowMs, tripNow(s, nowMs).date);
  const dates = new Set();
  for (const d of s.days) {
    if (d.date && (today === "post" || (today !== "pre" && d.date <= today))) dates.add(d.date);
  }
  for (const e of live) if (e.day !== "pre") dates.add(e.day);
  return [...[...dates].sort().reverse(), "pre"];
}

function drawLine(e, ctx) {
  const row = el("div", "rc-row");
  row.dataset.id = e.id;
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  if (e.pending) row.classList.add("is-pending");
  if (e.failed) row.classList.add("is-failed");
  if (isNewLine(e, ctx.me, ctx.seenAt)) row.classList.add("is-new");

  const payer = ctx.people.find((p) => p.name === e.paidBy);
  const t = el("span", "rc-t", e.title);
  if (e.note) t.append(el("small", "rc-note", e.note));
  const only = !ctx.names.every((n) => e.split.includes(n));
  const uneven = !!e.splitMode && e.splitMode !== "equal";
  if (only || uneven) {
    // "Ajen + Trenton only · uneven", the names in bold
    const small = el("small");
    if (only) {
      e.split.forEach((n, i) => small.append(...(i ? [" + "] : []), el("b", "", n)));
      small.append(" only");
    }
    if (uneven) small.append((only ? " · " : "") + "uneven");
    t.append(small);
  }
  if (e.failed) t.append(el("small", "rc-fail", "not saved, tap to retry"));
  else if (e.pending && !ctx.online) t.append(el("small", "rc-wait", "will send when signal returns"));
  row.append(fillSeal(el("span", "mini"), payer, e.paidBy, { named: true }), t, fig("span", "rc-amt", typed(e)));
  return row;
}

function drawDay(day, lines, ctx) {
  const group = el("section", "rc-group");
  group.dataset.day = day;
  const h = dayHead(day, ctx.days);
  const head = el("div", "rc-day");
  head.append(el("span", "", h.en), el("i", "", h.jp));
  if (h.city) head.append(el("span", "rc-city", h.city));
  group.append(head);
  if (!lines.length) {
    const empty = el("div", "rc-empty");
    const add = el("button", "", "Ring up");
    add.type = "button";
    add.dataset.addday = day;
    empty.append(el("span", "", "Nothing rung up yet"), add);
    group.append(empty);
  } else {
    for (const e of lines) group.append(drawLine(e, ctx));
    const sub = el("div", "rc-sub");
    sub.append(el("span", "", "小計 subtotal"), fig("b", "rc-cad", dollars(sum(lines, cadCents))), fig("b", "", yen(sum(lines, jpyOf))));
    group.append(sub);
  }
  group.append(el("div", "rule"));
  return group;
}

// parts = { head, find }: two nodes built once in mountMoney. The header is
// refilled on every draw; the find line (with the real input) is never rebuilt,
// moved or re-appended, so the keyboard and caret survive every redraw.
function drawReceipt(rc, s, live, ctx, parts, query) {
  const head = parts.head;
  head.replaceChildren(el("b", "", issuer(s.people)), document.createTextNode([s.trip.name, tripSpan(s.trip)].filter(Boolean).join(", ")));
  head.append(el("div", "rc-no", "レシート No." + String(live.length).padStart(4, "0")));
  if (s.loadedAt !== null) {
    const fresh = el("button", "rc-fresh", freshText(s.loadedAt));
    fresh.type = "button";
    fresh.id = "fresh";
    head.append(fresh);
  }

  // Newest line first. Sorted oldest first (the sort is stable) and then turned
  // over, so lines with the same time also flip: a later Sheet row sits higher.
  const newestFirst = live.slice().sort((a, b) => ((a.addedAt || "") < (b.addedAt || "") ? -1 : (a.addedAt || "") > (b.addedAt || "") ? 1 : 0)).reverse();
  const matches = findLines(newestFirst, query);
  const matchDays = new Set(matches.map((e) => e.day));
  const days = receiptDays(s, live, ctx.nowMs)
    .filter((day) => !query || matchDays.has(day))
    .map((day) => drawDay(day, matches.filter((e) => e.day === day), ctx));
  if (query && !matches.length) {
    const none = el("div", "rc-empty rc-none");
    const all = el("button", "", "Show all");
    all.type = "button";
    all.id = "rcShowAll";
    none.append(el("span", "", noItemText(query)), all);
    days.push(none, el("div", "rule"));
  }

  const totalYen = sum(live, jpyOf);
  const tot = el("div", "rc-tot");
  tot.append(el("span", "", query ? "合計 Trip total" : "合計 Total"), fig("b", "", yen(totalYen)));
  const inDollars = el("div", "rc-sub");
  inDollars.append(el("span", "", "in dollars"), fig("b", "", dollars(sum(live, cadCents))));
  const each = el("div", "rc-sub");
  each.append(el("span", "", "1人あたり each, about"), fig("b", "", yen(shares(totalYen, ctx.names)[ctx.names[0]])));
  const foot = el("div", "rc-f");
  foot.append(el("i", "", "毎度ありがとうございます"), document.createTextNode("Thank you, come again."), el("div", "bars"));

  // The frame only when it is not already there (first draw, or after the
  // no-trip branch emptied #rc). Everything below the find line's rule is
  // thrown away and drawn again; nothing at or above it is touched.
  if (parts.find.parentNode !== rc) rc.replaceChildren(parts.head, el("div", "rule"), parts.find, el("div", "rule"));
  const mark = parts.find.nextSibling;
  while (mark.nextSibling) mark.nextSibling.remove();
  rc.append(...days, tot, inDollars, each, el("div", "rule"), foot);
  return { shown: matches.length, total: live.length };
}

export function mountMoney(root, store, { onRing = () => {}, onLine = () => {}, onHistory = () => {}, now = () => Date.now() } = {}) {
  const say = el("h1");
  say.id = "say";
  const sayP = el("p");
  sayP.id = "sayP";
  const histBtn = el("button", "hist-btn", "履歴 History");
  histBtn.type = "button";
  histBtn.id = "histBtn";
  const histN = el("span", "hist-n");
  histN.id = "histN";
  histN.hidden = true;
  histBtn.append(histN);
  const top = el("div", "say");
  // Plain warnings about the figures, under the trip summary: a stand-in rate,
  // and Sheet rows left out of the totals.
  const rateNote = el("p", "say-warn");
  rateNote.id = "rateNote";
  rateNote.hidden = true;
  const asideNote = el("p", "say-warn");
  asideNote.id = "asideNote";
  asideNote.setAttribute("role", "status");
  asideNote.hidden = true;
  const provisionalNote = el("p", "say-warn", "Provisional balance. Some changes haven’t synced.");
  provisionalNote.id = "moneyProvisional";
  provisionalNote.setAttribute("role", "status");
  provisionalNote.hidden = true;
  top.append(say, provisionalNote, sayP, rateNote, asideNote, histBtn);
  const slip = el("div", "slip cf");
  slip.id = "slip";
  const rc = el("div", "rc");
  rc.id = "rc";
  const rcHead = el("div", "rc-h");
  const find = el("div", "rc-find");
  find.id = "rcFind";
  find.setAttribute("role", "search");
  const findRow = el("div", "rc-find-row");
  const findL = el("label", "rc-find-l");
  findL.htmlFor = "rcQuery";
  const findJa = el("i", "", "品名");
  findJa.lang = "ja";
  findJa.setAttribute("aria-hidden", "true");
  findL.append(findJa, document.createTextNode("Find"));
  const input = el("input", "rc-q");
  input.id = "rcQuery";
  input.type = "search";
  input.placeholder = "an item, like ramen";
  input.setAttribute("aria-label", "Find an item on the receipt");
  input.setAttribute("aria-describedby", "rcFindN");
  input.autocomplete = "off";
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  input.spellcheck = false;
  input.setAttribute("enterkeyhint", "search");
  const clear = el("button", "rc-clr", "Clear");
  clear.type = "button";
  clear.id = "rcClear";
  clear.hidden = true;
  findRow.append(findL, input, clear);
  const count = el("p", "rc-find-n");
  count.id = "rcFindN";
  count.setAttribute("role", "status");
  count.setAttribute("aria-live", "polite");
  count.hidden = true;
  find.append(findRow, count);
  const parts = { head: rcHead, find };
  root.replaceChildren(top, slip, rc);
  mountSlip(slip, store);

  histBtn.addEventListener("click", () => onHistory());
  const act = (target) => {
    if (target.closest("#fresh")) return store.refresh();
    if (target.closest("#rcClear, #rcShowAll")) return clearFind();
    const add = target.closest("[data-addday]");
    if (add) return onRing(add.dataset.addday);
    const row = target.closest(".rc-row[data-id]");
    if (!row) return;
    onLine(row.dataset.id);
  };
  rc.addEventListener("click", (ev) => act(ev.target));
  rc.addEventListener("keydown", (ev) => {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches(".rc-row[data-id]")) {
      ev.preventDefault();
      act(ev.target);
    }
  });

  function clearFind() {
    input.value = "";
    render(store.state);
    input.focus({ preventScroll: true });
  }

  function syncFind(shown, total) {
    const q = findQuery(input.value);
    clear.hidden = !q;
    const words = q ? findCount(shown, total) : "";
    if (count.textContent !== words) count.textContent = words;
    count.hidden = !q;
  }

  function render(s) {
    const names = s.people.map((p) => p.name);
    if (!s.trip || !s.trip.start || !names.length) {
      say.textContent = "";
      sayP.textContent = s.status === "error" ? UNREACHABLE : "";
      provisionalNote.hidden = true;
      rateNote.hidden = true;
      asideNote.hidden = true;
      histBtn.hidden = true;
      slip.hidden = true;
      input.value = "";
      rc.replaceChildren();
      syncFind(0, 0);
      return;
    }
    histBtn.hidden = false;
    slip.hidden = false;
    // The same reading the slip shows (one source: viewerOwed).
    const { live, list, bal, provisional } = viewerOwed(s);
    say.textContent = s.me ? sentence(standing(s.me, list, bal)) : "";
    // Shown whether or not this phone has picked a name, as the slip's own line is:
    // the totals and the slip are just as provisional (#21 review M1).
    provisionalNote.hidden = !provisional;
    // The words stay dim; the three figures are bold and bright.
    sayP.replaceChildren("The trip so far is ", el("b", "", dollars(sum(live, cadCents))), ", about ", el("b", "", yen(sum(live, jpyOf))),
      ", across ", el("b", "", String(live.length)), live.length === 1 ? " receipt." : " receipts.");
    rateNote.hidden = s.rateSource !== "fallback";
    rateNote.textContent = rateNote.hidden ? "" : STAND_IN_RATE;
    const aside = setAsideText(s.setAside);
    asideNote.hidden = !aside;
    asideNote.textContent = aside;

    const ctx = { me: s.me, online: s.online, seenAt: s.seenAt, people: s.people, names, days: s.days, nowMs: now() };
    // The one count of what is new: lines and stamps by someone else since you looked.
    const fresh = live.filter((e) => isNewLine(e, s.me, s.seenAt)).length + s.payments.filter((p) => isNewStamp(p, s.me, s.seenAt)).length;
    histN.textContent = String(fresh);
    histN.hidden = fresh === 0;

    const r = drawReceipt(rc, s, live, ctx, parts, findQuery(input.value));
    syncFind(r.shown, r.total);
  }

  input.addEventListener("input", () => render(store.state));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (!input.value) return;
      ev.preventDefault();
      clearFind();
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      input.blur();
    }
  });
  render(store.state);
  store.subscribe(render);
}
