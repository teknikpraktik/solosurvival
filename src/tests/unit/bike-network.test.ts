import { describe, expect, it } from "vitest";
import { RULES_VERSION, STEP_S, resolveRules } from "@/config/game-rules";
import { resolveModeRules } from "@/config/modes";
import { createGame, stepGame } from "@/engine/core/engine";
import { zombieLatLon } from "@/engine/core/movement";
import type { GameState, Zombie } from "@/engine/core/types";
import { OFF_BUDGET_S, OFF_ENTER_S, OFF_REGEN_PER_S, effectiveOffsetM, initialOffNetwork, isExposed, updateOffNetwork } from "@/engine/offnetwork";
import { DEFAULT_COMPONENT_POLICY, pickComponent, type ComponentCandidate, type ComponentPolicy } from "@/data/region-graph";
import { fromLocal, haversineM, type LatLon } from "@/geo/geometry";
import { buildGraph, type RawWay } from "@/geo/graph/build";
import { edgeLatLon, indexGraph } from "@/geo/graph/graph";
import { bikeNetworkAdvice } from "@/play/prepare";
import { ORIGIN, gridGraph } from "@/sim/test-graphs";
import type { RegionGraph } from "@/data/region-graph";

const cand = (id: number, distM: number, lenM: number): ComponentCandidate => ({ id, edgeId: `e${id}`, distM, len: lenM });
const ALL: ComponentPolicy[] = ["nearest", "largest150", "largest300", "largest500", "scored", "scored150"];

describe("val av startkomponent (pickComponent)", () => {
  it("standardregeln är fortfarande den närmaste delen på minst 1,5 km (mätningarna motiverade ingen ändring)", () => {
    expect(DEFAULT_COMPONENT_POLICY).toBe("nearest");
    // Närmaste del (12 m) är bara 1,2 km: hoppas över. Näst närmaste användbara (60 m, 2 km) väljs, inte den längre (140 m, 20 km).
    expect(pickComponent([cand(1, 12, 1200), cand(2, 60, 2000), cand(3, 140, 20000)], "nearest")?.id).toBe(2);
  });

  it("finns ingen del på 1,5 km väljs den närmaste överhuvudtaget", () => {
    for (const p of ALL) expect(pickComponent([cand(1, 90, 400), cand(2, 30, 900)], p)?.id).toBe(2);
    expect(pickComponent([], "nearest")).toBeNull();
  });

  it("flera delar nära start: largestN tar den längsta inom N m, och faller tillbaka på närmaste om ingen finns", () => {
    const cs = [cand(1, 20, 2000), cand(2, 120, 9000), cand(3, 250, 30000), cand(4, 450, 60000)];
    expect(pickComponent(cs, "largest150")?.id).toBe(2);
    expect(pickComponent(cs, "largest300")?.id).toBe(3);
    expect(pickComponent(cs, "largest500")?.id).toBe(4);
    expect(pickComponent([cand(1, 200, 5000)], "largest150")?.id).toBe(1); // ingen inom 150 m: närmaste regeln
  });

  it("en stor men avlägsen del är inte automatiskt bättre: poängen väger avstånd mot längd", () => {
    const cs = [cand(1, 10, 4000), cand(2, 400, 60000)];
    expect(pickComponent(cs, "scored")?.id).toBe(1);
    expect(pickComponent(cs, "largest500")?.id).toBe(2);
  });

  it("samma indata ger samma val oavsett kandidatordning (deterministiskt), även vid lika avstånd och längd", () => {
    const cs = [cand(5, 40, 5000), cand(2, 40, 5000), cand(9, 40, 5000), cand(4, 80, 90000)];
    for (const p of ALL) {
      const a = pickComponent(cs, p)?.id;
      expect(pickComponent([...cs].reverse(), p)?.id).toBe(a);
      expect(pickComponent([cs[2], cs[0], cs[3], cs[1]], p)?.id).toBe(a);
    }
  });
});

