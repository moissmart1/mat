/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Starts the app: takes the trip key from the invite link, builds the api and
// the store, mounts the screens (Days, Before we go and Money) and boots.

import { API_URL } from "./config.js";
import { createApi } from "./api.js";
import { createStore } from "./store.js";
import { createClock } from "./clock.js";
import { dateIn, defaultRingDay, tripDay } from "./time.js";
import { mountDays } from "./views/days.js";
import { mountMoney } from "./views/money.js";
import { mountFirst } from "./views/first.js";
import { mountRegister } from "./views/register.js";
import { mountLine } from "./views/line.js";
import { mountHistory } from "./views/history.js";
import { mountYou } from "./views/you.js";
import { mountStayCard } from "./views/staycard.js";
import { mountCompass } from "./views/compass.js";
import { mountAllDays } from "./views/alldays.js";
import { mountStopSheet } from "./views/stopsheet.js";
import { mountUndoBar } from "./views/ubar.js";
import { mountNet } from "./views/net.js";
import { mountTodos } from "./views/todos.js";
import { mountStampBook } from "./views/stampbook.js";
import { tabName } from "./todos.js";
import { rollingCount } from "./fx.js";
import { createUpdater, otherVersionIn } from "./update.js";
import { APP_VERSION } from "./config.js";
import { isWide, onWide } from "./shape.js";
import { createWhere } from "./where.js";
import { clearTrip, forgetPhone } from "./forget.js";

// How often a visible phone asks the backend whether anything changed.
const CHECK_MS = 20000;
const TABS = ["days", "money"];
// A demo left alone longer than this in the background is ended on return.
const DEMO_AWAY_MS = 10 * 60 * 1000;
// How often a running demo checks that the real day is still the one it started on.
const DEMO_GUARD_MS = 30000;

// localStorage, or a stand-in in memory when the browser will not give it.
function phoneStorage() {
  try {
    const s = globalThis.localStorage;
    s.getItem("mat.key");
    return s;
  } catch {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
      key: (i) => [...mem.keys()][i] ?? null,
      get length() {
        return mem.size;
      },
    };
  }
}

