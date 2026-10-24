import type { Activity } from "@/config/activities";
import { buildGraph, type RawWay } from "@/geo/graph/build";
import { indexGraph } from "@/geo/graph/graph";
import type { PathType, SerializedGraph } from "@/geo/graph/types";
import { haversineM, projectToPolyline, type LatLon } from "@/geo/geometry";
import { decideWay, isEasyBikeWay } from "@/geo/osm/overpass";
import type { TileWay } from "./tile-format";

/** Start längre bort än så från närmaste tillåtna stig räknas som "utanför nätet" (samma gräns som ruttgeneratorn). */
export const MAX_START_SNAP_M = 150;

/**
 * Hur startkomponenten väljs bland nätets sammanhängande delar (se `pickComponent`). `nearest` är v2.2:s regel.
 */
export type ComponentPolicy = "nearest" | "largest150" | "largest300" | "largest500" | "scored" | "scored150";

/** Delar kortare än så väljs bara om inget större nät finns. */
export const MIN_COMPONENT_M = 1500;

/** Standardregel; ändras bara när mätningarna på riktiga data motiverar det (docs/BIKE-NETWORK-IMPROVEMENTS.md). */
export const DEFAULT_COMPONENT_POLICY: ComponentPolicy = "nearest";

export interface ComponentCandidate {
  id: number;
  /** Närmaste kant till ankaret och avståndet dit (m). */
  edgeId: string;
  distM: number;
  /** Komponentens sammanlagda längd (m). */
  len: number;
}

/**
 * Väljer vilken sammanhängande del av nätet som spelet använder. Ren och deterministisk: samma kandidater ger alltid samma val.
 * - nearest: närmaste del på minst 1,5 km (v2.2); finns ingen sådan, närmaste del överhuvudtaget.
 * - largestN: den längsta delen på minst 1,5 km inom N m från ankaret; finns ingen, som `nearest`.
 * - scored: delar på minst 1,5 km inom 500 m; poäng = min(längd, 30 km) / (1 + (avstånd / 150 m)²); finns ingen, som `nearest`.
 */
export function pickComponent(cands: ComponentCandidate[], policy: ComponentPolicy): ComponentCandidate | null {
  const byDist = (a: ComponentCandidate, b: ComponentCandidate) => a.distM - b.distM || b.len - a.len || a.id - b.id;
  const usable = cands.filter((c) => c.len >= MIN_COMPONENT_M);
  const nearest = [...(usable.length ? usable : cands)].sort(byDist)[0] ?? null;
  if (policy === "nearest") return nearest;
  const within = (m: number) => usable.filter((c) => c.distM <= m);
  if (policy === "largest150" || policy === "largest300" || policy === "largest500") {
    const pool = within(policy === "largest150" ? 150 : policy === "largest300" ? 300 : 500);
    return pool.length ? [...pool].sort((a, b) => b.len - a.len || byDist(a, b))[0] : nearest;
  }
  const pool = within(policy === "scored150" ? 150 : 500);
  const score = (c: ComponentCandidate) => Math.min(c.len / 1000, 30) / (1 + (c.distM / 150) ** 2);
  return pool.length ? [...pool].sort((a, b) => score(b) - score(a) || byDist(a, b))[0] : nearest;
}

/** Gångpassager (stig-/gångvägar) som får användas av zombier för att följa spelaren över en större väg eller järnväg. */
const PEDESTRIAN_HIGHWAYS = new Set(["footway", "path", "cycleway", "pedestrian"]);

export interface RegionGraph {
  /**
   * Strikt nät för att lägga ut rutter/checkpoints: klippt vid varje delad nod med större väg/järnväg/vattendrag, så ingen
   * föreslagen sträcka korsar en större väg.
   */
  graph: SerializedGraph;
  /**
   * Spelnät för motorn (zombier, spawn, infektion): som `graph`, men kartlagda gångpassager över större väg/järnväg är
   * sammankopplade. Utan dem kan zombier aldrig följa spelaren över en väg (nätet delas i separata öar).
   */
  play: { graph: SerializedGraph; crossingNodes: Set<string>; components: number; componentKm: number };
  /** Privata ändnoder vid vägar/järnväg/vattendrag: stigen tar slut där, korsning är inte möjlig och inget mål placeras där. */
  hazardNodes: Set<string>;
  /** Avstånd från start till närmaste tillåtna stig (m), eller null om nätet är tomt. */
  startSnapM: number | null;
  /** Närmaste punkt på nätet, så att UI kan visa hur långt bort stigen ligger. */
  nearestAccess: LatLon | null;
  stats: {
    waysIn: number;
    waysUsed: number;
    excluded: Record<string, number>;
    edges: number;
    networkKm: number;
    componentKm: number;
    hazardStubs: number;
    components: number;
    /** De närmaste delarna av nätet (avstånd m, längd m) och vilken som valdes, för mätning och felsökning. */
    candidates?: { distM: number; lenM: number; chosen: boolean }[];
  };
}

