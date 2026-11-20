import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../scripts/serve.mjs";

test("each runner owns its loopback listener and cannot borrow another checkout's port", async (t) => {
  const first = await startServer(0);
  t.after(() => first.close());
  const second = await startServer(0);
  t.after(() => second.close());
  assert.notEqual(first.address().port, second.address().port);
  await assert.rejects(startServer(first.address().port), { code: "EADDRINUSE" });
  const response = await fetch("http://localhost:" + first.address().port);
  assert.match(await response.text(), /<title>MAT<\/title>/);
});
