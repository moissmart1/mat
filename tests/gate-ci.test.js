// The gate's browser tests on GitHub (scripts/gate-ci.mjs, issue 9), with
// GitHub and the clock stood in for: which run counts, what fails the gate,
// the one re-run of an abandoned slice, the time limit, and that ship takes
// the receipt either runner writes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ciBranch, githubCli, judgeJobs, pickRun, readSlice, repoOf, sliceCount, waitForCheck } from "../scripts/gate-ci.mjs";
import { judgePush, judgeReceipt, runnerText } from "../scripts/release-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HEAD = "a1b2c3d".padEnd(40, "0");
const OTHER = "ffffeee".padEnd(40, "1");
const BRANCH = ciBranch(HEAD);

const runOf = (over) => ({
  id: 500, run_number: 9, head_sha: HEAD, event: "push", head_branch: BRANCH, path: ".github/workflows/check.yml",
  status: "completed", conclusion: "success", run_attempt: 1, html_url: "https://github.com/o/r/actions/runs/500", ...over,
});
const jobsOf = (c = {}) => ["unit", "browser (1)", "browser (2)", "browser (3)", "browser (4)", "browser-all"].map((name, i) => ({ id: 900 + i, name, conclusion: c[name] || "success" }));
// A slice's log as GitHub serves it: a byte-order mark, a timestamp on every line.
const sliceLog = (pass, fail = 0, extra = []) =>
  "﻿" + ["Current runner version: '2.330.0'", "\u001b[36;1mif grep -q '^second try: ' x; then\u001b[0m", "ok   a > b", ...extra, pass + " passed, " + fail + " failed", "Cleaning up orphan processes"]
    .map((l, i) => "2026-11-20T16:0" + (i % 10) + ":00.1234567Z " + l).join("\n");

// GitHub, scripted: `states` is what the run looks like on each successive ask.
function fakeGithub({ runs = [], states = [], jobs = [jobsOf()], logs = {}, rerunFails = false } = {}) {
  const calls = { runs: 0, run: 0, jobs: 0, rerun: 0, log: [] };
  let s = 0;
  let j = 0;
  return {
    calls,
    runs() {
      calls.runs++;
      return typeof runs === "function" ? runs(calls.runs) : runs;
    },
    run() {
      calls.run++;
      return states[Math.min(s++, states.length - 1)];
    },
    jobs() {
      calls.jobs++;
      return jobs[Math.min(j++, jobs.length - 1)];
    },
    log(id) {
      calls.log.push(id);
      return logs[id] !== undefined ? logs[id] : sliceLog(100);
    },
    rerun() {
      calls.rerun++;
      if (rerunFails) throw new Error("HTTP 403");
    },
  };
}
function clock() {
  let t = 0;
  const slept = [];
  return { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; }, slept };
}
const wait = (api, c, over = {}) => waitForCheck({ head: HEAD, branch: BRANCH, slices: 4, api, now: c.now, sleep: c.sleep, ...over });

test("success on the exact commit: the browser count is the four slices' summary lines added up", async () => {
  const c = clock();
  const api = fakeGithub({
    runs: (n) => (n < 2 ? [] : [runOf({ status: "in_progress", conclusion: null })]),
    states: [runOf({ status: "in_progress", conclusion: null }), runOf()],
    logs: { 901: sliceLog(190), 902: sliceLog(178), 903: sliceLog(200), 904: sliceLog(188) },
  });
  const r = await wait(api, c);
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(r.e2e, { pass: 756, fail: 0, secondTry: [] });
  assert.deepEqual(r.run, { id: 500, url: "https://github.com/o/r/actions/runs/500", attempt: 1 });
  assert.deepEqual(api.calls.log, [901, 902, 903, 904], "only the slices' logs are read");
  assert.ok(c.slept.every((ms) => ms >= 60000), "never asks GitHub more often than once a minute");
});

test("a run for another commit, a pull_request run, another branch or an older run of ours never counts", async () => {
  const runs = [
    runOf({ id: 1, head_sha: OTHER }),
    runOf({ id: 2, event: "pull_request" }),
    runOf({ id: 3, head_branch: "dev" }),
    runOf({ id: 4, path: ".github/workflows/other.yml" }),
    runOf({ id: 5, run_number: 50 }),
  ];
  assert.equal(pickRun(runs, { head: HEAD, branch: BRANCH, before: [5] }), null);
  assert.equal(pickRun([...runs, runOf({ id: 6, run_number: 51 }), runOf({ id: 7, run_number: 52 })], { head: HEAD, branch: BRANCH, before: [5] }).id, 7);
  // The gate keeps waiting while only other runs are there, and then gives up saying so.
  const c = clock();
  const r = await wait(fakeGithub({ runs }), c, { before: [5] });
  assert.equal(r.ok, false);
  assert.match(r.why, /started no check run for a1b2c3d on ci\/release-a1b2c3d within 40 minutes/);
  assert.match(r.fix, /--local/);
});

