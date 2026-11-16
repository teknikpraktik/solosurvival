/**
 * Zombie AI with roles (rules.zombieAi === "roles"). Values: config/zombie-ai.ts. Description: docs/ZOMBIE-AI-ROLES.md.
 *
 * - Pursuer: the AI as it was without interception. Follows the latest observation it was given (magnet chase, a reveal or the detection
 *   radius), along the fastest way in time, terrain edges included (zombie-ai.ts, planToLastKnown); stale information ends in the existing
 *   search (investigate → patrol).
 * - Interceptor: chases like a pursuer until it can read a direction and speed from the observation history (`GameState.player.track`),
 *   then forecasts where the player is likely to be within a few minutes, and goes for a point it reaches in time but not absurdly early.
 *
 * Information: everything here works from `track` (observations the discovery rules handed out, with their time stamps), the graph and the
 * zombies' own positions. The player's real position is never an input. Three positions are kept apart in the code:
 *   observed  = a track entry (snapped to the network, with `observedAtS`)
 *   estimate  = `Motion`: where and how fast the player was moving at the newest observation
 *   forecast  = `Candidate`: a point on the network the player may reach, with the expected time and how likely
 */
import { ZOMBIE_AI as C, roleForIndex, type ZombieRole } from "@/config/zombie-ai";
import type { Rules } from "@/config/game-rules";
import { fromLocal, haversineM, toLocal, type LatLon } from "@/geo/geometry";
import { edgeLatLon, snapToGraph } from "@/geo/graph/graph";
import type { Dir, EdgePos, GraphEdge, TrailGraph } from "@/geo/graph/types";
import { planRoute, travelTimes, type PlanOptions, type Route, type TravelTimes } from "../pathfinding/astar";
import { rand, type RngHolder } from "../core/rng";
import type { Observation, Zombie } from "../core/types";

/** The zombie's role. Zombies without one (saved before roles existed) get the role their spawn number would have given. */
export function roleOf(z: Pick<Zombie, "id" | "role">): ZombieRole {
  if (z.role) return z.role;
  const n = Number(z.id.replace(/^\D+/, ""));
  return Number.isFinite(n) ? roleForIndex(n) : "pursuer";
}

/** The player's movement as estimated from two observations. `dir` is set when the player is on a real trail. */
export interface Motion {
  at: Observation;
  /** Where the observation lies (not snapped). */
  pos: LatLon;
  ageS: number;
  speedMps: number;
  /** Unit vector of travel, x east, y north. */
  vx: number;
  vy: number;
  /** On a trail: the direction along the snapped edge. Missing = off the trails (straight-line forecast). */
  dir?: Dir;
}

export interface Candidate {
  pos: EdgePos;
  /** Seconds from now until the player is expected there. */
  playerEtaS: number;
  /** How likely the forecast holds it that the player passes here (0–1). */
  prob: number;
}

function planOpts(g: TrailGraph, rules: Rules, speedMps: number): PlanOptions {
  if (!g.hasOfftrail || rules.offTrailFactor >= 1) return {};
  const slow = speedMps * rules.offTrailFactor;
  return { speed: (e) => (e.offtrail ? slow : speedMps), vMax: speedMps };
}
const speedFn = (g: TrailGraph, rules: Rules, v: number) => planOpts(g, rules, v).speed ?? (() => v);

const unit = (a: LatLon, b: LatLon) => {
  const v = toLocal(a, b);
  const len = Math.hypot(v.x, v.y);
  return { x: len ? v.x / len : 0, y: len ? v.y / len : 0, len };
};

/** Direction along an edge between two snapped positions: on the same edge directly, otherwise by the last step of the fastest way. */
function dirBetween(g: TrailGraph, rules: Rules, from: Observation, to: Observation): Dir | null {
  if (from.edgeId === to.edgeId) return to.edgeDistM === from.edgeDistM ? null : to.edgeDistM > from.edgeDistM ? 1 : -1;
  const r = planRoute(g, { edgeId: from.edgeId, distM: from.edgeDistM }, { edgeId: to.edgeId, distM: to.edgeDistM }, rules.playerPaceMps, planOpts(g, rules, rules.playerPaceMps));
  const last = r?.steps.at(-1);
  return last && last.edgeId === to.edgeId ? last.dir : null;
}

