// The gate's browser tests on GitHub (issue 9). `npm run gate` pushes the
// release candidate to its own ci/ branch, waits for the `check` run on
// exactly that commit, and reads the browser count from the slices' logs.
// `npm run gate -- --local` runs them on this Mac instead, as before.
//
// Everything that talks to GitHub comes in through `api` (githubCli below is
// the real one, made of `gh` calls), so tests/gate-ci.test.js can stand in for
// GitHub and the clock. Nothing here sees or prints a key: the check workflow
// has no secrets, and gh keeps its own token to itself.

import { spawnSync } from "node:child_process";

export const WAIT_MS = 40 * 60 * 1000; // the whole run: four slices take about 12 minutes
export const RERUN_WAIT_MS = 30 * 60 * 1000; // a slice GitHub lost, run again once
export const POLL_MS = 60 * 1000; // never asks GitHub more often than this
export const MAX_API_MISSES = 5; // asks in a row that GitHub does not answer

export const ciBranch = (head) => "ci/release-" + head.slice(0, 7);
const sliceName = (n) => "browser (" + n + ")";
// A job GitHub cancelled well before its time limit (check.yml: unit 10
// minutes, a slice 25) most likely lost its runner: worth one more try. One
// cancelled near the limit hung, and a hang is a fault in the code under test,
// not something to re-run around; so is `timed_out`.
export const LOST_BEFORE_MS = { unit: 8 * 60 * 1000, slice: 20 * 60 * 1000, "browser-all": 4 * 60 * 1000 };
const ranMs = (j) => {
  const a = Date.parse(j.started_at || "");
  const b = Date.parse(j.completed_at || "");
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : 0;
};
const limitOf = (name) => LOST_BEFORE_MS[name] || LOST_BEFORE_MS.slice;

// How many slices check.yml runs. It must be exactly 1..N and the runner must
// be told /N, or part of the suite would never run and still look green.
export function sliceCount(checkYml) {
  const m = String(checkYml).match(/^\s*shard:\s*\[([^\]]*)\]/m);
  const d = String(checkYml).match(/--shard \$\{\{ matrix\.shard \}\}\/(\d+)/);
  if (!m || !d) return 0;
  const shards = m[1].split(",").map((s) => Number(s.trim()));
  const n = shards.length;
  if (Number(d[1]) !== n || shards.some((v, i) => v !== i + 1)) return 0;
  return n;
}

// Whether a push of a ci/ branch starts check.yml at all (else the gate would
// wait 40 minutes for a run that never comes).
export function startsOnCi(checkYml) {
  const m = String(checkYml).match(/^\s*push:\s*\n\s*branches:\s*\[([^\]]*)\]/m);
  return !!m && /["']?ci\/\*\*["']?/.test(m[1]);
}

// owner/repo of a github.com remote address, or "".
export function repoOf(url) {
  const m = String(url).trim().match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? m[1] + "/" + m[2] : "";
}

// The run that tested exactly this commit: the `check` workflow, started by
// the push of our own ci/ branch (a pull_request run with the same head sha
// tests a merge with its base, not this commit), and not one that was there
// before this gate pushed. The newest if there are several.
export function pickRun(runs, { head, branch, before = [] }) {
  const seen = new Set(before.map(String));
  const mine = (runs || []).filter(
    (r) => r && r.head_sha === head && r.event === "push" && r.head_branch === branch &&
      String(r.path || "").replace(/@.*$/, "") === ".github/workflows/check.yml" && !seen.has(String(r.id)),
  );
  mine.sort((a, b) => Number(b.run_number || 0) - Number(a.run_number || 0) || Number(b.id) - Number(a.id));
  return mine[0] || null;
}

