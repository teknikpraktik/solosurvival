/* Experiment: the game's network built from OpenFreeMap vector tiles against the one built from our OSM tiles (the reference), with the
 * same graph builder. See docs/GLOBAL-MAP-DATA.md.
 *   npx tsx experiments/global/compare-ofm.ts [radius m] [areas]      areas: karlstad,i2-skogen,skutberget,sormon (Värmland, with reference)
 *                                                                     or any name:lat,lon (no reference, network figures only)
 * Tiles are cached in $OFM_CACHE (default: experiments/global/.cache, not committed). */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TileStore } from "../../src/data/store";
import { buildRegionGraph } from "../../src/data/region-graph";
import { indexGraph } from "../../src/geo/graph/graph";
import { pointAlong, toLocal, type LatLon } from "../../src/geo/geometry";
import type { Activity } from "../../src/config/activities";
import type { SerializedGraph } from "../../src/geo/graph/types";
import { DEFAULT_OFM, ofmWays, type TileFetcher } from "./ofm-ways";
/** OFM_STITCH (units, 0 = off) and OFM_CROSS=1 change how lines are joined (see ofm-ways.ts). */
const OPTS = { stitchUnits: Number(process.env.OFM_STITCH ?? DEFAULT_OFM.stitchUnits), crossings: process.env.OFM_CROSS === "1" };

const RADIUS = Number(process.argv[2] ?? 1500);
const KNOWN: Record<string, LatLon> = {
  karlstad: { lat: 59.3793, lon: 13.5036 }, "i2-skogen": { lat: 59.41, lon: 13.466 }, skutberget: { lat: 59.3723, lon: 13.394 }, sormon: { lat: 59.3785, lon: 13.354 },
};
const AREAS = (process.argv[3] ?? "karlstad,i2-skogen,skutberget,sormon").split(",").map((a) => {
  const [name, ll] = a.split(":");
  if (ll) { const [lat, lon] = ll.split("/").map(Number); return { name, c: { lat, lon }, ref: false }; }
  return { name, c: KNOWN[name], ref: true };
});

const root = path.join(process.cwd(), "public/data/v1/varmland");
const fsFetch = async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = new TileStore("/data/v1/varmland", fsFetch as never);

const CACHE = process.env.OFM_CACHE ?? path.join(process.cwd(), "experiments/global/.cache");
mkdirSync(CACHE, { recursive: true });
let template: string | null = null;
const fetchTile: TileFetcher = async (z, x, y) => {
  const f = path.join(CACHE, `${z}_${x}_${y}.pbf`);
  if (existsSync(f)) { const b = readFileSync(f); return b.length ? new Uint8Array(b) : null; }
  template ??= ((await (await fetch("https://tiles.openfreemap.org/planet")).json()) as { tiles: string[] }).tiles[0];
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)));
    if (r.status === 204 || r.status === 404) { writeFileSync(f, ""); return null; }
    if (r.ok) { const b = new Uint8Array(await r.arrayBuffer()); writeFileSync(f, b); return b; }
    await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
  }
  throw new Error(`tile ${z}/${x}/${y}`);
};

