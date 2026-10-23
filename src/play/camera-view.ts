import type { Activity } from "@/config/activities";

/** Camera profile: player centred, Track Up; zoomed so that `aheadM` is visible ahead of AND behind the player (top/bottom edge). */
export interface ViewProfile {
  /** Normal view: metres ahead of and behind the player. */
  aheadM: number;
  /** Zoomed-in view (zombies close): metres ahead of and behind the player. */
  closeAheadM: number;
  /** Whether the map zooms in to `closeAheadM` when a zombie is close (the "close" state still drives the tension sound either way). */
  autoZoom: boolean;
  /** Zoom in when the nearest zombie is within this distance (m)… */
  enterM: number;
  /** …and zoom out again only when it is farther than this (hysteresis, avoids flicker). */
  exitM: number;
}

/** On foot is slower than Bike, so it needs fewer metres of view. On foot the view never zooms in automatically. */
const FOOT: ViewProfile = { aheadM: 400, closeAheadM: 150, autoZoom: false, enterM: 100, exitM: 130 };
const BIKE: ViewProfile = { aheadM: 1000, closeAheadM: 300, autoZoom: true, enterM: 200, exitM: 260 };

export const viewProfile = (a: Activity): ViewProfile => (a === "mtb" ? BIKE : FOOT);

/** Minimum seconds between two "tension" sounds. */
export const TENSION_COOLDOWN_S = 45;
/** Seconds the map stays where the user left it before it returns to the player (position only: a zoom the user set is kept until they tap centre). */
export const VIEW_RETURN_S = 15;

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

/** Zoom level at which 2 × aheadM spans the map height (MapLibre world size = 512 · 2^zoom px). */
export function viewZoom(latDeg: number, heightPx: number, aheadM: number): number {
  const mpp = (2 * aheadM) / Math.max(200, heightPx);
  const z = Math.log2((40075016.686 * Math.cos((latDeg * Math.PI) / 180)) / (512 * mpp));
  return Math.min(18, Math.max(10, z));
}
