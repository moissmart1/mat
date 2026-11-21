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
// mountNet(root, store, { ready }) adds #net to root (the phone).
// ready (issue 84, js/views/ready.js): { model(), subscribe(fn), seen(),
// onFetch(), onOpen(button) }. Without it the strip is exactly as before.
// With it:
// - no signal and this phone ready (kind ready-off): the board's green line
//   (is-led), "圏外 No signal · everything is on this phone", on every screen;
// - no signal with pictures missing (wait): the red ring, "No signal. 3
//   ticket pictures are not on this phone.";
// - signal, pictures missing (missing, failed, fetching), from two days
//   before to the end of the trip, while the line on Days is out of sight or
//   another screen shows: the amber line (is-led is-amber), its words a
//   button that opens the sheet, its key beside it.
// The unsent count and the queue warning are added as before.

const SHOWING_LAST = "No signal. Showing what this phone last saw.";
const NOTHING_YET = "No signal.";
export const KEEP_OPEN = "Couldn’t save unsent changes on this device. Keep the app open to avoid losing them.";

export function mountNet(root, store, { ready = null } = {}) {
  const strip = document.createElement("div");
  strip.className = "net";
  strip.id = "net";
  strip.setAttribute("role", "status");
  strip.hidden = true;
  const words = document.createElement("span");
  // The amber line's words (a button: it opens "This phone") and its key.
  const go = document.createElement("button");
  go.type = "button";
  go.className = "net-w";
  go.id = "netWords";
  go.hidden = true;
  const goT = document.createElement("span");
  go.append(goT);
  const count = document.createElement("b");
  count.id = "netN";
  const key = document.createElement("button");
  key.type = "button";
  key.className = "net-key";
  key.id = "netKey";
  key.hidden = true;
  const keyJp = document.createElement("i");
  keyJp.textContent = "取込";
  keyJp.setAttribute("aria-hidden", "true");
  const keyT = document.createElement("span");
  key.append(keyJp, keyT);
  strip.append(words, go, count, key);
  root.prepend(strip);
  if (ready) {
    go.addEventListener("click", () => ready.onOpen(go));
    key.addEventListener("click", () => ready.onFetch());
  }

  // How far the screens move down: the strip's height while it shows.
  function place() {
    root.style.setProperty("--net-h", strip.hidden ? "0px" : strip.offsetHeight + "px");
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(place).observe(strip);

  const put = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };
  // The words, with a Japanese mark before them (圏外) hidden from a screen reader.
  function setWords(text, jp) {
    const sig = jp + "|" + text;
    if (words.dataset.sig === sig) return;
    words.dataset.sig = sig;
    if (!jp) {
      words.textContent = text;
      return;
    }
    const i = document.createElement("i");
    i.textContent = jp;
    i.setAttribute("aria-hidden", "true");
    words.replaceChildren(i, document.createTextNode(text));
  }

  function render(s) {
    const { unsent, waiting } = store.outbox();
    const m = ready ? ready.model() : null;
    const offline = s.online === false;
    let look = "";
    let message = s.online ? "" : s.loadedAt === null ? NOTHING_YET : SHOWING_LAST;
    let jp = "";
    if (m && m.strip && offline && m.kind === "ready-off") {
      look = "green";
      message = m.strip.text;
      jp = m.strip.jp;
    } else if (m && m.strip && offline && m.kind === "wait") {
      message = m.strip.text;
    } else if (m && m.strip && !offline && m.strip.tone === "amber" && !ready.seen()) {
      look = "amber";
    }
    if (s.queueStorageFailed) message = s.online ? KEEP_OPEN : (look === "green" ? message : NOTHING_YET) + " " + KEEP_OPEN;
    const amber = look === "amber";
    // The amber line's words are its button; the plain words then say only the queue's warning, if any.
    setWords(amber ? (s.queueStorageFailed ? KEEP_OPEN : "") : message, amber ? "" : jp);
    go.hidden = !amber;
    key.hidden = !amber || !m.strip.key;
    if (amber) {
      put(goT, m.strip.text + (m.strip.right ? " · " + m.strip.right : ""));
      go.setAttribute("aria-label", m.aria);
      put(keyT, m.strip.key);
      if (m.strip.key) key.setAttribute("aria-label", m.keyAria);
    }
    strip.classList.toggle("is-led", look !== "");
    strip.classList.toggle("is-amber", amber);
    strip.classList.toggle("is-fetching", amber && m.kind === "fetching");
    const show = !!message || waiting > 0 || amber;
    count.textContent = unsent > 0 ? (message || amber ? " " : "") + unsent + " to send." : "";
    if (strip.hidden === show) {
      strip.hidden = !show;
      root.classList.toggle("net-on", show);
    }
    place();
  }

  render(store.state);
  store.subscribe(render);
  if (ready) ready.subscribe(() => render(store.state));
}
