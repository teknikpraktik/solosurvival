// npx tsx experiments/routes/eval-routes.ts [startpunkter per cell] – utvärderar ruttgeneratorn på verkliga nät.
import { writeFileSync } from "node:fs";
import type { Activity } from "@/config/activities";
import { generateRoutes } from "@/routes/generate";
import type { RouteMode, RouteProposal } from "@/routes/types";
import { AREAS } from "../data/areas";
import { areaNet, randomStart } from "./lib/run";

const N = Number(process.argv[2] ?? 30);
const LENGTHS: Record<Activity, number[]> = { walk: [1500, 3000], run: [3000, 5000, 8000], mtb: [5000, 10000, 15000] };
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / (x.length || 1);
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)} %`;
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? NaN; };

const lines: string[] = [];
const out = (s: string) => { console.log(s); lines.push(s); };
out("| område | akt. | läge | längd km | giltig (≥1) | 3 förslag | bäst inom ±10 % | medel \\|avvikelse\\| bäst | slinga av förslag | upprepning | återvändsgren | målpunkt-djup > 60 m | målpunkt 1 utgång | alternativväg (A→B) | kvalitet | gen ms (medel / p95) |");
out("|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
for (const area of AREAS) for (const act of ["walk", "run", "mtb"] as Activity[]) for (const mode of ["escape", "mission"] as RouteMode[]) for (const L of LENGTHS[act]) {
  const net = areaNet(area.id, act);
  let valid = 0, three = 0, within = 0;
  const bestDev: number[] = [], ms: number[] = [];
  const props: RouteProposal[] = [];
  for (let s = 1; s <= N; s++) {
    const start = randomStart(net.g, 1000 + s);
    const r = generateRoutes(net.g, { start, activity: act, mode, targetLengthM: L, seed: s, hazardNodes: net.hazard });
    ms.push(r.stats.ms);
    if (r.proposals.length) valid++;
    if (r.proposals.length >= 3) three++;
    if (r.proposals.length) {
      const b = r.proposals.reduce((x, y) => (Math.abs(x.deviation) <= Math.abs(y.deviation) ? x : y));
      bestDev.push(Math.abs(b.deviation));
      if (r.proposals.some((p) => p.withinTolerance)) within++;
    }
    props.push(...r.proposals);
  }
  const loops = props.filter((p) => p.type === "loop").length / (props.length || 1);
  const esc = mode === "escape";
  out(`| ${area.name} | ${act} | ${mode} | ${L / 1000} | ${pct(valid / N)} | ${pct(three / N)} | ${pct(within / N)} | ${bestDev.length ? pct(mean(bestDev), 1) : "–"} | ${esc ? "–" : pct(loops)} | ${esc ? "–" : pct(mean(props.map((p) => p.metrics.reuseShare)))} | ${pct(mean(props.map((p) => p.metrics.deadEndShare)))} | ${pct(props.filter((p) => p.metrics.maxWaypointDeadEndDepthM > 60).length / (props.length || 1))} | ${pct(props.filter((p) => p.metrics.minWaypointExits < 2).length / (props.length || 1))} | ${esc ? pct(props.filter((p) => p.metrics.alternativeRatio !== null).length / (props.length || 1)) : "–"} | ${mean(props.map((p) => p.quality.score)).toFixed(0)} | ${mean(ms).toFixed(0)} / ${q(ms, 0.95).toFixed(0)} |`);
}
writeFileSync("experiments/routes/results-routes.md", lines.join("\n") + "\n");
