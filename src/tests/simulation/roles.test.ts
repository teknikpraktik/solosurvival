/**
 * Zombie AI with roles (rules.zombieAi === "roles", engine/ai/roles.ts, docs/ZOMBIE-AI-ROLES.md).
 * Hand-built networks: a street grid, a hairpin with a terrain lattice between the legs, a triangle with a slow short cut, two trails with
 * water between them. Each test names the scenario from the task it covers.
 */
import { describe, expect, it } from "vitest";
import { ZOMBIE_AI, roleForIndex } from "@/config/zombie-ai";
import { STEP_S, applyZombieAi, resolveRules, type Rules } from "@/config/game-rules";
import { createGame, stepGame } from "@/engine/core/engine";
import { advanceZombie, zombieLatLon } from "@/engine/core/movement";
import type { GameState, Observation, Zombie } from "@/engine/core/types";
import { estimateMotion, forecast, interceptorStep, roleOf, scoreCandidates, type RoleCtx } from "@/engine/ai/roles";
import { updateZombieAI } from "@/engine/ai/zombie-ai";
import { fromLocal, haversineM, toLocal, type LatLon } from "@/geo/geometry";
import { edgeLatLon, indexGraph, snapToGraph } from "@/geo/graph/graph";
import type { GraphNode, RawEdge, TrailGraph } from "@/geo/graph/types";
import { ORIGIN, gridGraph } from "@/sim/test-graphs";
import { resolveMatchRules } from "@/play/rules";
import { planRoute } from "@/engine/pathfinding/astar";
import { LiveGame } from "@/play/live-game";
import { emptyCounters } from "@/play/live-game";

const xy = (x: number, y: number): LatLon => fromLocal(ORIGIN, { x, y });
const local = (p: LatLon) => toLocal(ORIGIN, p);

/** A network from points (m, local) and edges; `off` marks terrain edges. */
function net(points: Record<string, [number, number]>, edges: [string, string, boolean?][]): TrailGraph {
  const nodes: GraphNode[] = Object.entries(points).map(([id, [x, y]]) => ({ id, ...xy(x, y) }));
  const at = new Map(nodes.map((n) => [n.id, n]));
  const raw: RawEdge[] = edges.map(([a, b, off], i) => ({ id: `e${i}:${a}-${b}`, from: a, to: b, geometry: [at.get(a)!, at.get(b)!].map((n) => ({ lat: n.lat, lon: n.lon })), type: off ? "other" : "path", ...(off ? { offtrail: true } : {}) }));
  return indexGraph({ graphVersion: "1.0", source: "test", nodes, edges: raw });
}

/** Observations every 4 s of a player walking from `from` in direction (dx, dy) at `v` m/s, the newest at `t`. */
function trackAlong(g: TrailGraph, from: [number, number], dx: number, dy: number, v: number, t: number, n = 6, noise?: () => [number, number]): Observation[] {
  const out: Observation[] = [];
  let prev: { edgeId: string; distM: number } | null = null;
  for (let i = n - 1; i >= 0; i--) {
    const back = v * 4 * i;
    const [nx, ny] = noise ? noise() : [0, 0];
    const p = xy(from[0] - dx * back + nx, from[1] - dy * back + ny);
    const s = snapToGraph(g, p)!;
    out.push({ lat: p.lat, lon: p.lon, observedAtS: t - 4 * i, edgeId: s.edgeId, edgeDistM: s.distM });
    prev = s;
  }
  void prev;
  return out;
}

const walkRules = (patch: Partial<Rules> = {}): Rules => ({ ...applyZombieAi(resolveRules("walk", "normal", 3000), "roles"), initialZombies: 1, maxZombies: 1, growthPerMin: 0, headStartS: 0, ...patch });

function zombieAt(g: TrailGraph, p: [number, number], rules: Rules, over: Partial<Zombie> = {}): Zombie {
  const s = snapToGraph(g, xy(...p))!;
  return { id: "z2", edgeId: s.edgeId, distanceAlongEdgeM: s.distM, speedMps: rules.zombieSpeedMps, state: "chase", dir: 1, route: [], stateSinceS: -100, replanAtS: 0, tacticalAtS: 0, contactLostS: 0, canIntercept: false, role: "interceptor", ...over };
}

