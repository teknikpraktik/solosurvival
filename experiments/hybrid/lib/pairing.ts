// Webbläsarsäkra hjälpare för parvisa jämförelser (används av både experimentkörningar och visualiseringen).
import { resolveRules } from "@/config/game-rules";
import type { Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import { rand, type RngHolder } from "@/engine/core/rng";
import type { GameState, Zombie } from "@/engine/core/types";
import type { LatLon } from "@/geo/geometry";
import { edgeLatLon } from "@/geo/graph/graph";
import type { TrailGraph } from "@/geo/graph/types";
import { SimSession, type StrategyName } from "@/sim/runner";
import { makePlanner } from "./planner";

export type Density = "sparse" | "normal" | "dense";
export const DENSITY: Record<Density, number> = { sparse: 0.5, normal: 1, dense: 2 };
export type AnyStrategy = StrategyName | "planner-trail" | "planner-omni";

/** Slumpad startpunkt längs stigarna (längdviktad), identisk för alla modeller med samma seed. */
export function randomStart(g: TrailGraph, seed: number): LatLon {
  const rng: RngHolder = { rngState: (seed * 40503 + 7) >>> 0 };
  const edges = [...g.edges.values()];
  const total = edges.reduce((s, e) => s + e.lengthM, 0);
  let r = rand(rng) * total;
  for (const e of edges) {
    r -= e.lengthM;
    if (r <= 0) return edgeLatLon(g, { edgeId: e.id, distM: rand(rng) * e.lengthM });
  }
  const e = edges[0];
  return edgeLatLon(g, { edgeId: e.id, distM: e.lengthM / 2 });
}

/** Flyttar en position på en basgraf-kant till motsvarande delkant i en hybridgraf. */
export function mapToHybrid(h: TrailGraph, edgeId: string, distM: number): { edgeId: string; distM: number } {
  if (h.edges.has(edgeId)) return { edgeId, distM };
  let acc = 0;
  for (let k = 0; ; k++) {
    const e = h.edges.get(`${edgeId}#${k}`);
    if (!e) return { edgeId: `${edgeId}#${k - 1}`, distM: h.edges.get(`${edgeId}#${k - 1}`)!.lengthM };
    if (distM <= acc + e.lengthM + 1e-9) return { edgeId: e.id, distM: Math.max(0, distM - acc) };
    acc += e.lengthM;
  }
}

export interface PairedSetup {
  base: TrailGraph;
  /** Motorns graf: `base` för modell A, annars hybridgrafen. */
  g: TrailGraph;
  activity: Activity;
  difficulty: Difficulty;
  durationS: number;
  strategy: AnyStrategy;
  density: Density;
  seed: number;
  paceFactor?: number;
  /** Startzombier från modell A, så att startförhållandena blir identiska. */
  from?: { zombies: Zombie[]; rng: number };
}

export function createPairedSession(p: PairedSetup): { session: SimSession; initial: Zombie[]; initialRng: number } {
  const k = DENSITY[p.density];
  const r0 = resolveRules(p.activity, p.difficulty, p.durationS);
  const maxZ = Math.max(1, Math.round(r0.maxZombies * k));
  const initZ = Math.max(1, Math.min(maxZ, Math.round(r0.initialZombies * k)));
  const growth = (maxZ - initZ) / Math.max(1, (p.durationS * 0.8 - r0.headStartS) / 60);
  let initial: Zombie[] = [];
  let initialRng = 0;
  const session = new SimSession({
    g: p.g,
    playerGraph: p.base,
    activity: p.activity,
    difficulty: p.difficulty,
    durationS: p.durationS,
    seed: p.seed,
    strategy: p.strategy.startsWith("planner") ? "avoid" : (p.strategy as StrategyName),
    strategyFn: p.strategy === "planner-trail" ? makePlanner("trail") : p.strategy === "planner-omni" ? makePlanner("omni") : undefined,
    start: randomStart(p.base, p.seed),
    paceFactor: p.paceFactor,
    rulesPatch: { initialZombies: initZ, maxZombies: maxZ, growthPerMin: growth },
    prepare: (state: GameState) => {
      if (p.from) {
        state.zombies = p.from.zombies.map((z) => {
          const pos = mapToHybrid(p.g, z.edgeId, z.distanceAlongEdgeM);
          return { ...structuredClone(z), edgeId: pos.edgeId, distanceAlongEdgeM: pos.distM };
        });
        state.rngState = p.from.rng;
      }
      initial = structuredClone(state.zombies);
      initialRng = state.rngState;
    },
  });
  return { session, initial, initialRng };
}
