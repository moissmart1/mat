// A picture in each person's seal (Task 16): set in You, shrunk on the phone,
// drawn in place of the initials on every seal, on and off told apart, seen
// by the other phones, removed, and put back from History.

const assert = require("node:assert/strict");
const { SEED, NOON12, open, until, atRest, text, expectText, visible } = require("./helpers.cjs");

// ---- small tools for this file ----

// A 300 x 200 PNG drawn by the page's own canvas (no real photo): grey
// edges, and a centred square split blue and orange, so the crop shows.
async function makePng(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 300;
    c.height = 200;
    const g = c.getContext("2d");
    g.fillStyle = "#888";
    g.fillRect(0, 0, 300, 200);
    g.fillStyle = "#2a62c9";
    g.fillRect(50, 0, 100, 200);
    g.fillStyle = "#f08a24";
    g.fillRect(150, 0, 100, 200);
    return c.toDataURL("image/png").split(",")[1];
  });
  return { name: "square.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") };
}

const people = (backend) => backend.fake.primitives.readTable_("People");
const photoOf = (backend, name) => people(backend).find((p) => p.name === name).photo;
const setPersonRequests = (backend) => backend.requests.filter((r) => r.action === "setPerson").length;

const waitYou = (page) => atRest(page, "#you", { message: "the settings sheet opens" });
const waitClosed = (page, id) => until(() => page.evaluate((i) => !document.getElementById(i).classList.contains("is-open"), id), id + " closes");

async function ready(page, opts = {}) {
  const backend = await open(page, { seed: SEED, nowMs: NOON12, ...opts });
  await until(() => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length > 0), "the receipt draws");
  return backend;
}

async function openYou(page) {
  await page.click("#youBtn");
  await waitYou(page);
}

// What a seal holds: whether it has a picture, its classes, its text, the
// picture's own size once loaded, and how the picture is drawn.
function sealOf(page, selector) {
  return page.evaluate((sel) => {
    const s = document.querySelector(sel);
    if (!s) return null;
    const img = s.querySelector("img");
    const st = img ? getComputedStyle(img) : null;
    return {
      pic: s.classList.contains("has-pic"),
      on: s.classList.contains("is-on"),
      text: s.textContent,
      src: img ? img.src.slice(0, 23) : "",
      alt: img ? img.getAttribute("alt") : null,
      size: img && img.complete ? [img.naturalWidth, img.naturalHeight] : null,
      filter: st ? st.filter : "",
      opacity: st ? Number(st.opacity) : 1,
      ring: getComputedStyle(s).borderTopColor,
      ringW: parseFloat(getComputedStyle(s).borderTopWidth),
    };
  }, selector);
}
const waitSeal = (page, selector, want, message) =>
  until(async () => {
    const s = await sealOf(page, selector);
    return s && want(s) ? s : null;
  }, message);
const SHU = "rgb(214, 60, 30)";
const isColour = (s) => s.pic && s.filter === "none" && s.opacity === 1 && s.ring === SHU && s.ringW >= 2;
const isGrey = (s) => s.pic && /grayscale\(1\)/.test(s.filter) && s.opacity < 0.6 && s.ring !== SHU;

// Chooses the generated picture through the row, as a tap would.
async function choose(page, file) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#setPicPick")]);
  assert.equal(chooser.isMultiple(), false);
  await chooser.setFiles(file);
}

const payer = (n) => '#xPayer .seal[data-p="' + n + '"]';
const splitter = (n) => '#xSplit .seal[data-p="' + n + '"]';

