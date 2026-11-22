/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Is this phone ready for no signal (issue 84)? Pure: no DOM, no storage, no
// clock of its own. Said about THIS storage (Safari's, or the Home Screen
// app's: they are separate). Ready when all four hold:
//  1. the trip is kept here: status "ready", a number loadedAt, and mat.key
//     and mat.cache in the phone's storage (env.kept);
//  2. pictures last here (env.lasting: IndexedDB open);
//  3. every picture still ahead is here (tickets.js aheadPictures: the stay
//     you are in, then every stop and stay from today on, everyone's; not
//     past ones, not deleted or off the plan, not this phone's own waiting
//     to be sent), by env.have(id);
//  4. the app itself opens with no signal (env.shell: a service worker
//     controls the page).
// "Only when I open one" (env.mode "open") never changes the count, only the
// reason given.
//
// phoneReady(state, nowMs, env) -> null (no line anywhere) or
//   { kind, n, total, where, toGo, mode, big, strip, l1, jp, right, key, aria, keyAria, items, sheet }
// env = { have, lasting, mode, shell, kept, standalone, online, fetching, progress, failed, noStore }
// noStore: this window has no lasting storage at all (no IndexedDB, or the
// phone's storage is a stand-in in memory): a private window. Otherwise a
// nokeep is storage that exists but did not answer (WebKit's IndexedDB hang),
// and the words say to close MAT and open it again (never, in the Home
// Screen app, to go to Safari).
// kind, first match wins: nokeep, fetching, wait, failed, missing, setup,
// ready-off, ready. big: the board's face from two days before (null
// otherwise). strip: what the strip at the top says (null: nothing of this).
// track(prev, n, fetching) -> the progress { at, of, left } or null.

import { tripNow, daysToGo } from "./plan.js";
import { aheadPictures } from "./tickets.js";
import { dayHead } from "./format.js";

const AMBER = ["nokeep", "fetching", "wait", "failed", "missing", "setup"];
export const isAmber = (kind) => AMBER.includes(kind);
// The kinds that say pictures are missing while there is signal: they carry a key.
const MISSING = ["missing", "failed", "fetching"];

const pics = (n) => (n === 1 ? "1 picture" : n + " pictures");
const tickets = (n) => (n === 1 ? "1 ticket picture" : n + " ticket pictures");
const ONLY_OPEN = "“Only when I open one”";

export const NOTE = "Each needs signal once. Fetch them now, on Wi‑Fi, and this phone works with no signal.";
export const KEY_JP = "取込";

// Progress of a pass: when one starts, of = n; while it runs, at = of - n + 1
// (never above of; if n grows, of grows with it); no pass, null.
export function track(prev, n, fetching) {
  if (!fetching) return null;
  const left = Math.max(0, n | 0);
  if (!prev) return { at: left > 0 ? 1 : 0, of: left, left };
  const done = Math.max(0, prev.of - prev.left);
  const of = Math.max(prev.of, done + left);
  return { at: Math.min(of, of - left + 1), of, left };
}

function lineWords(kind, n, mode, total, progress) {
  switch (kind) {
    case "ready":
      return { jp: "圏外OK", l1: "Ready for no signal", right: total === 0 ? "the trip" : total === 1 ? "trip · 1 ticket" : "trip · all " + total + " tickets" };
    case "ready-off":
      return { jp: "圏外", l1: "No signal · everything is on this phone", right: "" };
    case "missing":
      return { jp: "", l1: n === 1 ? "1 picture is not on this phone yet" : n + " pictures not on this phone yet", right: "", key: "Fetch now" };
    case "fetching":
      return { jp: "", l1: "Fetching " + progress.at + " of " + progress.of, right: "Keep MAT open" };
    case "failed":
      return { jp: "", l1: pics(n) + " could not be fetched", right: "", key: "Try again" };
    case "wait":
      return mode === "open"
        ? { jp: "", l1: n === 1 ? "1 picture needs signal once" : n + " pictures need signal once", right: "" }
        : { jp: "", l1: n === 1 ? "1 picture comes when signal is back" : n + " pictures come when signal is back", right: "" };
    case "setup":
      return { jp: "", l1: "Setting up for no signal", right: "A moment" };
    case "nokeep-fails":
      return { jp: "", l1: "Pictures can’t be saved right now", right: "" };
    default:
      return { jp: "", l1: "Nothing is kept in this window", right: "" };
  }
}

