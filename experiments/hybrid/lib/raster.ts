import { assembleRings, splitBoxByChain, toLocalRing, type Fixture, type Ring, type XY } from "./fixture";
import { pointInPolygonXY } from "./geom2d";

/** Terrängklasser i rastret. Allt över OPEN betraktas som blockerat. */
export const C = {
  UNKNOWN: 0,
  FOREST: 1,
  OPEN: 2,
  WATER: 3,
  WETLAND: 4,
  BUILDING: 5,
  BARRIER: 6,
  URBAN: 7,
  ROUGH: 8,
} as const;
export type TerrainClass = (typeof C)[keyof typeof C];
export const CLASS_NAMES = ["okänd", "skog", "öppen mark", "vatten", "våtmark", "byggnad", "barriär", "bebyggd/privat", "berg/block"];

export const CELL_M = 5;

export interface TerrainRaster {
  w: number;
  h: number;
  cell: number;
  data: Uint8Array;
  /** Antal polygoner/linjer per källa, för rapportering. */
  stats: {
    incompleteWaterSplit: number;
    incompleteWaterAmbiguous: number;
    incompleteOther: number;
    polygons: number;
  };
}

const FOREST_TAGS = (t: Record<string, string>) => t.landuse === "forest" || t.natural === "wood" || t.natural === "scrub";
const OPEN_TAGS = (t: Record<string, string>) =>
  ["farmland", "meadow", "grass", "orchard", "village_green", "recreation_ground", "greenfield", "brownfield"].includes(t.landuse) ||
  ["grassland", "heath", "beach", "sand"].includes(t.natural) ||
  ["park", "golf_course", "pitch"].includes(t.leisure);
const WATER_TAGS = (t: Record<string, string>) =>
  t.natural === "water" || t.landuse === "reservoir" || t.landuse === "basin" || t.waterway === "riverbank" || t.leisure === "swimming_pool" || t.leisure === "water_park";
const WETLAND_TAGS = (t: Record<string, string>) => t.natural === "wetland";
const ROUGH_TAGS = (t: Record<string, string>) => ["bare_rock", "scree", "cliff"].includes(t.natural);
const URBAN_TAGS = (t: Record<string, string>) =>
  ["residential", "industrial", "commercial", "retail", "farmyard", "military", "cemetery", "garages", "construction", "railway", "quarry", "landfill"].includes(t.landuse) ||
  ["sports_centre", "playground", "garden", "dog_park", "miniature_golf", "bleachers", "stadium"].includes(t.leisure);

function classOf(t: Record<string, string>): TerrainClass | null {
  if (t.building) return C.BUILDING;
  if (WATER_TAGS(t)) return C.WATER;
  if (WETLAND_TAGS(t)) return C.WETLAND;
  if (ROUGH_TAGS(t)) return C.ROUGH;
  if (URBAN_TAGS(t)) return C.URBAN;
  if (FOREST_TAGS(t)) return C.FOREST;
  if (OPEN_TAGS(t)) return C.OPEN;
  return null;
}

/** Målarordning: lägre rang målas först och kan skrivas över av högre. */
const RANK: Record<number, number> = { [C.FOREST]: 1, [C.OPEN]: 1, [C.URBAN]: 2, [C.ROUGH]: 3, [C.WETLAND]: 4, [C.WATER]: 5, [C.BUILDING]: 6, [C.BARRIER]: 7 };

function fillPolygon(r: TerrainRaster, rings: Ring[], cls: TerrainClass) {
  // Even-odd över alla ringar (outer + inner).
  let minY = Infinity, maxY = -Infinity;
  for (const ring of rings) for (const [, y] of ring) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const j0 = Math.max(0, Math.floor(minY / r.cell));
  const j1 = Math.min(r.h - 1, Math.floor(maxY / r.cell));
  for (let j = j0; j <= j1; j++) {
    const y = (j + 0.5) * r.cell;
    const xs: number[] = [];
    for (const ring of rings) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[i + 1];
        if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] / r.cell - 0.5));
      const i1 = Math.min(r.w - 1, Math.floor(xs[k + 1] / r.cell - 0.5));
      for (let i = i0; i <= i1; i++) {
        const idx = j * r.w + i;
        const cur = r.data[idx];
        if (cur === C.UNKNOWN || (RANK[cls] ?? 0) >= (RANK[cur] ?? 0)) r.data[idx] = cls;
      }
    }
  }
}

function drawLine(r: TerrainRaster, line: XY[], widthM: number, cls: TerrainClass) {
  const half = widthM / 2;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / (r.cell / 2)));
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps;
      const y = ay + ((by - ay) * s) / steps;
      const reach = Math.ceil(half / r.cell);
      const ci = Math.floor(x / r.cell);
      const cj = Math.floor(y / r.cell);
      for (let dj = -reach; dj <= reach; dj++)
        for (let di = -reach; di <= reach; di++) {
          const i2 = ci + di, j2 = cj + dj;
          if (i2 < 0 || j2 < 0 || i2 >= r.w || j2 >= r.h) continue;
          if (Math.hypot((i2 + 0.5) * r.cell - x, (j2 + 0.5) * r.cell - y) <= Math.max(half, r.cell * 0.55)) r.data[j2 * r.w + i2] = cls;
        }
    }
  }
}

