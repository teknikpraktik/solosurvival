/* A TO B i terräng (till fots): bygger terrängnätet på riktiga tiles (eller tomt) och mäter byggtid, storlek, kostnad per steg och utfall med simulerad spelare.
 *   npx tsx scripts/atob-terrain-sim.ts <antal seeds> [svårighet] [aktivitet]
 * Spelaren går fågelvägen via nätet ("follower": ingen hänsyn till zombier) eller undviker zombier ("planner"). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { TileStore } from "../src/data/store";
import { prepareMatch } from "../src/play/prepare";
import { defaultParams } from "../src/play/config";
import { SimSession } from "../src/sim/runner";
import { makeGoalBot, newBotStats } from "../src/sim/bots";
import { objectivesFromProposal } from "../src/routes/objectives";
import { resolveModeRules } from "../src/config/modes";
import { estimateTimeLimitS } from "../src/routes/timing";
import { COURSE_DETOUR_FACTOR } from "../src/routes/course";
import { haversineM, fromLocal, type LatLon } from "../src/geo/geometry";
import type { Difficulty } from "../src/config/difficulty";
import type { Activity } from "../src/config/activities";

const N = Number(process.argv[2] ?? 4);
const diff = (process.argv[3] ?? "normal") as Difficulty;
const activity = (process.argv[4] ?? "walk") as Activity;
const root = "public/data/v1/varmland";
const fsFetch = async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = new TileStore("/data/v1/varmland", fsFetch as never);
const wil = (k: number, n: number) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return `${Math.round(p * 100)}% (${Math.round((c - m) / d * 100)}–${Math.round((c + m) / d * 100)})`; };
const KARLSTAD: LatLon = { lat: 59.3793, lon: 13.5036 };
const FOREST: LatLon = { lat: 59.62, lon: 13.1 };
const OPEN: LatLon = { lat: 55.6, lon: 13.0 }; // utanför kartdata
const SCEN: [string, LatLon, number, number][] = [["Karlstad centrum", KARLSTAD, 1500, 40], ["Karlstad", KARLSTAD, 5000, 70], ["Skog", FOREST, 3000, 100], ["Skog", FOREST, 12000, 60], ["utanför kartdata", OPEN, 3000, 90], ["Karlstad", KARLSTAD, 20000, 80]];
console.log(`| område | A→B | prepare (ms) | noder / kanter | spacing | ms/steg | spelare | klarade målet | levande 10 min |\n|---|---|---|---|---|---|---|---|---|`);
const ONLY = process.env.ONLY ? Number(process.env.ONLY) : -1;
for (const [si, [name, a, distM, bearing]] of SCEN.entries()) {
  if (ONLY >= 0 && si !== ONLY) continue;
  const b = fromLocal(a, { x: distM * Math.sin((bearing * Math.PI) / 180), y: distM * Math.cos((bearing * Math.PI) / 180) });
  const p = { ...defaultParams(activity), mode: "escape" as const, difficulty: diff, pointA: a, pointB: b, seed: 3 };
  const t0 = performance.now();
  const prep = await prepareMatch(store, a, p);
  const prepMs = performance.now() - t0;
  if (prep.status !== "ok" || !prep.graph) { console.log(`| ${name} | ${distM} m | ${prepMs.toFixed(0)} | ${prep.status}: ${prep.message} |`); continue; }
  const g = prep.graph;
  const note = prep.notes.find((n) => n.startsWith("terrain-mesh")) ?? "";
  const spacing = /spacing (\d+)/.exec(note)?.[1] ?? "?";
  for (const bot of ["follower", "planner"] as const) {
    let ok = 0, a10 = 0, ms = 0, steps = 0;
    for (let i = 0; i < N; i++) {
      const proposal = prep.proposals[0];
      const durationS = estimateTimeLimitS(proposal.lengthM * COURSE_DETOUR_FACTOR, activity, diff, 1);
      const rules = resolveModeRules("escape", activity, diff, durationS, undefined, haversineM(a, b));
      const objectives = objectivesFromProposal(proposal);
      const s = new SimSession({ g, activity, difficulty: diff, durationS, seed: 100 + i, strategy: "avoid", start: a, mode: "escape", objectives, strategyFn: makeGoalBot(bot, newBotStats()), paceFactor: 1, rulesPatch: rules });
      const t1 = performance.now();
      let n = 0; while (!s.finished && n < Math.min(Number(process.env.STEPS ?? 1e9), Math.ceil((durationS + 120) / 0.2))) { s.step(); n++; }
      ms += performance.now() - t1; steps += n;
      if (s.state.result === "survived") ok++;
      if (s.state.result !== "infected" || s.state.elapsedSeconds >= 600) a10++;
    }
    console.log(`| ${name} | ${distM} m | ${prepMs.toFixed(0)} | ${g.nodes.size} / ${g.edges.size} | ${spacing} m | ${(ms / Math.max(1, steps)).toFixed(2)} | ${bot} | ${wil(ok, N)} | ${wil(a10, N)} |`);
  }
}
