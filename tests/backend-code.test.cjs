// backend/Code.js (doGet / doPost) evaluated over a stand-in ContentService,
// with handle_ and mcp_ played by the test. Pins the replies doPost gave
// before the Claude connector, so that a body that is not JSON-RPC is
// answered byte for byte as it was.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const CODE = fs.readFileSync(path.join(__dirname, "..", "backend", "Code.js"), "utf8");

function world({ handle, mcp, stamp } = {}) {
  const seen = { handle: [], mcp: [] };
  const ctx = vm.createContext({
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text) => ({ text, mime: null, setMimeType(m) { this.mime = m; return this; } }),
    },
    handle_: (body) => { seen.handle.push(body); return handle(body); },
    mcp_: (msg, params) => { seen.mcp.push([msg, params]); return mcp(msg, params); },
  });
  if (stamp !== undefined) vm.runInContext("var BACKEND_STAMP = " + JSON.stringify(stamp) + ";", ctx);
  vm.runInContext(CODE, ctx, { filename: "Code.js" });
  ctx.seen = seen;
  return ctx;
}

const post = (contents, parameter) => ({ postData: { contents }, parameter });

test("doPost answers a body that is not JSON-RPC exactly as before the connector", () => {
  const w = world({ handle: (b) => ({ ok: true, rev: 3, data: { echo: b.action } }) });
  const ok = w.doPost(post(JSON.stringify({ key: "k", action: "rev" })));
  assert.equal(ok.text, '{"ok":true,"rev":3,"data":{"echo":"rev"}}');
  assert.equal(ok.mime, "application/json");

  assert.equal(w.doPost(post("not json")).text, '{"ok":false,"error":"bad_input","message":"That request didn’t come through properly."}');
  assert.equal(w.doPost({}).text, '{"ok":false,"error":"bad_input","message":"That request didn’t come through properly."}');
  assert.equal(w.doPost(undefined).text, '{"ok":false,"error":"bad_input","message":"That request didn’t come through properly."}');

  // null, an array and a body with another jsonrpc value still go to handle_.
  w.doPost(post("null"));
  w.doPost(post("[1]"));
  w.doPost(post(JSON.stringify({ jsonrpc: "1.0", key: "k" })));
  assert.deepEqual(JSON.parse(JSON.stringify(w.seen.handle.slice(1))), [null, [1], { jsonrpc: "1.0", key: "k" }]);

  const boom = world({ handle: () => { throw new Error("kaput"); } });
  // Security (2026-11-18): the plain sentence only, never the thrown error's text.
  assert.equal(boom.doPost(post("{}")).text, '{"ok":false,"error":"server","message":"Something went wrong on our side. Try again."}');
  assert.equal(world({}).doGet().text, '{"ok":true,"rev":0,"data":{"name":"mat","stamp":""}}');
  assert.equal(world({ stamp: "0a1b2c3d4e" }).doGet().text, '{"ok":true,"rev":0,"data":{"name":"mat","stamp":"0a1b2c3d4e"}}');
});

test("doPost hands a JSON-RPC 2.0 body to mcp_ with the query parameters, never to handle_", () => {
  const w = world({ handle: () => ({ ok: true }), mcp: (m) => ({ jsonrpc: "2.0", id: m.id, result: {} }) });
  const r = w.doPost(post(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }), { t: "x", as: "Mo" }));
  assert.equal(r.text, '{"jsonrpc":"2.0","id":4,"result":{}}');
  assert.equal(r.mime, "application/json");
  assert.equal(w.seen.handle.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(w.seen.mcp)), [[{ jsonrpc: "2.0", id: 4, method: "tools/list" }, { t: "x", as: "Mo" }]]);
  w.doPost(post(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "initialize" })));
  assert.deepEqual(JSON.parse(JSON.stringify(w.seen.mcp[1][1])), {}, "no query: an empty parameter object");
});

test("doPost never lets a thrown error's text out in a JSON-RPC reply", () => {
  const w = world({ handle: () => ({ ok: true }), mcp: () => { throw new Error("secret-ish detail"); } });
  const r = w.doPost(post(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }), {}));
  assert.equal(r.text, '{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"Internal error"}}');
});
