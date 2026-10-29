import { ACTIVITIES, type Activity } from "./activities";
import { DIFFICULTIES, type Difficulty } from "./difficulty";

export const RULES_VERSION = "2.7.0";

/** Fast simuleringssteg (PRD 8.4): 5 Hz. */
export const STEP_S = 0.2;

export const INFECTION_RADIUS_M = 20;
export const INFECTION_TIME_S = 3;
/** Vid GPS-noggrannhet 10–20 m krävs ytterligare verifiering (PRD 6.3). */
export const INFECTION_TIME_VERIFY_S = 5;

export const EXTRACTION_OPEN_FRACTION = 0.8;

/**
 * Survival: when extraction opens (s). About 80 % of the match, rounded down to whole 5 minutes so the player can be told a plain time
 * (30 min → 20 min, 45 → 35, 60 → 45, 15 → 10). Always in the last half; very short matches (tests) keep the plain 80 %.
 */
export function extractionOpensAtS(durationS: number): number {
  const rounded = Math.floor((durationS * EXTRACTION_OPEN_FRACTION) / 300) * 300;
  return rounded >= durationS / 2 ? rounded : durationS * EXTRACTION_OPEN_FRACTION;
}
export const EXTRACTION_RADIUS_M = 30;
export const EXTRACTION_HOLD_S = 5;

/**
 * Zombie-spurt: en jagande zombie inom radien accelererar (ramp) till toppfarten, håller den (hold), tappar sedan gradvis farten tillbaka
 * till grundfarten (decay) och måste därefter återhämta sig (cooldown) innan nästa spurt. Toppfaktor och tider beror på svårighet
 * (`DIFFICULTIES[d].sprint`). v2.1 hade 1,5 × i 30 s direkt, utan acceleration eller avtagande, och 30 s återhämtning för alla svårigheter.
 */
export const SPRINT_RADIUS_M = 100;

/** Zombie speed (km/h) per activity and difficulty. Run is not selectable in the app and falls back to base speed × difficulty multiplier. */
export const ZOMBIE_SPEED_KMH: Partial<Record<Activity, Record<Difficulty, number>>> = {
  // Zombierna känner spelarens position hela tiden och är snabbare än en spelare som går eller joggar ⇒ då går jakten inte att undkomma, oavsett vägval (se
  // docs/V2.2-ANALYS.md avsnitt 5.1). Farten sätts därför nära den spelargrupp nivån är avsedd för:
  //   Easy   4,5 km/h  strax under promenadfart (4,7 km/h); v2.1 hade 6 km/h, vilket hinner upp en gående spelare.
  //   Normal 7 km/h    lugn joggingfart (jogg ≈ 7,9 km/h, förhållande ≈ 1,1); v2.1 hade 10 km/h, vilket bara en löpare (10,8 km/h) kunde hålla jämna steg med.
  //   Hard   13 km/h   oförändrad. Svår är dessutom 2 × antal zombier: i simulering klarar ingen testad strategi den ens i 14–19 km/h (se rapporten); en omarbetning
  //                    av Svår (antal/tillväxt) är ett produktbeslut och ingår inte i denna justering.
  // 2.7: every speed about 20 % lower after field testing (2.6: walk 4.5 / 7 / 13, Bike 9.8 / 11.9 / 16.8; Bike was already 30 % below 2.5).
  walk: { easy: 3.6, normal: 5.6, hard: 10.4 },
  mtb: { easy: 7.8, normal: 9.5, hard: 13.4 },
};

/**
 * Number of zombies per activity and difficulty, set after field testing instead of activity × `countMultiplier` (which gave up to 36 on foot
 * and 60 on Bike Hard). Both rise linearly with the difficulty: the start by 2 per level, the most at once by 5 per level, up to 20 on Hard.
 * Bike starts 2 higher (larger area, start zombies spread over it); the maximum is the same. Run falls back to the formula.
 */
export const ZOMBIE_COUNT: Partial<Record<Activity, Record<Difficulty, { initial: number; max: number }>>> = {
  walk: { easy: { initial: 4, max: 10 }, normal: { initial: 6, max: 15 }, hard: { initial: 8, max: 20 } },
  mtb: { easy: { initial: 6, max: 10 }, normal: { initial: 8, max: 15 }, hard: { initial: 10, max: 20 } },
};

/** Neutral återstartsperiod efter paus, utan infektion (PRD 7.2). */
export const RESUME_NEUTRAL_S = 5;
/** Efter så här lång GPS-förlust erbjuds spelaren att avsluta som INCOMPLETE (PRD 6.4). */
export const GPS_LOST_LONG_S = 60;

export const GPS_ACCURACY = { okM: 10, verifyM: 20, infectionPausedM: 35 } as const;

/**
 * Zombiers fart (km/h) utanför stigar i terrängläget (A TO B till fots), samma absoluta värde oavsett aktivitet.
 * Preliminära värden från docs/OFFTRAIL-BIKE-ADDENDUM.md; används bara på terrängkanter (`GraphEdge.offtrail`), som bara finns i terrängläget.
 */
