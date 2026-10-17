import type { Activity } from "@/config/activities";
import { MAX_AREA_KM2 } from "../validation/area";
import { indexGraph } from "../graph/graph";
import type { SerializedGraph } from "../graph/types";
import { overpassQuery, overpassToGraph, type Bbox, type OverpassResponse } from "./overpass";

export class TerrainError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

export function parseBbox(b: unknown, activity: Activity): Bbox {
  if (!Array.isArray(b) || b.length !== 4 || b.some((x) => typeof x !== "number" || !Number.isFinite(x))) {
    throw new TerrainError("bbox måste vara [väst, syd, öst, nord].", 400);
  }
  // API:t använder GeoJSON-ordning [west, south, east, north] (PRD 10.1).
  const [w, s, e, n] = b as number[];
  if (s >= n || w >= e || Math.abs(s) > 90 || Math.abs(n) > 90 || Math.abs(w) > 180 || Math.abs(e) > 180) {
    throw new TerrainError("Ogiltig bbox.", 400);
  }
  const km2 = ((n - s) * 111.32 * (e - w) * 111.32 * Math.cos((((n + s) / 2) * Math.PI) / 180));
  if (km2 > MAX_AREA_KM2[activity]) throw new TerrainError("Området är för stort.", 413);
  return [s, w, n, e];
}

/** Hämtar och normaliserar stignät för en bbox. Kastar TerrainError vid fel. */
export async function fetchTerrain(bbox: Bbox, activity: Activity): Promise<SerializedGraph> {
  let res: Response;
  try {
    res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "outbreak-solo-survival/0.1" },
      body: new URLSearchParams({ data: overpassQuery(bbox) }),
      signal: AbortSignal.timeout(25_000),
      next: { revalidate: 60 * 60 * 24 },
    } as RequestInit);
  } catch {
    throw new TerrainError("Kartdata kunde inte hämtas just nu. Försök igen senare.", 502);
  }
  if (!res.ok) throw new TerrainError("Kartdatatjänsten svarade med fel.", 502);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_RESPONSE_BYTES) throw new TerrainError("Kartdata för området är för stor.", 413);
  const json = (await res.json()) as OverpassResponse;
  if (!json || !Array.isArray(json.elements)) throw new TerrainError("Oväntat svar från kartdatatjänsten.", 502);
  return overpassToGraph(json, activity);
}

export function graphMetadata(sg: SerializedGraph) {
  const g = indexGraph(sg);
  let total = 0;
  for (const e of g.edges.values()) total += e.lengthM;
  return { nodeCount: g.nodes.size, edgeCount: g.edges.size, totalLengthM: Math.round(total) };
}

/** Enkel IP-baserad begränsning (best effort – serverlösa instanser delar inte minne). */
const hits = new Map<string, number[]>();
export function rateLimited(ip: string, limit = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > limit;
}
