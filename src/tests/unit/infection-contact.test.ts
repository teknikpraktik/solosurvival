import { describe, expect, it } from "vitest";
import { RULES_VERSION, STEP_S, resolveRules } from "@/config/game-rules";
import { createGame, stepGame } from "@/engine/core/engine";
import type { Zombie } from "@/engine/core/types";
import { infectionContactM } from "@/engine/infection/contact";
import { fromLocal, haversineM } from "@/geo/geometry";
import { buildGraph, type RawWay } from "@/geo/graph/build";
import { indexGraph, snapToGraph } from "@/geo/graph/graph";
import { rand } from "@/engine/core/rng";
import { ORIGIN } from "@/sim/test-graphs";

type P = [number, number];
const ll = ([x, y]: P) => fromLocal(ORIGIN, { x, y });
const w = (id: string, pts: [string, P][], extra: Partial<RawWay> = {}): RawWay => ({ id, type: "path", nodes: pts.map(([n, p]) => ({ id: n, ...ll(p) })), ...extra });
const graph = (ways: RawWay[]) => indexGraph(buildGraph(ways, "t"));
const zAt = (g: ReturnType<typeof graph>, p: P): Zombie => {
  const s = snapToGraph(g, ll(p))!;
  return { id: "z", edgeId: s.edgeId, distanceAlongEdgeM: s.distM, speedMps: 0, state: "patrol", dir: 1, route: [], stateSinceS: 0, replanAtS: 0, tacticalAtS: 1e9, contactLostS: 0, canIntercept: false };
};
const snapOf = (g: ReturnType<typeof graph>, p: P) => { const s = snapToGraph(g, ll(p))!; return { edgeId: s.edgeId, distM: s.distM }; };

/** Två gångstråk 12 m från varandra (t.ex. trottoarer på var sida om en väg), förbundna först 300 m bort i båda ändar. */
const twoWalks = () => graph([
  w("A", [["a-300", [-300, 0]], ["a-100", [-100, 0]], ["a0", [0, 0]], ["a100", [100, 0]], ["a300", [300, 0]]]),
  w("B", [["b-300", [-300, 12]], ["b-100", [-100, 12]], ["b0", [0, 12]], ["b100", [100, 12]], ["b300", [300, 12]]]),
  w("L1", [["a-300", [-300, 0]], ["b-300", [-300, 12]]]),
  w("L2", [["a300", [300, 0]], ["b300", [300, 12]]]),
]);

