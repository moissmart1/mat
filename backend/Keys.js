// Who is calling (security, 2026-11-18). Every request's key is one of:
// - a person's own key (PERSON_KEYS in Script Properties holds only each
//   key's SHA-256, never a key): the backend then knows who is calling and
//   ignores whatever name the phone sends;
// - the release check's read-only key (CHECK_KEY_HASH, CheckKey.js);
// - the old shared trip key (TRIP_KEY), only while it still exists: run
//   retireSharedLink() (Setup.js) once everyone has their own link.
// Uses getProp_, setProp_, sha256Hex_ (Env.js; in memory in
// tests/fake-backend.cjs) and keyHolder, personKeysFrom (Pure.js).

var PERSON_KEYS_PROP_ = "PERSON_KEYS";

// PERSON_KEYS as { name: { hash, at } }, read afresh on every call (never
// cached), so a cancelled or replaced link stops working on the next request.
// Throws when the property is there but is not a JSON object (fix round 1):
// the request then answers the plain server sentence, so nobody gets in and
// no phone takes it for a refused key (which would clear it).
function personKeys_() {
  var raw = getProp_(PERSON_KEYS_PROP_);
  if (!personKeysReadable(raw)) throw new Error("PERSON_KEYS is not readable");
  return personKeysFrom(raw);
}

function setPersonKeys_(keys) {
  setProp_(PERSON_KEYS_PROP_, JSON.stringify(keys));
}

// The holder of a key: { kind: "person", name } | { kind: "check" } |
// { kind: "shared" } | null (refused: bad_key). The shared key is read from
// Script Properties on every request, never from the script cache (fix
// round 1), so deleting TRIP_KEY, by hand or by retireSharedLink, takes
// effect on the next request. Throws when PERSON_KEYS can't be read.
function holderOf_(key) {
  if (typeof key !== "string" || key === "") return null;
  var check = typeof CHECK_KEY_HASH === "string" ? CHECK_KEY_HASH : "";
  return keyHolder(key, sha256Hex_(key), getProp_("TRIP_KEY"), personKeys_(), check);
}
