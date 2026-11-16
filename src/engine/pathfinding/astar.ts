import { MinHeap } from "../core/heap";
import { haversineM } from "@/geo/geometry";

import type { Dir, EdgePos, GraphEdge, TrailGraph } from "@/geo/graph/types";

export interface RouteStep {
  edgeId: string;
  dir: Dir;
}

export interface Route {
  /** Riktning på startkanten tills första noden nås. */
  firstDir: Dir;
  /** Kanter att följa efter att första noden nåtts. Sista steget är målkanten om målet ligger på en annan kant. */
  steps: RouteStep[];
  /** Offset på sista kanten där färden slutar. */
  stopAtM: number;
  etaS: number;
  lengthM: number;
}

/** Hastighet för en kant, så att underlag/lutning kan läggas till senare (PRD 4.3). */
export type SpeedFn = (e: GraphEdge) => number;

interface Source {
  node: string;
  g0: number;
}

interface AStarResult {
  cost: number;
  steps: RouteStep[];
  source: number;
}

/** Counts route searches (measurement only: scripts/ai-compare.ts). `nodes` = nodes taken off the queue in all of them. */
export const pathStats = { astar: 0, trees: 0, fields: 0, nodes: 0 };

/** Multi-käll A* med kostnad C(e) = L(e)/v(e). Kantriktningar (oneway) respekteras. */
export function astar(
  g: TrailGraph,
  sources: Source[],
  goal: string,
  speed: SpeedFn,
  vMax: number,
): AStarResult | null {
  const goalNode = g.nodes.get(goal);
  if (!goalNode) return null;
  const h = (n: string) => haversineM(g.nodes.get(n)!, goalNode) / vMax;
  const best = new Map<string, number>();
  const prev = new Map<string, { node: string; step: RouteStep } | { source: number }>();
  const open = new MinHeap<string>();
  sources.forEach((s, i) => {
    if (s.g0 < (best.get(s.node) ?? Infinity)) {
      best.set(s.node, s.g0);
      prev.set(s.node, { source: i });
      open.push(s.g0 + h(s.node), s.node);
    }
  });
  const closed = new Set<string>();
  pathStats.astar++;
  while (open.size) {
    const { v: n } = open.pop()!;
    if (closed.has(n)) continue;
    closed.add(n);
    pathStats.nodes++;
    if (n === goal) {
      const steps: RouteStep[] = [];
      let cur = n;
      for (;;) {
        const p = prev.get(cur)!;
        if ("source" in p) return { cost: best.get(goal)!, steps: steps.reverse(), source: p.source };
        steps.push(p.step);
        cur = p.node;
      }
    }
    const gn = best.get(n)!;
    for (const a of g.adj.get(n) ?? []) {
      const e = g.edges.get(a.edgeId)!;
      const c = gn + a.lengthM / speed(e);
      if (c < (best.get(a.to) ?? Infinity)) {
        best.set(a.to, c);
        prev.set(a.to, { node: n, step: { edgeId: a.edgeId, dir: a.dir } });
        open.push(c + h(a.to), a.to);
      }
    }
  }
  return null;
}

export interface PlanOptions {
  speed?: SpeedFn;
  /** Om satt får färden inte vända: bara denna riktning på startkanten är tillåten. */
  heading?: Dir;
  /** Största kantfart; anges den hoppar planeringen över genomgången av alla kanter (stora terränggrafer). */
  vMax?: number;
}

/** Planerar kortaste färdväg (i tid) mellan två positioner på nätet. */
export function planRoute(g: TrailGraph, from: EdgePos, to: EdgePos, speedMps: number, opts: PlanOptions = {}): Route | null {
  const speed = opts.speed ?? (() => speedMps);
  const e0 = g.edges.get(from.edgeId);
  const e1 = g.edges.get(to.edgeId);
  if (!e0 || !e1) return null;

  let bestRoute: Route | null = null;
  const consider = (r: Route) => {
    if (!bestRoute || r.etaS < bestRoute.etaS) bestRoute = r;
  };

  // Direkt på samma kant.
  if (e0.id === e1.id) {
    const dir: Dir = to.distM >= from.distM ? 1 : -1;
    if ((dir === 1 || !e0.oneway) && (opts.heading === undefined || opts.heading === dir)) {
      const len = Math.abs(to.distM - from.distM);
      consider({ firstDir: dir, steps: [], stopAtM: to.distM, etaS: len / speed(e0), lengthM: len });
    }
  }

  const srcOpts: { dir: Dir; node: string; g0: number; len: number }[] = [];
  if (opts.heading === undefined || opts.heading === 1) {
    srcOpts.push({ dir: 1, node: e0.to, g0: (e0.lengthM - from.distM) / speed(e0), len: e0.lengthM - from.distM });
  }
  if ((opts.heading === undefined || opts.heading === -1) && !e0.oneway) {
    srcOpts.push({ dir: -1, node: e0.from, g0: from.distM / speed(e0), len: from.distM });
  }
  const goalOpts: { dir: Dir; node: string; cost: number; len: number }[] = [
    { dir: 1, node: e1.from, cost: to.distM / speed(e1), len: to.distM },
  ];
  if (!e1.oneway) {
    goalOpts.push({ dir: -1, node: e1.to, cost: (e1.lengthM - to.distM) / speed(e1), len: e1.lengthM - to.distM });
  }
  let vMax = opts.vMax ?? 0.001;
  if (opts.vMax === undefined) for (const e of g.edges.values()) vMax = Math.max(vMax, speed(e));

  for (const go of goalOpts) {
    const res = astar(g, srcOpts.map((s) => ({ node: s.node, g0: s.g0 })), go.node, speed, vMax);
    if (!res) continue;
    const src = srcOpts[res.source];
    const pathLen = res.steps.reduce((s, st) => s + g.edges.get(st.edgeId)!.lengthM, 0);
    consider({
      firstDir: src.dir,
      steps: [...res.steps, { edgeId: e1.id, dir: go.dir }],
      stopAtM: to.distM,
      etaS: res.cost + go.cost,
      lengthM: src.len + pathLen + go.len,
    });
  }
  return bestRoute;
}

