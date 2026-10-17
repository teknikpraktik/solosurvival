import { INFECTION_RADIUS_M, INFECTION_TIME_S, INFECTION_TIME_VERIFY_S } from "@/config/game-rules";
import type { GpsQuality } from "@/gps/types";

export interface InfectionInput {
  dtS: number;
  /** Geografiskt avstånd (m) till närmaste zombie, Infinity om ingen finns. */
  nearestZombieM: number;
  quality: GpsQuality;
  /** Neutral återstartsperiod efter paus. */
  neutral: boolean;
}

export interface InfectionResult {
  progressS: number;
  infected: boolean;
}

/**
 * Infektion: zombie inom 20 m under sammanhängande tid (PRD 3.3).
 * Timern ackumuleras bara med tillförlitlig position, hålls vid bortfall/paus och nollställs när zombien är utanför radien.
 */
export function updateInfection(progressS: number, inp: InfectionInput): InfectionResult {
  if (inp.quality === "warning" || inp.quality === "unavailable" || inp.quality === "infection_paused") {
    return { progressS, infected: false };
  }
  if (inp.nearestZombieM > INFECTION_RADIUS_M) return { progressS: 0, infected: false };
  if (inp.neutral) return { progressS, infected: false };
  const need = inp.quality === "verify" ? INFECTION_TIME_VERIFY_S : INFECTION_TIME_S;
  const next = progressS + inp.dtS;
  // Flyttalstolerans: 15 steg à 0,2 s ska räknas som 3,0 s.
  return { progressS: next, infected: next >= need - 1e-9 };
}
