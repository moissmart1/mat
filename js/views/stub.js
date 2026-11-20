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
//   opens on this phone's person first, then the others in trip order;
// - one code for everyone; a PDF's pages one under another (tap to enlarge);
// - no picture: the booking ref, large, with a sentence for staff.
// A picture not on this phone yet is fetched now when there is signal
// ("Saving to this phone"), else it says it needs signal once. Every name,
// ref and seat goes in with textContent; a picture only as an <img> from a
// blob: URL made from bytes whose type was checked (js/tickets.js sniff).
// Reduced motion: no tear, it is simply there (css/tickets.css).

import { header } from "../plan.js";
import { dayHead } from "../format.js";
import { fillSeal } from "../picture.js";
import { ticketKinds, hasFacts, sniff, fromBase64 } from "../tickets.js";

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

export function mountStub(root, store, keep) {
  const host = el("div", "tix");
  host.id = "tix";
  host.hidden = true;
  root.append(host);

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
  const picsOf = () => (store.state.tickets || []).filter((t) => t && t.stop === stopId && !t.gone);

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
        const rank = (n) => (n === "" ? 1e6 : n === me ? -1 : people.indexOf(n) === -1 ? 1e5 : people.indexOf(n));
        return rank(a) - rank(b);
      });
      const pp = el("div", "pp");
      pp.dataset.pp = "";
      order.forEach((who) => {
        const pics = groups.get(who);
        const pg = el("div", "pp-pg");
        pg.dataset.who = who;
        const head = el("div", "stub-who");
        head.append(el("b", "", who ? who.toUpperCase() : "ALL"), el("span", "", str(pics[0].seat) || (who ? "" : str(stop.tkSeat))));
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
          b.setAttribute("aria-label", who ? (who === me ? "Your code" : who + "’s code") : "The code for everyone");
          const seal = el("span", "seal" + (i === 0 ? " is-on" : ""), "全");
          if (who) fillSeal(seal, store.state.people?.find((person) => person.name === who), who, { singleLetter: true });
          b.append(seal, who === me ? "You" : who || "All");
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
    const stop = stopOf();
    const pics = picsOf();
    return JSON.stringify([
      stop && [stop.title, stop.time, stop.detail, stop.date, stop.tkRef, stop.tkName, stop.tkPeople, stop.tkSeat],
      pics.map((t) => [t.id, t.who, t.seat, t.page, keep.have(t.id)]),
      (store.state.people || []).filter((p) => pics.some((t) => t.who === p.name)).map((p) => [p.name, p.photo]),
      store.state.me, online(),
    ]);
  }

  // Draws the stub. again: a redraw of the one up (no tear, the page in view kept).
  function paint(again = false) {
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

  function open(id, from = null) {
    if (typeof id !== "string" || !id) return false;
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

  return { open, close, isOpen };
}