/** Närmaste nätavstånd (meter) från en position till alla noder, med valfri begränsning. */
export function networkDistances(g: TrailGraph, from: EdgePos, maxM = Infinity, skipEdge?: (e: GraphEdge) => boolean): Map<string, number> {
  const e0 = g.edges.get(from.edgeId)!;
  const dist = new Map<string, number>();
  const open = new MinHeap<string>();
  const seed = (node: string, d: number) => {
    if (d < (dist.get(node) ?? Infinity)) {
      dist.set(node, d);
      open.push(d, node);
    }
  };
  seed(e0.to, e0.lengthM - from.distM);
  if (!e0.oneway) seed(e0.from, from.distM);
  const done = new Set<string>();
  while (open.size) {
    const { v: n } = open.pop()!;
    if (done.has(n)) continue;
    done.add(n);
    const dn = dist.get(n)!;
    if (dn > maxM) continue;
    for (const a of g.adj.get(n) ?? []) {
      if (skipEdge && skipEdge(g.edges.get(a.edgeId)!)) continue;
      seed(a.to, dn + a.lengthM);
    }
  }
  return dist;
}

/** Nätavstånd från en position till en annan, givet förberäknade nodavstånd från `from`. */
export function distanceToPos(g: TrailGraph, from: EdgePos, dists: Map<string, number>, to: EdgePos): number {
  const e = g.edges.get(to.edgeId)!;
  let d = Math.min(
    (dists.get(e.from) ?? Infinity) + to.distM,
    e.oneway ? Infinity : (dists.get(e.to) ?? Infinity) + (e.lengthM - to.distM),
  );
  if (e.id === from.edgeId) d = Math.min(d, Math.abs(to.distM - from.distM));
  return d;
}


/**
 * Kortaste-tid-träd mot ett mål: en enda Dijkstra från målet ger rutter för alla zombier som jagar samma punkt (magnet-jakt). I stora terrängnät
 * (tusentals noder) är en A*-sökning per zombie och omplanering för dyr; trädet byggs en gång per observation och delas.
 * Samma kostnadsmodell som `planRoute` (längd / fart per kant). Bara för grafer utan enkelriktade kanter (`null` annars; då gäller `planRoute`).
 */
export interface TargetTree {
  routeFrom(from: EdgePos): Route | null;
}

