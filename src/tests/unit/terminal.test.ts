import { describe, expect, it } from "vitest";
import { RULES_VERSION, STEP_S, resolveRules } from "@/config/game-rules";
import { resolveModeRules } from "@/config/modes";
import { abortGame, createGame, pauseGame, resumeGame, stepGame } from "@/engine/core/engine";
import type { GameEvent, GameState } from "@/engine/core/types";
import { createObjectives, objectiveProgress } from "@/engine/objectives/objectives";
import { edgeLatLon } from "@/geo/graph/graph";
import { makeGoalBot, newBotStats } from "@/sim/bots";
import { SimSession } from "@/sim/runner";
import { gridGraph } from "@/sim/test-graphs";

const g = gridGraph(14, 14, 120);
const at = (edgeId: string, distM: number) => edgeLatLon(g, { edgeId, distM });
const start = at("r7:5", 60);
const cfg = (mode: "survival" | "escape" | "mission", seed = 1) => ({ activity: "walk" as const, difficulty: "normal" as const, durationSeconds: 3000, areaId: "t", seed, rulesVersion: RULES_VERSION, mode });

/** Spelare som står stilla vid `start` med en zombie 5 m bort och infektionstimern 0,2 s från klar. */
function nearInfection(state: GameState) {
  const z = state.zombies[0] ?? { id: "z0", edgeId: "r7:5", distanceAlongEdgeM: 65, speedMps: 0, state: "patrol" as const, dir: 1 as const, route: [], stateSinceS: 0, replanAtS: 0, tacticalAtS: 1e9, contactLostS: 0, canIntercept: false };
  z.edgeId = "r7:5"; z.distanceAlongEdgeM = 65; z.speedMps = 0; z.route = []; z.state = "patrol";
  state.zombies = [z];
  state.infectionProgressSeconds = 3 - STEP_S;
}

describe("gemensam målstatus (objectiveProgress)", () => {
  const mission = () => createObjectives([
    { id: "C1", kind: "checkpoint", ...at("r2:2", 10) },
    { id: "C2", kind: "checkpoint", ...at("r3:3", 10) },
    { id: "C3", kind: "checkpoint", ...at("r4:4", 10) },
    { id: "A", kind: "home", ...start },
  ]);
  it("Mission: tre checkpoints och hem räknas aldrig som 3/4", () => {
    const o = mission();
    const seen: string[] = [];
    for (let i = 0; i <= 4; i++) {
      o.index = i;
      const p = objectiveProgress(o);
      seen.push(`${p.stage}:${p.primaryReached}/${p.primaryTotal}:${p.homeReached}`);
    }
    expect(seen).toEqual(["checkpoint:0/3:false", "checkpoint:1/3:false", "checkpoint:2/3:false", "home:3/3:false", "done:3/3:true"]);
  });
  it("A TO B: destinationen är det enda primära målet, ingen hemkomst", () => {
    const o = createObjectives([{ id: "B", kind: "destination", ...at("r7:9", 0) }]);
    expect(objectiveProgress(o)).toMatchObject({ stage: "destination", primaryTotal: 1, primaryReached: 0, hasHome: false });
    o.index = 1;
    expect(objectiveProgress(o)).toMatchObject({ stage: "done", primaryReached: 1 });
  });
});

