/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The real ticket on a stop, the part with no screen: the limits, what a
// picked file is, shrinking a picture before it is sent, turning a PDF into
// pictures of its pages, the pictures kept on this phone (IndexedDB), and
// fetching the ones this phone does not have yet.
//
// - LIMITS: the backend's own (backend/Pure.js TICKET_LIMITS; a test holds
//   them equal). Both sides check them.
// - sniff(blob): "image/jpeg", "image/png", "application/pdf" or null, from
//   the first bytes only, never the file's name or the type the phone says.
//   An SVG is null: it can carry script, so it is never a ticket.
// - shrink(file) -> { mime, w, h, data, blob }: drawn on a canvas at most
//   LIMITS.maxSide on its longer side (never larger than it was), as JPEG at
//   0.9 (a PNG stays PNG only when that is smaller); when that is still over
//   LIMITS.maxChars, lower quality, then smaller, until it fits. data is
//   base64 (no "data:" head); blob the same bytes.
// - pdfPages(file, { max, each, skipFirst }) -> { pages, total, drawn }: the first `max`
//   pages drawn white-backed at about LIMITS.maxSide, one at a time; with
//   skipFirst, drawing starts at page two and i remains the original zero-based index.
//   With each(canvas, i) every drawn page is handed over and its canvas let go (pages is
//   then empty); total is how many the PDF has. pdf.js (vendor/pdfjs, Apache-2.0, 4.10.38, its LICENSE beside it)
//   is loaded only now, the first time a PDF is picked, and is not in the
//   offline shell: attaching needs signal anyway. shrinkCanvas(canvas) then
//   encodes a page as shrink does.
// - createKeep({ indexedDB }) -> the keep: database "mat-tickets", id ->
//   { type, bytes }. have(id) (at once, from what was kept), get(id) -> Blob
//   or null, put(id, blob) -> true when kept, drop(id), subscribe(fn), wipe() (everything off, database deleted, not opened again),
//   restart() (open again, for a new link).
//   lasting is false when there is no IndexedDB (a private window, blocked):
//   pictures are then kept in memory for this visit only. Nothing throws.
// - fetchMissing(store, keep): fetches, one at a time, every picture this
//   phone lacks, upcoming stops first (soonest first), then past ones; never
//   two requests at once (a second call joins the first), never while the
//   store is saving, never without signal (and stops when it goes), never
//   before migrate, and not at all when nothing lasts (the stub fetches the
//   one it shows instead). Bytes that are not what their type says are not kept.
// - ticketKinds / ticketMark: what a stop's tickets are ("pp" per-person
//   codes, "one" code for everyone, "pages", "ref" facts only) and whether
//   every picture is on this phone. stayMark: the same for a stay's booking
//   ("pics" or "ref"; a picture on a stay has `stay` instead of `stop`).

import { tripNow } from "./plan.js";

export const LIMITS = { maxSide: 1500, maxChars: 450000, perStop: 8, perTrip: 120, chunk: 45000, fact: 60 };
export const NOT_A_TICKET = "Only a photo, a screenshot or a PDF can be a ticket.";
export const TOO_BIG = "That picture is too big even made smaller. Try a screenshot of just the code.";
export const LOST = "A ticket picture was lost on this phone before it was sent. Add it again.";

const SIGS = { "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] };
const PDF_SIG = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const starts = (head, sig) => sig.every((b, i) => head[i] === b);

export async function sniff(blob) {
  let head;
  try {
    head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  } catch {
    return null;
  }
  if (starts(head, SIGS["image/jpeg"])) return "image/jpeg";
  if (starts(head, SIGS["image/png"])) return "image/png";
  if (starts(head, PDF_SIG)) return "application/pdf";
  return null;
}

// ---------- base64 ----------

export async function toBase64(blob) {
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

// A Blob of these bytes, when they are well-formed base64 of a JPEG or PNG that is the given type; else null.
export function fromBase64(data, mime) {
  if (typeof data !== "string" || data.length % 4 !== 0 || !B64.test(data) || !SIGS[mime]) return null;
  let raw;
  try {
    raw = atob(data);
  } catch {
    return null;
  }
  const b = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i);
  if (!starts(b, SIGS[mime])) return null;
  return new Blob([b], { type: mime });
}

// ---------- shrinking ----------

async function decodeInBrowser(blob) {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    return { width: bmp.width, height: bmp.height, source: bmp, close: () => bmp.close && bmp.close() };
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight, source: img, close: () => {} };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

const browser = {
  decode: decodeInBrowser,
  makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  },
  encode: (canvas, mime, q) =>
    new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(NOT_A_TICKET))), mime, q)),
};

