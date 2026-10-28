/**
 * Spoken distance to the nearest zombie as it closes in, so the player knows how near it is without looking at the screen (field test, Bike).
 * Each step is said once when the zombie comes within it; only the nearest step crossed is said (no backlog when it jumps several at once).
 * A step is armed again only when the zombie has dropped back beyond it by a margin (hysteresis against GPS jitter).
 */
export const COUNTDOWN_M = [100, 50, 40, 30, 20, 10] as const;
export type CountdownStep = (typeof COUNTDOWN_M)[number];

/** The HUD distance is shown larger while the nearest zombie is within this distance (m). */
export const COUNTDOWN_START_M = COUNTDOWN_M[0];

/** Margin (m) the zombie must drop back beyond an announced step before that step can be said again. */
const rearmMarginM = (step: number): number => (step >= 100 ? 15 : 5);

/** Nearest step at or above the distance (the deepest step crossed), or null when farther than all steps. */
function stepFor(d: number): CountdownStep | null {
  let s: CountdownStep | null = null;
  for (const t of COUNTDOWN_M) if (d <= t) s = t;
  return s;
}

/**
 * Next countdown state. `last` = the last step said (null = none armed below the first step); `d` = nearest zombie distance (null = no
 * zombies or the match is not running). Returns the new state and the step to say now, if any.
 */
export function nextCountdown(last: CountdownStep | null, d: number | null): { last: CountdownStep | null; say: CountdownStep | null } {
  if (d === null) return { last: null, say: null };
  let cur = last;
  if (cur !== null && d > cur + rearmMarginM(cur)) cur = stepFor(d - rearmMarginM(cur)); // dropped back: re-arm the steps it is now beyond
  const s = stepFor(d);
  if (s !== null && (cur === null || s < cur)) return { last: s, say: s };
  return { last: cur, say: null };
}