// What the jobs of a finished run say: "success", "abandoned" (GitHub lost a
// runner: a job cancelled well before its limit, worth one more try) or
// "failed" (anything else that is not a success, a hang included).
export function judgeJobs(jobs, slices) {
  const by = new Map((jobs || []).map((j) => [j.name, j]));
  const needed = ["unit", ...Array.from({ length: slices }, (_, i) => sliceName(i + 1))];
  const failed = [];
  const abandoned = [];
  const missing = needed.filter((n) => !by.has(n));
  if (!by.has("browser-all")) missing.push("browser-all");
  const lost = (name, j) => j.conclusion === "cancelled" && ranMs(j) < limitOf(name);
  for (const n of needed) {
    const j = by.get(n);
    if (!j || j.conclusion === "success") continue;
    if (lost(n, j)) abandoned.push(n + " (cancelled after " + Math.round(ranMs(j) / 60000) + " min)");
    else if (j.conclusion === "cancelled") failed.push(n + " (hung: cancelled after " + Math.round(ranMs(j) / 60000) + " min, at its time limit)");
    else failed.push(n + " (" + (j.conclusion || "no result") + ")");
  }
  const all = by.get("browser-all");
  if (all && all.conclusion !== "success") {
    // browser-all only says whether every slice passed: when a slice was
    // lost it fails with it, and comes back with the re-run.
    if ((abandoned.length && !failed.length && all.conclusion !== "timed_out") || lost("browser-all", all)) abandoned.push("browser-all (" + all.conclusion + ")");
    else failed.push("browser-all (" + (all.conclusion || "no result") + ")");
  }
  for (const j of jobs || []) {
    if (needed.includes(j.name) || j.name === "browser-all") continue;
    if (j.conclusion !== "success" && j.conclusion !== "skipped") failed.push(j.name + " (" + (j.conclusion || "no result") + ")");
  }
  const state = missing.length || failed.length ? "failed" : abandoned.length ? "abandoned" : "success";
  return { state, failed, abandoned, missing };
}

// A slice's log, as GitHub keeps it: a timestamp before every line.
export function readSlice(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ""));
  let summary = null;
  for (const l of lines) {
    const m = l.match(/^(\d+) passed, (\d+) failed$/);
    if (m) summary = { pass: Number(m[1]), fail: Number(m[2]) };
  }
  const secondTry = lines.filter((l) => l.startsWith("second try: ")).map((l) => l.slice(12));
  const ok = lines.filter((l) => l.startsWith("ok   ")).map((l) => l.slice(5));
  const failLines = lines.filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5));
  return { found: !!summary, pass: summary ? summary.pass : 0, fail: summary ? summary.fail : 0, secondTry, ok, failLines };
}

// What each slice must run: every case of every file (listed here, from this
// commit's files: tests/e2e/cases.cjs), dealt into slices exactly as the
// runner deals them (tests/e2e/shard.cjs). Not what the workflow under test
// says it runs. [[ "file > case", ... ] per slice]
export function expectedSlices(list, slices, shardFiles) {
  const byFile = new Map(list.map((f) => [f.file, f.cases]));
  const out = [];
  for (let n = 1; n <= slices; n++) {
    out.push(shardFiles([...byFile.keys()], n, slices).flatMap((file) => byFile.get(file).map((c) => file.replace(/\.e2e\.cjs$/, "") + " > " + c)));
  }
  return out;
}

// Why a slice's log does not show that slice of the suite run and passed, or
// null. Every case must have its own `ok` line, as often as it is listed, and
// nothing else: so a narrowed run, an echoed summary or an empty slice fail.
export function checkSlice(s, expected) {
  if (!s.found) return "its log has no summary line";
  if (s.fail || s.failLines.length) return s.fail + " failed (" + s.failLines.slice(0, 3).join("; ") + ")";
  if (!(s.pass > 0)) return "it ran no tests";
  if (s.ok.length !== s.pass) return "its summary says " + s.pass + " passed but it shows " + s.ok.length + " ok lines";
  const want = new Map();
  for (const c of expected) want.set(c, (want.get(c) || 0) + 1);
  for (const c of s.ok) want.set(c, (want.get(c) || 0) - 1);
  const missing = [...want].filter(([, v]) => v > 0).map(([k]) => k);
  const extra = [...want].filter(([, v]) => v < 0).map(([k]) => k);
  if (missing.length) return missing.length + " of its " + expected.length + " cases did not run (" + missing.slice(0, 3).join("; ") + ")";
  if (extra.length) return "it ran cases that are not in this commit's slice (" + extra.slice(0, 3).join("; ") + ")";
  return null;
}

