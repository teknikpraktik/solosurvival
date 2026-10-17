import { ACTIVITIES, type Activity } from "./activities";
import { DIFFICULTIES, type Difficulty } from "./difficulty";

export const RULES_VERSION = "1.0.0-proto";

/** Fast simuleringssteg (PRD 8.4): 5 Hz. */
export const STEP_S = 0.2;

export const INFECTION_RADIUS_M = 20;
export const INFECTION_TIME_S = 3;
/** Vid GPS-noggrannhet 10–20 m krävs ytterligare verifiering (PRD 6.3). */
export const INFECTION_TIME_VERIFY_S = 5;

export const EXTRACTION_OPEN_FRACTION = 0.8;
export const EXTRACTION_RADIUS_M = 30;
export const EXTRACTION_HOLD_S = 5;

/** Neutral återstartsperiod efter paus, utan infektion (PRD 7.2). */
export const RESUME_NEUTRAL_S = 5;
/** Efter så här lång GPS-förlust erbjuds spelaren att avsluta som INCOMPLETE (PRD 6.4). */
export const GPS_LOST_LONG_S = 60;

export const GPS_ACCURACY = { okM: 10, verifyM: 20, infectionPausedM: 35 } as const;

export interface Rules {
  rulesVersion: string;
  activity: Activity;
  difficulty: Difficulty;
  durationS: number;
  headStartS: number;
  extractionOpensAtS: number;
  zombieSpeedMps: number;
  initialZombies: number;
  maxZombies: number;
  /** Zombier som tillkommer per minut efter försprånget. */
  growthPerMin: number;
  spawnMinDistanceM: number;
  revealIntervalS: number;
  detectionRadiusM: number;
  interceptShare: number;
  revealResponseProb: number;
  playerPaceMps: number;
  maxPlausibleSpeedMps: number;
  /** Max antal zombier som området klarar (spawn-kapacitet); begränsar max. */
  spawnCapacity: number;
}

export function resolveRules(
  activity: Activity,
  difficulty: Difficulty,
  durationS: number,
  spawnCapacity = Infinity,
): Rules {
  const a = ACTIVITIES[activity];
  const d = DIFFICULTIES[difficulty];
  const maxZombies = Math.max(1, Math.min(Math.round(a.maxZombies * d.countMultiplier), spawnCapacity));
  const initialZombies = Math.max(1, Math.min(Math.round(a.initialZombies * d.countMultiplier), maxZombies));
  const growthWindowMin = Math.max(1, (durationS * EXTRACTION_OPEN_FRACTION - a.headStartS) / 60);
  return {
    rulesVersion: RULES_VERSION,
    activity,
    difficulty,
    durationS,
    headStartS: a.headStartS,
    extractionOpensAtS: durationS * EXTRACTION_OPEN_FRACTION,
    zombieSpeedMps: (a.zombieSpeedKmh / 3.6) * d.speedMultiplier,
    initialZombies,
    maxZombies,
    growthPerMin: (maxZombies - initialZombies) / growthWindowMin,
    spawnMinDistanceM: a.spawnMinDistanceM,
    revealIntervalS: d.revealIntervalS,
    detectionRadiusM: d.detectionRadiusM,
    interceptShare: d.interceptShare,
    revealResponseProb: d.revealResponseProb,
    playerPaceMps: a.playerPaceMps,
    maxPlausibleSpeedMps: a.maxPlausibleSpeedMps,
    spawnCapacity,
  };
}
