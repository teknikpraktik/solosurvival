import { haversineM, toLocal, type LatLon } from "@/geo/geometry";
import { posAtNode, snapToGraphNear } from "@/geo/graph/graph";
import type { Dir, EdgePos, TrailGraph } from "@/geo/graph/types";
import { buildTargetTree, planRoute, type PlanOptions, type Route, type TargetTree } from "../pathfinding/astar";
import { rand, type RngHolder } from "../core/rng";
import type { Observation, Zombie, ZombieState } from "../core/types";
import { zombieLatLon } from "../core/movement";
import { STEP_S, type Rules } from "@/config/game-rules";
import { closeContact, dropMeeting, interceptorStep, roleOf, waitAtMeeting } from "./roles";

export interface AiContext {
  g: TrailGraph;
  rules: Rules;
  rng: RngHolder;
  timeS: number;
  /** Spelarens validerade position – används bara för närhetsdetektering (upptäcktsradie). */
  playerPos: LatLon;
  playerObservation: Observation | null;
  /** Magnet-jakt: färsk observation av spelaren (null om GPS ogiltig eller magnet av). */
  magnetObservation?: Observation | null;
  /** Sant under tick då ett periodiskt positionsavslöjande sker. */
  reveal: boolean;
  /** Sant om positionen är giltig nog att upptäcka spelaren. */
  detectionEnabled: boolean;
  events: ({ type: "zombie_detected"; zombieId: string } | { type: "zombie_intercept"; zombieId: string })[];
  /** Interception model "track" (rules.interceptModel) and AI with roles: the player's recent snapped positions, oldest first. */
  track?: Observation[];
  /** AI with roles: every zombie in the match (interceptors avoid each other's meeting points) and the player's network component. */
  zombies?: Zombie[];
  component?: number;
}

const REPLAN_MIN_S = 5;
const REPLAN_JITTER_S = 5;
const CONTACT_REPLAN_S = 2;
const TACTICAL_MIN_S = 20;
const TACTICAL_JITTER_S = 10;
const MIN_DECISION_S = 10;
const CONTACT_LOSS_S = 10;
const INVESTIGATE_TIMEOUT_S = 90;
const INTERCEPT_HORIZON_M = 900;
const INTERCEPT_MARGIN_S = 4;
/** Track model: the direction is read between the newest position and one at least this much older (s) and this far away (m). */
const TRACK_MIN_AGE_S = 6;
const TRACK_MAX_AGE_S = 40;
const TRACK_MIN_MOVE_M = 10;
/** Track model: an interceptor looks again this often (s, plus jitter) at whether its junction is still ahead of the player. */
const INTERCEPT_RECHECK_S = 10;
const INTERCEPT_RECHECK_JITTER_S = 5;
/** Track model: at most this many junctions ahead are tried (nearest first); each costs one route search. */
const INTERCEPT_MAX_CANDIDATES = 8;

/** Planeringsalternativ: på terrängkanter går zombien långsammare (kostnad = längd / fart), så den väljer stigen när den är snabbare. Utan terrängkanter inga alternativ (oförändrad planering). */
function planOpts(g: TrailGraph, rules: Rules, speedMps: number): PlanOptions {
  if (!g.hasOfftrail || rules.offTrailFactor >= 1) return {};
  const slow = speedMps * rules.offTrailFactor;
  return { speed: (e) => (e.offtrail ? slow : speedMps), vMax: speedMps };
}

function setState(z: Zombie, s: ZombieState, timeS: number) {
  if (z.state !== s) {
    z.state = s;
    z.stateSinceS = timeS;
  }
  if (s === "patrol") {
    z.route = [];
    z.stopAtM = undefined;
    z.targetNodeId = undefined;
  }
}

function applyRoute(z: Zombie, r: Route) {
  z.route = r.steps;
  z.stopAtM = r.stopAtM;
  z.dir = r.firstDir;
}

function observe(z: Zombie, o: Observation) {
  const prev = z.lastKnownEdge;
  if (prev && z.lastKnownPlayerPosition) {
    z.prevKnownEdge = { ...prev, atS: z.lastKnownPlayerPosition.observedAtMs / 1000 };
  }
  z.lastKnownPlayerPosition = { lat: o.lat, lon: o.lon, observedAtMs: o.observedAtS * 1000 };
  z.lastKnownEdge = { edgeId: o.edgeId, distM: o.edgeDistM };
}

