// Show to driver for a stop (#95, look B: 行先 on the ticket). A stop with its
// Japanese name or address prints it when open, under 行先 For a taxi
// driver, before its links; the whole block is the key to the driver's
// screen the hotel card already has (js/views/driver.js), with 行先 and the
// stop's time and title in the dark bar. The plan is tests/fixtures/plan.json
// over the seed; 18:40 on Dec 12 in Japan (Day 3), so the 19:00 dinner is the
// next stop and is open. The places and addresses here are invented
// (架空県 is "made-up prefecture").
// Pictures are taken only when MAT_TAB_SHOTS names an output folder.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { WITH_PLAN, makeBackend, open, advance, until, atRest, text, expectText } = require("./helpers.cjs");

const SHOTS = process.env.MAT_TAB_SHOTS || "";
async function shot(page, name, at = null) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  if (at) await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: "center" }), at);
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
}

const D12 = "2026-12-12";
const DINNER = "planstop1204";
const SKY = "planstop1203";
const AT_1840 = Date.parse("2026-12-12T18:40:00+09:00");
const NAME = "炭火焼鳥 鳥花 湖畔店";
const ADDRESS = "架空県湖畔郡湖畔町9-9-9 みどりビル3階";
const LONG = "架空県湖畔郡湖畔町大字湖畔字みずうみ通り 1234番地の5 レイクポート湖畔センタービルディング 西館 12階 1201号室 鳥花湖畔店";

function seedWith(patch = {}, stayPatch = null) {
  const seed = JSON.parse(JSON.stringify(WITH_PLAN));
  Object.assign(seed.stops.find((s) => s.id === DINNER), { title: "Dinner, Torihana", ...patch });
  if (stayPatch) Object.assign(seed.stays.find((s) => s.id === "planstay0001"), stayPatch);
  return seed;
}
const BOTH = { nameJp: NAME, addressJp: ADDRESS };

const row = (id) => '#rail .pg[data-date="' + D12 + '"] .r[data-id="' + id + '"]';
const isOpen = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  return !!el && el.classList.contains("is-open");
}, id);
const rowOpen = (page, id) => page.evaluate((sel) => document.querySelector(sel).classList.contains("is-open"), row(id));

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: seedWith(BOTH), tab: "days", nowMs: AT_1840, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
  return backend;
}
// The stop open and finished sliding open (every row on its ticket at rest).
async function openRow(page, id = DINNER) {
  if (!(await rowOpen(page, id))) await page.dispatchEvent(row(id) + " .r-b", "click");
  await until(() => page.evaluate((sel) => {
    const r = document.querySelector(sel);
    return r.classList.contains("is-open") && [...r.closest(".tk").querySelectorAll(".r[data-id]")].every((x) => {
      const d = x.querySelector(".r-more > div");
      return !d || d.clientHeight === (x.classList.contains("is-open") ? d.scrollHeight : 0);
    });
  }, row(id)), "the stop opens");
}
async function openDriver(page, id = DINNER) {
  await openRow(page, id);
  await page.evaluate((sel) => document.querySelector(sel + " .dst").scrollIntoView({ block: "center" }), row(id));
  await page.click(row(id) + " .dst");
  await atRest(page, "#driver", { message: "the driver's screen opens" });
  await until(() => page.evaluate(() => document.getElementById("driver").dataset.fit === "1"), "the type is fitted");
}
const focusOnBlock = (page, id = DINNER) => page.evaluate((sel) => document.activeElement === document.querySelector(sel + " .dst"), row(id));

