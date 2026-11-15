import { describe, expect, it } from "vitest";
import { CAMPAIGN_SPEED_KMH, CAMPAIGN_TIME_SLACK, missionDurationS, missionObjectives, missionParams, missionRules } from "@/campaign/setup";
import { pickDestination, trimCourse } from "@/campaign/prepare";
import { THE_FALL } from "@/campaign/the-fall";
import type { Difficulty } from "@/config/difficulty";
import { STEP_S, ZOMBIE_SPEED_KMH, intensityAt, resolveRules } from "@/config/game-rules";
import { estimateTimeLimitS } from "@/routes/timing";
import { resolveModeRules } from "@/config/modes";
import { createGame, stepGame } from "@/engine/core/engine";
import { OBJECTIVE_HOLD_S, TRANSMIT_EXIT_MARGIN_M, createObjectives, objectiveProgress, updateObjectives, type ObjectiveTarget } from "@/engine/objectives/objectives";
import { haversineM, type LatLon } from "@/geo/geometry";
import { edgeLatLon } from "@/geo/graph/graph";
import { resolveMatchRules } from "@/play/rules";
import { generateCourse } from "@/routes/course";
import { gridGraph, lineGraph } from "@/sim/test-graphs";
import { destinationPoint } from "./helpers";

const c = THE_FALL;
const mission = (id: string) => c.missions.find((m) => m.id === id)!;
const LEVELS: Difficulty[] = ["easy", "normal", "hard"];
const P: LatLon = { lat: 59.4, lon: 13.5 };
const cp = (id: string, bearing: number, distM: number, extra: Partial<ObjectiveTarget> = {}): ObjectiveTarget => ({ id, kind: "checkpoint", ...destinationPoint(P, distM, bearing), ...extra });
/** Stands at `pos` for `seconds` with good GPS; returns the last update with something in it. */
function stand(o: ReturnType<typeof createObjectives>, pos: LatLon, seconds: number, t0 = 0, quality: "ok" | "verify" | "warning" = "ok", accuracyM = 5) {
  const out: ReturnType<typeof updateObjectives>[] = [];
  for (let i = 0; i < Math.round(seconds / STEP_S); i++) out.push(updateObjectives(o, pos, quality, STEP_S, t0 + i * STEP_S, { accuracyM, fixSeq: Math.floor((t0 + i * STEP_S)) }));
  return out;
}

describe("goals in any order (mission 02)", () => {
  it("any remaining checkpoint can be taken first; the engine's order becomes the order taken", () => {
    const o = createObjectives([cp("C1", 0, 400), cp("C2", 90, 400), cp("C3", 180, 400)]);
    o.anyOrder = true;
    const r = stand(o, destinationPoint(P, 395, 180), OBJECTIVE_HOLD_S + 0.4);
    expect(r.find((u) => u.reached)?.reached?.id).toBe("C3");
    expect(o.index).toBe(1);
    expect(objectiveProgress(o)).toMatchObject({ primaryReached: 1, primaryTotal: 3, stage: "checkpoint" });
    stand(o, destinationPoint(P, 400, 0), OBJECTIVE_HOLD_S + 0.4, 100);
    const last = stand(o, destinationPoint(P, 400, 90), OBJECTIVE_HOLD_S + 0.4, 200);
    expect(last.at(-1)?.completed || last.some((u) => u.completed)).toBe(true);
    expect(o.targets.map((t) => t.id)).toEqual(["C3", "C1", "C2"]);
  });

  it("the active target is always the nearest remaining one (what the HUD points at)", () => {
    const o = createObjectives([cp("C1", 0, 400), cp("C2", 90, 400), cp("C3", 180, 400)]);
    o.anyOrder = true;
    updateObjectives(o, destinationPoint(P, 200, 90), "ok", STEP_S, 0);
    expect(o.targets[o.index].id).toBe("C2");
    updateObjectives(o, destinationPoint(P, 200, 180), "ok", STEP_S, 1);
    expect(o.targets[o.index].id).toBe("C3");
  });

  it("without the flag the order is kept: standing on the third checkpoint confirms nothing", () => {
    const o = createObjectives([cp("C1", 0, 400), cp("C2", 90, 400), cp("C3", 180, 400)]);
    const r = stand(o, destinationPoint(P, 400, 180), 20);
    expect(r.some((u) => u.reached)).toBe(false);
    expect(o.index).toBe(0);
  });

  it("a destination or home after the checkpoints is never taken out of turn", () => {
    const home: ObjectiveTarget = { id: "A", kind: "home", ...P };
    const o = createObjectives([cp("C1", 0, 400), cp("C2", 90, 400), home]);
    o.anyOrder = true;
    expect(stand(o, P, 20).some((u) => u.reached)).toBe(false);
    expect(o.targets[2].id).toBe("A");
  });
});

