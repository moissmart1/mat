/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The driver's screen (#driver): the little card a ryokan gives you for
// taxis, full screen. Paper-white, Japanese only, the name and the address as
// large as fits the width (fitted, never cut; a long address wraps between
// words) and ここまでお願いします。. No telephone: the Sheet has none. Lifted
// out of the hotel card (js/views/staycard.js) so a stop can use it too
// (#95: 行先 on the ticket), mounted once by the app.
//
// mountDriver(root) -> { open(what, opener), update(what), close(restoreFocus), isOpen(), onChange(fn) }
// - root is the phone. what = { mark, title, nameJp, addressJp }: mark is the
//   Japanese word in the dark bar (宿泊 for a stay, 行先 for a stop), title the
//   line beside it for the person holding the phone. open() does nothing
//   (false) without a Japanese name or address.
// - opener: what gets focus back when the screen closes (an element, or a
//   function giving one, for a key a redraw may have replaced).
// - update(what): redraws when its words changed; closes when what has
//   neither a Japanese name nor an address.
// - close(restoreFocus): back to the opener (restoreFocus true, the default).
//   Every close also empties the screen, so nothing of a trip taken off the
//   phone stays drawn in it.
// - onChange(fn): fn(open) after it opens and after it closes (before focus
//   goes back), so the hotel card can keep its own sheet inert meanwhile.
// Done, Escape (first, before anything under it) and the scrim close it;
// driver-open is on the phone while it is up, so the self-updater waits. The
// screen is kept awake while it is up where the phone allows (Wake Lock); a
// refusal is silent, and only a screen really kept awake says so. On a
// computer it stands in the Days pane (css/days.css). Text from the Sheet
// goes in with textContent only.

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const str = (v) => (typeof v === "string" ? v.trim() : "");

// A house number is one word: 9-9-9 (or ９−９−９, or 1ー2) never breaks at its
// hyphens. Splits text into runs; each such number is nb: true.
const NUMBER_RUN = /[0-9０-９]+(?:[-‐−–ー－][0-9０-９]+)+/g;
export function noBreakRuns(text) {
  const s = typeof text === "string" ? text : "";
  const out = [];
  let at = 0;
  for (const m of s.matchAll(NUMBER_RUN)) {
    if (m.index > at) out.push({ text: s.slice(at, m.index), nb: false });
    out.push({ text: m[0], nb: true });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at), nb: false });
  return out;
}

// Fills node with text, each house number in a <span class="nb">.
export function putNoBreaks(node, text) {
  node.replaceChildren(...noBreakRuns(text).map((r) => (r.nb ? el("span", "nb", r.text) : document.createTextNode(r.text))));
  return node;
}

// The screen's contents: the top bar (for the person holding the phone),
// then the Japanese for the driver.
function driverCard(what) {
  const top = el("div", "dc-top");
  const label = el("div");
  label.append(el("i", "", str(what.mark)), el("span", "", str(what.title)));
  const done = el("button", "", "Done");
  done.type = "button";
  done.id = "driverDone";
  top.append(label, done);
  const mid = el("div", "dc-mid");
  mid.append(el("div", "dc-to", "運転手さんへ"));
  const jp = str(what.nameJp);
  if (jp) mid.append(putNoBreaks(el("div", "dc-name"), jp));
  const address = str(what.addressJp);
  if (address) mid.append(putNoBreaks(el("div", "dc-ad"), address));
  const ask = el("div", "dc-ask");
  ask.append("ここまで", el("br"), "お願いします。");
  mid.append(ask);
  const bot = el("div", "dc-bot", "Hold the phone up to the driver.");
  return { nodes: [top, mid, bot], done, bot };
}

// The big lines as large as fits: from the drawn size down, one pixel at a
// time, until no word runs past the line (they wrap only between words, and
// never inside a house number). A word too long even at the smallest size may
// then break anywhere, a house number too.
const FIT = [
  [".dc-name", 46, 18],
  [".dc-ad", 30, 16],
  [".dc-ask", 30, 18],
];
function fitType(box) {
  for (const [sel, max, min] of FIT) {
    const n = box.querySelector(sel);
    if (!n) continue;
    const runs = [...n.querySelectorAll(".nb")];
    n.style.overflowWrap = "";
    for (const r of runs) r.style.whiteSpace = "";
    let size = max;
    n.style.fontSize = size + "px";
    while (size > min && n.scrollWidth > n.clientWidth + 0.5) {
      size -= 1;
      n.style.fontSize = size + "px";
    }
    if (n.scrollWidth > n.clientWidth + 0.5) {
      n.style.overflowWrap = "anywhere";
      for (const r of runs) r.style.whiteSpace = "normal";
    }
  }
}

