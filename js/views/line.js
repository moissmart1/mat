/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The line sheet: what opens when an expense on the receipt is tapped. Your
// share, who rang it up, a note, that line's history, edit and delete.
//
// mountLine(root, store, { onEdit(id) }) -> { open(id), close(), isOpen() }
// root is the phone. The sheet draws from store.state and redraws on every
// store change; it closes itself when its line is no longer on the receipt.
// Text from people or the Sheet goes in with textContent only.

import { expenseShares, cadCents, jpyOf } from "../money.js";
import { dollars, yen, typed, dayHead, pt, localDay, historySentence } from "../format.js";
import { fillSeal } from "../picture.js";

const NO_HISTORY = "History needs a connection.";
const UNSAVED = "Not saved yet.";
const HISTORY_FAILED = "Couldn’t load the history.";

const MARKUP = `
<div class="sheet-top"><span>This line</span><button type="button" id="lnDone">Done</button></div>
<div class="ln" id="lineBody"></div>
<div class="ln-btns"><button type="button" id="lnRetry" hidden>Try again</button><button type="button" id="lnEdit">Edit</button><button type="button" id="lnDel" class="danger">Delete</button></div>`;

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

// "Fri Dec 11" for a moment, in the phone's own time zone.
function dateOf(iso) {
  const t = Date.parse(iso);
  if (!isFinite(t)) return "";
  return dayHead(localDay(t), []).en;
}

// The part of a line that decides what the sheet shows, so history is fetched
// again only when the line itself changed.
const signature = (e) => JSON.stringify(e);

