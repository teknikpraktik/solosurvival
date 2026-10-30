import { wrap180 } from "./heading";

/** Tidskonstant (s) för kartans rotation: kort nog att kännas direkt, lång nog att jämna ut brus. */
export const BEARING_TAU_S = 0.22;
/** Time constant (s) while the compass turns the map: it is already filtered (play/heading.ts), so this only rounds off frame steps. */
export const BEARING_COMPASS_TAU_S = 0.05;
/** Högsta rotationshastighet (grader/s), så att en U-sväng aldrig snurrar kartan okontrollerat. */
export const BEARING_MAX_DEG_PER_S = 720;
/** Under detta avstånd (grader) till målet räknas rotationen som klar. */
export const BEARING_SETTLED_DEG = 0.15;

/**
 * Mjuk rotation mot en målvinkel (kortaste vägen, utan hopp över 360). Oberoende av bildfrekvens: samma resultat vid 30 och 60 fps.
 * `value` är den utrullade (ej normaliserade) vinkeln så att kartmotorn aldrig animerar "åt fel håll".
 */
export class BearingSmoother {
  value: number;
  target: number;
  constructor(initial = 0, private readonly tauS = BEARING_TAU_S, private readonly maxDegPerS = BEARING_MAX_DEG_PER_S) {
    this.value = initial;
    this.target = initial;
  }
  setTarget(deg: number): void {
    this.target = this.value + wrap180(deg - this.value);
  }
  /** Flyttar `dtS` sekunder framåt. Returnerar sant om vinkeln ändrades märkbart. */
  /** `tauS` overrides the time constant for this step (the compass is already filtered and should be followed almost directly). */
  step(dtS: number, tauS = this.tauS): boolean {
    const delta = this.target - this.value;
    if (Math.abs(delta) < BEARING_SETTLED_DEG) {
      const changed = this.value !== this.target;
      this.value = this.target;
      return changed;
    }
    const k = 1 - Math.exp(-Math.max(0, dtS) / tauS);
    const max = this.maxDegPerS * Math.max(0, dtS);
    const move = Math.sign(delta) * Math.min(Math.abs(delta) * k, max);
    this.value += move;
    return move !== 0;
  }
  get settled(): boolean {
    return Math.abs(this.target - this.value) < BEARING_SETTLED_DEG;
  }
}
