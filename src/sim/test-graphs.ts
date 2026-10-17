import { buildGraph, type RawWay } from "@/geo/graph/build";
import { indexGraph } from "@/geo/graph/graph";
import { fromLocal, type LatLon } from "@/geo/geometry";
import type { TrailGraph } from "@/geo/graph/types";

/** Origo för syntetiska nät (Värmland). */
export const ORIGIN: LatLon = { lat: 59.38, lon: 13.5 };

type XY = [number, number];

function way(id: string, pts: { id: string; xy: XY }[], extra: Partial<RawWay> = {}): RawWay {
  return {
    id,
    type: "path",
    nodes: pts.map((p) => {
      const ll = fromLocal(ORIGIN, { x: p.xy[0], y: p.xy[1] });
      return { id: p.id, lat: ll.lat, lon: ll.lon };
    }),
    ...extra,
  };
}

const g = (ways: RawWay[]): TrailGraph => indexGraph(buildGraph(ways, "synthetic"));

/** Rak stig (längd i meter) längs x-axeln med noder var 100:e meter. */
export function lineGraph(lengthM = 2000): TrailGraph {
  const pts = [];
  for (let x = 0; x <= lengthM; x += 100) pts.push({ id: `n${x}`, xy: [x, 0] as XY });
  return g([way("line", pts)]);
}

/** Rutnät rows×cols med given cellstorlek: många korsningar, många vägval. */
export function gridGraph(rows: number, cols: number, cellM = 150): TrailGraph {
  const ways: RawWay[] = [];
  for (let r = 0; r < rows; r++) {
    ways.push(way(`r${r}`, Array.from({ length: cols }, (_, c) => ({ id: `g${r}_${c}`, xy: [c * cellM, r * cellM] as XY }))));
  }
  for (let c = 0; c < cols; c++) {
    ways.push(way(`c${c}`, Array.from({ length: rows }, (_, r) => ({ id: `g${r}_${c}`, xy: [c * cellM, r * cellM] as XY }))));
  }
  return g(ways);
}

/** Korsning med tre vägar (T) som slutar i återvändsgränder. */
export function starGraph(armM = 500): TrailGraph {
  return g([
    way("w", [{ id: "c", xy: [0, 0] }, { id: "w1", xy: [-armM / 2, 0] }, { id: "w2", xy: [-armM, 0] }]),
    way("e", [{ id: "c", xy: [0, 0] }, { id: "e1", xy: [armM / 2, 0] }, { id: "e2", xy: [armM, 0] }]),
    way("n", [{ id: "c", xy: [0, 0] }, { id: "n1", xy: [0, armM / 2] }, { id: "n2", xy: [0, armM] }]),
  ]);
}

/** Cirkulärt stignät. */
export function ringGraph(radiusM = 400, segments = 24): TrailGraph {
  const pts = Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * 2 * Math.PI;
    return { id: `p${i}`, xy: [Math.cos(a) * radiusM, Math.sin(a) * radiusM] as XY };
  });
  pts.push({ ...pts[0] });
  return g([way("ring", pts)]);
}

/** Två skilda komponenter: en rak stig och en parallell 300 m bort utan förbindelse. */
export function twoComponentGraph(): TrailGraph {
  const a = Array.from({ length: 21 }, (_, i) => ({ id: `a${i}`, xy: [i * 100, 0] as XY }));
  const b = Array.from({ length: 21 }, (_, i) => ({ id: `b${i}`, xy: [i * 100, 300] as XY }));
  return g([way("A", a), way("B", b)]);
}

/** Två stigar som korsar varandra geometriskt (bro) men inte delar nod. */
export function bridgeGraph(): TrailGraph {
  return g([
    way("under", [{ id: "u0", xy: [-300, 0] }, { id: "u1", xy: [0, 0] }, { id: "u2", xy: [300, 0] }]),
    way("over", [{ id: "o0", xy: [0, -300] }, { id: "o1", xy: [0, 0.1] }, { id: "o2", xy: [0, 300] }]),
  ]);
}
