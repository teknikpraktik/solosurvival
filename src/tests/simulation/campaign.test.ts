import { describe, expect, it } from "vitest";
import { missionObjectives, missionRules } from "@/campaign/setup";
import { trimCourse } from "@/campaign/prepare";
import { THE_FALL } from "@/campaign/the-fall";
import type { Difficulty } from "@/config/difficulty";
import { STEP_S, type Rules } from "@/config/game-rules";
import { TRACK_SAMPLES, createGame, stepGame } from "@/engine/core/engine";
import { zombieLatLon } from "@/engine/core/movement";
import type { GameEvent, GameState } from "@/engine/core/types";
import { createObjectives } from "@/engine/objectives/objectives";
import { haversineM } from "@/geo/geometry";
import { edgeLatLon, indexGraph, serializeGraph } from "@/geo/graph/graph";
import type { TrailGraph } from "@/geo/graph/types";
import { generateCourse } from "@/routes/course";
import { makeGoalBot, newBotStats } from "@/sim/bots";
import { SimSession, simulateMatch } from "@/sim/runner";
import { gridGraph } from "@/sim/test-graphs";

const c = THE_FALL;
const mission = (id: string) => c.missions.find((m) => m.id === id)!;
const grid = gridGraph(14, 14, 120);
const at = (g: TrailGraph, edgeId: string, distM: number) => edgeLatLon(g, { edgeId, distM });

/** A match with one zombie placed by hand, the player walking along row 6. */
function chase(g: TrailGraph, rules: Rules, zombieAt: { edgeId: string; distM: number }) {
  const start = at(g, "r6:2", 10);
  const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 9, rulesVersion: "t", mode: "survival" }, rules, start });
  const z = state.zombies[0];
  Object.assign(z, { edgeId: zombieAt.edgeId, distanceAlongEdgeM: zombieAt.distM, canIntercept: true, route: [], stopAtM: undefined, state: "patrol", tacticalAtS: 12 });
  state.zombies.length = 1;
  return { state, z };
}
/** Walks the player along row 6 at `xM` metres per second (negative = west) for `seconds`, from the x position `fromM`. */
function walk(g: TrailGraph, state: GameState, rules: Rules, fromM: number, mps: number, seconds: number): { events: GameEvent[]; x: number } {
  const events: GameEvent[] = [];
  let x = fromM;
  for (let i = 0; i < seconds / STEP_S && state.phase !== "finished"; i++) {
    x += mps * STEP_S;
    const seg = Math.max(0, Math.min(12, Math.floor(x / 120)));
    events.push(...stepGame(g, state, rules, { position: at(g, `r6:${seg}`, x - seg * 120), quality: "ok", accuracyM: 5 }));
  }
  return { events, x };
}
const base = (patch: Partial<Rules> = {}): Rules => ({ ...missionRules(mission("03"), "normal", 3000, 1500), initialZombies: 1, maxZombies: 1, growthPerMin: 0, interceptShare: 1, ...patch });

