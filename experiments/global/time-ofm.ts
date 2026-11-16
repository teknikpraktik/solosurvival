/* Experiment: time to turn OpenFreeMap tiles into ways and a graph, at the bike's radius (docs/GLOBAL-MAP-DATA.md).
 *   npx tsx experiments/global/time-ofm.ts [radius m]   (tiles from experiments/global/.cache, see compare-ofm.ts) */
import { readFileSync } from "node:fs";
import { tilesAround, waysFromTiles } from "../../src/data/ofm-store";
import { buildRegionGraph } from "../../src/data/region-graph";
const R = Number(process.argv[2] ?? 6000);
const c = { lat: 59.3793, lon: 13.5036 };
const tiles = tilesAround(c, R + 300).map(([x, y]) => { try { const b = readFileSync(`experiments/global/.cache/14_${x}_${y}.pbf`); return b.length ? { z: 14, x, y, pbf: new Uint8Array(b) } : null; } catch { return null; } }).filter((t) => !!t);
for (let i = 0; i < 3; i++) {
  const t0 = performance.now(); const ways = waysFromTiles(tiles); const t1 = performance.now();
  buildRegionGraph(ways, "mtb", c, R, c, { strict: false }); const t2 = performance.now();
  console.log(`${tiles.length} tiles: ways ${(t1 - t0).toFixed(0)} ms, graph ${(t2 - t1).toFixed(0)} ms (${ways.length} ways)`);
}