function decide(g: TrailGraph, rules: Rules, z: Zombie, track: Observation[], t: number, zombies: Zombie[] = [z]) {
  const ctx: RoleCtx = { g, rules, rng: { rngState: 7 }, timeS: t, track, zombies, events: [] };
  interceptorStep(ctx, z);
  return ctx.events;
}
const meetingXY = (z: Zombie) => local(z.meeting!);
const usesTerrain = (g: TrailGraph, z: Zombie) => z.route.some((s) => g.edges.get(s.edgeId)!.offtrail) || !!g.edges.get(z.edgeId)!.offtrail;

describe("roles: assignment and switch", () => {
  it("about 30 % interceptors, dealt out by spawn order (never all or none in a small group)", () => {
    const count = (n: number) => Array.from({ length: n }, (_, i) => roleForIndex(i)).filter((r) => r === "interceptor").length;
    expect([count(1), count(2), count(3), count(4), count(6), count(10), count(15), count(20)]).toEqual([0, 0, 1, 1, 2, 3, 4, 6]);
  });

  it("new zombies get a role for life; the draw for the old interception is still made, so spawns are where they were", () => {
    const g = gridGraph(14, 14, 120);
    const start = edgeLatLon(g, { edgeId: "r7:5", distM: 60 });
    const make = (rules: Rules) => createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 1800, areaId: "t", seed: 4, rulesVersion: "t", mode: "survival" }, rules: { ...rules, initialZombies: 10, maxZombies: 10 }, start }).state.zombies;
    const old = make(resolveRules("walk", "normal", 1800));
    const roles = make(applyZombieAi(resolveRules("walk", "normal", 1800), "roles"));
    expect(roles.map((z) => [z.edgeId, z.distanceAlongEdgeM])).toEqual(old.map((z) => [z.edgeId, z.distanceAlongEdgeM]));
    expect(roles.filter((z) => z.role === "interceptor").length).toBe(3);
    expect(roles.every((z) => !z.canIntercept)).toBe(true);
    expect(old.every((z) => z.role === undefined)).toBe(true);
  });

  it("a match's AI follows its saved parameters: roles only when asked, never in a campaign mission", () => {
    expect(resolveMatchRules({ mode: "survival", activity: "walk", difficulty: "normal" }, 1800).zombieAi).toBeUndefined();
    const r = resolveMatchRules({ mode: "survival", activity: "mtb", difficulty: "hard", zombieAi: "roles" }, 1800);
    expect([r.zombieAi, r.interceptShare, r.interceptModel]).toEqual(["roles", ZOMBIE_AI.interceptorShare, undefined]);
    const camp = resolveMatchRules({ mode: "mission", activity: "walk", difficulty: "normal", zombieAi: "roles", campaign: { id: "the-fall", mission: "03" } }, 1800, 1500);
    expect([camp.zombieAi, camp.interceptModel]).toEqual([undefined, "track"]);
  });
});

