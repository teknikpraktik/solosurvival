import { describe, expect, it } from "vitest";
import { Cooldown, NearGate, Prowl, SOUND_RULES, pickVariant } from "@/play/sound-rules";

describe("no threat pulse", () => {
  it("the threat pulse rules are gone (field test: the music plays more often instead)", () => {
    expect("threat" in SOUND_RULES).toBe(false);
  });
});

describe("variants", () => {
  it("pickVariant never repeats and covers every variant", () => {
    const seen = new Set<number>();
    let prev: number | null = null;
    for (let k = 0; k < 200; k++) {
      const v = pickVariant(prev, 4, Math.random);
      expect(v).not.toBe(prev);
      seen.add(v);
      prev = v;
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    expect(pickVariant(0, 1, Math.random)).toBe(0);
  });
});

describe("close zombie and cooldown rules", () => {
  it("close zombie: once per approach into the close range, with cooldown and a cap per match", () => {
    const g = new NearGate();
    const plays: number[] = [];
    // A zombie hovering around 100 m: the hysteresis (out beyond 130 m) gives one sound, not one per wobble.
    for (let t = 0; t < 30; t++) if (g.update(t, t % 2 ? 95 : 110, "walk", true)) plays.push(t);
    expect(plays).toEqual([1]); // 110 m at t = 0 is not yet close
    // Away and back within the cooldown: no sound; after it: a sound.
    g.update(31, 200, "walk", true);
    expect(g.update(32, 90, "walk", true)).toBe(false);
    g.update(50, 200, "walk", true);
    expect(g.update(SOUND_RULES.near.cooldownS + 1, 90, "walk", true)).toBe(true);
    // Cap per match.
    const h = new NearGate();
    let n = 0;
    for (let k = 0; k < 40; k++) { h.update(k * 100, 300, "walk", true); if (h.update(k * 100 + 1, 50, "walk", true)) n++; }
    expect(n).toBe(SOUND_RULES.near.maxPerMatch);
    h.reset();
    expect(h.update(0, 50, "walk", true)).toBe(true);
  });

  it("many zombies make one sound: the rule follows the nearest distance only", () => {
    const g = new NearGate();
    expect(g.update(0, 40, "walk", true)).toBe(true);
    expect(g.update(1, 20, "walk", true)).toBe(false);
    expect(g.update(2, 60, "walk", false)).toBe(false); // paused
  });

  it("Cooldown", () => {
    const c = new Cooldown(60);
    expect(c.take(0)).toBe(true);
    expect(c.take(59)).toBe(false);
    expect(c.take(60)).toBe(true);
  });
});

describe("close-range steps after the field test", () => {
  it("the same distances on foot and by bike: roar at 100 m (out beyond 130), warning at 200 m (out beyond 260)", () => {
    expect([SOUND_RULES.near.enterM, SOUND_RULES.near.exitM, SOUND_RULES.approach.enterM, SOUND_RULES.approach.exitM]).toEqual([100, 130, 200, 260]);
    const bike = new NearGate();
    expect(bike.update(0, 150, "mtb", true)).toBe(false); // 150 m by bike: no roar any more
    expect(bike.update(1, 99, "mtb", true)).toBe(true);
    const warn = new NearGate(SOUND_RULES.approach);
    expect(warn.update(0, 199, "walk", true)).toBe(true);
  });
});

describe("close-zombie layer (breathing and steps within 300 m)", () => {
  type Hit = { t: number; kind: string; gain: number };
  /** Feeds one distance per second for `secs` s; returns the sounds with their time. `busyS`: how long each take holds its kind. */
  const feed = (p: Prowl, from: number, secs: number, d: number | null, random = () => 0.5, running = true, busyS = 0): Hit[] => {
    const out: Hit[] = [];
    const until: Record<string, number> = {};
    for (let t = from; t < from + secs; t++) {
      for (const r of p.update(t, d, running, random, (k) => (until[k] ?? -1) > t)) { out.push({ t, ...r }); until[r.kind] = t + busyS; }
    }
    return out;
  };
  const of = (h: Hit[], kind: string) => h.filter((x) => x.kind === kind);
  const gaps = (h: Hit[]) => h.slice(1).map((x, i) => x.t - h[i].t);
  const R = SOUND_RULES.prowl;

  it("nothing beyond 300 m; at the edge a steps passage about every 45 s and breathing about every 50 s, both quiet", () => {
    expect([R.steps.enterM, R.steps.exitM, R.breath.enterM, R.breath.exitM]).toEqual([300, 330, 300, 330]);
    const p = new Prowl();
    expect(feed(p, 0, 60, 320)).toEqual([]);
    const far = feed(p, 60, 600, 295);
    const steps = of(far, "steps"), breath = of(far, "breath");
    expect(breath[0].t - 60).toBeGreaterThanOrEqual(3);
    expect(breath[0].t - 60).toBeLessThanOrEqual(8);
    expect(steps[0].t - 60).toBeGreaterThanOrEqual(8);
    expect(steps[0].t - 60).toBeLessThanOrEqual(14);
    for (const g of gaps(steps)) { expect(g).toBeGreaterThanOrEqual(35); expect(g).toBeLessThanOrEqual(55); }
    for (const g of gaps(breath)) { expect(g).toBeGreaterThanOrEqual(39); expect(g).toBeLessThanOrEqual(61); }
    expect(steps[0].gain).toBeLessThan(0.25);
    expect(breath[0].gain).toBeLessThan(0.25);
  });

  it("closer: both more often and louder, and still quiet (breathing stays in the background)", () => {
    const at = (d: number) => feed(new Prowl(), 0, 600, d);
    for (const k of ["steps", "breath"]) {
      expect(of(at(50), k).length).toBeGreaterThan(of(at(290), k).length * 1.3);
      expect(of(at(50), k)[1].gain).toBeCloseTo(R[k as "steps" | "breath"].gain[1]);
    }
    expect(R.breath.gain[1]).toBeLessThanOrEqual(0.5);
  });

  it("a take still playing holds the next one, which then starts at once", () => {
    // 35 s takes at 50 m: each next one starts the second the last one ends, never on top of it.
    const held = of(feed(new Prowl(), 0, 600, 50, () => 0.5, true, 35), "breath");
    for (const g of gaps(held)) expect(g).toBe(35);
  });

  it("closing in never waits out a long gap chosen far away; leaving (beyond 330 m), pausing or no distance silences it", () => {
    const p = new Prowl();
    expect(of(feed(p, 0, 12, 295), "breath")).toHaveLength(1);
    const next = of(feed(p, 12, 50, 50), "breath"); // the gap chosen at 295 m was ~50 s (next at ≈ 56); at 50 m it is ~34 s
    expect(next[0].t).toBeLessThanOrEqual(12 + 34 * 1.2 + 1);
    expect(p.inside("breath")).toBe(true);
    expect(feed(p, 52, 60, 320).length).toBeGreaterThan(0); // 300–330 m: still inside (hysteresis)
    expect(feed(p, 112, 60, 340)).toEqual([]);
    expect(p.inside("breath")).toBe(false);
    expect(feed(p, 172, 60, 100, () => 0.5, false)).toEqual([]);
    expect(feed(p, 232, 60, null)).toEqual([]);
  });
});
