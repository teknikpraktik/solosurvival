/**
 * Experiment (global map data): the trail network from OpenFreeMap's vector tiles (OpenMapTiles schema, global, the same z14 tiles the
 * app already downloads for buildings and water) turned into the client's `TileWay` records, so the unchanged graph builder
 * (`buildRegionGraph`) can run on them. See docs/GLOBAL-MAP-DATA.md.
 *
 * What the tiles lack, and how it is made up for:
 * - OSM node ids (the topology). Vertices are keyed by their exact global pixel position at z14 (4096 units per tile, about 0.3 m at
 *   60° N): two lines that shared an OSM node have a vertex at the very same integer position, two lines that only cross (a bridge)
 *   do not. Lines are clipped to their own tile; points on a tile edge are matched to the neighbour's within a small tolerance.
 * - OSM way ids: one synthetic id per clipped piece.
 * - Some tags: sac_scale, trail_visibility, tracktype are not in the schema; surface is only paved/unpaved.
 */
import type { LatLon } from "@/geo/geometry";
import type { TileWay } from "@/data/tile-format";

// --- Minimal MVT reader for lines with properties -------------------------------------------------------------------------------

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
  double(): number { const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8).getFloat64(0, true); this.pos += 8; return v; }
  float(): number { const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4).getFloat32(0, true); this.pos += 4; return v; }
  skip(wire: number) {
    if (wire === 0) this.varint(); else if (wire === 1) this.pos += 8; else if (wire === 2) this.pos += this.varint(); else if (wire === 5) this.pos += 4;
    else throw new Error(`mvt: wire type ${wire}`);
  }
}
const utf8 = new TextDecoder();
const zigzag = (n: number) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

export interface MvtLine { props: Record<string, string | number | boolean>; lines: [number, number][][]; extent: number }

function readValue(r: Reader): string | number | boolean {
  let v: string | number | boolean = "";
  while (!r.done) {
    const tag = r.varint(), f = tag >> 3, w = tag & 7;
    if (f === 1) v = utf8.decode(r.bytes());
    else if (f === 2) v = r.float();
    else if (f === 3) v = r.double();
    else if (f === 4 || f === 5) v = r.varint();
    else if (f === 6) v = zigzag(r.varint());
    else if (f === 7) v = r.varint() === 1;
    else r.skip(w);
  }
  return v;
}

/** Line features (type 2) of the chosen layers, in tile units. */
export function decodeLines(pbf: Uint8Array, want: ReadonlySet<string>): Map<string, MvtLine[]> {
  const out = new Map<string, MvtLine[]>();
  const tile = new Reader(pbf);
  while (!tile.done) {
    const tag = tile.varint();
    if (tag >> 3 !== 3 || (tag & 7) !== 2) { tile.skip(tag & 7); continue; }
    const lr = new Reader(tile.bytes());
    let name = "", extent = 4096;
    const keys: string[] = [], values: (string | number | boolean)[] = [], feats: Uint8Array[] = [];
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
    const list: MvtLine[] = [];
    for (const fb of feats) {
      const fr = new Reader(fb);
      let type = 0; let tags: number[] = []; let geom: number[] = [];
      while (!fr.done) {
        const t = fr.varint(), f = t >> 3;
        if (f === 2) { const b = new Reader(fr.bytes()); tags = []; while (!b.done) tags.push(b.varint()); }
        else if (f === 3) type = fr.varint();
        else if (f === 4) { const b = new Reader(fr.bytes()); geom = []; while (!b.done) geom.push(b.varint()); }
        else fr.skip(t & 7);
      }
      if (type !== 2) continue;
      const props: MvtLine["props"] = {};
      for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]];
      const lines: [number, number][][] = [];
      let x = 0, y = 0, i = 0, cur: [number, number][] | null = null;
      while (i < geom.length) {
        const cmd = geom[i] & 7, count = geom[i] >> 3; i++;
        if (cmd === 7) continue;
        for (let k = 0; k < count; k++) {
          x += zigzag(geom[i++]); y += zigzag(geom[i++]);
          if (cmd === 1) { cur = [[x, y]]; lines.push(cur); } else cur?.push([x, y]);
        }
      }
      list.push({ props, lines: lines.filter((l) => l.length >= 2), extent });
    }
    out.set(name, list);
  }
  return out;
}

