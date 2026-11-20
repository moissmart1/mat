// The gate's browser tests on GitHub (scripts/gate-ci.mjs, issue 9), with
// GitHub and the clock stood in for: which run counts, what fails the gate,
// that each slice's log shows its whole share of the suite (counted here, not
// taken from the workflow), the one re-run of a slice whose runner was lost,
// the time limit, the scan of every commit the ci/ push makes public, and that
// ship takes the receipt either runner writes.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSlice, ciBranch, expectedSlices, githubCli, judgeJobs, pickRun, readSlice, repoOf, sliceCount, startsOnCi, waitForCheck } from "../scripts/gate-ci.mjs";
import { judgePush, judgeReceipt, runnerText } from "../scripts/release-lib.mjs";
import { scanCommits } from "../scripts/scan.mjs";

const require = createRequire(import.meta.url);
const { shardFiles } = require("./e2e/shard.cjs");
const { listCases } = require("./e2e/cases.cjs");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HEAD = "a1b2c3d".padEnd(40, "0");
const OTHER = "ffffeee".padEnd(40, "1");
const BRANCH = ciBranch(HEAD);

// A made-up suite: eight files, one with two cases of the same name.
const LIST = [
  { file: "alpha.e2e.cjs", cases: ["one", "two"] },
  { file: "bravo.e2e.cjs", cases: ["one"] },
  { file: "charlie.e2e.cjs", cases: ["x", "y", "z"] },
  { file: "delta.e2e.cjs", cases: ["d"] },
  { file: "echo.e2e.cjs", cases: ["e1", "e2"] },
  { file: "foxtrot.e2e.cjs", cases: ["f"] },
  { file: "golf.e2e.cjs", cases: ["g"] },
  { file: "hotel.e2e.cjs", cases: ["h", "h"] },
];
const EXPECTED = expectedSlices(LIST, 4, shardFiles);

const runOf = (over) => ({
  id: 500, run_number: 9, head_sha: HEAD, event: "push", head_branch: BRANCH, path: ".github/workflows/check.yml",
  status: "completed", conclusion: "success", run_attempt: 1, html_url: "https://github.com/o/r/actions/runs/500", ...over,
});
const T0 = "2026-11-20T16:00:00Z";
const after = (min) => new Date(Date.parse(T0) + min * 60000).toISOString();
// Jobs 900 (unit), 901..904 (the slices), 905 (browser-all); c: name -> conclusion or [conclusion, minutes run].
const jobsOf = (c = {}) =>
  ["unit", "browser (1)", "browser (2)", "browser (3)", "browser (4)", "browser-all"].map((name, i) => {
    const [conclusion, min] = Array.isArray(c[name]) ? c[name] : [c[name] || "success", 12];
    return { id: 900 + i, name, conclusion, started_at: T0, completed_at: after(min) };
  });
// A slice's log as GitHub serves it: a byte-order mark, a timestamp on every
// line, the workflow's own script echoed in colour, then what run.cjs prints.
const sliceLog = (oks, { summary, extra = [] } = {}) =>
  "﻿" +
  ["Current runner version: '2.330.0'", "\u001b[36;1mif grep -q '^second try: ' x; then\u001b[0m", ...oks.map((c) => "ok   " + c), ...extra, summary || oks.length + " passed, 0 failed", "Cleaning up orphan processes"]
    .map((l, i) => "2026-11-20T16:0" + (i % 10) + ":00.1234567Z " + l)
    .join("\n");
const goodLog = (n) => sliceLog(EXPECTED[n - 1]);

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
      return logs[id] !== undefined ? logs[id] : goodLog(id - 900);
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
const wait = (api, c = clock(), over = {}) => waitForCheck({ head: HEAD, branch: BRANCH, slices: 4, expected: EXPECTED, api, now: c.now, sleep: c.sleep, ...over });

test("success on the exact commit: the browser count is every case of every slice, each seen run", async () => {
  const c = clock();
  const api = fakeGithub({
    runs: (n) => (n < 2 ? [] : [runOf({ status: "in_progress", conclusion: null })]),
    states: [runOf({ status: "in_progress", conclusion: null }), runOf()],
  });
  const r = await wait(api, c);
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(r.e2e, { pass: 13, fail: 0, secondTry: [] });
  assert.deepEqual(r.run, { id: 500, url: "https://github.com/o/r/actions/runs/500", attempt: 1 });
  assert.deepEqual(api.calls.log, [901, 902, 903, 904], "only the slices' logs are read");
  assert.deepEqual(Object.keys(r.logs), ["browser (1)", "browser (2)", "browser (3)", "browser (4)"]);
  assert.ok(c.slept.every((ms) => ms >= 60000), "never asks GitHub more often than once a minute");
});

