/* Granskning av spelnätets passager mot facit (v2.2 QA):  npx tsx scripts/graph-audit.ts
 * De tre testområdena runt Karlstad (experiments/data/fixtures-osm-pbf) innehåller alla vägar, järnvägar och vattendrag med fulla OSM-taggar,
 * till skillnad från produktionstilesen. Här byggs samma TileWay-data som build_tiles.py (hazardindex) och passagerna som spelnätet kopplar ihop
 * jämförs med vad de faktiskt korsar. Skriver sammanfattning och en lista över varje kopplad passage. */
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { buildRegionGraph } from "../src/data/region-graph";
import type { TileWay } from "../src/data/tile-format";
import { decideWay } from "../src/geo/osm/overpass";
import { indexGraph } from "../src/geo/graph/graph";

const AREAS: Record<string, { c: { lat: number; lon: number }; r: number }> = {
  skutberget: { c: { lat: 59.3723, lon: 13.394 }, r: 2000 },
  "i2-skogen": { c: { lat: 59.41, lon: 13.466 }, r: 2000 },
  sormon: { c: { lat: 59.3785, lon: 13.354 }, r: 2000 },
};
const MAJOR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"]);
const RAIL = new Set(["rail", "light_rail", "tram", "subway", "narrow_gauge", "preserved", "funicular", "monorail"]);
const WATER = new Set(["river", "stream", "canal"]);
const PATHS = new Set(["path", "footway", "track", "cycleway", "service", "residential", "living_street", "unclassified", "pedestrian", "bridleway"]);
const PED = new Set(["footway", "path", "cycleway", "pedestrian"]);

