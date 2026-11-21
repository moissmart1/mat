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
// - Tonight's stay (look A, 予約票): when tonight's stay has a booking
//   (passCase's hook), lines of type at the top of the case: 今夜の宿 and the
//   night, the stay's name, its booking number, and 予約票 Show booking
//   (onStay(stayId, button): the app holds the booking up, js/views/stub.js).
//   It shows even with no stop ticket at all.
// - A ticket's first picture, small in the window, comes from the keep (the
//   pictures already on this phone, js/tickets.js); nothing is fetched here.
// - Whose each ticket is (passCase's whose, js/tickets.js whoseOf; issue #83,
//   Mo's pick B-2): the window's ticket carries a holder's line along its
//   foot as a commuter pass does (your seal, your name 様 and seat, the other
//   holders' seals; 全 ALL OF US; a dashed seal NONE FOR YOU YET), Show
//   ticket's right side says Yours / All of us / Not yours, and every slot
//   has a whose column (a seal and Yours, All of us or None yet; a reference
//   keeps its number). Every label says it in words too.
// Every title, detail, seat and reference goes in with textContent.

import { passCase } from "../passcase.js";
import { sealFor, photoSig } from "./nextticket.js";
import { sameName } from "../tickets.js";
import { dayHead } from "../format.js";
import { nightsShort, nightsLong } from "../staywords.js";

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

// Names in a sentence: "Mo", "Mo and Trenton", "Mo, Trenton and Ajen".
const names = (list) => (list.length < 2 ? list.join("") : list.slice(0, -1).join(", ") + " and " + list[list.length - 1]);
// Whose it is, for a label: ", yours, Car 7 · 10B", ", one code for all of us", ", no code for you yet, Mo and Trenton have theirs".
function whoseWords(t) {
  const w = t.whose;
  if (!w || w.kind === "ref") return "";
  if (w.kind === "mine") return ", yours" + (w.seat ? ", " + w.seat : "");
  if (w.kind === "all") return w.count > 0 ? ", a code for all of us" : t.status.label && / pages$/.test(t.status.label) ? ", " + t.status.label + " for all of us" : ", one code for all of us";
  const h = (w.holders || []).filter(Boolean);
  return ", no code for you yet" + (h.length ? ", " + names(h) + (h.length === 1 ? " has theirs" : " have theirs") : "");
}

// A seat breaks only at its " · ", never inside "10A–C".
function seatEl(seat) {
  const n = el("span", "pc-seat");
  seat.split(" · ").forEach((part, i) => {
    if (i) n.append(" · ");
    n.append(el("span", "pc-sp", part));
  });
  return n;
}

