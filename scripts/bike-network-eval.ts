/* Jämför regler för val av startkomponent på riktiga Värmlandstiles, med samma startpunkter för alla regler.
 *   npx tsx scripts/bike-network-eval.ts <antal starter> <shard> <antal shards> [aktivitet] > rader.jsonl
 * Startpunkter: en slumpad tillåten väg i en slumpad tile; spelaren står på vägen, 40 m eller 100 m från den (GPS är aldrig exakt på en väg).
 * Per start och regel: Survival (gränser, extraction) och Mission (checkpoints, längd) med den riktiga prepareMatch. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { TileStore } from "../src/data/store";
import { prepareMatch } from "../src/play/prepare";
import { defaultParams } from "../src/play/config";
import { decideWay } from "../src/geo/osm/overpass";
import { indexGraph } from "../src/geo/graph/graph";
import { snapToGraph } from "../src/geo/graph/graph";
import { chooseExtraction } from "../src/engine/extraction/extraction";
import { ACTIVITIES, type Activity } from "../src/config/activities";
import type { ComponentPolicy } from "../src/data/region-graph";
import type { LatLon } from "../src/geo/geometry";

const [nArg, shardArg, shardsArg, actArg] = process.argv.slice(2);
const N = Number(nArg ?? 60), shard = Number(shardArg ?? 0), shards = Number(shardsArg ?? 1);
const activity = (actArg ?? "mtb") as Activity;
const root = "public/data/v1/varmland";
const fsFetch = async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = new TileStore("/data/v1/varmland", fsFetch as never);
const manifest = JSON.parse(readFileSync(root + "/manifest.json", "utf8"));
const tiles: number[][] = manifest.tiles;
let seed = 20261024; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const POLICIES: ComponentPolicy[] = ["nearest", "largest150", "largest300", "largest500", "scored", "scored150"];
const OFFSETS = [0, 40, 100];

function displace(p: LatLon, m: number, bearing: number): LatLon {
  const dLat = (m * Math.cos(bearing)) / 111_320, dLon = (m * Math.sin(bearing)) / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  return { lat: p.lat + dLat, lon: p.lon + dLon };
}

/** Andel återvändsgränder (längd i grenar som slutar blint) och cykelkomplexitet (kanter − noder + 1) i den valda delen. */
function structure(g: ReturnType<typeof indexGraph>) {
  const deg = new Map<string, number>();
  for (const e of g.edges.values()) { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1); }
  const alive = new Set([...g.edges.keys()]);
  const d = new Map(deg);
  const stack = [...d.entries()].filter(([, v]) => v === 1).map(([k]) => k);
  let pruned = 0, total = 0;
  for (const e of g.edges.values()) total += e.lengthM;
  while (stack.length) {
    const n = stack.pop()!;
    if (d.get(n) !== 1) continue;
    for (const a of g.adj.get(n) ?? []) {
      if (!alive.has(a.edgeId)) continue;
      alive.delete(a.edgeId); pruned += g.edges.get(a.edgeId)!.lengthM;
      d.set(n, (d.get(n) ?? 1) - 1); d.set(a.to, (d.get(a.to) ?? 1) - 1);
      if (d.get(a.to) === 1) stack.push(a.to);
    }
  }
  return { deadEndShare: total ? pruned / total : 0, cycles: g.edges.size - g.nodes.size + 1 };
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
  if (!my) { done++; continue; }
  const start = displace({ lat: n.lat, lon: n.lon }, off, bearing);
  for (const policy of POLICIES) {
    const row: Record<string, unknown> = { i: idx - 1, activity, policy, offset: off, lat: +start.lat.toFixed(5), lon: +start.lon.toFixed(5) };
    const surv = await prepareMatch(store, start, { ...defaultParams(activity), mode: "survival", seed: 5 }, { component: policy });
    row.sStatus = surv.status; row.sSnap = surv.region?.startSnapM ?? null; row.sKm = surv.region?.stats.componentKm ?? 0; row.cands = surv.region?.stats.candidates;
    if (surv.status === "ok" && surv.graph) {
      const g = surv.graph;
      const sn = snapToGraph(g, start);
      const comp = sn ? g.edges.get(sn.edgeId)!.component : -1;
      row.sComponent = comp;
      Object.assign(row, structure(g));
      row.extraction = !!(sn && chooseExtraction(g, { playerPos: sn, component: comp, zombiePositions: [], remainingS: 0.2 * 2700, playerPaceMps: ACTIVITIES[activity].playerPaceMps }, { rngState: 7 }));
    }
    const mis = await prepareMatch(store, start, { ...defaultParams(activity), mode: "mission", seed: 5 }, { component: policy });
    row.mStatus = mis.status; row.mProposals = mis.proposals.length; row.mLenM = mis.proposals[0]?.lengthM ?? null; row.mTargetM = defaultParams(activity).targetLengthM;
    row.mSnap = mis.region?.startSnapM ?? null;
    console.log(JSON.stringify(row));
  }
  done++;
}
