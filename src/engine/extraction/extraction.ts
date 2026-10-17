import { haversineM, type LatLon } from "@/geo/geometry";
import { degreeOf } from "@/geo/graph/graph";
import type { EdgePos, TrailGraph } from "@/geo/graph/types";
import { networkDistances } from "../pathfinding/astar";
import { rand, type RngHolder } from "../core/rng";

export interface ExtractionContext {
  playerPos: EdgePos;
  component: number;
  zombiePositions: LatLon[];
  remainingS: number;
  playerPaceMps: number;
  /** Zombier närmare än så här gör en punkt olämplig (etablerad infektionszon). */
  zombieExclusionM?: number;
}

/** Andel av tillgänglig tid×fart som får gå åt – lämnar marginal för säker förflyttning (PRD 5.5). */
const REACH_SAFETY = 0.6;

/**
 * Väljer en extraction-nod på nätet: i spelarens komponent, nåbar inom rimlig tid, ingen återvändsgränd,
 * inte nära zombier. Reservförfarande: släpper zombiekravet innan punkten underkänns helt.
 */
export function chooseExtraction(g: TrailGraph, ctx: ExtractionContext, rng: RngHolder): string | null {
  const reachM = ctx.playerPaceMps * ctx.remainingS * REACH_SAFETY;
  const dists = networkDistances(g, ctx.playerPos, reachM);
  const exclusion = ctx.zombieExclusionM ?? 80;

  const score = (id: string, strict: boolean) => {
    const d = dists.get(id);
    if (d === undefined || d > reachM || d < 60) return null;
    const node = g.nodes.get(id)!;
    if (degreeOf(g, id) < 2) return null;
    const nearestZ = ctx.zombiePositions.reduce((m, z) => Math.min(m, haversineM(z, node)), Infinity);
    if (strict && nearestZ < exclusion) return null;
    // Föredra mellanstora avstånd (spelaren måste röra sig men inte maxa) och långt från zombier.
    const ratio = d / reachM;
    return Math.min(nearestZ, 400) / 400 + (1 - Math.abs(ratio - 0.5) * 2) * 0.5;
  };

  const compNodes = new Set<string>();
  for (const e of g.edges.values()) {
    if (e.component === ctx.component) {
      compNodes.add(e.from);
      compNodes.add(e.to);
    }
  }
  for (const strict of [true, false]) {
    const ranked = [...compNodes]
      .map((id) => ({ id, s: score(id, strict) }))
      .filter((x): x is { id: string; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : 1))
      .slice(0, 5);
    if (ranked.length) return ranked[Math.floor(rand(rng) * ranked.length)].id;
  }
  return null;
}
