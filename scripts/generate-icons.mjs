import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

// Rasterize the existing SVG's simple shapes without an image dependency.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

const holes = [
  [76, 67],
  [116, 67],
  [57, 100],
  [96, 100],
  [135, 100],
  [76, 132],
  [116, 132],
];
for (const size of [180, 192, 512]) {
  const pixels = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = [0, 0, 0];
      // Supersampling keeps the edges smooth at home-screen icon sizes.
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const px = ((x + (sx + 0.5) / 4) / size) * 192;
          const py = ((y + (sy + 0.5) / 4) / size) * 192;
          const ball = Math.hypot(px - 96, py - 96) <= 59;
          const hole = holes.some(
            ([hx, hy]) => Math.hypot(px - hx, py - hy) <= 9,
          );
          const sample = ball && !hole ? [217, 237, 134] : [23, 62, 49];
          for (let c = 0; c < 3; c++) color[c] += sample[c] / 16;
        }
      }
      const offset = y * (size * 3 + 1) + 1 + x * 3;
      for (let c = 0; c < 3; c++) pixels[offset + c] = Math.round(color[c]);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  writeFileSync(
    new URL(`../icon-${size}.png`, import.meta.url),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
  console.log(`Generated icon-${size}.png`);
}