describe("roles: reading the player's movement (scenario 5: standing still, GPS noise, too little history)", () => {
  const g = gridGraph(14, 14, 120);
  const rules = walkRules();
  it("one observation, or only old ones, says nothing", () => {
    const tr = trackAlong(g, [300, 720], 1, 0, 1.3, 100);
    expect(estimateMotion(g, rules, tr.slice(-1), 100)).toBeNull();
    expect(estimateMotion(g, rules, tr, 100 + ZOMBIE_AI.maxInfoAgeS + 1)).toBeNull();
    expect(estimateMotion(g, rules, [], 100)).toBeNull();
  });
  it("a player standing still in 8 m of GPS noise has no direction", () => {
    let k = 1;
    const noise = (): [number, number] => { k = (k * 16807) % 2147483647; const a = (k / 2147483647) * 2 * Math.PI; return [Math.cos(a) * 8, Math.sin(a) * 8]; };
    for (let t = 100; t < 160; t += 4) expect(estimateMotion(g, rules, trackAlong(g, [300, 720], 1, 0, 0, t, 8, noise), t)).toBeNull();
  });
  it("a walking player in 5 m of noise: direction and roughly the right speed", () => {
    let k = 3;
    const noise = (): [number, number] => { k = (k * 16807) % 2147483647; const a = (k / 2147483647) * 2 * Math.PI; return [Math.cos(a) * 5, 0 * Math.sin(a)]; };
    const m = estimateMotion(g, rules, trackAlong(g, [400, 720], 1, 0, 1.3, 100, 6, noise), 100)!;
    expect(m).not.toBeNull();
    expect(m.vx).toBeGreaterThan(0.9);
    expect(m.speedMps).toBeGreaterThan(0.9);
    expect(m.speedMps).toBeLessThan(1.8);
    expect(m.dir).toBeDefined();
  });
  it("a player who has just turned round gives no direction until the new one is clear", () => {
    const fwd = trackAlong(g, [500, 720], 1, 0, 1.3, 100, 5);
    const back = (n: number) => trackAlong(g, [500 - 1.3 * 4 * n, 720], -1, 0, 1.3, 100 + 4 * n, n);
    expect(estimateMotion(g, rules, [...fwd, ...back(3)].slice(-8), 112)).toBeNull();
    const later = estimateMotion(g, rules, [...fwd, ...back(6)].slice(-8), 124)!;
    expect(later.vx).toBeLessThan(-0.9);
  });
});

describe("roles: meeting points (scenario 1: a straight way where cutting ahead is possible)", () => {
  const g = gridGraph(14, 14, 120);
  const rules = walkRules();
  it("the interceptor heads for a point ahead of the player on its row that it reaches first and not absurdly early", () => {
    const z = zombieAt(g, [840, 480], rules);
    const tr = trackAlong(g, [600, 720], 1, 0, 1.3, 100);
    const ev = decide(g, rules, z, tr, 100);
    expect(ev).toEqual([{ type: "zombie_intercept", zombieId: "z2" }]);
    expect(z.state).toBe("intercept");
    const m = meetingXY(z);
    expect(Math.abs(m.y - 720)).toBeLessThan(2);
    expect(m.x).toBeGreaterThan(600);
    // The zombie arrives `marginS`–`maxWaitS` before the player is expected (route time from the same cost model as the planner).
    const zEta = planRoute(g, { edgeId: zombieAt(g, [840, 480], rules).edgeId, distM: zombieAt(g, [840, 480], rules).distanceAlongEdgeM }, snapToGraph(g, z.meeting!)!, rules.zombieSpeedMps)!.etaS;
    const wait = z.meeting!.playerAtS - 100 - zEta;
    expect(wait).toBeGreaterThanOrEqual(ZOMBIE_AI.marginS - 1);
    expect(wait).toBeLessThanOrEqual(ZOMBIE_AI.maxWaitS + 1);
    expect(z.meeting!.playerAtS - 100).toBeLessThanOrEqual(ZOMBIE_AI.horizonS);
  });

  it("in the engine: where following goes behind the player, the interceptor goes round the other way and meets it", () => {
    // Main trail along y=0; a loop above it (y=100) from x=300 to x=600. The zombie is on the loop, the player just past x=300 going east:
    // the way to where the player is goes back via x=300 (behind), the way to where the player is going goes via x=600 (ahead).
    const g = net({ A: [0, 0], J1: [300, 0], J2: [600, 0], E: [1500, 0], T1: [300, 100], T2: [600, 100] }, [["A", "J1"], ["J1", "J2"], ["J2", "E"], ["J1", "T1"], ["T1", "T2"], ["T2", "J2"]]);
    const run = (role: "interceptor" | "pursuer") => {
      const r = walkRules({ sprintRadiusM: 0 });
      const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 3, rulesVersion: "t", mode: "survival" }, rules: r, start: xy(350, 0) });
      const z = state.zombies[0];
      Object.assign(z, zombieAt(g, [500, 100], r, { id: z.id, role, state: "patrol", tacticalAtS: 0 }));
      let viaBehind = false, meetingAheadBy = -Infinity;
      for (let i = 0; i < 300 / STEP_S && state.phase !== "finished"; i++) {
        const x = 350 + 1.3 * STEP_S * (i + 1);
        stepGame(g, state, r, { position: xy(x, 0), quality: "ok", accuracyM: 5 });
        if (local(zombieLatLon(g, z)).x < 310) viaBehind = true; // took the way back round by x=300
        if (z.meeting && meetingAheadBy === -Infinity) meetingAheadBy = local(z.meeting).x - x;
      }
      return { viaBehind, meetingAheadBy, result: state.result };
    };
    const i = run("interceptor"), p = run("pursuer");
    expect(i.meetingAheadBy).toBeGreaterThan(100);
    expect(i.viaBehind).toBe(false);
    expect(i.result).toBe("infected");
    expect(p.viaBehind).toBe(true);
    expect(p.result).toBeUndefined(); // still following behind after five minutes
  });
});

