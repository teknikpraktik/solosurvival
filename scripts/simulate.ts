/* Balanseringssimulering (PRD 14.3):  npm run sim -- [matcher per cell] [rutnät]
 * Kör aktivitet × svårighet × spelarstrategi på ett syntetiskt nät och skriver ut utfall.
 * Resultaten gäller bara det syntetiska nätet och de modellerade strategierna – inte verkliga vinstsannolikheter. */
import { gridGraph } from "../src/sim/test-graphs";
import { simulateMatch, type StrategyName } from "../src/sim/runner";
import type { Activity } from "../src/config/activities";
import type { Difficulty } from "../src/config/difficulty";

const n = Number(process.argv[2] ?? 20);
const size = Number(process.argv[3] ?? 24);
const cell: Record<Activity, number> = { walk: 90, run: 130, mtb: 200 };
const acts: Activity[] = ["walk", "run", "mtb"];
const diffs: Difficulty[] = ["easy", "normal", "hard"];
const strategies: StrategyName[] = ["random", "avoid", "maximize", "extraction"];
const pct = (x: number) => `${(x * 100).toFixed(0).padStart(3)}%`;

console.log(`Rutnät ${size}×${size}, ${n} matcher per cell\n`);
console.log("aktivitet svårighet strategi    survived infected failed   tid till infektion (median)");
const t0 = Date.now();
for (const activity of acts) {
  const g = gridGraph(size, size, cell[activity]);
  for (const difficulty of diffs) {
    for (const strategy of strategies) {
      const res = Array.from({ length: n }, (_, i) =>
        simulateMatch({ g, activity, difficulty, durationS: 2700, seed: 1000 + i, strategy }),
      );
      const c = (r: string) => res.filter((x) => x.summary.result === r).length / n;
      const inf = res.filter((x) => x.summary.result === "infected").map((x) => x.summary.survivedSeconds).sort((a, b) => a - b);
      const med = inf.length ? `${Math.round(inf[Math.floor(inf.length / 2)] / 60)} min` : "–";
      console.log(
        `${activity.padEnd(9)} ${difficulty.padEnd(9)} ${strategy.padEnd(11)} ${pct(c("survived"))}     ${pct(c("infected"))}     ${pct(c("failed"))}    ${med}`,
      );
    }
  }
}
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s`);
