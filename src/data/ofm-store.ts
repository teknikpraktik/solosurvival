/**
 * The trail network from OpenFreeMap's vector tiles (OpenMapTiles schema): works anywhere in the world, from the same z14 tiles the app
 * already downloads for the background map and for buildings and water. Gives the client's `TileWay` records, so the unchanged graph
 * builder (`buildRegionGraph`) runs on them. Measurements against our OSM tiles: docs/GLOBAL-MAP-DATA.md.
 *
 * What the tiles lack, and how it is made up for:
 * - OSM node ids (the topology). A vertex's id is its exact global pixel position at z14 (about 0.3 m): ways that shared an OSM node
 *   have a vertex at the very same position, ways that only cross (a bridge) do not. The tiles' line simplification can drop such a
 *   vertex, so a line end within about 1 m of another line is joined to it, and two lines on the same level that cross without a
 *   vertex (neither a bridge nor a tunnel) get one. Lines are clipped to their own tile; a tile edge joins like a line end.
 * - Some tags: `sac_scale` and `trail_visibility` are not in the schema. A plain path through rock, scree or ice (the tiles' landcover)
 *   without anything that says it is an ordinary path gets `outbreak:route=no`: zombies may use it, routes and checkpoints do not.
 * - surface is only paved/unpaved; tracktype is missing (only the bike's choice of easy ways for checkpoints reads them).
 */
import type { LatLon } from "@/geo/geometry";
import type { TileFetcher } from "@/geo/blockers";
import { decodeFeatures, type MvtFeature, type MvtValue } from "@/geo/mvt-features";
import type { LoadStats } from "./store";
import type { TileWay } from "./tile-format";

export const OFM_ZOOM = 14;
/** A line end this close (z14 units, about 0.3 m each) to another line is joined to it. Measured: 3 is as good as 6 or 10. */
export const OFM_STITCH_UNITS = 3;
/** Tag on ways that routes and checkpoints must not use (region-graph's strict network leaves them out). */
export const NO_ROUTE_TAG = "outbreak:route";

const MAJOR: Record<string, string> = { motorway: "T", trunk: "T", primary: "T", secondary: "t", tertiary: "t" };
const WATERCOURSE = new Set(["river", "stream", "canal"]);
/** Landcover classes of the alpine terrain where a path may be a mountain route (sac_scale is not in the tiles). */
const ALPINE = new Set(["rock", "ice"]);
const GENERIC_PATH = new Set(["path", "bridleway"]);
const YES = new Set(["yes", "designated", "permissive"]);

/** OpenMapTiles transportation properties as the OSM tags the client's filters read (geo/osm/overpass.ts), or null for other ways. */
export function osmTags(p: Record<string, MvtValue>): Record<string, string> | null {
  const cls = String(p.class ?? ""), sub = p.subclass === undefined ? "" : String(p.subclass);
  let highway: string | undefined;
  if (cls === "path") highway = sub || "path";
  else if (cls === "minor") highway = !sub || sub === "road" ? "unclassified" : sub;
  else if (cls === "track" || cls === "service") highway = cls;
  if (!highway) return null;
  const t: Record<string, string> = { highway };
  if (p.brunnel === "bridge") t.bridge = "yes";
  if (p.brunnel === "tunnel") t.tunnel = "yes";
  if (p.brunnel === "ford") t.ford = "yes";
  if (p.oneway === 1) t.oneway = "yes";
  if (p.oneway === -1) t.oneway = "-1";
  for (const k of ["access", "foot", "bicycle", "service", "surface"] as const) if (p[k] !== undefined && p[k] !== "") t[k] = String(p[k]);
  if (p.mtb_scale !== undefined) t["mtb:scale"] = String(p.mtb_scale);
  if (p.indoor === 1) t.indoor = "yes";
  return t;
}

/** Hazard kind of a major road, railway or watercourse (as in the OSM tiles: T, t, r, w), or null. */
export function hazardKind(layer: string, p: Record<string, MvtValue>): string | null {
  if (layer === "waterway") return WATERCOURSE.has(String(p.class)) ? "w" : null;
  const cls = String(p.class ?? "");
  if (cls === "rail" || cls === "transit") return "r";
  return MAJOR[cls.replace(/_link$/, "")] ?? null;
}

