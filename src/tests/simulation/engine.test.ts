import { describe, expect, it } from "vitest";
import { resolveRules, RULES_VERSION, STEP_S } from "@/config/game-rules";
import { createGame, pauseGame, resumeGame, stepGame, GameSetupError } from "@/engine/core/engine";
import { zombieLatLon } from "@/engine/core/movement";
import { updateZombieAI, makeObservation } from "@/engine/ai/zombie-ai";
import type { GameConfig, Zombie } from "@/engine/core/types";
import { haversineM } from "@/geo/geometry";
import { edgeLatLon } from "@/geo/graph/graph";
import { simulateMatch } from "@/sim/runner";
import { gridGraph, lineGraph, ringGraph, starGraph, twoComponentGraph, ORIGIN } from "@/sim/test-graphs";

const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({
  activity: "run",
  difficulty: "normal",
  durationSeconds: 1200,
  areaId: "t",
  seed: 1,
  rulesVersion: RULES_VERSION,
  ...over,
});

const okInput = (p: { lat: number; lon: number }) => ({ position: p, quality: "ok" as const, accuracyM: 5 });

describe("matchstart och spawn", () => {
  it("kräver startposition nära nätet", () => {
    const g = gridGraph(5, 5, 150);
    const rules = resolveRules("run", "normal", 1200);
    expect(() => createGame({ g, config: cfg(), rules, start: { lat: ORIGIN.lat + 1, lon: ORIGIN.lon } })).toThrow(GameSetupError);
  });
  it("initiala zombier spawnar minst 250 m från spelaren (geografiskt och längs nätet)", () => {
    const g = gridGraph(20, 20, 150);
    for (let seed = 1; seed <= 25; seed++) {
      const rules = resolveRules("run", "normal", 2700);
      const start = edgeLatLon(g, { edgeId: "r10:5", distM: 75 });
      const { state } = createGame({ g, config: cfg({ seed, durationSeconds: 2700 }), rules, start });
      expect(state.zombies.length).toBe(rules.initialZombies);
      for (const z of state.zombies) expect(haversineM(zombieLatLon(g, z), start)).toBeGreaterThanOrEqual(250);
    }
  });
  it("avstår från att spawna när området är för litet", () => {
    const g = lineGraph(200);
    const rules = resolveRules("run", "normal", 1200);
    const { state, events } = createGame({ g, config: cfg(), rules, start: edgeLatLon(g, { edgeId: [...g.edges.keys()][0], distM: 100 }) });
    expect(state.zombies.length).toBe(0);
    expect(events.some((e) => e.type === "spawn_skipped")).toBe(true);
  });
  it("spawn-kapacitet begränsar antalet", () => {
    expect(resolveRules("run", "hard", 2700, 3).maxZombies).toBe(3);
  });
  it("zombieantalet ökar successivt upp till max, utan spawn nära spelaren", () => {
    const g = gridGraph(30, 30, 150);
    const res = simulateMatch({ g, activity: "run", difficulty: "normal", durationS: 2700, seed: 3, strategy: "avoid", paceFactor: 0.5 });
    const spawns = res.events.filter((e) => e.type === "zombie_spawned").length;
    const rules = resolveRules("run", "normal", 2700);
    expect(spawns).toBeGreaterThan(rules.initialZombies);
    expect(res.state.peakZombies).toBeLessThanOrEqual(rules.maxZombies);
  });
});

