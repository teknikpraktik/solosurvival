// LM_GPKG=<sökväg till kommunikation_*.gpkg (Topografi 10 eller 50)> npx tsx experiments/data/compare-lm.ts [lager...]
// Jämför Lantmäteriets stignät mot OSM (PBF) i de tre testområdena med samma mått som compare-osm.ts.
// Utan LM_GPKG skriver skriptet bara ut hur data beställs; inga värden hittas på.
import { existsSync } from "node:fs";
import { AREAS } from "./areas";
import { loadAreaGraphs } from "./lib/load";
import { linesToGraph, readGpkgLines } from "./lib/gpkg";
import { graphStats, matchAgainst } from "@/geo/compare/compare";
import { pointInPolygon } from "@/geo/geometry";
import type { SerializedGraph } from "@/geo/graph/types";

const file = process.env.LM_GPKG;
if (!file || !existsSync(file)) {
  console.log("Ingen Lantmäteri-GeoPackage angiven (LM_GPKG). Se experiments/data/DATA-SOURCES.md, avsnitt 'Beställning'.");
  process.exit(0);
}
const layers = process.argv.slice(2).length ? process.argv.slice(2) : ["ovrig_vag", "vaglinje"];
const lines = layers.flatMap((l) => readGpkgLines(file, l));
console.log(`${lines.length} linjeobjekt lästa ur ${file} (${layers.join(", ")})`);
const f = (x: number, d = 1) => x.toFixed(d);
for (const a of AREAS) {
  const [s, w, n, e] = a.bbox;
  const ring: [number, number][] = [[w, s], [e, s], [e, n], [w, n]];
  const inBox = lines.filter((l) => l.parts.some((p) => p.some((q) => pointInPolygon(q, ring))));
  const lm: SerializedGraph = linesToGraph(inBox);
  for (const act of ["run", "mtb"] as const) {
    const osm = loadAreaGraphs(a.id, "pbf", act).all;
    const sl = graphStats(lm), so = graphStats(osm);
    const lo = matchAgainst(lm, osm, 15), ol = matchAgainst(osm, lm, 15);
    console.log(`\n${a.name} / ${act}\n  LM : ${f(sl.lengthKm)} km, ${sl.edges} kanter, ${sl.junctions} korsn., största komp. ${f(sl.largestComponentShare * 100)} %, återvändsgrenar ${f(sl.deadEndShare * 100)} %\n  OSM: ${f(so.lengthKm)} km, ${so.edges} kanter, ${so.junctions} korsn., största komp. ${f(so.largestComponentShare * 100)} %, återvändsgrenar ${f(so.deadEndShare * 100)} %\n  LM i OSM (15 m): ${f(lo.aCoverage * 100)} % (${f(lo.aOnlyKm, 2)} km bara hos LM) · OSM i LM: ${f(ol.aCoverage * 100)} % (${f(ol.aOnlyKm, 2)} km bara hos OSM)`);
  }
}
