/* Fingeravtryck av prepareMatch på riktiga Värmlandstiles (samma startpunkter som bike-network-eval). Jämför två kodversioner med diff.
 *   npx tsx scripts/prepare-fingerprint.ts <antal starter> > a.txt */
import { readFileSync } from "node:fs";
import path from "node:path";
import { TileStore } from "../src/data/store";
import { prepareMatch } from "../src/play/prepare";
import { defaultParams } from "../src/play/config";
import { decideWay } from "../src/geo/osm/overpass";
import type { Activity } from "../src/config/activities";

const N = Number(process.argv[2] ?? 100);
const root = "public/data/v1/varmland";
const fsFetch = async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = new TileStore("/data/v1/varmland", fsFetch as never);
const tiles: number[][] = JSON.parse(readFileSync(root + "/manifest.json", "utf8")).tiles;
let seed = 777; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
let done = 0;
while (done < N) {
  const t = tiles[Math.floor(rnd() * tiles.length)];
  const c = { lat: (t[0] + 0.5) * 0.05, lon: (t[1] + 0.5) * 0.1 };
  const { ways } = await store.loadAround(c, 2800);
  const act = (done % 2 ? "mtb" : "walk") as Activity;
  const ok = ways.filter((w) => decideWay(w.tags, act).ok && w.nodes.length > 1);
  if (!ok.length) continue;
  const w = ok[Math.floor(rnd() * ok.length)], n = w.nodes[Math.floor(rnd() * w.nodes.length)];
  const start = { lat: n.lat + 40 / 111_320, lon: n.lon };
  const parts: string[] = [];
  for (const mode of ["survival", "mission"] as const) {
    const r = await prepareMatch(store, start, { ...defaultParams(act), mode, seed: 5 });
    parts.push(`${mode}:${r.status}:${r.region?.startSnapM?.toFixed(1) ?? "-"}:${r.region?.stats.componentKm.toFixed(2) ?? "-"}:${r.region?.play.componentKm.toFixed(2) ?? "-"}:${r.proposals[0]?.lengthM?.toFixed(0) ?? "-"}`);
  }
  console.log(`${done} ${act} ${parts.join(" ")}`);
  done++;
}
