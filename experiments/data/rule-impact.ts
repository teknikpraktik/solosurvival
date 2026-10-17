// Analys: hur Etapp 3-reglerna (decideWay + hazard-delning) påverkar stignätet i de tre testområdena.
// Kör: npx tsx experiments/data/rule-impact.ts > experiments/data/results-rule-impact.md
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import type { Activity } from "@/config/activities";
import { buildGraph, type RawWay } from "@/geo/graph/build";
import { indexGraph } from "@/geo/graph/graph";
import { cumulativeLengths, type LatLon } from "@/geo/geometry";
import { decideWay } from "@/geo/osm/overpass";
import { decideWay as decideOld } from "./lib/decide-way-2.5";
import { buildRegionGraph } from "@/data/region-graph";
import type { TileWay } from "@/data/tile-format";
import { AREAS } from "./areas";

interface El { type: string; id: number; nodes: number[]; geometry: ({ lat: number; lon: number } | null)[]; tags?: Record<string, string> }
const PATH = new Set(["path", "footway", "track", "cycleway", "service", "residential", "living_street", "unclassified", "pedestrian", "bridleway"]);
const MAJOR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"]);
const RAIL = new Set(["rail", "light_rail", "tram", "subway", "narrow_gauge", "preserved", "funicular", "monorail"]);
const WATER = new Set(["river", "stream", "canal"]);
const len = (w: El) => cumulativeLengths(w.geometry as LatLon[]).at(-1)!;
const km = (m: number) => (m / 1000).toFixed(1);
const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : "0") + " %";
const ACTS: Activity[] = ["walk", "run", "mtb"];

const out: string[] = [];
const P = (s = "") => out.push(s);
P("# Regelpåverkan Etapp 3 (testområden Skutberget, I2-skogen, Sörmon)");
P("");
P("Data: `fixtures-osm-pbf` (OSM-länsextrakt). Längder i km längs hela ways som rör rutan (ca 3×3 km). Jämför Etapp 2.5-regler (`lib/decide-way-2.5.ts`) med nuvarande `decideWay` och hazard-delning.");

const totals: Record<Activity, { all: number; oldEx: number; newEx: number; reasons: Record<string, number>; newOnly: Record<string, number> }> = {
  walk: { all: 0, oldEx: 0, newEx: 0, reasons: {}, newOnly: {} }, run: { all: 0, oldEx: 0, newEx: 0, reasons: {}, newOnly: {} }, mtb: { all: 0, oldEx: 0, newEx: 0, reasons: {}, newOnly: {} },
};
const conn: string[] = [];
const hazKinds: Record<string, number> = {};
const hazExamples: string[] = [];