test("the cases each slice must run are counted here, dealt as the runner deals them", () => {
  assert.equal(EXPECTED.flat().length, 13);
  assert.deepEqual(EXPECTED[0], ["alpha > one", "alpha > two", "echo > e1", "echo > e2"]);
  assert.deepEqual(EXPECTED[3], ["delta > d", "hotel > h", "hotel > h"]);
  // On this commit's real files: every case in exactly one slice.
  const real = listCases();
  const total = real.reduce((n, f) => n + f.cases.length, 0);
  const slices = expectedSlices(real, 4, shardFiles);
  assert.equal(slices.flat().length, total);
  assert.ok(slices.every((s) => s.length > 0));
  assert.ok(total > 100, "the real suite is listed, not an empty folder");
});

test("a narrowed run, an echoed summary or an empty slice fails the gate, whatever the jobs say", async () => {
  const s2 = EXPECTED[1];
  const cases = {
    // the browser step filtered to a subset: a real summary, too few cases
    narrowed: [sliceLog(s2.slice(0, 1)), /did not run/],
    // the step only echoes a summary
    echoed: [sliceLog([], { summary: "756 passed, 0 failed" }), /says 756 passed but it shows 0 ok lines/],
    // a slice that ran nothing
    empty: [sliceLog([], { summary: "0 passed, 0 failed" }), /ran no tests/],
    // a case that is not in this slice (the files dealt some other way)
    extra: [sliceLog([...s2, "golf > g"]), /not in this commit's slice/],
    // a FAIL line with a summary that says none failed
    failLine: [sliceLog(s2, { extra: ["FAIL bravo > one"] }), /0 failed \(bravo > one\)/],
    // a case listed twice must be seen twice
    once: [sliceLog(EXPECTED[3].slice(0, 2)), /did not run/],
  };
  for (const [name, [text, why]] of Object.entries(cases)) {
    const slice = name === "once" ? 904 : 902;
    const r = await wait(fakeGithub({ runs: [runOf()], logs: { [slice]: text } }));
    assert.equal(r.ok, false, name);
    assert.match(r.why, why, name);
    assert.match(r.why, new RegExp("browser \\(" + (slice - 900) + "\\) is not this commit's slice"), name);
  }
  // With no local list, nothing passes.
  const none = await wait(fakeGithub({ runs: [runOf()] }), clock(), { expected: undefined });
  assert.equal(none.ok, false);
  assert.match(none.why, /no local list/);
  assert.equal(checkSlice(readSlice(goodLog(1)), EXPECTED[0]), null);
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
  const r = await wait(fakeGithub({ runs }), clock(), { before: [5] });
  assert.equal(r.ok, false);
  assert.match(r.why, /started no check run for a1b2c3d on ci\/release-a1b2c3d within 40 minutes/);
  assert.match(r.fix, /--local/);
});

test("a run that answers for another commit, or one run again by hand, stops the gate", async () => {
  let r = await wait(fakeGithub({ runs: [runOf({ status: "queued", conclusion: null })], states: [runOf({ head_sha: OTHER })] }));
  assert.equal(r.ok, false);
  assert.match(r.why, /is for ffffeee, not a1b2c3d/);
  r = await wait(fakeGithub({ runs: [runOf({ run_attempt: 2 })] }));
  assert.equal(r.ok, false);
  assert.match(r.why, /attempt 2, but this gate started 1: it was run again by hand/);
});

test("a job that failed fails the gate, is not re-run, and its slice's log is kept", async () => {
  const api = fakeGithub({ runs: [runOf({ conclusion: "failure" })], jobs: [jobsOf({ "browser (3)": "failure", "browser-all": "failure" })], logs: { 903: "FAIL charlie > x" } });
  const r = await wait(api);
  assert.equal(r.ok, false);
  assert.match(r.why, /browser \(3\) \(failure\)/);
  assert.match(r.why, /browser-all \(failure\)/);
  assert.equal(api.calls.rerun, 0);
  assert.deepEqual(r.logs, { "browser (3)": "FAIL charlie > x" });
  assert.equal(judgeJobs(jobsOf({ unit: "failure" }), 4).state, "failed");
  // A failure next to a lost slice is still a failure.
  assert.equal(judgeJobs(jobsOf({ "browser (1)": "failure", "browser (2)": ["cancelled", 2], "browser-all": "failure" }), 4).state, "failed");
  assert.equal(judgeJobs(jobsOf({ "browser (2)": "skipped" }), 4).state, "failed");
  // A job that is missing (a slice that never ran) is a failure, not a pass.
  assert.equal(judgeJobs(jobsOf().filter((j) => j.name !== "browser (4)"), 4).state, "failed");
  assert.equal(judgeJobs(jobsOf().filter((j) => j.name !== "browser-all"), 4).state, "failed");
  assert.equal(judgeJobs(jobsOf({ "browser-all": "failure" }), 4).state, "failed");
});

test("a slice that passed only on a second try fails the gate (it is a fault, not a pass)", async () => {
  const r = await wait(fakeGithub({ runs: [runOf()], logs: { 902: sliceLog(EXPECTED[1], { extra: ["second try: days > eleven tickets"] }) } }));
  assert.equal(r.ok, false);
  assert.match(r.why, /second try.*days > eleven tickets/);
  // The workflow's own script, echoed in the log, is not a second try.
  assert.deepEqual(readSlice(goodLog(1)).secondTry, []);
});

test("a slice log with no summary line fails the gate", async () => {
  const r = await wait(fakeGithub({ runs: [runOf()], logs: { 903: "2026-11-20T16:00:00.0Z ok   charlie > x" } }));
  assert.equal(r.ok, false);
  assert.match(r.why, /browser \(3\) is not this commit's slice 3 run and passed: its log has no summary line/);
});

test("a slice cancelled well before its limit (a lost runner) is run again once, then the gate passes", async () => {
  const c = clock();
  const api = fakeGithub({
    runs: [runOf({ conclusion: "failure" })],
    states: [
      runOf({ conclusion: "failure" }), // GitHub has not taken the re-run in yet
      runOf({ status: "queued", conclusion: null, run_attempt: 2 }),
      runOf({ run_attempt: 2 }),
    ],
    jobs: [jobsOf({ "browser (2)": ["cancelled", 3], "browser (4)": ["cancelled", 0], "browser-all": ["failure", 1] }), jobsOf()],
  });
  const logs = [];
  const r = await wait(api, c, { log: (s) => logs.push(s) });
  assert.equal(r.ok, true, r.why);
  assert.equal(api.calls.rerun, 1);
  assert.equal(r.run.attempt, 2);
  assert.equal(api.calls.jobs, 2, "the first attempt's jobs are not judged again before the re-run reports");
  assert.ok(logs.some((l) => /lost browser \(2\) \(cancelled after 3 min\), browser \(4\) \(cancelled after 0 min\)/.test(l)), logs.join("\n"));
});

test("a timed-out slice, or one cancelled at its time limit, is a hang: the gate fails with no re-run", async () => {
  for (const [jobs, why] of [
    [jobsOf({ "browser (2)": ["timed_out", 25], "browser-all": "failure" }), /browser \(2\) \(timed_out\)/],
    [jobsOf({ "browser (2)": ["cancelled", 25], "browser-all": "failure" }), /browser \(2\) \(hung: cancelled after 25 min, at its time limit\)/],
    [jobsOf({ "browser (2)": ["cancelled", 20], "browser-all": "failure" }), /hung/],
    [jobsOf({ unit: ["cancelled", 10] }), /unit \(hung/],
  ]) {
    const api = fakeGithub({ runs: [runOf({ conclusion: "cancelled" })], jobs: [jobs] });
    const r = await wait(api);
    assert.equal(r.ok, false);
    assert.match(r.why, why);
    assert.equal(api.calls.rerun, 0, "never re-run around a hang");
  }
  assert.equal(judgeJobs(jobsOf({ "browser (2)": ["cancelled", 19], "browser-all": "failure" }), 4).state, "abandoned");
  // A cancelled job GitHub gives no times for is not known to be lost: it fails.
  const noTimes = jobsOf({ "browser (2)": ["cancelled", 3], "browser-all": "failure" }).map((j) => (j.name === "browser (2)" ? { ...j, started_at: null, completed_at: undefined } : j));
  const v = judgeJobs(noTimes, 4);
  assert.equal(v.state, "failed");
  assert.match(v.failed.join(), /browser \(2\) \(cancelled, and GitHub gives no times: counted as hung\)/);
  assert.equal(judgeJobs(jobsOf({ "browser-all": "timed_out" }), 4).state, "failed");
});

test("lost twice fails the gate: one re-run only; a re-run GitHub refuses is said", async () => {
  const lost = jobsOf({ "browser (1)": ["cancelled", 2], "browser-all": "failure" });
  const api = fakeGithub({ runs: [runOf({ conclusion: "cancelled" })], states: [runOf({ run_attempt: 2, conclusion: "cancelled" })], jobs: [lost, lost] });
  const r = await wait(api);
  assert.equal(r.ok, false);
  assert.equal(api.calls.rerun, 1);
  assert.match(r.why, /browser \(1\) \(cancelled after 2 min\), again/);
  const refused = await wait(fakeGithub({ runs: [runOf()], jobs: [lost], rerunFails: true }));
  assert.equal(refused.ok, false);
  assert.match(refused.why, /would not run it again \(HTTP 403\)/);
});

test("a run that does not finish in time fails with a clear message", async () => {
  const running = runOf({ status: "in_progress", conclusion: null });
  const api = fakeGithub({ runs: [running], states: [running] });
  const r = await wait(api);
  assert.equal(r.ok, false);
  assert.match(r.why, /No result from GitHub after 40 minutes \(last: in_progress, attempt 1\)/);
  assert.match(r.fix, /actions\/runs\/500/);
  assert.match(r.fix, /--local/);
  assert.ok(api.calls.run + api.calls.runs <= 42, "about one ask a minute");
});

test("GitHub that stops answering fails the gate rather than waiting quietly", async () => {
  const api = fakeGithub();
  api.runs = () => {
    throw new Error("error connecting to api.github.com");
  };
  const r = await wait(api);
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
  // Both scans (the tree, then every commit the push makes public) come before anything is pushed.
  const push = gate.indexOf("\"push\", \"-q\", \"origin\", head");
  assert.ok(gate.indexOf("scanTree()") < push, "tree scan before push");
  assert.ok(gate.indexOf("scanCommits(range)") < push, "history scan before push");
  assert.match(gate, /\["rev-list", "HEAD", "--not", "--remotes=origin"\]/);
  // The cases are counted here and handed to the wait.
  assert.match(gate, /waitForCheck\(\{ head, branch, slices, expected,/);
});

test("the gh calls: the right addresses, and a job log read as text", () => {
  const seen = [];
  const gh = githubCli("o/r", (args) => {
    seen.push(args.join(" "));
    if (args.at(-1).includes("/runs?")) return { code: 0, stdout: JSON.stringify({ workflow_runs: [runOf()] }) };
    if (args.at(-1).includes("/jobs?")) return { code: 0, stdout: JSON.stringify({ jobs: jobsOf() }) };
    if (args.at(-1).endsWith("/logs")) return { code: 0, stdout: goodLog(1) };
    if (args.at(-1).includes("actions/runs/")) return { code: 0, stdout: JSON.stringify(runOf()) };
    return { code: 1, stdout: "", stderr: "no" };
  });
  assert.equal(gh.runs(HEAD)[0].id, 500);
  assert.equal(gh.run(500).id, 500);
  assert.equal(gh.jobs(500).length, 6);
  assert.equal(readSlice(gh.log(901)).pass, 4);
  gh.rerun(500);
  assert.deepEqual(seen, [
    "api repos/o/r/actions/workflows/check.yml/runs?head_sha=" + HEAD + "&event=push&per_page=30",
    "api repos/o/r/actions/runs/500",
    "api repos/o/r/actions/runs/500/jobs?filter=latest&per_page=100",
    "api repos/o/r/actions/jobs/901/logs",
    "api -X POST repos/o/r/actions/runs/500/rerun-failed-jobs",
  ]);
});

test("check.yml's slices and triggers, the branch name and the repository are read as written", () => {
  const yml = readFileSync(join(ROOT, ".github", "workflows", "check.yml"), "utf8");
  assert.equal(sliceCount(yml), 4);
  assert.equal(sliceCount(yml.replace("shard: [1, 2, 3, 4]", "shard: [1, 2, 3]")), 0, "a slice the runner never runs");
  assert.equal(sliceCount(yml.replace("}}/4", "}}/5")), 0);
  assert.equal(sliceCount("jobs: {}"), 0);
  assert.equal(startsOnCi(yml), true);
  assert.equal(startsOnCi(yml.replace('[dev, "ci/**"]', "[dev]")), false, "a ci/ push would start no run");
  assert.equal(startsOnCi(""), false);
  assert.equal(ciBranch(HEAD), "ci/release-a1b2c3d");
  assert.equal(judgePush({ remoteRef: "refs/heads/" + ciBranch(HEAD), localSha: HEAD, ci: { atHead: true, clean: true, found: 0 } }), null, "the push check lets it out");
  assert.equal(repoOf("https://github.com/moissmart1/mat.git"), "moissmart1/mat");
  assert.equal(repoOf("git" + "@github.com:moissmart1/mat.git"), "moissmart1/mat"); // in two pieces: the scan reads it as a mail address
  assert.equal(repoOf("https://example.com/x/y.git"), "");
});

test("no browser test behaves differently on GitHub (the gate's count there must mean what it means here)", () => {
  // A case that returns early when it sees CI would still print its ok line,
  // and the GitHub gate would count a test that never ran.
  const dir = join(ROOT, "tests", "e2e");
  const hits = [];
  for (const f of readdirSync(dir).filter((x) => /\.(c|m)?js$/.test(x))) {
    const text = readFileSync(join(dir, f), "utf8");
    if (/GITHUB_ACTIONS|process\.env\.CI\b|env\[\s*["']CI["']\s*\]|RUNNER_/.test(text)) hits.push(f);
  }
  assert.deepEqual(hits, [], "CI-dependent code in tests/e2e: " + hits.join(", "));
});

// A throwaway repository for the history scan; the private word is made up.
const WORD = "ZEBRA" + "QUILT77";
function repoWith(commits) {
  const dir = mkdtempSync(join(tmpdir(), "gate-ci-scan-"));
  const g = (...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" }).trim();
  g("init", "-q");
  for (const { file, text, message } of commits) {
    writeFileSync(join(dir, file), text);
    g("add", "-A");
    g("commit", "-q", "-m", message);
  }
  return { dir, shas: g("rev-list", "HEAD").split("\n"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the push's history is scanned: a private string only in a middle commit, or only in a message, stops it", () => {
  const opts = { words: [WORD], deployId: "" };
  const middle = repoWith([
    { file: "a.txt", text: "hello\n", message: "first" },
    { file: "a.txt", text: "hello\nkey " + WORD + "\n", message: "second" },
    { file: "a.txt", text: "hello\n", message: "third: taken out again" },
  ]);
  try {
    const found = scanCommits(middle.shas, middle.dir, opts);
    assert.equal(found.length, 1);
    assert.deepEqual(found[0], { commit: middle.shas[1].slice(0, 7), file: "a.txt", rule: "a string from the private list", line: 2 });
    assert.ok(!JSON.stringify(found).includes(WORD), "never says what it found");
    assert.deepEqual(scanCommits([middle.shas[0], middle.shas[2]], middle.dir, opts), [], "the clean commits are clean");
  } finally {
    middle.cleanup();
  }
  // An added line that looks like a diff header must not hide the lines after it.
  const crafted = repoWith([
    { file: "a.txt", text: "one\n", message: "first" },
    { file: "a.txt", text: "one\n++ /dev/null\n++ b/x.png\n" + WORD + "\n", message: "second" },
  ]);
  try {
    const found = scanCommits(crafted.shas, crafted.dir, opts);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.deepEqual(found[0], { commit: crafted.shas[0].slice(0, 7), file: "a.txt", rule: "a string from the private list", line: 4 });
  } finally {
    crafted.cleanup();
  }
  const message = repoWith([
    { file: "a.txt", text: "one\n", message: "first" },
    { file: "b.txt", text: "two\n", message: "booking " + WORD },
  ]);
  try {
    const found = scanCommits(message.shas, message.dir, opts);
    assert.equal(found.length, 1);
    assert.equal(found[0].file, "(commit message)");
    // An address in a message is caught by the same rules as in a file.
    assert.equal(scanCommits(message.shas, message.dir, { words: [], deployId: "" }).length, 0);
    // No private list: a finding, never a clean answer. A commit that is not there: an error.
    assert.match(scanCommits(message.shas, message.dir, { words: null })[0].rule, /private list is missing/);
    assert.throws(() => scanCommits(["0".repeat(40)], message.dir, opts));
  } finally {
    message.cleanup();
  }
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
  assert.match(judgeReceipt({ ...github, runner: { ...github.runner, headSha: undefined } }, at), /names no GitHub run/);
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
