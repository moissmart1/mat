/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The arithmetic behind "Back to the hotel" (js/views/compass.js): where a
// stay is, which way it lies and how far, and which way the phone faces.
// Pure: no DOM, no clock, no storage, so it is all under test.
//
// A stay's spot comes from, in order: a pin dropped on this phone, then
// coordinates written into the stay's place (a Maps link that carries them,
// or "35.7148, 139.7967" typed as text). A stay with neither has no spot.

const R_EARTH_M = 6371008.8;
const RAD = Math.PI / 180;

const str = (v) => (typeof v === "string" ? v.trim() : "");

// 0 <= a < 360.
export function norm(a) {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

// A spot is { lat, lng } of finite numbers inside the globe, not 0,0.
export function isSpot(p) {
  return (
    !!p &&
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    !(p.lat === 0 && p.lng === 0)
  );
}

const spot = (lat, lng) => {
  const p = { lat: Number(lat), lng: Number(lng) };
  return isSpot(p) ? p : null;
};

const PAIR = "(-?\\d{1,2}(?:\\.\\d+)?)\\s*,\\s*(-?\\d{1,3}(?:\\.\\d+)?)";

// Coordinates written into a place: a Google Maps link's pin (!3d…!4d…),
// its query (q=, query=, ll=, destination=, center=), its view (@lat,lng),
// or a bare "lat, lng". The pin wins over the view: the view is only where
// the map was looking. Anything else is null.
export function spotFromPlace(place) {
  const s = str(place);
  if (!s) return null;
  let text = s;
  try {
    text = decodeURIComponent(s);
  } catch {
    // keep it as written
  }
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(text);
  if (pin) {
    const p = spot(pin[1], pin[2]);
    if (p) return p;
  }
  const query = new RegExp("[?&](?:q|query|ll|destination|center|daddr)=(?:loc:)?" + PAIR).exec(text);
  if (query) {
    const p = spot(query[1], query[2]);
    if (p) return p;
  }
  const view = new RegExp("@" + PAIR).exec(text);
  if (view) {
    const p = spot(view[1], view[2]);
    if (p) return p;
  }
  const bare = new RegExp("^" + PAIR + "$").exec(s);
  if (bare) return spot(bare[1], bare[2]);
  return null;
}

// The stay's spot and where it came from: { lat, lng, from: "pin" | "place" }, or null.
export function stayTarget(stay, pin) {
  if (isSpot(pin)) return { lat: pin.lat, lng: pin.lng, from: "pin" };
  const p = stay ? spotFromPlace(stay.place) : null;
  return p ? { ...p, from: "place" } : null;
}

// Metres along the ground between two spots (haversine).
export function distanceM(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The direction from a to b, in degrees clockwise from north (0..360).
export function bearing(a, b) {
  const p1 = a.lat * RAD;
  const p2 = b.lat * RAD;
  const dl = (b.lng - a.lng) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm(Math.atan2(y, x) / RAD);
}

// Which way the top of the phone faces, in degrees clockwise from north, from
// a deviceorientation(absolute) event; null when the event cannot say.
// iPhone: webkitCompassHeading. Android: an absolute alpha, which turns the
// other way. screenAngle: the screen's turn (screen.orientation.angle), so
// the heading follows the screen when the phone is held sideways.
export function headingOf(ev, screenAngle = 0) {
  if (!ev) return null;
  const turn = Number.isFinite(screenAngle) ? screenAngle : 0;
  const w = ev.webkitCompassHeading;
  if (typeof w === "number" && Number.isFinite(w) && w >= 0) return norm(w + turn);
  if (ev.absolute === true && typeof ev.alpha === "number" && Number.isFinite(ev.alpha)) return norm(360 - ev.alpha + turn);
  return null;
}

// The shortest turn from a to b: -180 < turn <= 180.
export function turn(a, b) {
  const d = norm(b - a);
  return d > 180 ? d - 360 : d;
}

const POINTS = [
  ["北", "north"],
  ["北東", "northeast"],
  ["東", "east"],
  ["南東", "southeast"],
  ["南", "south"],
  ["南西", "southwest"],
  ["西", "west"],
  ["北西", "northwest"],
];

// The eight-point name of a direction: { jp: "北東", en: "northeast" }.
export function pointOf(deg) {
  const [jp, en] = POINTS[Math.round(norm(deg) / 45) % 8];
  return { jp, en };
}

// "40 m", "350 m", "1.4 km", "12 km".
export function distanceText(m) {
  if (!Number.isFinite(m) || m < 0) return "";
  if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + " m";
  if (m < 9950) return (Math.round(m / 100) / 10).toFixed(1) + " km";
  return Math.round(m / 1000).toLocaleString("en-CA") + " km";
}

// Close enough to call it arrived.
export const HERE_M = 40;
// Walking pace for the rough time, metres a minute.
const WALK_M_MIN = 80;
// Further than this, a walking time means nothing: it is a train ride.
const WALK_MAX_M = 6000;

// The line under the distance: how the hotel lies from here, in words.
// accuracy: the phone's own guess at its error, in metres (or null).
export function wayText(m, deg, accuracy = null) {
  if (!Number.isFinite(m)) return "";
  if (m <= HERE_M) return "You’re there.";
  if (Number.isFinite(accuracy) && accuracy > m) return "Close. The phone can only tell to about " + distanceText(accuracy) + ".";
  const { en } = pointOf(deg);
  const dir = en[0].toUpperCase() + en.slice(1);
  if (m > WALK_MAX_M) return dir + ", in a straight line. Take a train or a taxi.";
  const min = Math.max(1, Math.round((m * 1.3) / WALK_M_MIN)); // streets are not straight
  return dir + ", about " + min + " min on foot.";
}
