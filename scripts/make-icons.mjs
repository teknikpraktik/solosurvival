// Genererar PWA-ikoner (PNG) utan beroenden: mörk bakgrund, röd ring och punkt. Kör: node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, { maskable }) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  const scale = maskable ? 0.62 : 0.8; // maskable: innehåll i säkra zonen
  const rOuter = (size / 2) * scale, rInner = rOuter * 0.78, rDot = rOuter * 0.32;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      let col = [11, 15, 20]; // bakgrund
      if (d <= rOuter && d >= rInner) col = [239, 68, 68];
      else if (d <= rDot) col = [239, 68, 68];
      else if (d < rInner && d > rDot) col = [19, 26, 34];
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, { maskable: false }));
writeFileSync("public/icons/icon-512.png", png(512, { maskable: false }));
writeFileSync("public/icons/icon-maskable-512.png", png(512, { maskable: true }));
writeFileSync("public/icons/apple-touch-icon.png", png(180, { maskable: false }));
console.log("ikoner skrivna");
