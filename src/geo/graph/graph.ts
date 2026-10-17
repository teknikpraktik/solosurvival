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
  const graph: TrailGraph = { nodes, edges, adj, components };
  if (g.edges.some((e) => e.offroad)) graph.trail = indexGraph({ ...g, edges: g.edges.filter((e) => !e.offroad) });
  return graph;
}

/** Spelarens vy av nätet: stigar och vägar, utan zombiernas off-road-förbindelser. */
export function trailOf(g: TrailGraph): TrailGraph {
  return g.trail ?? g;
}

export function serializeGraph(g: TrailGraph, source = "synthetic"): SerializedGraph {
  return {
    graphVersion: GRAPH_VERSION,
    source,
    nodes: [...g.nodes.values()],
    edges: [...g.edges.values()].map(({ id, from, to, geometry, type, oneway, offroad, speedFactor }) => ({
      id,
      from,
      to,
      geometry,
      type,
      oneway,
      ...(offroad ? { offroad, speedFactor } : {}),
    })),
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

/** Närmaste punkt på nätet. Linjär svepning räcker för spelområden av v1-storlek. */
export function snapToGraph(g: TrailGraph, p: LatLon, component?: number): Snap | null {
  let best: Snap | null = null;
  for (const e of trailOf(g).edges.values()) {
    if (component !== undefined && e.component !== component) continue;
    const pr = projectToPolyline(e.geometry, e.cumM, p);
    if (!best || pr.distanceM < best.offNetworkM) {
      best = { edgeId: e.id, distM: pr.distAlongM, offNetworkM: pr.distanceM };
    }
  }
  return best;
}

/** Alla kantpositioner inom `toleranceM` av bästa träffen – används för att upptäcka tvetydiga parallella stigar. */
export function nearbyEdges(g: TrailGraph, p: LatLon, radiusM: number): Snap[] {
  const out: Snap[] = [];
  for (const e of trailOf(g).edges.values()) {
    const pr = projectToPolyline(e.geometry, e.cumM, p);
    if (pr.distanceM <= radiusM) out.push({ edgeId: e.id, distM: pr.distAlongM, offNetworkM: pr.distanceM });
  }
  return out.sort((a, b) => a.offNetworkM - b.offNetworkM);
}

export function degreeOf(g: TrailGraph, nodeId: string): number {
  return trailOf(g).adj.get(nodeId)?.length ?? 0;
}

/** Position på en kant vid en nod (för att kunna använda noder som mål). */
export function posAtNode(g: TrailGraph, nodeId: string): EdgePos | null {
  const pg = trailOf(g);
  const a = pg.adj.get(nodeId)?.[0];
  if (!a) return null;
  return { edgeId: a.edgeId, distM: a.dir === 1 ? 0 : pg.edges.get(a.edgeId)!.lengthM };
}

export function straightDistanceM(g: TrailGraph, a: string, b: string): number {
  return haversineM(g.nodes.get(a)!, g.nodes.get(b)!);
}
