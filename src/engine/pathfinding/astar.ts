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
  /** Källan nås via en off-road-kant (zombien befinner sig på en förbindelse). */
  offroad?: boolean;
}

interface AStarResult {
  cost: number;
  steps: RouteStep[];
  source: number;
}

/**
 * Multi-käll A* med kostnad C(e) = L(e)/v(e). Kantriktningar (oneway) respekteras.
 * Off-road-kanter får inte följa direkt på varandra: efter en off-road-kant måste en stig följa, så att
 * sammanhängande rörelse utanför stig aldrig blir längre än en enskild förbindelse. Tillståndet är (nod, kom via off-road).
 */
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
  const k = (n: string, f: boolean) => (f ? `${n}#` : n);
  const best = new Map<string, number>();
  type Prev = { key: string; step: RouteStep } | { source: number };
  const prev = new Map<string, Prev>();
  const open = new MinHeap<{ node: string; off: boolean }>();
  sources.forEach((s, i) => {
    const key = k(s.node, !!s.offroad);
    if (s.g0 < (best.get(key) ?? Infinity)) {
      best.set(key, s.g0);
      prev.set(key, { source: i });
      open.push(s.g0 + h(s.node), { node: s.node, off: !!s.offroad });
    }
  });
  const closed = new Set<string>();
  while (open.size) {
    const { v } = open.pop()!;
    const key = k(v.node, v.off);
    if (closed.has(key)) continue;
    closed.add(key);
    if (v.node === goal) {
      const steps: RouteStep[] = [];
      let cur = key;
      for (;;) {
        const p = prev.get(cur)!;
        if ("source" in p) return { cost: best.get(key)!, steps: steps.reverse(), source: p.source };
        steps.push(p.step);
        cur = p.key;
      }
    }
    const gn = best.get(key)!;
    for (const a of g.adj.get(v.node) ?? []) {
      const e = g.edges.get(a.edgeId)!;
      if (v.off && e.offroad) continue;
      const c = gn + a.lengthM / speed(e);
      const nk = k(a.to, !!e.offroad);
      if (c < (best.get(nk) ?? Infinity)) {
        best.set(nk, c);
        prev.set(nk, { key, step: { edgeId: a.edgeId, dir: a.dir } });
        open.push(c + h(a.to), { node: a.to, off: !!e.offroad });
      }
    }
  }
  return null;
}

export interface PlanOptions {
  speed?: SpeedFn;
  /** Om satt får färden inte vända: bara denna riktning på startkanten är tillåten. */
  heading?: Dir;
}

/** Planerar kortaste färdväg (i tid) mellan två positioner på nätet. */
export function planRoute(g: TrailGraph, from: EdgePos, to: EdgePos, speedMps: number, opts: PlanOptions = {}): Route | null {
  const speed = opts.speed ?? ((e: GraphEdge) => speedMps * (e.speedFactor ?? 1));
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
  let vMax = 0.001;
  for (const e of g.edges.values()) vMax = Math.max(vMax, speed(e));

  for (const go of goalOpts) {
    const res = astar(g, srcOpts.map((s) => ({ node: s.node, g0: s.g0, offroad: !!e0.offroad })), go.node, speed, vMax);
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
export function networkDistances(g: TrailGraph, from: EdgePos, maxM = Infinity): Map<string, number> {
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
    for (const a of g.adj.get(n) ?? []) seed(a.to, dn + a.lengthM);
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

