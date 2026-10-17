import { haversineM, type LatLon } from "@/geo/geometry";
import type { GpsQuality } from "@/gps/types";

export type GameMode = "survival" | "escape" | "mission";

/** Aktiveringsradie och bekräftelsetid enligt etapp 2.5 (samma som extraction i Survival). */
export const OBJECTIVE_RADIUS_M = 30;
export const OBJECTIVE_HOLD_S = 5;
/** Inga zombier spawnar så här nära ett checkpoint eller en destination (undviker orättvis camping). */
export const OBJECTIVE_SPAWN_EXCLUSION_M = 150;

export interface ObjectiveTarget {
  id: string;
  kind: "destination" | "checkpoint" | "home";
  lat: number;
  lon: number;
  nodeId?: string;
}

/**
 * Gemensam målmodell för Escape (en destination) och Mission (ordnade checkpoints + hemkomst).
 * Målen besöks i ordning; ett senare mål kan inte klaras före de tidigare, även om spelaren står där (t.ex. hemma vid start).
 */
export interface ObjectiveSet {
  targets: ObjectiveTarget[];
  /** Index för aktivt mål; == targets.length när allt är klart. */
  index: number;
  holdS: number;
  radiusM: number;
  /** Spelklocka (s) då respektive mål bekräftades. */
  reachedAtS: number[];
}

export function createObjectives(targets: ObjectiveTarget[], radiusM = OBJECTIVE_RADIUS_M): ObjectiveSet {
  return { targets, index: 0, holdS: 0, radiusM, reachedAtS: [] };
}

export const activeTarget = (o: ObjectiveSet): ObjectiveTarget | undefined => o.targets[o.index];

export interface ObjectiveUpdate {
  reached?: ObjectiveTarget;
  completed: boolean;
}

/**
 * Bekräftelse bygger på position med godkänd noggrannhet (ok/verify). Utanför radien nollställs bekräftelsen;
 * vid otillförlitlig GPS hålls den kvar utan att räknas (samma princip som infektion).
 */
export function updateObjectives(o: ObjectiveSet, pos: LatLon, quality: GpsQuality, dtS: number, nowS: number): ObjectiveUpdate {
  const t = activeTarget(o);
  if (!t) return { completed: true };
  if (quality !== "ok" && quality !== "verify") return { completed: false };
  if (haversineM(pos, t) > o.radiusM) {
    o.holdS = 0;
    return { completed: false };
  }
  o.holdS += dtS;
  if (o.holdS < OBJECTIVE_HOLD_S - 1e-9) return { completed: false };
  o.holdS = 0;
  o.index++;
  o.reachedAtS.push(nowS);
  return { reached: t, completed: o.index >= o.targets.length };
}