// The invite link carries the key as #k=<key>. Take it out of the address
// bar, so it is not left in history or a shared URL. Returns { key,
// candidate }:
// - no key stored yet (or the same one): it is kept on the phone and is
//   `key` (so it still works for this visit when the phone will not store it);
// - another key already stored (fix round 1, C1: an old Home Screen icon or
//   invite link carrying the old shared key, or any link someone sends): it
//   is NOT stored. It is `candidate`, tried once by the store (boot), kept
//   only if the trip takes it, and never a reason to clear the phone.
function takeKey(storage) {
  const none = { key: null, candidate: null };
  const hash = location.hash.replace(/^#/, "");
  if (!hash) return none;
  const parts = hash.split("&");
  const found = parts.find((p) => p.startsWith("k="));
  if (found === undefined) return none;
  let key = found.slice(2);
  try {
    key = decodeURIComponent(key);
  } catch {
    // keep it as typed
  }
  const rest = parts.filter((p) => p !== found).join("&");
  history.replaceState(history.state, "", location.pathname + location.search + (rest ? "#" + rest : ""));
  if (!key) return none;
  let stored = null;
  try {
    stored = storage.getItem("mat.key");
  } catch {
    stored = null;
  }
  if (stored && stored !== key) return { key: null, candidate: key };
  try {
    storage.setItem("mat.key", key);
  } catch {
    // nowhere to keep it: it works for this visit only
  }
  return { key, candidate: null };
}

// The phone's storage, except that mat.key falls back to the key from this
// visit (its link, or a pasted one) when the phone could not keep it.
function withKey(storage, keyHere) {
  return {
    getItem(k) {
      let v = null;
      try {
        v = storage.getItem(k);
      } catch {
        v = null;
      }
      return v === null && k === "mat.key" ? keyHere() : v;
    },
    setItem: (k, v) => storage.setItem(k, v),
    removeItem: (k) => storage.removeItem(k),
    key: (i) => storage.key(i),
    get length() {
      return storage.length;
    },
  };
}

// The screens. showTab(tab) shows one, marks its button and makes the
// others inert; with `remember` it keeps the choice (mat.tab) and the trip day
// it was made on (mat.tabDay, by the real time, never the demo clock).
function mountTabs(store, storage) {
  const views = { days: document.getElementById("vDays"), before: document.getElementById("vBefore"), money: document.getElementById("vMoney") };
  const nav = document.getElementById("nav");
  const read = (k) => {
    try {
      return storage.getItem(k);
    } catch {
      return null;
    }
  };
  const keptTab = TABS.includes(read("mat.tab")) ? read("mat.tab") : null;
  const keptDay = read("mat.tabDay");
  let tab = null;
  let settled = false; // the opening screen has been decided with the trip known
  const shownHooks = []; // called with the tab's name each time a tab is shown

  // A computer's window (WIDE) shows Money and Days side by side, Before over
  // the Days pane while it is the tab. `tab` stays what a phone would show,
  // so a narrower window goes back to it.
  let wide = isWide();
  let cameFrom = null; // WIDE: the tab Before was opened from
  const shows = (name, t) => (wide ? name === "money" || name === (t === "before" ? "before" : "days") : name === t);

  function showTab(t, remember = true) {
    const changed = t !== tab;
    tab = t;
    for (const b of nav.querySelectorAll("button[data-tab]")) {
      const on = b.dataset.tab === t;
      b.classList.toggle("is-active", on);
      // WIDE hides the Days and Money keys (the panes are both there): only Before can be the current key.
      if (on && !(wide && b.dataset.tab !== "before")) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
    for (const [name, view] of Object.entries(views)) {
      const on = shows(name, t);
      view.classList.toggle("is-active", on);
      view.inert = !on;
    }
    // The hooks are for arriving: a tap on the tab already showing leaves it as it is.
    if (changed) for (const f of shownHooks) f(t);
    // The Before tab comes and goes with the list: it is never what the app opens on.
    // In WIDE there is nothing to choose between, so what is remembered is left as it was.
    if (!remember || wide || t === "before") return;
    const trip = store.state.trip;
    try {
      storage.setItem("mat.tab", t);
      storage.setItem("mat.tabDay", dateIn((trip && trip.tz) || "Asia/Tokyo", Date.now()));
    } catch {
      // private mode: it opens on Days next time
    }
  }

  // The stored screen, except that on a new day of the trip it is the ticket;
  // with nothing stored it is the ticket.
  function opening(trip) {
    if (!keptTab) return "days";
    if (trip && trip.start) {
      const today = tripDay({ ...trip, tz: trip.tz || "Asia/Tokyo" }, Date.now());
      if (today !== "pre" && today !== "post" && keptDay !== today) return "days";
    }
    return keptTab;
  }

  function settle(s) {
    if (settled || !(s.trip && s.trip.start)) return;
    settled = true;
    showTab(opening(s.trip));
  }

  showTab(opening(null), false);
  settle(store.state);
  store.subscribe(settle);
  // Crossing into or out of WIDE lays the views out again; nothing else changes.
  onWide((w) => {
    wide = w;
    if (tab) showTab(tab, false);
  });
  nav.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-tab]");
    if (!b) return;
    settled = true;
    // WIDE: Before takes the Days pane and the Days key brings back the tab it
    // was opened from (Money's pane never went away), so a narrower window
    // shows what it showed before.
    if (wide && b.dataset.tab === "before" && tab !== "before") cameFrom = tab;
    else if (wide && b.dataset.tab === "days" && tab === "before") return showTab(cameFrom || "days");
    showTab(b.dataset.tab);
  });
  return { showTab, tab: () => tab, onShown: (f) => shownHooks.push(f) };
}

