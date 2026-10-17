import { AREAS } from "./areas";
import { loadAreaGraph } from "./lib/graphs";
import { buildRaster } from "./lib/raster";
import { Blockers } from "./lib/blockers";
import { buildHybridGraph, DEFAULT_HYBRID } from "./lib/hybrid-graph";
import { loadFixture } from "./lib/fixture";
for (const a of AREAS) {
  const t0 = performance.now(); const fx = loadFixture(a.id); const tLoad = performance.now() - t0;
  const ag = loadAreaGraph(a.id, "mtb");
  let t = performance.now(); const r = buildRaster(fx); const tRaster = performance.now() - t;
  t = performance.now(); const b = new Blockers(r); const tMask = performance.now() - t; void b;
  t = performance.now(); buildHybridGraph(ag.trail, fx, r, { ...DEFAULT_HYBRID, maxLinkM: 150, dedupeM: 40 }); const tGen = performance.now() - t;
  console.log(`${a.name.padEnd(11)} läs fixtur ${tLoad.toFixed(0)} ms, raster 5 m ${tRaster.toFixed(0)} ms, hård mask 1 m ${tMask.toFixed(0)} ms, generera hybridgraf (B2-25-nms) ${tGen.toFixed(0)} ms  ⇒ totalt ${(tRaster + tMask + tGen).toFixed(0)} ms (Node, kall JIT)`);
}
