import type { LatLon } from "./geometry";

/**
 * Minimal Mapbox Vector Tile (MVT) decoder: reads the polygons of chosen layers from one tile, as lat/lon rings.
 * Only what the game needs (buildings and water from the background map's tiles, see geo/blockers.ts): no properties, no lines or points.
 * Format: protobuf; Tile.layers (3) → Layer.name (1), features (2), extent (5) → Feature.type (3, 3 = polygon), geometry (4, packed commands).
 */

export interface TilePolygons {
  /** Polygons per layer name; each polygon is its rings (the first is the outer ring, the rest holes), as lat/lon. */
  layers: Map<string, LatLon[][][]>;
}

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}
  get done() { return this.pos >= this.buf.length; }
  varint(): number {
    let r = 0, s = 0, b: number;
    do {
      b = this.buf[this.pos++];
      if (s < 28) r |= (b & 0x7f) << s;
      else r += (b & 0x7f) * 2 ** s;
      s += 7;
    } while (b & 0x80);
    return r;
  }
  bytes(): Uint8Array { const n = this.varint(); const out = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return out; }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) { const n = this.varint(); this.pos += n; } // not `pos += varint()`: that adds to the position before the length was read
    else if (wire === 5) this.pos += 4;
    else throw new Error(`mvt: unsupported wire type ${wire}`);
  }
}

const utf8 = new TextDecoder();
const zigzag = (n: number) => (n >>> 1) ^ -(n & 1);

/** Polygons of `want` layers in tile z/x/y. `pbf` is the decompressed tile. */
export function decodePolygons(pbf: Uint8Array, z: number, x: number, y: number, want: ReadonlySet<string>): TilePolygons {
  const layers = new Map<string, LatLon[][][]>();
  const tile = new Reader(pbf);
  while (!tile.done) {
    const key = tile.varint();
    if (key >> 3 !== 3 || (key & 7) !== 2) { tile.skip(key & 7); continue; }
    const layer = new Reader(tile.bytes());
    let name = "", extent = 4096;
    const feats: Uint8Array[] = [];
    while (!layer.done) {
      const k = layer.varint();
      const f = k >> 3, w = k & 7;
      if (f === 1 && w === 2) name = utf8.decode(layer.bytes());
      else if (f === 2 && w === 2) feats.push(layer.bytes());
      else if (f === 5 && w === 0) extent = layer.varint();
      else layer.skip(w);
    }
    if (!want.has(name)) continue;
    const out = layers.get(name) ?? [];
    layers.set(name, out);
    const n = 2 ** z;
    const toLatLon = (px: number, py: number): LatLon => {
      const lon = ((x + px / extent) / n) * 360 - 180;
      const t = Math.PI * (1 - (2 * (y + py / extent)) / n);
      return { lat: (Math.atan(Math.sinh(t)) * 180) / Math.PI, lon };
    };
    for (const fb of feats) {
      const fr = new Reader(fb);
      let type = 0, geom: Uint8Array | null = null;
      while (!fr.done) {
        const k = fr.varint();
        const f = k >> 3, w = k & 7;
        if (f === 3 && w === 0) type = fr.varint();
        else if (f === 4 && w === 2) geom = fr.bytes();
        else fr.skip(w);
      }
      if (type !== 3 || !geom) continue;
      out.push(...polygonsOf(geom, toLatLon));
    }
  }
  return { layers };
}

/** Geometry commands → polygons (an outer ring with positive area starts a new polygon; negative-area rings are its holes). */
function polygonsOf(geom: Uint8Array, toLatLon: (x: number, y: number) => LatLon): LatLon[][][] {
  const r = new Reader(geom);
  const rings: { pts: [number, number][]; area: number }[] = [];
  let cx = 0, cy = 0;
  let ring: [number, number][] = [];
  while (!r.done) {
    const ci = r.varint();
    const cmd = ci & 7, count = ci >> 3;
    if (cmd === 1 || cmd === 2) {
      for (let i = 0; i < count; i++) {
        cx += zigzag(r.varint()); cy += zigzag(r.varint());
        if (cmd === 1) { if (ring.length) rings.push({ pts: ring, area: 0 }); ring = []; }
        ring.push([cx, cy]);
      }
    } else if (cmd === 7) {
      if (ring.length > 2) rings.push({ pts: ring, area: 0 });
      ring = [];
    }
  }
  if (ring.length > 2) rings.push({ pts: ring, area: 0 });
  const polys: LatLon[][][] = [];
  for (const rg of rings) {
    let a = 0;
    for (let i = 0, j = rg.pts.length - 1; i < rg.pts.length; j = i++) a += (rg.pts[j][0] - rg.pts[i][0]) * (rg.pts[j][1] + rg.pts[i][1]);
    rg.area = a;
    const ll = rg.pts.map(([px, py]) => toLatLon(px, py));
    // In MVT (y down) an outer ring is clockwise, i.e. positive area by this formula; holes are negative.
    if (a > 0 || !polys.length) polys.push([ll]);
    else polys[polys.length - 1].push(ll);
  }
  return polys;
}