describe("roles: waiting at the meeting point", () => {
  it("an interceptor that gets there early waits instead of turning back, and goes for the player when it comes close", () => {
    // A straight trail and a 30 m spur joining it at x=700; the zombie stands at the end of the spur, the player comes from x=350.
    const g = net({ A: [0, 0], S: [700, 0], E: [1500, 0], S2: [700, 30] }, [["A", "S"], ["S", "E"], ["S", "S2"]]);
    const r = walkRules({ sprintRadiusM: 0 });
    const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 3, rulesVersion: "t", mode: "survival" }, rules: r, start: xy(350, 0) });
    const z = state.zombies[0];
    Object.assign(z, zombieAt(g, [700, 30], r, { id: z.id, role: "interceptor", state: "patrol", tacticalAtS: 0 }));
    // Waiting = standing still on an intercept plan. It may wait, step closer at a review and wait again, but never stands at one spot
    // longer than the longest wait the rules allow.
    let waited = 0, longest = 0, run = 0, prev = "";
    let x = 350;
    for (let i = 0; i < 300 / STEP_S && state.phase !== "finished"; i++) {
      x += 1.3 * STEP_S;
      stepGame(g, state, r, { position: xy(x, 0), quality: "ok", accuracyM: 5 });
      const here = `${z.edgeId}@${z.distanceAlongEdgeM.toFixed(3)}`;
      if (z.state === "intercept" && z.route.length === 0 && here === prev) { waited += STEP_S; run += STEP_S; longest = Math.max(longest, run); } else run = 0;
      prev = here;
    }
    expect(waited).toBeGreaterThan(5);
    expect(longest).toBeLessThanOrEqual(ZOMBIE_AI.maxWaitS + ZOMBIE_AI.lateToleranceS);
    expect(state.result).toBe("infected");
  });
});

describe("roles: terrain short cuts (scenarios 2 and 3)", () => {
  // Hairpin: the trail goes 500 m east along y=0, turns, comes back west along y=60. Terrain edges join the legs every 20 m.
  function hairpin(withTerrain: boolean) {
    const pts: Record<string, [number, number]> = {};
    const edges: [string, string, boolean?][] = [];
    for (let i = 0; i <= 25; i++) { pts[`b${i}`] = [20 * i, 0]; pts[`t${i}`] = [20 * i, 60]; }
    for (let i = 0; i < 25; i++) { edges.push([`b${i}`, `b${i + 1}`]); edges.push([`t${i}`, `t${i + 1}`]); }
    edges.push(["b25", "t25"]);
    if (withTerrain) for (let i = 0; i < 25; i++) edges.push([`b${i}`, `t${i}`, true]);
    return net(pts, edges);
  }
  it("2: a winding trail: the interceptor cuts across slow terrain because it is faster than going round", () => {
    const g = hairpin(true);
    const rules = walkRules();
    const z = zombieAt(g, [200, 60], rules);
    decide(g, rules, z, trackAlong(g, [40, 0], 1, 0, 1.3, 100), 100);
    expect(z.state).toBe("intercept");
    expect(usesTerrain(g, z)).toBe(true);
    expect(meetingXY(z).y).toBeLessThan(2); // on the player's leg, ahead of the player
    expect(meetingXY(z).x).toBeGreaterThan(40);
    // Without the terrain edges the way round is far too long: no meeting point, it keeps pursuing.
    const g2 = hairpin(false);
    const z2 = zombieAt(g2, [200, 60], rules);
    decide(g2, rules, z2, trackAlong(g2, [40, 0], 1, 0, 1.3, 100), 100);
    expect(z2.state).toBe("chase");
  });

  it("3: a short cut that is shorter but slower than the trail is not taken", () => {
    // Triangle: A(0,0) – M(50,56) – B(100,0) along the trail (150 m), a 100 m terrain edge A–B (= 200 m at half speed). Trail B–C east.
    const g = net({ A: [0, 0], M: [50, 56], B: [100, 0], C: [400, 0] }, [["A", "M"], ["M", "B"], ["B", "C"], ["A", "B", true]]);
    const rules = walkRules();
    const z = zombieAt(g, [0, 0], rules);
    decide(g, rules, z, trackAlong(g, [300, 0], -1, 0, 1.3, 100), 100);
    expect(z.state).toBe("intercept");
    expect(usesTerrain(g, z)).toBe(false);
    expect(z.route.some((s) => s.edgeId.includes("M-B") || s.edgeId.includes("A-M"))).toBe(true);
  });
});

