import { haversineM, type LatLon } from "@/geo/geometry";
import type { TrailGraph } from "@/geo/graph/types";
import { zombieLatLon } from "../core/movement";
import type { Zombie } from "../core/types";

/**
 * Zombier som jagar i grupp hamnar till slut på samma ställe längs nätet och följer sedan samma väg: de är i praktiken en enda zombie
 * men ritas som en hög markörer (tungt för kartan på cykel, fälttest). Av zombier som ligger inom STACK_RADIUS_M av varandra längs nätet,
 * jagar i samma läge och är minst STACK_MIN_PLAYER_M från spelaren behålls bara den som är närmast spelaren. Spelaren ser ingen skillnad:
 * kvar står en zombie på samma ställe, och ingen tas bort i närheten.
 */
export const STACK_RADIUS_M = 40;
export const STACK_MIN_PLAYER_M = 250;

/** Avstånd längs nätet mellan två zombier när de står på samma kant eller på kanter som möts i en nod, annars Infinity. */
function stackGapM(g: TrailGraph, a: Zombie, b: Zombie): number {
  if (a.edgeId === b.edgeId) return Math.abs(a.distanceAlongEdgeM - b.distanceAlongEdgeM);
  const ea = g.edges.get(a.edgeId), eb = g.edges.get(b.edgeId);
  if (!ea || !eb) return Infinity;
  const toNode = (e: typeof ea, d: number, node: string) => (node === e.from ? d : node === e.to ? e.lengthM - d : Infinity);
  let best = Infinity;
  for (const n of [ea.from, ea.to]) best = Math.min(best, toNode(ea, a.distanceAlongEdgeM, n) + toNode(eb, b.distanceAlongEdgeM, n));
  return best;
}

/** Tar bort överflödiga zombier i högar (se ovan). Muterar `zombies` och returnerar id:n på de borttagna. */
export function cullStackedZombies(g: TrailGraph, zombies: Zombie[], player: LatLon): string[] {
  const chasing = zombies
    .filter((z) => (z.state === "chase" || z.state === "intercept") && z.sprintUntilS === undefined)
    .map((z) => ({ z, d: haversineM(zombieLatLon(g, z), player) }))
    .filter((x) => x.d >= STACK_MIN_PLAYER_M)
    .sort((a, b) => a.d - b.d);
  const kept: Zombie[] = [];
  const removed = new Set<string>();
  for (const { z } of chasing) {
    if (kept.some((k) => k.state === z.state && stackGapM(g, k, z) <= STACK_RADIUS_M)) removed.add(z.id);
    else kept.push(z);
  }
  if (!removed.size) return [];
  for (let i = zombies.length - 1; i >= 0; i--) if (removed.has(zombies[i].id)) zombies.splice(i, 1);
  return [...removed];
}