for (const area of AREAS) {
  const els = (JSON.parse(gunzipSync(readFileSync(path.join(import.meta.dirname, "fixtures-osm-pbf", `${area.id}.pbf.json.gz`))).toString()).elements as El[]).filter((e) => e.type === "way" && !e.geometry.some((p) => !p));
  const nodeKind = new Map<string, string>();
  for (const w of els) {
    const t = w.tags ?? {};
    const k = MAJOR.has(t.highway) ? `väg:${t.highway.replace("_link", "")}` : RAIL.has(t.railway) ? "järnväg" : WATER.has(t.waterway) ? `vatten:${t.waterway}` : null;
    if (k) for (const n of w.nodes) if (!nodeKind.has(String(n))) nodeKind.set(String(n), k);
  }
  const paths = els.filter((w) => PATH.has(w.tags?.highway ?? ""));
  const tileWays: TileWay[] = paths.map((w) => {
    const nodes = w.nodes.map((id, i) => ({ id: String(id), lat: w.geometry[i]!.lat, lon: w.geometry[i]!.lon }));
    return { id: String(w.id), tags: w.tags ?? {}, nodes, hazard: nodes.flatMap((n, i) => (nodeKind.has(n.id) ? [i] : [])) };
  });
  const center = { lat: (area.bbox[0] + area.bbox[2]) / 2, lon: (area.bbox[1] + area.bbox[3]) / 2 };
  for (const act of ACTS) {
    const T = totals[act];
    for (const w of paths) {
      const l = len(w);
      T.all += l;
      const o = decideOld(w.tags, act), n = decideWay(w.tags, act);
      if (!o.ok) T.oldEx += l;
      if (!n.ok) { T.newEx += l; T.reasons[n.reason] = (T.reasons[n.reason] ?? 0) + l; if (o.ok) T.newOnly[n.reason] = (T.newOnly[n.reason] ?? 0) + l; }
    }
    // Grafer: gamla regler utan delning, nya regler utan delning, nya regler med delning.
    const comps = (decide: typeof decideWay) => {
      const raw: RawWay[] = [];
      for (const w of paths) {
        const d = decide(w.tags, act);
        if (!d.ok) continue;
        let nodes = w.nodes.map((id, i) => ({ id: String(id), lat: w.geometry[i]!.lat, lon: w.geometry[i]!.lon }));
        if ("reverse" in d && d.reverse) nodes = nodes.reverse();
        raw.push({ id: String(w.id), nodes, type: "path", oneway: "oneway" in d ? d.oneway : undefined });
      }
      const g = indexGraph(buildGraph(raw));
      const sizes = g.components.map((c) => c.lengthM).sort((a, b) => b - a);
      const total = sizes.reduce((a, b) => a + b, 0);
      return { n: sizes.length, total, largest: sizes[0] ?? 0, over1km: sizes.filter((s) => s >= 1000).length };
    };
    const a = comps(decideOld as unknown as typeof decideWay), b = comps(decideWay);
    const rg = buildRegionGraph(tileWays, act, center, 5000);
    // hazard-noder som blev stubbar, per typ
    for (const id of rg.hazardNodes) { const orig = id.split("!")[0]; const k = nodeKind.get(orig) ?? "?"; hazKinds[`${act}:${k}`] = (hazKinds[`${act}:${k}`] ?? 0) + 1; }
    conn.push(`| ${area.id} | ${act} | ${a.n} / ${km(a.total)} / ${km(a.largest)} / ${pct(a.largest, a.total)} | ${b.n} / ${km(b.total)} / ${km(b.largest)} / ${pct(b.largest, b.total)} | ${rg.stats.components} / ${rg.stats.networkKm.toFixed(1)} / ${km(rg.stats.componentKm * 1000)} / ${pct(rg.stats.componentKm, rg.stats.networkKm)} | ${rg.stats.hazardStubs} |`);
  }
  void hazExamples;
}

P(""); P("## 1. Andel utesluten stig per aktivitet (andel av längden på path/footway/track/cycleway/service/residential/living_street/unclassified/pedestrian/bridleway)"); P("");
P("| Aktivitet | Totalt km | Uteslutet 2.5 | Uteslutet nu | Tillkommit sedan 2.5 |"); P("|---|---|---|---|---|");
for (const act of ACTS) { const T = totals[act]; P(`| ${act} | ${km(T.all)} | ${pct(T.oldEx, T.all)} | ${pct(T.newEx, T.all)} | ${pct(T.newEx - T.oldEx, T.all)} |`); }
P(""); P("## 2. Orsaker (andel av total längd; \"nya\" = uteslutna nu men inte med 2.5-reglerna)"); P("");
for (const act of ACTS) {
  const T = totals[act];
  P(`**${act}**`); P("");
  P("| Regel | Uteslutet km | Andel | Varav nytt sedan 2.5 |"); P("|---|---|---|---|");
  for (const [r, l] of Object.entries(T.reasons).sort((a, b) => b[1] - a[1])) P(`| ${r} | ${km(l)} | ${pct(l, T.all)} | ${km(T.newOnly[r] ?? 0)} km |`);
  P("");
}
P("## 3. Sammanhängande delar (antal komponenter / total km / största km / största andel)"); P("");
P("| Område | Aktivitet | Gamla regler, ingen delning | Nya regler, ingen delning | Nya regler + hazard-delning (spelets nät) | Hazard-stubbar |"); P("|---|---|---|---|---|---|");
for (const c of conn) P(c);
P(""); P("## 4. Vad delningen stoppar (hazard-stubbar per typ som stigen möter)"); P("");
P("| Aktivitet:typ | Antal stubbar |"); P("|---|---|");
for (const [k, v] of Object.entries(hazKinds).sort()) P(`| ${k} | ${v} |`);
console.log(out.join("\n"));
