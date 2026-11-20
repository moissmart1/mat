// The shell, first open and the receipt (Task 7).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ORIGIN, SEED, NOON12, makeBackend, open, until, text, expectText, visible } = require("./helpers.cjs");

const homelinkShot = async (page, name) => {
  const dir = process.env.MAT_TAB_SHOTS;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name) });
};
const NAMES = ["Mo", "Ajen", "Trenton"];
const lib = async () => ({ ...(await import("../../js/money.js")), ...(await import("../../js/format.js")) });
const live = (seed) => seed.expenses.filter((e) => !e.deleted);
const rowCount = (page) => page.evaluate(() => document.querySelectorAll("#rc .rc-row").length);
const waitRows = (page, n) => until(async () => (await rowCount(page)) === n, "expected " + n + " receipt rows");

function withExtras(extra = {}) {
  const seed = JSON.parse(JSON.stringify(SEED));
  if (extra.expenses) seed.expenses.push(...extra.expenses);
  if (extra.days) seed.days = extra.days;
  if (extra.patch) for (const [id, p] of Object.entries(extra.patch)) Object.assign(seed.expenses.find((e) => e.id === id), p);
  return seed;
}

const BOARD = {
  id: "seedexp010", day: "pre", title: "Board rental", amount: 730, currency: "CAD", rate: 111,
  paidBy: "Ajen", split: ["Mo", "Ajen", "Trenton"], splitMode: "equal", splitVals: [], note: "", kind: "", addedBy: "Ajen", deleted: false,
};

