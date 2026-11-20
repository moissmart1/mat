// The release rules (scripts/release-lib.mjs, scripts/scan.mjs): what may be
// pushed, when a version number is owed, what counts as private, and that the
// backend stamp matches the backend files.
import test from "node:test";
import assert from "node:assert/strict";
import { backendFiles, backendHash, config, judgePush, needsBump, stampIn, writtenBackendStamp } from "../scripts/release-lib.mjs";
import { findings } from "../scripts/scan.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { liveStampUntil, askUntil, checkKey, ownerKey, tripLoaded, withoutKeys } from "../scripts/release-lib.mjs";

test("I4: the live load is asked again for about 30 seconds; ship never advises rolling the backend back", async () => {
  const waits = [];
  const answers = [{ ok: false, error: "bad_key" }, null, { ok: true, data: { days: [1], stops: [] } }];
  let n = 0;
  const r = await askUntil(async () => answers[n++], tripLoaded, { sleep: async (ms) => waits.push(ms) });
  assert.equal(tripLoaded(r), true);
  assert.deepEqual(waits, [5000, 5000], "asked three times, five seconds apart");
  let m = 0;
  const never = await askUntil(async () => { m++; return { ok: false }; }, tripLoaded, { sleep: async (ms) => waits.push(ms) });
  assert.equal(m, 7, "seven tries, about 30 seconds of waiting");
  assert.equal(tripLoaded(never), false);
  const ship = readFileSync(join(ROOT, "scripts", "ship.mjs"), "utf8");
  assert.equal(/roll back the backend first|go back to if this goes wrong/.test(ship), false);
  assert.match(ship, /never roll the\s*\n?\/\/ backend back|never roll back past/);
  assert.match(ship, /askUntil\(\(\) => call\(cfg\.apiUrl, KEY, "load"\), tripLoaded\)/);
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.match(readme, /never roll the backend back/i);
});

const ok = { unit: { pass: 10, fail: 0 }, e2e: { pass: 5, fail: 0 } };
const push = (over) => judgePush({ remoteRef: "refs/heads/main", localSha: "a".repeat(40), receipt: ok, commitStamp: "abc", live: "abc", ...over });

test("backend/Stamp.js matches the backend files (run npm run stamp)", () => {
  assert.equal(writtenBackendStamp(), backendHash());
  assert.ok(!backendFiles().includes("Stamp.js"));
  assert.ok(backendFiles().includes("appsscript.json"));
});

test("release branches require a receipt and their own live backend", () => {
  assert.equal(push({}), null);
  assert.match(push({ remoteRef: "refs/original/refs/heads/main" }), /refs\/original/);
  // dev (reviewed work waiting for a release) goes out under the same checks.
  assert.equal(push({ remoteRef: "refs/heads/dev" }), null);
  assert.match(push({ remoteRef: "refs/heads/dev", receipt: null }), /npm run gate/);
  assert.match(push({ remoteRef: "refs/heads/dev", localSha: "0".repeat(40) }), /never deleted/);
  assert.match(push({ localSha: "0".repeat(40) }), /never deleted/);
  assert.match(push({ receipt: null }), /npm run gate/);
  assert.match(push({ receipt: { unit: { pass: 9, fail: 1 }, e2e: { pass: 5, fail: 0 } } }), /failing tests/);
  assert.match(push({ receipt: { unit: { pass: 9, fail: 0 }, e2e: { pass: 5, fail: 2 } } }), /failing tests/);
  assert.match(push({ live: "old" }), /backend goes first/);
  assert.match(push({ live: "" }), /backend goes first/);
  // A commit from before the stamp existed has nothing to compare.
  assert.equal(push({ commitStamp: "", live: "" }), null);
});

test("CI and feature branches require a full clean scan at the outgoing commit", () => {
  const localSha = "a".repeat(40);
  for (const name of ["ci/browser-tests", "ticks-build", "codex/issue-19", "team/fix/sidebar"]) {
    const remoteRef = "refs/heads/" + name;
    const scan = { atHead: true, clean: true, found: 0 };
    const check = (changes) => judgePush({ remoteRef, localSha, scan: { ...scan, ...changes } });
    assert.equal(check({}), null);
    assert.match(check({ found: 2 }), /private-data scan found 2/);
    assert.match(check({ clean: false }), /clean checkout/);
    assert.match(check({ atHead: false }), /clean checkout/);
    assert.match(judgePush({ remoteRef, localSha }), /clean checkout/);
  }
  const deleted = "0".repeat(40);
  assert.equal(judgePush({ remoteRef: "refs/heads/ci/check", localSha: deleted }), null);
  assert.match(judgePush({ remoteRef: "refs/heads/topic", localSha: deleted }), /deletion/);
  for (const remoteRef of ["refs/tags/v1", "refs/heads/ci/a/b", "refs/notes/x", "refs/original/refs/heads/x"]) {
    assert.ok(judgePush({ remoteRef, localSha, scan: { atHead: true, clean: true, found: 0 } }));
  }
});

