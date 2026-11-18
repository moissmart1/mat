// The split of the browser tests into slices (tests/e2e/shard.cjs).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseShard, shardFiles } = require("./e2e/shard.cjs");

const real = fs.readdirSync(path.join(__dirname, "e2e")).filter((f) => f.endsWith(".e2e.cjs"));

test("every file is in exactly one slice, for several slice counts", () => {
  for (const m of [1, 2, 3, 4, 7, real.length, real.length + 5]) {
    const all = [];
    for (let n = 1; n <= m; n++) all.push(...shardFiles(real, n, m));
    assert.deepEqual([...all].sort(), [...real].sort(), "m=" + m);
  }
});

test("slices are stable and sorted, whatever order the files come in", () => {
  const files = ["d.e2e.cjs", "a.e2e.cjs", "c.e2e.cjs", "b.e2e.cjs", "e.e2e.cjs"];
  assert.deepEqual(shardFiles(files, 1, 2), ["a.e2e.cjs", "c.e2e.cjs", "e.e2e.cjs"]);
  assert.deepEqual(shardFiles(files, 2, 2), ["b.e2e.cjs", "d.e2e.cjs"]);
  assert.deepEqual(shardFiles([...files].reverse(), 1, 2), shardFiles(files, 1, 2));
  assert.deepEqual(files[0], "d.e2e.cjs", "the input is not changed");
});

test("slices differ in size by at most one file", () => {
  const sizes = [1, 2, 3, 4].map((n) => shardFiles(real, n, 4).length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, sizes.join(","));
});

test("a good shard parses", () => {
  assert.deepEqual(parseShard("2/4"), { n: 2, m: 4 });
  assert.deepEqual(parseShard("1/1"), { n: 1, m: 1 });
});

test("bad input stops with a sentence", () => {
  for (const bad of ["0/4", "5/4", "x", "", "1/0", "-1/4", "1.5/4", "2/", "/4", "1/2/3"]) {
    assert.throws(() => parseShard(bad), /Bad shard .* N\/M/, JSON.stringify(bad));
  }
});
