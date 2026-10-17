// npx tsx experiments/hybrid/paired.ts <preset> [stratumKeys,...]  – parvis jämförelse av varje modell mot A (samma scenario, start och seed).
import { readdirSync, readFileSync } from "node:fs";
import type { Metrics } from "./lib/experiment";

const [preset, strataArg = ""] = process.argv.slice(2);
const strata = strataArg ? strataArg.split(",") : [];
const rows: Metrics[] = [];
for (const f of readdirSync("experiments/hybrid/results")) if (f.startsWith(preset + ".") && f.endsWith(".jsonl")) for (const l of readFileSync(`experiments/hybrid/results/${f}`, "utf8").split("\n")) if (l) rows.push(JSON.parse(l));
const sk = (r: Metrics) => [r.area, r.activity, r.difficulty, r.durationS, r.strategy, r.density, r.seed].join("|");
const byScenario = new Map<string, Map<string, Metrics>>();
for (const r of rows) (byScenario.get(sk(r)) ?? byScenario.set(sk(r), new Map()).get(sk(r))!).set(r.model, r);

// Överlevnadstid under jakten, högercensurerad vid matchens slut (SURVIVED/FAILED = hela fönstret).
const huntTime = (r: Metrics) => (r.result === "infected" ? r.endS - r.huntS : r.durationS - r.huntS);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const ci = (xs: number[]) => 1.96 * sd(xs) / Math.sqrt(xs.length || 1);
// Tvåsidigt exakt teckentest (McNemar) på diskordanta par.
function mcnemar(b: number, c: number): number {
  const n = b + c; if (!n) return 1;
  const k = Math.min(b, c);
  let p = 0, coef = 1; // C(n,i)/2^n
  const lg = (x: number) => { let s = 0; for (let i = 2; i <= x; i++) s += Math.log(i); return s; };
  for (let i = 0; i <= k; i++) p += Math.exp(lg(n) - lg(i) - lg(n - i) - n * Math.LN2);
  void coef;
  return Math.min(1, 2 * p);
}

const models = [...new Set(rows.map((r) => r.model))].filter((m) => m !== "A");
const stratumOf = (r: Metrics) => strata.map((k) => (r as never)[k]).join(" | ") || "alla";
const strataSet = [...new Set(rows.map(stratumOf))].sort();
console.log(`${byScenario.size} scenarier, modeller mot A. Δ = modell − A. Tid = sekunder av jakten som överlevs (censurerad).`);
for (const st of strataSet) {
  console.log(`\n### ${st}`);
  console.log("modell".padEnd(12), "par".padStart(5), "vinst A→B".padStart(11), "A+B− / A−B+".padStart(12), "p(McNemar)".padStart(11), "Δvinst pp".padStart(10), "Δtid s [±95%]".padStart(16), "Δ<50m s".padStart(9), "Δinstängd s".padStart(12), "Δstängd extr.".padStart(14), "off-road%".padStart(10), "Δ cpu ms".padStart(9));
  for (const m of models) {
    const pairs: [Metrics, Metrics][] = [];
    for (const sc of byScenario.values()) { const a = sc.get("A"), b = sc.get(m); if (a && b && stratumOf(a) === st) pairs.push([a, b]); }
    if (!pairs.length) continue;
    const aw = pairs.filter(([a, b]) => a.result === "survived" && b.result !== "survived").length;
    const bw = pairs.filter(([a, b]) => a.result !== "survived" && b.result === "survived").length;
    const winA = pairs.filter(([a]) => a.result === "survived").length, winB = pairs.filter(([, b]) => b.result === "survived").length;
    const dT = pairs.map(([a, b]) => huntTime(b) - huntTime(a));
    const d50 = pairs.map(([a, b]) => b.secsWithin50 - a.secsWithin50);
    const dTr = pairs.map(([a, b]) => b.trappedSecs - a.trappedSecs);
    // Extraction svårare att nå: zombiernas ankomst till extraction minus spelarens (lägre = svårare).
    const dEx = pairs.filter(([a, b]) => Number.isFinite(a.extractionZombieEtaS - a.extractionPlayerEtaS) && Number.isFinite(b.extractionZombieEtaS - b.extractionPlayerEtaS)).map(([a, b]) => (b.extractionZombieEtaS - b.extractionPlayerEtaS) - (a.extractionZombieEtaS - a.extractionPlayerEtaS));
    const off = pairs.reduce((s, [, b]) => s + b.zombieDistOffroadM, 0) / (pairs.reduce((s, [, b]) => s + b.zombieDistOffroadM + b.zombieDistTrailM, 0) || 1);
    const dc = pairs.map(([a, b]) => b.cpuMs - a.cpuMs);
    const n = pairs.length;
    console.log(m.padEnd(12), String(n).padStart(5), `${(winA / n * 100).toFixed(1)}→${(winB / n * 100).toFixed(1)}`.padStart(11), `${aw} / ${bw}`.padStart(12), mcnemar(aw, bw).toFixed(3).padStart(11), ((winB - winA) / n * 100).toFixed(1).padStart(10), `${mean(dT).toFixed(0)} ±${ci(dT).toFixed(0)}`.padStart(16), mean(d50).toFixed(1).padStart(9), mean(dTr).toFixed(1).padStart(12), (dEx.length ? `${mean(dEx).toFixed(0)} (n=${dEx.length})` : "–").padStart(14), (off * 100).toFixed(2).padStart(10), mean(dc).toFixed(0).padStart(9));
  }
}
