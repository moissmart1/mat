/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// 一括 Add tickets: many ticket files at once (and the list, a CSV, if you
// have it), opened from You, as option C of the bulk-add mock-up, 検札 the
// ticket check: the sure ones go by in a banded bundle (帯), the odd ones are
// held up one card at a time, and 入鋏 adds them all.
//
// mountBulkAdd(root, store, keep, { onOpenDay(date), onClose() }) -> { open(), close(restoreFocus), isOpen(), isBusy() }
//
// Steps: empty (drop zone, Choose files, Choose list) -> reading -> sorted
// (bundle, cards, the quiet lines, 入鋏) -> adding -> added. Nothing is sent
// before 入鋏. Matching is js/bulk.js. Each picture goes in through the same
// path as one added from a stop's Edit sheet (js/views/ticketpart.js
// upload): put in the keep, store.addTicket, then store.ticketOutcome; a PDF
// is made into pictures of its pages here, as there. Fix round 1: every
// picture is made and kept before any is handed over, then all are handed
// over at once (so each is in mat.queue before the first leaves), and the
// stop's ticket facts (only the empty ones, worked out as each is sent)
// follow through store.updateStop, as the Edit sheet's Save does; they never
// hold the pictures up. With no signal the pictures wait on the phone as a
// single add does, after a reload too.
//
// The list and the files never leave the phone except as those pictures and
// facts; nothing from them is logged. Text from them goes in with
// textContent; a thumbnail is an <img> of a picture the phone made itself.
// Closing the sheet any way but Cancel keeps what was sorted (or the adding
// going on); Cancel throws it away, Done after adding starts afresh.

import { LIMITS, sniff, shrink, shrinkCanvas, pdfPages } from "../tickets.js";
import { parseList, sortFiles, factsFor, seatFor, stopLabel } from "../bulk.js";
import { newId } from "../time.js";
import { minutesOf } from "../plan.js";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
const btn = (cls, text) => {
  const b = el("button", cls, text);
  b.type = "button";
  return b;
};
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const initial = (name) => ([...String(name || "")][0] || "").toUpperCase();
const isCsv = (f) => /\.csv$/i.test(String(f.name || "")) || f.type === "text/csv";

