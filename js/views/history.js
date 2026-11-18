/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The History tape: a sheet listing every change anyone made, newest first,
// with Undo on the newest change to each item.
//
// mountHistory(root, store) -> { open(), close(restoreFocus), isOpen() }
// root is the phone. The tape draws from store.state.history and redraws on
// every store change. It is fetched once quietly after the app starts and again
// each time the sheet opens; what is already held shows while that fetch is out.
// Undo is store.undoEntry(id): the store handles a refused (stale) undo by
// showing the notice and loading the first page again. Text from people or
// the Sheet goes in with textContent only.

import { clock, dayHead, localDay, viaText } from "../format.js";

const LOADING = "…";
const NO_HISTORY = "History needs a connection.";
const HISTORY_FAILED = "Couldn’t load the history.";
const LAST_LOADED = "Showing the last loaded history.";
const NOTHING_YET = "Nothing has changed yet.";
const INTRO = "Every change, newest first. Undo is on the latest change to each item.";

const MARKUP = `
<div class="hist-top"><span><i>履歴</i> History</span><button type="button" id="histDone">Done</button></div>
<p class="hist-p">${INTRO}</p>
<div class="tape" id="tape" tabindex="-1"></div>`;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function mountHistory(root, store) {
  const scrim = el("div", "scrim");
  scrim.id = "histScrim";
  scrim.hidden = true;
  const sheet = el("div", "hist");
  sheet.id = "hist";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "History");
  sheet.inert = true;
  sheet.innerHTML = MARKUP;
  root.append(scrim, sheet);

  const tape = sheet.querySelector("#tape");
  const done = sheet.querySelector("#histDone");

  let opened = false;
  let phase = "loading"; // "loading" until this opening's fetch has answered, then "done" or "failed"
  let openNo = 0;
  const busy = new Set(); // entries whose Undo is on its way: no second tap

  function drawRow(en) {
    const row = el("div", "tp-row" + (en.undoneBy ? " is-undone" : ""));
    row.dataset.id = en.id;
    const ms = Date.parse(en.at);
    const when = el("time", "", isFinite(ms) ? clock(ms) : "");
    const said = el("span", "tp-s");
    said.append(el("b", "", en.who), " " + en.summary);
    if (viaText(en.via)) said.append(el("i", "", viaText(en.via)));
    row.append(when, said);
    // A picture is only ever changed by its owner, Undo included (Task 16).
    // A stamp likewise: its line names whose it is after the last bar (def|who).
    const notMine = (en.kind === "picture" && en.ref !== store.state.me) || (en.kind === "stamp" && en.ref.slice(en.ref.lastIndexOf("|") + 1) !== store.state.me);
    if (en.canUndo && !en.undoneBy && !notMine) {
      const undo = el("button", "tp-undo", "Undo");
      undo.type = "button";
      undo.setAttribute("aria-label", "Undo: " + said.textContent);
      undo.disabled = busy.has(en.id);
      row.append(undo);
    }
    return row;
  }

  function draw(s) {
    const h = s.history;
    // Nothing held yet: wait for the fetch. What is already held shows at once
    // and is replaced when the fetch lands.
    if (phase === "loading" && !h.entries.length) {
      tape.replaceChildren(el("p", "tp-msg", LOADING));
      return;
    }
    const error = h.error ? (h.error === "network" ? NO_HISTORY : HISTORY_FAILED) : "";
    if (!h.entries.length) {
      tape.replaceChildren(el("p", "tp-msg", error || NOTHING_YET));
      return;
    }
    const nodes = [];
    if (error && phase === "failed") {
      const notice = el("p", "tp-msg", LAST_LOADED + " " + error);
      notice.setAttribute("role", "status");
      nodes.push(notice);
    }
    let last = null;
    for (const en of h.entries) {
      const day = localDay(Date.parse(en.at));
      if (day !== last) {
        last = day;
        if (day) {
          const head = dayHead(day, []);
          const d = el("div", "tp-day");
          d.append(el("span", "", head.en), el("i", "", head.jp));
          nodes.push(d);
        }
      }
      nodes.push(drawRow(en));
    }
    if (h.more) {
      const more = el("button", "tp-more", "Show older");
      more.type = "button";
      more.id = "histMore";
      more.disabled = h.loading;
      more.setAttribute("aria-busy", h.loading ? "true" : "false");
      nodes.push(more);
    }
    if (error && phase !== "failed") nodes.push(el("p", "tp-msg", error));
    tape.replaceChildren(...nodes);
  }

  function render(s) {
    // The trip was taken off this phone: the sheet closes and the tape goes.
    if (s.status === "nokey") {
      close(false);
      tape.replaceChildren();
      return;
    }
    if (!opened) return;
    // A redraw replaces the buttons: keep the thumb's place when one had focus.
    const hadFocus = tape.contains(document.activeElement) && document.activeElement !== tape;
    draw(s);
    if (hadFocus && !tape.contains(document.activeElement)) tape.focus({ preventScroll: true });
  }

  async function open() {
    if (opened) return;
    opened = true;
    const mine = ++openNo;
    phase = "loading";
    busy.clear();
    render(store.state);
    sheet.classList.add("is-open");
    sheet.inert = false;
    scrim.hidden = false;
    root.classList.add("hist-open");
    tape.scrollTop = 0;
    store.markSeen();
    done.focus({ preventScroll: true });
    await store.loadHistory();
    if (mine !== openNo || !opened) return;
    phase = store.state.history.error ? "failed" : "done";
    render(store.state);
  }

  // restoreFocus: give focus back to the History button.
  function close(restoreFocus = true) {
    if (!opened) return;
    opened = false;
    openNo++;
    sheet.classList.remove("is-open");
    sheet.inert = true;
    scrim.hidden = true;
    root.classList.remove("hist-open");
    if (sheet.contains(document.activeElement)) document.activeElement.blur();
    if (restoreFocus === true) {
      const btn = document.getElementById("histBtn");
      if (btn && !btn.hidden) btn.focus({ preventScroll: true });
    }
  }

  // ---- taps ----

  done.addEventListener("click", () => close());
  scrim.addEventListener("click", () => close());
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") close();
  });

  tape.addEventListener("click", async (ev) => {
    if (ev.target.closest("#histMore")) {
      store.loadHistory({ older: true });
      return;
    }
    const btn = ev.target.closest("button.tp-undo");
    if (!btn) return;
    const id = Number(btn.closest(".tp-row").dataset.id);
    if (busy.has(id)) return;
    busy.add(id);
    tape.focus({ preventScroll: true }); // the button is about to go: keep the place
    btn.disabled = true;
    let ok = false;
    try {
      ok = await store.undoEntry(id);
    } catch {
      store.notify("Couldn’t undo that. Try again.");
    } finally {
      busy.delete(id);
    }
    if (ok) tape.scrollTop = 0; // the new "undid" row is on top
    render(store.state);
  });

  store.subscribe(render);

  return { open, close: (restoreFocus) => close(restoreFocus), isOpen: () => opened };
}
