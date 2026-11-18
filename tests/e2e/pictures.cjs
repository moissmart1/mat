// Made-up pictures for the ticket tests: a PNG drawn here (a pattern that
// looks like a code and scans as nothing) and a small PDF of plain pages.
// Nothing real: no ticket, code or booking is ever in the repo.

const zlib = require("zlib");

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// A w x h PNG (RGB): black squares on white in a pattern from `seed`, with
// three corner boxes like a QR code's. noise: add grey speckle so it does
// not compress (to make a big file).
function pngBytes(w, h, seed = 1, { noise = false } = {}) {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const N = 25;
  const cell = Math.max(1, Math.floor(Math.min(w, h) / (N + 4)));
  const grid = [];
  for (let i = 0; i < N * N; i++) grid.push(rnd() < 0.5);
  const box = (ox, oy) => {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      grid[(oy + y) * N + ox + x] = d === 3 || d <= 1;
    }
  };
  box(0, 0); box(N - 7, 0); box(0, N - 7);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const ox = Math.floor((w - N * cell) / 2), oy = Math.floor((h - N * cell) / 2);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const gx = Math.floor((x - ox) / cell), gy = Math.floor((y - oy) / cell);
      const on = gx >= 0 && gy >= 0 && gx < N && gy < N && grid[gy * N + gx];
      let v = on ? 0 : 255;
      if (noise && !on) v = 160 + Math.floor(rnd() * 95);
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = raw[i + 1] = raw[i + 2] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const png = (w, h, seed, opts) => pngBytes(w, h, seed, opts).toString("base64");

// A PDF of `pages` plain pages, each with a heading, a box and a few lines.
function pdfBytes(pages = 2) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  const pagesId = pages + 3 + pages; // reserved below
  const pageIds = [];
  for (let i = 1; i <= pages; i++) {
    const text = `BT /F1 22 Tf 40 380 Td (Made-up e-ticket, page ${i}) Tj ET BT /F1 12 Tf 40 350 Td (Nothing here is real.) Tj ET 0 0 0 rg 90 90 120 120 re f 1 1 1 rg 110 110 30 30 re f`;
    const content = add(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
    pageIds.push({ content });
  }
  const pagesObj = objs.length + pages + 1;
  for (const p of pageIds) kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 300 424] /Contents ${p.content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  const pagesNum = add(`<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${pages} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>`);
  void pagesId;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>');

module.exports = { png, pngBytes, pdfBytes, SVG };