async function checkRegister(page) {
  await page.click("#ring");
  await atRest(page, "#reg", { message: "the register opens" });
  const on = await waitSeal(page, payer("Mo"), (s) => s.pic && s.on, "Mo's paid seal shows the picture, on");
  assert.ok(isColour(on), "on: full colour in the vermilion ring " + JSON.stringify(on));
  assert.equal(on.alt, "");
  assert.equal(await page.getAttribute(payer("Mo"), "aria-label"), "Mo paid");
  const aj = await sealOf(page, payer("Ajen"));
  assert.deepEqual([aj.pic, aj.text], [false, "AJ"], "no picture: initials as before");
  // Split seals: all on; Mo off is grey and faint in the dim ring.
  assert.ok(isColour(await sealOf(page, splitter("Mo"))), "split, on");
  await page.click(splitter("Mo"));
  // The colours ease over 120 ms (real time): wait for where they end.
  await waitSeal(page, splitter("Mo"), (s) => !s.on && isGrey(s), "off: greyscale, faint, dim ring");
  await page.click(splitter("Mo"));
  await waitSeal(page, splitter("Mo"), (s) => s.on && isColour(s), "on again: colour");
  // Payer: Ajen chosen, Mo's paid seal goes grey.
  await page.click(payer("Ajen"));
  await waitSeal(page, payer("Mo"), (s) => !s.on && isGrey(s), "payer not chosen: grey");
  await page.click("#regDone");
  await waitClosed(page, "reg");
}

async function checkLine(page) {
  const row = '#rc .rc-row[data-id="seedexp001"] .mini';
  const mini = await waitSeal(page, row, (s) => s.pic, "the receipt line's payer seal shows Mo's picture");
  assert.equal(mini.ring, SHU);
  assert.equal(mini.filter, "none");
  assert.equal(await page.getAttribute(row, "aria-label"), "Mo", "the seal still says whose it is");
  assert.equal((await sealOf(page, '#rc .rc-row[data-id="seedexp002"] .mini')).text, "AJ");
  await page.click('#rc .rc-row[data-id="seedexp001"]');
  await atRest(page, "#line", { message: "the line sheet opens" });
  await waitSeal(page, "#line .ln-paid .mini", (s) => s.pic, "the line sheet's payer seal");
  const shared = await page.$$eval("#line .ln-d .mini", (els) => els.map((e) => (e.classList.contains("has-pic") ? "pic" : e.textContent)));
  assert.deepEqual(shared, ["pic", "AJ", "TR"], "shared by: Mo's picture, the others' initials");
  await page.click("#lnDone");
  await waitClosed(page, "line");
}

const JPEG = require("../fixtures/picture.json").jpeg;

