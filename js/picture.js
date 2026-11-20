/* Copyright (c) 2026 moissmart1. All rights reserved. No licence is granted: do not copy, adapt or reuse this code or design, and do not use it to train or prompt an AI system to reproduce it. See LICENSE. */
// A person's picture (Task 16): shrunk on the phone before it is sent, and
// drawn in place of the initials inside their round seal.
//
// shrinkPicture(file, { decode, makeCanvas }) -> data address or null
//   The centred square of the picture, drawn the right way up at 128 x 128
//   and exported as a JPEG of at most PICTURE_MAX characters (fitJpeg).
//   null when the file is not a picture, will not decode, or will not fit.
// choosePicture(file, { shrink, save, notify }) -> true when saved
//   Shrinks, then hands the address to save; a picture that cannot be used
//   gets PICTURE_BAD through notify and nothing is sent.
// fillSeal(node, person, name, { named, singleLetter }) -> node
//   Puts the person's picture into a seal (an <img>, its address set as a
//   property, alt="") or, with none, their initials. named: the seal is on
//   its own (not inside a labelled button) and says whose it is. Ticket
//   selectors use singleLetter to keep their one-letter fallback.
// isPicture(v): the same check the backend makes (validatePersonPatch):
//   a JPEG data address of at most PICTURE_MAX characters whose base64 part
//   is whole 4-character groups.

export const PICTURE_MAX = 12000;
export const PICTURE_SIDE = 128;
export const PICTURE_BAD = "That picture couldn’t be used. Try another.";
const QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4];
const JPEG_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

const JPEG_HEAD = "data:image/jpeg;base64,";

export const isPicture = (v) => typeof v === "string" && v.length <= PICTURE_MAX && JPEG_RE.test(v) && (v.length - JPEG_HEAD.length) % 4 === 0;

// The first JPEG export, from quality 0.8 down to 0.4, that fits; else null.
export function fitJpeg(canvas) {
  for (const q of QUALITIES) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (isPicture(url)) return url;
  }
  return null;
}

// An <img> for the file. The browser draws it the right way up: the photo's
// own orientation is honoured by default (image-orientation: from-image),
// on the page and when drawn onto a canvas.
function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ image: img, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("not a picture"));
    };
    img.src = url;
  });
}

const newCanvas = () => document.createElement("canvas");

export async function shrinkPicture(file, { decode = decodeImage, makeCanvas = newCanvas } = {}) {
  // A file that says what it is must say it is a picture; one that says
  // nothing (some phones) is tried.
  if (!file || (typeof file.type === "string" && file.type !== "" && !file.type.startsWith("image/"))) return null;
  let got;
  try {
    got = await decode(file);
  } catch {
    return null;
  }
  const w = got && got.width;
  const h = got && got.height;
  if (!(w > 0 && h > 0)) return null;
  const side = Math.min(w, h);
  // Drawing and exporting can throw (out of memory on a huge photo, a codec
  // the browser half knows): that is a picture that cannot be used too.
  try {
    const canvas = makeCanvas();
    canvas.width = PICTURE_SIDE;
    canvas.height = PICTURE_SIDE;
    const g = canvas.getContext("2d");
    if (!g) return null;
    // A see-through picture lands on white, not on JPEG's black.
    g.fillStyle = "#fff";
    g.fillRect(0, 0, PICTURE_SIDE, PICTURE_SIDE);
    g.drawImage(got.image || got, (w - side) / 2, (h - side) / 2, side, side, 0, 0, PICTURE_SIDE, PICTURE_SIDE);
    return fitJpeg(canvas);
  } catch {
    return null;
  }
}

export async function choosePicture(file, { shrink = shrinkPicture, save, notify }) {
  const url = await shrink(file);
  if (!url) {
    notify(PICTURE_BAD);
    return false;
  }
  return !!(await save(url));
}

const initialsOf = (person, name) => (person && person.initials) || String((person && person.name) || name || "").slice(0, 2).toUpperCase();

export function fillSeal(node, person, name, { named = false, singleLetter = false } = {}) {
  const pic = person && isPicture(person.photo) ? person.photo : "";
  const letters = singleLetter ? ([...String(name || person?.name || "")][0] || "").toUpperCase() : initialsOf(person, name);
  node.classList.toggle("has-pic", !!pic);
  if (!pic) {
    node.textContent = letters;
    if (named) {
      node.removeAttribute("role");
      node.removeAttribute("aria-label");
    }
    return node;
  }
  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;
  // A picture that will not draw falls back to the initials.
  img.addEventListener("error", () => {
    node.classList.remove("has-pic");
    node.textContent = letters;
  });
  img.src = pic;
  node.replaceChildren(img);
  if (named) {
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", (person && person.name) || String(name || ""));
  }
  return node;
}
