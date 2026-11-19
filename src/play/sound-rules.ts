import type { Activity } from "@/config/activities";

/**
 * When the adult app's soundscape plays what (src/app/_client/audio.ts plays it). Pure rules on the game's own, visible information: the
 * nearest zombie distance is the number the HUD always shows, so no sound tells the player more than the screen does.
 * All distances and times are gathered here. The threat pulse (bursts within 300 m on foot / 600 m by bike) was removed after the field
 * test: the music plays more often in its place.
 */
export const SOUND_RULES = {
  /**
   * After the field test, two steps for both activities: at 200 m the operator's "Zombies approaching!" (out again beyond 260 m), at 100 m
   * the zombies' roar (out again beyond 130 m). Each once per approach, with a cooldown and a cap per match.
   */
  approach: { enterM: 200, exitM: 260, cooldownS: 45, maxPerMatch: 8 },
  near: { enterM: 100, exitM: 130, cooldownS: 45, maxPerMatch: 8 },
  /** "Position revealed": at most this often. */
  revealed: { cooldownS: 60 },
  /** A sprinting zombie's roar is skipped when the roar was heard within this time; the contact sting comes at most this often. */
  sprint: { afterRoarS: 8 },
  contact: { cooldownS: 10 },
  heli: { loopFadeInS: 3, approachFadeOutS: 3, loopStopS: 0.8 },
} as const;

/** A random variant index in [0, n) that is never `prev` (when there is more than one). */
export function pickVariant(prev: number | null, n: number, random: () => number): number {
  if (n <= 1) return 0;
  if (prev === null || prev < 0 || prev >= n) return Math.min(n - 1, Math.floor(random() * n));
  const i = Math.min(n - 2, Math.floor(random() * (n - 1)));
  return i >= prev ? i + 1 : i;
}

/**
 * A zombie within a distance: once on entering it (with hysteresis), with a cooldown and a cap per match. The default is the close range
 * (100 m, the roar); `SOUND_RULES.approach` gives the 200 m step ("Zombies approaching!").
 */
export class NearGate {
  private inside = false;
  private last = -Infinity;
  private count = 0;

  constructor(private readonly r: { enterM: number; exitM: number; cooldownS: number; maxPerMatch: number } = SOUND_RULES.near) {}

  /** `activity` is kept for the call sites; both activities use the same distances since the field test. */
  update(tS: number, nearestM: number | null, _activity: Activity, running: boolean): boolean {
    if (!running || nearestM === null) { this.inside = false; return false; }
    const was = this.inside;
    this.inside = was ? nearestM <= this.r.exitM : nearestM <= this.r.enterM;
    if (!this.inside || was) return false;
    if (tS - this.last < this.r.cooldownS || this.count >= this.r.maxPerMatch) return false;
    this.last = tS;
    this.count++;
    return true;
  }

  reset(): void { this.inside = false; this.last = -Infinity; this.count = 0; }
}

/** At most once per `cooldownS`. */
export class Cooldown {
  private last = -Infinity;
  constructor(private readonly cooldownS: number) {}
  take(tS: number): boolean {
    if (tS - this.last < this.cooldownS) return false;
    this.last = tS;
    return true;
  }
  reset(): void { this.last = -Infinity; }
}
