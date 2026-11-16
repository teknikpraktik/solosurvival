/**
 * Laying out a mission on the local network: the course of a checkpoint mission, the destination of an A to B mission. Uses Free Play's
 * preparation (map data, region graph, course generator, A to B routing) and only adds what a mission needs on top.
 */
import { rand, type RngHolder } from "@/engine/core/rng";
import { networkDistances } from "@/engine/pathfinding/astar";
import { haversineM, type LatLon } from "@/geo/geometry";
import { snapToGraph } from "@/geo/graph/graph";
import type { TrailGraph } from "@/geo/graph/types";
import type { WayStore } from "@/data/store";
import type { MatchParams } from "@/play/config";
import { prepareMatch, type PrepareOptions, type Prepared } from "@/play/prepare";
import { analyzeNetwork } from "@/routes/analysis";
import type { RouteProposal } from "@/routes/types";
import type { MissionDef } from "./types";

/**
 * A checkpoint mission's course from the generator's loop: the first `count` checkpoints, no return home (a mission ends at its last
 * goal). Null when the loop has fewer than `minCount` checkpoints.
 */
export function trimCourse(p: RouteProposal, start: LatLon, count: number, minCount: number): RouteProposal | null {
  const cps = p.waypoints.filter((w) => w.kind === "checkpoint").slice(0, count);
  if (cps.length < minCount) return null;
  const pts: LatLon[] = [start, ...cps.map((w) => ({ lat: w.lat, lon: w.lon }))];
  const lengthM = pts.reduce((s, q, i) => s + (i ? haversineM(pts[i - 1], q) : 0), 0);
  return { ...p, type: "point-to-point", waypoints: cps, geometry: pts, lengthM, deviation: 0, withinTolerance: true };
}

/** Distances (as shares of the wanted route length) a destination is looked for in, best first: the wanted distance, then wider, then anything walkable. */
const DESTINATION_BANDS: readonly [number, number][] = [[0.8, 1.25], [0.55, 1.5], [0.3, 1.6]];
const DESTINATION_MIN_M = 400;

/**
 * A destination for an A to B mission: a point on the route network (never across a major road, never in a dead end, with at least two
 * ways out) about `routeLengthM` from the start along the network. Among the fitting points the ones farthest away as the crow flies are
 * preferred (a destination "round the corner" makes a dull escape), and the seed picks one of the best. Null when the connected network
 * around the start is too small for any band.
 */
export function pickDestination(g: TrailGraph, start: LatLon, hazardNodes: Set<string>, routeLengthM: number, seed: number): LatLon | null {
  const snap = snapToGraph(g, start);
  if (!snap || snap.offNetworkM > 150) return null;
  const dists = networkDistances(g, snap, routeLengthM * DESTINATION_BANDS[DESTINATION_BANDS.length - 1][1]);
  const an = analyzeNetwork(g);
  const rng: RngHolder = { rngState: (seed * 2246822519) >>> 0 };
  for (const [lo, hi] of DESTINATION_BANDS) {
    const min = Math.max(DESTINATION_MIN_M, lo * routeLengthM), max = hi * routeLengthM;
    const cands: { p: LatLon; straight: number }[] = [];
    for (const [id, d] of dists) {
      if (d < min || d > max || hazardNodes.has(id) || (an.deadEndDepthM.get(id) ?? 0) > 0 || (g.adj.get(id)?.length ?? 0) < 2) continue;
      const n = g.nodes.get(id);
      if (!n) continue;
      const straight = haversineM(start, n);
      if (straight < DESTINATION_MIN_M * 0.75) continue;
      cands.push({ p: { lat: n.lat, lon: n.lon }, straight });
    }
    if (!cands.length) continue;
    cands.sort((a, b) => b.straight - a.straight || a.p.lat - b.p.lat || a.p.lon - b.p.lon);
    const top = cands.slice(0, Math.min(6, cands.length));
    return top[Math.floor(rand(rng) * top.length)].p;
  }
  return null;
}

/**
 * Loads the map around the player and lays out the mission's goals there. The result is what Free Play's preparation returns (same
 * statuses and messages: outside the mapped area, too far from a trail, too little network), so the caller handles both alike.
 * A mission is only offered when its goals can really be reached on the local network; with a small network the generator's closest
 * course is used, down to the mission's minimum number of goals, before the mission is refused.
 */
export async function prepareMission(store: WayStore, start: LatLon, m: MissionDef, p: MatchParams, opts: PrepareOptions = {}): Promise<Prepared> {
  const l = m.layout;
  if (l.kind === "destination") {
    const r = await prepareMatch(store, start, p, { ...opts, autoDestination: (g, s, hazard) => pickDestination(g, s, hazard, l.routeLengthM, p.seed) });
    // One route is enough: any way to the destination counts, the line on the map is only a hint.
    return r.proposals.length > 1 ? { ...r, proposals: r.proposals.slice(0, 1) } : r;
  }
  const r = await prepareMatch(store, start, p, opts);
  if (l.kind !== "checkpoints") return r;
  if ((r.status !== "ok" && r.status !== "alternative") || !r.proposals.length) return r;
  const course = trimCourse(r.proposals[0], start, l.count, l.minCount);
  if (!course) return { ...r, status: "no_route", proposals: [], message: "Too few reachable places around you for this mission. Move to an area with more connected paths and try again." };
  return { ...r, status: "ok", message: undefined, proposals: [course] };
}
