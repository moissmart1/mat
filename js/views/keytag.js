/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The key tag (鍵札, S2 of the stay-ticket mock-up, which Mo picked): a
// ryokan's wooden room tag on a red cord, the booking's number on a paper
// label tied to it. The small tag hangs on the hotel card
// (js/views/staycard.js) and on the hook at the top of the pass case
// (js/views/passcase.js); the big one is on the booking held up
// (js/views/stub.js). Decoration only: every tag is aria-hidden, and the words
// beside it say the same.
//
// - cord(w, h, style): the red cord, an inline SVG; style: { left, marginLeft, top }.
// - notches(night): one notch per night (up to 7; more nights, none), filled
//   for the nights reached; null when there are none to draw.
// - tagSmall(ref, night): the 92 px tag: 宿, the reference on its label
//   ("予約番号" and the ref, or "予約" and "Booking"), the notches and the
//   nights ("1 / 3泊"; "3泊" before the first night and after the last).
// - nightsShort(night), nightsLong(night): the words for the night.
// night is js/plan.js nightOf's { total, n, state }. Text goes in with
// textContent.

const SVG = "http://www.w3.org/2000/svg";
export const MAX_NOTCHES = 7;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function cord(w, h, style) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "kt-cord");
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.setAttribute("viewBox", "0 0 " + w + " " + h);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  // Through the style object, never a style attribute (the page's CSP refuses those).
  if (style) for (const [k, v] of Object.entries(style)) svg.style[k] = v;
  const m = w / 2;
  const d = "M" + (m - 7) + " " + h + " C " + (m - 16) + " " + h * 0.35 + ", " + (m - 4) + " 4, " + m + " 4 S " + (m + 16) + " " + h * 0.35 + ", " + (m + 7) + " " + h;
  for (const [stroke, width, dash] of [["#8E2B1B", "3.2", ""], ["#D85A3F", "1", "2 3"]]) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", stroke);
    p.setAttribute("stroke-width", width);
    p.setAttribute("stroke-linecap", "round");
    if (dash) p.setAttribute("stroke-dasharray", dash);
    svg.append(p);
  }
  return svg;
}

// How many nights are reached: none before the first, all after the last.
const reached = (night) => (night.state === "before" ? 0 : night.state === "after" ? night.total : night.n);

export function notches(night) {
  if (!night || !(night.total > 0) || night.total > MAX_NOTCHES) return null;
  const box = el("div", "kt-notch");
  const on = reached(night);
  for (let i = 0; i < night.total; i++) box.append(el("i", i < on ? "is-on" : ""));
  return box;
}

// "1 / 3泊" on a night of the stay; "3泊" before it and after it.
export function nightsShort(night) {
  if (!night || !(night.total > 0)) return "";
  return night.state === "on" ? night.n + " / " + night.total + "泊" : night.total + "泊";
}

// "Night 1 of 3" on a night of the stay; "3 nights" (or "1 night") before it and after it.
export function nightsLong(night) {
  if (!night || !(night.total > 0)) return "";
  if (night.state === "on") return "Night " + night.n + " of " + night.total;
  return night.total + (night.total === 1 ? " night" : " nights");
}

export function tagSmall(ref, night) {
  const wrap = el("div", "kt-wrap");
  wrap.setAttribute("aria-hidden", "true");
  const tag = el("div", "kt sm");
  tag.append(el("span", "kt-hole"), el("div", "kt-yado kt-burn", "宿"));
  const label = el("div", "kt-ref");
  const r = typeof ref === "string" ? ref.trim() : "";
  label.append(el("small", "", r ? "予約番号" : "予約"), el("span", "", r || "Booking"));
  tag.append(label);
  const n = notches(night);
  if (n) tag.append(n);
  tag.append(el("div", "kt-nights kt-burn", nightsShort(night)));
  wrap.append(cord(40, 34, { left: "50%", marginLeft: "-20px", top: "-22px" }), tag);
  return wrap;
}