export interface RasterOptions {
  cellM?: number;
  /** Bäckar och diken: spärr (true) eller passerbara (false). */
  streamsBlock?: boolean;
}

/** Rasteriserar OSM-fixturen till terrängklasser. */
export function buildRaster(fx: Fixture, opts: RasterOptions = {}): TerrainRaster {
  const cell = opts.cellM ?? CELL_M;
  const r: TerrainRaster = {
    w: Math.ceil(fx.widthM / cell),
    h: Math.ceil(fx.heightM / cell),
    cell,
    data: new Uint8Array(0),
    stats: { incompleteWaterSplit: 0, incompleteWaterAmbiguous: 0, incompleteOther: 0, polygons: 0 },
  };
  r.data = new Uint8Array(r.w * r.h);

  type Job = { rings: Ring[]; cls: TerrainClass };
  const jobs: Job[] = [];
  const lines: { line: XY[]; width: number }[] = [];

  // Trädnoder i lokala meter, för att avgöra vattensida vid ofullständiga relationer.
  const trailXY: XY[] = [];
  for (const w of fx.ways) {
    if (w.tags?.highway && !["platform", "steps"].includes(w.tags.highway)) {
      for (const p of w.geometry) if (p) trailXY.push(toLocalRing(fx, [p as never])[0]);
    }
  }

  for (const w of fx.ways) {
    const t = w.tags ?? {};
    const pts = w.geometry as ({ lat: number; lon: number } | null)[];
    if (pts.some((p) => !p)) continue;
    const loc = toLocalRing(fx, pts as never);
    const closed = w.nodes.length > 3 && w.nodes[0] === w.nodes[w.nodes.length - 1];
    const cls = !t.highway && !t.railway ? classOf(t) : null;
    if (cls !== null && closed) jobs.push({ rings: [loc], cls });
    if (t.barrier && ["fence", "wall", "hedge", "retaining_wall", "guard_rail", "city_wall", "gate"].includes(t.barrier) && t.barrier !== "gate") lines.push({ line: loc, width: 2 });
    if (t.natural === "cliff") lines.push({ line: loc, width: 4 });
    if (t.railway && ["rail", "light_rail", "narrow_gauge", "tram", "subway"].includes(t.railway)) lines.push({ line: loc, width: 6 });
    if (t.waterway === "river" || t.waterway === "canal") lines.push({ line: loc, width: 10 });
    if (opts.streamsBlock !== false && ["stream", "ditch", "drain"].includes(t.waterway)) lines.push({ line: loc, width: 3 });
  }

  for (const rel of fx.relations) {
    const cls = classOf(rel.tags);
    if (cls === null) continue;
    const outer = assembleRings(rel.members, "outer");
    const inner = assembleRings(rel.members, "inner");
    const rings: Ring[] = [...outer.closed, ...inner.closed].map((x) => toLocalRing(fx, x));
    if (rel.complete && outer.open.length === 0) {
      jobs.push({ rings, cls });
      continue;
    }
    // Ofullständig relation. Vatten: sluts mot rutans kant, med vattensida = sidan med färre vägnoder.
    if (cls === C.WATER) {
      let handled = false;
      for (const chain of outer.open) {
        const sides = splitBoxByChain(fx, toLocalRing(fx, chain));
        if (!sides) continue;
        const count = (ring: Ring) => trailXY.reduce((n, p) => n + (pointInPolygonXY(p, ring) ? 1 : 0), 0);
        const [a, b] = [count(sides[0]), count(sides[1])];
        const lo = Math.min(a, b), hi = Math.max(a, b);
        // Entydigt om ena sidan nästan saknar vägar och den andra har många.
        if (lo <= Math.max(2, hi * 0.02) && hi >= 20) {
          jobs.push({ rings: [a < b ? sides[0] : sides[1]], cls });
          r.stats.incompleteWaterSplit++;
          handled = true;
        } else {
          r.stats.incompleteWaterAmbiguous++;
        }
      }
      if (rings.length) jobs.push({ rings, cls });
      if (!handled && rings.length === 0) r.stats.incompleteOther++;
    } else {
      // Ofullständig skog/mark: använd bara slutna delar, annars okänd (konservativt).
      if (rings.length && outer.closed.length) jobs.push({ rings, cls });
      else r.stats.incompleteOther++;
    }
  }

  jobs.sort((a, b) => (RANK[a.cls] ?? 0) - (RANK[b.cls] ?? 0));
  for (const j of jobs) fillPolygon(r, j.rings, j.cls);
  r.stats.polygons = jobs.length;
  for (const l of lines) drawLine(r, l.line, l.width, C.BARRIER);
  return r;
}

export function classAt(r: TerrainRaster, x: number, y: number): number {
  const i = Math.floor(x / r.cell), j = Math.floor(y / r.cell);
  if (i < 0 || j < 0 || i >= r.w || j >= r.h) return C.UNKNOWN;
  return r.data[j * r.w + i];
}

export function coverage(r: TerrainRaster): Record<string, number> {
  const counts = new Array(CLASS_NAMES.length).fill(0);
  for (const v of r.data) counts[v]++;
  const out: Record<string, number> = {};
  CLASS_NAMES.forEach((n, i) => (out[n] = counts[i] / r.data.length));
  return out;
}
