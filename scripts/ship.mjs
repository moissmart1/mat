// The release, in the only order that is safe, each step checked against the
// real thing before the next one starts:
//
//   npm run ship                 backend first (when it changed), then the site
//   npm run ship -- --migrate    also runs the backend's `migrate` (new tabs or columns)
//   npm run ship -- --check      says what it would do and changes nothing
//   npm run ship -- --backend-only   steps 1 to 3, then stops before the push
//                                (to check something by hand against the new
//                                backend; `npm run ship` again does the rest)
//
// 1. This commit is main, clean, and has the gate's receipt (npm run gate),
//    from either runner (GitHub, or this Mac with --local): the first line
//    says which.
// 2. If the live backend is not this commit's backend: clasp push, new version
//    on the same deployment, then wait until the live backend answers with
//    this commit's stamp.
// 3. The live trip still loads, read with the release check's read-only key
//    (MAT_CHECK_KEY from ~/.config/mat/env; MAT_KEY only when there is none).
// 4. git push origin main (the push check runs again there).
// 5. Wait until the site serves this version, then compare every file the
//    phones cache, byte for byte, with this commit.
// 6. Open the live site in a headless browser with the check key in the fragment
//    (never in the query string): the trip loads and there is no script error.
//
// 7. dev is brought up to the release (or it says dev holds work not in it).
//
// It never prints a key. If a step fails it stops and says where things stand.
//
// Once issueLinks has run (the security release, 2026-11-18), never roll the
// backend back past that version: an older backend knows only the shared key,
// refuses every personal key, and each phone that hears that clears itself.
// Fix forward.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ROOT, SITE, askUntil, call, checkKey, tripLoaded, git, gitOk, judgeReceipt, liveStamp, privateEnv, readConfig, readReceipt, runnerText, withoutKeys, writtenBackendStamp } from "./release-lib.mjs";
import { shellList } from "./stamp-sw.mjs";

