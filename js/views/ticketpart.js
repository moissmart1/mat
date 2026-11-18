/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The Ticket part of a stop's Edit sheet (js/views/stopsheet.js), under its
// other fields, as the tickets mock-up's three attach steps: the pictures
// already on the stop (each with Remove), Add pictures or a PDF (the phone's
// own picker), each picked picture as a thumbnail with who it is for (All
// three / M / A / T: one file is for all three, as many files as people are
// theirs in trip order, one tap changes it) and, for a person, their seat;
// then the four facts shown with the ticket.
//
// mountTicketPart(box, store, keep) -> { fill(stop), read(), fieldsOf(stop),
//   changed(), pending(), setBusy(on), upload(stopId), clear(), inputs() }
// - fill(stop): the stop's facts and pictures, nothing picked (stop is {} for a new one).
// - read(): the facts as the backend takes them ({ tkRef, tkName, tkPeople, tkSeat }).
// - upload(stopId) -> { saved, waiting, failed }: sends each picked picture in
//   turn (kept in the keep first, so one that has to wait for signal is still
//   on the phone), showing each one's progress; one refused leaves the others
//   going and stays in the list with the reason.
// Every file is read by its first bytes (js/tickets.js sniff): an SVG or any
// other file is refused at once with a sentence. A PDF is turned into
// pictures of its pages here, before anything is sent; more pages than the
// stop has room for are said before Save, not after. Text goes in with
// textContent; a thumbnail is an <img> from a blob: URL of bytes the phone
// made itself (or checked, from the keep).

import { LIMITS, NOT_A_TICKET, sniff, shrink, shrinkCanvas, pdfPages } from "../tickets.js";
import { newId } from "../time.js";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const str = (v) => (typeof v === "string" ? v : "");
const FACTS = [
  ["tkRef", "Booking ref"],
  ["tkName", "Name on booking"],
  ["tkPeople", "People"],
  ["tkSeat", "Seats or time"],
];
const mb = (chars) => {
  const bytes = (chars * 3) / 4;
  return (bytes < 50000 ? "under 0.1" : (Math.round(bytes / 100000) / 10).toFixed(1)) + " MB";
};

