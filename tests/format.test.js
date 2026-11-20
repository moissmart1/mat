import test from "node:test";
import assert from "node:assert/strict";
import { yen, dollars, typed, dayHead, issuer, pt, clock, sentence, changeText, tripSpan, dayShort } from "../js/format.js";

test("yen and dollars", () => {
  assert.equal(yen(14500), "¥14,500");
  assert.equal(yen(438340), "¥438,340");
  assert.equal(yen(0), "¥0");
  assert.equal(dollars(13063), "$130.63");
  assert.equal(dollars(5), "$0.05");
  assert.equal(dollars(394901), "$3,949.01");
  assert.equal(dollars(0), "$0.00");
});

test("typed shows the figure as entered", () => {
  assert.equal(typed({ amount: 4200, currency: "JPY" }), "¥4,200");
  assert.equal(typed({ amount: 130, currency: "CAD" }), "$130.00");
  assert.equal(typed({ amount: 12.5, currency: "CAD" }), "$12.50");
});

test("dayHead", () => {
  assert.deepEqual(dayHead("pre", []), { jp: "出発前", en: "Before the trip", city: "" });
  assert.deepEqual(dayHead("2026-12-11", [{ date: "2026-12-11", city: "Tokyo" }]), { jp: "12月11日(金)", en: "Fri Dec 11", city: "Tokyo" });
  assert.deepEqual(dayHead("2026-12-10", [{ date: "2026-12-10", city: "" }]), { jp: "12月10日(木)", en: "Thu Dec 10", city: "" });
  assert.deepEqual(dayHead("2026-12-13", []), { jp: "12月13日(日)", en: "Sun Dec 13", city: "" });
});

test("issuer is the first letters of the names in order", () => {
  assert.equal(issuer([{ name: "Mo" }, { name: "Ajen" }, { name: "Trenton" }]), "MAT");
});

test("tripSpan", () => {
  assert.equal(tripSpan({ start: "2026-12-10", end: "2026-12-20" }), "Dec 10 to 20");
  assert.equal(tripSpan({ start: "2026-12-28", end: "2027-01-03" }), "Dec 28 to Jan 3");
});

test("pt wraps punctuation in spans", () => {
  assert.equal(pt("¥14,500"), '<span class="pt">¥</span>14<span class="pt">,</span>500');
  assert.equal(pt("$1.50"), '<span class="pt">$</span>1<span class="pt">.</span>50');
});

test("pt escapes its input before wrapping", () => {
  const out = pt('<script>alert("x")</script> & \'y\'.');
  assert.equal(out, '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;<span class="pt">.</span>');
  assert.ok(!out.includes("<script"));
});

test("clock is the phone's local time", () => {
  const ms = new Date(2026, 11, 12, 13, 20, 59).getTime();
  assert.equal(clock(ms), "13:20");
  assert.equal(clock(new Date(2026, 11, 12, 7, 5).getTime()), "07:05");
});

test("sentence", () => {
  assert.equal(sentence({ kind: "owed", who: "Ajen", cents: 25030 }), "Ajen owes you $250.30.");
  assert.equal(sentence({ kind: "owed", who: null, cents: 57657 }), "You’re owed $576.57.");
  assert.equal(sentence({ kind: "owe", who: "Mo", cents: 28829 }), "You owe Mo $288.29.");
  assert.equal(sentence({ kind: "owe", who: null, cents: 600 }), "You owe $6.00.");
  assert.equal(sentence({ kind: "square", who: null, cents: 0 }), "You’re square.");
  assert.equal(sentence({ kind: "even", who: null, cents: 0 }), "You’re even overall.");
});

test("changeText", () => {
  const dinner = { title: "Dinner", amount: 14500, currency: "JPY" };
  assert.equal(changeText({ action: "add", kind: "expense", item: dinner }), "Rang up Dinner ¥14,500.");
  assert.equal(changeText({ action: "edit", kind: "expense", item: dinner }), "Changed Dinner.");
  assert.equal(changeText({ action: "delete", kind: "expense", item: dinner }), "Deleted Dinner.");
  assert.equal(changeText({ action: "restore", kind: "expense", item: dinner }), "Brought back Dinner.");
  const pay = { from: "Ajen", to: "Mo", cad: 250 };
  assert.equal(changeText({ action: "stamp", kind: "payment", item: pay }), "Stamped $250.00 to Mo.");
  assert.equal(changeText({ action: "unstamp", kind: "payment", item: pay }), "Stamp removed.");
  assert.equal(changeText({ action: "restamp", kind: "payment", item: pay }), "Stamp put back.");
  assert.equal(changeText({ action: "undo", kind: "expense", item: dinner }), "Undone.");
});

test("dayShort is the register's day: weekday and date, or Before", () => {
  assert.equal(dayShort("2026-12-12"), "Sat 12");
  assert.equal(dayShort("2026-12-10"), "Thu 10");
  assert.equal(dayShort("2027-01-01"), "Fri 1");
  assert.equal(dayShort("pre"), "Before");
});

test("changeText for a stop", () => {
  const sky = { title: "Shibuya Sky", date: "2026-12-12" };
  assert.equal(changeText({ action: "add", kind: "stop", item: sky }), "Added Shibuya Sky.");
  assert.equal(changeText({ action: "edit", kind: "stop", item: sky }), "Changed Shibuya Sky.");
  assert.equal(changeText({ action: "delete", kind: "stop", item: sky }), "Removed Shibuya Sky.");
  assert.equal(changeText({ action: "restore", kind: "stop", item: sky }), "Put back Shibuya Sky.");
  assert.equal(changeText({ action: "undo", kind: "stop", item: sky }), "Undone.");
});

test("changeText: a stay's booking edited or a stay added says the stay's name", () => {
  assert.equal(changeText({ kind: "stay", action: "edit", item: { name: "Tsubame-so Guest House" } }), "Changed Tsubame-so Guest House.");
  assert.equal(changeText({ kind: "stay", action: "add", item: { name: "Lakeside Airport Inn" } }), "Added Lakeside Airport Inn.");
  assert.equal(changeText({ kind: "stay", action: "undo", item: { name: "x" } }), "Undone.");
});
