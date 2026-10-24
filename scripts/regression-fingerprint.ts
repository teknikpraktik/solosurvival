/* Deterministisk fingeravtryck av simulerade matcher (gång/cykel × svårighet × läge × seeds) för att jämföra två kodversioner.
 *   npx tsx scripts/regression-fingerprint.ts > a.txt   (kör på båda versionerna och jämför med diff)
 * Spelaren följer nätet hela tiden, så ändringar som bara gäller spelare utanför nätet får inte ändra någon rad. */
import { SimSession } from "../src/sim/runner";
import { makeGoalBot, newBotStats } from "../src/sim/bots";
import { gridGraph } from "../src/sim/test-graphs";
import { createObjectives } from "../src/engine/objectives/objectives";
import { edgeLatLon } from "../src/geo/graph/graph";

const g = gridGraph(14, 14, 120);
const at = (edgeId: string, distM: number) => edgeLatLon(g, { edgeId, distM });
const start = at("r7:5", 60);
for (const activity of ["walk", "mtb"] as const) for (const difficulty of ["easy", "normal", "hard"] as const) for (const mode of ["survival", "escape", "mission"] as const) {
  const out: string[] = [];
  for (let seed = 1; seed <= 6; seed++) {
    const objectives = mode === "escape" ? createObjectives([{ id: "B", kind: "destination", ...at("r7:9", 0) }])
      : mode === "mission" ? createObjectives([{ id: "C1", kind: "checkpoint", ...at("r5:5", 60) }, { id: "C2", kind: "checkpoint", ...at("r9:8", 60) }, { id: "A", kind: "home", ...start }]) : undefined;
    const s = new SimSession({ g, activity, difficulty, durationS: 1500, seed, strategy: "avoid", start, mode, objectives, strategyFn: objectives ? makeGoalBot("planner", newBotStats()) : undefined });
    let n = 0; while (!s.finished && n < 9000) { s.step(); n++; }
    out.push(`${s.state.result ?? "none"}@${s.state.elapsedSeconds.toFixed(1)}`);
  }
  console.log(`${activity} ${difficulty} ${mode}: ${out.join(" ")}`);
}