function pathType(h: string): PathType {
  if (h === "path" || h === "footway" || h === "track" || h === "cycleway" || h === "service" || h === "residential") return h;
  if (h === "pedestrian") return "footway";
  return "other";
}

/**
 * Bygger aktivitetens stignät kring `center`. Komponenten som ligger närmast `anchor` (standard `center`) väljs; avstånd/åtkomstpunkt avser `anchor`.
 * - Aktivitetsfiltret `decideWay` avgör vilka ways som får användas.
 * - Varje stig delas vid delade noder med större väg/järnväg/vattendrag; delarna får egna ändnoder, så nätet
 *   aldrig förbinder två sidor av en väg (spelet föreslår aldrig en vägkorsning).
 * - Nätet klipps till cirkeln och begränsas till den komponent som startpunkten ligger närmast.
 */
/**
 * För mätning (scripts/gap-link-analysis.ts): nätets alla sammanhängande delar inom cirkeln, före val av startdel, samt hindernoderna.
 * Används inte av spelet.
 */
export function networkPieces(ways: TileWay[], activity: Activity, center: LatLon, radiusM: number): { graph: SerializedGraph; hazardNodes: Set<string> } {
  const a = assemble(ways, activity, center, radiusM, center, true, "nearest");
  return { graph: a.all, hazardNodes: a.allHazardNodes };
}

export function buildRegionGraph(ways: TileWay[], activity: Activity, center: LatLon, radiusM: number, anchor: LatLon = center, opts: { strict?: boolean; component?: ComponentPolicy } = {}): RegionGraph {
  const policy = opts.component ?? DEFAULT_COMPONENT_POLICY;
  const play = assemble(ways, activity, center, radiusM, anchor, true, policy);
  // Survival lägger inga rutter eller checkpoints, så det strikta nätet behövs inte där (sparar ungefär halva byggtiden på en telefon).
  const strict = opts.strict === false ? play : assemble(ways, activity, center, radiusM, anchor, false, policy);
  return {
    graph: strict.graph,
    play: { graph: play.graph, crossingNodes: play.crossingNodes, components: play.components, componentKm: play.componentKm },
    hazardNodes: strict.hazardNodes,
    startSnapM: strict.startSnapM,
    nearestAccess: strict.nearestAccess,
    stats: strict.stats,
  };
}

interface Assembled {
  /** Hela nätet inom cirkeln och alla hindernoder (före val av startdel), bara för `networkPieces`. */
  all: SerializedGraph;
  allHazardNodes: Set<string>;
  graph: SerializedGraph;
  hazardNodes: Set<string>;
  crossingNodes: Set<string>;
  startSnapM: number | null;
  nearestAccess: LatLon | null;
  components: number;
  componentKm: number;
  stats: RegionGraph["stats"];
}

/**
 * `bridge` = false: strikt nät (varje delad nod med större väg/järnväg/vattendrag blir en privat ändnod).
 * `bridge` = true: en gång-/cykelväg som delar nod med större väg/järnväg räknas som en kartlagd passage och behåller sin förbindelse:
 * - nod mitt på vägen (stigen fortsätter över): ingen klippning;
 * - nod i vägens ände: bara om minst två gångvägar möts där (en passage mappad som två halvor); en ensam stig som tar slut vid vägen förblir en återvändsgränd.
 * Broar och tunnlar delar aldrig nod med vägen de korsar och blir därför aldrig falskt förbundna.
 */