module.exports = [
  {
    name: "within a day the newest line is at the top",
    async run({ page }) {
      const mk = (id, title, addedAt) => ({
        id, day: "2026-12-11", title, amount: 1000, currency: "JPY", rate: 111, paidBy: "Mo", split: NAMES.slice(),
        splitMode: "equal", splitVals: [], note: "", kind: "", addedBy: "Mo", addedAt, deleted: false,
      });
      const seed = withExtras({ expenses: [mk("ordexp001", "Earlier snack", "2026-12-11T09:00:00.000Z"), mk("ordexp002", "Later snack", "2026-12-11T15:00:00.000Z")] });
      await open(page, { seed, nowMs: NOON12 });
      await waitRows(page, 10);
      const ids = await page.$$eval('.rc-group[data-day="2026-12-11"] .rc-row[data-id]', (els) => els.map((e) => e.dataset.id));
      assert.deepEqual(ids.slice(0, 2), ["ordexp002", "ordexp001"], "the later one, then the earlier one, above the older lines");
      // Lines with the same time keep the Sheet's order, flipped: a later row is higher.
      const was = seed.expenses.filter((e) => !e.deleted && e.day === "2026-12-11" && !e.id.startsWith("ord")).map((e) => e.id);
      assert.deepEqual(ids.slice(2), was.slice().reverse());
      // The total stays at the foot of the receipt.
      const below = await page.evaluate(() => {
        const last = [...document.querySelectorAll("#rc .rc-group")].pop();
        return !!(last.compareDocumentPosition(document.querySelector("#rc .rc-tot")) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      assert.ok(below, "the total is under the last day");
    },
  },
  {
    name: "sentence, summary and receipt from the standard seed",
    async run({ page }) {
      const { balances, owedList, standing, sentence, jpyOf, cadCents, yen, dollars } = await lib();
      await open(page, { seed: SEED, nowMs: NOON12 });
      await waitRows(page, 8);

      const exps = live(SEED);
      const bal = balances(NAMES, exps, SEED.payments);
      await expectText(page, "#say", sentence(standing("Mo", owedList(NAMES, exps, SEED.payments, true), bal)));
      const cents = exps.reduce((a, e) => a + cadCents(e), 0);
      await expectText(page, "#sayP", "The trip so far is " + dollars(cents) + ", about ¥438,340, across 8 receipts.");
      assert.equal(dollars(cents), "$3,949.01");
      // Figures in the summary are bold and bright; the words around them stay dim.
      const figs = await page.$$eval("#sayP b", (els) => els.map((b) => [b.textContent, getComputedStyle(b).fontWeight, getComputedStyle(b).color]));
      assert.deepEqual(figs.map((f) => f[0]), ["$3,949.01", "¥438,340", "8"]);
      const textColour = await page.evaluate(() => getComputedStyle(document.body).color);
      for (const [, weight, colour] of figs) {
        assert.equal(weight, "700");
        assert.equal(colour, textColour);
      }

      const heads = await page.$$eval("#rc .rc-day", (els) => els.map((e) => e.textContent));
      assert.equal(heads.length, 4, "four day headings");
      // Newest day at the top; what was paid before the trip is at the bottom.
      assert.match(heads[0], /Dec 12/);
      assert.match(heads[1], /Dec 11/);
      assert.match(heads[2], /Dec 10/);
      assert.match(heads[3], /出発前/);

      const rows = await page.$$eval("#rc .rc-row[data-id]", (els) => els.map((e) => e.textContent));
      assert.equal(rows.length, 8);
      assert.ok(!rows.some((t) => t.includes("Konbini snacks")), "deleted line is not shown");

      assert.equal(await page.locator('.rc-group[data-day="2026-12-12"] .rc-empty').count(), 1, "Dec 12 is empty");
      assert.equal(await page.locator('.rc-group[data-day="2026-12-12"] [data-addday="2026-12-12"]').count(), 1);

      // Every day's subtotal: 小計, the day's yen and its dollars.
      for (const day of ["pre", "2026-12-10", "2026-12-11"]) {
        const list = exps.filter((e) => e.day === day);
        const sub = await text(page, '.rc-group[data-day="' + day + '"] .rc-sub');
        assert.ok(sub.includes("小計"), day + " subtotal says 小計");
        assert.ok(sub.includes(yen(list.reduce((a, e) => a + jpyOf(e), 0))), day + " subtotal yen: " + sub);
        assert.ok(sub.includes(dollars(list.reduce((a, e) => a + cadCents(e), 0))), day + " subtotal dollars: " + sub);
      }
      assert.ok((await text(page, '.rc-group[data-day="2026-12-11"] .rc-sub')).includes("¥27,400"));

      assert.ok((await text(page, '.rc-row[data-id="seedexp008"]')).includes("Ajen + Trenton only"));
      const onlyNames = await page.$$eval('.rc-row[data-id="seedexp008"] small b', (els) => els.map((b) => [b.textContent, getComputedStyle(b).fontWeight]));
      assert.deepEqual(onlyNames, [["Ajen", "700"], ["Trenton", "700"]]);
      await expectText(page, '.rc-row[data-id="seedexp001"] .rc-note', "ref NK-4471");
      assert.equal(await page.locator("#rc .rc-note").count(), 1, "only the line with a note has .rc-note");

      const tot = await text(page, "#rc .rc-tot");
      assert.ok(tot.includes("合計") && tot.includes("¥438,340"), "total: " + tot);
      assert.ok((await text(page, "#rc .rc-f")).includes("毎度ありがとうございます"));

      assert.ok(await visible(page, "#nav #youBtn"));
      assert.ok(await visible(page, "#nav #ring"));
      assert.ok(await visible(page, "#histBtn"));
      assert.equal(await visible(page, "#histN"), false, "no new lines, no count");
      assert.equal(await visible(page, "#first"), false);
      assert.equal(await visible(page, "#how"), false);

      // No sideways scroll: the page, and the boxes that clip their own overflow.
      for (const sel of [":root", "#vMoney", "#rc", "#slip"]) {
        const { sw, cw } = await page.evaluate((s) => {
          const el = document.querySelector(s);
          return { sw: el.scrollWidth, cw: el.clientWidth };
        }, sel);
        assert.equal(sw, cw, "no sideways scroll in " + sel);
      }

      // Nothing covers the bottom bar's buttons at the top of the page.
      await page.evaluate(() => { document.getElementById("vMoney").scrollTop = 0; });
      for (const sel of ["#youBtn", "#ring"]) {
        const ok = await page.evaluate((s) => {
          const b = document.querySelector(s);
          const r = b.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!hit && (hit === b || b.contains(hit));
        }, sel);
        assert.ok(ok, sel + " is the element at its own centre");
      }
      // ...and the bar behind them is solid, so no paper shows through.
      const nav = await page.evaluate(() => ({ bg: getComputedStyle(document.getElementById("nav")).backgroundColor, image: getComputedStyle(document.getElementById("nav")).backgroundImage }));
      assert.equal(nav.image, "linear-gradient(rgb(35, 29, 26), rgb(26, 22, 20) 60%)", "the bottom bar is the opaque --bar-top to --ground gradient");
    },
  },
  {
    name: "day cities, and a dollar line shows dollars",
    async run({ page }) {
      const seed = withExtras({ expenses: [BOARD], days: { "2026-12-11": { city: "Tokyo" } } });
      await open(page, { seed, nowMs: NOON12 });
      await waitRows(page, 9);
      await expectText(page, '.rc-group[data-day="2026-12-11"] .rc-day .rc-city', "Tokyo");
      assert.equal(await page.locator('.rc-group[data-day="2026-12-10"] .rc-city').count(), 0, "no city, none shown");
      await expectText(page, '.rc-row[data-id="seedexp010"] .rc-amt', "$730.00");
      assert.ok((await text(page, '.rc-group[data-day="pre"] .rc-sub')).includes("¥480,030"));
    },
  },
  {
    name: "the last-updated time, and tapping it refreshes",
    async run({ page }) {
      const backend = await open(page, { seed: SEED, nowMs: NOON12 });
      await expectText(page, "#fresh", "Up to date 13:20");
      const loads = () => backend.requests.filter((r) => r.action === "load").length;
      await until(() => loads() === 1, "one load at boot");
      await page.click("#fresh");
      await until(() => loads() === 2, "tapping #fresh loads again");
    },
  },
  {
    name: "lines added by someone else since you looked are marked new",
    async run({ page }) {
      const half = new Date(NOON12 - 30 * 60 * 1000).toISOString();
      const seed = withExtras({ patch: { seedexp007: { addedAt: half }, seedexp009: { addedAt: half } } });
      // The store keeps mat.seen as milliseconds (String(Date.now())).
      await open(page, { seed, nowMs: NOON12, storage: { "mat.seen": String(NOON12 - 60 * 60 * 1000) } });
      await waitRows(page, 8);
      await until(() => page.evaluate(() => document.querySelector('.rc-row[data-id="seedexp007"]').classList.contains("is-new")), "Shibuya Sky is new");
      assert.equal(await page.locator('.rc-row[data-id="seedexp009"].is-new').count(), 0, "Mo's own Coffee is not new");
      assert.equal(await page.locator("#rc .rc-row.is-new").count(), 1);
      await expectText(page, "#histN", "1");
      assert.ok(await visible(page, "#histN"));

      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        Object.defineProperty(document, "hidden", { value: true, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await until(() => page.evaluate(() => Number(localStorage.getItem("mat.seen")) >= Date.now()), "hiding the page stores mat.seen");
      await page.reload();
      await waitRows(page, 8);
      assert.equal(await page.locator("#rc .rc-row.is-new").count(), 0, "nothing new after looking");
      assert.equal(await visible(page, "#histN"), false);
    },
  },
  {
    name: "no key: says so and loads nothing",
    async run({ page }) {
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await expectText(page, "#gate p", "This phone needs the trip link. Open it from your email again, or paste it here.");
      assert.ok(await visible(page, "#gate"));
      assert.equal(await page.evaluate(() => document.getElementById("rc").childElementCount), 0, "#rc is empty");
      assert.equal(backend.requests.length, 0, "no calls without a key");
    },
  },
  {
    name: "no key: pasting the trip link opens the trip without a reload, and keeps the key off the screen and the address",
    async run({ page }) {
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await expectText(page, "#gate p", "This phone needs the trip link. Open it from your email again, or paste it here.");
      assert.ok(await visible(page, "#keyPaste"));
      assert.equal(await page.locator('label[for="keyPaste"]').count(), 0, "no label: the sentence says what the field is for");
      assert.equal(await page.getAttribute("#keyPaste", "aria-label"), "Trip link");
      assert.equal(await text(page, "#keyGo"), "Open");
      const field = await page.evaluate(() => {
        const f = document.getElementById("keyPaste");
        return { cap: f.getAttribute("autocapitalize"), cor: f.getAttribute("autocorrect"), size: parseFloat(getComputedStyle(f).fontSize) };
      });
      assert.equal(field.cap, "none");
      assert.equal(field.cor, "off");
      assert.ok(field.size >= 16, "16 px or more, so Safari does not zoom: " + field.size);
      await page.evaluate(() => {
        globalThis.__marker = 1; // gone if the page reloads
      });

      for (const bad of ["", "   ", "hello there", ORIGIN + "/", ORIGIN + "/#x=1", "#k=", "abc"]) {
        await page.fill("#keyPaste", bad);
        await page.click("#keyGo");
        await expectText(page, "#keyMsg", "That doesn’t look like a trip link.");
      }
      assert.equal(backend.requests.length, 0, "a bad paste calls nothing");
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.key")), null);

      await page.fill("#keyPaste", "  " + ORIGIN + "/#k=test-key  ");
      await page.click("#keyGo");
      await waitRows(page, 8);
      assert.equal(await visible(page, "#gate"), false);
      assert.equal(await page.evaluate(() => globalThis.__marker), 1, "no reload");
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.key")), "test-key");
      assert.equal(await page.evaluate(() => location.hash), "");
      assert.equal(await page.evaluate(() => location.href.includes("test-key")), false);
      assert.equal(await page.evaluate(() => document.body.innerText.includes("test-key")), false, "the key is not drawn");
      assert.equal(await page.inputValue("#keyPaste"), "", "the field lets the key go");
    },
  },
  {
    name: "no key in Safari: the gate says to open the email again; pictures when MAT_TAB_SHOTS is set",
    async run({ page }) {
      await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await expectText(page, "#gate p", "This phone needs the trip link. Open it from your email again, or paste it here.");
      assert.equal(await page.evaluate(() => navigator.standalone === true), false);
      await homelinkShot(page, "gate-safari.png");
    },
  },
  {
    name: "no key on the Home Screen app: the gate says to copy the link from the email, and pasting a valid link still signs in",
    async run({ page }) {
      await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await expectText(page, "#gate p", "The Home Screen app keeps its own sign-in. Find the email with your own MAT link, press and hold the link, tap Copy Link, then paste it here.");
      assert.ok(await visible(page, "#keyPaste"));
      await homelinkShot(page, "gate-standalone.png");
      await page.fill("#keyPaste", ORIGIN + "/#k=test-key");
      await page.click("#keyGo");
      await waitRows(page, 8);
      assert.equal(await visible(page, "#gate"), false);
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.key")), "test-key");
      assert.ok(backend.requests.some((r) => r.action === "load"));
    },
  },
  {
    name: "no key on the Home Screen app: a refused link says how to fix it, and pasting a good link signs in",
    async run({ page }) {
      await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await until(() => visible(page, "#keyPaste"), "the paste field");
      await page.fill("#keyPaste", "wrong-key-123");
      await page.click("#keyGo");
      await until(() => backend.requests.some((r) => r.action === "load"), "it tries the key");
      await expectText(page, "#gate p", "That link no longer works here. Find the email with your own MAT link, press and hold the link, tap Copy Link, then paste it here.");
      await page.fill("#keyPaste", ORIGIN + "/#k=test-key");
      await page.click("#keyGo");
      await waitRows(page, 8);
      assert.equal(await visible(page, "#gate"), false);
    },
  },
  {
    name: "no key: a bare key works too; one the trip refuses comes back to the same screen",
    async run({ page }) {
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null });
      await until(() => visible(page, "#keyPaste"), "the paste field");
      await page.fill("#keyPaste", "wrong-key-123");
      await page.click("#keyGo");
      await until(() => backend.requests.some((r) => r.action === "load"), "it tries the key");
      await expectText(page, "#gate p", "That trip link didn’t work. Ask Mo for the current one.");
      assert.ok(await visible(page, "#keyPaste"));
      assert.equal(await rowCount(page), 0);

      await page.fill("#keyPaste", "test-key");
      await page.press("#keyPaste", "Enter");
      await waitRows(page, 8);
      assert.equal(await visible(page, "#gate"), false);
    },
  },
  {
    name: "not connected: says so and calls nothing",
    async run({ page }) {
      // A bridge is there but no MAT_FAKE_API, and API_URL is empty (the
      // shipped config with its address blanked): the app must not call
      // anything at all.
      const config = fs.readFileSync(path.join(__dirname, "..", "..", "js", "config.js"), "utf8")
        .replace(/API_URL = "[^"]*"/, 'API_URL = ""');
      assert.ok(config.includes('API_URL = ""'), "the address was blanked");
      await page.route("**/js/config.js", (route) => route.fulfill({ contentType: "text/javascript", body: config }));
      const backend = makeBackend(SEED, { now: NOON12 });
      await page.exposeFunction("__matBridge", (body) => backend.handle(body));
      const outside = [];
      page.on("request", (r) => {
        if (!["localhost", "fonts.googleapis.com", "fonts.gstatic.com"].includes(new URL(r.url()).hostname)) outside.push(r.url());
      });
      await page.goto(ORIGIN + "/");
      await expectText(page, "#gate p", "This app isn’t connected yet.");
      assert.equal(await visible(page, "#keyPaste"), false, "no paste field when the app is not connected");
      assert.equal(await page.evaluate(() => document.getElementById("rc").childElementCount), 0);
      assert.deepEqual(outside, [], "no request to any other host (fonts aside)");
      assert.equal(backend.requests.length, 0, "the bridge received nothing");
    },
  },
  {
    name: "first open: which one are you, then how this works",
    async run({ page }) {
      await open(page, { seed: SEED, nowMs: NOON12, key: null, me: null, how: null, hash: "#k=test-key" });
      await until(() => visible(page, "#first"), "#first shows");
      assert.equal(await page.locator("#first [data-me]").count(), 3, "three seals");
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.key")), "test-key");
      assert.equal(await visible(page, "#how"), false);

      await page.click('#first [data-me="Ajen"]');
      await until(() => page.evaluate(() => localStorage.getItem("mat.me") === "Ajen"), "mat.me stored");
      assert.equal(await page.evaluate(() => location.hash), "");
      assert.ok(!(await page.evaluate(() => location.href)).includes("k="), "key gone from the address");
      await until(() => visible(page, "#how"), "#how shows");
      assert.equal(await visible(page, "#first"), false);
      const lines = await page.$$eval("#how .how-l", (els) => els.map((e) => e.textContent.trim()));
      assert.deepEqual(lines, ["Ring up what you paid.", "The slip says who pays whom.", "Stamp it the moment you send."]);
      // In a Safari tab (not from the Home Screen), one more line under them, dimmer.
      assert.ok(await visible(page, "#how #howHome"));
      assert.equal(await text(page, "#howHome"), "Add it to your Home Screen from You 設定. The Home Screen app asks for your link once: paste it from your email.");
      const dim = await page.evaluate(() => [getComputedStyle(document.querySelector("#how .how-l")).opacity, getComputedStyle(document.getElementById("howHome")).opacity].map(Number));
      assert.ok(dim[1] < dim[0], "dimmer than the three lines: " + dim);

      await page.click("#howOk");
      await until(() => page.evaluate(() => localStorage.getItem("mat.how") === "1"), "mat.how stored");
      await until(async () => !(await visible(page, "#how")), "#how closes");
      await waitRows(page, 8);
      assert.ok(await visible(page, "#rc"));

      await page.reload();
      await waitRows(page, 8);
      assert.equal(await visible(page, "#first"), false, "no identity sheet on the next load");
      assert.equal(await visible(page, "#how"), false, "no how-this-works on the next load");
    },
  },
  {
    name: "how this works survives a reload before Got it",
    async run({ page }) {
      await open(page, { seed: SEED, nowMs: NOON12, key: null, me: null, how: null, hash: "#k=test-key" });
      await until(() => visible(page, "#first"), "#first shows");
      await page.click('#first [data-me="Trenton"]');
      await until(() => visible(page, "#how"), "#how shows");
      await page.reload();
      await waitRows(page, 8);
      await until(() => visible(page, "#how"), "#how still shows after a reload");
      assert.equal(await visible(page, "#first"), false);
      await page.click("#howOk");
      await until(async () => !(await visible(page, "#how")), "#how closes");
    },
  },
  {
    name: "a key the phone cannot store still works for this visit",
    async run({ page }) {
      await page.addInitScript(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === "mat.key") throw new Error("QuotaExceededError");
          return set.call(this, k, v);
        };
      });
      const backend = await open(page, { seed: SEED, nowMs: NOON12, key: null, hash: "#k=test-key" });
      await waitRows(page, 8);
      assert.equal(await page.evaluate(() => localStorage.getItem("mat.key")), null, "nothing was stored");
      assert.equal(await page.evaluate(() => location.hash), "", "key gone from the address");
      assert.equal(await visible(page, "#gate"), false);
      const loads = backend.requests.filter((r) => r.action === "load");
      assert.ok(loads.length >= 1 && loads.every((r) => r.key === "test-key"), "loads carry the key from the link");
    },
  },
];

