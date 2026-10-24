/* Analys (inte spelregler): hur skulle de preliminära off-trail-hastigheterna (Lätt 2,5 / Normal 3,5 / Svår 4,5 km/h, samma för gång och cykel)
 * fungera i ett helt öppet landskap? Syntetiskt gitter utan hinder, planner-spelare, zombier med den absoluta farten överallt.
 *   npx tsx scripts/offtrail-speed-analysis.ts <foot|bike> [antal matcher per rad] */
import { SimSession } from "../src/sim/runner";
import { makeGoalBot, newBotStats } from "../src/sim/bots";
import { gridGraph } from "../src/sim/test-graphs";
import type { Difficulty } from "../src/config/difficulty";

const kind = process.argv[2] === "bike" ? "bike" : "foot";
const N = Number(process.argv[3] ?? 20);
const TABLE: Record<Difficulty, number> = { easy: 2.5, normal: 3.5, hard: 4.5 };
const wil = (k: number, n: number) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return `${Math.round(p * 100)}% (${Math.round((c - m) / d * 100)}–${Math.round((c + m) / d * 100)})`; };
const g = kind === "foot" ? gridGraph(50, 50, 40) : gridGraph(60, 60, 60);
const activity = kind === "foot" ? "walk" : "mtb";
const durationS = kind === "foot" ? 1800 : 2700;
const players = kind === "foot" ? [["walker 4.7 km/h", 1], ["slow walker 3.8 km/h", 0.8], ["jogger 8 km/h", 1.7]] as const : [["cyclist 16 km/h", 1], ["slow cyclist 10 km/h", 0.62], ["pushing the bike 5 km/h", 0.31]] as const;
console.log(`| zombies off-trail | player | survived ${Math.round(durationS / 60)} min | alive after 10 min |\n|---|---|---|---|`);
for (const diff of ["easy", "normal", "hard"] as Difficulty[]) for (const [label, pace] of players) {
  let ok = 0, a10 = 0;
  for (let i = 0; i < N; i++) {
    const s = new SimSession({ g, activity, difficulty: diff, durationS, seed: 100 + i, strategy: "avoid", strategyFn: makeGoalBot("planner", newBotStats()), paceFactor: pace, rulesPatch: { zombieSpeedMps: TABLE[diff] / 3.6 } });
    let n = 0; while (!s.finished && n < Math.ceil((durationS + 120) / 0.2)) { s.step(); n++; }
    if (s.state.result === "survived") ok++;
    if (s.state.result !== "infected" || s.state.elapsedSeconds >= 600) a10++;
  }
  console.log(`| ${diff} ${TABLE[diff]} km/h | ${label} | ${wil(ok, N)} | ${wil(a10, N)} |`);
}
