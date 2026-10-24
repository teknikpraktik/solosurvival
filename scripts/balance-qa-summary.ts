/* Sammanfattning över strategier: för varje (område, läge, svårighet, tempo) bästa och sämsta strategi, v2.1 mot v2.2.
 *  npx tsx scripts/balance-qa-summary.ts <v22.jsonl> [v21.jsonl] [strategier som räknas som bra, kommaseparerat]  */
import { readFileSync } from "node:fs";
const [f22, f21, goodArg] = process.argv.slice(2);
const good = new Set((goodArg ?? "avoid,planner,risk300-nomid,shortest").split(","));
type R = Record<string, string | number>;
const load = (f?: string): R[] => (f ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const a = load(f22), b = load(f21);
const wil = (k: number, n: number): [number, number] => { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)); return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]; };
const pct = (k: number, n: number) => { const [lo, hi] = wil(k, n); return `${Math.round((k / n) * 100)}% (${Math.round(lo * 100)}–${Math.round(hi * 100)})`; };
const key = (r: R) => `${r.diff}|${r.pace}`;
const group = (rows: R[]) => { const m = new Map<string, Map<string, R[]>>(); for (const r of rows) { const k = key(r); const s = m.get(k) ?? m.set(k, new Map()).get(k)!; (s.get(String(r.strat)) ?? s.set(String(r.strat), []).get(String(r.strat))!).push(r); } return m; };
const stat = (rows: R[]) => ({ n: rows.length, win: rows.filter((r) => r.result === "survived").length, a10: rows.filter((r) => r.result !== "infected" || Number(r.t) >= 600).length });
const best = (g: Map<string, R[]>, metric: "win" | "a10") => { let bestS = "", bestV = -1, bn = 0, bk = 0; for (const [s, rows] of g) { if (!good.has(s)) continue; const st = stat(rows); const v = st[metric] / st.n; if (v > bestV) { bestV = v; bestS = s; bn = st.n; bk = st[metric]; } } return { s: bestS, text: bn ? pct(bk, bn) : "–" }; };
const A = group(a), B = group(b);
console.log("| svårighet | tempo | v2.1 klarade målet (bästa strategi) | v2.2 klarade målet (bästa strategi) | v2.1 levande 10 min | v2.2 levande 10 min | alla strategier v2.2 (klarade målet, min–max) |\n|---|---|---|---|---|---|---|");
for (const [k, g] of A) {
  const [diff, pace] = k.split("|");
  const w22 = best(g, "win"), t22 = best(g, "a10");
  const gb = B.get(k);
  const w21 = gb ? best(gb, "win") : { s: "", text: "–" }, t21 = gb ? best(gb, "a10") : { text: "–" };
  const wins = [...g.values()].map((rows) => stat(rows)).map((s) => s.win / s.n);
  console.log(`| ${diff} | ${pace} | ${w21.text} (${w21.s || "–"}) | ${w22.text} (${w22.s}) | ${t21.text} | ${t22.text} | ${Math.round(Math.min(...wins) * 100)}–${Math.round(Math.max(...wins) * 100)}% |`);
}
