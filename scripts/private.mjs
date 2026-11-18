// Rebuilds the private list the scan checks against (~/.config/mat/private.txt)
// from the live trip: the keys, people's addresses, the Sheet's id, lodging
// names and addresses, and every booking or picture link. Run it after the
// trip's Sheet gains new places or links:
//
//   npm run private
//
// Prints how many strings it kept, never the strings.

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KEY_NAMES, PRIVATE_DIR, call, ownerKey, privateEnv, readConfig } from "./release-lib.mjs";

const env = privateEnv();
// The whole trip is read with the owner's own key (MAT_OWNER_KEY), else the
// old shared MAT_KEY: the check key's load leaves out e-Transfer addresses.
const key = ownerKey(env);
if (!key) {
  console.error("private: no MAT_OWNER_KEY or MAT_KEY (put one in " + join(PRIVATE_DIR, "env") + ")");
  process.exit(1);
}

const res = await call(readConfig().apiUrl, key, "load");
if (!res || res.ok !== true) {
  console.error("private: the live trip did not answer (" + ((res && res.error) || "no answer") + ")");
  process.exit(1);
}

const d = res.data;
const out = new Set();
const add = (s, min = 6) => {
  if (typeof s === "string" && s.trim().length >= min) out.add(s.trim());
};

for (const k of KEY_NAMES) add(env[k]);
for (const m of String(d.sheetUrl || "").matchAll(/[A-Za-z0-9_-]{25,}/g)) add(m[0]);
for (const p of d.people || []) {
  add(p.etransfer);
  add(p.photo, 20);
}
for (const s of d.stays || []) {
  add(s.name, 8);
  add(s.nameJp, 4);
  add(s.addressJp, 6);
  add(s.link, 12);
  add(s.photo, 20);
}
for (const s of d.stops || []) {
  add(s.link, 12);
  add(s.photo, 20);
}
for (const t of d.todos || []) add(t.link, 12);

mkdirSync(PRIVATE_DIR, { recursive: true, mode: 0o700 });
const file = join(PRIVATE_DIR, "private.txt");
writeFileSync(file, [...out].join("\n") + "\n", { mode: 0o600 });
chmodSync(file, 0o600);
console.log("private: kept " + out.size + " strings in " + file);
