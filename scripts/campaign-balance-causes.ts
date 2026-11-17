/* THE FALL: why a simulated player loses a mission, not only how often. One level and pace, several what-ifs that each remove one
 * cause, on the balance grid of scripts/campaign-balance.ts and on real Värmland data.
 *   npx tsx scripts/campaign-balance-causes.ts [seeds=20] [level=normal] [pace=1.0]
 * pace is a share of the nominal walking pace on foot (1.3 m/s = 4.7 km/h): 1.3 = brisk 6.1, 1.6 = jog 7.5, 2.0 = run 9.4 km/h.
 * What-ifs (everything else as in the game):
 *   base        the game's rules, the planner bot (as campaign-balance.ts)
 *   risk-bot    the risk-aware bot (turns mid-edge, plans 700 m ahead): is the loss the bot's simple route choice?
 *   no-cut      no interceptors: is the loss the infected's tactics?
 *   slow        infected at 90 % of the player's pace: is the loss their speed?
 *   time x2     twice the time limit: is the loss the clock?
 *   half        half as many infected: is the loss their number?
 *   no-sprint   no sprints (the short bursts at 1.25–1.5 × speed near the player)
 *   no-magnet   the infected do not get the player's position every second (only reveals and what they detect)
 *   not-at-goals  the first infected are spread anywhere instead of around the goals (02, 04)
 * VARIANTS=base,slow,... limits the run to those columns. MISSIONS=02,03 limits the missions.
 * Wins of N (caught / out of time), the median minute of capture, and the goals reached on average.
 * Simulated players are not people: read the rows against each other, not as a forecast. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { prepareMission, trimCourse } from "../src/campaign/prepare";
import { missionDurationS, missionObjectives, missionParams, missionRules } from "../src/campaign/setup";
import { THE_FALL } from "../src/campaign/the-fall";
import type { Rules } from "../src/config/game-rules";
import { ACTIVITIES } from "../src/config/activities";
import type { Difficulty } from "../src/config/difficulty";
import { TileStore } from "../src/data/store";
import { createObjectives, type ObjectiveSet } from "../src/engine/objectives/objectives";
import { edgeLatLon } from "../src/geo/graph/graph";
import type { TrailGraph } from "../src/geo/graph/types";
import type { LatLon } from "../src/geo/geometry";
import { generateCourse } from "../src/routes/course";
import type { RouteProposal } from "../src/routes/types";
import { makeGoalBot, newBotStats } from "../src/sim/bots";
import { makeRiskBot } from "../src/sim/risk-bot";
import { simulateMatch } from "../src/sim/runner";
import { gridGraph } from "../src/sim/test-graphs";
import type { MissionDef } from "../src/campaign/types";

const N = Number(process.argv[2] ?? 20);
const LEVEL = (process.argv[3] ?? "normal") as Difficulty;
const PACE = Number(process.argv[4] ?? 1.0);
const playerMps = ACTIVITIES.walk.playerPaceMps * PACE;

const root = "public/data/v1/varmland";
const fsFetch = async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = new TileStore("/data/v1/varmland", fsFetch as never);

interface Setup { g: TrailGraph; start: LatLon; objectives?: ObjectiveSet; durationS: number }
type Variant = { name: string; patch: (r: Rules) => Partial<Rules>; time?: number; bot?: "risk" };
const ALL_VARIANTS: Variant[] = [
  { name: "base", patch: () => ({}) },
  { name: "risk-bot", patch: () => ({}), bot: "risk" },
  { name: "no-cut", patch: () => ({ interceptShare: 0 }) },
  { name: "slow", patch: () => ({ zombieSpeedMps: playerMps * 0.9 }) },
  { name: "time x2", patch: () => ({}), time: 2 },
  { name: "half", patch: (r) => ({ initialZombies: Math.max(1, Math.round(r.initialZombies / 2)), maxZombies: Math.max(1, Math.round(r.maxZombies / 2)), growthPerMin: r.growthPerMin / 2 }) },
  { name: "no-sprint", patch: () => ({ sprintSpeedFactor: 1 }) },
  { name: "no-magnet", patch: () => ({ magnetic: false }) },
  { name: "not-at-goals", patch: () => ({ spreadStart: false }) },
];
const VARIANTS = ALL_VARIANTS.filter((v) => !process.env.VARIANTS || process.env.VARIANTS.split(",").includes(v.name));

/** The balance grid of campaign-balance.ts: 14 × 14 streets, 120 m apart. */
function gridSetup(m: MissionDef, seed: number): Setup {
  const g = gridGraph(14, 14, 120);
  const start = edgeLatLon(g, { edgeId: "r7:6", distM: 60 });
  const l = m.layout;
  const course = l.kind === "checkpoints" ? trimCourse(generateCourse(g, { start, activity: "walk", targetLengthM: l.courseLengthM, seed, count: 3, minCheckpoints: l.minCount }).proposals[0], start, l.count, l.minCount) : null;
  const objectives = l.kind === "checkpoints" ? missionObjectives(m, course, LEVEL) : l.kind === "destination" ? createObjectives([{ id: "B", kind: "destination", ...edgeLatLon(g, { edgeId: "r2:11", distM: 0 }) }]) : undefined;
  const durationS = missionDurationS(m, { difficulty: LEVEL, durationS: 1800 }, course ?? (l.kind === "destination" ? ({ lengthM: 1140, waypoints: [0] } as unknown as RouteProposal) : null));
  return { g, start, objectives, durationS };
}

