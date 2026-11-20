// Shared by the release gate (gate.mjs), the release itself (ship.mjs), the
// push check (prepush.mjs) and the private-data scan (scan.mjs). Nothing here
// holds a key or anything from the trip's Sheet: those live outside the
// repository, in ~/.config/mat/ (see privateEnv and scan.mjs).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SITE = "https://moissmart1.github.io/mat/";
export const PRIVATE_DIR = process.env.MAT_PRIVATE_DIR || join(homedir(), ".config", "mat");

export function git(args, root = ROOT) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function gitOk(args, root = ROOT) {
  try {
    git(args, root);
    return true;
  } catch {
    return false;
  }
}

// What js/config.js says: where the backend is and which version this is.
export function config(src) {
  const url = (src.match(/API_URL = "([^"]*)"/) || [])[1] || "";
  return {
    apiUrl: url,
    deployId: (url.match(/\/macros\/s\/([A-Za-z0-9_-]+)\/exec/) || [])[1] || "",
    appVersion: (src.match(/APP_VERSION = "([^"]*)"/) || [])[1] || "",
  };
}

export function readConfig(root = ROOT) {
  return config(readFileSync(join(root, "js", "config.js"), "utf8"));
}

// KEY=value lines of ~/.config/mat/env; the process environment wins.
export function privateEnv() {
  const out = {};
  const file = join(PRIVATE_DIR, "env");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  }
  for (const k of KEY_NAMES) if (process.env[k]) out[k] = process.env[k];
  return out;
}

// The env names that hold a key (never printed).
export const KEY_NAMES = ["MAT_KEY", "MAT_CHECK_KEY", "MAT_OWNER_KEY", "DESK_KEY"];

// The key the release checks use (security, 2026-11-18): the read-only check
// key, MAT_CHECK_KEY (it may load, rev, history and migrate, nothing else);
// the old shared MAT_KEY only when there is no check key. "" when neither.
export function checkKey(env) {
  return (env && (env.MAT_CHECK_KEY || env.MAT_KEY)) || "";
}

// The key that reads the whole trip for the private list: the owner's own
// key (MAT_OWNER_KEY), else the old shared MAT_KEY (the check key's load
// leaves out the e-Transfer addresses, which the list must hold).
export function ownerKey(env) {
  return (env && (env.MAT_OWNER_KEY || env.MAT_KEY)) || "";
}

// text with every key in env blanked, for a message that could carry one.
export function withoutKeys(text, env) {
  let s = String(text);
  for (const k of KEY_NAMES) {
    const v = env && env[k];
    if (typeof v === "string" && v.length >= 6) {
      s = s.split(v).join("(key)");
      s = s.split(encodeURIComponent(v)).join("(key)");
    }
  }
  return s;
}

// --- the backend stamp: ten hex digits over every file clasp pushes ---------

export const STAMP_LINE = /^var BACKEND_STAMP = "([^"]*)";$/m;

export function backendFiles(root = ROOT) {
  const dir = join(root, "backend");
  return readdirSync(dir)
    .filter((f) => (f.endsWith(".js") && f !== "Stamp.js") || f === "appsscript.json")
    .sort();
}

export function backendHash(root = ROOT) {
  const h = createHash("sha256");
  for (const f of backendFiles(root)) {
    h.update(f + "\0");
    h.update(readFileSync(join(root, "backend", f)));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 10);
}

export function stampIn(src) {
  const m = String(src || "").match(STAMP_LINE);
  return m ? m[1] : "";
}

export function writtenBackendStamp(root = ROOT) {
  const file = join(root, "backend", "Stamp.js");
  return existsSync(file) ? stampIn(readFileSync(file, "utf8")) : "";
}

// --- receipts: proof that the gate passed for one exact tree ----------------

export function receiptDir(root = ROOT) {
  const common = git(["rev-parse", "--git-common-dir"], root);
  return join(isAbsolute(common) ? common : join(root, common), "mat-gate");
}

export function readReceipt(tree, root = ROOT) {
  const file = join(receiptDir(root), tree + ".json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Where the gate's browser tests ran, in words: "GitHub (run …)" or "this Mac"
// (a receipt from before issue 9 has no runner: it was this Mac).
export function runnerText(receipt) {
  const r = receipt && receipt.runner;
  if (r && r.kind === "github") return "GitHub, run " + r.runId + (r.attempt > 1 ? " attempt " + r.attempt : "") + " (" + r.url + ")";
  return "this Mac";
}

// Why a receipt does not let this commit out, or null when it does. The same
// rules for a receipt from either runner: for this tree and version, and every
// test counted and passed.
export function judgeReceipt(receipt, { tree, appVersion }) {
  if (!receipt) return "This commit has not passed the gate.";
  if (receipt.tree !== tree) return "The gate's receipt is for other files (" + String(receipt.tree).slice(0, 7) + ").";
  if (receipt.appVersion !== appVersion) return "The gate passed version " + receipt.appVersion + ", but this commit is version " + appVersion + ".";
  const u = receipt.unit || {};
  const e = receipt.e2e || {};
  if (u.fail || e.fail) return "The gate's receipt for this commit records failing tests.";
  if (!(u.pass > 0) || !(e.pass > 0)) return "The gate's receipt counts no unit or no browser tests.";
  const r = receipt.runner;
  if (r && r.kind === "github" && (!r.runId || !/^https:\/\/github\.com\//.test(String(r.url || "")) || r.headSha !== receipt.head)) {
    return "The gate's receipt names no GitHub run for this commit.";
  }
  return null;
}

// --- the live backend --------------------------------------------------------

// The stamp the live backend answers with ("" from a backend older than the
// stamp, or one that cannot be reached).
export async function liveStamp(apiUrl) {
  try {
    const r = await fetch(apiUrl, { redirect: "follow" });
    const j = await r.json();
    return (j && j.data && typeof j.data.stamp === "string" && j.data.stamp) || "";
  } catch {
    return "";
  }
}

// One action, posted the way the phone posts it: the key in the body only,
// never in the address.
export async function call(apiUrl, key, action, args = {}) {
  const r = await fetch(apiUrl, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ key, actor: "Mo", via: "app", action, args }),
  });
  return r.json();
}