function assemble(ways: TileWay[], activity: Activity, center: LatLon, radiusM: number, anchor: LatLon, bridge: boolean, policy: ComponentPolicy): Assembled {
  const excluded: Record<string, number> = {};
  const raw: RawWay[] = [];
  const hazardNodes = new Set<string>();
  const crossingNodes = new Set<string>();
  const decided: { w: TileWay; d: Extract<ReturnType<typeof decideWay>, { ok: true }> }[] = [];
  for (const w of ways) {
    const d = decideWay(w.tags, activity);
    if (!d.ok) {
      excluded[d.reason] = (excluded[d.reason] ?? 0) + 1;
      continue;
    }
    decided.push({ w, d });
  }
  // Hur många gångvägar som delar varje hazardnod (för passager som är mappade som två halvor).
  const pedUse = new Map<string, number>();
  if (bridge) {
    for (const { w } of decided) {
      if (!PEDESTRIAN_HIGHWAYS.has(w.tags.highway)) continue;
      for (const i of new Set(w.hazard)) pedUse.set(w.nodes[i].id, (pedUse.get(w.nodes[i].id) ?? 0) + 1);
    }
  }
  let used = 0;
  for (const { w, d } of decided) {
    used++;
    let nodes = w.nodes;
    let hz = w.hazard;
    if (d.reverse) {
      nodes = [...nodes].reverse();
      hz = hz.map((i) => nodes.length - 1 - i);
    }
    if (bridge && PEDESTRIAN_HIGHWAYS.has(w.tags.highway)) {
      // Med nya tiles (`hazardKinds`) kopplas bara passager över secondary/tertiary (kind "t"); motorväg/trunk/primary, järnväg och vattendrag förblir klippta.
      // Äldre tiles saknar uppgiften: då gäller strukturregeln nedan för alla hinder (se docs/V2.2-ANALYS.md).
      const kindAt = new Map<number, string>();
      if (w.hazardKinds && !d.reverse) w.hazard.forEach((hi, k) => kindAt.set(hi, w.hazardKinds![k]));
      else if (w.hazardKinds) w.hazard.forEach((hi, k) => kindAt.set(w.nodes.length - 1 - hi, w.hazardKinds![k]));
      hz = hz.filter((i) => {
        const kind = kindAt.get(i);
        if (kind !== undefined && kind !== "t") return true; // inte en passage vi kopplar: förblir en hazard-ändnod
        const crossing = (i > 0 && i < nodes.length - 1) || (pedUse.get(nodes[i].id) ?? 0) >= 2;
        if (crossing) crossingNodes.add(nodes[i].id);
        return !crossing; // en ensam stig som tar slut vid vägen förblir en återvändsgränd
      });
    }
    const cuts = [0, ...[...new Set(hz)].filter((i) => i > 0 && i < nodes.length - 1).sort((a, b) => a - b), nodes.length - 1];
    const hazardSet = new Set(hz);
    const type = pathType(w.tags.highway);
    const easy = activity === "mtb" ? isEasyBikeWay(w.tags) : undefined;
    const grade = w.tags.tunnel && w.tags.tunnel !== "no" ? "tunnel" : w.tags.bridge && w.tags.bridge !== "no" ? "bridge" : undefined;
    for (let k = 0; k + 1 < cuts.length; k++) {
      const part = nodes.slice(cuts[k], cuts[k + 1] + 1).map((n) => ({ ...n }));
      if (part.length < 2) continue;
      const mkPrivate = (end: "first" | "last", idx: number) => {
        if (!hazardSet.has(idx)) return;
        const n = end === "first" ? part[0] : part[part.length - 1];
        n.id = `${n.id}!${w.id}.${k}${end === "first" ? "a" : "b"}`;
        hazardNodes.add(n.id);
      };
      mkPrivate("first", cuts[k]);
      mkPrivate("last", cuts[k + 1]);
      raw.push({ id: cuts.length > 2 ? `${w.id}.${k}` : w.id, nodes: part, type, oneway: d.oneway, easy, grade });
    }
  }
  const all = buildGraph(raw, "openstreetmap", crossingNodes);
  const keep = all.edges.filter((e) => haversineM(center, e.geometry[Math.floor(e.geometry.length / 2)]) <= radiusM);
  const ids = new Set(keep.flatMap((e) => [e.from, e.to]));
  const clipped: SerializedGraph = { ...all, nodes: all.nodes.filter((n) => ids.has(n.id)), edges: keep };
  const idx = indexGraph(clipped);
  const networkKm = idx.components.reduce((s, c) => s + c.lengthM, 0) / 1000;
  // Vilken del av nätet som används avgörs av `pickComponent` (se där för reglerna).
  const bestPer = new Map<number, { edgeId: string; distM: number }>();
  for (const e of idx.edges.values()) {
    const pr = projectToPolyline(e.geometry, e.cumM, anchor);
    const cur = bestPer.get(e.component);
    if (!cur || pr.distanceM < cur.distM) bestPer.set(e.component, { edgeId: e.id, distM: pr.distanceM });
  }
  const candidates: ComponentCandidate[] = [...bestPer.entries()].map(([id, b]) => ({ id, ...b, len: idx.components.find((c) => c.id === id)!.lengthM }));
  const best = pickComponent(candidates, policy);
  let graph = clipped;
  let componentKm = 0;
  let near: LatLon | null = null;
  if (best) {
    const edges = clipped.edges.filter((e) => idx.edges.get(e.id)?.component === best.id);
    const cids = new Set(edges.flatMap((e) => [e.from, e.to]));
    graph = { ...clipped, nodes: clipped.nodes.filter((n) => cids.has(n.id)), edges };
    componentKm = best.len / 1000;
    const e = idx.edges.get(best.edgeId)!;
    near = projectToPolyline(e.geometry, e.cumM, anchor).point;
  }
  const gnodes = new Set(graph.nodes.map((n) => n.id));
  return {
    all: clipped,
    allHazardNodes: hazardNodes,
    graph,
    hazardNodes: new Set([...hazardNodes].filter((id) => gnodes.has(id))),
    crossingNodes: new Set([...crossingNodes].filter((id) => gnodes.has(id))),
    startSnapM: best ? best.distM : null,
    nearestAccess: near,
    components: idx.components.length,
    componentKm,
    stats: { waysIn: ways.length, waysUsed: used, excluded, edges: graph.edges.length, networkKm, componentKm, hazardStubs: hazardNodes.size, components: idx.components.length, candidates: candidates.sort((a, b) => a.distM - b.distM).slice(0, 8).map((c) => ({ distM: Math.round(c.distM), lenM: Math.round(c.len), chosen: !!best && c.id === best.id })) },
  };
}