/** Skapar en observation av spelaren (snappad på nätet) vid tiden `timeS`. */
export function makeObservation(g: TrailGraph, p: LatLon, timeS: number, component?: number, prev?: Pick<Observation, "edgeId" | "edgeDistM"> | null): Observation | null {
  const s = snapToGraphNear(g, p, component, prev ? { edgeId: prev.edgeId, distM: prev.edgeDistM } : null);
  if (!s) return null;
  return { lat: p.lat, lon: p.lon, observedAtS: timeS, edgeId: s.edgeId, edgeDistM: s.distM };
}

/** Riktning på spelarens kant uppskattad enbart från zombiens egna observationer. */
function estimateHeading(g: TrailGraph, rules: Rules, z: Zombie, speedMps: number): { edge: EdgePos; dir: Dir } | null {
  const last = z.lastKnownEdge;
  const prev = z.prevKnownEdge;
  if (!last || !prev || !z.lastKnownPlayerPosition) return null;
  const lastAt = z.lastKnownPlayerPosition.observedAtMs / 1000;
  if (lastAt - prev.atS > 60) return null; // för gammalt för att säga något om riktning
  if (prev.edgeId === last.edgeId) {
    if (Math.abs(last.distM - prev.distM) < 8) return null;
    return { edge: last, dir: last.distM > prev.distM ? 1 : -1 };
  }
  const r = planRoute(g, { edgeId: prev.edgeId, distM: prev.distM }, last, speedMps, planOpts(g, rules, speedMps));
  const lastStep = r?.steps.at(-1);
  if (!r || !lastStep || lastStep.edgeId !== last.edgeId) return null;
  return { edge: last, dir: lastStep.dir };
}

/**
 * Track model: the player's direction from the recent track. The newest position against the most recent one that is old enough and far
 * enough away to say something; a player who stands still, or whose track is too short, has no direction (no interception).
 */
function headingFromTrack(g: TrailGraph, rules: Rules, track: Observation[]): { edge: EdgePos; dir: Dir; from: LatLon; vx: number; vy: number } | null {
  const last = track[track.length - 1];
  if (!last) return null;
  const edge: EdgePos = { edgeId: last.edgeId, distM: last.edgeDistM };
  for (let i = track.length - 2; i >= 0; i--) {
    const p = track[i];
    const age = last.observedAtS - p.observedAtS;
    if (age < TRACK_MIN_AGE_S) continue;
    if (age > TRACK_MAX_AGE_S) break;
    if (p.edgeId === last.edgeId) {
      if (Math.abs(last.edgeDistM - p.edgeDistM) < TRACK_MIN_MOVE_M) continue;
      return { edge, dir: last.edgeDistM > p.edgeDistM ? 1 : -1, ...travel(p, last) };
    }
    if (haversineM(p, last) < TRACK_MIN_MOVE_M) continue;
    const r = planRoute(g, { edgeId: p.edgeId, distM: p.edgeDistM }, edge, rules.playerPaceMps, planOpts(g, rules, rules.playerPaceMps));
    const step = r?.steps.at(-1);
    if (!r || !step || step.edgeId !== last.edgeId) return null;
    return { edge, dir: step.dir, ...travel(p, last) };
  }
  return null;
}

/** Where the player is and the direction of travel as the crow flies (unit vector, x east, y north) between two track positions. */
function travel(a: LatLon, b: LatLon): { from: LatLon; vx: number; vy: number } {
  const v = toLocal(a, b);
  const len = Math.hypot(v.x, v.y) || 1;
  return { from: { lat: b.lat, lon: b.lon }, vx: v.x / len, vy: v.y / len };
}

/**
 * Junctions ahead of the player (never turning back), with the distance along the network to each, nearest first.
 * `trailsOnly` (track model): the sweep follows real trails and roads only, and a junction needs three of them, so the lattice of terrain
 * edges across open ground neither carries the player's predicted way nor counts as junctions.
 */
