/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The stub: 切符 Show ticket tears the stop off the day's ticket and holds it
// up on paper-white stock (direction A of the tickets mock-up, which Mo
// chose). The code is on white, about 300 px wide; the facts staff ask for
// are printed under it like a ticket's fields; Put it back, Escape or a tap
// on the dark around it closes it.
//
// mountStub(root, store, keep) -> { open(stopId, opener), close(restoreFocus), isOpen() }
// root is the phone (#tix is added to it; css/tickets.css puts it over Days,
// and in the computer layout inside the Days pane). keep is js/tickets.js's
// keep. While it is up, #phone has stub-open, so a new release waits to
// reload (js/update.js), and the screen is asked to stay on (Wake Lock,
// where the phone allows it; a refusal is silent).
//
// What it shows, by the stop's pictures (js/tickets.js ticketKinds):
// - per-person codes: one page each, swiped or picked with the seals; it
//   opens on this phone's person first, then the others in trip order. Each
//   person's page says whose it is at its head (issue #83, Mo's pick A-2):
//   their seal with their picture, the name, and あなたの券 Your code, or
//   "Mo’s code, not yours" in vermilion. The seals under the code are all in
//   colour, the one in view ringed in vermilion;
// - one code for everyone; a PDF's pages one under another (tap to enlarge);
// - no picture: the booking ref, large, with a sentence for staff.
// A picture not on this phone yet is fetched now when there is signal
// ("Saving to this phone"), else it says it needs signal once. Every name,
// ref and seat goes in with textContent; a picture only as an <img> from a
// blob: URL made from bytes whose type was checked (js/tickets.js sniff).
// Reduced motion: no tear, it is simply there (css/tickets.css).
//
// A stay's booking (look A, 予約票): open(stayId, opener, { stay: true }), or
// openStay(stayId, opener), shares the slots, the fetching, the zoom, the
// wake lock, closing and focus, and draws its own page (paintStay): the
// app's white stub with the stay's name and the night, the booking's number
// large with a sentence for the front desk, the facts, and the confirmation's
// pages (two columns, tap to enlarge). No tear: it is simply there. The night comes from clock() (the
// trip's zone: { date, minutes }). It closes itself when the stay, or its
// booking, is gone.

import { header, nightOf, staySpan } from "../plan.js";
import { fillSeal } from "../picture.js";
import { dayHead } from "../format.js";
import { ticketKinds, hasFacts, hasStayFacts, stayPictures, sniff, fromBase64, sameName } from "../tickets.js";
import { nightsShort, nightsLong, stayDots, stayDayNums, peopleWord } from "../staywords.js";
import { sealFor } from "./nextticket.js";

const NUMBER_WORD = { 2: "TWO", 3: "THREE", 4: "FOUR", 5: "FIVE", 6: "SIX" };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const str = (v) => (typeof v === "string" ? v.trim() : "");

// The sentence for staff on a reference-only stub, in Japanese and English.
function staffLines(stop) {
  const name = str(stop.tkName);
  const time = /^\d{2}:\d{2}$/.test(stop.time || "") ? stop.time : "";
  const people = str(stop.tkPeople);
  if (!name) return null;
  const jp = name + " の名前で" + (time ? "、" + time + "に" : "") + "予約しています。";
  const en = "We have a booking" + (people ? " for " + people : "") + (time ? " at " + time : "") + " under " + name + ".";
  return { jp, en };
}

// The sentence for the front desk on a stay's booking: in Japanese and
// English, the name it is under, the nights and from when ("本日から" on the
// first night, else the date).
function deskLines(stay, today) {
  const name = str(stay.tkName);
  if (!name) return null;
  const night = nightOf(stay, { today: stay.firstNight, minutes: 720 });
  const total = night.total;
  if (!total) return null;
  const first = stay.firstNight === today;
  const [, m, d] = stay.firstNight.split("-").map(Number);
  const en = dayHead(stay.firstNight, []).en.split(" ").slice(1).join(" "); // "Dec 10"
  return {
    jp: [name + " の名前で、", (first ? "本日から" : m + "月" + d + "日から") + total + "泊予約しています。"],
    en: "We have a booking for " + total + (total === 1 ? " night" : " nights") + " from " + (first ? "today" : en) + " under " + name + ".",
  };
}

