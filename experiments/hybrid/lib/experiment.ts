import { ACTIVITIES, type Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import { resolveRules, STEP_S } from "@/config/game-rules";
import { MinHeap } from "@/engine/core/heap";
import { zombieLatLon } from "@/engine/core/movement";
import { rand, type RngHolder } from "@/engine/core/rng";
import type { GameState, Zombie } from "@/engine/core/types";
import { bearingDeg, haversineM, toLocal, type LatLon } from "@/geo/geometry";
import { edgeLatLon, nodeLatLon, trailOf } from "@/geo/graph/graph";
import type { TrailGraph } from "@/geo/graph/types";
import { SimSession, type StrategyName } from "@/sim/runner";
import type { AreaDef } from "../areas";
import { loadAreaGraph, type AreaGraph } from "./graphs";
import { buildHybridGraph, type HybridConfig, type HybridResult } from "./hybrid-graph";
import { blockersFor } from "./blockers";
import { buildRaster, type TerrainRaster } from "./raster";
import { makePlanner, zombieEtas as etasOf } from "./planner";
import { createPairedSession, mapToHybrid, randomStart, type Density } from "./pairing";
export { mapToHybrid, randomStart };

export type { Density };

export interface Scenario {
  area: AreaDef["id"];
  activity: Activity;
  difficulty: Difficulty;
  durationS: number;
  strategy: StrategyName | "planner-trail" | "planner-omni";
  density: Density;
  seed: number;
  paceFactor?: number;
}

/** null = Modell A (stigbunden). */
export type ModelSpec = { id: string; hybrid: HybridConfig | null };

export interface Metrics {
  model: string;
  area: string;
  activity: string;
  difficulty: string;
  durationS: number;
  strategy: string;
  density: string;
  seed: number;
  result: string;
  endS: number;
  /** Matchtid då hotet började (efter försprång), för tid-till-infektion. */
  huntS: number;
  minDistM: number;
  secsWithin50: number;
  secsWithin25: number;
  trappedSecs: number;
  trappedEpisodes: number;
  zombieDistTrailM: number;
  zombieDistOffroadM: number;
  zombieSwitches: number;
  zombieHours: number;
  approaches: number;
  approachSpreadDeg: number;
  extractionOpened: boolean;
  extractionPlayerEtaS: number;
  extractionZombieEtaS: number;
  deadEndInfection: boolean;
  offroadViolations: number;
  maxStepM: number;
  maxStepAllowedM: number;
  cpuMs: number;
  steps: number;
  zombies: number;
}

export interface AreaCtx {
  ag: AreaGraph;
  raster: TerrainRaster;
  deadEndEdges: Set<string>;
  hybrids: Map<string, HybridResult>;
}

const ctxCache = new Map<string, AreaCtx>();

export function areaCtx(area: AreaDef["id"], activity: Activity): AreaCtx {
  const key = `${area}/${activity === "mtb" ? "mtb" : "run"}`;
  let c = ctxCache.get(key);
  if (!c) {
    const ag = loadAreaGraph(area, activity === "mtb" ? "mtb" : "run");
    c = { ag, raster: buildRaster(ag.fx), deadEndEdges: deadEnds(ag.trailIndexed), hybrids: new Map() };
    ctxCache.set(key, c);
  }
  return c;
}

export function hybridFor(c: AreaCtx, cfg: HybridConfig): HybridResult {
  const key = JSON.stringify(cfg);
  let h = c.hybrids.get(key);
  if (!h) {
    h = buildHybridGraph(c.ag.trail, c.ag.fx, c.raster, cfg);
    c.hybrids.set(key, h);
  }
  return h;
}

/** Kanter som ligger i återvändsgränder (grenar som blir kvar efter att bladnoder rekursivt tagits bort). */
export function deadEnds(g: TrailGraph): Set<string> {
  const deg = new Map<string, number>();
  for (const [n, a] of g.adj) deg.set(n, a.length);
  const removed = new Set<string>();
  const queue = [...deg].filter(([, d]) => d === 1).map(([n]) => n);
  while (queue.length) {
    const n = queue.pop()!;
    for (const a of g.adj.get(n) ?? []) {
      if (removed.has(a.edgeId)) continue;
      removed.add(a.edgeId);
      const d = (deg.get(a.to) ?? 0) - 1;
      deg.set(a.to, d);
      if (d === 1) queue.push(a.to);
    }
  }
  return removed;
}

const circSpreadDeg = (angles: number[]): number => {
  if (angles.length < 2) return 0;
  const s = angles.reduce((a, b) => a + Math.sin((b * Math.PI) / 180), 0) / angles.length;
  const c = angles.reduce((a, b) => a + Math.cos((b * Math.PI) / 180), 0) / angles.length;
  const R = Math.hypot(s, c);
  return (1 - R) * 100; // 0 = alla från samma håll, 100 = jämnt fördelat
};

export interface RunOutput {
  metrics: Metrics;
  initialZombies: Zombie[];
  initialRng: number;
}

/** Kör en match för en modell. `from` ger startzombier från modell A så att startförhållandena blir identiska. */
export function runMatch(sc: Scenario, model: ModelSpec, from?: { zombies: Zombie[]; rng: number }): RunOutput {
  const c = areaCtx(sc.area, sc.activity);
  const base = c.ag.trailIndexed;
  const hyb = model.hybrid ? hybridFor(c, model.hybrid) : null;
  const g = hyb ? hyb.indexed : base;
  const { session: s, initial, initialRng } = createPairedSession({
    base, g, activity: sc.activity, difficulty: sc.difficulty, durationS: sc.durationS, strategy: sc.strategy,
    density: sc.density, seed: sc.seed, paceFactor: sc.paceFactor, from,
  });

  const state = s.state;
  const rules = s.rules;
  const pace = ACTIVITIES[sc.activity].playerPaceMps * (sc.paceFactor ?? 1);
  const m: Metrics = {
    model: model.id, area: sc.area, activity: sc.activity, difficulty: sc.difficulty, durationS: sc.durationS,
    strategy: sc.strategy, density: sc.density, seed: sc.seed, result: "", endS: 0, huntS: rules.headStartS,
    minDistM: Infinity, secsWithin50: 0, secsWithin25: 0, trappedSecs: 0, trappedEpisodes: 0,
    zombieDistTrailM: 0, zombieDistOffroadM: 0, zombieSwitches: 0, zombieHours: 0,
    approaches: 0, approachSpreadDeg: 0, extractionOpened: false, extractionPlayerEtaS: NaN, extractionZombieEtaS: NaN,
    deadEndInfection: false, offroadViolations: 0, maxStepM: 0, maxStepAllowedM: 0, cpuMs: 0, steps: 0, zombies: 0,
  };
  const prevPos = new Map<string, LatLon>();
  const prevOff = new Map<string, boolean>();
  const within100 = new Set<string>();
  const angles: number[] = [];
  let wasTrapped = false;

  while (!s.finished && m.steps < (sc.durationS / STEP_S) * 1.5) {
    const t0 = performance.now();
    const ev = s.step();
    m.cpuMs += performance.now() - t0;
    m.steps++;
    const hunting = state.phase === "survival" || state.phase === "extraction";
    if (!hunting) continue;
    const pl = state.player.position;
    let nearest = Infinity;
    for (const z of state.zombies) {
      const ll = zombieLatLon(g, z);
      const e = g.edges.get(z.edgeId)!;
      const off = !!e.offroad;
      const step = z.speedMps * (e.speedFactor ?? 1) * STEP_S;
      if (off) m.zombieDistOffroadM += step; else m.zombieDistTrailM += step;
      m.zombieHours += STEP_S / 3600;
      if (prevOff.has(z.id) && prevOff.get(z.id) !== off) m.zombieSwitches++;
      prevOff.set(z.id, off);
      const pp = prevPos.get(z.id);
      if (pp) {
        m.maxStepM = Math.max(m.maxStepM, haversineM(pp, ll));
        m.maxStepAllowedM = Math.max(m.maxStepAllowedM, z.speedMps * STEP_S);
      }
      prevPos.set(z.id, ll);
      if (off) {
        const l = toLocal(c.ag.fx.origin, ll);
        if (blockersFor(c.raster).pointBlocked([l.x, l.y])) m.offroadViolations++;
      }
      const d = haversineM(ll, pl);
      nearest = Math.min(nearest, d);
      if (d <= 100 && !within100.has(z.id)) { within100.add(z.id); m.approaches++; angles.push(bearingDeg(pl, ll)); }
      if (d > 140) within100.delete(z.id);
    }
    m.minDistM = Math.min(m.minDistM, nearest);
    if (nearest <= 50) m.secsWithin50 += STEP_S;
    if (nearest <= 25) m.secsWithin25 += STEP_S;

    // Instängdhet (var 5:e s): båda utgångar från spelarens kant nås av en zombie före spelaren.
    if (m.steps % 25 === 0 && state.zombies.length) {
      const pe = base.edges.get(s.pos.edgeId)!;
      const etas = etasOf(g, state.zombies.map((z) => ({ edgeId: z.edgeId, distM: z.distanceAlongEdgeM, speed: z.speedMps })));
      const cut = (node: string, dist: number) =>
        (base.adj.get(node)?.length ?? 0) <= 1 || (etas.get(node) ?? Infinity) <= dist / pace;
      const trapped = cut(pe.to, pe.lengthM - s.pos.distM) && (pe.oneway ? true : cut(pe.from, s.pos.distM));
      if (trapped) { m.trappedSecs += 5; if (!wasTrapped) m.trappedEpisodes++; }
      wasTrapped = trapped;
    }
    for (const e of ev) {
      if (e.type === "extraction_opened") {
        m.extractionOpened = true;
        const nid = e.nodeId;
        const x = nodeLatLon(base, nid);
        // Spelarens stigtid till noden och zombiernas tidigaste ankomst (via Dijkstra över motorns graf).
        const pe = base.edges.get(s.pos.edgeId)!;
        const dists = bfsDist(base, [{ n: pe.to, d: pe.lengthM - s.pos.distM }, { n: pe.from, d: s.pos.distM }]);
        m.extractionPlayerEtaS = (dists.get(nid) ?? Infinity) / pace;
        m.extractionZombieEtaS = state.zombies.length ? (etasOf(g, state.zombies.map((z) => ({ edgeId: z.edgeId, distM: z.distanceAlongEdgeM, speed: z.speedMps }))).get(nid) ?? Infinity) : Infinity;
        void x;
      }
    }
  }
  m.result = state.result ?? "failed";
  m.endS = state.elapsedSeconds;
  m.zombies = state.zombies.length;
  m.approachSpreadDeg = circSpreadDeg(angles);
  if (m.result === "infected") m.deadEndInfection = c.deadEndEdges.has(s.pos.edgeId.split("#")[0]);
  if (!Number.isFinite(m.minDistM)) m.minDistM = NaN;
  void trailOf;
  return { metrics: m, initialZombies: initial, initialRng };
}

function bfsDist(g: TrailGraph, seeds: { n: string; d: number }[]): Map<string, number> {
  const best = new Map<string, number>();
  const heap = new MinHeap<string>();
  for (const s of seeds) if (s.d < (best.get(s.n) ?? Infinity)) { best.set(s.n, s.d); heap.push(s.d, s.n); }
  while (heap.size) {
    const { k, v } = heap.pop()!;
    if (k > (best.get(v) ?? Infinity)) continue;
    for (const a of g.adj.get(v) ?? []) {
      const nd = k + a.lengthM;
      if (nd < (best.get(a.to) ?? Infinity)) { best.set(a.to, nd); heap.push(nd, a.to); }
    }
  }
  return best;
}

/** Kör modell A och sedan övriga modeller med identiska startförhållanden. */
export function runPair(sc: Scenario, models: ModelSpec[]): Metrics[] {
  const out: Metrics[] = [];
  let ref: { zombies: Zombie[]; rng: number } | undefined;
  for (const m of models) {
    const r = runMatch(sc, m, ref);
    if (!ref) ref = { zombies: r.initialZombies, rng: r.initialRng };
    out.push(r.metrics);
  }
  return out;
}
