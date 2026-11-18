// One browser-test run at a time on this computer, whichever checkout starts
// it. Two at once make timing failures, and hand-written "wait until the other
// one is done" loops have deadlocked (a shell that waits for the runner's name
// matches its own command line). So the runner queues itself:
//
//   const leave = await takeTurn();   // returns when it is this run's turn
//   ...                                // run
//   leave();                           // the next in line goes
//
// The line is a folder of small ticket files, oldest first. A ticket whose
// process is gone is thrown away, so a run that crashed never blocks the
// rest. The folder is the same for every checkout (and for the Chicago app's
// copy of this file), so they all share one line.

const fs = require("fs");
const path = require("path");

const QUEUE = process.env.MAT_E2E_QUEUE || path.join(fs.existsSync("/tmp") ? "/tmp" : require("os").tmpdir(), "mat-e2e-queue");
const POLL_MS = 2000;
const WAIT_MAX_MS = 60 * 60 * 1000; // give up after an hour in line
const HEAD_OLD_MS = 40 * 60 * 1000; // the run in front has been going this long: say so

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// Runs started by an older copy of the runner (no ticket): they are in front too.
function unticketed(ticketPids) {
  try {
    const { execFileSync } = require("child_process");
    return execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim().match(/^(\d+)\s+(?:\S*\/)?node\s+(?:\S+\s+)*?tests\/e2e\/run\.cjs/))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .filter((pid) => pid !== process.pid && !ticketPids.includes(pid));
  } catch {
    return [];
  }
}

// The line, oldest first, without tickets whose process has gone.
function line() {
  let names = [];
  try {
    names = fs.readdirSync(QUEUE);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.filter((n) => /^\d+-\d+\.json$/.test(n)).sort()) {
    const pid = Number(name.slice(name.indexOf("-") + 1, -5));
    if (alive(pid)) out.push({ name, pid, since: Number(name.slice(0, name.indexOf("-"))) });
    else fs.rmSync(path.join(QUEUE, name), { force: true });
  }
  return out;
}

async function takeTurn({ say = console.log, now = () => Date.now() } = {}) {
  fs.mkdirSync(QUEUE, { recursive: true });
  // Thirteen digits, so names sort by time.
  const mine = String(now()).padStart(13, "0") + "-" + process.pid + ".json";
  const file = path.join(QUEUE, mine);
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, cwd: process.cwd(), args: process.argv.slice(2), at: new Date().toISOString() }));
  const leave = () => fs.rmSync(file, { force: true });
  process.on("exit", leave);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      leave();
      process.exit(130);
    });
  }
  const started = now();
  let told = "";
  for (;;) {
    const q = line();
    const loose = unticketed(q.map((t) => t.pid));
    const at = q.findIndex((t) => t.name === mine) + loose.length;
    if (at <= 0) return leave;
    const head = loose.length ? { pid: loose[0], since: started } : q[0];
    const mins = Math.round((now() - head.since) / 60000);
    const msg = "waiting for the test runner: " + at + " ahead (pid " + head.pid + " at the front for " + mins + " min)";
    if (msg !== told) say(msg);
    told = msg;
    if (now() - head.since > HEAD_OLD_MS && now() - started > 5 * 60 * 1000) {
      say("the run at the front (pid " + head.pid + ") has been going " + mins + " minutes: it may be stuck. Still waiting.");
    }
    if (now() - started > WAIT_MAX_MS) {
      leave();
      throw new Error("Gave up after an hour in line for the test runner (pid " + head.pid + " is at the front).");
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

module.exports = { takeTurn, line, QUEUE };
