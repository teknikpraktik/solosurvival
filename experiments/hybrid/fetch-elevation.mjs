// Provtar EU-DEM 25 m via api.opentopodata.org i ett 30×30-rutnät per område. Kör: node experiments/hybrid/fetch-elevation.mjs
import { writeFileSync, existsSync } from "node:fs";
const AREAS = { skutberget: [59.3588, 13.368, 59.3858, 13.42], "i2-skogen": [59.3965, 13.44, 59.4235, 13.492], sormon: [59.365, 13.328, 59.392, 13.38] };
const N = 30, UA = "outbreak-solo-survival-research/0.1 (per.a.bjorkman@gmail.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [id, [s, w, n, e]] of Object.entries(AREAS)) {
  const out = `experiments/hybrid/fixtures/${id}.elevation.json`;
  if (existsSync(out)) { console.log(id, "cachad"); continue; }
  const pts = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pts.push([s + ((n - s) * j) / (N - 1), w + ((e - w) * i) / (N - 1)]);
  const elev = [];
  for (let k = 0; k < pts.length; k += 100) {
    const loc = pts.slice(k, k + 100).map(([a, b]) => `${a.toFixed(6)},${b.toFixed(6)}`).join("|");
    const res = await fetch(`https://api.opentopodata.org/v1/eudem25m?locations=${loc}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
    for (const r of (await res.json()).results) elev.push(r.elevation);
    await sleep(1300);
  }
  writeFileSync(out, JSON.stringify({ area: id, bbox: [s, w, n, e], grid: N, dataset: "eudem25m (EU-DEM v1.1, Copernicus)", endpoint: "https://api.opentopodata.org/v1/eudem25m", fetchedAt: new Date().toISOString(), license: "Copernicus EU-DEM: fri och öppen åtkomst; opentopodata.org som tjänst", note: "Punktprover (inte hela rastret); DSM-upplösning 25 m, vertikalt fel ca 7 m RMSE", elevation: elev }));
  console.log(id, elev.length, "punkter", elev.filter((x) => x === null).length, "null");
}
