// Every screen reads "today" and "now" from the Days clock (js/plan.js
// tripNow), so a day in its own zone (Dec 9) is that place's everywhere. Only
// the clock's own files, and the two that are Japan's or home's on purpose
// (todos.js: due dates on the home calendar; stampbook.js: stamp windows in
// Japan time), may read a zone's date or time themselves.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "js");
const ALLOWED = new Set(["plan.js", "time.js", "todos.js", "stampbook.js"]);

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []));
}

test("no file under js/ but the clock's own calls nowIn( or dateIn(", () => {
  const found = [];
  for (const f of files(JS)) {
    const rel = path.relative(JS, f);
    if (ALLOWED.has(rel)) continue;
    fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (/\b(nowIn|dateIn)\(/.test(line)) found.push(rel + ":" + (i + 1) + ": " + line.trim());
    });
  }
  assert.deepEqual(found, []);
});

// japanDay( is Japan's date by the wall clock. Outside the stamp book's own
// model (js/stampbook.js) it may only name a pressed stamp's own day
// (views/stampbook.js, the one line marked "own day"), never "today".
test("no file under js/ reads japanDay( for today but the stamp model and a pressed stamp's own day", () => {
  const found = [];
  for (const f of files(JS)) {
    const rel = path.relative(JS, f);
    if (rel === "stampbook.js") continue;
    fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (/\bjapanDay\(/.test(line) && !/import /.test(line) && !/own day/.test(line)) found.push(rel + ":" + (i + 1) + ": " + line.trim());
    });
  }
  assert.deepEqual(found, []);
});

test("the japanDay rule would have caught the stamp book's Today row", () => {
  const old = "    const today = japanDay(m.t);";
  assert.ok(/\bjapanDay\(/.test(old) && !/import /.test(old) && !/own day/.test(old));
  const src = fs.readFileSync(path.join(JS, "views", "stampbook.js"), "utf8");
  assert.match(src, /japanDay\(at\) : ""\); \/\/ own day/);
});

test("the rule would catch one (the allowed files do call them)", () => {
  assert.match(fs.readFileSync(path.join(JS, "plan.js"), "utf8"), /\bnowIn\(/);
  assert.match(fs.readFileSync(path.join(JS, "time.js"), "utf8"), /\bdateIn\(/);
});
