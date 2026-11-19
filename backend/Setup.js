// One-time setup, run by hand from the script editor. Safe to run twice.
// The trip key goes only to Script Properties (and, from showInvite, to the
// execution log). It is never returned and never written into the Sheet.
// The owner functions further down (issueLinks and the rest) are also run
// from the script editor: no menu, no dialog, no new permission.

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (tab) {
    var sh = ss.getSheetByName(tab) || ss.insertSheet(tab);
    var wanted = TABS[tab];
    var have = sh.getLastColumn() === 0 ? [] : headersOf_(sh);
    wanted.forEach(function (h) {
      if (have.indexOf(h) === -1) {
        sh.getRange(1, have.length + 1).setValue(h);
        have.push(h);
      }
    });
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, have.length).setFontWeight("bold");
    have.forEach(function (h, i) {
      if (isTextColumn(tab, h)) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat("@");
    });
  });

  var seed = setupSeedRows();
  seedIfEmpty_("Trip", seed.Trip);
  seedIfEmpty_("People", seed.People);
  seedIfEmpty_("Days", seed.Days);

  var plain = ss.getSheetByName("Sheet1");
  if (plain && plain.getLastRow() === 0 && plain.getLastColumn() === 0 && ss.getSheets().length > 1) ss.deleteSheet(plain);

  var props = PropertiesService.getScriptProperties();
  // A shared key only for a brand-new trip: once anyone has a personal link,
  // or the shared one was ever retired (SHARED_RETIRED, set by
  // retireSharedLink), setup never brings a shared key back.
  if (!props.getProperty("TRIP_KEY") && props.getProperty("SHARED_RETIRED") !== "yes" && !props.getProperty("PERSON_KEYS")) props.setProperty("TRIP_KEY", Utilities.getUuid().replace(/-/g, "").slice(0, 24));
  // The Claude connector's token. Not shown here: the app's Settings copies it.
  ensureClaudeToken_();

  // Last, so the tabs are there either way: a rate host that refuses Google's
  // servers must show up now, not as a silent stand-in rate on every line.
  requireLiveRate_();
}

