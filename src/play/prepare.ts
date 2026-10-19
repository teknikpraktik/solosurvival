import { ACTIVITIES } from "@/config/activities";
import { buildRegionGraph, MAX_START_SNAP_M, type RegionGraph } from "@/data/region-graph";
import type { LoadStats, TileStore } from "@/data/store";
import type { LatLon } from "@/geo/geometry";
import { indexGraph } from "@/geo/graph/graph";
import type { TrailGraph } from "@/geo/graph/types";
import { generateRoutes } from "@/routes/generate";
import { densifyCheckpoints, CHECKPOINT_SPACING_BIKE_M, CHECKPOINT_SPACING_M } from "@/routes/densify";
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

/** Minsta nätlängd (m) relativt önskad sträcka för att rimliga alternativ ska kunna finnas. */
const MIN_NETWORK_FACTOR = 1.5;

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
  const region = buildRegionGraph(ways, p.activity, center, radius, start);
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
  if (p.mode !== "survival" && !atob && region.stats.componentKm * 1000 < p.targetLengthM * MIN_NETWORK_FACTOR) {
    return done({
      ...base,
      status: "sparse",
      message: `Only ${region.stats.componentKm.toFixed(1)} km of connected trail for ${label} here. Pick a shorter distance or another place.`,
    });
  }
  const graph = indexGraph(region.graph);
  if (p.mode === "survival") {
    if (region.stats.componentKm < 3) {
      return done({ ...base, status: "sparse", message: "Not enough connected trail here for Survival (at least 3 km needed)." }, graph);
    }
    return done({ ...base, status: "ok" }, graph);
  }
  if (atob) {
    const t5 = performance.now();
    const ab = generateAtoB(graph, start, p.pointB!, region.hazardNodes, A_TO_B_MIN_STRAIGHT_M);
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
  const t4 = performance.now();
  const res = generateRoutes(graph, {
    start,
    activity: p.activity,
    mode: p.mode === "escape" ? "escape" : "mission",
    targetLengthM: p.targetLengthM,
    seed: p.seed,
    count: 3,
    hazardNodes: region.hazardNodes,
    // Begränsat sökdjup: håller genereringen till några sekunder även på en mobil.
    samples: 100,
    maxCandidates: 40,
  });
  timing.routeMs = performance.now() - t4;
  // Förslag som berör större väg/järnväg/vatten (hazardCrossings) visas bara om inget annat finns.
  const safe = res.proposals.filter((x) => x.metrics.hazardCrossings === 0);
  const proposals = safe.length ? safe : res.proposals;
  if (!proposals.length) {
    return done({ ...base, status: "no_route", notes: res.notes, message: "No good route found here. Try another distance or starting point." }, graph);
  }
  // Mission: ett checkpoint per ca 500 m (till fots) eller 1 km (cykel) längs slingan.
  const spacing = p.activity === "mtb" ? CHECKPOINT_SPACING_BIKE_M : CHECKPOINT_SPACING_M;
  const dense = proposals.map((x) => densifyCheckpoints(graph, x, spacing));
  const best = dense.filter((x) => x.withinTolerance);
  if (!best.length) {
    const nearest = dense.filter((x) => Math.abs(x.deviation) <= 0.25);
    if (!nearest.length) {
      return done({ ...base, status: "no_route", notes: res.notes, message: "No route found close to the wanted distance. Adjust the distance and try again." }, graph);
    }
    return done({ status: "alternative", proposals: nearest, notes: res.notes, message: "No route within ±10 % of the wanted distance. Showing the closest alternatives." }, graph);
  }
  return done({ status: "ok", proposals: best, notes: res.notes }, graph);
}

/** Uppskattad tid (s) för en rutt i lugn fart, för visning i förhandsgranskningen. */
export function estimatedMinutes(lengthM: number, p: MatchParams): number {
  return Math.round(lengthM / (ACTIVITIES[p.activity].playerPaceMps * 0.8) / 60);
}
