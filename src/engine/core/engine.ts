import {
  EXTRACTION_HOLD_S,
  EXTRACTION_RADIUS_M,
  GPS_LOST_LONG_S,
  INFECTION_RADIUS_M,
  PASS_THROUGH_WINDOW_S,
  RESUME_NEUTRAL_S,
  STEP_S,
  sprintFactorAt,
  sprintTotalS,
  type Rules,
} from "@/config/game-rules";
import { haversineM, toLocal, type LatLon } from "@/geo/geometry";
import { edgeLatLon, nodeLatLon, snapToGraph } from "@/geo/graph/graph";
import type { EdgePos, TrailGraph } from "@/geo/graph/types";
import type { GpsQuality } from "@/gps/types";
import { cullStackedZombies } from "../ai/culling";
import { makeObservation, updateZombieAI } from "../ai/zombie-ai";
import { chooseExtraction } from "../extraction/extraction";
import { CONTACT_CHECK_M, infectionContactM } from "../infection/contact";
import { updateInfection } from "../infection/infection";
import { OFF_WAIT_M, initialOffNetwork, isExposed, updateOffNetwork } from "../offnetwork";
import { findSpawn } from "../spawning/spawn";
import { advanceZombie, zombieLatLon } from "./movement";
import { rand } from "./rng";
import { OBJECTIVE_MIN_FIXES, OBJECTIVE_SPAWN_EXCLUSION_M, VERIFY_OK_ACCURACY_M, updateObjectives, type ObjectiveSet } from "../objectives/objectives";
import type { GameConfig, GameEvent, GamePhase, GameResult, GameState, Zombie } from "./types";

export interface StepInput {
  /** Filtrerad spelposition, null om den saknas. */
  position: LatLon | null;
  quality: GpsQuality;
  accuracyM: number;
  /** Löpnummer för senaste godkända GPS-fix (live-spel). Används för att kräva flera olika fixar vid målbekräftelse. */
  fixSeq?: number;
}

export class GameSetupError extends Error {}

/** Aktuell fartfaktor för en zombie (1 utanför spurt). Äldre sparade matcher saknar `sprintStartS`: då antas en spurt utan ramp/avtagande. */
export function zombieSpeedFactor(rules: Rules, z: Pick<Zombie, "sprintUntilS" | "sprintStartS">, t: number): number {
  if (z.sprintUntilS === undefined) return 1;
  const start = z.sprintStartS ?? z.sprintUntilS - rules.sprintDurationS;
  return sprintFactorAt(rules, t - start);
}

export interface CreateGameOptions {
  g: TrailGraph;
  config: GameConfig;
  rules: Rules;
  start: LatLon;
  id?: string;
  /** Mål för Escape/Mission. */
  objectives?: ObjectiveSet;
}

/**
 * Skapar en match. Spelaren måste ligga nära nätet; initiala zombier placeras enligt spawnreglerna
 * (och hoppas över om säker placering saknas).
 */
export function createGame({ g, config, rules, start, id, objectives }: CreateGameOptions): { state: GameState; events: GameEvent[] } {
  const snap = snapToGraph(g, start);
  if (!snap || snap.offNetworkM > 150) throw new GameSetupError("Startpositionen ligger för långt från stignätet.");
  const component = g.edges.get(snap.edgeId)!.component;

  const state: GameState = {
    id: id ?? `game-${config.seed}`,
    config,
    phase: "head_start",
    elapsedSeconds: 0,
    zombies: [],
    infectionProgressSeconds: 0,
    rngState: config.seed >>> 0,
    player: { position: start, distanceM: 0 },
    paused: false,
    neutralUntilS: 0,
    extractionHoldS: 0,
    gpsLostS: 0,
    gpsLostLong: false,
    nextRevealAtS: rules.headStartS + rules.revealIntervalS,
    nextSpawnTryAtS: rules.headStartS,
    zombieCounter: 0,
    peakZombies: 0,
    component,
    objectives,
    startPos: start,
    offNetwork: rules.offNetworkExposure ? initialOffNetwork() : undefined,
  };
  const events: GameEvent[] = [{ type: "phase", phase: "head_start" }];
  // Initial zombies keep their distance (time to look around) and, when rules.spreadStart is set (Bike), are spread out:
  // one per mission checkpoint in turn (farther than startMinDistanceM from the start), otherwise spaced over the whole area.
  const cps = (objectives?.targets ?? []).filter((t) => t.kind !== "home" && haversineM(t, start) >= rules.startMinDistanceM);
  for (let i = 0; i < rules.initialZombies; i++) {
    const near = rules.spreadStart && cps.length && state.config.mode !== "escape" ? { p: cps[i % cps.length], minR: 100, maxR: 450 } : undefined;
    const band = state.config.mode === "escape" ? { i, n: rules.initialZombies } : undefined;
    if (!trySpawn(g, state, rules, snap, events, { initial: true, near, band })) break;
  }
  return { state, events };
}