describe("roles: barriers (scenario 6: a forbidden or unreachable passage)", () => {
  it("water between the zombie and the player's trail (no terrain edges across): no meeting point there", () => {
    // Two parallel trails 100 m apart, joined only 2 km away. Terrain lattice on the zombie's side only.
    const pts: Record<string, [number, number]> = { P0: [0, 0], P1: [2000, 0], Z0: [0, 100], Z1: [2000, 100], W0: [0, 160], W1: [400, 160] };
    const g = net(pts, [["P0", "P1"], ["Z0", "Z1"], ["P1", "Z1"], ["Z0", "W0", true], ["W0", "W1", true]]);
    const rules = walkRules();
    const z = zombieAt(g, [500, 100], rules);
    decide(g, rules, z, trackAlong(g, [200, 0], 1, 0, 1.3, 100), 100);
    expect(z.state).toBe("chase");
    // The control: a terrain edge across the "water" and it does intercept.
    const g2 = net({ ...pts, X0: [500, 100], X1: [500, 0] }, [["P0", "X1"], ["X1", "P1"], ["Z0", "X0"], ["X0", "Z1"], ["P1", "Z1"], ["X0", "X1", true]]);
    const z2 = zombieAt(g2, [500, 100], rules);
    decide(g2, rules, z2, trackAlong(g2, [200, 0], 1, 0, 1.3, 100), 100);
    expect(z2.state).toBe("intercept");
  });

  it("off the trails the forecast never puts the player in water (no network there)", () => {
    // A terrain lattice 40 m apart with a 200 × 200 m hole (a lake) east of the player.
    const pts: Record<string, [number, number]> = {};
    const edges: [string, string, boolean?][] = [];
    const lake = (x: number, y: number) => x > 150 && x < 350 && y > -100 && y < 100;
    for (let i = -2; i <= 15; i++) for (let j = -6; j <= 6; j++) if (!lake(40 * i, 40 * j)) pts[`n${i}_${j}`] = [40 * i, 40 * j];
    for (let i = -2; i <= 15; i++) for (let j = -6; j <= 6; j++) {
      if (!pts[`n${i}_${j}`]) continue;
      if (pts[`n${i + 1}_${j}`]) edges.push([`n${i}_${j}`, `n${i + 1}_${j}`, true]);
      if (pts[`n${i}_${j + 1}`]) edges.push([`n${i}_${j}`, `n${i}_${j + 1}`, true]);
    }
    const g = net(pts, edges);
    const rules = walkRules();
    const m = estimateMotion(g, rules, trackAlong(g, [100, 0], 1, 0, 1.3, 100), 100)!;
    expect(m.dir).toBeUndefined(); // off the trails
    const cands = forecast(g, rules, m);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      const p = local(edgeLatLon(g, c.pos));
      expect(lake(p.x, p.y)).toBe(false);
      expect(local(edgeLatLon(g, c.pos)).x).toBeGreaterThan(100); // ahead of the player
    }
  });
});