// --- From tiles to TileWay ------------------------------------------------------------------------------------------------------

export type TileFetcher = (z: number, x: number, y: number) => Promise<Uint8Array | null>;

const MAJOR: Record<string, string> = { motorway: "T", trunk: "T", primary: "T", secondary: "t", tertiary: "t" };
const WATER = new Set(["river", "stream", "canal"]);

/** OpenMapTiles transportation properties as the OSM tags the client's filters read (src/geo/osm/overpass.ts). */
export function osmTags(p: MvtLine["props"]): Record<string, string> | null {
  const cls = String(p.class ?? ""), sub = p.subclass === undefined ? "" : String(p.subclass);
  let highway: string | undefined;
  if (cls === "path") highway = sub || "path";
  else if (cls === "minor") highway = sub === "road" || !sub ? "unclassified" : sub;
  else if (cls === "track" || cls === "service") highway = cls;
  if (!highway) return null;
  const t: Record<string, string> = { highway };
  if (p.brunnel === "bridge") t.bridge = "yes";
  if (p.brunnel === "tunnel") t.tunnel = "yes";
  if (p.brunnel === "ford") t.ford = "yes";
  if (p.oneway === 1) t.oneway = "yes";
  if (p.oneway === -1) t.oneway = "-1";
  for (const k of ["access", "foot", "bicycle", "service", "surface"] as const) if (p[k] !== undefined) t[k] = String(p[k]);
  if (p.mtb_scale !== undefined) t["mtb:scale"] = String(p.mtb_scale);
  if (p.indoor === 1) t.indoor = "yes";
  return t;
}

function hazardKind(layer: string, p: MvtLine["props"]): string | null {
  if (layer === "waterway") return WATER.has(String(p.class)) && (process.env.OFM_CULVERT_HAZARD !== "0" || p.brunnel !== "tunnel") ? "w" : null;
  const cls = String(p.class ?? "");
  if (cls === "rail" || cls === "transit") return "r";
  return MAJOR[cls.replace(/_link$/, "")] ?? null;
}

/** Tiles (x, y) at zoom z covering a circle. */
export function tilesAround(c: LatLon, radiusM: number, z: number): [number, number][] {
  const n = 2 ** z;
  const dLat = radiusM / 111_320, dLon = radiusM / (111_320 * Math.cos((c.lat * Math.PI) / 180));
  const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const ty = (lat: number) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };
  const out: [number, number][] = [];
  for (let x = tx(c.lon - dLon); x <= tx(c.lon + dLon); x++) for (let y = ty(c.lat + dLat); y <= ty(c.lat - dLat); y++) out.push([x, y]);
  return out;
}

const toLatLon = (gx: number, gy: number, world: number): LatLon => ({
  lon: (gx / world) * 360 - 180,
  lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / world))) * 180) / Math.PI,
});

/** Liang–Barsky: the parts of a polyline inside [0, e] × [0, e] (tile units). */
function clip(line: [number, number][], e: number): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] | null = null;
  const inside = (p: [number, number]) => p[0] >= 0 && p[0] <= e && p[1] >= 0 && p[1] <= e;
  for (let i = 0; i + 1 < line.length; i++) {
    const [x0, y0] = line[i], [x1, y1] = line[i + 1];
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dy = y1 - y0;
    let ok = true;
    for (const [p, q] of [[-dx, x0], [dx, e - x0], [-dy, y0], [dy, e - y0]] as [number, number][]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { cur = null; continue; }
    const a: [number, number] = [x0 + t0 * dx, y0 + t0 * dy], b: [number, number] = [x0 + t1 * dx, y0 + t1 * dy];
    if (!cur || t0 > 0 || !inside(line[i])) { cur = [a]; out.push(cur); }
    cur.push(b);
    if (t1 < 1) cur = null;
  }
  return out.filter((l) => l.length >= 2);
}