// Each big line is whole: nothing runs past its box or the screen (as driver.e2e.cjs).
async function nothingCut(page) {
  const got = await page.evaluate(() => {
    const d = document.getElementById("driver").getBoundingClientRect();
    return [...document.querySelectorAll("#driver .dc-name, #driver .dc-ad, #driver .dc-ask, #driver .dc-to")].map((n) => {
      const r = n.getBoundingClientRect();
      return { cls: n.className, sw: n.scrollWidth, cw: n.clientWidth, left: r.left, right: r.right, dl: d.left, dr: d.right, size: parseFloat(getComputedStyle(n).fontSize) };
    });
  });
  for (const g of got) {
    assert.ok(g.sw <= g.cw + 0.5, g.cls + " is not cut: " + JSON.stringify(g));
    assert.ok(g.left >= g.dl - 0.5 && g.right <= g.dr + 0.5, g.cls + " is inside the screen: " + JSON.stringify(g));
  }
  return got;
}
// Nothing on the day's ticket runs past its right edge, and the page does not scroll sideways.
const noSideways = (page) => page.evaluate((date) => {
  const tk = document.querySelector('#rail .pg[data-date="' + date + '"] .tk');
  const edge = tk.getBoundingClientRect().right;
  const over = [...tk.querySelectorAll(".r.is-open *")].filter((e) => e.getBoundingClientRect().width && e.getBoundingClientRect().right > edge + 0.5).map((e) => e.tagName + "." + (e.getAttribute("class") || "") + ":" + (e.textContent || "").slice(0, 20));
  const dst = tk.querySelector(".dst");
  const cut = dst ? [...dst.querySelectorAll(".dst-n, .dst-a, .dst-k > span")].filter((n) => n.scrollWidth > n.clientWidth + 0.5).map((n) => n.className || "dst-k span") : [];
  return { doc: document.scrollingElement.scrollWidth <= innerWidth, over, cut };
}, D12);
// How many lines each house-number run takes (1: it never broke at a hyphen).
const nbLines = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s + " .nb")].map((n) => {
  const tops = new Set([...n.getClientRects()].map((r) => Math.round(r.top)));
  return { text: n.textContent, lines: tops.size };
}), sel);

