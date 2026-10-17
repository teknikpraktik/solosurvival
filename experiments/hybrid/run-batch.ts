// Kör: npx tsx experiments/hybrid/run-batch.ts <preset> <shard> <antal> – skriver results/<preset>.<shard>.jsonl (återupptar där den slutade).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { runPair } from "./lib/experiment";
import { PRESETS } from "./lib/presets";

const [preset, shardArg = "0", nArg = "1"] = process.argv.slice(2);
const p = PRESETS[preset];
if (!p) { console.error("okänd preset", preset, Object.keys(PRESETS)); process.exit(1); }
const shard = Number(shardArg), n = Number(nArg);
mkdirSync("experiments/hybrid/results", { recursive: true });
const out = `experiments/hybrid/results/${preset}.${shard}.jsonl`;
const done = new Set<string>();
if (existsSync(out)) for (const l of readFileSync(out, "utf8").split("\n")) if (l) { const m = JSON.parse(l); done.add(`${m.area}|${m.activity}|${m.difficulty}|${m.durationS}|${m.strategy}|${m.density}|${m.seed}`); }
let i = 0, ran = 0;
const t0 = Date.now();
for (const sc of p.scenarios) {
  if (i++ % n !== shard) continue;
  if (done.has(`${sc.area}|${sc.activity}|${sc.difficulty}|${sc.durationS}|${sc.strategy}|${sc.density}|${sc.seed}`)) continue;
  for (const m of runPair(sc, p.models)) appendFileSync(out, JSON.stringify(m) + "\n");
  if (++ran % 25 === 0) console.log(`[${preset}.${shard}] ${ran} scenarier, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
console.log(`[${preset}.${shard}] klar: ${ran} scenarier × ${p.models.length} modeller på ${((Date.now() - t0) / 60000).toFixed(1)} min`);