async function encodeSource(source, width, height, tryPng, deps) {
  if (!(width > 0 && height > 0)) throw new Error(NOT_A_TICKET);
  let scale = Math.min(1, LIMITS.maxSide / Math.max(width, height));
  let q = 0.9;
  for (let i = 0; i < 12; i++) {
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = deps.makeCanvas(w, h);
    const ctx = canvas.getContext("2d");
    // A JPEG has no see-through parts: what was see-through is paper-white, not black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    let blob = await deps.encode(canvas, "image/jpeg", q);
    if (tryPng) {
      const png = await deps.encode(canvas, "image/png");
      if (png.size < blob.size) blob = png;
    }
    // This try's canvas is done with: let its memory go (minor 3).
    canvas.width = 0;
    canvas.height = 0;
    // What the canvas really made (a phone that cannot make a JPEG makes a PNG).
    const mime = await sniff(blob);
    if (mime !== "image/jpeg" && mime !== "image/png") throw new Error(NOT_A_TICKET);
    if (4 * Math.ceil(blob.size / 3) <= LIMITS.maxChars) return { mime, w, h, data: await toBase64(blob), blob };
    if (q > 0.65) q = Math.round((q - 0.1) * 10) / 10;
    else scale *= 0.8;
    if (Math.max(width, height) * scale < 300) break;
  }
  throw new Error(TOO_BIG);
}

export async function shrink(file, deps = browser) {
  const type = await sniff(file);
  if (type !== "image/jpeg" && type !== "image/png") throw new Error(NOT_A_TICKET);
  const img = await deps.decode(file);
  try {
    return await encodeSource(img.source, img.width, img.height, type === "image/png", deps);
  } finally {
    if (img.close) img.close();
  }
}

export function shrinkCanvas(canvas, deps = browser) {
  return encodeSource(canvas, canvas.width, canvas.height, false, deps);
}

// ---------- a PDF's pages ----------

let pdfLib = null;
function loadPdf() {
  if (!pdfLib) {
    const base = new URL("../vendor/pdfjs/", import.meta.url);
    pdfLib = import(new URL("pdf.min.mjs", base).href).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.mjs", base).href;
      return lib;
    });
    pdfLib.catch(() => {
      pdfLib = null;
    });
  }
  return pdfLib;
}

