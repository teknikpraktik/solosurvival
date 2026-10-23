import { describe, expect, it } from "vitest";
import { resolveRules, RULES_VERSION, STEP_S, sprintFactorAt, sprintTotalS, type Rules } from "@/config/game-rules";
import { DIFFICULTIES, type Difficulty } from "@/config/difficulty";
import { createGame, stepGame, zombieSpeedFactor } from "@/engine/core/engine";
import { zombieLatLon } from "@/engine/core/movement";
import type { GameEvent } from "@/engine/core/types";
import { haversineM } from "@/geo/geometry";
import { edgeLatLon } from "@/geo/graph/graph";
import { gridGraph } from "@/sim/test-graphs";

/** v2.1-modellen (1,5 × direkt i 30 s, 30 s återhämtning) uttryckt som regelåsidosättning, för jämförelse under identiska förhållanden. */
const V21: Partial<Rules> = { sprintSpeedFactor: 1.5, sprintDurationS: 30, sprintRampS: 0, sprintDecayS: 0, sprintCooldownS: 30 };

/** En ensam jagande zombie på samma gata som en stillastående spelare, `gapM` bort längs kanten. */
function setup(gapM: number, difficulty: Difficulty = "normal", patch: Partial<Rules> = {}) {
  const g = gridGraph(14, 14, 150);
  const rules = { ...resolveRules("walk", difficulty, 3000), ...patch, headStartS: 0, initialZombies: 1, maxZombies: 1 };
  const start = edgeLatLon(g, { edgeId: "r7:6", distM: 20 });
  const { state } = createGame({ g, config: { activity: "walk", difficulty, durationSeconds: 3000, areaId: "t", seed: 3, rulesVersion: RULES_VERSION }, rules, start });
  const z = state.zombies[0];
  z.edgeId = "r7:6"; z.distanceAlongEdgeM = 20 + gapM > 150 ? 150 : 20 + gapM; z.route = []; z.state = "patrol";
  state.zombies = [z];
  return { g, rules, state, start, z };
}

/** Kör `seconds` sekunder med zombien hållen på `holdGapM` från spelaren (så att spurtvillkoret alltid är uppfyllt) och loggar fart per steg. */
function trace(rules: Rules, seconds: number, holdGapM = 60) {
  const { g, state, start, z } = setup(holdGapM, rules.difficulty, rules);
  const speeds: { t: number; v: number; sprinting: boolean }[] = [];
  const starts: number[] = [];
  let prev = zombieLatLon(g, z);
  for (let i = 0; i < Math.round(seconds / STEP_S); i++) {
    z.edgeId = "r7:6"; z.distanceAlongEdgeM = 20 + holdGapM;
    prev = zombieLatLon(g, z);
    const ev: GameEvent[] = stepGame(g, state, rules, { position: start, quality: "infection_paused", accuracyM: 25 });
    if (ev.some((e) => e.type === "zombie_sprint")) starts.push(state.elapsedSeconds);
    // Farten som motorn tillämpade detta steg (förflyttningen innan vi sätter tillbaka zombien).
    const now = zombieLatLon(g, z);
    speeds.push({ t: state.elapsedSeconds, v: haversineM(prev, now) / STEP_S, sprinting: z.sprintUntilS !== undefined });
  }
  return { speeds, starts, z, rules };
}

