#!/usr/bin/env node
// Minimal dependency-free PNG generator for the placeholder Penta icon.
// Produces a solid Penta-cyan RGBA square. Replace with real art before launch
// (then run `pnpm tauri icon <art.png>` to regenerate the full icon set).
const fs = require("node:fs");
const zlib = require("node:zlib");

const out = process.argv[2] || "icon.png";
const size = parseInt(process.argv[3] || "512", 10);
const channels = 4; // RGBA
const [r, g, b, a] = [56, 189, 248, 255]; // sky-400, Penta accent

const raw = Buffer.alloc((size * channels + 1) * size);
for (let y = 0; y < size; y++) {
  const rowStart = y * (size * channels + 1);
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < size; x++) {
    const p = rowStart + 1 + x * channels;
    raw[p] = r;
    raw[p + 1] = g;
    raw[p + 2] = b;
    raw[p + 3] = a;
  }
}

const crcTable = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
const idat = zlib.deflateSync(raw);
const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.mkdirSync(require("node:path").dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${size}x${size}, ${png.length} bytes)`);