describe("infektion kräver fysisk möjlighet att mötas, inte bara koordinatnärhet", () => {
  it("5 m bort på andra sidan en barriär med närmaste passage 300 m bort: ingen kontakt", () => {
    const g = graph([
      w("A", [["a-300", [-300, 0]], ["a0", [0, 0]], ["a300", [300, 0]]]),
      w("B", [["b-300", [-300, 5]], ["b0", [0, 5]], ["b300", [300, 5]]]),
      w("L1", [["a-300", [-300, 0]], ["b-300", [-300, 5]]]),
      w("L2", [["a300", [300, 0]], ["b300", [300, 5]]]),
    ]);
    expect(haversineM(ll([0, 0]), ll([0, 5]))).toBeCloseTo(5, 0);
    expect(infectionContactM(g, ll([0, 5]), snapOf(g, [0, 5]), [zAt(g, [0, 0])])).toBe(Infinity);
  });

  it("samma gångstråk: kontakt på det verkliga avståndet, även vid en kurva (gångavstånd lite längre än fågelvägen)", () => {
    const g = graph([w("C", [["c0", [0, 0]], ["c1", [18, 0]], ["c2", [18, 14]]])]);
    // Fågelvägen 18 m, gångavstånd 32 m: en kurva ska inte skydda mot smitta.
    const d = infectionContactM(g, ll([18, 14]), snapOf(g, [18, 14]), [zAt(g, [0, 0])]);
    expect(d).toBeCloseTo(haversineM(ll([0, 0]), ll([18, 14])), 0);
    expect(d).toBeLessThan(25);
  });

  it("en lång omväg räknas inte som närhet: 15 m fågelvägen men 120 m att gå = ingen kontakt", () => {
    const g = graph([
      w("U", [["u0", [0, 0]], ["u1", [0, 60]], ["u2", [15, 60]], ["u3", [15, 0]]]),
    ]);
    expect(infectionContactM(g, ll([15, 0]), snapOf(g, [15, 0]), [zAt(g, [0, 0])])).toBe(Infinity);
  });

  it("tunnel under en gångväg/bro: ovanpå varandra i koordinater men inte på samma nivå = ingen kontakt", () => {
    const g = graph([
      w("over", [["o-200", [-200, 0]], ["o0", [0, 0]], ["o200", [200, 0]]], { type: "footway", grade: "bridge" }),
      w("under", [["u-200", [-200, 0.5]], ["u0", [0, 0.5]], ["u200", [200, 0.5]]], { type: "footway", grade: "tunnel" }),
      w("l1", [["o-200", [-200, 0]], ["u-200", [-200, 0.5]]]),
      w("l2", [["o200", [200, 0]], ["u200", [200, 0.5]]]),
    ]);
    expect(infectionContactM(g, ll([0, 0]), snapOf(g, [0, 0]), [zAt(g, [0, 0.5])])).toBe(Infinity);
    // Samma nivå (båda på bron): kontakt.
    expect(infectionContactM(g, ll([0, 0]), snapOf(g, [0, 0]), [zAt(g, [10, 0])])).toBeCloseTo(10, 0);
  });

  it("enkelriktad stig (cykel): en zombie bakom spelaren smittar lika väl som en framför", () => {
    const g = graph([w("one", [["n0", [-100, 0]], ["n1", [0, 0]], ["n2", [100, 0]]], { oneway: true })]);
    const player = ll([0, 0]);
    const behind = infectionContactM(g, player, snapOf(g, [0, 0]), [zAt(g, [-8, 0])]);
    const ahead = infectionContactM(g, player, snapOf(g, [0, 0]), [zAt(g, [8, 0])]);
    expect(behind).toBeCloseTo(8, 0);
    expect(ahead).toBeCloseTo(8, 0);
  });

  it("enkelriktad stig: zombie på föregående kant (andra sidan en nod) smittar också", () => {
    // En sidogren i n1 delar den enkelriktade stigen i två kanter (n0→n1, n1→n2).
    const g = graph([w("one", [["n0", [-100, 0]], ["n1", [0, 0]], ["n2", [100, 0]]], { oneway: true }), w("stub", [["n1", [0, 0]], ["s", [0, 40]]])]);
    const d = infectionContactM(g, ll([5, 0]), snapOf(g, [5, 0]), [zAt(g, [-12, 0])]);
    expect(d).toBeCloseTo(17, 0);
  });

  it("vid kontakt över själva korsningen (passage nära) smittar det normalt", () => {
    const g = graph([
      w("A", [["a-20", [-20, 0]], ["a0", [0, 0]], ["a20", [20, 0]]]),
      w("B", [["b-20", [-20, 8]], ["b0", [0, 8]], ["b20", [20, 8]]]),
      w("X", [["a0", [0, 0]], ["b0", [0, 8]]]),
    ]);
    expect(infectionContactM(g, ll([0, 8]), snapOf(g, [0, 8]), [zAt(g, [0, 0])])).toBeCloseTo(8, 0);
  });
});