// Whether a live load answered with the trip (days and stops).
export function tripLoaded(r) {
  return !!r && r.ok === true && !!r.data && Array.isArray(r.data.days) && r.data.days.length > 0 && Array.isArray(r.data.stops);
}

// Asks ask() until ok(answer), at most `tries` times, waiting `waitMs`
// between: right after a deploy a request can still land on the old version
// (which refuses the check key). Resolves with the last answer.
export async function askUntil(ask, ok, { tries = 7, waitMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await ask().catch(() => null);
    if (ok(last)) return last;
    if (i < tries - 1) await sleep(waitMs);
  }
  return last;
}

// The live backend's stamp, asked again every 3 seconds for up to 30 seconds
// while it is not `wanted` (right after a deploy one request can still reach
// the old version). Resolves with the last answer. ask and sleep stand in for
// the network and the clock in tests.
export async function liveStampUntil(apiUrl, wanted, { ask = liveStamp, sleep, tries = 11, waitMs = 3000 } = {}) {
  const last = await askUntil(() => ask(apiUrl), (v) => v === wanted, { tries, waitMs, ...(sleep ? { sleep } : {}) });
  return last === null ? "" : last;
}

// Calls migrate until an answer comes from the backend that carries `wanted`
// (this commit's stamp), then trusts that answer's `added` list. Right after a
// deploy a request can still land on the previous version, which answers ok with
// "nothing to add" (2026-11-18, and again 2026-11-20); such an answer, and a
// refusal from the old version, are asked again with a growing wait (3 s, then
// 1.5 times longer, at most 15 s each) until about `budgetMs` of waiting has
// passed. Resolves { ok: true, added, calls } or { ok: false, why, calls }.
// ask and sleep stand in for the network and the clock in tests.
export async function migrateUntilCurrent(ask, wanted, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), budgetMs = 120000 } = {}) {
  let waited = 0;
  let calls = 0;
  let seen = "no answer";
  // A missing wanted stamp can never be "this commit": refuse rather than match an answer without one.
  if (typeof wanted !== "string" || wanted.trim() === "") return { ok: false, added: [], calls: 0, why: "no commit stamp to wait for" };
  for (let wait = 3000; ; wait = Math.min(Math.round(wait * 1.5), 15000)) {
    const r = await ask().catch(() => null);
    calls++;
    if (r && r.ok === true && r.data && r.data.stamp === wanted) {
      return { ok: true, added: Array.isArray(r.data.added) ? r.data.added : [], calls };
    }
    seen = !r ? "no answer" : r.ok === true ? "answered by backend " + ((r.data && r.data.stamp) || "older than the stamp") : "refused (" + (r.error || r.message || "no reason") + ")";
    if (waited + wait > budgetMs) break;
    await sleep(wait);
    waited += wait;
  }
  return { ok: false, why: "migrate was only ever answered by the wrong backend (last: " + seen + "; wanted " + wanted + ") after " + calls + " calls over about " + Math.round(waited / 1000) + " seconds.", calls };
}

// --- rules that are pure, so tests can pin them -----------------------------

// A change the phones must fetch needs a new APP_VERSION, or they keep the old one.
export function needsBump(changed, shell) {
  const files = new Set(shell.map((f) => (f === "./" ? "index.html" : f)));
  files.add("sw.js");
  return changed.some((f) => files.has(f));
}

export function isReleaseRef(ref) {
  return ref === "refs/heads/main" || ref === "refs/heads/dev";
}

// Why a push must not go out, or null when it may.
//   remoteRef, localSha: what git hands a pre-push hook
//   receipt: the gate's receipt for that commit's tree, or null
//   commitStamp: BACKEND_STAMP in that commit ("" before the stamp existed)
//   live: the stamp the live backend answers with
export function judgePush({ remoteRef, localSha, receipt, commitStamp, live, scan = null }) {
  if (/refs\/original\//.test(remoteRef)) return "refs/original is never pushed: it holds history that was removed on purpose.";
  if (!isReleaseRef(remoteRef)) {
    if (!remoteRef.startsWith("refs/heads/") || (remoteRef.startsWith("refs/heads/ci/") && !/^refs\/heads\/ci\/[\w.-]+$/.test(remoteRef))) {
      return "Push a feature branch, a ci/<name> branch, or a release branch.";
    }
    if (/^0+$/.test(localSha)) {
      return remoteRef.startsWith("refs/heads/ci/") ? null : "Feature branch deletion is not allowed by this hook.";
    }
    if (!scan || !scan.atHead || !scan.clean) return "Push a feature or CI branch from a clean checkout at the commit being pushed.";
    if (scan.found !== 0) return "The private-data scan found " + scan.found + " thing(s) in this commit. Nothing was pushed.";
    return null;
  }
  if (/^0+$/.test(localSha)) return "main and dev are never deleted.";
  if (!receipt) return "This commit has not passed the gate. Run `npm run gate`, then `npm run ship`.";
  if (receipt.unit.fail || receipt.e2e.fail) return "The gate's receipt for this commit records failing tests.";
  if (commitStamp && commitStamp !== live) {
    return "The live backend (" + (live || "no stamp") + ") is not this commit's backend (" + commitStamp +
      "). The backend goes first: run `npm run ship`, which deploys it and checks it before publishing.";
  }
  return null;
}
