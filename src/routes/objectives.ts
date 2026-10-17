import { createObjectives, type ObjectiveSet } from "@/engine/objectives/objectives";
import type { RouteProposal } from "./types";

/** Gör om ett ruttförslag till mål för spelmotorn. Destination/checkpoints/hem i den ordning de ska besökas. */
export function objectivesFromProposal(p: RouteProposal): ObjectiveSet {
  return createObjectives(p.waypoints.map((w) => ({ id: w.id, kind: w.kind, lat: w.lat, lon: w.lon, nodeId: w.nodeId })));
}
