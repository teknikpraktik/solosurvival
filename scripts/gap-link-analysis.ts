/* Utredning (ingen speländring): hur många av de misslyckade starterna skulle lösas om zombier fick använda korta länkar mellan nätverksdelar?
 *   npx tsx scripts/gap-link-analysis.ts <antal starter> <shard> <antal shards> [aktivitet]
 * Samma startpunkter som scripts/bike-network-eval.ts. Länkar mellan delar vars närmaste noder ligger inom G m (25/50/100/250).
 * En länk räknas som "riskabel" om någon av dess ändnoder är en hindernod, alltså där stigen tar slut vid större väg, järnväg eller vatten
 * (den nuvarande tile-datan skiljer inte på vilken typ). Spelet använder inga länkar; detta är bara mätning. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { TileStore } from "../src/data/store";
import { networkPieces, MIN_COMPONENT_M, MAX_START_SNAP_M } from "../src/data/region-graph";
import { decideWay } from "../src/geo/osm/overpass";
import { indexGraph } from "../src/geo/graph/graph";
import { haversineM, projectToPolyline, type LatLon } from "../src/geo/geometry";
import { ACTIVITIES, type Activity } from "../src/config/activities";
import { dataRadiusM, defaultParams } from "../src/play/config";

const [nArg, shardArg, shardsArg, actArg] = process.argv.slice(2);
const N = Number(nArg ?? 60), shard = Number(shardArg ?? 0), shards = Number(shardsArg ?? 1);
const activity = (actArg ?? "mtb") as Activity;
const root = "public/data/v1/varmland";
const fsFetch = async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = new TileStore("/data/v1/varmland", fsFetch as never);
const manifest = JSON.parse(readFileSync(root + "/manifest.json", "utf8"));
const tiles: number[][] = manifest.tiles;
let seed = 20261024; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const OFFSETS = [0, 40, 100];
const GAPS = [0, 25, 50, 100, 250];
const SURV_MIN_M = 3000;
function displace(p: LatLon, m: number, bearing: number): LatLon {
  return { lat: p.lat + (m * Math.cos(bearing)) / 111_320, lon: p.lon + (m * Math.sin(bearing)) / (111_320 * Math.cos((p.lat * Math.PI) / 180)) };
}
let idx = 0, done = 0;
while (done < N) {
  const t = tiles[Math.floor(rnd() * tiles.length)];
  const c = { lat: (t[0] + 0.5) * 0.05, lon: (t[1] + 0.5) * 0.1 };
  const { ways } = await store.loadAround(c, 2800);
  const ok = ways.filter((w) => decideWay(w.tags, activity).ok && w.nodes.length > 1);
  const w = ok.length ? ok[Math.floor(rnd() * ok.length)] : null;
  const n = w ? w.nodes[Math.floor(rnd() * w.nodes.length)] : null;
  const off = OFFSETS[Math.floor(rnd() * OFFSETS.length)], bearing = rnd() * 2 * Math.PI;
  if (!n) continue;
  const my = idx++ % shards === shard;
  done++;
  if (!my) continue;
  const start = displace({ lat: n.lat, lon: n.lon }, off, bearing);
  const p = { ...defaultParams(activity), mode: "survival" as const };
  const radius = dataRadiusM(p);
  const { ways: ww } = await store.loadAround(start, radius);
  const { graph, hazardNodes } = networkPieces(ww, activity, start, radius);
  const g = indexGraph(graph);
  const comps = g.components.length;
  // Närmaste punkt per del till startpunkten (för start-gränsen på 150 m).
  const dist = new Array<number>(comps).fill(Infinity);
  for (const e of g.edges.values()) { const d = projectToPolyline(e.geometry, e.cumM, start).distanceM; if (d < dist[e.component]) dist[e.component] = d; }
  const nodeComp = new Map<string, number>();
  for (const e of g.edges.values()) { nodeComp.set(e.from, e.component); nodeComp.set(e.to, e.component); }
  const pts = [...nodeComp.entries()].map(([id, cc]) => ({ ...g.nodes.get(id)!, id, cc }));
  const cell = 0.0025; const grid = new Map<string, typeof pts>();
  for (const q of pts) { const k = `${Math.floor(q.lat / cell)}_${Math.floor(q.lon / (cell * 2))}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(q); }
  const row: Record<string, unknown> = { i: idx - 1, activity, offset: off, comps };
  for (const [G, safeOnly] of GAPS.flatMap((g) => (g === 0 ? [[0, false]] : [[g, false], [g, true]])) as [number, boolean][]) {
    const par = [...Array(comps).keys()]; const find = (x: number): number => (par[x] === x ? x : (par[x] = find(par[x])));
    let links = 0, risky = 0;
    const seen = new Set<string>();
    if (G > 0) {
      const r = Math.ceil(G / 250) + 1;
      for (const q of pts) {
        const ky = Math.floor(q.lat / cell), kx = Math.floor(q.lon / (cell * 2));
        let best: { o: (typeof pts)[number]; d: number } | null = null;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r * 2; dx <= r * 2; dx++) for (const o of grid.get(`${ky + dy}_${kx + dx}`) ?? []) {
          if (o.cc === q.cc) continue;
          const d = haversineM(o, q);
          if (d <= G && (!best || d < best.d) && !(safeOnly && (hazardNodes.has(o.id) || hazardNodes.has(q.id)))) best = { o, d };
        }
        if (best) {
          const key = [q.cc, best.o.cc].sort().join("-");
          if (!seen.has(key)) { seen.add(key); links++; if (hazardNodes.has(q.id) || hazardNodes.has(best.o.id)) risky++; }
          par[find(best.o.cc)] = find(q.cc);
        }
      }
    }
    // Startdelen: den som hålls av den närmaste delen ≥ 1,5 km (som spelet), annars närmaste överhuvudtaget; sedan sammanslagen längd av alla delar ≤ 150 m eller länkade.
    const lens = g.components.map((x) => x.lengthM);
    const mergedLen = new Map<number, number>(); for (let i = 0; i < comps; i++) mergedLen.set(find(i), (mergedLen.get(find(i)) ?? 0) + lens[i]);
    const mergedDist = new Map<number, number>(); for (let i = 0; i < comps; i++) mergedDist.set(find(i), Math.min(mergedDist.get(find(i)) ?? Infinity, dist[i]));
    const groups = [...mergedLen.keys()].map((k) => ({ len: mergedLen.get(k)!, d: mergedDist.get(k)! }));
    const usable = groups.filter((x) => x.len >= MIN_COMPONENT_M);
    const pool = usable.length ? usable : groups;
    const best = pool.sort((a, b) => a.d - b.d)[0];
    row[`g${G}${safeOnly ? "s" : ""}`] = { km: best ? +(best.len / 1000).toFixed(2) : 0, d: best ? Math.round(best.d) : null, ok: !!best && best.d <= MAX_START_SNAP_M && best.len >= SURV_MIN_M, links, risky };
  }
  console.log(JSON.stringify(row));
}
void ACTIVITIES;