function junctionsAhead(g: TrailGraph, heading: { edge: EdgePos; dir: Dir }, trailsOnly: boolean): { id: string; d: number }[] {
  const e0 = g.edges.get(heading.edge.edgeId);
  if (!e0 || (trailsOnly && e0.offtrail)) return [];
  const startNode = heading.dir === 1 ? e0.to : e0.from;
  const firstLen = heading.dir === 1 ? e0.lengthM - heading.edge.distM : heading.edge.distM;
  const real = (edgeId: string) => !trailsOnly || !g.edges.get(edgeId)?.offtrail;

  // Dijkstra-liknande svep framåt (utan att vända) från spelarens nod.
  const dist = new Map<string, number>([[startNode, firstLen]]);
  const queue: string[] = [startNode];
  const cameFrom = new Map<string, string>([[startNode, e0.id]]);
  const candidates: { id: string; d: number }[] = [];
  while (queue.length) {
    queue.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const n = queue.shift()!;
    const d = dist.get(n)!;
    if (d > INTERCEPT_HORIZON_M) break;
    const adj = g.adj.get(n) ?? [];
    if ((trailsOnly ? adj.filter((a) => real(a.edgeId)).length : adj.length) >= 3) candidates.push({ id: n, d });
    for (const a of adj) {
      if (!real(a.edgeId)) continue;
      if (a.edgeId === cameFrom.get(n) && n !== startNode) continue;
      if (a.edgeId === e0.id && n === startNode) continue; // ingen vändning
      const nd = d + a.lengthM;
      if (nd < (dist.get(a.to) ?? Infinity)) {
        dist.set(a.to, nd);
        cameFrom.set(a.to, a.edgeId);
        queue.push(a.to);
      }
    }
  }
  return candidates;
}

/**
 * Genskjutning (PRD 4.4): hitta en korsning framför spelaren som zombien rimligen hinner före.
 * Använder bara senast observerade position/riktning och en nominell spelarfart – aldrig spelarens verkliga framtid.
 */
function findIntercept(
  ctx: AiContext,
  z: Zombie,
): { nodeId: string; route: Route } | null {
  const { g, rules } = ctx;
  const heading = ctx.track ? headingFromTrack(g, rules, ctx.track) : estimateHeading(g, rules, z, rules.playerPaceMps);
  if (!heading || !z.lastKnownPlayerPosition) return null;
  const ageS = Math.max(0, ctx.timeS - z.lastKnownPlayerPosition.observedAtMs / 1000);
  let candidates = junctionsAhead(g, heading, !!ctx.track);
  const zPos: EdgePos = { edgeId: z.edgeId, distM: z.distanceAlongEdgeM };
  if (ctx.track) {
    // A dense street network has dozens of junctions ahead, most of them hopeless for this zombie. Keep only those it could reach first
    // even in a straight line (no route can be shorter), then search routes for the nearest few of them.
    const zll = zombieLatLon(g, z);
    const h = heading as NonNullable<ReturnType<typeof headingFromTrack>>;
    candidates = candidates.filter((c) => {
      const n = g.nodes.get(c.id);
      return !!n && onTheWay(h, n, c.d) && haversineM(zll, n) / z.speedMps + INTERCEPT_MARGIN_S <= c.d / rules.playerPaceMps - ageS;
    }).slice(0, INTERCEPT_MAX_CANDIDATES);
  }

  let best: { nodeId: string; route: Route; playerEta: number } | null = null;
  for (const c of candidates) {
    const playerEta = c.d / rules.playerPaceMps - ageS;
    if (playerEta < 0) continue; // spelaren har troligen redan passerat
    const target = posAtNode(g, c.id);
    if (!target) continue;
    const route = planRoute(g, zPos, target, z.speedMps, planOpts(g, rules, z.speedMps));
    if (!route) continue;
    if (route.etaS + INTERCEPT_MARGIN_S <= playerEta && (!best || playerEta < best.playerEta)) {
      best = { nodeId: c.id, route, playerEta };
    }
  }
  return best ? { nodeId: best.nodeId, route: best.route } : null;
}

/** Track model: is the junction this zombie is heading for still ahead of the player, as far as the player's track tells? */
function interceptStillAhead(ctx: AiContext, z: Zombie): boolean {
  if (!ctx.track || !z.targetNodeId) return true;
  const heading = headingFromTrack(ctx.g, ctx.rules, ctx.track);
  if (!heading) return true; // standing still: nothing new is known, the zombie keeps its plan
  const target = ctx.g.nodes.get(z.targetNodeId);
  return !!target && junctionsAhead(ctx.g, heading, true).some((c) => c.id === z.targetNodeId && onTheWay(heading, target, c.d));
}

/**
 * Track model: a junction counts as ahead of the player only if it lies in the direction the player is moving (within about 70 degrees)
 * and the way there is fairly direct. In a street grid every junction can be reached "forwards" by going round a block, also the ones
 * behind a player who has just turned; those are not where the player is going.
 */
const AHEAD_MIN_COS = 0.35;
function onTheWay(h: { from: LatLon; vx: number; vy: number }, junction: LatLon, aheadM: number): boolean {
  const v = toLocal(h.from, junction);
  const straight = Math.hypot(v.x, v.y);
  if (straight < 1) return true;
  if ((v.x * h.vx + v.y * h.vy) / straight < AHEAD_MIN_COS) return false;
  return aheadM <= straight * 1.5 + 40;
}