type Piece = { tags: Record<string, string> | null; hazard: string | null; pts: [number, number][]; world: number; level: string; grade: boolean };

/** Segment grid over all pieces (global z14 units). */
function grid(pieces: Piece[], cell: number) {
  const cells = new Map<string, [number, number][]>(); // [piece, segment index]
  pieces.forEach((p, pi) => {
    for (let i = 0; i + 1 < p.pts.length; i++) {
      const [x0, y0] = p.pts[i], [x1, y1] = p.pts[i + 1];
      for (let cx = Math.floor(Math.min(x0, x1) / cell); cx <= Math.floor(Math.max(x0, x1) / cell); cx++)
        for (let cy = Math.floor(Math.min(y0, y1) / cell); cy <= Math.floor(Math.max(y0, y1) / cell); cy++) (cells.get(`${cx}_${cy}`) ?? cells.set(`${cx}_${cy}`, []).get(`${cx}_${cy}`)!).push([pi, i]);
    }
  });
  return (x: number, y: number) => cells.get(`${Math.floor(x / cell)}_${Math.floor(y / cell)}`) ?? [];
}

/**
 * The tiles' line simplification can drop the vertex where one way's end meets another way (a T junction), and tile edges cut lines in
 * two. A line end within `tol` units of another line is moved onto it: onto its vertex if one is that close, otherwise a vertex is
 * inserted there. Never onto a bridge or tunnel (a path ending under a bridge is not on it), never between different levels.
 */
function stitch(pieces: Piece[], tol: number) {
  const at = grid(pieces, 64);
  pieces.forEach((p, pi) => {
    for (const end of [0, p.pts.length - 1]) {
      const [ex, ey] = p.pts[end];
      let best: { pi: number; si: number; t: number; d: number } | null = null;
      for (const [qi, si] of at(ex, ey)) {
        if (qi === pi) continue;
        const q = pieces[qi];
        if (q.grade !== p.grade || q.level !== p.level) continue;
        const [x0, y0] = q.pts[si], [x1, y1] = q.pts[si + 1];
        const vx = x1 - x0, vy = y1 - y0, l2 = vx * vx + vy * vy;
        const t = l2 ? Math.max(0, Math.min(1, ((ex - x0) * vx + (ey - y0) * vy) / l2)) : 0;
        const d = Math.hypot(ex - x0 - t * vx, ey - y0 - t * vy);
        if (d <= tol && (!best || d < best.d)) best = { pi: qi, si, t, d };
      }
      if (!best || best.d === 0) continue;
      const q = pieces[best.pi];
      const [x0, y0] = q.pts[best.si], [x1, y1] = q.pts[best.si + 1];
      const segLen = Math.hypot(x1 - x0, y1 - y0);
      // A vertex of the other line within the tolerance: use it.
      if (best.t * segLen <= tol) { p.pts[end] = [x0, y0]; continue; }
      if ((1 - best.t) * segLen <= tol) { p.pts[end] = [x1, y1]; continue; }
      const v: [number, number] = [Math.round(x0 + best.t * (x1 - x0)), Math.round(y0 + best.t * (y1 - y0))];
      q.pts.splice(best.si + 1, 0, v);
      p.pts[end] = v;
    }
  });
}

/** Two lines that cross between vertices, same level, neither a bridge nor a tunnel: a vertex is put in both where they cross. */
function crossings(pieces: Piece[]) {
  const at = grid(pieces, 128);
  const adds = new Map<number, { si: number; t: number; v: [number, number] }[]>();
  const seen = new Set<string>();
  pieces.forEach((p, pi) => {
    if (p.grade) return;
    for (let i = 0; i + 1 < p.pts.length; i++) {
      const [ax, ay] = p.pts[i], [bx, by] = p.pts[i + 1];
      for (const [qi, sj] of [...at(ax, ay), ...at(bx, by)]) {
        if (qi <= pi) continue;
        const q = pieces[qi];
        if (q.grade || q.level !== p.level) continue;
        const k = `${pi}:${i}:${qi}:${sj}`; if (seen.has(k)) continue; seen.add(k);
        const [cx, cy] = q.pts[sj], [dx, dy] = q.pts[sj + 1];
        const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
        if (!den) continue;
        const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
        if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) continue; // at a vertex already (or an end: stitch handles those)
        const v: [number, number] = [Math.round(ax + t * (bx - ax)), Math.round(ay + t * (by - ay))];
        (adds.get(pi) ?? adds.set(pi, []).get(pi)!).push({ si: i, t, v });
        (adds.get(qi) ?? adds.set(qi, []).get(qi)!).push({ si: sj, t: u, v });
      }
    }
  });
  for (const [pi, list] of adds) {
    list.sort((a, b) => b.si - a.si || b.t - a.t);
    for (const a of list) pieces[pi].pts.splice(a.si + 1, 0, a.v);
  }
}

