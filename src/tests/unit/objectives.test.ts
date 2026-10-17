import { describe, expect, it } from "vitest";
import { STEP_S, resolveRules } from "@/config/game-rules";
import { resolveModeRules } from "@/config/modes";
import { createGame, stepGame } from "@/engine/core/engine";
import { createObjectives, updateObjectives } from "@/engine/objectives/objectives";
import { edgeLatLon } from "@/geo/graph/graph";
import { fromLocal } from "@/geo/geometry";
import { gridGraph, ORIGIN } from "@/sim/test-graphs";
import { SimSession } from "@/sim/runner";
import { makeGoalBot, newBotStats } from "@/sim/bots";

const at = (x: number, y: number) => fromLocal(ORIGIN, { x, y });
/** Kör `secs` sekunder och returnerar första bekräftade mål samt om allt blev klart. */
const run = (o: ReturnType<typeof createObjectives>, pos: ReturnType<typeof at>, secs: number, q: "ok" | "unavailable" | "infection_paused" = "ok") => {
  let reached, completed = false;
  for (let i = 0; i < Math.round(secs / STEP_S); i++) {
    const u = updateObjectives(o, pos, q, STEP_S, 100 + i * STEP_S);
    reached ??= u.reached;
    completed ||= u.completed && !!u.reached;
  }
  return { reached, completed };
};
const mk = () => createObjectives([
  { id: "C1", kind: "checkpoint", ...at(300, 0) },
  { id: "C2", kind: "checkpoint", ...at(300, 300) },
  { id: "A", kind: "home", ...at(0, 0) },
]);

describe("målmodell", () => {
  it("bekräftar först efter 5 s inom 30 m", () => {
    const o = mk();
    expect(run(o, at(310, 0), 4.6).reached).toBeUndefined();
    expect(o.index).toBe(0);
    expect(run(o, at(310, 0), 0.6).reached?.id).toBe("C1");
    expect(o.index).toBe(1);
  });
  it("nollställer bekräftelsen när spelaren lämnar radien", () => {
    const o = mk();
    run(o, at(310, 0), 4);
    run(o, at(400, 0), 1);
    expect(o.holdS).toBe(0);
    run(o, at(310, 0), 4);
    expect(o.index).toBe(0);
  });
  it("kräver rätt ordning: hemkomst räknas inte före checkpoints", () => {
    const o = mk();
    run(o, at(0, 0), 60); // står hemma från start
    expect(o.index).toBe(0);
    run(o, at(300, 0), 5.2);
    run(o, at(300, 300), 5.2);
    expect(o.index).toBe(2);
    const u = run(o, at(5, 5), 5.2);
    expect(u.completed).toBe(true);
  });
  it("räknar inte med otillförlitlig GPS, och radien är 30 m", () => {
    const o = mk();
    run(o, at(300, 0), 60, "unavailable");
    run(o, at(300, 0), 60, "infection_paused");
    expect(o.index).toBe(0);
    run(o, at(300 + 31, 0), 20);
    expect(o.index).toBe(0);
    run(o, at(300 + 29, 0), 5.2);
    expect(o.index).toBe(1);
  });
});

describe("spelmotor med mål", () => {
  const g = gridGraph(14, 14, 120);
  const start = edgeLatLon(g, { edgeId: "r7:5", distM: 60 });
  it("Escape: vinst när destinationen nås; ingen extraction öppnas", () => {
    const dest = edgeLatLon(g, { edgeId: "r7:9", distM: 0 });
    const objectives = createObjectives([{ id: "B", kind: "destination", ...dest }]);
    const s = new SimSession({ g, activity: "run", difficulty: "easy", durationS: 3000, seed: 3, strategy: "avoid", start, mode: "escape", objectives, strategyFn: makeGoalBot("follower", newBotStats()) });
    while (!s.finished) s.step();
    expect(s.state.result).toBe("survived");
    expect(s.state.extractionNodeId).toBeUndefined();
    expect(s.events.some((e) => e.type === "objective_reached")).toBe(true);
  });
  it("tidsgränsen ger FAILED när målet inte nås", () => {
    const dest = edgeLatLon(g, { edgeId: "r7:9", distM: 0 });
    const objectives = createObjectives([{ id: "B", kind: "destination", ...dest }]);
    const s = new SimSession({ g, activity: "walk", difficulty: "easy", durationS: 300, seed: 3, strategy: "avoid", start, mode: "escape", objectives, paceFactor: 0.01 });
    while (!s.finished) s.step();
    expect(["failed", "infected"]).toContain(s.state.result);
  });
  it("zombier spawnar aldrig inom 150 m från mål", () => {
    const dest = edgeLatLon(g, { edgeId: "r3:3", distM: 60 });
    const objectives = createObjectives([{ id: "B", kind: "destination", ...dest }]);
    const rules = resolveModeRules("escape", "run", "hard", 3000);
    for (let seed = 1; seed < 20; seed++) {
      const { state } = createGame({ g, config: { activity: "run", difficulty: "hard", durationSeconds: 3000, areaId: "t", seed, rulesVersion: "t", mode: "escape" }, rules, start, objectives });
      for (const z of state.zombies) {
        const p = edgeLatLon(g, { edgeId: z.edgeId, distM: z.distanceAlongEdgeM });
        expect(Math.hypot((p.lat - dest.lat) * 111320, (p.lon - dest.lon) * 111320 * Math.cos((dest.lat * Math.PI) / 180))).toBeGreaterThanOrEqual(150);
      }
    }
  });
  it("Survival är oförändrat: samma regler och extraction öppnar", () => {
    expect(resolveModeRules("survival", "run", "normal", 2700)).toEqual(resolveRules("run", "normal", 2700));
    expect(resolveModeRules("escape", "run", "normal", 2700).extractionOpensAtS).toBe(Infinity);
  });
  it("zombier får inte tillgång till målen: AI-koden läser inte objectives", async () => {
    const fs = await import("node:fs");
    for (const f of ["src/engine/ai/zombie-ai.ts", "src/engine/core/movement.ts", "src/engine/infection/infection.ts"]) {
      expect(fs.readFileSync(f, "utf8")).not.toMatch(/objectives/);
    }
  });
});
