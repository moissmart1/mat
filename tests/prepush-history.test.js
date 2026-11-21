import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("feature pushes check every outgoing commit including its message", t => {
  const root = mkdtempSync(join(tmpdir(), "mat-push-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "repo");
  mkdirSync(cwd);
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const write = text => writeFileSync(join(cwd, "sample"), text);
  const commit = message => { git("add", "."); git("commit", "-qm", message); return git("rev-parse", "HEAD"); };
  const marker = "invented-private-marker";
  writeFileSync(join(root, "private.txt"), marker);
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "test@example.test");
  mkdirSync(join(cwd, "js"));
  writeFileSync(join(cwd, "js/config.js"), "// test");
  write("base");
  const base = commit("base");
  git("update-ref", "refs/remotes/origin/dev", base);
  const zero = "0".repeat(40);
  const check = (remote, ok) => {
    const hook = fileURLToPath(new URL("../scripts/prepush.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [hook], { cwd, encoding: "utf8",
      env: { ...process.env, MAT_PRIVATE_DIR: root },
      input: `HEAD ${git("rev-parse", "HEAD")} refs/heads/topic ${remote}\n` });
    assert.equal(result.status, ok ? 0 : 1, result.stderr);
    assert.ok(!result.stderr.includes(marker));
  };
  write("first"); commit("first");
  write("second"); commit("second");
  check(zero, true);
  write(marker); commit("middle"); write("clean"); const clean = commit("tip");
  check(base, false);
  check(zero, false);
  write("message only"); commit(marker);
  check(clean, false);
  check("a".repeat(40), false);
});
