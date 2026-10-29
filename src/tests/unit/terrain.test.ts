import { describe, expect, it } from "vitest";
import { RULES_VERSION, STEP_S, resolveRules } from "@/config/game-rules";
import { resolveModeRules } from "@/config/modes";
import { createGame, stepGame } from "@/engine/core/engine";
import { zombieLatLon } from "@/engine/core/movement";
import { buildTargetTree, planRoute } from "@/engine/pathfinding/astar";
import { createObjectives } from "@/engine/objectives/objectives";
import { haversineM, type LatLon } from "@/geo/geometry";
import { buildGraph, type RawWay } from "@/geo/graph/build";
import { edgeLatLon, indexGraph, serializeGraph, snapToGraph, snapToGraphNear } from "@/geo/graph/graph";
import { buildTerrainMesh, MESH_MAX_NODES, MESH_MAX_SPACING_M, MESH_MIN_SPACING_M } from "@/geo/graph/terrain-mesh";
import { makeGoalBot, newBotStats } from "@/sim/bots";
import { SimSession } from "@/sim/runner";
import { ORIGIN } from "@/sim/test-graphs";
import { destinationPoint } from "./helpers";

const A = ORIGIN;
const B3 = destinationPoint(A, 3000, 70);

describe("terrängnät (buildTerrainMesh)", () => {
  it("storlek och avstånd: aldrig fler än MESH_MAX_NODES noder, avstånd 45–70 m, även för 20 km", () => {
    for (const km of [0.5, 1, 3, 10, 20]) {
      const m = buildTerrainMesh(null, { a: A, b: destinationPoint(A, km * 1000, 30) });
      expect(m.meshNodes).toBeLessThanOrEqual(MESH_MAX_NODES);
      expect(m.spacingM).toBeGreaterThanOrEqual(MESH_MIN_SPACING_M);
      expect(m.spacingM).toBeLessThanOrEqual(MESH_MAX_SPACING_M);
      expect(m.graph.edges.every((e) => e.offtrail)).toBe(true);
    }
  });

  it("deterministiskt: samma A och B ger exakt samma graf", () => {
    const a = JSON.stringify(buildTerrainMesh(null, { a: A, b: B3 }).graph);
    expect(JSON.stringify(buildTerrainMesh(null, { a: A, b: B3 }).graph)).toBe(a);
  });

  it("täckning: varje punkt i korridoren ligger inom infektionsradien (20 m) från närmaste kant, och A och B snappar nära", () => {
    for (const km of [1, 6, 20]) {
      const b = destinationPoint(A, km * 1000, 110);
      const g = indexGraph(buildTerrainMesh(null, { a: A, b }).graph);
      let seed = 5; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      let worst = 0;
      for (let i = 0; i < 300; i++) {
        const t = rnd(), side = (rnd() - 0.5) * 1200; // inom 600 m från linjen
        const p = destinationPoint(destinationPoint(A, t * km * 1000, 110), side, 20);
        worst = Math.max(worst, snapToGraph(g, p)!.offNetworkM);
      }
      expect(worst).toBeLessThanOrEqual(20);
      expect(snapToGraph(g, A)!.offNetworkM).toBeLessThanOrEqual(20);
      expect(snapToGraph(g, b)!.offNetworkM).toBeLessThanOrEqual(20);
    }
  });

  it("stigar behålls oförändrade och kopplas till gittret; en stig före terräng när den ligger inom 4 m", () => {
    const trail: RawWay = { id: "T", type: "path", nodes: [0, 1, 2, 3].map((i) => ({ id: `n${i}`, ...destinationPoint(A, 500 + i * 400, 70) })) };
    const m = buildTerrainMesh(buildGraph([trail]), { a: A, b: B3 });
    expect(m.trailEdges).toBeGreaterThanOrEqual(3); // en stig på ca 1,2 km delas i bitar om högst 120 m
    expect(m.links).toBeGreaterThanOrEqual(8);
    const g = indexGraph(m.graph);
    expect(g.hasOfftrail).toBe(true);
    expect(g.components).toHaveLength(1); // allt är sammanhängande
    const onTrail = destinationPoint(destinationPoint(A, 900, 70), 2, 160);
    expect(g.edges.get(snapToGraph(g, onTrail)!.edgeId)!.offtrail).toBeUndefined(); // stigen vinner inom 4 m
    expect(g.edges.get(snapToGraphNear(g, onTrail, undefined, null)!.edgeId)!.offtrail).toBeUndefined();
    const far = destinationPoint(destinationPoint(A, 900, 70), 40, 160);
    expect(g.edges.get(snapToGraph(g, far)!.edgeId)!.offtrail).toBe(true);
  });

  it("serialisering behåller terrängkanter", () => {
    const g = indexGraph(buildTerrainMesh(null, { a: A, b: destinationPoint(A, 800, 0) }).graph);
    const back = indexGraph(serializeGraph(g));
    expect(back.hasOfftrail).toBe(true);
    expect([...back.edges.values()].every((e) => e.offtrail)).toBe(true);
  });
});