describe("roles: the information boundary (scenario 4: a change of way after a reveal)", () => {
  // No magnet chase, reveals every 30 s, no detection radius, no sprint: the zombie knows only what the reveals tell it.
  const g = gridGraph(14, 14, 120);
  const rules = walkRules({ magnetic: false, revealIntervalS: 30, detectionRadiusM: 0, sprintRadiusM: 0, revealResponseProb: 1 });
  /** The player walks east along row 6 and at x=720 either keeps going or turns north up column 6. */
  const path = (turn: boolean, s: number): LatLon => (s <= 120 || !turn ? xy(600 + s, 720) : xy(720, 720 + (s - 120)));
  function setup(): { state: GameState; z: Zombie } {
    const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 5, rulesVersion: "t", mode: "survival" }, rules, start: xy(600, 720) });
    const z = state.zombies[0];
    Object.assign(z, zombieAt(g, [840, 600], rules, { id: z.id }));
    // The history the reveals so far have given: walking east, the newest at t=0 (x=600).
    const tr = trackAlong(g, [600, 720], 1, 0, 1.3, 0, 8);
    state.player.track = tr;
    state.player.lastObservation = tr.at(-1);
    z.lastKnownEdge = { edgeId: tr.at(-1)!.edgeId, distM: tr.at(-1)!.edgeDistM };
    z.lastKnownPlayerPosition = { lat: tr[7].lat, lon: tr[7].lon, observedAtMs: 0 };
    state.nextRevealAtS = 30;
    return { state, z };
  }
  const snapshot = (z: Zombie) => JSON.stringify({ e: z.edgeId, d: z.distanceAlongEdgeM.toFixed(6), s: z.state, m: z.meeting, r: z.route });

  it("the same reveals give the same decisions, whatever the player did in between; the next reveal can change them", () => {
    const a = setup(), b = setup();
    const seen: { before: boolean[]; at: string[] } = { before: [], at: [] };
    let met: LatLon | undefined;
    for (let i = 0; i < 29.8 / STEP_S; i++) {
      const s = 1.3 * STEP_S * (i + 1);
      stepGame(g, a.state, rules, { position: path(false, s), quality: "ok", accuracyM: 5 });
      stepGame(g, b.state, rules, { position: path(true, s), quality: "ok", accuracyM: 5 });
      seen.before.push(snapshot(a.z) === snapshot(b.z));
      met ??= a.z.meeting;
    }
    // The interceptor chose a point ahead on row 6 (east of x=720) and both runs did exactly the same, step by step.
    expect(met).toBeDefined();
    expect(local(met!).x).toBeGreaterThan(720);
    expect(seen.before.every(Boolean)).toBe(true);
    // b turned north at x=720 (after about 92 s of walking... here the turn is at s=120 m ≈ 92 s), so let both walk on.
    for (let i = 0; i < 120 / STEP_S; i++) {
      const s = 1.3 * (29.8 + STEP_S * (i + 1));
      stepGame(g, a.state, rules, { position: path(false, s), quality: "ok", accuracyM: 5 });
      stepGame(g, b.state, rules, { position: path(true, s), quality: "ok", accuracyM: 5 });
      seen.at.push(snapshot(a.z) === snapshot(b.z) ? "same" : "diff");
    }
    // Identical until the first reveal after the turn (t=120 s, about 28 s after it), different after.
    const firstDiff = seen.at.indexOf("diff");
    const t = 29.8 + (firstDiff + 1) * STEP_S;
    expect(firstDiff).toBeGreaterThan(0);
    expect(t).toBeGreaterThanOrEqual(120 - 1e-6);
  });

  it("right after the turn the interceptor still heads for its old point (it was fooled), and gives it up later", () => {
    const { state, z } = setup();
    let x = 0, targetAtTurn: LatLon | undefined;
    for (let i = 0; i < 300 / STEP_S; i++) {
      x = 1.3 * STEP_S * (i + 1);
      stepGame(g, state, rules, { position: path(true, x), quality: "ok", accuracyM: 5 });
      if (x >= 125 && !targetAtTurn && z.meeting) targetAtTurn = { ...z.meeting };
    }
    expect(targetAtTurn).toBeDefined();
    expect(local(targetAtTurn!).x).toBeGreaterThan(720); // still east, where the player no longer goes
    // Later it no longer goes for that point.
    const now = z.meeting ? local(z.meeting) : null;
    expect(!now || haversineM(z.meeting!, targetAtTurn!) > ZOMBIE_AI.samePointM).toBe(true);
  });
});

