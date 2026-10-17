// Frysta etapp 2.5-regler (före Etapp 3-skärpningen) för jämförelse i rule-impact.ts. Ändras inte.
import type { Activity } from "@/config/activities";
import { buildGraph, type RawWay } from "@/geo/graph/build";
import type { PathType, SerializedGraph } from "@/geo/graph/types";

/** Överpass `out geom`: varje way har nod-id:n och parallella koordinater. */
export interface OverpassWay {
  type: "way";
  id: number;
  nodes: number[];
  geometry: ({ lat: number; lon: number } | null)[];
  tags?: Record<string, string>;
}
export interface OverpassResponse {
  elements: { type: string; id: number; [k: string]: unknown }[];
}

export type Bbox = [south: number, west: number, north: number, east: number];

const HIGHWAY_REGEX = "path|footway|track|cycleway|bridleway|service|residential|living_street|unclassified|pedestrian";

/** Query för en bounding box (ordning enligt Overpass: söder, väster, norr, öster). */
export function overpassQuery(bbox: Bbox, timeoutS = 20): string {
  const [s, w, n, e] = bbox;
  return `[out:json][timeout:${timeoutS}];way["highway"~"^(${HIGHWAY_REGEX})$"](${s},${w},${n},${e});out geom;`;
}

const WALK_TYPES = new Set(["path", "footway", "track", "cycleway", "service", "residential", "living_street", "unclassified", "pedestrian", "bridleway"]);

function pathType(h: string): PathType {
  if (h === "path" || h === "footway" || h === "track" || h === "cycleway" || h === "service" || h === "residential") return h;
  if (h === "pedestrian") return "footway";
  return "other";
}

const NO = new Set(["no", "private", "dismount", "use_sidepath"]);
const YES = new Set(["yes", "designated", "permissive", "official"]);

export type FilterDecision = { ok: true; oneway?: boolean; reverse?: boolean } | { ok: false; reason: string };

/**
 * Konservativ filtrering (PRD 5.4): vid oklar åtkomst eller uppenbar risk väljs uteslutning.
 * - Allt över "unclassified" (motorväg…tertiary), järnväg, byggen och trappor utesluts redan i query/här.
 * - Promenad/löpning: foot=no eller access=private/no utesluts (om inte foot uttryckligen tillåts).
 * - MTB: kräver att cykling är tillåten. footway/pedestrian kräver bicycle=yes/designated.
 *   mtb:scale ≥ 4 utesluts av säkerhetsskäl; bicycle=no/dismount utesluts.
 */
export function decideWay(tags: Record<string, string> | undefined, activity: Activity): FilterDecision {
  const t = tags ?? {};
  const h = t.highway;
  if (!h || !WALK_TYPES.has(h)) return { ok: false, reason: "highway" };
  if (t.railway || t.indoor || t.area === "yes") return { ok: false, reason: "not-a-path" };
  if (t.access && NO.has(t.access) && !(activity === "mtb" ? YES.has(t.bicycle ?? "") : YES.has(t.foot ?? ""))) {
    return { ok: false, reason: "access" };
  }
  if (h === "bridleway" && !YES.has(t.foot ?? "") && !YES.has(t.bicycle ?? "")) return { ok: false, reason: "bridleway" };
  if (h === "service" && (t.service === "parking_aisle" || t.service === "driveway") && !YES.has(t.foot ?? "")) {
    return { ok: false, reason: "service" };
  }

  if (activity === "mtb") {
    if (t.bicycle && NO.has(t.bicycle)) return { ok: false, reason: "bicycle" };
    if ((h === "footway" || h === "pedestrian") && !YES.has(t.bicycle ?? "")) return { ok: false, reason: "foot-only" };
    const scale = Number.parseInt(t["mtb:scale"] ?? "", 10);
    if (Number.isFinite(scale) && scale >= 4) return { ok: false, reason: "mtb-scale" };
    const ow = t["oneway:bicycle"] ?? t.oneway;
    if (ow === "yes" || ow === "1" || ow === "true") return { ok: true, oneway: true };
    if (ow === "-1") return { ok: true, oneway: true, reverse: true };
    return { ok: true };
  }
  if (t.foot && NO.has(t.foot)) return { ok: false, reason: "foot" };
  return { ok: true };
}

/** Normaliserar ett Overpass-svar till rå-linjer för aktiviteten. Okända/ofullständiga linjer hoppas över. */
export function normalizeOverpass(resp: OverpassResponse, activity: Activity): RawWay[] {
  const ways: RawWay[] = [];
  for (const el of resp.elements) {
    if (el.type !== "way") continue;
    const w = el as unknown as OverpassWay;
    if (!Array.isArray(w.nodes) || !Array.isArray(w.geometry) || w.nodes.length !== w.geometry.length) continue;
    if (w.geometry.some((p) => !p)) continue; // way delvis utanför datasetet
    const d = decideWay(w.tags, activity);
    if (!d.ok) continue;
    let nodes = w.nodes.map((id, i) => ({ id: String(id), lat: w.geometry[i]!.lat, lon: w.geometry[i]!.lon }));
    if (d.reverse) nodes = nodes.reverse();
    ways.push({ id: String(w.id), nodes, type: pathType(w.tags!.highway), oneway: d.oneway });
  }
  return ways;
}

export function overpassToGraph(resp: OverpassResponse, activity: Activity): SerializedGraph {
  return buildGraph(normalizeOverpass(resp, activity), "openstreetmap");
}