function start() {
  const raw = phoneStorage();
  const taken = takeKey(raw);
  let keyHere = taken.key;
  const storage = withKey(raw, () => keyHere);

  const connected = !!API_URL || typeof globalThis.MAT_FAKE_API === "function";
  let store;
  const api = createApi({
    url: API_URL,
    getKey: () => storage.getItem("mat.key"),
    // On its own link the backend knows who this is: no name is sent.
    getActor: () => (store && store.state.personal ? undefined : (store && store.state.me) || storage.getItem("mat.me")),
  });
  // A refused key takes the trip off the phone (js/store.js): the stored
  // keys, and the key this visit came with.
  store = createStore({
    api,
    storage,
    clear: (queue) => {
      keyHere = null;
      clearTrip(raw, { queue });
    },
  });

  // Where the phone is: kept in memory only, never sent or stored (js/where.js).
  const where = createWhere({ storage: raw, geolocation: navigator.geolocation, permissions: navigator.permissions });
  where.start();

  // The one clock the Days screen reads, in the trip's time zone.
  const clock = createClock({ getTz: () => (store.state.trip && store.state.trip.tz) || "Asia/Tokyo" });
  const tabs = mountTabs(store, raw);

  const phone = document.getElementById("phone");
  // Ring up on Days shows Money while the register is open, so each line is
  // seen printing onto the receipt, and goes back to Days when it closes.
  // Borrowed: mat.tab is left as it was.
  let borrowed = false;
  const register = mountRegister(phone, store, {
    storage: raw,
    onClose: () => {
      if (!borrowed) return;
      borrowed = false;
      tabs.showTab("days", false);
    },
  });
  // One sheet at a time: opening one closes the others.
  const history = mountHistory(phone, store);
  // The Days sheets: the hotel card, the list of every day and the stop sheet.
  // Back to the hotel: the compass, from You → Extras or the hotel card.
  const compass = mountCompass(phone, store, { clock, storage: raw });
  const stayCard = mountStayCard(phone, store, {
    where,
    onCompass: (id) => {
      stayCard.close(false);
      compass.open(id);
    },
  });
  const allDays = mountAllDays(phone, store, { clock, onPick: (i) => days.goDay(i) });
  const stopSheet = mountStopSheet(phone, store);
  // The stamp book, a panel like History, opened from the Days bar or today's ticket.
  const book = mountStampBook(phone, store, { where });
  const closeDaySheets = () => {
    stayCard.close(false);
    allDays.close(false);
    stopSheet.close(false);
    book.close(false);
    compass.close(false);
  };
  // A tab switch closes them (they belong to Days).
  document.getElementById("nav").addEventListener("click", (ev) => {
    if (!ev.target.closest("button[data-tab]")) return;
    borrowed = false;
    closeDaySheets();
  });
  // A phone is never left pretending unseen (R34): the demo ends by itself
  // when the app comes back after more than 10 minutes away, or on another
  // real trip-zone day than the one it started on. Real time, not the demo's.
  const realToday = () => dateIn((store.state.trip && store.state.trip.tz) || "Asia/Tokyo", Date.now());
  let demoOn = null; // the real trip-zone day the demo was started on
  let hiddenAt = null;
  // The one rule: a running demo ends when it was left more than 10 minutes
  // in the background, or the real trip-zone day is no longer the one it
  // started on. Checked on return to the foreground and, while a demo runs,
  // by a slow timer (a visible phone is never left pretending unseen).
  const endStaleDemo = (away) => {
    if (clock.demoDay() && (away > DEMO_AWAY_MS || realToday() !== demoOn)) clock.stop();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    endStaleDemo(away);
  });
  // The slow timer exists only while a demo runs.
  let demoGuard = null;
  clock.subscribe(() => {
    if (clock.demoDay() && !demoGuard) demoGuard = setInterval(() => endStaleDemo(0), DEMO_GUARD_MS);
    else if (!clock.demoDay() && demoGuard) {
      clearInterval(demoGuard);
      demoGuard = null;
    }
  });
  const you = mountYou(phone, store, {
    demo: clock,
    where,
    getKey: () => storage.getItem("mat.key"),
    // A computer's window shows Days and Money side by side (Before takes the Days pane while it is the tab).
    screen: () => (tabs.tab() === "before" ? "Before we go" : isWide() ? "Days and Money" : tabs.tab() === "days" ? "Days" : "Money"),
    // Try another day: Days follows the demo clock from the picked day's
    // 07:00. Nothing is stored, so a reload ends it.
    onDemo: (date) => {
      you.close(false);
      register.close();
      borrowed = false;
      closeDaySheets();
      tabs.showTab("days", false);
      demoOn = realToday();
      clock.start(date);
      // The clock's own change already jumped the rail; this is for picking
      // the day that is already running, which changes nothing it can see.
      days.goDay(Math.max(0, (store.state.days || []).findIndex((d) => d && d.date === date)));
    },
    onHistory: () => {
      you.close(false);
      history.open();
    },
    onCompass: () => {
      you.close(false);
      register.close();
      line.close(false);
      history.close(false);
      closeDaySheets();
      compass.open(null, { back: document.getElementById("youBtn") });
    },
    // Forget this phone: the trip, the key and every setting, the offline
    // copy and the worker, then the no-key screen.
    onForget: async () => {
      keyHere = null;
      let session = null;
      try {
        session = window.sessionStorage;
      } catch {
        session = null;
      }
      await forgetPhone({
        storages: [raw, session].filter(Boolean),
        indexedDB: globalThis.indexedDB || null,
        caches: globalThis.caches || null,
        serviceWorker: (navigator && navigator.serviceWorker) || null,
      });
      store.forgot();
      you.close(false);
    },
  });
  const line = mountLine(phone, store, {
    onEdit: (id) => {
      line.close(false);
      register.edit(id);
    },
  });
  const ring = (day) => {
    if (!(store.state.trip && store.state.trip.start)) return;
    line.close(false);
    history.close(false);
    you.close(false);
    closeDaySheets();
    if (tabs.tab() === "days") {
      borrowed = true;
      tabs.showTab("money", false);
    }
    register.open(day);
  };
  // Opening a Days sheet closes the register, the line sheet, History,
  // Settings and the other Days sheets.
  const closeForDays = () => {
    register.close();
    line.close(false);
    history.close(false);
    you.close(false);
    closeDaySheets();
  };
  // "Before we go": the bookings and prep from the planner, on its own tab.
  // The tab is in the bar only while the list says so; if it goes while it is
  // showing, the person lands on Days.
  const beforeBtn = document.getElementById("beforeBtn");
  const beforeN = document.getElementById("beforeN");
  const pillRoll = rollingCount(beforeN); // a change after the count has settled rolls in
  const todos = mountTodos(document.getElementById("vBefore"), store, {
    clock,
    onState: ({ show, open }) => {
      // A hidden button cannot keep focus: if it has it, Days takes it.
      const hadFocus = !show && document.activeElement === beforeBtn;
      beforeBtn.hidden = !show;
      // Five keys: Ring up is the middle one (before Money). Four: it is last. The DOM order is the visual and focus order.
      const ringBtn = document.getElementById("ring");
      const navEl = document.getElementById("nav");
      const moneyBtn = navEl.querySelector('button[data-tab="money"]');
      const wantBefore = show ? moneyBtn : null;
      if (ringBtn && moneyBtn && (show ? ringBtn.nextElementSibling !== moneyBtn : ringBtn.nextElementSibling !== null)) {
        const had = document.activeElement === ringBtn;
        navEl.insertBefore(ringBtn, wantBefore);
        if (had) ringBtn.focus({ preventScroll: true });
      }
      beforeN.hidden = !show || open < 1;
      beforeN.textContent = open > 0 ? String(open) : "";
      // A change while the app is open rolls the new number in; the first count shown, and loading, do not.
      if (show && open > 0) pillRoll.set(open);
      else pillRoll.reset();
      beforeBtn.setAttribute("aria-label", tabName(open));
      if (!show && tabs.tab() === "before") tabs.showTab("days", false);
      if (hadFocus) {
        // The Days key, or in WIDE (where it is hidden) the rail's first key that shows.
        const keys = [...document.querySelectorAll("#nav button")];
        const daysBtn = document.querySelector('#nav button[data-tab="days"]');
        const to = daysBtn && daysBtn.getClientRects().length ? daysBtn : keys.find((k) => k.getClientRects().length);
        if (to) to.focus({ preventScroll: true });
      }
    },
  });
  // Showing the tab folds the done group and fetches quietly if the list is an hour old.
  tabs.onShown((t) => {
    if (t === "before") todos.shown();
  });
  const days = mountDays(document.getElementById("vDays"), store, {
    clock,
    where,
    storage: raw,
    onStay: (id) => {
      closeForDays();
      stayCard.open(id);
    },
    onAllDays: () => {
      closeForDays();
      allDays.open();
    },
    onStampBook: () => {
      closeForDays();
      book.open();
    },
    onAddStop: (date) => {
      closeForDays();
      stopSheet.add(date);
    },
    onStop: (id) => {
      closeForDays();
      stopSheet.edit(id);
    },
    // A stop being added or changed is being looked at: the rail stays put.
    held: () => stopSheet.isOpen(),
  });
  mountMoney(document.getElementById("vMoney"), store, {
    onRing: ring,
    onLine: (id) => {
      register.close();
      history.close(false);
      you.close(false);
      closeDaySheets();
      line.open(id);
    },
    onHistory: () => {
      register.close();
      line.close(false);
      you.close(false);
      closeDaySheets();
      history.open();
    },
  });
  mountUndoBar(phone, store);
  mountNet(phone, store);
  mountFirst(phone, store, {
    connected,
    storage,
    // A key pasted on the no-key screen: keep it and start, without a reload.
    onKey: (key) => {
      keyHere = key;
      try {
        raw.setItem("mat.key", key);
      } catch {
        // nowhere to keep it: it works for this visit only
      }
      store.boot();
    },
  });

  document.getElementById("ring").addEventListener("click", () => {
    if (store.state.trip && store.state.trip.start) ring(defaultRingDay(store.state.trip, Date.now()));
  });
  // Click-through tests reach the register and the store here; only when the
  // fake backend is in the page, never in the real app.
  if (typeof globalThis.MAT_FAKE_API === "function") globalThis.__matTest = { store, register, clock };
  document.getElementById("youBtn").addEventListener("click", () => {
    register.close();
    line.close(false);
    history.close(false);
    closeDaySheets();
    you.open();
  });

  // Staying in step with the other phones: ask whether anything changed
  // every 20 seconds while the app is on screen, at once when it comes back
  // on screen, and when signal returns (after sending what was waiting).
  // One check at a time: on weak signal a slow check is not joined by more.
  let checking = null;
  let inFlight = null;
  const check = () => {
    if (inFlight) return inFlight;
    const st = store.state.status;
    if (st !== "ready" && st !== "error") return Promise.resolve();
    inFlight = store.checkRev().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
  // Each look also asks for the planner's payments, at most every 10 minutes (store.autoPayments).
  const look = () => {
    check();
    store.autoPayments();
  };
  const startChecking = () => {
    if (connected && !checking) checking = setInterval(look, CHECK_MS);
  };
  const stopChecking = () => {
    clearInterval(checking);
    checking = null;
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      store.markSeen();
      stopChecking();
    } else {
      look();
      startChecking();
    }
  });
  window.addEventListener("online", () => {
    if (!connected) return;
    store.flush().then(check);
  });

  // Once started, the list is fetched if it is an hour old.
  if (connected) store.boot({ candidate: taken.candidate }).then(() => {
    todos.wake();
    store.autoPayments();
    // History is fetched quietly, so it opens at once (it then keeps itself up to date).
    if (store.state.status === "ready") store.loadHistory();
  });
  // A new release reloads the page only when nothing would be lost (js/update.js).
  // Nothing unsent or still sending, and no notice waiting to be read (it would be wiped).
  nothingUnsent = () => store.outbox().unsent === 0 && !store.busy() && !store.state.notice;
  if (document.visibilityState !== "hidden") startChecking();
}

