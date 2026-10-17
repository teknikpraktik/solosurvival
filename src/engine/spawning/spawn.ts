import { haversineM, type LatLon } from "@/geo/geometry";
import { edgeLatLon } from "@/geo/graph/graph";
import type { EdgePos, TrailGraph } from "@/geo/graph/types";
import { distanceToPos, networkDistances } from "../pathfinding/astar";
import { rand, type RngHolder } from "../core/rng";

export interface SpawnContext {
  player: LatLon;
  playerPos: EdgePos;
  component: number;
  zombiePositions: LatLon[];
  minDistanceM: number;
  /** Minsta avstånd till andra zombier, så att nya inte hamnar i en klunga. */
  minSpacingM?: number;
  tries?: number;
  /** Zoner där zombier inte får spawna (t.ex. runt checkpoints och destination). */
  avoid?: { p: LatLon; r: number }[];
}

/**
 * Väljer en säker spawnpunkt på nätet eller null (PRD 3.4): i spelarens komponent, minst `minDistanceM`
 * bort både fågelvägen och längs nätet, och inte ovanpå en annan zombie.
 */
export function findSpawn(g: TrailGraph, ctx: SpawnContext, rng: RngHolder): EdgePos | null {
  const edges = [...g.edges.values()].filter((e) => e.component === ctx.component);
  if (!edges.length) return null;
  const total = edges.reduce((s, e) => s + e.lengthM, 0);
  const dists = networkDistances(g, ctx.playerPos);
  const spacing = ctx.minSpacingM ?? 100;

  for (let i = 0; i < (ctx.tries ?? 60); i++) {
    // Längdviktad slumpning av kant.
    let r = rand(rng) * total;
    let edge = edges[edges.length - 1];
    for (const e of edges) {
      r -= e.lengthM;
      if (r <= 0) {
        edge = e;
        break;
      }
    }
    const pos: EdgePos = { edgeId: edge.id, distM: rand(rng) * edge.lengthM };
    const ll = edgeLatLon(g, pos);
    if (haversineM(ll, ctx.player) < ctx.minDistanceM) continue;
    // Oriktade nät: avståndet från spelaren till spawn räknas längs nätet.
    if (distanceToPos(g, ctx.playerPos, dists, pos) < ctx.minDistanceM) continue;
    if (ctx.zombiePositions.some((z) => haversineM(z, ll) < spacing)) continue;
    if (ctx.avoid?.some((a) => haversineM(a.p, ll) < a.r)) continue;
    return pos;
  }
  return null;
}
