// npx tsx experiments/hybrid/slope-stats.ts – brantfördelning från höjdprovtagningen (grov: ~100 m mellan punkter).
import { readFileSync } from "node:fs";
import { AREAS } from "./areas";
for (const a of AREAS) {
  const f = JSON.parse(readFileSync(`experiments/hybrid/fixtures/${a.id}.elevation.json`, "utf8"));
  const N = f.grid, z: number[] = f.elevation;
  const [s, w, n, e] = a.bbox;
  const dy = ((n - s) * 111320) / (N - 1), dx = ((e - w) * 111320 * Math.cos((((s + n) / 2) * Math.PI) / 180)) / (N - 1);
  const slopes: number[] = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const g = (a1: number, b1: number) => z[b1 * N + a1];
    const sx = (g(i + 1, j) - g(i, j)) / dx, sy = (g(i, j + 1) - g(i, j)) / dy;
    slopes.push((Math.atan(Math.hypot(sx, sy)) * 180) / Math.PI);
  }
  slopes.sort((x, y) => x - y);
  const q = (p: number) => slopes[Math.floor(slopes.length * p)].toFixed(1);
  const share = (deg: number) => ((slopes.filter((x) => x > deg).length / slopes.length) * 100).toFixed(1);
  console.log(`${a.name.padEnd(11)} höjd ${Math.min(...z).toFixed(0)}–${Math.max(...z).toFixed(0)} m, brant (${dx.toFixed(0)}×${dy.toFixed(0)} m-skala) median ${q(0.5)}°, p90 ${q(0.9)}°, p99 ${q(0.99)}°, max ${q(0.999)}° | >15°: ${share(15)} %  >25°: ${share(25)} %  >35°: ${share(35)} %`);
}