describe("terminala tillstånd är ömsesidigt uteslutande och slutgiltiga", () => {
  it("fångst och mål på samma steg: fångst vinner (fast regel, ett enda 'finished')", () => {
    const objectives = createObjectives([{ id: "B", kind: "destination", ...start }]);
    const rules = resolveModeRules("escape", "walk", "normal", 3000);
    const { state } = createGame({ g, config: cfg("escape"), rules, start, objectives });
    nearInfection(state);
    objectives.holdS = 5 - STEP_S; // målet skulle bekräftas på just detta steg
    state.phase = "survival";
    const ev = stepGame(g, state, rules, { position: start, quality: "ok", accuracyM: 5 });
    expect(ev.filter((e) => e.type === "finished")).toEqual([{ type: "finished", result: "infected" }]);
    expect(state.result).toBe("infected");
    expect(ev.some((e) => e.type === "objective_reached")).toBe(false);
  });

  it("extraction som bekräftas samma steg som tidsgränsen går ut räknas som vinst", () => {
    const rules = { ...resolveRules("walk", "normal", 3000), initialZombies: 0, maxZombies: 0 };
    const { state } = createGame({ g, config: cfg("survival"), rules, start });
    state.phase = "extraction";
    state.extractionNodeId = g.edges.get("r7:5")!.to;
    const ex = g.nodes.get(state.extractionNodeId)!;
    state.player.position = ex;
    state.extractionHoldS = 5 - STEP_S;
    state.elapsedSeconds = rules.durationS - STEP_S;
    const ev = stepGame(g, state, rules, { position: ex, quality: "ok", accuracyM: 5 });
    expect(state.result).toBe("survived");
    expect(ev.filter((e) => e.type === "finished")).toHaveLength(1);
  });

  it("efter avslut ignoreras allt: GPS, tid, paus, fortsätt och avbryt ändrar varken resultat eller tillstånd", () => {
    const objectives = createObjectives([{ id: "B", kind: "destination", ...start }]);
    const rules = resolveModeRules("escape", "walk", "normal", 3000);
    const { state } = createGame({ g, config: cfg("escape"), rules, start, objectives });
    nearInfection(state);
    state.phase = "survival";
    stepGame(g, state, rules, { position: start, quality: "ok", accuracyM: 5 });
    expect(state.result).toBe("infected");
    const frozen = JSON.stringify(state);
    const later: GameEvent[] = [];
    for (let i = 0; i < 200; i++) later.push(...stepGame(g, state, rules, { position: at("r7:9", 0), quality: "ok", accuracyM: 5 }));
    pauseGame(state); resumeGame(state);
    later.push(...abortGame(state, "aborted"), ...abortGame(state, "incomplete"));
    expect(later).toEqual([]);
    expect(state.result).toBe("infected");
    expect(JSON.stringify(state).replace('"paused":true', '"paused":false')).toBe(frozen.replace('"paused":true', '"paused":false'));
  });
});

describe("alla tre spellägen: exakt ett slutresultat, mål registreras högst en gång", () => {
  const modes: { mode: "survival" | "escape" | "mission"; objectives?: () => ReturnType<typeof createObjectives> }[] = [
    { mode: "survival" },
    { mode: "escape", objectives: () => createObjectives([{ id: "B", kind: "destination", ...at("r7:9", 0) }]) },
    { mode: "mission", objectives: () => createObjectives([
      { id: "C1", kind: "checkpoint", ...at("r5:5", 60) },
      { id: "C2", kind: "checkpoint", ...at("r9:8", 60) },
      { id: "A", kind: "home", ...start },
    ]) },
  ];
  for (const { mode, objectives } of modes) {
    it(`${mode}: ett enda 'finished', stabilt resultat, mål i ordning`, () => {
      const results = new Set<string>();
      for (let seed = 1; seed <= 6; seed++) {
        const obj = objectives?.();
        const s = new SimSession({ g, activity: "walk", difficulty: "normal", durationS: 1500, seed, strategy: "avoid", start, mode, objectives: obj, strategyFn: obj ? makeGoalBot("planner", newBotStats()) : undefined });
        while (!s.finished) s.step();
        const finals = s.events.filter((e) => e.type === "finished");
        expect(finals).toHaveLength(1);
        const result = s.state.result!;
        results.add(result);
        const reached = s.events.filter((e) => e.type === "objective_reached");
        const ids = reached.map((e) => (e as { targetId: string }).targetId);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual((obj?.targets ?? []).slice(0, ids.length).map((t) => t.id));
        if (result === "survived" && obj) expect(ids).toHaveLength(obj.targets.length);
        // Fler steg efter avslut ändrar ingenting.
        const snap = JSON.stringify(s.state);
        for (let i = 0; i < 50; i++) s.step();
        expect(JSON.stringify(s.state)).toBe(snap);
      }
      for (const r of results) expect(["survived", "infected", "failed"]).toContain(r);
    });
  }
});