function trySpawn(g: TrailGraph, s: GameState, rules: Rules, playerPos: EdgePos, events: GameEvent[], opt: { initial?: boolean; near?: { p: LatLon; minR: number; maxR: number }; band?: { i: number; n: number } } = {}): boolean {
  const ctx = {
    player: s.player.position,
    playerPos,
    component: s.component,
    zombiePositions: s.zombies.map((z) => zombieLatLon(g, z)),
    minDistanceM: opt.initial ? rules.startMinDistanceM : rules.spawnMinDistanceM,
    avoid: s.objectives?.targets.filter((t) => t.kind !== "home").map((t) => ({ p: t, r: (s.objectives?.targets.length ?? 0) > 6 ? 80 : OBJECTIVE_SPAWN_EXCLUSION_M })), // smalare zon när checkpoints ligger tätt (Mission)
  };
  // A TO B: zombierna ska uppstå mellan A och B (framför spelaren), inte bakom A eller bortom B.
  const dest = s.config.mode === "escape" ? s.objectives?.targets.find((t) => t.kind === "destination") : undefined;
  let spawn: EdgePos | null = null;
  if (dest && s.startPos) {
    const a = s.startPos;
    const bv = toLocal(a, dest);
    const pv = toLocal(a, s.player.position);
    const len2 = bv.x * bv.x + bv.y * bv.y;
    const tPlayer = len2 > 0 ? (pv.x * bv.x + pv.y * bv.y) / len2 : 0;
    const dAB = Math.sqrt(len2);
    // Initial zombies are spread evenly over the whole way: zombie i of n gets the i-th slice of the stretch from the start distance to B.
    if (opt.band && opt.initial) {
      const tLo = Math.min(0.5, Math.max(0.05, rules.startMinDistanceM / Math.max(1, dAB)));
      const tHi = 0.97;
      const w = (tHi - tLo) / opt.band.n;
      spawn = findSpawn(g, { ...ctx, minDistanceM: Math.min(ctx.minDistanceM, rules.spawnMinDistanceM), minSpacingM: 50, tries: 600, corridor: { a, b: dest, halfWidthM: Math.max(250, 0.3 * dAB), minT: tLo + opt.band.i * w, maxT: tLo + (opt.band.i + 1) * w } }, s);
    }
    if (!spawn) spawn = findSpawn(g, { ...ctx, minSpacingM: rules.spreadStart && opt.initial ? 200 : 50, corridor: { a, b: dest, halfWidthM: Math.max(250, 0.3 * dAB), minT: Math.min(0.9, Math.max(0.05, tPlayer)), maxT: 0.97 } }, s);
    if (!spawn && opt.initial && rules.startMinDistanceM > rules.spawnMinDistanceM) spawn = findSpawn(g, { ...ctx, minDistanceM: rules.spawnMinDistanceM, minSpacingM: 50, corridor: { a, b: dest, halfWidthM: Math.max(250, 0.3 * dAB), minT: Math.min(0.9, Math.max(0.05, tPlayer)), maxT: 0.97 } }, s);
  }
  // Spread start on a mission: next to a checkpoint far from the start.
  if (!spawn && opt.near) spawn = findSpawn(g, { ...ctx, near: opt.near, minSpacingM: rules.startSpacingM }, s);
  // Spread start without checkpoints (Survival): anywhere in the area, spaced out, from the start distance outwards.
  if (!spawn && opt.initial && rules.spreadStart && !dest) spawn = findSpawn(g, { ...ctx, minSpacingM: rules.startSpacingM }, s);
  if (!spawn && opt.initial && rules.startMinDistanceM > rules.spawnMinDistanceM) spawn = findSpawn(g, { ...ctx, minDistanceM: rules.spawnMinDistanceM, maxDistanceM: rules.spawnMaxDistanceM }, s);
  if (!spawn) spawn = findSpawn(g, { ...ctx, maxDistanceM: rules.spawnMaxDistanceM }, s);
  if (!spawn) {
    // Inget säkert ställe inom bandet (t.ex. spelaren långt från nätet): släpp övre gränsen hellre än att inga zombier alls tillkommer.
    spawn = findSpawn(g, ctx, s);
    if (spawn) events.push({ type: "spawn_relaxed" });
  }
  if (!spawn) {
    events.push({ type: "spawn_skipped" });
    return false;
  }
  const z: Zombie = {
    id: `z${s.zombieCounter++}`,
    edgeId: spawn.edgeId,
    distanceAlongEdgeM: spawn.distM,
    speedMps: rules.zombieSpeedMps,
    state: "patrol",
    dir: rand(s) < 0.5 ? 1 : -1,
    route: [],
    stateSinceS: s.elapsedSeconds,
    replanAtS: 0,
    tacticalAtS: s.elapsedSeconds + 20 + rand(s) * 10,
    contactLostS: 0,
    canIntercept: rand(s) < rules.interceptShare && !g.hasOfftrail, // genskjutning är odefinierad i öppen terräng
  };
  s.zombies.push(z);
  s.peakZombies = Math.max(s.peakZombies, s.zombies.length);
  events.push({ type: "zombie_spawned", zombieId: z.id });
  return true;
}

