/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// Taking the trip off this phone (security, 2026-11-18).
//
// clearTrip(storage, { queue }): removes every mat.* key from a storage
//   (localStorage, sessionStorage, or anything with length / key(i) /
//   removeItem): the saved trip (mat.cache, which holds the pictures too),
//   the key, who you are, the unsent queue and every small setting. queue,
//   when given, is written back as mat.queue afterwards (a refused key keeps
//   the person's own unsent lines). Never throws.
// forgetPhone({ storages, indexedDB, caches, serviceWorker, scope }): clearTrip
//   on each storage, then deletes only this app's own things: IndexedDB
//   databases named mat-* or mat.*, caches named mat-*, and the service
//   worker registrations whose scope is exactly `scope` (this app's base URL,
//   with the trailing slash). A sibling app on the same host (another path)
//   keeps its databases, caches and worker. No scope: no worker is touched.
//   Each step is best effort: resolves when all have been tried.

const PREFIX = "mat.";

function keysOf(storage) {
  const out = [];
  try {
    const n = storage.length;
    for (let i = 0; i < n; i++) {
      const k = storage.key(i);
      if (typeof k === "string") out.push(k);
    }
  } catch {
    // a storage that will not list its keys: nothing to remove
  }
  return out;
}

export function clearTrip(storage, { queue = null } = {}) {
  if (!storage) return;
  for (const k of keysOf(storage)) {
    if (!k.startsWith(PREFIX)) continue;
    try {
      storage.removeItem(k);
    } catch {
      // nothing more can be done for this one
    }
  }
  if (queue !== null) {
    try {
      storage.setItem("mat.queue", queue);
    } catch {
      // it could not be kept
    }
  }
}

const isOurs = (name) => typeof name === "string" && (name.startsWith("mat-") || name.startsWith("mat."));

export async function forgetPhone({ storages = [], indexedDB = null, caches = null, serviceWorker = null, scope = null } = {}) {
  for (const s of storages) clearTrip(s);
  const tries = [];
  try {
    if (indexedDB && typeof indexedDB.databases === "function") {
      const dbs = await indexedDB.databases();
      for (const db of dbs || []) if (db && isOurs(db.name)) tries.push(new Promise((done) => {
        const req = indexedDB.deleteDatabase(db.name);
        req.onsuccess = req.onerror = req.onblocked = () => done();
      }));
    }
  } catch {
    // no list of databases on this phone
  }
  try {
    if (caches && typeof caches.keys === "function") for (const name of await caches.keys()) if (name.startsWith("mat-")) tries.push(Promise.resolve(caches.delete(name)).catch(() => {}));
  } catch {
    // no caches here
  }
  try {
    if (serviceWorker && typeof serviceWorker.getRegistrations === "function") {
      for (const r of await serviceWorker.getRegistrations()) if (scope && r && r.scope === scope) tries.push(Promise.resolve(r.unregister()).catch(() => {}));
    }
  } catch {
    // no worker here
  }
  await Promise.all(tries);
}
