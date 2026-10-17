// npx tsx experiments/hybrid/pooled.ts – poolar lika konfigurerade modeller över serier och räknar signifikanta stratifierade tester.
import { readdirSync, readFileSync } from "node:fs";
import type { Metrics } from "./lib/experiment";

const rows: (Metrics & { preset: string })[] = [];
for (const f of readdirSync("experiments/hybrid/results")) {
  const m = f.match(/^(s\d)\.\d+\.jsonl$/);
  if (m) for (const l of readFileSync(`experiments/hybrid/results/${f}`, "utf8").split("\n")) if (l) rows.push({ ...JSON.parse(l), preset: m[1] });
}
const sk = (r: Metrics & { preset: string }) => [r.preset, r.area, r.activity, r.difficulty, r.durationS, r.strategy, r.density, r.seed].join("|");
const sc = new Map<string, Map<string, Metrics>>();
for (const r of rows) (sc.get(sk(r)) ?? sc.set(sk(r), new Map()).get(sk(r))!).set(r.model, r);
const huntTime = (r: Metrics) => (r.result === "infected" ? r.endS - r.huntS : r.durationS - r.huntS);
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / (x.length || 1);
const sd = (x: number[]) => { const m = mean(x); return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, x.length - 1)); };
const lg = (x: number) => { let s = 0; for (let i = 2; i <= x; i++) s += Math.log(i); return s; };
const mcn = (b: number, c: number) => { const n = b + c; if (!n) return 1; let p = 0; for (let i = 0; i <= Math.min(b, c); i++) p += Math.exp(lg(n) - lg(i) - lg(n - i) - n * Math.LN2); return Math.min(1, 2 * p); };
const models = [...new Set(rows.map((r) => r.model))].filter((m) => m !== "A");

console.log("### Poolat per modell (alla serier där modellen ingår)\n");
console.log("| modell | par | vinst A → B (%) | Δ vinst pp [95 % KI] | p (McNemar) | Δ tid under jakt (s) ±95 % | Δ instängd (s) | Δ <50 m (s) |");
console.log("|---|--:|---|---|--:|--:|--:|--:|");
for (const m of models) {
  const pairs: [Metrics, Metrics][] = [];
  for (const s of sc.values()) { const a = s.get("A"), b = s.get(m); if (a && b) pairs.push([a, b]); }
  const n = pairs.length;
  const aw = pairs.filter(([a, b]) => a.result === "survived" && b.result !== "survived").length;
  const bw = pairs.filter(([a, b]) => a.result !== "survived" && b.result === "survived").length;
  const d = (bw - aw) / n, se = Math.sqrt(aw + bw - (bw - aw) ** 2 / n) / n; // parat andelsdifferens (diskordanta par)
  const dT = pairs.map(([a, b]) => huntTime(b) - huntTime(a));
  console.log(`| ${m} | ${n} | ${(pairs.filter(([a]) => a.result === "survived").length / n * 100).toFixed(1)} → ${(pairs.filter(([, b]) => b.result === "survived").length / n * 100).toFixed(1)} | ${(d * 100).toFixed(1)} [${((d - 1.96 * se) * 100).toFixed(1)}, ${((d + 1.96 * se) * 100).toFixed(1)}] | ${mcn(aw, bw).toFixed(3)} | ${mean(dT).toFixed(0)} ±${(1.96 * sd(dT) / Math.sqrt(n)).toFixed(0)} | ${mean(pairs.map(([a, b]) => b.trappedSecs - a.trappedSecs)).toFixed(1)} | ${mean(pairs.map(([a, b]) => b.secsWithin50 - a.secsWithin50)).toFixed(1)} |`);
}

// Alla stratifierade tester (modell × stratum) med minst 40 par: hur många p < 0,05 och åt vilket håll?
let tests = 0, sig = 0, sigPlayerWorse = 0, sigPlayerBetter = 0;
const dims: (keyof Metrics)[] = ["activity", "difficulty", "strategy", "area", "density", "durationS"];
for (const dim of dims) for (const m of models) {
  const vals = [...new Set(rows.map((r) => String(r[dim])))];
  for (const v of vals) {
    const pairs: [Metrics, Metrics][] = [];
    for (const s of sc.values()) { const a = s.get("A"), b = s.get(m); if (a && b && String(a[dim]) === v) pairs.push([a, b]); }
    if (pairs.length < 40) continue;
    const aw = pairs.filter(([a, b]) => a.result === "survived" && b.result !== "survived").length;
    const bw = pairs.filter(([a, b]) => a.result !== "survived" && b.result === "survived").length;
    if (aw + bw < 10) continue;
    tests++;
    if (mcn(aw, bw) < 0.05) { sig++; if (aw > bw) sigPlayerWorse++; else sigPlayerBetter++; }
  }
}
console.log(`\nStratifierade tester (≥40 par, ≥10 diskordanta): ${tests}. Signifikanta (p<0,05): ${sig} (väntat av slumpen ≈ ${(tests * 0.05).toFixed(1)}). Hybrid sämre för spelaren: ${sigPlayerWorse}, bättre: ${sigPlayerBetter}.`);
