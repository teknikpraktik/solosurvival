// npx tsx experiments/data/compare-osm.ts  – jämför OSM-API-tiles mot regionalt PBF-extrakt (och är redo för Lantmäteriets GPKG, se lm-gpkg.md).
import { writeFileSync } from "node:fs";
import { AREAS } from "./areas";
import { loadAreaGraphs, loadWays, wayLengths } from "./lib/load";
import { attributeCoverage, graphStats, matchAgainst } from "@/geo/compare/compare";

const ATTRS = ["access", "foot", "bicycle", "mtb:scale", "surface", "oneway", "bridge", "tunnel", "tracktype", "trail_visibility", "sac_scale", "name"];
const rows: unknown[] = [];
const f = (x: number, d = 1) => x.toFixed(d);
for (const a of AREAS) for (const act of ["run", "mtb"] as const) {
  const api = loadAreaGraphs(a.id, "api", act), pbf = loadAreaGraphs(a.id, "pbf", act);
  const sa = graphStats(api.all), sp = graphStats(pbf.all);
  const ap = matchAgainst(api.all, pbf.all, 10), pa = matchAgainst(pbf.all, api.all, 10);
  console.log(`\n${a.name} / ${act}`);
  console.log(`  API : ${f(sa.lengthKm)} km, ${sa.edges} kanter, ${sa.junctions} korsn., ${sa.components} komp., största ${f(sa.largestComponentShare * 100)} %, återvändsgrenar ${f(sa.deadEndShare * 100)} %`);
  console.log(`  PBF : ${f(sp.lengthKm)} km, ${sp.edges} kanter, ${sp.junctions} korsn., ${sp.components} komp., största ${f(sp.largestComponentShare * 100)} %, återvändsgrenar ${f(sp.deadEndShare * 100)} %`);
  console.log(`  API i PBF (10 m): ${f(ap.aCoverage * 100, 2)} % (${f(ap.aOnlyKm, 3)} km saknas), korsningar ${ap.junctionsMatched}/${ap.junctionsA} · PBF i API: ${f(pa.aCoverage * 100, 2)} % (${f(pa.aOnlyKm, 3)} km saknas), korsningar ${pa.junctionsMatched}/${pa.junctionsA}`);
  rows.push({ area: a.id, act, api: sa, pbf: sp, apiInPbf: { ...ap, aOnlySegments: ap.aOnlySegments.length }, pbfInApi: { ...pa, aOnlySegments: pa.aOnlySegments.length } });
}
console.log("\nAttributtäckning (andel av ways | andel av längd), alla highway-ways i rutan:");
for (const a of AREAS) for (const src of ["api", "pbf"] as const) {
  const c = attributeCoverage(wayLengths(loadWays(a.id, src)), ATTRS);
  console.log(`  ${a.name.padEnd(11)} ${src} (${c.ways} ways): ` + ATTRS.map((k) => `${k} ${f(c.share[k] * 100, 0)}|${f(c.lengthShare[k] * 100, 0)}`).join("  "));
}
writeFileSync("experiments/data/results-compare-osm.json", JSON.stringify(rows, null, 1));

// Andel av stignätet som går att använda för säker ruttgenerering (PBF-källan).
import { indexGraph } from "@/geo/graph/graph";
const POS = new Set(["yes", "designated", "permissive", "official"]);
console.log("\nAnvändbarhet för säker ruttgenerering (största komponenten, % av längd):");
for (const a of AREAS) for (const act of ["run", "mtb"] as const) {
  const g = loadAreaGraphs(a.id, "pbf", act);
  const tags = new Map(loadWays(a.id, "pbf").map((w) => [String(w.id), w.tags!]));
  const idx = indexGraph(g.main), total = [...idx.edges.values()].reduce((s, e) => s + e.lengthM, 0);
  const share = (pred: (t: Record<string, string>) => boolean) => [...idx.edges.values()].filter((e) => pred(tags.get(e.id.split(":")[0]) ?? {})).reduce((s, e) => s + e.lengthM, 0) / total;
  const all = graphStats(g.all).lengthKm, main = graphStats(g.main).lengthKm;
  const explicit = share((t) => (act === "mtb" ? POS.has(t.bicycle) || t["mtb:scale"] !== undefined : POS.has(t.foot)));
  const oneway = share((t) => !!(t.oneway || t["oneway:bicycle"]));
  console.log(`  ${a.name.padEnd(11)} ${act.padEnd(4)} i största komp. ${f(main / all * 100)} % av filtrerad längd; med uttryckligt positivt tillträdesstöd (${act === "mtb" ? "bicycle=yes/designated eller mtb:scale" : "foot=yes/designated"}) ${f(explicit * 100)} %; enkelriktat ${f(oneway * 100)} %; farliga korsningar med större väg: ${g.hazardNodes.size} noder`);
}
