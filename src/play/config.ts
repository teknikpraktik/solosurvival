import { ACTIVITIES, type Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import type { GameMode } from "@/engine/objectives/objectives";

export interface MatchParams {
  mode: GameMode;
  activity: Activity;
  difficulty: Difficulty;
  /** Escape: ruttlängd A→B. Mission: slingans längd. Survival: används inte (matchlängd i `durationS`). */
  targetLengthM: number;
  /** Survival: matchlängd (s). Escape/Mission: tidsgräns beräknas från rutten. */
  durationS: number;
  seed: number;
}

/** Skjutreglage för sträcka (Escape/Mission) per aktivitet: min, max, steg och förvalt värde (m). */
export const DISTANCE_LIMITS: Record<Activity, { min: number; max: number; step: number; default: number }> = {
  walk: { min: 1000, max: 6000, step: 250, default: 3000 },
  run: { min: 2000, max: 12000, step: 500, default: 5000 },
  mtb: { min: 4000, max: 30000, step: 1000, default: 10000 },
};

/** Skjutreglage för matchlängd (Survival) i minuter. Förvalt = aktivitetens defaultDurationS. */
export const DURATION_LIMITS: Record<Activity, { minMin: number; maxMin: number; stepMin: number }> = {
  walk: { minMin: 15, maxMin: 60, stepMin: 5 },
  run: { minMin: 20, maxMin: 75, stepMin: 5 },
  mtb: { minMin: 20, maxMin: 90, stepMin: 5 },
};

export const defaultParams = (activity: Activity = "walk"): MatchParams => ({
  mode: "mission",
  activity,
  difficulty: "normal",
  targetLengthM: DISTANCE_LIMITS[activity].default,
  durationS: ACTIVITIES[activity].defaultDurationS,
  seed: Math.floor(Math.random() * 1e9),
});

/** Byte av aktivitet återställer reglagen till aktivitetens förvalda värden. */
export function withActivity(p: MatchParams, activity: Activity): MatchParams {
  return { ...p, activity, targetLengthM: DISTANCE_LIMITS[activity].default, durationS: ACTIVITIES[activity].defaultDurationS };
}

export function clampParams(p: MatchParams): MatchParams {
  const d = DISTANCE_LIMITS[p.activity];
  const t = DURATION_LIMITS[p.activity];
  return {
    ...p,
    targetLengthM: Math.min(d.max, Math.max(d.min, p.targetLengthM)),
    durationS: Math.min(t.maxMin * 60, Math.max(t.minMin * 60, p.durationS)),
  };
}

/** Radien (m) kring start som behöver kartdata. Håller nere nedladdningen för korta matcher. */
export function dataRadiusM(p: MatchParams): number {
  if (p.mode === "survival") return Math.max(ACTIVITIES[p.activity].autoRadiusM, ACTIVITIES[p.activity].playerPaceMps * p.durationS * 0.5);
  if (p.mode === "escape") return p.targetLengthM * 0.75 + 300;
  return p.targetLengthM * 0.5 + 500;
}

/**
 * Hur nära en zombie måste vara för att synas på kartan (m). Preliminärt UI-värde (påverkar inte motorn);
 * justeras efter fälttest. Längre för snabbare aktiviteter eftersom reaktionssträckan är längre.
 */
export const AWARENESS_M: Record<Activity, number> = { walk: 150, run: 250, mtb: 400 };

/** Före matchstart: bästa acceptabla noggrannhet (m) för att få starta, och när varning visas. */
export const START_MAX_ACCURACY_M = 25;
export const START_WARN_ACCURACY_M = 15;
/** Hur långt spelaren får ha rört sig från förhandsvisningens startpunkt innan förslaget måste uppdateras. */
export const START_MOVED_LIMIT_M = 60;
