import type { LatLon } from "@/geo/geometry";

/** Måste motsvara experiments/data/build_tiles.py. */
export const TILE_FORMAT = 1;

export interface TileManifest {
  format: number;
  region: string;
  /** Innehållshash; används som cache-nyckel och i tile-URL:er så att gammal data aldrig serveras. */
  dataVersion: string;
  tile: { latStepDeg: number; lonStepDeg: number; coordUnitDeg: number };
  bbox: [number, number, number, number];
  /** [ty, tx, ways, bytes, gzipBytes] */
  tiles: [number, number, number, number, number][];
  stats: { tiles: number; pathWays: number; hazardNodes: number; bytes: number; gzipBytes: number };
  source: { extract: string; url: string; md5: string; builtAt: string };
  license: string;
}

export interface TileFile {
  f: number;
  ty: number;
  tx: number;
  w: {
    i: number;
    t: Record<string, string>;
    n: number[];
    y: number[];
    x: number[];
    h?: number[];
    /** Hindrets typ för varje index i `h` (ett tecken vardera): t = secondary/tertiary (+ länkar), T = motorway/trunk/primary (+ länkar), r = järnväg, w = vattendrag. Saknas i äldre tiles. */
    k?: string;
  }[];
}

export interface TileWay {
  id: string;
  tags: Record<string, string>;
  nodes: { id: string; lat: number; lon: number }[];
  /** Index i `nodes` där vägen delar nod med större väg, järnväg eller vattendrag. */
  hazard: number[];
  /** Hindrets typ per index i `hazard` (se TileFile.k). Utelämnad när tilesen saknar uppgiften. */
  hazardKinds?: string[];
}

function undelta(d: number[]): number[] {
  const out = new Array<number>(d.length);
  let acc = 0;
  for (let i = 0; i < d.length; i++) out[i] = acc += d[i];
  return out;
}

export function decodeTile(tile: TileFile, unitDeg = 1e-6): TileWay[] {
  if (tile.f !== TILE_FORMAT) throw new Error(`Unknown tile format ${tile.f}`);
  return tile.w.map((w) => {
    const ids = undelta(w.n), la = undelta(w.y), lo = undelta(w.x);
    return {
      id: String(w.i),
      tags: w.t,
      nodes: ids.map((id, k) => ({ id: String(id), lat: la[k] * unitDeg, lon: lo[k] * unitDeg })),
      hazard: w.h ?? [],
      hazardKinds: w.k && w.h && w.k.length === w.h.length ? [...w.k] : undefined,
    };
  });
}

export const tileKey = (ty: number, tx: number) => `${ty}_${tx}`;

export function tileOf(p: LatLon, m: TileManifest["tile"]): [number, number] {
  return [Math.floor(p.lat / m.latStepDeg + 1e-9), Math.floor(p.lon / m.lonStepDeg + 1e-9)];
}

/** Alla tiles (ty,tx) vars ruta skär cirkeln med radien radiusM kring p (rektangulär approximation). */
export function tilesInRadius(p: LatLon, radiusM: number, m: TileManifest["tile"]): [number, number][] {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  const [t0, x0] = tileOf({ lat: p.lat - dLat, lon: p.lon - dLon }, m);
  const [t1, x1] = tileOf({ lat: p.lat + dLat, lon: p.lon + dLon }, m);
  const out: [number, number][] = [];
  for (let ty = t0; ty <= t1; ty++) for (let tx = x0; tx <= x1; tx++) out.push([ty, tx]);
  return out;
}
