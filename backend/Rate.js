// Yen per Canadian dollar for today's Japan date. Fetched at most once a day
// (kept in Script Properties as RATE_<YYYY-MM-DD>). A failed fetch is noted in
// RATE_FAIL_AT and not retried for an hour (see shouldFetchRate in Pure.js);
// meanwhile, and on any failure, the last good rate, or 111 if there has never
// been one. getRateInfo_ also says which of those it is (rateSource in Pure.js).

var RATE_URL_ = "https://open.er-api.com/v6/latest/CAD";
var RATE_FALLBACK_ = 111;

function rateKey_() {
  return "RATE_" + Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
}

// One fetch. Stores and returns { rate } on success, or { error } saying why not.
function fetchRate_(key) {
  var error;
  try {
    var res = UrlFetchApp.fetch(RATE_URL_, { muteHttpExceptions: true });
    var code = res.getResponseCode();
    if (code === 200) {
      var jpy = Number(JSON.parse(res.getContentText()).rates.JPY);
      // Refuse an absurd figure rather than stamp it onto every expense today.
      if (isFinite(jpy) && jpy > 30 && jpy < 500) {
        setProp_(key, String(jpy));
        setProp_("RATE_LAST", String(jpy));
        delProp_("RATE_FAIL_AT"); // deleted, not emptied: an empty Script Property blocks the properties page from saving
        return { rate: jpy };
      }
      error = "an unexpected rate (" + jpy + ")";
    } else {
      error = "HTTP " + code;
    }
  } catch (e) {
    error = String((e && e.message) || e);
  }
  setProp_("RATE_FAIL_AT", nowIso_());
  return { error: error };
}

function getRateInfo_() {
  var key = rateKey_();
  var stored = getProp_(key);
  if (Number(stored) > 0) return { rate: Number(stored), source: "live" };
  if (shouldFetchRate(stored, getProp_("RATE_FAIL_AT"), nowIso_())) {
    var got = fetchRate_(key);
    if (got.rate) return { rate: got.rate, source: "live" };
  }
  var last = getProp_("RATE_LAST");
  var source = rateSource(null, last);
  return { rate: source === "last" ? Number(last) : RATE_FALLBACK_, source: source };
}

function getRate_() {
  return getRateInfo_().rate;
}

// Run by setup(): fetches today's rate now (whatever the hourly back-off says)
// and throws a plain error if it cannot, so a host that refuses Google's
// servers is found with Mo at the keyboard, not by the trip's first line.
function requireLiveRate_() {
  var key = rateKey_();
  if (Number(getProp_(key)) > 0) return;
  var got = fetchRate_(key);
  if (got.rate) return;
  throw new Error("Couldn\u2019t fetch today\u2019s yen rate from open.er-api.com: " + got.error + ". The app would fall back to " + RATE_FALLBACK_ + ".");
}
