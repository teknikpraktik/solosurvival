/* THE FALL: simulated win rates per mission, difficulty and player pace (a simple bot on a street grid).
 *   npx tsx scripts/campaign-balance.ts [seeds=20]
 * The bot avoids the nearest zombie or walks the shortest way to its goal; it does not plan like a person. The numbers compare missions
 * and levels with each other. They are not a forecast of what a player experiences: that needs field tests.
 * The grid is easier than real networks; scripts/campaign-balance-causes.ts runs the same missions on real Värmland data and
 * separates the causes of a loss (speed, tactics, clock, number, the bot's route choice). */
import { missionDurationS, missionObjectives, missionRules } from "../src/campaign/setup";
import type { RouteProposal } from "../src/routes/types";
import { trimCourse } from "../src/campaign/prepare";
import { THE_FALL } from "../src/campaign/the-fall";
import type { Difficulty } from "../src/config/difficulty";
import { createObjectives } from "../src/engine/objectives/objectives";
import { edgeLatLon } from "../src/geo/graph/graph";
import { generateCourse } from "../src/routes/course";
import { makeGoalBot, newBotStats } from "../src/sim/bots";
import { simulateMatch } from "../src/sim/runner";
import { gridGraph } from "../src/sim/test-graphs";

const N = Number(process.argv[2] ?? 20);
const g = gridGraph(14, 14, 120);
const start = edgeLatLon(g, { edgeId: "r7:6", distM: 60 });
const PACES: [string, number][] = [["walk 4.7 km/h", 1.0], ["brisk 6.1 km/h", 1.3], ["jog 7.5 km/h", 1.6], ["run 9.4 km/h", 2.0]];
console.log(`mission | level | ${PACES.map((p) => p[0]).join(" | ")}   (wins of ${N}; caught / out of time)`);
for (const m of THE_FALL.missions) for (const d of ["easy", "normal", "hard"] as Difficulty[]) {
  const cells = PACES.map(([, pace]) => {
    let won = 0, caught = 0, late = 0;
    for (let seed = 1; seed <= N; seed++) {
      const course = m.layout.kind === "checkpoints" ? trimCourse(generateCourse(g, { start, activity: "walk", targetLengthM: m.layout.courseLengthM, seed, count: 3, minCheckpoints: m.layout.minCount }).proposals[0], start, m.layout.count, m.layout.minCount) : null;
      const objectives = m.layout.kind === "checkpoints" ? missionObjectives(m, course, d) : m.layout.kind === "destination" ? createObjectives([{ id: "B", kind: "destination", ...edgeLatLon(g, { edgeId: "r2:11", distM: 0 }) }]) : undefined;
      // The time limit the game would set: from the course, or (A to B) from the network distance to the fixed destination, 1 140 m.
      const durationS = missionDurationS(m, { difficulty: d, durationS: 1800 }, course ?? (m.layout.kind === "destination" ? ({ lengthM: 1140, waypoints: [0] } as unknown as RouteProposal) : null));
      const r = simulateMatch({ g, activity: "walk", difficulty: d, durationS, seed, start, mode: m.mode, objectives, paceFactor: pace, rulesPatch: missionRules(m, d, durationS, 1000), strategy: m.layout.kind === "extraction" ? "extraction" : "avoid", strategyFn: objectives ? makeGoalBot("planner", newBotStats()) : undefined }).summary.result;
      if (r === "survived") won++; else if (r === "infected") caught++; else late++;
    }
    return `${String(won).padStart(2)} (${caught}/${late})`;
  });
  console.log(`${m.id} ${m.title.padEnd(16)} | ${d.padEnd(6)} | ${cells.join(" | ")}`);
}
