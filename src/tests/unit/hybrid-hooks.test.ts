import { describe, expect, it } from "vitest";
import { STEP_S, resolveRules } from "@/config/game-rules";
import { createGame, stepGame } from "@/engine/core/engine";
import { advanceZombie } from "@/engine/core/movement";
import type { Zombie } from "@/engine/core/types";
import { chooseExtraction } from "@/engine/extraction/extraction";
import { planRoute } from "@/engine/pathfinding/astar";
import { degreeOf, indexGraph, snapToGraph, trailOf } from "@/geo/graph/graph";
import type { RawEdge, SerializedGraph } from "@/geo/graph/types";
import { fromLocal } from "@/geo/geometry";
import { ORIGIN } from "@/sim/test-graphs";

type XY = [number, number];
const node = (id: string, [x, y]: XY, virtual = false) => ({ id, ...fromLocal(ORIGIN, { x, y }), ...(virtual ? { virtual } : {}) });
const edge = (id: string, a: ReturnType<typeof node>, b: ReturnType<typeof node>, extra: Partial<RawEdge> = {}): RawEdge => ({
  id, from: a.id, to: b.id, geometry: [a, b].map(({ lat, lon }) => ({ lat, lon })), type: "path", ...extra,
});
const link = (id: string, a: ReturnType<typeof node>, b: ReturnType<typeof node>, f = 0.25) => edge(id, a, b, { offroad: true, speedFactor: f, type: "other" });
const mk = (nodes: ReturnType<typeof node>[], edges: RawEdge[]): SerializedGraph => ({ graphVersion: "t", source: "t", nodes, edges });

/** Lång omväg på stigar (700 m) mot en rak off-road-förbindelse (100 m) mellan A och B. */
function uGraph(f = 0.25) {
  const A = node("A", [0, 0]), P = node("P", [0, 300]), Q = node("Q", [100, 300]), B = node("B", [100, 0]), Z = node("Z", [-200, 0]);
  return indexGraph(mk([A, P, Q, B, Z], [edge("ap", A, P), edge("pq", P, Q), edge("qb", Q, B), edge("za", Z, A), link("ab", A, B, f)]));
}

describe("hybridgraf: grafmodell", () => {
  it("bygger en spelarvy utan off-road-kanter och lämnar rena stignät orörda", () => {
    const g = uGraph();
    expect(g.trail).toBeDefined();
    expect([...trailOf(g).edges.values()].some((e) => e.offroad)).toBe(false);
    expect(g.edges.has("ab")).toBe(true);
    const plain = indexGraph(mk([node("A", [0, 0]), node("B", [100, 0])], [edge("ab", node("A", [0, 0]), node("B", [100, 0]))]));
    expect(plain.trail).toBeUndefined();
    expect(trailOf(plain)).toBe(plain);
  });
  it("spelaren snappar aldrig till en off-road-förbindelse och korsningsgrad räknar bara stigar", () => {
    const g = uGraph();
    const p = fromLocal(ORIGIN, { x: 50, y: 1 }); // precis vid förbindelsen
    expect(snapToGraph(g, p)!.edgeId).not.toBe("ab");
    expect(degreeOf(g, "A")).toBe(2); // za + ap, inte ab
  });
  it("extraction väljer aldrig virtuella hjälpnoder", () => {
    const A = node("A", [0, 0]), V = node("V", [200, 0], true), B = node("B", [400, 0]), C = node("C", [400, 400]), D = node("D", [0, 400]);
    const g = indexGraph(mk([A, V, B, C, D], [edge("av", A, V), edge("vb", V, B), edge("bc", B, C), edge("cd", C, D), edge("da", D, A)]));
    const picks = new Set<string>();
    for (let s = 1; s < 40; s++) {
      const id = chooseExtraction(g, { playerPos: { edgeId: "av", distM: 10 }, component: 0, zombiePositions: [], remainingS: 600, playerPaceMps: 3 }, { rngState: s });
      if (id) picks.add(id);
    }
    expect(picks.size).toBeGreaterThan(0);
    expect(picks.has("V")).toBe(false);
  });
});

