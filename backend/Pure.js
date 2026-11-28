// Pure logic. Plain global functions so Apps Script can run it as-is;
// the footer lets Node tests load the same file.

var TABS = {
  Trip: ["key", "value"],
  People: ["name", "initials", "order", "etransfer", "simplify", "email", "photo"],
  // tz: a day in its own time zone (blank: the trip's); kind: "eve" for the
  // evening before the first day. Both typed in the Sheet only: no action writes them.
  Days: ["date", "city", "title", "line_jp", "line_en", "line_colour", "from_jp", "from_en", "to_jp", "to_en", "lat", "lng", "tz", "kind"],
  Stops: ["id", "date", "time", "title", "detail", "getting_there", "travel_min", "fixed", "place", "sign_jp", "booked", "link", "photo", "note", "deleted_at", "lat", "lng", "tk_ref", "tk_name", "tk_people", "tk_seat", "name_jp", "address_jp"],
  Stays: ["id", "name", "name_jp", "address_jp", "first_night", "last_night", "note", "place", "link", "photo", "deleted_at", "lat", "lng", "tk_ref", "tk_name", "tk_people", "tk_room"],
  Expenses: ["id", "day", "title", "amount", "currency", "rate", "paid_by", "split", "split_mode", "split_vals", "note", "kind", "receipt", "added_by", "added_at", "deleted_at", "planner_id"],
  Settlements: ["id", "from", "to", "cad", "stamped_by", "stamped_at", "seed", "rot", "removed_at"],
  Log: ["id", "at", "who", "via", "action", "kind", "ref", "summary", "before", "after", "undoes", "undone_by"],
  Todos: ["id", "item", "book_by", "status", "note", "link", "claimed_by", "ticked_by", "ticked_at", "ticked_item", "planner_written", "planner_was", "gone"],
  StampDefs: ["id", "date", "name_ja", "name_en", "place", "motif", "ink", "shape"],
  Stamps: ["id", "def", "who", "at", "seed", "gone", "here"],
  // The real ticket on a stop: one row per picture (no data), and the
  // pictures' base64 in chunks, one cell each (README, The ticket on a stop).
  // planner_id: the line of the planner's Tickets list a picture came from
  // ("T007:<print>"), set only by an add from the list (auto-add).
  // stay: the stay a picture is on (a booking), set instead of stop.
  Tickets: ["id", "stop", "who", "seat", "page", "mime", "w", "h", "size", "chunks", "by", "at", "gone", "planner_id", "stay"],
  TicketData: ["ticket", "n", "data"],
};

var KINDS = ["food", "transport", "stay", "activity", "shopping"];

// Every column is plain text (so Sheets never turns "1/2" into a date or
// "0012" into 12) except these numbers and booleans.
var NUMBER_COLUMNS_ = ["amount", "rate", "cad", "seed", "rot", "order", "travel_min"];
var LOG_NUMBER_COLUMNS_ = ["id", "undoes", "undone_by"];
var BOOLEAN_COLUMNS_ = ["simplify", "fixed", "booked"];

function isTextColumn(tab, header) {
  if (NUMBER_COLUMNS_.indexOf(header) !== -1 || BOOLEAN_COLUMNS_.indexOf(header) !== -1) return false;
  if (tab === "Log" && LOG_NUMBER_COLUMNS_.indexOf(header) !== -1) return false;
  return true;
}

var ID_RE_ = /^[A-Za-z0-9][A-Za-z0-9_-]{7,39}$/;
var DAY_RE_ = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeCell(v) {
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

// Undoes sanitizeCell on read, whether or not Sheets kept the apostrophe in a
// plain-text cell: "'" followed by = + - @ tab or CR loses that one apostrophe.
function unsanitizeCell(v) {
  if (typeof v === "string" && /^'[=+\-@\t\r]/.test(v)) return v.slice(1);
  return v;
}

function rowToObj(headers, row) {
  var o = {};
  for (var i = 0; i < headers.length; i++) o[headers[i]] = i < row.length ? unsanitizeCell(row[i]) : "";
  return o;
}

function objToRow(headers, obj) {
  return headers.map(function (h) {
    var v = obj[h];
    return v === undefined || v === null ? "" : sanitizeCell(v);
  });
}

// ---- input checking ----

function fail_(message) { return { ok: false, message: message }; }

function isObj_(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

function round2_(n) {
  var s = String(n);
  if (s.indexOf("e") !== -1) return Math.round(n * 100) / 100;
  return Number(Math.round(Number(s + "e2")) + "e-2");
}

function cents_(n) { return Math.round(Number(String(round2_(n)) + "e2")); }

function realDay_(s) {
  var y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  var dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= dim[m - 1];
}

function validateExpense(input, peopleNames) {
  if (!isObj_(input)) return fail_("That didn’t come through properly.");
  var id = input.id, day = input.day, title = input.title, amount = input.amount;
  if (typeof id !== "string" || !ID_RE_.test(id)) return fail_("That line has a bad id.");
  if (typeof day !== "string" || (day !== "pre" && (!DAY_RE_.test(day) || !realDay_(day)))) return fail_("Pick a day.");
  if (typeof title !== "string") return fail_("Say what it was for.");
  title = title.trim();
  if (!title) return fail_("Say what it was for.");
  if (title.length > 80) return fail_("Keep the name under 80 letters.");
  if (typeof amount !== "number" || !isFinite(amount)) return fail_("Put in an amount.");
  if (input.currency !== "JPY" && input.currency !== "CAD") return fail_("Use yen or Canadian dollars.");
  var currency = input.currency;
  amount = currency === "JPY" ? Math.round(amount) : round2_(amount);
  if (!(amount > 0)) return fail_("The amount has to be more than zero.");
  if (amount > 10000000) return fail_("That amount is too big.");
  if (typeof input.paidBy !== "string" || peopleNames.indexOf(input.paidBy) === -1) return fail_("Pick who paid.");
  var split = input.split;
  if (!Array.isArray(split) || split.length === 0) return fail_("Pick who shares it.");
  for (var i = 0; i < split.length; i++) {
    if (typeof split[i] !== "string" || peopleNames.indexOf(split[i]) === -1) return fail_("Someone in the split isn’t on this trip.");
    if (split.indexOf(split[i]) !== i) return fail_("Someone is in the split twice.");
  }
  var note = input.note === undefined || input.note === null ? "" : input.note;
  if (typeof note !== "string") return fail_("The note didn’t come through properly.");
  note = note.trim();
  if (note.length > 200) return fail_("Keep the note under 200 letters.");
  var kind = input.kind === undefined || input.kind === null ? "" : input.kind;
  if (kind !== "" && KINDS.indexOf(kind) === -1) return fail_("That kind isn’t one we know.");
  var mode = input.splitMode === undefined || input.splitMode === null || input.splitMode === "" ? "equal" : input.splitMode;
  var vals = input.splitVals === undefined || input.splitVals === null ? [] : input.splitVals;
  if (!Array.isArray(vals)) return fail_("The split didn’t come through properly.");
  if (mode === "equal") {
    vals = [];
  } else if (mode === "parts") {
    if (vals.length !== split.length) return fail_("Give every person a share.");
    for (var p = 0; p < vals.length; p++) {
      if (typeof vals[p] !== "number" || vals[p] % 1 !== 0 || vals[p] < 1 || vals[p] > 99) return fail_("Shares must be whole numbers from 1 to 99.");
    }
  } else if (mode === "exact") {
    if (vals.length !== split.length) return fail_("Give every person an amount.");
    var sum = 0;
    var rounded = [];
    for (var x = 0; x < vals.length; x++) {
      var v = vals[x];
      if (typeof v !== "number" || !isFinite(v) || !(v > 0)) return fail_("Every amount has to be more than zero.");
      var units = currency === "JPY" ? Math.round(v) : cents_(v);
      if (units < 1) return fail_("Every amount has to be at least " + (currency === "JPY" ? "one yen." : "one cent."));
      sum += units;
      rounded.push(currency === "JPY" ? units : units / 100);
    }
    var total = currency === "JPY" ? amount : cents_(amount);
    if (sum !== total) return fail_("The amounts don’t add up to the total.");
    vals = rounded;
  } else {
    return fail_("That way of splitting isn’t one we know.");
  }
  return {
    ok: true,
    value: { id: id, day: day, title: title, amount: amount, currency: currency, paidBy: input.paidBy, split: split.slice(), splitMode: mode, splitVals: vals.slice(), note: note, kind: kind },
  };
}

function validatePayment(input, peopleNames) {
  if (!isObj_(input)) return fail_("That didn’t come through properly.");
  if (typeof input.id !== "string" || !ID_RE_.test(input.id)) return fail_("That payment has a bad id.");
  if (typeof input.from !== "string" || peopleNames.indexOf(input.from) === -1) return fail_("Pick who paid.");
  if (typeof input.to !== "string" || peopleNames.indexOf(input.to) === -1) return fail_("Pick who got paid.");
  if (input.from === input.to) return fail_("Nobody can pay themselves.");
  if (typeof input.cad !== "number" || !isFinite(input.cad)) return fail_("Put in an amount.");
  var cad = round2_(input.cad);
  if (!(cad > 0)) return fail_("The amount has to be more than zero.");
  if (cad > 100000) return fail_("That amount is too big.");
  if (typeof input.seed !== "number" || input.seed % 1 !== 0 || input.seed < 1) return fail_("That payment is missing its stamp.");
  if (typeof input.rot !== "number" || !isFinite(input.rot)) return fail_("That payment is missing its stamp.");
  return { ok: true, value: { id: input.id, from: input.from, to: input.to, cad: cad, seed: input.seed, rot: input.rot } };
}

// A person's picture (Task 16): a square JPEG the phone has already shrunk,
// as a data address, or "" for none. Nothing else is ever stored or drawn.
var PHOTO_RE_ = /^data:image\/jpeg;base64,[A-Za-z0-9+\/]+={0,2}$/;
var PHOTO_MAX_ = 12000;
var PHOTO_BAD_ = "That picture couldn\u2019t be used. Try another.";
var PHOTO_HEAD_ = "data:image/jpeg;base64,";
// The address's shape, and its base64 part in whole 4-character groups.
function isPhoto_(ph) {
  return PHOTO_RE_.test(ph) && (ph.length - PHOTO_HEAD_.length) % 4 === 0;
}

function validatePersonPatch(patch) {
  if (!isObj_(patch)) return fail_("That didn’t come through properly.");
  var out = {};
  var keys = Object.keys(patch);
  if (keys.length === 0) return fail_("Nothing to change.");
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === "etransfer") {
      if (typeof patch.etransfer !== "string") return fail_("The e-Transfer address didn’t come through properly.");
      var t = patch.etransfer.trim();
      if (t.length > 80) return fail_("Keep the e-Transfer address under 80 letters.");
      out.etransfer = t;
    } else if (k === "simplify") {
      if (typeof patch.simplify !== "boolean") return fail_("Simplify has to be on or off.");
      out.simplify = patch.simplify;
    } else if (k === "photo") {
      var ph = patch.photo;
      if (typeof ph !== "string" || ph.length > PHOTO_MAX_ || (ph !== "" && !isPhoto_(ph))) return fail_(PHOTO_BAD_);
      out.photo = ph;
    } else {
      return fail_("You can only change the e-Transfer address, Simplify and your picture.");
    }
  }
  return { ok: true, value: out };
}

// ---- stops, stays and day headers ----

var DAY_PATCH_KEYS = ["city", "title", "lineJp", "lineEn", "lineColour", "fromJp", "fromEn", "toJp", "toEn"];
var TIME_RE_ = /^([01]\d|2[0-3]):[0-5]\d$/;
var COLOUR_RE_ = /^#[0-9A-Fa-f]{6}$/;

// The trimmed link when it is http(s) with no spaces and not too long, else "".
function safeUrl(v) {
  if (typeof v !== "string") return "";
  var t = v.trim();
  return t.length <= 500 && /^https?:\/\/\S+$/i.test(t) ? t : "";
}

// A picture address has to be https (a stop's photo is only checked as a link;
// a stay's is held to the https the message promises).
function safeHttpsUrl(v) {
  var u = safeUrl(v);
  return /^https:/i.test(u) ? u : "";
}

function optPhoto_(v, message) {
  if (v === undefined || v === null) return { ok: true, value: "" };
  if (typeof v !== "string") return fail_(message);
  if (v.trim() === "") return { ok: true, value: "" };
  // safeUrl takes nothing over 500 letters: say so, not that it isn't https.
  if (v.trim().length > 500) return fail_("That picture link is too long.");
  var u = safeHttpsUrl(v);
  return u ? { ok: true, value: u } : fail_(message);
}

function dayLabel(date) {
  var s = String(date);
  if (!DAY_RE_.test(s) || !realDay_(s)) return s;
  var d = new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))));
  var wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  var mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return wd + " " + mo + " " + d.getUTCDate();
}