export async function pdfPages(file, { max = LIMITS.perStop, skipFirst = false, each = null } = {}) {
  const lib = await loadPdf();
  const data = new Uint8Array(await file.arrayBuffer());
  // No eval, no scripting, no forms: the PDF is only drawn.
  const doc = await lib.getDocument({ data, isEvalSupported: false, enableXfa: false, stopAtErrors: false, verbosity: lib.VerbosityLevel ? lib.VerbosityLevel.ERRORS : 0 }).promise;
  try {
    const total = doc.numPages;
    const pages = [];
    // One page at a time (minor 3): drawn, handed to each(canvas, index) to be
    // shrunk, then its canvas let go, so 8 pages never sit in memory at once.
    const last = Math.min(total, Math.max(0, max));
    const first = skipFirst ? 2 : 1;
    for (let i = first; i <= last; i++) {
      const page = await doc.getPage(i);
      const one = page.getViewport({ scale: 1 });
      const scale = Math.min(4, LIMITS.maxSide / Math.max(one.width, one.height));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      if (each) {
        try {
          await each(canvas, i - 1);
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      } else pages.push(canvas);
    }
    return { pages, total, drawn: Math.max(0, last - first + 1) };
  } finally {
    doc.destroy();
  }
}

// ---------- the keep ----------

export const OPEN_WAIT_MS = 3000;

// A picture that waits for signal is only on the phone once its keep.put has
// finished: until then its data is in memory, and closing MAT (or a reload)
// loses it. So an add waits for the puts of its waiting pictures (`puts`,
// the promises keep.put returned), at most `ms`: a keep that never answers
// must not hold the add up for long. True only when every put kept its
// picture, in time, in a keep that lasts (IndexedDB, not the memory keep);
// false and the add says to keep MAT open instead of "on this phone".
export function keptOrLate(keep, puts, ms = OPEN_WAIT_MS) {
  if (!puts.length) return Promise.resolve(true);
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const kept = Promise.all(puts.map((p) => Promise.resolve(p).catch(() => false))).then((all) => all.every((ok) => ok === true) && keep.lasting === true);
  return Promise.race([kept, late]).finally(() => clearTimeout(timer));
}

export function createKeep({ indexedDB = globalThis.indexedDB, name = "mat-tickets", openWaitMs = OPEN_WAIT_MS } = {}) {
  const STORE = "pics";
  const known = new Set();
  const mem = new Map();
  const subs = new Set();
  let db = null;
  let lasting = false;
  // Set by a wipe (a refused key, Forget this phone): the database is not
  // opened again until restart() (a new link), so a Forget never leaves an
  // empty database open behind its own delete.
  let wiped = false;
  // One per wipe: a put begun before a wipe never lands after it.
  let gen = 0;
  const tell = () => {
    for (const fn of [...subs]) {
      try {
        fn();
      } catch {
        // one view's trouble
      }
    }
  };
  // One request in its own transaction; for a write, done when the transaction is.
  const run = (mode, fn) =>
    new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(STORE, mode);
      } catch (e) {
        reject(e);
        return;
      }
      let result;
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => {
        result = req.result;
        if (mode === "readonly") resolve(result);
      };
      req.onerror = () => reject(req.error || new Error("IndexedDB"));
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB"));
    });
  // Opens the database; one that never answers (a known WebKit fault) is
  // given up on after openWaitMs and the pictures are kept in memory instead.
  function open() {
    const mine = gen;
    return (async () => {
      if (wiped || !indexedDB || typeof indexedDB.open !== "function") return;
      try {
        const opened = await new Promise((resolve, reject) => {
          let r;
          const timer = setTimeout(() => reject(new Error("IndexedDB did not answer")), openWaitMs);
          const done = (f) => (v) => {
            clearTimeout(timer);
            f(v);
          };
          try {
            r = indexedDB.open(name, 1);
          } catch (e) {
            done(reject)(e);
            return;
          }
          r.onupgradeneeded = () => {
            const d = r.result;
            if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
          };
          r.onsuccess = () => {
            // Answered after the wait was over: close it, the memory keep is in use.
            if (r.result && late) {
              try { r.result.close(); } catch { /* nothing */ }
              return;
            }
            done(resolve)(r.result);
          };
          r.onerror = done(() => reject(r.error || new Error("IndexedDB")));
          r.onblocked = done(() => reject(new Error("IndexedDB blocked")));
          let late = false;
          setTimeout(() => { late = true; }, openWaitMs);
        });
        if (mine !== gen) {
          try { opened.close(); } catch { /* nothing */ }
          return;
        }
        // Another tab or a deletion wants the database: let go of it at once.
        opened.onversionchange = () => {
          try { opened.close(); } catch { /* nothing */ }
          if (db === opened) {
            db = null;
            lasting = false;
          }
        };
        db = opened;
        const keys = await run("readonly", (st) => st.getAllKeys());
        if (mine !== gen) return;
        for (const k of keys || []) known.add(String(k));
        lasting = true;
        // Views drawn before this (the 券 boxes) look again.
        if (known.size) tell();
      } catch {
        db = null;
        lasting = false;
      }
    })();
  }
  let ready = open();

  return {
    get ready() {
      return ready;
    },
    get lasting() {
      return lasting;
    },
    // The wipe number now: pass it to put so a picture begun before a wipe is not kept after it.
    get gen() {
      return gen;
    },
    have: (id) => known.has(id) || mem.has(id),
    async get(id) {
      await ready;
      if (mem.has(id)) return mem.get(id);
      if (!db) return null;
      try {
        const v = await run("readonly", (st) => st.get(id));
        if (v && v.bytes && typeof v.type === "string") return new Blob([v.bytes], { type: v.type });
      } catch {
        // evicted or broken: as if it was never kept
      }
      if (known.delete(id)) tell();
      return null;
    },
    async put(id, blob, { gen: at = gen } = {}) {
      if (at !== gen) return false;
      await ready;
      if (at !== gen) return false;
      if (!db) {
        mem.set(id, blob);
        tell();
        return true;
      }
      try {
        const bytes = await blob.arrayBuffer();
        if (at !== gen || !db) return false;
        await run("readwrite", (st) => st.put({ type: blob.type, bytes }, id));
        if (at !== gen) return false;
        known.add(id);
        tell();
        return true;
      } catch {
        return false;
      }
    },
    async drop(id) {
      await ready;
      const had = mem.delete(id) || known.delete(id);
      if (db) {
        try {
          await run("readwrite", (st) => st.delete(id));
        } catch {
          // nothing to do
        }
      }
      if (had) tell();
    },
    // What is kept (ids).
    ids: () => [...new Set([...known, ...mem.keys()])],
    // Every picture off this phone (a refused key, Forget this phone): the
    // database deleted, memory emptied, and anything still on its way
    // refused. The database is not opened again here: restart() does that
    // for a new link.
    async wipe() {
      gen++;
      wiped = true;
      known.clear();
      mem.clear();
      lasting = false;
      const was = db;
      db = null;
      if (was) {
        try { was.close(); } catch { /* nothing */ }
      }
      tell();
      if (indexedDB && typeof indexedDB.deleteDatabase === "function") {
        await new Promise((done) => {
          let req;
          const t = setTimeout(done, openWaitMs);
          try {
            req = indexedDB.deleteDatabase(name);
          } catch {
            clearTimeout(t);
            done();
            return;
          }
          req.onsuccess = req.onerror = req.onblocked = () => {
            clearTimeout(t);
            done();
          };
        });
      }
    },
    // A new link after a wipe: the keep opens its database again, empty.
    restart() {
      if (!wiped) return ready;
      wiped = false;
      ready = open();
      return ready;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

// ---------- the You setting: which pictures this phone fetches ----------
// "all" (the default): every picture, in the background, whenever the app is
// open with signal. "open": only a picture being shown (the stub fetches its
// own). Kept in mat.tixFetch; anything else there reads as the default.
const FETCH_KEY = "mat.tixFetch";
const local = (storage) => storage || globalThis.localStorage || null;
export function fetchMode(storage) {
  try {
    const s = local(storage);
    return s && s.getItem(FETCH_KEY) === "open" ? "open" : "all";
  } catch {
    return "all";
  }
}
export function setFetchMode(mode, storage) {
  try {
    const s = local(storage);
    if (s) s.setItem(FETCH_KEY, mode === "open" ? "open" : "all");
  } catch {
    // private mode or full: it lasts this visit only (the default comes back)
  }
}
export const fetchesAll = (storage) => fetchMode(storage) === "all";

// ---------- fetching what this phone lacks ----------

const live = (t) => t && typeof t.id === "string" && t.id && !t.gone;

const nextDay = (date) => {
  const [y, m, d] = String(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

// The live pictures in the order they are fetched: the pictures of the stay
// you are in first of all (from its first night to the morning after its
// last), then upcoming stops and stays (soonest first; a stay's at its first
// night, 15:00), then past ones (most recent first); none whose stop or stay
// is removed or not on the plan.
export function fetchOrder(s, nowMs) {
  // Today by the Days clock (a day in its own zone is that place's).
  const today = tripNow(s, nowMs).date;
  const stops = new Map((Array.isArray(s.stops) ? s.stops : []).filter((x) => x && !x.deleted).map((x) => [x.id, x]));
  const stays = new Map((Array.isArray(s.stays) ? s.stays : []).filter((x) => x && !x.deleted && /^\d{4}-\d{2}-\d{2}$/.test(String(x.firstNight || ""))).map((x) => [x.id, x]));
  const when = (t) => {
    if (t.stay) {
      const sy = stays.get(t.stay);
      return sy ? sy.firstNight + " 15:00" : null;
    }
    const st = stops.get(t.stop);
    return st ? String(st.date || "") + " " + (st.time || "99:99") : null;
  };
  // The stay you are in: from its first night to the morning after its last.
  const inNow = (t) => {
    const sy = t.stay ? stays.get(t.stay) : null;
    return !!sy && sy.firstNight <= today && today <= nextDay(sy.lastNight || sy.firstNight);
  };
  const list = (Array.isArray(s.tickets) ? s.tickets : []).filter((t) => live(t) && !t.pending && !t.failed);
  const first = [];
  const ahead = [];
  const past = [];
  for (const t of list) {
    const w = when(t);
    // A picture whose stop or stay is removed or not on the plan is never fetched (minor 6).
    if (w === null) continue;
    else if (inNow(t)) first.push([w, t]);
    else if (w.slice(0, 10) >= today) ahead.push([w, t]);
    else past.push([w, t]);
  }
  const up = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  first.sort(up);
  ahead.sort(up);
  past.sort((a, b) => (a[0] > b[0] ? -1 : a[0] < b[0] ? 1 : 0));
  return [...first.map((x) => x[1]), ...ahead.map((x) => x[1]), ...past.map((x) => x[1])];
}

// After a load: pictures the trip no longer has (removed, refused, on a stop
// gone from the plan) come off this phone (minor 4). Never before migrate,
// and never one still on the screen (this phone's own, waiting to be sent).
export async function pruneKeep(store, keep) {
  const s = store.state;
  if (!s.ticketsReady || !Array.isArray(s.tickets)) return;
  const shown = new Set(s.tickets.filter(live).map((t) => t.id));
  for (const id of keep.ids()) if (!shown.has(id)) await keep.drop(id);
}

const running = new WeakMap();
// A picture the backend refused or sent back broken is not asked for again for this long.
export const RETRY_MS = 10 * 60 * 1000;
const failures = new WeakMap(); // store -> Map(id -> when it failed)

// allowed(): asked at the top of every picture, so a change of the You setting
// stops a pass at the next one.
export function fetchMissing(store, keep, { now = () => Date.now(), allowed = () => true } = {}) {
  const cur = running.get(store);
  if (cur) return cur;
  if (!failures.has(store)) failures.set(store, new Map());
  const failed = failures.get(store);
  const p = (async () => {
    await keep.ready;
    if (!keep.lasting) return;
    // A wipe (a refused key, Forget this phone) while this runs: nothing it fetched is kept.
    const at = keep.gen;
    const tried = new Set();
    for (;;) {
      const s = store.state;
      if (!allowed() || !s.ticketsReady || s.online === false || store.busy()) return;
      const t0 = now();
      const next = fetchOrder(s, t0).find((t) => !keep.have(t.id) && !tried.has(t.id) && !(failed.has(t.id) && t0 - failed.get(t.id) < RETRY_MS));
      if (!next) return;
      tried.add(next.id);
      let got;
      try {
        got = await store.fetchTicket(next.id);
      } catch (err) {
        if (err && err.code === "network") return;
        failed.set(next.id, now()); // refused (removed meanwhile): the next one
        continue;
      }
      const blob = got && got.id === next.id && got.mime === next.mime ? fromBase64(got.data, got.mime) : null;
      if (!blob) {
        failed.set(next.id, now());
        continue;
      }
      if (at !== keep.gen) return;
      if (!(await keep.put(next.id, blob, { gen: at }))) {
        // The phone is full: this one backs off like a broken one (fix round 1, I2),
        // or every redraw would fetch it again.
        failed.set(next.id, now());
        return;
      }
    }
  })().finally(() => running.delete(store));
  running.set(store, p);
  return p;
}

// ---------- what a stop's tickets are ----------

export function ticketKinds(list) {
  const mine = (Array.isArray(list) ? list : []).filter(live);
  if (!mine.length) return { kind: null, list: mine };
  const people = new Set(mine.filter((t) => t.who).map((t) => t.who));
  if (people.size) return { kind: "pp", label: people.size === 1 ? "1 code" : people.size + " codes", list: mine };
  if (mine.length === 1) return { kind: "one", label: "1 code", list: mine };
  return { kind: "pages", label: mine.length + " pages", list: mine };
}

export const hasFacts = (stop) => !!stop && ["tkRef", "tkName", "tkPeople", "tkSeat"].some((k) => typeof stop[k] === "string" && stop[k].trim() !== "");

// The 券 mark for a stop: null (no ticket at all), or { kind, label, saved }.
export function ticketMark(stop, tickets, have) {
  if (!stop) return null;
  const k = ticketKinds((Array.isArray(tickets) ? tickets : []).filter((t) => t && t.stop === stop.id));
  if (!k.kind) return hasFacts(stop) ? { kind: "ref", label: "Reference", saved: true } : null;
  return { kind: k.kind, label: k.label, saved: k.list.every((t) => have(t.id)) };
}

// ---------- a stay's booking (S2 鍵札) ----------

export const STAY_FACTS = ["tkRef", "tkName", "tkPeople", "tkRoom"];
export const hasStayFacts = (stay) => !!stay && STAY_FACTS.some((k) => typeof stay[k] === "string" && stay[k].trim() !== "");

// A stay's live pictures, in order of person then page.
export function stayPictures(stay, tickets) {
  if (!stay) return [];
  return (Array.isArray(tickets) ? tickets : [])
    .filter((t) => live(t) && t.stay === stay.id)
    .sort((a, b) => String(a.who || "").localeCompare(String(b.who || "")) || (Number(a.page) || 0) - (Number(b.page) || 0));
}

// The key tag's mark for a stay: null (no booking at all), or { kind, label,
// saved }: "pics" ("1 page", "N pages"; saved when every one is on this
// phone) or "ref" (the facts alone).
export function stayMark(stay, tickets, have) {
  if (!stay) return null;
  const pics = stayPictures(stay, tickets);
  if (!pics.length) return hasStayFacts(stay) ? { kind: "ref", label: "Reference", saved: true } : null;
  return { kind: "pics", label: pics.length === 1 ? "1 page" : pics.length + " pages", saved: pics.every((t) => have(t.id)) };
}
