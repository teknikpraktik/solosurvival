import { ACTIVITIES } from "@/config/activities";
import { buildRegionGraph, MAX_START_SNAP_M, type RegionGraph } from "@/data/region-graph";
import type { LoadStats, TileStore } from "@/data/store";
import type { LatLon } from "@/geo/geometry";
import { indexGraph } from "@/geo/graph/graph";
import type { TrailGraph } from "@/geo/graph/types";
import { generateCourse } from "@/routes/course";
import type { RouteProposal } from "@/routes/types";
import { A_TO_B_MIN_STRAIGHT_M, atoBMaxStraightM, dataCenter, dataRadiusM, type MatchParams } from "./config";
import { generateAtoB } from "@/routes/atob";
import { haversineM } from "@/geo/geometry";

export type PrepareStatus =
  | "ok"
  | "outside_region" // utanför det kartlagda området
  | "off_network" // för långt från närmaste tillåtna stig
  | "sparse" // för lite stigdata för önskad sträcka
  | "alternative" // inget förslag inom toleransen; närmaste alternativ erbjuds
  | "no_route"; // generatorn hittade inget acceptabelt förslag

export interface Prepared {
  status: PrepareStatus;
  /** Svensk text som kan visas för spelaren. */
  message?: string;
  region?: RegionGraph;
  graph?: TrailGraph;
  proposals: RouteProposal[];
  notes: string[];
  load?: LoadStats;
  timing: { loadMs: number; graphMs: number; routeMs: number; totalMs: number };
  dataVersion?: string;
}

const emptyTiming = { loadMs: 0, graphMs: 0, routeMs: 0, totalMs: 0 };


/**
 * Hämtar regionala tiles, bygger aktivitetens stignät och genererar ruttförslag från den verkliga startpositionen.
 * Hellre ett tydligt avslag med förklaring än en dålig rutt (säkerhetsprincip).
 */
