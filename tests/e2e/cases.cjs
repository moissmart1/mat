// Every browser-test case, by file, without a browser or the test queue:
//   node tests/e2e/cases.cjs   prints [{ file, cases: [name, ...] }] as JSON
// The release gate (scripts/gate-ci.mjs) uses it to know which `ok` lines each
// slice's log on GitHub must show, whatever the workflow under test says.
// Reads the cases the way run.cjs does (casesOf).

const fs = require("fs");
const path = require("path");

function casesOf(file) {
  const mod = require(file);
  const base = path.basename(file, ".e2e.cjs");
  if (typeof mod === "function") return [base];
  if (Array.isArray(mod)) return mod.map((c) => c.name);
  throw new Error(base + ": export an array of { name, run } or one async function");
}

function listCases(dir = __dirname) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".e2e.cjs"))
    .sort()
    .map((file) => ({ file, cases: casesOf(path.join(dir, file)) }));
}

module.exports = { listCases };

if (require.main === module) {
  process.stdout.write(JSON.stringify(listCases()) + "\n");
  setTimeout(() => process.exit(0), 50); // a test file's helpers may hold a timer open
}
