import { toLocal, type LatLon } from "./geometry";

/**
 * Kontroll av en vald punkt (B i A TO B i terräng) mot kartans egna skikt (OpenMapTiles via OpenFreeMap). Terrängläget känner inte vatten, byggnader,
 * större vägar eller järnväg, så en punkt som uppenbart ligger i vatten, inne i en byggnad eller på en större väg/järnväg avvisas redan när den väljs.
 * Ren funktion på GeoJSON-liknande kartobjekt (testbar utan webbläsare). Saknas kartdata för platsen (offline, tiles ej inlästa) godkänns punkten.
 */
export interface MapFeature {
  sourceLayer?: string;
  properties?: Record<string, unknown> | null;
  geometry: { type: string; coordinates: unknown };
}

export type PickProblemKind = "water" | "building" | "major_road" | "railway";
export interface PickProblem {
  kind: PickProblemKind;
  message: string;
}

/** Större vägklasser (samma som kartans varmt färgade vägar) och hur nära en sådan en punkt får ligga (m). */
export const MAJOR_ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary"];
export const ROAD_CLEARANCE_M = 12;

type Pt = [number, number];
const MESSAGES: Record<PickProblemKind, string> = {
  water: "B is in water. Pick a spot on land.",
  building: "B is inside a building. Pick a spot outside.",
  major_road: "B is on a major road. Pick a spot away from the road.",
  railway: "B is on a railway. Pick a spot away from the tracks.",
};

function ringContains(ring: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Sant om punkten ligger i polygonen (yttre ring minus hål). */
export function polygonContains(rings: Pt[][], p: Pt): boolean {
  if (!rings.length || !ringContains(rings[0], p)) return false;
  for (let k = 1; k < rings.length; k++) if (ringContains(rings[k], p)) return false;
  return true;
}

function distToSegmentM(origin: LatLon, a: Pt, b: Pt): number {
  const A = toLocal(origin, { lat: a[1], lon: a[0] }), B = toLocal(origin, { lat: b[1], lon: b[0] });
  const dx = B.x - A.x, dy = B.y - A.y, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, (-A.x * dx - A.y * dy) / len2)) : 0;
  return Math.hypot(A.x + t * dx, A.y + t * dy);
}

const polygons = (g: MapFeature["geometry"]): Pt[][][] => (g.type === "Polygon" ? [g.coordinates as Pt[][]] : g.type === "MultiPolygon" ? (g.coordinates as Pt[][][]) : []);
const lines = (g: MapFeature["geometry"]): Pt[][] => (g.type === "LineString" ? [g.coordinates as Pt[]] : g.type === "MultiLineString" ? (g.coordinates as Pt[][]) : []);

/** Första problemet med punkten, eller null. Tunnlar räknas inte (marken ovanpå är fri). */
export function checkPickPoint(features: MapFeature[], p: LatLon): PickProblem | null {
  const pt: Pt = [p.lon, p.lat];
  let road = false, rail = false;
  for (const f of features) {
    const layer = f.sourceLayer;
    const props = f.properties ?? {};
    if (layer === "water" || layer === "building") {
      if (polygons(f.geometry).some((rings) => polygonContains(rings, pt))) return { kind: layer, message: MESSAGES[layer] };
    } else if (layer === "transportation" && props.brunnel !== "tunnel") {
      const cls = String(props.class ?? "");
      const isRail = cls === "rail";
      if (!isRail && !MAJOR_ROAD_CLASSES.includes(cls)) continue;
      if (lines(f.geometry).some((l) => l.some((_, i) => i > 0 && distToSegmentM(p, l[i - 1], l[i]) <= ROAD_CLEARANCE_M))) {
        if (isRail) rail = true; else road = true;
      }
    }
  }
  if (rail) return { kind: "railway", message: MESSAGES.railway };
  if (road) return { kind: "major_road", message: MESSAGES.major_road };
  return null;
}
