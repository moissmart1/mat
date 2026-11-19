/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The Tickets tab (定期入れ, the pass case; option A of the tickets-tab
// mock-up, which Mo picked on 2026-11-18). From the trip's first day its key
// stands in Before's place in the bar. A leather case: the next ticket in its
// clear window with a paper-white 切符 Show ticket key under it, then card
// slots for the rest of today, later days, and the used ones in the back
// pocket. Open Before items are a reservation slip (予約票) tucked behind the
// top of the case.
//
// mountPassCase(root, store, { clock, keep, where, onTicket, onBefore, onState })
//   -> { update(), setBefore(open) }
// - root: #vTickets.
// - The order, the pockets and the counts are js/passcase.js passCase; this
//   only draws its result.
// - onTicket(stopId, button): the window, Show ticket or a slot was tapped;
//   the app opens the same stub a stop's Show ticket opens (js/views/stub.js).
// - onBefore(button): the slip's Open; the app shows the Before pad as a sheet.
// - onState({ on, todayLeft }): told on every change whether the key is in the
//   bar (the trip's first day has begun, by the Days clock) and its badge.
// - setBefore(open): how many Before items are still open (the slip's count;
//   no slip at 0).
// - A ticket's first picture, small in the window, comes from the keep (the
//   pictures already on this phone, js/tickets.js); nothing is fetched here.
// Every title, detail, seat and reference goes in with textContent.

import { passCase } from "../passcase.js";
import { dayHead } from "../format.js";

// How often the case looks again while the app is on screen: a ticket's time
// passing moves it to the back pocket, and midnight on Day 1 brings the key.
const LOOK_MS = 30000;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function button(cls) {
  const b = el("button", cls);
  b.type = "button";
  return b;
}
// Japanese beside an English label: decoration, not read out.
function deco(tag, cls, text) {
  const n = el(tag, cls, text);
  n.setAttribute("aria-hidden", "true");
  return n;
}

// "券 3 codes · on this phone", "券 1 code · needs signal once", "番号のみ Reference only".
function statusLine(st) {
  const line = el("small", "pc-st");
  if (st.kind === "ref") {
    line.append(deco("span", "pc-jp", "番号のみ"), " Reference only");
    return line;
  }
  const box = deco("b", "pc-kb" + (st.kind === "needs" ? " is-dash" : ""), "券");
  line.append(box, st.label + (st.kind === "have" ? " · on this phone" : " · needs signal once"));
  return line;
}
const statusWords = (st) => (st.kind === "ref" ? "reference only" + (st.ref ? ", " + st.ref : "") : st.label + (st.kind === "have" ? ", on this phone" : ", needs signal once"));

export function mountPassCase(root, store, { clock, keep, where = null, onTicket = () => {}, onBefore = () => {}, onState = () => {} } = {}) {
  const section = el("section", "pc");
  section.setAttribute("aria-labelledby", "pcTitle");
  root.replaceChildren(section);

  let beforeOpen = 0;
  let sig = "";
  let urls = [];
  let lastState = "";

  const forget = () => {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
  };

  // A ticket's first picture, small: drawn once the keep hands it over.
  function thumb(id) {
    const box = el("span", "pc-th");
    box.setAttribute("aria-hidden", "true");
    (async () => {
      const blob = keep ? await keep.get(id) : null;
      if (!blob || !box.isConnected) return;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = el("img");
      img.alt = "";
      img.decoding = "async";
      img.src = url;
      box.replaceChildren(img);
    })();
    return box;
  }

  function windowTicket(t) {
    const b = button("pc-tk");
    b.dataset.id = t.id;
    b.dataset.act = "win";
    if (t.colour) b.style.setProperty("--line", t.colour);
    b.setAttribute("aria-label", "Show ticket: " + (t.title || "the next ticket") + (t.time ? ", " + t.time : "") + ", " + statusWords(t.status));
    const band = el("span", "pc-band");
    const name = el("span", "pc-bn");
    if (t.line && (t.line.jp || t.line.en)) {
      name.append(t.line.jp || t.line.en);
      if (t.line.jp && t.line.en) name.append(el("i", "", t.line.en));
    } else name.append("切符", el("i", "", "Ticket"));
    const num = el("span", "num");
    num.append(el("small", "", "D"), " " + String(t.day).padStart(2, "0"));
    band.append(name, num);
    const body = el("span", "pc-tb");
    const main = el("span", "pc-tm");
    const kind = el("span", "pc-kind");
    const kk = el("span");
    kk.append(deco("span", "", t.status.kind === "ref" ? "予約" : "切符"), el("i", "", t.status.kind === "ref" ? "Reservation" : "Ticket"));
    kind.append(kk, el("b", "", t.time));
    main.append(kind, el("span", "pc-title", t.title || "Ticket"));
    if (t.detail) main.append(el("span", "pc-detail", t.detail));
    if (t.lead) {
      const lv = el("span", "pc-lv");
      lv.append(deco("span", "pc-tag", "こんど"), t.lead);
      main.append(lv);
    }
    main.append(statusLine(t.status));
    body.append(main);
    if (t.status.kind === "ref" && t.status.ref) {
      const side = el("span", "pc-side");
      const r = el("span", "pc-refno", t.status.ref);
      r.append(deco("small", "", "予約番号"));
      side.append(r);
      body.append(side);
    } else if (t.first) {
      const side = el("span", "pc-side");
      side.append(thumb(t.first));
      if (t.seat) side.append(el("span", "pc-seat", t.seat));
      body.append(side);
    }
    b.append(band, body);
    return b;
  }

  function slot(t, pocket, today) {
    const wrap = el("div", "pc-slot");
    const b = button("pc-pk is-" + t.status.kind + (pocket === "used" ? " is-used" : ""));
    b.dataset.id = t.id;
    b.dataset.act = "slot";
    if (t.colour) b.style.setProperty("--line", t.colour);
    const head = dayHead(t.date, []).en; // "Tue Dec 15"
    const [wd, , dn] = head.split(" ");
    const other = t.date !== today;
    b.setAttribute("aria-label", (pocket === "used" ? "Used: " : "Show ticket: ") + (t.title || "Ticket") + ", " + (other ? head + (t.time ? " " : "") : "") + (t.time || (other ? "" : "today")) + ", " + statusWords(t.status));
    const time = el("span", "pc-t");
    time.append(t.time || "—");
    if (other && t.status.kind === "ref") time.append(el("small", "", wd + " " + dn));
    const n = el("span", "pc-n");
    n.append(el("span", "pc-nt", t.title || "Ticket"), statusLine(t.status));
    b.append(time, n);
    if (t.status.kind === "ref" && t.status.ref) {
      const r = el("span", "pc-refno", t.status.ref);
      r.append(deco("small", "", "予約番号"));
      b.append(r);
    } else if (other) {
      const d = el("span", "pc-d");
      d.append(el("em", "", dn), wd);
      b.append(d);
    } else b.append(deco("span", "pc-d", "›"));
    wrap.append(b);
    return wrap;
  }

  function foil(jp, en, right) {
    const f = el("div", "pc-foil");
    const l = el("span");
    l.append(deco("span", "", jp + " "), el("i", "", en));
    f.append(l, el("span", "", right));
    return f;
  }

  function draw(c) {
    const spot = (() => {
      const a = document.activeElement;
      if (!a || !section.contains(a)) return null;
      return { act: a.dataset.act || a.id || null, id: a.dataset.id || null };
    })();
    forget();
    const nodes = [];

    const bar = el("div", "bar pc-bar");
    const h = el("h2", "bar-t pc-h", "Tickets");
    h.id = "pcTitle";
    // The space stands outside the date, so a narrow phone breaks the line there.
    h.append(" ", el("i", "", dayHead(c.date, []).en + " · today"));
    bar.append(h);
    if (c.toCome > 0) bar.append(el("span", "pc-come", c.toCome + " to come"));
    nodes.push(bar);

    const holder = el("div", "pc-hold");
    if (beforeOpen > 0) {
      const slip = button("pc-slip");
      slip.id = "pcSlip";
      slip.dataset.act = "before";
      slip.setAttribute("aria-label", "Before we go: " + beforeOpen + " still to book. Open");
      slip.append(deco("b", "", "予約票"), el("span", "", beforeOpen + " still to book"), el("u", "", "Open"));
      holder.append(slip);
    }

    const box = el("div", "pc-case");
    const top = foil("次", "Next", "");
    top.lastChild.append(deco("span", "", "本日 "), c.empty ? "Today" : "Today · " + c.todayLeft + " left");
    box.append(top);
    const win = el("div", "pc-win");
    win.id = "pcWin";
    if (c.next) {
      win.append(windowTicket(c.next));
      box.append(win);
      const show = button("pc-show");
      show.id = "pcShow";
      show.dataset.act = "show";
      show.dataset.id = c.next.id;
      const w = el("span");
      w.append(deco("b", "", "切符"), "Show ticket");
      show.append(w);
      if (c.next.seat) show.append(el("i", "", c.next.seat));
      show.setAttribute("aria-label", "Show ticket: " + (c.next.title || "the next ticket"));
      box.append(show);
    } else {
      const none = el("div", "pc-none");
      if (c.empty) none.append(el("b", "", "No tickets on any stop yet."), el("span", "", "Open a stop, tap Edit, then add it under 切符 Ticket."));
      else none.append(el("b", "", "No ticket still to come."), el("span", "", "The used ones are in the back pocket below."));
      win.append(none);
      box.append(win);
    }
    const pocket = (list, name) => {
      const p = el("div", "pc-slots");
      p.dataset.pocket = name;
      for (const t of list) p.append(slot(t, name, c.date));
      return p;
    };
    if (c.today.length) box.append(pocket(c.today, "today"));
    if (c.later.length) {
      box.append(foil("明日から", "Later days", c.later.length + " in this pocket"));
      box.append(pocket(c.later, "later"));
    }
    if (c.used.length) {
      box.append(foil("使用済", "Used, in the back pocket", String(c.used.length)));
      box.append(pocket(c.used, "used"));
    }
    holder.append(box);
    nodes.push(holder);
    section.replaceChildren(...nodes);

    if (spot) {
      let target = null;
      if (spot.act === "before") target = section.querySelector("#pcSlip");
      else if (spot.id) target = section.querySelector('[data-act="' + spot.act + '"][data-id="' + CSS.escape(spot.id) + '"]') || section.querySelector('[data-id="' + CSS.escape(spot.id) + '"]');
      if (!target) target = section.querySelector("#pcShow") || document.getElementById("ticketsBtn");
      if (target) target.focus({ preventScroll: true });
    }
  }

  function update() {
    const s = store.state;
    const nowMs = clock ? clock.now() : Date.now();
    const here = where && typeof where.current === "function" ? where.current() : null;
    const c = passCase(s, nowMs, { have: (id) => !!keep && keep.have(id), here });
    const st = JSON.stringify([c.on, c.todayLeft]);
    if (st !== lastState) {
      lastState = st;
      onState({ on: c.on, todayLeft: c.todayLeft });
    }
    // The trip was taken off this phone: nothing of it stays in the page.
    if (s.status === "nokey" || !c.on) {
      if (sig !== "") {
        forget();
        section.replaceChildren();
        sig = "";
      }
      return;
    }
    const next = JSON.stringify([c, beforeOpen]);
    if (next === sig) return;
    sig = next;
    draw(c);
  }

  section.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-act]");
    if (!b || !section.contains(b)) return;
    if (b.dataset.act === "before") onBefore(b);
    else if (b.dataset.id) onTicket(b.dataset.id, b);
  });
  // iPhone Safari draws a pressed look (:active) on touch only when something listens.
  section.addEventListener("touchstart", () => {}, { passive: true });

  store.subscribe(update);
  if (clock && clock.subscribe) clock.subscribe(update);
  if (keep && keep.subscribe) keep.subscribe(update);
  if (where && where.subscribe) where.subscribe(update);
  let timer = null;
  const wake = () => {
    if (document.visibilityState !== "hidden" && !timer) {
      timer = setInterval(update, LOOK_MS);
      update();
    } else if (document.visibilityState === "hidden" && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  document.addEventListener("visibilitychange", wake);
  wake();
  update();

  return {
    update,
    setBefore(n) {
      const v = Number.isFinite(n) && n > 0 ? n : 0;
      if (v === beforeOpen) return;
      beforeOpen = v;
      update();
    },
  };
}