// clock(): { date, minutes } now, in the trip's zone (the night on a stay's booking).
export function mountStub(root, store, keep, { clock = null } = {}) {
  const host = el("div", "tix");
  host.id = "tix";
  host.hidden = true;
  root.append(host);

  let mode = "stop"; // "stop", or "stay" for a stay's booking
  let stopId = null;
  let opener = null;
  let urls = [];
  let lock = null;
  let locked = false;
  let groupKey = null; // the per-person page in view, by whose it is
  let sig = "";
  let fetching = false;
  const failedNow = new Set(); // fetched this opening and refused: not again until it is opened again

  const isOpen = () => !host.hidden;
  const online = () => store.state.online !== false;
  const stopOf = () => (store.state.stops || []).find((s) => s && s.id === stopId && !s.deleted) || null;
  const stayOf = () => (store.state.stays || []).find((s) => s && s.id === stopId && !s.deleted) || null;
  const picsOf = () => (mode === "stay" ? stayPictures(stayOf(), store.state.tickets) : (store.state.tickets || []).filter((t) => t && t.stop === stopId && !t.gone));
  const nowHere = () => {
    const c = clock ? clock() : null;
    return c && typeof c.date === "string" ? c : { date: "", minutes: 0 };
  };

  function forget() {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
  }

  // ---- the screen kept on ----
  async function wake() {
    try {
      if (!navigator.wakeLock || document.visibilityState !== "visible" || lock) return;
      lock = await navigator.wakeLock.request("screen");
      locked = true;
      lock.addEventListener("release", () => {
        lock = null;
      });
      if (!isOpen()) {
        lock.release();
        lock = null;
      }
    } catch {
      lock = null; // refused: say nothing
    }
    paintWakeLine();
  }
  function sleep() {
    try {
      if (lock) lock.release();
    } catch {
      // nothing to do
    }
    lock = null;
  }
  document.addEventListener("visibilitychange", () => {
    if (isOpen() && document.visibilityState === "visible") wake();
  });
  function paintWakeLine() {
    const line = host.querySelector(".oa-x");
    if (line) line.hidden = !locked;
  }

  // ---- the pieces ----

  function facts(stop, seat) {
    const rows = [
      ["予約番号", "Booking ref", str(stop.tkRef)],
      ["名義", "Name on booking", str(stop.tkName)],
      ["人数", "People", str(stop.tkPeople)],
      ["座席", "Seat", str(seat)],
    ].filter((r) => r[2]);
    if (!rows.length) return null;
    const dl = el("dl", "facts");
    for (const [jp, en, v] of rows) {
      const d = el("div");
      const dt = el("dt", "", jp);
      dt.append(el("i", "", en));
      d.append(dt, el("dd", "", v));
      dl.append(d);
    }
    return dl;
  }

  function keptLine(kind, all) {
    const k = el("div", "kept");
    if (!kind) k.append(el("b", "", "文字"), el("span", "", "Text only, always on this phone."));
    else if (all) k.append(el("b", "", "保存済"), el("span", "", "On this phone. Works with no signal."));
    else k.append(el("b", "is-dash", "未保存"), el("span", "", "Not on this phone yet. Needs signal once."));
    return k;
  }

  function missing(saving) {
    const m = el("div", "miss");
    if (saving) {
      m.append("Saving to this phone", el("div", "bar-p"), el("span", "", "Once, then it works with no signal."));
    } else {
      m.append("The picture is not on this phone yet.", el("span", "", "It saves the first time this phone opens MAT with signal. Until then, show the booking ref below; staff can find it."));
    }
    return m;
  }

  // A slot for one picture: filled from the keep, or fetched now.
  function slot(pic, { zoom = false, page = false } = {}) {
    const box = el("div", "stub-code" + (page ? " is-page" : ""));
    box.dataset.id = pic.id;
    const fill = async () => {
      const blob = await keep.get(pic.id);
      if (!box.isConnected && !host.contains(box)) return;
      if (blob && (await sniff(blob)) === pic.mime && (pic.mime === "image/jpeg" || pic.mime === "image/png")) {
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const img = el("img", "code");
        img.alt = pic.who ? pic.who + "’s code" : page ? "Page " + pic.page : "The ticket";
        img.decoding = "async";
        img.src = url;
        if (zoom) {
          box.classList.add("can-zoom");
          box.tabIndex = 0;
          box.setAttribute("role", "button");
          box.setAttribute("aria-label", "Enlarge " + img.alt.toLowerCase());
        }
        box.replaceChildren(img);
        return;
      }
      const saving = online() && !failedNow.has(pic.id);
      box.replaceChildren(missing(saving));
      if (saving) fetchNow();
    };
    box.append(el("div", "miss-wait"));
    fill();
    return box;
  }

  // Fetches the pictures of this stop the phone lacks, one at a time, then redraws.
  async function fetchNow() {
    if (fetching) return;
    fetching = true;
    const at = keep.gen;
    try {
      for (const t of picsOf()) {
        if (!isOpen() || keep.have(t.id) || failedNow.has(t.id)) continue;
        let got;
        try {
          got = await store.fetchTicket(t.id);
        } catch (err) {
          if (err && err.code === "network") break;
          failedNow.add(t.id);
          continue;
        }
        const blob = got && got.id === t.id && got.mime === t.mime ? fromBase64(got.data, got.mime) : null;
        if (!blob || !(await keep.put(t.id, blob, { gen: at }))) failedNow.add(t.id);
      }
    } finally {
      fetching = false;
    }
    if (isOpen()) paint(true);
  }

  function zoomOut() {
    const z = host.querySelector(".zoom");
    if (!z) return false;
    z.remove();
    return true;
  }
  function zoomIn(box) {
    const img = box.querySelector("img");
    if (!img) return;
    const z = el("div", "zoom");
    z.setAttribute("role", "dialog");
    z.setAttribute("aria-label", "Enlarged");
    const back = el("button", "zoom-x", "Back");
    back.type = "button";
    const big = el("img");
    big.src = img.src;
    big.alt = img.alt;
    z.append(back, big);
    host.append(z);
    back.focus({ preventScroll: true });
  }

  // ---- drawing ----

  function body(stop, k, people, me) {
    const p = el("div", "stub-p");
    if (!k.kind) {
      const ref = el("div", "ref-big");
      ref.append(el("small", "", "予約番号 Reference"));
      if (str(stop.tkRef)) ref.append(el("b", "", str(stop.tkRef)));
      const said = staffLines(stop);
      if (said) ref.append(el("p", "", said.jp), el("span", "", said.en));
      p.append(ref);
      return { node: p, seat: str(stop.tkSeat) };
    }
    const byPage = (a, b) => a.page - b.page;
    if (k.kind === "pp") {
      const groups = new Map();
      for (const t of k.list.slice().sort(byPage)) {
        const g = t.who || "";
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(t);
      }
      const order = [...groups.keys()].sort((a, b) => {
        const at = (n) => people.findIndex((x) => sameName(x, n));
        const rank = (n) => (n === "" ? 1e6 : sameName(n, me) ? -1 : at(n) === -1 ? 1e5 : at(n));
        return rank(a) - rank(b);
      });
      const pp = el("div", "pp");
      pp.dataset.pp = "";
      order.forEach((who) => {
        const pics = groups.get(who);
        const pg = el("div", "pp-pg");
        pg.dataset.who = who;
        const head = el("div", "stub-who");
        const seat = el("span", "", str(pics[0].seat) || (who ? "" : str(stop.tkSeat)));
        if (who) {
          // Whose code this is: the seal, the name, and yours or not yours.
          head.classList.add("is-whose");
          const mine = sameName(who, me);
          const person = (store.state.people || []).find((x) => x && sameName(x.name, who));
          const hd = el("span", "wh-head");
          const words = el("span");
          const small = el("small", mine ? "" : "is-not");
          if (mine) {
            const jp = el("span", "", "あなたの券 ");
            jp.setAttribute("aria-hidden", "true");
            small.append(jp, "Your code");
          } else small.append(who + "’s code, not yours");
          words.append(el("b", "", who.toUpperCase()), small);
          hd.append(sealFor(mine ? "me" : "other", { ...person, initials: [...who][0].toUpperCase() }, who, "s46"), words);
          head.append(hd, seat);
        } else head.append(el("b", "", "ALL"), seat);
        pg.append(head, ...pics.map((t) => slot(t, { zoom: pics.length > 1, page: pics.length > 1 })));
        pp.append(pg);
      });
      p.append(pp);
      let seats = order.map((who) => str(groups.get(who)[0].seat) || str(stop.tkSeat));
      if (order.length > 1) {
        const w3 = el("div", "who3");
        order.forEach((who, i) => {
          const b = el("button");
          b.type = "button";
          b.dataset.k = String(i);
          b.setAttribute("aria-label", who ? (sameName(who, me) ? "Your code" : who + "’s code") : "The code for everyone");
          const seal = el("span", "seal" + (i === 0 ? " is-on" : ""), who ? "" : "全");
          if (who) {
            const person = (store.state.people || []).find((x) => x && sameName(x.name, who));
            fillSeal(seal, { ...person, initials: [...who][0].toUpperCase() }, who);
          }
          b.append(seal, sameName(who, me) ? "You" : who || "All");
          w3.append(b);
        });
        p.append(w3);
      }
      return { node: p, seat: seats[0], seats, order };
    }
    if (k.kind === "one") {
      const n = people.length;
      const head = el("div", "stub-who");
      head.append(el("b", "", n > 1 ? n + "名 · ALL " + (NUMBER_WORD[n] || n) : "ALL"), el("span", "", str(stop.tkSeat)));
      p.append(head, slot(k.list[0], { zoom: true }));
      return { node: p, seat: str(stop.tkSeat) };
    }
    const head = el("div", "stub-who");
    head.append(el("b", "", "E-TICKET"), el("span", "", "Tap to enlarge"));
    p.append(head, ...k.list.slice().sort(byPage).map((t) => slot(t, { zoom: true, page: true })));
    return { node: p, seat: str(stop.tkSeat) };
  }

  function signature() {
    if (mode === "stay") {
      const stay = stayOf();
      const now = nowHere();
      return JSON.stringify([
        stay && [stay.name, stay.nameJp, stay.firstNight, stay.lastNight, stay.tkRef, stay.tkName, stay.tkPeople, stay.tkRoom],
        picsOf().map((t) => [t.id, t.who, t.page, keep.have(t.id)]),
        stay ? nightOf(stay, { today: now.date, minutes: now.minutes }) : null, now.date, online(),
      ]);
    }
    const stop = stopOf();
    const pics = picsOf();
    return JSON.stringify([
      stop && [stop.title, stop.time, stop.detail, stop.date, stop.tkRef, stop.tkName, stop.tkPeople, stop.tkSeat],
      pics.map((t) => [t.id, t.who, t.seat, t.page, keep.have(t.id)]),
      (store.state.people || []).map((p) => [p.name, p.photo ? p.photo.length + ":" + p.photo.slice(-16) : ""]),
      store.state.me, online(),
    ]);
  }

  // A stay's booking, held up: the white stub, the number large on white.
  function paintStay() {
    const stay = stayOf();
    const pics = picsOf();
    if (!stay || (!pics.length && !hasStayFacts(stay))) {
      close(false);
      return;
    }
    sig = signature();
    forget();
    const now = nowHere();
    const night = nightOf(stay, { today: now.date, minutes: now.minutes });
    const name = str(stay.name) || str(stay.nameJp);
    const span = staySpan(stay);
    const short = nightsShort(night);
    const long = nightsLong(night);

    const ov = el("div", "ov oa");
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Booking: " + name);
    const top = el("div", "oa-top");
    const back = el("button", "", "Put it back");
    back.type = "button";
    back.dataset.close = "";
    top.append(el("span", "", "予約票 Booking" + (now.date ? " · " + dayHead(now.date, []).en : "")), back);

    const stub = el("div", "tstub is-up is-stay");
    const band = el("div", "stub-band");
    const bname = el("span", "", "宿泊");
    bname.append(el("i", "", "Stay"));
    band.append(bname);
    const dn = stayDayNums(stay, store.state.days);
    if (dn) {
      const num = el("span", "num");
      num.append(el("small", "", "D"), " " + dn);
      band.append(num);
    }
    const sh = el("div", "stub-h");
    const kind = el("div", "stub-k");
    const kk = el("span", "", "予約票");
    kk.append(el("i", "", "Booking"));
    kind.append(kk, el("span", "", [long, short].filter(Boolean).join(" · ")));
    sh.append(kind, el("div", "stub-t", name));
    if (str(stay.name) && str(stay.nameJp)) sh.append(el("div", "stub-w", str(stay.nameJp)));
    stub.append(band, sh);

    const p = el("div", "stub-p");
    const ref = str(stay.tkRef);
    const said = deskLines(stay, now.date);
    if (ref || said) {
      const big = el("div", "ref-big");
      if (ref) {
        big.append(el("small", "", "予約番号 Booking number"), el("b", [...ref].length > 14 ? "is-long" : "", ref));
      }
      if (said) {
        const jp = el("p");
        jp.append(said.jp[0], el("br"), said.jp[1]);
        big.append(jp, el("span", "", said.en));
      }
      p.append(big);
    }
    const rows = [
      ["お名前", "Name on booking", str(stay.tkName), ""],
      ["人数", "In the room", peopleWord(stay.tkPeople), ""],
      ["部屋", "Room", str(stay.tkRoom), ""],
      ["泊数", "Nights", short, span],
    ].filter((r) => r[2]);
    if (rows.length) {
      const dl = el("dl", "facts");
      for (const [jp, en, v, small] of rows) {
        const d = el("div");
        const dt = el("dt", "", jp);
        dt.append(el("i", "", en));
        const dd = el("dd", "", v);
        if (small) dd.append(el("small", "", small));
        d.append(dt, dd);
        dl.append(d);
      }
      p.append(dl);
    }
    stub.append(p);
    // The confirmation's pages, in order of person then page.
    if (pics.length) {
      const f = el("div", "stub-f");
      const cap = el("div", "pg-cap", "予約確認書 Confirmation, " + (pics.length === 1 ? "1 page" : pics.length + " pages"));
      cap.append(el("span", "", "Tap to enlarge"));
      const pages = el("div", "pages" + (pics.length === 1 ? " is-one" : ""));
      pages.append(...pics.map((t) => slot(t, { zoom: true, page: true })));
      f.append(cap, pages);
      stub.append(el("div", "stub-perf"), f);
    }
    const foot = el("div", "stub-foot");
    foot.append(keptLine(pics.length ? "pics" : null, pics.every((t) => keep.have(t.id))), el("span", "", stayDots(stay)));
    stub.append(foot);
    const wl = el("span", "oa-x", "Screen stays on while the booking is up.");
    wl.hidden = !locked;
    ov.append(top, stub, wl);
    host.replaceChildren(ov);
    groupKey = null;
  }

  // Draws the stub. again: a redraw of the one up (no tear, the page in view kept).
  function paint(again = false) {
    if (mode === "stay") {
      paintStay();
      return;
    }
    const s = store.state;
    const stop = stopOf();
    if (!stop) {
      close(false);
      return;
    }
    const pics = picsOf();
    if (!pics.length && !hasFacts(stop)) {
      close(false);
      return;
    }
    sig = signature();
    forget();
    const days = Array.isArray(s.days) ? s.days : [];
    const i = days.findIndex((d) => d && d.date === stop.date);
    const day = i >= 0 ? days[i] : { date: stop.date };
    const h = header(day);
    const people = (s.people || []).map((p) => p.name);
    const k = ticketKinds(pics);

    const ov = el("div", "ov oa");
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Ticket: " + str(stop.title));
    const top = el("div", "oa-top");
    const back = el("button", "", "Put it back");
    back.type = "button";
    back.dataset.close = "";
    top.append(el("span", "", "切取 Torn off · " + (stop.date ? dayHead(stop.date, []).en : "")), back);

    // A redraw while the stub is still tearing off (its pictures arriving)
    // carries the tear on from where it was, rather than jumping to the end.
    const was = again ? host.querySelector(".tstub") : null;
    const tearing = was && typeof was.getAnimations === "function" ? was.getAnimations().find((a) => a.animationName === "tear" && a.playState === "running") : null;
    const tearAt = tearing ? tearing.currentTime : null;
    const stub = el("div", "tstub" + (again && tearAt === null ? " is-up" : ""));
    if (h.colour) {
      stub.style.setProperty("--line", h.colour);
      stub.style.setProperty("--line-ink", h.ink);
    }
    const band = el("div", "stub-band");
    const name = el("span", "", h.line ? h.line.jp || h.line.en : h.city || "切符");
    if (h.line && h.line.jp && h.line.en) name.append(el("i", "", h.line.en));
    const num = el("span", "num");
    num.append(el("small", "", "D"), " " + String(i >= 0 ? i + 1 : 0).padStart(2, "0"));
    band.append(name, num);
    const sh = el("div", "stub-h");
    const kind = el("div", "stub-k");
    const kk = el("span", "", "切符");
    kk.append(el("i", "", k.kind === "pages" ? "E-ticket, " + k.list.length + " pages" : k.kind ? "Ticket" : "Reservation"));
    kind.append(kk, el("span", "", /^\d{2}:\d{2}$/.test(stop.time || "") ? stop.time : ""));
    sh.append(kind, el("div", "stub-t", str(stop.title)));
    if (str(stop.detail)) sh.append(el("div", "stub-w", str(stop.detail)));

    const b = body(stop, k, people, s.me);
    const fbox = el("div", "stub-f");
    fbox.dataset.facts = "";
    const f = facts(stop, b.seat);
    if (f) fbox.append(f);
    const foot = el("div", "stub-foot");
    foot.append(keptLine(k.kind, k.list.every((t) => keep.have(t.id))), el("span", "", "当日限り有効"));
    stub.append(band, sh, b.node, el("div", "stub-perf"), fbox, foot);
    const wl = el("span", "oa-x", "Screen stays on while the stub is up.");
    wl.hidden = !locked;
    ov.append(top, stub, wl);
    host.replaceChildren(ov);
    if (tearAt !== null) for (const a of stub.getAnimations()) if (a.animationName === "tear") a.currentTime = tearAt;

    // The per-person pages: the seals follow the swipe, the facts follow the page.
    const pp = ov.querySelector("[data-pp]");
    if (pp && b.order && b.order.length > 1) {
      const seals = [...ov.querySelectorAll(".who3 button")];
      const at = (n) => {
        seals.forEach((x, j) => x.firstElementChild.classList.toggle("is-on", j === n));
        groupKey = b.order[n];
        const nf = facts(stop, b.seats[n]);
        fbox.replaceChildren(...(nf ? [nf] : []));
      };
      seals.forEach((x, n) => x.addEventListener("click", () => {
        pp.scrollTo({ left: n * pp.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        at(n);
      }));
      pp.addEventListener("scroll", () => {
        const n = Math.max(0, Math.min(seals.length - 1, Math.round(pp.scrollLeft / Math.max(1, pp.clientWidth))));
        if (b.order[n] !== groupKey) at(n);
      }, { passive: true });
      const keepAt = again && groupKey !== null ? b.order.indexOf(groupKey) : 0;
      groupKey = b.order[0];
      if (keepAt > 0) {
        requestAnimationFrame(() => {
          pp.scrollLeft = keepAt * pp.clientWidth;
          at(keepAt);
        });
      }
    } else groupKey = null;
  }

  function open(id, from = null, { stay = false } = {}) {
    if (typeof id !== "string" || !id) return false;
    mode = stay === true ? "stay" : "stop";
    stopId = id;
    opener = from;
    groupKey = null;
    failedNow.clear();
    host.hidden = false;
    paint(false);
    if (!isOpen()) return false;
    root.classList.add("stub-open");
    const back = host.querySelector("[data-close]");
    if (back) back.focus({ preventScroll: true });
    wake();
    return true;
  }

  function close(restoreFocus = true) {
    if (!isOpen()) return;
    host.hidden = true;
    host.replaceChildren();
    forget();
    sleep();
    locked = false;
    root.classList.remove("stub-open");
    stopId = null;
    mode = "stop";
    sig = "";
    const back = opener;
    opener = null;
    if (restoreFocus && back && back.isConnected) back.focus({ preventScroll: true });
  }

  host.addEventListener("click", (ev) => {
    if (ev.target.closest(".zoom")) {
      zoomOut();
      return;
    }
    if (ev.target.closest("[data-close]")) {
      close();
      return;
    }
    const z = ev.target.closest(".stub-code.can-zoom");
    if (z) {
      zoomIn(z);
      return;
    }
    // The dark around the stub.
    if (!ev.target.closest(".tstub")) close();
  });
  host.addEventListener("keydown", (ev) => {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches(".stub-code.can-zoom")) {
      ev.preventDefault();
      zoomIn(ev.target);
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !isOpen() || ev.isComposing) return;
    if (!zoomOut()) close();
  });
  const again = () => {
    if (isOpen() && signature() !== sig) paint(true);
  };
  store.subscribe(again);
  keep.subscribe(again);

  return { open, openStay: (id, from = null) => open(id, from, { stay: true }), close, isOpen };
}
