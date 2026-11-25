import type { Activity } from "@/config/activities";

/**
 * When the adult app's soundscape plays what (src/app/_client/audio.ts plays it). Pure rules on the game's own, visible information: the
 * nearest zombie distance is the number the HUD always shows, so no sound tells the player more than the screen does.
 * All distances and times are gathered here. The threat pulse (bursts within 300 m on foot / 600 m by bike) was removed after the field
 * test: the music plays more often in its place. The close-zombie layer that came after it (`prowl`) is long takes of breathing (within
 * 300 m) and dragging steps (within 100 m), one of each at a time, with pauses between them.
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
  /** A new infected joins the game (someone has been bitten): a scream, at most this often. (The jump scare itself is silent.) */
  infected: { cooldownS: 20 },
  heli: { loopFadeInS: 3, approachFadeOutS: 3, loopStopS: 0.8 },
  /**
   * The close-zombie layer. After field test 3 (2026-11-25: the breathing was good but too short; steps should mean "close"):
   * - breathing: one long take at a time (20–30 s), while the nearest zombie is within 300 m (out beyond 330 m); start to start ≈ 45 s
   *   at the edge (a pause of 15–25 s after a take) and ≈ 28 s at 50 m (almost back to back); a little quieter than before;
   * - steps: one long, slow, dragging passage at a time (≈ 25 s), only within 100 m (out beyond 130 m); start to start ≈ 40 s at
   *   100 m, ≈ 30 s at 30 m and closer.
   * Pairs are [at the edge of the kind's range, at its `nearM` and closer], linear in between; gaps vary ±`jitter`. A sound that is due
   * while its previous take still plays, or within 4 s after the roar, waits and starts as soon as it may. Leaving a kind's range fades
   * its take out. Both activities use the same distances, like the other close-zombie sounds since the field test.
   */
  prowl: {
    breath: { enterM: 300, exitM: 330, nearM: 50, gapS: [45, 28], gain: [0.25, 0.6], firstS: [3, 8] },
    steps: { enterM: 100, exitM: 130, nearM: 30, gapS: [40, 30], gain: [0.25, 0.45], firstS: [5, 9] },
    jitter: 0.2, afterRoarS: 4, fadeOutS: 2,
  },
} as const;

export type ProwlKind = "steps" | "breath";
type Pair = readonly [number, number];
const lerp = (p: Pair, k: number) => p[0] + (p[1] - p[0]) * k;
type PulseRule = { enterM: number; exitM: number; nearM: number; gapS: Pair; gain: Pair; firstS: Pair };

/**
 * One kind's own range and timing. Due when its time has come; closing in never waits out a long gap chosen further away; a due sound
 * that is held (its previous take still playing, the roar just heard) stays due and starts as soon as it is let go.
 */
class Pulse {
  private nextS: number | null = null;
  on = false;
  constructor(private readonly c: PulseRule, private readonly jitter: number) {}

  /** 0 at the edge of the range, 1 at `nearM` and closer. */
  closeness(d: number): number { return Math.max(0, Math.min(1, (this.c.enterM - d) / (this.c.enterM - this.c.nearM))); }

  update(tS: number, d: number, held: boolean, random: () => number): number | null {
    const was = this.on;
    this.on = was ? d <= this.c.exitM : d <= this.c.enterM;
    if (!this.on) { this.nextS = null; return null; }
    const k = this.closeness(d);
    const gap = lerp(this.c.gapS, k);
    if (!was || this.nextS === null) { this.nextS = tS + lerp(this.c.firstS, random()); return null; }
    this.nextS = Math.min(this.nextS, tS + gap * (1 + this.jitter));
    if (tS < this.nextS || held) return null;
    this.nextS = tS + gap * (1 - this.jitter + 2 * this.jitter * random());
    return lerp(this.c.gain, k);
  }
  reset(): void { this.on = false; this.nextS = null; }
}

/**
 * When the close-zombie layer makes its sounds, and at what level (0–1, on top of the mix). Feed it the nearest distance every second or
 * so, with the kinds that are held right now (a take still playing, the roar just heard); it returns the sounds that are due. `inside`
 * says whether a kind's range holds: a take still playing is faded out when it does not.
 */
export class Prowl {
  private readonly pulses: Record<ProwlKind, Pulse>;

  constructor(r = SOUND_RULES.prowl) {
    this.pulses = { breath: new Pulse(r.breath, r.jitter), steps: new Pulse(r.steps, r.jitter) };
  }

  inside(kind: ProwlKind): boolean { return this.pulses[kind].on; }

  update(tS: number, nearestM: number | null, running: boolean, random: () => number, held: (kind: ProwlKind) => boolean = () => false): { kind: ProwlKind; gain: number }[] {
    if (!running || nearestM === null) { this.reset(); return []; }
    const out: { kind: ProwlKind; gain: number }[] = [];
    for (const kind of ["steps", "breath"] as const) {
      const g = this.pulses[kind].update(tS, nearestM, held(kind), random);
      if (g !== null) out.push({ kind, gain: g });
    }
    return out;
  }

  reset(): void { this.pulses.breath.reset(); this.pulses.steps.reset(); }
}

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
