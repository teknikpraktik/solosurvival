import { ACTIVITIES, type Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import { RULES_VERSION, STEP_S, type Rules } from "@/config/game-rules";
import { resolveModeRules } from "@/config/modes";
import type { GameMode, ObjectiveSet } from "@/engine/objectives/objectives";
import { createGame, stepGame, type StepInput } from "@/engine/core/engine";
import { zombieLatLon } from "@/engine/core/movement";
import { rand, type RngHolder } from "@/engine/core/rng";
import type { GameEvent, GameResult, GameState } from "@/engine/core/types";
import { networkDistances, planRoute } from "@/engine/pathfinding/astar";
import { summarize, type MatchSummary } from "@/engine/scoring/summary";
import { haversineM, type LatLon } from "@/geo/geometry";
import { edgeLatLon, nodeLatLon, posAtNode, snapToGraph } from "@/geo/graph/graph";
import type { Dir, EdgePos, TrailGraph } from "@/geo/graph/types";

export type StrategyName = "random" | "avoid" | "maximize" | "extraction";

export interface PlayerCtx {
  g: TrailGraph;
  state: GameState;
  rules: Rules;
  /** Valmöjligheter vid noden: [edgeId, dir, nodeAtEnd]. */
  options: { edgeId: string; dir: Dir; to: string }[];
  rng: RngHolder;
  /** Spelarens verkliga fart (m/s) i denna simulering, inklusive `paceFactor`. */
  speedMps: number;
}

/** Läge mitt på en kant (används för att kunna vända om utan att vänta på nästa korsning, som en riktig spelare kan). */
export interface MidEdgeCtx {
  g: TrailGraph;
  state: GameState;
  rules: Rules;
  pos: EdgePos;
  dir: Dir;
  speedMps: number;
}

/** Spelarstrategier för balanseringssimulering (PRD 14.3). Väljer vägval vid varje nod. */
const strategies: Record<StrategyName, (c: PlayerCtx) => number> = {
  random: (c) => Math.floor(rand(c.rng) * c.options.length),
  avoid: (c) => scoreOptions(c, false),
  maximize: (c) => scoreOptions(c, true),
  extraction: (c) => {
    const { state, g } = c;
    if (state.extractionNodeId) {
      const here = snapToGraph(g, state.player.position, state.component);
      const goal = posAtNode(g, state.extractionNodeId);
      if (here && goal) {
        const r = planRoute(g, here, goal, 1);
        if (r) {
          const i = c.options.findIndex((o) => o.edgeId === r.steps[0]?.edgeId && o.dir === r.steps[0]?.dir);
          if (i >= 0) return i;
        }
      }
    }
    return scoreOptions(c, false);
  },
};

/** Väljer väg vars slutnod ligger längst från närmaste zombie (eller summan, för `maximize`). */
function scoreOptions(c: PlayerCtx, useSum: boolean): number {
  const zs = c.state.zombies.map((z) => zombieLatLon(c.g, z));
  if (!zs.length) return Math.floor(rand(c.rng) * c.options.length);
  let best = 0;
  let bestScore = -Infinity;
  c.options.forEach((o, i) => {
    const p = nodeLatLon(c.g, o.to);
    const ds = zs.map((z) => haversineM(z, p));
    const score = useSum ? ds.reduce((a, b) => a + b, 0) / ds.length : Math.min(...ds);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

export interface SimOptions {
  g: TrailGraph;
  activity: Activity;
  difficulty: Difficulty;
  durationS: number;
  seed: number;
  strategy: StrategyName;
  start?: LatLon;
  /** Spelarens fart som andel av aktivitetens nominella fart. */
  paceFactor?: number;
  /** GPS-brus (standardavvikelse i meter) på det som matas in i motorn. */
  gpsNoiseM?: number;
  /** Intervall (spelklocka, s) då GPS är borta, t.ex. för test av bortfall. */
  gpsOutages?: [number, number][];
  spawnCapacity?: number;
  /** Spelläge (default survival). Escape/Mission kräver `objectives`. */
  mode?: GameMode;
  objectives?: ObjectiveSet;
  /** Egen vägvalsstrategi (ersätter `strategy`). Returnerar index i `ctx.options`. */
  strategyFn?: (ctx: PlayerCtx) => number;
  /**
   * Anropas ungefär varje sekund när spelaren är mitt på en kant. Returnerar sant om spelaren ska vända om.
   * Utan den kan en simulerad spelare bara välja väg i korsningar, vilket är en mycket sämre flykt än en riktig människas.
   */
  midEdge?: (ctx: MidEdgeCtx) => boolean;
  /** Startriktning på startkanten (annars slumpad eller mot första målet). */
  initialDir?: Dir;
  /** Justerar reglerna (t.ex. zombietäthet) för experiment. */
  rulesPatch?: Partial<Rules>;
}

export interface SimResult {
  summary: MatchSummary;
  events: GameEvent[];
  state: GameState;
}

function randomStart(g: TrailGraph, rng: RngHolder): LatLon {
  const edges = [...g.edges.values()].sort((a, b) => b.lengthM - a.lengthM);
  const biggest = edges[0].component;
  const inComp = edges.filter((e) => e.component === biggest);
  const e = inComp[Math.floor(rand(rng) * inComp.length)];
  return edgeLatLon(g, { edgeId: e.id, distM: e.lengthM / 2 });
}

/** Stegbar simulering: en simulerad spelare följer stignätet och matar motorn med (brusiga) positioner. */
export class SimSession {
  readonly g: TrailGraph;
  readonly rules: Rules;
  readonly state: GameState;
  readonly events: GameEvent[];
  /** Spelarens verkliga position (utan GPS-brus). */
  readonly pos: EdgePos;
  private dir: Dir;
  private readonly speed: number;
  private nextMidCheckS = 0;
  private readonly simRng: RngHolder;
  private readonly noiseRng: RngHolder;

  constructor(private readonly o: SimOptions) {
    this.g = o.g;
    this.simRng = { rngState: (o.seed * 2654435761) >>> 0 };
    this.noiseRng = { rngState: (o.seed ^ 0x9e3779b9) >>> 0 };
    const startLL = o.start ?? randomStart(o.g, this.simRng);
    this.rules = { ...resolveModeRules(o.mode ?? "survival", o.activity, o.difficulty, o.durationS, o.spawnCapacity), ...o.rulesPatch };
    const { state, events } = createGame({
      g: o.g,
      config: {
        activity: o.activity,
        difficulty: o.difficulty,
        durationSeconds: o.durationS,
        areaId: "sim",
        seed: o.seed,
        rulesVersion: RULES_VERSION,
        mode: o.mode ?? "survival",
      },
      rules: this.rules,
      start: startLL,
      objectives: o.objectives,
    });
    this.state = state;
    this.events = [...events];
    this.speed = ACTIVITIES[o.activity].playerPaceMps * (o.paceFactor ?? 1);
    const snap = snapToGraph(o.g, startLL)!;
    this.pos = { edgeId: snap.edgeId, distM: snap.distM };
    this.dir = rand(this.simRng) < 0.5 ? 1 : -1;
    // Med mål (Escape/Mission) börjar spelaren gå åt det håll som leder närmast första målet.
    const first = o.objectives?.targets[0];
    if (first) {
      const tp = snapToGraph(o.g, first, this.state.component);
      if (tp) {
        const d = networkDistances(o.g, tp);
        const e = o.g.edges.get(this.pos.edgeId)!;
        const fwd = (e.lengthM - this.pos.distM) + (d.get(e.to) ?? Infinity);
        const back = e.oneway ? Infinity : this.pos.distM + (d.get(e.from) ?? Infinity);
        if (tp.edgeId === this.pos.edgeId) this.dir = tp.distM >= this.pos.distM ? 1 : -1;
        else if (Number.isFinite(Math.min(fwd, back))) this.dir = fwd <= back ? 1 : -1;
      }
    }
    if (o.initialDir) this.dir = o.initialDir;
  }

  get speedMps() {
    return this.speed;
  }

  private gauss() {
    const u = Math.max(1e-9, rand(this.noiseRng));
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand(this.noiseRng));
  }

  get finished() {
    return this.state.phase === "finished";
  }

  /** Ett motorsteg (STEP_S). Returnerar de händelser som uppstod. */
  step(): GameEvent[] {
    const { g, o, state, pos } = this;
    // Mitt på kanten: strategin får vända om (ungefär en gång per sekund).
    if (o.midEdge && state.elapsedSeconds >= this.nextMidCheckS) {
      this.nextMidCheckS = state.elapsedSeconds + 1;
      const e0 = g.edges.get(pos.edgeId)!;
      const canReverse = this.dir === 1 ? !e0.oneway : !e0.oneway;
      if (canReverse && o.midEdge({ g, state, rules: this.rules, pos: { ...pos }, dir: this.dir, speedMps: this.speed })) this.dir = (-this.dir) as Dir;
    }
    let remaining = this.speed * STEP_S;
    while (remaining > 0) {
      const e = g.edges.get(pos.edgeId)!;
      const toEnd = this.dir === 1 ? e.lengthM - pos.distM : pos.distM;
      if (remaining < toEnd) {
        pos.distM += this.dir * remaining;
        break;
      }
      remaining -= toEnd;
      const node = this.dir === 1 ? e.to : e.from;
      const options = (g.adj.get(node) ?? []).map((a) => ({ edgeId: a.edgeId, dir: a.dir, to: a.to }));
      // Vänd bara i återvändsgränder.
      const forward = options.filter((a) => !(a.edgeId === e.id && a.dir === -this.dir));
      const pool = forward.length ? forward : options;
      if (!pool.length) {
        // Enkelriktad stig utan utgång (finns i verklig OSM-data): spelaren vänder.
        this.dir = (-this.dir) as Dir;
        continue;
      }
      const pick = pool[(o.strategyFn ?? strategies[o.strategy])({ g, state, rules: this.rules, options: pool, rng: this.simRng, speedMps: this.speed })];
      pos.edgeId = pick.edgeId;
      this.dir = pick.dir;
      pos.distM = this.dir === 1 ? 0 : g.edges.get(pick.edgeId)!.lengthM;
    }

    const t = state.elapsedSeconds;
    const out = o.gpsOutages?.some(([a, b]) => t >= a && t < b) ?? false;
    const real = edgeLatLon(g, pos);
    const noise = o.gpsNoiseM ?? 0;
    const input: StepInput = out
      ? { position: null, quality: "unavailable", accuracyM: Infinity }
      : {
          position: noise
            ? {
                lat: real.lat + (this.gauss() * noise) / 111_320,
                lon: real.lon + (this.gauss() * noise) / (111_320 * Math.cos((real.lat * Math.PI) / 180)),
              }
            : real,
          quality: "ok",
          accuracyM: noise || 5,
        };
    const ev = stepGame(g, state, this.rules, input);
    this.events.push(...ev);
    return ev;
  }
}

/** Kör en hel match utan verklig GPS. */
export function simulateMatch(o: SimOptions): SimResult {
  const session = new SimSession(o);
  const outage = o.gpsOutages?.reduce((s, [a, b]) => s + b - a, 0) ?? 0;
  const maxSteps = Math.ceil((o.durationS + 120 + outage) / STEP_S) + 10;
  for (let i = 0; i < maxSteps && !session.finished; i++) session.step();
  if (!session.finished) session.state.result = "failed";
  return { summary: summarize(session.state), events: session.events, state: session.state };
}

export function winRate(results: SimResult[], r: GameResult = "survived"): number {
  return results.filter((x) => x.summary.result === r).length / results.length;
}