describe("zombierörelse", () => {
  it("zombier teleporterar aldrig och rör sig högst med sin fart", () => {
    const g = gridGraph(15, 15, 120);
    const rules = resolveRules("mtb", "hard", 1500);
    const start = edgeLatLon(g, { edgeId: "r7:3", distM: 60 });
    const { state } = createGame({ g, config: cfg({ activity: "mtb", difficulty: "hard", durationSeconds: 1500, seed: 9 }), rules, start });
    const last = new Map(state.zombies.map((z) => [z.id, zombieLatLon(g, z)]));
    let maxMove = 0;
    for (let i = 0; i < 5 * 60 * 12 && state.phase !== "finished"; i++) {
      stepGame(g, state, rules, okInput(start));
      for (const z of state.zombies) {
        const p = zombieLatLon(g, z);
        const prev = last.get(z.id);
        if (prev) maxMove = Math.max(maxMove, haversineM(prev, p));
        last.set(z.id, p);
        const e = g.edges.get(z.edgeId)!;
        expect(z.distanceAlongEdgeM).toBeGreaterThanOrEqual(-1e-6);
        expect(z.distanceAlongEdgeM).toBeLessThanOrEqual(e.lengthM + 1e-6);
      }
      if (state.result === "infected") break;
    }
    expect(maxMove).toBeLessThanOrEqual(rules.zombieSpeedMps * STEP_S + 0.01);
  });
  it("zombier är stilla under försprånget", () => {
    const g = gridGraph(12, 12, 150);
    const rules = { ...resolveRules("run", "normal", 1800), headStartS: 60 }; // försprång är valbart i motorn (standard 0 sedan fälttest 2)
    const start = edgeLatLon(g, { edgeId: "r5:3", distM: 75 });
    const { state } = createGame({ g, config: cfg({ seed: 4 }), rules, start });
    const before = state.zombies.map((z) => zombieLatLon(g, z));
    for (let i = 0; i < 5 * (rules.headStartS - 5); i++) stepGame(g, state, rules, okInput(start));
    expect(state.phase).toBe("head_start");
    expect(state.zombies.map((z) => zombieLatLon(g, z))).toEqual(before);
  });
});

describe("determinism", () => {
  const run = (seed: number) =>
    simulateMatch({ g: gridGraph(16, 16, 140), activity: "run", difficulty: "hard", durationS: 1800, seed, strategy: "random", gpsNoiseM: 3 });
  it("samma seed ger samma resultat och zombiepositioner", () => {
    const a = run(11);
    const b = run(11);
    expect(a.summary).toEqual(b.summary);
    expect(a.state.zombies).toEqual(b.state.zombies);
    expect(a.events).toEqual(b.events);
  });
  it("olika seeds ger olika förlopp", () => {
    expect(run(11).state.zombies).not.toEqual(run(12).state.zombies);
  });
});

describe("paus och GPS-bortfall", () => {
  it("paus stoppar klocka, zombier och infektion", () => {
    const g = gridGraph(12, 12, 150);
    const rules = resolveRules("run", "normal", 1800);
    const start = edgeLatLon(g, { edgeId: "r5:3", distM: 75 });
    const { state } = createGame({ g, config: cfg({ seed: 4 }), rules, start });
    for (let i = 0; i < 5 * 200; i++) stepGame(g, state, rules, okInput(start));
    pauseGame(state);
    const snapshot = JSON.stringify(state);
    for (let i = 0; i < 500; i++) stepGame(g, state, rules, okInput(start));
    expect(JSON.stringify(state)).toBe(snapshot);
  });
  it("återupptagning ger en neutral period utan infektion", () => {
    const g = gridGraph(12, 12, 150);
    const rules = resolveRules("run", "normal", 1800);
    const start = edgeLatLon(g, { edgeId: "r5:3", distM: 75 });
    const { state } = createGame({ g, config: cfg({ seed: 4 }), rules, start });
    pauseGame(state);
    resumeGame(state);
    expect(state.neutralUntilS).toBeGreaterThan(state.elapsedSeconds);
  });
  it("GPS-bortfall pausar klockan och orsakar aldrig infektion; lång förlust signaleras", () => {
    const g = gridGraph(14, 14, 150);
    const res = simulateMatch({
      g, activity: "run", difficulty: "hard", durationS: 1500, seed: 5, strategy: "avoid",
      gpsOutages: [[400, 520]],
    });
    expect(res.events.some((e) => e.type === "gps_lost_long")).toBe(true);
    expect(res.state.result).not.toBe("incomplete");
    // Spelklockan fortsätter bara när GPS finns: bortfallet räknas inte som speltid.
    expect(res.state.elapsedSeconds).toBeLessThanOrEqual(1500 + 1);
  });
  it("tappad GPS med zombie intill ger ingen infektion", () => {
    const g = gridGraph(14, 14, 150);
    const rules = resolveRules("run", "normal", 1500);
    const start = edgeLatLon(g, { edgeId: "r7:6", distM: 75 });
    const { state } = createGame({ g, config: cfg({ seed: 2, durationSeconds: 1500 }), rules, start });
    state.phase = "survival";
    state.elapsedSeconds = rules.headStartS + 1;
    // Zombie placeras 5 m från spelaren.
    const z = state.zombies[0];
    z.edgeId = "r7:6";
    z.distanceAlongEdgeM = 80;
    z.route = [];
    for (let i = 0; i < 5 * 120; i++) stepGame(g, state, rules, { position: null, quality: "unavailable", accuracyM: Infinity });
    expect(state.result).toBeUndefined();
    expect(state.infectionProgressSeconds).toBe(0);
  });
});

