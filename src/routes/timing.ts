import { ACTIVITIES, type Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";

/** Lugn fart som andel av aktivitetens nominella fart. Tidsgränsen utgår från denna, inte från maxfart. */
const CALM_FACTOR = 0.6;
const MARGIN: Record<Difficulty, number> = { easy: 1.4, normal: 1.25, hard: 1.1 };

/**
 * Tidsgräns (s) för Escape/Mission: ruttlängd i lugn fart × marginal + fast tillägg för bekräftelser.
 * Ingen bonus för snabbare mål: vinst beror bara på att målet nås, inte på återstående tid (PRD-krav).
 */
export function estimateTimeLimitS(lengthM: number, activity: Activity, difficulty: Difficulty, waypoints = 1): number {
  const calm = ACTIVITIES[activity].playerPaceMps * CALM_FACTOR;
  const confirm = waypoints * 10; // 5 s bekräftelse + marginal per målpunkt
  return Math.round((lengthM / calm) * MARGIN[difficulty] + confirm + 120);
}
