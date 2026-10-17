import { pointAlong, type LatLon } from "@/geo/geometry";
import { nodeLatLon, posAtNode } from "@/geo/graph/graph";
import type { EdgePos, GraphEdge, TrailGraph } from "@/geo/graph/types";
import { planRoute, type Route } from "@/engine/pathfinding/astar";

export interface Leg {
  from: EdgePos;
  route: Route;
  lengthM: number;
  edgeIds: string[];
  geometry: LatLon[];
}

/** Delpolylinje längs en kant mellan två avstånd (i valfri riktning). */
function slice(e: GraphEdge, d0: number, d1: number): LatLon[] {
  const out: LatLon[] = [pointAlong(e.geometry, e.cumM, d0)];
  if (d1 >= d0) {
    for (let i = 1; i < e.geometry.length - 1; i++) if (e.cumM[i] > d0 && e.cumM[i] < d1) out.push(e.geometry[i]);
  } else {
    for (let i = e.geometry.length - 2; i >= 1; i--) if (e.cumM[i] < d0 && e.cumM[i] > d1) out.push(e.geometry[i]);
  }
  out.push(pointAlong(e.geometry, e.cumM, d1));
  return out;
}

export function nodePos(g: TrailGraph, nodeId: string): EdgePos {
  const p = posAtNode(g, nodeId);
  if (!p) throw new Error(`Noden ${nodeId} saknar kanter`);
  return p;
}

/**
 * Kortaste väg mellan två positioner där kanter kan ges straff (multiplikator ≥ 1 på kostnaden).
 * Längd och geometri avser den fysiska sträckan, inte den straffade kostnaden.
 */
export function legBetween(g: TrailGraph, from: EdgePos, to: EdgePos, penalty?: Map<string, number>): Leg | null {
  const speed = penalty ? (e: GraphEdge) => 1 / (penalty.get(e.id) ?? 1) : undefined;
  const route = planRoute(g, from, to, 1, speed ? { speed } : {});
  if (!route) return null;
  const e0 = g.edges.get(from.edgeId)!;
  const edgeIds = [from.edgeId];
  const geometry: LatLon[] = [];
  if (route.steps.length === 0) {
    geometry.push(...slice(e0, from.distM, route.stopAtM));
  } else {
    geometry.push(...slice(e0, from.distM, route.firstDir === 1 ? e0.lengthM : 0));
    route.steps.forEach((s, i) => {
      const e = g.edges.get(s.edgeId)!;
      edgeIds.push(s.edgeId);
      const last = i === route.steps.length - 1;
      const start = s.dir === 1 ? 0 : e.lengthM;
      const end = last ? route.stopAtM : s.dir === 1 ? e.lengthM : 0;
      geometry.push(...slice(e, start, end).slice(1));
    });
  }
  return { from, route, lengthM: route.lengthM, edgeIds, geometry };
}

/** Kantföljd för ett ben. Kanter med försumbar sträcka (< 0,5 m) hoppas över, utom första kanten på första benet. */
export function legSteps(g: TrailGraph, leg: Leg, first: boolean): { edgeId: string; dir: 1 | -1 }[] {
  const out: { edgeId: string; dir: 1 | -1 }[] = [];
  const e0 = g.edges.get(leg.from.edgeId)!;
  const r = leg.route;
  if (r.steps.length === 0) {
    if (first || Math.abs(r.stopAtM - leg.from.distM) >= 0.5) out.push({ edgeId: e0.id, dir: r.firstDir });
    return out;
  }
  const len0 = r.firstDir === 1 ? e0.lengthM - leg.from.distM : leg.from.distM;
  if (first || len0 >= 0.5) out.push({ edgeId: e0.id, dir: r.firstDir });
  r.steps.forEach((s, i) => {
    const e = g.edges.get(s.edgeId)!;
    const last = i === r.steps.length - 1;
    const from = s.dir === 1 ? 0 : e.lengthM;
    const to = last ? r.stopAtM : s.dir === 1 ? e.lengthM : 0;
    if (Math.abs(to - from) >= 0.5) out.push({ edgeId: s.edgeId, dir: s.dir });
  });
  return out;
}

export function joinGeometry(legs: Leg[]): LatLon[] {
  const out: LatLon[] = [];
  for (const l of legs) out.push(...(out.length ? l.geometry.slice(1) : l.geometry));
  return out;
}

/** Ökar straffet på kanter som redan används (längdviktat antal gånger). */
export function addPenalty(pen: Map<string, number>, edgeIds: string[], factor: number) {
  for (const id of edgeIds) pen.set(id, Math.max(pen.get(id) ?? 1, factor));
}

export { nodeLatLon };