export const OFF_TRAIL_KMH: Record<Difficulty, number> = { easy: 2, normal: 2.8, hard: 3.6 }; // 2.7: 20 % lower (was 2.5 / 3.5 / 4.5)

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
  spawnMaxDistanceM: number;
  startMinDistanceM: number;
  startSpacingM: number;
  spreadStart: boolean;
  magnetRangeM: number;
  /** Magnet-jakt: zombier känner alltid spelarens (giltiga) position och jagar kontinuerligt, utan upptäcktsradie. */
  magnetic: boolean;
  /** Cykel: en spelare som varaktigt är utanför nätet blir exponerad när budgeten är slut (engine/offnetwork.ts). */
  offNetworkExposure: boolean;
  /** Fartfaktor på terrängkanter (1 = ingen skillnad). Bara terrängläget har sådana kanter; cykel är alltid vägbunden. */
  offTrailFactor: number;
  sprintRadiusM: number;
  /** Sekunder på toppfart. Hela spurten är ramp + duration + decay. */
  sprintDurationS: number;
  /** Toppfart som faktor av grundfarten. */
  sprintSpeedFactor: number;
  /** Återhämtning efter spurtens slut innan en ny kan starta. */
  sprintCooldownS: number;
  /** Sekunder med linjär acceleration från grundfart till toppfart. */
  sprintRampS: number;
  /** Sekunder med linjärt avtagande fart från toppfart tillbaka till grundfart. */
  sprintDecayS: number;
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
  const count = ZOMBIE_COUNT[activity]?.[difficulty];
  const maxZombies = Math.max(1, Math.min(count?.max ?? Math.round(a.maxZombies * d.countMultiplier), spawnCapacity));
  const initialZombies = Math.max(1, Math.min(count?.initial ?? Math.round(a.initialZombies * d.countMultiplier), maxZombies));
  const growthWindowMin = Math.max(1, (extractionOpensAtS(durationS) - a.headStartS) / 60);
  return {
    rulesVersion: RULES_VERSION,
    activity,
    difficulty,
    durationS,
    headStartS: a.headStartS,
    extractionOpensAtS: extractionOpensAtS(durationS),
    zombieSpeedMps: (ZOMBIE_SPEED_KMH[activity]?.[difficulty] ?? a.zombieSpeedKmh * d.speedMultiplier) / 3.6,
    initialZombies,
    maxZombies,
    growthPerMin: (maxZombies - initialZombies) / growthWindowMin,
    spawnMinDistanceM: a.spawnMinDistanceM,
    spawnMaxDistanceM: a.spawnMaxDistanceM,
    startMinDistanceM: a.startMinDistanceM,
    startSpacingM: a.startSpacingM,
    spreadStart: a.spreadStart,
    magnetRangeM: a.magnetRangeM,
    magnetic: true,
    offNetworkExposure: activity === "mtb",
    offTrailFactor: activity === "mtb" ? 1 : Math.min(1, OFF_TRAIL_KMH[difficulty] / 3.6 / ((ZOMBIE_SPEED_KMH[activity]?.[difficulty] ?? a.zombieSpeedKmh * d.speedMultiplier) / 3.6)),
    sprintRadiusM: SPRINT_RADIUS_M,
    sprintDurationS: d.sprint.holdS,
    sprintSpeedFactor: d.sprint.peakFactor,
    sprintCooldownS: d.sprint.cooldownS,
    sprintRampS: d.sprint.rampS,
    sprintDecayS: d.sprint.decayS,
    revealIntervalS: d.revealIntervalS,
    detectionRadiusM: d.detectionRadiusM,
    interceptShare: d.interceptShare,
    revealResponseProb: d.revealResponseProb,
    playerPaceMps: a.playerPaceMps,
    maxPlausibleSpeedMps: a.maxPlausibleSpeedMps,
    spawnCapacity,
  };
}

/** Spurtens totala längd (ramp + topp + avtagande). */
export const sprintTotalS = (r: Pick<Rules, "sprintRampS" | "sprintDurationS" | "sprintDecayS">): number => r.sprintRampS + r.sprintDurationS + r.sprintDecayS;

/** Fartfaktor (≥ 1) `sinceStartS` sekunder in i en spurt: linjär acceleration, topp, linjärt avtagande. */
export function sprintFactorAt(r: Pick<Rules, "sprintRampS" | "sprintDurationS" | "sprintDecayS" | "sprintSpeedFactor">, sinceStartS: number): number {
  const extra = r.sprintSpeedFactor - 1;
  if (sinceStartS < 0) return 1;
  if (sinceStartS < r.sprintRampS) return 1 + extra * (sinceStartS / r.sprintRampS);
  if (sinceStartS < r.sprintRampS + r.sprintDurationS) return r.sprintSpeedFactor;
  const d = sinceStartS - r.sprintRampS - r.sprintDurationS;
  if (d < r.sprintDecayS) return 1 + extra * (1 - d / r.sprintDecayS);
  return 1;
}
