// The 12-day trip laid over the seed (tests/fixtures/dec9.json), as the
// store's state holds it: an eve (Dec 8) and Day 1 (Dec 9) in a zone of their
// own, then the seed's Dec 10 to 20 in Japan. Invented places, flights and
// hotel. For the unit tests; the browser tests give the JSON to the fake.

import fs from "node:fs";

export const DEC9 = JSON.parse(fs.readFileSync(new URL("./dec9.json", import.meta.url), "utf8"));
export const ET = "America/New_York";

// A Days row in the Sheet's column names -> the shape load gives the app.
const dayOf = (r) => ({
  date: r.date, city: r.city || "", title: r.title || "", lineJp: r.line_jp || "", lineEn: r.line_en || "", lineColour: r.line_colour || "",
  fromJp: r.from_jp || "", fromEn: r.from_en || "", toJp: r.to_jp || "", toEn: r.to_en || "", lat: "", lng: "", tz: r.tz || "", kind: r.kind || "",
});

const seedDays = () => Array.from({ length: 11 }, (_, i) => dayOf({ date: "2026-12-" + (10 + i) }));

// The store's state for the 12-day trip (eves split from days, as derive does).
export function dec9State(over = {}) {
  const rows = DEC9.daysBefore.map(dayOf).concat(seedDays());
  return {
    status: "ready",
    me: "Mo",
    trip: { name: "Japan 2026", start: DEC9.trip.start, end: "2026-12-20", tz: "Asia/Tokyo" },
    eves: rows.filter((d) => d.kind === "eve"),
    days: rows.filter((d) => d.kind !== "eve"),
    stops: DEC9.stops.map((s) => ({ travelMin: 0, fixed: false, deleted: false, place: "", ...s })),
    stays: DEC9.stays.map((s) => ({ deleted: false, ...s })),
    tickets: [],
    ticketsReady: true,
    ...over,
  };
}

// The seed's 11-day trip with no zoned day: the state every phone holds today.
export function seedState(over = {}) {
  return { status: "ready", me: "Mo", trip: { name: "Japan 2026", start: "2026-12-10", end: "2026-12-20", tz: "Asia/Tokyo" }, eves: [], days: seedDays(), stops: [], stays: [], tickets: [], ticketsReady: true, ...over };
}

// An instant on the Eastern wall clock: et("2026-12-09T07:00").
export const et = (iso) => Date.parse(iso + ":00-05:00");