// The offline shell (sw.js). Quietly does nothing where service workers are
// missing or blocked. A new worker takes over at once and tells this page,
// which reloads itself once nothing would be lost (someone may be mid-entry).
// An app on the Home Screen often comes back without loading again, so the
// worker is also asked to look for a new version whenever the app comes back
// on screen. Registered before start(), so a broken start still gets fixed.
// A new release loads on its own (js/update.js). Safe to reload: no sheet,
// register or History open, nothing being typed, nothing still to send.
let nothingUnsent = () => true;
function safeToReload() {
  const phone = document.getElementById("phone");
  if (!phone || /(^|\s)[a-z]+-open(\s|$)/.test(phone.className)) return false;
  const at = document.activeElement;
  if (at && /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName)) return false;
  return nothingUnsent();
}
let sessionStore = null;
try {
  sessionStore = window.sessionStorage;
} catch {
  sessionStore = null;
}
const updater = createUpdater({
  isSafe: safeToReload,
  reload: () => location.reload(),
  storage: { getItem: (k) => (sessionStore ? sessionStore.getItem(k) : null), setItem: (k, v) => { if (sessionStore) sessionStore.setItem(k, v); } },
});
// How often an open app asks whether a new release is out.
const UPDATE_LOOK_MS = 10 * 60 * 1000;