describe("hybridgraf: A*", () => {
  it("väljer off-road när det är snabbare i tid, inte bara kortare", () => {
    const g = uGraph(0.25); // 100 m / 0,25 = 400 m-ekvivalent < 700 m
    const r = planRoute(g, { edgeId: "za", distM: 190 }, { edgeId: "qb", distM: 250 }, 1.4)!;
    expect(r.steps.some((s) => s.edgeId === "ab")).toBe(true);
    expect(r.etaS).toBeCloseTo((10 + 100 / 0.25 + 50) / 1.4, 3);
  });
  it("väljer stigen när off-road är för långsamt", () => {
    const g = uGraph(0.1); // 100 / 0,1 = 1000 > 700
    const r = planRoute(g, { edgeId: "za", distM: 190 }, { edgeId: "qb", distM: 250 }, 1.4)!;
    expect(r.steps.some((s) => s.edgeId === "ab")).toBe(false);
  });
  it("tillåter aldrig två off-road-förbindelser i följd (kedjeregeln)", () => {
    // X–A (stig), A~B och B~C är förbindelser, C–Y (stig). Ingen stigförbindelse mellan A, B och C.
    const X = node("X", [-100, 0]), A = node("A", [0, 0]), B = node("B", [60, 0]), C = node("C", [120, 0]), Y = node("Y", [220, 0]), Bs = node("Bs", [60, 50]);
    const chained = indexGraph(mk([X, A, B, C, Y], [edge("xa", X, A), link("ab", A, B), link("bc", B, C), edge("cy", C, Y)]));
    expect(planRoute(chained, { edgeId: "xa", distM: 50 }, { edgeId: "cy", distM: 50 }, 1.4)).toBeNull();
    // Med en kort stig vid B emellan går det: förbindelse – stig – förbindelse.
    const ok = indexGraph(mk([X, A, B, Bs, C, Y], [edge("xa", X, A), link("ab", A, B), edge("bb", B, Bs), link("bsc", Bs, C), edge("cy", C, Y)]));
    expect(planRoute(ok, { edgeId: "xa", distM: 50 }, { edgeId: "cy", distM: 50 }, 1.4)).not.toBeNull();
  });
  it("kedjeregeln gäller även för en zombie som redan står på en förbindelse", () => {
    const X = node("X", [-100, 0]), A = node("A", [0, 0]), B = node("B", [60, 0]), C = node("C", [120, 0]), Y = node("Y", [220, 0]);
    const g = indexGraph(mk([X, A, B, C, Y], [edge("xa", X, A), link("ab", A, B), link("bc", B, C), edge("cy", C, Y)]));
    expect(planRoute(g, { edgeId: "ab", distM: 20 }, { edgeId: "cy", distM: 50 }, 1.4)).toBeNull();
  });
});

describe("hybridgraf: rörelse", () => {
  const zombie = (over: Partial<Zombie>): Zombie => ({
    id: "z", edgeId: "za", distanceAlongEdgeM: 0, speedMps: 1.4, state: "patrol", dir: 1, route: [], stateSinceS: 0,
    replanAtS: 0, tacticalAtS: 0, contactLostS: 0, canIntercept: false, ...over,
  });
  it("patrullerande zombier går aldrig in på off-road-förbindelser", () => {
    const g = uGraph();
    const z = zombie({});
    const rng = { rngState: 5 };
    for (let i = 0; i < 20000; i++) {
      advanceZombie(g, z, 2, rng);
      expect(g.edges.get(z.edgeId)!.offroad).toBeFalsy();
    }
  });
  it("en zombie på en förbindelse rör sig med speedFactor × normal fart i motorn", () => {
    const g = uGraph(0.25);
    const rules = resolveRules("run", "normal", 1800);
    // Startposition långt från zombien så att inga andra regler påverkar.
    const start = fromLocal(ORIGIN, { x: -200, y: 0 });
    const { state } = createGame({ g, config: { activity: "run", difficulty: "normal", durationSeconds: 1800, areaId: "t", seed: 1, rulesVersion: "t" }, rules: { ...rules, spawnMinDistanceM: 10 }, start });
    state.phase = "survival";
    state.elapsedSeconds = rules.headStartS + 1;
    state.zombies = [zombie({ edgeId: "ab", distanceAlongEdgeM: 10, speedMps: 2, dir: 1 })];
    stepGame(g, state, { ...rules, maxZombies: 0, initialZombies: 0 }, { position: start, quality: "ok", accuracyM: 5 });
    expect(state.zombies[0].distanceAlongEdgeM - 10).toBeCloseTo(2 * 0.25 * STEP_S, 6);
  });
});
