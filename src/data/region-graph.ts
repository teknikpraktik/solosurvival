import type { Activity } from "@/config/activities";
import { buildGraph, type RawWay } from "@/geo/graph/build";
import { indexGraph } from "@/geo/graph/graph";
import type { PathType, SerializedGraph } from "@/geo/graph/types";
import { haversineM, projectToPolyline, type LatLon } from "@/geo/geometry";
import { decideWay } from "@/geo/osm/overpass";
import type { TileWay } from "./tile-format";

/** Start längre bort än så från närmaste tillåtna stig räknas som "utanför nätet" (samma gräns som ruttgeneratorn). */
export const MAX_START_SNAP_M = 150;

export interface RegionGraph {
  graph: SerializedGraph;
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
export function buildRegionGraph(ways: TileWay[], activity: Activity, center: LatLon, radiusM: number, anchor: LatLon = center): RegionGraph {
  const excluded: Record<string, number> = {};
  const raw: RawWay[] = [];
  const hazardNodes = new Set<string>();
  let used = 0;
  for (const w of ways) {
    const d = decideWay(w.tags, activity);
    if (!d.ok) {
      excluded[d.reason] = (excluded[d.reason] ?? 0) + 1;
      continue;
    }
    used++;
    let nodes = w.nodes;
    let hz = w.hazard;
    if (d.reverse) {
      nodes = [...nodes].reverse();
      hz = hz.map((i) => nodes.length - 1 - i);
    }
    const cuts = [0, ...[...new Set(hz)].filter((i) => i > 0 && i < nodes.length - 1).sort((a, b) => a - b), nodes.length - 1];
    const hazardSet = new Set(hz);
    const type = pathType(w.tags.highway);
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
      raw.push({ id: cuts.length > 2 ? `${w.id}.${k}` : w.id, nodes: part, type, oneway: d.oneway });
    }
  }
  const all = buildGraph(raw, "openstreetmap");
  const keep = all.edges.filter((e) => haversineM(center, e.geometry[Math.floor(e.geometry.length / 2)]) <= radiusM);
  const ids = new Set(keep.flatMap((e) => [e.from, e.to]));
  const clipped: SerializedGraph = { ...all, nodes: all.nodes.filter((n) => ids.has(n.id)), edges: keep };
  const idx = indexGraph(clipped);
  const networkKm = idx.components.reduce((s, c) => s + c.lengthM, 0) / 1000;
  // Närmaste "användbara" komponent: små isolerade fragment (< 1,5 km) väljs bara om inget större nät finns.
  const MIN_COMPONENT_M = 1500;
  const bestPer = new Map<number, { edgeId: string; distM: number }>();
  for (const e of idx.edges.values()) {
    const pr = projectToPolyline(e.geometry, e.cumM, anchor);
    const cur = bestPer.get(e.component);
    if (!cur || pr.distanceM < cur.distM) bestPer.set(e.component, { edgeId: e.id, distM: pr.distanceM });
  }
  const candidates = [...bestPer.entries()].map(([id, b]) => ({ id, ...b, len: idx.components.find((c) => c.id === id)!.lengthM }));
  const usable = candidates.filter((c) => c.len >= MIN_COMPONENT_M);
  const pool = usable.length ? usable : candidates;
  const best = pool.sort((a, b) => a.distM - b.distM)[0] ?? null;
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
    graph,
    hazardNodes: new Set([...hazardNodes].filter((id) => gnodes.has(id))),
    startSnapM: best ? best.distM : null,
    nearestAccess: near,
    stats: { waysIn: ways.length, waysUsed: used, excluded, edges: graph.edges.length, networkKm, componentKm, hazardStubs: hazardNodes.size, components: idx.components.length },
  };
}