describe("interception from the player's track (reusable zombie AI, behind rules.interceptModel)", () => {
  it("an interceptor leaves the chase for a junction ahead of the player that it can reach first", () => {
    const rules = base();
    // The zombie is north-east of the player, three rows up: following would be a stern chase, cutting down a column gets ahead.
    const { state, z } = chase(grid, rules, { edgeId: "r3:6", distM: 0 });
    const { events, x } = walk(grid, state, rules, 250, 1.3, 40);
    expect(events.filter((e) => e.type === "zombie_intercept")).toEqual([{ type: "zombie_intercept", zombieId: z.id }]);
    expect(z.state).toBe("intercept");
    const node = grid.nodes.get(z.targetNodeId!)!;
    const player = at(grid, `r6:${Math.floor(x / 120)}`, x % 120);
    // The target is a junction on the player's row, ahead of the player.
    expect(Math.abs(node.lat - player.lat)).toBeLessThan(1e-5);
    expect(node.lon).toBeGreaterThan(player.lon);
    expect(state.player.track!.length).toBeGreaterThan(2);
    expect(state.player.track!.length).toBeLessThanOrEqual(TRACK_SAMPLES);
  });

  it("the player can fool it: turning back makes the interceptor give up its junction and follow again", () => {
    const rules = base();
    const { state, z } = chase(grid, rules, { edgeId: "r3:6", distM: 0 });
    const out = walk(grid, state, rules, 250, 1.3, 40);
    expect(z.state).toBe("intercept");
    const target = z.targetNodeId;
    // It keeps the plan for a while (no perfect knowledge): right after the turn it is still heading for the old junction.
    const turn = walk(grid, state, rules, out.x, -1.3, 4);
    expect(z.state).toBe("intercept");
    expect(z.targetNodeId).toBe(target);
    // Within half a minute of the turn it has let go of that junction; a later attempt is for a junction on the player's new way (west).
    let x = turn.x, gaveUp = false;
    for (let i = 0; i < 30 && !gaveUp; i++) { x = walk(grid, state, rules, x, -1.3, 1).x; gaveUp = z.state === "chase" && z.targetNodeId === undefined; }
    expect(gaveUp).toBe(true);
    for (let i = 0; i < 60 && z.state !== "intercept"; i++) x = walk(grid, state, rules, x, -1.3, 1).x;
    if (z.state === "intercept") {
      expect(z.targetNodeId).not.toBe(target);
      expect(grid.nodes.get(z.targetNodeId!)!.lon).toBeLessThan(at(grid, `r6:${Math.floor(x / 120)}`, x % 120).lon);
    }
  });

  it("a player who stands still gives no direction, so nobody cuts ahead", () => {
    const rules = base();
    const { state, z } = chase(grid, rules, { edgeId: "r3:6", distM: 0 });
    const { events } = walk(grid, state, rules, 250, 0, 60);
    expect(events.some((e) => e.type === "zombie_intercept")).toBe(false);
    expect(z.state).toBe("chase");
  });

  it("only the share the rules give may intercept: with none, every zombie simply follows", () => {
    const rules = base({ interceptShare: 0 });
    const { state } = chase(grid, rules, { edgeId: "r3:6", distM: 0 });
    state.zombies[0].canIntercept = false;
    expect(walk(grid, state, rules, 250, 1.3, 60).events.some((e) => e.type === "zombie_intercept")).toBe(false);
  });

  it("it also works when the graph has terrain edges (the live game's lattice), which stops the original model", () => {
    const raw = serializeGraph(grid);
    const a = raw.nodes.find((n) => n.id === "g0_0")!, b = raw.nodes.find((n) => n.id === "g1_1")!;
    const mesh = indexGraph({ ...raw, edges: [...raw.edges, { id: "mesh:0", from: a.id, to: b.id, geometry: [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }], type: "other", offtrail: true }] });
    expect(mesh.hasOfftrail).toBe(true);
    const track = base();
    const t = chase(mesh, track, { edgeId: "r3:6", distM: 0 });
    expect(walk(mesh, t.state, track, 250, 1.3, 40).events.some((e) => e.type === "zombie_intercept")).toBe(true);
    // New zombies: the original model never lets them intercept on such a graph; the track model follows the share.
    const spawned = (rules: Rules) => createGame({ g: mesh, config: { activity: "walk", difficulty: "hard", durationSeconds: 900, areaId: "t", seed: 2, rulesVersion: "t", mode: "survival" }, rules: { ...rules, initialZombies: 8, maxZombies: 8 }, start: at(mesh, "r6:6", 10) }).state.zombies;
    expect(spawned(base({ interceptModel: undefined })).every((z) => !z.canIntercept)).toBe(true);
    expect(spawned(base()).every((z) => z.canIntercept)).toBe(true);
  });

  it("the original model is untouched without the flag: no track is kept and no interception event is sent", () => {
    const rules = base({ interceptModel: undefined });
    const { state } = chase(grid, rules, { edgeId: "r3:6", distM: 0 });
    const { events } = walk(grid, state, rules, 250, 1.3, 60);
    expect(state.player.track).toBeUndefined();
    expect(events.some((e) => e.type === "zombie_intercept")).toBe(false);
  });
});