// A second way to find a new release, independent of the worker (which may be
// stopped before it can say so, leaving a page on the old version until the
// next launch): the page reads js/config.js itself. Only when the app comes
// back on screen and at most every UPDATE_LOOK_MS. The address carries a
// query, so the offline worker does not answer it from its kept copy and the
// network is asked; no-store, so the browser's own copy is not used either.
// A failed answer is tried again at the next return; an odd one (a captive
// page) does nothing.
//
// A different APP_VERSION on the server is not yet a reason to reload: a
// reload is answered from the worker's kept copy, and until the worker has
// fetched the release that copy is still this version (the reload would land
// where it started, and the real one would follow a minute later). So the
// page then reads js/config.js once more WITHOUT the query, which is what a
// reload would get. Only when that is another version too does it go to the
// updater (which waits until nothing would be lost and never reloads twice
// within a minute). Otherwise the worker, asked to look in the same return to
// the screen, says so itself when it has taken over.
let lastLook = 0;
function lookForRelease() {
  const now = Date.now();
  if (now - lastLook < UPDATE_LOOK_MS) return;
  const before = lastLook;
  lastLook = now;
  const config = new URL("./config.js", import.meta.url).href;
  const read = (url, cache) =>
    Promise.resolve(fetch(url, { cache })).then((r) => (r && r.ok ? r.text() : Promise.reject(new Error("no answer"))));
  try {
    read(config + "?look=" + now, "no-store")
      .then((text) => {
        if (otherVersionIn(APP_VERSION, text) === null) return null;
        return read(config, "no-cache").then((kept) => {
          if (otherVersionIn(APP_VERSION, kept) !== null) updater.newVersion();
        });
      })
      .catch(() => {
        lastLook = before;
      });
  } catch {
    lastLook = before;
  }
}