function validDay_(v) { return typeof v === "string" && DAY_RE_.test(v) && realDay_(v); }

// Optional text: absent is "", otherwise a string trimmed and kept to max letters.
function optText_(v, max, tooLong) {
  if (v === undefined || v === null) return { ok: true, value: "" };
  if (typeof v !== "string") return fail_("That didn’t come through properly.");
  var t = v.trim();
  if (t.length > max) return fail_(tooLong);
  return { ok: true, value: t };
}

// Optional link: absent or blank is "", otherwise it has to be http(s).
function optLink_(v, message) {
  if (v === undefined || v === null) return { ok: true, value: "" };
  if (typeof v !== "string") return fail_(message);
  if (v.trim() === "") return { ok: true, value: "" };
  var u = safeUrl(v);
  return u ? { ok: true, value: u } : fail_(message);
}

// A place is plain words or a pasted Maps link; anything starting http has to be a good link.
function optPlace_(v) {
  var r = optText_(v, 200, "Keep the place under 200 letters.");
  if (!r.ok) return r;
  if (/^https?:/i.test(r.value) && !safeUrl(r.value)) return fail_("That map link didn’t come through properly.");
  return r;
}

function optFlag_(v, message) {
  if (v === undefined || v === null) return { ok: true, value: false };
  if (typeof v !== "boolean") return fail_(message);
  return { ok: true, value: v };
}

// ---- where things are (lat, lng: numbers kept as text, "" when unknown) ----

var COORD_RE_ = /^-?\d{1,3}(\.\d+)?$/;
var COORD_BAD_ = "That map position didn\u2019t come through properly.";

// A coordinate as the Sheet keeps it: the number as text, else "".
function coordText_(v, max) {
  if (v === undefined || v === null || v === "") return "";
  var t = String(v).trim();
  if (!COORD_RE_.test(t)) return "";
  var n = Number(t);
  return isFinite(n) && Math.abs(n) <= max ? String(n) : "";
}

// { lat, lng } from a row: both or neither.
function coordsOf_(o) {
  var lat = coordText_(o.lat, 90);
  var lng = coordText_(o.lng, 180);
  return lat !== "" && lng !== "" ? { lat: lat, lng: lng } : { lat: "", lng: "" };
}

// Optional coordinates sent by the app (from a pasted Maps link): two
// strings, both empty (not on the map) or both a coordinate.
function optCoords_(lat, lng) {
  if ((lat === undefined || lat === null) && (lng === undefined || lng === null)) return { ok: true, value: { lat: "", lng: "" } };
  if (typeof lat !== "string" || typeof lng !== "string") return fail_(COORD_BAD_);
  if (lat.trim() === "" && lng.trim() === "") return { ok: true, value: { lat: "", lng: "" } };
  var c = { lat: coordText_(lat, 90), lng: coordText_(lng, 180) };
  if (c.lat === "" || c.lng === "") return fail_(COORD_BAD_);
  return { ok: true, value: c };
}