describe("mission rules in the engine", () => {
  const start = at(grid, "r7:6", 60);
  const game = (rules: Rules, mode: "survival" | "mission" | "escape" = "survival") =>
    createGame({ g: grid, config: { activity: "walk", difficulty: "normal", durationSeconds: rules.durationS, areaId: "t", seed: 3, rulesVersion: "t", mode }, rules, start }).state;

  it("mission 01: the clock running down is the win, and bad GPS neither moves the clock nor ends the mission", () => {
    const rules = { ...missionRules(mission("01"), "easy", 60), initialZombies: 1, maxZombies: 1, growthPerMin: 0 };
    const s = game(rules);
    // A minute without location: the clock stands still.
    for (let i = 0; i < 300; i++) stepGame(grid, s, rules, { position: null, quality: "unavailable", accuracyM: Infinity });
    expect(s.elapsedSeconds).toBe(0);
    expect(s.phase).not.toBe("finished");
    const ev: GameEvent[] = [];
    for (let i = 0; i < 320 && s.phase !== "finished"; i++) ev.push(...stepGame(grid, s, rules, { position: start, quality: "infection_paused", accuracyM: 30 }));
    expect(s.result).toBe("survived");
    expect(s.elapsedSeconds).toBeCloseTo(60, 1);
    expect(ev.some((e) => e.type === "extraction_opened" || e.type === "extraction_unavailable")).toBe(false);
  });

  it("the same clock in Free Play Survival is a loss (unchanged)", () => {
    const rules = { ...missionRules(mission("01"), "easy", 60), winOnTimeout: undefined, initialZombies: 1, maxZombies: 1, growthPerMin: 0 };
    const s = game(rules);
    for (let i = 0; i < 320 && s.phase !== "finished"; i++) stepGame(grid, s, rules, { position: start, quality: "infection_paused", accuracyM: 30 });
    expect(s.result).toBe("failed");
  });

  it("mission 01 begins with few infected and the number grows to its maximum, never beyond", () => {
    for (const d of ["easy", "normal", "hard"] as Difficulty[]) {
      const rules = missionRules(mission("01"), d, 900);
      const s = game(rules);
      expect(s.zombies.length).toBe(rules.initialZombies);
      for (const z of s.zombies) expect(haversineM(zombieLatLon(grid, z), start)).toBeGreaterThanOrEqual(rules.startMinDistanceM - 1);
      for (let i = 0; i < 4400 && s.phase !== "finished"; i++) stepGame(grid, s, rules, { position: start, quality: "infection_paused", accuracyM: 30 });
      // Zombies standing in a pile on a still player are thinned out and not replaced, so count them too.
      expect(s.zombies.length + (s.culledZombies ?? 0)).toBe(rules.maxZombies);
      expect(s.peakZombies).toBeLessThanOrEqual(rules.maxZombies);
    }
  });

  it("mission 05: the director makes the infected faster late in the mission, and faster again when the helicopter has landed", () => {
    const rules = { ...missionRules(mission("05"), "normal", 1800), initialZombies: 1, maxZombies: 1, growthPerMin: 0 };
    const s = game(rules);
    const z = s.zombies[0];
    const speedAt = (t: number) => {
      s.elapsedSeconds = t;
      z.sprintUntilS = undefined; z.sprintReadyAtS = Infinity;
      const before = { ...z };
      const p0 = zombieLatLon(grid, z);
      stepGame(grid, s, rules, { position: start, quality: "infection_paused", accuracyM: 30 });
      const moved = haversineM(p0, zombieLatLon(grid, z)) / STEP_S;
      void before;
      return moved;
    };
    const early = speedAt(200), mid = speedAt(900), late = speedAt(1250);
    expect(early).toBeCloseTo(rules.zombieSpeedMps, 1);
    expect(mid / early).toBeCloseTo(1.05, 1);
    expect(late / early).toBeCloseTo(1.12, 1);
    const rush = speedAt(1400);
    expect(s.phase).toBe("extraction");
    expect(rush / early).toBeCloseTo(1.12 * 1.3, 1);
    expect(s.extractionNodeId).toBeTruthy();
    // The landing zone is a walkable distance away and not on top of the player.
    const lz = grid.nodes.get(s.extractionNodeId!)!;
    expect(haversineM(lz, start)).toBeGreaterThan(40);
    expect(haversineM(lz, start)).toBeLessThan(450);
  });

  it("mission 05: if no landing zone can be chosen when the helicopter arrives, the game keeps trying instead of leaving the player without one", () => {
    const rules = { ...missionRules(mission("05"), "normal", 1800), initialZombies: 1, maxZombies: 1, growthPerMin: 0 };
    const s = game(rules);
    s.elapsedSeconds = 1319.5;
    const real = s.component;
    s.component = 999; // no node of that component: nothing can be chosen
    const ev: GameEvent[] = [];
    for (let i = 0; i < 10; i++) ev.push(...stepGame(grid, s, rules, { position: start, quality: "infection_paused", accuracyM: 30 }));
    expect(ev.some((e) => e.type === "extraction_unavailable")).toBe(true);
    expect(s.extractionNodeId).toBeUndefined();
    s.component = real;
    for (let i = 0; i < 90 && !s.extractionNodeId; i++) ev.push(...stepGame(grid, s, rules, { position: start, quality: "infection_paused", accuracyM: 30 }));
    expect(s.extractionNodeId).toBeTruthy();
    expect(ev.filter((e) => e.type === "extraction_opened")).toHaveLength(1);
  });
});

