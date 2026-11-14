import type { Activity } from "@/config/activities";
import { viewProfile } from "./camera-view";

/**
 * When the adult app's soundscape plays what (src/app/_client/audio.ts plays it). Pure rules on the game's own, visible information: the
 * nearest zombie distance is the number the HUD always shows, so no sound tells the player more than the screen does.
 * All distances and times are gathered here.
 */
export const SOUND_RULES = {
  threat: {
    /**
     * A threat period starts when the nearest zombie stays within `onM` for `enterDwellS`, and ends when it has stayed beyond `offM` for
     * `exitDwellS` (and the period has lasted `minOnS`). Widened after the field test so the pulse is heard more often: on foot 300 m
     * (≈ 100 s of head-on closing at a walk against a Normal zombie, 5.6 km/h), on Bike 600 m because both move faster (player ≈ 16 km/h,
     * zombie 7.8–13.4 km/h: ≈ 85–100 s head-on). It still follows only the nearest-zombie distance the HUD shows.
     */
    byActivity: { walk: { onM: 300, offM: 380 }, mtb: { onM: 600, offM: 750 } } as Partial<Record<Activity, { onM: number; offM: number }>>,
    enterDwellS: 2,
    exitDwellS: 8,
    minOnS: 12,
    /** Calm after a period: a new one waits this long, unless a zombie is already in the close range (where the map zooms in). */
    quietGapS: 8,
    fadeInS: 2.5,
    fadeOutS: 4,
    /** Pause, match end or the app in the background: out quickly. */
    stopFadeS: 1.2,
    /**
     * Within a threat period the pulse comes in bursts of random length with random silences between (field test: a steady pulse wore
     * off). Each burst is a new random variant, never the one just heard; only one burst sounds at a time (a silence is longer than the
     * fade-out). Ranges in seconds.
     */
    burstS: [6, 14] as const,
    restS: [3, 8] as const,
    burstFadeInS: 1.5,
    burstFadeOutS: 2.5,
  },
  /**
   * After the field test, two steps for both activities: at 200 m the operator's "Zombies approaching!" (out again beyond 260 m), at 100 m
   * the zombies' roar (out again beyond 130 m). Each once per approach, with a cooldown and a cap per match.
   */
  approach: { enterM: 200, exitM: 260, cooldownS: 45, maxPerMatch: 8 },
  near: { enterM: 100, exitM: 130, cooldownS: 45, maxPerMatch: 8 },
  /** "Position revealed": at most this often. */
  revealed: { cooldownS: 60 },
  heli: { loopFadeInS: 3, approachFadeOutS: 3, loopStopS: 0.8 },
} as const;

const DEFAULT_RANGE = { onM: 300, offM: 380 };
export const threatRange = (a: Activity) => SOUND_RULES.threat.byActivity[a] ?? DEFAULT_RANGE;

/** A random value in [min, max]. */
export const between = ([min, max]: readonly [number, number], random: () => number): number => min + (max - min) * random();

/** A random variant index in [0, n) that is never `prev` (when there is more than one). */
export function pickVariant(prev: number | null, n: number, random: () => number): number {
  if (n <= 1) return 0;
  if (prev === null || prev < 0 || prev >= n) return Math.min(n - 1, Math.floor(random() * n));
  const i = Math.min(n - 2, Math.floor(random() * (n - 1)));
  return i >= prev ? i + 1 : i;
}

export type ThreatAction = { start: number } | { stop: "fade" | "quick" } | null;

/**
 * One threat pulse at a time, with hysteresis and dwell so GPS jitter near a limit does not toggle it. `update` is called with the
 * current time (s) and returns what to do now: start a variant, stop it, or nothing.
 */
export class ThreatGate {
  private on = false;
  private onSince = 0;
  private armSince: number | null = null;
  private exitSince: number | null = null;
  private lastOffAt = -Infinity;
  private variant: number | null = null;

  constructor(private readonly variants: number, private readonly random: () => number = Math.random) {}

  get active(): boolean { return this.on; }
  get current(): number | null { return this.on ? this.variant : null; }

  /** `running` = a match is being played now (not paused, not finished, app in front); `nearestM` null = no zombies. */
  update(tS: number, nearestM: number | null, activity: Activity, running: boolean): ThreatAction {
    const R = SOUND_RULES.threat;
    if (!running || nearestM === null) {
      this.armSince = null;
      this.exitSince = null;
      if (!this.on) return null;
      this.on = false;
      return { stop: "quick" };
    }
    const { onM, offM } = threatRange(activity);
    if (!this.on) {
      this.exitSince = null;
      if (nearestM > onM) { this.armSince = null; return null; }
      this.armSince ??= tS;
      const close = nearestM <= viewProfile(activity).enterM;
      if (tS - this.armSince < R.enterDwellS || (!close && tS - this.lastOffAt < R.quietGapS)) return null;
      this.on = true;
      this.onSince = tS;
      this.armSince = null;
      this.variant = pickVariant(this.variant, this.variants, this.random);
      return { start: this.variant };
    }
    if (nearestM <= offM) { this.exitSince = null; return null; }
    this.exitSince ??= tS;
    if (tS - this.exitSince < R.exitDwellS || tS - this.onSince < R.minOnS) return null;
    this.on = false;
    this.exitSince = null;
    this.lastOffAt = tS;
    return { stop: "fade" };
  }

  /** A new match: forget everything except which variant was heard last (so it does not open the next match too). */
  reset(): void {
    this.on = false;
    this.armSince = null;
    this.exitSince = null;
    this.lastOffAt = -Infinity;
  }
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
