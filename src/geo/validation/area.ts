import { ACTIVITIES, type Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import { resolveRules } from "@/config/game-rules";
import { chooseExtraction } from "@/engine/extraction/extraction";
import { distanceToPos, networkDistances } from "@/engine/pathfinding/astar";
import { indexGraph, snapToGraph } from "../graph/graph";
import type { SerializedGraph, TrailGraph } from "../graph/types";
import { pointInPolygon, polygonAreaKm2, polygonSelfIntersects, type LatLon } from "../geometry";
interface Polygon { type: string; coordinates: number[][][] }

export interface AreaMetrics {
  connectedTrailLengthM: number;
  junctionCount: number;
  spawnCapacity: number;
}

export interface AreaValidation {
  valid: boolean;
  warnings: string[];
  metrics: AreaMetrics;
  /** Komponent som spelet ska använda (närmast starten, annars störst). */
  component: number | null;
}

/** Maxyta per aktivitet (km²) – skydd mot orimligt stora förfrågningar. */
export const MAX_AREA_KM2: Record<Activity, number> = { walk: 25, run: 80, mtb: 200 };

/** Genomsnittligt avstånd mellan zombiers möjliga spawnpunkter vid kapacitetsuppskattning. */
const SPAWN_SPACING_M = 200;

export function validatePolygon(p: unknown, activity: Activity): { ring: [number, number][] } | { error: string } {
  const poly = p as Polygon | undefined;
  const ring0 = poly?.type === "Polygon" ? poly.coordinates?.[0] : undefined;
  if (!Array.isArray(ring0) || ring0.length < 4) return { error: "Polygonen måste ha minst tre hörn." };
  const ring = ring0.slice(0, -1) as [number, number][];
  if (ring.length > 200) return { error: "Polygonen har för många hörn." };
  if (ring.some((c) => !Array.isArray(c) || c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[1]) > 90 || Math.abs(c[0]) > 180)) {
    return { error: "Ogiltiga koordinater." };
  }
  if (polygonSelfIntersects(ring)) return { error: "Polygonen får inte korsa sig själv." };
  if (polygonAreaKm2(ring) > MAX_AREA_KM2[activity]) return { error: "Spelområdet är för stort." };
  return { ring };
}

/** Klipper nätet till polygonen: bara kanter vars geometri helt ligger inom området behålls (konservativt). */
export function clipGraphToPolygon(g: SerializedGraph, ring: [number, number][]): SerializedGraph {
  const edges = g.edges.filter((e) => e.geometry.every((pt) => pointInPolygon(pt, ring)));
  const used = new Set(edges.flatMap((e) => [e.from, e.to]));
  return { ...g, nodes: g.nodes.filter((n) => used.has(n.id)), edges };
}

export interface AreaInput {
  graph: TrailGraph;
  activity: Activity;
  difficulty: Difficulty;
  durationS: number;
  /** Spelarens startposition; utan den används största komponenten. */
  start?: LatLon;
}

/** Kontrollerar att ett nät räcker för en match (PRD 5.2, 5.5). */
export function validateArea(inp: AreaInput): AreaValidation {
  const { graph: g, activity, durationS } = inp;
  const warnings: string[] = [];
  const empty: AreaMetrics = { connectedTrailLengthM: 0, junctionCount: 0, spawnCapacity: 0 };
  if (!g.components.length) return { valid: false, warnings: ["Inga stigar hittades i området."], metrics: empty, component: null };

  let comp = [...g.components].sort((a, b) => b.lengthM - a.lengthM)[0];
  let startSnap = null as ReturnType<typeof snapToGraph>;
  if (inp.start) {
    startSnap = snapToGraph(g, inp.start);
    if (!startSnap || startSnap.offNetworkM > 150) {
      return { valid: false, warnings: ["Startpositionen ligger för långt från närmaste stig."], metrics: empty, component: null };
    }
    comp = g.components[g.edges.get(startSnap.edgeId)!.component];
    if (startSnap.offNetworkM > 60) warnings.push("Du befinner dig en bit från närmaste stig.");
  }
  const profile = ACTIVITIES[activity];
  const startPos = startSnap ?? (() => {
    const e = [...g.edges.values()].find((x) => x.component === comp.id)!;
    return { edgeId: e.id, distM: e.lengthM / 2, offNetworkM: 0 };
  })();

  // Spawn-kapacitet: nätlängd som ligger minst spawnMinDistance bort längs nätet.
  const dists = networkDistances(g, startPos);
  let farLength = 0;
  for (const e of g.edges.values()) {
    if (e.component !== comp.id) continue;
    const a = distanceToPos(g, startPos, dists, { edgeId: e.id, distM: 0 });
    const b = distanceToPos(g, startPos, dists, { edgeId: e.id, distM: e.lengthM });
    if (a >= profile.spawnMinDistanceM && b >= profile.spawnMinDistanceM) farLength += e.lengthM;
  }
  const spawnCapacity = Math.floor(farLength / SPAWN_SPACING_M);
  const metrics: AreaMetrics = { connectedTrailLengthM: Math.round(comp.lengthM), junctionCount: comp.junctionCount, spawnCapacity };

  const rules = resolveRules(activity, inp.difficulty, durationS, spawnCapacity);
  const minLength = Math.max(2500, profile.playerPaceMps * durationS * 0.4);
  const errors: string[] = [];
  if (comp.lengthM < minLength) errors.push(`Det sammanhängande stignätet är för litet (${Math.round(comp.lengthM)} m, minst ${Math.round(minLength)} m).`);
  if (comp.junctionCount < 5) errors.push("För få korsningar för att ge meningsfulla vägval.");
  if (spawnCapacity < 1) errors.push("Det finns inga säkra platser för zombier på tillräckligt avstånd.");
  else if (spawnCapacity < rules.initialZombies) warnings.push("Området rymmer färre zombier än vald svårighet normalt använder.");

  // Extraction ska kunna placeras nåbart även sent i matchen.
  const ex = chooseExtraction(
    g,
    { playerPos: startPos, component: comp.id, zombiePositions: [], remainingS: durationS * 0.2, playerPaceMps: profile.playerPaceMps },
    { rngState: 1 },
  );
  if (ex === null) errors.push("Ingen nåbar och säker extraction-punkt kunde placeras.");

  return { valid: errors.length === 0, warnings: [...errors, ...warnings], metrics, component: comp.id };
}

export function indexAndValidate(sg: SerializedGraph, input: Omit<AreaInput, "graph">) {
  const graph = indexGraph(sg);
  return { graph, validation: validateArea({ ...input, graph }) };
}

