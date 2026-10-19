import { haversineM, toLocal, type LatLon } from "@/geo/geometry";
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
  /** Högsta fågelvägsavstånd till spelaren (och 1,5 × längs nätet). Utelämnat = ingen gräns. */
  maxDistanceM?: number;
  /** Minsta avstånd till andra zombier, så att nya inte hamnar i en klunga. */
  minSpacingM?: number;
  tries?: number;
  /**
   * A TO B: nya zombier ska uppstå mellan A och B (inte bakom A eller bortom B) så att de försöker stoppa spelaren.
   * Punktens projektion på linjen A→B ska ligga i [minT, maxT] (0 = A, 1 = B) och högst `halfWidthM` från linjen.
   */
  corridor?: { a: LatLon; b: LatLon; halfWidthM: number; minT: number; maxT: number };
  /** Spread start: spawn within [minR, maxR] metres of this point (e.g. a mission checkpoint). */
  near?: { p: LatLon; minR: number; maxR: number };
  /** Zoner där zombier inte får spawna (t.ex. runt checkpoints och destination). */
  avoid?: { p: LatLon; r: number }[];
}

/** Ligger punkten mellan A och B (projektion på linjen) och inom korridorens halva bredd? */
export function inCorridor(p: LatLon, c: NonNullable<SpawnContext["corridor"]>): boolean {
  const b = toLocal(c.a, c.b);
  const q = toLocal(c.a, p);
  const len2 = b.x * b.x + b.y * b.y;
  if (len2 === 0) return false;
  const t = (q.x * b.x + q.y * b.y) / len2;
  if (t < c.minT || t > c.maxT) return false;
  const px = q.x - t * b.x, py = q.y - t * b.y;
  return Math.hypot(px, py) <= c.halfWidthM;
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

  // Med övre gräns är träffytan mindre: fler försök (varje försök är billigt).
  for (let i = 0; i < (ctx.tries ?? (ctx.near ? 800 : ctx.maxDistanceM !== undefined ? 400 : 60)); i++) {
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
    const direct = haversineM(ll, ctx.player);
    if (direct < ctx.minDistanceM) continue;
    if (ctx.maxDistanceM !== undefined && direct > ctx.maxDistanceM) continue;
    // Oriktade nät: avståndet från spelaren till spawn räknas längs nätet.
    const net = distanceToPos(g, ctx.playerPos, dists, pos);
    if (net < ctx.minDistanceM) continue;
    if (ctx.maxDistanceM !== undefined && net > ctx.maxDistanceM * 1.5) continue;
    if (ctx.near) { const dn = haversineM(ll, ctx.near.p); if (dn < ctx.near.minR || dn > ctx.near.maxR) continue; }
    if (ctx.corridor && !inCorridor(ll, ctx.corridor)) continue;
    if (ctx.zombiePositions.some((z) => haversineM(z, ll) < spacing)) continue;
    if (ctx.avoid?.some((a) => haversineM(a.p, ll) < a.r)) continue;
    return pos;
  }
  return null;
}