module.exports = [
  {
    name: "a picture that arrives while a line is open is drawn on its seals without reopening",
    async run({ page }) {
      const backend = await ready(page);
      await page.click('#rc .rc-row[data-id="seedexp001"]');
      await atRest(page, "#line", { message: "the line sheet opens" });
      const seals = () => page.evaluate(() => ({
        paid: document.querySelector("#line .ln-paid .mini").classList.contains("has-pic"),
        shared: [...document.querySelectorAll("#line .ln-d .mini")].map((e) => (e.classList.contains("has-pic") ? "pic" : e.textContent)),
      }));
      assert.deepEqual(await seals(), { paid: false, shared: ["MO", "AJ", "TR"] });
      // Mo (the payer) sets a picture on this phone; Ajen (shares it) on another.
      await page.evaluate((pic) => globalThis.__matTest.store.setPerson("Mo", { photo: pic }), JPEG);
      await until(async () => (await seals()).paid, "the payer's seal shows the picture");
      backend.fake.primitives.updateWhere_("People", "name", "Ajen", { photo: JPEG });
      await page.evaluate(() => globalThis.__matTest.store.refresh());
      await until(async () => JSON.stringify((await seals()).shared) === JSON.stringify(["pic", "pic", "TR"]), "the sharers' seals show theirs");
      assert.equal(await page.evaluate(() => document.getElementById("line").classList.contains("is-open")), true, "the sheet stayed open");
    },
  },
  {
    name: "a picture chosen in You shows in every seal (on and off told apart), on a second phone after refresh; removed, then put back from History",
    async run(ctx) {
      const { page } = ctx;
      const backend = await ready(page);
      const b = await ctx.newPhone();
      await ready(b, { backend, me: "Ajen" });

      await openYou(page);
      assert.equal(await text(page, "#setPic > span"), "Your pictureShows in your seal, on every phone");
      assert.equal(await text(page, "#setPicPick"), "Add");
      assert.equal(await visible(page, "#setPicSeal"), false);
      assert.equal(await visible(page, "#setPicDel"), false);
      assert.equal(await page.getAttribute("#setPicFile", "accept"), "image/*");
      assert.equal((await sealOf(page, '#setWho [data-me="Mo"] .seal')).text, "MO");

      await choose(page, await makePng(page));
      await until(() => /^data:image\/jpeg;base64,/.test(photoOf(backend, "Mo")), "the picture reaches the trip sheet");
      const stored = photoOf(backend, "Mo");
      assert.ok(stored.length <= 12000, "at most 12,000 characters: " + stored.length);
      const mine = await waitSeal(page, "#setPicSeal", (s) => s.pic && s.size, "You's row shows the picture");
      assert.deepEqual(mine.size, [128, 128], "shrunk to 128 x 128");
      assert.equal(mine.src, "data:image/jpeg;base64,");
      assert.ok(isColour(mine), JSON.stringify(mine));
      await expectText(page, "#setPicPick", "Change");
      assert.equal(await text(page, "#setPicDel"), "Remove");
      assert.equal(await visible(page, "#setPicDel"), true);
      // Which one are you: Mo chosen (in colour), and the others keep their initials.
      assert.ok(isColour(await waitSeal(page, '#setWho [data-me="Mo"] .seal', (s) => s.pic, "the who seal")));
      assert.equal((await sealOf(page, '#setWho [data-me="Ajen"] .seal')).text, "AJ");
      // The centre square was kept: its left half blue, its right half orange.
      const halves = await page.evaluate(() => {
        const img = document.querySelector("#setPicSeal img");
        const c = document.createElement("canvas");
        c.width = c.height = 128;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        const at = (x) => Array.from(g.getImageData(x, 64, 1, 1).data.slice(0, 3));
        return [at(20), at(108)];
      });
      assert.ok(halves[0][2] > 150 && halves[0][0] < 100, "left is blue: " + halves[0]);
      assert.ok(halves[1][0] > 200 && halves[1][2] < 100, "right is orange: " + halves[1]);

      await page.click("#youDone");
      await waitClosed(page, "you");
      await checkRegister(page);
      await checkLine(page);

      // The other phone, after its next refresh.
      assert.equal((await sealOf(b, '#rc .rc-row[data-id="seedexp001"] .mini')).text, "MO", "not before it refreshes");
      await openYou(b);
      await b.click("#setFreshRow");
      await waitSeal(b, '#setWho [data-me="Mo"] .seal', (s) => s.pic && !s.on, "Ajen's phone shows Mo's picture, off (Ajen is chosen)");
      assert.equal(await text(b, "#setPicPick"), "Add", "Ajen's own row: no picture of his");
      await b.click("#youDone");
      await waitClosed(b, "you");
      await waitSeal(b, '#rc .rc-row[data-id="seedexp001"] .mini', (s) => s.pic, "and on the receipt");

      // Removed: initials come back everywhere.
      await openYou(page);
      await page.click("#setPicDel");
      await until(() => photoOf(backend, "Mo") === "", "the picture is taken away");
      await waitSeal(page, '#setWho [data-me="Mo"] .seal', (s) => !s.pic && s.text === "MO", "initials back in You");
      await expectText(page, "#setPicPick", "Add");
      assert.equal(await visible(page, "#setPicSeal"), false);
      assert.equal(await visible(page, "#setPicDel"), false);
      assert.equal((await sealOf(page, '#rc .rc-row[data-id="seedexp001"] .mini')).text, "MO");

      // History: two sentences, Undo on the newest, and the picture is back.
      await page.click("#setHist");
      await until(() => page.evaluate(() => document.querySelectorAll("#tape .tp-row").length >= 2), "the tape loads");
      const rows = await page.$$eval("#tape .tp-row", (els) => els.map((r) => [r.querySelector(".tp-s").textContent, !!r.querySelector(".tp-undo")]));
      assert.deepEqual(rows.slice(0, 2), [["Mo removed the picture", true], ["Mo set a picture", false]]);
      await page.locator("#tape .tp-row .tp-undo").first().click();
      await until(() => photoOf(backend, "Mo") === stored, "undo puts the picture back");
      await waitSeal(page, '#rc .rc-row[data-id="seedexp001"] .mini', (s) => s.pic, "the receipt shows it again");

      // Ajen's History has no Undo on Mo's picture.
      await b.click("#histBtn");
      await until(() => b.evaluate(() => document.querySelectorAll("#tape .tp-row").length >= 3), "Ajen's tape loads");
      const theirs = await b.$$eval("#tape .tp-row", (els) => els.map((r) => [r.querySelector(".tp-s").textContent, !!r.querySelector(".tp-undo")]));
      assert.deepEqual(theirs.slice(0, 3), [["Mo undid: removed the picture", false], ["Mo removed the picture", false], ["Mo set a picture", false]]);
    },
  },
  {
    name: "who are you: a picture replaces the initials on first open, in colour",
    async run({ page }) {
      const backend = await open(page, { seed: { ...SEED, people: { Ajen: { photo: require("../fixtures/picture.json").jpeg } } }, me: null, nowMs: NOON12 });
      await until(() => visible(page, '.who-pick [data-me="Ajen"] .seal'), "the picker shows");
      const sel = '.who-pick [data-me="Ajen"] .seal';
      const s = await waitSeal(page, sel, (x) => x.pic, "Ajen's seal shows the picture");
      assert.equal(s.filter, "none");
      assert.equal(s.ring, SHU);
      assert.equal((await sealOf(page, '.who-pick [data-me="Mo"] .seal')).text, "MO");
      assert.equal(backend.requests.filter((r) => r.action === "setPerson").length, 0);
    },
  },
  {
    name: "a file that is not a picture is turned away with the usual notice, and nothing is sent",
    async run({ page }) {
      const backend = await ready(page);
      await openYou(page);
      await choose(page, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a picture") });
      await expectText(page, "#ubarT", "That picture couldn’t be used. Try another.");
      await choose(page, { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not really a png") });
      await until(() => page.evaluate(() => !document.getElementById("setPicPick").disabled), "the row is free again");
      assert.equal(setPersonRequests(backend), 0);
      assert.equal(photoOf(backend, "Mo"), "");
      assert.equal(await text(page, "#setPicPick"), "Add");
    },
  },
  {
    name: "held sideways at 844 x 390: the picture row fits, the keypad's seals and a line show the picture",
    viewport: { width: 844, height: 390 },
    async run({ page }) {
      const backend = await ready(page);
      await openYou(page);
      await page.evaluate(() => document.getElementById("setPic").scrollIntoView({ block: "center" }));
      const box = await page.evaluate(() => {
        const r = document.getElementById("setPic").getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: innerWidth, h: innerHeight };
      });
      assert.ok(box.top >= 0 && box.bottom <= box.h && box.left >= 0 && box.right <= box.w, "the row is on screen: " + JSON.stringify(box));
      await choose(page, await makePng(page));
      await until(() => /^data:image\/jpeg/.test(photoOf(backend, "Mo")), "saved");
      await waitSeal(page, "#setPicSeal", (s) => s.pic, "the row shows it");
      const pick = await page.evaluate(() => {
        const a = document.getElementById("setPicPick").getBoundingClientRect();
        const d = document.getElementById("setPicDel").getBoundingClientRect();
        return [a.height, d.height, a.right <= d.left];
      });
      assert.deepEqual(pick, [44, 44, true], "Change and Remove are full-size taps, side by side");
      await page.click("#youDone");
      await waitClosed(page, "you");
      await checkRegister(page);
      await checkLine(page);
    },
  },
];
