/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The stop sheet: adding a stop to a day, or changing or removing one. Opened
// from a ticket's ＋ Add a stop row or an open stop's Edit button.
//
// mountStopSheet(root, store) -> { add(date), edit(id), close(restoreFocus), isOpen() }
// root is the phone. The fields are filled once, when the sheet opens; a
// sync or another phone's change never rewrites them while it is open, so
// nothing half-typed is lost. Save sends the stop (store.addStop), or only
// the fields that were changed (store.updateStop), and the sheet waits for
// the backend's answer (R36): while it waits it says Saving…, its buttons are
// off, nothing closes it and the fields cannot be changed. Saved: it closes
// and the undo bar shows the change. Refused: it stays, with everything typed
// and the backend's reason. No answer: it says it is checking, and closes as
// saved once a load shows the backend has it, or says it was not saved and
// Save works again (an add keeps its first id, so a retry can never make a
// second stop). Remove still goes at once, Undo on the bar. Stop writes need
// a connection: with no signal (store.state.online false) Save and Remove
// are off and the sheet says so. While changing a stop that another phone
// removes, the sheet says so and keeps what was typed. The fields are
// words, so the phone's own keyboard is used; the field being typed in is
// kept in view above it. Nothing here depends on the time.
//
// On the map: one row says whether the stop is On the map or Not on the map
// (its lat and lng, which the backend's locate fills in), with a field to
// paste a Google Maps link; the position is read from the link
// (js/geo.js pointFromLink) and sent as the stop's lat and lng. That is how a
// stop the geocoder put in the wrong city is put right. A new place with no
// link pasted takes the old position off (lat and lng sent empty). This is a
// place's position, never the phone's.
//
// The ticket (js/views/ticketpart.js), once migrate has made the ticket tabs
// (store.state.ticketsReady; until then the sheet is exactly as it was): the
// four facts are stop fields, saved with the rest; picked pictures are sent
// after the stop is saved, one by one, each with its progress. One refused
// keeps the sheet open with the reason; the others are saved.
//
// Drafts (issue 22): what is typed is kept on the phone (mat.stopDraft.*,
// per person and stop, or per day and new stop's id) until it is saved,
// removed or discarded. Reopening the stop, or ＋ Add a stop on that day
// (the newest new-stop draft, with its id, so a retry is still one stop;
// older ones are taken off), brings it back, field by field, unless another
// phone has changed that field since. Only then does the sheet say "Your
// unsaved changes are back." at the top and offer Discard draft.

import { dayHead } from "../format.js";
import { newId } from "../time.js";
import { pointFromLink, linkProblem } from "../geo.js";
import { mountTicketPart } from "./ticketpart.js";

const NO_SIGNAL = "No signal. Stops need a connection.";
const GONE = "Someone removed this stop, so it can’t be saved.";
const SAVING = "Saving…";
const CHECKING = "No answer from the trip sheet yet. Checking whether it was saved…";
const NO_SIGNAL_UNSAVED = "No signal. That wasn’t saved.";
const notSaved = (word) => "That wasn’t saved. Tap " + word + " to try again.";
// Said on the undo bar when the sheet was closed while still checking, and
// the check then showed the stop did not land.
const LEFT_UNSAVED = "That stop wasn’t saved.";
const TIME = /^([01]\d|2[0-3]):[0-5]\d/;
// Said at the top of the sheet when it opens with typing kept from before.
const BROUGHT_BACK = "Your unsaved changes are back.";
const DRAFT = "mat.stopDraft.";