export async function prepareMatch(store: TileStore, start: LatLon, p: MatchParams): Promise<Prepared> {
  const t0 = performance.now();
  const base = { proposals: [], notes: [] as string[], timing: { ...emptyTiming } };
  const manifest = await store.loadManifest();
  if (!store.covers(start)) {
    return { ...base, status: "outside_region", message: "You are outside the area the game has map data for (Värmland, Sweden).", dataVersion: manifest.dataVersion };
  }
  const atob = p.mode === "escape" && !!p.pointB;
  if (atob) {
    const straight = haversineM(start, p.pointB!);
    if (straight > atoBMaxStraightM(p.activity)) {
      return { ...base, status: "sparse", message: `A and B are too far apart (${(straight / 1000).toFixed(1)} km). The maximum for this activity is ${(atoBMaxStraightM(p.activity) / 1000).toFixed(0)} km.`, dataVersion: manifest.dataVersion };
    }
    if (straight < A_TO_B_MIN_STRAIGHT_M) {
      return { ...base, status: "no_route", message: `A and B are too close together (at least ${A_TO_B_MIN_STRAIGHT_M} m). Pick a B further away.`, dataVersion: manifest.dataVersion };
    }
    if (!store.covers(p.pointB!)) {
      return { ...base, status: "outside_region", message: "B is outside the area the game has map data for (Värmland, Sweden).", dataVersion: manifest.dataVersion };
    }
  }
  const radius = dataRadiusM(p);
  const center = dataCenter(p, start);
  const t1 = performance.now();
  const { ways, stats } = await store.loadAround(center, radius);
  const t2 = performance.now();
  const region = buildRegionGraph(ways, p.activity, center, radius, start, { strict: p.mode !== "survival" });
  const t3 = performance.now();
  const timing = { loadMs: t2 - t1, graphMs: t3 - t2, routeMs: 0, totalMs: 0 };
  const done = (r: Omit<Prepared, "timing" | "dataVersion" | "region" | "load">, graph?: TrailGraph): Prepared => {
    timing.totalMs = performance.now() - t0;
    return { ...r, graph, region, load: stats, timing, dataVersion: manifest.dataVersion };
  };
  const label = p.activity === "mtb" ? "biking" : "walking and running";
  if (region.startSnapM === null || region.startSnapM > MAX_START_SNAP_M) {
    return done({
      ...base,
      status: "off_network",
      message:
        region.startSnapM === null
          ? `No trails for ${label} found here. Map data is missing or too limited.`
          : `The nearest trail for ${label} is about ${Math.round(region.startSnapM)} m away. Move to a trail or road nearby and try again.`,
    });
  }
  // Two networks: routes and checkpoints are laid out on the strict one (never across a major road); the game itself (zombies, spawns,
  // infection) runs on the play network, where mapped pedestrian crossings are connected so that zombies can follow the player across a road.
  const graph = indexGraph({ ...region.play.graph, crossingNodes: [...region.play.crossingNodes] });
  const routeGraph = p.mode === "survival" ? graph : indexGraph(region.graph);
  if (p.mode === "survival") {
    if (region.stats.componentKm < 3) {
      return done({ ...base, status: "sparse", message: "Not enough connected trail here for Survival (at least 3 km needed)." }, graph);
    }
    return done({ ...base, status: "ok" }, graph);
  }
  if (atob) {
    const t5 = performance.now();
    const ab = generateAtoB(routeGraph, start, p.pointB!, region.hazardNodes, A_TO_B_MIN_STRAIGHT_M);
    timing.routeMs = performance.now() - t5;
    const msg: Record<string, string> = {
      b_off: "B is too far from a trail connected to A. Pick a point closer to a trail or road.",
      a_off: "A is too far from a trail. Pick a point closer to a trail or road.",
      too_close: `A and B are too close together (at least ${A_TO_B_MIN_STRAIGHT_M} m).`,
      no_path: "There is no way from A to B in the map data. Pick another B.",
    };
    if (ab.status !== "ok") return done({ ...base, status: ab.status === "a_off" ? "off_network" : "no_route", message: msg[ab.status], notes: ab.notes }, graph);
    return done({ status: "ok", proposals: ab.proposals, notes: ab.notes }, graph);
  }
  // Mission: only the checkpoints are laid out (fetched in order, then home); there is no route. Distances are straight lines.
  // Bike: checkpoints on easy-to-ride ways (paved/gravel roads, bike lanes, good tracks) when that network can make a fitting course; zombies still use every way.
  const t4 = performance.now();
  const req = { start, activity: p.activity, targetLengthM: p.targetLengthM, seed: p.seed, count: 3, hazardNodes: region.hazardNodes };
  let res = generateCourse(routeGraph, req);
  if (p.activity === "mtb") {
    const easyEdges = region.graph.edges.filter((e) => e.easy);
    const easy = easyEdges.length ? generateCourse(indexGraph({ ...region.graph, edges: easyEdges }), req) : null;
    if (easy && easy.proposals.some((x) => x.withinTolerance)) res = easy;
    else base.notes.push(easy ? "easy-bike-network-no-course: used all rideable ways" : "easy-bike-network-empty: used all rideable ways");
  }
  timing.routeMs = performance.now() - t4;
  const notes = [...base.notes, ...res.notes];
  if (!res.proposals.length) {
    return done({ ...base, status: "no_route", notes, message: "No checkpoints could be placed here. Move to a trail or road with more connected paths and try again." }, graph);
  }
  const best = res.proposals.filter((x) => x.withinTolerance);
  if (!best.length) {
    const km = (m: number) => (m / 1000).toFixed(1);
    return done({ status: "alternative", proposals: res.proposals.slice(0, 1), notes, message: `The map data here only allows a course of about ${km(res.proposals[0].lengthM)} km instead of ${km(p.targetLengthM)} km. Showing the closest.` }, graph);
  }
  // One course only (the closest to the wanted distance); NEW COURSE makes another.
  return done({ status: "ok", proposals: best.slice(0, 1), notes }, graph);
}

/** Uppskattad tid (s) för en rutt i lugn fart, för visning i förhandsgranskningen. */
export function estimatedMinutes(lengthM: number, p: MatchParams): number {
  return Math.round(lengthM / (ACTIVITIES[p.activity].playerPaceMps * 0.8) / 60);
}