function ariaFor(kind, n, total, where, progress, l1) {
  const place = where === "home" ? "in the Home Screen app" : "in Safari";
  switch (kind) {
    case "ready": {
      const what = total === 0 ? "The trip is" : total === 1 ? "The trip and 1 ticket are" : "The trip and all " + total + " tickets are";
      return "Ready for no signal. " + what + " on this phone, " + place + ". Details";
    }
    case "ready-off":
      return "No signal. Everything is on this phone. Details";
    case "missing":
      return tickets(n) + (n === 1 ? " is" : " are") + " not on this phone yet. Details";
    case "fetching":
      return "Fetching " + progress.at + " of " + progress.of + " ticket pictures. Details";
    case "failed":
      return tickets(n) + " could not be fetched. Details";
    default:
      return l1 + ". Details";
  }
}

// The board's face from two days before (section 5).
function bigFace(kind, n, mode, toGo, progress) {
  const fetchingText = progress ? "Fetching " + progress.at + " of " + progress.of : "";
  if (kind === "fetching") return { l1: fetchingText, l2: "Keep MAT open", note: NOTE, key: fetchingText, busy: true };
  if (kind === "failed") return { l1: pics(n) + " could not be fetched", l2: "Try again on Wi‑Fi", note: NOTE, key: "Try again", busy: false };
  return {
    l1: pics(n) + " not on this phone",
    l2: mode === "open" ? "Set to " + ONLY_OPEN : toGo === 1 ? "Flying tomorrow" : "Flying in " + toGo + " days",
    note: NOTE,
    key: n === 1 ? "Fetch it now" : "Fetch all " + n + " now",
    busy: false,
  };
}

// The missing pictures, one line per stop or stay, in the order they are fetched.
function missingItems(s, missing) {
  const stops = new Map((Array.isArray(s.stops) ? s.stops : []).filter((x) => x && x.id).map((x) => [x.id, x]));
  const stays = new Map((Array.isArray(s.stays) ? s.stays : []).filter((x) => x && x.id).map((x) => [x.id, x]));
  const seen = new Set();
  const out = [];
  for (const t of missing) {
    const k = t.stay ? "y:" + t.stay : "s:" + t.stop;
    if (seen.has(k)) continue;
    seen.add(k);
    if (t.stay) {
      const sy = stays.get(t.stay);
      if (sy) out.push(dayHead(sy.firstNight).en + " · " + (String(sy.name || "").trim() || "Stay") + ", booking");
    } else {
      const st = stops.get(t.stop);
      if (st) out.push(dayHead(st.date).en + " · " + (String(st.title || "").trim() || "Stop"));
    }
  }
  return out;
}

const lastDay = (days) => (Array.isArray(days) ? days : []).map((d) => (d && typeof d.date === "string" ? d.date : "")).filter(Boolean).sort().pop() || "";

