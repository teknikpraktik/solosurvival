import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { AREAS, type AreaDef } from "../areas";
import { fromLocal, toLocal, type LatLon } from "@/geo/geometry";
import type { OverpassResponse } from "@/geo/osm/overpass";

export interface FixtureWay {
  type: "way";
  id: number;
  nodes: number[];
  geometry: ({ lat: number; lon: number } | null)[];
  tags?: Record<string, string>;
}
export interface FixtureRelation {
  type: "relation";
  id: number;
  tags: Record<string, string>;
  members: { type: "way"; ref: number; role: string; geometry: ({ lat: number; lon: number } | null)[] | null }[];
  complete: boolean;
}
export type FixtureElement = FixtureWay | FixtureRelation;

export interface Fixture {
  area: AreaDef;
  elements: FixtureElement[];
  ways: FixtureWay[];
  relations: FixtureRelation[];
  /** Lokalt metersystem: origo = SW-hörnet av bbox. */
  origin: LatLon;
  widthM: number;
  heightM: number;
}

const dir = path.join(import.meta.dirname, "..", "fixtures");

export function loadFixture(id: AreaDef["id"]): Fixture {
  const area = AREAS.find((a) => a.id === id)!;
  const raw = JSON.parse(gunzipSync(readFileSync(path.join(dir, `${id}.osm.json.gz`))).toString("utf8"));
  const elements = raw.elements as FixtureElement[];
  const [s, w, n, e] = area.bbox;
  const origin = { lat: s, lon: w };
  const ne = toLocal(origin, { lat: n, lon: e });
  return {
    area,
    elements,
    ways: elements.filter((x): x is FixtureWay => x.type === "way"),
    relations: elements.filter((x): x is FixtureRelation => x.type === "relation"),
    origin,
    widthM: ne.x,
    heightM: ne.y,
  };
}

/** Overpass-liknande svar (ways) som kan matas rakt in i `overpassToGraph`. */
export function asOverpass(fx: Fixture): OverpassResponse {
  return { elements: fx.ways as unknown as OverpassResponse["elements"] };
}

export type XY = [number, number];
export type Ring = XY[];

const key = (p: { lat: number; lon: number }) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;

/** Sätter ihop medlemsways till slutna ringar (slutna ringar + kedjor som möts i ändpunkter). Öppna kedjor returneras separat. */
export function assembleRings(
  members: { role: string; geometry: ({ lat: number; lon: number } | null)[] | null }[],
  role: "outer" | "inner",
): { closed: LatLon[][]; open: LatLon[][] } {
  const pieces: LatLon[][] = [];
  for (const m of members) {
    if (m.role !== role && !(role === "outer" && m.role === "")) continue;
    if (!m.geometry || m.geometry.some((p) => !p)) continue;
    pieces.push(m.geometry as LatLon[]);
  }
  const closed: LatLon[][] = [];
  const open: LatLon[][] = [];
  const pool = pieces.slice();
  while (pool.length) {
    let chain = pool.pop()!;
    for (let progress = true; progress && key(chain[0]) !== key(chain[chain.length - 1]); ) {
      progress = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        const head = key(chain[0]);
        const tail = key(chain[chain.length - 1]);
        if (key(p[0]) === tail) chain = [...chain, ...p.slice(1)];
        else if (key(p[p.length - 1]) === tail) chain = [...chain, ...p.slice(0, -1).reverse()];
        else if (key(p[p.length - 1]) === head) chain = [...p, ...chain.slice(1)];
        else if (key(p[0]) === head) chain = [...p.slice().reverse(), ...chain.slice(1)];
        else continue;
        pool.splice(i, 1);
        progress = true;
        break;
      }
    }
    (key(chain[0]) === key(chain[chain.length - 1]) && chain.length >= 4 ? closed : open).push(chain);
  }
  return { closed, open };
}

export function toLocalRing(fx: Fixture, pts: LatLon[]): Ring {
  return pts.map((p) => {
    const l = toLocal(fx.origin, p);
    return [l.x, l.y] as XY;
  });
}

/**
 * Sluter en öppen kedja mot bbox-kanten och returnerar de två möjliga regionerna (i meter).
 * Kedjan klipps mellan första inträde och sista utträde i rutan.
 */
export function splitBoxByChain(fx: Fixture, chain: Ring): [Ring, Ring] | null {
  const W = fx.widthM;
  const H = fx.heightM;
  const inside = (p: XY) => p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H;
  // Snittpunkter mellan segment och rektangelns kanter.
  const hits: { idx: number; t: number; pt: XY }[] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const [ax, ay] = chain[i];
    const [bx, by] = chain[i + 1];
    const cands: number[] = [];
    for (const X of [0, W]) if ((ax - X) * (bx - X) < 0) cands.push((X - ax) / (bx - ax));
    for (const Y of [0, H]) if ((ay - Y) * (by - Y) < 0) cands.push((Y - ay) / (by - ay));
    for (const t of cands) {
      const pt: XY = [ax + (bx - ax) * t, ay + (by - ay) * t];
      if (pt[0] >= -1e-6 && pt[0] <= W + 1e-6 && pt[1] >= -1e-6 && pt[1] <= H + 1e-6) hits.push({ idx: i, t, pt });
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.idx - b.idx || a.t - b.t);
  const first = hits[0];
  const last = hits[hits.length - 1];
  if (first === last) return null;
  const mid = chain.slice(first.idx + 1, last.idx + 1).filter(inside);
  const poly: Ring = [first.pt, ...mid, last.pt];
  // Perimeter-parameter (moturs, start i SW).
  const perim = (p: XY) => {
    const [x, y] = p;
    if (Math.abs(y) < 1e-3) return x;
    if (Math.abs(x - W) < 1e-3) return W + y;
    if (Math.abs(y - H) < 1e-3) return W + H + (W - x);
    return 2 * W + H + (H - y);
  };
  const corners: [number, XY][] = [[0, [0, 0]], [W, [W, 0]], [W + H, [W, H]], [2 * W + H, [0, H]]];
  const P = 2 * (W + H);
  const walk = (from: number, to: number, ccw: boolean): Ring => {
    const out: Ring = [];
    const span = ccw ? (to - from + P) % P : (from - to + P) % P;
    for (const [c, pt] of corners) {
      const d = ccw ? (c - from + P) % P : (from - c + P) % P;
      if (d > 1e-6 && d < span) out.push(pt);
    }
    out.sort((a, b) => {
      const da = ccw ? (perim(a) - from + P) % P : (from - perim(a) + P) % P;
      const db = ccw ? (perim(b) - from + P) % P : (from - perim(b) + P) % P;
      return da - db;
    });
    return out;
  };
  const pe = perim(first.pt);
  const px = perim(last.pt);
  return [
    [...poly, ...walk(px, pe, true)],
    [...poly, ...walk(px, pe, false)],
  ];
}

export { fromLocal };
