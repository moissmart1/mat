// A stood-in navigator.geolocation (and permissions.query for it) for the
// location tests. Not a test file itself (run.cjs only runs *.e2e.cjs).
//
// await geoStub(page, { mode, lat, lng, accuracy, ageMs, permission })
// - mode: "granted" (answers with the position), "refused" (the phone's no),
//   "silent" (never answers), "none" (the phone has no geolocation at all).
// - ageMs: how old the position is when it comes (stale: more than 3 min);
//   accuracy in metres (rough: more than 300).
// - permission: what permissions.query says for geolocation ("prompt" by default).
// - message: the refusal's message (default "User denied Geolocation").
// In the page: window.__geoCalls (each request's options), window.__geoWatch
// (watchPosition calls), window.__geoSet(patch) to change the answer later.

// Gion, Kyoto: a spot no fixture or seed uses, so its digits are easy to find.
const HERE = { lat: 35.0036612, lng: 135.7787213 };

async function geoStub(page, cfg = {}) {
  await page.addInitScript((c) => {
    window.__geo = { mode: "granted", lat: 0, lng: 0, accuracy: 30, ageMs: 0, permission: "prompt", ...c };
    window.__geoCalls = [];
    window.__geoWatch = 0;
    window.__geoSet = (patch) => Object.assign(window.__geo, patch);
    if (window.__geo.mode === "none") {
      Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
      return;
    }
    const geo = {
      getCurrentPosition(ok, no, opts) {
        window.__geoCalls.push(opts || null);
        const g = window.__geo;
        if (g.mode === "silent") return;
        // A microtask, not a timer: the tests pause the page's clock.
        Promise.resolve().then(() => {
          if (g.mode === "refused") no({ code: 1, message: typeof g.message === "string" ? g.message : "User denied Geolocation" });
          else ok({ coords: { latitude: g.lat, longitude: g.lng, accuracy: g.accuracy }, timestamp: Date.now() - g.ageMs });
        });
      },
      watchPosition() {
        window.__geoWatch++;
        return 0;
      },
      clearWatch() {},
    };
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: geo });
    const perms = navigator.permissions;
    const query = perms && perms.query ? perms.query.bind(perms) : null;
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: (d) => (d && d.name === "geolocation" ? Promise.resolve({ state: window.__geo.permission }) : query ? query(d) : Promise.reject(new Error("no"))) },
    });
  }, { ...HERE, ...cfg });
}

// Every request body the fake backend received, and the page's storage, as
// text: a position's digits must never be in any of them.
// latOnly: for a test whose places share the phone's longitude on purpose.
async function leaks(page, backend, pos = HERE, { latOnly = false } = {}) {
  const digits = latOnly ? [String(pos.lat).slice(0, 7)] : [String(pos.lat).slice(0, 7), String(pos.lng).slice(0, 8)];
  const bodies = JSON.stringify(backend.requests);
  const stored = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) out[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    try {
      for (let i = 0; i < sessionStorage.length; i++) out["s:" + sessionStorage.key(i)] = sessionStorage.getItem(sessionStorage.key(i));
    } catch {
      // none
    }
    return JSON.stringify(out);
  });
  return digits.filter((d) => bodies.includes(d) || stored.includes(d));
}

module.exports = { geoStub, leaks, HERE };
