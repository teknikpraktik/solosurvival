import { haversineM, type LatLon } from "@/geo/geometry";
import { edgeLatLon } from "@/geo/graph/graph";
import type { EdgePos, TrailGraph } from "@/geo/graph/types";
import { distanceToPos, networkDistances } from "../pathfinding/astar";
import { zombieLatLon } from "../core/movement";
import type { Zombie } from "../core/types";

/** Zombies farther away than this (straight line) cannot infect, so the (costlier) network check is skipped for them. */
export const CONTACT_CHECK_M = 30;
/** A zombie only counts as in contact if the way between it and the player is at most this many times the straight-line distance, plus a margin. */
export const CONTACT_DETOUR_FACTOR = 2;
export const CONTACT_SLACK_M = 15;
const NETWORK_SEARCH_M = 150;

/**
 * Distance (m) to the nearest zombie that can actually reach the player, for infection.
 * Straight-line distance alone lets a zombie "infect" a player on the other side of a road, railway or building even though there is
 * no passage between them. A zombie is in contact when the walking distance along the network (from the zombie to the player's
 * position on the network, plus the player's distance off the network) is not much longer than the straight line.
 * Without a network position for the player the plain straight-line distance is used.
 */
export function infectionContactM(g: TrailGraph, player: LatLon, snap: EdgePos | null, zombies: Pick<Zombie, "edgeId" | "distanceAlongEdgeM">[]): number {
  let best = Infinity;
  let dists: Map<string, number> | null = null;
  let offsetM = 0;
  for (const z of zombies) {
    const d = haversineM(zombieLatLon(g, z), player);
    if (d >= best) continue;
    if (d > CONTACT_CHECK_M || !snap) {
      best = d;
      continue;
    }
    if (!dists) {
      dists = networkDistances(g, snap, NETWORK_SEARCH_M);
      offsetM = haversineM(player, edgeLatLon(g, snap));
    }
    const net = distanceToPos(g, snap, dists, { edgeId: z.edgeId, distM: z.distanceAlongEdgeM }) + offsetM;
    if (net <= CONTACT_DETOUR_FACTOR * d + CONTACT_SLACK_M) best = d;
  }
  return best;
}