// Metres between two { lat, lng } (numbers or text), along the ground; NaN when either is not a coordinate.
function metresBetween_(a, b) {
  var p = coordsOf_(a || {}), q = coordsOf_(b || {});
  if (p.lat === "" || q.lat === "") return NaN;
  var rad = Math.PI / 180;
  var dLat = (Number(q.lat) - Number(p.lat)) * rad, dLng = (Number(q.lng) - Number(p.lng)) * rad;
  var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(Number(p.lat) * rad) * Math.cos(Number(q.lat) * rad) * Math.pow(Math.sin(dLng / 2), 2);
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The position in a pasted Google Maps link (the place's pin !3d..!4d.., else,
// only in a place or search link, the map's centre @lat,lng), or null. Never
// from a directions link (its start may be where someone was) or a bare map
// view. The same rule as js/geo.js pointFromLink.
function pointFromLink(text) {
  if (typeof text !== "string") return null;
  var s = text.trim();
  if (/\/dir\//i.test(s)) return null;
  var m = /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/.exec(s);
  if (!m && /\/(?:place|search)\//i.test(s)) m = /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/.exec(s);
  if (!m) return null;
  var c = coordsOf_({ lat: m[1], lng: m[2] });
  return c.lat === "" ? null : c;
}

function validateStop(input, dayDates) {
  if (!isObj_(input)) return fail_("That didn’t come through properly.");
  if (typeof input.id !== "string" || !ID_RE_.test(input.id)) return fail_("That stop has a bad id.");
  if (!validDay_(input.date) || dayDates.indexOf(input.date) === -1) return fail_("Pick a day of the trip.");
  if (typeof input.title !== "string" || input.title.trim() === "") return fail_("Say what it is.");
  var title = input.title.trim();
  if (title.length > 80) return fail_("Keep the name under 80 letters.");
  var time = input.time === undefined || input.time === null ? "" : input.time;
  if (typeof time !== "string" || (time !== "" && !TIME_RE_.test(time))) return fail_("Use a time like 14:30.");
  var travel = input.travelMin === undefined || input.travelMin === null || input.travelMin === "" ? 0 : input.travelMin;
  if (typeof travel !== "number" || travel % 1 !== 0 || travel < 0 || travel > 600) return fail_("Minutes to get there must be a whole number from 0 to 600.");
  var detail = optText_(input.detail, 120, "Keep the detail under 120 letters.");
  if (!detail.ok) return detail;
  var there = optText_(input.gettingThere, 300, "Keep the directions under 300 letters.");
  if (!there.ok) return there;
  var fixed = optFlag_(input.fixed, "Fixed has to be on or off.");
  if (!fixed.ok) return fixed;
  var place = optPlace_(input.place);
  if (!place.ok) return place;
  var sign = optText_(input.signJp, 20, "Keep the sign name under 20 letters.");
  if (!sign.ok) return sign;
  var booked = optFlag_(input.booked, "Booked has to be on or off.");
  if (!booked.ok) return booked;
  var link = optLink_(input.link, "That link has to start with https://.");
  if (!link.ok) return link;
  var photo = optLink_(input.photo, "That photo link has to start with https://.");
  if (!photo.ok) return photo;
  var note = optText_(input.note, 300, "Keep the note under 300 letters.");
  if (!note.ok) return note;
  var at = optCoords_(input.lat, input.lng);
  if (!at.ok) return at;
  var facts = {};
  for (var i = 0; i < TICKET_FACTS_.length; i++) {
    var fact = optText_(input[TICKET_FACTS_[i]], TICKET_LIMITS.fact, "Keep each ticket detail under " + TICKET_LIMITS.fact + " letters.");
    if (!fact.ok) return fact;
    facts[TICKET_FACTS_[i]] = fact.value;
  }
  // For a taxi driver (#95): the stay's own words and limits.
  var nameJp = optText_(input.nameJp, 80, "Keep the Japanese name under 80 letters.");
  if (!nameJp.ok) return nameJp;
  var addressJp = optText_(input.addressJp, 200, "Keep the address under 200 letters.");
  if (!addressJp.ok) return addressJp;
  return {
    ok: true,
    value: { id: input.id, date: input.date, time: time, title: title, detail: detail.value, gettingThere: there.value, travelMin: travel, fixed: fixed.value, place: place.value, signJp: sign.value, booked: booked.value, link: link.value, photo: photo.value, note: note.value, lat: at.value.lat, lng: at.value.lng, tkRef: facts.tkRef, tkName: facts.tkName, tkPeople: facts.tkPeople, tkSeat: facts.tkSeat, nameJp: nameJp.value, addressJp: addressJp.value },
  };
}

function validateStay(input) {
  if (!isObj_(input)) return fail_("That didn’t come through properly.");
  if (typeof input.id !== "string" || !ID_RE_.test(input.id)) return fail_("That stay has a bad id.");
  if (typeof input.name !== "string" || input.name.trim() === "") return fail_("Say where you’re staying.");
  var name = input.name.trim();
  if (name.length > 80) return fail_("Keep the name under 80 letters.");
  var nameJp = optText_(input.nameJp, 80, "Keep the Japanese name under 80 letters.");
  if (!nameJp.ok) return nameJp;
  var addressJp = optText_(input.addressJp, 200, "Keep the address under 200 letters.");
  if (!addressJp.ok) return addressJp;
  if (!validDay_(input.firstNight) || !validDay_(input.lastNight)) return fail_("Pick the first and last night.");
  if (input.lastNight < input.firstNight) return fail_("The last night can’t be before the first.");
  var note = optText_(input.note, 300, "Keep the note under 300 letters.");
  if (!note.ok) return note;
  var place = optPlace_(input.place);
  if (!place.ok) return place;
  var link = optLink_(input.link, "That link has to start with https://.");
  if (!link.ok) return link;
  var photo = optPhoto_(input.photo, "That photo link has to start with https://.");
  if (!photo.ok) return photo;
  // The booking on a stay: four facts, as a stop's ticket has (Room where a stop says Seat).
  var facts = {};
  for (var i = 0; i < STAY_FACTS_.length; i++) {
    var fact = optText_(input[STAY_FACTS_[i]], TICKET_LIMITS.fact, "Keep each booking detail under " + TICKET_LIMITS.fact + " letters.");
    if (!fact.ok) return fact;
    facts[STAY_FACTS_[i]] = fact.value;
  }
  return {
    ok: true,
    value: { id: input.id, name: name, nameJp: nameJp.value, addressJp: addressJp.value, firstNight: input.firstNight, lastNight: input.lastNight, note: note.value, place: place.value, link: link.value, photo: photo.value, tkRef: facts.tkRef, tkName: facts.tkName, tkPeople: facts.tkPeople, tkRoom: facts.tkRoom },
  };
}

function validateDayPatch(patch) {
  if (!isObj_(patch)) return fail_("That didn’t come through properly.");
  var keys = Object.keys(patch);
  if (keys.length === 0) return fail_("Nothing to change.");
  var out = {};
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (DAY_PATCH_KEYS.indexOf(k) === -1) return fail_("Only a day’s city, title, line and places can be changed.");
    var v = patch[k];
    if (typeof v !== "string") return fail_("That didn’t come through properly.");
    v = v.trim();
    if (k === "lineColour") {
      if (v !== "" && !COLOUR_RE_.test(v)) return fail_("Use a colour like #2FB6E8.");
    } else if (k === "title") {
      if (v.length > 80) return fail_("Keep the title under 80 letters.");
    } else if (v.length > 60) {
      return fail_("Keep each line, city and place under 60 letters.");
    }
    out[k] = v;
  }
  return { ok: true, value: out };
}

// ---- sheet row -> API shape ----

function cellDate_(v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return "";
    if (typeof Utilities !== "undefined" && typeof Session !== "undefined") return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
    return v.toISOString().slice(0, 10);
  }
  return v === undefined || v === null ? "" : String(v);
}

function cellStamp_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString();
  return v === undefined || v === null ? "" : String(v);
}

function cellText_(v) { return v === undefined || v === null ? "" : String(v); }

function cellNum_(v) {
  if (v === "" || v === undefined || v === null) return 0;
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

function cellList_(v) {
  if (v === undefined || v === null || v === "") return [];
  if (Array.isArray(v)) return v.map(cellText_);
  return String(v).split(",").map(function (s) { return s.trim(); }).filter(function (s) { return s !== ""; });
}

function cellSet_(v) { return v !== undefined && v !== null && v !== "" && !(v instanceof Date && isNaN(v.getTime())); }

function expenseFromRow(o) {
  return {
    id: cellText_(o.id),
    day: cellDate_(o.day),
    title: cellText_(o.title),
    amount: cellNum_(o.amount),
    currency: cellText_(o.currency),
    rate: cellNum_(o.rate),
    paidBy: cellText_(o.paid_by),
    split: cellList_(o.split),
    splitMode: cellText_(o.split_mode) || "equal",
    splitVals: cellList_(o.split_vals).map(Number),
    note: cellText_(o.note),
    kind: cellText_(o.kind),
    addedBy: cellText_(o.added_by),
    addedAt: cellStamp_(o.added_at),
    deleted: cellSet_(o.deleted_at),
  };
}

function paymentFromRow(o) {
  return {
    id: cellText_(o.id),
    from: cellText_(o.from),
    to: cellText_(o.to),
    cad: cellNum_(o.cad),
    stampedBy: cellText_(o.stamped_by),
    stampedAt: cellStamp_(o.stamped_at),
    seed: cellNum_(o.seed),
    rot: cellNum_(o.rot),
    removed: cellSet_(o.removed_at),
  };
}

function personFromRow(o) {
  var off = o.simplify === false || String(o.simplify).trim().toUpperCase() === "FALSE";
  return { name: cellText_(o.name), initials: cellText_(o.initials), etransfer: cellText_(o.etransfer), simplify: !off, photo: cellText_(o.photo) };
}

function cellBool_(v) { return v === true || String(v).trim().toUpperCase() === "TRUE"; }

// A stop's time cell as "HH:MM", or "" when it holds no readable time. Typed
// by hand it may lack the leading zero (9:30). Sheets may hand a time cell
// back as a fraction of a day (0.5 is 12:00) or as a Date on its zero day in
// the sheet's zone: like cellDate_, that Date is read in the script's zone,
// and only on Apps Script; a reading with stray seconds (an old zone's local
// mean time on that 1899 day) is not trusted and counts as no time.
function cellTime_(v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime()) || typeof Utilities === "undefined" || typeof Session === "undefined") return "";
    var hms = Utilities.formatDate(v, Session.getScriptTimeZone(), "HH:mm:ss");
    return /^([01]\d|2[0-3]):[0-5]\d:00$/.test(hms) ? hms.slice(0, 5) : "";
  }
  if (typeof v === "number") {
    if (!isFinite(v) || v < 0 || v >= 1) return "";
    var m = Math.round(v * 1440);
    if (m >= 1440) return "";
    return (m < 600 ? "0" : "") + Math.floor(m / 60) + ":" + (m % 60 < 10 ? "0" : "") + (m % 60);
  }
  var t = cellText_(v).trim();
  if (/^\d:[0-5]\d$/.test(t)) t = "0" + t;
  return TIME_RE_.test(t) ? t : "";
}

// Minutes to get there: a whole number from 0 up (rounded); anything else 0.
function cellMinutes_(v) {
  var n = cellNum_(v);
  return n > 0 ? Math.round(n) : 0;
}

function stopFromRow(o) {
  return {
    id: cellText_(o.id),
    date: cellDate_(o.date),
    time: cellTime_(o.time),
    title: cellText_(o.title),
    detail: cellText_(o.detail),
    gettingThere: cellText_(o.getting_there),
    travelMin: cellMinutes_(o.travel_min),
    fixed: cellBool_(o.fixed),
    place: cellText_(o.place),
    signJp: cellText_(o.sign_jp),
    booked: cellBool_(o.booked),
    link: safeUrl(cellText_(o.link)),
    photo: safeUrl(cellText_(o.photo)),
    note: cellText_(o.note),
    deleted: cellSet_(o.deleted_at),
    lat: coordsOf_(o).lat,
    lng: coordsOf_(o).lng,
    tkRef: cellText_(o.tk_ref),
    tkName: cellText_(o.tk_name),
    tkPeople: cellText_(o.tk_people),
    tkSeat: cellText_(o.tk_seat),
    nameJp: cellText_(o.name_jp),
    addressJp: cellText_(o.address_jp),
  };
}

function stayFromRow(o) {
  return {
    id: cellText_(o.id),
    name: cellText_(o.name),
    nameJp: cellText_(o.name_jp),
    addressJp: cellText_(o.address_jp),
    firstNight: cellDate_(o.first_night),
    lastNight: cellDate_(o.last_night),
    note: cellText_(o.note),
    place: cellText_(o.place),
    link: safeUrl(cellText_(o.link)),
    photo: safeHttpsUrl(cellText_(o.photo)),
    deleted: cellSet_(o.deleted_at),
    lat: coordsOf_(o).lat,
    lng: coordsOf_(o).lng,
    tkRef: cellText_(o.tk_ref),
    tkName: cellText_(o.tk_name),
    tkPeople: cellText_(o.tk_people),
    tkRoom: cellText_(o.tk_room),
  };
}

function dayFromRow(o) {
  var colour = cellText_(o.line_colour).trim();
  return {
    date: cellDate_(o.date),
    city: cellText_(o.city),
    title: cellText_(o.title),
    lineJp: cellText_(o.line_jp),
    lineEn: cellText_(o.line_en),
    lineColour: COLOUR_RE_.test(colour) ? colour : "",
    fromJp: cellText_(o.from_jp),
    fromEn: cellText_(o.from_en),
    toJp: cellText_(o.to_jp),
    toEn: cellText_(o.to_en),
    lat: coordsOf_(o).lat,
    lng: coordsOf_(o).lng,
    tz: dayZone_(o.tz),
    kind: cellText_(o.kind).trim().toLowerCase() === "eve" ? "eve" : "",
  };
}

// A Days.tz cell when it looks like a zone name ("America/New_York"), at
// most 40 letters; else "" (the trip's zone). The app checks it is a real one.
var DAY_ZONE_RE_ = /^[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2}$/;
function dayZone_(v) {
  var t = cellText_(v).trim();
  return t.length <= 40 && DAY_ZONE_RE_.test(t) ? t : "";
}

// ---- API shape -> sheet row ----
// Timestamps (added_at, deleted_at, stamped_at, removed_at) are left to the
// action that writes the row. Optional fields that are absent are left out, so
// the result can also be used as a patch.

function put_(o, key, v) { if (v !== undefined) o[key] = v; }

function expenseToRow(e) {
  var o = {};
  put_(o, "id", e.id);
  put_(o, "day", e.day);
  put_(o, "title", e.title);
  put_(o, "amount", e.amount);
  put_(o, "currency", e.currency);
  put_(o, "rate", e.rate);
  put_(o, "paid_by", e.paidBy);
  put_(o, "split", Array.isArray(e.split) ? e.split.join(",") : undefined);
  put_(o, "split_mode", e.splitMode);
  put_(o, "split_vals", Array.isArray(e.splitVals) ? e.splitVals.join(",") : undefined);
  put_(o, "note", e.note);
  put_(o, "kind", e.kind);
  put_(o, "added_by", e.addedBy);
  return o;
}

