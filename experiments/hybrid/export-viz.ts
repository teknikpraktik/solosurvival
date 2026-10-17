// npx tsx experiments/hybrid/export-viz.ts  – förbakar data för /dev/hybrid till public/dev-hybrid/ (gitignorerat; genereras från fixturerna).
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { AREAS } from "./areas";
import { areaCtx, hybridFor } from "./lib/experiment";
import { VIEW_MODELS } from "./lib/view-models";
import { C } from "./lib/raster";
import { fromLocal } from "@/geo/geometry";

const OUT = "public/dev-hybrid";
mkdirSync(OUT, { recursive: true });

function crc32(buf: Buffer): number {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const COLOR: Record<number, [number, number, number, number]> = {
  [C.FOREST]: [34, 110, 60, 120], [C.OPEN]: [140, 170, 70, 110], [C.WATER]: [40, 110, 220, 170], [C.WETLAND]: [40, 170, 170, 150],
  [C.BUILDING]: [180, 110, 60, 190], [C.BARRIER]: [230, 60, 160, 200], [C.URBAN]: [150, 120, 160, 110], [C.ROUGH]: [150, 150, 150, 150],
};

const index: unknown[] = [];
for (const a of AREAS) {
  for (const act of ["run", "mtb"] as const) {
    const c = areaCtx(a.id, act);
    writeFileSync(`${OUT}/${a.id}.${act}.trail.json`, JSON.stringify(c.ag.trail));
    for (const m of VIEW_MODELS) {
      if (!m.hybrid) continue;
      const h = hybridFor(c, m.hybrid);
      writeFileSync(`${OUT}/${a.id}.${act}.${m.id}.json`, JSON.stringify(h.graph));
    }
  }
  const r = areaCtx(a.id, "run").raster;
  const rgba = new Uint8Array(r.w * r.h * 4);
  for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
    const col = COLOR[r.data[j * r.w + i]];
    if (!col) continue;
    const o = ((r.h - 1 - j) * r.w + i) * 4;
    rgba.set(col, o);
  }
  writeFileSync(`${OUT}/${a.id}.terrain.png`, png(r.w, r.h, rgba));
  const fx = areaCtx(a.id, "run").ag.fx;
  const tl = fromLocal(fx.origin, { x: 0, y: r.h * r.cell }), br = fromLocal(fx.origin, { x: r.w * r.cell, y: 0 });
  index.push({ id: a.id, name: a.name, bbox: a.bbox, imageCoords: [[tl.lon, tl.lat], [br.lon, tl.lat], [br.lon, br.lat], [tl.lon, br.lat]] });
}
writeFileSync(`${OUT}/index.json`, JSON.stringify({ areas: index, models: VIEW_MODELS.map((m) => ({ id: m.id, hybrid: m.hybrid })) }));
console.log("klart:", OUT);
