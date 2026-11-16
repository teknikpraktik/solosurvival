/**
 * Mapbox Vector Tile (MVT) decoder for lines and polygons with their properties, in tile units (0…extent). Used to build the trail network
 * from OpenFreeMap's tiles (data/ofm-store.ts). geo/mvt.ts is the smaller decoder for building and water polygons as lat/lon.
 * Format: protobuf. Tile.layers (3) → Layer.name (1), features (2), keys (3), values (4), extent (5); Feature.tags (2), type (3), geometry (4).
 */

export type MvtValue = string | number | boolean;

export interface MvtFeature {
  /** 2 = line, 3 = polygon. */
  type: 2 | 3;
  props: Record<string, MvtValue>;
  /** Lines: each part. Polygons: each ring (outer and holes in the order of the tile). Tile units. */
  parts: [number, number][][];
}

export interface MvtLayer {
  extent: number;
  features: MvtFeature[];
}

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}
  get done() { return this.pos >= this.buf.length; }
  varint(): number {
    let r = 0, s = 0, b: number;
    do { b = this.buf[this.pos++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80);
    return r;
  }
  bytes(): Uint8Array { const n = this.varint(); const out = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return out; }
  fixed(n: 4 | 8): number {
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, n);
    this.pos += n;
    return n === 8 ? v.getFloat64(0, true) : v.getFloat32(0, true);
  }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) { const n = this.varint(); this.pos += n; }
    else if (wire === 5) this.pos += 4;
    else throw new Error(`mvt: unsupported wire type ${wire}`);
  }
}

const utf8 = new TextDecoder();
const zigzag = (n: number) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

function readValue(r: Reader): MvtValue {
  let v: MvtValue = "";
  while (!r.done) {
    const tag = r.varint(), f = tag >> 3;
    if (f === 1) v = utf8.decode(r.bytes());
    else if (f === 2) v = r.fixed(4);
    else if (f === 3) v = r.fixed(8);
    else if (f === 4 || f === 5) v = r.varint();
    else if (f === 6) v = zigzag(r.varint());
    else if (f === 7) v = r.varint() === 1;
    else r.skip(tag & 7);
  }
  return v;
}

function readGeometry(cmds: number[]): [number, number][][] {
  const parts: [number, number][][] = [];
  let x = 0, y = 0, i = 0, cur: [number, number][] | null = null;
  while (i < cmds.length) {
    const cmd = cmds[i] & 7, count = cmds[i] >> 3;
    i++;
    if (cmd === 7) { if (cur && cur.length) cur.push([cur[0][0], cur[0][1]]); continue; } // close the ring
    for (let k = 0; k < count && i + 1 < cmds.length; k++) {
      x += zigzag(cmds[i++]);
      y += zigzag(cmds[i++]);
      if (cmd === 1) { cur = [[x, y]]; parts.push(cur); } else cur?.push([x, y]);
    }
  }
  return parts.filter((p) => p.length >= 2);
}

/** The line and polygon features of the chosen layers. Points and other layers are skipped. */
export function decodeFeatures(pbf: Uint8Array, want: ReadonlySet<string>): Map<string, MvtLayer> {
  const out = new Map<string, MvtLayer>();
  const tile = new Reader(pbf);
  while (!tile.done) {
    const tag = tile.varint();
    if (tag >> 3 !== 3 || (tag & 7) !== 2) { tile.skip(tag & 7); continue; }
    const lr = new Reader(tile.bytes());
    let name = "", extent = 4096;
    const keys: string[] = [], values: MvtValue[] = [], feats: Uint8Array[] = [];
    while (!lr.done) {
      const t = lr.varint(), f = t >> 3;
      if (f === 1) name = utf8.decode(lr.bytes());
      else if (f === 2) feats.push(lr.bytes());
      else if (f === 3) keys.push(utf8.decode(lr.bytes()));
      else if (f === 4) values.push(readValue(new Reader(lr.bytes())));
      else if (f === 5) extent = lr.varint();
      else lr.skip(t & 7);
    }
    if (!want.has(name)) continue;
    const features: MvtFeature[] = [];
    for (const fb of feats) {
      const fr = new Reader(fb);
      let type = 0, tags: number[] = [], geom: number[] = [];
      while (!fr.done) {
        const t = fr.varint(), f = t >> 3;
        if (f === 2) { const b = new Reader(fr.bytes()); tags = []; while (!b.done) tags.push(b.varint()); }
        else if (f === 3) type = fr.varint();
        else if (f === 4) { const b = new Reader(fr.bytes()); geom = []; while (!b.done) geom.push(b.varint()); }
        else fr.skip(t & 7);
      }
      if (type !== 2 && type !== 3) continue;
      const props: Record<string, MvtValue> = {};
      for (let i = 0; i + 1 < tags.length; i += 2) if (keys[tags[i]] !== undefined) props[keys[tags[i]]] = values[tags[i + 1]];
      const parts = readGeometry(geom);
      if (parts.length) features.push({ type, props, parts });
    }
    const prev = out.get(name);
    if (prev) prev.features.push(...features); else out.set(name, { extent, features });
  }
  return out;
}