const MARKUP = `
<div class="sheet-top"><span id="stHead">Add a stop</span><button type="button" id="stDone">Done</button></div>
<div class="st">
  <p class="st-msg" id="stBack" role="status" hidden></p>
  <div class="st-day" id="stDay"></div>
  <label class="st-f"><span>What</span><input id="stWhat" maxlength="80" autocomplete="off" enterkeyhint="next"></label>
  <label class="st-f st-time"><span>Time</span><input id="stTime" type="time"></label>
  <label class="st-f"><span>A line of detail</span><input id="stDetail" maxlength="120" autocomplete="off" enterkeyhint="next"></label>
  <label class="st-f"><span>How to get there</span><textarea id="stGo" maxlength="300" rows="2"></textarea></label>
  <label class="st-f st-time"><span>Minutes to get there</span><input id="stMin" inputmode="numeric" maxlength="3" autocomplete="off" enterkeyhint="next"></label>
  <label class="st-sw"><span>The time can’t slip<i>指定</i></span><input id="stFixed" type="checkbox" role="switch"></label>
  <label class="st-f"><span>Place name or pasted Maps link</span><input id="stPlace" maxlength="200" autocomplete="off" enterkeyhint="next"></label>
  <label class="st-f st-at"><span class="st-at-h"><b id="stAtW">Not on the map</b><i id="stAtS"></i></span><input id="stPin" type="url" inputmode="url" maxlength="2000" autocomplete="off" enterkeyhint="next" placeholder="Paste a Google Maps link"></label>
  <label class="st-f"><span>Link to a ticket or confirmation</span><input id="stLink" type="url" inputmode="url" maxlength="500" autocomplete="off" enterkeyhint="next"></label>
  <label class="st-f"><span>Japanese name on signs</span><input id="stSign" maxlength="20" lang="ja" autocomplete="off" enterkeyhint="done"></label>
  <div id="stTix" hidden></div>
  <p class="st-msg" id="stMsg" role="status"></p>
  <button type="button" id="stDiscard" hidden>Discard draft</button>
  <div class="st-btns"><button type="button" id="stDel" hidden>Remove</button><button type="button" id="stSave" disabled>Add stop</button></div>
</div>`;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const str = (v) => (typeof v === "string" ? v : "");
// "HH:MM" from what a time field gives, else "" (the backend does not trim it).
const cleanTime = (v) => {
  const m = TIME.exec(str(v).trim());
  return m ? m[0] : "";
};
// A whole number of minutes from 0 up (empty is 0, as the backend keeps it).
const cleanMin = (v) => {
  const digits = str(v).replace(/\D/g, "");
  return digits ? Number(digits) : 0;
};

// What the backend's validateStop (backend/Pure.js) would refuse in these
// fields, in its own words, and the field to correct; null when it takes
// them. The other limits are the fields' maxlength, the name is required
// before Save comes on, the time is cleaned and the day comes from a ticket,
// so this is everything a save from the sheet can be refused for.
const goodUrl = (v) => v.length <= 500 && /^https?:\/\/\S+$/i.test(v);
function problem(v) {
  if (v.travelMin > 600) return { field: "travelMin", text: "Minutes to get there must be a whole number from 0 to 600." };
  if (/^https?:/i.test(v.place) && !goodUrl(v.place)) return { field: "place", text: "That map link didn’t come through properly." };
  if (v.link && !goodUrl(v.link)) return { field: "link", text: "That link has to start with https://." };
  return null;
}

// Retain fields from an earlier opening until the user edits them. Keep the
// original value alongside each edit so a restore can detect intervening changes.
export function updateStopDraft(previous, original, values, addId) {
  const fields = { ...previous?.fields };
  const base = { ...previous?.base };
  delete fields.stTkRef;
  delete base.stTkRef;
  for (const [key, value] of Object.entries(values)) {
    if (key === "stTkRef" || original[key] === value) continue;
    fields[key] = value;
    if (!(key in base)) base[key] = original[key];
  }
  return Object.keys(fields).length ? { fields, base, addId } : null;
}

