// npx tsx experiments/routes/export-viz.ts – förbakar stignät för /dev/routes till public/dev-routes/ (gitignorerat).
import { mkdirSync, writeFileSync } from "node:fs";
import { AREAS } from "../data/areas";
import { loadAreaGraphs } from "../data/lib/load";

const OUT = "public/dev-routes";
mkdirSync(OUT, { recursive: true });
const index = [];
for (const a of AREAS) {
  for (const act of ["run", "mtb"] as const) {
    const ag = loadAreaGraphs(a.id, "pbf", act);
    writeFileSync(`${OUT}/${a.id}.${act}.json`, JSON.stringify({ graph: ag.main, hazardNodes: [...ag.hazardNodes] }));
  }
  index.push({ id: a.id, name: a.name, bbox: a.bbox });
}
writeFileSync(`${OUT}/index.json`, JSON.stringify({ areas: index }));
console.log("klart", OUT);
