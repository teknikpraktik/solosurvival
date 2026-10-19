/** Distance (m) shown ahead of and behind the player in the bike view. */
export const BIKE_VIEW_AHEAD_M = 500;
/** Seconds the map stays where the user left it before it returns to the player (bike view). */
export const BIKE_VIEW_RETURN_S = 6;

/** Zoom level at which 2 × BIKE_VIEW_AHEAD_M spans the map height (MapLibre world size = 512 · 2^zoom px). */
export function bikeZoom(latDeg: number, heightPx: number): number {
  const mpp = (2 * BIKE_VIEW_AHEAD_M) / Math.max(200, heightPx);
  const z = Math.log2((40075016.686 * Math.cos((latDeg * Math.PI) / 180)) / (512 * mpp));
  return Math.min(18, Math.max(10, z));
}