describe("cykel utan tillräckligt cykelbart nät: begripligt meddelande, ingen automatisk lägesändring", () => {
  const region = (startSnapM: number | null, componentKm: number) => ({ startSnapM, stats: { componentKm } }) as unknown as RegionGraph;
  it("off_network, sparse och no_route får ett cykelmeddelande och förslaget walk", () => {
    for (const status of ["off_network", "sparse", "no_route"] as const) {
      const r = bikeNetworkAdvice({ status, message: "x" }, "mtb", region(320, 2.2));
      expect(r.message).toMatch(/not enough rideable roads/);
      expect(r.message).toMatch(/another start, or switch to walking/);
      expect(r.alternatives).toEqual(["walk"]);
    }
    expect(bikeNetworkAdvice({ status: "off_network", message: "x" }, "mtb", region(320, 2.2)).message).toMatch(/about 320 m away/);
    expect(bikeNetworkAdvice({ status: "sparse", message: "x" }, "mtb", region(10, 2.2)).message).toMatch(/2\.2 km/);
  });
  it("ok/alternative och gångläge lämnas orörda", () => {
    expect(bikeNetworkAdvice({ status: "ok" }, "mtb", region(5, 40))).toEqual({ status: "ok" });
    expect(bikeNetworkAdvice({ status: "alternative", message: "a" }, "mtb", region(5, 40)).alternatives).toBeUndefined();
    const walk = { status: "off_network" as const, message: "orig" };
    expect(bikeNetworkAdvice(walk, "walk", region(null, 0))).toEqual(walk);
  });
});

describe("off-network: klassificering", () => {
  const run = (s = initialOffNetwork(), secs = 0, raw: number | null = 0, acc = 5) => { const ch: (string | null)[] = []; for (let t = 0; t < secs; t += STEP_S) ch.push(updateOffNetwork(s, STEP_S, raw, acc)); return { s, ch: ch.filter(Boolean) }; };

  it("GPS-brus och dålig noggrannhet räknas inte: stort avstånd med dålig noggrannhet ger lägre effektivt avstånd", () => {
    expect(effectiveOffsetM(45, 25)).toBe(20);
    expect(effectiveOffsetM(45, 80)).toBe(20); // avdraget är begränsat, så dålig noggrannhet kan inte trolla bort ett verkligt avstånd
    const { s } = run(initialOffNetwork(), 60, 45, 25); // 45 m med 25 m osäkerhet = 20 m
    expect(s.active).toBe(false);
    const r = run(initialOffNetwork(), 60, 400, 60); // sämre än 40 m: positionen används inte
    expect(r.s.active).toBe(false);
  });

  it("kort avvikelse (< 8 s) tolereras och nollställer räknaren", () => {
    const s = initialOffNetwork();
    run(s, 6, 80, 5); run(s, 1, 0, 5); run(s, 6, 80, 5);
    expect(s.active).toBe(false);
  });

  it("varaktig avvikelse ger exakt ett 'entered' efter OFF_ENTER_S, och hysteres vid återkomst", () => {
    const a = run(initialOffNetwork(), OFF_ENTER_S + 1, 80, 5);
    expect(a.ch).toEqual(["entered"]);
    expect(a.s.active).toBe(true);
    // Effektivt 35 m (40 m minus 5 m osäkerhet) räknas inte som återkomst (utgångströskel 25 m), 10 m i 3 s gör det.
    expect(run(a.s, 10, 40, 5).s.active).toBe(true);
    const b = run(a.s, 4, 10, 5);
    expect(b.ch).toEqual(["left"]);
    expect(b.s.active).toBe(false);
  });

  it("budgeten: 90 s utanför ger exakt ett 'exposed'; på nätet fylls den på 0,3 s per s", () => {
    const s = initialOffNetwork();
    const r = run(s, OFF_ENTER_S + OFF_BUDGET_S + 2, 80, 5);
    expect(r.ch).toEqual(["entered", "exposed"]);
    expect(isExposed(s)).toBe(true);
    run(s, 10, 0, 5); // lämnar
    expect(s.active).toBe(false);
    const b0 = s.budgetS;
    run(s, 100, 0, 5);
    expect(s.budgetS - b0).toBeCloseTo(Math.min(OFF_BUDGET_S - b0, 100 * OFF_REGEN_PER_S), 5);
  });
});

/* --- Motorn --- */
const g = gridGraph(14, 14, 120);
const at = (edgeId: string, distM: number) => edgeLatLon(g, { edgeId, distM });
const start = at("r7:5", 60);
const north = (p: LatLon, m: number): LatLon => ({ lat: p.lat + m / 111_320, lon: p.lon });
const CFG = (mode: "survival" | "mission" | "escape" = "survival") => ({ activity: "mtb" as const, difficulty: "normal" as const, durationSeconds: 3000, areaId: "t", seed: 1, rulesVersion: RULES_VERSION, mode });