const check = process.argv.includes("--check");
const migrate = process.argv.includes("--migrate");
const backendOnly = process.argv.includes("--backend-only");
const step = (s) => console.log("ship: " + s);
const stop = (why, fix) => {
  console.error("\nship: STOPPED. " + why + (fix ? "\n      " + fix : ""));
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

// 1 ---------------------------------------------------------------------------
if (git(["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") stop("Releases go out from main.", "Merge the work into main first.");
if (git(["status", "--porcelain"])) stop("There are uncommitted changes.", "Commit them, then `npm run gate`.");
const head = git(["rev-parse", "HEAD"]);
const headTree = git(["rev-parse", "HEAD^{tree}"]);
const receipt = readReceipt(headTree);
const notReady = judgeReceipt(receipt, { tree: headTree, appVersion: readConfig().appVersion });
if (notReady) stop(notReady, "Run `npm run gate` (browser tests on GitHub, about 15 minutes; `-- --local` runs them on this Mac).");
step("gate passed on " + runnerText(receipt) + " at " + receipt.at);
git(["fetch", "origin", "main"]);
if (!gitOk(["merge-base", "--is-ancestor", "origin/main", "HEAD"])) stop("origin/main has commits this one does not.", "Merge them, then `npm run gate` again.");
git(["fetch", "origin", "dev"]);
if (gitOk(["rev-parse", "--verify", "-q", "origin/dev"]) && !gitOk(["merge-base", "--is-ancestor", "origin/dev", "HEAD"])) {
  step("note: dev holds " + git(["rev-list", "--count", "HEAD..origin/dev"]) + " merged commit(s) that are not in this commit. They will not go out with this release.");
}
const cfg = readConfig();
const env = privateEnv();
const KEY = checkKey(env);
if (!KEY) stop("No key to check the live trip with.", "Put MAT_CHECK_KEY=... in ~/.config/mat/env (never in the repository).");
if (!env.MAT_CHECK_KEY) step("no MAT_CHECK_KEY: checking with the old shared MAT_KEY");
step("commit " + head.slice(0, 7) + ", version " + cfg.appVersion + ", gate passed " + receipt.at + " on " + (receipt.runner && receipt.runner.kind === "github" ? "GitHub" : "this Mac") + " (" + receipt.unit.pass + " unit, " + receipt.e2e.pass + " browser)");

// 2 ---------------------------------------------------------------------------
const want = writtenBackendStamp();
let live = await liveStamp(cfg.apiUrl);
if (live === want) {
  step("backend: the live one is already this commit's (" + want + ")");
} else {
  step("backend: live is " + (live || "older than the stamp") + ", this commit is " + want + ": it must be deployed first");
  if (check) {
    step("--check: would run clasp push and a new version on the same deployment" + (migrate ? ", then migrate" : ""));
  } else {
    if (!existsSync(join(ROOT, ".clasp.json"))) stop("No .clasp.json here, so the backend cannot be deployed.", "It is git-ignored and lives only in /Users/owner/Projects/mat.");
    const clasp = (args) => spawnSync("npx", ["clasp", ...args], { cwd: ROOT, encoding: "utf8" });
    const before = clasp(["list-deployments"]);
    const was = ((before.stdout || "").split("\n").find((l) => l.includes(cfg.deployId)) || "").match(/@(\d+)/);
    step("backend: live deployment was at version " + (was ? was[1] : "unknown") + " (fix forward: once issueLinks has run, never roll back past the security release)");
    const push = clasp(["push", "-f"]);
    if (push.status !== 0) stop("clasp push failed.", (push.stderr || push.stdout || "").trim().split("\n").slice(-3).join("\n      "));
    const dep = clasp(["create-deployment", "-i", cfg.deployId, "-d", "v" + cfg.appVersion + " " + head.slice(0, 7)]);
    if (dep.status !== 0) stop("The new backend version was pushed but not deployed.", (dep.stderr || dep.stdout || "").trim().split("\n").slice(-3).join("\n      "));
    for (let i = 0; i < 30 && live !== want; i++) {
      await sleep(3000);
      live = await liveStamp(cfg.apiUrl);
    }
    if (live !== want) {
      stop("The live backend still answers " + (live || "with no stamp") + " after the deploy.",
        "The site was NOT published. Look at `npx clasp list-deployments`" + (was ? "; version " + was[1] + " is the one that was live." : "."));
    }
    step("backend: live and answering " + want);
  }
}

// 3 ---------------------------------------------------------------------------
if (migrate && !check) {
  // Asked until it answers that nothing is left to add. Right after a deploy a
  // request can still land on the old version, whose migrate adds nothing and
  // says ok (seen on 2026-11-18: the new columns only went in on a second call).
  let added = [];
  let settled = false;
  for (let i = 0; i < 6 && !settled; i++) {
    // A request that lands on the old version refuses the check key: asked again.
    const r = await askUntil(() => call(cfg.apiUrl, KEY, "migrate"), (x) => !!x && x.ok === true);
    if (!r || r.ok !== true) stop("migrate did not succeed (" + withoutKeys((r && (r.message || r.error)) || "no answer", env) + ").", "The site was NOT published. Run `npm run ship` again in a minute; fix forward, do not roll the backend back.");
    const now = (r.data && r.data.added) || [];
    added = added.concat(now);
    settled = i > 0 && now.length === 0;
    if (!settled) await sleep(5000);
  }
  if (!settled) stop("migrate kept adding columns after six calls.", "Look at the Sheet. The site was NOT published.");
  step("backend: migrate ran" + (added.length ? ", added " + added.join(", ") : ", nothing to add"));
}
// Asked for about 30 seconds: right after a deploy a request can still land
// on the old version, which refuses the check key.
const load = await askUntil(() => call(cfg.apiUrl, KEY, "load"), tripLoaded);
if (!tripLoaded(load)) {
  stop("The live trip does not load (" + withoutKeys((load && (load.message || load.error)) || "no answer", env) + ").",
    "The site was NOT published. Run `npm run ship` again in a minute. If it still does not load, fix forward: do not roll the backend back once issueLinks has run (every phone on a personal link would clear itself).");
}
step("live trip loads: " + load.data.days.length + " days, " + load.data.stops.length + " stops, rev " + load.rev);

// 4 ---------------------------------------------------------------------------
if (backendOnly && !check) {
  console.log("\nship: the backend is live and the trip loads. Stopped before the push, as asked. `npm run ship` does the rest.");
  process.exit(0);
}
const ahead = git(["rev-list", "--count", "origin/main..HEAD"]);
if (check) {
  step("--check: would push " + ahead + " commit(s) to origin/main, then check the live site. Nothing was changed.");
  process.exit(0);
}
if (ahead !== "0") {
  const push = spawnSync("git", ["push", "origin", "main"], { cwd: ROOT, stdio: "inherit" });
  if (push.status !== 0) stop("git push was refused.", "Read the message above. The backend is already live; the site is not.");
  step("pushed " + ahead + " commit(s)");
} else {
  step("nothing to push: origin/main is already this commit");
}

// 5 ---------------------------------------------------------------------------
const get = async (path) => {
  const r = await fetch(SITE + path + (path.includes("?") ? "&" : "?") + "ship=" + Date.now(), { cache: "no-store" });
  return { status: r.status, body: Buffer.from(await r.arrayBuffer()) };
};
let served = "";
for (let i = 0; i < 48; i++) {
  const r = await get("js/config.js").catch(() => null);
  served = r && r.status === 200 ? (r.body.toString("utf8").match(/APP_VERSION = "([^"]*)"/) || [])[1] || "" : "";
  if (served === cfg.appVersion && sha(r.body) === sha(readFileSync(join(ROOT, "js", "config.js")))) break;
  served = served === cfg.appVersion ? "" : served;
  await sleep(10000);
}
if (served !== cfg.appVersion) stop("After 8 minutes the site still serves version " + (served || "unknown") + ".", "Look at the repository's Pages build. The push itself went through.");
const wrong = [];
for (const entry of [...shellList(), "sw.js"]) {
  const file = entry === "./" ? "index.html" : entry;
  const r = await get(entry === "./" ? "" : entry).catch(() => null);
  if (!r || r.status !== 200 || sha(r.body) !== sha(readFileSync(join(ROOT, file)))) wrong.push(file);
}
if (wrong.length) stop("The site serves " + wrong.length + " file(s) that differ from this commit: " + wrong.slice(0, 8).join(", "), "Wait a minute and run `npm run ship` again (it only re-checks).");
step("site: version " + served + ", every cached file matches this commit");

// 6 ---------------------------------------------------------------------------
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  // The key goes in the fragment, as an invite link has it: a fragment is never
  // sent to the site's server (a query string is, and until 2026-11-18 this
  // step put the key in one). The app reads it there, so this is also the only
  // way the check really signs in: it waits for the trip's own day count.
  // The check key's phone has no one chosen (me is "") and shows the trip read-only.
  await page.goto(SITE + "#k=" + encodeURIComponent(KEY), { waitUntil: "load", timeout: 45000 });
  await page.waitForSelector("#phone", { timeout: 20000 });
  await page.waitForSelector("#dayCount", { state: "visible", timeout: 30000 });
  await sleep(2000);
} catch (e) {
  errors.push("the page did not start: " + withoutKeys(String(e.message || e).split("\n")[0], env));
} finally {
  await browser.close();
}
if (errors.length) stop("The live site started with " + errors.length + " error(s): " + withoutKeys(errors.slice(0, 3).join(" | "), env), "This is live now. Fix forward or revert the commit and ship again.");
step("live site starts with no script error");

// 7 ---------------------------------------------------------------------------
// dev (where reviewed pull requests wait) is brought up to what is now live,
// so the next branch starts from it. If dev holds merged work that was not in
// this release, it is left alone and said.
git(["fetch", "origin", "dev"]);
if (!gitOk(["rev-parse", "--verify", "-q", "origin/dev"])) {
  step("dev: there is no dev branch on GitHub");
} else if (git(["rev-parse", "origin/dev"]) === head) {
  step("dev: already at this release");
} else if (gitOk(["merge-base", "--is-ancestor", "origin/dev", "HEAD"])) {
  const sync = spawnSync("git", ["push", "origin", "HEAD:refs/heads/dev"], { cwd: ROOT, encoding: "utf8" });
  step(sync.status === 0 ? "dev: brought up to this release" : "dev: could NOT be brought up to this release (" + (sync.stderr || "").trim().split("\n").pop() + "). The release itself is live.");
} else {
  step("dev: holds " + git(["rev-list", "--count", "HEAD..origin/dev"]) + " merged commit(s) that are NOT in this release. Merge origin/dev into main for the next one.");
}

console.log("\nship: DONE. Version " + cfg.appVersion + " (" + head.slice(0, 7) + ") is live, backend " + want + ". Record it in the ledger and MEMORY.md.");
