/* How many goals THE FALL's checkpoint missions (02, 04) really get, on the real Värmland tiles, with the game's own preparation.
 *   npx tsx scripts/campaign-goal-count.ts [random starts] [seeds per start] > rows.jsonl
 * Starts: fixed representative places (town centre, suburb, forest, small towns, countryside) and deterministic random starts
 * (a random tile, a random walkable way, a node on it, 0/40/100 m off it, as in bike-network-eval.ts). Per start, mission and seed:
 * the preparation's status, the number of goals laid out, the course length, and the number of checkpoints the generator's course had. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { TileStore } from "../src/data/store";
import { prepareMission } from "../src/campaign/prepare";
import { missionParams } from "../src/campaign/setup";
import { THE_FALL } from "../src/campaign/the-fall";
import { decideWay } from "../src/geo/osm/overpass";
import type { LatLon } from "../src/geo/geometry";

const N = Number(process.argv[2] ?? 60), SEEDS = Number(process.argv[3] ?? 5);
const root = "public/data/v1/varmland";
const fsFetch = async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = new TileStore("/data/v1/varmland", fsFetch as never);
const tiles: number[][] = JSON.parse(readFileSync(root + "/manifest.json", "utf8")).tiles;
let s = 20261117; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

export const PLACES: { id: string; p: LatLon }[] = [
  { id: "karlstad-centrum", p: { lat: 59.3793, lon: 13.5036 } },
  { id: "karlstad-i2", p: { lat: 59.40731, lon: 13.46753 } },
  { id: "skutberget", p: { lat: 59.3723, lon: 13.3937 } },
  { id: "sormon", p: { lat: 59.3786, lon: 13.3539 } },
  { id: "kronoparken", p: { lat: 59.4055, lon: 13.5850 } },
  { id: "kristinehamn", p: { lat: 59.3097, lon: 14.1081 } },
  { id: "arvika", p: { lat: 59.6553, lon: 12.5852 } },
  { id: "sunne", p: { lat: 59.8366, lon: 13.1433 } },
  { id: "torsby", p: { lat: 60.1336, lon: 13.0000 } },
  { id: "filipstad", p: { lat: 59.7127, lon: 14.1683 } },
  { id: "hagfors", p: { lat: 60.0328, lon: 13.6936 } },
  { id: "saffle", p: { lat: 59.1328, lon: 12.9306 } },
  { id: "molkom", p: { lat: 59.6012, lon: 13.7177 } },
  { id: "deje", p: { lat: 59.6040, lon: 13.4680 } },
];

function displace(p: LatLon, m: number, b: number): LatLon {
  return { lat: p.lat + (m * Math.cos(b)) / 111_320, lon: p.lon + (m * Math.sin(b)) / (111_320 * Math.cos((p.lat * Math.PI) / 180)) };
}

async function randomStarts(n: number): Promise<{ id: string; p: LatLon }[]> {
  const out: { id: string; p: LatLon }[] = [];
  while (out.length < n) {
    const t = tiles[Math.floor(rnd() * tiles.length)];
    const c = { lat: (t[0] + 0.5) * 0.05, lon: (t[1] + 0.5) * 0.1 };
    const { ways } = await store.loadAround(c, 2800);
    const ok = ways.filter((w) => decideWay(w.tags, "walk").ok && w.nodes.length > 1);
    const off = [0, 40, 100][Math.floor(rnd() * 3)], b = rnd() * 2 * Math.PI;
    if (!ok.length) continue;
    const w = ok[Math.floor(rnd() * ok.length)];
    const nd = w.nodes[Math.floor(rnd() * w.nodes.length)];
    out.push({ id: `r${out.length}`, p: displace({ lat: nd.lat, lon: nd.lon }, off, b) });
  }
  return out;
}

const missions = THE_FALL.missions.filter((m) => m.layout.kind === "checkpoints");
for (const st of [...PLACES, ...(await randomStarts(N))]) {
  for (const m of missions) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const p = missionParams(THE_FALL, m, "normal", seed);
      const r = await prepareMission(store, st.p, m, p);
      const goals = r.proposals[0]?.waypoints.filter((w) => w.kind === "checkpoint").length ?? 0;
      console.log(JSON.stringify({ start: st.id, lat: +st.p.lat.toFixed(5), lon: +st.p.lon.toFixed(5), mission: m.id, seed, status: r.status, goals, lengthM: Math.round(r.proposals[0]?.lengthM ?? 0), km: +(r.region?.stats.componentKm ?? 0).toFixed(1), notes: r.notes.filter((x) => /course|checkpoint|Too few/i.test(x)) }));
    }
  }
}