function stationaryZombie(state: GameState, edgeId: string, distM: number): Zombie {
  const z = state.zombies[0] ?? { id: "z0", edgeId, distanceAlongEdgeM: distM, speedMps: 0, state: "chase" as const, dir: 1 as const, route: [], stateSinceS: 0, replanAtS: 0, tacticalAtS: 1e9, contactLostS: 0, canIntercept: false };
  Object.assign(z, { edgeId, distanceAlongEdgeM: distM, speedMps: 0, route: [], state: "chase" });
  state.zombies = [z];
  return z;
}
function game(activity: "mtb" | "walk", mode: "survival" | "mission" | "escape" = "survival") {
  const rules = { ...resolveModeRules(mode, activity, "normal", 3000), initialZombies: 0, maxZombies: 0, headStartS: 0 };
  const { state } = createGame({ g, config: { ...CFG(mode), activity }, rules, start });
  state.phase = "survival";
  return { rules, state };
}
const step = (s: GameState, rules: ReturnType<typeof game>["rules"], pos: LatLon, n: number) => { const ev = []; for (let i = 0; i < n; i++) ev.push(...stepGame(g, s, rules, { position: pos, quality: "ok", accuracyM: 5 })); return ev; };

describe("off-network i motorn (cykel)", () => {
  it("bakgrund: 50 m från vägen utan skydd var förut ofarligt för alltid – nu exponeras spelaren när budgeten är slut", () => {
    const { rules, state } = game("mtb");
    expect(rules.offNetworkExposure).toBe(true);
    const z = stationaryZombie(state, "r7:5", 60); // väntar vid närmaste vägpunkt
    const off = north(start, 50);
    const ev1 = step(state, rules, off, Math.round((OFF_ENTER_S + 60) / STEP_S));
    expect(ev1.some((e) => e.type === "off_network" && e.change === "entered")).toBe(true);
    expect(state.result).toBeUndefined(); // 60 s: budgeten räcker
    expect(state.infectionProgressSeconds).toBe(0);
    const ev2 = step(state, rules, off, Math.round(60 / STEP_S));
    expect(ev2.some((e) => e.type === "off_network" && e.change === "exposed")).toBe(true);
    expect(state.result).toBe("infected");
    expect(haversineM(zombieLatLon(g, z), start)).toBeLessThan(1); // zombien har inte flyttats
  });

  it("gångläge påverkas inte (ingen klassificering, ingen exponering, samma resultat som före)", () => {
    const { rules, state } = game("walk");
    expect(rules.offNetworkExposure).toBe(false);
    expect(state.offNetwork).toBeUndefined();
    stationaryZombie(state, "r7:5", 60);
    const ev = step(state, rules, north(start, 50), Math.round(400 / STEP_S));
    expect(ev.some((e) => e.type === "off_network")).toBe(false);
    expect(state.result).toBeUndefined();
  });

  it("GPS-brus nära vägen: 25 m från vägen med 6 m brus utlöser aldrig läget", () => {
    const { rules, state } = game("mtb");
    stationaryZombie(state, "r7:5", 400); // långt bort
    let seed = 3; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 2;
    const ev = [];
    for (let i = 0; i < 1500; i++) ev.push(...stepGame(g, state, rules, { position: north(start, 25 + rnd() * 10), quality: "ok", accuracyM: 10 }));
    expect(ev.some((e) => e.type === "off_network")).toBe(false);
    expect(state.offNetwork!.active).toBe(false);
  });

  it("en zombie på andra sidan en barriär (ingen väg mellan) räknas inte som väntande, en på samma väg gör det", () => {
    // Två parallella stigar 12 m från varandra, förbundna först långt bort: spelaren utanför nätet snappas till den övre.
    const mk = (id: string, y: number, pts: number[]): RawWay => ({ id, type: "path", nodes: pts.map((x, i) => { const ll = fromLocal(ORIGIN, { x, y }); return { id: `${id}${i}`, lat: ll.lat, lon: ll.lon }; }) });
    const up = mk("U", 0, [-300, -100, 0, 100, 300]);
    const down = mk("D", -12, [-300, -100, 0, 100, 300]);
    const link: RawWay = { id: "L", type: "path", nodes: [{ id: "U0", ...fromLocal(ORIGIN, { x: -300, y: 0 }) }, { id: "D0", ...fromLocal(ORIGIN, { x: -300, y: -12 }) }] };
    const bg = indexGraph(buildGraph([up, down, link], "synthetic"));
    const rules = { ...resolveModeRules("survival", "mtb", "normal", 3000), initialZombies: 0, maxZombies: 0, headStartS: 0 };
    const upEdge = [...bg.edges.values()].find((e) => e.id.startsWith("U") && e.lengthM > 50)!;
    const p0 = edgeLatLon(bg, { edgeId: upEdge.id, distM: upEdge.lengthM / 2 });
    const mkState = (zEdge: string, zDist: number) => {
      const { state } = createGame({ g: bg, config: { ...CFG(), activity: "mtb" }, rules, start: p0 });
      state.phase = "survival";
      state.zombies = [{ id: "z", edgeId: zEdge, distanceAlongEdgeM: zDist, speedMps: 0, state: "chase", dir: 1, route: [], stateSinceS: 0, replanAtS: 0, tacticalAtS: 1e9, contactLostS: 0, canIntercept: false }];
      state.offNetwork = { ...initialOffNetwork(), active: true, budgetS: 0 };
      return state;
    };
    const off = { lat: p0.lat + 50 / 111_320, lon: p0.lon };
    const downEdge = [...bg.edges.values()].find((e) => e.id.startsWith("D") && e.lengthM > 50)!;
    const across = mkState(downEdge.id, downEdge.lengthM / 2);
    for (let i = 0; i < 100; i++) stepGame(bg, across, rules, { position: off, quality: "ok", accuracyM: 5 });
    expect(across.result).toBeUndefined();
    const same = mkState(upEdge.id, upEdge.lengthM / 2 + 5);
    for (let i = 0; i < 100; i++) stepGame(bg, same, rules, { position: off, quality: "ok", accuracyM: 5 });
    expect(same.result).toBe("infected");
  });

  it("zombierna fortsätter jaga och hoppar inte: utanför nätet och vid återkomst rör de sig högst en stegs fart", () => {
    const { rules, state } = game("mtb");
    const z0 = stationaryZombie(state, "r2:2", 30);
    z0.speedMps = rules.zombieSpeedMps; z0.state = "patrol";
    const off = north(start, 50);
    let prev = zombieLatLon(g, z0);
    let maxJump = 0, chased = false;
    const maxStep = rules.zombieSpeedMps * rules.sprintSpeedFactor * STEP_S + 0.05;
    for (let i = 0; i < 3000 && !state.result; i++) {
      // Första 90 s utanför nätet, sedan tillbaka på vägen.
      const pos = i * STEP_S < 90 ? off : start;
      stepGame(g, state, rules, { position: pos, quality: "ok", accuracyM: 5 });
      const now = zombieLatLon(g, z0);
      maxJump = Math.max(maxJump, haversineM(prev, now));
      prev = now;
      if (state.zombies[0].state === "chase" || state.zombies[0].state === "intercept") chased = true;
    }
    expect(chased).toBe(true);
    expect(maxJump).toBeLessThanOrEqual(maxStep);
    expect(state.result === undefined || state.result === "infected").toBe(true);
  });

  it("utnyttjande: gå utanför vägen i 60 s, tillbaka, och igen – budgeten återfylls bara långsamt, så en jagande zombie smittar till slut", () => {
    const { rules, state } = game("mtb");
    stationaryZombie(state, "r7:5", 60);
    const off = north(start, 50);
    let cycles = 0;
    while (!state.result && cycles < 40) { step(state, rules, off, Math.round(70 / STEP_S)); if (state.result) break; step(state, rules, start, Math.round(20 / STEP_S)); cycles++; }
    expect(state.result).toBe("infected");
    expect(cycles).toBeLessThan(6);
  });

  it("en match sparad före 2.3 (utan offNetwork) kan fortsätta utan fel", () => {
    const { rules, state } = game("mtb");
    delete state.offNetwork;
    stationaryZombie(state, "r7:5", 400);
    expect(() => step(state, rules, north(start, 50), 200)).not.toThrow();
    expect(state.offNetwork).toBeDefined();
  });

  it("Survival, Mission och A TO B: samma regel i alla lägen; Mission och A TO B startar utan fel", () => {
    for (const mode of ["survival", "mission", "escape"] as const) {
      const rules = resolveRules("mtb", "hard", 3000);
      expect(rules.offNetworkExposure).toBe(true);
      expect(resolveModeRules(mode, "mtb", "hard", 3000).offNetworkExposure).toBe(true);
    }
  });
});
