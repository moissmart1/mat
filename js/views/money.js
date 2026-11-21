/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The Money screen: where you stand, the settlement slip (js/views/slip.js)
// and the till receipt.
// mountMoney(root, store, { onRing(day), onLine(id), onHistory() }) draws into
// root and redraws on every store change. Every figure comes from money.js and
// format.js; text from people or the Sheet goes in with textContent only.

import { standing, jpyOf, cadCents, shares, expenseShares } from "../money.js";
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

// The export uses the same exchange rates, rounding, and transfers as the slip.
export function settlementSummary(state, exportedAt) {
  const { live, list, bal, simplify } = viewerOwed(state);
  const ageMs = Date.parse(exportedAt) - state.loadedAt;
  const hasLoad = Number.isFinite(state.loadedAt);
  const fresh = hasLoad && ageMs >= 0 && ageMs <= 60000;
  return {
    trip: state.trip.name,
    exportedAt,
    lastLoadedAt: hasLoad ? new Date(state.loadedAt).toISOString() : null,
    settlementCurrency: "CAD",
    simplified: simplify,
    online: state.online,
    provisional: !state.online || !fresh || [...state.expenses, ...state.payments].some((row) => row.pending || row.failed),
    excludedRows: (state.setAside || []).length,
    expenses: live.map((e) => ({
      day: e.day, description: e.title, paidBy: e.paidBy, amount: e.amount,
      currency: e.currency, rate: e.rate, cadCents: cadCents(e),
      splitMode: e.splitMode || "equal", split: [...e.split], splitValues: [...(e.splitVals || [])],
      sharesCadCents: expenseShares(e),
    })),
    payments: state.payments.filter((p) => !p.removed).map((p) => ({
      from: p.from, to: p.to, cadCents: Math.round(p.cad * 100), recordedAt: p.stampedAt,
    })),
    balances: bal,
    transfers: list.map(({ from, to, cents }) => ({ from, to, cents })),
  };
}

export function summaryText(summary) {
  const lines = [summary.trip + " — Settlement summary", "Amounts in CAD unless labelled otherwise.",
    "Prepared " + summary.exportedAt, "Last loaded " + (summary.lastLoadedAt || "unknown")];
  if (summary.provisional) lines.push("Provisional: pending changes or figures awaiting refresh.");
  if (summary.excludedRows) lines.push("Unreadable rows excluded: " + summary.excludedRows);
  lines.push("", "Expenses");
  for (const e of summary.expenses) {
    lines.push(e.day + " · " + e.description + " · " + e.paidBy + " paid " + e.amount + " " + e.currency +
      " (" + dollars(e.cadCents) + " CAD, " + e.rate + " JPY/CAD)");
    lines.push("  " + e.splitMode + " split: " + Object.entries(e.sharesCadCents).map(([who, cents]) => who + " " + dollars(cents)).join(", "));
  }
  if (!summary.expenses.length) lines.push("None");
  lines.push("", "Recorded payments");
  for (const p of summary.payments) lines.push(p.from + " → " + p.to + "  " + dollars(p.cadCents));
  if (!summary.payments.length) lines.push("None");
  lines.push("", "Balances");
  for (const [who, cents] of Object.entries(summary.balances)) lines.push(who + " " +
    (cents < 0 ? "owes " : cents > 0 ? "is owed " : "") + dollars(Math.abs(cents)));
  lines.push("", summary.simplified ? "Remaining transfers (simplified)" : "Remaining transfers");
  for (const t of summary.transfers) lines.push(t.from + " → " + t.to + "  " + dollars(t.cents));
  if (!summary.transfers.length) lines.push("All settled");
  return lines.join("\n");
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

function drawReceipt(rc, s, live, ctx) {
  const head = el("div", "rc-h");
  head.append(el("b", "", issuer(s.people)), document.createTextNode([s.trip.name, tripSpan(s.trip)].filter(Boolean).join(", ")));
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
  const days = receiptDays(s, live, ctx.nowMs).map((day) => drawDay(day, newestFirst.filter((e) => e.day === day), ctx));

  const totalYen = sum(live, jpyOf);
  const tot = el("div", "rc-tot");
  tot.append(el("span", "", "合計 Total"), fig("b", "", yen(totalYen)));
  const inDollars = el("div", "rc-sub");
  inDollars.append(el("span", "", "in dollars"), fig("b", "", dollars(sum(live, cadCents))));
  const each = el("div", "rc-sub");
  each.append(el("span", "", "1人あたり each, about"), fig("b", "", yen(shares(totalYen, ctx.names)[ctx.names[0]])));
  const foot = el("div", "rc-f");
  foot.append(el("i", "", "毎度ありがとうございます"), document.createTextNode("Thank you, come again."), el("div", "bars"));

  rc.replaceChildren(head, el("div", "rule"), ...days, tot, inDollars, each, el("div", "rule"), foot);
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
  const summary = el("details", "settlement-summary");
  const content = el("pre");
  const download = el("button", "", "Download text");
  download.type = "button";
  summary.append(el("summary", "", "Settlement summary"), content, download);
  const refreshSummary = () => {
    content.textContent = summaryText(settlementSummary(store.state, new Date().toISOString()));
  };
  summary.addEventListener("toggle", () => { if (summary.open && !summary.hidden) refreshSummary(); });
  download.addEventListener("click", () => {
    refreshSummary();
    const url = URL.createObjectURL(new Blob([content.textContent + "\n"], { type: "text/plain;charset=utf-8" }));
    const link = el("a");
    link.href = url;
    link.download = "settlement-summary.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  root.replaceChildren(top, slip, rc, summary);
  mountSlip(slip, store);

  histBtn.addEventListener("click", () => onHistory());
  const act = (target) => {
    if (target.closest("#fresh")) return store.refresh();
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
      summary.hidden = true;
      content.textContent = "";
      rc.replaceChildren();
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

    drawReceipt(rc, s, live, ctx);
    summary.hidden = false;
    if (summary.open) refreshSummary();
  }

  render(store.state);
  store.subscribe(render);
}
