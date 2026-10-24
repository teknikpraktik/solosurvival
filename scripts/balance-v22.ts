/* Balansmätning för v2.2:  npx tsx scripts/balance-v22.ts [matcher per cell] [område: karlstad|skog] [läge: survival|mission]
 * Jämför zombiernas hastighets- och spurtmodell under identiska förhållanden (samma graf, samma seed, samma spelarstrategi, samma spelartempo).
 * Modellerna ges som regelåsidosättningar (`rulesPatch`). Resultat gäller simulerade spelare på riktig OSM-data, inte verkliga människor. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { TileStore } from "../src/data/store";
import { defaultParams, withActivity } from "../src/play/config";
import { prepareMatch } from "../src/play/prepare";
import { objectivesFromProposal } from "../src/routes/objectives";
import { matchDurationS } from "../src/play/match";
import { SimSession } from "../src/sim/runner";
import { makeGoalBot, newBotStats } from "../src/sim/bots";
import { STEP_S, type Rules } from "../src/config/game-rules";
import { indexGraph } from "../src/geo/graph/graph";
import type { Activity } from "../src/config/activities";
import type { Difficulty } from "../src/config/difficulty";

const root = path.join(process.cwd(), "public/data/v1/varmland");
const fsFetch = async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = new TileStore("/data/v1/varmland", fsFetch as never);

const N = Number(process.argv[2] ?? 12);
const AREA = process.argv[3] ?? "karlstad";
const MODE = (process.argv[4] ?? "survival") as "survival" | "mission";
const START = AREA === "karlstad" ? { lat: 59.3793, lon: 13.5036 } : { lat: 59.40731, lon: 13.46753 };

type Patch = (a: Activity, d: Difficulty) => Partial<Rules>;
/** v2.1: hastigheter och spurt som i produktionen före v2.2 (km/h-tabellen och 1,5 × i 30 s, 30 s återhämtning). */
const LEGACY_KMH: Record<string, Record<Difficulty, number>> = { walk: { easy: 6, normal: 10, hard: 13 }, mtb: { easy: 14, normal: 17, hard: 24 } };
const legacy: Patch = (a, d) => ({ zombieSpeedMps: LEGACY_KMH[a][d] / 3.6, sprintSpeedFactor: 1.5, sprintDurationS: 30, sprintRampS: 0, sprintDecayS: 0, sprintCooldownS: 30 });
/** Den modell som ligger i koden just nu (ingen åsidosättning). */
const current: Patch = () => ({});
const mk = (kmh: number, peak: number, ramp: number, hold: number, decay: number, cool: number): Partial<Rules> => ({ zombieSpeedMps: kmh / 3.6, sprintSpeedFactor: peak, sprintRampS: ramp, sprintDurationS: hold, sprintDecayS: decay, sprintCooldownS: cool });
/** Kandidater: tabell per svårighet (walk/mtb delar sprintformen; hastigheten för Normal/Hard är oförändrad). */
const cand = (t: Record<Difficulty, { walk: [number, ...number[]]; mtb: [number, ...number[]] }>): Patch => (a, d) => { const [kmh, peak, ramp, hold, decay, cool] = t[d][a as "walk" | "mtb"] as [number, number, number, number, number, number]; return mk(kmh, peak, ramp, hold, decay, cool); };
const models: Record<string, Patch> = {
  v21: legacy,
  v22: current,
  // A: lätt = under promenadtempo, mild kort spurt; Normal/Hard behåller fart men får avtagande spurt.
  A: cand({ easy: { walk: [4.5, 1.25, 2, 4, 8, 60], mtb: [14, 1.25, 2, 4, 8, 60] }, normal: { walk: [10, 1.4, 2, 8, 12, 45], mtb: [17, 1.4, 2, 8, 12, 45] }, hard: { walk: [13, 1.5, 2, 10, 12, 30], mtb: [24, 1.5, 2, 10, 12, 30] } }),
  // B: lätt = promenadtempo (5 km/h), något starkare spurt.
  B: cand({ easy: { walk: [5, 1.3, 2, 5, 10, 50], mtb: [14, 1.3, 2, 5, 10, 50] }, normal: { walk: [10, 1.35, 2, 6, 12, 45], mtb: [17, 1.35, 2, 6, 12, 45] }, hard: { walk: [13, 1.5, 2, 8, 10, 30], mtb: [24, 1.5, 2, 8, 10, 30] } }),
  // D/E/F: lättare lätt-lägen (promenadtempo ned till 4 km/h).
  D: cand({ easy: { walk: [4, 1.25, 2, 4, 8, 60], mtb: [14, 1.25, 2, 4, 8, 60] }, normal: { walk: [10, 1.4, 2, 8, 12, 45], mtb: [17, 1.4, 2, 8, 12, 45] }, hard: { walk: [13, 1.5, 2, 10, 12, 30], mtb: [24, 1.5, 2, 10, 12, 30] } }),
  E: cand({ easy: { walk: [4.5, 1.2, 2, 3, 6, 90], mtb: [14, 1.2, 2, 3, 6, 90] }, normal: { walk: [10, 1.4, 2, 8, 12, 45], mtb: [17, 1.4, 2, 8, 12, 45] }, hard: { walk: [13, 1.5, 2, 10, 12, 30], mtb: [24, 1.5, 2, 10, 12, 30] } }),
  F: cand({ easy: { walk: [4.5, 1.0, 0, 1, 0, 30], mtb: [14, 1.0, 0, 1, 0, 30] }, normal: { walk: [10, 1.4, 2, 8, 12, 45], mtb: [17, 1.4, 2, 8, 12, 45] }, hard: { walk: [13, 1.5, 2, 10, 12, 30], mtb: [24, 1.5, 2, 10, 12, 30] } }),
  // C: som A men utan spurt-förändring för Normal/Hard (isolerar effekten av lätt-läget).
  C: cand({ easy: { walk: [4.5, 1.25, 2, 4, 8, 60], mtb: [14, 1.25, 2, 4, 8, 60] }, normal: { walk: [10, 1.5, 0, 30, 0, 30], mtb: [17, 1.5, 0, 30, 0, 30] }, hard: { walk: [13, 1.5, 0, 30, 0, 30], mtb: [24, 1.5, 0, 30, 0, 30] } }),
};
const only = process.argv[5]?.split(",");

