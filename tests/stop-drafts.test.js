import test from "node:test";
import assert from "node:assert/strict";
import { stopDrafts } from "../js/views/stopsheet.js";

test("stop drafts survive reopening, isolate people and days, and retain a newer edit after a late save", () => {
  const data = new Map();
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) };
  const key = ["Trip", "A", "add", "2030-01-01"];
  const a = stopDrafts(storage, key);
  const first = { fields: { stWhat: "Walk" }, addId: "draft0001" };
  a.write(first);
  const again = stopDrafts(storage, key);
  assert.deepEqual(again.read(), first);
  assert.equal(stopDrafts(storage, ["Trip","B","add",key[3]]).read(), null);
  assert.equal(stopDrafts(storage, ["Trip","A","add","2030-01-02"]).read(), null);
  again.write({ ...first, fields: { stWhat: "Lunch" } });
  a.clear(first);
  assert.equal(again.read().fields.stWhat, "Lunch");
  again.clear(again.read());
  assert.equal(a.read(), null);
});

test("a second editing session preserves other draft fields and their original values", async () => {
  const { updateStopDraft } = await import("../js/views/stopsheet.js");
  const first = updateStopDraft(null, { stWhat: "Walk", stTime: "10:00" }, { stWhat: "Walk", stTime: "11:00" }, null);
  const base = { stWhat: "Walk", stTime: "12:00", stTkRef: "private-marker" };
  const next = updateStopDraft(first, base, { ...base, stWhat: "Park", stTkRef: "different-private-marker" }, null);
  assert.deepEqual(next.fields, { stTime: "11:00", stWhat: "Park" });
  assert.deepEqual(next.base, { stTime: "10:00", stWhat: "Walk" });
  assert.doesNotMatch(JSON.stringify(next), /private-marker/);
});