/**
 * Records the player's position in `speedTrail` and returns the speed (m/s) over the last `PASS_THROUGH_WINDOW_S` of game time, or null
 * until that much history exists. Measured over a few seconds rather than per step: positions only change on a new GPS fix (about 1 Hz).
 */
function trackPlayerSpeed(s: GameState, pos: LatLon, t: number): number | null {
  const trail = (s.player.speedTrail ??= []);
  trail.push({ t, lat: pos.lat, lon: pos.lon });
  // Keep exactly one sample at least a window old as the anchor.
  while (trail.length > 2 && t - trail[1].t >= PASS_THROUGH_WINDOW_S) trail.shift();
  const a = trail[0];
  const dt = t - a.t;
  return dt >= PASS_THROUGH_WINDOW_S - 1e-9 ? haversineM(a, pos) / dt : null;
}

/**
 * Terminal state. The first result wins and can never be changed: a finished match ignores later GPS, zombie or abort input.
 * Order of evaluation within one engine step (STEP_S), which is the rule for events that happen at (almost) the same time:
 *   1. capture (infection timer completes)  2. goal reached (last objective / extraction held)  3. time limit.
 * A goal confirmed on the very step the time limit expires therefore counts as success; a capture completing on the same step as a goal wins.
 */
function finish(s: GameState, result: GameResult, events: GameEvent[]) {
  if (s.phase === "finished") return;
  s.result = result;
  s.phase = "finished";
  events.push({ type: "finished", result });
}

function setPhase(s: GameState, phase: GamePhase, events: GameEvent[]) {
  if (s.phase !== phase) {
    s.phase = phase;
    events.push({ type: "phase", phase });
  }
}

export function pauseGame(s: GameState) {
  s.paused = true;
}

/** Återupptar med en kort neutral period där infektion är avstängd (PRD 7.2). */
export function resumeGame(s: GameState) {
  if (!s.paused || s.phase === "finished") return;
  s.paused = false;
  s.neutralUntilS = s.elapsedSeconds + RESUME_NEUTRAL_S;
  s.gpsLostLong = false;
}

export function abortGame(s: GameState, result: "aborted" | "incomplete" = "aborted"): GameEvent[] {
  const events: GameEvent[] = [];
  if (s.phase !== "finished") finish(s, result, events);
  return events;
}

/**
 * Ett fast simuleringssteg (STEP_S). Muterar `s` och returnerar händelser.
 * Pausad match och GPS-bortfall stoppar både spelklocka och zombier (PRD 6.4, 7.2).
 */
