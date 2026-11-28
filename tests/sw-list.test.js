// sw.js keeps a hand-written list of the shell files (there is no build
// step). This checks that list against the repo.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ROOT, readSw, shellList as listIn, shellHash, writtenVersion } from "../scripts/stamp-sw.mjs";

const SRC = readSw();
const shellList = () => listIn(SRC);

function filesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + "/" + entry.name;
    if (entry.isDirectory()) out.push(...filesUnder(rel));
    else if (!entry.name.startsWith(".")) out.push(rel);
  }
  return out;
}

test("SW_VERSION is the hash of the shell files", () => {
  const written = writtenVersion(SRC);
  assert.ok(written, 'sw.js has const SW_VERSION = "...";');
  assert.equal(written, shellHash(), "shell changed: run npm run stamp");
});

test("the hash changes when any shell file changes", () => {
  const list = shellList();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mat-sw-"));
  try {
    for (const f of list) {
      const file = f === "./" ? "index.html" : f;
      fs.mkdirSync(path.join(tmp, path.dirname(file)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, file), path.join(tmp, file));
    }
    const before = shellHash(tmp, list);
    assert.equal(before, shellHash(), "same files, same hash");
    fs.appendFileSync(path.join(tmp, "css/money.css"), "\n");
    assert.notEqual(shellHash(tmp, list), before, "one byte more in one file, a new hash");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("the shell list names every file the app needs", () => {
  const list = new Set(shellList());
  const needed = [
    "./",
    "index.html",
    "manifest.webmanifest",
    ...filesUnder("css"),
    ...filesUnder("js"),
    ...fs.readdirSync(path.join(ROOT, "icons")).filter((f) => f.endsWith(".png")).map((f) => "icons/" + f),
  ];
  const missing = needed.filter((f) => !list.has(f));
  assert.deepEqual(missing, [], "missing from SHELL in sw.js");
});

test("the shell list names only files that exist, never tools, tests, backend or scripts", () => {
  const list = shellList();
  assert.equal(new Set(list).size, list.length, "no file twice");
  for (const f of list) {
    if (f === "./") continue;
    assert.ok(fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).isFile(), f + " is in SHELL but does not exist");
    assert.equal(/^(tools|tests|backend|scripts)\//.test(f), false, f + " must not be cached");
    assert.equal(f, path.posix.normalize(f), f + " is written plainly");
  }
});

test("the worker never touches the trip backend", () => {
  assert.ok(SRC.includes('"script.google.com"') && SRC.includes('"script.googleusercontent.com"'));
  assert.match(SRC, /if \(BACKEND_HOSTS\.includes\(url\.hostname\)\) return;/);
});

// caches.open makes a cache when it is not there. Only the worker's own fills (install, and the
// page's "mat-keep-shell" ask, which deletes what it could not fill) may make a mat-shell- cache;
// a fetch or the page's look at the copy that opened it just after a refill failed left an empty
// one behind (phoneready flake, CI run 46096048563). Lookups use caches.match with cacheName.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
test("only the worker's fills open the shell cache; the page never opens a cache", () => {
  const opens = code(SRC).match(/caches\s*\.open\(\s*SHELL_CACHE\s*\)/g) || [];
  assert.equal(opens.length, 2, "caches.open(SHELL_CACHE) only in install and the mat-keep-shell fill");
  const pageFiles = filesUnder("js").filter((f) => f.endsWith(".js"));
  const opening = pageFiles.filter((f) => /caches\s*\.open\(/.test(code(fs.readFileSync(path.join(ROOT, f), "utf8"))));
  assert.deepEqual(opening, [], "the page looks with caches.match({ cacheName }), never caches.open");
});