export function buildTargetTree(g: TrailGraph, to: EdgePos, speed: SpeedFn): TargetTree | null {
  const e1 = g.edges.get(to.edgeId);
  if (!e1) return null;
  for (const e of g.edges.values()) if (e.oneway) return null;
  const cost = new Map<string, number>();
  /** Steg från noden mot målet; `goal` = noden är en målkants ände. */
  const next = new Map<string, { step: RouteStep; node: string } | { goal: Dir }>();
  const heap = new MinHeap<string>();
  const seed = (node: string, c: number, goalDir: Dir) => {
    if (c < (cost.get(node) ?? Infinity)) {
      cost.set(node, c);
      next.set(node, { goal: goalDir });
      heap.push(c, node);
    }
  };
  seed(e1.from, to.distM / speed(e1), 1);
  seed(e1.to, (e1.lengthM - to.distM) / speed(e1), -1);
  const done = new Set<string>();
  pathStats.trees++;
  while (heap.size) {
    const { v: m } = heap.pop()!;
    if (done.has(m)) continue;
    done.add(m);
    pathStats.nodes++;
    const cm = cost.get(m)!;
    for (const a of g.adj.get(m) ?? []) {
      const c = cm + a.lengthM / speed(g.edges.get(a.edgeId)!);
      if (c < (cost.get(a.to) ?? Infinity)) {
        cost.set(a.to, c);
        next.set(a.to, { step: { edgeId: a.edgeId, dir: (-a.dir) as Dir }, node: m });
        heap.push(c, a.to);
      }
    }
  }
  const stepsFrom = (node: string): RouteStep[] | null => {
    const steps: RouteStep[] = [];
    let cur = node;
    for (let guard = 0; guard < 100000; guard++) {
      const n = next.get(cur);
      if (!n) return null;
      if ("goal" in n) {
        steps.push({ edgeId: e1.id, dir: n.goal });
        return steps;
      }
      steps.push(n.step);
      cur = n.node;
    }
    return null;
  };
  return {
    routeFrom(from: EdgePos): Route | null {
      const e0 = g.edges.get(from.edgeId);
      if (!e0) return null;
      let best: Route | null = null;
      if (e0.id === e1.id) {
        const dir: Dir = to.distM >= from.distM ? 1 : -1;
        const len = Math.abs(to.distM - from.distM);
        best = { firstDir: dir, steps: [], stopAtM: to.distM, etaS: len / speed(e0), lengthM: len };
      }
      for (const [dir, node, len] of [[1, e0.to, e0.lengthM - from.distM], [-1, e0.from, from.distM]] as [Dir, string, number][]) {
        const c = cost.get(node);
        if (c === undefined) continue;
        const eta = len / speed(e0) + c;
        if (best && best.etaS <= eta) continue;
        const steps = stepsFrom(node);
        if (!steps) continue;
        best = { firstDir: dir, steps, stopAtM: to.distM, etaS: eta, lengthM: len + steps.reduce((s, st) => s + g.edges.get(st.edgeId)!.lengthM, 0) };
      }
      return best;
    },
  };
}

/**
 * Travel times from one position to every node that can be reached within `maxS` seconds, and the fastest route to any of them: one
 * bounded search instead of one A* per candidate. Same cost model as `planRoute` (length / speed per edge), one-way edges respected.
 * A route ends at the node itself.
 */
export interface TravelTimes {
  etaS(nodeId: string): number | undefined;
  routeTo(nodeId: string): Route | null;
}

export function travelTimes(g: TrailGraph, from: EdgePos, speed: SpeedFn, maxS: number): TravelTimes | null {
  const e0 = g.edges.get(from.edgeId);
  if (!e0) return null;
  const cost = new Map<string, number>();
  const prev = new Map<string, { node: string; step: RouteStep } | { first: Dir }>();
  const heap = new MinHeap<string>();
  const seed = (node: string, c: number, first: Dir) => {
    if (c < (cost.get(node) ?? Infinity)) {
      cost.set(node, c);
      prev.set(node, { first });
      heap.push(c, node);
    }
  };
  seed(e0.to, (e0.lengthM - from.distM) / speed(e0), 1);
  if (!e0.oneway) seed(e0.from, from.distM / speed(e0), -1);
  const done = new Set<string>();
  pathStats.fields++;
  while (heap.size) {
    const { v: n } = heap.pop()!;
    if (done.has(n)) continue;
    done.add(n);
    pathStats.nodes++;
    const cn = cost.get(n)!;
    if (cn > maxS) break;
    for (const a of g.adj.get(n) ?? []) {
      const c = cn + a.lengthM / speed(g.edges.get(a.edgeId)!);
      if (c < (cost.get(a.to) ?? Infinity)) {
        cost.set(a.to, c);
        prev.set(a.to, { node: n, step: { edgeId: a.edgeId, dir: a.dir } });
        heap.push(c, a.to);
      }
    }
  }
  return {
    etaS: (nodeId) => (done.has(nodeId) ? cost.get(nodeId) : undefined),
    routeTo(nodeId) {
      if (!done.has(nodeId)) return null;
      const steps: RouteStep[] = [];
      let cur = nodeId;
      for (let guard = 0; guard < 100000; guard++) {
        const p = prev.get(cur);
        if (!p) return null;
        if ("first" in p) {
          steps.reverse();
          const last = steps.at(-1);
          const lastEdge = last ? g.edges.get(last.edgeId)! : e0;
          const lastDir = last ? last.dir : p.first;
          const lengthM = (p.first === 1 ? e0.lengthM - from.distM : from.distM) + steps.reduce((s, st) => s + g.edges.get(st.edgeId)!.lengthM, 0);
          return { firstDir: p.first, steps, stopAtM: lastDir === 1 ? lastEdge.lengthM : 0, etaS: cost.get(nodeId)!, lengthM };
        }
        steps.push(p.step);
        cur = p.node;
      }
      return null;
    },
  };
}
