import { ACTIVITIES, type Activity } from "@/config/activities";
import { haversineM, type LatLon } from "@/geo/geometry";
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
  /** A TO B (escape): spelarens valda start A (null = min position) och mål B. Ingen sträcka ställs in; längden följer av valen. */
  pointA?: LatLon | null;
  pointB?: LatLon | null;
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

/** Longest straight-line distance A–B (m) for A TO B: 20 km for every activity. */
export const atoBMaxStraightM = (_a: Activity): number => 20000;
export const A_TO_B_MIN_STRAIGHT_M = 300;

/** Mittpunkt för kartdata: mitt mellan A och B i A TO B, annars start. */
export function dataCenter(p: MatchParams, start: LatLon): LatLon {
  if (p.mode === "escape" && p.pointB) return { lat: (start.lat + p.pointB.lat) / 2, lon: (start.lon + p.pointB.lon) / 2 };
  return start;
}

/** Radien (m) kring start som behöver kartdata. Håller nere nedladdningen för korta matcher. */
export function dataRadiusM(p: MatchParams): number {
  if (p.mode === "survival") return Math.max(ACTIVITIES[p.activity].autoRadiusM, ACTIVITIES[p.activity].playerPaceMps * p.durationS * 0.5);
  // A TO B: A och B är valda (A sätts till startpositionen vid förberedelsen); datan måste täcka båda plus omvägar.
  if (p.mode === "escape" && p.pointA && p.pointB) return haversineM(p.pointA, p.pointB) * 0.75 + 600;
  if (p.mode === "escape") return p.targetLengthM * 0.75 + 300;
  return p.targetLengthM * 0.5 + 500;
}

/**
 * Zombier ritas på kartan (och räknas i HUD:ens "Zombie N m") inom detta avstånd, oavsett spelområdets storlek. Skild från
 * `proximityRadiusM`, som bara styr varningsljudet. Fälttest 1: zombie 600 m bort stod i HUD men ritades inte eftersom kartradien då var 500 m.
 */
export const VISIBLE_RADIUS_M = 1000;

/** Spelområden med datahämtningsradie under denna gräns räknas som "små" (se proximityRadiusM). */
export const LARGE_AREA_RADIUS_M = 3500;

/**
 * Närhetsradie (m): inom detta geografiska avstånd syns zombier på kartan och en ny zombie ger ett varningsljud.
 * 500 m i små spelområden (Walk/Run-slingor, korta Escape), 1 000 m i stora (MTB, långa pass, Survival över ca 3,5 km radie).
 * Utgår från samma radie som kartdata hämtas med (`dataRadiusM`), alltså spelområdets faktiska storlek – aldrig från zoom eller pixlar.
 */
export function proximityRadiusM(p: MatchParams): number {
  return dataRadiusM(p) >= LARGE_AREA_RADIUS_M ? 1000 : 500;
}

/** Före matchstart: bästa acceptabla noggrannhet (m) för att få starta, och när varning visas. */
export const START_MAX_ACCURACY_M = 25;
export const START_WARN_ACCURACY_M = 15;
/** Hur långt spelaren får ha rört sig från förhandsvisningens startpunkt innan förslaget måste uppdateras. */
export const START_MOVED_LIMIT_M = 60;