/** A plain path with nothing saying it is an ordinary one (a designated or paved way, a graded MTB trail). */
function uncertainPath(t: Record<string, string>): boolean {
  if (!GENERIC_PATH.has(t.highway)) return false;
  if (YES.has(t.foot ?? "") || t.bicycle === "designated" || t.surface === "paved") return false;
  const scale = Number.parseInt(t["mtb:scale"] ?? "", 10);
  return !(Number.isFinite(scale) && scale <= 2);
}

/** Tiles (x, y) at zoom z covering a circle. */
export function tilesAround(c: LatLon, radiusM: number, z = OFM_ZOOM): [number, number][] {
  const n = 2 ** z;
  const dLat = radiusM / 111_320, dLon = radiusM / (111_320 * Math.cos((c.lat * Math.PI) / 180));
  const tx = (lon: number) => Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const ty = (lat: number) => { const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180; return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n))); };
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
  for (let i = 0; i + 1 < line.length; i++) {
    const [x0, y0] = line[i], [x1, y1] = line[i + 1];
    let t0 = 0, t1 = 1, ok = true;
    const dx = x1 - x0, dy = y1 - y0;
    for (const [p, q] of [[-dx, x0], [dx, e - x0], [-dy, y0], [dy, e - y0]] as [number, number][]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { cur = null; continue; }
    const a: [number, number] = [x0 + t0 * dx, y0 + t0 * dy], b: [number, number] = [x0 + t1 * dx, y0 + t1 * dy];
    if (!cur || t0 > 0) { cur = [a]; out.push(cur); }
    cur.push(b);
    if (t1 < 1) cur = null;
  }
  return out.filter((l) => l.length >= 2);
}

