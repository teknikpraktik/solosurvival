// npx tsx experiments/routes/summarize.ts <preset> <gruppnycklar,...>  → markdowntabell
import { readdirSync, readFileSync } from "node:fs";
import type { ModeMetrics } from "./lib/run";

const [preset, keysArg = "mode", filterArg = ""] = process.argv.slice(2);
const filters = filterArg ? filterArg.split(",").map((x) => x.split("=")) : [];
const keys = keysArg.split(",");
const rows: ModeMetrics[] = [];
for (const f of readdirSync("experiments/routes/results")) if (f.startsWith(preset + ".") && f.endsWith(".jsonl")) for (const l of readFileSync(`experiments/routes/results/${f}`, "utf8").split("\n")) if (l) rows.push(JSON.parse(l));
const wilson = (k: number, n: number): [number, number] => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), a = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n); return [(c - a) / d, (c + a) / d]; };
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / (x.length || 1);
const med = (x: number[]) => { const s = [...x].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const kept = rows.filter((r) => filters.every(([k, v]) => String((r as unknown as Record<string, unknown>)[k]) === v));
const groups = new Map<string, ModeMetrics[]>();
for (const r of kept) { const k = keys.map((x) => String((r as unknown as Record<string, unknown>)[x])).join(" · "); (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
console.log(`| ${keys.join(" · ")} | n | giltig rutt | vinst % [95 % KI] | infekterad % | tidsgräns ute % | median tid → mål (min) | andel av gräns använd (vinnare) | blockerade vägval % | avvik. från rutt % | gången/ruttlängd |`);
console.log("|---|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|");
for (const [k, rs] of [...groups].sort()) {
  const n = rs.length, w = rs.filter((r) => r.result === "survived"), [lo, hi] = wilson(w.length, n);
  const dec = rs.reduce((a, r) => a + r.decisions, 0);
  const rl = w.filter((r) => r.routeLengthM > 0);
  console.log(`| ${k} | ${n} | ${(rs.filter((r) => r.routeValid).length / n * 100).toFixed(0)} % | ${(w.length / n * 100).toFixed(0)} [${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}] | ${(rs.filter((r) => r.result === "infected").length / n * 100).toFixed(0)} | ${(rs.filter((r) => r.result === "failed").length / n * 100).toFixed(0)} | ${w.length && rs[0].mode !== "survival" ? (med(w.map((r) => r.timeToGoalS)) / 60).toFixed(1) : "–"} | ${w.length && rs[0].mode !== "survival" ? (mean(w.map((r) => r.endS / r.limitS)) * 100).toFixed(0) + " %" : "–"} | ${dec ? (rs.reduce((a, r) => a + r.blocked, 0) / dec * 100).toFixed(1) : "–"} | ${dec ? (rs.reduce((a, r) => a + r.deviations, 0) / dec * 100).toFixed(1) : "–"} | ${rl.length ? mean(rl.map((r) => r.distanceM / r.routeLengthM)).toFixed(2) : "–"} |`);
}
