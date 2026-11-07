import { describe, expect, it } from "vitest";
import { RULES_VERSION, STEP_S } from "@/config/game-rules";
import { resolveModeRules } from "@/config/modes";
import { createGame, stepGame } from "@/engine/core/engine";
import { zombieLatLon } from "@/engine/core/movement";
import { fromLocal, toLocal } from "@/geo/geometry";
import { ORIGIN, gridGraph } from "@/sim/test-graphs";

/** A rider going east at 6 m/s across a large grid; returns where each new (not initial) zombie appeared, relative to the rider. */
function newZombies(share: number, seed: number) {
  const g = gridGraph(40, 40, 150); // 6 km square, ORIGIN at a corner
  const rules = { ...resolveModeRules("survival", "mtb", "normal", 3000), aheadSpawnShare: share, headStartS: 0, initialZombies: 1, maxZombies: 30, growthPerMin: 6, magnetic: false, detectionRadiusM: 0, revealIntervalS: 1e9, sprintRadiusM: 0, spawnMinDistanceM: 300, spawnMaxDistanceM: 900 };
  const start = fromLocal(ORIGIN, { x: 1200, y: 3000 });
  const { state } = createGame({ g, config: { activity: "mtb", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed, rulesVersion: RULES_VERSION, mode: "survival" }, rules, start });
  state.neutralUntilS = 1e9;
  const seen = new Set(state.zombies.map((z) => z.id));
  const rel: { x: number; y: number }[] = [];
  for (let i = 0; i < 300 / STEP_S; i++) {
    const p = fromLocal(ORIGIN, { x: 1200 + i * STEP_S * 6, y: 3000 });
    stepGame(g, state, rules, { position: p, quality: "ok", accuracyM: 5 });
    for (const z of state.zombies) if (!seen.has(z.id)) { seen.add(z.id); rel.push(toLocal(p, zombieLatLon(g, z))); }
  }
  return rel;
}
const aheadShare = (rel: { x: number; y: number }[]) => rel.filter((v) => v.x / Math.hypot(v.x, v.y) >= 0.5).length / rel.length;

describe("Survival on the bike: new zombies mostly ahead of the rider", () => {
  it("with the share at 1 every new zombie appears within 60 degrees of the direction of travel", () => {
    const rel = [1, 2, 3].flatMap((s) => newZombies(1, s));
    expect(rel.length).toBeGreaterThan(20);
    expect(aheadShare(rel)).toBeGreaterThan(0.95);
  });
  it("without it they appear all around (about a third in that cone)", () => {
    const rel = [1, 2, 3].flatMap((s) => newZombies(0, s));
    expect(aheadShare(rel)).toBeLessThan(0.5);
  });
  it("the rule is on for Survival on the bike (70 %), not on foot or in other modes", () => {
    expect(resolveModeRules("survival", "mtb", "normal", 3000).aheadSpawnShare).toBe(0.7);
    expect(resolveModeRules("survival", "walk", "normal", 3000).aheadSpawnShare).toBeUndefined();
    expect(resolveModeRules("mission", "mtb", "normal", 3000).aheadSpawnShare).toBeUndefined();
  });
});
