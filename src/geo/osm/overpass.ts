import type { Activity } from "@/config/activities";
import { buildGraph, type RawWay } from "../graph/build";
import type { PathType, SerializedGraph } from "../graph/types";

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

const NO = new Set(["no", "private", "dismount", "use_sidepath", "customers", "delivery", "permit", "military", "forestry", "agricultural"]);
const YES = new Set(["yes", "designated", "permissive", "official"]);

export type FilterDecision = { ok: true; oneway?: boolean; reverse?: boolean } | { ok: false; reason: string };

/**
 * Konservativ filtrering (PRD 5.4): vid oklar åtkomst eller uppenbar risk väljs uteslutning.
 * - Allt över "unclassified" (motorväg…tertiary), järnväg, byggen och trappor utesluts redan i query/här.
 * - Promenad/löpning: foot=no eller access=private/no utesluts (om inte foot uttryckligen tillåts).
 * - MTB: kräver att cykling är tillåten. footway/pedestrian kräver bicycle=yes/designated.
 *   mtb:scale ≥ 3 utesluts av säkerhetsskäl; bicycle=no/dismount utesluts.
 * - Saknade attribut tolkas aldrig som "säkert": cykelbana utan foot=yes/designated är inte en gångväg,
 *   vad, dålig/obefintlig stigsynlighet (trail_visibility) och krävande vandringsstigar (sac_scale ≥ mountain_hiking) utesluts,
 *   och vadställen (ford) utesluts eftersom passerbarhet inte är känd.
 */
export function decideWay(tags: Record<string, string> | undefined, activity: Activity): FilterDecision {
  const t = tags ?? {};
  const h = t.highway;
  if (!h || !WALK_TYPES.has(h)) return { ok: false, reason: "highway" };
  if (t.railway || t.indoor || t.area === "yes") return { ok: false, reason: "not-a-path" };
  if (t.ford && t.ford !== "no") return { ok: false, reason: "ford" };
  if (t.highway === "construction" || t.access === "unknown") return { ok: false, reason: "unknown-access" };
  if (["bad", "horrible", "no"].includes(t.trail_visibility ?? "")) return { ok: false, reason: "visibility" };
  if (["mountain_hiking", "demanding_mountain_hiking", "alpine_hiking", "demanding_alpine_hiking", "difficult_alpine_hiking"].includes(t.sac_scale ?? "")) {
    return { ok: false, reason: "sac-scale" };
  }
  if (t.access && NO.has(t.access) && !(activity === "mtb" ? YES.has(t.bicycle ?? "") : YES.has(t.foot ?? ""))) {
    return { ok: false, reason: "access" };
  }
  if (h === "bridleway" && !YES.has(t.foot ?? "") && !YES.has(t.bicycle ?? "")) return { ok: false, reason: "bridleway" };
  if (h === "service" && ["parking_aisle", "driveway", "drive-through", "emergency_access"].includes(t.service ?? "") && !YES.has(t.foot ?? "")) {
    return { ok: false, reason: "service" };
  }

  if (activity === "mtb") {
    if (t.bicycle && NO.has(t.bicycle)) return { ok: false, reason: "bicycle" };
    if ((h === "footway" || h === "pedestrian") && !YES.has(t.bicycle ?? "")) return { ok: false, reason: "foot-only" };
    const scale = Number.parseInt(t["mtb:scale"] ?? "", 10);
    if (Number.isFinite(scale) && scale >= 3) return { ok: false, reason: "mtb-scale" };
    const ow = t["oneway:bicycle"] ?? t.oneway;
    if (ow === "yes" || ow === "1" || ow === "true") return { ok: true, oneway: true };
    if (ow === "-1") return { ok: true, oneway: true, reverse: true };
    return { ok: true };
  }
  if (t.foot && NO.has(t.foot)) return { ok: false, reason: "foot" };
  if (h === "cycleway" && !YES.has(t.foot ?? "")) return { ok: false, reason: "cycleway-no-foot" };
  return { ok: true };
}

const PAVED = new Set(["paved", "asphalt", "concrete", "concrete:plates", "concrete:lanes", "paving_stones", "sett", "cobblestone", "chipseal", "metal", "bricks"]);
const GRAVEL = new Set(["gravel", "fine_gravel", "compacted", "unpaved_compacted"]);
const ROUGH_SURFACE = new Set(["grass", "dirt", "earth", "ground", "mud", "sand", "rock", "pebblestone", "woodchips", "wood", "grass_paver", "snow", "ice", "stepping_stones", "clay", "salt"]);
const ROUGH_SMOOTHNESS = new Set(["bad", "very_bad", "horrible", "very_horrible", "impassable"]);

/**
 * Bike: is the way easy to ride (paved or gravel road, bike lane, good forest road)? Used to choose the Mission track only;
 * zombies may use every allowed way. Unknown surface on a path/footway is NOT assumed easy; a plain "track" (forest/gravel road) is.
 */
export function isEasyBikeWay(tags: Record<string, string> | undefined): boolean {
  const t = tags ?? {};
  const h = t.highway;
  if (!h) return false;
  const scale = Number.parseInt(t["mtb:scale"] ?? "", 10);
  if (Number.isFinite(scale) && scale >= 1) return false;
  if (t.sac_scale && t.sac_scale !== "hiking") return false;
  if (ROUGH_SMOOTHNESS.has(t.smoothness ?? "")) return false;
  const surface = (t.surface ?? "").split(";")[0];
  if (ROUGH_SURFACE.has(surface)) return false;
  if (h === "cycleway" || h === "residential" || h === "living_street" || h === "unclassified") return true;
  const good = PAVED.has(surface) || GRAVEL.has(surface);
  if (h === "service") return !["parking_aisle", "driveway"].includes(t.service ?? "");
  if (h === "track") {
    const grade = t.tracktype ?? "";
    if (grade === "grade4" || grade === "grade5") return false;
    return true;
  }
  // path / footway / pedestrian / bridleway: only with a known good surface
  return good && (h !== "bridleway");
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
