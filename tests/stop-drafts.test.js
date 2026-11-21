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

function memory() {
  const data = new Map();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
}
const draftKey = (scope) => "mat.stopDraft." + JSON.stringify(scope);

test("a draft field comes back only while its baseline still matches the stop (another phone's change wins)", async () => {
  const { draftToRestore } = await import("../js/views/stopsheet.js");
  const draft = {
    fields: { stWhat: "Park", stDetail: "Meet at the gate", stFixed: true },
    base: { stWhat: "Walk", stDetail: "Old line", stFixed: false },
  };
  // stDetail changed elsewhere since (Old line -> New line): it stays as the stop has it.
  const opened = { stWhat: "Walk", stDetail: "New line", stFixed: false, stTime: "10:00" };
  assert.deepEqual(draftToRestore(draft, opened), { stWhat: "Park", stFixed: true });
  assert.deepEqual(draftToRestore(null, opened), {});
  // A field of the wrong kind is never put in.
  assert.deepEqual(draftToRestore({ fields: { stWhat: 5 }, base: { stWhat: "Walk" } }, opened), {});
});

test("a new stop's newest draft on a day is found with its id, and older ones on that day are taken off", async () => {
  const { newestAddDraft } = await import("../js/views/stopsheet.js");
  const s = memory();
  const day = ["Trip", "2030-01-01", "A", "add", "2030-01-02"];
  s.setItem(draftKey([...day, "old00001"]), JSON.stringify({ fields: { stWhat: "Walk" }, savedAt: 100 }));
  s.setItem(draftKey([...day, "new00002"]), JSON.stringify({ fields: { stWhat: "Lunch" }, savedAt: 200 }));
  s.setItem(draftKey(["Trip", "2030-01-01", "A", "add", "2030-01-03", "other003"]), JSON.stringify({ fields: { stWhat: "Other day" }, savedAt: 300 }));
  s.setItem(draftKey(["Trip", "2030-01-01", "B", "add", "2030-01-02", "bdraft04"]), JSON.stringify({ fields: { stWhat: "B's" }, savedAt: 400 }));
  s.setItem(draftKey(["Trip", "2030-01-01", "A", "edit", "stop0005"]), JSON.stringify({ fields: { stWhat: "Edit" }, savedAt: 500 }));
  s.setItem("mat.other", "kept");
  assert.equal(newestAddDraft(s, day), "new00002");
  assert.equal(s.getItem(draftKey([...day, "old00001"])), null, "the older orphan is gone");
  assert.ok(s.getItem(draftKey([...day, "new00002"])));
  assert.equal(s.data.size, 5, "other days, people, edits and other keys are untouched");
  assert.equal(newestAddDraft(s, ["Trip", "2030-01-01", "A", "add", "2030-01-09"]), null);
  // A storage that throws leaves the sheet usable.
  const broken = { get length() { throw new Error("blocked"); }, key() { throw new Error("blocked"); } };
  assert.equal(newestAddDraft(broken, day), null);
});

test("new-stop drafts on a day the trip no longer has are pruned at load", async () => {
  const { pruneAddDrafts } = await import("../js/views/stopsheet.js");
  const s = memory();
  const who = ["Trip", "2030-01-01", "A"];
  s.setItem(draftKey([...who, "add", "2030-01-02", "keep0001"]), "{}");
  s.setItem(draftKey([...who, "add", "2029-12-31", "gone0002"]), "{}");
  s.setItem(draftKey(["Trip", "2030-01-01", "B", "add", "2029-12-31", "bkeep003"]), "{}");
  s.setItem(draftKey([...who, "edit", "stop0004"]), "{}");
  pruneAddDrafts(s, who, ["2030-01-02", "2030-01-03"]);
  assert.deepEqual([...s.data.keys()].map((k) => JSON.parse(k.slice("mat.stopDraft.".length)).at(-1)).sort(), ["bkeep003", "keep0001", "stop0004"]);
});

test("dropAddDraft takes one new-stop draft off the phone and nothing else", async () => {
  const { dropAddDraft } = await import("../js/views/stopsheet.js");
  const s = memory();
  const day = ["Trip", "2030-01-01", "A", "add", "2030-01-02"];
  s.setItem(draftKey([...day, "one00001"]), "{}");
  s.setItem(draftKey([...day, "two00002"]), "{}");
  dropAddDraft(s, day, "one00001");
  assert.equal(s.data.size, 1);
  assert.ok(s.getItem(draftKey([...day, "two00002"])));
  dropAddDraft({ removeItem() { throw new Error("blocked"); } }, day, "two00002");
});
