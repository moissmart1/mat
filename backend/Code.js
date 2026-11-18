function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// A plain GET says which backend this is (Stamp.js, written by `npm run
// stamp`), so a release can check the live backend before publishing.
function doGet() {
  return json_({ ok: true, rev: 0, data: { name: "mat", stamp: typeof BACKEND_STAMP === "string" ? BACKEND_STAMP : "" } });
}

// One endpoint: the body is { key, actor, via, action, args }; Actions.js does
// the rest. A JSON-RPC 2.0 body is the Claude connector instead (Mcp.js),
// checked against the token in the address (?t=...). Always answers JSON,
// never an HTML error page.
function doPost(e) {
  var body;
  try {
    body = JSON.parse(e && e.postData ? e.postData.contents : undefined);
  } catch (err) {
    return json_({ ok: false, error: "bad_input", message: "That request didn’t come through properly." });
  }
  if (body !== null && typeof body === "object" && body.jsonrpc === "2.0") {
    try {
      return json_(mcp_(body, (e && e.parameter) || {}));
    } catch (err) {
      // mcp_ answers its own errors; this is the last resort, and says nothing more.
      return json_({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } });
    }
  }
  try {
    return json_(handle_(body));
  } catch (err) {
    // The plain sentence only; the detail goes to the owner's log, with any
    // key, token or id blanked (reportError_, Actions.js).
    if (typeof reportError_ === "function") reportError_("doPost", err, [body && typeof body === "object" ? body.key : null]);
    return json_({ ok: false, error: "server", message: "Something went wrong on our side. Try again." });
  }
}
