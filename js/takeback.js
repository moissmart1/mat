/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// "Take all back" (bulk C): the small runner both screens use (the added
// screen of js/views/bulkadd.js and the History tape, js/views/history.js).
// The record is js/bulkbatch.js; this does it, one step at a time, each
// waited for, with what the store already offers:
//   1. the batch's pictures still on the trip: store.removeTicket (quiet),
//      each outcome waited for (one never sent is simply taken back);
//   0. first, each old picture's own History line, looked up by its id
//      (store.historyFor); a lookup that fails stops the run before anything;
//   2. the old pictures it took off: that History line undone
//      (store.undoEntry), one at a time;
//   3. the stops it added that now hold nothing and are as it left them:
//      store.deleteStop, then store.idle(). A stay it added is left on.
// The batch reads "taken back" only when nothing is left to try; otherwise
// its button stays and a second run does only what is left.
//
// createTakeBack(store, { storage, now }) -> { list(), record(fields),
// running(at), run(at) -> Promise<sentence>, subscribe(fn) }.
// Only this phone has its batches (ids, counts and times only). A wipe
// (Forget this phone, a refused key) empties the memory; storage was
// cleared with every other mat.* key.

import { batchOf, addBatch, loadBatches, saveBatches, planOf, stopFree, resultText, ticketsBack, picturesOf, NO_SIGNAL, NOT_LOOKED_UP } from "./bulkbatch.js";

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
    // A batch that only added a stop (its ticket refused) is kept too, so the stop can be taken back (fix round 2, R4).
    if (!b.at || (!b.n && !b.off && !b.stops.length)) return null;
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

  // One run: what is left of the batch, one step at a time. The batch is
  // marked taken back only when nothing is left to try (fix round 1, I1); a
  // run that stops part way keeps the button, and running it again redoes
  // nothing that was done (planOf looks at the trip as it is now).
  async function run(at) {
    const b = batches.find((x) => x.at === at);
    if (!b || b.back || busy.has(at)) return "";
    const unsent = new Set(picturesOf(b).filter((id) => typeof store.unsaved === "function" && store.unsaved(id)));
    const plan = planOf(b, store.state, { unsent });
    if (plan.blocked) {
      store.notify(NO_SIGNAL);
      return NO_SIGNAL;
    }
    busy.add(at);
    emit();
    try {
      // 0. Each old picture's own History line, looked up by its id (no page
      //    limit; fix round 1, I2), before anything is taken off. One lookup
      //    that fails: nothing is taken back.
      const entries = new Map(); // old picture id -> its undoable remove line, or null (none: History can't put it back)
      for (const id of plan.putBack) {
        let got;
        try {
          got = await store.historyFor(id);
        } catch {
          const text = store.state.online === false ? NO_SIGNAL : NOT_LOOKED_UP;
          store.notify(text);
          return text;
        }
        if (store.state.status === "nokey") return "";
        entries.set(id, (Array.isArray(got) ? got : []).find((e) => e && e.kind === "ticket" && e.ref === id && e.action === "remove" && e.canUndo && !e.undoneBy) || null);
      }
      // 1. The pictures it added, each waited for; one that did not surely come off is tried again next time.
      const unsure = new Set();
      const stuck = new Set(); // refused for good by the backend (not a lost signal): final, said (fix round 2, R3)
      for (const id of plan.remove) {
        if (store.state.status === "nokey") return "";
        const out = await settle((onUnsure) => store.removeTicket(id, { quiet: true, onUnsure }));
        if (out && !out.saved && out.reason === "refused" && ticketOn(id)) stuck.add(id);
        else if (!(out && out.saved) && (ticketOn(id) || (out && out.reason === "unsure"))) unsure.add(id);
      }
      const isOn = (id) => ticketOn(id) || unsure.has(id);
      // 2. The old pictures it took off: each one's own History line, undone.
      let put = 0;
      let lost = 0;
      for (const id of plan.putBack) {
        if (store.state.status === "nokey") return "";
        const entry = entries.get(id);
        if (!entry) {
          lost += 1; // changed since: it has its own line in History
          continue;
        }
        let ok = false;
        try {
          ok = await store.undoEntry(entry.id);
        } catch {
          ok = false;
        }
        if (ok) put += 1;
      }
      put += b.removed.length - plan.putBack.length; // put back by an earlier run
      // 3. The stops it added that hold nothing now and are as it left them;
      //    never one whose picture did not surely come off (fix round 1, M4).
      let stopsLeft = 0;
      let stopsKept = 0; // changed since, or holding another picture: left on for good, and said (R4)
      for (const id of b.stops) {
        if (store.state.status === "nokey") return "";
        if (!stopFree(id, b, store.state)) {
          const there = (store.state.stops || []).find((x) => x && x.id === id && !x.deleted);
          if (there) stopsKept += 1;
          continue;
        }
        const mine = (store.state.tickets || []).filter((t) => t && t.stop === id).map((t) => t.id);
        if (mine.some((tid) => unsure.has(tid))) {
          stopsLeft += 1;
          continue;
        }
        store.deleteStop(id);
        await store.idle();
        const st = (store.state.stops || []).find((x) => x && x.id === id);
        if (st && !st.deleted) stopsLeft += 1;
      }
      const total = b.items.length;
      const back = ticketsBack(b, isOn);
      const oldBack = b.removed.filter((id) => ticketOn(id)).length;
      const settled = b.items.every((one) => one.every((id) => stuck.has(id) || !isOn(id)));
      const done = settled && oldBack + lost >= b.removed.length && stopsLeft === 0;
      const stays = b.stays.filter((id) => (store.state.stays || []).some((x) => x && x.id === id && !x.deleted)).length;
      const text = resultText({ total, back, put: Math.min(put, oldBack), lost, stays, done, stuck: stuck.size, stopsKept });
      if (done) {
        const iso = new Date(now()).toISOString();
        batches = batches.map((x) => (x.at === at ? { ...x, back: iso } : x));
        saveBatches(st(), batches);
      }
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