test("a change to what the phones run owes a new version number", () => {
  const shell = ["./", "index.html", "js/app.js", "css/base.css"];
  assert.equal(needsBump(["js/app.js"], shell), true);
  assert.equal(needsBump(["index.html"], shell), true);
  assert.equal(needsBump(["sw.js"], shell), true);
  assert.equal(needsBump(["backend/Actions.js", "tests/store.test.js", "README.md", "scripts/ship.mjs"], shell), false);
  assert.equal(needsBump([], shell), false);
});

test("config and the stamp line are read as written", () => {
  const id = "AKfy" + "TESTtest_test-testTEST123"; // in two pieces: the scan refuses a whole one
  const c = config('export const API_URL = "https://script.google.com/macros/s/' + id + '/exec";\nexport const APP_VERSION = "23";\n');
  assert.equal(c.deployId, id);
  assert.equal(c.appVersion, "23");
  assert.equal(stampIn('// note\nvar BACKEND_STAMP = "0123456789";\n'), "0123456789");
  assert.equal(stampIn(""), "");
});

test("the scan finds what must not be public and leaves examples alone", () => {
  const rules = (text, opts) => findings(text, opts).map((f) => f.rule);
  assert.deepEqual(rules("mail mo@example.com, t@example.test, x@sub.example.org"), []);
  assert.deepEqual(rules('"playwright-core@1.48.0" and icon@2x.png and @google/clasp'), []);
  assert.equal(rules("write to someone" + "@" + "gmail.com").length, 1);
  const real = "AKfy" + "c".repeat(40);
  assert.deepEqual(rules("url " + real, { deployId: real }), []);
  assert.equal(rules("url " + real, { deployId: "AKfy" + "d".repeat(40) }).length, 1);
  assert.equal(rules("sheet 1" + "Ab_-9".repeat(8) + "xyz").length, 1);
  assert.equal(rules("a 0f1e2d3c4b5a69788796a5b4c3d2e1f0 hash").length, 0);
  assert.equal(rules("We stay at the Grand Snow Lodge", { words: ["grand snow lodge"] }).length, 1);
  assert.equal(findings("one\ntwo Secret Place\n", { words: ["secret place"] })[0].line, 2);
  // A finding never carries the text it matched.
  assert.deepEqual(Object.keys(findings("x " + "y@" + "real.org")[0]).sort(), ["line", "rule"]);
});

// ---- security (2026-11-18): a key never in an address, never in a log ----

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const filesIn = (dir, re) => readdirSync(join(ROOT, dir), { recursive: true }).filter((f) => re.test(f)).map((f) => join(dir, f));

