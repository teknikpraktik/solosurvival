import { describe, expect, it } from "vitest";
import type { Difficulty } from "@/config/difficulty";
import type { Rules } from "@/config/game-rules";
import { makeGoalBot, newBotStats } from "@/sim/bots";
import { SimSession } from "@/sim/runner";
import { gridGraph } from "@/sim/test-graphs";

/**
 * Balansregression på ett syntetiskt rutnät (snabbt, deterministiskt). Det är ett jämförande test mellan v2.1 och v2.2 under identiska förhållanden
 * (samma nät, samma seed, samma spelarbot och tempo), inte ett mått på verklig vinstsannolikhet. Mätningar på riktig OSM-data står i docs/V2.2-RAPPORT.md.
 */
const V21_KMH: Record<Difficulty, number> = { easy: 6, normal: 10, hard: 13 };
const v21 = (d: Difficulty): Partial<Rules> => ({ zombieSpeedMps: V21_KMH[d] / 3.6, sprintSpeedFactor: 1.5, sprintDurationS: 30, sprintRampS: 0, sprintDecayS: 0, sprintCooldownS: 30 });

const g = gridGraph(22, 22, 90);
const SEEDS = Array.from({ length: 10 }, (_, i) => 500 + i);
const DURATION = 1500;

function run(difficulty: Difficulty, pace: number, patch?: Partial<Rules>) {
  const res = SEEDS.map((seed) => {
    const s = new SimSession({ g, activity: "walk", difficulty, durationS: DURATION, seed, strategy: "extraction", paceFactor: pace, strategyFn: makeGoalBot("planner", newBotStats()), rulesPatch: patch });
    while (!s.finished) s.step();
    return { result: s.state.result, t: s.state.elapsedSeconds };
  });
  return {
    survived: res.filter((r) => r.result === "survived").length / res.length,
    meanT: res.reduce((a, r) => a + (r.result === "infected" ? r.t : DURATION), 0) / res.length,
  };
}

describe("spelbalans (simulerat, syntetiskt nät, gående spelare)", () => {
  it("Lätt, Normal och Svår skiljer sig tydligt i hur länge en gående spelare klarar sig", () => {
    const e = run("easy", 1), n = run("normal", 1), h = run("hard", 1);
    expect(e.meanT).toBeGreaterThan(n.meanT * 1.3);
    expect(n.meanT).toBeGreaterThan(h.meanT * 1.1);
    expect(e.survived).toBeGreaterThanOrEqual(n.survived);
    expect(n.survived).toBeGreaterThanOrEqual(h.survived);
  }, 120000);

  it("Lätt är lättare i v2.2 än i v2.1 för en gående spelare (nominell fart och 0,8 ×) under identiska förhållanden", () => {
    for (const pace of [1, 0.8]) {
      const a = run("easy", pace, v21("easy")), b = run("easy", pace);
      expect(b.meanT).toBeGreaterThanOrEqual(a.meanT);
      expect(b.survived).toBeGreaterThanOrEqual(a.survived);
    }
    const old = run("easy", 1, v21("easy")), now = run("easy", 1);
    expect(now.meanT).toBeGreaterThan(old.meanT * 1.15);
  }, 120000);

  it("Normal och Svår är inte lättare än tidigare (sprintändringen mjukar upp formen, inte svårighetsgraden)", () => {
    for (const d of ["normal", "hard"] as const) {
      const a = run(d, 1, v21(d)), b = run(d, 1);
      expect(b.meanT).toBeGreaterThan(a.meanT * 0.8);
      expect(b.meanT).toBeLessThan(a.meanT * 1.5);
    }
  }, 120000);
});
