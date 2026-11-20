/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Edit stay (宿泊): a stay's booking, opened from the hotel card's Edit
// (S-edit of the stay-ticket mock-up). The name, address and nights come from
// the planner and are not changed here; this adds the booking: the stop
// sheet's own Ticket part (js/views/ticketpart.js, { on: "stay" }: pictures or
// a PDF, and Booking ref, Name on booking, People, Room) and the note.
//
// mountStaySheet(root, store, keep, { onClose }) -> { open(stayId), close(restoreFocus), isOpen() }
// root is the phone. Built as the stop sheet is (js/views/stopsheet.js): the
// same sheet on the ticket stock, scrim, focus, Escape, inert, the Days pane
// on a computer, and staysheet-open on the phone while it is up so a new
// release waits. The fields are filled once, when it opens.
//
// Save sends only the fields that changed (store.saveStay, merge: true, so
// nothing typed in the Sheet is overwritten) and waits for the answer (R36),
// then sends the picked pictures one by one (each with its progress), then
// closes. Nothing changed and nothing picked: it closes. With no signal Save
// is off and it says so (pictures already picked stay picked). Refused: the
// backend's sentence, and everything typed is kept. The stay removed on
// another phone while it is open: it closes. onClose(how): "done" (Done,
// Escape, the scrim with nothing changed) or "saved"; the app opens the
// hotel card again then. A close the app makes itself (another sheet, the
// trip taken off this phone) says nothing.

import { dayHead } from "../format.js";
import { staySpan, nightOf } from "../plan.js";
import { mountTicketPart } from "./ticketpart.js";

const NO_SIGNAL = "No signal. Stays need a connection.";
const SAVING = "Saving…";
const CHECKING = "No answer from the trip sheet yet. Checking whether it was saved…";
const NO_SIGNAL_UNSAVED = "No signal. That wasn’t saved.";
const NOT_SAVED = "That wasn’t saved. Tap Save to try again.";
const LEFT_UNSAVED = "That stay’s booking wasn’t saved.";

const MARKUP = `
<div class="sheet-top"><span id="syHead">Edit stay<i>宿泊</i></span><button type="button" id="syDone">Done</button></div>
<div class="st">
  <div class="st-day" id="syDay"></div>
  <p class="st-say">The name, address and nights come from the planner. Here you add the booking.</p>
  <div id="syTix"></div>
  <label class="st-f"><span>Note</span><textarea id="syNote" maxlength="300" rows="2"></textarea></label>
  <p class="st-msg" id="syMsg" role="status"></p>
  <div class="st-btns"><button type="button" class="st-save" id="sySave">Save</button></div>
</div>`;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const str = (v) => (typeof v === "string" ? v : "");

