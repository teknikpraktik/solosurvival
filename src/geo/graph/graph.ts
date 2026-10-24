import {
  cumulativeLengths,
  haversineM,
  pointAlong,
  projectToPolyline,
  type LatLon,
} from "../geometry";
import type {
  Adjacent,
  ComponentInfo,
  Dir,
  EdgePos,
  GraphEdge,
  GraphNode,
  SerializedGraph,
  TrailGraph,
} from "./types";

export const GRAPH_VERSION = "1.0";

/** Bygger sökbart index (längder, grannlistor, sammanhängande komponenter) av en serialiserad graf. */
export function indexGraph(g: SerializedGraph): TrailGraph {
  const nodes = new Map<string, GraphNode>(g.nodes.map((n) => [n.id, n]));
  const edges = new Map<string, GraphEdge>();
  const adj = new Map<string, Adjacent[]>();
  for (const n of g.nodes) adj.set(n.id, []);

  for (const raw of g.edges) {
    if (!nodes.has(raw.from) || !nodes.has(raw.to) || raw.geometry.length < 2) continue;
    const cumM = cumulativeLengths(raw.geometry);
    const lengthM = cumM[cumM.length - 1];
    if (!(lengthM > 0)) continue;
    edges.set(raw.id, { ...raw, cumM, lengthM, component: -1 });
    adj.get(raw.from)!.push({ edgeId: raw.id, to: raw.to, dir: 1, lengthM });
    if (!raw.oneway) adj.get(raw.to)!.push({ edgeId: raw.id, to: raw.from, dir: -1, lengthM });
  }

  // Komponenter räknas odirigerat (union-find över noder).
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    while (parent.get(x)! !== r) {
      const n = parent.get(x)!;
      parent.set(x, r);
      x = n;
    }
    return r;
  };
  for (const id of nodes.keys()) parent.set(id, id);
  for (const e of edges.values()) parent.set(find(e.from), find(e.to));

  const compIndex = new Map<string, number>();
  const components: ComponentInfo[] = [];
  const degree = new Map<string, number>();
  for (const e of edges.values()) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  for (const e of edges.values()) {
    const root = find(e.from);
    let idx = compIndex.get(root);
    if (idx === undefined) {
      idx = components.length;
      compIndex.set(root, idx);
      components.push({ id: idx, lengthM: 0, nodeIds: [], junctionCount: 0 });
    }
    e.component = idx;
    components[idx].lengthM += e.lengthM;
  }
  for (const id of nodes.keys()) {
    if (!degree.has(id)) continue;
    const c = components[compIndex.get(find(id))!];
    c.nodeIds.push(id);
    if ((degree.get(id) ?? 0) >= 3) c.junctionCount++;
  }
  const hasOfftrail = g.edges.some((e) => e.offtrail);
  return { nodes, edges, adj, components, crossingNodes: new Set(g.crossingNodes ?? []), ...(hasOfftrail ? { hasOfftrail: true } : {}) };
}

export function serializeGraph(g: TrailGraph, source = "synthetic"): SerializedGraph {
  return {
    graphVersion: GRAPH_VERSION,
    source,
    nodes: [...g.nodes.values()],
    edges: [...g.edges.values()].map(({ id, from, to, geometry, type, oneway, easy, grade, crossing, offtrail }) => ({
      id,
      from,
      to,
      geometry,
      type,
      oneway,
      easy,
      grade,
      crossing,
      offtrail,
    })),
    crossingNodes: g.crossingNodes.size ? [...g.crossingNodes] : undefined,
  };
}

export function edgeLatLon(g: TrailGraph, pos: EdgePos): LatLon {
  const e = g.edges.get(pos.edgeId)!;
  return pointAlong(e.geometry, e.cumM, pos.distM);
}

export function nodeLatLon(g: TrailGraph, nodeId: string): LatLon {
  return g.nodes.get(nodeId)!;
}

export function otherEnd(e: GraphEdge, dir: Dir): string {
  return dir === 1 ? e.to : e.from;
}

export interface Snap extends EdgePos {
  offNetworkM: number;
}

/** I en graf med terrängkanter vinner en stig om den ligger inom så här många meter från den närmaste terrängkanten. */
export const OFFTRAIL_SNAP_PENALTY_M = 4;

const CELL_DEG = 0.001;
const GRID_SAMPLE_M = 40;
const gridCache = new WeakMap<TrailGraph, { cells: Map<string, string[]>; cosLat: number }>();

/** Rumsindex för grafer med terrängkanter (tusentals kanter): kantid per cell om ca 110 m, med kanter inlagda i varje cell de passerar. */
function gridFor(g: TrailGraph) {
  let hit = gridCache.get(g);
  if (hit) return hit;
  const first = g.nodes.values().next().value as GraphNode | undefined;
  const cosLat = Math.cos(((first?.lat ?? 59) * Math.PI) / 180);
  const cells = new Map<string, string[]>();
  const key = (lat: number, lon: number) => `${Math.floor(lat / CELL_DEG)}_${Math.floor(lon / (CELL_DEG / cosLat))}`;
  for (const e of g.edges.values()) {
    const seen = new Set<string>();
    const add = (pt: LatLon) => { const k = key(pt.lat, pt.lon); if (!seen.has(k)) { seen.add(k); (cells.get(k) ?? cells.set(k, []).get(k)!).push(e.id); } };
    for (let i = 0; i + 1 < e.geometry.length; i++) {
      const a = e.geometry[i], b = e.geometry[i + 1];
      const n = Math.max(1, Math.ceil(haversineM(a, b) / GRID_SAMPLE_M));
      for (let k = 0; k <= n; k++) add({ lat: a.lat + ((b.lat - a.lat) * k) / n, lon: a.lon + ((b.lon - a.lon) * k) / n });
    }
  }
  hit = { cells, cosLat };
  gridCache.set(g, hit);
  return hit;
}