test("a run that answers for another commit stops the gate", async () => {
  const c = clock();
  const r = await wait(fakeGithub({ runs: [runOf({ status: "queued", conclusion: null })], states: [runOf({ head_sha: OTHER })] }), c);
  assert.equal(r.ok, false);
  assert.match(r.why, /is for ffffeee, not a1b2c3d/);
});

test("a job that failed fails the gate, and is not re-run", async () => {
  const c = clock();
  const api = fakeGithub({ runs: [runOf({ conclusion: "failure" })], jobs: [jobsOf({ "browser (3)": "failure", "browser-all": "failure" })] });
  const r = await wait(api, c);
  assert.equal(r.ok, false);
  assert.match(r.why, /browser \(3\) \(failure\)/);
  assert.match(r.why, /browser-all \(failure\)/);
  assert.equal(api.calls.rerun, 0);
  // unit fails too, and a failure next to a cancelled slice is still a failure.
  assert.equal(judgeJobs(jobsOf({ unit: "failure" }), 4).state, "failed");
  assert.equal(judgeJobs(jobsOf({ "browser (1)": "failure", "browser (2)": "cancelled", "browser-all": "failure" }), 4).state, "failed");
  assert.equal(judgeJobs(jobsOf({ "browser (2)": "skipped" }), 4).state, "failed");
  // A job that is missing (a slice that never ran) is a failure, not a pass.
  assert.equal(judgeJobs(jobsOf().filter((j) => j.name !== "browser (4)"), 4).state, "failed");
  assert.equal(judgeJobs(jobsOf().filter((j) => j.name !== "browser-all"), 4).state, "failed");
  // browser-all failing on its own is a failure.
  assert.equal(judgeJobs(jobsOf({ "browser-all": "failure" }), 4).state, "failed");
});

test("a slice that passed only on a second try fails the gate (it is a fault, not a pass)", async () => {
  const c = clock();
  const api = fakeGithub({ runs: [runOf()], logs: { 902: sliceLog(178, 0, ["second try: days > eleven tickets"]) } });
  const r = await wait(api, c);
  assert.equal(r.ok, false);
  assert.match(r.why, /second try: days > eleven tickets|second try.*days > eleven tickets/);
  // The workflow's own script, echoed in the log, is not a second try.
  assert.deepEqual(readSlice(sliceLog(5)).secondTry, []);
});

test("a slice log with no summary line, or a count of nothing, fails the gate", async () => {
  let r = await wait(fakeGithub({ runs: [runOf()], logs: { 903: "2026-11-20T16:00:00.0Z ok   a > b" } }), clock());
  assert.equal(r.ok, false);
  assert.match(r.why, /browser \(3\) passed but its log has no summary line/);
  r = await wait(fakeGithub({ runs: [runOf()], logs: { 901: sliceLog(0), 902: sliceLog(0), 903: sliceLog(0), 904: sliceLog(0) } }), clock());
  assert.equal(r.ok, false);
  assert.match(r.why, /0 passed, 0 failed/);
});

test("a slice GitHub cancelled or timed out is run again once, then the gate passes", async () => {
  const c = clock();
  const api = fakeGithub({
    runs: [runOf({ conclusion: "failure" })],
    states: [
      runOf({ conclusion: "failure" }), // GitHub has not taken the re-run in yet
      runOf({ status: "queued", conclusion: null, run_attempt: 2 }),
      runOf({ run_attempt: 2 }),
    ],
    jobs: [jobsOf({ "browser (2)": "cancelled", "browser (4)": "timed_out", "browser-all": "failure" }), jobsOf()],
  });
  const logs = [];
  const r = await wait(api, c, { log: (s) => logs.push(s) });
  assert.equal(r.ok, true, r.why);
  assert.equal(api.calls.rerun, 1);
  assert.equal(r.run.attempt, 2);
  assert.equal(api.calls.jobs, 2, "the first attempt's jobs are not judged again before the re-run reports");
  assert.ok(logs.some((l) => /abandoned browser \(2\) \(cancelled\), browser \(4\) \(timed_out\)/.test(l)), logs.join("\n"));
});

