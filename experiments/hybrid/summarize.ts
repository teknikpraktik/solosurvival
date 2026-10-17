// npx tsx experiments/hybrid/summarize.ts <preset> [groupBy,...]  – sammanfattar results/<preset>.*.jsonl
import { readdirSync, readFileSync } from "node:fs";
import type { Metrics } from "./lib/experiment";

const [preset, groupArg = "model"] = process.argv.slice(2);
const rows: Metrics[] = [];
for (const f of readdirSync("experiments/hybrid/results")) if (f.startsWith(preset + ".") && f.endsWith(".jsonl")) for (const l of readFileSync(`experiments/hybrid/results/${f}`, "utf8").split("\n")) if (l) rows.push(JSON.parse(l));
const keys = groupArg.split(",");
const wilson = (k: number, n: number) => { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), a = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n); return [(c - a) / d, (c + a) / d]; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const groups = new Map<string, Metrics[]>();
for (const r of rows) { const k = keys.map((x) => (r as never)[x]).join(" | "); (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
console.log(`${rows.length} rader i ${groups.size} grupper (${preset}, gruppering: ${groupArg})\n`);
console.log("grupp".padEnd(40), "n".padStart(5), "vinst%[95%KI]".padEnd(20), "infekt%".padStart(8), "tid→inf(med,min)".padStart(17), "minDist".padStart(8), "<50m s".padStart(7), "instängd s".padStart(11), "offroad%".padStart(9), "byten/zh".padStart(9), "spridn.".padStart(8), "cpu ms".padStart(7));
for (const [k, rs] of [...groups].sort()) {
  const n = rs.length, w = rs.filter((r) => r.result === "survived").length, inf = rs.filter((r) => r.result === "infected");
  const [lo, hi] = wilson(w, n);
  const off = rs.reduce((a, r) => a + r.zombieDistOffroadM, 0) / (rs.reduce((a, r) => a + r.zombieDistOffroadM + r.zombieDistTrailM, 0) || 1);
  const sw = rs.reduce((a, r) => a + r.zombieSwitches, 0) / (rs.reduce((a, r) => a + r.zombieHours, 0) || 1);
  console.log(k.padEnd(40), String(n).padStart(5), `${(w / n * 100).toFixed(0).padStart(3)} [${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}]`.padEnd(20), `${(inf.length / n * 100).toFixed(0)}`.padStart(8), (inf.length ? `${(med(inf.map((r) => r.endS - r.huntS)) / 60).toFixed(1)}` : "–").padStart(17), mean(rs.map((r) => r.minDistM).filter(Number.isFinite)).toFixed(0).padStart(8), mean(rs.map((r) => r.secsWithin50)).toFixed(0).padStart(7), mean(rs.map((r) => r.trappedSecs)).toFixed(0).padStart(11), (off * 100).toFixed(2).padStart(9), sw.toFixed(1).padStart(9), mean(rs.map((r) => r.approachSpreadDeg)).toFixed(0).padStart(8), mean(rs.map((r) => r.cpuMs)).toFixed(0).padStart(7));
}
const bad = rows.filter((r) => r.offroadViolations > 0 || r.maxStepM > r.maxStepAllowedM + 0.05);
console.log(`\ninvarianter: ${bad.length} rader med terrängöverträdelse eller för stort steg av ${rows.length}`);