// The worker's registration, once there is one (see registerWorker).
let registration = null;
function updateWorker() {
  if (!registration || typeof registration.update !== "function") return;
  try {
    Promise.resolve(registration.update()).catch(() => {});
  } catch {
    // nothing to do: the next look asks again
  }
}

// One listener for the app coming back on screen: a new version that was
// waiting for a safe moment is tried again, and a new release is looked for,
// by the worker and by the page.
function watchForRelease() {
  document.addEventListener("visibilitychange", () => {
    updater.check();
    if (document.visibilityState === "hidden") return;
    lookForRelease();
    updateWorker();
  });
}

function registerWorker() {
  try {
    if (!("serviceWorker" in navigator)) return;
    // The worker says a new version has taken over: answer (so it leaves the
    // reloading to this page) and reload when safe.
    navigator.serviceWorker.addEventListener("message", (ev) => {
      if (!ev.data || ev.data.type !== "mat-new-version") return;
      try {
        if (ev.ports && ev.ports[0]) ev.ports[0].postMessage("ok");
      } catch {
        // the worker reloads the page itself
      }
      updater.newVersion();
    });
    Promise.resolve(navigator.serviceWorker.register("sw.js"))
      .then((r) => {
        registration = r || null;
        setInterval(() => {
          if (document.visibilityState !== "hidden") updateWorker();
        }, UPDATE_LOOK_MS);
      })
      .catch(() => {});
  } catch {
    // not allowed here
  }
}

watchForRelease();
registerWorker();
start();
