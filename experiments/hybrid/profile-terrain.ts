import { AREAS } from "./areas";
import { loadFixture } from "./lib/fixture";
import { buildRaster, coverage } from "./lib/raster";

for (const a of AREAS) {
  const fx = loadFixture(a.id);
  const r = buildRaster(fx);
  const cov = coverage(r);
  console.log(`\n== ${a.name} (${fx.widthM.toFixed(0)} × ${fx.heightM.toFixed(0)} m, ${r.w}×${r.h} celler à ${r.cell} m)`);
  for (const [k, v] of Object.entries(cov)) console.log(`  ${k.padEnd(16)} ${(v * 100).toFixed(1)} %`);
  console.log("  rasterstatistik:", JSON.stringify(r.stats));
}
