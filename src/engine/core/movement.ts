import type { Dir, TrailGraph } from "@/geo/graph/types";
import { edgeLatLon } from "@/geo/graph/graph";
import { rand, type RngHolder } from "./rng";
import type { Zombie } from "./types";

const MAX_NODE_HOPS = 64;

/** Zombiens geografiska position. */
export function zombieLatLon(g: TrailGraph, z: Pick<Zombie, "edgeId" | "distanceAlongEdgeM">) {
  return edgeLatLon(g, { edgeId: z.edgeId, distM: z.distanceAlongEdgeM });
}

/** Slumpar ett vägval vid en nod; vänder bara i återvändsgränder. */
function choosePatrolStep(g: TrailGraph, node: string, arrivedEdge: string, arrivedDir: Dir, rng: RngHolder) {
  const all = g.adj.get(node) ?? [];
  // Patrullerande zombier håller sig på stigarna (off-road används bara för att jaga/utreda).
  const options = all.some((a) => !g.edges.get(a.edgeId)!.offroad) ? all.filter((a) => !g.edges.get(a.edgeId)!.offroad) : all;
  const forward = options.filter((a) => !(a.edgeId === arrivedEdge && a.dir === -arrivedDir));
  const pool = forward.length ? forward : options;
  if (!pool.length) return null;
  return pool[Math.floor(rand(rng) * pool.length)];
}

/**
 * Flyttar zombien `distM` längs nätet. Zombien kan bara byta kant i en nod som kanterna delar,
 * vilket utesluter teleportering och hopp mellan segment. Returnerar sant om den nådde `stopAtM`.
 */
export function advanceZombie(g: TrailGraph, z: Zombie, distM: number, rng: RngHolder): boolean {
  let remaining = distM;
  for (let hops = 0; hops < MAX_NODE_HOPS; hops++) {
    const e = g.edges.get(z.edgeId);
    if (!e) return false;

    if (z.stopAtM !== undefined && z.route.length === 0) {
      const toStop = (z.stopAtM - z.distanceAlongEdgeM) * z.dir;
      if (toStop <= 0) {
        z.distanceAlongEdgeM = z.stopAtM;
        z.stopAtM = undefined;
        return true;
      }
      if (remaining < toStop) {
        z.distanceAlongEdgeM += z.dir * remaining;
        return false;
      }
      z.distanceAlongEdgeM = z.stopAtM;
      z.stopAtM = undefined;
      return true;
    }

    const toEnd = z.dir === 1 ? e.lengthM - z.distanceAlongEdgeM : z.distanceAlongEdgeM;
    if (remaining < toEnd) {
      z.distanceAlongEdgeM += z.dir * remaining;
      return false;
    }
    remaining -= toEnd;
    const node = z.dir === 1 ? e.to : e.from;
    z.distanceAlongEdgeM = z.dir === 1 ? e.lengthM : 0;

    let next: { edgeId: string; dir: Dir } | null = null;
    while (z.route.length) {
      const step = z.route.shift()!;
      const se = g.edges.get(step.edgeId);
      const startsHere = se && (step.dir === 1 ? se.from === node : se.to === node);
      if (startsHere && !(step.dir === -1 && se.oneway)) {
        next = step;
        break;
      }
      // Ogiltig rutt (grafen ändrades eller planen var inkonsekvent): släpp den.
      z.route = [];
      z.stopAtM = undefined;
    }
    if (!next) next = choosePatrolStep(g, node, z.edgeId, z.dir, rng);
    if (!next) {
      z.dir = (-z.dir) as Dir;
      continue;
    }
    const ne = g.edges.get(next.edgeId)!;
    z.edgeId = ne.id;
    z.dir = next.dir;
    z.distanceAlongEdgeM = next.dir === 1 ? 0 : ne.lengthM;
  }
  return false;
}