function paymentToRow(p) {
  var o = {};
  put_(o, "id", p.id);
  put_(o, "from", p.from);
  put_(o, "to", p.to);
  put_(o, "cad", p.cad);
  put_(o, "stamped_by", p.stampedBy);
  put_(o, "seed", p.seed);
  put_(o, "rot", p.rot);
  return o;
}

function stopToRow(s) {
  var o = {};
  put_(o, "id", s.id);
  put_(o, "date", s.date);
  put_(o, "time", s.time);
  put_(o, "title", s.title);
  put_(o, "detail", s.detail);
  put_(o, "getting_there", s.gettingThere);
  put_(o, "travel_min", s.travelMin);
  put_(o, "fixed", s.fixed);
  put_(o, "place", s.place);
  put_(o, "sign_jp", s.signJp);
  put_(o, "booked", s.booked);
  put_(o, "link", s.link);
  put_(o, "photo", s.photo);
  put_(o, "note", s.note);
  put_(o, "lat", s.lat);
  put_(o, "lng", s.lng);
  put_(o, "tk_ref", s.tkRef);
  put_(o, "tk_name", s.tkName);
  put_(o, "tk_people", s.tkPeople);
  put_(o, "tk_seat", s.tkSeat);
  put_(o, "name_jp", s.nameJp);
  put_(o, "address_jp", s.addressJp);
  return o;
}

function stayToRow(s) {
  var o = {};
  put_(o, "id", s.id);
  put_(o, "name", s.name);
  put_(o, "name_jp", s.nameJp);
  put_(o, "address_jp", s.addressJp);
  put_(o, "first_night", s.firstNight);
  put_(o, "last_night", s.lastNight);
  put_(o, "note", s.note);
  put_(o, "place", s.place);
  put_(o, "link", s.link);
  put_(o, "photo", s.photo);
  put_(o, "lat", s.lat);
  put_(o, "lng", s.lng);
  put_(o, "tk_ref", s.tkRef);
  put_(o, "tk_name", s.tkName);
  put_(o, "tk_people", s.tkPeople);
  put_(o, "tk_room", s.tkRoom);
  return o;
}

function dayToRow(d) {
  var o = {};
  put_(o, "date", d.date);
  put_(o, "city", d.city);
  put_(o, "title", d.title);
  put_(o, "line_jp", d.lineJp);
  put_(o, "line_en", d.lineEn);
  put_(o, "line_colour", d.lineColour);
  put_(o, "from_jp", d.fromJp);
  put_(o, "from_en", d.fromEn);
  put_(o, "to_jp", d.toJp);
  put_(o, "to_en", d.toEn);
  put_(o, "lat", d.lat);
  put_(o, "lng", d.lng);
  return o;
}

// The rows setup() writes into an empty Sheet (also used by the test backend).
function setupSeedRows() {
  var days = [];
  for (var d = 10; d <= 20; d++) days.push({ date: "2026-12-" + d });
  return {
    Trip: [
      { key: "name", value: "Japan 2026" }, { key: "start", value: "2026-12-10" }, { key: "end", value: "2026-12-20" },
      { key: "home", value: "CAD" }, { key: "currency", value: "JPY" }, { key: "tz", value: "Asia/Tokyo" },
    ],
    People: [
      { name: "Mo", initials: "MO", order: 1, etransfer: "", simplify: true, email: "", photo: "" },
      { name: "Ajen", initials: "AJ", order: 2, etransfer: "", simplify: true, email: "", photo: "" },
      { name: "Trenton", initials: "TR", order: 3, etransfer: "", simplify: true, email: "", photo: "" },
    ],
    Days: days,
  };
}

// ---- exchange rate ----

// Where the rate in use came from: today's stored rate is "live", an earlier
// day's (RATE_LAST) is "last", none at all means the stand-in 111, "fallback".
function rateSource(todayKeyValue, lastValue) {
  if (Number(todayKeyValue) > 0) return "live";
  if (Number(lastValue) > 0) return "last";
  return "fallback";
}

// The trip key check: whole keys only, and the time taken does not depend on
// where two keys of the same length first differ.
function sameKey(given, key) {
  if (typeof given !== "string" || typeof key !== "string" || key === "" || given.length !== key.length) return false;
  var diff = 0;
  for (var i = 0; i < key.length; i++) diff |= given.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

// ---- personal keys (security, 2026-11-18) ----

// Bytes as lower-case hex. Apps Script's computeDigest gives signed bytes
// (-128..127); each is taken as its low 8 bits.
function hexOfBytes(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i++) out += ("0" + (bytes[i] & 0xff).toString(16)).slice(-2);
  return out;
}

var KEY_HASH_RE_ = /^[0-9a-f]{64}$/;

// PERSON_KEYS as stored ({ "<name>": { hash, at } }), keeping only entries
// whose hash is 64 hex characters. Anything else (missing, not JSON, not an
// object) is no personal keys at all.
function personKeysFrom(raw) {
  var out = {};
  if (typeof raw !== "string" || raw === "") return out;
  var obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return out;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  Object.keys(obj).forEach(function (name) {
    var v = obj[name];
    if (name !== "" && name !== "__proto__" && v && typeof v === "object" && typeof v.hash === "string" && KEY_HASH_RE_.test(v.hash)) {
      out[name] = { hash: v.hash, at: typeof v.at === "string" ? v.at : "" };
    }
  });
  return out;
}

// Whether a stored PERSON_KEYS can be read: absent or empty (no personal
// keys yet), or a JSON object. Anything else (broken JSON, an array, null, a
// string) is a property someone broke by hand: not readable.
function personKeysReadable(raw) {
  if (raw === null || raw === undefined || raw === "") return true;
  if (typeof raw !== "string") return false;
  try {
    var obj = JSON.parse(raw);
    return !!obj && typeof obj === "object" && !Array.isArray(obj);
  } catch (e) {
    return false;
  }
}

// Who holds a key: { kind: "person", name } | { kind: "check" } |
// { kind: "shared" } | null. given is the key as sent, givenHash its SHA-256
// in hex, shared the shared trip key (null or "" once retired: then nothing
// matches it), people PERSON_KEYS as personKeysFrom reads it, checkHash the
// release check's key hash. Every stored hash is compared, the same way
// whatever matches (no early exit), and an empty key never matches anything.
function keyHolder(given, givenHash, shared, people, checkHash) {
  if (typeof given !== "string" || given === "" || typeof givenHash !== "string" || !KEY_HASH_RE_.test(givenHash)) return null;
  var person = null;
  var names = Object.keys(people || {});
  for (var i = 0; i < names.length; i++) {
    var hit = sameKey(givenHash, people[names[i]].hash);
    if (hit && person === null) person = names[i];
  }
  var check = typeof checkHash === "string" && KEY_HASH_RE_.test(checkHash) && sameKey(givenHash, checkHash);
  var isShared = typeof shared === "string" && shared !== "" && sameKey(given, shared);
  if (person !== null) return { kind: "person", name: person };
  if (check) return { kind: "check" };
  if (isShared) return { kind: "shared" };
  return null;
}

// Text for the owner's log with anything secret blanked: each of `secrets`
// (keys, tokens, ids of 5 characters or more) wherever it appears, and any
// run of 20 or more letters, digits, - or _ (the shape of a key, a token or
// a spreadsheet id) in case one was not on the list.
function blankSecrets(text, secrets) {
  var s = String(text);
  (secrets || []).forEach(function (x) {
    if (typeof x === "string" && x.length >= 5) s = s.split(x).join("(hidden)");
  });
  return s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "(hidden)").replace(/[A-Za-z0-9_-]{20,}/g, "(hidden)");
}

// Whether to fetch today's rate: only when today's is not stored yet and the
// last failed fetch (failAtIso) was not within the past hour.
function shouldFetchRate(todayKeyValue, failAtIso, nowIso) {
  if (Number(todayKeyValue) > 0) return false;
  var failAt = failAtIso ? Date.parse(failAtIso) : NaN;
  var now = Date.parse(nowIso);
  if (isNaN(failAt) || isNaN(now)) return true;
  var since = now - failAt;
  return !(since >= 0 && since < 60 * 60 * 1000);
}

// ---- history and undo ----

function money_(n, currency) {
  var neg = n < 0;
  var s = currency === "JPY" ? String(Math.round(Math.abs(n))) : Math.abs(n).toFixed(2);
  var parts = s.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + (currency === "JPY" ? "\u00a5" : "$") + parts.join(".");
}