/** Delat kortaste-tid-träd per graf och mål (terrängnät): alla zombier som jagar samma observation använder samma träd. */
const treeCache = new WeakMap<TrailGraph, Map<string, TargetTree | null>>();
const TREE_CACHE_SIZE = 4;
/** Målets läge längs kanten avrundas så här (m): zombier som jagar samma punkt några meter isär delar träd. */
const TREE_TARGET_STEP_M = 15;

function planToLastKnown(ctx: AiContext, z: Zombie): boolean {
  if (!z.lastKnownEdge) return false;
  if (ctx.g.hasOfftrail) {
    const k = z.lastKnownEdge;
    const q = Math.round(k.distM / TREE_TARGET_STEP_M);
    const key = `${k.edgeId}@${q}|${z.speedMps.toFixed(3)}|${ctx.rules.offTrailFactor}`;
    let cache = treeCache.get(ctx.g);
    if (!cache) treeCache.set(ctx.g, (cache = new Map()));
    if (!cache.has(key)) {
      const o = planOpts(ctx.g, ctx.rules, z.speedMps);
      const speed = o.speed ?? (() => z.speedMps);
      if (cache.size >= TREE_CACHE_SIZE) cache.delete(cache.keys().next().value!);
      cache.set(key, buildTargetTree(ctx.g, { edgeId: k.edgeId, distM: Math.min(ctx.g.edges.get(k.edgeId)?.lengthM ?? k.distM, q * TREE_TARGET_STEP_M) }, speed));
    }
    const hit = { tree: cache.get(key) };
    const r = hit.tree?.routeFrom({ edgeId: z.edgeId, distM: z.distanceAlongEdgeM });
    if (r) {
      applyRoute(z, r);
      return true;
    }
  }
  const r = planRoute(ctx.g, { edgeId: z.edgeId, distM: z.distanceAlongEdgeM }, z.lastKnownEdge, z.speedMps, planOpts(ctx.g, ctx.rules, z.speedMps));
  if (!r) return false;
  applyRoute(z, r);
  return true;
}

function scheduleReplan(ctx: AiContext, z: Zombie, inContact: boolean) {
  // Under direktkontakt följer zombien snabbare efter; annars gäller den begränsade frekvensen (PRD 8.4).
  // Magnet-jakt sprider omplaneringarna (2–4 s) så att många zombier inte planerar samma tick.
  const contact = ctx.magnetObservation ? CONTACT_REPLAN_S + rand(ctx.rng) * 2 : CONTACT_REPLAN_S;
  z.replanAtS = ctx.timeS + (inContact ? contact : REPLAN_MIN_S + rand(ctx.rng) * REPLAN_JITTER_S);
}