// GitHub through the gh command line. run(args) -> { code, stdout, stderr }.
export function githubCli(repo, run = ghRun) {
  const api = (path, extra = []) => {
    const r = run(["api", ...extra, "repos/" + repo + "/" + path]);
    if (r.code !== 0) throw new Error(firstLine(r.stderr || r.stdout) || "gh api " + path + " failed");
    return r.stdout;
  };
  const json = (path) => JSON.parse(api(path));
  return {
    // Signed in, and GitHub answers for this repository.
    reachable() {
      const auth = run(["auth", "status", "--hostname", "github.com"]);
      if (auth.code === 127) return { ok: false, why: "gh is not installed (" + firstLine(auth.stderr) + ")." };
      if (auth.code !== 0) return { ok: false, why: "gh is not signed in to GitHub (`gh auth status`)." };
      const r = run(["api", "repos/" + repo, "--jq", ".full_name"]);
      if (r.code !== 0) return { ok: false, why: "GitHub cannot be reached for " + repo + " (" + (firstLine(r.stderr) || "no answer") + ")." };
      return { ok: true };
    },
    runs(head) {
      const j = json("actions/workflows/check.yml/runs?head_sha=" + head + "&event=push&per_page=30");
      return j.workflow_runs || [];
    },
    run: (id) => json("actions/runs/" + id),
    jobs: (id) => json("actions/runs/" + id + "/jobs?filter=latest&per_page=100").jobs || [],
    log: (jobId) => api("actions/jobs/" + jobId + "/logs"),
    rerun: (id) => api("actions/runs/" + id + "/rerun-failed-jobs", ["-X", "POST"]),
  };
}

