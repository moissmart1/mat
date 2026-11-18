// The release check's read-only key (security, 2026-11-18): only its SHA-256
// is here. The key itself is a random 32-byte value kept outside this
// repository, in the owner's private env file (MAT_CHECK_KEY). Publishing
// the hash gives nothing away. Under this key the backend answers only load,
// rev, history and migrate (Actions.js dispatch_), and its load leaves out
// the e-Transfer addresses.
var CHECK_KEY_HASH = "f2f89b3b2b97f6b6cbdb1ffb78d6124b8f7394a1f8ba693e6ca1c3fe358a6aea";
