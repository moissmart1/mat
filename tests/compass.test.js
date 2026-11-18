// The arithmetic behind Back to the hotel (js/compass.js).

import test from "node:test";
import assert from "node:assert/strict";

import { spotFromPlace, stayTarget, distanceM, bearing, headingOf, turn, pointOf, distanceText, wayText, norm, isSpot } from "../js/compass.js";

const SENSOJI = { lat: 35.7148, lng: 139.7967 };
const SKYTREE = { lat: 35.7101, lng: 139.8107 };
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, what + ": " + a + " not within " + tol + " of " + b);

test("coordinates come out of the ways a Maps link carries them", () => {
  assert.deepEqual(spotFromPlace("https://www.google.com/maps/place/Senso-ji/@35.7147,139.7966,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d35.7148!4d139.7967"), SENSOJI, "the pin beats the view");
  assert.deepEqual(spotFromPlace("https://www.google.com/maps/@35.7148,139.7967,15z"), SENSOJI);
  assert.deepEqual(spotFromPlace("https://www.google.com/maps/search/?api=1&query=35.7148,139.7967"), SENSOJI);
  assert.deepEqual(spotFromPlace("https://maps.google.com/?q=35.7148%2C139.7967"), SENSOJI);
  assert.deepEqual(spotFromPlace("https://www.google.com/maps/dir/?api=1&destination=35.7148,139.7967"), SENSOJI);
  assert.deepEqual(spotFromPlace("https://maps.apple.com/?ll=35.7148,139.7967&q=Hotel"), SENSOJI);
  assert.deepEqual(spotFromPlace(" 35.7148, 139.7967 "), SENSOJI);
  assert.deepEqual(spotFromPlace("-33.8568,151.2153"), { lat: -33.8568, lng: 151.2153 });
});

test("a place without coordinates, or with impossible ones, has no spot", () => {
  for (const p of ["", null, undefined, 42, "Asakusa hotel Tokyo", "https://maps.app.goo.gl/AbCdEf123", "https://www.google.com/maps/@0,0,3z", "95.1, 10.2", "35.1, 190.2", "Room 35, 139"]) {
    assert.equal(spotFromPlace(p), null, String(p));
  }
});

test("a pin on this phone beats the plan's place", () => {
  const stay = { id: "s1", place: "https://www.google.com/maps/@35.7148,139.7967,15z" };
  assert.deepEqual(stayTarget(stay, null), { ...SENSOJI, from: "place" });
  assert.deepEqual(stayTarget(stay, { lat: 35.7, lng: 139.8 }), { lat: 35.7, lng: 139.8, from: "pin" });
  assert.equal(stayTarget({ id: "s2", place: "Niseko lodge" }, null), null);
  assert.equal(stayTarget({ id: "s2" }, { lat: "35", lng: "139" }), null, "a pin of strings is no pin");
  assert.equal(isSpot({ lat: NaN, lng: 1 }), false);
});

test("distance and bearing between two real places", () => {
  near(distanceM(SENSOJI, SKYTREE), 1360, 30, "Senso-ji to the Skytree");
  near(bearing(SENSOJI, SKYTREE), 112, 3, "the Skytree lies east-southeast of Senso-ji");
  near(bearing(SKYTREE, SENSOJI), 292, 3, "and back the other way");
  near(bearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }), 0, 0.001, "due north");
  near(bearing({ lat: 0, lng: 0 }, { lat: 0, lng: -1 }), 270, 0.001, "due west");
  assert.equal(distanceM(SENSOJI, SENSOJI), 0);
});

test("the phone's heading, iPhone and Android, upright and sideways", () => {
  assert.equal(headingOf({ webkitCompassHeading: 30 }), 30);
  assert.equal(headingOf({ webkitCompassHeading: 350 }, 90), 80, "sideways adds the screen's turn");
  assert.equal(headingOf({ webkitCompassHeading: -1 }), null, "an iPhone not calibrated yet");
  assert.equal(headingOf({ absolute: true, alpha: 90 }), 270, "Android's alpha turns the other way");
  assert.equal(headingOf({ absolute: true, alpha: 0 }, 270), 270);
  assert.equal(headingOf({ absolute: false, alpha: 90 }), null, "a relative alpha is no compass");
  assert.equal(headingOf({ alpha: null, absolute: true }), null);
  assert.equal(headingOf(null), null);
});

test("turns take the short way round", () => {
  assert.equal(turn(350, 10), 20);
  assert.equal(turn(10, 350), -20);
  assert.equal(turn(0, 180), 180);
  assert.equal(norm(-90), 270);
  assert.equal(norm(720), 0);
});

test("directions and distances in words", () => {
  assert.deepEqual(pointOf(0), { jp: "北", en: "north" });
  assert.deepEqual(pointOf(112), { jp: "東", en: "east" }, "just short of southeast");
  assert.deepEqual(pointOf(125), { jp: "南東", en: "southeast" });
  assert.deepEqual(pointOf(359), { jp: "北", en: "north" });
  assert.deepEqual(pointOf(-45), { jp: "北西", en: "northwest" });
  assert.equal(distanceText(3), "10 m");
  assert.equal(distanceText(347), "350 m");
  assert.equal(distanceText(1360), "1.4 km");
  assert.equal(distanceText(9990), "10 km");
  assert.equal(distanceText(23456), "23 km");
  assert.equal(distanceText(NaN), "");
});

test("the line under the distance", () => {
  assert.equal(wayText(25, 90), "You’re there.");
  assert.equal(wayText(120, 90, 300), "Close. The phone can only tell to about 300 m.");
  assert.equal(wayText(1360, 125, 15), "Southeast, about 22 min on foot.");
  assert.equal(wayText(80, 0, null), "North, about 1 min on foot.");
  assert.equal(wayText(40000, 270), "West, in a straight line. Take a train or a taxi.");
});
