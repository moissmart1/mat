import test from "node:test";
import assert from "node:assert/strict";
import { forgetPhone, clearTrip } from "../js/forget.js";

const SCOPE = "https://host.test/mat/";

function stand() {
  const deleted = { dbs: [], caches: [], unregistered: [] };
  const indexedDB = {
    databases: async () => ["mat-tickets", "mat.extra", "chi-offline", "matter", "other"].map((name) => ({ name })),
    deleteDatabase(name) {
      deleted.dbs.push(name);
      const req = {};
      setTimeout(() => req.onsuccess && req.onsuccess(), 0);
      return req;
    },
  };
  const caches = {
    keys: async () => ["mat-shell-28", "mat-fonts", "chi-shell-3", "matrix", "other"],
    delete: async (n) => deleted.caches.push(n),
  };
  const reg = (scope) => ({ scope, unregister: async () => deleted.unregistered.push(scope) });
  const serviceWorker = {
    getRegistrations: async () => [reg(SCOPE), reg("https://host.test/chi/"), reg("https://host.test/"), reg("https://host.test/mat/sub/"), reg("https://other.test/mat/")],
  };
  return { deleted, indexedDB, caches, serviceWorker };
}

test("forgetPhone removes only this app's caches, databases and worker", async () => {
  const s = stand();
  await forgetPhone({ storages: [], indexedDB: s.indexedDB, caches: s.caches, serviceWorker: s.serviceWorker, scope: SCOPE });
  assert.deepEqual(s.deleted.caches.sort(), ["mat-fonts", "mat-shell-28"]);
  assert.deepEqual(s.deleted.dbs.sort(), ["mat-tickets", "mat.extra"]);
  assert.deepEqual(s.deleted.unregistered, [SCOPE]);
});

test("forgetPhone with no scope given unregisters no worker", async () => {
  const s = stand();
  await forgetPhone({ storages: [], serviceWorker: s.serviceWorker });
  assert.deepEqual(s.deleted.unregistered, []);
});

test("forgetPhone works on a phone without indexedDB.databases", async () => {
  const s = stand();
  await forgetPhone({ storages: [], indexedDB: { deleteDatabase: () => assert.fail("nothing to delete") }, caches: s.caches, serviceWorker: s.serviceWorker, scope: SCOPE });
  assert.deepEqual(s.deleted.caches.sort(), ["mat-fonts", "mat-shell-28"]);
  assert.deepEqual(s.deleted.unregistered, [SCOPE]);
});

test("Forget this phone and a refused key take mat.bulkBatch (Take all back's record) with the rest; a refused key keeps only the queue", async () => {
  const mem = () => {
    const m = new Map([["mat.bulkBatch", "[]"], ["mat.listSkip", "[]"], ["mat.key", "k"], ["mat.queue", "[1]"], ["other.app", "x"]]);
    return { m, get length() { return m.size; }, key: (i) => [...m.keys()][i], removeItem: (k) => m.delete(k), setItem: (k, v) => m.set(k, v), getItem: (k) => m.get(k) ?? null };
  };
  const forgot = mem();
  await forgetPhone({ storages: [forgot] });
  assert.deepEqual([...forgot.m.keys()], ["other.app"]);
  const refused = mem();
  clearTrip(refused, { queue: "[1]" });
  assert.deepEqual([...refused.m.keys()].sort(), ["mat.queue", "other.app"]);
});