export function mountLine(root, store, { onEdit = () => {} } = {}) {
  const scrim = el("div", "scrim");
  scrim.id = "lineScrim";
  scrim.hidden = true;
  const sheet = el("div", "sheet");
  sheet.id = "line";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Receipt line");
  sheet.inert = true;
  sheet.innerHTML = MARKUP;
  root.append(scrim, sheet);

  const body = sheet.querySelector("#lineBody");
  const editBtn = sheet.querySelector("#lnEdit");
  const delBtn = sheet.querySelector("#lnDel");
  const retryBtn = sheet.querySelector("#lnRetry");

  // The sections that change while the sheet is open are built once and
  // filled in on each draw, so a note being typed is never wiped.
  const title = el("div", "ln-t");
  const amount = el("div", "ln-a");
  const paid = el("div", "ln-paid");
  const dl = el("dl", "ln-d");
  const share = el("div", "ln-share");
  share.id = "lnShare";
  const by = el("div", "ln-by");
  by.id = "lnBy";
  const noteBox = el("div", "ln-note");
  const note = el("input");
  note.id = "lnNote";
  note.type = "text";
  note.maxLength = 200;
  note.placeholder = "add a note";
  note.autocomplete = "off";
  note.enterKeyHint = "done";
  note.setAttribute("aria-label", "Note");
  const noteSave = el("button", "", "Save");
  noteSave.type = "button";
  noteSave.id = "lnNoteSave";
  noteBox.append(note, noteSave);
  const logHead = el("div", "ln-h", "Every change to this line");
  const log = el("div", "ln-log");
  log.id = "lnLog";
  body.append(title, amount, paid, dl, share, by, noteBox, logHead, log);

  let lineId = null;
  let sentNote = null; // the text last sent with Save, kept in the field if the save fails
  let shownNote = ""; // the note as last drawn; the field follows it until it is typed in
  let shownSig = "";
  let fetchNo = 0;

  const current = () => store.state.expenses.find((x) => x.id === lineId && !x.deleted) || null;

  function drawLine(e) {
    const s = store.state;
    const person = (n) => s.people.find((p) => p.name === n);
    const seal = (n) => fillSeal(el("span", "mini"), person(n), n, { named: true });

    title.textContent = e.title;
    amount.replaceChildren(fig("span", "", typed(e)));
    const other = e.currency === "CAD" ? yen(jpyOf(e)) : dollars(cadCents(e));
    amount.append(el("i", "", "about " + other));

    paid.replaceChildren(seal(e.paidBy), el("b", "", e.paidBy + " paid"));

    const row = (label, ...content) => {
      const r = el("div");
      const dd = el("dd");
      dd.append(...content);
      r.append(el("dt", "", label), dd);
      return r;
    };
    const names = s.people.map((p) => p.name);
    const everyone = names.every((n) => e.split.includes(n));
    const uneven = !!e.splitMode && e.splitMode !== "equal";
    dl.replaceChildren(
      row("Day", e.day === "pre" ? "Before the trip" : dayHead(e.day, s.days).en),
      row("Shared by", ...e.split.map(seal), ...(everyone ? [el("span", "", "all three")] : []), ...(uneven ? [el("span", "", "uneven")] : [])),
    );

    if (s.me) {
      const mine = e.split.includes(s.me) ? expenseShares(e)[s.me] : 0;
      share.hidden = false;
      if (e.split.includes(s.me)) {
        share.replaceChildren(el("span", "", "Your share"), " ", fig("b", "", dollars(mine)));
        share.classList.remove("is-none");
      } else {
        share.textContent = "You’re not in this one.";
        share.classList.add("is-none");
      }
    } else {
      share.hidden = true;
    }

    const when = dateOf(e.addedAt);
    by.textContent = "Rung up" + (e.addedBy ? " by " + e.addedBy : "") + (when ? ", " + when : "");

    // An unsaved line cannot be edited or noted: it can be sent again or dropped.
    const unsaved = store.unsaved(e.id);
    noteBox.hidden = unsaved;
    editBtn.hidden = unsaved;
    retryBtn.hidden = !e.failed;
    if (sentNote !== null && !e.pending && e.note === sentNote) sentNote = null; // saved: the field follows the line again
    const holdsSent = sentNote !== null && note.value === sentNote;
    if (!unsaved && note.value === shownNote && !holdsSent) note.value = e.note || "";
    shownNote = e.note || "";
    noteSave.disabled = note.value.trim() === shownNote;
  }

  // The history, fetched afresh. "…" until it arrives.
  async function drawHistory(e) {
    const mine = ++fetchNo;
    if (store.unsaved(e.id)) {
      log.replaceChildren(el("div", "ln-ev", UNSAVED));
      return;
    }
    if (!log.children.length) log.replaceChildren(el("div", "ln-ev", "…"));
    let entries;
    try {
      entries = await store.historyFor(lineId);
    } catch (err) {
      if (mine === fetchNo) log.replaceChildren(el("div", "ln-ev", err && err.code === "network" ? NO_HISTORY : HISTORY_FAILED));
      return;
    }
    if (mine !== fetchNo || !sheet.classList.contains("is-open")) return;
    if (!entries.length) {
      log.replaceChildren();
      return;
    }
    log.replaceChildren(
      ...entries.map((en) => {
        const row = el("div", "ln-ev" + (en.undoneBy ? " is-undone" : ""));
        const when = dateOf(en.at);
        row.append(el("time", "", when), el("span", "", historySentence(en)));
        return row;
      }),
    );
  }

  function render() {
    if (!sheet.classList.contains("is-open")) return;
    const e = current();
    if (!e) {
      close();
      return;
    }
    drawLine(e);
    const sig = signature(e);
    if (sig !== shownSig) {
      shownSig = sig;
      drawHistory(e);
    }
  }

  function open(id) {
    lineId = id;
    const e = current();
    if (!e) {
      lineId = null;
      return false;
    }
    note.value = "";
    shownNote = "";
    sentNote = null;
    shownSig = "";
    log.replaceChildren();
    sheet.classList.add("is-open");
    sheet.inert = false;
    scrim.hidden = false;
    root.classList.add("line-open");
    sheet.scrollTop = 0;
    render();
    sheet.querySelector("#lnDone").focus({ preventScroll: true }); // not the note field: no keyboard pops up
    return true;
  }

  // restoreFocus: give focus back to the row that opened the sheet, when it is still there.
  function close(restoreFocus = true) {
    if (!sheet.classList.contains("is-open")) return;
    fetchNo++;
    const id = lineId;
    lineId = null;
    sheet.classList.remove("is-open");
    sheet.inert = true;
    scrim.hidden = true;
    root.classList.remove("line-open");
    if (sheet.contains(document.activeElement)) document.activeElement.blur();
    if (restoreFocus === true) {
      const row = root.querySelector('#rc .rc-row[data-id="' + id + '"]');
      if (row) row.focus({ preventScroll: true });
    }
  }

  // ---- taps ----

  sheet.querySelector("#lnDone").addEventListener("click", () => close());
  scrim.addEventListener("click", () => close());
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") close();
  });

  const saveNote = () => {
    const e = current();
    if (!e || store.unsaved(e.id)) return;
    const text = note.value.trim();
    if (text === (e.note || "")) return;
    sentNote = text;
    store.updateExpense(lineId, { note: text });
  };
  noteSave.addEventListener("click", saveNote);
  note.addEventListener("input", () => {
    noteSave.disabled = note.value.trim() === shownNote;
  });
  note.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      saveNote();
      note.blur();
    }
  });

  editBtn.addEventListener("click", () => {
    const id = lineId;
    if (!id) return;
    close(false);
    onEdit(id);
  });
  retryBtn.addEventListener("click", () => {
    const id = lineId;
    close(false);
    if (id) store.retry(id);
  });
  delBtn.addEventListener("click", () => {
    const e = current();
    if (!e) return;
    const id = lineId;
    close(false);
    if (store.unsaved(id)) store.discard(id);
    else store.deleteExpense(id);
  });

  // The trip was taken off this phone: the sheet closes and nothing of the line stays drawn.
  function wipe() {
    close(false);
    for (const n of [title, amount, paid, dl, share, by, log]) n.replaceChildren();
    note.value = "";
    shownNote = "";
    sentNote = null;
    shownSig = "";
  }

  store.subscribe(() => {
    if (store.state.status === "nokey") wipe();
    else render();
  });

  return { open, close: (restoreFocus) => close(restoreFocus), isOpen: () => sheet.classList.contains("is-open") };
}
