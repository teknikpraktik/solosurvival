import { describe, expect, it } from "vitest";
import { Cooldown, NearGate, SOUND_RULES, pickVariant } from "@/play/sound-rules";

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
