import { zombieSpeedFactor } from "@/engine/core/engine";
import { MinHeap } from "@/engine/core/heap";
import { zombieLatLon } from "@/engine/core/movement";
import { networkDistances } from "@/engine/pathfinding/astar";
import { haversineM } from "@/geo/geometry";
import { edgeLatLon } from "@/geo/graph/graph";
import type { EdgePos, TrailGraph } from "@/geo/graph/types";
import { targetPos } from "./bots";
import type { MidEdgeCtx, PlayerCtx } from "./runner";

/**
 * Riskmedveten simulerad spelare ("flyktar på riktigt"). Används för balansmätning: en dålig testspelare ger missvisande balans.
 *
 * Beslutsregel (vid korsning och, till skillnad från de äldre botarna, även mitt på en kant där den kan vända om):
 * 1. Beräkna när närmaste zombie tidigast kan vara vid varje nod (Dijkstra från alla kända zombier, deras faktiska fart inklusive spurt).
 * 2. För varje möjligt första drag, gå igenom alla vägar inom `horizonM` och räkna marginalen vid varje nod = zombiens ankomst − min ankomst.
 *    Ett drag är "säkert" om marginalen längs hela vägen håller sig över `safeMarginS`.
 * 3. Säkra drag rangordnas efter hur nära målet vägen slutar (Mission/A TO B/extraction) eller efter marginal (inget mål); osäkra efter bästa marginal.
 * Spelaren känner bara zombier inom `visibleM` fågelvägen (standard: de som syns på kartan).
 */
export interface RiskBotOptions {
  /** Hur långt fram (m längs nätet) vägar utvärderas. */
  horizonM?: number;
  /** Marginal (s) som krävs vid varje nod för att vägen ska räknas som säker. Infektion kräver ~7 s (20 m) + 3 s kontakt. */
  safeMarginS?: number;
  /** Zombier längre bort än så (fågelvägen) är okända för spelaren. */
  visibleM?: number;
  /** Använd målet (checkpoint/extraction) när det finns. */
  useGoal?: boolean;
  /** Tillåt att vända mitt på en kant. */
  midEdge?: boolean;
}

const CAP_S = 90;
const SAFE_BASE = 1_000_000;

interface Rank { safe: boolean; v: number }
const better = (a: Rank, b: Rank, hystAbs = 0): boolean => (a.safe !== b.safe ? a.safe : a.safe ? a.v > b.v + hystAbs : a.v > b.v + hystAbs);

