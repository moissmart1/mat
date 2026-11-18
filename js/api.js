/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// One call to the trip backend: api(action, args, { actor }) -> Promise<{ rev, data }>.
// `actor` names who the request is from when it is not the phone's current
// person (a line queued earlier is sent as whoever rang it up).
// Rejects with an Error whose .code is the backend's error code, "network"
// when the request itself fails, or "server" when the reply is not an
// envelope. A "network" error also has .notSent when the request provably
// never left the phone (no address to send to, or the phone says it has no
// network). The trip key travels only in the request body: never in the URL,
// an error message or a log line.

function fail(code, message, notSent = false) {
  const err = new Error(message);
  err.code = code;
  if (notSent) err.notSent = true;
  return err;
}

const UNREACHABLE = "Couldn’t reach the trip sheet.";
const phoneOnline = () => !(globalThis.navigator && globalThis.navigator.onLine === false);
// How long one request may take, reply included, before it counts as no
// signal. Weak signal must not leave requests piling up.
export const API_TIMEOUT_MS = 30000;
const BAD_REPLY = "The trip sheet sent back something unexpected.";

export function createApi({ url, getKey, getActor, fetchImpl, timeoutMs = API_TIMEOUT_MS, isOnline = phoneOnline }) {
  // key: another key than the phone's own, for one request (a key that came
  // in the address is tried this way before it is kept: js/store.js boot).
  return async function api(action, args = {}, { actor, key } = {}) {
    const body = { key: key || getKey(), actor: actor || getActor(), via: "app", action, args };
    if (!isOnline()) throw fail("network", UNREACHABLE, true);
    let env;
    const fake = globalThis.MAT_FAKE_API;
    if (typeof fake === "function") {
      try {
        env = await fake(body);
      } catch {
        throw fail("network", UNREACHABLE);
      }
    } else {
      const doFetch = fetchImpl || globalThis.fetch;
      if (!url || typeof doFetch !== "function") throw fail("network", UNREACHABLE, true);
      let text;
      const abort = typeof AbortController === "function" ? new AbortController() : null;
      let timer;
      // Gives up at the timeout even if the fetch ignores the abort.
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (abort) abort.abort();
          reject(new Error("timeout"));
        }, timeoutMs);
        // Under Node (the unit tests) a pending request must not hold the process open.
        if (timer && typeof timer.unref === "function") timer.unref();
      });
      try {
        const request = (async () => {
          const res = await doFetch(url, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(body),
            signal: abort ? abort.signal : undefined,
          });
          return res.text();
        })();
        request.catch(() => {}); // when the timeout wins, its later failure is not news
        text = await Promise.race([request, timeout]);
      } catch {
        throw fail("network", UNREACHABLE);
      } finally {
        clearTimeout(timer);
      }
      try {
        env = JSON.parse(text);
      } catch {
        throw fail("server", BAD_REPLY);
      }
    }
    if (!env || typeof env !== "object" || typeof env.ok !== "boolean") throw fail("server", BAD_REPLY);
    if (!env.ok) throw fail(typeof env.error === "string" ? env.error : "server", typeof env.message === "string" ? env.message : BAD_REPLY);
    return { rev: env.rev, data: env.data };
  };
}
