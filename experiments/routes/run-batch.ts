// npx tsx experiments/routes/run-batch.ts <preset> <skärva> <antal>  → results/<preset>.<skärva>.jsonl (återupptar)
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { PRESETS } from "./presets";
import { runModeMatch } from "./lib/run";

const [preset, shardArg = "0", nArg = "1"] = process.argv.slice(2);
const list = PRESETS[preset];
if (!list) { console.error("okänd preset", Object.keys(PRESETS)); process.exit(1); }
const shard = Number(shardArg), n = Number(nArg);
mkdirSync("experiments/routes/results", { recursive: true });
const out = `experiments/routes/results/${preset}.${shard}.jsonl`;
const key = (m: { area: string; activity: string; mode: string; difficulty: string; seed: number; bot: string; cps: number; policy: string }) => [m.area, m.activity, m.mode, m.difficulty, m.seed, m.bot, m.cps, m.policy].join("|");
const done = new Set<string>();
if (existsSync(out)) for (const l of readFileSync(out, "utf8").split("\n")) if (l) done.add(key(JSON.parse(l)));
let i = 0, ran = 0;
const t0 = Date.now();
for (const sc of list) {
  if (i++ % n !== shard) continue;
  if (done.has(key({ ...sc, cps: sc.checkpoints ?? 0, policy: sc.deadEndPolicy ?? "avoid" }))) continue;
  appendFileSync(out, JSON.stringify(runModeMatch(sc).m) + "\n");
  if (++ran % 50 === 0) console.log(`[${preset}.${shard}] ${ran}, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
console.log(`[${preset}.${shard}] klar: ${ran} matcher på ${((Date.now() - t0) / 60000).toFixed(1)} min`);