describe("roles: several interceptors (scenario 7: steady choices, no train)", () => {
  it("three interceptors next to each other do not all pick the same point, and keep their points while the player walks straight on", () => {
    const g = gridGraph(14, 14, 120);
    const rules = walkRules({ sprintRadiusM: 0, initialZombies: 3, maxZombies: 3 });
    const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 8, rulesVersion: "t", mode: "survival" }, rules, start: xy(480, 720) });
    // Three interceptors 80 m apart on the same street, ahead and to the side of the player.
    state.zombies.forEach((z, i) => Object.assign(z, zombieAt(g, [960, 480 + 80 * i], rules, { id: z.id, state: "patrol", tacticalAtS: 12 + i })));
    const switches = new Map<string, number>();
    const last = new Map<string, LatLon | undefined>();
    let distinct = 0;
    for (let i = 0; i < 180 / STEP_S && state.phase !== "finished"; i++) {
      stepGame(g, state, rules, { position: xy(480 + 1.3 * STEP_S * (i + 1), 720), quality: "ok", accuracyM: 5 });
      for (const z of state.zombies) {
        const prev = last.get(z.id);
        if (z.meeting && prev && haversineM(z.meeting, prev) > ZOMBIE_AI.samePointM) switches.set(z.id, (switches.get(z.id) ?? 0) + 1);
        last.set(z.id, z.meeting ? { ...z.meeting } : prev);
      }
      const pts = state.zombies.filter((z) => z.meeting).map((z) => z.meeting!);
      if (pts.length === 3) {
        const groups = pts.filter((p, j) => pts.findIndex((q) => haversineM(p, q) <= ZOMBIE_AI.samePointM) === j).length;
        distinct = Math.max(distinct, groups);
      }
    }
    expect(distinct).toBeGreaterThanOrEqual(2);
    for (const n of switches.values()) expect(n).toBeLessThanOrEqual(2);
  });

  it("an interceptor does not flip between two nearly equal points at each review (inertia)", () => {
    const g = gridGraph(14, 14, 120);
    const rules = walkRules();
    const z = zombieAt(g, [840, 480], rules);
    decide(g, rules, z, trackAlong(g, [600, 720], 1, 0, 1.3, 100), 100);
    const first = { ...z.meeting! };
    for (let t = 104; t <= 140; t += 4) {
      z.tacticalAtS = 0;
      // The zombie has moved a little along its route; the player a little along the row.
      advanceZombie(g, z, z.speedMps * 4, { rngState: 1 });
      decide(g, rules, z, trackAlong(g, [600 + 1.3 * (t - 100), 720], 1, 0, 1.3, t), t);
      expect(z.state).toBe("intercept");
      expect(haversineM(z.meeting!, first)).toBeLessThanOrEqual(ZOMBIE_AI.samePointM);
    }
  });

  it("scores a point already taken by another interceptor lower", () => {
    const g = gridGraph(14, 14, 120);
    const rules = walkRules();
    const z = zombieAt(g, [840, 480], rules);
    const m = estimateMotion(g, rules, trackAlong(g, [600, 720], 1, 0, 1.3, 100), 100)!;
    const free = scoreCandidates(g, rules, z, forecast(g, rules, m), []);
    const best = edgeLatLon(g, free[0].cand.pos);
    const taken = scoreCandidates(g, rules, z, forecast(g, rules, m), [best]);
    expect(haversineM(edgeLatLon(g, taken[0].cand.pos), best)).toBeGreaterThan(0);
    expect(taken.find((c) => haversineM(edgeLatLon(g, c.cand.pos), best) < 1)!.score).toBeCloseTo(free[0].score * ZOMBIE_AI.sharedTargetFactor);
  });
});