interface El { id: number; nodes: number[]; geometry: { lat: number; lon: number }[]; tags: Record<string, string> }
const rows: string[] = [];
const total = { nodes: 0, ok: 0, risky: 0 };
const kinds: Record<string, number> = {};
for (const [name, area] of Object.entries(AREAS)) {
  const els = (JSON.parse(gunzipSync(readFileSync(`experiments/data/fixtures-osm-pbf/${name}.pbf.json.gz`)).toString()).elements as El[]).filter((e) => e.nodes && e.geometry);
  const hazardWays = els.filter((e) => MAJOR.has(e.tags.highway) || RAIL.has(e.tags.railway) || WATER.has(e.tags.waterway));
  const hazardNode = new Map<number, El[]>();
  for (const h of hazardWays) for (const n of h.nodes) (hazardNode.get(n) ?? hazardNode.set(n, []).get(n)!).push(h);
  const tileWays: TileWay[] = [];
  const SEV: Record<string, number> = { T: 3, r: 2, w: 1, t: 0 };
  const kindOf = (h: El) => (RAIL.has(h.tags.railway) ? "r" : WATER.has(h.tags.waterway) ? "w" : /^(secondary|tertiary)(_link)?$/.test(h.tags.highway) ? "t" : "T");
  const byId = new Map<string, El>();
  for (const e of els) {
    if (!PATHS.has(e.tags.highway) || (MAJOR.has(e.tags.highway) && !PATHS.has(e.tags.highway))) continue;
    byId.set(String(e.id), e);
    tileWays.push({ id: String(e.id), tags: e.tags, nodes: e.nodes.map((id, i) => ({ id: String(id), lat: e.geometry[i].lat, lon: e.geometry[i].lon })), hazard: e.nodes.map((n, i) => (hazardNode.has(n) ? i : -1)).filter((i) => i >= 0), hazardKinds: e.nodes.map((n, i) => (hazardNode.has(n) ? i : -1)).filter((i) => i >= 0).map((i) => hazardNode.get(e.nodes[i])!.map(kindOf).reduce((a, b) => (SEV[a] >= SEV[b] ? a : b))) });
  }
  const r = buildRegionGraph(tileWays.map((t) => ({ ...t, hazardKinds: undefined })), "walk", area.c, area.r);
  const rk = buildRegionGraph(tileWays, "walk", area.c, area.r);
  console.log(`   med hindertyp i tilen (förbättrad generering): ${rk.play.crossingNodes.size} kopplade passager i stället för ${r.play.crossingNodes.size}`);
  const strict = indexGraph(r.graph), play = indexGraph(r.play.graph);
  console.log(`\n## ${name}: ${tileWays.length} stigways, ${hazardWays.length} hinder-ways; strikt nät: ${r.stats.components} delar, störst ${r.stats.componentKm.toFixed(1)} km; spelnät: ${r.play.components} delar, störst ${r.play.componentKm.toFixed(1)} km, ${r.play.crossingNodes.size} kopplade passager`);
  void strict; void play;
  // Alla passager (före urval av störst del): räkna om utan komponentval via hazardnoder på gångvägar.
  const seen = new Set<string>();
  for (const w of tileWays) {
    if (!PED.has(w.tags.highway) || !decideWay(w.tags, "walk").ok) continue;
    for (const i of w.hazard) {
      const node = Number(w.nodes[i].id);
      const key = `${node}`;
      const interior = i > 0 && i < w.nodes.length - 1;
      const pedUse = tileWays.filter((x) => PED.has(x.tags.highway) && decideWay(x.tags, "walk").ok && x.hazard.some((j) => x.nodes[j].id === w.nodes[i].id)).length;
      const bridged = interior || pedUse >= 2;
      if (!bridged || seen.has(key + ":" + w.id)) continue;
      seen.add(key + ":" + w.id);
      const hz = hazardNode.get(node)!;
      const h = hz[0];
      const hk = MAJOR.has(h.tags.highway) ? `väg:${h.tags.highway}` : RAIL.has(h.tags.railway) ? `järnväg:${h.tags.railway}` : `vatten:${h.tags.waterway}`;
      const lvlW = `${w.tags.bridge ? "bro" : ""}${w.tags.tunnel ? "tunnel" : ""}${w.tags.layer ? "layer" + w.tags.layer : ""}`;
      const lvlH = `${h.tags.bridge ? "bro" : ""}${h.tags.tunnel ? "tunnel" : ""}${h.tags.layer ? "layer" + h.tags.layer : ""}`;
      const crossingTag = w.tags.footway === "crossing" || w.tags.crossing || w.tags.highway === "crossing";
      const faults: string[] = [];
      if (/motorway|trunk|primary/.test(hk)) faults.push("stor väg (motorväg/trunk/primary)");
      if (hk.startsWith("järnväg")) faults.push("järnväg");
      if (hk.startsWith("vatten")) faults.push("vattendrag");
      if (lvlW !== lvlH) faults.push(`nivåskillnad (stig ${lvlW || "mark"}, hinder ${lvlH || "mark"})`);
      if (w.tags.highway === "cycleway") faults.push("cykelväg");
      const hasCls = /secondary|tertiary/.test(hk);
      rows.push(`| ${name} | ${w.id} (${w.tags.highway}${crossingTag ? ", crossing-tagg" : ""}) | ${hk}${hz.length > 1 ? ` +${hz.length - 1}` : ""} | ${interior ? "mitt" : "två halvor"} | ${lvlW || "–"} / ${lvlH || "–"} | ${faults.length ? "RISK: " + faults.join("; ") : hasCls ? "ok (tertiary/secondary)" : "ok"} |`);
      total.nodes++;
      if (faults.length) { total.risky++; for (const f of faults) kinds[f.split(" (")[0]] = (kinds[f.split(" (")[0]] ?? 0) + 1; } else total.ok++;
    }
  }
}
console.log(`\n### Sammanfattning: ${total.nodes} kopplade gångpassager; ${total.ok} utan anmärkning; ${total.risky} med risk`);
console.log(Object.entries(kinds).map(([k, v]) => `- ${k}: ${v}`).join("\n"));
console.log("\n| område | stig | korsar | mappad | nivå (stig/hinder) | bedömning |\n|---|---|---|---|---|---|");
console.log(rows.join("\n"));