// One record per person and stop (or trip day for a new stop). Compare before
// removal so a late save cannot clear a newer draft from another opening.
export function stopDrafts(storage, scope) {
  const key = DRAFT + JSON.stringify(scope);
  return {
    read() {
      try {
        const draft = JSON.parse(storage.getItem(key));
        return draft && draft.fields && typeof draft.fields === "object" ? draft : null;
      } catch {
        return null;
      }
    },
    write(draft) {
      try {
        storage.setItem(key, JSON.stringify(draft));
        return true;
      } catch {
        return false;
      }
    },
    clear(expected) {
      try {
        if (expected && storage.getItem(key) === JSON.stringify(expected)) storage.removeItem(key);
      } catch {
        // A storage failure must leave the editor usable.
      }
    },
  };
}

// What a kept draft brings back into a sheet that opened with `original`
// (each field's value as filled): only the fields whose saved baseline still
// matches, so a newer value from another phone wins over that draft field.
export function draftToRestore(draft, original) {
  const out = {};
  if (!draft || !draft.fields) return out;
  for (const [id, initial] of Object.entries(original)) {
    if (!(id in draft.fields) || !draft.base || draft.base[id] !== initial) continue;
    const v = draft.fields[id];
    if (typeof initial === "boolean" ? typeof v === "boolean" : typeof v === "string") out[id] = v;
  }
  return out;
}

// The new-stop drafts on one day: scope is [trip name, trip start, person,
// "add", day]; each key adds that try's stop id. Returns the newest one's id
// (so a retry still lands as one stop on the backend) and takes the older
// ones off the phone; null when there is none.
function draftKeys(storage) {
  const keys = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (typeof k === "string" && k.startsWith(DRAFT)) keys.push(k);
    }
  } catch {
    // A storage failure must leave the editor usable.
  }
  return keys.map((k) => {
    try {
      const scope = JSON.parse(k.slice(DRAFT.length));
      return Array.isArray(scope) ? { k, scope } : null;
    } catch {
      return null;
    }
  }).filter(Boolean);
}
const sameScope = (a, b) => b.every((v, i) => a[i] === v);
const when = (storage, k) => {
  try {
    const d = JSON.parse(storage.getItem(k));
    return d && Number.isFinite(d.savedAt) ? d.savedAt : 0;
  } catch {
    return 0;
  }
};
export function newestAddDraft(storage, scope) {
  const found = draftKeys(storage)
    .filter(({ scope: s }) => s.length === scope.length + 1 && sameScope(s, scope) && typeof s[scope.length] === "string" && s[scope.length])
    .map(({ k, scope: s }) => ({ k, addId: s[scope.length], at: when(storage, k) }))
    .sort((a, b) => b.at - a.at);
  if (!found.length) return null;
  for (const old of found.slice(1)) {
    try {
      storage.removeItem(old.k);
    } catch {
      // left for the next opening
    }
  }
  return found[0].addId;
}

// Takes one new-stop draft (scope plus its stop id) off the phone.
export function dropAddDraft(storage, scope, addId) {
  try {
    storage.removeItem(DRAFT + JSON.stringify([...scope, addId]));
  } catch {
    // left for the next opening
  }
}

// New-stop drafts for this person and trip ([trip name, trip start, person])
// on a day that is no longer one of the trip's days: nothing can open them.
export function pruneAddDrafts(storage, who, days) {
  const keep = new Set(days);
  for (const { k, scope } of draftKeys(storage)) {
    if (scope.length !== who.length + 3 || !sameScope(scope, who) || scope[who.length] !== "add" || keep.has(scope[who.length + 1])) continue;
    try {
      storage.removeItem(k);
    } catch {
      // left for the next load
    }
  }
}

