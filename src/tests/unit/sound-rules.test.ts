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

describe("close-zombie layer (breathing within 300 m, steps within 100 m)", () => {
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

  it("nothing beyond 300 m; at the edge breathing about every 45 s, quiet, and no steps", () => {
    const p = new Prowl();
    expect(feed(p, 0, 60, 320)).toEqual([]);
    const far = feed(p, 60, 600, 295);
    const breath = of(far, "breath");
    expect(of(far, "steps")).toEqual([]);
    expect(breath[0].t - 60).toBeGreaterThanOrEqual(3);
    expect(breath[0].t - 60).toBeLessThanOrEqual(8);
    for (const g of gaps(breath)) { expect(g).toBeGreaterThanOrEqual(35); expect(g).toBeLessThanOrEqual(55); }
    expect(breath[0].gain).toBeLessThan(0.3);
  });

  it("steps only within 100 m (out again beyond 130 m), every 30–40 s, louder closer and always below the breathing at its closest", () => {
    expect([R.steps.enterM, R.steps.exitM, R.breath.enterM, R.breath.exitM]).toEqual([100, 130, 300, 330]);
    expect(of(feed(new Prowl(), 0, 300, 110), "steps")).toEqual([]);
    const p = new Prowl();
    const close = of(feed(p, 0, 600, 90), "steps");
    expect(close[0].t).toBeGreaterThanOrEqual(5);
    for (const g of gaps(close)) { expect(g).toBeGreaterThanOrEqual(28); expect(g).toBeLessThanOrEqual(48); }
    expect(of(feed(p, 600, 60, 120), "steps").length).toBeGreaterThan(0); // 100–130 m: still inside (hysteresis)
    expect(of(feed(p, 660, 60, 140), "steps")).toEqual([]);
    expect(p.inside("steps")).toBe(false);
    expect(p.inside("breath")).toBe(true);
    const nearest = of(feed(new Prowl(), 0, 300, 20), "steps");
    expect(nearest[0].gain).toBeCloseTo(R.steps.gain[1]);
    expect(close[0].gain).toBeLessThan(R.steps.gain[1]);
    expect(R.steps.gain[1]).toBeLessThan(R.breath.gain[1]);
  });

  it("closer: breathing more often and louder; a take still playing holds the next one, which then starts at once", () => {
    const at = (d: number) => feed(new Prowl(), 0, 600, d);
    expect(of(at(50), "breath").length).toBeGreaterThan(of(at(290), "breath").length * 1.4);
    expect(of(at(50), "breath")[1].gain).toBeCloseTo(R.breath.gain[1]);
    // 30 s takes at 50 m: each next one starts the second the last one ends, never on top of it.
    const held = of(feed(new Prowl(), 0, 600, 50, () => 0.5, true, 30), "breath");
    for (const g of gaps(held)) expect(g).toBe(30);
  });

  it("closing in never waits out a long gap chosen far away; leaving (beyond 330 m), pausing or no distance silences it", () => {
    const p = new Prowl();
    expect(of(feed(p, 0, 12, 295), "breath")).toHaveLength(1);
    const next = of(feed(p, 12, 40, 50), "breath"); // the gap chosen at 295 m was ~45 s (next at ≈ 51); at 50 m it is ~28 s
    expect(next[0].t).toBeLessThanOrEqual(12 + 28 * 1.2 + 1);
    expect(p.inside("breath")).toBe(true);
    expect(feed(p, 52, 60, 320).length).toBeGreaterThan(0); // 300–330 m: still inside (hysteresis)
    expect(feed(p, 112, 60, 340)).toEqual([]);
    expect(p.inside("breath")).toBe(false);
    expect(feed(p, 172, 60, 100, () => 0.5, false)).toEqual([]);
    expect(feed(p, 232, 60, null)).toEqual([]);
  });
});