/** The game's own preparation at a real place. */
async function realSetup(m: MissionDef, seed: number, start: LatLon): Promise<Setup | null> {
  const p = missionParams(THE_FALL, m, LEVEL, seed);
  const r = await prepareMission(store, start, m, p);
  if (r.status !== "ok" || !r.graph) return null;
  const proposal = r.proposals[0] ?? null;
  return { g: r.graph, start, objectives: missionObjectives(m, proposal, LEVEL), durationS: missionDurationS(m, p, proposal) };
}

const PLACES: [string, LatLon | null][] = [["grid", null], ["I2-skogen", { lat: 59.40731, lon: 13.46753 }], ["Karlstad centrum", { lat: 59.3793, lon: 13.5036 }]];
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);

console.log(`level ${LEVEL}, player ${(playerMps * 3.6).toFixed(1)} km/h, ${N} seeds per cell. Cells: wins (caught/out of time) median capture min, goals reached on average`);
for (const m of THE_FALL.missions.filter((x) => !process.env.MISSIONS || process.env.MISSIONS.split(",").includes(x.id))) {
  const zKmh = (missionRules(m, LEVEL, 1800).zombieSpeedMps * 3.6).toFixed(1);
  console.log(`\n${m.id} ${m.title}: infected ${zKmh} km/h on trails`);
  console.log(`place            | ${VARIANTS.map((v) => v.name.padEnd(18)).join(" | ")}`);
  for (const [place, start] of PLACES) {
    const setups: (Setup | null)[] = [];
    for (let seed = 1; seed <= N; seed++) setups.push(start ? await realSetup(m, seed, start) : gridSetup(m, seed));
    const cells = VARIANTS.map((v) => {
      let won = 0, caught = 0, late = 0, goals = 0, n = 0;
      const capMin: number[] = [];
      setups.forEach((s, i) => {
        if (!s) return;
        n++;
        const seed = i + 1;
        const durationS = Math.round(s.durationS * (v.time ?? 1));
        const rules = missionRules(m, LEVEL, durationS, 1000);
        const objectives = s.objectives ? structuredClone(s.objectives) : undefined;
        const bot = v.bot === "risk" ? makeRiskBot({ useGoal: true }) : null;
        const res = simulateMatch({
          g: s.g, activity: "walk", difficulty: LEVEL, durationS, seed, start: s.start, mode: m.mode, objectives, paceFactor: PACE,
          rulesPatch: { ...rules, ...v.patch(rules) },
          strategy: m.layout.kind === "extraction" ? "extraction" : "avoid",
          strategyFn: bot ? bot.choose : objectives ? makeGoalBot("planner", newBotStats()) : undefined,
          midEdge: bot?.midEdge,
        });
        const r = res.summary.result;
        goals += res.events.filter((e) => e.type === "objective_reached").length;
        if (r === "survived") won++;
        else if (r === "infected") { caught++; capMin.push(res.summary.survivedSeconds / 60); }
        else late++;
      });
      if (!n) return "n/a".padEnd(18);
      const med = capMin.length ? `${median(capMin).toFixed(0)}m` : "  ";
      return `${String(won).padStart(2)}/${n} (${caught}/${late}) ${med} ${(goals / n).toFixed(1)}g`.padEnd(18);
    });
    console.log(`${place.padEnd(16)} | ${cells.join(" | ")}`);
  }
}