/** Even–odd point in polygon over all rings. */
function inRings(rings: [number, number][][], x: number, y: number): boolean {
  let inside = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

interface Piece { tags: Record<string, string> | null; hazard: string | null; pts: [number, number][]; world: number; level: string; grade: boolean }

/** Cells (of size `cell`) a segment's bounding box covers. */
function cellsOf(x0: number, y0: number, x1: number, y1: number, cell: number): string[] {
  const out: string[] = [];
  for (let cx = Math.floor(Math.min(x0, x1) / cell); cx <= Math.floor(Math.max(x0, x1) / cell); cx++)
    for (let cy = Math.floor(Math.min(y0, y1) / cell); cy <= Math.floor(Math.max(y0, y1) / cell); cy++) out.push(`${cx}_${cy}`);
  return out;
}

/** Segment grid over the pieces (global z14 units): which piece segments pass through a cell. */
function segmentGrid(pieces: Piece[], cell: number) {
  const cells = new Map<string, [number, number][]>();
  pieces.forEach((p, pi) => {
    for (let i = 0; i + 1 < p.pts.length; i++) {
      const [x0, y0] = p.pts[i], [x1, y1] = p.pts[i + 1];
      for (const k of cellsOf(x0, y0, x1, y1, cell)) {
        const list = cells.get(k);
        if (list) list.push([pi, i]); else cells.set(k, [[pi, i]]);
      }
    }
  });
  return {
    at: (x: number, y: number) => cells.get(`${Math.floor(x / cell)}_${Math.floor(y / cell)}`) ?? [],
    /** Everything in the cells along a segment (its bounding box). */
    along: (x0: number, y0: number, x1: number, y1: number) => cellsOf(x0, y0, x1, y1, cell).flatMap((k) => cells.get(k) ?? []),
  };
}

/** Line ends within `tol` of another line (same level, same bridge/tunnel status) are moved onto it, at a vertex or a new one. */
function stitch(pieces: Piece[], tol: number) {
  const { at } = segmentGrid(pieces, 64);
  pieces.forEach((p, pi) => {
    for (const end of [0, p.pts.length - 1]) {
      const [ex, ey] = p.pts[end];
      let best: { qi: number; si: number; t: number; d: number } | null = null;
      for (const [qi, si] of at(ex, ey)) {
        if (qi === pi) continue;
        const q = pieces[qi];
        if (q.grade !== p.grade || q.level !== p.level) continue;
        const [x0, y0] = q.pts[si], [x1, y1] = q.pts[si + 1];
        const vx = x1 - x0, vy = y1 - y0, l2 = vx * vx + vy * vy;
        const t = l2 ? Math.max(0, Math.min(1, ((ex - x0) * vx + (ey - y0) * vy) / l2)) : 0;
        const d = Math.hypot(ex - x0 - t * vx, ey - y0 - t * vy);
        if (d <= tol && (!best || d < best.d)) best = { qi, si, t, d };
      }
      if (!best || best.d === 0) continue;
      const q = pieces[best.qi];
      const [x0, y0] = q.pts[best.si], [x1, y1] = q.pts[best.si + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (best.t * len <= tol) { p.pts[end] = [x0, y0]; continue; }
      if ((1 - best.t) * len <= tol) { p.pts[end] = [x1, y1]; continue; }
      const v: [number, number] = [Math.round(x0 + best.t * (x1 - x0)), Math.round(y0 + best.t * (y1 - y0))];
      q.pts.splice(best.si + 1, 0, v);
      p.pts[end] = v;
    }
  });
}

/** Two lines on the same level that cross between vertices, neither a bridge nor a tunnel, get a shared vertex where they cross. */
function crossings(pieces: Piece[]) {
  const grid = segmentGrid(pieces, 128);
  const adds = new Map<number, { si: number; t: number; v: [number, number] }[]>();
  const seen = new Set<string>();
  const add = (pi: number, a: { si: number; t: number; v: [number, number] }) => { const l = adds.get(pi); if (l) l.push(a); else adds.set(pi, [a]); };
  pieces.forEach((p, pi) => {
    if (p.grade) return;
    for (let i = 0; i + 1 < p.pts.length; i++) {
      const [ax, ay] = p.pts[i], [bx, by] = p.pts[i + 1];
      for (const [qi, sj] of grid.along(ax, ay, bx, by)) {
        if (qi <= pi) continue;
        const q = pieces[qi];
        if (q.grade || q.level !== p.level) continue;
        const k = `${pi}:${i}:${qi}:${sj}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const [cx, cy] = q.pts[sj], [dx, dy] = q.pts[sj + 1];
        const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
        if (!den) continue;
        const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
        if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) continue;
        const v: [number, number] = [Math.round(ax + t * (bx - ax)), Math.round(ay + t * (by - ay))];
        add(pi, { si: i, t, v });
        add(qi, { si: sj, t: u, v });
      }
    }
  });
  for (const [pi, list] of adds) {
    list.sort((a, b) => b.si - a.si || b.t - a.t);
    for (const a of list) pieces[pi].pts.splice(a.si + 1, 0, a.v);
  }
}

export interface OfmTile { z: number; x: number; y: number; pbf: Uint8Array }

/** The way records from a set of tiles. Pure: the same tiles always give the same ways (ids included). */
export function waysFromTiles(tiles: readonly OfmTile[], stitchUnits = OFM_STITCH_UNITS): TileWay[] {
  const pieces: Piece[] = [];
  const sorted = [...tiles].sort((a, b) => a.x - b.x || a.y - b.y);
  for (const { z, x, y, pbf } of sorted) {
    const layers = decodeFeatures(pbf, new Set(["transportation", "waterway", "landcover"]));
    const alpine = (layers.get("landcover")?.features ?? []).filter((f) => f.type === 3 && ALPINE.has(String(f.props.class)));
    const alpineRings = alpine.flatMap((f) => f.parts);
    for (const layer of ["transportation", "waterway"] as const) {
      const l = layers.get(layer);
      if (!l) continue;
      const e = l.extent, world = e * 2 ** z;
      for (const f of l.features as MvtFeature[]) {
        if (f.type !== 2) continue;
        let tags = layer === "transportation" ? osmTags(f.props) : null;
        const hz = hazardKind(layer, f.props);
        if (!tags && !hz) continue;
        if (tags && alpineRings.length && uncertainPath(tags) && f.parts.some((pt) => pt.some(([px, py]) => inRings(alpineRings, px, py)))) tags = { ...tags, [NO_ROUTE_TAG]: "no" };
        const level = `${f.props.layer ?? 0}`, grade = f.props.brunnel === "bridge" || f.props.brunnel === "tunnel";
        for (const part of f.parts) for (const c of clip(part, e)) pieces.push({ tags, hazard: hz, world, level, grade, pts: c.map(([px, py]) => [x * e + px, y * e + py]) });
      }
    }
  }
  if (stitchUnits > 0) stitch(pieces, stitchUnits);
  crossings(pieces);
  const key = ([gx, gy]: [number, number]) => `g${Math.round(gx)}_${Math.round(gy)}`;
  const sev: Record<string, number> = { T: 3, r: 2, w: 1, t: 0 };
  const hazardAt = new Map<string, string>();
  for (const p of pieces) if (p.hazard) for (const v of p.pts) { const k = key(v), old = hazardAt.get(k); if (!old || sev[p.hazard] > sev[old]) hazardAt.set(k, p.hazard); }
  const ways: TileWay[] = [];
  let seq = 0;
  for (const p of pieces) {
    if (!p.tags) continue;
    const nodes = p.pts.map((v) => ({ id: key(v), ...toLatLon(v[0], v[1], p.world) }));
    const hazard: number[] = [], hazardKinds: string[] = [];
    nodes.forEach((n, i) => { const h = hazardAt.get(n.id); if (h) { hazard.push(i); hazardKinds.push(h); } });
    ways.push({ id: `ofm${seq++}`, tags: p.tags, nodes, hazard, hazardKinds });
  }
  return ways;
}

export interface OpenFreeMapClient {
  tile: TileFetcher;
  /** The tile set's version (the build in the tile URL), for `dataVersion`. */
  version(): Promise<string>;
}

/** Trail network for any place, from OpenFreeMap. Same interface as the OSM `TileStore` where `prepareMatch` uses it. */
export class OfmStore {
  private readonly bytes = new Map<string, Uint8Array | null>();
  private versionId?: string;
  constructor(private readonly client: OpenFreeMapClient, private readonly maxCachedTiles = 400) {}

  get dataVersion(): string | undefined { return this.versionId; }

  async loadManifest(): Promise<{ dataVersion: string }> {
    this.versionId = `ofm-${await this.client.version()}`;
    return { dataVersion: this.versionId };
  }

  /** Every place has tiles (the ocean simply has no ways). */
  covers(_p: LatLon): boolean { return true; }

  async loadAround(center: LatLon, radiusM: number): Promise<{ ways: TileWay[]; stats: LoadStats }> {
    if (!this.versionId) await this.loadManifest();
    const t0 = Date.now();
    const keys = tilesAround(center, radiusM);
    const stats: LoadStats = { tiles: keys.length, fromCache: 0, fromNetwork: 0, missing: 0, networkGzipBytes: 0, ms: 0, source: "openfreemap", dataVersion: this.versionId };
    const tiles = await Promise.all(keys.map(async ([x, y]): Promise<OfmTile | null> => {
      const k = `${x}_${y}`;
      let pbf = this.bytes.get(k);
      if (pbf !== undefined) stats.fromCache++;
      else {
        pbf = await this.client.tile(OFM_ZOOM, x, y);
        stats.fromNetwork++;
        if (pbf) stats.networkGzipBytes += pbf.length;
        if (this.bytes.size >= this.maxCachedTiles) this.bytes.delete(this.bytes.keys().next().value!);
        this.bytes.set(k, pbf);
      }
      if (!pbf) { stats.missing++; return null; }
      return { z: OFM_ZOOM, x, y, pbf };
    }));
    const ways = waysFromTiles(tiles.filter((t): t is OfmTile => !!t));
    stats.ms = Date.now() - t0;
    return { ways, stats };
  }
}
