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
     * `exitDwellS` (and the period has lasted `minOnS`). On foot `onM` is the distance where "Zombies approaching" is already spoken
     * (200 m ≈ 70 s of head-on closing at a walk against a Normal zombie, 5.6 km/h); Bike doubles it because both move faster
     * (player ≈ 16 km/h, zombie 7.8–13.4 km/h: 400 m ≈ 55–65 s head-on).
     */
    byActivity: { walk: { onM: 200, offM: 260 }, mtb: { onM: 400, offM: 500 } } as Partial<Record<Activity, { onM: number; offM: number }>>,
    enterDwellS: 3,
    exitDwellS: 10,
    minOnS: 12,
    /** Calm after a period: a new one waits this long, unless a zombie is already in the close range (where the map zooms in). */
    quietGapS: 20,
    fadeInS: 2.5,
    fadeOutS: 4,
    /** Pause, match end or the app in the background: out quickly. */
    stopFadeS: 1.2,
  },
  /** Zombie at close range (the distance where the map zooms in: 100 m on foot, 200 m on Bike; out again beyond 130 / 260 m). */
  near: { cooldownS: 45, maxPerMatch: 8 },
  /** "Position revealed": at most this often. */
  revealed: { cooldownS: 60 },
  radio: {
    /** The radio click comes before the operator's voice; the voice starts this long after it. */
    leadMs: 450,
    /** After a spoken line the channel counts as open this long: the next line comes without a new click. */
    channelOpenS: 8,
    /** A delayed line later than this (the phone was busy or in the background) is dropped, not said late. */
    maxLateMs: 1500,
  },
  heli: { loopFadeInS: 3, approachFadeOutS: 3, loopStopS: 0.8 },
} as const;

const DEFAULT_RANGE = { onM: 200, offM: 260 };
export const threatRange = (a: Activity) => SOUND_RULES.threat.byActivity[a] ?? DEFAULT_RANGE;

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

/** Zombie at close range: once on entering the range (hysteresis as the map's zoom), with a cooldown and a cap per match. */
export class NearGate {
  private inside = false;
  private last = -Infinity;
  private count = 0;

  update(tS: number, nearestM: number | null, activity: Activity, running: boolean): boolean {
    if (!running || nearestM === null) { this.inside = false; return false; }
    const v = viewProfile(activity);
    const was = this.inside;
    this.inside = was ? nearestM <= v.exitM : nearestM <= v.enterM;
    if (!this.inside || was) return false;
    if (tS - this.last < SOUND_RULES.near.cooldownS || this.count >= SOUND_RULES.near.maxPerMatch) return false;
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
