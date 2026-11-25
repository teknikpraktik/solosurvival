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

describe("close-zombie layer (steps, breathing within 300 m)", () => {
  type Hit = { t: number; kind: string; gain: number };
  /** Feeds one distance per second for `secs` s; returns the sounds with their time. */
  const feed = (p: Prowl, from: number, secs: number, d: number | null, random = () => 0.5, running = true): Hit[] => {
    const out: Hit[] = [];
    for (let t = from; t < from + secs; t++) for (const r of p.update(t, d, running, random)) out.push({ t, ...r });
    return out;
  };
  const of = (h: Hit[], kind: string) => h.filter((x) => x.kind === kind);
  const gaps = (h: Hit[]) => h.slice(1).map((x, i) => x.t - h[i].t);

  it("nothing beyond 300 m; at the edge breathing about every 10 s and a steps passage about every 100 s, both quiet", () => {
    const p = new Prowl();
    expect(feed(p, 0, 60, 320)).toEqual([]);
    const far = feed(p, 60, 600, 295);
    const steps = of(far, "steps"), breath = of(far, "breath");
    expect(steps[0].t - 60).toBeGreaterThanOrEqual(3);
    expect(steps[0].t - 60).toBeLessThanOrEqual(8);
    for (const g of gaps(steps)) { expect(g).toBeGreaterThanOrEqual(65); expect(g).toBeLessThanOrEqual(131); }
    for (const g of gaps(breath)) { expect(g).toBeGreaterThanOrEqual(6); expect(g).toBeLessThanOrEqual(14); }
    expect(breath.length).toBeGreaterThan(steps.length * 6); // breathing is the main sound
    expect(steps[0].gain).toBeLessThan(0.2);
    expect(breath[0].gain).toBeLessThan(0.35);
  });

  it("closer: more often and louder, steps still never closer than about 30 s apart and always below the breathing", () => {
    const at = (d: number) => feed(new Prowl(), 0, 600, d);
    const far = at(250), near = at(50);
    expect(of(near, "breath").length).toBeGreaterThan(of(far, "breath").length * 2);
    expect(of(near, "steps").length).toBeGreaterThan(of(far, "steps").length);
    for (const g of gaps(of(near, "steps"))) expect(g).toBeGreaterThanOrEqual(31);
    expect(of(near, "breath")[1].gain).toBeCloseTo(SOUND_RULES.prowl.breath.gain[1]);
    expect(of(near, "steps")[0].gain).toBeCloseTo(SOUND_RULES.prowl.steps.gain[1]);
    expect(SOUND_RULES.prowl.steps.gain[1]).toBeLessThan(SOUND_RULES.prowl.breath.gain[1]);
  });

  it("closing in never waits out a long gap chosen far away; leaving (beyond 330 m), pausing or no distance silences it", () => {
    const p = new Prowl();
    expect(of(feed(p, 0, 12, 295), "breath")).toHaveLength(1);
    const next = of(feed(p, 12, 10, 60), "breath"); // the gap chosen at 295 m was ~10 s; at 60 m it is ~3 s
    expect(next[0].t).toBeLessThanOrEqual(17);
    expect(p.inside).toBe(true);
    expect(feed(p, 22, 30, 320).length).toBeGreaterThan(0); // 300–330 m: still inside (hysteresis)
    expect(feed(p, 52, 60, 340)).toEqual([]);
    expect(p.inside).toBe(false);
    expect(feed(p, 112, 60, 100, () => 0.5, false)).toEqual([]);
    expect(feed(p, 172, 60, null)).toEqual([]);
  });
});