/** Kantkandidater nära `p`. Utan terrängkanter alla kanter (oförändrat beteende); annars kanter i 5 × 5 celler, och alla om inget hittas. */
function candidateEdges(g: TrailGraph, p: LatLon): Iterable<GraphEdge> {
  if (!g.hasOfftrail) return g.edges.values();
  const { cells, cosLat } = gridFor(g);
  const cy = Math.floor(p.lat / CELL_DEG), cx = Math.floor(p.lon / (CELL_DEG / cosLat));
  const ids = new Set<string>();
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) for (const id of cells.get(`${cy + dy}_${cx + dx}`) ?? []) ids.add(id);
  if (!ids.size) return g.edges.values();
  return [...ids].map((id) => g.edges.get(id)!);
}

const rank = (g: TrailGraph, e: GraphEdge, distanceM: number): number => (g.hasOfftrail && e.offtrail ? distanceM + OFFTRAIL_SNAP_PENALTY_M : distanceM);

/** Närmaste punkt på nätet. Linjär svepning räcker för spelområden av v1-storlek; med terrängkanter används ett rumsindex. */
export function snapToGraph(g: TrailGraph, p: LatLon, component?: number): Snap | null {
  let best: Snap | null = null;
  let bestRank = Infinity;
  for (const e of candidateEdges(g, p)) {
    if (component !== undefined && e.component !== component) continue;
    const pr = projectToPolyline(e.geometry, e.cumM, p);
    const r = rank(g, e, pr.distanceM);
    if (!best || r < bestRank) {
      best = { edgeId: e.id, distM: pr.distAlongM, offNetworkM: pr.distanceM };
      bestRank = r;
    }
  }
  return best;
}

/** Within this much of the closest edge, the one continuing from the previous position wins (see snapToGraphNear). */
export const SNAP_CONTINUITY_M = 8;

/**
 * Like snapToGraph, but keeps the player on the way they were already on. Where two ways lie almost on top of each other
 * (a bridge over a road, a road above a tunnel, parallel sidewalks) the plain nearest edge flips with GPS noise and can put the player
 * on the wrong level. With a previous position, an edge that is the previous edge or touches it wins if it is within
 * SNAP_CONTINUITY_M of the closest one.
 */
export function snapToGraphNear(g: TrailGraph, p: LatLon, component?: number, prev?: EdgePos | null): Snap | null {
  const prevEdge = prev ? g.edges.get(prev.edgeId) : undefined;
  let best: Snap | null = null, bestRank = Infinity;
  let kept: Snap | null = null, keptRank = Infinity;
  for (const e of candidateEdges(g, p)) {
    if (component !== undefined && e.component !== component) continue;
    const pr = projectToPolyline(e.geometry, e.cumM, p);
    const cand: Snap = { edgeId: e.id, distM: pr.distAlongM, offNetworkM: pr.distanceM };
    const r = rank(g, e, pr.distanceM);
    if (!best || r < bestRank) { best = cand; bestRank = r; }
    if (prevEdge && (e.id === prevEdge.id || e.from === prevEdge.from || e.from === prevEdge.to || e.to === prevEdge.from || e.to === prevEdge.to)) {
      if (!kept || r < keptRank) { kept = cand; keptRank = r; }
    }
  }
  if (best && kept && keptRank <= bestRank + SNAP_CONTINUITY_M) return kept;
  return best;
}

/** Alla kantpositioner inom `toleranceM` av bästa träffen – används för att upptäcka tvetydiga parallella stigar. */
export function nearbyEdges(g: TrailGraph, p: LatLon, radiusM: number): Snap[] {
  const out: Snap[] = [];
  for (const e of g.edges.values()) {
    const pr = projectToPolyline(e.geometry, e.cumM, p);
    if (pr.distanceM <= radiusM) out.push({ edgeId: e.id, distM: pr.distAlongM, offNetworkM: pr.distanceM });
  }
  return out.sort((a, b) => a.offNetworkM - b.offNetworkM);
}

export function degreeOf(g: TrailGraph, nodeId: string): number {
  return g.adj.get(nodeId)?.length ?? 0;
}

/** Position på en kant vid en nod (för att kunna använda noder som mål). */
export function posAtNode(g: TrailGraph, nodeId: string): EdgePos | null {
  const a = g.adj.get(nodeId)?.[0];
  if (!a) return null;
  return { edgeId: a.edgeId, distM: a.dir === 1 ? 0 : g.edges.get(a.edgeId)!.lengthM };
}

export function straightDistanceM(g: TrailGraph, a: string, b: string): number {
  return haversineM(g.nodes.get(a)!, g.nodes.get(b)!);
}
