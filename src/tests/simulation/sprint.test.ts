import { describe, expect, it } from "vitest";
import { resolveRules, RULES_VERSION, STEP_S, SPRINT_DURATION_S } from "@/config/game-rules";
import { createGame, stepGame } from "@/engine/core/engine";
import { zombieLatLon } from "@/engine/core/movement";
import type { GameEvent } from "@/engine/core/types";
import { haversineM } from "@/geo/geometry";
import { edgeLatLon } from "@/geo/graph/graph";
import { gridGraph } from "@/sim/test-graphs";

/** En ensam jagande zombie på samma gata som en stillastående spelare, `gapM` bort längs kanten. */
function setup(gapM: number) {
  const g = gridGraph(14, 14, 150);
  const rules = { ...resolveRules("walk", "normal", 3000), headStartS: 0, initialZombies: 1, maxZombies: 1 };
  const start = edgeLatLon(g, { edgeId: "r7:6", distM: 20 });
  const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 3, rulesVersion: RULES_VERSION }, rules, start });
  const z = state.zombies[0];
  z.edgeId = "r7:6"; z.distanceAlongEdgeM = 20 + gapM > 150 ? 150 : 20 + gapM; z.route = []; z.state = "patrol";
  state.zombies = [z];
  return { g, rules, state, start, z };
}

function run(gapM: number, seconds: number) {
  const { g, rules, state, start, z } = setup(gapM);
  const events: GameEvent[] = [];
  const speeds: number[] = [];
  let prev = zombieLatLon(g, z);
  for (let i = 0; i < Math.round(seconds / STEP_S) && state.result === undefined; i++) {
    // Smitta pausad så att spelaren överlever och spurten kan observeras.
    events.push(...stepGame(g, state, rules, { position: start, quality: "infection_paused", accuracyM: 25 }));
    const now = zombieLatLon(g, z);
    speeds.push(haversineM(prev, now) / STEP_S);
    prev = now;
  }
  return { rules, z, events, speeds, state };
}

describe("zombie-spurt", () => {
  it("jagande zombie inom 100 m spurtar: dubbel fart i 20 s, sedan normal fart", () => {
    const { rules, events, speeds } = run(95, 40);
    const sprints = events.filter((e) => e.type === "zombie_sprint");
    expect(sprints.length).toBeGreaterThanOrEqual(1);
    const base = rules.zombieSpeedMps;
    // Under spurten ≈ 2 × fart (kantbyten kan ge enstaka avvikelser: använd medianen).
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const during = speeds.slice(2, Math.floor(SPRINT_DURATION_S / STEP_S) - 5).filter((s) => s > 0.01);
    expect(during.length).toBeGreaterThan(20);
    expect(median(during)).toBeGreaterThan(base * 1.8);
    expect(median(during)).toBeLessThan(base * 2.2);
  });

  it("utan spurt utanför 100 m", () => {
    const { events } = run(140, 5);
    expect(events.some((e) => e.type === "zombie_sprint")).toBe(false);
  });

  it("direkt mätning av cykeln: spurt → återhämtning → ny spurt först efter cooldown", () => {
    const { g, rules, state, start, z } = setup(60);
    // Håll zombien 60 m bort i varje steg så att villkoret hela tiden är uppfyllt; läs tillståndet.
    const log: { t: number; sprinting: boolean }[] = [];
    let spurts = 0;
    for (let i = 0; i < Math.round(120 / STEP_S); i++) {
      z.edgeId = "r7:6"; z.distanceAlongEdgeM = 80; // alltid 60 m bort
      for (const e of stepGame(g, state, rules, { position: start, quality: "infection_paused", accuracyM: 25 })) if (e.type === "zombie_sprint") spurts++;
      z.edgeId = "r7:6"; z.distanceAlongEdgeM = 80;
      log.push({ t: state.elapsedSeconds, sprinting: z.sprintUntilS !== undefined });
    }
    const active = log.filter((l) => l.sprinting).length * STEP_S;
    // 120 s: spurt 20 s + cooldown 30 s = cykel 50 s → 2–3 spurter, ungefär 40–60 s spurttid.
    expect(spurts).toBeGreaterThanOrEqual(2);
    expect(spurts).toBeLessThanOrEqual(3);
    expect(active).toBeGreaterThan(38);
    expect(active).toBeLessThan(62);
    // Aldrig längre sammanhängande spurt än 20 s (+ ett steg).
    let run = 0, maxRun = 0;
    for (const l of log) { run = l.sprinting ? run + STEP_S : 0; maxRun = Math.max(maxRun, run); }
    expect(maxRun).toBeLessThanOrEqual(SPRINT_DURATION_S + 0.5);
  });

  it("spurten ligger i tillståndet (JSON) och bevaras vid återställning", () => {
    const { g, rules, state, start } = setup(60);
    for (let i = 0; i < 50; i++) stepGame(g, state, rules, { position: start, quality: "infection_paused", accuracyM: 25 });
    const copy = JSON.parse(JSON.stringify(state));
    expect(copy.zombies[0].sprintUntilS).toBe(state.zombies[0].sprintUntilS);
    expect(copy.zombies[0].sprintUntilS).toBeDefined();
  });
});
