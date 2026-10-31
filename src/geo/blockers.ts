import { haversineM, type LatLon } from "./geometry";
import { decodePolygons } from "./mvt";

/**
 * Where zombies cannot go off the trails: buildings and water, from the background map's vector tiles (OpenFreeMap, OpenMapTiles schema).
 * Loaded once when a match is prepared, for the play area; polygons are put in a coarse grid so a point or a short segment is checked
 * against only the few polygons near it.
 */
export interface Blockers {
  /** Inside a building or water. */
  blocked(p: LatLon): boolean;
  /** Any point along a–b (every `stepM`) is blocked. */
  segmentBlocked(a: LatLon, b: LatLon, stepM?: number): boolean;
  polygons: number;
}

/** Fetches one vector tile (decompressed bytes), or null if it is missing. */
export type TileFetcher = (z: number, x: number, y: number) => Promise<Uint8Array | null>;

const LAYERS = new Set(["building", "water"]);
/** Zoom of the tiles read: buildings are only complete at 14 (at 13 most small houses are left out). */
export const BLOCKER_ZOOM = 14;
const PARALLEL = 8;
/** Grid cell for the polygon index (degrees, about 110 × 55 m in Värmland). */
const CELL_DEG = 0.001;

interface Poly { rings: LatLon[][]; s: number; w: number; n: number; e: number }

export function tileRange(center: LatLon, radiusM: number, z: number) {
  const n = 2 ** z;
  const dLat = radiusM / 111_320, dLon = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const ty = (lat: number) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };
  return { x0: tx(center.lon - dLon), x1: tx(center.lon + dLon), y0: ty(center.lat + dLat), y1: ty(center.lat - dLat) };
}

/** Loads buildings and water for a disc; null when any tile could not be fetched (then zombies stay on the trails). */
export async function loadBlockers(center: LatLon, radiusM: number, z: number, fetchTile: TileFetcher): Promise<Blockers | null> {
  const r = tileRange(center, radiusM, z);
  const todo: [number, number][] = [];
  for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) todo.push([x, y]);
  const all: (LatLon[][][] | null)[] = [];
  // A few at a time, not a burst of a hundred requests.
  for (let i = 0; i < todo.length; i += PARALLEL) {
    all.push(...await Promise.all(todo.slice(i, i + PARALLEL).map(([x, y]) => fetchTile(z, x, y).then((buf) => {
      if (!buf) return [];
      const t = decodePolygons(buf, z, x, y, LAYERS);
      return [...(t.layers.get("building") ?? []), ...(t.layers.get("water") ?? [])];
    }, () => null))));
    if (all.some((x) => x === null)) return null;
  }
  if (all.some((x) => x === null)) return null;
  return makeBlockers(all.flat() as LatLon[][][]);
}

export function makeBlockers(polys: LatLon[][][]): Blockers {
  const index = new Map<string, Poly[]>();
  const key = (i: number, j: number) => `${i},${j}`;
  for (const rings of polys) {
    if (!rings.length || rings[0].length < 3) continue;
    let s = 90, w = 180, n = -90, e = -180;
    for (const p of rings[0]) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon); }
    const poly = { rings, s, w, n, e };
    for (let i = Math.floor(s / CELL_DEG); i <= Math.floor(n / CELL_DEG); i++) for (let j = Math.floor(w / CELL_DEG); j <= Math.floor(e / CELL_DEG); j++) {
      const k = key(i, j);
      const list = index.get(k);
      if (list) list.push(poly); else index.set(k, [poly]);
    }
  }
  const inRing = (p: LatLon, ring: LatLon[]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
    }
    return inside;
  };
  const blocked = (p: LatLon) => {
    const list = index.get(key(Math.floor(p.lat / CELL_DEG), Math.floor(p.lon / CELL_DEG)));
    if (!list) return false;
    for (const poly of list) {
      if (p.lat < poly.s || p.lat > poly.n || p.lon < poly.w || p.lon > poly.e) continue;
      if (inRing(p, poly.rings[0]) && !poly.rings.slice(1).some((h) => inRing(p, h))) return true;
    }
    return false;
  };
  return {
    polygons: polys.length,
    blocked,
    segmentBlocked(a, b, stepM = 8) {
      const k = Math.max(1, Math.ceil(haversineM(a, b) / stepM));
      for (let i = 0; i <= k; i++) {
        const t = i / k;
        if (blocked({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t })) return true;
      }
      return false;
    },
  };
}

/** The background map's vector tiles (the same OpenFreeMap tiles the map shows, so they are often in the browser's cache already). */
export function openFreeMapFetcher(fetchFn: typeof fetch = fetch): TileFetcher {
  let template: Promise<string> | null = null;
  return async (z, x, y) => {
    template ??= fetchFn("https://tiles.openfreemap.org/planet").then((r) => r.json()).then((j: { tiles: string[] }) => j.tiles[0]);
    const url = (await template).replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
    const res = await fetchFn(url);
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
}
