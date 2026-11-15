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
  /** Time (s) the player must stay inside the radius to confirm this target. Missing = OBJECTIVE_HOLD_S. */
  holdS?: number;
  /** Activation radius (m) for this target. Missing = the set's radius. */
  radiusM?: number;
  /**
   * A long hold (signal transmission): leaving the zone pauses the progress instead of resetting it, and the zone has a margin on the
   * way out (TRANSMIT_EXIT_MARGIN_M) so GPS noise at the edge does not flicker between holding and paused.
   */
  keepProgress?: boolean;
}

/** A player holding a `keepProgress` target counts as inside until this far beyond its radius (m). */
export const TRANSMIT_EXIT_MARGIN_M = 10;

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
  /** Checkpoints may be taken in any order: the nearest remaining one is always the active target. Missing = in the given order. */
  anyOrder?: boolean;
  /** The player is inside the active `keepProgress` target's zone and the hold is counting (or waiting for reliable GPS). */
  holding?: boolean;
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
  /** A `keepProgress` target only: the hold began, was paused (the player left the zone) or resumed. */
  hold?: "started" | "paused" | "resumed";
}

/** Seconds needed inside the zone of a target. */
export const holdNeedS = (t: Pick<ObjectiveTarget, "holdS">): number => t.holdS ?? OBJECTIVE_HOLD_S;

/** Any order: the nearest remaining checkpoint becomes the active target (a hold in progress on another one starts over). */
function activateNearest(o: ObjectiveSet, pos: LatLon): void {
  let best = -1, bd = Infinity;
  for (let i = o.index; i < o.targets.length; i++) {
    if (o.targets[i].kind !== "checkpoint") break; // home / destination always come after the checkpoints
    const d = haversineM(pos, o.targets[i]);
    if (d < bd) { bd = d; best = i; }
  }
  if (best <= o.index) return;
  const a = o.targets[o.index];
  o.targets[o.index] = o.targets[best];
  o.targets[best] = a;
  o.holdS = 0;
  o.holdFixes = 0;
  o.holding = false;
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
  if (!activeTarget(o)) return { completed: true };
  if (quality !== "ok" && quality !== "verify") return { completed: false };
  if (o.anyOrder) activateNearest(o, pos);
  const t = activeTarget(o)!;
  // Vid "verify" kan sanna positionen ligga upp till accuracyM från den rapporterade: kräv marginal.
  const shrink = quality === "verify" && fix.accuracyM !== undefined ? Math.max(0, fix.accuracyM - VERIFY_OK_ACCURACY_M) : 0;
  const radius = t.radiusM ?? o.radiusM;
  const d = haversineM(pos, t);
  if (t.keepProgress) {
    // Signal transmission: inside counts with the same care as any target; once holding, the player stays "inside" a little beyond the edge.
    const inside = o.holding ? d <= radius + TRANSMIT_EXIT_MARGIN_M : d <= radius - shrink;
    if (!inside) {
      if (!o.holding) return { completed: false };
      o.holding = false;
      return { completed: false, hold: "paused" };
    }
    let hold: ObjectiveUpdate["hold"];
    if (!o.holding) { o.holding = true; hold = o.holdS > 0 ? "resumed" : "started"; }
    if (fix.fixSeq !== undefined && fix.fixSeq !== o.lastFixSeq) {
      o.lastFixSeq = fix.fixSeq;
      o.holdFixes = (o.holdFixes ?? 0) + 1;
    }
    o.holdS += dtS;
    if (o.holdS < holdNeedS(t) - 1e-9) return { completed: false, hold };
    if (fix.fixSeq !== undefined && (o.holdFixes ?? 0) < OBJECTIVE_MIN_FIXES) return { completed: false, hold };
    o.holding = false;
  } else {
    if (d > radius - shrink) {
      o.holdS = 0;
      o.holdFixes = 0;
      return { completed: false };
    }
    if (fix.fixSeq !== undefined && fix.fixSeq !== o.lastFixSeq) {
      o.lastFixSeq = fix.fixSeq;
      o.holdFixes = (o.holdFixes ?? 0) + 1;
    }
    o.holdS += dtS;
    if (o.holdS < holdNeedS(t) - 1e-9) return { completed: false };
    if (fix.fixSeq !== undefined && (o.holdFixes ?? 0) < OBJECTIVE_MIN_FIXES) return { completed: false };
  }
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