// ---- fix wave ----

module.exports.push(
  {
    name: "a Sheet row with a name the app does not know is left out, said so above the slip, and the rest works",
    async run({ page }) {
      const backend = makeBackend(SEED, { now: NOON12 });
      // Mo mistypes a name by hand in the Sheet.
      const row = backend.fake.tables.Expenses.find((r) => r.id === "seedexp004");
      row.split = "Mo,Ajen,Trent";
      await open(page, { backend, nowMs: NOON12 });
      await waitRows(page, 7);
      await expectText(page, "#asideNote", "1 line in the Sheet can’t be read (a name the app doesn’t know). It’s left out of the totals. Tell Mo.");
      const order = await page.evaluate(() => {
        const a = document.getElementById("asideNote").getBoundingClientRect();
        const s = document.getElementById("slip").getBoundingClientRect();
        return a.bottom <= s.top;
      });
      assert.ok(order, "the line sits above the slip");
      assert.equal(await page.locator('#rc .rc-row[data-id="seedexp004"]').count(), 0, "the line is not on the receipt");
      assert.ok((await page.locator("#slip .s-row.is-open").count()) > 0, "the slip still draws");
      // The rest of the app works: open a line, and the stand-in rate line stays away.
      await page.click('#rc .rc-row[data-id="seedexp001"]');
      await until(() => page.evaluate(() => document.getElementById("line").classList.contains("is-open")), "a line opens");
      assert.equal(await visible(page, "#rateNote"), false);
      // Mo fixes the Sheet; a reload loads it.
      row.split = "Mo,Ajen,Trenton";
      await page.reload();
      await waitRows(page, 8);
      assert.equal(await visible(page, "#asideNote"), false);
    },
  },
  {
    name: "yen converted at the stand-in rate: one plain line under the trip summary",
    async run({ page }) {
      const backend = makeBackend(SEED, { now: NOON12 });
      backend.fake.setRate(111, "fallback");
      await open(page, { backend, nowMs: NOON12 });
      await waitRows(page, 8);
      await expectText(page, "#rateNote", "Yen is being converted at a stand-in rate of 111. Tell Mo.");
      const under = await page.evaluate(() => document.getElementById("sayP").getBoundingClientRect().bottom <= document.getElementById("rateNote").getBoundingClientRect().top);
      assert.ok(under, "under the trip summary");
      backend.fake.setRate(108.4, "last");
      await page.evaluate(() => globalThis.__matTest.store.refresh());
      await until(async () => !(await visible(page, "#rateNote")), "nothing shown for an earlier day's rate");
    },
  },
);
