/**
 * From a mission definition to a playable match: the match parameters, the rules for the chosen difficulty, the goals on the local
 * network, and the time limit. Everything is built from the same pieces Free Play uses (mode rules, course generator, A to B routing);
 * this file only says how a mission differs.
 */
import type { Rules } from "@/config/game-rules";
import type { Difficulty } from "@/config/difficulty";
import { resolveModeRules } from "@/config/modes";
import { createObjectives, type ObjectiveSet } from "@/engine/objectives/objectives";
import type { MatchParams } from "@/play/config";
import { COURSE_DETOUR_FACTOR } from "@/routes/course";
import { estimateTimeLimitS } from "@/routes/timing";
import type { RouteProposal } from "@/routes/types";
import type { CampaignDef, MissionDef } from "./types";

/** Campaign missions are played on foot (THE FALL v1 has no bike missions). */
export const CAMPAIGN_ACTIVITY = "walk" as const;

/**
 * Base zombie speed (km/h) in campaign missions, per difficulty; a mission scales it with its own factor (0.85 in the first, 1.05 in the
 * last). Easy and Normal are Free Play's speeds on foot. Hard is not: Free Play Hard runs at 10.4 km/h, faster than a jogging player, and
 * in simulation no mission after the first could be won at that speed. A campaign must be completable on every level, so Hard here is
 * about a steady jog and gets its difficulty from more infected, more of them cutting ahead and tighter zones.
 */
export const CAMPAIGN_SPEED_KMH: Record<Difficulty, number> = { easy: 3.6, normal: 5.6, hard: 6.6 };

/** Course-based time limits get this much more than Free Play's estimate: a mission expects detours round the infected. */
export const CAMPAIGN_TIME_SLACK = 1.25;
/** Per signal transmission: the hold itself counted this many times (leaving and coming back), plus fixed seconds to get clear of the zone. */
const TRANSMIT_TIME_FACTOR = 2.5;
const TRANSMIT_EXTRA_S = 60;

/** The match parameters of a mission: the mission's mode and layout, the campaign's difficulty, a new seed. */
export function missionParams(c: CampaignDef, m: MissionDef, difficulty: Difficulty, seed: number): MatchParams {
  const l = m.layout;
  return {
    mode: m.mode,
    activity: CAMPAIGN_ACTIVITY,
    difficulty,
    targetLengthM: l.kind === "checkpoints" ? l.courseLengthM : l.kind === "destination" ? l.routeLengthM : 0,
    durationS: l.kind === "survive" || l.kind === "extraction" ? l.durationS : m.aboutMin * 60,
    seed,
    campaign: { id: c.id, mission: m.id },
  };
}

/**
 * The mission's rules at a difficulty. The campaign's speed for the level (CAMPAIGN_SPEED_KMH) is scaled by the mission, the
 * population and the share of interceptors come from the mission's table, and the layout switches on what the mission needs
 * (win on timeout, extraction time, transmission pressure). Story and goals are the same on every level.
 */
export function missionRules(m: MissionDef, difficulty: Difficulty, durationS: number, straightM?: number): Rules {
  const base = resolveModeRules(m.mode, CAMPAIGN_ACTIVITY, difficulty, durationS, undefined, straightM);
  const t = m.tuning;
  const z = t.zombies[difficulty];
  const maxZombies = Math.max(1, z.max, z.initial);
  const initialZombies = Math.max(1, z.initial);
  const windowMin = Math.max(1, (durationS * t.growthUntil) / 60);
  const l = m.layout;
  return {
    ...base,
    zombieSpeedMps: (CAMPAIGN_SPEED_KMH[difficulty] * t.speed) / 3.6,
    initialZombies,
    maxZombies,
    growthPerMin: (maxZombies - initialZombies) / windowMin,
    interceptShare: t.interceptShare[difficulty],
    interceptModel: "track",
    aheadSpawnShare: undefined,
    intensity: t.intensity?.map((s) => ({ atS: s.atFrac * durationS, speed: s.speed })),
    spreadStart: !!t.spreadStart,
    startMinDistanceM: t.spreadStart?.minDistanceM ?? base.startMinDistanceM,
    extractionOpensAtS: l.kind === "extraction" ? l.extractionAtS : Infinity,
    extractionRushFactor: l.kind === "extraction" ? l.rushFactor : undefined,
    extractionRetry: l.kind === "extraction" ? true : undefined,
    winOnTimeout: l.kind === "survive" ? true : undefined,
    transmitSpawn: l.kind === "checkpoints" && l.transmit ? l.transmit.spawn[difficulty] : undefined,
  };
}

/** Seconds of signal transmission in a mission (all goals), 0 without transmissions. */
function transmitTotalS(m: MissionDef, difficulty: Difficulty, goals: number): number {
  const l = m.layout;
  if (l.kind !== "checkpoints" || !l.transmit || goals <= 0) return 0;
  return (goals - 1) * l.transmit.holdS[difficulty] + l.transmit.lastHoldS[difficulty];
}

/** The mission's time limit: fixed for survival missions, from the laid-out course otherwise (calm pace plus margin, as in Free Play). */
export function missionDurationS(m: MissionDef, p: Pick<MatchParams, "difficulty" | "durationS">, proposal: RouteProposal | null): number {
  const l = m.layout;
  if (l.kind === "survive" || l.kind === "extraction") return l.durationS;
  if (!proposal) return p.durationS;
  if (l.kind === "destination") return Math.round(estimateTimeLimitS(proposal.lengthM, CAMPAIGN_ACTIVITY, p.difficulty, 1) * CAMPAIGN_TIME_SLACK);
  // Checkpoint distances are straight lines; the way walked is longer. A transmission takes its own time plus a margin for leaving the zone.
  const goals = proposal.waypoints.length;
  const tx = transmitTotalS(m, p.difficulty, goals);
  return Math.round(estimateTimeLimitS(proposal.lengthM * COURSE_DETOUR_FACTOR, CAMPAIGN_ACTIVITY, p.difficulty, goals) * CAMPAIGN_TIME_SLACK) + (tx ? Math.round(tx * TRANSMIT_TIME_FACTOR) + goals * TRANSMIT_EXTRA_S : 0);
}

/** The mission's goals for the engine, from the laid-out course. Survival missions have none. */
export function missionObjectives(m: MissionDef, proposal: RouteProposal | null, difficulty: Difficulty): ObjectiveSet | undefined {
  const l = m.layout;
  if (!proposal || l.kind === "survive" || l.kind === "extraction") return undefined;
  const n = proposal.waypoints.length;
  const o = createObjectives(proposal.waypoints.map((w, i) => {
    const t = { id: w.id, kind: w.kind, lat: w.lat, lon: w.lon, nodeId: w.nodeId };
    if (l.kind !== "checkpoints" || !l.transmit) return t;
    return { ...t, holdS: i === n - 1 ? l.transmit.lastHoldS[difficulty] : l.transmit.holdS[difficulty], radiusM: l.transmit.radiusM[difficulty], keepProgress: true };
  }));
  if (l.kind === "checkpoints" && l.anyOrder) o.anyOrder = true;
  return o;
}