function same_(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function expenseDiff_(before, after) {
  if (before.amount !== after.amount || before.currency !== after.currency) {
    return "changed " + after.title + " " + money_(before.amount, before.currency) + " \u2192 " + money_(after.amount, after.currency);
  }
  if (before.title !== after.title) return "renamed " + before.title + " to " + after.title;
  var changed = [];
  if (before.paidBy !== after.paidBy) changed.push("payer");
  if (!same_(before.split, after.split) || before.splitMode !== after.splitMode || !same_(before.splitVals, after.splitVals)) changed.push("split");
  if (before.day !== after.day) changed.push("day");
  if (before.note !== after.note) changed.push("note");
  return "changed " + after.title + (changed.length ? ": " + changed.join(", ") : "");
}

var STOP_FIELD_LABELS_ = [["detail", "detail"], ["gettingThere", "directions"], ["travelMin", "travel time"], ["fixed", "fixed time"], ["place", "place"], ["signJp", "sign name"], ["booked", "booked"], ["link", "link"], ["photo", "photo"], ["note", "note"], ["lat", "map"], ["lng", "map"], ["tkRef", "ticket"], ["tkName", "ticket"], ["tkPeople", "ticket"], ["tkSeat", "ticket"], ["nameJp", "Japanese name"], ["addressJp", "Japanese address"]];

function stopDiff_(before, after) {
  if (before.title !== after.title) return "renamed " + before.title + " to " + after.title;
  if (before.date !== after.date || before.time !== after.time) {
    return "moved " + after.title + " to " + dayLabel(after.date) + (after.time ? " " + after.time : "");
  }
  var changed = [];
  for (var i = 0; i < STOP_FIELD_LABELS_.length; i++) {
    var label = STOP_FIELD_LABELS_[i][1];
    if (before[STOP_FIELD_LABELS_[i][0]] !== after[STOP_FIELD_LABELS_[i][0]] && changed.indexOf(label) === -1) changed.push(label);
  }
  return "changed " + after.title + (changed.length ? ": " + changed.join(", ") : "");
}

function summarize(action, kind, before, after) {
  // The address itself never goes in a sentence: it stays in the Sheet.
  if (kind === "person") return "changed " + (after || before).name + "\u2019s e-Transfer address";
  // The picture itself never goes in a sentence either, and no pronoun does.
  if (kind === "picture") {
    if (!before || !before.photo) return "set a picture";
    if (!after || !after.photo) return "removed the picture";
    return "changed the picture";
  }
  if (kind === "payment") {
    var pay = after || before;
    var what = pay.from + " \u2192 " + pay.to + " " + money_(pay.cad, "CAD");
    if (action === "stamp") return "stamped " + what;
    if (action === "unstamp") return "removed the stamp " + what;
    if (action === "restamp") return "put back the stamp " + what;
    return "changed the stamp " + what;
  }
  if (kind === "stop") {
    var stop = after || before;
    if (action === "add") return "added " + stop.title + " to " + dayLabel(stop.date);
    if (action === "delete") return "removed " + stop.title + " from " + dayLabel(stop.date);
    if (action === "restore") return "put back " + stop.title + " on " + dayLabel(stop.date);
    if (before && after) return stopDiff_(before, after);
    return "changed " + stop.title;
  }
  if (kind === "stay") {
    var stayName = (after || before).name;
    if (action === "add") return "added the stay " + stayName;
    if (action === "delete") return "removed the stay " + stayName;
    if (action === "restore") return "put back the stay " + stayName;
    // The booking's four facts are named as a stop's are: "ticket", never their values.
    if (before && after && STAY_FACTS_.some(function (f) { return (before[f] || "") !== (after[f] || ""); })) return "changed the stay " + stayName + ": ticket";
    return "changed the stay " + stayName;
  }
  // A stamp in the book: the day it is for (a snapshot's `day`), never a place or a drawing.
  if (kind === "stamp") {
    var st = after || before;
    return !st.day ? "stamped the book" : "stamped " + shortDay_(st.day);
  }
  if (kind === "day") return "changed the ticket for " + dayLabel((after || before).date);
  // A ticket picture on a stop: whose it is and the stop's name, never the picture.
  if (kind === "ticket") {
    var tk = after || before;
    var whose = cellText_(tk.who) ? cellText_(tk.who) + "\u2019s ticket" : "a ticket";
    var on = cellText_(tk.stopTitle) || (cellText_(tk.stay) ? "a stay" : "a stop");
    if (action === "remove") return "removed " + whose + " from " + on;
    return "added " + whose + " to " + on;
  }
  // A "Before we go" item: its own text (cut) and names, never a planner value.
  if (kind === "todo") {
    var what = plannerCut_(cellText_((after || before).item), 60);
    if (action === "tick") return "ticked off: " + what;
    var was = before ? cellText_(before.claimedBy) : "";
    if (action === "unclaim") return "handed back: " + what;
    if (action === "claim" && was !== "") return "took over: " + what + ", from " + was;
    if (action === "claim") return "is on: " + what;
    return "changed " + what;
  }
  var item = after || before;
  var tag = item.title + " " + money_(item.amount, item.currency);
  if (action === "add") return "rang up " + tag;
  if (action === "delete") return "deleted " + tag;
  if (action === "restore") return "brought back " + tag;
  if (action === "edit" && before && after) return expenseDiff_(before, after);
  return "changed " + item.title;
}

function undoTarget(entry) {
  if (entry.before) return JSON.parse(JSON.stringify(entry.before));
  var t = JSON.parse(JSON.stringify(entry.after));
  if (entry.kind === "payment") t.removed = true;
  else t.deleted = true;
  return t;
}

function canUndo(entry, allEntries) {
  if (entry.kind === "person") return false;
  // A tick or claim the planner took off (Task 19, R49) is a fact, not a change to undo.
  if (entry.kind === "todo" && entry.action === "takeoff") return false;
  // A note that the planner kept a Booked the app could not record (round 2).
  if (entry.kind === "planner") return false;
  if (entry.undoneBy !== null && entry.undoneBy !== undefined && entry.undoneBy !== "") return false;
  for (var i = 0; i < allEntries.length; i++) {
    var o = allEntries[i];
    if (Number(o.id) > Number(entry.id) && o.kind === entry.kind && String(o.ref) === String(entry.ref)) return false;
  }
  return true;
}

function cellId_(v) {
  if (v === "" || v === undefined || v === null) return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

function cellJson_(v) {
  if (v === "" || v === undefined || v === null) return null;
  try { return JSON.parse(String(v)); } catch (e) { return null; }
}

function logShape_(o) {
  return {
    id: Number(o.id),
    at: cellStamp_(o.at),
    who: cellText_(o.who),
    via: o.via === "claude" || o.via === "planner" ? o.via : "app",
    action: cellText_(o.action),
    kind: cellText_(o.kind),
    ref: cellText_(o.ref),
    summary: cellText_(o.summary),
    undoes: cellId_(o.undoes),
    undoneBy: cellId_(o.undone_by),
  };
}

function parseLogRow(o) {
  var e = logShape_(o);
  e.before = cellJson_(o.before);
  e.after = cellJson_(o.after);
  return e;
}

function entryFromRow(o, allRows) {
  var e = logShape_(o);
  e.canUndo = canUndo(e, allRows.map(logShape_));
  return e;
}

// ---- payments from the planner sheet (R39) ----
// The planner is a separate Google Sheet with a Payments tab; what it holds
// is read as untrusted text. These turn its rows into expenses for the app's
// own validation (validateExpense) to check.

// A payment id: up to 20 letters, digits, _ and -, with at least one letter
// and one digit (X7, P005), so a plain word or number is never one (R40).
var PAYMENT_ID_RE_ = /^(?=[^A-Za-z]*[A-Za-z])(?=[^0-9]*[0-9])[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/;
var PLANNER_NEEDS_ = ["payment_id", "payer", "description", "amount", "currency", "amount_cad", "split_between", "split_type", "include_in_split"];
var PLANNER_MAX_ROWS_ = 300;
var PLANNER_KINDS_ = { lodging: "stay", transport: "transport", flight: "transport", food: "food", shopping: "shopping" };

function plannerText_(v) { return v === undefined || v === null ? "" : String(v).trim(); }

// A number, or text such as "CA$1,234.50" or "¥24,750"; null when blank,
// NaN when there but unreadable.
function plannerNum_(v) {
  if (typeof v === "number") return isFinite(v) ? v : NaN;
  if (plannerText_(v) === "") return null;
  if (typeof v !== "string") return NaN;
  var s = v.replace(/CA\$/gi, "").replace(/[$¥\s,]/g, "");
  if (s === "") return NaN;
  var n = Number(s);
  return isFinite(n) ? n : NaN;
}

// include_in_split: yes, or a ticked checkbox (true / TRUE).
function plannerYes_(v) {
  var t = plannerText_(v).toLowerCase();
  return v === true || t === "yes" || t === "true";
}

// A blank row, looking only at the table's own columns (the first `width`;
// all of them when width is left out): a cell further right, a note or a
// filled-down checkbox past the header, does not make a row part of the table.
function plannerBlank_(row, width) {
  if (!Array.isArray(row)) return true;
  var cells = typeof width === "number" ? row.slice(0, width) : row;
  return cells.every(function (c) { return plannerText_(c) === ""; });
}

// How many columns a table spans: up to its header row's last named cell.
function headWidth_(head) {
  for (var c = head.length - 1; c >= 0; c--) if (head[c] !== "") return c + 1;
  return 0;
}

// rows: the Payments tab as Sheets hands it back, row 1 the column names
// (null or [] when there is no tab or it is empty).
// -> { payments, problems: [{ id, message, row, what }], missing, capped }:
// row is the sheet's own row number (the first data row is 2) and what a few
// words of that row's description; missing is why the tab can't be read at
// all (else null); capped: more than 300 rows.
function paymentsFromRows(rows) {
  var list = Array.isArray(rows) ? rows : [];
  var none = function (message) { return { payments: [], problems: [], missing: message, capped: false }; };
  if (!list.length) return none("The planner has no Payments tab to read.");
  var head = (Array.isArray(list[0]) ? list[0] : []).map(function (h) { return plannerText_(h).toLowerCase(); });
  for (var i = 0; i < PLANNER_NEEDS_.length; i++) {
    if (head.indexOf(PLANNER_NEEDS_[i]) === -1) return none("The planner’s Payments tab is missing the column " + PLANNER_NEEDS_[i] + ".");
  }
  var width = headWidth_(head);
  var cell = function (row, name) {
    var c = head.indexOf(name);
    return c === -1 ? "" : row[c];
  };
  var payments = [];
  var problems = [];
  var seen = {};
  var read = 0;
  var capped = false;
  for (var r = 1; r < list.length; r++) {
    var row = list[r];
    if (plannerBlank_(row, width)) continue;
    if (read === PLANNER_MAX_ROWS_) {
      capped = true;
      break;
    }
    read++;
    var id = plannerText_(cell(row, "payment_id"));
    var what = plannerWhat_(cell(row, "description"));
    if (!PAYMENT_ID_RE_.test(id)) {
      problems.push({ id: "", message: "That payment’s id isn’t usable.", row: r + 1, what: what });
      continue;
    }
    if (seen[id] === true) {
      problems.push({ id: id, message: "That payment id is in the planner twice.", row: r + 1, what: what });
      continue;
    }
    seen[id] = true;
    payments.push({
      id: id,
      row: r + 1,
      datePaid: plannerText_(cell(row, "date_paid")),
      payer: plannerText_(cell(row, "payer")),
      description: plannerText_(cell(row, "description")),
      category: plannerText_(cell(row, "category")),
      vendor: plannerText_(cell(row, "vendor")),
      bookingRef: plannerText_(cell(row, "booking_ref")),
      amount: plannerNum_(cell(row, "amount")),
      currency: plannerText_(cell(row, "currency")),
      amountCad: plannerNum_(cell(row, "amount_cad")),
      cadExact: plannerText_(cell(row, "cad_is_exact")),
      splitBetween: plannerText_(cell(row, "split_between")).split(",").map(plannerText_).filter(function (s) { return s !== ""; }),
      splitType: plannerText_(cell(row, "split_type")),
      include: plannerYes_(cell(row, "include_in_split")),
    });
  }
  return { payments: payments, problems: problems, missing: null, capped: capped };
}

// A few words of a planner cell for a problem line: spaces collapsed, cut to 60.
function plannerWhat_(v) {
  return plannerCut_(plannerText_(v).replace(/\s+/g, " "), 60);
}

// s cut to max letters: at max - 1, less a trailing part-word, then "…".
function plannerCut_(s, max) {
  if (s.length <= max) return s;
  var t = s.slice(0, max - 1);
  if (s.charAt(max - 1) !== " " && t.charAt(t.length - 1) !== " " && t.lastIndexOf(" ") > 0) t = t.slice(0, t.lastIndexOf(" "));
  return t.replace(/\s+$/, "") + "…";
}

// The person among people that name means, in their own spelling, or null.
function plannerPerson_(name, people) {
  var want = plannerText_(name).toLowerCase();
  for (var i = 0; i < people.length; i++) if (people[i].trim().toLowerCase() === want) return people[i];
  return null;
}

// An included payment as the expense fields the planner owns, plus the day
// and kind a new expense starts with. -> { ok, value } | { ok: false, message }
function expenseFromPayment(p, people, dayDates) {
  if (p.splitType.toLowerCase() !== "equal") return fail_("Only payments split equally can be brought in.");
  // A name not on the trip is never repeated back: it is the planner's text.
  var paidBy = plannerPerson_(p.payer, people);
  if (p.payer === "" || paidBy === null) return fail_("The payer isn’t one of the people on this trip.");
  if (!p.splitBetween.length) return fail_("That payment has nobody to split it between.");
  var split = [];
  for (var i = 0; i < p.splitBetween.length; i++) {
    var who = plannerPerson_(p.splitBetween[i], people);
    if (who === null) return fail_("Someone in the split isn’t one of the people on this trip.");
    split.push(who);
  }
  if (p.amountCad !== null && isNaN(p.amountCad)) return fail_("That payment’s CAD amount can’t be read.");
  var charged = p.currency.toUpperCase();
  var useCad = p.amountCad > 0;
  var amount, currency;
  if (useCad) {
    amount = round2_(p.amountCad);
    currency = "CAD";
  } else if ((charged === "JPY" || charged === "CAD") && p.amount > 0) {
    currency = charged;
    amount = charged === "JPY" ? Math.round(p.amount) : round2_(p.amount);
  } else {
    return fail_("That payment has no usable amount.");
  }
  var title = p.description.replace(/\s+/g, " ").trim();
  if (title === "") return fail_("That payment has no description.");

  var day = "pre";
  if (dayDates.indexOf(p.datePaid) !== -1) day = p.datePaid;
  else if (validDay_(p.datePaid) && dayDates.length && p.datePaid > dayDates[0]) day = dayDates[dayDates.length - 1];

  var parts = [p.id, p.vendor, p.bookingRef ? "ref " + p.bookingRef : ""];
  if (useCad && typeof p.amount === "number" && isFinite(p.amount)) {
    if (charged === "JPY") parts.push(money_(p.amount, "JPY") + " charged");
    else if (charged !== "CAD" && charged !== "") parts.push(p.amount + " " + p.currency);
  }
  if (useCad && p.cadExact.toLowerCase().indexOf("yes") !== 0) parts.push("CAD amount is an estimate");
  var note = parts.filter(function (x) { return x !== ""; }).join(" · ");

  return {
    ok: true,
    value: {
      title: plannerCut_(title, 80), amount: amount, currency: currency, paidBy: paidBy, split: split, day: day,
      kind: PLANNER_KINDS_[p.category.toLowerCase()] || "activity", note: plannerCut_(note, 200),
    },
  };
}

// The payment an expense was brought in from: its note's first part (before
// " · "), when that is a payment id. Expenses rung up by hand in this format
// are recognised the same way.
function paymentIdOf(note) {
  if (typeof note !== "string") return null;
  var i = note.indexOf(" · ");
  var head = i === -1 ? note : note.slice(0, i);
  return PAYMENT_ID_RE_.test(head) ? head : null;
}

// ---- "Before we go": the planner's Book Now tab (Task 19, R45) ----
// The planner's Book Now tab lists bookings and prep. Its rows are untrusted
// text; these turn them into to-do items and build the one Change Log row a
// tick (or its undo) appends there. Nothing here talks to the planner.

var TODO_NEEDS_ = ["#", "item", "book by", "status"];
var CHANGE_LOG_NEEDS_ = ["#", "tab", "old value", "new value"];
var MONTHS_ = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// Planner text cut to max characters (never inside a surrogate pair), with "…".
var TODO_ITEM_MAX_ = 300;
var TODO_NOTE_MAX_ = 2000;
function cutText_(s, max) {
  if (s.length <= max) return s;
  var t = s.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
  return t + "…";
}

// A whole number from 0 up, as a number or as text such as "17" or "17.0";
// null for anything else.
function wholeNum_(v) {
  if (typeof v === "number") return isFinite(v) && v >= 0 && v % 1 === 0 ? v : null;
  if (typeof v !== "string") return null;
  var t = v.trim();
  return /^\d+(\.0+)?$/.test(t) ? Number(t) : null;
}

function pad2_(n) { return (n < 10 ? "0" : "") + n; }

// A month's number (1 to 12) from its name or a short form of three letters
// or more ("Dec", "Sept", "December"); 0 when it is none.
function monthNum_(name) {
  var m = name.toLowerCase();
  if (m.length < 3) return 0;
  for (var i = 0; i < MONTHS_.length; i++) if (MONTHS_[i].indexOf(m) === 0) return i + 1;
  return 0;
}

// A Book by cell as "YYYY-MM-DD", or "" when it holds no date this reads.
// Read with dates as the sheet shows them, it arrives as ISO text
// ("2026-12-05"), as month-name text ("Dec 5", "Dec 5, 2026", "5 Dec",
// "5 Dec 2026"; year, when there is none, the trip's) or, when the cell is
// formatted as a number, as Sheets' serial day (days from 1899-12-30).
function bookByDay(v, year) {
  if (typeof v === "number") {
    if (!isFinite(v) || v < 1 || v > 2958465) return "";
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
  }
  if (typeof v !== "string") return "";
  var t = v.trim();
  if (DAY_RE_.test(t)) return realDay_(t) ? t : "";
  var md = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(t);
  var dm = /^(\d{1,2})\s+([A-Za-z]+)\.?(?:,?\s+(\d{4}))?$/.exec(t);
  var mon, day, y;
  if (md) { mon = monthNum_(md[1]); day = Number(md[2]); y = md[3]; }
  else if (dm) { mon = monthNum_(dm[2]); day = Number(dm[1]); y = dm[3]; }
  else return "";
  y = y ? Number(y) : year;
  if (!mon || typeof y !== "number" || !isFinite(y) || y < 1000 || y > 9999) return "";
  var s = y + "-" + pad2_(mon) + "-" + pad2_(day);
  return realDay_(s) ? s : "";
}

// The first row (index) whose trimmed, lower-cased cells include all of needs, or -1.
function headerAt_(list, needs) {
  for (var r = 0; r < list.length; r++) {
    var head = (Array.isArray(list[r]) ? list[r] : []).map(function (h) { return plannerText_(h).toLowerCase(); });
    if (needs.every(function (n) { return head.indexOf(n) !== -1; })) return r;
  }
  return -1;
}

function headOf_(row) {
  return (Array.isArray(row) ? row : []).map(function (h) { return plannerText_(h).toLowerCase(); });
}

// rows: the Book Now tab as Sheets hands it back from A1 (null or [] when
// there is no tab or it is empty); year: the trip's. The table ends at the
// first fully blank row after an item, or at a row that is the header again
// (a second table below is never read with the first one's columns). Item is
// cut to 300 characters and Notes to 2,000.
// -> { items: [{ id, item, bookBy, status, note, link, row, statusCol }],
// problems: [{ id, message, row, what }], missing }: missing is why the tab
// can't be read at all (else null); row is the item's 1-based row in the tab
// (the sheet's own row number) and statusCol the 0-based column of Status,
// for writing back; a problem's what is a few words of its Item.
function todosFromRows(rows, year) {
  var list = Array.isArray(rows) ? rows : [];
  var none = function (message) { return { items: [], problems: [], missing: message }; };
  if (!list.length) return none("The planner has no Book Now tab to read.");
  var h = headerAt_(list, TODO_NEEDS_);
  if (h === -1) return none("The planner’s Book Now tab has no row with the columns #, Item, Book by and Status.");
  var head = headOf_(list[h]);
  var width = headWidth_(head);
  var cell = function (row, name) {
    var c = head.indexOf(name);
    return c === -1 || !Array.isArray(row) ? "" : row[c];
  };
  var items = [];
  var problems = [];
  var seen = {};
  for (var r = h + 1; r < list.length; r++) {
    var row = list[r];
    if (items.length && plannerBlank_(row, width)) break;
    if (headerAt_([row], TODO_NEEDS_) === 0) break;
    var item = cutText_(plannerText_(cell(row, "item")), TODO_ITEM_MAX_);
    if (item === "") continue;
    var num = wholeNum_(cell(row, "#"));
    if (num === null) continue;
    var id = String(num);
    if (seen[id] === true) {
      problems.push({ id: id, message: "That number is in the Book Now tab twice.", row: r + 1, what: plannerWhat_(item) });
      continue;
    }
    seen[id] = true;
    var link = safeUrl(plannerText_(cell(row, "booking link")));
    items.push({
      id: id,
      item: item,
      bookBy: bookByDay(cell(row, "book by"), year),
      status: plannerText_(cell(row, "status")),
      note: cutText_(plannerText_(cell(row, "notes")), TODO_NOTE_MAX_),
      link: /^https:\/\//i.test(link) ? link : "",
      row: r + 1,
      statusCol: head.indexOf("status"),
    });
  }
  return { items: items, problems: problems, missing: null };
}

// Whether a planner status says booked: it starts with the word (any case).
function isBooked(status) {
  return /^booked\b/i.test(cellText_(status).trim());
}

// A Todos row as the app sees it. Done: the planner says booked, or someone ticked it.
function todoFromRow(o) {
  var tickedBy = cellText_(o.ticked_by);
  var status = cellText_(o.status);
  return {
    id: cellText_(o.id),
    item: cellText_(o.item),
    bookBy: cellDate_(o.book_by),
    status: status,
    note: cellText_(o.note),
    link: safeUrl(cellText_(o.link)),
    claimedBy: cellText_(o.claimed_by),
    tickedBy: tickedBy,
    tickedAt: cellStamp_(o.ticked_at),
    done: isBooked(status) || tickedBy !== "",
    // The tick met a formula in the planner's Status: the planner works it out.
    plannerComputes: tickedBy !== "" && cellText_(o.planner_written) === "formula",
  };
}

// ---- the stamp book ----

// Japan time is fixed UTC+9 (no daylight saving). A day stamp is open from
// 00:00 on its date until 03:00 the next day: 27 hours.
var JAPAN_OFFSET_MS_ = 9 * 3600000;
var STAMP_OPEN_MS_ = 27 * 3600000;
var STAMP_LATE_MS_ = 48 * 3600000;
var STAMP_AHEAD_MS_ = 5 * 60000;

function shortDay_(date) {
  var s = String(date);
  if (!validDay_(s)) return s;
  var mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(s.slice(5, 7)) - 1];
  return mo + " " + Number(s.slice(8, 10));
}

// When a stamp can be pressed, as epoch ms { opens, closes }. A day stamp
// (date YYYY-MM-DD): from 00:00 Japan time on that date for 27 hours. The
// issue stamp (date ""): from the beginning until the last day stamp closes
// (never, when the book has no day stamps). Any other date: never open.
function stampWindow(def, defs) {
  var date = cellDate_(def && def.date);
  if (date === "") {
    var latest = null;
    var list = Array.isArray(defs) ? defs : [];
    for (var i = 0; i < list.length; i++) {
      var d = cellDate_(list[i] && list[i].date);
      if (d === "" || !validDay_(d)) continue;
      var c = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) - JAPAN_OFFSET_MS_ + STAMP_OPEN_MS_;
      if (latest === null || c > latest) latest = c;
    }
    return { opens: 0, closes: latest === null ? Infinity : latest };
  }
  if (!validDay_(date)) return { opens: Infinity, closes: -Infinity };
  var opens = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) - JAPAN_OFFSET_MS_;
  return { opens: opens, closes: opens + STAMP_OPEN_MS_ };
}