describe("sprintens form: acceleration, topp, avtagande, återhämtning", () => {
  it("fartfaktorn är kontinuerlig: 1 → topp → tillbaka till exakt 1", () => {
    const r = resolveRules("walk", "normal", 3000);
    expect(sprintFactorAt(r, 0)).toBe(1);
    expect(sprintFactorAt(r, r.sprintRampS / 2)).toBeCloseTo(1 + (r.sprintSpeedFactor - 1) / 2);
    expect(sprintFactorAt(r, r.sprintRampS)).toBe(r.sprintSpeedFactor);
    expect(sprintFactorAt(r, r.sprintRampS + r.sprintDurationS - 0.01)).toBe(r.sprintSpeedFactor);
    // Avtagande: strikt fallande hela vägen ned till 1, aldrig under.
    let prev = Infinity;
    for (let t = r.sprintRampS + r.sprintDurationS; t < sprintTotalS(r); t += 0.5) {
      const f = sprintFactorAt(r, t);
      expect(f).toBeLessThanOrEqual(prev);
      expect(f).toBeGreaterThanOrEqual(1);
      prev = f;
    }
    expect(sprintFactorAt(r, sprintTotalS(r))).toBe(1);
    expect(sprintFactorAt(r, sprintTotalS(r) + 5)).toBe(1);
  });

  it("v2.1-formen (utan ramp/avtagande) ger fortfarande 1,5 × rakt av", () => {
    const r = { ...resolveRules("walk", "normal", 3000), ...V21 };
    expect(sprintFactorAt(r, 0)).toBe(1.5);
    expect(sprintFactorAt(r, 29.9)).toBe(1.5);
    expect(sprintFactorAt(r, 30)).toBe(1);
  });

  it("i spelet: zombien accelererar mjukt, är aldrig snabbare än toppfarten och tappar farten gradvis ned till grundfarten", () => {
    const rules = resolveRules("walk", "normal", 3000);
    const { speeds, starts } = trace(rules, 40);
    expect(starts.length).toBeGreaterThanOrEqual(1);
    const t0 = starts[0];
    const base = rules.zombieSpeedMps, peak = base * rules.sprintSpeedFactor;
    const at = (dt: number) => speeds.filter((s) => s.t > t0 + dt - 0.3 && s.t <= t0 + dt + 0.3).map((s) => s.v);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    // Första sekunden: långsammare än toppfarten (ingen omedelbar 1,4 ×), efter ramp + lite: på toppfart.
    expect(avg(at(0.4))).toBeLessThan(base * 1.15);
    expect(avg(at(rules.sprintRampS + 2))).toBeCloseTo(peak, 0);
    // Mitt i avtagandet mellan topp och grundfart, och efteråt grundfart.
    const mid = avg(at(rules.sprintRampS + rules.sprintDurationS + rules.sprintDecayS / 2));
    expect(mid).toBeGreaterThan(base * 1.1);
    expect(mid).toBeLessThan(peak * 0.99);
    expect(avg(at(sprintTotalS(rules) + 1))).toBeCloseTo(base, 0);
    // Aldrig över toppfarten (kantbyten ger enstaka avvikelser: 98:e percentilen).
    const v = speeds.map((s) => s.v).sort((a, b) => a - b);
    expect(v[Math.floor(v.length * 0.98)]).toBeLessThanOrEqual(peak * 1.02);
  });

  it("spurten kan inte köras oavbrutet: ny spurt först efter återhämtningen, per svårighet", () => {
    for (const d of ["easy", "normal", "hard"] as const) {
      const rules = resolveRules("walk", d, 3000);
      const cycle = sprintTotalS(rules) + rules.sprintCooldownS;
      const { starts } = trace(rules, cycle * 2.5, 60);
      expect(starts.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(cycle - 0.5);
      // Aldrig längre sammanhängande spurt än den totala längden (+ ett steg).
      const { speeds } = trace(rules, cycle * 1.2, 60);
      let run = 0, maxRun = 0;
      for (const s of speeds) { run = s.sprinting ? run + STEP_S : 0; maxRun = Math.max(maxRun, run); }
      expect(maxRun).toBeLessThanOrEqual(sprintTotalS(rules) + 0.5);
    }
  });
});

describe("svårigheterna skiljer sig tydligt och Lätt går att spela gående", () => {
  it("sprintens extra sträcka växer med svårigheten, och är mindre än v2.1 för alla", () => {
    const extra = (r: Pick<Rules, "sprintRampS" | "sprintDurationS" | "sprintDecayS" | "sprintSpeedFactor">) => {
      let sum = 0;
      for (let t = 0; t < sprintTotalS(r); t += 0.05) sum += (sprintFactorAt(r, t) - 1) * 0.05;
      return sum; // meter per m/s grundfart
    };
    const e = extra(resolveRules("walk", "easy", 3000)), n = extra(resolveRules("walk", "normal", 3000)), h = extra(resolveRules("walk", "hard", 3000));
    const old = extra({ ...resolveRules("walk", "normal", 3000), ...V21 });
    expect(e).toBeLessThan(n);
    expect(n).toBeLessThan(h);
    expect(h).toBeLessThan(old);
    expect(n).toBeLessThan(old * 0.6);
  });

  it("Lätt till fots ligger under gångfart även i spurt-toppen när spelaren går i nominell fart, Normal och Svår gör det inte", () => {
    const pace = 1.3; // ACTIVITIES.walk.playerPaceMps
    const easy = resolveRules("walk", "easy", 3000), normal = resolveRules("walk", "normal", 3000), hard = resolveRules("walk", "hard", 3000);
    expect(easy.zombieSpeedMps).toBeLessThan(pace);
    expect(easy.zombieSpeedMps * easy.sprintSpeedFactor).toBeLessThan(pace * 1.25); // toppen är kort och knappt snabbare än en rask gång
    expect(normal.zombieSpeedMps).toBeGreaterThan(pace * 2);
    expect(hard.zombieSpeedMps).toBeGreaterThan(normal.zombieSpeedMps * 1.25);
    // Svårigheterna skiljer sig i fart, spurt och återhämtning.
    expect(DIFFICULTIES.easy.sprint.cooldownS).toBeGreaterThan(DIFFICULTIES.normal.sprint.cooldownS);
    expect(DIFFICULTIES.normal.sprint.cooldownS).toBeGreaterThan(DIFFICULTIES.hard.sprint.cooldownS);
    expect(DIFFICULTIES.easy.sprint.peakFactor).toBeLessThan(DIFFICULTIES.hard.sprint.peakFactor);
  });
});

describe("zombie-spurt (villkor och tillstånd)", () => {
  it("jagande zombie inom 100 m spurtar; utanför 100 m gör den inte det", () => {
    const rules = resolveRules("walk", "normal", 3000);
    expect(trace(rules, 5, 95).starts.length).toBeGreaterThanOrEqual(1);
    expect(trace(rules, 5, 140).starts.length).toBe(0);
  });

  it("spurten ligger i tillståndet (JSON) och bevaras vid återställning, även en äldre match utan sprintStartS", () => {
    const { g, rules, state, start, z } = setup(60);
    for (let i = 0; i < 50; i++) stepGame(g, state, rules, { position: start, quality: "infection_paused", accuracyM: 25 });
    const copy = JSON.parse(JSON.stringify(state));
    expect(copy.zombies[0].sprintUntilS).toBe(state.zombies[0].sprintUntilS);
    expect(copy.zombies[0].sprintStartS).toBe(state.zombies[0].sprintStartS);
    expect(copy.zombies[0].sprintUntilS).toBeDefined();
    // Äldre match: ingen sprintStartS ⇒ antas börja `sprintDurationS` före slutet (v2.1-form), utan krasch.
    const legacyZ = { sprintUntilS: z.sprintUntilS!, sprintStartS: undefined };
    expect(zombieSpeedFactor(rules, legacyZ, z.sprintUntilS! - 1)).toBeGreaterThanOrEqual(1);
  });
});
