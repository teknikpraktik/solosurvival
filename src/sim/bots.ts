import { ACTIVITIES } from "@/config/activities";
import { MinHeap } from "@/engine/core/heap";
import { networkDistances } from "@/engine/pathfinding/astar";
import { activeTarget } from "@/engine/objectives/objectives";
import { snapToGraph } from "@/geo/graph/graph";
import type { EdgePos, TrailGraph } from "@/geo/graph/types";
import type { GameState } from "@/engine/core/types";
import type { PlayerCtx } from "./runner";

export interface BotStats {
  /** Vägval med minst två alternativ. */
  decisions: number;
  /** Vägval där den mest målinriktade vägen var otillgänglig, dvs. en zombie hinner före spelaren. */
  blocked: number;
  /** Vägval där boten valde något annat än den mest målinriktade vägen. */
  deviations: number;
}

export const newBotStats = (): BotStats => ({ decisions: 0, blocked: 0, deviations: 0 });

/** Tidigast ankomst (s) för någon zombie till varje nod. */
export function zombieEtas(g: TrailGraph, st: GameState): Map<string, number> {
  const best = new Map<string, number>();
  const heap = new MinHeap<string>();
  const seed = (n: string, t: number) => {
    if (t < (best.get(n) ?? Infinity)) { best.set(n, t); heap.push(t, n); }
  };
  const v = st.zombies[0]?.speedMps ?? 1;
  for (const z of st.zombies) {
    const e = g.edges.get(z.edgeId)!;
    seed(e.to, (e.lengthM - z.distanceAlongEdgeM) / z.speedMps);
    if (!e.oneway) seed(e.from, z.distanceAlongEdgeM / z.speedMps);
  }
  while (heap.size) {
    const { k, v: n } = heap.pop()!;
    if (k > (best.get(n) ?? Infinity)) continue;
    for (const a of g.adj.get(n) ?? []) seed(a.to, k + a.lengthM / v);
  }
  return best;
}

const SAFE_MARGIN_S = 20;
const DEAD_END_PENALTY_S = 60;

/** Målposition för boten: aktivt mål (Escape/Mission) eller extraction (Survival). */
function targetPos(c: PlayerCtx): EdgePos | null {
  const t = c.state.objectives ? activeTarget(c.state.objectives) : undefined;
  if (t) {
    const s = snapToGraph(c.g, t, c.state.component);
    return s ? { edgeId: s.edgeId, distM: s.distM } : null;
  }
  if (c.state.extractionNodeId) {
    const n = c.g.nodes.get(c.state.extractionNodeId)!;
    const s = snapToGraph(c.g, n, c.state.component);
    return s ? { edgeId: s.edgeId, distM: s.distM } : null;
  }
  return null;
}

/**
 * - `follower`: går mot målet och ignorerar zombier (referens för "enbart rutten").
 * - `planner`: går mot målet men väljer en annan väg när en zombie hinner före (maximin över tre korsningar).
 *   Utan mål (Survival före extraction) maximeras bara säkerhetsmarginalen.
 * Boten vet inget om framtida zombierörelser, men ser zombiernas positioner (som spelaren).
 */
export function makeGoalBot(kind: "follower" | "planner", stats: BotStats, path?: { edgeId: string; dir: 1 | -1 }[]) {
  // Pekare i referensrutten: index för steget spelaren senast gick (0 = startkanten).
  let ptr = 0;
  const cache = new WeakMap<object, { key: string; d: Map<string, number> }>();
  return (c: PlayerCtx): number => {
    const { g, state } = c;
    const pace = ACTIVITIES[state.config.activity].playerPaceMps;
    const tp = targetPos(c);
    const distMap = tp ? (() => {
      const key = `${tp.edgeId}@${tp.distM.toFixed(1)}`;
      const hit = cache.get(g);
      if (hit && hit.key === key) return hit.d;
      const d = networkDistances(g, tp);
      cache.set(g, { key, d });
      return d;
    })() : null;
    const first = g.edges.get(c.options[0].edgeId)!;
    const here = c.options[0].dir === 1 ? first.from : first.to;
    const remaining = (o: PlayerCtx["options"][number]) => {
      const e = g.edges.get(o.edgeId)!;
      if (tp && o.edgeId === tp.edgeId) return Math.abs(tp.distM - (o.dir === 1 ? 0 : e.lengthM));
      return e.lengthM + (distMap?.get(o.to) ?? Infinity);
    };
    const rem = c.options.map(remaining);
    let goalIdx = tp ? rem.indexOf(Math.min(...rem)) : -1;
    // Referensrutten: nästa steg som börjar i noden spelaren står i (första förekomst efter pekaren).
    let routeIdx = -1;
    if (path) {
      for (let j = ptr + 1; j < path.length; j++) {
        const e = g.edges.get(path[j].edgeId)!;
        const startNode = path[j].dir === 1 ? e.from : e.to;
        if (startNode === here) {
          const i = c.options.findIndex((o) => o.edgeId === path[j].edgeId && o.dir === path[j].dir);
          if (i >= 0) { routeIdx = i; ptr = j - 1; }
          break;
        }
      }
      if (routeIdx >= 0) goalIdx = routeIdx;
    }
    const take = (i: number) => {
      if (path && routeIdx >= 0 && i === routeIdx) ptr++;
      return i;
    };
    if (kind === "follower" && goalIdx >= 0) return take(goalIdx);

    const etas = state.zombies.length ? zombieEtas(g, state) : new Map<string, number>();
    const margin = (node: string, t: number) => (etas.get(node) ?? Infinity) - t;
    const value = (edgeId: string, from: string, t0: number, depth: number): number => {
      const e = g.edges.get(edgeId)!;
      const to = e.from === from && e.to !== from ? e.to : e.to === from ? e.from : e.to;
      const t = t0 + e.lengthM / pace;
      const m = margin(to, t);
      const next = (g.adj.get(to) ?? []).filter((a) => a.edgeId !== edgeId);
      if (!next.length) return m - DEAD_END_PENALTY_S;
      if (depth <= 1) return m;
      return Math.min(m, Math.max(...next.map((a) => value(a.edgeId, to, t, depth - 1))));
    };
    const vals = c.options.map((o) => value(o.edgeId, here, 0, 3));
    let pick = vals.indexOf(Math.max(...vals));
    if (c.options.length > 1) {
      stats.decisions++;
      if (goalIdx >= 0 && vals[goalIdx] < 0) stats.blocked++;
    }
    if (goalIdx >= 0) {
      if (path && routeIdx >= 0 && vals[routeIdx] >= SAFE_MARGIN_S) return take(routeIdx);
      const safe = c.options.map((_, i) => i).filter((i) => vals[i] >= SAFE_MARGIN_S);
      if (safe.length) pick = safe.reduce((b, i) => (rem[i] < rem[b] ? i : b), safe[0]);
      if (c.options.length > 1 && pick !== goalIdx) stats.deviations++;
    }
    return take(pick);
  };
}