export function mountStaySheet(root, store, keep, { onClose = () => {} } = {}) {
  const scrim = el("div", "scrim");
  scrim.id = "staySheetScrim";
  scrim.hidden = true;
  const sheet = el("div", "sheet stop");
  sheet.id = "staySheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Edit stay");
  sheet.inert = true;
  sheet.innerHTML = MARKUP;
  root.append(scrim, sheet);

  const $ = (id) => sheet.querySelector("#" + id);
  const done = $("syDone");
  const dayLine = $("syDay");
  const msg = $("syMsg");
  const save = $("sySave");
  const note = $("syNote");
  const tixBox = $("syTix");
  const part = mountTicketPart(tixBox, store, keep, { on: "stay" });

  let stayId = null;
  let was = null; // the fields as they were filled
  let phase = null; // "saving" while Save waits; "checking" when no answer came
  let refused = "";
  let unsaved = false;
  let session = 0;

  const isOpen = () => sheet.classList.contains("is-open");
  const current = () => (store.state.stays || []).find((s) => s && s.id === stayId && !s.deleted) || null;
  const online = () => store.state.online !== false;

  const read = () => ({ ...part.read(), note: note.value.trim() });
  const fieldsOf = (stay) => ({ ...part.fieldsOf(stay), note: str(stay.note).trim() });
  const diff = (from, to) => {
    const out = {};
    for (const k of Object.keys(to)) if (to[k] !== from[k]) out[k] = to[k];
    return out;
  };
  const changed = () => {
    const now = read();
    return Object.keys(now).some((k) => now[k] !== was[k]) || part.changed();
  };

  function update() {
    if (!isOpen()) return;
    const busy = phase !== null;
    note.disabled = busy;
    part.setBusy(busy);
    sheet.classList.toggle("is-saving", phase === "saving");
    done.disabled = phase === "saving";
    save.textContent = phase === "saving" ? SAVING : "Save";
    if (busy) {
      save.disabled = true;
      msg.textContent = phase === "checking" ? CHECKING : "";
      return;
    }
    if (part.reading()) {
      save.disabled = true;
      return;
    }
    const off = !online();
    save.disabled = off;
    msg.textContent = off ? (unsaved ? NO_SIGNAL_UNSAVED : NO_SIGNAL) : refused || (unsaved ? NOT_SAVED : "");
  }

  function fill(stay) {
    note.value = str(stay.note);
    part.fill(stay);
    was = fieldsOf(stay);
    const span = staySpan(stay);
    const total = nightOf(stay, {}).total;
    const nights = total ? total + (total === 1 ? " night" : " nights") : "";
    dayLine.replaceChildren(el("b", "", str(stay.name).trim() || str(stay.nameJp).trim()), el("i", "", [span, nights].filter(Boolean).join(" · ")));
  }

  function open(id) {
    if (phase) return false;
    stayId = id;
    const stay = current();
    if (!stay) {
      stayId = null;
      return false;
    }
    session += 1;
    phase = null;
    refused = "";
    unsaved = false;
    fill(stay);
    sheet.classList.add("is-open");
    sheet.inert = false;
    scrim.hidden = false;
    root.classList.add("staysheet-open");
    sheet.scrollTop = 0;
    update();
    done.focus({ preventScroll: true });
    return true;
  }

  // how: "done" or "saved" tell the app (it opens the card again); false says nothing.
  function close(how = false) {
    if (!isOpen() || phase === "saving") return;
    const id = stayId;
    stayId = null;
    phase = null;
    refused = "";
    unsaved = false;
    session += 1;
    note.disabled = false;
    done.disabled = false;
    sheet.classList.remove("is-saving");
    sheet.classList.remove("is-open");
    sheet.inert = true;
    scrim.hidden = true;
    root.classList.remove("staysheet-open");
    sheet.style.removeProperty("--kb");
    part.clear();
    if (sheet.contains(document.activeElement)) document.activeElement.blur();
    if (how === "done" || how === "saved") onClose(id, how);
  }

  function onSave() {
    if (save.disabled || phase) return;
    if (!current()) return;
    const patch = diff(was, read());
    if (!Object.keys(patch).length) {
      if (part.pending()) pictures(stayId, session);
      else close("saved");
      return;
    }
    const mine = session;
    const onUnsure = () => {
      if (mine !== session || phase !== "saving") return;
      phase = "checking";
      update();
    };
    phase = "saving";
    refused = "";
    unsaved = false;
    if (sheet.contains(document.activeElement)) document.activeElement.blur();
    const token = store.saveStay(stayId, patch, { quiet: true, onUnsure });
    if (!token) {
      phase = null;
      close(false);
      return;
    }
    update();
    store.outcome(token).then((out) => {
      if (mine !== session) {
        if (out && !out.saved) store.notify(LEFT_UNSAVED);
        return;
      }
      phase = null;
      if (out && out.saved) {
        if (out.item) was = fieldsOf(out.item);
        if (part.pending()) {
          pictures(stayId, mine);
          return;
        }
        close("saved");
        return;
      }
      if (out && out.reason === "refused") refused = out.message;
      else unsaved = true;
      update();
    });
  }

  // The picked pictures, one by one (still saving meanwhile). All saved, or
  // waiting on the phone for signal: it closes. One refused: it stays open
  // with the reason by that picture; Save tries it again.
  function pictures(id, mine) {
    phase = "saving";
    update();
    part.upload(id).then((res) => {
      if (mine !== session) return;
      phase = null;
      if (res.failed) {
        update();
        return;
      }
      close("saved");
    });
  }

  // The phone's keyboard: the sheet sits on top of it, the field in view (as the stop sheet).
  function keepInView() {
    if (!isOpen()) return;
    const vv = globalThis.visualViewport;
    const kb = vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
    if (kb > 0) sheet.style.setProperty("--kb", kb + "px");
    else sheet.style.removeProperty("--kb");
    const a = document.activeElement;
    if (!a || !sheet.contains(a) || !a.matches("input, textarea")) return;
    const box = (a.closest(".st-f") || a).getBoundingClientRect();
    const view = sheet.getBoundingClientRect();
    const pad = 12;
    if (box.bottom > view.bottom - pad) sheet.scrollTop += box.bottom - view.bottom + pad;
    else if (box.top < view.top + pad) sheet.scrollTop -= view.top + pad - box.top;
  }
  sheet.addEventListener("focusin", () => requestAnimationFrame(keepInView));
  if (globalThis.visualViewport) {
    globalThis.visualViewport.addEventListener("resize", keepInView);
    globalThis.visualViewport.addEventListener("scroll", keepInView);
  }

  // A picture picked or taken off (the Ticket part says so with an input event).
  tixBox.addEventListener("input", update);
  const edited = () => {
    if (!refused) return;
    refused = "";
    update();
  };
  sheet.addEventListener("input", edited);
  sheet.addEventListener("change", edited);
  save.addEventListener("click", onSave);
  done.addEventListener("click", () => close("done"));
  // A tap outside closes it only when nothing was changed (R33).
  scrim.addEventListener("click", () => {
    if (isOpen() && !changed()) close("done");
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !ev.isComposing && isOpen()) close("done");
  });
  // The keyboard's Next goes through the four facts; on Room it puts the keyboard away.
  const order = part.inputs();
  sheet.addEventListener("keydown", (ev) => {
    const i = order.indexOf(ev.target);
    if (ev.key !== "Enter" || i < 0 || ev.isComposing) return;
    ev.preventDefault();
    if (order[i + 1]) order[i + 1].focus();
    else ev.target.blur();
  });

  function wipe() {
    phase = null;
    close(false);
    note.value = "";
    part.clear();
    dayLine.replaceChildren();
    msg.textContent = "";
  }

  store.subscribe((s) => {
    if (s && s.status === "nokey") {
      wipe();
      return;
    }
    if (!isOpen()) return;
    // Removed on another phone while open: it closes (nothing to save it to).
    if (!current() && phase !== "saving") {
      phase = null;
      close(false);
      return;
    }
    update();
  });

  return { open, close: (restoreFocus) => close(restoreFocus === "done" || restoreFocus === "saved" ? restoreFocus : false), isOpen };
}