// Lines that put a key in a query string: "?k=" / "&k=", or a k parameter set on a URL.
function keyInQuery(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    if (/[?&]k=/.test(line) || /searchParams\.(set|append)\(\s*["']k["']/.test(line) || /URLSearchParams\(\s*\{[^}]*\bk\s*:/.test(line)) out.push(i + 1);
  });
  return out;
}

test("no script or click-through test builds an address with a key in its query string", () => {
  assert.deepEqual(keyInQuery('page.goto(SITE + "?k=" + key)'), [1], "the check catches one");
  assert.deepEqual(keyInQuery('u.searchParams.set("k", key)'), [1]);
  assert.deepEqual(keyInQuery('page.goto(SITE + "#k=" + key)'), [], "a fragment is fine");
  const bad = [];
  for (const f of [...filesIn("scripts", /\.(mjs|cjs|js)$/), ...filesIn("tests/e2e", /\.(cjs|js)$/)]) {
    for (const line of keyInQuery(readFileSync(join(ROOT, f), "utf8"))) bad.push(f + ":" + line);
  }
  assert.deepEqual(bad, []);
});

// Backend log calls (Logger.log, console.*) whose arguments name a key or a
// token, outside the owner's link functions (backend/Setup.js, item 8).
const OWNER_FUNCTIONS = ["issueLinks", "newLinkFor_", "cancelLinkFor_", "linksStatus", "retireSharedLink", "showInvite", "logLink_"];
function keyLogs(src) {
  const out = [];
  const heads = [...src.matchAll(/^function (\w+)\s*\(/gm)].map((m) => ({ name: m[1], at: m.index }));
  for (const m of src.matchAll(/\b(Logger\.log|console\.(?:log|error|warn|info))\s*\(/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    const args = src.slice(start, i - 1).replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
    const fn = heads.filter((h) => h.at < m.index).pop();
    const name = fn ? fn.name : "(top)";
    if (/key|token|secret|TRIP_KEY|CLAUDE_TOKEN|PLANNER_ID|plannerId_/i.test(args) && !OWNER_FUNCTIONS.includes(name)) out.push(name + ": " + m[1] + "(" + args.trim() + ")");
  }
  return out;
}

test("no backend file passes a key or token to Logger.log or console.*, outside the owner's link functions", () => {
  assert.equal(keyLogs('function f() {\n  Logger.log("Trip key: " + tripKey_());\n}').length, 1, "the check catches one");
  assert.equal(keyLogs('function g() {\n  console.error("x " + token);\n}').length, 1);
  assert.equal(keyLogs('function issueLinks() {\n  Logger.log(name + key);\n}').length, 0, "allowed in an owner function");
  assert.equal(keyLogs('function h() {\n  Logger.log("the key words in a sentence");\n}').length, 0, "words in a sentence are not a key");
  const bad = [];
  for (const f of readdirSync(join(ROOT, "backend")).filter((f) => f.endsWith(".js"))) {
    for (const hit of keyLogs(readFileSync(join(ROOT, "backend", f), "utf8"))) bad.push(f + " " + hit);
  }
  assert.deepEqual(bad, []);
});

test("the release checks use the check key, the old shared key only without one, and never print either", () => {
  const SHARED_NAME = "MAT_" + "KEY";
  const S = "shared-" + "x".repeat(10), C = "check-" + "y".repeat(10), O = "owner-" + "z".repeat(10);
  assert.equal(checkKey({ MAT_CHECK_KEY: C, [SHARED_NAME]: S }), C);
  assert.equal(checkKey({ [SHARED_NAME]: S }), S);
  assert.equal(checkKey({}), "");
  assert.equal(ownerKey({ MAT_OWNER_KEY: O, [SHARED_NAME]: S, MAT_CHECK_KEY: C }), O);
  assert.equal(ownerKey({ MAT_CHECK_KEY: C }), "", "never the check key: its load hides the addresses");
  const env = { MAT_CHECK_KEY: C, [SHARED_NAME]: S };
  assert.equal(withoutKeys("goto https://x/#k=" + C + " and " + encodeURIComponent(S), env), "goto https://x/#k=(key) and (key)");
  const ship = readFileSync(join(ROOT, "scripts", "ship.mjs"), "utf8");
  assert.equal(ship.split("env." + SHARED_NAME).length - 1, 0, "ship reads its key only through checkKey");
  assert.match(ship, /const KEY = checkKey\(env\)/);
  assert.match(ship, /"#k=" \+ encodeURIComponent\(KEY\)/);
});

test("liveStampUntil asks again every 3 seconds, up to 30 seconds, until the live stamp is the commit's", async () => {
  const waits = [];
  const answers = ["old", "old", "abc"];
  let n = 0;
  const got = await liveStampUntil("https://example.test/exec", "abc", { ask: async () => answers[n++], sleep: async (ms) => waits.push(ms) });
  assert.equal(got, "abc");
  assert.deepEqual(waits, [3000, 3000]);
  const waits2 = [];
  let m = 0;
  const never = await liveStampUntil("https://example.test/exec", "abc", { ask: async () => { m++; return "old"; }, sleep: async (ms) => waits2.push(ms) });
  assert.equal(never, "old");
  assert.equal(m, 11);
  assert.equal(waits2.length, 10);
  assert.equal(waits2.reduce((a, b) => a + b, 0), 30000);
  // At once when it is already right: no wait.
  const waits3 = [];
  assert.equal(await liveStampUntil("u", "abc", { ask: async () => "abc", sleep: async (ms) => waits3.push(ms) }), "abc");
  assert.deepEqual(waits3, []);
});

test("the pre-push check waits for the live stamp before it judges", () => {
  const src = readFileSync(new URL("../scripts/prepush.mjs", import.meta.url), "utf8");
  assert.match(src, /liveStampUntil\(config\(show\(localSha, "js\/config\.js"\)\)\.apiUrl, commitStamp\)/);
});