/** Off the trails: the observation is on a terrain edge, or far from the edge it was snapped to. */
function offTrail(g: TrailGraph, o: Observation): boolean {
  const e = g.edges.get(o.edgeId);
  if (!e) return true;
  if (e.offtrail) return true;
  return haversineM(o, edgeLatLon(g, { edgeId: o.edgeId, distM: o.edgeDistM })) > C.offTrailM;
}

/**
 * Estimates the player's movement from the observation history, or null when it says too little: too few or too old observations, a
 * player who stands still (noise only), or a history that contradicts itself (turned round without having moved far enough since).
 */
export function estimateMotion(g: TrailGraph, rules: Rules, track: readonly Observation[] | undefined, timeS: number): Motion | null {
  if (!track?.length) return null;
  const last = track[track.length - 1];
  const ageS = timeS - last.observedAtS;
  if (ageS > C.maxInfoAgeS || ageS < -1e-6) return null;
  // The youngest observation that is old and far enough away (short window: the newest direction and speed), and the oldest such one
  // within the window (long window: is the direction consistent?).
  let short: Observation | null = null, long: Observation | null = null;
  for (let i = track.length - 2; i >= 0; i--) {
    const p = track[i];
    const dt = last.observedAtS - p.observedAtS;
    if (dt > C.headingMaxAgeS) break;
    if (dt < C.headingMinAgeS || haversineM(p, last) < C.headingMinMoveM) continue;
    if (!short) short = p;
    long = p;
  }
  if (!short || !long) return null;
  const s = unit(short, last);
  if (long !== short) {
    const l = unit(long, last);
    // Turned round within the window: trust the new direction only after a clear move in it.
    if (s.x * l.x + s.y * l.y < 0 && s.len < C.reversalMinMoveM) return null;
  }
  const speed = s.len / (last.observedAtS - short.observedAtS);
  if (speed < C.minSpeedShare * rules.playerPaceMps) return null;
  const motion: Motion = { at: last, pos: { lat: last.lat, lon: last.lon }, ageS, speedMps: Math.min(speed, C.maxSpeedShare * rules.playerPaceMps), vx: s.x, vy: s.y };
  if (offTrail(g, last)) return motion;
  const dir = dirBetween(g, rules, short, last);
  if (dir === null) return null; // contradicts the network (no way between the two)
  return { ...motion, dir };
}

/** Heading (unit vector) where an edge leaves or enters a node. */
function edgeHeading(e: GraphEdge, dir: Dir, atStart: boolean): { x: number; y: number } {
  const pts = e.geometry;
  const n = pts.length;
  const [a, b] = dir === 1 ? (atStart ? [pts[0], pts[1]] : [pts[n - 2], pts[n - 1]]) : atStart ? [pts[n - 1], pts[n - 2]] : [pts[1], pts[0]];
  const u = unit(a, b);
  return { x: u.x, y: u.y };
}

/** Points along an edge are this many seconds of the player's nominal pace apart (walk 26 m, bike 90 m): finer than a meeting window. */
const SAMPLE_STEP_S = 20;
const sampleStepM = (rules: Rules) => Math.min(90, Math.max(25, rules.playerPaceMps * SAMPLE_STEP_S));
const MAX_SWEEP_NODES = 400;

/**
 * Forecast along the trails: from the player's estimated position and direction, every way ahead (never turning back) within the horizon.
 * At each junction the probability is split by how straight each way goes on; ways the player is unlikely to take fall below
 * `minProbability` and are not followed. Terrain edges are not followed (a player on a trail stays on it, as far as the forecast goes).
 */