describe("GPS-brus gör inte infektion orimligt svår", () => {
  const g = twoWalks();
  const rules = { ...resolveRules("walk", "normal", 3000), headStartS: 0, initialZombies: 1, maxZombies: 1, magnetic: false, detectionRadiusM: 0, revealIntervalS: 1e9, sprintRadiusM: 0 };
  /** Spelare på stråk A vid x = 5 med brus σ; zombie står på A vid x = 0. Andel som smittas inom `secs`. */
  function infectedShare(sigma: number, secs: number, runs: number, playerY: number) {
    let infected = 0;
    for (let seed = 1; seed <= runs; seed++) {
      const rng = { rngState: seed * 7919 };
      const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rand(rng)))) * Math.cos(2 * Math.PI * rand(rng));
      const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed, rulesVersion: RULES_VERSION }, rules, start: ll([5, 0]) });
      state.zombies = [zAt(g, [0, 0])];
      for (let i = 0; i < Math.round(secs / STEP_S) && state.result === undefined; i++) {
        // Ett nytt brusigt GPS-värde varje sekund (som en riktig fix), annars samma.
        if (i % 5 === 0) state.player.position = ll([5 + gauss() * sigma, playerY + gauss() * sigma]);
        stepGame(g, state, rules, { position: state.player.position, quality: "ok", accuracyM: 6 });
      }
      if (state.result === "infected") infected++;
    }
    return infected / runs;
  }

  it("på samma stråk som zombien: nästan alla smittas inom 20 s trots brus på 4 m", () => {
    expect(infectedShare(4, 20, 30, 0)).toBeGreaterThanOrEqual(0.9);
  });
  it("på andra stråket 12 m bort (passage 300 m bort): nästan ingen smittas, trots brus på 4 m", () => {
    expect(infectedShare(4, 20, 30, 12)).toBeLessThanOrEqual(0.1);
  });
});

describe("cykel: genomcykling är borttagen (fälttest: inte trovärdigt)", () => {
  const g = twoWalks();
  const base = { headStartS: 0, initialZombies: 1, maxZombies: 1, magnetic: false, detectionRadiusM: 0, revealIntervalS: 1e9, sprintRadiusM: 0 };
  /** Spelaren färdas längs stråk A från x = -100 till +100 i `kmh`, ny GPS-fix varje sekund; zombien står still vid x = 0. */
  function rideThrough(activity: "mtb" | "walk", kmh: number) {
    const rules = { ...resolveRules(activity, "normal", 3000), ...base };
    const { state } = createGame({ g, config: { activity, difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 1, rulesVersion: RULES_VERSION }, rules, start: ll([-100, 0]) });
    state.zombies = [zAt(g, [0, 0])];
    const v = kmh / 3.6;
    let pos = ll([-100, 0]);
    for (let i = 0; (i * STEP_S) * v <= 200 && state.result === undefined; i++) {
      if (i % 5 === 0) pos = ll([-100 + i * STEP_S * v, 0]);
      stepGame(g, state, rules, { position: pos, quality: "ok", accuracyM: 5 });
    }
    return state.result;
  }

  it("cykel i 28 km/h förbi en zombie: smittad, som i alla farter", () => {
    expect(rideThrough("mtb", 28)).toBe("infected");
  });
  it("cykel i 18 km/h förbi en zombie: smittad", () => {
    expect(rideThrough("mtb", 18)).toBe("infected");
  });
  it("ingen aktivitet har genomcykling", () => {
    expect(resolveRules("walk", "normal", 3000).passThroughMps).toBeUndefined();
    expect(resolveRules("mtb", "normal", 3000).passThroughMps).toBeUndefined();
  });
});

describe("genomcyklingens mekanism (avstängd i reglerna, kvar i motorn)", () => {
  it("påslagen i reglerna: pass_through skickas en gång per möte, inte varje steg", () => {
    const g = twoWalks();
    const rules = { ...resolveRules("mtb", "normal", 3000), passThroughMps: 25 / 3.6, headStartS: 0, initialZombies: 1, maxZombies: 1, magnetic: false, detectionRadiusM: 0, revealIntervalS: 1e9, sprintRadiusM: 0 };
    const { state } = createGame({ g, config: { activity: "mtb", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed: 1, rulesVersion: RULES_VERSION }, rules, start: ll([-100, 0]) });
    state.zombies = [zAt(g, [0, 0])];
    const v = 30 / 3.6;
    let n = 0;
    let pos = ll([-100, 0]);
    for (let i = 0; i * STEP_S * v <= 200 && state.result === undefined; i++) {
      if (i % 5 === 0) pos = ll([-100 + i * STEP_S * v, 0]);
      n += stepGame(g, state, rules, { position: pos, quality: "ok", accuracyM: 5 }).filter((e) => e.type === "pass_through").length;
    }
    expect(state.result).toBeUndefined();
    expect(n).toBe(1);
  });
});