export function makeRiskBot(o: RiskBotOptions = {}) {
  const horizonM = o.horizonM ?? 700;
  const safeS = o.safeMarginS ?? 12;
  const visibleM = o.visibleM ?? 1000;
  const useGoal = o.useGoal ?? true;
  let lastReverseS = -Infinity;
  const goalCache = new WeakMap<object, { key: string; d: Map<string, number> }>();

  /** Tidigaste zombieankomst (s) per nod. */
  function etaMap(g: TrailGraph, ctx: { state: MidEdgeCtx["state"]; rules: MidEdgeCtx["rules"] }, me: { lat: number; lon: number }): Map<string, number> {
    const { state, rules } = ctx;
    const t = state.elapsedSeconds;
    const known = state.zombies.filter((z) => haversineM(zombieLatLon(g, z), me) <= visibleM);
    const best = new Map<string, number>();
    if (!known.length) return best;
    // Alla antas jaga med den snabbaste kända zombiens fart (försiktigt).
    const v = Math.max(...known.map((z) => z.speedMps * zombieSpeedFactor(rules, z, t)), 0.1);
    const heap = new MinHeap<string>();
    const seed = (n: string, tt: number) => { if (tt < (best.get(n) ?? Infinity)) { best.set(n, tt); heap.push(tt, n); } };
    for (const z of known) {
      const e = g.edges.get(z.edgeId)!;
      seed(e.to, (e.lengthM - z.distanceAlongEdgeM) / v);
      if (!e.oneway) seed(e.from, z.distanceAlongEdgeM / v);
    }
    while (heap.size) {
      const { k, v: n } = heap.pop()!;
      if (k > (best.get(n) ?? Infinity)) continue;
      if (k > 300) break; // längre bort än så spelar ingen roll för en horisont på några hundra meter
      for (const a of g.adj.get(n) ?? []) seed(a.to, k + a.lengthM / v);
    }
    return best;
  }

  function goalDistances(g: TrailGraph, c: PlayerCtx | MidEdgeCtx): Map<string, number> | null {
    if (!useGoal) return null;
    const tp = targetPos({ g, state: c.state, rules: c.rules, options: [], rng: c.state, speedMps: c.speedMps });
    if (!tp) return null;
    const key = `${tp.edgeId}@${tp.distM.toFixed(0)}`;
    const hit = goalCache.get(g);
    if (hit && hit.key === key) return hit.d;
    const d = networkDistances(g, tp);
    goalCache.set(g, { key, d });
    return d;
  }

  /**
   * Rangordnar ett första drag: spelaren når `node` efter `t0` sekunder via `viaEdge`. Därifrån söks (Dijkstra på spelarens ankomsttid; tidigaste
   * ankomst ger störst marginal) alla noder som går att nå på en kedja av noder där marginalen mot närmaste zombie hela tiden är minst `safeS`.
   * - Når sökningen `horizonM` är draget säkert; rangordnas efter hur nära målet den säkra regionen når (eller efter marginal utan mål).
   * - Annars är draget osäkert; rangordnas efter hur länge (sekunder) spelaren kan fortsätta röra sig säkert (längre är bättre).
   */
  function evaluate(g: TrailGraph, etas: Map<string, number>, goal: Map<string, number> | null, speed: number, node: string, t0: number, dist0: number, viaEdge: string): Rank {
    const marginAt = (n: string, t: number) => Math.min(CAP_S, (etas.get(n) ?? Infinity) - t);
    const m0 = marginAt(node, t0);
    if (m0 < safeS) return { safe: false, v: t0 * 1000 + Math.max(-5, m0) };
    const best = new Map<string, number>([[node, t0]]);
    const heap = new MinHeap<{ n: string; dist: number; via: string }>();
    heap.push(t0, { n: node, dist: dist0, via: viaEdge });
    let reachedFar = false, deepest = t0, bestGoal = Infinity, bestMargin = m0;
    let expanded = 0;
    while (heap.size && expanded < 4000) {
      const { k: t, v: cur } = heap.pop()!;
      if (t > (best.get(cur.n) ?? Infinity)) continue;
      expanded++;
      deepest = Math.max(deepest, t);
      if (goal) bestGoal = Math.min(bestGoal, goal.get(cur.n) ?? 1e5);
      bestMargin = Math.max(bestMargin, marginAt(cur.n, t));
      if (cur.dist >= horizonM) { reachedFar = true; continue; }
      for (const a of g.adj.get(cur.n) ?? []) {
        if (a.edgeId === cur.via) continue;
        const tn = t + a.lengthM / speed;
        if (tn >= (best.get(a.to) ?? Infinity)) continue;
        if (marginAt(a.to, tn) < safeS) continue;
        best.set(a.to, tn);
        heap.push(tn, { n: a.to, dist: cur.dist + a.lengthM, via: a.edgeId });
      }
    }
    if (reachedFar) return { safe: true, v: SAFE_BASE - (goal ? bestGoal : -bestMargin * 10) };
    return { safe: false, v: deepest * 1000 };
  }

  const choose = (c: PlayerCtx): number => {
    const { g, state, rules } = c;
    const me = state.player.position;
    const etas = etaMap(g, { state, rules }, me);
    const goal = goalDistances(g, c);
    let bestI = 0;
    let best: Rank = { safe: false, v: -Infinity };
    c.options.forEach((opt, i) => {
      const e = g.edges.get(opt.edgeId)!;
      const r = evaluate(g, etas, goal, c.speedMps, opt.to, e.lengthM / c.speedMps, e.lengthM, opt.edgeId);
      if (better(r, best)) { best = r; bestI = i; }
    });
    return bestI;
  };

  const midEdge = (c: MidEdgeCtx): boolean => {
    if (o.midEdge === false) return false;
    const { g, state, rules, pos, dir, speedMps } = c;
    if (state.elapsedSeconds - lastReverseS < 8) return false;
    const e = g.edges.get(pos.edgeId)!;
    const me = edgeLatLon(g, pos as EdgePos);
    const etas = etaMap(g, { state, rules }, me);
    if (!etas.size) return false;
    const goal = goalDistances(g, c);
    const fwdNode = dir === 1 ? e.to : e.from, backNode = dir === 1 ? e.from : e.to;
    const dF = dir === 1 ? e.lengthM - pos.distM : pos.distM, dB = e.lengthM - dF;
    const rf = evaluate(g, etas, goal, speedMps, fwdNode, dF / speedMps, dF, pos.edgeId);
    const rb = evaluate(g, etas, goal, speedMps, backNode, dB / speedMps, dB, pos.edgeId);
    // Vänd bara om det klart är bättre: säkert mot osäkert, eller (båda säkra) tydligt närmare målet, eller (båda osäkra) minst 2 s mer marginal.
    const hyst = rf.safe && rb.safe ? 40 : 3000; // 3 s senare underskridande (osäkert) eller 40 m närmare målet (säkert)
    if (better(rb, rf, hyst)) { lastReverseS = state.elapsedSeconds; return true; }
    return false;
  };

  return { choose, midEdge };
}