/** Ett AI-steg för en zombie. `arrived` anger att rörelsen nådde sitt mål under föregående tick. */
export function updateZombieAI(ctx: AiContext, z: Zombie, arrived: boolean): void {
  const { rules, timeS } = ctx;
  const zll = zombieLatLon(ctx.g, z);

  // 1. Upptäckt via närhet (kräver giltig GPS).
  const dist = haversineM(zll, ctx.playerPos);
  // Magnet-jakt: med giltig GPS känner zombien alltid spelarens (snappade) position och jagar kontinuerligt, oavsett avstånd.
  // Gäller bara nätet (stigbunden): zombien går den kortaste vägen längs stigar/vägar mot spelaren.
  // Within magnetRangeM only (Infinity on foot): far-away zombies keep patrolling, so a long track stays spread out. Hysteresis while chasing.
  const range = rules.magnetRangeM * (z.state === "chase" || z.state === "intercept" ? 1.25 : 1);
  const inRange = dist <= range;
  const magnet = !!ctx.magnetObservation && inRange;
  const inContact = magnet || (ctx.detectionEnabled && dist <= rules.detectionRadiusM);
  if (inContact) {
    const obs = (magnet ? ctx.magnetObservation : null) ?? makeObservation(ctx.g, ctx.playerPos, timeS, undefined, z.lastKnownEdge ? { edgeId: z.lastKnownEdge.edgeId, edgeDistM: z.lastKnownEdge.distM } : null);
    if (obs) {
      observe(z, obs);
      z.contactLostS = 0;
      if (z.state === "patrol" || z.state === "investigate") {
        ctx.events.push({ type: "zombie_detected", zombieId: z.id });
        setState(z, "chase", timeS);
        z.replanAtS = timeS;
      }
    }
  } else if (z.state === "chase" || z.state === "intercept") {
    z.contactLostS += STEP_S;
  }

  // 2. Periodiskt positionsavslöjande.
  if (ctx.reveal && ctx.playerObservation && inRange) {
    const o = ctx.playerObservation;
    if (z.state === "patrol") {
      if (rand(ctx.rng) < rules.revealResponseProb) {
        observe(z, o);
        setState(z, "investigate", timeS);
        z.replanAtS = timeS;
      }
    } else {
      observe(z, o);
      z.replanAtS = Math.min(z.replanAtS, timeS + 1);
    }
  }

  // 3. Tillståndsövergångar.
  switch (z.state) {
    case "investigate":
      if (arrived || timeS - z.stateSinceS > INVESTIGATE_TIMEOUT_S) setState(z, "patrol", timeS);
      break;
    case "chase":
      if (z.contactLostS > CONTACT_LOSS_S && !inContact) {
        setState(z, "investigate", timeS);
        z.replanAtS = timeS;
      }
      break;
    case "intercept":
      // AI with roles: the plan has its own end (the expected meeting time, engine/ai/roles.ts), so losing contact does not end it.
      // Arriving early is not an end either: it waits there (engine/ai/roles.ts, waitAtMeeting).
      if (rules.zombieAi === "roles") break;
      if (arrived || z.contactLostS > CONTACT_LOSS_S) {
        setState(z, z.contactLostS > CONTACT_LOSS_S ? "investigate" : "chase", timeS);
        z.replanAtS = timeS;
      }
      break;
    default:
      break;
  }

  // 4. Planering mot senast kända position.
  if (
    (z.state === "chase" || z.state === "investigate") &&
    (timeS >= z.replanAtS || (arrived && z.state === "chase"))
  ) {
    if (!planToLastKnown(ctx, z)) setState(z, "patrol", timeS);
    scheduleReplan(ctx, z, inContact && z.state === "chase");
  }

  // 5. AI with roles: pursuers are done (step 4); interceptors forecast and pick a meeting point (engine/ai/roles.ts).
  if (rules.zombieAi === "roles") {
    if (z.state !== "intercept" && z.meeting) z.meeting = undefined; // left the plan in step 3 (arrived, or lost contact)
    if (roleOf(z) !== "interceptor") return;
    if (z.state === "intercept" && closeContact(ctx, zll)) {
      dropMeeting(ctx, z);
      if (planToLastKnown(ctx, z)) scheduleReplan(ctx, z, inContact);
      return;
    }
    if (timeS - z.stateSinceS < MIN_DECISION_S && z.state === "chase") return;
    waitAtMeeting(z);
    interceptorStep({ g: ctx.g, rules, rng: ctx.rng, timeS, track: ctx.track, zombies: ctx.zombies, component: ctx.component, events: ctx.events as { type: "zombie_intercept"; zombieId: string }[] }, z);
    return;
  }

  // 5. Taktisk omplanering: försök genskjuta.
  if (z.state === "chase" && z.canIntercept && timeS >= z.tacticalAtS && timeS - z.stateSinceS >= MIN_DECISION_S) {
    z.tacticalAtS = timeS + TACTICAL_MIN_S + rand(ctx.rng) * TACTICAL_JITTER_S;
    const hit = findIntercept(ctx, z);
    if (hit) {
      z.targetNodeId = hit.nodeId;
      applyRoute(z, hit.route);
      setState(z, "intercept", timeS);
      z.replanAtS = timeS + MIN_DECISION_S;
      if (ctx.track) {
        z.tacticalAtS = timeS + INTERCEPT_RECHECK_S + rand(ctx.rng) * INTERCEPT_RECHECK_JITTER_S;
        ctx.events.push({ type: "zombie_intercept", zombieId: z.id });
      }
    }
  } else if (ctx.track && z.state === "intercept" && timeS >= z.tacticalAtS) {
    // Track model: the interceptor has no perfect knowledge. It holds its plan for a while, then looks at the player's track again; a
    // player who turned away or took another branch has fooled it, and it goes back to following (and may try again later).
    z.tacticalAtS = timeS + INTERCEPT_RECHECK_S + rand(ctx.rng) * INTERCEPT_RECHECK_JITTER_S;
    if (!interceptStillAhead(ctx, z)) {
      setState(z, "chase", timeS);
      z.targetNodeId = undefined;
      z.replanAtS = timeS;
      z.tacticalAtS = timeS + TACTICAL_MIN_S + rand(ctx.rng) * TACTICAL_JITTER_S;
    }
  }
}

