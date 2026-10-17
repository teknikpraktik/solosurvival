import { rand, type RngHolder } from "@/engine/core/rng";
import type { LatLon } from "@/geo/geometry";
import { edgeLatLon } from "@/geo/graph/graph";
import type { TrailGraph } from "@/geo/graph/types";

/** Slumpad startpunkt längs stigarna (längdviktad), deterministisk per seed. */
export function randomStart(g: TrailGraph, seed: number): LatLon {
  const rng: RngHolder = { rngState: (seed * 40503 + 7) >>> 0 };
  const edges = [...g.edges.values()];
  const total = edges.reduce((s, e) => s + e.lengthM, 0);
  let r = rand(rng) * total;
  for (const e of edges) {
    r -= e.lengthM;
    if (r <= 0) return edgeLatLon(g, { edgeId: e.id, distM: rand(rng) * e.lengthM });
  }
  return edgeLatLon(g, { edgeId: edges[0].id, distM: edges[0].lengthM / 2 });
}