// Why a press made at atMs (the phone's time) and received at nowMs is
// refused: "" (it is fine), "future" (the phone's time is ahead of ours by
// more than 5 minutes), "not_open", "closed" (atMs is outside the stamp's
// window) or "late" (it arrived more than 48 hours after it was pressed).
function pressRefusal(def, defs, atMs, nowMs) {
  if (!isFinite(atMs) || !isFinite(nowMs)) return "future";
  if (atMs > nowMs + STAMP_AHEAD_MS_) return "future";
  var w = stampWindow(def, defs);
  if (atMs < w.opens) return "not_open";
  if (atMs >= w.closes) return "closed";
  if (nowMs - atMs > STAMP_LATE_MS_) return "late";
  return "";
}

// A StampDefs row, every column as text.
function stampDefFromRow(o) {
  return {
    id: cellText_(o.id), date: cellDate_(o.date), name_ja: cellText_(o.name_ja), name_en: cellText_(o.name_en),
    place: cellText_(o.place), motif: cellText_(o.motif), ink: cellText_(o.ink), shape: cellText_(o.shape),
  };
}

// A Stamps row as the app sees it ("gone" only on a lifted one).
function stampFromRow(o) {
  var s = { def: cellText_(o.def), who: cellText_(o.who), at: cellStamp_(o.at), seed: cellNum_(o.seed) };
  if (cellText_(o.gone) === "yes") s.gone = true;
  // Pressed with the phone in the place: only this yes is ever kept, never where.
  if (cellText_(o.here) === "yes") s.here = true;
  return s;
}