export function phoneReady(s, nowMs, env) {
  if (!s || s.status !== "ready" || s.ticketsReady !== true || !s.trip || !s.trip.start) return null;
  const today = tripNow(s, nowMs).date;
  const end = lastDay(s.days);
  if (end && today > end) return null;
  const toGo = daysToGo({ ...s.trip, tz: s.trip.tz || "Asia/Tokyo" }, nowMs, today);
  const ahead = aheadPictures(s, nowMs);
  const missing = ahead.filter((t) => !env.have(t.id));
  const n = missing.length;
  const total = ahead.length;
  const mode = env.mode === "open" ? "open" : "all";
  const where = env.standalone ? "home" : "safari";
  const online = s.online !== false;
  const kept = env.kept === true && typeof s.loadedAt === "number";
  let kind;
  if (!kept || env.lasting !== true) kind = "nokeep";
  else if (env.fetching && n > 0) kind = "fetching";
  else if (n > 0 && !online) kind = "wait";
  else if (n > 0 && env.failed) kind = "failed";
  else if (n > 0) kind = "missing";
  else if (!env.shell) kind = "setup";
  else if (!online) kind = "ready-off";
  else kind = "ready";
  const progress = kind === "fetching" ? env.progress || { at: 1, of: n, left: n } : null;
  // Private window only when there is no storage at all and this is not the Home Screen app.
  const why = kind !== "nokeep" ? "" : env.noStore === true && !env.standalone ? "private" : "fails";
  const w = lineWords(why === "fails" ? "nokeep-fails" : kind, n, mode, total, progress);
  const big = MISSING.includes(kind) && online && (toGo === 1 || toGo === 2) ? bigFace(kind, n, mode, toGo, progress) : null;
  let strip = null;
  if (kind === "ready-off") strip = { tone: "green", jp: "圏外", text: "No signal · everything is on this phone" };
  else if (kind === "wait") strip = { tone: "red", text: "No signal. " + tickets(n) + (n === 1 ? " is" : " are") + " not on this phone." };
  else if (MISSING.includes(kind) && online && toGo <= 2) strip = { tone: "amber", text: w.l1, right: w.right || "", key: w.key || "" };
  return {
    kind,
    why,
    n,
    total,
    where,
    toGo,
    mode,
    big,
    strip,
    l1: w.l1,
    jp: w.jp,
    right: w.right,
    key: w.key || "",
    aria: ariaFor(kind, n, total, where, progress, w.l1),
    keyAria: w.key ? (kind === "failed" ? "Try again: fetch " + tickets(n) : "Fetch " + tickets(n) + " now") : "",
    items: missingItems(s, missing),
  };
}

// The sheet a tap on the line opens ("This phone"), as rows of words.
// -> { verdict, rows: [{ label, value, lines? }], notes: [..], key }
export function sheetFor(m) {
  const ready = m.kind === "ready" || m.kind === "ready-off";
  const rows = [{ id: "trip", label: "The trip", value: "on this phone" }];
  const here = m.total - m.n;
  if (m.n === 0) rows.push({ id: "tix", label: "Tickets", value: m.total === 0 ? "no tickets yet" : m.total === 1 ? "1 picture on this phone" : "all " + m.total + " pictures on this phone" });
  else {
    const lines = m.items.slice(0, 5);
    if (m.items.length > 5) lines.push("and " + (m.items.length - 5) + " more");
    rows.push({ id: "tix", label: "Tickets", value: here + " of " + m.total + (m.total === 1 ? " picture" : " pictures") + " on this phone", lines });
  }
  const notes = [];
  notes.push(
    m.where === "home"
      ? "Here in the Home Screen app. Safari keeps its own copy."
      : "Here in Safari. Safari can clear a site it has not seen for a week, so open MAT now and then. The Home Screen app keeps its own copy: open it once with signal too.",
  );
  if (m.mode === "open") notes.push("Ticket pictures are set to " + ONLY_OPEN + ". Change it in You, Ticket pictures.");
  if (m.kind === "failed") notes.push("Some pictures would not fetch. This phone may be full, or the signal dropped. Try again on Wi‑Fi.");
  if (m.kind === "nokeep")
    notes.push(
      m.why === "private"
        ? "This window keeps nothing after it is closed (a private window, or storage is off). Open your link in an ordinary Safari window."
        : "Pictures can’t be saved on this phone right now. Close MAT and open it again.",
    );
  if (m.kind === "setup") notes.push("The app is still saving itself to this phone. It takes a moment with signal.");
  if (m.kind === "wait") notes.push(m.mode === "open" ? "No signal now. Fetch them when it is back." : "No signal now. The missing pictures come by themselves when it is back.");
  // The key: only when the line has one. Two days before it says what the board's paper key says.
  const key = !m.key ? "" : m.kind === "failed" ? "Try again" : m.big ? m.big.key : "Fetch now";
  return { verdict: ready ? "Ready for no signal." : "Not ready for no signal yet.", rows, notes, key };
}
