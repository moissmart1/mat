// Guards the browser tests (tests/e2e/*.e2e.cjs) against the two shapes that
// made this week's CI flakes (see the flakes-sweep report, 2026-11-21):
//
// 1. A wait on a sheet's is-open class. The class goes on as the 0.5 s slide
//    starts, so a tap aimed then lands where the control was, not where it is
//    (the register's keys in line.e2e, the hotel card's Done in stopedit).
//    Wait with helpers.cjs atRest(page, "#id") instead, opening or closing.
//    Asserting the class (assert.equal(await isOpen(...))) is fine: only a
//    wait, until(...), on it is refused. A wait that must look at the class
//    itself (one that moves the page's clock on while it waits) says why on
//    the line above, "// class wait: <reason>", and is followed by atRest.
// 2. A real-time sleep in Node, await new Promise((r) => setTimeout(r, ms)),
//    including a fake backend that answers after ms and is then checked "has
//    not answered yet" (polish.e2e before 903623a). Hold such an answer on a
//    promise the test releases, or wait on a concrete condition. The spots
//    below are allowed, each with its reason: they wait, then check that
//    something is absent (or delay to make requests overlap), so a slow
//    runner can only make them pass without testing, never fail.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "e2e");

// Every sliding sheet or panel the app opens with is-open.
const SHEETS = ["stay", "reg", "stop", "you", "allDays", "line", "hist", "driver", "bulk", "staySheet", "book"];

// Allowed real-time sleeps: file -> [{ next: the first words of the line the
// sleep comes before, why }]. Line numbers move; the guarded check does not.
const SLEEPS = {
  "asking.e2e.cjs": [{ next: "assert.equal(await askShown(page), false);", why: "no location: checks the ask never appears; slowness can only make it pass early" }],
  "driver.e2e.cjs": [{ next: 'assert.equal(await text(page, "#driver .dc-bot"), "Hold the phone up to the driver.");', why: "a refused wake lock: checks the line never changes to the held-awake one" }],
  "nearest.e2e.cjs": [
    { next: 'assert.deepEqual(await rows(other), plain, "far: as if off");', why: "far away: checks no distance or tag ever appears" },
    { next: "assert.deepEqual(await rows(third), plain);", why: "refused: checks no distance or tag ever appears" },
    { next: "assert.equal(await page.evaluate(() => document.querySelectorAll(\"#rail .r-fx.at, #rail .tag.near\").length), 0, \"Dec 12 is not today\");", why: "another day's ticket: checks nothing is marked" },
  ],
  "leaveby.e2e.cjs": [{ next: 'assert.equal(await lead(page), "Leave by 13:30, in 10 min.");', why: "no usable position: checks the line stays the plan's own" }],
  "stay.e2e.cjs": [
    { next: 'assert.equal(await page.evaluate(() => document.querySelectorAll("#stay .sy-ph").length), 0, "not drawn again");', why: "a photo that failed: checks it is not drawn or asked for again" },
    { next: 'assert.equal(await kept(), true, "the third row is the same node after sync " + (i + 1));', why: "a sync with nothing new: checks the row is never redrawn" },
  ],
  "staydist.e2e.cjs": [
    { next: "await openCard(page);", why: "no usable position: checks the card never says a distance" },
    { next: "assert.equal(await dist(page), null);", why: "over 50 km: checks the card never says a distance" },
  ],
  "sync.e2e.cjs": [{ next: 'assert.equal(revs, 1, "one rev request in 60 seconds, not three");', why: "a hanging check: checks no second request starts" }],
  "bulkadd.e2e.cjs": [
    { next: "if (landed >= 2) {", why: "a backend delay to make uploads overlap if the app let them: slowness can only hide an overlap" },
    { next: "return await handle(body);", why: "a backend delay to make uploads overlap if the app let them: slowness can only hide an overlap" },
    { next: 'if (weak && landed >= 2) throw new Error("network");', why: "a backend delay to make uploads overlap if the app let them: slowness can only hide an overlap" },
  ],
};

// The text of a call's arguments: from the "(" at `open` to its match,
// skipping string and template literals and comments.
function argsAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

const lineOf = (src, at) => src.slice(0, at).split("\n").length;
const files = () => fs.readdirSync(DIR).filter((f) => f.endsWith(".e2e.cjs")).sort();

