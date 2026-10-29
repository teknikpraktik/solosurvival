import type { Activity } from "@/config/activities";

/**
 * Camera profile for AUTO (the game's map mode): Track Up, player a little below the middle of the screen (`playerY`), zoomed so that `aheadM`
 * is visible between the player and the top edge, closing in to `closeAheadM` when a zombie or the next goal is near and widening again when
 * it is gone or taken. With AUTO off (the player touched the map) the game leaves the map alone.
 */
export interface ViewProfile {
  /** Normal view: metres from the player to the top edge. */
  aheadM: number;
  /** Zoomed-in view (zombie or goal near): metres from the player to the top edge. */
  closeAheadM: number;
  /** Player's height on the screen as a fraction from the top (0.5 = middle). */
  playerY: number;
  /** Zoom in when the nearest zombie is within this distance (m)… */
  enterM: number;
  /** …and zoom out again only when it is farther than this (hysteresis, avoids flicker). */
  exitM: number;
  /** Zoom in when the next goal (checkpoint, home, B, extraction) is within this distance (m)… */
  goalEnterM: number;
  /** …and out again when it is farther than this, or taken (the next one is then far away). */
  goalExitM: number;
}

/** On foot is slower than Bike, so it needs fewer metres of view. */
const FOOT: ViewProfile = { aheadM: 400, closeAheadM: 150, playerY: 0.6, enterM: 100, exitM: 130, goalEnterM: 120, goalExitM: 160 };
const BIKE: ViewProfile = { aheadM: 1000, closeAheadM: 300, playerY: 0.6, enterM: 200, exitM: 260, goalEnterM: 250, goalExitM: 320 };

export const viewProfile = (a: Activity): ViewProfile => (a === "mtb" ? BIKE : FOOT);

/** Minimum seconds between two "tension" sounds. */
export const TENSION_COOLDOWN_S = 45;

/** "Zombies approaching" is spoken when the nearest zombie comes within this distance (m)… */
export const APPROACH_ENTER_M = 200;
/** …and is armed again only after it has been farther away than this (hysteresis), plus the cooldown below. */
export const APPROACH_EXIT_M = 260;
/** Minimum seconds between two spoken warnings. */
export const APPROACH_COOLDOWN_S = 30;

/** Next "a zombie is within warning range" state given the nearest zombie distance (null = no zombies). */
export function nextApproaching(prev: boolean, nearestM: number | null): boolean {
  if (nearestM === null) return false;
  return prev ? nearestM <= APPROACH_EXIT_M : nearestM <= APPROACH_ENTER_M;
}

/** Next zoomed-in state given the nearest zombie distance (null = no zombies). */
export function nextClose(prev: boolean, nearestM: number | null, v: ViewProfile): boolean {
  if (nearestM === null) return false;
  return prev ? nearestM <= v.exitM : nearestM <= v.enterM;
}

/** Next zoomed-in state given the distance to the next goal (null = no goal). */
export function nextGoalClose(prev: boolean, goalM: number | null, v: ViewProfile): boolean {
  if (goalM === null) return false;
  return prev ? goalM <= v.goalExitM : goalM <= v.goalEnterM;
}

/** Zoom level at which `aheadM` spans the part of the map above the player (`playerY` of the height; MapLibre world size = 512 · 2^zoom px). */
export function viewZoom(latDeg: number, heightPx: number, aheadM: number, playerY = 0.5): number {
  const mpp = aheadM / (playerY * Math.max(200, heightPx));
  const z = Math.log2((40075016.686 * Math.cos((latDeg * Math.PI) / 180)) / (512 * mpp));
  return Math.min(18, Math.max(10, z));
}
