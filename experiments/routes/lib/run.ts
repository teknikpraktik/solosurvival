import { type Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import { STEP_S } from "@/config/game-rules";
import type { GameMode } from "@/engine/objectives/objectives";
import { indexGraph } from "@/geo/graph/graph";
import type { TrailGraph } from "@/geo/graph/types";
import { generateRoutes } from "@/routes/generate";
import { objectivesFromProposal } from "@/routes/objectives";
import { estimateTimeLimitS } from "@/routes/timing";
import type { RouteProposal } from "@/routes/types";
import { makeGoalBot, newBotStats } from "@/sim/bots";
import { randomStart } from "@/sim/start";
import { SimSession } from "@/sim/runner";
import type { AreaDef } from "../../data/areas";
import { loadAreaGraphs } from "../../data/lib/load";

export interface AreaNet { id: AreaDef["id"]; activity: Activity; g: TrailGraph; hazard: Set<string> }
const cache = new Map<string, AreaNet>();
export function areaNet(id: AreaDef["id"], activity: Activity): AreaNet {
  const key = `${id}/${activity === "mtb" ? "mtb" : "run"}`;
  let n = cache.get(key);
  if (!n) {
    const ag = loadAreaGraphs(id, "pbf", activity === "mtb" ? "mtb" : "run");
    n = { id, activity, g: indexGraph(ag.main), hazard: ag.hazardNodes };
    cache.set(key, n);
  }
  return n;
}

export { randomStart };

export interface ModeScenario {
  area: AreaDef["id"];
  activity: Activity;
  mode: GameMode;
  difficulty: Difficulty;
  /** Escape/Mission: önskad ruttlängd (m). Survival: matchlängd (s). */
  size: number;
  seed: number;
  bot: "follower" | "planner";
  /** Vilket av de genererade förslagen som spelas (0 = bäst). */
  proposalIndex?: number;
  /** Zombietäthet relativt PRD:s antal (default 1). */
  density?: number;
  /** Mission: tvinga antal checkpoints. */
  checkpoints?: 1 | 2 | 3;
  deadEndPolicy?: "avoid" | "allow";
}

export interface ModeMetrics {
  area: string; activity: string; mode: string; difficulty: string; size: number; seed: number; bot: string;
  routeValid: boolean; cps: number; policy: string; routeMaxDepth: number; routeExits: number;
  routeType: string; routeLengthM: number; routeDeviation: number; routeQuality: number; routeDeadEndShare: number; routeReuse: number; checkpoints: number;
  genMs: number;
  result: string; endS: number; limitS: number; reached: number; timeToGoalS: number; distanceM: number;
  blocked: number; decisions: number; deviations: number; peakZombies: number; simMs: number;
}

export function runModeMatch(sc: ModeScenario): { m: ModeMetrics; proposals: RouteProposal[] } {
  const net = areaNet(sc.area, sc.activity);
  const start = randomStart(net.g, sc.seed);
  const base: ModeMetrics = {
    area: sc.area, activity: sc.activity, mode: sc.mode, difficulty: sc.difficulty, size: sc.size, seed: sc.seed, bot: sc.bot,
    routeValid: true, cps: sc.checkpoints ?? 0, policy: sc.deadEndPolicy ?? "avoid", routeMaxDepth: 0, routeExits: 0, routeType: "-", routeLengthM: 0, routeDeviation: 0, routeQuality: 0, routeDeadEndShare: 0, routeReuse: 0, checkpoints: 0,
    genMs: 0, result: "", endS: 0, limitS: 0, reached: 0, timeToGoalS: NaN, distanceM: 0, blocked: 0, decisions: 0, deviations: 0, peakZombies: 0, simMs: 0,
  };
  let durationS = sc.size;
  let proposals: RouteProposal[] = [];
  let objectives;
  if (sc.mode !== "survival") {
    const r = generateRoutes(net.g, { start, activity: sc.activity, mode: sc.mode, targetLengthM: sc.size, seed: sc.seed, hazardNodes: net.hazard, checkpoints: sc.checkpoints, deadEndPolicy: sc.deadEndPolicy });
    proposals = r.proposals;
    base.genMs = r.stats.ms;
    const p = proposals[Math.min(sc.proposalIndex ?? 0, proposals.length - 1)];
    if (!p) return { m: { ...base, routeValid: false, result: "no_route" }, proposals };
    base.routeType = p.type; base.routeLengthM = p.lengthM; base.routeDeviation = p.deviation; base.routeQuality = p.quality.score;
    base.routeDeadEndShare = p.metrics.deadEndShare; base.routeReuse = p.metrics.reuseShare; base.checkpoints = p.waypoints.filter((w) => w.kind === "checkpoint").length; base.routeMaxDepth = p.metrics.maxWaypointDeadEndDepthM; base.routeExits = p.metrics.minWaypointExits;
    durationS = estimateTimeLimitS(p.lengthM, sc.activity, sc.difficulty, p.waypoints.length);
    objectives = objectivesFromProposal(p);
  }
  base.limitS = durationS;
  const stats = newBotStats();
  const t0 = performance.now();
  const k = sc.density ?? 1;
  const s = new SimSession({
    g: net.g, activity: sc.activity, difficulty: sc.difficulty, durationS, seed: sc.seed, strategy: "avoid",
    strategyFn: makeGoalBot(sc.bot, stats, proposals.length ? proposals[Math.min(sc.proposalIndex ?? 0, proposals.length - 1)].path : undefined), start, mode: sc.mode, objectives, initialDir: proposals[Math.min(sc.proposalIndex ?? 0, proposals.length - 1)]?.path[0]?.dir,
  });
  if (k !== 1) {
    const r = s.rules;
    r.maxZombies = Math.max(1, Math.round(r.maxZombies * k));
    r.initialZombies = Math.max(1, Math.min(r.maxZombies, Math.round(r.initialZombies * k)));
    r.growthPerMin = (r.maxZombies - r.initialZombies) / Math.max(1, (durationS * 0.8 - r.headStartS) / 60);
  }
  let steps = 0;
  while (!s.finished && steps < (durationS / STEP_S) * 1.5) { s.step(); steps++; }
  base.simMs = performance.now() - t0;
  const st = s.state;
  base.result = st.result ?? "failed";
  base.endS = st.elapsedSeconds;
  base.reached = st.objectives?.index ?? 0;
  base.timeToGoalS = st.result === "survived" && st.objectives ? st.objectives.reachedAtS.at(-1)! : NaN;
  base.distanceM = st.player.distanceM;
  base.blocked = stats.blocked; base.decisions = stats.decisions; base.deviations = stats.deviations;
  base.peakZombies = st.peakZombies;
  return { m: base, proposals };
}