describe("whole missions, simulated (a bot on a street grid; not field evidence)", () => {
  const start = at(grid, "r7:6", 60);
  const course = trimCourse(generateCourse(grid, { start, activity: "walk", targetLengthM: 1500, seed: 5, count: 3 }).proposals[0], start, 3, 2)!;
  const dest = createObjectives([{ id: "B", kind: "destination", ...at(grid, "r2:11", 0) }]);
  const run = (id: string, difficulty: Difficulty, seed: number, paceFactor: number) => {
    const m = mission(id);
    const objectives = m.layout.kind === "checkpoints" ? missionObjectives(m, course, difficulty) : m.layout.kind === "destination" ? structuredClone(dest) : undefined;
    const durationS = m.layout.kind === "survive" || m.layout.kind === "extraction" ? m.layout.durationS : 1800;
    const rules = missionRules(m, difficulty, durationS, 1000);
    return simulateMatch({
      g: grid, activity: "walk", difficulty, durationS, seed, start, mode: m.mode, objectives, paceFactor, rulesPatch: rules,
      strategy: m.layout.kind === "extraction" ? "extraction" : "avoid", strategyFn: objectives ? makeGoalBot("planner", newBotStats()) : undefined,
    });
  };
  const seeds = [1, 2, 3, 4, 5, 6];
  const wins = (id: string, d: Difficulty, pace: number) => seeds.filter((s) => run(id, d, s, pace).summary.result === "survived").length;

  it("every mission ends with a legal result at every level, and a win is possible", () => {
    for (const m of c.missions) for (const d of ["easy", "normal", "hard"] as Difficulty[]) {
      for (const seed of [1, 2]) {
        const r = run(m.id, d, seed, 1.6);
        expect(["survived", "infected", "failed"]).toContain(r.summary.result);
        expect(r.summary.survivedSeconds).toBeLessThanOrEqual(r.summary.durationSeconds + 1);
      }
    }
    // On Easy a brisk walker gets through each mission at least sometimes (the bot is far from a clever player).
    for (const m of c.missions) expect(wins(m.id, "easy", 1.3)).toBeGreaterThan(0);
  });

  it("mission 01 on Easy is forgiving for a walker, and mission 01 is never harder than the finale for the same bot", () => {
    expect(wins("01", "easy", 1.0)).toBeGreaterThanOrEqual(4);
    for (const d of ["easy", "normal"] as Difficulty[]) expect(wins("01", d, 1.6)).toBeGreaterThanOrEqual(wins("05", d, 1.6));
  });

  it("difficulty separates: Hard is never easier than Easy for the same bot and seeds", () => {
    for (const id of ["01", "03", "05"]) expect(wins(id, "easy", 1.6)).toBeGreaterThanOrEqual(wins(id, "hard", 1.6));
  });

  it("a won mission 01 ends exactly at its 15 minutes; a won mission 05 ends at the helicopter after it has landed", () => {
    const w1 = seeds.map((s) => run("01", "easy", s, 1.3)).find((r) => r.summary.result === "survived")!;
    expect(w1.summary.survivedSeconds).toBe(900);
    const w5 = seeds.map((s) => run("05", "easy", s, 1.6)).find((r) => r.summary.result === "survived");
    if (w5) {
      expect(w5.summary.survivedSeconds).toBeGreaterThanOrEqual(22 * 60);
      expect(w5.events.some((e) => e.type === "extraction_opened")).toBe(true);
    }
  });

  it("interceptors appear in missions 03 and 05 and not in mission 01", () => {
    const count = (id: string) => seeds.reduce((n, s) => n + run(id, "normal", s, 1.6).events.filter((e) => e.type === "zombie_intercept").length, 0);
    expect(count("01")).toBe(0);
    expect(count("03") + count("05")).toBeGreaterThan(0);
  });

  it("is deterministic: the same seed gives the same match", () => {
    const a = run("05", "normal", 3, 1.6), b = run("05", "normal", 3, 1.6);
    expect(a.summary).toEqual(b.summary);
    expect(new SimSession({ g: grid, activity: "walk", difficulty: "normal", durationS: 900, seed: 1, strategy: "avoid", start }).rules.interceptModel).toBeUndefined();
  });
});
