import type { Activity } from "@/config/activities";

/**
 * When the adult app's soundscape plays what (src/app/_client/audio.ts plays it). Pure rules on the game's own, visible information: the
 * nearest zombie distance is the number the HUD always shows, so no sound tells the player more than the screen does.
 * All distances and times are gathered here. The threat pulse (bursts within 300 m on foot / 600 m by bike) was removed after the field
 * test: the music plays more often in its place. The close-zombie layer that came after it (`prowl`) is single sounds, steps and
 * breathing, with silence between them, not a bed.
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
<<<<<<< HEAD
   * The close-zombie layer: while the nearest zombie is within 300 m (out again beyond 330 m). After the field test (short steps came too
   * often, were too loud and sounded like a child in a puddle; there was too little breathing):
   * - steps: one long, slow, dragging passage at a time (≈ 25 s), low; start to start ≈ 100 s at the edge of the range, ≈ 45 s at 50 m;
   * - breathing: the main sound, over the whole range; every ≈ 10 s at the edge (quiet), every ≈ 3 s at 50 m.
   * Pairs are [at the edge, at `nearM` and closer], with linear steps in between; gaps vary ±30 %. None within 4 s after the roar.
   * Both activities use the same distances, like the other close-zombie sounds since the field test.
   */
  prowl: {
    enterM: 300, exitM: 330, nearM: 50,
    steps: { gapS: [100, 45], gain: [0.15, 0.4], firstS: [3, 8] },
    breath: { gapS: [10, 3], gain: [0.3, 0.85], firstS: [4, 9] },
    jitter: 0.3, afterRoarS: 4, stepsFadeOutS: 2,
=======
   * The close-zombie layer: while the nearest zombie is within 300 m (out again beyond 330 m), a short sound now and then, more often and
   * louder the closer it is. Far: steps only, about every 20 s (±30 %) at a third of full level; at 50 m about every 4 s at 0.85.
   * Breathing joins the steps (half the sounds) from 150 m: you do not hear breath at 300 m. The first sound comes 2–5 s after entering,
   * and none within 4 s after the roar. Both activities use the same distances, like the other close-zombie sounds since the field test.
   */
  prowl: {
    enterM: 300, exitM: 330, breathM: 150,
    far: { gapS: 20, gain: 0.3 }, near: { atM: 50, gapS: 4, gain: 0.85 },
    jitter: 0.3, firstS: [2, 5] as readonly [number, number], afterRoarS: 4,
>>>>>>> origin/claude/amazing-bell-3cf4xs
  },
} as const;

export type ProwlKind = "steps" | "breath";
<<<<<<< HEAD
type Pair = readonly [number, number];
const lerp = (p: Pair, k: number) => p[0] + (p[1] - p[0]) * k;

/** One kind's own timing inside the range: due when its time has come; closing in never waits out a long gap chosen further away. */
class Pulse {
  private nextS: number | null = null;
  constructor(private readonly c: { gapS: Pair; gain: Pair; firstS: Pair }, private readonly jitter: number) {}
  update(tS: number, k: number, entered: boolean, random: () => number): number | null {
    const gap = lerp(this.c.gapS, k);
    if (entered || this.nextS === null) { this.nextS = tS + lerp(this.c.firstS, random()); return null; }
    this.nextS = Math.min(this.nextS, tS + gap * (1 + this.jitter));
    if (tS < this.nextS) return null;
    this.nextS = tS + gap * (1 - this.jitter + 2 * this.jitter * random());
    return lerp(this.c.gain, k);
  }
  reset(): void { this.nextS = null; }
}

/**
 * When the close-zombie layer makes its sounds, and at what level (0–1, on top of the mix). Feed it the nearest distance every second or
 * so; it returns the sounds that are due (steps and breathing keep their own time). `inside` says whether the range holds: a steps
 * passage still playing is faded out when it does not.
 */
export class Prowl {
  private on = false;
  private readonly steps: Pulse;
  private readonly breath: Pulse;

  constructor(private readonly r = SOUND_RULES.prowl) {
    this.steps = new Pulse(r.steps, r.jitter);
    this.breath = new Pulse(r.breath, r.jitter);
  }

  get inside(): boolean { return this.on; }

  /** 0 at the edge of the range, 1 at `nearM` and closer. */
  closeness(nearestM: number): number {
    return Math.max(0, Math.min(1, (this.r.enterM - nearestM) / (this.r.enterM - this.r.nearM)));
  }

  update(tS: number, nearestM: number | null, running: boolean, random: () => number): { kind: ProwlKind; gain: number }[] {
    if (!running || nearestM === null) { this.reset(); return []; }
    const was = this.on;
    this.on = was ? nearestM <= this.r.exitM : nearestM <= this.r.enterM;
    if (!this.on) { this.reset(); return []; }
    const k = this.closeness(nearestM);
    const out: { kind: ProwlKind; gain: number }[] = [];
    const s = this.steps.update(tS, k, !was, random);
    if (s !== null) out.push({ kind: "steps", gain: s });
    const b = this.breath.update(tS, k, !was, random);
    if (b !== null) out.push({ kind: "breath", gain: b });
    return out;
  }

  reset(): void { this.on = false; this.steps.reset(); this.breath.reset(); }
=======

/**
 * When the close-zombie layer makes a sound, and which kind at what level (0–1, on top of the mix). Feed it the nearest distance every
 * second or so; it returns a sound at most when one is due. Getting closer never waits out a long gap chosen further away.
 */
export class Prowl {
  private inside = false;
  private nextS: number | null = null;

  constructor(private readonly r = SOUND_RULES.prowl) {}

  /** 0 at the edge of the range, 1 at `near.atM` and closer. */
  closeness(nearestM: number): number {
    return Math.max(0, Math.min(1, (this.r.enterM - nearestM) / (this.r.enterM - this.r.near.atM)));
  }

  update(tS: number, nearestM: number | null, running: boolean, random: () => number): { kind: ProwlKind; gain: number } | null {
    if (!running || nearestM === null) { this.inside = false; this.nextS = null; return null; }
    const was = this.inside;
    this.inside = was ? nearestM <= this.r.exitM : nearestM <= this.r.enterM;
    if (!this.inside) { this.nextS = null; return null; }
    const k = this.closeness(nearestM);
    const gap = this.r.far.gapS + (this.r.near.gapS - this.r.far.gapS) * k;
    if (!was || this.nextS === null) { this.nextS = tS + this.r.firstS[0] + (this.r.firstS[1] - this.r.firstS[0]) * random(); return null; }
    this.nextS = Math.min(this.nextS, tS + gap * (1 + this.r.jitter));
    if (tS < this.nextS) return null;
    this.nextS = tS + gap * (1 - this.r.jitter + 2 * this.r.jitter * random());
    const kind: ProwlKind = nearestM <= this.r.breathM && random() < 0.5 ? "breath" : "steps";
    return { kind, gain: this.r.far.gain + (this.r.near.gain - this.r.far.gain) * k };
  }

  reset(): void { this.inside = false; this.nextS = null; }
>>>>>>> origin/claude/amazing-bell-3cf4xs
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
