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
  // Extraction is never placed across a major road: edges at mapped crossings do not count as reachable.
  const dists = networkDistances(g, ctx.playerPos, reachM, (e) => !!e.crossing);
  const exclusion = ctx.zombieExclusionM ?? 80;
  // The helicopter lands on a road or trail the map shows, never on a point of the terrain mesh (edges across open ground, not drawn).
  const realEdges = (id: string) => (g.adj.get(id) ?? []).reduce((n, a) => n + (g.edges.get(a.edgeId)?.offtrail ? 0 : 1), 0);

  const score = (id: string, strict: boolean, minReal = 2) => {
    const d = dists.get(id);
    if (d === undefined || d > reachM || d < 60) return null;
    const node = g.nodes.get(id)!;
    if (degreeOf(g, id) < 2 || realEdges(id) < minReal || g.crossingNodes.has(id)) return null;
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
  // Wanted: on a road or trail that goes on in two directions. Last resort: the end of one (still on the map), never open ground.
  for (const [strict, minReal] of [[true, 2], [false, 2], [true, 1], [false, 1]] as const) {
    const ranked = [...compNodes]
      .map((id) => ({ id, s: score(id, strict, minReal) }))
      .filter((x): x is { id: string; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : 1))
      .slice(0, 5);
    if (ranked.length) return ranked[Math.floor(rand(rng) * ranked.length)].id;
  }
  return null;
}
