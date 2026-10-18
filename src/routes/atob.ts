import { haversineM, type LatLon } from "@/geo/geometry";
import { edgeLatLon, snapToGraph } from "@/geo/graph/graph";
import type { TrailGraph } from "@/geo/graph/types";
import { addPenalty, joinGeometry, legBetween, legSteps, type Leg } from "./pathing";
import type { RouteMetrics, RouteProposal } from "./types";

/** Punkt längre från närmaste stig än så får inte väljas (samma gräns som övrig ruttgenerering). */
export const AB_MAX_SNAP_M = 150;

export type AtoBStatus = "ok" | "a_off" | "b_off" | "too_close" | "no_path";

export interface AtoBResult {
  status: AtoBStatus;
  /** Avstånd (m) från A respektive B till närmaste stig i A:s nät (om funnet). */
  aSnapM: number | null;
  bSnapM: number | null;
  proposals: RouteProposal[];
  notes: string[];
}

const jaccard = (a: string[], b: string[], g: TrailGraph) => {
  const A = new Set(a), B = new Set(b);
  let inter = 0, uni = 0;
  for (const id of new Set([...A, ...B])) { const l = g.edges.get(id)!.lengthM; uni += l; if (A.has(id) && B.has(id)) inter += l; }
  return uni ? inter / uni : 0;
};

/**
 * Rutt för "A TO B" där spelaren själv valt A och B: kortaste väg längs nätet plus upp till två tydligt olika alternativ
 * (straff på redan använda kanter; längd ≤ 1,6 × kortaste). Längden är resultatet av valen, ingen önskad sträcka.
 * B måste ligga på/nära (≤ 150 m) en stig som hör till samma sammanhängande nät som A, annars avslås valet med förklaring.
 */
export function generateAtoB(g: TrailGraph, a: LatLon, b: LatLon, hazardNodes: Set<string>, minStraightM = 300): AtoBResult {
  const notes: string[] = [];
  const sa = snapToGraph(g, a);
  const sb = snapToGraph(g, b);
  const empty = (status: AtoBStatus): AtoBResult => ({ status, aSnapM: sa?.offNetworkM ?? null, bSnapM: sb?.offNetworkM ?? null, proposals: [], notes });
  if (!sa || sa.offNetworkM > AB_MAX_SNAP_M) return empty("a_off");
  if (!sb || sb.offNetworkM > AB_MAX_SNAP_M) return empty("b_off");
  const aLL = edgeLatLon(g, sa), bLL = edgeLatLon(g, sb);
  if (haversineM(aLL, bLL) < minStraightM) return empty("too_close");

  const legs: Leg[] = [];
  const first = legBetween(g, sa, sb);
  if (!first) return empty("no_path");
  legs.push(first);
  const shortest = first.lengthM;
  const pen = new Map<string, number>();
  for (let k = 0; k < 4 && legs.length < 3; k++) {
    addPenalty(pen, legs[legs.length - 1].edgeIds.slice(1, -1), 8);
    const alt = legBetween(g, sa, sb, pen);
    if (!alt || alt.lengthM > shortest * 1.6) continue;
    if (legs.every((l) => jaccard(l.edgeIds, alt.edgeIds, g) < 0.6)) legs.push(alt);
  }

  const destEdge = g.edges.get(sb.edgeId)!;
  const proposals = legs.map((leg, i): RouteProposal => {
    const flags: string[] = [];
    let hazards = 0;
    for (const id of leg.edgeIds) { const e = g.edges.get(id)!; for (const n of [e.from, e.to]) if (hazardNodes.has(n)) hazards += 0.5; }
    hazards = Math.round(hazards);
    const direct = haversineM(aLL, bLL);
    const metrics: RouteMetrics = {
      reuseShare: 0, deadEndShare: 0, maxWaypointDeadEndDepthM: 0, decisionPoints: 0, hazardCrossings: hazards,
      minWaypointExits: 2, alternativeRatio: legs.length > 1 ? legs[0].lengthM / leg.lengthM : null, directness: direct / leg.lengthM,
    };
    let score = 100;
    if (hazards > 0) { score -= 20; flags.push(`${hazards} crossing(s) with a major road`); }
    if (metrics.directness < 0.5) { score -= 10; flags.push("the route is more than twice as long as the straight line"); }
    if (hazardNodes.has(destEdge.from) || hazardNodes.has(destEdge.to)) flags.push("B is close to a major road – be careful");
    return {
      id: `atob-${i}`, mode: "escape", type: "point-to-point",
      waypoints: [{ id: "B", kind: "destination", nodeId: destEdge.from, lat: bLL.lat, lon: bLL.lon }],
      lengthM: leg.lengthM, deviation: 0, withinTolerance: true,
      geometry: joinGeometry([leg]), edgeIds: [...new Set(leg.edgeIds)], path: legSteps(g, leg, true),
      metrics, quality: { score: Math.max(0, score), flags },
    };
  });
  if (proposals.length < 2) notes.push("Only one reasonable way was found between A and B.");
  return { status: "ok", aSnapM: sa.offNetworkM, bSnapM: sb.offNetworkM, proposals, notes };
}
