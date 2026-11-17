/* Passages in the play network (where zombies may follow the player across a road, a railway or a stream), per place and obstacle type.
 *   npx tsx scripts/hazard-kind-audit.ts <tiles dir> <kinds dir> [radius m] > out.json
 * <tiles dir>: the tiles the game loads (e.g. public/data/v1/varmland). <kinds dir>: tiles that carry "k" (a build_tiles.py run), used only
 * to name the obstacle at each passage, so that tiles without "k" can be audited too. Also counts bridges and tunnels and the strict
 * network's hazard ends, which the obstacle type must not change. */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { TileStore } from "../src/data/store";
import { buildRegionGraph } from "../src/data/region-graph";
import type { LatLon } from "../src/geo/geometry";

const [dir, kindsDir, rArg] = process.argv.slice(2);
const R = Number(rArg ?? 2500);
const fsFetch = (root: string) => async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = new TileStore("/data/v1/varmland", fsFetch(dir) as never);

const kindOf = new Map<string, string>();
for (const f of readdirSync(path.join(kindsDir, "t"))) {
  for (const w of JSON.parse(readFileSync(path.join(kindsDir, "t", f), "utf8")).w as { n: number[]; h?: number[]; k?: string }[]) {
    if (!w.h || !w.k) continue;
    let acc = 0;
    const ids = w.n.map((d) => (acc += d));
    w.h.forEach((i, j) => kindOf.set(String(ids[i]), w.k![j]));
  }
}

const PLACES: { id: string; p: LatLon }[] = [
  { id: "karlstad-centrum", p: { lat: 59.3793, lon: 13.5036 } },
  { id: "karlstad-i2", p: { lat: 59.40731, lon: 13.46753 } },
  { id: "kronoparken", p: { lat: 59.4055, lon: 13.585 } },
  { id: "skutberget", p: { lat: 59.3723, lon: 13.3937 } },
  { id: "kristinehamn", p: { lat: 59.3097, lon: 14.1081 } },
  { id: "arvika", p: { lat: 59.6553, lon: 12.5852 } },
  { id: "sunne", p: { lat: 59.8366, lon: 13.1433 } },
];
const out: unknown[] = [];
for (const pl of PLACES) {
  const { ways } = await store.loadAround(pl.p, R);
  const region = buildRegionGraph(ways, "walk", pl.p, R, pl.p, { strict: true });
  const nodes = new Map(region.play.graph.nodes.map((n) => [n.id, n]));
  const byKind: Record<string, number> = {};
  const examples: Record<string, { id: string; lat: number; lon: number }[]> = {};
  for (const id of region.play.crossingNodes) {
    const k = kindOf.get(id) ?? "?";
    byKind[k] = (byKind[k] ?? 0) + 1;
    const n = nodes.get(id);
    if (n && (examples[k] ??= []).length < 3) examples[k].push({ id, lat: +n.lat.toFixed(5), lon: +n.lon.toFixed(5) });
  }
  const grade = (g: typeof region.play.graph, v: string) => g.edges.filter((e) => e.grade === v).length;
  out.push({
    place: pl.id, playCrossings: region.play.crossingNodes.size, byKind, examples,
    playKm: +region.play.componentKm.toFixed(1), strictKm: +region.stats.componentKm.toFixed(1), strictHazardEnds: region.hazardNodes.size,
    bridges: grade(region.play.graph, "bridge"), tunnels: grade(region.play.graph, "tunnel"),
  });
}
console.log(JSON.stringify(out, null, 1));