// Waits whose condition looks at a sheet's is-open class.
function sheetWaits(file, src) {
  const out = [];
  const sheet = "(" + SHEETS.join("|") + ")";
  const byId = new RegExp('(getElementById\\("' + sheet + '"\\)|"#' + sheet + '"|\\$\\("#' + sheet + '"\\))');
  // isOpen(page, "stay"), isOpen(page, id), or a file's own one-sheet isOpen(page).
  const byHelper = new RegExp("\\bisOpen\\(\\s*\\w+\\s*(,\\s*(\"" + sheet + "\"|[A-Za-z_]\\w*)\\s*)?\\)");
  for (const m of src.matchAll(/\buntil\(/g)) {
    const before = src.slice(0, m.index).split("\n");
    if (/\/\/ class wait: \S.{10,}/.test(before[before.length - 2] || "")) continue;
    const args = argsAt(src, m.index + m[0].length - 1);
    const cls = args.includes('"is-open"') && byId.test(args);
    if (cls || byHelper.test(args)) out.push(file + ":" + lineOf(src, m.index) + ": " + args.split("\n")[0].trim().slice(0, 100));
  }
  return out;
}

// Real-time sleeps in Node, and the line that follows each.
function sleeps(src) {
  const out = [];
  const lines = src.split("\n");
  lines.forEach((l, i) => {
    if (!/new Promise\(\(?(r|res|resolve)\)? => setTimeout\(\1,/.test(l)) return;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    out.push({ line: i + 1, next: (lines[j] || "").trim() });
  });
  return out;
}

test("no browser test waits on a sheet's is-open class: it waits with atRest", () => {
  const found = [];
  for (const f of files()) found.push(...sheetWaits(f, fs.readFileSync(path.join(DIR, f), "utf8")));
  assert.deepEqual(found, [], "class-only sheet waits (use atRest from helpers.cjs):\n" + found.join("\n"));
});

test("no browser test sleeps in real time, except the allowed spots, each with its reason", () => {
  const found = [];
  const used = new Set();
  for (const f of files()) {
    for (const s of sleeps(fs.readFileSync(path.join(DIR, f), "utf8"))) {
      const ok = (SLEEPS[f] || []).find((a) => s.next.startsWith(a.next));
      if (ok) used.add(f + "|" + ok.next);
      else found.push(f + ":" + s.line + ": before " + s.next.slice(0, 100));
    }
  }
  assert.deepEqual(found, [], "real-time sleeps (hold the answer on a promise, or wait on a condition):\n" + found.join("\n"));
  const stale = Object.entries(SLEEPS).flatMap(([f, list]) => list.filter((a) => !used.has(f + "|" + a.next)).map((a) => f + ": " + a.next));
  assert.deepEqual(stale, [], "allowed sleeps that are no longer there (take them off the list):\n" + stale.join("\n"));
  for (const list of Object.values(SLEEPS)) for (const a of list) assert.ok(a.why && a.why.length > 10, "each allowed sleep says why");
});

// The scanner itself: it must catch the shapes it is for.
test("the guard catches a class-only sheet wait and an unlisted sleep", () => {
  const bad = [
    'await until(() => isOpen(page, "stay"), "the hotel card opens");',
    'await until(async () => !(await isOpen(page, "stay")), "closes");',
    'const waitOpen = (page, id) => until(() => isOpen(page, id), "#" + id + " opens");',
    'await until(() => page.evaluate(() => document.getElementById("reg").classList.contains("is-open")), "the register opens");',
    'until(() => page.evaluate(() => { const s = document.getElementById("stop"); return !!s && s.classList.contains("is-open") && Math.abs(s.getBoundingClientRect().bottom - innerHeight) < 1; }), "opens");',
    'await until(() => page.locator("#stop").evaluate((s) => s.classList.contains("is-open")), "opens (R1)");',
    'const waitClosed = (page) => until(async () => !(await isOpen(page)), "the register closes");',
  ];
  for (const b of bad) assert.equal(sheetWaits("x", b).length, 1, b);
  const good = [
    'await atRest(page, "#stay");',
    'assert.equal(await isOpen(page, "stop"), true);',
    'await until(() => page.evaluate((sel) => document.querySelector(sel).classList.contains("is-open"), row(id)), "the row opens");',
    '    // class wait: the close follows the page\'s own timers, so the clock moves on; atRest follows.\n    await until(async () => !(await isOpen(page, "staySheet")), "closes");',
  ];
  for (const g of good) assert.equal(sheetWaits("x", g).length, 0, g);
  assert.deepEqual(sleeps("      await new Promise((r) => setTimeout(r, 3000));\n      log.answered++;").map((s) => s.next), ["log.answered++;"]);
});