export function mountStopSheet(root, store, { keep = null, storage = null } = {}) {
  const scrim = el("div", "scrim");
  scrim.id = "stopScrim";
  scrim.hidden = true;
  const sheet = el("div", "sheet stop");
  sheet.id = "stop";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "stHead");
  sheet.inert = true;
  sheet.innerHTML = MARKUP;
  root.append(scrim, sheet);

  const $ = (id) => sheet.querySelector("#" + id);
  const head = $("stHead");
  const dayLine = $("stDay");
  const done = $("stDone");
  const msg = $("stMsg");
  const save = $("stSave");
  const del = $("stDel");
  const discard = $("stDiscard");
  const back = $("stBack");
  const f = {
    title: $("stWhat"), time: $("stTime"), detail: $("stDetail"), gettingThere: $("stGo"), travelMin: $("stMin"),
    fixed: $("stFixed"), place: $("stPlace"), link: $("stLink"), signJp: $("stSign"),
  };
  const pin = $("stPin");
  const atWord = $("stAtW");
  const atSay = $("stAtS");
  let at = { lat: "", lng: "" }; // the stop's position as the sheet opened
  const tixBox = $("stTix");
  const part = keep ? mountTicketPart(tixBox, store, keep) : null;
  let withTix = false; // the Ticket part is shown (migrate has run): its facts are part of the stop

  let mode = null; // "add" or "edit" while open
  let date = null; // the day the stop is on
  let stopId = null; // the stop being changed
  let was = null; // the fields as they were filled, to send only what changed
  let refused = ""; // why the last Save was refused, until a field changes
  let phase = null; // "saving" while Save waits for the backend; "checking" when no answer came
  let unsaved = false; // the last Save did not reach the Sheet
  let addId = null; // the new stop's id, kept across tries so a retry can never make a second stop
  let tries = 0; // Saves sent for this add
  let saveWord = "Add stop";
  let session = 0; // one per opening, so a late answer knows whether its sheet is still the one open

  let drafts = null;
  let originalInputs = {};
  let draft = null;

  // Only editable text, checkbox values and the retry id belong here. Ticket
  // files use the separate ticket store. Preserve the raw text as typed.
  function formValues() {
    const controls = [...Object.values(f), pin, ...(withTix ? part.inputs() : [])];
    return Object.fromEntries(controls.filter((field) => field.id !== "stTkRef").map((field) => [
      field.id, field.type === "checkbox" ? field.checked : field.value,
    ]));
  }

  // Keeps what is typed on the phone. "Discard draft" and the line at the top
  // show only when the sheet opened with typing brought back (show()), not
  // as soon as anyone types; with everything put back as it was, there is
  // nothing left to discard and both go.
  function captureDraft() {
    if (!drafts || !mode) return;
    const next = updateStopDraft(null, originalInputs, formValues(), addId);
    if (!next) {
      drafts.clear(draft);
      draft = null;
      broughtBack(false);
      return;
    }
    draft = { ...next, savedAt: Date.now() };
    drafts.write(draft);
  }

  function broughtBack(on) {
    discard.hidden = !on;
    back.hidden = !on;
    back.textContent = on ? BROUGHT_BACK : "";
  }

  const isOpen = () => sheet.classList.contains("is-open");
  const current = () => (store.state.stops || []).find((s) => s && s.id === stopId && !s.deleted) || null;
  const online = () => store.state.online !== false;

  // The position the stop will have: from a pasted link that has one, else
  // as it was, except that a new place takes it off (the old one was for the
  // old place).
  function where(place) {
    const p = pointFromLink(pin.value);
    if (p) return { lat: String(p.lat), lng: String(p.lng) };
    if (was && place !== was.place) return { lat: "", lng: "" };
    return at;
  }

  function showAt() {
    const typed = pin.value.trim() !== "";
    const p = pointFromLink(pin.value);
    const w = where(f.place.value.trim());
    atWord.textContent = w.lat !== "" ? "On the map" : "Not on the map";
    const bad = linkProblem(pin.value);
    atSay.textContent = bad ? bad : p ? "From the pasted link." : typed ? "No position in that link. Copy the long link from Google Maps’ address bar." : w.lat !== "" ? "Paste a Google Maps link to move it." : "Paste a Google Maps link to put it there.";
  }

  // The fields as the backend takes them.
  function read() {
    const place = f.place.value.trim();
    const w = where(place);
    return {
      title: f.title.value.trim(),
      time: cleanTime(f.time.value),
      detail: f.detail.value.trim(),
      gettingThere: f.gettingThere.value.trim(),
      travelMin: cleanMin(f.travelMin.value),
      fixed: f.fixed.checked,
      place,
      link: f.link.value.trim(),
      signJp: f.signJp.value.trim(),
      lat: w.lat,
      lng: w.lng,
      ...(withTix ? part.read() : {}),
    };
  }

  // A stop's fields as read() would give them back once filled in.
  function fieldsOf(stop) {
    const min = Number(stop.travelMin);
    return {
      title: str(stop.title).trim(),
      time: cleanTime(stop.time),
      detail: str(stop.detail).trim(),
      gettingThere: str(stop.gettingThere).trim(),
      travelMin: Number.isInteger(min) && min > 0 ? min : 0,
      fixed: stop.fixed === true,
      place: str(stop.place).trim(),
      link: str(stop.link).trim(),
      signJp: str(stop.signJp).trim(),
      lat: str(stop.lat),
      lng: str(stop.lng),
      ...(withTix ? part.fieldsOf(stop) : {}),
    };
  }

  function fill(stop) {
    f.title.value = str(stop.title);
    f.time.value = cleanTime(stop.time);
    f.detail.value = str(stop.detail);
    f.gettingThere.value = str(stop.gettingThere);
    const min = Number(stop.travelMin);
    f.travelMin.value = Number.isInteger(min) && min > 0 ? String(min) : "";
    f.fixed.checked = stop.fixed === true;
    f.place.value = str(stop.place);
    f.link.value = str(stop.link);
    f.signJp.value = str(stop.signJp);
    pin.value = "";
    withTix = !!part && store.state.ticketsReady === true;
    tixBox.hidden = !withTix;
    // The keyboard's key says what Enter does: on to the ticket's facts, or done.
    f.signJp.enterKeyHint = withTix ? "next" : "done";
    if (part) part.fill(withTix ? stop : {});
    at = str(stop.lat) !== "" && str(stop.lng) !== "" ? { lat: str(stop.lat), lng: str(stop.lng) } : { lat: "", lng: "" };
    was = null;
    was = read();
    showAt();
  }

  const diff = (from, to) => {
    const out = {};
    for (const k of Object.keys(to)) if (to[k] !== from[k]) out[k] = to[k];
    return out;
  };

  // Something differs from what the sheet opened with (a field typed and
  // put back counts as unchanged).
  function changed() {
    const now = read();
    return Object.keys(now).some((k) => now[k] !== was[k]) || (withTix && part.changed());
  }

  // Save and Remove, and the line above them: saving or checking, no
  // signal, the stop removed on another phone (what was typed stays, but
  // cannot be saved; it comes back if the stop is put back), why the last
  // Save was refused, or that it was not saved.
  function update() {
    if (!isOpen()) return;
    const busy = phase !== null;
    discard.disabled = busy;
    for (const field of Object.values(f)) field.disabled = busy;
    pin.disabled = busy;
    if (withTix) part.setBusy(busy);
    sheet.classList.toggle("is-saving", phase === "saving");
    done.disabled = phase === "saving";
    save.textContent = phase === "saving" ? SAVING : saveWord;
    if (busy) {
      save.disabled = true;
      del.disabled = true;
      msg.textContent = phase === "checking" ? CHECKING : "";
      return;
    }
    if (withTix && part.reading()) {
      save.disabled = true;
      return;
    }
    const off = !online();
    const gone = mode === "edit" && !current();
    save.disabled = off || gone || f.title.value.trim() === "";
    del.disabled = off || gone;
    msg.textContent = off ? (unsaved ? NO_SIGNAL_UNSAVED : NO_SIGNAL) : gone ? GONE : refused || (unsaved ? notSaved(saveWord) : "");
  }

  const render = update;

  function show(title, day, word) {
    session += 1;
    phase = null;
    unsaved = false;
    refused = "";
    tries = 0;
    originalInputs = formValues();
    const trip = store.state.trip;
    drafts = storage && trip && store.state.me
      ? stopDrafts(storage, [trip.name, trip.start, store.state.me, mode, ...(stopId ? [stopId] : [day, addId])])
      : null;
    draft = drafts ? drafts.read() : null;
    const restore = draftToRestore(draft, originalInputs);
    for (const [id, v] of Object.entries(restore)) {
      const input = $(id);
      if (input.type === "checkbox") input.checked = v;
      else input.value = v;
    }
    if (draft) {
      showAt();
      // The kept draft is now exactly what was brought back (fields another
      // phone changed since are dropped), or gone when nothing was.
      captureDraft();
    }
    broughtBack(!!draft);
    head.textContent = title;
    const dh = dayHead(day);
    // A stop on the evening before the first day (前夜) keeps that day: it reads so.
    const eve = (store.state.eves || []).some((d) => d && d.date === day);
    if (eve) dayLine.replaceChildren(el("b", "", "前夜 " + dh.en));
    else dayLine.replaceChildren(el("b", "", dh.en), el("i", "", dh.jp));
    saveWord = word;
    del.hidden = mode !== "edit";
    sheet.classList.add("is-open");
    sheet.inert = false;
    scrim.hidden = false;
    root.classList.add("stop-open");
    sheet.scrollTop = 0;
    update();
    // Done, not the name field: the keyboard does not cover the sheet as it rises.
    done.focus({ preventScroll: true });
  }

  function add(day) {
    if (typeof day !== "string" || !day || phase) return false;
    mode = "add";
    date = day;
    stopId = null;
    const trip = store.state.trip;
    const scope = storage && trip && store.state.me ? [trip.name, trip.start, store.state.me, "add", day] : null;
    let kept = scope ? newestAddDraft(storage, scope) : null;
    // That save did land (its answer was lost): the id is already a stop, so a
    // retry under it would write nothing. Start blank under a new id.
    if (kept && (store.state.stops || []).some((s) => s.id === kept)) {
      dropAddDraft(storage, scope, kept);
      kept = null;
    }
    addId = kept || newId();
    fill({});
    show("Add a stop", day, "Add stop");
    return true;
  }

  function edit(id) {
    if (phase) return false;
    stopId = id;
    const stop = current();
    if (!stop) {
      stopId = null;
      return false;
    }
    mode = "edit";
    date = stop.date;
    fill(stop);
    show("Change a stop", stop.date, "Save");
    return true;
  }

  // restoreFocus: back to what opened the sheet on the ticket in view (the
  // stop's Edit, else its day's ＋ Add a stop).
  // Nothing closes the sheet while a Save waits for its answer.
  function close(restoreFocus = true) {
    if (!isOpen() || phase === "saving") return;
    const id = stopId;
    const day = date;
    mode = null;
    drafts = null;
    draft = null;
    broughtBack(false);
    stopId = null;
    addId = null;
    refused = "";
    unsaved = false;
    phase = null;
    session += 1;
    for (const field of Object.values(f)) field.disabled = false;
    pin.disabled = false;
    done.disabled = false;
    sheet.classList.remove("is-saving");
    sheet.classList.remove("is-open");
    sheet.inert = true;
    scrim.hidden = true;
    root.classList.remove("stop-open");
    sheet.style.removeProperty("--kb");
    if (part) part.clear();
    if (sheet.contains(document.activeElement)) document.activeElement.blur();
    if (restoreFocus !== true) return;
    const edit = id ? root.querySelector('.r[data-id="' + CSS.escape(id) + '"] .r-edit') : null;
    const back = edit || (day ? root.querySelector('.pg[data-date="' + CSS.escape(day) + '"] .tk-add') : null);
    if (back) back.focus({ preventScroll: true });
  }

  function onSave() {
    if (save.disabled || phase) return;
    const now = read();
    if (!now.title) return;
    // Refused here in the backend's words, with everything typed kept.
    const why = problem(now);
    if (why) {
      refused = why.text;
      update();
      f[why.field].focus();
      return;
    }
    send(now);
  }

  // Sends what is typed and waits for the backend's answer (R36).
  function send(now) {
    const mine = session;
    const onUnsure = () => {
      if (mine !== session || phase !== "saving") return;
      phase = "checking";
      update();
    };
    let token = null;
    phase = "saving";
    refused = "";
    unsaved = false;
    if (sheet.contains(document.activeElement)) document.activeElement.blur();
    if (mode === "add") {
      if (!addId) addId = newId();
      tries += 1;
      captureDraft();
      token = store.addStop({ date, ...now }, { id: addId, quiet: true, onUnsure });
    } else if (mode === "edit") {
      const patch = diff(was, now);
      if (Object.keys(patch).length) token = store.updateStop(stopId, patch, { quiet: true, onUnsure });
      else if (current()) {
        if (withTix && part.pending()) {
          pictures(stopId, mine);
          return;
        }
        phase = null;
        close();
        return;
      }
    }
    if (!token) {
      // The stop is gone (removed on another phone): update() says so.
      phase = null;
      update();
      return;
    }
    update();
    const sentAdd = mode === "add" ? now : null;
    const savingDrafts = drafts;
    const submitted = formValues();
    const savingDraft = draft && Object.entries(draft.fields).every(([field, value]) => submitted[field] === value) ? draft : null;
    store.outcome(token).then((out) => {
      if (out && out.saved && savingDrafts) savingDrafts.clear(savingDraft);
      if (mine !== session) {
        // Closed while it was checking: the undo bar has the last word.
        if (out && !out.saved) store.notify(LEFT_UNSAVED);
        return;
      }
      phase = null;
      if (out && out.saved) {
        // A retried add whose first try had landed after all: the backend
        // kept the first one. What was typed since is sent as a change.
        if (sentAdd && tries > 1 && out.item && Object.keys(diff(fieldsOf(out.item), sentAdd)).length) {
          mode = "edit";
          stopId = out.item.id;
          was = fieldsOf(out.item);
          send(sentAdd);
          return;
        }
        if (withTix && part.pending() && out.item) {
          // The stop is saved: now it can hold pictures (a new one has its id now).
          mode = "edit";
          stopId = out.item.id;
          was = fieldsOf(out.item);
          pictures(out.item.id, mine);
          return;
        }
        close();
        return;
      }
      if (out && out.reason === "refused") refused = out.message;
      else unsaved = true;
      update();
    });
  }

  // Sends the picked pictures, one by one (the sheet stays saving meanwhile).
  // All saved (or waiting on the phone for signal): it closes. One refused:
  // it stays open with the reason by that picture; Save tries it again.
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
      close();
    });
  }

  function onRemove() {
    if (mode !== "edit" || del.disabled) return;
    const id = stopId;
    if (drafts) drafts.clear(draft);
    store.deleteStop(id);
    stopId = null; // its row is gone: focus goes to the day's ＋ Add a stop
    close();
  }

  // The phone's keyboard covers the bottom of the screen: the sheet sits on
  // top of it, and the field being typed in is scrolled into the sheet's view.
  function keepInView() {
    if (!isOpen()) return;
    const vv = globalThis.visualViewport;
    const kb = vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
    if (kb > 0) sheet.style.setProperty("--kb", kb + "px");
    else sheet.style.removeProperty("--kb");
    const a = document.activeElement;
    if (!a || !sheet.contains(a) || !a.matches("input, textarea")) return;
    const box = (a.closest(".st-f, .st-sw") || a).getBoundingClientRect();
    const view = sheet.getBoundingClientRect();
    const pad = 12;
    if (box.bottom > view.bottom - pad) sheet.scrollTop += box.bottom - view.bottom + pad;
    else if (box.top < view.top + pad) sheet.scrollTop -= view.top + pad - box.top;
  }
  sheet.addEventListener("focusin", () => requestAnimationFrame(keepInView));
  // iOS moves the visible area (offsetTop) with "scroll" as well as "resize".
  if (globalThis.visualViewport) {
    globalThis.visualViewport.addEventListener("resize", keepInView);
    globalThis.visualViewport.addEventListener("scroll", keepInView);
  }

  f.title.addEventListener("input", update);
  // A picture picked or taken off (the Ticket part says so with an input event).
  tixBox.addEventListener("input", update);
  pin.addEventListener("input", showAt);
  f.place.addEventListener("input", showAt);
  // Correcting any field takes the reason away.
  const edited = () => {
    captureDraft();
    if (!refused) return;
    refused = "";
    update();
  };
  sheet.addEventListener("input", edited);
  sheet.addEventListener("change", edited);
  // Minutes are a whole number: anything else typed is dropped.
  f.travelMin.addEventListener("input", () => {
    const digits = f.travelMin.value.replace(/\D/g, "");
    if (digits !== f.travelMin.value) f.travelMin.value = digits;
  });
  save.addEventListener("click", onSave);
  discard.addEventListener("click", () => {
    if (!drafts || phase) return;
    drafts.clear(draft);
    draft = null;
    fill(current() || {});
    originalInputs = formValues();
    broughtBack(false);
    refused = "";
    unsaved = false;
    update();
    done.focus({ preventScroll: true });
  });
  del.addEventListener("click", onRemove);
  done.addEventListener("click", () => close());
  // A tap outside closes the sheet only when nothing was changed (R33).
  scrim.addEventListener("click", () => {
    if (isOpen() && !changed()) close();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !ev.isComposing) close();
  });
  // The keyboard's Next, in a one-line field, goes to the next field (the
  // directions box among them); on the last one it puts the keyboard away.
  // Enter in the directions box is its own (a new line).
  const order = [f.title, f.time, f.detail, f.gettingThere, f.travelMin, f.place, pin, f.link, f.signJp, ...(part ? part.inputs() : [])];
  sheet.addEventListener("keydown", (ev) => {
    // Only the fields that show (the ticket's facts are hidden before migrate: minor 1).
    const shown = order.filter((x) => !x.closest("[hidden]"));
    const i = shown.indexOf(ev.target);
    if (ev.key !== "Enter" || i < 0 || ev.isComposing || ev.target === f.gettingThere) return;
    ev.preventDefault();
    if (shown[i + 1]) shown[i + 1].focus();
    else ev.target.blur();
  });
  // The trip was taken off this phone: the sheet closes, even mid-save, and
  // the stop it held is taken out of its fields.
  function wipe() {
    phase = null;
    close(false);
    fill({});
    head.textContent = "";
    dayLine.replaceChildren();
    msg.textContent = "";
    date = null;
  }

  // Once a load has the trip's days: new-stop drafts on a day the trip no
  // longer has are taken off the phone.
  let pruned = false;
  function prune(s) {
    if (pruned || !storage || !s || s.status !== "ready" || !s.trip || !s.me || !(s.days || []).length) return;
    pruned = true;
    const days = [...s.days, ...(s.eves || [])].map((d) => d && String(d.date).slice(0, 10)).filter(Boolean);
    pruneAddDrafts(storage, [s.trip.name, s.trip.start, s.me], days);
  }

  store.subscribe((s) => {
    if (s && s.status === "nokey") {
      pruned = false;
      wipe();
    } else {
      prune(s);
      render();
    }
  });

  return { add, edit, close: (restoreFocus) => close(restoreFocus), isOpen };
}