export function mountPassCase(root, store, { clock, keep, where = null, onTicket = () => {}, onStay = () => {}, onBefore = () => {}, onState = () => {} } = {}) {
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

  const personOf = (name) => (store.state.people || []).find((p) => p && sameName(p.name, name)) || null;
  const meName = () => (typeof store.state.me === "string" ? store.state.me : "");

  // The holder's line along the foot of the window's ticket, under a rule.
  function nameLine(t) {
    const w = t.whose;
    if (!w || w.kind === "ref") return null;
    const me = meName();
    const line = el("span", "wh-name");
    line.dataset.whose = w.kind;
    const others = (w.holders || []).filter((n) => n && !sameName(n, me));
    if (w.kind === "mine") {
      const b = el("b", "", me.toUpperCase());
      b.append(el("i", "", "様"));
      line.append(sealFor("me", personOf(me), me, "s30"), b);
      if (w.seat) line.append(el("span", "wh-name-s", w.seat));
    } else if (w.kind === "all") {
      line.append(sealFor("all", null, "", "s30"), el("b", "", "ALL OF US"));
      if (w.seat) line.append(el("span", "wh-name-s", w.seat));
    } else {
      line.append(sealFor("none", null, "", "s30"), el("b", "wh-none", "NONE FOR YOU YET"));
    }
    if (w.kind !== "all" && others.length) {
      const o = el("span", "wh-oth");
      for (const n of others) o.append(sealFor("other", personOf(n), n));
      line.append(o);
    }
    return line;
  }

  // A slot's whose column: a seal and one word (a reference keeps its number instead).
  function whoseCol(t) {
    const w = t.whose;
    const col = el("span", "wh-col");
    col.dataset.whose = w.kind;
    const me = meName();
    if (w.kind === "mine") col.append(sealFor("me", personOf(me), me, "s28"), el("i", "", "Yours"));
    else if (w.kind === "all") col.append(sealFor("all", null, "", "s28"), el("i", "", "All of us"));
    else col.append(sealFor("none", null, "", "s28"), el("i", "", "None yet"));
    return col;
  }

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
    if (t.colour) {
      b.style.setProperty("--line", t.colour);
      if (t.ink) b.style.setProperty("--line-ink", t.ink); // the same ink the Days ticket and the stub use for this colour
    }
    b.setAttribute("aria-label", "Show ticket: " + (t.title || "the next ticket") + (t.time ? ", " + t.time : "") + ", " + statusWords(t.status) + whoseWords(t));
    const band = el("span", "pc-band");
    const name = el("span", "pc-bn");
    if (t.line && (t.line.jp || t.line.en)) {
      name.append(t.line.jp || t.line.en);
      if (t.line.jp && t.line.en) name.append(el("i", "", t.line.en));
    } else name.append("切符", el("i", "", "Ticket"));
    const num = el("span", "num");
    if (t.day > 0) num.append(el("small", "", "D"), " " + String(t.day).padStart(2, "0"));
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
      lv.append(deco("span", "pc-tag", "こんど"), el("span", "pc-lt", t.lead));
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
      // Your own code: your seat under it (else the stop's).
      const seat = t.whose && t.whose.kind === "mine" ? t.whose.seat : t.seat;
      if (seat) side.append(seatEl(seat));
      body.append(side);
    }
    b.append(band, body);
    const nl = nameLine(t);
    if (nl) b.append(nl);
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
    b.setAttribute("aria-label", (pocket === "used" ? "Used: " : "Show ticket: ") + (t.title || "Ticket") + ", " + (other ? head + (t.time ? " " : "") : "") + (t.time || (other ? "" : "today")) + ", " + statusWords(t.status) + whoseWords(t));
    const time = el("span", "pc-t");
    time.append(t.time || "—");
    // A later (or earlier) day's date under the time: the right is whose it is.
    if (other) time.append(el("small", "", wd + " " + dn));
    const n = el("span", "pc-n");
    n.append(el("span", "pc-nt", t.title || "Ticket"), statusLine(t.status));
    b.append(time, n);
    if (t.status.kind === "ref" && t.status.ref) {
      const r = el("span", "pc-refno", t.status.ref);
      r.append(deco("small", "", "予約番号"));
      b.append(r);
    } else if (t.whose && t.whose.kind !== "ref") b.append(whoseCol(t));
    else b.append(deco("span", "pc-d", "›"));
    wrap.append(b);
    return wrap;
  }

  // Tonight's stay, in type: the label and the night, the name, the booking
  // number, and the key that holds the booking up.
  function stayEl(k) {
    const box = el("div", "pc-stay");
    const label = el("div", "pc-stay-l");
    const lw = el("span");
    lw.append(deco("span", "", "今夜の宿 "), "Tonight’s stay");
    const short = nightsShort(k);
    label.append(lw);
    if (short) label.append(deco("span", "", short));
    box.append(label, el("div", "pc-stay-n", k.name));
    if (k.ref) {
      const r = el("div", "pc-stay-r");
      const sm = el("small");
      sm.append(deco("span", "", "予約番号 "), "Booking no.");
      r.append(sm, el("b", "", k.ref));
      box.append(r);
    }
    const show = button("pc-stay-b");
    show.dataset.act = "stay";
    show.dataset.stay = k.id;
    const w = el("span");
    w.append(deco("b", "", "予約票"), "Show booking");
    const nl = nightsLong(k);
    show.append(w, deco("i", "", nl ? nl + " ›" : "›"));
    show.setAttribute("aria-label", "Show booking: " + k.name + (nl ? ", " + nl.toLowerCase() : ""));
    box.append(show);
    return box;
  }

  // Show ticket's right side: Yours · Car 7 · 10B, All of us · seat, Not yours; a reference its seat.
  function showWords(t) {
    const w = t.whose;
    if (!w || w.kind === "ref") return t.seat;
    if (w.kind === "mine") return w.seat ? "Yours · " + w.seat : "Yours";
    if (w.kind === "all") return w.seat ? "All of us · " + w.seat : "All of us";
    return "Not yours";
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
    if (c.hook) box.append(stayEl(c.hook));
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
      const sw = showWords(c.next);
      if (sw) show.append(el("i", "", sw));
      show.setAttribute("aria-label", "Show ticket: " + (c.next.title || "the next ticket") + whoseWords(c.next));
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
      else if (spot.act === "stay") target = section.querySelector('[data-act="stay"]');
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
    // The "in N min" line changes every minute: that text is updated where it
    // stands, so the case, its buttons and the picture are not rebuilt (focus
    // and the picture stay). Anything else that changed redraws.
    // The seals follow the people's pictures and who is on this phone.
    const faces = [(s.people || []).map((p) => [p && p.name, photoSig(p)]), s.me];
    const next = JSON.stringify([c.next ? { ...c.next, lead: !!c.next.lead } : null, { ...c, next: null }, beforeOpen, faces]);
    if (next === sig) {
      const lt = section.querySelector("#pcWin .pc-lt");
      const want = c.next && c.next.lead ? c.next.lead : "";
      if (lt && lt.textContent !== want) lt.textContent = want;
      return;
    }
    sig = next;
    draw(c);
  }

  section.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-act]");
    if (!b || !section.contains(b)) return;
    if (b.dataset.act === "before") onBefore(b);
    else if (b.dataset.act === "stay") onStay(b.dataset.stay, b);
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