function forecastOnTrails(g: TrailGraph, m: Motion, horizonM: number, stepM: number): Candidate[] {
  const e0 = g.edges.get(m.at.edgeId)!;
  const dir0 = m.dir!;
  const out: Candidate[] = [];
  const toTime = (d: number) => d / m.speedMps - m.ageS;
  const add = (pos: EdgePos, d: number, prob: number) => {
    const t = toTime(d);
    if (t > 0 && prob >= C.minProbability) out.push({ pos, playerEtaS: t, prob });
  };
  // Along an edge: points at fixed places (every stepM from the edge's start), so the same point is found again at the next review.
  const along = (e: GraphEdge, dir: Dir, enterAtM: number, d0: number, prob: number) => {
    const ks = dir === 1 ? Math.floor(enterAtM / stepM) + 1 : Math.ceil(enterAtM / stepM) - 1;
    for (let k = ks; k > 0 && k * stepM < e.lengthM; k += dir) {
      const d = d0 + Math.abs(k * stepM - enterAtM);
      if (d > horizonM) break;
      add({ edgeId: e.id, distM: k * stepM }, d, prob);
    }
  };
  const rest = dir0 === 1 ? e0.lengthM - m.at.edgeDistM : m.at.edgeDistM;
  along(e0, dir0, m.at.edgeDistM, 0, 1);
  type Item = { node: string; d: number; prob: number; via: GraphEdge; viaDir: Dir };
  const queue: Item[] = [{ node: dir0 === 1 ? e0.to : e0.from, d: rest, prob: 1, via: e0, viaDir: dir0 }];
  const seen = new Set<string>();
  while (queue.length && seen.size < MAX_SWEEP_NODES) {
    queue.sort((a, b) => a.d - b.d);
    const it = queue.shift()!;
    if (it.d > horizonM || seen.has(it.node)) continue;
    seen.add(it.node);
    add({ edgeId: it.via.id, distM: it.viaDir === 1 ? it.via.lengthM : 0 }, it.d, it.prob);
    const inH = edgeHeading(it.via, it.viaDir, false);
    const ways = (g.adj.get(it.node) ?? []).filter((a) => a.edgeId !== it.via.id && !g.edges.get(a.edgeId)!.offtrail);
    if (!ways.length) continue; // dead end: the player has to turn; that is not forecast
    const w = ways.map((a) => {
      const h = edgeHeading(g.edges.get(a.edgeId)!, a.dir, true);
      return C.straightBias + Math.max(0, inH.x * h.x + inH.y * h.y);
    });
    const sum = w.reduce((x, y) => x + y, 0);
    ways.forEach((a, i) => {
      const prob = (it.prob * w[i]) / sum;
      if (prob < C.minProbability) return;
      const e = g.edges.get(a.edgeId)!;
      along(e, a.dir, a.dir === 1 ? 0 : e.lengthM, it.d, prob);
      queue.push({ node: a.to, d: it.d + e.lengthM, prob, via: e, viaDir: a.dir });
    });
  }
  return out;
}

/**
 * Forecast off the trails: the player keeps the direction and speed of the last observations (straight line). A point is usable only if
 * there is network close by (no node lies in water or a building) and it stays within a cone of the direction of travel. The belief falls
 * with the time ahead.
 */
function forecastOffTrail(g: TrailGraph, m: Motion, component: number | undefined): Candidate[] {
  const out: Candidate[] = [];
  for (const lead of C.freeLeadsS) {
    const ahead = m.speedMps * (m.ageS + lead);
    const p = fromLocal(m.pos, { x: m.vx * ahead, y: m.vy * ahead });
    const s = snapToGraph(g, p, component);
    if (!s || s.offNetworkM > C.freeSnapMaxM) continue;
    const u = unit(m.pos, edgeLatLon(g, s));
    if (u.x * m.vx + u.y * m.vy < C.freeConeCos) continue;
    const prob = Math.pow(0.5, lead / C.freeHalfLifeS);
    if (prob >= C.minProbability) out.push({ pos: { edgeId: s.edgeId, distM: s.distM }, playerEtaS: lead, prob });
  }
  return out;
}