module.exports = [
  {
    name: "a stop with its Japanese prints 行先, and the block opens the driver's screen",
    async run({ page }) {
      await ready(page);
      await openRow(page);
      const block = await page.evaluate((sel) => {
        const b = document.querySelector(sel + " .dst");
        const kids = [...b.children].map((c) => c.className);
        const after = b.nextElementSibling ? b.nextElementSibling.className : "";
        const n = b.querySelector(".dst-n");
        const a = b.querySelector(".dst-a");
        return { tag: b.tagName, type: b.type, label: b.getAttribute("aria-label"), kids, after, nLang: n.lang, aLang: a.lang, h: b.querySelector(".dst-h").textContent, k: b.querySelector(".dst-k").textContent, n: n.textContent, a: a.textContent, nb: [...a.querySelectorAll(".nb")].map((x) => x.textContent) };
      }, row(DINNER));
      assert.deepEqual([block.tag, block.type, block.label], ["BUTTON", "button", "運転手さんへ Show to driver"]);
      assert.deepEqual(block.kids, ["dst-h", "dst-n", "dst-a", "dst-k"]);
      assert.equal(block.after, "r-btns", "before the links");
      assert.deepEqual([block.h, block.n, block.a, block.k], ["行先For a taxi driver", NAME, ADDRESS, "運転手さんへShow it large›"]);
      assert.deepEqual([block.nLang, block.aLang, block.nb], ["ja", "ja", ["9-9-9"]]);
      // The closed row is unchanged: its short sign is the stop's own (none here).
      assert.equal(await text(page, row(DINNER) + " .r-j"), "");
      await shot(page, "stop-block-390", row(DINNER) + " .dst");
      await openDriver(page);
      assert.equal(await page.evaluate(() => document.getElementById("phone").classList.contains("driver-open")), true);
      assert.equal(await text(page, "#driver .dc-top"), "行先19:00 Dinner, TorihanaDone");
      assert.equal(await text(page, "#driver .dc-to"), "運転手さんへ");
      assert.equal(await text(page, "#driver .dc-name"), NAME);
      assert.equal(await text(page, "#driver .dc-ad"), ADDRESS);
      assert.equal(await text(page, "#driver .dc-ask"), "ここまでお願いします。");
      assert.equal(/[A-Za-z]/.test(await text(page, "#driver .dc-mid")), false, "Japanese only for the driver");
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "driverDone", "focus on Done");
      await nothingCut(page);
      await shot(page, "stop-driver-390");
      await page.click("#driverDone");
      await atRest(page, "#driver", { open: false, message: "Done closes it" });
      assert.equal(await page.evaluate(() => document.getElementById("phone").classList.contains("driver-open")), false);
      assert.equal(await focusOnBlock(page), true, "focus back on the block");
      assert.equal(await rowOpen(page, DINNER), true, "the stop is still open");
      // The keyboard: Enter on the block opens it too; the row is not toggled shut.
      await page.keyboard.press("Enter");
      await atRest(page, "#driver", { message: "Enter on the block opens it" });
      await page.click("#driverDone");
      await atRest(page, "#driver", { open: false });
      assert.equal(await rowOpen(page, DINNER), true);
      assert.equal(await page.evaluate(() => document.getElementById("driver").textContent), "", "nothing stays drawn in the closed screen");
    },
  },
  {
    name: "a stop without the Japanese has no block and no key",
    async run({ page }) {
      await ready(page, { seed: seedWith({ signJp: "鳥花" }) });
      await openRow(page);
      assert.equal(await page.evaluate(() => document.querySelectorAll("#rail .dst").length), 0);
      // The sign name alone is not promoted to a driver's name.
      assert.equal(await text(page, row(DINNER) + " .r-j"), "鳥花");
      await openRow(page, SKY);
      assert.equal(await page.evaluate((sel) => document.querySelectorAll(sel + " .dst").length, row(SKY)), 0, "Shibuya Sky has only its sign name");
    },
  },
  {
    name: "name only: heading, name and the key; on the screen the name and the request, no address",
    async run({ page }) {
      await ready(page, { seed: seedWith({ nameJp: NAME }) });
      await openRow(page);
      assert.deepEqual(await page.evaluate((sel) => [...document.querySelector(sel + " .dst").children].map((c) => c.className), row(DINNER)), ["dst-h", "dst-n", "dst-k"]);
      await shot(page, "stop-name-only-390", row(DINNER) + " .dst");
      await openDriver(page);
      assert.equal(await page.evaluate(() => document.querySelectorAll("#driver .dc-ad").length), 0);
      assert.equal(await text(page, "#driver .dc-name"), NAME);
      assert.equal(await text(page, "#driver .dc-ask"), "ここまでお願いします。");
    },
  },
  {
    name: "address only: heading, address with no rule above it, and the key; on the screen no name",
    async run({ page }) {
      await ready(page, { seed: seedWith({ addressJp: ADDRESS, time: "" }) });
      await openRow(page);
      const b = await page.evaluate((sel) => {
        const a = document.querySelector(sel + " .dst-a");
        return { kids: [...a.parentElement.children].map((c) => c.className), rule: getComputedStyle(a).borderTopWidth, pad: getComputedStyle(a).paddingTop };
      }, row(DINNER));
      assert.deepEqual(b.kids, ["dst-h", "dst-a", "dst-k"]);
      assert.deepEqual([b.rule, b.pad], ["0px", "0px"], "the address is the first line under the heading");
      await openDriver(page);
      assert.equal(await page.evaluate(() => document.querySelectorAll("#driver .dc-name").length), 0);
      assert.equal(await text(page, "#driver .dc-ad"), ADDRESS);
      // No time: the title alone in the dark bar.
      assert.equal(await text(page, "#driver .dc-top"), "行先Dinner, TorihanaDone");
    },
  },
  {
    name: "Escape and the scrim close it; the stop stays open",
    viewport: { width: 1440, height: 900 },
    mobile: false,
    async run({ page }) {
      await ready(page);
      await openDriver(page);
      // On a computer it stands in the Days pane, as for a stay.
      const box = await page.evaluate(() => {
        const d = document.getElementById("driver").getBoundingClientRect();
        const days = document.getElementById("vDays").getBoundingClientRect();
        return [d.left, d.right, days.left, days.right];
      });
      assert.ok(Math.abs(box[0] - box[2]) < 1 && Math.abs(box[1] - box[3]) < 1, "in the Days pane: " + JSON.stringify(box));
      await page.keyboard.press("Escape");
      await atRest(page, "#driver", { open: false, message: "Escape closes it" });
      assert.equal(await rowOpen(page, DINNER), true, "the stop stays open");
      assert.equal(await focusOnBlock(page), true);
      await openDriver(page);
      await page.mouse.click(1100, 450); // the scrim, over the Money pane
      await atRest(page, "#driver", { open: false, message: "the scrim closes it" });
      assert.equal(await rowOpen(page, DINNER), true);
    },
  },
  {
    name: "the Japanese is added on another phone while the stop is open: the block appears",
    async run({ page }) {
      const backend = await ready(page, { seed: seedWith() });
      await openRow(page);
      assert.equal(await page.evaluate(() => document.querySelectorAll("#rail .dst").length), 0);
      const env = await backend.handle({ key: "test-key", actor: "Ajen", via: "app", action: "updateStop", args: { id: DINNER, patch: BOTH } });
      assert.equal(env.ok, true, JSON.stringify(env));
      await advance(page, backend, 20000);
      await expectText(page, row(DINNER) + " .dst-n", NAME);
      assert.equal(await rowOpen(page, DINNER), true, "the stop stays open");
      // And dropped again without closing it.
      await backend.handle({ key: "test-key", actor: "Ajen", via: "app", action: "updateStop", args: { id: DINNER, patch: { nameJp: "", addressJp: "" } } });
      await advance(page, backend, 20000);
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .dst").length === 0), "the block goes");
      assert.equal(await rowOpen(page, DINNER), true);
    },
  },
  {
    name: "the Japanese is changed, then removed on another phone while the screen is up: it redraws, then closes",
    async run({ page }) {
      const backend = await ready(page);
      await openDriver(page);
      let env = await backend.handle({ key: "test-key", actor: "Ajen", via: "app", action: "updateStop", args: { id: DINNER, patch: { addressJp: "架空県湖畔郡湖畔町1-2-3" } } });
      assert.equal(env.ok, true, JSON.stringify(env));
      await advance(page, backend, 20000);
      await expectText(page, "#driver .dc-ad", "架空県湖畔郡湖畔町1-2-3");
      assert.equal(await isOpen(page, "driver"), true);
      env = await backend.handle({ key: "test-key", actor: "Ajen", via: "app", action: "updateStop", args: { id: DINNER, patch: { nameJp: "", addressJp: "" } } });
      assert.equal(env.ok, true, JSON.stringify(env));
      await advance(page, backend, 20000);
      await atRest(page, "#driver", { open: false, message: "it closes when the Japanese is gone" });
      assert.equal(await page.evaluate(() => document.getElementById("phone").classList.contains("driver-open")), false);
      assert.equal(await rowOpen(page, DINNER), true, "the stop stays open");
    },
  },
  {
    name: "the stop is removed on another phone while the screen is up: it closes",
    async run({ page }) {
      const backend = await ready(page);
      await openDriver(page);
      const env = await backend.handle({ key: "test-key", actor: "Ajen", via: "app", action: "deleteStop", args: { id: DINNER } });
      assert.equal(env.ok, true, JSON.stringify(env));
      await advance(page, backend, 20000);
      await atRest(page, "#driver", { open: false, message: "it closes when the stop is gone" });
      assert.equal(await page.evaluate(() => document.getElementById("driver").textContent), "");
    },
  },
  {
    name: "the stop sheet saves the two fields, and they come back on reopening",
    async run({ page }) {
      const backend = await ready(page, { seed: seedWith() });
      await openRow(page);
      await page.click(row(DINNER) + " .r-edit");
      await atRest(page, "#stop");
      const labels = await page.evaluate(() => ["stSign", "stNameJp", "stAddrJp"].map((id) => {
        const i = document.getElementById(id);
        return [i.closest("label").querySelector("span").textContent, i.maxLength, i.lang, i.enterKeyHint];
      }));
      assert.deepEqual(labels, [
        ["Japanese name on signs", 20, "ja", "next"],
        ["Full name in Japanese, for a taxi driver", 80, "ja", "next"],
        ["Address in Japanese, for a taxi driver", 200, "ja", "next"],
      ]);
      // The keyboard's Next: the sign name, then the name, then the address.
      await page.focus("#stSign");
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement.id), "stNameJp");
      await page.fill("#stNameJp", NAME);
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement.id), "stAddrJp");
      await page.fill("#stAddrJp", ADDRESS);
      await page.evaluate(() => document.getElementById("stNameJp").closest("label").scrollIntoView({ block: "center" }));
      await page.evaluate(() => document.activeElement.blur());
      await shot(page, "stop-sheet-fields-390");
      await page.click("#stSave");
      await atRest(page, "#stop", { open: false });
      const sent = backend.requests.filter((r) => r.action === "updateStop").at(-1);
      assert.deepEqual(sent.args.patch, BOTH, "only the two fields are sent");
      const saved = backend.fake.tables.Stops.find((r) => r.id === DINNER);
      assert.deepEqual([saved.name_jp, saved.address_jp], [NAME, ADDRESS]);
      await expectText(page, row(DINNER) + " .dst-a", ADDRESS);
      await openRow(page);
      await page.click(row(DINNER) + " .r-edit");
      await atRest(page, "#stop");
      assert.deepEqual(await page.evaluate(() => [document.getElementById("stNameJp").value, document.getElementById("stAddrJp").value]), [NAME, ADDRESS]);
    },
  },
  {
    name: "an older Sheet before migrate: the stop sheet says so for these fields and keeps what was typed",
    async run({ page }) {
      const old = makeBackend({ ...seedWith(), missingColumns: ["Stops.name_jp", "Stops.address_jp"] }, { now: AT_1840 });
      await ready(page, { backend: old });
      await openRow(page);
      await page.click(row(DINNER) + " .r-edit");
      await atRest(page, "#stop");
      await page.fill("#stAddrJp", ADDRESS);
      await page.click("#stSave");
      await expectText(page, "#stMsg", "The trip sheet needs updating first. Ask Mo to run migrate.");
      assert.equal(await isOpen(page, "stop"), true);
      assert.equal(await page.evaluate(() => document.getElementById("stAddrJp").value), ADDRESS);
      assert.equal(old.fake.tables.Stops.find((r) => r.id === DINNER).address_jp, undefined, "nothing written");
    },
  },
  {
    name: "nothing is cut and nothing runs past the edge at 320",
    viewport: { width: 320, height: 640 },
    async run({ page }) {
      await ready(page);
      await openRow(page);
      let n = await noSideways(page);
      assert.equal(n.doc, true, "the page does not scroll sideways");
      assert.deepEqual([n.over, n.cut], [[], []]);
      assert.deepEqual(await nbLines(page, row(DINNER) + " .dst-a"), [{ text: "9-9-9", lines: 1 }]);
      await shot(page, "stop-block-320", row(DINNER) + " .dst");
      await openDriver(page);
      await nothingCut(page);
      assert.deepEqual(await nbLines(page, "#driver .dc-ad"), [{ text: "9-9-9", lines: 1 }], "the house number is one word on the driver's screen");
      await shot(page, "stop-driver-320");
    },
  },
  {
    name: "a very long name and address wrap on the ticket and shrink on the screen at 320; nothing is cut",
    viewport: { width: 320, height: 640 },
    async run({ page }) {
      await ready(page, { seed: seedWith({ nameJp: "炭火焼鳥とおばんざいの店 鳥花 レイクポート湖畔センタービル店", addressJp: LONG }) });
      await openRow(page);
      let n;
      n = await noSideways(page);
      assert.equal(n.doc, true);
      assert.deepEqual([n.over, n.cut], [[], []]);
      await openDriver(page);
      await nothingCut(page);
    },
  },
  {
    name: "at 320 a house number is not broken at its hyphens (the hotel card's screen too)",
    viewport: { width: 320, height: 640 },
    async run({ page }) {
      await open(page, { seed: seedWith({}, { addressJp: ADDRESS }), tab: "days" });
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
      await page.dispatchEvent('#rail .pg[data-date="2026-12-12"] .tk-stay', "click");
      await atRest(page, "#stay", { message: "the hotel card opens" });
      await page.evaluate(() => document.querySelector("#stay .drv").scrollIntoView({ block: "center" }));
      await page.click("#stay .drv");
      await atRest(page, "#driver", { message: "the driver's screen opens" });
      await until(() => page.evaluate(() => document.getElementById("driver").dataset.fit === "1"), "the type is fitted");
      assert.equal(await text(page, "#driver .dc-top"), "宿泊Asakusa hotelDone");
      assert.equal(await text(page, "#driver .dc-ad"), ADDRESS);
      assert.deepEqual(await nbLines(page, "#driver .dc-ad"), [{ text: "9-9-9", lines: 1 }]);
      await nothingCut(page);
      await shot(page, "stay-driver-320-hyphen");
      await page.click("#driverDone");
      await atRest(page, "#driver", { open: false });
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("drv")), true, "focus back on the card's key");
    },
  },
];