describe("signal transmission (mission 04)", () => {
  const tx = (holdS = 30, radiusM = 50) => createObjectives([cp("R1", 0, 300, { holdS, radiusM, keepProgress: true }), cp("R2", 90, 300, { holdS, radiusM, keepProgress: true })]);
  const at = (d: number) => destinationPoint(destinationPoint(P, 300, 0), d, 45);

  it("starts when the player enters the zone, counts while inside, and completes after the hold", () => {
    const o = tx();
    expect(stand(o, at(80), 5).some((u) => u.hold)).toBe(false);
    const r = stand(o, at(30), 29.6, 10);
    expect(r[0].hold).toBe("started");
    expect(r.filter((u) => u.hold).length).toBe(1);
    expect(o.holding).toBe(true);
    expect(r.some((u) => u.reached)).toBe(false);
    const done = stand(o, at(20), 1, 40);
    expect(done.find((u) => u.reached)?.reached?.id).toBe("R1");
    expect(o.holdS).toBe(0);
    expect(o.holding).toBe(false);
  });

  it("the player may move about inside the zone: it is an area, not a spot", () => {
    const o = tx();
    let reached = false;
    for (let i = 0; i < 160 && !reached; i++) reached = !!updateObjectives(o, destinationPoint(destinationPoint(P, 300, 0), 40, (i * 9) % 360), "ok", STEP_S, i * STEP_S).reached;
    expect(reached).toBe(true);
  });

  it("leaving the zone pauses the signal and keeps what was sent; coming back resumes it", () => {
    const o = tx();
    stand(o, at(20), 12);
    const away = stand(o, at(120), 40, 20);
    expect(away[0].hold).toBe("paused");
    expect(away.filter((u) => u.hold).length).toBe(1);
    expect(o.holdS).toBeCloseTo(12, 5);
    const back = stand(o, at(20), 17.6, 70);
    expect(back[0].hold).toBe("resumed");
    expect(back.some((u) => u.reached)).toBe(false);
    expect(stand(o, at(20), 1, 90).some((u) => u.reached)).toBe(true);
  });

  it("GPS noise at the edge does not flicker: once holding, the zone reaches a little further out", () => {
    const o = tx(30, 50);
    stand(o, at(48), 2);
    const edge = stand(o, at(50 + TRANSMIT_EXIT_MARGIN_M - 2), 3, 5);
    expect(edge.some((u) => u.hold === "paused")).toBe(false);
    expect(stand(o, at(50 + TRANSMIT_EXIT_MARGIN_M + 3), 1, 10)[0].hold).toBe("paused");
    // Entering again needs the zone proper, not the margin.
    expect(stand(o, at(50 + TRANSMIT_EXIT_MARGIN_M - 2), 2, 12).some((u) => u.hold)).toBe(false);
  });

  it("unreliable GPS neither counts nor loses the signal, and a jump of the position cannot complete it", () => {
    const o = tx();
    stand(o, at(20), 10);
    const lost = stand(o, at(400), 60, 20, "warning");
    expect(lost.some((u) => u.hold || u.reached)).toBe(false);
    expect(o.holdS).toBeCloseTo(10, 5);
    expect(o.holding).toBe(true);
  });

  it("a poor fix (verify) needs margin to enter the zone", () => {
    const o = tx(30, 50);
    // 18 m accuracy: the zone shrinks by 8 m, so 46 m from the relay is not yet inside.
    expect(stand(o, at(46), 3, 0, "verify", 18).some((u) => u.hold)).toBe(false);
    expect(stand(o, at(40), 1, 5, "verify", 18)[0].hold).toBe("started");
  });

  it("a single fix can never complete a transmission (several different fixes are needed)", () => {
    const o = tx(1, 50);
    let reached = false;
    for (let i = 0; i < 20; i++) reached ||= !!updateObjectives(o, at(10), "ok", STEP_S, i * STEP_S, { accuracyM: 5, fixSeq: 7 }).reached;
    expect(reached).toBe(false);
  });

  it("in the engine: a transmission is announced, draws extra infected at a safe distance, and pausing is an event", () => {
    const g = gridGraph(12, 12, 120);
    const start = edgeLatLon(g, { edgeId: "r6:5", distM: 60 });
    const relay = edgeLatLon(g, { edgeId: "r6:7", distM: 0 });
    const far = edgeLatLon(g, { edgeId: "r6:3", distM: 0 });
    const rules = { ...missionRules(mission("04"), "hard", 1800), initialZombies: 1, maxZombies: 1, growthPerMin: 0 };
    const objectives = createObjectives([{ id: "R1", kind: "checkpoint", ...relay, holdS: 30, radiusM: 50, keepProgress: true }, { id: "R2", kind: "checkpoint", ...far, holdS: 30, radiusM: 50, keepProgress: true }]);
    const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 1800, areaId: "t", seed: 4, rulesVersion: "t", mode: "mission" }, rules, start, objectives });
    const before = state.zombies.length;
    const events = [];
    for (let i = 0; i < 25; i++) events.push(...stepGame(g, state, rules, { position: relay, quality: "infection_paused", accuracyM: 5 }));
    // GPS too weak to count: nothing starts.
    expect(events.some((e) => e.type === "objective_hold")).toBe(false);
    for (let i = 0; i < 50; i++) events.push(...stepGame(g, state, rules, { position: relay, quality: "ok", accuracyM: 5 }));
    expect(events.filter((e) => e.type === "objective_hold")).toEqual([{ type: "objective_hold", targetId: "R1", change: "started" }]);
    expect(state.bonusZombies).toBe(rules.transmitSpawn);
    expect(state.zombies.length).toBeGreaterThan(before);
    for (const z of state.zombies.slice(before)) expect(haversineM(edgeLatLon(g, { edgeId: z.edgeId, distM: z.distanceAlongEdgeM }), relay)).toBeGreaterThanOrEqual(rules.spawnMinDistanceM - 1);
    const left = [];
    for (let i = 0; i < 10; i++) left.push(...stepGame(g, state, rules, { position: start, quality: "ok", accuracyM: 5 }));
    expect(left.filter((e) => e.type === "objective_hold")).toEqual([{ type: "objective_hold", targetId: "R1", change: "paused" }]);
    // Coming back does not draw a second wave for the same relay.
    for (let i = 0; i < 10; i++) stepGame(g, state, rules, { position: relay, quality: "ok", accuracyM: 5 });
    expect(state.bonusZombies).toBe(rules.transmitSpawn);
  });
});

