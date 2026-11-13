import { describe, expect, it } from "vitest";
import { Cooldown, NearGate, SOUND_RULES, ThreatGate, pickVariant, threatRange } from "@/play/sound-rules";

const R = SOUND_RULES.threat;

/** Feeds a gate one value per second; returns every action with its time. */
function feed(g: ThreatGate, from: number, secs: number, d: number | null, activity: "walk" | "mtb" = "walk", running = true) {
  const out: { t: number; a: NonNullable<ReturnType<ThreatGate["update"]>> }[] = [];
  for (let t = from; t < from + secs; t++) { const a = g.update(t, d, activity, running); if (a) out.push({ t, a }); }
  return out;
}

describe("threat pulse rules", () => {
  it("starts only after the nearest zombie has stayed within range for the dwell time", () => {
    const g = new ThreatGate(4, () => 0.5);
    expect(feed(g, 0, 30, 400)).toEqual([]); // far away: calm
    const a = feed(g, 30, 10, 180);
    expect(a).toHaveLength(1);
    expect(a[0].t).toBe(30 + R.enterDwellS);
    expect("start" in a[0].a).toBe(true);
  });

  it("does not toggle with GPS jitter around the limits (hysteresis, dwell and minimum length)", () => {
    const g = new ThreatGate(4, () => 0.3);
    feed(g, 0, 5, 190);
    expect(g.active).toBe(true);
    // Jitter between 195 and 270 m for two minutes: never 10 s in a row beyond 260 m, so it stays on.
    const acts: unknown[] = [];
    for (let t = 5; t < 125; t++) { const a = g.update(t, t % 8 < 6 ? 270 : 195, "walk", true); if (a) acts.push(a); }
    expect(g.update(125, 195, "walk", true)).toBeNull();
    expect(acts).toEqual([]);
    // Then it really goes away: off after exitDwellS, with the long fade.
    const off = feed(g, 126, 20, 300);
    expect(off).toEqual([{ t: 126 + R.exitDwellS, a: { stop: "fade" } }]);
  });

  it("keeps a calm gap between threats unless a zombie is already at close range", () => {
    const g = new ThreatGate(4, () => 0.1);
    feed(g, 0, 20, 150);
    feed(g, 20, 15, 400); // ends at 30
    expect(g.active).toBe(false);
    const again = feed(g, 35, 30, 180); // back within 200 m, but not close (> 100 m)
    expect(again).toHaveLength(1);
    expect(again[0].t).toBeGreaterThanOrEqual(30 + R.quietGapS);
    const h = new ThreatGate(4, () => 0.1);
    feed(h, 0, 20, 150);
    feed(h, 20, 15, 400);
    const close = feed(h, 35, 10, 80); // a zombie at close range: no waiting for the gap
    expect(close[0].t).toBe(35 + R.enterDwellS);
  });

  it("one variant per threat period, never the same twice in a row; only one at a time", () => {
    const rnd = [0.0, 0.0, 0.99, 0.5, 0.0, 0.2, 0.7, 0.7, 0.1];
    let i = 0;
    const g = new ThreatGate(4, () => rnd[i++ % rnd.length]);
    const starts: number[] = [];
    let t = 0;
    for (let k = 0; k < 8; k++) {
      for (const x of feed(g, t, 20, 150)) if ("start" in x.a) starts.push(x.a.start);
      t += 20;
      feed(g, t, 40, 500);
      t += 40;
    }
    expect(starts).toHaveLength(8);
    for (let k = 1; k < starts.length; k++) expect(starts[k]).not.toBe(starts[k - 1]);
    for (const s of starts) expect(s).toBeGreaterThanOrEqual(0);
    for (const s of starts) expect(s).toBeLessThan(4);
  });

  it("pause, match end or no zombies stop it at once (quick fade), and it re-arms with the dwell", () => {
    const g = new ThreatGate(4);
    feed(g, 0, 5, 150);
    expect(g.update(5, 150, "walk", false)).toEqual({ stop: "quick" });
    expect(g.update(6, 150, "walk", false)).toBeNull();
    const back = feed(g, 7, 5, 150);
    expect(back[0].t).toBe(7 + R.enterDwellS); // no calm gap after a pause, but the dwell again
    expect(g.update(20, null, "walk", true)).toEqual({ stop: "quick" });
  });

  it("Bike uses wider limits (both move faster)", () => {
    expect(threatRange("mtb").onM).toBeGreaterThan(threatRange("walk").onM);
    const g = new ThreatGate(4);
    expect(feed(g, 0, 10, 350, "walk")).toEqual([]);
    expect(feed(g, 10, 10, 350, "mtb")).toHaveLength(1);
  });

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
