/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// "Back to the hotel" (帰り道): a compass that points to where you sleep. A
// sheet on the ticket stock, like the hotel card, opened from You → Extras or
// from the hotel card's 方位 Compass.
//
// mountCompass(root, store, { clock, storage }) -> { open(stayId, { back }), close(restoreFocus), isOpen() }
// root is the phone. clock: the Days clock (js/clock.js), so the hotel it
// starts on is the one the ticket shows. storage: the phone's localStorage
// (or its stand-in), for pins. open(stayId): that stay, or with none the
// stay of the night the clock is in. back: where focus goes on close.
//
// Where the hotel is (js/compass.js stayTarget): a pin dropped on this phone,
// else coordinates in the stay's place. A pin is kept on this phone only
// (mat.pin.<stay id>): it is never sent, so it needs no signal and the other
// phones are not changed. Nothing here talks to the backend.
//
// The phone's location and compass are asked for only on a tap (Start, or
// Pin it here): an iPhone allows the compass only from a tap, and nobody is
// asked for their location just for opening the sheet. Both are let go when
// the sheet closes or the app leaves the screen. With no compass (a laptop,
// or one refused) the dial stands still with north at the top and the needle
// still points the right way on it.
// Text from the Sheet goes in with textContent only; a link only through safeHref.

import { stayShownFor, stayMapsUrl, nowIn, safeHref } from "../plan.js";
import { stayTarget, distanceM, bearing, headingOf, turn, pointOf, distanceText, wayText, isSpot, norm, HERE_M } from "../compass.js";

const PIN_KEY = "mat.pin.";
// How long after Start with no heading before the dial says there is no compass.
const NO_HEADING_MS = 2500;
// Each frame the dial covers this share of the way to where it should point.
const EASE = 0.22;

const MSG = {
  start: "Tap Start, then hold the phone flat in front of you.",
  noSpot: "This phone doesn’t know where the hotel is yet. When you’re there, tap Pin it here.",
  finding: "Finding where you are…",
  pinning: "Pinning…",
  flat: "Hold the phone flat, away from anything metal.",
  noCompass: "No compass on this phone: north is at the top.",
  compassOff: "The phone didn’t allow the compass, so north is at the top. To ask again, close the app fully and reopen it.",
  locOff: "Location is off for this app. Allow it in the phone’s settings for this browser, then tap Start.",
  noLoc: "This phone can’t share its location here.",
  lost: "Can’t find where you are right now. Try again in the open.",
  noStays: "No hotel in the plan yet. Add one to a day, and it shows here.",
};

const MARKUP = `
<div class="sheet-top"><span>Back to the hotel<i>帰り道</i></span><button type="button" id="cpDone">Done</button></div>
<div class="cp" id="cpBody">
  <div class="cp-pick" id="cpPick" role="group" aria-label="Which hotel" hidden></div>
  <div class="cp-to" id="cpTo"><b id="cpName"></b><span id="cpEn"></span></div>
  <div class="cp-dial" id="cpDial" aria-hidden="true">
    <svg class="cp-face" id="cpFace" viewBox="0 0 200 200" focusable="false">
      <circle cx="100" cy="100" r="96" class="cp-rim"/>
      <circle cx="100" cy="100" r="78" class="cp-ring"/>
      <g id="cpTicks"></g>
      <text x="100" y="40" class="cp-n">北</text>
      <text x="160" y="104" class="cp-l">東</text>
      <text x="100" y="168" class="cp-l">南</text>
      <text x="40" y="104" class="cp-l">西</text>
      <text x="100" y="22" class="cp-ne">N</text>
    </svg>
    <svg class="cp-needle" id="cpNeedle" viewBox="0 0 200 200" focusable="false">
      <path d="M100 30 L111 100 L100 92 L89 100 Z" class="cp-tip"/>
      <path d="M100 170 L111 100 L100 108 L89 100 Z" class="cp-tail"/>
    </svg>
    <span class="cp-hub">宿</span>
  </div>
  <div class="lcd cp-lcd" id="cpLcd">
    <div class="cp-far" id="cpFar">– – –</div>
    <div class="cp-way" id="cpWay" aria-live="polite"></div>
  </div>
  <p class="cp-msg" id="cpMsg"></p>
  <button type="button" class="cp-go" id="cpGo">Start</button>
  <div class="cp-pin" id="cpPinRow">
    <span id="cpPinT"></span>
    <span class="cp-pin-b"><button type="button" id="cpPin">Pin it here</button><button type="button" id="cpUnpin" hidden>Unpin</button></span>
  </div>
  <div class="r-btns" id="cpLinks"></div>
</div>`;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const str = (v) => (typeof v === "string" ? v.trim() : "");