describe("mission rules and difficulty", () => {
  it("Free Play's rules carry none of the mission rules", () => {
    for (const mode of ["survival", "escape", "mission"] as const) for (const d of LEVELS) {
      const r = resolveModeRules(mode, "walk", d, 1800, undefined, mode === "escape" ? 1200 : undefined);
      expect([r.winOnTimeout, r.intensity, r.interceptModel, r.transmitSpawn, r.extractionRetry]).toEqual([undefined, undefined, undefined, undefined, undefined]);
      expect(resolveMatchRules({ mode, activity: "walk", difficulty: d }, 1800, mode === "escape" ? 1200 : undefined)).toEqual(r);
    }
    expect(intensityAt(resolveRules("walk", "normal", 1800), 900)).toBe(1);
  });

  it("a mission match gets the mission's rules; an unknown campaign falls back to the mode's", () => {
    const r = resolveMatchRules({ mode: "survival", activity: "walk", difficulty: "normal", campaign: { id: "the-fall", mission: "01" } }, 900);
    expect(r).toEqual(missionRules(mission("01"), "normal", 900));
    expect(r.winOnTimeout).toBe(true);
    expect(resolveMatchRules({ mode: "survival", activity: "walk", difficulty: "normal", campaign: { id: "gone", mission: "01" } }, 900)).toEqual(resolveModeRules("survival", "walk", "normal", 900));
  });

  it("every mission: Easy < Normal < Hard in speed and numbers, the same goals and time on every level", () => {
    for (const m of c.missions) {
      const rs = LEVELS.map((d) => missionRules(m, d, 1500, 1000));
      for (let i = 1; i < rs.length; i++) {
        expect(rs[i].zombieSpeedMps).toBeGreaterThan(rs[i - 1].zombieSpeedMps);
        expect(rs[i].initialZombies).toBeGreaterThanOrEqual(rs[i - 1].initialZombies);
        expect(rs[i].maxZombies).toBeGreaterThan(rs[i - 1].maxZombies);
        expect(rs[i].interceptShare).toBeGreaterThanOrEqual(rs[i - 1].interceptShare);
      }
      // The campaign's speed for the level, scaled by the mission only.
      LEVELS.forEach((d, i) => expect(rs[i].zombieSpeedMps).toBeCloseTo((CAMPAIGN_SPEED_KMH[d] * m.tuning.speed) / 3.6, 6));
      expect(new Set(LEVELS.map((d) => missionParams(c, m, d, 1).mode)).size).toBe(1);
      for (const r of rs) {
        expect(r.interceptModel).toBe("track");
        expect(r.spawnMinDistanceM).toBeGreaterThanOrEqual(300); // new infected never appear on top of the player, on any level
        expect(r.initialZombies).toBeLessThanOrEqual(r.maxZombies);
        expect(r.growthPerMin).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("campaign speeds: Free Play's on Easy and Normal; Hard is a jog, not Free Play's sprint, so every level can be completed", () => {
    expect(CAMPAIGN_SPEED_KMH.easy).toBe(ZOMBIE_SPEED_KMH.walk!.easy);
    expect(CAMPAIGN_SPEED_KMH.normal).toBe(ZOMBIE_SPEED_KMH.walk!.normal);
    expect(CAMPAIGN_SPEED_KMH.hard).toBeGreaterThan(CAMPAIGN_SPEED_KMH.normal);
    expect(CAMPAIGN_SPEED_KMH.hard).toBeLessThan(ZOMBIE_SPEED_KMH.walk!.hard);
    // Even the finale's fastest moment on Hard (director and landing rush, without a sprint) stays below a 12 km/h run.
    const m5 = missionRules(mission("05"), "hard", 1800);
    expect(m5.zombieSpeedMps * 1.12 * 1.3 * 3.6).toBeLessThan(12);
  });

  it("the campaign's curve: mission 01 is the mildest and mission 05 the most intense, on every level", () => {
    for (const d of LEVELS) {
      const rs = c.missions.map((m) => missionRules(m, d, m.aboutMin * 60, 1000));
      const peak = (r: (typeof rs)[number]) => r.zombieSpeedMps * Math.max(1, ...(r.intensity ?? []).map((s) => s.speed));
      for (const r of rs.slice(1)) {
        expect(rs[0].maxZombies).toBeLessThan(r.maxZombies);
        expect(rs[0].initialZombies).toBeLessThanOrEqual(r.initialZombies);
        expect(rs[0].zombieSpeedMps).toBeLessThan(r.zombieSpeedMps);
      }
      for (const r of rs.slice(0, 4)) {
        expect(rs[4].maxZombies).toBeGreaterThanOrEqual(r.maxZombies);
        expect(peak(rs[4])).toBeGreaterThan(peak(r));
        expect(rs[4].interceptShare).toBeGreaterThanOrEqual(r.interceptShare);
      }
      // Missions 01 and 02 teach survival and planning; interception arrives with mission 03 (on Hard a little in 02).
      expect(rs[0].interceptShare).toBe(0);
      expect(rs[2].interceptShare).toBeGreaterThan(rs[1].interceptShare);
    }
  });

  it("the finale never runs the infected faster than Free Play Survival does at the same level", () => {
    for (const d of LEVELS) {
      const free = resolveModeRules("survival", "walk", d, 1800);
      const m5 = missionRules(mission("05"), d, 1800);
      const top = m5.zombieSpeedMps * Math.max(...m5.intensity!.map((s) => s.speed)) * (m5.extractionRushFactor ?? 1);
      expect(top).toBeLessThanOrEqual(free.zombieSpeedMps * (free.extractionRushFactor ?? 1));
    }
  });

  it("mission layouts: what each one switches on", () => {
    const [m1, m2, m3, m4, m5] = c.missions.map((m) => missionRules(m, "normal", m.aboutMin * 60, 1000));
    expect(m1).toMatchObject({ winOnTimeout: true, extractionOpensAtS: Infinity });
    expect(m2).toMatchObject({ extractionOpensAtS: Infinity, spreadStart: true, startMinDistanceM: 250 });
    expect(m2.winOnTimeout).toBeUndefined();
    expect(m3.extractionOpensAtS).toBe(Infinity);
    expect(m4).toMatchObject({ transmitSpawn: 1, spreadStart: true });
    expect(missionRules(mission("04"), "hard", 1800).transmitSpawn).toBe(2);
    expect(m5).toMatchObject({ extractionOpensAtS: 22 * 60, extractionRetry: true, extractionRushFactor: 1.3 });
    expect(m5.intensity).toEqual([{ atS: 0.45 * 1800, speed: 1.05 }, { atS: 0.65 * 1800, speed: 1.12 }]);
    expect(intensityAt(m5, 100)).toBe(1);
    expect(intensityAt(m5, 900)).toBe(1.05);
    expect(intensityAt(m5, 1700)).toBe(1.12);
    // The helicopter lands with time to reach it: at least six minutes at every level.
    expect(1800 - m5.extractionOpensAtS).toBeGreaterThanOrEqual(360);
  });

  it("mission parameters: on foot, the campaign's difficulty, the mission's mode and marker", () => {
    for (const m of c.missions) for (const d of LEVELS) {
      expect(missionParams(c, m, d, 7)).toMatchObject({ activity: "walk", difficulty: d, mode: m.mode, seed: 7, campaign: { id: "the-fall", mission: m.id } });
    }
    expect(missionParams(c, mission("01"), "easy", 1).durationS).toBe(900);
    expect(missionParams(c, mission("05"), "easy", 1).durationS).toBe(1800);
  });
});

describe("laying out a mission on the network", () => {
  const g = gridGraph(16, 16, 120);
  const start = edgeLatLon(g, { edgeId: "r8:7", distM: 60 });

  it("checkpoint missions: the generator's loop without the way home, cut to the mission's number of goals", () => {
    const course = generateCourse(g, { start, activity: "walk", targetLengthM: 2000, seed: 3, count: 3 }).proposals[0];
    expect(course.waypoints.at(-1)?.kind).toBe("home");
    const t = trimCourse(course, start, 3, 2)!;
    expect(t.waypoints.map((w) => w.kind)).toEqual(["checkpoint", "checkpoint", "checkpoint"]);
    expect(t.geometry[0]).toEqual(start);
    expect(t.geometry).toHaveLength(4);
    expect(t.lengthM).toBeLessThan(course.lengthM);
    expect(trimCourse({ ...course, waypoints: course.waypoints.slice(0, 1) }, start, 3, 2)).toBeNull();
    // Goals for the engine: any order in mission 02; zones with their own hold and radius in mission 04, the last one longer.
    const o2 = missionObjectives(mission("02"), t, "normal")!;
    expect(o2.anyOrder).toBe(true);
    expect(o2.targets.every((x) => x.holdS === undefined && !x.keepProgress)).toBe(true);
    const o4 = missionObjectives(mission("04"), t, "normal")!;
    expect(o4.anyOrder).toBeUndefined();
    expect(o4.targets.map((x) => [x.holdS, x.radiusM, x.keepProgress])).toEqual([[30, 55, true], [30, 55, true], [45, 55, true]]);
    // Zones are never tighter than 50 m, on any level (GPS noise, and room to keep moving).
    for (const d of LEVELS) for (const x of missionObjectives(mission("04"), t, d)!.targets) expect(x.radiusM).toBeGreaterThanOrEqual(50);
    expect(missionObjectives(mission("04"), t, "easy")!.targets.map((x) => [x.holdS, x.radiusM])).toEqual([[20, 60], [20, 60], [30, 60]]);
    expect(missionObjectives(mission("01"), null, "normal")).toBeUndefined();
    expect(missionObjectives(mission("05"), null, "normal")).toBeUndefined();
  });

  it("time limits: fixed for survival missions, from the course otherwise, with room for the transmissions", () => {
    const course = trimCourse(generateCourse(g, { start, activity: "walk", targetLengthM: 2000, seed: 3, count: 3 }).proposals[0], start, 3, 2)!;
    expect(missionDurationS(mission("01"), { difficulty: "hard", durationS: 1 }, null)).toBe(900);
    expect(missionDurationS(mission("05"), { difficulty: "easy", durationS: 1 }, null)).toBe(1800);
    const plain = missionDurationS(mission("02"), { difficulty: "normal", durationS: 1 }, course);
    const withTx = missionDurationS(mission("04"), { difficulty: "normal", durationS: 1 }, course);
    // Each transmission is given its time two and a half times over, plus a minute to get clear of the zone.
    expect(withTx - plain).toBe(Math.round((30 + 30 + 45) * 2.5) + 3 * 60);
    expect(plain).toBe(Math.round(estimateTimeLimitS(course.lengthM * 1.35, "walk", "normal", 3) * CAMPAIGN_TIME_SLACK));
    // Enough time to walk it calmly: the straight-line course at a slow walk fits well inside the limit.
    expect(plain).toBeGreaterThan((course.lengthM * 1.35) / 1.3);
    expect(missionDurationS(mission("02"), { difficulty: "easy", durationS: 1 }, course)).toBeGreaterThan(plain);
  });

  it("A to B missions: a destination on the network, about the wanted distance away, the same for the same seed", () => {
    const b = pickDestination(g, start, new Set(), 1500, 11)!;
    expect(b).not.toBeNull();
    expect(haversineM(start, b)).toBeGreaterThan(300);
    expect(haversineM(start, b)).toBeLessThanOrEqual(1500 * 1.25);
    expect(pickDestination(g, start, new Set(), 1500, 11)).toEqual(b);
    // It is a junction of the grid (never a dead end, never in open ground).
    expect([...g.nodes.values()].some((n) => haversineM(n, b) < 1)).toBe(true);
  });

  it("A to B missions: major-road crossings are never chosen, and a small network gives a nearer destination or none", () => {
    const all = new Set(g.nodes.keys());
    expect(pickDestination(g, start, all, 1500, 11)).toBeNull();
    const small = gridGraph(5, 5, 120); // 480 m across: nothing 1.2 km away, the wider bands still find a walkable goal
    const s2 = edgeLatLon(small, { edgeId: "r0:0", distM: 10 });
    const near = pickDestination(small, s2, new Set(), 1500, 3)!;
    expect(near).not.toBeNull();
    expect(haversineM(s2, near)).toBeGreaterThanOrEqual(300);
    // A single short trail: no goal can be offered, and the mission is refused rather than made unfair.
    const line = lineGraph(250);
    expect(pickDestination(line, edgeLatLon(line, { edgeId: [...line.edges.keys()][0], distM: 5 }), new Set(), 1500, 3)).toBeNull();
    expect(pickDestination(g, { lat: 10, lon: 10 }, new Set(), 1500, 3)).toBeNull();
  });
});