describe("roles: saving and resuming (scenario 8)", () => {
  const g = gridGraph(14, 14, 120);
  const rules = walkRules({ initialZombies: 6, maxZombies: 8, growthPerMin: 1 });
  const walk = (state: GameState, from: number, n: number) => {
    for (let i = from; i < from + n && state.phase !== "finished"; i++) {
      const s = 1.3 * STEP_S * (i + 1);
      const p = s < 900 ? xy(120 + s, 720) : xy(1020, 720 + (s - 900));
      stepGame(g, state, rules, { position: p, quality: "ok", accuracyM: 5 });
    }
  };
  it("a match saved mid-hunt (JSON, like IndexedDB) continues exactly as if it had never stopped", () => {
    const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 12, rulesVersion: "t", mode: "survival" }, rules, start: xy(120, 720) });
    walk(state, 0, 400);
    expect(state.zombies.some((z) => z.role === "interceptor")).toBe(true);
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    walk(state, 400, 900);
    walk(saved, 400, 900);
    expect(JSON.stringify(saved)).toBe(JSON.stringify(state));
  });

  it("zombies saved without a role get the one their spawn number gives, and play on", () => {
    expect(roleOf({ id: "z2" })).toBe("interceptor");
    expect(roleOf({ id: "z3" })).toBe("pursuer");
    expect(roleOf({ id: "z3", role: "interceptor" })).toBe("interceptor");
    const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 12, rulesVersion: "t", mode: "survival" }, rules, start: xy(120, 720) });
    for (const z of state.zombies) delete z.role;
    walk(state, 0, 600);
    expect(state.zombies.length).toBeGreaterThan(0);
  });

  it("a restored live match keeps the AI it was started with (old saves: none)", () => {
    const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 1800, areaId: "t", seed: 12, rulesVersion: "t", mode: "survival" }, rules, start: xy(120, 720) });
    const old = LiveGame.restore(g, structuredClone(state), { activity: "walk", mode: "survival", difficulty: "normal" }, null, emptyCounters(), null, 0);
    const roles = LiveGame.restore(g, structuredClone(state), { activity: "walk", mode: "survival", difficulty: "normal", zombieAi: "roles" }, null, emptyCounters(), null, 0);
    expect(old.rules.zombieAi).toBeUndefined();
    expect(roles.rules.zombieAi).toBe("roles");
  });
});

describe("roles: pursuers are the AI as it was", () => {
  it("a pursuer goes for the newest observation exactly like a zombie without roles that may not intercept", () => {
    const g = gridGraph(14, 14, 120);
    const roles = walkRules({ sprintRadiusM: 0 });
    const old = { ...resolveRules("walk", "normal", 3000), initialZombies: 1, maxZombies: 1, growthPerMin: 0, headStartS: 0, sprintRadiusM: 0 };
    const run = (r: Rules, role?: "pursuer") => {
      const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 3, rulesVersion: "t", mode: "survival" }, rules: r, start: xy(240, 720) });
      const z = state.zombies[0];
      Object.assign(z, zombieAt(g, [960, 240], r, { id: z.id, role, canIntercept: false, state: "patrol" }));
      const out: string[] = [];
      for (let i = 0; i < 200 / STEP_S && state.phase !== "finished"; i++) {
        stepGame(g, state, r, { position: xy(240 + 1.3 * STEP_S * (i + 1), 720), quality: "ok", accuracyM: 5 });
        out.push(`${z.edgeId}@${z.distanceAlongEdgeM.toFixed(3)}`);
      }
      return out;
    };
    expect(run(roles, "pursuer")).toEqual(run(old));
  });

  it("updateZombieAI never reads the player's real position for an interceptor's plan (only the history)", () => {
    const g = gridGraph(14, 14, 120);
    const rules = walkRules();
    const tr = trackAlong(g, [600, 720], 1, 0, 1.3, 100);
    const plan = (playerPos: LatLon) => {
      const z = zombieAt(g, [840, 480], rules);
      updateZombieAI({ g, rules, rng: { rngState: 5 }, timeS: 100, playerPos, playerObservation: null, magnetObservation: null, reveal: false, detectionEnabled: false, events: [], track: tr, zombies: [] }, z, false);
      return JSON.stringify({ m: z.meeting, r: z.route, s: z.state });
    };
    expect(plan(xy(600, 720))).toBe(plan(xy(720, 900)));
  });
});
