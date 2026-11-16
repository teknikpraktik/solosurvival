/* Experiment: the same simulated matches on the network from our OSM tiles and from OpenFreeMap tiles (docs/GLOBAL-MAP-DATA.md).
 *   npx tsx experiments/global/sim-ofm.ts [matches] */
import { readFileSync } from "node:fs";
import path from "node:path";
import { TileStore } from "../../src/data/store";
import { buildRegionGraph } from "../../src/data/region-graph";
import { edgeLatLon, indexGraph, snapToGraph } from "../../src/geo/graph/graph";
import { SimSession } from "../../src/sim/runner";
import { makeRiskBot } from "../../src/sim/risk-bot";
import { STEP_S } from "../../src/config/game-rules";
import { ofmWays } from "./ofm-ways";
import type { Activity } from "../../src/config/activities";
const N = Number(process.argv[2] ?? 12);
const fetchTile = async (z: number, x: number, y: number) => { try { const b = readFileSync(`experiments/global/.cache/${z}_${x}_${y}.pbf`); return b.length ? new Uint8Array(b) : null; } catch { return null; } };
const root = path.join(process.cwd(), "public/data/v1/varmland");
const fsFetch = async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = new TileStore("/data/v1/varmland", fsFetch as never);
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log("| area | activity | source | caught | median min | survived |\n|---|---|---|--:|--:|--:|");
for (const [name, c] of [["karlstad", { lat: 59.3793, lon: 13.5036 }], ["i2-skogen", { lat: 59.41, lon: 13.466 }]] as const) for (const activity of ["walk", "mtb"] as Activity[]) {
  const R = activity === "mtb" ? 4000 : 1500;
  const sources = { "OSM": (await store.loadAround(c, R + 300)).ways, "OpenFreeMap": (await ofmWays(fetchTile, c, R + 300, 14, { stitchUnits: 3, crossings: true })).ways };
  for (const [src, ways] of Object.entries(sources)) {
    const reg = buildRegionGraph(ways, activity, c, R, c, { strict: false });
    const g = indexGraph({ ...reg.play.graph, crossingNodes: [...reg.play.crossingNodes] });
    const sn = snapToGraph(g, c)!;
    const start = edgeLatLon(g, sn); // the nearest point on this network (the area's centre may be in the forest)
    const t: number[] = []; let caught = 0, won = 0;
    for (let i = 0; i < N; i++) {
      const b = makeRiskBot({ useGoal: true });
      const s = new SimSession({ g, activity, difficulty: "normal", durationS: activity === "mtb" ? 2700 : 1800, seed: 100 + i, start, mode: "survival", strategy: "avoid", strategyFn: b.choose, midEdge: b.midEdge, paceFactor: activity === "walk" ? 1.5 : 1 });
      for (let k = 0; k < (s.rules.durationS + 60) / STEP_S && !s.finished; k++) s.step();
      if (s.state.result === "infected") { caught++; t.push(s.state.elapsedSeconds / 60); } else if (s.state.result === "survived") won++;
    }
    console.log(`| ${name} | ${activity} | ${src} | ${caught}/${N} | ${t.length ? median(t).toFixed(1) : "–"} | ${won}/${N} |`);
  }
}