// The stays that can be picked: not deleted, by first night.
function liveStays(s) {
  return (Array.isArray(s.stays) ? s.stays : [])
    .filter((x) => x && x.id && !x.deleted && (str(x.name) || str(x.nameJp)))
    .sort((a, b) => String(a.firstNight || "9").localeCompare(String(b.firstNight || "9")));
}

// The stay of the night the clock is in; before the trip the first, after it the last.
export function stayNow(stays, trip, nowMs) {
  if (!stays.length) return null;
  const tz = (trip && trip.tz) || "Asia/Tokyo";
  const now = nowIn(tz, nowMs);
  const shown = stayShownFor(stays, now.date, { today: now.date, minutes: now.minutes });
  if (shown) return shown;
  const dated = stays.filter((s) => s.firstNight);
  if (!dated.length) return stays[0];
  if (now.date < dated[0].firstNight) return dated[0];
  // Between stays or after the last: the most recent one begun.
  const begun = dated.filter((s) => s.firstNight <= now.date);
  return begun.length ? begun[begun.length - 1] : dated[0];
}

export function mountCompass(root, store, { clock = null, storage = null } = {}) {
  const scrim = el("div", "scrim");
  scrim.id = "compassScrim";
  scrim.hidden = true;
  const sheet = el("div", "sheet stay compass");
  sheet.id = "compass";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Back to the hotel");
  sheet.inert = true;
  sheet.innerHTML = MARKUP;
  root.append(scrim, sheet);
  sheet.addEventListener("touchstart", () => {}, { passive: true });

  const $ = (id) => sheet.querySelector("#" + id);
  const done = $("cpDone");
  const pick = $("cpPick");
  const nameEl = $("cpName");
  const enEl = $("cpEn");
  const dial = $("cpDial");
  const face = $("cpFace");
  const needle = $("cpNeedle");
  const far = $("cpFar");
  const way = $("cpWay");
  const msg = $("cpMsg");
  const go = $("cpGo");
  const pinRow = $("cpPinRow");
  const pinT = $("cpPinT");
  const pinBtn = $("cpPin");
  const unpinBtn = $("cpUnpin");
  const links = $("cpLinks");

  // The dial's ticks: every 10°, longer every 30°.
  const ticks = $("cpTicks");
  const NS = "http://www.w3.org/2000/svg";
  for (let a = 0; a < 360; a += 10) {
    const t = document.createElementNS(NS, "line");
    const long = a % 30 === 0;
    t.setAttribute("x1", "100");
    t.setAttribute("x2", "100");
    t.setAttribute("y1", long ? "6" : "8");
    t.setAttribute("y2", long ? "17" : "13");
    t.setAttribute("class", long ? "cp-t is-long" : "cp-t");
    t.setAttribute("transform", "rotate(" + a + " 100 100)");
    ticks.append(t);
  }

  let opened = false;
  let back = null; // gets focus on close
  let stayId = null;
  let running = false; // Start was tapped: location and compass are wanted
  let here = null; // { lat, lng, accuracy }
  let heading = null; // degrees, or null with no compass
  let headingSeen = false;
  let compassRefused = false;
  let locProblem = null; // a MSG key
  let watchId = null;
  let noHeadingTimer = null;
  let pinning = false;
  let frame = 0;
  // The dial's angles as drawn, unwrapped so a turn past north never spins the long way.
  let faceAt = 0;
  let needleAt = 0;

  const read = (k) => {
    try {
      return storage ? storage.getItem(k) : null;
    } catch {
      return null;
    }
  };
  const write = (k, v) => {
    try {
      if (storage) storage.setItem(k, v);
      return true;
    } catch {
      return false;
    }
  };
  function pinOf(id) {
    if (!id) return null;
    try {
      const p = JSON.parse(read(PIN_KEY + id) || "null");
      return isSpot(p) ? p : null;
    } catch {
      return null;
    }
  }

  const stays = () => liveStays(store.state);
  const stay = () => stays().find((s) => s.id === stayId) || null;
  const target = () => {
    const s = stay();
    return s ? stayTarget(s, pinOf(s.id)) : null;
  };
  const reduced = () => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  };
  const screenAngle = () => {
    try {
      if (screen.orientation && typeof screen.orientation.angle === "number") return screen.orientation.angle;
    } catch {
      // older phones
    }
    return typeof window.orientation === "number" ? window.orientation : 0;
  };

  // ---- drawing ----

  let shownPick = "";
  function drawPick() {
    const list = stays();
    pick.hidden = list.length < 2;
    const sig = JSON.stringify(list.map((s) => [s.id, s.name, s.nameJp]));
    if (sig !== shownPick) {
      shownPick = sig;
      pick.replaceChildren(
        ...list.map((s) => {
          const b = el("button", "", str(s.name) || str(s.nameJp));
          b.type = "button";
          b.dataset.stay = s.id;
          return b;
        }),
      );
    }
    for (const b of pick.children) {
      const on = b.dataset.stay === stayId;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function link(cls, text, href) {
    const a = el("a", cls, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }

  let shownLinks = "";
  function drawLinks(s, t) {
    const walk = t ? "https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=" + t.lat.toFixed(6) + "," + t.lng.toFixed(6) : "";
    const map = s ? stayMapsUrl(s) : "";
    const sig = walk + "|" + map;
    if (sig === shownLinks) return;
    shownLinks = sig;
    const nodes = [];
    if (walk && safeHref(walk)) nodes.push(link("r-map", "歩く Walk there ↗", walk));
    if (map) nodes.push(link("r-map" + (walk ? " alt" : ""), "地図 Map ↗", map));
    links.replaceChildren(...nodes);
  }

  function say(text) {
    if (msg.textContent !== text) msg.textContent = text;
  }

  // Everything but the dial's angles, which the frame loop draws.
  function render() {
    if (!opened) return;
    const list = stays();
    if (!list.some((s) => s.id === stayId)) stayId = list.length ? stayNow(list, store.state.trip, clock ? clock.now() : Date.now()).id : null;
    drawPick();
    const s = stay();
    sheet.classList.toggle("is-empty", !s);
    if (!s) {
      nameEl.textContent = "";
      enEl.textContent = "";
      far.textContent = "– – –";
      way.textContent = "";
      say(MSG.noStays);
      go.hidden = true;
      pinRow.hidden = true;
      links.replaceChildren();
      shownLinks = "";
      return;
    }
    const jp = str(s.nameJp);
    const en = str(s.name);
    nameEl.textContent = jp || en;
    enEl.textContent = jp && en ? en : "";
    enEl.hidden = !(jp && en);

    const t = target();
    const pin = pinOf(s.id);
    sheet.classList.toggle("has-spot", !!t);
    sheet.classList.toggle("is-live", running && !!here && !!t);
    sheet.classList.toggle("has-heading", running && heading !== null);

    // The LCD: how far, and which way in words.
    if (t && here) {
      const m = distanceM(here, t);
      const deg = bearing(here, t);
      const p = pointOf(deg);
      const f = distanceText(m);
      if (far.textContent !== f) far.textContent = f;
      const w = (m > HERE_M ? p.jp + " · " : "") + wayText(m, deg, here.accuracy);
      if (way.textContent !== w) way.textContent = w;
    } else {
      if (far.textContent !== "– – –") far.textContent = "– – –";
      const w = t ? (t.from === "pin" ? "Pinned on this phone" : "From the plan’s map link") : "Not pinned yet";
      if (way.textContent !== w) way.textContent = w;
    }

    // The one line that says what is going on.
    if (pinning) say(MSG.pinning);
    else if (locProblem) say(MSG[locProblem]);
    else if (!t) say(MSG.noSpot);
    else if (!running) say(MSG.start);
    else if (!here) say(MSG.finding);
    else if (heading === null && compassRefused) say(MSG.compassOff);
    else if (heading === null && !headingSeen && noHeadingTimer === null) say(MSG.noCompass);
    else if (heading === null) say(MSG.finding);
    else say(MSG.flat);

    go.hidden = !t || (running && !locProblem);
    go.textContent = locProblem ? "Try again" : "Start";

    // The pin: always on offer, so a hotel whose plan link is off can be put right.
    pinRow.hidden = false;
    pinT.textContent = pin ? "Pinned on this phone" : t ? "Not where the plan says?" : "Standing at the hotel?";
    pinBtn.textContent = pinning ? "Pinning…" : pin ? "Move pin here" : "Pin it here";
    pinBtn.disabled = pinning;
    unpinBtn.hidden = !pin;

    drawLinks(s, t);
  }

  // The dial: the face turns so 北 points north; the needle points at the hotel.
  function tick() {
    frame = 0;
    if (!opened) return;
    const t = target();
    const h = running && heading !== null ? heading : 0;
    const wantFace = -h;
    // With no fix yet the needle lies along 北, as a plain compass.
    const wantNeedle = t && here ? bearing(here, t) - h : wantFace;
    const k = reduced() ? 1 : EASE;
    faceAt += turn(norm(faceAt), norm(wantFace)) * k;
    needleAt += turn(norm(needleAt), norm(wantNeedle)) * k;
    face.style.transform = "rotate(" + faceAt.toFixed(2) + "deg)";
    needle.style.transform = "rotate(" + needleAt.toFixed(2) + "deg)";
    const settling = Math.abs(turn(norm(faceAt), norm(wantFace))) > 0.1 || Math.abs(turn(norm(needleAt), norm(wantNeedle))) > 0.1;
    if (settling || (running && heading !== null)) frame = requestAnimationFrame(tick);
  }
  const kick = () => {
    if (opened && !frame) frame = requestAnimationFrame(tick);
  };

  // ---- the phone's location and compass ----

  function onOrient(ev) {
    const h = headingOf(ev, screenAngle());
    if (h === null) return;
    // An absolute reading beats a relative one: once one is seen, the other kind is ignored.
    if (ev.type === "deviceorientation" && ev.absolute !== true && typeof ev.webkitCompassHeading !== "number") return;
    const first = heading === null;
    heading = h;
    headingSeen = true;
    if (first) render();
    kick();
  }

  function onFix(pos) {
    const c = pos && pos.coords;
    if (!c) return;
    here = { lat: c.latitude, lng: c.longitude, accuracy: Number.isFinite(c.accuracy) ? c.accuracy : null };
    locProblem = null;
    render();
    kick();
  }
  function onFixError(err) {
    locProblem = err && err.code === 1 ? "locOff" : "lost";
    if (err && err.code === 1) stopWatching();
    render();
  }

  const geo = () => (typeof navigator !== "undefined" && navigator.geolocation ? navigator.geolocation : null);

  function startWatching() {
    const g = geo();
    if (!g) {
      locProblem = "noLoc";
      return;
    }
    if (watchId === null) {
      try {
        watchId = g.watchPosition(onFix, onFixError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
      } catch {
        locProblem = "noLoc";
      }
    }
    window.addEventListener("deviceorientationabsolute", onOrient);
    window.addEventListener("deviceorientation", onOrient);
    clearTimeout(noHeadingTimer);
    noHeadingTimer = setTimeout(() => {
      noHeadingTimer = null;
      render();
    }, NO_HEADING_MS);
  }

  function stopWatching() {
    const g = geo();
    if (watchId !== null && g) {
      try {
        g.clearWatch(watchId);
      } catch {
        // already gone
      }
    }
    watchId = null;
    window.removeEventListener("deviceorientationabsolute", onOrient);
    window.removeEventListener("deviceorientation", onOrient);
    clearTimeout(noHeadingTimer);
    noHeadingTimer = null;
    heading = null;
  }

  // An iPhone shows its compass only to a page that asked on a tap, so this
  // is called straight from one (before anything is awaited).
  function askCompass() {
    const D = globalThis.DeviceOrientationEvent;
    if (!D || typeof D.requestPermission !== "function") return Promise.resolve(true);
    try {
      return Promise.resolve(D.requestPermission()).then(
        (r) => r === "granted",
        () => false,
      );
    } catch {
      return Promise.resolve(false);
    }
  }

  async function start() {
    const asking = askCompass(); // first, while the tap still counts
    running = true;
    locProblem = null;
    compassRefused = false;
    startWatching();
    render();
    kick();
    const ok = await asking;
    if (!ok && opened) {
      compassRefused = true;
      render();
    }
  }

  // Pin it here: one careful fix, kept on this phone for this stay.
  function pinHere() {
    const s = stay();
    const g = geo();
    if (!s || pinning) return;
    if (!g) {
      locProblem = "noLoc";
      render();
      return;
    }
    const id = s.id;
    pinning = true;
    render();
    const asking = askCompass(); // the same tap starts the compass too
    g.getCurrentPosition(
      (pos) => {
        pinning = false;
        const c = pos.coords;
        const p = { lat: c.latitude, lng: c.longitude };
        if (!isSpot(p)) {
          locProblem = "lost";
          render();
          return;
        }
        const saved = write(PIN_KEY + id, JSON.stringify({ ...p, at: new Date().toISOString() }));
        const acc = Number.isFinite(c.accuracy) ? c.accuracy : null;
        store.notify(saved ? "Pinned" + (acc && acc > 30 ? ", to about " + distanceText(acc) : "") + ". The compass points here now." : "Couldn’t keep the pin on this phone.");
        onFix(pos);
        if (!running) {
          running = true;
          startWatching();
          asking.then((ok) => {
            if (!ok && opened) {
              compassRefused = true;
              render();
            }
          });
        }
        render();
        kick();
      },
      (err) => {
        pinning = false;
        onFixError(err);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }

  function unpin() {
    const s = stay();
    if (!s) return;
    try {
      if (storage && typeof storage.removeItem === "function") storage.removeItem(PIN_KEY + s.id);
      else write(PIN_KEY + s.id, "null");
    } catch {
      write(PIN_KEY + s.id, "null");
    }
    store.notify("Pin taken off this phone.");
    render();
    kick();
  }

  // ---- opening and closing ----

  const isOpen = () => opened;

  function open(id = null, { back: backTo = null } = {}) {
    if (opened) close(false);
    const list = stays();
    stayId = id && list.some((s) => s.id === id) ? id : null;
    opened = true;
    back = backTo;
    shownLinks = "";
    render();
    sheet.classList.add("is-open");
    sheet.inert = false;
    scrim.hidden = false;
    root.classList.add("compass-open");
    sheet.scrollTop = 0;
    // The dial starts where it will point, not with a spin.
    faceAt = 0;
    needleAt = 0;
    face.style.transform = "";
    needle.style.transform = "";
    kick();
    done.focus({ preventScroll: true });
    return true;
  }

  // restoreFocus: give focus back to what opened it.
  function close(restoreFocus = true) {
    if (!opened) return;
    opened = false;
    running = false;
    pinning = false;
    here = null;
    locProblem = null;
    stopWatching();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    sheet.classList.remove("is-open");
    sheet.inert = true;
    scrim.hidden = true;
    root.classList.remove("compass-open");
    if (sheet.contains(document.activeElement)) document.activeElement.blur();
    const b = back;
    back = null;
    if (restoreFocus === true && b && typeof b.focus === "function") b.focus({ preventScroll: true });
  }

  done.addEventListener("click", () => close());
  scrim.addEventListener("click", () => close());
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") close();
  });
  go.addEventListener("click", start);
  pinBtn.addEventListener("click", pinHere);
  unpinBtn.addEventListener("click", unpin);
  pick.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-stay]");
    if (!b || b.dataset.stay === stayId) return;
    stayId = b.dataset.stay;
    render();
    kick();
  });
  // Off the screen, the phone's location and compass are let go; back on, picked up again.
  document.addEventListener("visibilitychange", () => {
    if (!opened || !running) return;
    if (document.visibilityState === "hidden") stopWatching();
    else {
      startWatching();
      render();
      kick();
    }
  });
  store.subscribe(render);
  if (clock && clock.subscribe) clock.subscribe(render);

  return { open, close: (restoreFocus) => close(restoreFocus), isOpen };
}
