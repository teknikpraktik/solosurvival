/* GPS-brus mot infektionsregeln (v2.2): andel som smittas inom 20 s på samma stråk resp. på ett stråk 12 m bort (passage 300 m bort),
 * jämfört med den gamla regeln (bara fågelvägen). Syntetisk geometri; brus i meter (standardavvikelse per axel). */
import { RULES_VERSION, STEP_S, resolveRules } from "../src/config/game-rules";
import { createGame, stepGame } from "../src/engine/core/engine";
import { updateInfection } from "../src/engine/infection/infection";
import { zombieLatLon } from "../src/engine/core/movement";
import { rand } from "../src/engine/core/rng";
import { fromLocal, haversineM } from "../src/geo/geometry";
import { buildGraph, type RawWay } from "../src/geo/graph/build";
import { indexGraph, snapToGraph } from "../src/geo/graph/graph";
import { ORIGIN } from "../src/sim/test-graphs";
type P = [number, number];
const ll = ([x, y]: P) => fromLocal(ORIGIN, { x, y });
const w = (id: string, pts: [string, P][]): RawWay => ({ id, type: "path", nodes: pts.map(([n, p]) => ({ id: n, ...ll(p) })) });
const g = indexGraph(buildGraph([
  w("A", [["a-300", [-300, 0]], ["a0", [0, 0]], ["a300", [300, 0]]]), w("B", [["b-300", [-300, 12]], ["b0", [0, 12]], ["b300", [300, 12]]]),
  w("L1", [["a-300", [-300, 0]], ["b-300", [-300, 12]]]), w("L2", [["a300", [300, 0]], ["b300", [300, 12]]]),
], "t"));
const rules = { ...resolveRules("walk", "normal", 3000), headStartS: 0, initialZombies: 1, maxZombies: 1, magnetic: false, detectionRadiusM: 0, revealIntervalS: 1e9, sprintRadiusM: 0 };
const RUNS = 200;
console.log("| brus σ (m) | läge | gamla regeln (fågelvägen) | v2.2 (gångförbindelse) |\n|---|---|---|---|");
for (const sigma of [0, 2, 4, 6, 8]) for (const [name, y] of [["samma stråk, zombie 5 m bort", 0], ["andra stråket 12 m bort", 12]] as const) {
  let oldN = 0, newN = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const rng = { rngState: seed * 7919 };
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rand(rng)))) * Math.cos(2 * Math.PI * rand(rng));
    const { state } = createGame({ g, config: { activity: "walk", difficulty: "normal", durationSeconds: 3000, areaId: "t", seed, rulesVersion: RULES_VERSION }, rules, start: ll([5, 0]) });
    const s0 = snapToGraph(g, ll([0, 0]))!;
    state.zombies = [{ id: "z", edgeId: s0.edgeId, distanceAlongEdgeM: s0.distM, speedMps: 0, state: "patrol", dir: 1, route: [], stateSinceS: 0, replanAtS: 0, tacticalAtS: 1e9, contactLostS: 0, canIntercept: false }];
    let oldProg = 0, oldInf = false;
    for (let i = 0; i < Math.round(20 / STEP_S) && state.result === undefined; i++) {
      if (i % 5 === 0) state.player.position = ll([5 + gauss() * sigma, y + gauss() * sigma]);
      const r = updateInfection(oldProg, { dtS: STEP_S, nearestZombieM: haversineM(zombieLatLon(g, state.zombies[0]), state.player.position), quality: "ok", neutral: false });
      oldProg = r.progressS; oldInf ||= r.infected;
      stepGame(g, state, rules, { position: state.player.position, quality: "ok", accuracyM: 6 });
    }
    if (oldInf) oldN++;
    if (state.result === "infected") newN++;
  }
  console.log(`| ${sigma} | ${name} | ${Math.round((oldN / RUNS) * 100)}% | ${Math.round((newN / RUNS) * 100)}% |`);
}
