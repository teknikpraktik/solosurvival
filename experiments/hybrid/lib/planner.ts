import { ACTIVITIES } from "@/config/activities";
import { MinHeap } from "@/engine/core/heap";
import { zombieLatLon } from "@/engine/core/movement";
import { snapToGraph } from "@/geo/graph/graph";
import type { TrailGraph } from "@/geo/graph/types";
import type { Zombie } from "@/engine/core/types";
import type { PlayerCtx } from "@/sim/runner";

/** Tidigast ankomsttid (s) för någon zombie till varje nod i grafen `g`, med hänsyn till kanthastighet. */
export function zombieEtas(g: TrailGraph, zs: { edgeId: string; distM: number; speed: number }[]): Map<string, number> {
  const best = new Map<string, number>();
  const heap = new MinHeap<string>();
  const seed = (n: string, t: number) => {
    if (t < (best.get(n) ?? Infinity)) { best.set(n, t); heap.push(t, n); }
  };
  const vz = zs[0]?.speed ?? 1;
  for (const z of zs) {
    const e = g.edges.get(z.edgeId);
    if (!e) continue;
    const v = z.speed * (e.speedFactor ?? 1);
    seed(e.to, (e.lengthM - z.distM) / v);
    if (!e.oneway) seed(e.from, z.distM / v);
  }
  while (heap.size) {
    const { k, v: n } = heap.pop()!;
    if (k > (best.get(n) ?? Infinity)) continue;
    for (const a of g.adj.get(n) ?? []) seed(a.to, k + a.lengthM / (vz * (g.edges.get(a.edgeId)!.speedFactor ?? 1)));
  }
  return best;
}

const SAFE_MARGIN_S = 20;
const DEAD_END_PENALTY_S = 60;

/**
 * Taktisk bot: väljer vägen med bäst "marginal" (zombiernas ankomsttid minus spelarens) tre korsningar framåt (maximin).
 * - `trail`: räknar med att zombier bara går på stigar (vad en människa kan förutse).
 * - `omni`: känner till zombiernas verkliga (hybrid)rörlighet. Övre gräns för en spelare som lärt sig genvägarna.
 * När extraction är öppen väljs bland säkra alternativ det som är närmast extraction.
 */
export function makePlanner(kind: "trail" | "omni") {
  return (c: PlayerCtx): number => {
    const { g: pg, eg, state } = c;
    const pace = ACTIVITIES[state.config.activity].playerPaceMps;
    const zs = state.zombies;
    let etas: Map<string, number>;
    if (!zs.length) etas = new Map();
    else if (kind === "omni") {
      etas = zombieEtas(eg, zs.map((z: Zombie) => ({ edgeId: z.edgeId, distM: z.distanceAlongEdgeM, speed: z.speedMps })));
    } else {
      etas = zombieEtas(pg, zs.map((z: Zombie) => {
        const s = snapToGraph(pg, zombieLatLon(eg, z))!;
        return { edgeId: s.edgeId, distM: s.distM, speed: z.speedMps };
      }));
    }
    const margin = (node: string, t: number) => (etas.get(node) ?? Infinity) - t;
    const value = (edgeId: string, from: string, t0: number, depth: number): number => {
      const e = pg.edges.get(edgeId)!;
      const to = e.from === from && e.to !== from ? e.to : e.to === from ? e.from : e.to;
      const t = t0 + e.lengthM / pace;
      const m = margin(to, t);
      const next = (pg.adj.get(to) ?? []).filter((a) => a.edgeId !== edgeId);
      if (!next.length) return m - DEAD_END_PENALTY_S;
      if (depth <= 1) return m;
      return Math.min(m, Math.max(...next.map((a) => value(a.edgeId, to, t, depth - 1))));
    };
    // Spelarens nuvarande nod härleds ur alternativen (alla delar startnod).
    const first = pg.edges.get(c.options[0].edgeId)!;
    const here = c.options[0].dir === 1 ? first.from : first.to;
    const vals = c.options.map((o) => value(o.edgeId, here, 0, 3));
    let pick = vals.indexOf(Math.max(...vals));
    if (state.extractionNodeId) {
      const safe = c.options.map((_, i) => i).filter((i) => vals[i] >= SAFE_MARGIN_S);
      if (safe.length) {
        const d = distTo(pg, state.extractionNodeId);
        pick = safe.reduce((b, i) => ((d.get(c.options[i].to) ?? Infinity) < (d.get(c.options[b].to) ?? Infinity) ? i : b), safe[0]);
      }
    }
    return pick;
  };
}

const distCache = new WeakMap<TrailGraph, Map<string, Map<string, number>>>();
function distTo(g: TrailGraph, target: string): Map<string, number> {
  let perG = distCache.get(g);
  if (!perG) distCache.set(g, (perG = new Map()));
  let d = perG.get(target);
  if (d) return d;
  d = new Map([[target, 0]]);
  const heap = new MinHeap<string>();
  heap.push(0, target);
  while (heap.size) {
    const { k, v } = heap.pop()!;
    if (k > (d.get(v) ?? Infinity)) continue;
    for (const a of g.adj.get(v) ?? []) {
      const nd = k + a.lengthM;
      if (nd < (d.get(a.to) ?? Infinity)) { d.set(a.to, nd); heap.push(nd, a.to); }
    }
  }
  perG.set(target, d);
  return d;
}