// What the Log keeps of a press: the stamp, whether it is lifted, and the
// day it is for (so History can say "Jan 5" without reading the definitions).
function stampSnap_(s, day) {
  return { def: s.def, who: s.who, at: s.at, seed: s.seed, gone: s.gone === true, day: day };
}

// A column's A1 letters from its 0-based index: 0 is A, 26 is AA.
function colLetter(i) {
  var s = "";
  for (var n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// The row to append to the planner's Change Log, from its rows as Sheets
// hands them back from A1 and the values by column name (any case): # is one
// above the largest whole number in that column, or blank when it has none
// (never a guessed 1); a column the log lacks is
// skipped, one this does not fill is left blank. -> { headerRow (1-based),
// firstCol (0-based: the table's first non-empty header cell, which Sheets'
// append writes from), values (first to last non-empty header cell) } | null when there is no tab or no row with #, Tab, Old value and
// New value.
function changeLogRow(rows, fields) {
  var list = Array.isArray(rows) ? rows : [];
  var h = headerAt_(list, CHANGE_LOG_NEEDS_);
  if (h === -1) return null;
  var head = headOf_(list[h]);
  var numCol = head.indexOf("#");
  var max = null;
  for (var r = h + 1; r < list.length; r++) {
    var n = Array.isArray(list[r]) ? wholeNum_(list[r][numCol]) : null;
    if (n !== null && (max === null || n > max)) max = n;
  }
  var named = {};
  Object.keys(fields).forEach(function (k) { named[k.trim().toLowerCase()] = fields[k]; });
  var firstCol = -1, lastCol = headWidth_(head) - 1;
  head.forEach(function (name, c) { if (name !== "" && firstCol === -1) firstCol = c; });
  var values = [];
  for (var c = firstCol; c <= lastCol; c++) {
    var name = head[c];
    if (c === numCol) values.push(max === null ? "" : max + 1);
    else values.push(Object.prototype.hasOwnProperty.call(named, name) ? named[name] : "");
  }
  return { headerRow: h + 1, firstCol: firstCol, values: values };
}

// ---- the real ticket on a stop ----
// The same limits as js/tickets.js (the phone checks them before sending;
// the backend checks them again). A picture is a JPEG or PNG the phone made,
// at most maxSide pixels on its longer side and maxChars base64 characters;
// at most perStop pictures on a stop and perTrip in the whole trip. The
// picture is kept in chunks of at most `chunk` characters, one Sheet cell
// each (a cell holds at most 50,000). Each fact is text up to `fact` letters.
var TICKET_LIMITS = { maxSide: 1500, maxChars: 450000, perStop: 8, perTrip: 120, chunk: 45000, fact: 60 };
var TICKET_FACTS_ = ["tkRef", "tkName", "tkPeople", "tkSeat"];
var STAY_FACTS_ = ["tkRef", "tkName", "tkPeople", "tkRoom"];
var TICKET_MIMES_ = { "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] };
var B64_RE_ = /^[A-Za-z0-9+\/]+={0,2}$/;
var B64_CHARS_ = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var TICKET_BAD_ = "That picture couldn’t be used. Try another.";

// The first n bytes of a base64 string (n at most 9), as numbers.
function b64Head_(s, n) {
  var out = [];
  var bits = 0, acc = 0;
  for (var i = 0; i < s.length && out.length < n; i++) {
    var v = B64_CHARS_.indexOf(s.charAt(i));
    if (v === -1) break;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

function wholeIn_(v, lo, hi) {
  return typeof v === "number" && v % 1 === 0 && v >= lo && v <= hi;
}

// A picture as the phone sends it to addTicket: { id, stop, who, seat, page,
// mime, w, h, data }. who is "" (for everyone) or one of the people; data is
// base64 whose first bytes are the mime's signature (so an SVG, or anything
// else named a JPEG, is refused). The size is checked before the base64 is
// read, so a huge one costs nothing.
function validateTicket(input, peopleNames) {
  if (!isObj_(input)) return fail_(TICKET_BAD_);
  if (typeof input.id !== "string" || !ID_RE_.test(input.id)) return fail_("That ticket picture has a bad id.");
  // A picture is on a stop or on a stay (its booking): exactly one, each by the id rule.
  var onStop = input.stop !== undefined && input.stop !== null && input.stop !== "";
  var onStay = input.stay !== undefined && input.stay !== null && input.stay !== "";
  if (onStop === onStay) return fail_("That didn’t say which stop it is for.");
  if (onStop && (typeof input.stop !== "string" || !ID_RE_.test(input.stop))) return fail_("That didn’t say which stop it is for.");
  if (onStay && (typeof input.stay !== "string" || !ID_RE_.test(input.stay))) return fail_("That didn’t say which stop it is for.");
  var who = input.who === undefined || input.who === null ? "" : input.who;
  if (typeof who !== "string" || (who !== "" && peopleNames.indexOf(who) === -1)) return fail_("That person isn’t on this trip.");
  var seat = optText_(input.seat, TICKET_LIMITS.fact, "Keep the seat under " + TICKET_LIMITS.fact + " letters.");
  if (!seat.ok) return seat;
  if (!wholeIn_(input.page, 1, TICKET_LIMITS.perStop)) return fail_(TICKET_BAD_);
  var sig = Object.prototype.hasOwnProperty.call(TICKET_MIMES_, input.mime) ? TICKET_MIMES_[input.mime] : null;
  if (!sig) return fail_("Only a photo, a screenshot or a PDF can be a ticket.");
  if (!wholeIn_(input.w, 1, TICKET_LIMITS.maxSide) || !wholeIn_(input.h, 1, TICKET_LIMITS.maxSide)) return fail_(TICKET_BAD_);
  var data = input.data;
  if (typeof data !== "string" || data === "") return fail_(TICKET_BAD_);
  if (data.length > TICKET_LIMITS.maxChars) return fail_("That picture is too big. Try a smaller one.");
  if (data.length % 4 !== 0 || !B64_RE_.test(data)) return fail_(TICKET_BAD_);
  var head = b64Head_(data, sig.length);
  for (var i = 0; i < sig.length; i++) if (head[i] !== sig[i]) return fail_(TICKET_BAD_);
  // from: the list line it came from (auto-add), or "" for a picture added by hand.
  var from = input.from === undefined || input.from === null ? "" : input.from;
  if (typeof from !== "string" || (from !== "" && !TICKET_FROM_RE_.test(from))) return fail_("That ticket’s line on the list didn’t come through properly.");
  return { ok: true, value: { id: input.id, stop: onStop ? input.stop : "", stay: onStay ? input.stay : "", who: who, seat: seat.value, page: input.page, mime: input.mime, w: input.w, h: input.h, data: data, from: from } };
}

// A picture's tie to its line of the planner's Tickets list: letters, digits and ":" only, short.
var TICKET_FROM_RE_ = /^[A-Za-z0-9:]{1,40}$/;

// data cut into the cells it is kept in, in order.
function ticketChunks(data) {
  var out = [];
  for (var i = 0; i < data.length; i += TICKET_LIMITS.chunk) out.push(data.slice(i, i + TICKET_LIMITS.chunk));
  return out;
}

// The picture put back together from its TicketData cells ({ n, data }, any
// order): sorted by n as a number, each of 0 to count - 1 exactly once, and
// size characters in all. null when anything is missing or doubled.
function joinTicketChunks(cells, count, size) {
  if (!wholeIn_(count, 1, 1000)) return null;
  var parts = [];
  for (var i = 0; i < cells.length; i++) {
    var k = Number(cellText_(cells[i].n));
    if (!wholeIn_(k, 0, count - 1) || parts[k] !== undefined) return null;
    parts[k] = cellText_(cells[i].data);
  }
  for (var j = 0; j < count; j++) if (parts[j] === undefined) return null;
  var data = parts.join("");
  return data.length === size ? data : null;
}

// A Tickets row as load and the actions give it (never its data); gone only on a removed one.
function ticketFromRow(o) {
  var t = {
    id: cellText_(o.id), stop: cellText_(o.stop), who: cellText_(o.who), seat: cellText_(o.seat),
    page: cellNum_(o.page), mime: cellText_(o.mime), w: cellNum_(o.w), h: cellNum_(o.h),
    size: cellNum_(o.size), chunks: cellNum_(o.chunks), by: cellText_(o.by), at: cellStamp_(o.at),
  };
  if (cellText_(o.gone) === "yes") t.gone = true;
  if (cellText_(o.planner_id) !== "") t.from = cellText_(o.planner_id);
  // On a stay (its booking): only when the cell is filled, so a stop's picture reads as before.
  if (cellText_(o.stay) !== "") t.stay = cellText_(o.stay);
  return t;
}

// ---- tickets from the planner's list (auto-add) ----
// The owner's phone asks for the planner's Tickets tab and the desk's list of
// the ticket files, compares them with the trip's pictures and, after the
// owner looks, adds what is new through addTicket (js/autoadd.js).

// The columns of the list the phone uses (matching and the stop's facts); the
// rest (file links, notes, booking links) never leave the backend.
var LIST_COLS_ = ["ticket_id", "start_date", "start_time", "end_date", "end_time", "type", "title", "provider", "confirmation", "traveler", "ticket_ref", "seat", "holder", "status"];
var LIST_MAX_ROWS_ = 300;
var LIST_CELL_MAX_ = 200;

// A list date as YYYY-MM-DD: a real date cell (a number), 2026-12-11,
// 2026/12/11, 12/11/2026 (month first, unless the first is over 12), Dec 11,
// Dec 11, 2026, 11 Dec, a weekday in front ("Fri, Dec 11, 2026"); "" for
// anything else. year fills in one with no year.
function listDay(v, year) {
  if (typeof v === "number") return bookByDay(v, year);
  var t = plannerText_(v).replace(/^[A-Za-z]{3,9}\.?,?\s+(?=[A-Za-z0-9])/, function (w) { return monthNum_(w.replace(/[^A-Za-z]/g, "")) ? w : ""; });
  var got = bookByDay(t, year);
  if (got) return got;
  var ymd = /^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/.exec(t);
  var mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  var y, m, d;
  if (ymd) { y = Number(ymd[1]); m = Number(ymd[2]); d = Number(ymd[3]); }
  else if (mdy) {
    y = Number(mdy[3]);
    m = Number(mdy[1]);
    d = Number(mdy[2]);
    if (m > 12 && d <= 12) { var x = m; m = d; d = x; }
  } else return "";
  var s = y + "-" + pad2_(m) + "-" + pad2_(d);
  return m >= 1 && m <= 12 && realDay_(s) ? s : "";
}

// A list time as HH:MM (24-hour): a time cell (a fraction of a day, or a date
// and time), 9:30, 09:30, 9:30:00, 9:30 AM, 9:30:00 pm; "" for anything else.
function listTime(v) {
  if (typeof v === "number") {
    if (!isFinite(v) || v < 0) return "";
    var mins = Math.round((v - Math.floor(v)) * 1440) % 1440;
    return pad2_(Math.floor(mins / 60)) + ":" + pad2_(mins % 60);
  }
  var m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([AaPp])\.?[Mm]\.?$|^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(plannerText_(v));
  if (!m) return "";
  var h = Number(m[1] || m[4]), min = Number(m[2] || m[5]);
  if (m[3]) {
    if (h < 1 || h > 12) return "";
    h = (h % 12) + (/[Pp]/.test(m[3]) ? 12 : 0);
  }
  return h <= 23 && min <= 59 ? pad2_(h) + ":" + pad2_(min) : "";
}

// rows: the planner's Tickets tab as Sheets hands it back from A1 (row 1 the
// column names). -> { rows: [{ ticket_id, start_date, ... }] (only
// LIST_COLS_, each a string, dates and times as above; a ticket_id twice
// keeps its first line), missing } (missing: why it can't be used, else null).
function listRowsFrom(rows, year) {
  var list = Array.isArray(rows) ? rows : [];
  var head = headOf_(list[0]);
  if (head.indexOf("ticket_id") === -1) return { rows: [], missing: "The planner’s Tickets tab has no ticket_id column." };
  if (head.indexOf("start_date") === -1) return { rows: [], missing: "The planner’s Tickets tab has no start_date column." };
  var out = [], seen = {};
  list.slice(1, LIST_MAX_ROWS_ + 1).forEach(function (r) {
    if (!Array.isArray(r)) return;
    var o = {};
    LIST_COLS_.forEach(function (c) {
      var at = head.indexOf(c);
      var v = at === -1 ? "" : r[at];
      var text = c === "start_date" || c === "end_date" ? listDay(v, year) : c === "start_time" || c === "end_time" ? listTime(v) : plannerText_(v).replace(/[\r\n\t]+/g, " ");
      o[c] = text.slice(0, LIST_CELL_MAX_);
    });
    if (o.ticket_id === "" || Object.prototype.hasOwnProperty.call(seen, o.ticket_id)) return;
    seen[o.ticket_id] = true;
    out.push(o);
  });
  return { rows: out, missing: null };
}

var DESK_KINDS_ = ["application/pdf", "image/png", "image/jpeg"];
var DESK_HANDLE_RE_ = /^[0-9a-f]{32}$/;
var DESK_PRINT_RE_ = /^[0-9a-f]{12}$/;
// The most a ticket file from the desk may be (the desk refuses bigger ones).
var DESK_FILE_MAX_ = 4000000;

// The desk's answer to "tickets", checked: [{ h, name, mime, size, print, at }]
// (at most 200, names cut to 120 letters), or null when it is not that shape.
function deskFilesFrom(answer) {
  if (!isObj_(answer) || answer.ok !== true || !Array.isArray(answer.files)) return null;
  var out = [];
  for (var i = 0; i < answer.files.length && out.length < 200; i++) {
    var f = answer.files[i];
    if (!isObj_(f) || typeof f.h !== "string" || !DESK_HANDLE_RE_.test(f.h) || typeof f.print !== "string" || !DESK_PRINT_RE_.test(f.print)) continue;
    if (DESK_KINDS_.indexOf(f.mime) === -1 || typeof f.name !== "string") continue;
    var size = typeof f.size === "number" && isFinite(f.size) && f.size >= 0 ? Math.floor(f.size) : 0;
    out.push({ h: f.h, name: f.name.replace(/[\r\n\t]+/g, " ").trim().slice(0, 120) || "A file", mime: f.mime, size: size, print: f.print, at: typeof f.at === "string" ? f.at.slice(0, 30) : "" });
  }
  return out;
}

// The desk's answer to "ticketFile", checked: { name, mime, data } or null.
function deskFileFrom(answer, handle) {
  if (!isObj_(answer) || answer.ok !== true || answer.h !== handle) return null;
  if (DESK_KINDS_.indexOf(answer.mime) === -1 || typeof answer.data !== "string" || answer.data === "") return null;
  if (answer.data.length > Math.ceil(DESK_FILE_MAX_ / 3) * 4 || answer.data.length % 4 !== 0 || !B64_RE_.test(answer.data)) return null;
  return { name: typeof answer.name === "string" ? answer.name.replace(/[\r\n\t]+/g, " ").trim().slice(0, 120) || "A file" : "A file", mime: answer.mime, data: answer.data };
}

// What the Log keeps of a picture: its row (no data), whether it is removed,
// and the stop's name for the sentence (a stay's name when it is on a stay,
// under the same field, so old entries read as before).
function ticketSnap_(t, stopTitle) {
  var snap = { id: t.id, stop: t.stop, who: t.who, seat: t.seat, page: t.page, mime: t.mime, w: t.w, h: t.h, size: t.size, chunks: t.chunks, by: t.by, at: t.at, gone: t.gone === true, stopTitle: cellText_(stopTitle) };
  if (t.stay) snap.stay = t.stay;
  return snap;
}

if (typeof module !== "undefined") {
  module.exports = { TABS, KINDS, isTextColumn, sanitizeCell, unsanitizeCell, rowToObj, objToRow, validateExpense, validatePayment, validatePersonPatch, validateStop, validateStay, validateDayPatch, DAY_PATCH_KEYS, safeUrl, safeHttpsUrl, dayLabel, stopFromRow, stopToRow, stayFromRow, stayToRow, dayFromRow, dayToRow, expenseFromRow, paymentFromRow, personFromRow, cellDate_, cellStamp_, summarize, undoTarget, canUndo, entryFromRow, parseLogRow, expenseToRow, paymentToRow, setupSeedRows, shouldFetchRate, rateSource, sameKey, hexOfBytes, personKeysFrom, personKeysReadable, keyHolder, blankSecrets, paymentsFromRows, expenseFromPayment, paymentIdOf, todosFromRows, bookByDay, todoFromRow, isBooked, colLetter, changeLogRow, shortDay_, stampWindow, pressRefusal, stampDefFromRow, stampFromRow, stampSnap_, plannerWhat_, coordsOf_, pointFromLink, metresBetween_, TICKET_LIMITS, validateTicket, ticketChunks, joinTicketChunks, ticketFromRow, ticketSnap_, listDay, listTime, listRowsFrom, deskFilesFrom, deskFileFrom, LIST_COLS_ };
}
