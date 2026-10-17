import type { Activity } from "@/config/activities";
import type { LatLon } from "@/geo/geometry";

export type RouteMode = "escape" | "mission";
export type RouteType = "point-to-point" | "loop" | "partial-loop" | "out-and-back";

export interface Waypoint {
  id: string;
  kind: "destination" | "checkpoint" | "home";
  nodeId: string;
  lat: number;
  lon: number;
}

export interface RouteMetrics {
  /** Andel av rutten (längd) som redan trafikerats tidigare i rutten. */
  reuseShare: number;
  /** Andel av rutten som ligger i återvändsgrenar. */
  deadEndShare: number;
  /** Största djup (m) in i en återvändsgren för någon målpunkt (0 = i huvudnätet). */
  maxWaypointDeadEndDepthM: number;
  /** Antal korsningar (≥ 3 grannar) längs rutten, dvs. möjliga vägval. */
  decisionPoints: number;
  /** Antal passager där rutten korsar en utesluten större väg. */
  hazardCrossings: number;
  /** Minsta antal utgångar ur huvudnätet vid en målpunkt (≥ 2 = ingen enda blockerbar väg). */
  minWaypointExits: number;
  /** Längd på bästa alternativa väg start→mål utan att använda ruttens kanter, relativt ruttens längd (A→B). null = saknas. */
  alternativeRatio: number | null;
  /** Fågelväg/ruttlängd (A→B) eller maximalt avstånd från start/ruttlängd (A→A). */
  directness: number;
}

export interface RouteProposal {
  id: string;
  mode: RouteMode;
  type: RouteType;
  waypoints: Waypoint[];
  lengthM: number;
  /** (längd − önskad) / önskad. */
  deviation: number;
  withinTolerance: boolean;
  geometry: LatLon[];
  edgeIds: string[];
  /** Ordnad kantföljd (med upprepningar) som utgör referensrutten. */
  path: { edgeId: string; dir: 1 | -1 }[];
  metrics: RouteMetrics;
  /** Enkel riskbedömning utan kännedom om zombierörelser: 0–100 (högre = bättre uppdragsdesign). */
  quality: { score: number; flags: string[] };
}

export interface RouteRequest {
  start: LatLon;
  activity: Activity;
  mode: RouteMode;
  targetLengthM: number;
  seed: number;
  /** Antal förslag (default 3). */
  count?: number;
  /** Mission: antal checkpoints (1–3). Utelämnat = generatorn provar alla. */
  checkpoints?: 1 | 2 | 3;
  /** Noder där rutten korsar större väg. */
  hazardNodes?: Set<string>;
  /** Tillåten avvikelse från önskad längd (default 0,10). */
  tolerance?: number;
  /** "avoid" (default): målpunkter undviker återvändsgrenar. "allow": inga sådana krav (för ablation). */
  deadEndPolicy?: "avoid" | "allow";
  /** Antal slumpade kandidater per variant (default 300). */
  samples?: number;
  /** Escape: högsta antal destinationer som utvärderas fullt (default 250). Lägre värde ger snabbare generering på mobil. */
  maxCandidates?: number;
}

export interface RouteResult {
  proposals: RouteProposal[];
  /** Förklaringar, t.ex. om närmaste användbara alternativ ligger utanför toleransen. */
  notes: string[];
  stats: { candidates: number; evaluated: number; ms: number };
}