function ghRun(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { code: 127, stdout: "", stderr: r.error.code === "ENOENT" ? "no gh command on this Mac" : String(r.error.message) };
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

const firstLine = (s) => String(s || "").trim().split("\n")[0];
const minutes = (ms) => Math.round(ms / 60000);

// Waits for the check run on `head` (already pushed to `branch`), re-runs
// once what GitHub abandoned, and reads the browser count. Resolves with
//   { ok: true, run: { id, url, attempt }, e2e: { pass, fail, secondTry }, logs }
//   { ok: false, why, fix, run }
export async function waitForCheck({
  head, branch, slices, expected, api, before = [],
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), log = () => {},
  waitMs = WAIT_MS, rerunWaitMs = RERUN_WAIT_MS, pollMs = POLL_MS,
}) {
  if (!(slices > 0)) return { ok: false, why: "check.yml does not split the browser tests into slices 1..N with a matching /N.", fix: "Fix .github/workflows/check.yml, or run `npm run gate -- --local`." };
  if (!Array.isArray(expected) || expected.length !== slices) return { ok: false, why: "There is no local list of the cases each slice must run.", fix: "Check `node tests/e2e/cases.cjs`, or run `npm run gate -- --local`." };
  const started = now();
  let deadline = started + waitMs;
  let run = null;
  let wantAttempt = 1;
  let reran = false;
  let misses = 0;
  let lastState = "";
  const logs = {};
  const fail = (why, fix) => ({ ok: false, why, fix, logs, run: run && { id: run.id, url: run.html_url } });
  for (;;) {
    let r = null;
    try {
      r = run ? api.run(run.id) : pickRun(api.runs(head), { head, branch, before });
      misses = 0;
    } catch (e) {
      if (++misses >= MAX_API_MISSES) return fail("GitHub did not answer " + misses + " times in a row (" + firstLine(e.message) + ").", "Check the connection and `gh auth status`, then run the gate again, or `npm run gate -- --local`.");
    }
    if (r && r.head_sha !== head) return fail("GitHub's run " + r.id + " is for " + String(r.head_sha).slice(0, 7) + ", not " + head.slice(0, 7) + ".", "Run the gate again.");
    if (r && !run) {
      run = r;
      log("GitHub run " + r.html_url);
    }
    if (r) {
      run = r;
      const state = r.status + (r.conclusion ? " " + r.conclusion : "") + ", attempt " + r.run_attempt;
      if (state !== lastState) log("GitHub: " + state);
      lastState = state;
    }
    // Only the attempts this gate started count: one run again by hand while
    // the gate waited could have been re-run around a real failure.
    if (r && Number(r.run_attempt) > wantAttempt) return fail("GitHub's run is at attempt " + r.run_attempt + ", but this gate started " + wantAttempt + ": it was run again by hand.", "Run the gate again (a fresh run), or `npm run gate -- --local`.");
    if (r && r.status === "completed" && Number(r.run_attempt) === wantAttempt) {
      let jobs;
      try {
        jobs = api.jobs(r.id);
      } catch (e) {
        return fail("GitHub would not list the run's jobs (" + firstLine(e.message) + ").", "Run the gate again, or `npm run gate -- --local`.");
      }
      const v = judgeJobs(jobs, slices);
      if (v.state === "abandoned" && !reran) {
        try {
          api.rerun(r.id);
        } catch (e) {
          return fail("GitHub lost " + v.abandoned.join(", ") + " and would not run it again (" + firstLine(e.message) + ").", "See " + r.html_url);
        }
        reran = true;
        wantAttempt = Number(r.run_attempt) + 1;
        deadline = Math.max(deadline, now() + rerunWaitMs);
        log("GitHub lost " + v.abandoned.join(", ") + ": running it once more");
      } else if (v.state !== "success") {
        // The logs of the slices that failed are kept for reading here (GitHub's expire).
        for (const j of jobs) {
          if (/^browser \(\d+\)$/.test(j.name) && j.conclusion !== "success") {
            try {
              logs[j.name] = api.log(j.id);
            } catch {
              // the run's address is in the message
            }
          }
        }
        const what = [...v.failed, ...v.missing.map((n) => n + " (missing)"), ...v.abandoned.map((n) => n + (reran ? ", again" : ""))];
        return fail("The check run on GitHub did not pass: " + what.join(", ") + ".", "See " + r.html_url);
      } else {
        // Every required job passed: the count comes from each slice's own log.
        const e2e = { pass: 0, fail: 0, secondTry: [] };
        for (let n = 1; n <= slices; n++) {
          const job = jobs.find((j) => j.name === sliceName(n));
          let text;
          try {
            text = api.log(job.id);
          } catch (e) {
            return fail("Could not read the log of " + sliceName(n) + " (" + firstLine(e.message) + "), so there is no browser count.", "Run the gate again, or `npm run gate -- --local`.");
          }
          logs[sliceName(n)] = text;
          const s = readSlice(text);
          if (s.secondTry.length) return fail("Passed only on a second try (a fault, not a pass): " + s.secondTry.join("; ") + ".", "See " + r.html_url);
          const why = checkSlice(s, expected[n - 1]);
          if (why) return fail(sliceName(n) + " is not this commit's slice " + n + " run and passed: " + why + ".", "See " + r.html_url + ". The gate counts the cases itself; check.yml must run the whole suite.");
          e2e.pass += s.pass;
          e2e.fail += s.fail;
          e2e.secondTry.push(...s.secondTry);
        }
        if (e2e.fail || !e2e.pass) return fail("Browser tests on GitHub: " + e2e.pass + " passed, " + e2e.fail + " failed.", "See " + r.html_url);
        if (e2e.secondTry.length) return fail("Passed only on a second try (a fault, not a pass): " + e2e.secondTry.join("; ") + ".", "See " + r.html_url);
        return { ok: true, run: { id: r.id, url: r.html_url, attempt: Number(r.run_attempt) }, e2e, logs };
      }
    }
    if (now() >= deadline) {
      return run
        ? fail("No result from GitHub after " + minutes(now() - started) + " minutes (last: " + lastState + ").", "See " + run.html_url + ". Run the gate again later, or `npm run gate -- --local`.")
        : fail("GitHub started no check run for " + head.slice(0, 7) + " on " + branch + " within " + minutes(waitMs) + " minutes.", "Look at the repository's Actions tab, or run `npm run gate -- --local`.");
    }
    await sleep(pollMs);
  }
}