export interface OfmLoad { ways: TileWay[]; tiles: number; bytes: number; ms: number }

/**
 * The client's way records for a circle, from OpenFreeMap z14 tiles. Node ids: `g<gx>_<gy>` (global z14 pixel), points on a tile edge
 * snapped to a 1-unit grid along that edge so both neighbours give the same id.
 */
export interface OfmOptions {
  /** Join a line's end to another line within this many z14 units (about 0.3 m each); 0 = off. Never onto a bridge or tunnel. */
  stitchUnits: number;
  /** Also join two lines that cross without a shared vertex (same level, neither a bridge nor a tunnel). */
  crossings: boolean;
}
export const DEFAULT_OFM: OfmOptions = { stitchUnits: 3, crossings: false };

export async function ofmWays(fetchTile: TileFetcher, center: LatLon, radiusM: number, z = 14, opts: OfmOptions = DEFAULT_OFM): Promise<OfmLoad> {
  const t0 = Date.now();
  const keys = tilesAround(center, radiusM, z);
  let bytes = 0, seq = 0;
  const pieces: Piece[] = [];
  await Promise.all(keys.map(async ([x, y]) => {
    const pbf = await fetchTile(z, x, y);
    if (!pbf) return;
    bytes += pbf.length;
    const layers = decodeLines(pbf, new Set(["transportation", "waterway"]));
    for (const [layer, feats] of layers) for (const f of feats) {
      const tags = layer === "transportation" ? osmTags(f.props) : null;
      const hz = hazardKind(layer, f.props);
      if (!tags && !hz) continue;
      const e = f.extent, world = e * 2 ** z;
      const level = `${f.props.layer ?? 0}`, grade = f.props.brunnel === "bridge" || f.props.brunnel === "tunnel";
      for (const l of f.lines) for (const part of clip(l, e)) pieces.push({ tags, hazard: hz, world, level, grade, pts: part.map(([px, py]) => [x * e + px, y * e + py]) });
    }
  }));
  if (opts.stitchUnits > 0) stitch(pieces, opts.stitchUnits);
  if (opts.crossings) crossings(pieces);
  // Node keys. Interior vertices are integers; clipped points lie on a tile edge: round along the edge.
  const key = ([gx, gy]: [number, number]) => `g${Math.round(gx)}_${Math.round(gy)}`;
  // Hazard vertices: every vertex of a major road, railway or watercourse.
  const hazardAt = new Map<string, string>();
  const sev: Record<string, number> = { T: 3, r: 2, w: 1, t: 0 };
  for (const p of pieces) if (p.hazard) for (const v of p.pts) { const k = key(v); const old = hazardAt.get(k); if (!old || sev[p.hazard] > sev[old]) hazardAt.set(k, p.hazard); }
  const ways: TileWay[] = [];
  for (const p of pieces) {
    if (!p.tags) continue;
    const nodes = p.pts.map((v) => ({ id: key(v), ...toLatLon(v[0], v[1], p.world) }));
    const hazard: number[] = [], kinds: string[] = [];
    nodes.forEach((n, i) => { const h = hazardAt.get(n.id); if (h) { hazard.push(i); kinds.push(h); } });
    ways.push({ id: `ofm${seq++}`, tags: p.tags, nodes, hazard, hazardKinds: kinds });
  }
  return { ways, tiles: keys.length, bytes, ms: Date.now() - t0 };
}