async function hashOf(blob) {
  try {
    const d = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

const NOTHING_SENT = "Nothing is sent until 入鋏.";

export function mountBulkAdd(root, store, keep, { onOpenDay = () => {}, onClose = () => {} } = {}) {
  const scrim = el("div", "scrim");
  scrim.id = "bulkScrim";
  scrim.hidden = true;
  const sheet = el("div", "sheet");
  sheet.id = "bulk";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Add tickets");
  sheet.inert = true;
  const top = el("div", "sheet-top");
  const topT = el("span", "", "Add tickets");
  const topI = el("i", "", "一括");
  topT.append(topI);
  const topB = btn("", "Cancel");
  topB.id = "bulkTop";
  top.append(topT, topB);
  const body = el("div", "ba-body");
  const say = el("p", "ba-vh");
  say.setAttribute("role", "status");
  const fileIn = el("input");
  fileIn.type = "file";
  fileIn.multiple = true;
  fileIn.accept = "application/pdf,image/png,image/jpeg";
  fileIn.id = "bulkFiles";
  fileIn.hidden = true;
  fileIn.tabIndex = -1;
  const listIn = el("input");
  listIn.type = "file";
  listIn.accept = ".csv,text/csv";
  listIn.id = "bulkList";
  listIn.hidden = true;
  listIn.tabIndex = -1;
  sheet.append(top, body, say, fileIn, listIn);
  root.append(scrim, sheet);

  let opened = false;
  // phase: "empty" | "reading" | "sorted" | "adding" | "added"
  let phase = "empty";
  let files = []; // { key, name, raw, kind, pages, sig, pic, url, unreadable }
  let list = null; // { rows, error, name }
  let answers = new Map();
  let checked = new Set(); // placement keys answered on a card
  let untied = false;
  let openLine = null; // the untied line being changed
  let other = null; // the card whose "another stop" picker is open
  let reading = { done: 0, total: 0 };
  let hashes = new Map(); // ticket id -> hash of the bytes this phone keeps
  let adding = null; // { done, total, items, ... } while adding and after
  let seeAll = false;
  let urls = [];
  let gen = 0; // one per Cancel / Done: work begun before it is dropped

  const url = (blob) => {
    const u = URL.createObjectURL(blob);
    urls.push(u);
    return u;
  };

  // ---- matching ----

  const liveTickets = () => (store.state.tickets || []).filter((t) => t && !t.gone);
  function isThere(fileKey, stopId, who = "") {
    const f = files.find((x) => x.key === fileKey);
    if (!f || !f.sig) return false;
    return liveTickets().some((t) => t.stop === stopId && (t.who || "") === (who || "") && t.mime === f.sig.mime && Number(t.w) === f.sig.w && Number(t.h) === f.sig.h && Number(t.size) === f.sig.size && (!hashes.has(t.id) || !f.sig.hash || hashes.get(t.id) === f.sig.hash));
  }
  // The bytes of every kept picture that could be the same as a dropped one, hashed once.
  async function hashKept() {
    const want = liveTickets().filter((t) => !hashes.has(t.id) && keep.have(t.id) && files.some((f) => f.sig && f.sig.mime === t.mime && f.sig.w === Number(t.w) && f.sig.h === Number(t.h) && f.sig.size === Number(t.size)));
    for (const t of want) {
      const b = await keep.get(t.id);
      if (b) hashes.set(t.id, await hashOf(b));
    }
  }

  const sorted = () => sortFiles({ files, rows: list && !list.error ? list.rows : [], listError: list ? list.error : null, state: store.state, answers, isThere });

  // ---- reading what was picked or dropped ----

  async function readList(file) {
    const mine = gen;
    let text = "";
    try {
      text = await file.text();
    } catch {
      text = "";
    }
    if (mine !== gen || (phase !== "empty" && phase !== "reading" && phase !== "sorted")) return;
    const got = parseList(text);
    list = { ...got, name: String(file.name || "list.csv").slice(0, 60) };
    // Fix round 1, M4: answers were given to the cards of the old list (or of none): they start again.
    answers = new Map();
    checked = new Set();
    openLine = null;
    other = null;
    if (phase === "empty") draw();
    else afterChange();
  }

  // One pick or drop at a time, in the order they came.
  let queue = Promise.resolve();
  function take(picked) {
    queue = queue.then(() => takeNow(picked)).catch(() => {
      // Anything else that went wrong reading: what was read is kept and sorted, and it is said.
      if (phase === "reading") phase = "sorted";
      draw();
      say.textContent = "A file couldn’t be read on this phone. Try a screenshot of the ticket instead.";
    });
    return queue;
  }
  async function takeNow(picked) {
    const all = [...picked];
    const csv = all.filter(isCsv);
    const rest = all.filter((f) => !isCsv(f));
    const mine = gen;
    if (csv.length) await readList(csv[0]);
    if (!rest.length || mine !== gen) return;
    if (phase !== "empty" && phase !== "sorted") return;
    phase = "reading";
    reading = { done: 0, total: rest.length };
    draw();
    for (const raw of rest) {
      const f = { key: newId(), name: String(raw.name || "A file").slice(0, 80), raw, kind: null, pages: 0, sig: null, pic: null, url: "", unreadable: "" };
      try {
        f.kind = await sniff(raw);
        if (f.kind === "image/png" || f.kind === "image/jpeg") {
          f.pic = await shrink(raw);
          f.pages = 1;
        } else if (f.kind === "application/pdf") {
          // The first page only, for its picture and already-there; the rest are drawn at 入鋏.
          const got = await pdfPages(raw, {
            max: 1,
            each: async (canvas) => {
              f.pic = await shrinkCanvas(canvas);
            },
          });
          f.pages = got.total;
          if (!f.pic) throw new Error("no page");
        }
      } catch {
        f.unreadable = "couldn’t be read on this phone";
        f.kind = null;
        f.pic = null;
      }
      if (f.pic) f.sig = { mime: f.pic.mime, w: f.pic.w, h: f.pic.h, size: f.pic.data.length, hash: await hashOf(f.pic.blob) };
      if (mine !== gen) return;
      files.push(f);
      reading.done += 1;
      drawReading();
    }
    await hashKept();
    if (mine !== gen) return;
    phase = "sorted";
    afterChange();
    say.textContent = plural(files.length, "file", "files") + " sorted.";
  }

  // ---- drawing ----

  const dayLabel = (stop) => stopLabel(stop, store.state.days || []);
  const stopOf = (id) => (store.state.stops || []).find((s) => s && s.id === id && !s.deleted);
  const people = () => (store.state.people || []).map((p) => p.name).filter(Boolean);

  function drawTop() {
    if (phase === "empty") topI.textContent = "一括";
    else if (phase === "adding" || phase === "added") topI.textContent = "punched";
    else topI.textContent = plural(files.length, "file", "files") + (list && !list.error ? " · list of " + list.rows.length : "");
    topB.textContent = phase === "adding" || phase === "added" ? "Done" : "Cancel";
  }

  function emptyZone() {
    const z = el("div", "ba-empty");
    z.append(el("b", "", "Drop the ticket files here."), el("span", "", "PDFs and pictures, all at once. Add the list (.csv) too if you have it: fewer to check by hand."));
    const two = el("div", "ba-two");
    const f = btn("is-p", "Choose files");
    f.id = "bulkChoose";
    f.append(el("small", "", "PDF · PNG · JPG"));
    const l = btn("", list && !list.error ? "List chosen" : "Choose list");
    l.id = "bulkChooseList";
    l.append(el("small", "", list && !list.error ? plural(list.rows.length, "line", "lines") : ".csv, optional"));
    two.append(f, l);
    z.append(two);
    return z;
  }

  function drawReading() {
    const p = body.querySelector(".ba-prog");
    if (!p) return;
    p.firstChild.textContent = "Reading " + reading.done + " of " + reading.total + "…";
    p.querySelector(".ba-bar i").style.width = (reading.total ? Math.round((100 * reading.done) / reading.total) : 0) + "%";
  }

  function progress(head, small, part, whole) {
    const p = el("div", "ba-prog", head);
    p.append(el("small", "", small));
    const bar = el("div", "ba-bar");
    const fill = el("i");
    fill.style.width = (whole ? Math.round((100 * part) / whole) : 0) + "%";
    bar.append(fill);
    p.append(bar);
    return p;
  }

  // A small round seal with a person's initial.
  // Fix round 1, M10: what it means is in the text, for a screen reader.
  const seal = (name) => {
    const s = el("span", "ba-seal", initial(name));
    s.append(el("span", "ba-vh", " for " + name));
    return s;
  };

  // The banded bundle: the top ticket (a stop with one each, else the first),
  // two edges under it, the band with the count.
  function bundle(items, { punched = false, band, small, action, actionLabel, expanded }) {
    const wrap = el("div", "ba-bundle" + (punched ? " is-punched" : ""));
    const edge1 = el("div", "ba-tk");
    const edge2 = el("div", "ba-tk");
    const topTk = el("div", "ba-tk is-top");
    const pp = items.find((i) => i.who && items.filter((j) => j.stop === i.stop && j.who).length > 1);
    const first = pp || items[0];
    const mine = items.filter((i) => i.stop === first.stop);
    const st = stopOf(first.stop) || {};
    const lab = dayLabel(st);
    const each = mine.filter((i) => i.who).length > 1;
    const left = el("div");
    left.append(el("div", "ba-k", [lab.d, lab.when].filter(Boolean).join(" ") + (each ? " · one each" : mine.length > 1 ? " · " + mine.length + " files" : "")), el("div", "ba-n", lab.title));
    const s = el("div", "ba-s");
    if (punched) s.textContent = each ? mine.filter((i) => i.who).map((i) => initial(i.who)).join(" · ") : mine.length + (mine.length === 1 ? " ticket" : " tickets");
    else {
      for (const i of mine.slice(0, 4)) {
        const one = el("span", "ba-id", i.rowIds.length ? i.rowIds.join(" ") : i.file.name);
        if (i.who) one.append(seal(i.who));
        s.append(one);
      }
    }
    left.append(s);
    const right = el("div", "ba-pv");
    if (first.file.pic) {
      const img = el("img");
      img.alt = "";
      img.src = first.file.url || (first.file.url = url(first.file.pic.blob));
      right.append(img);
    }
    topTk.append(left, right);
    const b = el("div", "ba-band");
    const t = el("b");
    t.append(el("span", punched ? "ba-ai is-shu" : "ba-ai", punched ? "済" : "帯"), band, el("small", "", small));
    b.append(t);
    if (action) {
      const u = btn("ba-untie", actionLabel);
      u.dataset.act = action;
      u.setAttribute("aria-expanded", String(!!expanded));
      b.append(u);
    }
    wrap.append(edge1, edge2, topTk, b);
    return wrap;
  }

  // The stops as a picker: one group per day.
  function stopPicker(selected) {
    const s = el("select", "ba-pick");
    s.append(new Option("Pick a stop…", ""));
    const days = store.state.days || [];
    days.forEach((d, i) => {
      const stops = (store.state.stops || []).filter((x) => x && !x.deleted && x.date === d.date);
      if (!stops.length) return;
      stops.sort((a, b) => (minutesOf(a.time) ?? 9999) - (minutesOf(b.time) ?? 9999));
      const g = el("optgroup");
      g.label = "D" + (i + 1) + " " + dayLabel({ date: d.date }).when;
      for (const st of stops) {
        const o = new Option([st.time, st.title].filter(Boolean).join(" ") || "A stop", st.id);
        o.selected = st.id === selected;
        g.append(o);
      }
      s.append(g);
    });
    s.setAttribute("aria-label", "Stop");
    return s;
  }

  function choiceBtn(c, i, card) {
    const st = stopOf(c.stop);
    const lab = dayLabel(st || {});
    const b = btn("");
    b.dataset.choice = card.key + "|" + i;
    const sp = el("span", "", c.pages ? "First " + plural(c.pages, "page", "pages") : lab.when || "No time");
    sp.append(el("small", "", (c.pages ? lab.d + " " : "") + lab.title + (c.who ? " · for " + c.who : "")));
    b.append(el("b", "", c.pages ? "" : lab.d), sp, el("i", "", "›"));
    if (c.pages) b.classList.add("is-fit");
    return b;
  }

  function cardNode(card, n, of) {
    const c = el("div", "ba-card");
    c.dataset.card = card.key;
    const q = el("div", "ba-q");
    q.append(el("span", "", card.kind === "limit" ? "満員 Too many" : "どちら？ Which one?"), el("i", "", card.onList ? card.rowIds.join(" ") || "on the list" : "not on the list"));
    const big = el("div", "ba-big");
    const pv = el("div", "ba-pv");
    if (card.file.pic) {
      const img = el("img");
      img.alt = "";
      img.src = card.file.url || (card.file.url = url(card.file.pic.blob));
      pv.append(img);
    }
    pv.append(el("div", "ba-cap", card.file.name));
    const words = el("div");
    words.append(el("div", "ba-fn", card.onList ? card.label : card.file.kind === "application/pdf" ? "A PDF · " + plural(card.file.pages || 1, "page", "pages") : "A picture"), el("div", "ba-ask", card.ask), el("div", "ba-hint", card.hint));
    big.append(pv, words);
    const opts = el("div", "ba-opts");
    card.choices.forEach((ch, i) => opts.append(choiceBtn(ch, i, card)));
    const showOther = other === card.key || !card.choices.length;
    if (!showOther) {
      const soft = btn("is-soft");
      soft.dataset.other = card.key;
      soft.append(el("span", "", "Another stop, or leave it out"), el("i", "", "›"));
      opts.append(soft);
    } else {
      const box = el("div", "ba-other");
      const pick = stopPicker("");
      pick.dataset.pickFor = card.key;
      const put = btn("ba-put", "Put it on this stop");
      put.dataset.put = card.key;
      const out = btn("ba-out", "Leave it out");
      out.dataset.out = card.key;
      box.append(pick, put, out);
      opts.append(box);
    }
    c.append(q, big, opts);
    c.setAttribute("role", "group");
    c.setAttribute("aria-label", "To look at, " + n + " of " + of);
    return c;
  }

  function aside(sealText, strong, rest, cls = "") {
    const a = el("div", "ba-aside" + (cls ? " " + cls : ""));
    a.append(el("span", "ba-ring", sealText));
    const t = el("span");
    if (strong) t.append(el("b", "", strong), " ");
    t.append(rest);
    a.append(t);
    return a;
  }

  function untiedList(items) {
    const box = el("div", "ba-list");
    const days = store.state.days || [];
    let lastDay = null;
    for (const it of items) {
      const st = stopOf(it.stop) || {};
      if (st.date !== lastDay) {
        lastDay = st.date;
        const i = days.findIndex((d) => d.date === st.date);
        box.append(el("div", "ba-lh", "D" + (i + 1) + " " + dayLabel({ date: st.date }).when));
      }
      const line = el("div", "ba-line" + (openLine === it.key ? " is-open" : ""));
      const b = btn("ba-lb");
      b.dataset.line = it.key;
      b.setAttribute("aria-expanded", String(openLine === it.key));
      const lab = dayLabel(st);
      b.append(el("b", "", (st.time || "—")), el("span", "", lab.title), el("small", "", (it.rowIds.length ? it.rowIds.join(" ") + " · " : "") + it.file.name + (it.pages > 1 ? " · " + it.pages + " pages" : "")));
      if (it.who) b.append(seal(it.who));
      line.append(b);
      if (openLine === it.key) {
        const ed = el("div", "ba-ed");
        const pick = stopPicker(it.stop);
        pick.dataset.move = it.key;
        const fr = el("div", "ba-for");
        fr.append("For ");
        const ppl = people();
        for (const [v, label] of [["", ppl.length === 3 ? "All three" : "Everyone"], ...ppl.map((p) => [p, initial(p)])]) {
          const w = btn(it.who === v ? "is-on" : "", label);
          w.dataset.who = it.key + "|" + v;
          w.setAttribute("aria-pressed", String(it.who === v));
          if (v) w.setAttribute("aria-label", "For " + v);
          fr.append(w);
        }
        const out = btn("ba-out", "Leave it out");
        out.dataset.out = it.key;
        ed.append(pick, fr, out);
        line.append(ed);
      }
      box.append(line);
    }
    return box;
  }

  function drawSorted(r) {
    const nodes = [];
    if (phase === "reading") nodes.push(progress("Reading " + reading.done + " of " + reading.total + "…", "Made into pictures on this phone. " + NOTHING_SENT, reading.done, reading.total));
    const sure = r.items;
    if (sure.length) {
      const days = sure.map((i) => (store.state.days || []).findIndex((d) => d.date === (stopOf(i.stop) || {}).date) + 1).filter((n) => n > 0);
      const lo = days.length ? Math.min(...days) : 0;
      const hi = days.length ? Math.max(...days) : 0;
      const stops = new Set(sure.map((i) => i.stop)).size;
      const each = sure.filter((i) => i.who).length;
      nodes.push(bundle(sure, {
        band: sure.length + " sorted",
        small: (lo === hi ? "D" + lo : "D" + lo + " to D" + hi) + " · " + plural(stops, "stop", "stops") + (each ? " · " + each + " one each" : ""),
        action: "untie",
        actionLabel: untied ? "Tie ‹" : "Untie ›",
        expanded: untied,
      }));
      if (untied) nodes.push(untiedList(sure));
    }
    const total = checked.size + r.cards.length;
    if (r.cards.length) {
      const h = el("div", "ba-h");
      h.append(el("span", "", "検札 To look at · " + (checked.size + 1) + " of " + total));
      const dots = el("span", "ba-dots");
      dots.setAttribute("aria-hidden", "true");
      for (let i = 0; i < Math.min(total, 8); i++) dots.append(el("span", i < checked.size ? "is-done" : i === checked.size ? "is-on" : ""));
      h.append(dots);
      nodes.push(h, cardNode(r.cards[0], checked.size + 1, total));
      const next = el("div", "ba-next");
      for (const c of r.cards.slice(1, 3)) {
        const d = el("div");
        d.append(el("span", "", c.label), el("i", "", c.short));
        next.append(d);
      }
      if (next.childNodes.length) nodes.push(next);
    } else if (checked.size) {
      nodes.push(el("div", "ba-h", "検札 All " + checked.size + " looked at"));
    }
    const there = r.out.filter((o) => o.kind === "there");
    if (there.length) {
      const names = there.map((o) => o.label + " is on " + ((stopOf(o.stop) || {}).title || "its stop")).join("; ");
      nodes.push(aside("既", there.length + " already there:", names + ". Left out."));
    }
    const notT = r.out.filter((o) => o.kind === "notTicket");
    if (notT.length) {
      const bad = notT.filter((o) => o.file.unreadable);
      const odd = notT.filter((o) => !o.file.unreadable);
      if (odd.length) nodes.push(aside("外", plural(odd.length, "file isn’t a ticket file:", "files aren’t ticket files:"), odd.map((o) => o.file.name).join(", ") + ". Left out."));
      if (bad.length) nodes.push(aside("外", plural(bad.length, "file couldn’t be read", "files couldn’t be read") + " on this phone:", bad.map((o) => o.file.name).join(", ") + ". Try a screenshot instead."));
    }
    const inactive = r.out.filter((o) => o.kind === "inactive");
    if (inactive.length) nodes.push(aside("止", plural(inactive.length, "not active", "not active") + " on the list:", inactive.map((o) => o.label + " (" + o.why.replace(/^on the list as /, "") + ")").join(", ") + ". Left out."));
    const mineOut = r.out.filter((o) => o.kind === "leftOut");
    if (mineOut.length) nodes.push(aside("除", plural(mineOut.length, "left out", "left out") + ":", mineOut.map((o) => o.label).join(", ") + "."));
    if (list && list.error) nodes.push(aside("表", "", list.error, "is-warn"));
    else if (list && list.warn && list.warn.length) nodes.push(aside("表", "", list.warn.join(" "), "is-warn"));
    if (list && !list.error && r.quiet) nodes.push(aside("表", "", plural(r.quiet, "line", "lines") + " on the list " + (r.quiet === 1 ? "has" : "have") + " no file here."));
    else if (!list) {
      const a = aside("表", "", "No list: every file not matched is looked at by hand. ");
      const b = btn("ba-link", "Choose list");
      b.id = "bulkChooseList";
      a.lastChild.append(b);
      nodes.push(a);
    }
    nodes.push(aside(String(LIMITS.perTrip), "", "", "is-count"));
    const cnt = nodes[nodes.length - 1].lastChild;
    cnt.append("Pictures on the trip: ", el("b", "", r.now + " now, " + r.after + " after this"), ".");
    const n = sure.length;
    const key = btn("ba-punch");
    key.id = "bulkPunch";
    key.disabled = n === 0 || phase === "reading";
    const sp = el("span");
    const small = (r.cards.length ? (r.cards.length === 1 ? "the 1 not looked at stays out" : "the " + r.cards.length + " not looked at stay out") + " · " : "") + "on every phone";
    sp.append(el("b", "", "入鋏"), n ? "Add " + n + " now" : "Nothing to add yet", el("small", "", small));
    key.append(el("span", "ba-hole"), sp, el("i", "", "›"));
    nodes.push(key);
    return nodes;
  }

  function drawAdded() {
    const a = adding;
    const nodes = [];
    if (phase === "adding") {
      // Fix round 1 (I2): until every picture is kept on this phone, MAT must stay open; after that nothing confirmed is lost.
      if (a.step === "making") nodes.push(progress("Making pictures: " + a.made + " of " + a.total, "Keep MAT open until each one is kept on this phone. Nothing is sent yet.", a.made, a.total));
      else if (a.step === "sending") nodes.push(progress("While adding: " + a.settled + " of " + plural(a.pics, "picture", "pictures"), "Each one is kept on this phone; one that can’t go up now goes up when MAT next has signal.", a.settled, a.pics));
      else nodes.push(progress("Filling in the stops’ details…", "From the list, only where a stop’s field is empty.", 1, 1));
    }
    if (phase === "added") {
      const ok = a.items.filter((i) => i.saved + i.waiting > 0);
      const stops = new Set(ok.map((i) => i.stop)).size;
      const pics = ok.reduce((s, i) => s + i.saved + i.waiting, 0);
      const waiting = ok.reduce((s, i) => s + i.waiting, 0);
      nodes.push(el("p", "ba-done-h", ok.length ? plural(ok.length, "ticket", "tickets") + " added to " + plural(stops, "stop", "stops") + "." : "No ticket was added."));
      if (ok.length) {
        const s = el("p", "ba-done-s");
        s.append(el("b", "", plural(pics, "picture", "pictures")), ", kept in the trip. Every phone shows them on its stubs the next time it opens MAT with signal.");
        if (waiting) s.append(" " + (waiting === pics ? "They wait" : waiting + " wait") + " on this phone" + (a.busy && a.busy === waiting ? " and go up in a moment." : " and go up when there is signal."));
        nodes.push(s);
        const sure = ok.filter((i) => i.from === "sure").length;
        nodes.push(bundle(ok, { punched: true, band: ok.length + " punched in", small: sure + " sorted + " + (ok.length - sure) + " you checked", action: "seeall", actionLabel: seeAll ? "Hide ‹" : "See all ›", expanded: seeAll }));
        if (seeAll) {
          const box = el("div", "ba-list");
          for (const it of ok) {
            const st = stopOf(it.stop) || {};
            const lab = dayLabel(st);
            const row = el("div", "ba-line");
            const d = el("div", "ba-lb");
            d.append(el("b", "", lab.d), el("span", "", lab.title), el("small", "", (it.rowIds.length ? it.rowIds.join(" ") + " · " : "") + plural(it.saved + it.waiting, "picture", "pictures") + (it.waiting ? ", waiting" : "")));
            if (it.who) d.append(seal(it.who));
            row.append(d);
            box.append(row);
          }
          nodes.push(box);
        }
      }
      // Fix round 1 (I2): which ones wait on this phone for signal, by name.
      const waitingNow = ok.filter((i) => i.waiting > 0);
      if (waitingNow.length) {
        nodes.push(el("div", "ba-h", "Waiting for signal · " + waitingNow.length));
        const box = el("div", "ba-next is-flat ba-wait");
        for (const it of waitingNow) {
          const d = el("div");
          const st = stopOf(it.stop) || {};
          d.append(el("span", "", [it.rowIds.join(" ") || it.file.name, st.title].filter(Boolean).join(" · ")), el("i", "", (it.waiting === it.saved + it.waiting ? "" : it.waiting + " of " + (it.saved + it.waiting) + " ") + "on this phone, goes up " + (it.busy === it.waiting ? "in a moment" : "when there is signal")));
          box.append(d);
        }
        nodes.push(box);
      }
      const notAdded = a.notAdded;
      if (notAdded.length) {
        nodes.push(el("div", "ba-h", "Not added · " + notAdded.length));
        const box = el("div", "ba-next is-flat");
        for (const x of notAdded) {
          const d = el("div");
          d.append(el("span", "", x.label), el("i", x.grey ? "is-g" : "", x.why));
          box.append(d);
        }
        nodes.push(box);
      }
      if (notAdded.some((x) => x.why.startsWith("details not filled"))) nodes.push(aside("控", "", "Details not filled can be added from the stop’s Edit sheet.", "is-warn"));
      const firstDay = ok.map((i) => (stopOf(i.stop) || {}).date).filter(Boolean).sort()[0];
      if (firstDay) {
        const n = (store.state.days || []).findIndex((d) => d.date === firstDay) + 1;
        const go = btn("ba-plain", "Open Day " + n + " · see the stubs");
        go.id = "bulkOpenDay";
        go.dataset.day = firstDay;
        nodes.push(go);
      }
    }
    return nodes;
  }

  let lastSig = "";
  function draw() {
    drawTop();
    const focusKey = document.activeElement && sheet.contains(document.activeElement) ? focusId(document.activeElement) : null;
    let nodes;
    if (phase === "empty") {
      nodes = [emptyZone()];
      if (list && (list.error || (list.warn && list.warn.length))) nodes.push(aside("表", "", list.error || list.warn.join(" "), "is-warn"));
      const p = el("p", "ba-say");
      p.append("Yours, or anyone’s on the trip. The conductor sorts them; you only look at the odd ones. ", el("b", "", NOTHING_SENT));
      nodes.push(p);
    } else if (phase === "reading" || phase === "sorted") {
      const r = sorted();
      lastSig = sigOf(r);
      noteStops();
      nodes = drawSorted(r);
    }
    else nodes = drawAdded();
    body.replaceChildren(...nodes);
    if (focusKey) refocus(focusKey);
  }
  // A redraw keeps focus on the same control (keyboard on a computer).
  const ATTRS = ["choice", "other", "put", "out", "line", "who", "act", "pickFor", "move"];
  function focusId(n) {
    if (n.id) return "#" + n.id;
    for (const a of ATTRS) if (n.dataset && n.dataset[a] !== undefined) return "[data-" + a.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) + '="' + CSS.escape(n.dataset[a]) + '"]';
    return null;
  }
  function refocus(sel) {
    const n = body.querySelector(sel) || sheet.querySelector(sel);
    if (n && !n.disabled) n.focus({ preventScroll: true });
    else if (body.querySelector(".ba-card button")) body.querySelector(".ba-card button").focus({ preventScroll: true });
    else topB.focus({ preventScroll: true });
  }

  const sigOf = (r) => JSON.stringify([r.items.map((i) => [i.key, i.stop, i.who, i.pages]), r.cards.map((c) => [c.key, c.kind, c.choices.map((x) => x.stop)]), r.out.map((o) => o.kind + (o.key || "")), r.now, r.after, (store.state.stops || []).map((x) => x.id + x.date + x.time + x.title + !!x.deleted)]);

  // After an answer or a change of the trip: sort again and draw.
  function afterChange() {
    draw();
  }

  // ---- 入鋏: adding ----
  //
  // Fix round 1 (I2): three steps, so that nothing the person confirmed hangs
  // on anything else, and closing MAT part way loses nothing confirmed.
  // 1. Every picture is made (a PDF's pages drawn here) and put in the keep.
  // 2. Then every one is handed to store.addTicket in one go, the single
  //    add's own path: each is in mat.queue (its data in the keep) before the
  //    first leaves, and one with no signal waits on the phone and goes up
  //    later, after a reload too. Their outcomes are waited for together.
  // 3. Then the stops' facts, each worked out as it is sent (I1).
  // A wipe (Forget, a refused key) or Cancel stops waiting at once (aborts).

  const KEEP_WAIT_MS = 10000;
  let aborts = new Set();
  const orAbort = (p) => new Promise((resolve) => {
    aborts.add(resolve);
    Promise.resolve(p).then((v) => {
      aborts.delete(resolve);
      resolve(v);
    }, () => {
      aborts.delete(resolve);
      resolve(null);
    });
  });
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Every stop as it was when the sort was last drawn (I1): a stop changed
  // since then gets no facts from the list.
  let seenStops = new Map();
  const stopKey = (st) => {
    const b = { ...st };
    delete b.pending;
    delete b.failed;
    return JSON.stringify(Object.keys(b).sort().map((k) => [k, b[k]]));
  };
  const noteStops = () => {
    seenStops = new Map((store.state.stops || []).filter((x) => x && x.id).map((x) => [x.id, stopKey(x)]));
  };

  const FACTS_WHY = { notSent: "no signal", notLanded: "it didn’t land", unsure: "no reply yet, look at the stop later", gone: "the stop was removed", changed: "changed on another phone" };

  async function punch() {
    if (phase !== "sorted") return;
    const r = sorted();
    if (!r.items.length) return;
    // Fix round 1, M7: what is added is what was shown; a trip changed since is drawn again first.
    if (sigOf(r) !== lastSig) {
      draw();
      say.textContent = "The trip changed while you looked. Check it again, then 入鋏.";
      return;
    }
    const mine = gen;
    const at = keep.gen;
    const dead = () => mine !== gen || at !== keep.gen || store.state.status === "nokey";
    const rows = list && !list.error ? list.rows : [];
    phase = "adding";
    adding = {
      step: "making", made: 0, pics: 0, settled: 0, total: r.items.length, busy: 0,
      items: r.items.map((i) => ({ ...i, saved: 0, waiting: 0, busy: 0, failed: 0, message: "", short: 0 })),
      notAdded: [],
    };
    // What the sort left out goes on the Not added list: cards not looked at, then the rest.
    for (const c of r.cards) adding.notAdded.push({ label: c.label, why: "left out: " + c.short });
    for (const o of r.out) {
      if (o.kind === "there") adding.notAdded.push({ label: [o.label.split(" · ")[0], (stopOf(o.stop) || {}).title].filter(Boolean).join(" · "), why: "already there", grey: true });
      else if (o.kind === "notTicket") adding.notAdded.push({ label: o.file.name, why: o.file.unreadable || "not a ticket file", grey: true });
      else adding.notAdded.push({ label: o.label, why: o.why });
    }
    draw();
    say.textContent = "Adding " + plural(r.items.length, "ticket", "tickets") + ".";

    // 1. Every picture made and put in the keep, nothing sent yet.
    const pics = []; // { it, id, pic, k }
    const puts = [];
    const hold = (it, pic, k) => {
      const id = newId();
      puts.push(keep.put(id, pic.blob, { gen: at }));
      pics.push({ it, id, pic, k });
    };
    for (const it of adding.items) {
      if (dead()) break;
      try {
        if (it.file.kind === "application/pdf") {
          let bad = false;
          await pdfPages(it.file.raw, {
            max: it.pages,
            each: async (canvas, k) => {
              if (bad || dead()) return;
              try {
                hold(it, await shrinkCanvas(canvas), k);
              } catch {
                bad = true;
                it.short = it.pages - k;
              }
            },
          });
        } else if (it.file.pic) hold(it, it.file.pic, 0);
      } catch {
        it.failed += 1;
        it.message = "That PDF couldn’t be read here. Try a screenshot of the ticket instead.";
      }
      adding.made += 1;
      if (mine === gen) draw();
    }
    if (dead()) return;
    // A keep that never answers (a known WebKit fault) does not hold the rest up: the data also travels with each add.
    await orAbort(Promise.race([Promise.all(puts), pause(KEEP_WAIT_MS)]));
    if (dead()) return;

    // 2. All handed over at once: each one waits on the phone if it has to.
    adding.step = "sending";
    adding.pics = pics.length;
    const liveOn = (id) => (store.state.tickets || []).filter((t) => t && t.stop === id && !t.gone);
    const outcomes = pics.map(({ it, id, pic, k }) => {
      const sameWho = liveOn(it.stop).filter((t) => (t.who || "") === it.who).length;
      const token = store.addTicket({ id, stop: it.stop, who: it.who, seat: seatFor(it, rows), page: Math.min(LIMITS.perStop, Math.max(k + 1, sameWho + 1)), mime: pic.mime, w: pic.w, h: pic.h, data: pic.data });
      return store.ticketOutcome(token).then((res) => {
        if (mine !== gen) return;
        if (res && res.saved) it.saved += 1;
        else if (res && res.reason === "queued") {
          it.waiting += 1;
          if (res.busy) {
            it.busy += 1;
            adding.busy += 1;
          }
        } else {
          it.failed += 1;
          it.message = (res && res.message) || "That picture wasn’t saved.";
          keep.drop(id);
        }
        adding.settled += 1;
        draw();
      });
    });
    pics.length = 0;
    draw();
    await orAbort(Promise.all(outcomes));
    if (mine !== gen) return;
    for (const it of adding.items) {
      // Fix round 1, M9: which limit cut a PDF.
      if (it.pages < it.file.pages) adding.notAdded.push({ label: (it.rowIds[0] || it.file.name) + " · pages " + (it.pages + 1) + (it.file.pages > it.pages + 1 ? "–" + it.file.pages : ""), why: it.cut === "trip" ? "trip full, " + LIMITS.perTrip + " of " + LIMITS.perTrip : "stop full, " + LIMITS.perStop + " of " + LIMITS.perStop });
      if (it.short) adding.notAdded.push({ label: it.label, why: it.short + " pages couldn’t be made into pictures here" });
      else if (it.failed) adding.notAdded.push({ label: it.label, why: it.message });
    }

    // 3. The stops' facts, each from the stop as this phone has it now.
    adding.step = "facts";
    draw();
    const missed = (id, why) => adding.notAdded.push({ label: (stopOf(id) || {}).title || (r.items.find((i) => i.stop === id) || {}).label || "A stop", why: "details not filled: " + FACTS_WHY[why] });
    const stopIds = [...new Set(adding.items.map((i) => i.stop))];
    for (const id of stopIds) {
      if (dead()) break;
      const now = stopOf(id);
      const mineHere = adding.items.filter((i) => i.stop === id);
      const want = factsFor(mineHere, rows, now ? [now] : [{ id }])[id];
      if (!want) continue;
      if (!now) {
        missed(id, "gone");
        continue;
      }
      if (seenStops.get(id) !== stopKey(now)) {
        missed(id, "changed");
        continue;
      }
      let unsure = null;
      const noReply = new Promise((resolve) => {
        unsure = resolve;
      });
      const token = store.updateStop(id, want, { quiet: true, onUnsure: () => unsure({ saved: false, reason: "unsure" }) });
      if (!token) {
        missed(id, "gone");
        continue;
      }
      const out = await orAbort(Promise.race([store.outcome(token), noReply]));
      if (mine !== gen) return;
      if (!out || !out.saved) {
        if (out && out.reason === "refused") adding.notAdded.push({ label: now.title || "A stop", why: "details not filled: " + (out.message || "refused") });
        else missed(id, out ? out.reason : "unsure");
      }
    }
    if (mine !== gen) return;
    phase = "added";
    draw();
    const ok = adding.items.filter((i) => i.saved + i.waiting > 0).length;
    say.textContent = plural(ok, "ticket", "tickets") + " added.";
  }

  // ---- taps ----

  function answerCard(key, a) {
    answers.set(key, a);
    checked.add(key);
    other = null;
    afterChange();
  }

  body.addEventListener("click", (ev) => {
    const t = ev.target.closest("button");
    if (!t || t.disabled) return;
    if (t.id === "bulkChoose") return fileIn.click();
    if (t.id === "bulkChooseList") return listIn.click();
    if (t.id === "bulkPunch") return punch();
    if (t.id === "bulkOpenDay") {
      const day = t.dataset.day;
      close(false);
      onOpenDay(day);
      return;
    }
    const d = t.dataset;
    if (d.act === "untie") {
      untied = !untied;
      openLine = null;
      return draw();
    }
    if (d.act === "seeall") {
      seeAll = !seeAll;
      return draw();
    }
    const r = phase === "sorted" ? sorted() : null;
    if (!r) return;
    if (d.choice) {
      const [key, i] = d.choice.split("|");
      const card = r.cards.find((c) => c.key === key);
      const ch = card && card.choices[Number(i)];
      if (ch) answerCard(key, { stop: ch.stop, who: ch.who, rowIds: ch.rowIds, pages: ch.pages || null });
      return;
    }
    if (d.other) {
      other = d.other;
      draw();
      const p = body.querySelector('[data-pick-for="' + CSS.escape(d.other) + '"]');
      if (p) p.focus();
      return;
    }
    if (d.put) {
      const card = r.cards.find((c) => c.key === d.put);
      const p = body.querySelector('[data-pick-for="' + CSS.escape(d.put) + '"]');
      if (!card || !p || !p.value) {
        say.textContent = "Pick a stop first.";
        if (p) p.focus();
        return;
      }
      answerCard(card.key, { stop: p.value, who: card.who || "", rowIds: card.rowIds || [] });
      return;
    }
    if (d.out) {
      const card = r.cards.find((c) => c.key === d.out);
      if (card) answerCard(card.key, { out: true, why: card.short });
      else {
        answers.set(d.out, { out: true });
        openLine = null;
        afterChange();
      }
      return;
    }
    if (d.line) {
      openLine = openLine === d.line ? null : d.line;
      return draw();
    }
    if (d.who) {
      const [key, who] = d.who.split("|");
      const it = r.items.find((i) => i.key === key);
      if (it) {
        answers.set(key, { stop: it.stop, who, rowIds: it.rowIds, pages: it.pages });
        afterChange();
      }
    }
  });
  body.addEventListener("change", (ev) => {
    const s = ev.target.closest && ev.target.closest("select[data-move]");
    if (!s || !s.value || phase !== "sorted") return;
    const it = sorted().items.find((i) => i.key === s.dataset.move);
    if (!it) return;
    answers.set(it.key, { stop: s.value, who: it.who, rowIds: it.rowIds });
    openLine = it.key;
    afterChange();
  });

  fileIn.addEventListener("change", () => {
    const f = [...(fileIn.files || [])];
    fileIn.value = "";
    if (f.length) take(f);
  });
  listIn.addEventListener("change", () => {
    const f = listIn.files && listIn.files[0];
    listIn.value = "";
    if (f) readList(f);
  });
  // A computer: files dropped anywhere on the sheet, before 入鋏.
  sheet.addEventListener("dragover", (ev) => {
    if (phase === "adding" || phase === "added") return;
    ev.preventDefault();
    sheet.classList.add("is-drop");
  });
  sheet.addEventListener("dragleave", (ev) => {
    if (ev.target === sheet) sheet.classList.remove("is-drop");
  });
  sheet.addEventListener("drop", (ev) => {
    sheet.classList.remove("is-drop");
    if (phase === "adding" || phase === "added") return;
    ev.preventDefault();
    const f = [...((ev.dataTransfer && ev.dataTransfer.files) || [])];
    if (f.length) take(f);
  });

  // Starts afresh: everything sorted is dropped (nothing was sent).
  function reset() {
    gen += 1;
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    files = [];
    list = null;
    answers = new Map();
    checked = new Set();
    untied = false;
    openLine = null;
    other = null;
    reading = { done: 0, total: 0 };
    hashes = new Map();
    adding = null;
    seenStops = new Map();
    // Work waiting on the store (outcomes, facts) stops waiting.
    for (const done of [...aborts]) done(null);
    aborts = new Set();
    seeAll = false;
    phase = "empty";
    say.textContent = "";
  }

  topB.addEventListener("click", () => {
    // Cancel throws away what was sorted; Done after adding starts afresh. Adding goes on behind a close.
    if (phase === "added" || phase === "empty" || phase === "sorted" || phase === "reading") reset();
    close();
  });
  scrim.addEventListener("click", () => close());
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && opened) close();
  });

  // The trip taken off this phone (Forget this phone, a refused key; fix
  // round 1, I3): as every other view, nothing of it stays: the list, the
  // files, their pictures' addresses, the answers and what was drawn, open
  // or not. Work begun before it is dropped.
  let wiped = false;
  function wipe() {
    reset();
    body.replaceChildren();
    say.textContent = "";
    topI.textContent = "一括";
    topB.textContent = "Cancel";
    fileIn.value = "";
    listIn.value = "";
    queue = Promise.resolve();
    close(false);
  }

  // Another phone's change (a stop moved, a picture added): sorted again, and
  // drawn when it shows differently (never under an open stop picker).
  store.subscribe(() => {
    if (store.state.status === "nokey") {
      if (!wiped) {
        wiped = true;
        wipe();
      }
      return;
    }
    wiped = false;
    if (!opened || phase !== "sorted") return;
    if (sigOf(sorted()) === lastSig) return;
    const a = document.activeElement;
    if (a && a.tagName === "SELECT" && sheet.contains(a)) return;
    draw();
  });

  function open() {
    if (opened) return;
    opened = true;
    draw();
    sheet.classList.add("is-open");
    sheet.inert = false;
    scrim.hidden = false;
    root.classList.add("bulk-open");
    sheet.scrollTop = 0;
    topB.focus({ preventScroll: true });
  }

  function close(restoreFocus = true) {
    if (!opened) return;
    opened = false;
    sheet.classList.remove("is-open", "is-drop");
    sheet.inert = true;
    scrim.hidden = true;
    root.classList.remove("bulk-open");
    if (sheet.contains(document.activeElement)) document.activeElement.blur();
    onClose(restoreFocus === true);
  }

  // Reading files or adding (fix round 1, I4): a new release waits, open or not.
  const isBusy = () => phase === "reading" || phase === "adding";

  return { open, close: (restoreFocus) => close(restoreFocus), isOpen: () => opened, isBusy };
}
