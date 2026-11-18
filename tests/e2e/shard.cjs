// Splits the browser-test files into slices, so several machines can each run
// one (GitHub Actions runs four). Pure: no files, no browser.

// "2/4" -> { n: 2, m: 4 }. Anything else stops with a plain sentence.
function parseShard(text) {
  const m = /^(\d+)\/(\d+)$/.exec(String(text).trim());
  const n = m && Number(m[1]);
  const total = m && Number(m[2]);
  if (!m || n < 1 || total < 1 || n > total) {
    throw new Error('Bad shard "' + text + '": write it as N/M with N from 1 to M, for example 2/4.');
  }
  return { n, m: total };
}

// Files sorted by name and dealt round-robin: slice n gets the files at
// positions n-1, n-1+m, n-1+2m ... Every file lands in exactly one slice.
function shardFiles(files, n, m) {
  const sorted = [...files].sort();
  return sorted.filter((_, i) => i % m === n - 1);
}

module.exports = { parseShard, shardFiles };
