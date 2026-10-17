import { nearbyEdges } from "@/geo/graph/graph";
import type { EdgePos, TrailGraph } from "@/geo/graph/types";
import type { LatLon } from "@/geo/geometry";

export interface MatchResult {
  /** Satt bara när kopplingen är tillräckligt säker. */
  match: EdgePos | null;
  ambiguous: boolean;
}

/**
 * Projicerar spelaren mot närmaste stig, men bara när det är entydigt (PRD 6.5).
 * Flera parallella kandidater på olika kanter inom `ambiguityM` av varandra ger ambiguous = true.
 * Resultatet används för visualisering/AI-observationer – aldrig ensamt för infektion.
 */
export function matchToNetwork(
  g: TrailGraph,
  pos: LatLon,
  accuracyM: number,
  ambiguityM = 6,
): MatchResult {
  const radius = Math.max(15, accuracyM * 1.5);
  const cands = nearbyEdges(g, pos, radius);
  if (!cands.length) return { match: null, ambiguous: false };
  const best = cands[0];
  const rival = cands.find((c) => c.edgeId !== best.edgeId && c.offNetworkM - best.offNetworkM < ambiguityM);
  if (rival) {
    // Grannkanter som delar en nod nära korsningen är inte en verklig tvetydighet.
    const a = g.edges.get(best.edgeId)!;
    const b = g.edges.get(rival.edgeId)!;
    const shared = [a.from, a.to].some((n) => n === b.from || n === b.to);
    if (!shared) return { match: null, ambiguous: true };
  }
  return { match: { edgeId: best.edgeId, distM: best.distM }, ambiguous: false };
}