const acts: Activity[] = (process.env.ACTS ?? "walk,mtb").split(",") as Activity[];
const BOT = process.env.BOT ?? "planner";
const GRAPH = process.env.GRAPH ?? "play";
const diffs: Difficulty[] = (process.env.DIFFS ?? "easy,normal,hard").split(",") as Difficulty[];
const paces = (process.env.PACES ?? "0.8,1,1.25").split(",").map(Number);

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);

console.log(`# Balans (${AREA}, ${MODE}, bot=${BOT}, nät=${GRAPH}, ${N} matcher per cell)\n`);
console.log("| aktivitet | svårighet | tempo | modell | överlevde | smittad | tid ute | median tid till smitta (min) | sprinter/match |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const activity of acts) {
  const p0 = { ...withActivity(defaultParams(activity), activity), mode: MODE, seed: 11 };
  const prep = await prepareMatch(store, START, p0);
  if (!prep.graph || prep.status === "off_network") { console.log(`<!-- ${activity}: ${prep.status} ${prep.message} -->`); continue; }
  const graph = GRAPH === "strict" ? indexGraph(prep.region!.graph) : prep.graph;
  const proposal = MODE === "survival" ? null : prep.proposals[0];
  if (MODE !== "survival" && !proposal) { console.log(`<!-- ${activity}: inget förslag -->`); continue; }
  const durationS = matchDurationS(p0, proposal);
  for (const difficulty of diffs) {
    for (const pace of paces) {
      for (const [name, patch] of Object.entries(models)) {
        if (only && !only.includes(name)) continue;
        const res: { r: string | undefined; t: number }[] = [];
        let sprints = 0;
        for (let i = 0; i < N; i++) {
          const objectives = proposal ? objectivesFromProposal(proposal) : undefined;
          const sim = new SimSession({
            g: graph, activity, difficulty, durationS, seed: 100 + i, strategy: "extraction", start: START, paceFactor: pace, mode: MODE, objectives,
            strategyFn: BOT === "planner" ? makeGoalBot("planner", newBotStats()) : undefined, rulesPatch: patch(activity, difficulty),
          });
          const maxSteps = Math.ceil((durationS + 60) / STEP_S);
          for (let k = 0; k < maxSteps && !sim.finished; k++) sim.step();
          if (!sim.finished) sim.state.result = "failed";
          sprints += sim.events.filter((e) => e.type === "zombie_sprint").length;
          res.push({ r: sim.state.result, t: sim.state.elapsedSeconds });
        }
        const c = (r: string) => res.filter((x) => x.r === r).length / N;
        const inf = res.filter((x) => x.r === "infected").map((x) => x.t / 60);
        console.log(`| ${activity} | ${difficulty} | ${pace.toFixed(2)}× | ${name} | ${pct(c("survived"))} | ${pct(c("infected"))} | ${pct(c("failed"))} | ${Number.isNaN(median(inf)) ? "–" : median(inf).toFixed(1)} | ${(sprints / N).toFixed(1)} |`);
      }
    }
  }
}
