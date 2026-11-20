// The gate every release passes before anything is published:
//
//   npm run gate            everything, and a receipt for this exact tree; the
//                           browser tests run on GitHub (the `check` workflow,
//                           on a ci/release-<sha> branch pushed for the purpose)
//   npm run gate -- --local the same, with the browser tests on this Mac
//                           (about 15 minutes, behind the local test queue)
//   npm run gate -- --quick everything but the browser tests; no receipt
//
// The private-data scan runs here, before anything is pushed. The backend
// deploy and the live checks are not part of the gate: they are `npm run ship`.
//
// It stops at the first thing that is wrong and says what to do. The receipt
// (in .git/mat-gate/, never committed) is what `npm run ship` and the push
// check ask for: no receipt for the commit, no release.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ROOT, backendHash, config, git, gitOk, needsBump, readConfig, receiptDir, runnerText, writtenBackendStamp } from "./release-lib.mjs";
import { ciBranch, expectedSlices, githubCli, repoOf, sliceCount, startsOnCi, waitForCheck } from "./gate-ci.mjs";
import { scanCommits, scanTree } from "./scan.mjs";
import { readSw, shellHash, shellList, writtenVersion } from "./stamp-sw.mjs";

const quick = process.argv.includes("--quick");
const local = process.argv.includes("--local");
const step = (s) => console.log("gate: " + s);
const stop = (why, fix) => {
  console.error("\ngate: STOPPED. " + why + (fix ? "\n      " + fix : ""));
  process.exit(1);
};

// 1. Nothing uncommitted: the receipt is for a commit, not for a working copy.
if (git(["status", "--porcelain"])) stop("There are uncommitted changes.", "Commit them (or stash them) and run the gate again.");
const head = git(["rev-parse", "HEAD"]);
const tree = git(["rev-parse", "HEAD^{tree}"]);
step("commit " + head.slice(0, 7));

// 1b. On GitHub unless --local: gh must be signed in and GitHub must answer.
// Never a quiet fall-back to this Mac: that is a different gate, asked for by name.
let gh = null;
let repo = "";
if (!local && !quick) {
  repo = repoOf(gitOk(["remote", "get-url", "origin"]) ? git(["remote", "get-url", "origin"]) : "");
  if (!repo) stop("origin is not a GitHub repository, so the browser tests cannot run there.", "Run `npm run gate -- --local` to run them on this Mac.");
  gh = githubCli(repo);
  const can = gh.reachable();
  if (!can.ok) stop(can.why + " The browser tests run on GitHub unless asked otherwise.", "Sign in with `gh auth login`, or run `npm run gate -- --local` to run them on this Mac.");
  step("GitHub answers for " + repo);
}

// 2. Both stamps match the files.
if (shellHash() !== writtenVersion(readSw())) stop("sw.js is not stamped for these files.", "Run `npm run stamp`, commit, and run the gate again.");
if (backendHash() !== writtenBackendStamp()) stop("backend/Stamp.js is not stamped for these files.", "Run `npm run stamp`, commit, and run the gate again.");
step("stamps match");

// 3. What the phones run has a new version number, and nothing is lost.
const cfg = readConfig();
if (gitOk(["rev-parse", "--verify", "origin/main"])) {
  if (!gitOk(["merge-base", "--is-ancestor", "origin/main", "HEAD"])) {
    stop("This commit does not contain what is published (origin/main).", "Merge or rebase onto origin/main first.");
  }
  const changed = git(["diff", "--name-only", "origin/main", "HEAD"]).split("\n").filter(Boolean);
  const was = config(git(["show", "origin/main:js/config.js"])).appVersion;
  if (needsBump(changed, shellList()) && !(Number(cfg.appVersion) > Number(was))) {
    stop("Files the phones run have changed but APP_VERSION is still " + cfg.appVersion + ".",
      "Raise APP_VERSION in js/config.js, run `npm run stamp`, commit, and run the gate again.");
  }
  step("version " + cfg.appVersion + " (published: " + was + "), " + changed.length + " files changed");
} else {
  step("no origin/main here: version check skipped");
}

// 4. Nothing private in a public repository.
const found = scanTree();
if (found.length) {
  for (const f of found) console.error("gate: " + f.file + ":" + f.line + "  " + f.rule);
  stop("The private-data scan found " + found.length + " problem(s).", "Take them out of the tracked files.");
}
step("nothing private in the tracked files");

