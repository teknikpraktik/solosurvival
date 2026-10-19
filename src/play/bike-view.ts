/** Distance (m) shown ahead of and behind the player in the normal bike view. */
export const BIKE_VIEW_AHEAD_M = 1000;
/** Distance (m) shown ahead of the player when zombies are close (zoomed in). */
export const BIKE_VIEW_CLOSE_AHEAD_M = 300;
/** Zoom in when the nearest zombie is within this distance (m)… */
export const BIKE_CLOSE_ENTER_M = 200;
/** …and zoom out again only when it is farther than this (hysteresis, avoids flicker). */
export const BIKE_CLOSE_EXIT_M = 260;
/** Minimum seconds between two "tension" sounds. */
export const BIKE_TENSION_COOLDOWN_S = 45;
/** Seconds the map stays where the user left it before it returns to the player (bike view). */
export const BIKE_VIEW_RETURN_S = 6;

/** Next zoomed-in state given the nearest zombie distance (null = no zombies). */
export function nextBikeClose(prev: boolean, nearestM: number | null): boolean {
  if (nearestM === null) return false;
  return prev ? nearestM <= BIKE_CLOSE_EXIT_M : nearestM <= BIKE_CLOSE_ENTER_M;
}

/** Zoom level at which 2 × aheadM spans the map height (MapLibre world size = 512 · 2^zoom px). */
export function bikeZoom(latDeg: number, heightPx: number, aheadM: number = BIKE_VIEW_AHEAD_M): number {
  const mpp = (2 * aheadM) / Math.max(200, heightPx);
  const z = Math.log2((40075016.686 * Math.cos((latDeg * Math.PI) / 180)) / (512 * mpp));
  return Math.min(18, Math.max(10, z));
}
