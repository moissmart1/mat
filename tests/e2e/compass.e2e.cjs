// Back to the hotel (#compass): opened from You → Extras and from the hotel
// card, pinning the hotel on this phone, a Maps link with coordinates, and
// the distance and direction once the phone knows where it is. The plan is
// tests/fixtures/plan.json over the seed; the clock is 13:20 on Dec 12 in
// Japan, a night at the Asakusa hotel (planstay0001).

const assert = require("node:assert/strict");
const { WITH_PLAN, open, until, text, expectText, visible } = require("./helpers.cjs");

const SENSOJI = { latitude: 35.7148, longitude: 139.7967 };
const SKYTREE = { latitude: 35.7101, longitude: 139.8107 };

const isOpen = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  return !!el && el.classList.contains("is-open");
}, id);

async function openFromYou(page) {
  await page.click("#youBtn");
  await until(() => isOpen(page, "you"), "settings open");
  await page.click("#setCompass");
  await until(() => isOpen(page, "compass"), "the compass opens");
  assert.equal(await isOpen(page, "you"), false, "settings closed under it");
}

const withMapLink = () => {
  const seed = JSON.parse(JSON.stringify(WITH_PLAN));
  seed.stays.find((s) => s.id === "planstay0001").place = "https://www.google.com/maps/place/x/@35.71,139.79,17z/data=!3d35.7148!4d139.7967";
  return seed;
};

module.exports = [
  {
    name: "Extras in You opens the compass on tonight's hotel; a pin on this phone makes it point",
    async run({ page, context }) {
      const backend = await open(page, { seed: WITH_PLAN, tab: "days" });
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
      await openFromYou(page);

      await expectText(page, "#cpName", "浅草ホテル");
      await expectText(page, "#cpEn", "Asakusa hotel");
      // Two stays: both can be picked, tonight's is the one pressed.
      const picks = await page.evaluate(() => [...document.querySelectorAll("#cpPick button")].map((b) => [b.textContent, b.getAttribute("aria-pressed")]));
      assert.deepEqual(picks, [["Asakusa hotel", "true"], ["Niseko lodge", "false"]]);
      // The plan's place is a name: nowhere to point yet, and nothing was asked of the phone.
      await expectText(page, "#cpMsg", /doesn’t know where the hotel is yet/);
      assert.equal(await visible(page, "#cpGo"), false, "no Start with nowhere to point");
      await expectText(page, "#cpPin", "Pin it here");
      await expectText(page, "#cpFar", "– – –");

      // Standing at the hotel: Pin it here.
      await context.grantPermissions(["geolocation"]);
      await context.setGeolocation({ ...SENSOJI, accuracy: 12 });
      await page.click("#cpPin");
      await until(() => page.evaluate(() => localStorage.getItem("mat.pin.planstay0001")), "the pin is kept on this phone");
      await expectText(page, "#cpPin", "Move pin here");
      assert.ok(await visible(page, "#cpUnpin"));
      await expectText(page, "#cpWay", "You’re there.");
      assert.equal(backend.requests.filter((r) => /stay/i.test(r.action || "")).length, 0, "a pin never goes to the backend");

      // Walk away to the Skytree: the display says how far and which way.
      await context.setGeolocation({ ...SKYTREE, accuracy: 15 });
      await expectText(page, "#cpFar", "1.4 km", 8000);
      await expectText(page, "#cpWay", /^西 · West, about \d+ min on foot\.$/);
      assert.ok(await page.evaluate(() => document.getElementById("compass").classList.contains("is-live")));
      // A walking route to the pin, and the plan's own map link.
      const links = await page.evaluate(() => [...document.querySelectorAll("#cpLinks a")].map((a) => [a.textContent, a.getAttribute("href")]));
      assert.equal(links[0][0], "歩く Walk there ↗");
      assert.match(links[0][1], /travelmode=walking&destination=35\.714800,139\.796700$/);
      assert.equal(links[1][0], "地図 Map ↗");

      // The Niseko lodge has no pin of its own.
      await page.click('#cpPick button[data-stay="planstay0002"]');
      await expectText(page, "#cpName", "Niseko lodge");
      await expectText(page, "#cpPin", "Pin it here");

      // Done closes it and gives focus back to You.
      await page.click("#cpDone");
      await until(async () => !(await isOpen(page, "compass")), "the compass closes");
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "youBtn");
      await page.screenshot({ path: "/tmp/mat-compass-closed.png" }).catch(() => {});
    },
  },
  {
    name: "a Maps link with coordinates needs no pin; the hotel card's 方位 Compass opens it",
    async run({ page, context }) {
      await open(page, { seed: withMapLink(), tab: "days" });
      await until(() => page.evaluate(() => document.querySelectorAll("#rail .pg .tk").length === 11), "the tickets draw");
      await page.click('#rail .pg[data-date="2026-12-12"] .tk-stay');
      await until(() => isOpen(page, "stay"), "the hotel card opens");
      await expectText(page, "#stay button[data-compass]", "方位 Compass");
      await page.click("#stay button[data-compass]");
      await until(() => isOpen(page, "compass"), "the compass opens");
      assert.equal(await isOpen(page, "stay"), false, "the hotel card closed under it");
      await expectText(page, "#cpWay", "From the plan’s map link");
      await expectText(page, "#cpMsg", /Tap Start/);
      assert.ok(await visible(page, "#cpGo"));

      await context.grantPermissions(["geolocation"]);
      await context.setGeolocation({ ...SKYTREE, accuracy: 20 });
      // As a phone that allows the compass when asked (this Chrome would refuse).
      await page.evaluate(() => {
        if (globalThis.DeviceOrientationEvent) DeviceOrientationEvent.requestPermission = () => Promise.resolve("granted");
      });
      await page.click("#cpGo");
      await expectText(page, "#cpFar", "1.4 km", 8000);
      assert.equal(await visible(page, "#cpGo"), false, "Start is gone once started");
      // A laptop has no compass: after a moment the dial says north is at the top.
      await page.clock.fastForward(3000);
      await expectText(page, "#cpMsg", /No compass on this phone/);
      // A compass reading (Android: absolute alpha) turns the dial and says to hold it flat.
      await page.evaluate(() => {
        const ev = new Event("deviceorientationabsolute");
        Object.assign(ev, { absolute: true, alpha: 90, beta: 0, gamma: 0 });
        window.dispatchEvent(ev);
      });
      await expectText(page, "#cpMsg", /Hold the phone flat/);
      for (let i = 0; i < 40; i++) await page.clock.runFor(16);
      const face = await page.evaluate(() => document.getElementById("cpFace").style.transform);
      assert.match(face, /rotate\(-?\d/, "the face has turned: " + face);
      await page.screenshot({ path: "/tmp/mat-compass-live.png" }).catch(() => {});
    },
  },
];
