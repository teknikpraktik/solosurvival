import { describe, expect, it } from "vitest";
import { RULES_VERSION, resolveRules } from "@/config/game-rules";
import { createGame } from "@/engine/core/engine";
import type { Zombie } from "@/engine/core/types";
import { zombieLatLon } from "@/engine/core/movement";
import { edgeLatLon } from "@/geo/graph/graph";
import { haversineM } from "@/geo/geometry";
import type { GPSFix } from "@/gps/types";
import { BACKGROUND_GRACE_MS, LiveGame, SHIELD_BUDGET_MS, SHIELD_DANGER_M } from "@/play/live-game";
import { gridGraph } from "@/sim/test-graphs";

/** Bakgrundsregler: skydd under kort frånvaro bara när inga zombier är nära, med budget; längre frånvaro pausar. Alla tider simulerade (fejkad klocka). */
const g = gridGraph(14, 14, 100);
const start = edgeLatLon(g, { edgeId: "r7:6", distM: 50 });
const fix = (t: number): GPSFix => ({ latitude: start.lat, longitude: start.lon, accuracyM: 6, timestampMs: t, speedMps: null, headingDeg: null });

function setup(zombieGapM: number | null, frozen = false) {
  const rules = { ...resolveRules("walk", "normal", 3000), headStartS: 0, initialZombies: 0, maxZombies: 0 };
  const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 4, rulesVersion: RULES_VERSION }, rules, start });
  if (zombieGapM !== null) {
    const z: Zombie = { id: "z", edgeId: "r7:6", distanceAlongEdgeM: Math.min(100, 50 + zombieGapM), speedMps: frozen ? 0 : rules.zombieSpeedMps, state: "chase", dir: -1, route: [], stateSinceS: 0, replanAtS: 0, tacticalAtS: 1e9, contactLostS: 0, canIntercept: false };
    state.zombies = [z];
    if (zombieGapM > 50 && zombieGapM <= 150) { z.edgeId = "r7:7"; z.distanceAlongEdgeM = zombieGapM - 50; }
    // Långt bort: en annan gata ca 500 m från spelaren.
    if (zombieGapM >= 300) { z.edgeId = "r2:2"; z.distanceAlongEdgeM = 50; }
  }
  const live = new LiveGame(g, state, rules);
  let t = 1_000_000;
  live.pushFix(fix(t), t);
  expect(live.resume(t)).toBe(true);
  // Ett par sekunder normal speltid.
  for (let i = 0; i < 6; i++) { t += 1000; live.pushFix(fix(t), t); live.tick(t); }
  return { live, state, rules, now: () => t, set: (x: number) => (t = x), fix, advance: (ms: number) => { t += ms; } };
}
const away = (s: ReturnType<typeof setup>, ms: number) => {
  s.live.enterBackground(s.now());
  s.advance(ms);
  const r = s.live.leaveBackground(s.now());
  s.live.pushFix(fix(s.now()), s.now());
  return r;
};

describe("bakgrundsläge: rättvist utan att straffa normala avbrott", () => {
  it("telefonsamtal 25 s utan zombie i närheten: spelet går vidare, tiden räknas, ingen smitta", () => {
    const s = setup(400);
    const e0 = s.state.elapsedSeconds;
    const r = away(s, 25_000);
    expect(r.paused).toBe(false);
    expect(r.shielded).toBe(true);
    expect(s.state.elapsedSeconds - e0).toBeCloseTo(25, 0);
    expect(s.state.result).toBeUndefined();
  });

  it("zombie 80 m bort när appen lämnas: inget skydd – den hinner fram och smittar den stillastående spelaren (att titta bort räddar inte)", () => {
    const s = setup(80);
    expect(haversineM(zombieLatLon(g, s.state.zombies[0]), start)).toBeLessThan(SHIELD_DANGER_M);
    const r = away(s, 44_000);
    expect(r.shielded).toBe(false);
    expect(s.state.result).toBe("infected");
  });

  it("zombie nära men frånvaron kort (8 s): ingen hinner fram, och 5 s neutral period efter återkomst", () => {
    const s = setup(80);
    const r = away(s, 8_000);
    expect(r.shielded).toBe(false);
    expect(s.state.result).toBeUndefined();
    expect(s.state.neutralUntilS).toBeGreaterThan(s.state.elapsedSeconds);
  });

  it("frånvaro över gränsen (60 s): paus, ingen tid räknas, ingen smitta, fortsätt kräver ny fix", () => {
    const s = setup(80);
    const e0 = s.state.elapsedSeconds;
    const r = away(s, BACKGROUND_GRACE_MS + 15_000);
    expect(r.paused).toBe(true);
    expect(s.state.paused).toBe(true);
    expect(s.state.elapsedSeconds).toBe(e0);
    expect(s.state.result).toBeUndefined();
    expect(s.live.resume(s.now())).toBe(true);
  });

  it("skyddsbudget: upprepade korta frånvaron kan inte staplas till permanent skydd", () => {
    const s = setup(600, true);
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      results.push(away(s, 25_000).shielded);
      for (let k = 0; k < 10; k++) { s.advance(1000); s.live.pushFix(fix(s.now()), s.now()); s.live.tick(s.now()); }
    }
    // 25 + 25 = 50 s ryms i budgeten (60 s), den tredje (75 s) gör det inte.
    expect(results).toEqual([true, true, false, false]);
    expect(SHIELD_BUDGET_MS).toBe(60_000);
  });

  it("budgeten förnyas: samma frånvaro efter fönstret (5 min) är skyddad igen", () => {
    const s = setup(600, true);
    away(s, 40_000);
    for (let k = 0; k < 310; k++) { s.advance(1000); s.live.pushFix(fix(s.now()), s.now()); s.live.tick(s.now()); }
    expect(away(s, 40_000).shielded).toBe(true);
  });

  it("manuell paus påverkas inte av appbyte, och en dold händelse utan frånvaro ändrar inget", () => {
    const s = setup(400);
    s.live.pause();
    const e0 = s.state.elapsedSeconds;
    const r = away(s, 30_000);
    expect(r.awayMs).toBe(0);
    expect(s.state.paused).toBe(true);
    expect(s.state.elapsedSeconds).toBe(e0);
  });

  it("tick under bakgrund simulerar ingenting (webbläsaren kan strypa timers)", () => {
    const s = setup(400);
    s.live.enterBackground(s.now());
    const e0 = s.state.elapsedSeconds;
    s.advance(10_000);
    expect(s.live.tick(s.now())).toEqual([]);
    expect(s.state.elapsedSeconds).toBe(e0);
    expect(s.live.inBackground).toBe(true);
  });
});
