import { ACTIVITIES } from "@/config/activities";
import { buildRegionGraph, MAX_START_SNAP_M, type RegionGraph } from "@/data/region-graph";
import type { LoadStats, TileStore } from "@/data/store";
import type { LatLon } from "@/geo/geometry";
import { indexGraph } from "@/geo/graph/graph";
import type { TrailGraph } from "@/geo/graph/types";
import { generateRoutes } from "@/routes/generate";
import type { RouteProposal } from "@/routes/types";
import { dataRadiusM, type MatchParams } from "./config";

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
    return { ...base, status: "outside_region", message: "Du befinner dig utanför det område som spelet har kartdata för (Värmland).", dataVersion: manifest.dataVersion };
  }
  const radius = dataRadiusM(p);
  const t1 = performance.now();
  const { ways, stats } = await store.loadAround(start, radius);
  const t2 = performance.now();
  const region = buildRegionGraph(ways, p.activity, start, radius);
  const t3 = performance.now();
  const timing = { loadMs: t2 - t1, graphMs: t3 - t2, routeMs: 0, totalMs: 0 };
  const done = (r: Omit<Prepared, "timing" | "dataVersion" | "region" | "load">, graph?: TrailGraph): Prepared => {
    timing.totalMs = performance.now() - t0;
    return { ...r, graph, region, load: stats, timing, dataVersion: manifest.dataVersion };
  };
  const label = p.activity === "mtb" ? "cykel" : p.activity === "run" ? "löpning" : "promenad";
  if (region.startSnapM === null || region.startSnapM > MAX_START_SNAP_M) {
    return done({
      ...base,
      status: "off_network",
      message:
        region.startSnapM === null
          ? `Hittade inga stigar för ${label} här. Kartdata saknas eller är för begränsad.`
          : `Närmaste stig för ${label} ligger cirka ${Math.round(region.startSnapM)} m bort. Gå till en stig eller en väg i närheten och försök igen.`,
    });
  }
  if (p.mode !== "survival" && region.stats.componentKm * 1000 < p.targetLengthM * MIN_NETWORK_FACTOR) {
    return done({
      ...base,
      status: "sparse",
      message: `Det finns bara ${region.stats.componentKm.toFixed(1)} km sammanhängande stig för ${label} här. Välj en kortare sträcka eller en annan plats.`,
    });
  }
  const graph = indexGraph(region.graph);
  if (p.mode === "survival") {
    if (region.stats.componentKm < 3) {
      return done({ ...base, status: "sparse", message: "För lite sammanhängande stig här för Survival (minst 3 km behövs)." }, graph);
    }
    return done({ ...base, status: "ok" }, graph);
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
    return done({ ...base, status: "no_route", notes: res.notes, message: "Hittade ingen bra rutt här. Prova en annan sträcka eller en annan startpunkt." }, graph);
  }
  const best = proposals.filter((x) => x.withinTolerance);
  if (!best.length) {
    const nearest = proposals.filter((x) => Math.abs(x.deviation) <= 0.25);
    if (!nearest.length) {
      return done({ ...base, status: "no_route", notes: res.notes, message: "Hittade ingen rutt som ligger nära önskad sträcka. Justera sträckan och försök igen." }, graph);
    }
    return done({ status: "alternative", proposals: nearest, notes: res.notes, message: "Ingen rutt hittades inom ±10 % av önskad sträcka. Närmaste alternativ visas." }, graph);
  }
  return done({ status: "ok", proposals: best, notes: res.notes }, graph);
}

/** Uppskattad tid (s) för en rutt i lugn fart, för visning i förhandsgranskningen. */
export function estimatedMinutes(lengthM: number, p: MatchParams): number {
  return Math.round(lengthM / (ACTIVITIES[p.activity].playerPaceMps * 0.8) / 60);
}