const hasJapanese = (what) => !!what && (str(what.nameJp) !== "" || str(what.addressJp) !== "");

export function mountDriver(root) {
  const scrim = el("div", "scrim");
  scrim.id = "driverScrim";
  scrim.hidden = true;
  const driver = el("div", "drvcard");
  driver.id = "driver";
  driver.setAttribute("role", "dialog");
  driver.setAttribute("aria-modal", "true");
  driver.setAttribute("aria-label", "Show to driver");
  driver.lang = "ja";
  driver.hidden = true;
  driver.inert = true;
  root.append(scrim, driver);

  let sig = ""; // what the screen was last drawn from
  let opener = null;
  let lock = null; // the wake lock while one is held
  let wantLock = false;
  let foot = null;
  const watchers = [];
  const isOpen = () => driver.classList.contains("is-open");
  const tell = (on) => {
    for (const fn of watchers) fn(on);
  };

  function holdAwake() {
    if (!wantLock || lock || document.visibilityState === "hidden") return;
    let req;
    try {
      req = navigator.wakeLock && typeof navigator.wakeLock.request === "function" ? navigator.wakeLock.request("screen") : null;
    } catch {
      req = null;
    }
    if (!req) return;
    Promise.resolve(req).then((l) => {
      if (!l) return;
      if (!wantLock) {
        Promise.resolve(l.release()).catch(() => {});
        return;
      }
      lock = l;
      if (typeof l.addEventListener === "function") l.addEventListener("release", () => {
        if (lock === l) lock = null;
        sayAwake();
      });
      sayAwake();
    }, () => {});
  }
  function letGo() {
    wantLock = false;
    const l = lock;
    lock = null;
    if (l) {
      try {
        Promise.resolve(l.release()).catch(() => {});
      } catch {
        // already gone
      }
    }
  }
  // The foot says the screen stays on only while it really does.
  function sayAwake() {
    if (!foot) return;
    const words = "Hold the phone up to the driver." + (lock && isOpen() ? " It stays on while this is open." : "");
    if (foot.textContent !== words) foot.textContent = words;
  }
  // Coming back on screen: the phone let go of the lock while hidden.
  document.addEventListener("visibilitychange", holdAwake);

  function draw(what) {
    const next = JSON.stringify([str(what.mark), str(what.title), str(what.nameJp), str(what.addressJp)]);
    if (next === sig) return;
    sig = next;
    const d = driverCard(what);
    foot = d.bot;
    driver.replaceChildren(...d.nodes);
    d.done.addEventListener("click", () => close());
    sayAwake();
    fit();
  }
  function fit() {
    if (!isOpen()) return;
    fitType(driver);
    driver.dataset.fit = "1";
  }
  if (typeof ResizeObserver === "function") {
    let w = 0;
    new ResizeObserver(() => {
      if (driver.clientWidth === w) return;
      w = driver.clientWidth;
      fit();
    }).observe(driver);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit, () => {});

  function open(what, from = null) {
    if (!hasJapanese(what) || isOpen()) return false;
    sig = "";
    opener = from;
    driver.hidden = false;
    driver.inert = false;
    scrim.hidden = false;
    driver.classList.add("is-open");
    root.classList.add("driver-open");
    tell(true);
    draw(what);
    driver.scrollTop = 0;
    wantLock = true;
    holdAwake();
    const d = driver.querySelector("#driverDone");
    if (d) d.focus({ preventScroll: true });
    return true;
  }

  function update(what) {
    if (!isOpen()) return;
    if (hasJapanese(what)) draw(what);
    else close(false);
  }

  function close(restoreFocus = true) {
    if (!isOpen()) return;
    letGo();
    driver.classList.remove("is-open");
    driver.hidden = true;
    driver.inert = true;
    scrim.hidden = true;
    delete driver.dataset.fit;
    root.classList.remove("driver-open");
    if (driver.contains(document.activeElement)) document.activeElement.blur();
    driver.replaceChildren();
    sig = "";
    foot = null;
    const back = opener;
    opener = null;
    tell(false);
    if (restoreFocus !== true) return;
    const key = typeof back === "function" ? back() : back;
    if (key && key.isConnected) key.focus({ preventScroll: true });
  }

  scrim.addEventListener("click", () => close());
  // Escape closes the driver's screen first (what is under it stays).
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !isOpen()) return;
    ev.stopPropagation();
    close();
  }, true);

  function onChange(fn) {
    watchers.push(fn);
    return () => {
      const i = watchers.indexOf(fn);
      if (i !== -1) watchers.splice(i, 1);
    };
  }

  return { open, update, close: (restoreFocus) => close(restoreFocus), isOpen, onChange };
}