/** Where the player may be within the horizon (see the two forecasts above). */
export function forecast(g: TrailGraph, rules: Rules, m: Motion, component?: number): Candidate[] {
  const horizonM = Math.min(C.horizonMaxM, m.speedMps * C.horizonS);
  return m.dir === undefined ? forecastOffTrail(g, m, component) : forecastOnTrails(g, m, horizonM, sampleStepM(rules));
}

/** The zombie's travel time to a point on an edge, from its bounded travel-time field. */
function etaTo(g: TrailGraph, tt: TravelTimes, pos: EdgePos, speed: (e: GraphEdge) => number): number {
  const e = g.edges.get(pos.edgeId)!;
  const v = speed(e);
  const a = tt.etaS(e.from), b = e.oneway ? undefined : tt.etaS(e.to);
  return Math.min(a === undefined ? Infinity : a + pos.distM / v, b === undefined ? Infinity : b + (e.lengthM - pos.distM) / v);
}

export interface Choice {
  cand: Candidate;
  zombieEtaS: number;
  score: number;
}

/**
 * Scores the forecast for one zombie: a point counts only if the zombie gets there `marginS` before the player and waits no more than
 * `maxWaitS`. Likelier and sooner meetings score higher; a point another interceptor already heads for scores lower.
 */
export function scoreCandidates(g: TrailGraph, rules: Rules, z: Zombie, cands: Candidate[], taken: readonly LatLon[]): Choice[] {
  const usable = cands.filter((c) => c.playerEtaS >= C.minLeadS);
  if (!usable.length) return [];
  const maxS = Math.max(...usable.map((c) => c.playerEtaS));
  const speed = speedFn(g, rules, z.speedMps);
  const tt = travelTimes(g, { edgeId: z.edgeId, distM: z.distanceAlongEdgeM }, speed, maxS);
  if (!tt) return [];
  const out: Choice[] = [];
  for (const c of usable) {
    const eta = etaTo(g, tt, c.pos, speed);
    if (!Number.isFinite(eta)) continue; // unreachable (water, another component, one-way)
    const wait = c.playerEtaS - eta;
    if (wait < C.marginS || wait > C.maxWaitS) continue;
    const ll = edgeLatLon(g, c.pos);
    const shared = taken.some((t) => haversineM(t, ll) <= C.samePointM);
    const score = c.prob * (1 - (C.latePenalty * c.playerEtaS) / C.horizonS) * (shared ? C.sharedTargetFactor : 1);
    out.push({ cand: c, zombieEtaS: eta, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Close contact: the newest observation is within `closeChaseM` of the zombie, so it goes straight for the player like a pursuer (an
 * interceptor that has reached its point meets the player head on). Uses only the observation history.
 */
export function closeContact(ctx: Pick<RoleCtx, "track" | "timeS">, zll: LatLon): boolean {
  const last = ctx.track?.at(-1);
  return !!last && ctx.timeS - last.observedAtS <= C.maxInfoAgeS && haversineM(last, zll) <= C.closeChaseM;
}

export interface RoleCtx {
  g: TrailGraph;
  rules: Rules;
  rng: RngHolder;
  timeS: number;
  /** The observation history (the only information about the player used here). */
  track?: readonly Observation[];
  /** All zombies, to see which meeting points other interceptors already head for. */
  zombies?: readonly Zombie[];
  component?: number;
  events: { type: "zombie_intercept"; zombieId: string }[];
}

/** Meeting points other interceptors are heading for. */
function takenPoints(ctx: RoleCtx, z: Zombie): LatLon[] {
  const out: LatLon[] = [];
  for (const o of ctx.zombies ?? []) if (o !== z && o.state === "intercept" && o.meeting) out.push(o.meeting);
  return out;
}

function adopt(ctx: RoleCtx, z: Zombie, ch: Choice): boolean {
  const route: Route | null = planRoute(ctx.g, { edgeId: z.edgeId, distM: z.distanceAlongEdgeM }, ch.cand.pos, z.speedMps, planOpts(ctx.g, ctx.rules, z.speedMps));
  if (!route) return false;
  const fresh = z.state !== "intercept";
  z.route = route.steps;
  z.stopAtM = route.stopAtM;
  z.dir = route.firstDir;
  const ll = edgeLatLon(ctx.g, ch.cand.pos);
  z.targetNodeId = undefined;
  z.meeting = { lat: ll.lat, lon: ll.lon, playerAtS: ctx.timeS + ch.cand.playerEtaS, prob: ch.cand.prob, madeAtS: ctx.timeS };
  if (fresh) {
    z.state = "intercept";
    z.stateSinceS = ctx.timeS;
    ctx.events.push({ type: "zombie_intercept", zombieId: z.id });
  }
  return true;
}

/**
 * An interceptor at its meeting point waits there (standing still) instead of turning back towards the player: the plan ends when the
 * player comes close (closeContact), when the expected time has passed (interceptorStep), or when a review sends it elsewhere.
 * `maxWaitS` keeps the wait short. Without this the existing rule "arrived → chase" would give up the ambush the moment it is reached.
 */
export function waitAtMeeting(z: Zombie): void {
  if (z.state === "intercept" && z.route.length === 0 && z.stopAtM === undefined) z.stopAtM = z.distanceAlongEdgeM;
}

/** Back to pursuit (the role stays interceptor). The next attempt waits the usual time. */
export function dropMeeting(ctx: Pick<RoleCtx, "timeS" | "rng">, z: Zombie): void {
  if (z.state === "intercept") {
    z.state = "chase";
    z.stateSinceS = ctx.timeS;
  }
  z.meeting = undefined;
  z.targetNodeId = undefined;
  z.replanAtS = ctx.timeS;
  z.tacticalAtS = ctx.timeS + C.attemptS + rand(ctx.rng) * C.attemptJitterS;
}

/**
 * One decision for an interceptor, at most when its timer (`tacticalAtS`) runs out:
 * - chasing: look for a meeting point; none → keep pursuing and try again later.
 * - intercepting: review the plan. It is kept while the forecast still holds the point (the player has not clearly gone another way) and
 *   the zombie is still in time; a new point replaces it only if it is clearly better (`switchGain`).
 * Between decisions the plan stands, whatever the player does: that is what lets a player fool it.
 */
export function interceptorStep(ctx: RoleCtx, z: Zombie): void {
  const { timeS } = ctx;
  // Plain rules that end a plan without new information: the meeting time has passed, or the zombie has arrived and the player has not come.
  if (z.state === "intercept" && z.meeting && timeS > z.meeting.playerAtS + C.lateToleranceS) return dropMeeting(ctx, z);
  if (timeS < z.tacticalAtS) return;
  if (z.state !== "chase" && z.state !== "intercept") return;
  const intercepting = z.state === "intercept";
  z.tacticalAtS = timeS + (intercepting ? C.holdS + rand(ctx.rng) * C.holdJitterS : C.attemptS + rand(ctx.rng) * C.attemptJitterS);
  const m = estimateMotion(ctx.g, ctx.rules, ctx.track, timeS);
  if (!m) {
    // Nothing usable (standing still, too little or too old): an existing plan is kept until its time is up; no new one is made.
    return;
  }
  const choices = scoreCandidates(ctx.g, ctx.rules, z, forecast(ctx.g, ctx.rules, m, ctx.component), takenPoints(ctx, z));
  if (!intercepting) {
    if (choices.length) adopt(ctx, z, choices[0]);
    return;
  }
  // The current point, if the forecast still holds it (the best-scoring candidate close to it).
  const current = choices.find((c) => haversineM(edgeLatLon(ctx.g, c.cand.pos), z.meeting!) <= C.samePointM);
  const best = choices[0];
  if (current && (!best || best.score < current.score * C.switchGain)) {
    z.meeting = { ...z.meeting!, playerAtS: timeS + current.cand.playerEtaS, prob: current.cand.prob };
    return;
  }
  if (best && adopt(ctx, z, best)) return;
  dropMeeting(ctx, z);
}
