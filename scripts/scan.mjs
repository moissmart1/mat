// The repository is public. This looks through every tracked text file for
// what must never be in it: a real address, a deployment or Sheet id, or any
// string from the private list (~/.config/mat/private.txt: the keys, and
// names, links and addresses from the trip's own Sheet; `npm run private`
// rebuilds it from the live trip).
//
//   npm run scan
//   node scripts/scan.mjs --patterns-only   where there is no private list (the
//                                           pull request check): the address
//                                           and id rules only. The release
//                                           gate always uses the full list.
//
// It never prints what it found, only where.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PRIVATE_DIR, ROOT, git, readConfig } from "./release-lib.mjs";

const BINARY = /\.(png|jpe?g|ico|gif|webp|woff2?|ttf|otf|mp3|wav|m4a|pdf)$/i;
const MAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const SAFE_MAIL = /@(?:[a-z0-9-]+\.)*(example\.(com|net|org)|test|anthropic\.com)$/i;
const NOT_MAIL = /\.(png|jpe?g|svg|js|mjs|cjs|css|json|html|md)$/i;
const DEPLOY = /AKfy[A-Za-z0-9_-]{20,}/g;
const GOOGLE_ID = /(?<![A-Za-z0-9_-])1[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;

// An entry is checked when it has 6 characters or more, or 4 or 5 and it has
// a digit or is all upper case (a booking code), so a short code is caught
// without flagging common four and five letter words.
export function worthChecking(s) {
  if (s.length >= 6) return true;
  if (s.length < 4) return false;
  return /\d/.test(s) || (/[A-Z]/.test(s) && s === s.toUpperCase());
}

export function privateWords(file = join(PRIVATE_DIR, "private.txt")) {
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").split("\n").map((s) => s.trim()).filter(worthChecking);
}

// [{ rule, line }] for one file's text.
export function findings(text, { deployId = "", words = [] } = {}) {
  const out = [];
  const lower = text.toLowerCase();
  const lineOf = (i) => text.slice(0, i).split("\n").length;
  for (const m of text.matchAll(MAIL)) {
    if (!SAFE_MAIL.test(m[0]) && !NOT_MAIL.test(m[0])) out.push({ rule: "an address that is not an example address", line: lineOf(m.index) });
  }
  for (const m of text.matchAll(DEPLOY)) {
    if (m[0] !== deployId) out.push({ rule: "a deployment id other than the app's own", line: lineOf(m.index) });
  }
  for (const m of text.matchAll(GOOGLE_ID)) out.push({ rule: "what looks like a Google file id", line: lineOf(m.index) });
  for (const w of words) {
    const i = lower.indexOf(w.toLowerCase());
    if (i !== -1) out.push({ rule: "a string from the private list", line: lineOf(i) });
  }
  return out;
}

// [{ file, rule, line }] for every tracked file.
export function scanTree(root = ROOT, { patternsOnly = false } = {}) {
  const words = patternsOnly ? privateWords() || [] : privateWords();
  if (words === null) {
    return [{ file: "(setup)", rule: "the private list is missing: run `npm run private` (it needs ~/.config/mat/env)", line: 0 }];
  }
  const { deployId } = readConfig(root);
  const out = [];
  for (const file of git(["ls-files"], root).split("\n").filter(Boolean)) {
    if (BINARY.test(file) || !existsSync(join(root, file))) continue;
    const text = readFileSync(join(root, file), "utf8");
    for (const f of findings(text, { deployId, words })) out.push({ file, ...f });
  }
  return out;
}

// [{ commit, file, rule, line }] for what each commit adds and for its
// message: every commit a push would make public, not only the last one (a
// private string added in one commit and taken out in the next is still in
// the history). Merges are read against every parent (-m), the first commit
// against nothing (--root). Fails closed: a git error throws, and with no
// private list the answer is a finding.
export function scanCommits(shas, root = ROOT, { words, deployId } = {}) {
  const list = words === undefined ? privateWords() : words;
  if (list === null) return [{ commit: "(setup)", file: "(setup)", rule: "the private list is missing: run `npm run private` (it needs ~/.config/mat/env)", line: 0 }];
  const id = deployId === undefined ? readConfig(root).deployId : deployId;
  const run = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const out = [];
  for (const sha of shas) {
    const commit = sha.slice(0, 7);
    for (const f of findings(run(["log", "-1", "--format=%B", sha]), { deployId: id, words: list })) out.push({ commit, file: "(commit message)", ...f });
    // Added lines only, per file, with their line numbers in the new file.
    const added = new Map();
    let file = "";
    let at = 0;
    for (const l of run(["diff-tree", "-p", "-m", "--root", "--no-commit-id", "--no-color", "--no-ext-diff", "--no-renames", "-U0", sha]).split("\n")) {
      if (l.startsWith("+++ ")) {
        file = l === "+++ /dev/null" ? "" : l.replace(/^\+\+\+ (b\/)?/, "");
      } else if (l.startsWith("@@")) {
        at = Number((l.match(/\+(\d+)/) || [])[1] || 0);
      } else if (l.startsWith("+") && file && !BINARY.test(file)) {
        if (!added.has(file)) added.set(file, { text: [], lines: [] });
        added.get(file).text.push(l.slice(1));
        added.get(file).lines.push(at++);
      }
    }
    for (const [f, a] of added) {
      for (const x of findings(a.text.join("\n"), { deployId: id, words: list })) out.push({ commit, file: f, rule: x.rule, line: a.lines[x.line - 1] || 0 });
    }
  }
  return out;
}

function main() {
  const patternsOnly = process.argv.includes("--patterns-only");
  const found = scanTree(ROOT, { patternsOnly });
  if (!found.length) {
    console.log("scan: nothing private in the tracked files" + (patternsOnly && privateWords() === null ? " (address and id rules only: no private list here)" : ""));
    return;
  }
  for (const f of found) console.log("scan: " + f.file + ":" + f.line + "  " + f.rule);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