test("abandoned twice fails the gate: one re-run only", async () => {
  const c = clock();
  const cancelled = jobsOf({ "browser (1)": "cancelled", "browser-all": "failure" });
  const api = fakeGithub({ runs: [runOf({ conclusion: "cancelled" })], states: [runOf({ run_attempt: 2, conclusion: "cancelled" })], jobs: [cancelled, cancelled] });
  const r = await wait(api, c);
  assert.equal(r.ok, false);
  assert.equal(api.calls.rerun, 1);
  assert.match(r.why, /browser \(1\) \(cancelled\), again/);
  // And a re-run GitHub refuses is said.
  const refused = await wait(fakeGithub({ runs: [runOf()], jobs: [cancelled], rerunFails: true }), clock());
  assert.equal(refused.ok, false);
  assert.match(refused.why, /would not run it again \(HTTP 403\)/);
});

test("a run that does not finish in time fails with a clear message", async () => {
  const c = clock();
  const running = runOf({ status: "in_progress", conclusion: null });
  const api = fakeGithub({ runs: [running], states: [running] });
  const r = await wait(api, c);
  assert.equal(r.ok, false);
  assert.match(r.why, /No result from GitHub after 40 minutes \(last: in_progress, attempt 1\)/);
  assert.match(r.fix, /actions\/runs\/500/);
  assert.match(r.fix, /--local/);
  assert.ok(api.calls.run + api.calls.runs <= 42, "about one ask a minute");
});

test("GitHub that stops answering fails the gate rather than waiting quietly", async () => {
  const c = clock();
  const api = fakeGithub();
  api.runs = () => {
    throw new Error("error connecting to api.github.com");
  };
  const r = await wait(api, c);
  assert.equal(r.ok, false);
  assert.match(r.why, /did not answer 5 times in a row \(error connecting to api\.github\.com\)/);
  assert.match(r.fix, /--local/);
});

