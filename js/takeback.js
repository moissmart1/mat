/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// "Take all back" (bulk C): the small runner both screens use (the added
// screen of js/views/bulkadd.js and the History tape, js/views/history.js).
// The record is js/bulkbatch.js; this does it, one step at a time, each
// waited for, with what the store already offers:
//   1. the batch's pictures still on the trip: store.removeTicket (quiet),
//      each outcome waited for (one never sent is simply taken back);
//   2. the old pictures it took off: their own History line undone
//      (store.loadHistory, then store.undoEntry), one at a time;
//   3. the stops it added that now hold nothing and are as it left them:
//      store.deleteStop, then store.idle(). A stay it added is left on.
//
// createTakeBack(store, { storage, now }) -> { list(), record(fields),
// running(at), run(at) -> Promise<sentence>, subscribe(fn) }.
// Only this phone has its batches (ids, counts and times only). A wipe
// (Forget this phone, a refused key) empties the memory; storage was
// cleared with every other mat.* key.

import { batchOf, addBatch, loadBatches, saveBatches, planOf, stopFree, resultText, NO_SIGNAL } from "./bulkbatch.js";

export function createTakeBack(store, { storage = null, now = () => Date.now() } = {}) {
  const st = () => {
    try {
      return storage || globalThis.localStorage || null;
    } catch {
      return null;
    }
  };
  let batches = loadBatches(st());
  const busy = new Set();
  const subs = new Set();
  const emit = () => {
    for (const fn of subs) fn();
  };
  let wiped = false;
  store.subscribe(() => {
    if (store.state.status === "nokey") {
      if (!wiped) {
        wiped = true;
        batches = [];
        busy.clear();
        emit();
      }
      return;
    }
    wiped = false;
  });

  function record(fields) {
    const b = batchOf(fields);
    if (!b.at || (!b.n && !b.off)) return null;
    batches = addBatch(batches, b);
    saveBatches(st(), batches);
    emit();
    return b;
  }

  // Waits for a quiet write's outcome, or for the store to say it is unsure.
  async function settle(start) {
    let unsure = null;
    const noReply = new Promise((resolve) => {
      unsure = resolve;
    });
    const token = start(() => unsure({ saved: false, reason: "unsure" }));
    if (!token) return null;
    return Promise.race([store.outcome(token), noReply]);
  }
  const ticketOn = (id) => (store.state.tickets || []).some((t) => t && t.id === id && !t.gone);

  async function run(at) {
    const b = batches.find((x) => x.at === at);
    if (!b || b.back || busy.has(at)) return "";
    const unsent = new Set(b.tickets.filter((id) => typeof store.unsaved === "function" && store.unsaved(id)));
    const plan = planOf(b, store.state, { unsent });
    if (plan.blocked) {
      store.notify(NO_SIGNAL);
      return NO_SIGNAL;
    }
    busy.add(at);
    emit();
    try {
      // 1. The pictures it added, each waited for.
      for (const id of plan.remove) {
        if (store.state.status === "nokey") return "";
        await settle((onUnsure) => store.removeTicket(id, { quiet: true, onUnsure }));
      }
      const back = b.tickets.filter((id) => !ticketOn(id)).length;
      // 2. The old pictures it took off: each one's own History line, undone.
      let put = 0;
      if (plan.putBack.length) {
        await store.loadHistory();
        for (const id of plan.putBack) {
          if (store.state.status === "nokey") return "";
          const entry = (store.state.history.entries || []).find((e) => e && e.kind === "ticket" && e.ref === id && e.action === "remove" && e.canUndo && !e.undoneBy);
          if (!entry) continue; // changed since: it has its own line in History
          let ok = false;
          try {
            ok = await store.undoEntry(entry.id);
          } catch {
            ok = false;
          }
          if (ok) put += 1;
        }
      }
      // 3. The stops it added that hold nothing now and are as it left them.
      for (const id of b.stops) {
        if (store.state.status === "nokey") return "";
        if (!stopFree(id, b, store.state)) continue;
        store.deleteStop(id);
        await store.idle();
      }
      const stays = b.stays.filter((id) => (store.state.stays || []).some((x) => x && x.id === id && !x.deleted)).length;
      const text = resultText({ total: b.tickets.length, back, put, removed: b.removed.length, stays });
      const iso = new Date(now()).toISOString();
      batches = batches.map((x) => (x.at === at ? { ...x, back: iso } : x));
      saveBatches(st(), batches);
      store.notify(text);
      return text;
    } finally {
      busy.delete(at);
      emit();
    }
  }

  return {
    list: () => batches.slice(),
    find: (at) => batches.find((x) => x.at === at) || null,
    record,
    running: (at) => busy.has(at),
    run,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
