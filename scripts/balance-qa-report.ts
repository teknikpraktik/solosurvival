/* Sammanställer JSONL från scripts/balance-qa.ts:  npx tsx scripts/balance-qa-report.ts <fil.jsonl>[,fil2...] [grupper: kommaseparerade kolumner]
 * Grupperar på området, läge, modell, variant, svårighet, tempo, strategi och skriver Markdown med Wilson-konfidensintervall (95 %). */
import { readFileSync } from "node:fs";

const files = (process.argv[2] ?? "").split(",").filter(Boolean);
const groupCols = (process.argv[3] ?? "area,mode,model,variant,diff,pace,strat").split(",");
const rows = files.flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, string | number>));

function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}
const pct = (x: number) => `${Math.round(x * 100)}%`;
const ci = (k: number, n: number) => { const [a, b] = wilson(k, n); return `${pct(k / n)} (${pct(a)}–${pct(b)})`; };
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);

const groups = new Map<string, typeof rows>();
for (const r of rows) {
  const key = groupCols.map((c) => String(r[c] ?? "")).join(" | ");
  (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
}
console.log(`| ${groupCols.join(" | ")} | n | klarade målet | smittade | levande efter 10 min | median tid till smitta (min) | fångstorsak (bakifrån/mötande/sida) |`);
console.log(`|${groupCols.map(() => "---").join("|")}|---|---|---|---|---|---|`);
for (const [key, g] of groups) {
  const n = g.length;
  const win = g.filter((r) => r.result === "survived").length;
  const inf = g.filter((r) => r.result === "infected");
  const alive10 = g.filter((r) => r.result !== "infected" || Number(r.t) >= 600).length;
  const causes = (c: string) => inf.filter((r) => r.cause === c).length;
  const med = median(inf.map((r) => Number(r.t) / 60));
  console.log(`| ${key} | ${n} | ${ci(win, n)} | ${pct(inf.length / n)} | ${ci(alive10, n)} | ${Number.isNaN(med) ? "–" : med.toFixed(1)} | ${causes("overtaken")}/${causes("head-on")}/${causes("side")} |`);
}