export function stepGame(g: TrailGraph, s: GameState, rules: Rules, input: StepInput): GameEvent[] {
  const events: GameEvent[] = [];
  if (s.phase === "finished" || s.paused) return events;

  if (!input.position || input.quality === "warning" || input.quality === "unavailable") {
    s.gpsLostS += STEP_S;
    if (s.gpsLostS >= GPS_LOST_LONG_S && !s.gpsLostLong) {
      s.gpsLostLong = true;
      events.push({ type: "gps_lost_long" });
    }
    return events;
  }
  s.gpsLostS = 0;

  const moved = haversineM(s.player.position, input.position);
  // Små rörelser räknas som brus; stora hopp ska redan ha filtrerats bort.
  if (moved > 0.5 && moved < 50) s.player.distanceM += moved;
  s.player.position = input.position;
  s.elapsedSeconds += STEP_S;
  const t = s.elapsedSeconds;
  const speedMps = trackPlayerSpeed(s, input.position, t);

  // Fasövergångar.
  if (s.phase === "head_start" && t >= rules.headStartS) setPhase(s, "survival", events);
  if (s.phase === "survival" && t >= rules.extractionOpensAtS) {
    setPhase(s, "extraction", events);
    openExtraction(g, s, rules, events);
  }
  const hunting = s.phase === "survival" || s.phase === "extraction";

  // Periodiskt positionsavslöjande.
  let reveal = false;
  const detection = input.quality === "ok" || input.quality === "verify" || input.quality === "infection_paused";
  if (hunting && t >= s.nextRevealAtS) {
    reveal = true;
    s.nextRevealAtS += rules.revealIntervalS;
    s.player.lastObservation = makeObservation(g, input.position, t, s.component, s.player.magnetObservation ?? s.player.lastObservation) ?? s.player.lastObservation;
    events.push({ type: "reveal" });
  }

  // Successivt fler zombier.
  if (hunting && t >= s.nextSpawnTryAtS) {
    const sinceHunt = t - rules.headStartS;
    const target = Math.min(rules.maxZombies, rules.initialZombies + Math.floor((rules.growthPerMin * sinceHunt) / 60));
    // Zombier som tagits bort ur en hög räknas fortfarande: nya kommer i samma takt som förut, men de borttagna ersätts inte.
    if (s.zombies.length + (s.culledZombies ?? 0) < target) {
      const snap = snapToGraph(g, input.position, s.component);
      if (snap && trySpawn(g, s, rules, snap, events)) s.nextSpawnTryAtS = t + 5;
      else s.nextSpawnTryAtS = t + 10; // ingen säker plats: avstå och försök senare
    }
  }

  // Magnet-jakt: en gemensam, ungefär sekundfärsk observation av spelaren som alla zombier jagar mot.
  if (hunting && rules.magnetic && detection) {
    const m = s.player.magnetObservation;
    if (!m || t - m.observedAtS >= 1) s.player.magnetObservation = makeObservation(g, input.position, t, s.component, m ?? s.player.lastObservation) ?? m;
  }

  // Zombier.
  if (hunting) {
    const aiEvents: { type: "zombie_detected"; zombieId: string }[] = [];
    for (const z of s.zombies) {
      // Spurt: en jagande zombie nära spelaren accelererar, håller toppfart, tappar den gradvis och måste sedan återhämta sig.
      if (z.sprintUntilS !== undefined && t >= z.sprintUntilS) {
        z.sprintUntilS = undefined;
        z.sprintStartS = undefined;
        z.sprintReadyAtS = t + rules.sprintCooldownS;
      }
      if (
        z.sprintUntilS === undefined &&
        (z.state === "chase" || z.state === "intercept") &&
        t >= (z.sprintReadyAtS ?? 0) &&
        haversineM(zombieLatLon(g, z), input.position) <= rules.sprintRadiusM
      ) {
        z.sprintStartS = t;
        z.sprintUntilS = t + sprintTotalS(rules);
        events.push({ type: "zombie_sprint", zombieId: z.id });
      }
      // Terrängkant: zombien går långsammare. Hastigheten avgörs av kanten den står på i stegets början (högst ett steg fel vid kantbyte).
      const offTrail = g.hasOfftrail && g.edges.get(z.edgeId)?.offtrail;
      const speed = z.speedMps * zombieSpeedFactor(rules, z, t) * (offTrail ? rules.offTrailFactor : 1);
      const arrived = advanceZombie(g, z, speed * STEP_S, s);
      updateZombieAI(
        {
          g,
          rules,
          rng: s,
          timeS: t,
          playerPos: input.position,
          playerObservation: s.player.lastObservation ?? null,
          magnetObservation: rules.magnetic && detection ? (s.player.magnetObservation ?? null) : null,
          reveal,
          detectionEnabled: detection,
          events: aiEvents,
        },
        z,
        arrived,
      );
    }
    events.push(...aiEvents);
    for (const id of cullStackedZombies(g, s.zombies, input.position)) {
      s.culledZombies = (s.culledZombies ?? 0) + 1;
      events.push({ type: "zombie_culled", zombieId: id });
    }
  }

  // Spelare utanför nätet (cykel): klassificering med hysteres och budget; exponerad spelare kan smittas av zombier som väntar vid närmaste nätpunkt.
  let exposedAt: EdgePos | null = null;
  if (hunting && rules.offNetworkExposure) {
    const st = (s.offNetwork ??= initialOffNetwork());
    const o = s.player.magnetObservation ?? s.player.lastObservation;
    const rawOffset = o ? haversineM(input.position, edgeLatLon(g, { edgeId: o.edgeId, distM: o.edgeDistM })) : null;
    const change = updateOffNetwork(st, STEP_S, rawOffset, input.accuracyM);
    if (change) events.push({ type: "off_network", change });
    if (o && isExposed(st)) exposedAt = { edgeId: o.edgeId, distM: o.edgeDistM };
  }

  // Infektion.
  if (hunting) {
    let nearest = Infinity;
    for (const z of s.zombies) nearest = Math.min(nearest, haversineM(zombieLatLon(g, z), input.position));
    // A zombie only infects if it can actually reach the player along the network (not across a road, railway or building).
    if (nearest <= CONTACT_CHECK_M) {
      const m = s.player.magnetObservation;
      const snap = m && t - m.observedAtS <= 2 ? { edgeId: m.edgeId, distM: m.edgeDistM } : snapToGraph(g, input.position, s.component);
      nearest = infectionContactM(g, input.position, snap, s.zombies);
    }
    if (exposedAt) {
      // Samma nätkontroll som för en spelare på nätet: en zombie på andra sidan en barriär (ingen väg mellan) räknas inte som väntande.
      const waiting = infectionContactM(g, edgeLatLon(g, exposedAt), exposedAt, s.zombies);
      if (waiting <= OFF_WAIT_M) nearest = Math.min(nearest, INFECTION_RADIUS_M);
    }
    // Bike: fast enough and the player rides through the zombie; the contact does not count (and the timer starts over).
    const passing = rules.passThroughMps !== undefined && speedMps !== null && speedMps >= rules.passThroughMps;
    if (passing && nearest <= INFECTION_RADIUS_M && !s.passingThrough) events.push({ type: "pass_through" });
    s.passingThrough = passing && nearest <= INFECTION_RADIUS_M;
    if (passing) nearest = Infinity;
    const before = s.infectionProgressSeconds;
    const r = updateInfection(before, {
      dtS: STEP_S,
      nearestZombieM: nearest,
      quality: input.quality,
      neutral: t < s.neutralUntilS,
    });
    s.infectionProgressSeconds = r.progressS;
    if (before === 0 && r.progressS > 0) events.push({ type: "infection_contact" });
    if (r.infected) {
      finish(s, "infected", events);
      return events;
    }
  }

  // Mål (Escape/Mission).
  if (s.objectives) {
    const u = updateObjectives(s.objectives, input.position, input.quality, STEP_S, t, { accuracyM: input.accuracyM, fixSeq: input.fixSeq });
    if (u.reached) events.push({ type: "objective_reached", targetId: u.reached.id, index: s.objectives.index - 1 });
    if (u.completed) {
      finish(s, "survived", events);
      return events;
    }
  }

  // Extraction.
  if (s.phase === "extraction" && s.extractionNodeId) {
    const ex = nodeLatLon(g, s.extractionNodeId);
    const shrink = input.quality === "verify" ? Math.max(0, input.accuracyM - VERIFY_OK_ACCURACY_M) : 0;
    const near = haversineM(ex, input.position) <= EXTRACTION_RADIUS_M - shrink;
    const reliable = input.quality === "ok" || input.quality === "verify";
    if (near && reliable) {
      s.extractionHoldS += STEP_S;
      if (input.fixSeq !== undefined && input.fixSeq !== s.extractionLastFix) {
        s.extractionLastFix = input.fixSeq;
        s.extractionFixes = (s.extractionFixes ?? 0) + 1;
      }
      if (s.extractionHoldS >= EXTRACTION_HOLD_S - 1e-9 && (input.fixSeq === undefined || (s.extractionFixes ?? 0) >= OBJECTIVE_MIN_FIXES)) {
        finish(s, "survived", events);
        return events;
      }
    } else if (!near) {
      s.extractionHoldS = 0;
      s.extractionFixes = 0;
    }
  }

  if (t >= rules.durationS) finish(s, "failed", events);
  return events;
}

function openExtraction(g: TrailGraph, s: GameState, rules: Rules, events: GameEvent[]) {
  const snap = snapToGraph(g, s.player.position, s.component);
  const node = snap
    ? chooseExtraction(
        g,
        {
          playerPos: snap,
          component: s.component,
          zombiePositions: s.zombies.map((z) => zombieLatLon(g, z)),
          remainingS: rules.durationS - s.elapsedSeconds,
          playerPaceMps: rules.playerPaceMps,
        },
        s,
      )
    : null;
  if (node) {
    s.extractionNodeId = node;
    events.push({ type: "extraction_opened", nodeId: node });
  } else {
    events.push({ type: "extraction_unavailable" });
  }
}