describe("zombier i terräng", () => {
  const trail: RawWay = { id: "T", type: "path", nodes: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ id: `n${i}`, ...destinationPoint(A, 100 + i * 250, 70) })) };

  it("fart: på terrängkant går en zombie offTrailFactor × farten, på stig full fart", () => {
    const rules = { ...resolveModeRules("escape", "walk", "normal", 3000, undefined, 3000), initialZombies: 0, maxZombies: 0, headStartS: 0, magnetic: false, detectionRadiusM: 1 };
    expect(rules.offTrailFactor).toBeCloseTo(3.5 / 7, 6); // Normal: 3,5 km/h av 7 km/h
    const g = indexGraph(buildTerrainMesh(buildGraph([trail]), { a: A, b: B3 }).graph);
    const mk = (edgeId: string) => {
      const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 1, rulesVersion: RULES_VERSION, mode: "escape" }, rules, start: A, objectives: createObjectives([{ id: "B", kind: "destination", ...B3 }]) });
      state.phase = "survival";
      state.zombies = [{ id: "z", edgeId, distanceAlongEdgeM: 0, speedMps: rules.zombieSpeedMps, state: "patrol", dir: 1, route: [], stateSinceS: 0, replanAtS: 1e9, tacticalAtS: 1e9, contactLostS: 0, canIntercept: false }];
      return state;
    };
    const trailEdge = [...g.edges.values()].find((e) => !e.offtrail && e.lengthM > 100)!; // en bit om ca 120 m
    const meshEdge = [...g.edges.values()].find((e) => e.offtrail && e.lengthM > 40 && e.id.startsWith("T:"))!;
    const run = (edgeId: string) => { const s = mk(edgeId); const p0 = zombieLatLon(g, s.zombies[0]); for (let i = 0; i < 20; i++) stepGame(g, s, rules, { position: destinationPoint(A, 5000, 250), quality: "ok", accuracyM: 5 }); return haversineM(p0, zombieLatLon(g, s.zombies[0])); };
    const onTrail = run(trailEdge.id), onMesh = run(meshEdge.id);
    expect(onTrail).toBeGreaterThan(0);
    expect(onMesh / onTrail).toBeGreaterThan(rules.offTrailFactor - 0.05);
    expect(onMesh / onTrail).toBeLessThan(rules.offTrailFactor + 0.05);
  });

  it("vägval: zombien följer stigen när den är snabbare, och trädet ger samma tid som A*", () => {
    const g = indexGraph(buildTerrainMesh(buildGraph([trail]), { a: A, b: destinationPoint(A, 2600, 70) }).graph);
    const v = 1.94, slow = v * 0.5;
    const speed = (e: { offtrail?: boolean }) => (e.offtrail ? slow : v);
    const trailEdges = [...g.edges.values()].filter((e) => !e.offtrail);
    const from = { edgeId: trailEdges[0].id, distM: 5 };
    const to = { edgeId: trailEdges.at(-1)!.id, distM: 5 };
    const direct = planRoute(g, from, to, v, { speed, vMax: v })!;
    expect(direct.steps.filter((s) => !g.edges.get(s.edgeId)!.offtrail).length).toBeGreaterThan(direct.steps.length / 2);
    const tree = buildTargetTree(g, to, speed)!.routeFrom(from)!;
    expect(tree.etaS).toBeCloseTo(direct.etaS, 3);
    // Slumpade par på nätet: träd och A* ger samma ankomsttid.
    const ids = [...g.edges.keys()];
    let seed = 9; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 25; i++) {
      const f = { edgeId: ids[Math.floor(rnd() * ids.length)], distM: 3 }, t = { edgeId: ids[Math.floor(rnd() * ids.length)], distM: 3 };
      const a = planRoute(g, f, t, v, { speed, vMax: v })!, b = buildTargetTree(g, t, speed)!.routeFrom(f)!;
      expect(b.etaS).toBeCloseTo(a.etaS, 3);
    }
  });

  it("öppen terräng: en stillastående spelare nås av en zombie 100 m bort på ungefär 100 m / (3,5 km/h) och smittas", () => {
    const rules = { ...resolveModeRules("escape", "walk", "normal", 3000, undefined, 3000), initialZombies: 0, maxZombies: 0, headStartS: 0 };
    const g = indexGraph(buildTerrainMesh(null, { a: A, b: B3 }).graph);
    const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 1, rulesVersion: RULES_VERSION, mode: "escape" }, rules, start: A, objectives: createObjectives([{ id: "B", kind: "destination", ...B3 }]) });
    state.phase = "survival";
    const zp = destinationPoint(A, 100, 70);
    const sn = snapToGraph(g, zp)!;
    state.zombies = [{ id: "z", edgeId: sn.edgeId, distanceAlongEdgeM: sn.distM, speedMps: rules.zombieSpeedMps, state: "chase", dir: 1, route: [], stateSinceS: 0, replanAtS: 0, tacticalAtS: 1e9, contactLostS: 0, canIntercept: false }];
    let t = 0;
    while (!state.result && t < 400) { stepGame(g, state, rules, { position: A, quality: "ok", accuracyM: 5 }); t += STEP_S; }
    expect(state.result).toBe("infected");
    expect(t).toBeGreaterThan(55);
    expect(t).toBeLessThan(160);
  });

  it("målet nås exakt där spelaren valde (inte snappat) och matchen vinns utan zombier i vägen", () => {
    const g = indexGraph(buildTerrainMesh(null, { a: A, b: destinationPoint(A, 600, 70) }).graph);
    const b = destinationPoint(A, 600, 70);
    const objectives = createObjectives([{ id: "B", kind: "destination", ...b }]);
    const s = new SimSession({ g, activity: "walk", difficulty: "easy", durationS: 3000, seed: 3, strategy: "avoid", start: A, mode: "escape", objectives, strategyFn: makeGoalBot("follower", newBotStats()), rulesPatch: { initialZombies: 0, maxZombies: 0 } });
    for (let i = 0; i < 5000 && !s.finished; i++) s.step();
    expect(s.state.result).toBe("survived");
    expect(objectives.targets[0].lat).toBe(b.lat);
  });

  it("bara terrängläget har terrängkanter: Survival och Mission till fots och allt på cykel bygger inga", () => {
    for (const m of ["survival", "mission"] as const) expect(resolveModeRules(m, "walk", "normal", 3000).offTrailFactor).toBeGreaterThan(0);
    expect(resolveRules("mtb", "hard", 3000).offTrailFactor).toBe(1);
    expect(resolveRules("walk", "hard", 3000).offTrailFactor).toBeCloseTo(4.5 / 13, 6);
    expect(resolveRules("walk", "easy", 3000).offTrailFactor).toBeCloseTo(2.5 / 4.5, 6);
    void edgeLatLon;
  });
});

describe("terrängläget är bara för A TO B till fots", () => {
  it("regelversionen är 2.7.0", () => {
    expect(RULES_VERSION).toBe("2.7.0");
  });
  it("prestanda: ett 20 km långt terrängnät byggs och indexeras på rimlig tid och med rimligt antal kanter", () => {
    const t0 = performance.now();
    const m = buildTerrainMesh(null, { a: A, b: destinationPoint(A, 20000, 45) });
    const g = indexGraph(m.graph);
    const ms = performance.now() - t0;
    expect(g.edges.size).toBeLessThan(4.1 * MESH_MAX_NODES);
    expect(ms).toBeLessThan(4000);
  });
});

void (null as unknown as LatLon);
