// npx tsx experiments/hybrid/graph-stats.ts  – grafstorlek, byggtid, A*-kostnad och genvägsnytta (statiskt, utan AI-dynamik).
// Kör gärna med NODE_OPTIONS=--expose-gc för minnesmätning.
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { AREAS } from "./areas";
import { areaCtx } from "./lib/experiment";
import { mapToHybrid, randomStart } from "./lib/pairing";
import { buildHybridGraph, DEFAULT_HYBRID, type HybridConfig } from "./lib/hybrid-graph";
import { indexGraph, snapToGraph } from "@/geo/graph/graph";
import { planRoute } from "@/engine/pathfinding/astar";
import type { SerializedGraph } from "@/geo/graph/types";

const gc = (globalThis as { gc?: () => void }).gc;
const heap = () => { gc?.(); return process.memoryUsage().heapUsed; };
const CONFIGS: [string, HybridConfig][] = [
  ["B1-25", { ...DEFAULT_HYBRID, offroadFactor: 0.25, maxLinkM: 100 }],
  ["B2-25", { ...DEFAULT_HYBRID, offroadFactor: 0.25, maxLinkM: 150 }],
  ["B2-25-nms", { ...DEFAULT_HYBRID, offroadFactor: 0.25, maxLinkM: 150, dedupeM: 40 }],
  ["B3-25", { ...DEFAULT_HYBRID, offroadFactor: 0.25, maxLinkM: 400 }],
  ["B2-50", { ...DEFAULT_HYBRID, offroadFactor: 0.5, maxLinkM: 150 }],
  ["B2-50-nms", { ...DEFAULT_HYBRID, offroadFactor: 0.5, maxLinkM: 150, dedupeM: 40 }],
  ["B2-25-perm", { ...DEFAULT_HYBRID, offroadFactor: 0.25, maxLinkM: 150, terrain: "permissive" }],
  ["B3-50-perm", { ...DEFAULT_HYBRID, offroadFactor: 0.5, maxLinkM: 400, terrain: "permissive" }],
];
const PAIRS = 1500;
const rows: Record<string, unknown>[] = [];
const speed = 5 / 3.6; // löpning, normal

for (const a of AREAS) for (const act of ["run", "mtb"] as const) {
  const c = areaCtx(a.id, act);
  const base = c.ag.trailIndexed;
  const m0 = heap();
  const copy = indexGraph(JSON.parse(JSON.stringify(c.ag.trail)) as SerializedGraph);
  const baseMB = (heap() - m0) / 1e6;
  void copy;
  // Slumpade par på stigarna.
  const pts = Array.from({ length: PAIRS * 2 }, (_, i) => snapToGraph(base, randomStart(base, 7000 + i))!);
  const tA0 = performance.now();
  const rA = Array.from({ length: PAIRS }, (_, i) => planRoute(base, pts[2 * i], pts[2 * i + 1], speed));
  const msA = (performance.now() - tA0) / PAIRS;
  rows.push({ area: a.id, act, model: "A", nodes: base.nodes.size, edges: base.edges.size, links: 0, jsonKB: JSON.stringify(c.ag.trail).length / 1e3, gzKB: gzipSync(JSON.stringify(c.ag.trail)).length / 1e3, heapMB: baseMB, buildMs: 0, astarMs: msA });
  for (const [id, cfg] of CONFIGS) {
    const h = buildHybridGraph(c.ag.trail, c.ag.fx, c.raster, cfg);
    const js = JSON.stringify(h.graph);
    const m1 = heap();
    const idx = indexGraph(JSON.parse(js) as SerializedGraph);
    const heapMB = (heap() - m1) / 1e6;
    const map = (p: { edgeId: string; distM: number }) => mapToHybrid(idx, p.edgeId, p.distM);
    const t0 = performance.now();
    const rH = Array.from({ length: PAIRS }, (_, i) => planRoute(idx, map(pts[2 * i]), map(pts[2 * i + 1]), speed));
    const msH = (performance.now() - t0) / PAIRS;
    // Genvägsnytta: relativ tidsbesparing zombie→spelare, för par med ETA > 60 s.
    const sav: number[] = [];
    let any5 = 0, any25 = 0, n = 0, offShare = 0;
    for (let i = 0; i < PAIRS; i++) {
      const ra = rA[i], rh = rH[i];
      if (!ra || !rh || ra.etaS < 60) continue;
      n++;
      const s = 1 - rh.etaS / ra.etaS;
      sav.push(s);
      if (s > 0.05) any5++;
      if (s > 0.25) any25++;
      offShare += rh.steps.filter((st) => idx.edges.get(st.edgeId)?.offroad).length > 0 ? 1 : 0;
    }
    sav.sort((x, y) => x - y);
    rows.push({
      area: a.id, act, model: id, nodes: idx.nodes.size, edges: idx.edges.size, links: h.stats.links, jsonKB: js.length / 1e3, gzKB: gzipSync(js).length / 1e3,
      heapMB, buildMs: h.stats.buildMs, astarMs: msH, pairs: n, saveMean: sav.reduce((x, y) => x + y, 0) / sav.length, saveP90: sav[Math.floor(sav.length * 0.9)], saveMax: sav[sav.length - 1],
      pairsSave5: any5 / n, pairsSave25: any25 / n, pairsUsingOffroad: offShare / n,
    });
  }
}
writeFileSync("experiments/hybrid/results/graph-stats.json", JSON.stringify(rows, null, 1));
const f = (x: unknown, d = 1) => (typeof x === "number" ? x.toFixed(d) : "–");
console.log("område/akt · modell".padEnd(30), "noder kanter länkar  JSON kB  gz kB  heap MB  bygg ms  A* ms  | par  Δtid medel  p90   >5%   >25%  använder off-road");
for (const r of rows) console.log(`${String(r.area)}/${String(r.act)} · ${String(r.model)}`.padEnd(30), String(r.nodes).padStart(5), String(r.edges).padStart(5), String(r.links).padStart(5), f(r.jsonKB, 0).padStart(8), f(r.gzKB, 0).padStart(6), f(r.heapMB).padStart(8), f(r.buildMs, 0).padStart(8), f(r.astarMs, 2).padStart(6), "|", r.pairs !== undefined ? `${String(r.pairs).padStart(4)} ${(Number(r.saveMean) * 100).toFixed(1).padStart(8)}% ${(Number(r.saveP90) * 100).toFixed(1).padStart(6)}% ${(Number(r.pairsSave5) * 100).toFixed(0).padStart(4)}% ${(Number(r.pairsSave25) * 100).toFixed(0).padStart(5)}% ${(Number(r.pairsUsingOffroad) * 100).toFixed(0).padStart(8)}%` : "");
