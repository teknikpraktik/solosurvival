// npx tsx experiments/hybrid/tables.ts <preset> <stratum,...> [metrics]  – markdowntabeller för rapporten (parvis mot modell A).
import { readdirSync, readFileSync } from "node:fs";
import type { Metrics } from "./lib/experiment";

const [preset, strataArg = "", mode = "paired"] = process.argv.slice(2);
const strata = strataArg ? strataArg.split(",") : [];
const rows: Metrics[] = [];
for (const f of readdirSync("experiments/hybrid/results")) if (f.startsWith(preset + ".") && f.endsWith(".jsonl")) for (const l of readFileSync(`experiments/hybrid/results/${f}`, "utf8").split("\n")) if (l) rows.push(JSON.parse(l));
const sk = (r: Metrics) => [r.area, r.activity, r.difficulty, r.durationS, r.strategy, r.density, r.seed].join("|");
const byScenario = new Map<string, Map<string, Metrics>>();
for (const r of rows) (byScenario.get(sk(r)) ?? byScenario.set(sk(r), new Map()).get(sk(r))!).set(r.model, r);
const huntTime = (r: Metrics) => (r.result === "infected" ? r.endS - r.huntS : r.durationS - r.huntS);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const ci = (xs: number[]) => (1.96 * sd(xs)) / Math.sqrt(xs.length || 1);
const lg = (x: number) => { let s = 0; for (let i = 2; i <= x; i++) s += Math.log(i); return s; };
function mcnemar(b: number, c: number): number { const n = b + c; if (!n) return 1; const k = Math.min(b, c); let p = 0; for (let i = 0; i <= k; i++) p += Math.exp(lg(n) - lg(i) - lg(n - i) - n * Math.LN2); return Math.min(1, 2 * p); }
const wilson = (k: number, n: number): [number, number] => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), a = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n); return [(c - a) / d, (c + a) / d]; };
const stratumOf = (r: Metrics) => strata.map((k) => (r as never)[k]).join(" · ") || "alla";
const models = [...new Set(rows.map((r) => r.model))];
const strataSet = [...new Set(rows.map(stratumOf))].sort();
const pct = (x: number, d = 0) => (x * 100).toFixed(d);
const f = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "–");

if (mode === "level") {
  // Absolut nivå per modell och stratum.
  console.log(`| ${strata.join(" · ") || "grupp"} | modell | n | vinst % [95 % KI] | infekterade % | median tid → infektion (min) | <50 m (s) | instängd (s) | andel infektioner i återvändsgränd | off-road-andel % | byten/zombietimme | ankomstspridning |`);
  console.log("|---|---|--:|---|--:|--:|--:|--:|--:|--:|--:|--:|");
  for (const st of strataSet) for (const m of models) {
    const rs = rows.filter((r) => stratumOf(r) === st && r.model === m);
    if (!rs.length) continue;
    const n = rs.length, w = rs.filter((r) => r.result === "survived").length, inf = rs.filter((r) => r.result === "infected");
    const [lo, hi] = wilson(w, n);
    const off = rs.reduce((a, r) => a + r.zombieDistOffroadM, 0) / (rs.reduce((a, r) => a + r.zombieDistOffroadM + r.zombieDistTrailM, 0) || 1);
    const sw = rs.reduce((a, r) => a + r.zombieSwitches, 0) / (rs.reduce((a, r) => a + r.zombieHours, 0) || 1);
    const srt = inf.map((r) => r.endS - r.huntS).sort((a, b) => a - b);
    console.log(`| ${st} | ${m} | ${n} | ${pct(w / n)} [${pct(lo)}–${pct(hi)}] | ${pct(inf.length / n)} | ${srt.length ? f(srt[Math.floor(srt.length / 2)] / 60, 1) : "–"} | ${f(mean(rs.map((r) => r.secsWithin50)), 1)} | ${f(mean(rs.map((r) => r.trappedSecs)))} | ${inf.length ? pct(inf.filter((r) => r.deadEndInfection).length / inf.length) + " %" : "–"} | ${f(off * 100, 2)} | ${f(sw, 2)} | ${f(mean(rs.map((r) => r.approachSpreadDeg)))} |`);
  }
} else {
  console.log(`| ${strata.join(" · ") || "grupp"} | modell | par | vinst A → B (%) | A+B− / A−B+ | p (McNemar) | Δ tid under jakt (s) ±95 % | Δ <50 m (s) | Δ instängd (s) | Δ extraction-marginal (s) | Δ ankomstspridning | Δ CPU (ms) |`);
  console.log("|---|---|--:|---|--:|--:|--:|--:|--:|--:|--:|--:|");
  for (const st of strataSet) for (const m of models.filter((x) => x !== "A")) {
    const pairs: [Metrics, Metrics][] = [];
    for (const sc of byScenario.values()) { const a = sc.get("A"), b = sc.get(m); if (a && b && stratumOf(a) === st) pairs.push([a, b]); }
    if (!pairs.length) continue;
    const n = pairs.length;
    const aw = pairs.filter(([a, b]) => a.result === "survived" && b.result !== "survived").length;
    const bw = pairs.filter(([a, b]) => a.result !== "survived" && b.result === "survived").length;
    const winA = pairs.filter(([a]) => a.result === "survived").length, winB = pairs.filter(([, b]) => b.result === "survived").length;
    const dT = pairs.map(([a, b]) => huntTime(b) - huntTime(a));
    const slack = (r: Metrics) => r.extractionZombieEtaS - r.extractionPlayerEtaS;
    const dEx = pairs.filter(([a, b]) => Number.isFinite(slack(a)) && Number.isFinite(slack(b))).map(([a, b]) => slack(b) - slack(a));
    console.log(`| ${st} | ${m} | ${n} | ${pct(winA / n, 1)} → ${pct(winB / n, 1)} | ${aw} / ${bw} | ${mcnemar(aw, bw).toFixed(3)} | ${f(mean(dT))} ±${f(ci(dT))} | ${f(mean(pairs.map(([a, b]) => b.secsWithin50 - a.secsWithin50)), 1)} | ${f(mean(pairs.map(([a, b]) => b.trappedSecs - a.trappedSecs)), 1)} | ${dEx.length ? f(mean(dEx)) + ` (n=${dEx.length})` : "–"} | ${f(mean(pairs.map(([a, b]) => b.approachSpreadDeg - a.approachSpreadDeg)), 1)} | ${f(mean(pairs.map(([a, b]) => b.cpuMs - a.cpuMs)))} |`);
  }
}
const bad = rows.filter((r) => r.offroadViolations > 0 || r.maxStepM > r.maxStepAllowedM + 0.05);
console.log(`\n_Invarianter: ${bad.length} av ${rows.length} rader med terrängöverträdelse eller för stort steg._`);
