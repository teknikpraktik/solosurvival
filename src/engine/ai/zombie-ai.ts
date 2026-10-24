import { haversineM, type LatLon } from "@/geo/geometry";
import { posAtNode, snapToGraphNear } from "@/geo/graph/graph";
import type { Dir, EdgePos, TrailGraph } from "@/geo/graph/types";
import { buildTargetTree, planRoute, type PlanOptions, type Route, type TargetTree } from "../pathfinding/astar";
import { rand, type RngHolder } from "../core/rng";
import type { Observation, Zombie, ZombieState } from "../core/types";
import { zombieLatLon } from "../core/movement";
import { STEP_S, type Rules } from "@/config/game-rules";

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
  events: { type: "zombie_detected"; zombieId: string }[];
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
 * Genskjutning (PRD 4.4): hitta en korsning framför spelaren som zombien rimligen hinner före.
 * Använder bara senast observerade position/riktning och en nominell spelarfart – aldrig spelarens verkliga framtid.
 */
function findIntercept(
  ctx: AiContext,
  z: Zombie,
): { nodeId: string; route: Route } | null {
  const { g, rules } = ctx;
  const heading = estimateHeading(g, rules, z, rules.playerPaceMps);
  if (!heading || !z.lastKnownPlayerPosition) return null;
  const ageS = Math.max(0, ctx.timeS - z.lastKnownPlayerPosition.observedAtMs / 1000);
  const e0 = g.edges.get(heading.edge.edgeId)!;
  const startNode = heading.dir === 1 ? e0.to : e0.from;
  const firstLen = heading.dir === 1 ? e0.lengthM - heading.edge.distM : heading.edge.distM;

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
    if (adj.length >= 3) candidates.push({ id: n, d });
    for (const a of adj) {
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

  const zPos: EdgePos = { edgeId: z.edgeId, distM: z.distanceAlongEdgeM };
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

  // 5. Taktisk omplanering: försök genskjuta.
  if (z.state === "chase" && z.canIntercept && timeS >= z.tacticalAtS && timeS - z.stateSinceS >= MIN_DECISION_S) {
    z.tacticalAtS = timeS + TACTICAL_MIN_S + rand(ctx.rng) * TACTICAL_JITTER_S;
    const hit = findIntercept(ctx, z);
    if (hit) {
      z.targetNodeId = hit.nodeId;
      applyRoute(z, hit.route);
      setState(z, "intercept", timeS);
      z.replanAtS = timeS + MIN_DECISION_S;
    }
  }
}

