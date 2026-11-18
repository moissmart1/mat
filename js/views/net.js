/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// The "no signal" strip (#net), across the top of the phone, above the
// sentence. It shows while the phone has no signal ("No signal." alone when
// this phone has never loaded anything), or while a line or a stamp
// is held on the phone for the next contact, and says how many lines are
// still to send. It also warns if the queue could not be saved. While it
// shows, the screens move down by its height (the
// --net-h property on the phone), so it never covers the sentence, and it
// sits below every sheet and the bottom bar.
//
// mountNet(root, store) adds #net to root (the phone).

const SHOWING_LAST = "No signal. Showing what this phone last saw.";
const NOTHING_YET = "No signal.";
const KEEP_OPEN = "Couldn’t save unsent changes on this device. Keep the app open to avoid losing them.";

export function mountNet(root, store) {
  const strip = document.createElement("div");
  strip.className = "net";
  strip.id = "net";
  strip.setAttribute("role", "status");
  strip.hidden = true;
  const words = document.createElement("span");
  const count = document.createElement("b");
  count.id = "netN";
  strip.append(words, count);
  root.prepend(strip);

  // How far the screens move down: the strip's height while it shows.
  function place() {
    root.style.setProperty("--net-h", strip.hidden ? "0px" : strip.offsetHeight + "px");
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(place).observe(strip);

  function render(s) {
    const { unsent, waiting } = store.outbox();
    const message = s.queueStorageFailed ? KEEP_OPEN : s.online ? "" : s.loadedAt === null ? NOTHING_YET : SHOWING_LAST;
    const show = !!message || waiting > 0;
    words.textContent = message;
    count.textContent = unsent > 0 ? (message ? " " : "") + unsent + " to send." : "";
    if (strip.hidden === show) {
      strip.hidden = !show;
      root.classList.toggle("net-on", show);
    }
    place();
  }

  render(store.state);
  store.subscribe(render);
}