/** Points every `stepM` along all edges, and a grid of the edges' segments for nearest-distance queries. */
function sampler(g: SerializedGraph, origin: LatLon) {
  const ig = indexGraph(g);
  const segs: [number, number, number, number][] = [];
  const cells = new Map<string, number[]>();
  const C = 25;
  for (const e of ig.edges.values()) for (let i = 0; i + 1 < e.geometry.length; i++) {
    const a = toLocal(origin, e.geometry[i]), b = toLocal(origin, e.geometry[i + 1]);
    const id = segs.push([a.x, a.y, b.x, b.y]) - 1;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / C));
    const seen = new Set<string>();
    for (let k = 0; k <= n; k++) { const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n; const key = `${Math.floor(x / C)}_${Math.floor(y / C)}`; if (!seen.has(key)) { seen.add(key); (cells.get(key) ?? cells.set(key, []).get(key)!).push(id); } }
  }
  const nearest = (p: { x: number; y: number }, maxM: number) => {
    let best = Infinity;
    const r = Math.ceil(maxM / C);
    const cx = Math.floor(p.x / C), cy = Math.floor(p.y / C);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (const id of cells.get(`${cx + dx}_${cy + dy}`) ?? []) {
      const [x0, y0, x1, y1] = segs[id]; const vx = x1 - x0, vy = y1 - y0; const l2 = vx * vx + vy * vy;
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - x0) * vx + (p.y - y0) * vy) / l2)) : 0;
      best = Math.min(best, Math.hypot(p.x - x0 - t * vx, p.y - y0 - t * vy));
    }
    return best;
  };
  const samples = (stepM: number) => {
    const out: { x: number; y: number }[] = [];
    for (const e of ig.edges.values()) for (let d = 0; d <= e.lengthM; d += stepM) out.push(toLocal(origin, pointAlong(e.geometry, e.cumM, d)));
    return out;
  };
  const km = [...ig.edges.values()].reduce((s, e) => s + e.lengthM, 0) / 1000;
  const deg = new Map<string, number>();
  for (const e of ig.edges.values()) { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1); }
  const junctions = [...deg].filter(([, d]) => d >= 3).map(([id]) => toLocal(origin, ig.nodes.get(id)!));
  const largest = Math.max(0, ...ig.components.map((c) => c.lengthM)) / 1000;
  return { ig, nearest, samples, km, junctions, largest, components: ig.components.length };
}

const pct = (x: number) => `${(100 * x).toFixed(1)} %`;
const within = (pts: { x: number; y: number }[], other: { x: number; y: number }[], m: number) => pts.filter((p) => other.some((q) => Math.abs(q.x - p.x) <= m && Math.abs(q.y - p.y) <= m && Math.hypot(q.x - p.x, q.y - p.y) <= m)).length / Math.max(1, pts.length);

console.log(`# Network from OpenFreeMap tiles against OSM tiles (radius ${RADIUS} m, joining ${JSON.stringify(OPTS)})\n`);
console.log("| area | activity | source | km | edges | junctions | components | largest comp. km | crossings/hazard stubs | junctions matched (5 m) | covered by other (10 m) | tiles | download | ms |");
console.log("|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
for (const area of AREAS) {
  const ofm = await ofmWays(fetchTile, area.c, RADIUS + 300, 14, OPTS);
  const ref = area.ref ? await store.loadAround(area.c, RADIUS + 300) : null;
  for (const activity of ["walk", "mtb"] as Activity[]) {
    const t0 = Date.now();
    const go = buildRegionGraph(ofm.ways, activity, area.c, RADIUS);
    const gms = Date.now() - t0;
    const o = sampler(go.play.graph, area.c);
    const row = (name: string, s: ReturnType<typeof sampler>, g: typeof go, extra: string) =>
      `| ${area.name} | ${activity} | ${name} | ${s.km.toFixed(1)} | ${s.ig.edges.size} | ${s.junctions.length} | ${s.components} | ${s.largest.toFixed(1)} | ${g.play.crossingNodes.size}/${g.stats.hazardStubs} | ${extra}`;
    if (ref) {
      const gr = buildRegionGraph(ref.ways, activity, area.c, RADIUS);
      const r = sampler(gr.play.graph, area.c);
      const so = o.samples(10), sr = r.samples(10);
      const covRef = sr.filter((p) => o.nearest(p, 10) <= 10).length / sr.length; // reference covered by OFM
      const covOfm = so.filter((p) => r.nearest(p, 10) <= 10).length / so.length;
      console.log(row("OSM (ref)", r, gr, `– | ${pct(covRef)} by OFM | – | ${(ref.stats.networkGzipBytes / 1024).toFixed(0)} KB* | – |`));
      console.log(row("OpenFreeMap", o, go, `${pct(within(r.junctions, o.junctions, 5))} of ref / ${pct(within(o.junctions, r.junctions, 5))} real | ${pct(covOfm)} by ref | ${ofm.tiles} | ${(ofm.bytes / 1024).toFixed(0)} KB | ${gms} |`));
    } else {
      console.log(row("OpenFreeMap", o, go, `– | – | ${ofm.tiles} | ${(ofm.bytes / 1024).toFixed(0)} KB | ${gms} |`));
    }
  }
}
console.log("\n*OSM tiles: 0 KB when read from disk here; in the app about 10–15 KB gzip per km² of Värmland.");