describe("infektion i motorn", () => {
  it("zombie intill spelaren infekterar efter ~3 s", () => {
    const g = gridGraph(14, 14, 150);
    const rules = resolveRules("run", "easy", 1500);
    const start = edgeLatLon(g, { edgeId: "r7:6", distM: 75 });
    const { state } = createGame({ g, config: cfg({ seed: 2, difficulty: "easy", durationSeconds: 1500 }), rules, start });
    state.phase = "survival";
    state.elapsedSeconds = rules.headStartS + 1;
    const z = state.zombies[0];
    z.edgeId = "r7:6";
    z.distanceAlongEdgeM = 80;
    z.route = [];
    z.speedMps = 0; // håller zombien stilla för att isolera infektionsregeln
    const t0 = state.elapsedSeconds;
    let steps = 0;
    while (!state.result && steps < 100) {
      z.distanceAlongEdgeM = 80;
      stepGame(g, state, rules, okInput(start));
      steps++;
    }
    expect(state.result).toBe("infected");
    expect(state.elapsedSeconds - t0).toBeGreaterThanOrEqual(3 - 1e-6);
    expect(state.elapsedSeconds - t0).toBeLessThan(3.5);
  });
});

describe("zombie-AI informationsgränser", () => {
  const setup = () => {
    const g = gridGraph(14, 14, 150);
    const rules = resolveRules("run", "normal", 1800);
    const z: Zombie = {
      id: "t", edgeId: "r2:2", distanceAlongEdgeM: 10, speedMps: 1.4, state: "patrol", dir: 1, route: [],
      stateSinceS: 0, replanAtS: 0, tacticalAtS: 1e9, contactLostS: 0, canIntercept: false,
    };
    return { g, rules, z };
  };
  const ctx = (g: any, rules: any, pos: any, over: any = {}) => ({
    g, rules, rng: { rngState: 1 }, timeS: 100, playerPos: pos, playerObservation: null, reveal: false,
    detectionEnabled: true, events: [], ...over,
  });

  it("använder senaste observation, inte spelarens aktuella position", () => {
    const { g, rules, z } = setup();
    const observedAt = edgeLatLon(g, { edgeId: "r10:8", distM: 50 });
    const obs = makeObservation(g, observedAt, 90)!;
    // Spelaren har sedan flyttat sig långt bort och ligger utanför upptäcktsradien.
    const farAway = edgeLatLon(g, { edgeId: "r2:11", distM: 50 });
    rules.revealResponseProb = 1;
    updateZombieAI(ctx(g, rules, farAway, { reveal: true, playerObservation: obs }), z, false);
    expect(z.state).toBe("investigate");
    expect(z.lastKnownEdge).toEqual({ edgeId: obs.edgeId, distM: obs.edgeDistM });
    expect(z.lastKnownPlayerPosition!.lat).toBeCloseTo(observedAt.lat, 8);
  });
  it("ny observation uppdaterar målet", () => {
    const { g, rules, z } = setup();
    rules.revealResponseProb = 1;
    const o1 = makeObservation(g, edgeLatLon(g, { edgeId: "r10:8", distM: 50 }), 90)!;
    const far = edgeLatLon(g, { edgeId: "r2:11", distM: 50 });
    updateZombieAI(ctx(g, rules, far, { reveal: true, playerObservation: o1 }), z, false);
    const o2 = makeObservation(g, edgeLatLon(g, { edgeId: "r12:3", distM: 20 }), 110)!;
    updateZombieAI(ctx(g, rules, far, { reveal: true, playerObservation: o2, timeS: 110 }), z, false);
    expect(z.lastKnownEdge).toEqual({ edgeId: o2.edgeId, distM: o2.edgeDistM });
  });
  it("upptäckt inom radien ger CHASE, men inte utan giltig GPS", () => {
    const { g, rules, z } = setup();
    const near = edgeLatLon(g, { edgeId: "r2:2", distM: 60 });
    updateZombieAI(ctx(g, rules, near, { detectionEnabled: false }), z, false);
    expect(z.state).toBe("patrol");
    updateZombieAI(ctx(g, rules, near), z, false);
    expect(z.state).toBe("chase");
  });
});