// 5. Unit tests, then the browser tests, alone.
const dir = receiptDir();
mkdirSync(dir, { recursive: true });
function run(name, cmd, args) {
  step(name + " running (log: " + join(dir, name + ".log") + ")");
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const text = (r.stdout || "") + (r.stderr || "");
  writeFileSync(join(dir, name + ".log"), text);
  return { code: r.status, text };
}

const unit = run("unit", "npm", ["test"]);
const unitPass = Number((unit.text.match(/^(?:#|ℹ) pass (\d+)/m) || [])[1] || 0);
const unitFail = Number((unit.text.match(/^(?:#|ℹ) fail (\d+)/m) || [])[1] || 0);
if (unit.code !== 0 || unitFail || !unitPass) stop("Unit tests: " + unitPass + " passed, " + unitFail + " failed.", "See " + join(dir, "unit.log"));
step("unit tests: " + unitPass + " passed");

if (quick) {
  console.log("\ngate: quick run passed. No receipt: run `npm run gate` before a release.");
  process.exit(0);
}

let e2ePass, e2eFail, secondTry, runner;
if (local) {
  // The runner waits in line by itself (tests/e2e/queue.cjs), so nothing to check here.
  const e2e = run("e2e", "node", ["tests/e2e/run.cjs"]);
  const m = e2e.text.match(/^(\d+) passed, (\d+) failed$/m);
  secondTry = e2e.text.split("\n").filter((l) => l.startsWith("second try: ")).map((l) => l.slice(12));
  e2ePass = m ? Number(m[1]) : 0;
  e2eFail = m ? Number(m[2]) : 0;
  if (e2e.code !== 0 || e2eFail || !e2ePass) {
    const fails = e2e.text.split("\n").filter((l) => l.startsWith("FAIL ")).slice(0, 12).join("\n      ");
    stop("Browser tests: " + e2ePass + " passed, " + e2eFail + " failed.", (fails || "No summary line: the run did not finish.") + "\n      See " + join(dir, "e2e.log"));
  }
  step("browser tests: " + e2ePass + " passed");
  if (secondTry.length) step("UNRELIABLE, passed only on a second try (fix these): " + secondTry.join("; "));
  runner = { kind: "local" };
} else {
  // Exactly this commit goes to its own ci/ branch (public, so only after the
  // scan above; the push check scans it again). The run is GitHub's `check`
  // workflow from this commit, started by that push.
  let yml = "";
  try {
    yml = git(["show", head + ":.github/workflows/check.yml"]);
  } catch {
    stop("This commit has no .github/workflows/check.yml, so GitHub would run no browser tests.", "Put it back, or run `npm run gate -- --local`.");
  }
  if (!startsOnCi(yml)) stop("check.yml does not run on a push to a ci/ branch, so no run would start.", "Keep \"ci/**\" under on.push.branches, or run `npm run gate -- --local`.");
  const slices = sliceCount(yml);
  if (!slices) stop("check.yml does not split the browser tests into slices 1..N with a matching /N.", "Fix .github/workflows/check.yml, or run `npm run gate -- --local`.");
  // What each slice must show it ran, counted here from this commit's test
  // files (no browser, no queue), not taken from the workflow under test.
  const listed = spawnSync("node", ["tests/e2e/cases.cjs"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let expected;
  try {
    if (listed.status !== 0) throw new Error((listed.stderr || "").trim().split("\n")[0] || "exit " + listed.status);
    const { shardFiles } = createRequire(import.meta.url)("../tests/e2e/shard.cjs");
    expected = expectedSlices(JSON.parse(listed.stdout), slices, shardFiles);
  } catch (e) {
    stop("Could not list the browser-test cases here (" + String(e.message).split("\n")[0] + ").", "Run `node tests/e2e/cases.cjs` to see why.");
  }
  if (expected.some((x) => !x.length)) stop("A slice of " + slices + " would hold no browser tests.", "Fewer slices in check.yml, or run `npm run gate -- --local`.");
  step("browser tests: " + expected.flat().length + " cases here, in " + slices + " slices");
  // Everything the push makes public, not only this commit: each commit's
  // added lines and its message, against the private list.
  let range = [];
  try {
    git(["fetch", "-q", "--prune", "origin"]);
    range = git(["rev-list", "HEAD", "--not", "--remotes=origin"]).split("\n").filter(Boolean);
  } catch (e) {
    stop("Could not ask GitHub which commits are new (" + String(e.message).split("\n")[0] + ").", "Run the gate again, or `npm run gate -- --local`.");
  }
  let inRange;
  try {
    inRange = scanCommits(range);
  } catch (e) {
    stop("The scan of the commits to be pushed did not finish (" + String(e.message).split("\n")[0] + "). Nothing was pushed.", "Run the gate again.");
  }
  if (inRange.length) {
    for (const f of inRange) console.error("gate: " + f.commit + " " + f.file + ":" + f.line + "  " + f.rule);
    stop("The private-data scan found " + inRange.length + " problem(s) in the " + range.length + " commit(s) the push would make public. Nothing was pushed.",
      "Take them out of the history (they are in commits not yet on GitHub), or ask the owner.");
  }
  step("nothing private in the " + range.length + " commit(s) the push makes public");
  const branch = ciBranch(head);
  let before = [];
  try {
    before = gh.runs(head).map((r) => r.id);
  } catch (e) {
    stop("GitHub would not list the check runs (" + String(e.message).split("\n")[0] + ").", "Run the gate again, or `npm run gate -- --local`.");
  }
  // A branch of that name left by an earlier gate is replaced, so this push starts a fresh run.
  let left = "";
  try {
    left = git(["ls-remote", "origin", "refs/heads/" + branch]);
  } catch (e) {
    stop("GitHub cannot be reached with git (" + String(e.message).split("\n")[0] + ").", "Run the gate again, or `npm run gate -- --local`.");
  }
  if (left) {
    const del = spawnSync("git", ["push", "-q", "origin", "--delete", branch], { cwd: ROOT, stdio: "inherit" });
    if (del.status !== 0) stop("Could not remove the old " + branch + " branch on GitHub.", "Read the message above.");
  }
  step("browser tests: pushing " + head.slice(0, 7) + " to " + branch + " for the check run on GitHub");
  const push = spawnSync("git", ["push", "-q", "origin", head + ":refs/heads/" + branch], { cwd: ROOT, stdio: "inherit" });
  if (push.status !== 0) stop("The push to " + branch + " was refused.", "Read the message above. Nothing else was pushed.");
  step("browser tests: waiting for GitHub (" + slices + " slices, about 15 minutes; asked once a minute, up to 40)");
  const ci = await waitForCheck({ head, branch, slices, expected, api: gh, before, log: (s) => step(s) });
  // What was read of the slices' logs is kept here, pass or fail (GitHub's expire).
  writeFileSync(join(dir, "e2e.log"), Object.entries(ci.logs || {}).map(([k, v]) => "=== " + k + "\n" + v).join("\n"));
  if (!ci.ok) stop("Browser tests on GitHub: " + ci.why, ci.fix + "\n      Slice logs: " + join(dir, "e2e.log") + "\n      The branch " + branch + " is left on GitHub to look at; the next gate replaces it.");
  e2ePass = ci.e2e.pass;
  e2eFail = ci.e2e.fail;
  secondTry = ci.e2e.secondTry;
  runner = { kind: "github", repo, runId: ci.run.id, attempt: ci.run.attempt, url: ci.run.url, branch, headSha: head };
  step("browser tests: " + e2ePass + " passed on GitHub (" + ci.run.url + (ci.run.attempt > 1 ? ", attempt " + ci.run.attempt : "") + ")");
}

// 6. The receipt. The tree must still be the one that was tested.
if (git(["status", "--porcelain"]) || git(["rev-parse", "HEAD^{tree}"]) !== tree) stop("The files changed while the tests ran.", "Run the gate again.");
const receipt = {
  tree,
  head,
  at: new Date().toISOString(),
  appVersion: cfg.appVersion,
  backendStamp: writtenBackendStamp(),
  unit: { pass: unitPass, fail: unitFail },
  e2e: { pass: e2ePass, fail: e2eFail, secondTry },
  runner,
};
writeFileSync(join(dir, tree + ".json"), JSON.stringify(receipt, null, 2) + "\n");
if (runner.kind === "github") {
  // The run stays on GitHub (its address is in the receipt); the branch was only its trigger.
  const del = spawnSync("git", ["push", "-q", "origin", "--delete", runner.branch], { cwd: ROOT, stdio: "inherit" });
  if (del.status !== 0) step("note: could not remove " + runner.branch + " on GitHub (harmless; the next gate for this commit replaces it)");
}
console.log("\ngate: PASSED for " + head.slice(0, 7) + " (version " + cfg.appVersion + ") on " + runnerText(receipt) + ": " + unitPass + " unit, " + e2ePass + " browser. Next: `npm run ship`.");