function seedIfEmpty_(tab, objs) {
  var sh = sheet_(tab);
  if (sh.getLastRow() >= 2) return;
  var headers = headersOf_(sh);
  var rows = objs.map(function (o) { return objToRow(headers, o); });
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

// The old shared key, printed only while it exists. Personal links replace
// it (issueLinks, below).
function showInvite() {
  // The key is cached for six hours (tripKey_ in Env.js): forget the cached
  // copy so a key changed by hand in Script Properties takes effect now.
  forgetTripKey_();
  var key = getProp_("TRIP_KEY");
  if (!key) {
    Logger.log("There is no shared link any more: personal links replace it. Run linksStatus to see who has one, issueLinks for anyone without.");
    return;
  }
  Logger.log("Shared trip key (personal links replace it: run issueLinks, then retireSharedLink once everyone uses theirs): " + key);
}

// ---- personal links (security, 2026-11-18) ----
// Each person has their own link (#k=<their key>). Only each key's SHA-256
// is kept (PERSON_KEYS, Keys.js). A new key is written once, to this run's
// log, which only the script's owner can open: copy it from there and send
// it to that person. No function here ever prints a key again.

// The app's address for a link: the Script Property SITE_URL when it is a
// plain https:// address, else "" (the log then says to put it in front).
function siteUrl_() {
  var site = getProp_("SITE_URL");
  return typeof site === "string" && /^https:\/\/[^\s#?]+$/.test(site.replace(/#.*$/, "")) ? site.replace(/#.*$/, "") : "";
}

function logLink_(name, key) {
  Logger.log(name + "’s link: " + siteUrl_() + "#k=" + key);
}

// Once, after the links, when they lack the app's address.
function logSiteHint_() {
  if (!siteUrl_()) Logger.log("(Put the app’s address in front of each link, or set the Script Property SITE_URL to that address for next time.)");
}

function dayOf_(iso) {
  return typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : "an unknown date";
}

// Whether `keys` (PERSON_KEYS as read) holds a link for this name, as its
// own entry (never an inherited one such as "constructor").
function hasLink_(keys, name) {
  return Object.prototype.hasOwnProperty.call(keys, name);
}

// A name a link can be kept under (fix round 1): a string that is not
// "__proto__" (which a plain object cannot hold as its own key).
function linkableName_(name) {
  return typeof name === "string" && name !== "" && name !== "__proto__";
}

var LINKS_UNREADABLE_ = "PERSON_KEYS can’t be read (it is not what issueLinks writes). Nobody can open the trip until it is fixed. If only its punctuation is broken (a quote, brace or comma), mend the text in Project Settings → Script Properties: every link keeps working. Deleting or emptying it cancels every personal link: each phone then clears itself, and issueLinks makes new links to send to everyone.";

// PERSON_KEYS, or null after saying in the log that it can't be read.
function personKeysOrSay_() {
  try {
    return personKeys_();
  } catch (e) {
    Logger.log(LINKS_UNREADABLE_);
    return null;
  }
}

// Makes a link for everyone on the trip who has none, and logs each new one
// once. Those who already have one are listed, without a key. Links kept for
// names no longer on the trip are removed (named in the log).
function issueLinks() {
  if (personKeysOrSay_() === null) return;
  // Fix round 2: with nobody in the People tab (or no People tab), the
  // leftover removal below would delete every link: change nothing.
  var listed;
  try {
    listed = peopleNames_();
  } catch (e) {
    Logger.log("Not done: the People tab can’t be read. Nothing was changed.");
    return;
  }
  if (!listed.length) {
    Logger.log("Not done: the People tab lists nobody. Nothing was changed.");
    return;
  }
  var made = [];
  var had = [];
  var gone = [];
  var odd = [];
  var r = withLock_(function () {
    var keys = personKeys_();
    var names = peopleNames_();
    Object.keys(keys).forEach(function (name) {
      if (names.indexOf(name) === -1) {
        delete keys[name];
        gone.push(name);
      }
    });
    names.forEach(function (name) {
      if (!linkableName_(name)) {
        odd.push(name);
        return;
      }
      if (hasLink_(keys, name)) {
        had.push(name + ": already has a link (issued " + dayOf_(keys[name].at) + ").");
        return;
      }
      var key = newPersonKey_();
      keys[name] = { hash: sha256Hex_(key), at: nowIso_() };
      made.push({ name: name, key: key });
    });
    if (made.length || gone.length) setPersonKeys_(keys);
    return { ok: true };
  });
  if (!r || r.ok !== true) {
    Logger.log("The app is busy saving. Run issueLinks again in a moment.");
    return;
  }
  gone.forEach(function (name) { Logger.log("Removed the link of someone no longer on the trip: " + name + "."); });
  odd.forEach(function (name) { Logger.log(name + ": no link made: that name can’t be used. Change it in the People tab."); });
  had.forEach(function (line) { Logger.log(line); });
  made.forEach(function (m) { logLink_(m.name, m.key); });
  if (made.length) logSiteHint_();
  else Logger.log("Nobody needed a new link.");
}

// The person at this place in the People tab's order (1 = the first), or null.
function personAt_(n) {
  var names = peopleNames_();
  return n >= 1 && n <= names.length ? names[n - 1] : null;
}

// Replaces person n's link: the old one stops working at once.
function newLinkFor_(n) {
  var name = personAt_(n);
  if (name === null) {
    Logger.log("There is no person " + n + " on this trip.");
    return;
  }
  if (!linkableName_(name)) {
    Logger.log(name + ": no link made: that name can’t be used. Change it in the People tab.");
    return;
  }
  if (personKeysOrSay_() === null) return;
  var key = newPersonKey_();
  var r = withLock_(function () {
    var keys = personKeys_();
    keys[name] = { hash: sha256Hex_(key), at: nowIso_() };
    setPersonKeys_(keys);
    return { ok: true };
  });
  if (!r || r.ok !== true) {
    Logger.log("The app is busy saving. Run it again in a moment.");
    return;
  }
  Logger.log(name + "’s old link no longer works.");
  logLink_(name, key);
  logSiteHint_();
}

// Cancels person n's link: it stops working on the next request.
function cancelLinkFor_(n) {
  var name = personAt_(n);
  if (name === null) {
    Logger.log("There is no person " + n + " on this trip.");
    return;
  }
  if (personKeysOrSay_() === null) return;
  var had = false;
  var r = withLock_(function () {
    var keys = personKeys_();
    had = hasLink_(keys, name);
    if (had) {
      delete keys[name];
      setPersonKeys_(keys);
    }
    return { ok: true };
  });
  if (!r || r.ok !== true) {
    Logger.log("The app is busy saving. Run it again in a moment.");
    return;
  }
  Logger.log(had ? name + ": link cancelled." : name + " had no link.");
}

function newLinkForPerson1() { newLinkFor_(1); }
function newLinkForPerson2() { newLinkFor_(2); }
function newLinkForPerson3() { newLinkFor_(3); }
function newLinkForPerson4() { newLinkFor_(4); }
function newLinkForPerson5() { newLinkFor_(5); }
function newLinkForPerson6() { newLinkFor_(6); }
function cancelLinkForPerson1() { cancelLinkFor_(1); }
function cancelLinkForPerson2() { cancelLinkFor_(2); }
function cancelLinkForPerson3() { cancelLinkFor_(3); }
function cancelLinkForPerson4() { cancelLinkFor_(4); }
function cancelLinkForPerson5() { cancelLinkFor_(5); }
function cancelLinkForPerson6() { cancelLinkFor_(6); }

// Who has a link and since when, links kept for names no longer on the trip,
// and whether the shared link still works. Never a key.
function linksStatus() {
  var keys = personKeysOrSay_();
  if (keys === null) return;
  var names = peopleNames_();
  // An entry that is there but not a usable { hash, at } (personKeysFrom
  // leaves it out): said as unreadable, not as no link.
  var raw = {};
  try {
    raw = JSON.parse(getProp_("PERSON_KEYS") || "{}") || {};
  } catch (e) {
    raw = {};
  }
  names.forEach(function (name, i) {
    var said = hasLink_(keys, name) ? "has a link (issued " + dayOf_(keys[name].at) + ")"
      : Object.prototype.hasOwnProperty.call(raw, name) ? "unreadable entry for " + name + " (run newLinkForPerson" + (i + 1) + " to give a new link)"
      : "no link yet";
    Logger.log((i + 1) + ". " + name + ": " + said);
  });
  var stale = Object.keys(keys).filter(function (name) { return names.indexOf(name) === -1; });
  if (stale.length && !names.length) Logger.log("Still has a link: " + stale.join(", ") + ". The People tab lists nobody.");
  else if (stale.length) Logger.log("Not on the trip any more, still has a link: " + stale.join(", ") + ". Run issueLinks to remove it.");
  Logger.log(getProp_("TRIP_KEY") ? "The shared link still works." : "The shared link is retired.");
}

// Deletes the shared key, only once everyone has a personal link. After
// this only personal links, the check key and the Claude link work, and
// setup() never makes a shared key again (SHARED_RETIRED).
function retireSharedLink() {
  var keys = personKeysOrSay_();
  if (keys === null) return;
  var names = peopleNames_();
  if (!names.length) {
    Logger.log("Not retired: the People tab lists nobody.");
    return;
  }
  var without = names.filter(function (name) { return !hasLink_(keys, name); });
  if (without.length) {
    Logger.log("Not retired: " + without.join(", ") + (without.length === 1 ? " has" : " have") + " no personal link yet. Run issueLinks first.");
    return;
  }
  setProp_("SHARED_RETIRED", "yes");
  if (!getProp_("TRIP_KEY")) {
    forgetTripKey_();
    Logger.log("The shared link was already retired.");
    return;
  }
  delProp_("TRIP_KEY");
  forgetTripKey_();
  Logger.log("The shared link is retired: it stops working now. Personal links, the check key and the Claude link still work.");
}

// The planner sheet (R39, R46): run once from the script editor after
// setting PLANNER_ID, and again whenever the script asks for a new permission.
// Running it is how the owner grants the Sheets permission the pull and the
// "Before we go" write-back need. It logs how many payment rows and Book Now
// items there are, or what is wrong, and whether the Change Log is there:
// never a value from the sheet and never its id.
function checkPlanner() {
  // Google lets an owner grant only some of a script's permissions, and does
  // not ask again by itself when a new one is added. This asks for whatever
  // is still missing (the Sheets permission for the planner) and stops this
  // run; the next run then goes through.
  if (typeof ScriptApp !== "undefined" && ScriptApp.requireAllScopes) ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  if (!plannerId_()) {
    Logger.log("Planner: not linked yet. Set the Script Property PLANNER_ID to the planner’s spreadsheet id first.");
    return;
  }
  checkPlannerPayments_();
  checkPlannerTodos_();
}

function checkPlannerPayments_() {
  var rows;
  try {
    rows = plannerRows_();
  } catch (e) {
    Logger.log("Planner: couldn’t read its Payments tab. Check the id and that this account can open the sheet.");
    return;
  }
  var read = paymentsFromRows(rows);
  if (read.missing) {
    Logger.log("Planner: " + read.missing);
    return;
  }
  var width = headWidth_(headOf_(rows[0]));
  var n = rows.slice(1).filter(function (r) { return !plannerBlank_(r, width); }).length;
  Logger.log("Planner: " + n + " payment rows, columns ok");
}

function checkPlannerTodos_() {
  try {
    // The year only fills in dates, which this does not show.
    var read = todosFromRows(plannerTab_("Book Now"), 2026);
    Logger.log("Book Now: " + (read.missing || read.items.length + " items, columns ok"));
    if (!read.missing) {
      // The app never writes over a formula: say how many Status cells are one
      // (or are filled by one placed elsewhere).
      var formulas = 0;
      try {
        read.items.forEach(function (it) {
          var computed = plannerCellComputed_("Book Now", it.row, it.statusCol);
          if (computed === null) throw new Error("unknown"); // a cell it could not tell: no count
          if (computed) formulas++;
        });
        Logger.log("Book Now: " + formulas + " Status cells are formulas (the app leaves those alone).");
      } catch (e2) {
        Logger.log("Book Now: couldn’t check its Status cells for formulas.");
      }
    }
  } catch (e) {
    Logger.log("Book Now: couldn’t read it.");
  }
  try {
    Logger.log("Change Log: " + (changeLogRow(plannerTab_("Change Log"), {}) ? "found" : "not found"));
  } catch (e) {
    Logger.log("Change Log: couldn’t read it.");
  }
}

// ---- the ticket shelf (auto-add): the key the newsletter desk answers to ----
// The desk (another script of the owner's, which can read Drive) hands the
// ticket files to this backend only with this key. Run once from the script
// editor: it makes a random key (64 hex characters, 32 bytes), keeps it only
// in this script's Script Properties (TICKET_DESK_KEY) and logs only its
// SHA-256, to paste into the desk's Script Property MAT_KEY_HASH. Running it
// again logs the same hash and changes nothing. To replace the key, delete
// TICKET_DESK_KEY and run it again, then paste the new hash into the desk.
// The desk's web address goes in the Script Property TICKET_DESK_URL by hand.
function ticketDeskKey() {
  var key = getProp_("TICKET_DESK_KEY");
  var made = false;
  if (!key) {
    key = newPersonKey_();
    setProp_("TICKET_DESK_KEY", key);
    made = true;
  }
  // Only the hash is ever logged.
  var hash = sha256Hex_(key);
  key = null;
  Logger.log((made ? "Made the ticket desk key. " : "The ticket desk key is already there. ") + "Paste this into the desk’s Script Property MAT_KEY_HASH: " + hash);
  var url = getProp_("TICKET_DESK_URL");
  Logger.log(url ? (/^https:\/\/script\.google\.com\//.test(url) ? "TICKET_DESK_URL is set." : "TICKET_DESK_URL is set but is not a script.google.com address: the desk won’t be asked.") : "Set the Script Property TICKET_DESK_URL to the desk’s web app address.");
}