test("gh not signed in, or GitHub not reachable, is said (and the gate offers --local, never falls back)", () => {
  const signedOut = githubCli("o/r", (args) => (args[0] === "auth" ? { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts." } : { code: 0, stdout: "o/r" }));
  assert.match(signedOut.reachable().why, /not signed in/);
  const noGh = githubCli("o/r", () => ({ code: 127, stdout: "", stderr: "no gh command on this Mac" }));
  assert.match(noGh.reachable().why, /gh is not installed/);
  const offline = githubCli("o/r", (args) => (args[0] === "auth" ? { code: 0 } : { code: 1, stdout: "", stderr: "error connecting to api.github.com\nmore" }));
  assert.match(offline.reachable().why, /cannot be reached for o\/r \(error connecting to api\.github\.com\)/);
  const gate = readFileSync(join(ROOT, "scripts", "gate.mjs"), "utf8");
  assert.match(gate, /if \(!can\.ok\) stop\(/);
  assert.match(gate, /npm run gate -- --local/);
  // --local is the old path, word for word: the local runner and its summary line.
  assert.match(gate, /if \(local\) \{\n\s+\/\/ The runner waits in line[^\n]*\n\s+const e2e = run\("e2e", "node", \["tests\/e2e\/run\.cjs"\]\);/);
  // The private-data scan comes before anything is pushed.
  assert.ok(gate.indexOf("scanTree()") < gate.indexOf("\"push\", \"-q\", \"origin\", head"), "scan before push");
});

test("the gh calls: the right addresses, and a job log read as text", () => {
  const seen = [];
  const gh = githubCli("o/r", (args) => {
    seen.push(args.join(" "));
    if (args.at(-1).includes("/runs?")) return { code: 0, stdout: JSON.stringify({ workflow_runs: [runOf()] }) };
    if (args.at(-1).includes("/jobs?")) return { code: 0, stdout: JSON.stringify({ jobs: jobsOf() }) };
    if (args.at(-1).endsWith("/logs")) return { code: 0, stdout: sliceLog(3) };
    if (args.at(-1).includes("actions/runs/")) return { code: 0, stdout: JSON.stringify(runOf()) };
    return { code: 1, stdout: "", stderr: "no" };
  });
  assert.equal(gh.runs(HEAD)[0].id, 500);
  assert.equal(gh.run(500).id, 500);
  assert.equal(gh.jobs(500).length, 6);
  assert.equal(readSlice(gh.log(901)).pass, 3);
  gh.rerun(500);
  assert.deepEqual(seen, [
    "api repos/o/r/actions/workflows/check.yml/runs?head_sha=" + HEAD + "&event=push&per_page=30",
    "api repos/o/r/actions/runs/500",
    "api repos/o/r/actions/runs/500/jobs?filter=latest&per_page=100",
    "api repos/o/r/actions/jobs/901/logs",
    "api -X POST repos/o/r/actions/runs/500/rerun-failed-jobs",
  ]);
});

test("check.yml's slices, the branch name and the repository are read as written", () => {
  const yml = readFileSync(join(ROOT, ".github", "workflows", "check.yml"), "utf8");
  assert.equal(sliceCount(yml), 4);
  assert.equal(sliceCount(yml.replace("shard: [1, 2, 3, 4]", "shard: [1, 2, 3]")), 0, "a slice the runner never runs");
  assert.equal(sliceCount(yml.replace("}}/4", "}}/5")), 0);
  assert.equal(sliceCount("jobs: {}"), 0);
  assert.equal(ciBranch(HEAD), "ci/release-a1b2c3d");
  assert.equal(judgePush({ remoteRef: "refs/heads/" + ciBranch(HEAD), localSha: HEAD, ci: { atHead: true, clean: true, found: 0 } }), null, "the push check lets it out");
  assert.equal(repoOf("https://github.com/moissmart1/mat.git"), "moissmart1/mat");
  assert.equal(repoOf("git" + "@github.com:moissmart1/mat.git"), "moissmart1/mat"); // in two pieces: the scan reads it as a mail address
  assert.equal(repoOf("https://example.com/x/y.git"), "");
});

test("ship takes the receipt from either runner under the same rules, and says which ran", () => {
  const base = { tree: "t".repeat(40), head: HEAD, at: "2026-11-20T12:00:00.000Z", appVersion: "34", backendStamp: "abc", unit: { pass: 900, fail: 0 }, e2e: { pass: 756, fail: 0, secondTry: [] } };
  const github = { ...base, runner: { kind: "github", repo: "o/r", runId: 500, attempt: 1, url: "https://github.com/o/r/actions/runs/500", branch: BRANCH, headSha: HEAD } };
  const local = { ...base, runner: { kind: "local" } };
  const old = { ...base }; // from before issue 9
  const at = { tree: base.tree, appVersion: "34" };
  for (const r of [github, local, old]) {
    assert.equal(judgeReceipt(r, at), null);
    assert.equal(judgePush({ remoteRef: "refs/heads/main", localSha: HEAD, receipt: r, commitStamp: "abc", live: "abc" }), null);
    assert.match(judgeReceipt({ ...r, appVersion: "33" }, at), /version 33/);
    assert.match(judgeReceipt({ ...r, tree: "u".repeat(40) }, at), /other files/);
    assert.match(judgeReceipt({ ...r, e2e: { pass: 750, fail: 1 } }, at), /failing tests/);
    assert.match(judgeReceipt({ ...r, unit: { pass: 0, fail: 0 } }, at), /no unit or no browser/);
  }
  assert.match(judgeReceipt(null, at), /not passed the gate/);
  assert.match(judgeReceipt({ ...github, runner: { ...github.runner, headSha: OTHER } }, at), /names no GitHub run/);
  assert.match(judgeReceipt({ ...github, runner: { ...github.runner, url: "https://example.com/x" } }, at), /names no GitHub run/);
  assert.equal(runnerText(github), "GitHub, run 500 (https://github.com/o/r/actions/runs/500)");
  assert.equal(runnerText({ ...github, runner: { ...github.runner, attempt: 2 } }), "GitHub, run 500 attempt 2 (https://github.com/o/r/actions/runs/500)");
  assert.equal(runnerText(local), "this Mac");
  assert.equal(runnerText(old), "this Mac");
  // ship judges the receipt before anything else and its first line names the runner.
  const ship = readFileSync(join(ROOT, "scripts", "ship.mjs"), "utf8");
  const firstStep = ship.indexOf("step(");
  assert.ok(ship.indexOf("judgeReceipt(receipt") < firstStep);
  assert.match(ship.slice(firstStep, firstStep + 80), /^step\("gate passed on " \+ runnerText\(receipt\)/);
});