export function mountTicketPart(box, store, keep) {
  box.classList.add("tkp");
  const head = el("div", "st-sec tkp-h");
  const count = el("i", "", "Optional");
  head.append(el("b", "", "切符"), "Ticket", count);
  const have = el("div", "tkp-have");
  const none = el("p", "st-none", "No ticket on this stop yet.");
  const pick = el("label", "tkp-add");
  const input = el("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,application/pdf";
  input.multiple = true;
  input.id = "stTkFile";
  pick.append(input, el("span", "", "Add pictures or a PDF"));
  const picked = el("div", "tkp-picked");
  const say = el("p", "tkp-say");
  say.setAttribute("role", "status");
  const facts = el("div", "tkp-facts");
  const fhead = el("div", "st-sec tkp-fh");
  fhead.append(el("b", "", "控"), "Shown with the ticket");
  const fields = {};
  const pair = () => el("div", "st-2");
  const rows = [pair(), pair()];
  FACTS.forEach(([k, label], i) => {
    const l = el("label", "st-f");
    const f = el("input");
    f.id = "st" + k[0].toUpperCase() + k.slice(1);
    f.maxLength = LIMITS.fact;
    f.autocomplete = "off";
    f.enterKeyHint = i === FACTS.length - 1 ? "done" : "next";
    l.append(el("span", "", label), f);
    rows[i < 2 ? 0 : 1].append(l);
    fields[k] = f;
  });
  facts.append(fhead, ...rows);
  box.replaceChildren(head, have, none, picked, pick, say, facts);

  let stop = null;
  let was = {};
  let picks = []; // { key, name, size, mime, w, h, data, blob, url, who, seat, page, row, state }
  let urls = [];
  const haveUrls = new Map(); // a picture on the stop -> its thumbnail's address, made once
  let busy = false;
  let reading = 0; // files still being turned into pictures

  const people = () => (store.state.people || []).map((p) => p.name).filter(Boolean);
  const liveOn = (id) => (store.state.tickets || []).filter((t) => t && t.stop === id && !t.gone);
  const room = () => {
    const onStop = stop && stop.id ? liveOn(stop.id).length : 0;
    const inTrip = (store.state.tickets || []).filter((t) => t && !t.gone).length;
    return Math.max(0, Math.min(LIMITS.perStop - onStop - picks.length, LIMITS.perTrip - inTrip - picks.length));
  };

  const url = (blob) => {
    const u = URL.createObjectURL(blob);
    urls.push(u);
    return u;
  };

  // A thumbnail from a blob (one URL each) or an address made already.
  function thumb(blob, made = null) {
    const th = el("div", "th");
    if (blob || made) {
      const img = el("img");
      img.alt = "";
      img.src = made || url(blob);
      th.append(img);
    } else th.append(el("b", "", "券"));
    return th;
  }

  function whoLabel(t) {
    if (t.who) return t.who + "’s code";
    return liveOn(t.stop).length > 1 ? "Page " + t.page : "For all three";
  }

  // The pictures already on the stop, each with Remove (at once, Undo on the bar).
  function drawHave() {
    const list = stop && stop.id ? liveOn(stop.id).slice().sort((a, b) => (a.who || "~").localeCompare(b.who || "~") || a.page - b.page) : [];
    const nodes = list.map((t) => {
      const r = el("div", "file is-on");
      r.dataset.id = t.id;
      const th = thumb(null, haveUrls.get(t.id) || null);
      if (!haveUrls.has(t.id) && keep.have(t.id)) {
        keep.get(t.id).then(async (blob) => {
          if (!blob || haveUrls.has(t.id) || (await sniff(blob)) !== t.mime) return;
          haveUrls.set(t.id, url(blob));
          if (r.isConnected) th.replaceChildren(thumb(null, haveUrls.get(t.id)).firstChild);
        });
      }
      const n = el("div", "file-n", whoLabel(t));
      n.append(el("i", "", [t.seat, t.pending ? "Saving…" : ""].filter(Boolean).join(" · ") || mb(t.size || 0)));
      const x = el("button", "file-rm", "Remove");
      x.type = "button";
      x.dataset.rm = t.id;
      x.disabled = busy || !!t.pending || store.state.online === false;
      x.setAttribute("aria-label", "Remove " + whoLabel(t));
      r.append(th, n, x);
      return r;
    });
    have.replaceChildren(...nodes);
    none.hidden = nodes.length > 0 || picks.length > 0;
    const n = list.length + picks.length;
    count.textContent = n ? n + (n === 1 ? " picture" : " pictures") : "Optional";
  }

  function forRow(p) {
    const fr = el("div", "file-for");
    fr.append("For ");
    const opts = [["", "All three"], ...people().map((name) => [name, [...name][0].toUpperCase()])];
    if (people().length !== 3) opts[0][1] = "Everyone";
    for (const [v, label] of opts) {
      const b = el("button", p.who === v ? "is-on" : "", label);
      b.type = "button";
      b.dataset.for = p.key + "|" + v;
      b.setAttribute("aria-pressed", String(p.who === v));
      if (v) b.setAttribute("aria-label", "For " + v);
      b.disabled = busy;
      fr.append(b);
    }
    return fr;
  }

  function drawPicked() {
    picked.replaceChildren(...picks.map((p) => {
      const r = el("div", "file");
      r.dataset.key = p.key;
      if (p.state === "failed") r.classList.add("is-failed");
      const n = el("div", "file-n", p.name);
      const st = p.state === "saving" ? "Saving…" : p.state === "failed" ? p.message : mb(p.data.length);
      n.append(el("i", "", st));
      const x = el("button", "file-x", "×");
      x.type = "button";
      x.dataset.drop = p.key;
      x.disabled = busy;
      x.setAttribute("aria-label", "Take off " + p.name);
      if (!p.url) p.url = url(p.blob);
      r.append(thumb(null, p.url), n, x, forRow(p));
      if (p.who) {
        const l = el("label", "st-f file-seat");
        const f = el("input");
        f.value = p.seat;
        f.maxLength = LIMITS.fact;
        f.autocomplete = "off";
        f.dataset.seat = p.key;
        f.disabled = busy;
        l.append(el("span", "", p.who + "’s seat"), f);
        r.append(l);
      }
      return r;
    }));
    drawHave();
  }

  // Turns picked files into pictures, in the order picked. One file: for all
  // three; as many as there are people: theirs, in trip order.
  async function take(files) {
    const list = [...files];
    if (!list.length) return;
    reading += 1;
    let refused = 0;
    let cut = "";
    const ppl = people();
    const forEach = list.length > 1 && list.length === ppl.length;
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        const type = await sniff(file);
        const who = forEach ? ppl[i] : "";
        const name = str(file.name).slice(0, 60) || "Picture";
        if (type === "application/pdf") {
          const space = room();
          if (!space) {
            cut = "This stop has no room for more pictures (" + LIMITS.perStop + " at most).";
            continue;
          }
          say.textContent = "Reading the PDF…";
          let got;
          try {
            got = await pdfPages(file, { max: space });
          } catch {
            cut = "That PDF couldn’t be read here. Try a screenshot of the ticket instead.";
            continue;
          }
          if (got.total > got.pages.length) {
            cut = "This PDF has " + got.total + " pages; a stop holds " + LIMITS.perStop + " pictures, so only the first " + got.pages.length + (got.pages.length === 1 ? " page" : " pages") + " will be kept.";
          }
          for (let k = 0; k < got.pages.length; k++) {
            const pic = await shrinkCanvas(got.pages[k]);
            picks.push({ key: newId(), name: name + (got.total > 1 ? " · page " + (k + 1) : ""), who, seat: "", page: k + 1, ...pic });
          }
          continue;
        }
        if (type !== "image/jpeg" && type !== "image/png") {
          refused += 1;
          continue;
        }
        if (!room()) {
          cut = "This stop has no room for more pictures (" + LIMITS.perStop + " at most).";
          continue;
        }
        try {
          const pic = await shrink(file);
          picks.push({ key: newId(), name, who, seat: "", page: 1, ...pic });
        } catch (e) {
          cut = (e && e.message) || NOT_A_TICKET;
        }
      }
    } finally {
      reading -= 1;
    }
    say.textContent = [refused ? (refused === 1 ? "That file can’t be a ticket. " : refused + " files can’t be tickets. ") + NOT_A_TICKET : "", cut].filter(Boolean).join(" ");
    drawPicked();
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }

  input.addEventListener("change", () => {
    const files = input.files;
    take(files).finally(() => {
      input.value = "";
    });
  });
  box.addEventListener("click", (ev) => {
    const f = ev.target.closest("[data-for]");
    if (f && !busy) {
      const [key, who] = f.dataset.for.split("|");
      const p = picks.find((x) => x.key === key);
      if (p) {
        p.who = who;
        drawPicked();
      }
      return;
    }
    const d = ev.target.closest("[data-drop]");
    if (d && !busy) {
      picks = picks.filter((x) => x.key !== d.dataset.drop);
      say.textContent = "";
      drawPicked();
      box.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const rm = ev.target.closest("[data-rm]");
    if (rm && !busy && !rm.disabled) {
      store.removeTicket(rm.dataset.rm);
      drawHave();
    }
  });
  box.addEventListener("input", (ev) => {
    const s = ev.target.closest && ev.target.closest("[data-seat]");
    if (!s) return;
    const p = picks.find((x) => x.key === s.dataset.seat);
    if (p) p.seat = s.value;
  });

  function clear() {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    haveUrls.clear();
    picks = [];
    say.textContent = "";
    picked.replaceChildren();
    have.replaceChildren();
  }

  function fieldsOf(s) {
    const out = {};
    for (const [k] of FACTS) out[k] = str(s && s[k]).trim();
    return out;
  }

  function fill(s) {
    clear();
    stop = s && s.id ? s : null;
    for (const [k] of FACTS) fields[k].value = str(s && s[k]);
    was = fieldsOf(s);
    drawHave();
  }

  function read() {
    const out = {};
    for (const [k] of FACTS) out[k] = fields[k].value.trim();
    return out;
  }

  const changed = () => picks.length > 0 || reading > 0 || FACTS.some(([k]) => fields[k].value.trim() !== was[k]);

  function setBusy(on) {
    if (busy === on) return;
    busy = on;
    input.disabled = on;
    pick.classList.toggle("is-off", on);
    for (const [k] of FACTS) fields[k].disabled = on;
    drawPicked();
  }

  async function upload(stopId) {
    const out = { saved: 0, waiting: 0, failed: 0 };
    stop = (store.state.stops || []).find((s) => s && s.id === stopId) || { id: stopId };
    const todo = picks.filter((p) => p.state !== "saved");
    for (const p of todo) {
      p.state = "saving";
      p.message = "";
      drawPicked();
      say.textContent = "Saving " + (todo.indexOf(p) + 1) + " of " + todo.length + "…";
      const id = newId();
      // On the phone first: a picture that has to wait for signal is sent from here later.
      await keep.put(id, p.blob);
      const sameWho = liveOn(stopId).filter((t) => (t.who || "") === p.who).length;
      const token = store.addTicket({ id, stop: stopId, who: p.who, seat: p.seat.trim(), page: Math.min(LIMITS.perStop, Math.max(p.page, sameWho + 1)), mime: p.mime, w: p.w, h: p.h, data: p.data });
      const res = await store.ticketOutcome(token);
      if (res && res.saved) {
        p.state = "saved";
        out.saved += 1;
      } else if (res && res.reason === "queued") {
        p.state = "saved";
        out.waiting += 1;
      } else {
        p.state = "failed";
        p.message = (res && res.message) || "That picture wasn’t saved.";
        out.failed += 1;
        keep.drop(id);
      }
      picks = picks.filter((x) => x.state !== "saved");
      drawPicked();
    }
    say.textContent = out.failed
      ? (out.failed === 1 ? "One picture wasn’t saved. " : out.failed + " pictures weren’t saved. ") + "The rest are on the stop."
      : out.waiting
      ? "Saved on this phone. It goes up when there is signal."
      : "";
    return out;
  }

  store.subscribe(() => {
    if (box.isConnected && !box.closest("[inert]")) drawHave();
  });
  keep.subscribe(() => {
    if (box.isConnected && !box.closest("[inert]")) drawHave();
  });

  return {
    fill, read, fieldsOf, changed, setBusy, upload, clear,
    pending: () => picks.filter((p) => p.state !== "saved").length,
    reading: () => reading > 0,
    inputs: () => FACTS.map(([k]) => fields[k]),
  };
}
