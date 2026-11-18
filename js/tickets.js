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
// - pdfPages(file, { max }) -> { pages: [canvas], total }: the first `max`
//   pages drawn white-backed at about LIMITS.maxSide; total is how many the
//   PDF has. pdf.js (vendor/pdfjs, Apache-2.0, 4.10.38, its LICENSE beside it)
//   is loaded only now, the first time a PDF is picked, and is not in the
//   offline shell: attaching needs signal anyway. shrinkCanvas(canvas) then
//   encodes a page as shrink does.
// - createKeep({ indexedDB }) -> the keep: database "mat-tickets", id ->
//   { type, bytes }. have(id) (at once, from what was kept), get(id) -> Blob
//   or null, put(id, blob) -> true when kept, drop(id), subscribe(fn).
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
//   every picture is on this phone.

import { dateIn } from "./time.js";

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

export async function pdfPages(file, { max = LIMITS.perStop } = {}) {
  const lib = await loadPdf();
  const data = new Uint8Array(await file.arrayBuffer());
  // No eval, no scripting, no forms: the PDF is only drawn.
  const doc = await lib.getDocument({ data, isEvalSupported: false, enableXfa: false, stopAtErrors: false, verbosity: lib.VerbosityLevel ? lib.VerbosityLevel.ERRORS : 0 }).promise;
  try {
    const total = doc.numPages;
    const pages = [];
    for (let i = 1; i <= Math.min(total, Math.max(0, max)); i++) {
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
      pages.push(canvas);
    }
    return { pages, total };
  } finally {
    doc.destroy();
  }
}

// ---------- the keep ----------

export const OPEN_WAIT_MS = 3000;

export function createKeep({ indexedDB = globalThis.indexedDB, name = "mat-tickets", openWaitMs = OPEN_WAIT_MS } = {}) {
  const STORE = "pics";
  const known = new Set();
  const mem = new Map();
  const subs = new Set();
  let db = null;
  let lasting = false;
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
      if (!indexedDB || typeof indexedDB.open !== "function") return;
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
    // refused. The keep then starts again, empty, for a new link.
    async wipe() {
      gen++;
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
      ready = open();
      await ready;
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

// The live pictures in the order they are fetched: upcoming stops first
// (soonest first), then past ones (most recent first), then any whose stop is
// not on the plan.
export function fetchOrder(s, nowMs) {
  const tz = (s.trip && s.trip.tz) || "Asia/Tokyo";
  const today = dateIn(tz, nowMs);
  const stops = new Map((Array.isArray(s.stops) ? s.stops : []).filter((x) => x && !x.deleted).map((x) => [x.id, x]));
  const when = (t) => {
    const st = stops.get(t.stop);
    return st ? String(st.date || "") + " " + (st.time || "99:99") : null;
  };
  const list = (Array.isArray(s.tickets) ? s.tickets : []).filter((t) => live(t) && !t.pending && !t.failed);
  const ahead = [];
  const past = [];
  const lost = [];
  for (const t of list) {
    const w = when(t);
    if (w === null) lost.push(t);
    else if (w.slice(0, 10) >= today) ahead.push([w, t]);
    else past.push([w, t]);
  }
  ahead.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  past.sort((a, b) => (a[0] > b[0] ? -1 : a[0] < b[0] ? 1 : 0));
  return [...ahead.map((x) => x[1]), ...past.map((x) => x[1]), ...lost];
}

const running = new WeakMap();
// A picture the backend refused or sent back broken is not asked for again for this long.
export const RETRY_MS = 10 * 60 * 1000;
const failures = new WeakMap(); // store -> Map(id -> when it failed)

export function fetchMissing(store, keep, { now = () => Date.now() } = {}) {
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
      if (!s.ticketsReady || s.online === false || store.busy()) return;
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