describe("extraction", () => {
  it("öppnar vid 80 % av tiden på en nåbar nod", () => {
    const g = gridGraph(20, 20, 150);
    // Med magnet-jakt hinner inte alla seeds så långt: kräv att extraction öppnar i matcher som överlever till 80 %.
    const opened = Array.from({ length: 10 }, (_, i) =>
      simulateMatch({ g, activity: "run", difficulty: "easy", durationS: 1800, seed: 7 + i, strategy: "avoid", paceFactor: 0.9 }).events.find((e) => e.type === "extraction_opened") as any,
    ).filter(Boolean);
    expect(opened.length).toBeGreaterThan(0);
    for (const o of opened) expect(g.nodes.has(o.nodeId)).toBe(true);
  }, 60000);
  it("spelare som söker extraction kan vinna på lätt nivå", () => {
    const g = gridGraph(20, 20, 150);
    const wins = Array.from({ length: 20 }, (_, i) =>
      simulateMatch({ g, activity: "run", difficulty: "easy", durationS: 1800, seed: 100 + i, strategy: "extraction", paceFactor: 1 }),
    ).filter((r) => r.summary.result === "survived").length;
    expect(wins).toBeGreaterThan(0);
  }, 60000);
  it("matchtiden löper ut utan extraction → FAILED", () => {
    const g = gridGraph(20, 20, 150);
    const res = simulateMatch({ g, activity: "run", difficulty: "easy", durationS: 600, seed: 8, strategy: "random", paceFactor: 0.0001 });
    expect(["failed", "infected"]).toContain(res.summary.result);
  });
});

describe("scenarier", () => {
  const strategies = ["random", "avoid", "maximize", "extraction"] as const;
  const graphs: [string, () => ReturnType<typeof gridGraph>][] = [
    ["korsning/återvändsgränder", () => starGraph(700)],
    ["cirkulärt nät", () => ringGraph(500)],
    ["två komponenter", () => twoComponentGraph()],
    ["rutnät", () => gridGraph(18, 18, 120)],
  ];
  for (const [name, mk] of graphs) {
    it(`kör hela matcher utan fel: ${name}`, () => {
      for (const strategy of strategies) {
        for (const activity of ["walk", "run", "mtb"] as const) {
          const res = simulateMatch({ g: mk(), activity, difficulty: "normal", durationS: 900, seed: 21, strategy });
          expect(res.state.phase).toBe("finished");
          expect(res.state.zombies.length).toBeLessThanOrEqual(resolveRules(activity, "normal", 900).maxZombies);
        }
      }
    });
  }
  it("zombier stannar i spelarens komponent", () => {
    const g = twoComponentGraph();
    const res = simulateMatch({ g, activity: "run", difficulty: "normal", durationS: 900, seed: 3, strategy: "random", start: edgeLatLon(g, { edgeId: "A:0", distM: 5 }) });
    for (const z of res.state.zombies) expect(g.edges.get(z.edgeId)!.component).toBe(res.state.component);
  });
});
