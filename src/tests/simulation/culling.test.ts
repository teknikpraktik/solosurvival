import { describe, expect, it } from "vitest";
import { resolveRules, RULES_VERSION, STEP_S } from "@/config/game-rules";
import { cullStackedZombies, STACK_MIN_PLAYER_M, STACK_RADIUS_M } from "@/engine/ai/culling";
import { createGame, stepGame } from "@/engine/core/engine";
import type { Zombie, ZombieState } from "@/engine/core/types";
import { edgeLatLon } from "@/geo/graph/graph";
import { gridGraph } from "@/sim/test-graphs";

// Rad 0 i rutnätet: en 3 km lång väg delad i kanter på 100 m vid varje korsning.
const g = gridGraph(2, 31, 100);
const edges = [...g.edges.values()].filter((e) => e.id.startsWith("r0:")).sort((a, b) => Math.min(g.nodes.get(a.from)!.lon, g.nodes.get(a.to)!.lon) - Math.min(g.nodes.get(b.from)!.lon, g.nodes.get(b.to)!.lon));
/** Position `m` meter längs rad 0. */
const at = (m: number) => {
  const e = edges[Math.floor(m / 100)];
  const forward = g.nodes.get(e.from)!.lon < g.nodes.get(e.to)!.lon;
  return { edgeId: e.id, distM: forward ? m % 100 : e.lengthM - (m % 100) };
};
const player = edgeLatLon(g, at(0));

function zombie(id: string, m: number, state: ZombieState = "chase", over: Partial<Zombie> = {}): Zombie {
  const p = at(m);
  return { id, edgeId: p.edgeId, distanceAlongEdgeM: p.distM, speedMps: 3, state, dir: -1, route: [], stateSinceS: 0, replanAtS: 0, tacticalAtS: 0, contactLostS: 0, canIntercept: false, ...over };
}

describe("gallring av zombiehögar", () => {
  it("behåller bara den närmaste av jagande zombier som står på samma ställe långt bort", () => {
    const zs = [zombie("a", 1010), zombie("b", 1000), zombie("c", 1020)];
    const removed = cullStackedZombies(g, zs, player);
    expect(zs.map((z) => z.id)).toEqual(["b"]);
    expect(removed.sort()).toEqual(["a", "c"]);
  });

  it("räknar avstånd över en nod mellan två kanter", () => {
    const zs = [zombie("a", 995), zombie("b", 1005)];
    expect(zs[0].edgeId).not.toBe(zs[1].edgeId);
    cullStackedZombies(g, zs, player);
    expect(zs.map((z) => z.id)).toEqual(["a"]);
  });

  it("rör inte zombier nära spelaren, glesa grupper, patrullerande, olika lägen eller spurtande", () => {
    const near = [zombie("a", STACK_MIN_PLAYER_M - 50), zombie("b", STACK_MIN_PLAYER_M - 45)];
    const spaced = [zombie("c", 1000), zombie("d", 1000 + STACK_RADIUS_M + 10)];
    const patrol = [zombie("e", 1500, "patrol"), zombie("f", 1505, "patrol")];
    const mixed = [zombie("g", 2000, "chase"), zombie("h", 2005, "intercept")];
    const sprint = [zombie("i", 2500), zombie("j", 2505, "chase", { sprintUntilS: 99 })];
    const zs = [...near, ...spaced, ...patrol, ...mixed, ...sprint];
    expect(cullStackedZombies(g, zs, player)).toEqual([]);
    expect(zs).toHaveLength(10);
  });

  it("borttagna zombier räknas i tillväxten och ersätts inte", () => {
    const rules = { ...resolveRules("mtb", "normal", 1800), initialZombies: 5, maxZombies: 5, growthPerMin: 0 };
    const { state } = createGame({ g, config: { activity: "mtb", difficulty: "normal", durationSeconds: 1800, areaId: "t", seed: 4, rulesVersion: RULES_VERSION }, rules, start: player });
    state.phase = "survival";
    // Fem jagande zombier i en hög 1,2 km bort och inga andra.
    state.zombies = ["p", "q", "r", "s", "t"].map((id, i) => zombie(id, 1200 + i * 2));
    state.zombieCounter = 100;
    const seen: string[] = [];
    for (let i = 0; i < 5 / STEP_S; i++) for (const e of stepGame(g, state, rules, { position: player, quality: "ok", accuracyM: 5 })) if (e.type === "zombie_culled") seen.push(e.zombieId);
    expect(seen).toHaveLength(4);
    expect(state.culledZombies).toBe(4);
    expect(state.zombies.map((z) => z.id)).toEqual(["p"]); // ingen ny zombie fyller på: taket (5) är nått räknat med de borttagna
    expect(state.zombieCounter).toBe(100);
  });
});
