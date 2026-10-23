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
  /** Antal olika GPS-fixar som hittills räknats under pågående bekräftelse (bara när fixSeq anges). */
  holdFixes?: number;
  lastFixSeq?: number;
}

/** Minsta antal olika GPS-fixar under bekräftelsen, så att en enstaka (dålig) fix aldrig kan registrera ett mål. */
export const OBJECTIVE_MIN_FIXES = 3;
/** Om fixens osäkerhet överlappar gränsen (verify: 10–20 m) krymps radien med osäkerheten över okM. Preliminärt; kräver fälttest. */
export const VERIFY_OK_ACCURACY_M = 10;

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
export interface ObjectiveFixInfo {
  accuracyM?: number;
  /** Löpnummer för senaste mottagna GPS-fix. Utelämnas i simuleringar utan riktiga fixar. */
  fixSeq?: number;
}

export function updateObjectives(o: ObjectiveSet, pos: LatLon, quality: GpsQuality, dtS: number, nowS: number, fix: ObjectiveFixInfo = {}): ObjectiveUpdate {
  const t = activeTarget(o);
  if (!t) return { completed: true };
  if (quality !== "ok" && quality !== "verify") return { completed: false };
  // Vid "verify" kan sanna positionen ligga upp till accuracyM från den rapporterade: kräv marginal.
  const shrink = quality === "verify" && fix.accuracyM !== undefined ? Math.max(0, fix.accuracyM - VERIFY_OK_ACCURACY_M) : 0;
  if (haversineM(pos, t) > o.radiusM - shrink) {
    o.holdS = 0;
    o.holdFixes = 0;
    return { completed: false };
  }
  if (fix.fixSeq !== undefined && fix.fixSeq !== o.lastFixSeq) {
    o.lastFixSeq = fix.fixSeq;
    o.holdFixes = (o.holdFixes ?? 0) + 1;
  }
  o.holdS += dtS;
  if (o.holdS < OBJECTIVE_HOLD_S - 1e-9) return { completed: false };
  if (fix.fixSeq !== undefined && (o.holdFixes ?? 0) < OBJECTIVE_MIN_FIXES) return { completed: false };
  o.holdS = 0;
  o.holdFixes = 0;
  o.index++;
  o.reachedAtS.push(nowS);
  return { reached: t, completed: o.index >= o.targets.length };
}

/**
 * Enda källan för hur långt spelaren har kommit, så att HUD, resultatdialog och historik alltid visar samma tal.
 * - "Primära" mål är checkpoints (Mission) eller destinationen (A TO B). Hemkomsten räknas aldrig som ett checkpoint.
 * - `stage` är vad spelaren ska göra nu: nästa checkpoint, nå destinationen, ta sig hem, eller klart.
 */
export interface ObjectiveProgress {
  primaryReached: number;
  primaryTotal: number;
  stage: "checkpoint" | "destination" | "home" | "done";
  homeReached: boolean;
  hasHome: boolean;
}

export function objectiveProgress(o: ObjectiveSet): ObjectiveProgress {
  const primaryTotal = o.targets.filter((t) => t.kind !== "home").length;
  const reached = o.targets.slice(0, Math.min(o.index, o.targets.length));
  const next = o.targets[o.index];
  return {
    primaryReached: reached.filter((t) => t.kind !== "home").length,
    primaryTotal,
    stage: !next ? "done" : next.kind === "home" ? "home" : next.kind === "destination" ? "destination" : "checkpoint",
    homeReached: reached.some((t) => t.kind === "home"),
    hasHome: o.targets.some((t) => t.kind === "home"),
  };
}
