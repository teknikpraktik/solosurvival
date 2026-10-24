/* Granskning av spelnätet i centrala Karlstad (produktionstiles):  npx tsx scripts/graph-audit-karlstad.ts
 *  1. För varje kopplad passage: gångavstånd mellan passagens två sidor i det strikta nätet (v2.1) respektive spelnätet (v2.2), jämfört med fågelvägen.
 *  2. Nivåfel: bro/tunnel-ways vars mittnoder delas med en annan väg (en bro ska bara fästa i ändarna).
 *  3. Gångvägar som korsar varandra geometriskt utan delad nod (ska vara oförbundna i båda näten). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { TileStore } from "../src/data/store";
import { buildRegionGraph } from "../src/data/region-graph";
import { networkDistances } from "../src/engine/pathfinding/astar";
import { haversineM, toLocal } from "../src/geo/geometry";
import { indexGraph, snapToGraph } from "../src/geo/graph/graph";

const root = path.join(process.cwd(), "public/data/v1/varmland");
const fsFetch = async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = new TileStore("/data/v1/varmland", fsFetch as never);
const C = { lat: 59.3793, lon: 13.5036 };
const { ways } = await store.loadAround(C, 2500);
const r = buildRegionGraph(ways, "walk", C, 2500, C);
const strict = indexGraph(r.graph);
const play = indexGraph({ ...r.play.graph, crossingNodes: [...r.play.crossingNodes] });
console.log(`strikt: ${r.stats.components} delar, störst ${r.stats.componentKm.toFixed(1)} km | spelnät: ${r.play.components} delar, störst ${r.play.componentKm.toFixed(1)} km | kopplade passager: ${r.play.crossingNodes.size}`);

// 1. Passager
const rows: { id: string; straight: number; strictD: number; playD: number }[] = [];
for (const id of play.crossingNodes) {
  const n = play.nodes.get(id)!;
  const inc = (play.adj.get(id) ?? []).slice(0, 4);
  if (inc.length < 2) continue;
  const a = play.nodes.get(inc[0].to)!, b = play.nodes.get(inc[1].to)!;
  const straight = haversineM(a, b);
  const dist = (g: ReturnType<typeof indexGraph>, p1: { lat: number; lon: number }, p2: { lat: number; lon: number }) => {
    const s1 = snapToGraph(g, p1), s2 = snapToGraph(g, p2);
    if (!s1 || !s2 || s1.offNetworkM > 3 || s2.offNetworkM > 3) return NaN;
    const d = networkDistances(g, s1, 3000);
    const e = g.edges.get(s2.edgeId)!;
    return Math.min((d.get(e.from) ?? Infinity) + s2.distM, e.oneway ? Infinity : (d.get(e.to) ?? Infinity) + (e.lengthM - s2.distM), s1.edgeId === s2.edgeId ? Math.abs(s1.distM - s2.distM) : Infinity);
  };
  void n;
  rows.push({ id, straight, strictD: dist(strict, a, b), playD: dist(play, a, b) });
}
const ok = rows.filter((x) => Number.isFinite(x.playD) && x.straight > 2);
const wasCut = ok.filter((x) => !Number.isFinite(x.strictD));
const longer = ok.filter((x) => Number.isFinite(x.strictD) && x.strictD > 3 * x.playD);
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
console.log(`\n### Passager (${ok.length} med mätbara sidor)\n- spelnätet: gångavstånd/fågelväg median ${med(ok.map((x) => x.playD / x.straight)).toFixed(2)}, 90:e percentilen ${[...ok.map((x) => x.playD / x.straight)].sort((x, y) => x - y)[Math.floor(ok.length * 0.9)].toFixed(2)}`);
console.log(`- strikta nätet: ${wasCut.length} (${Math.round((wasCut.length / ok.length) * 100)} %) var helt oförbundna i det valda nätet eller utanför det; ${longer.length} hade en omväg > 3 × (median omväg ${med(longer.map((x) => x.strictD)).toFixed(0)} m mot ${med(longer.map((x) => x.playD)).toFixed(0)} m)`);
console.log("| passage | fågelväg (m) | strikt nät (m) | spelnät (m) |\n|---|---|---|---|");
for (const x of [...ok].sort((a, b) => (Number.isFinite(b.strictD) ? b.strictD : 1e6) - (Number.isFinite(a.strictD) ? a.strictD : 1e6)).slice(0, 5)) console.log(`| ${x.id} | ${x.straight.toFixed(0)} | ${Number.isFinite(x.strictD) ? x.strictD.toFixed(0) : "oförbunden"} | ${x.playD.toFixed(0)} |`);

// 2. Nivåfel: bro/tunnel med mittnoder delade med annan väg
const nodeUse = new Map<string, number>();
for (const w of ways) for (const n of w.nodes) nodeUse.set(n.id, (nodeUse.get(n.id) ?? 0) + 1);
let bt = 0, btShared = 0;
const examples: string[] = [];
for (const w of ways) {
  if (!((w.tags.bridge && w.tags.bridge !== "no") || (w.tags.tunnel && w.tags.tunnel !== "no"))) continue;
  bt++;
  const mids = w.nodes.slice(1, -1).filter((n) => (nodeUse.get(n.id) ?? 0) > 1);
  if (mids.length) { btShared++; if (examples.length < 5) examples.push(`${w.id} (${w.tags.bridge ? "bro" : "tunnel"}, ${w.tags.highway}): ${mids.length} mittnod(er) delade`); }
}
console.log(`\n### Nivåfel\n- ${bt} bro/tunnel-ways i området; ${btShared} (${Math.round((btShared / Math.max(1, bt)) * 100)} %) har mittnoder som delas med en annan väg (kan vara ramper eller kartfel).`);
for (const e of examples) console.log(`  - ${e}`);

// 3. Korsande utan nod
function segIntersect(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, p4: { x: number; y: number }) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}
const edges = [...play.edges.values()];
let crossings = 0, merged = 0, tested = 0;
const origin = C;
const pts = new Map(edges.map((e) => [e.id, e.geometry.map((p) => toLocal(origin, p))]));
const bbox = new Map(edges.map((e) => { const q = pts.get(e.id)!; return [e.id, { x0: Math.min(...q.map((p) => p.x)), x1: Math.max(...q.map((p) => p.x)), y0: Math.min(...q.map((p) => p.y)), y1: Math.max(...q.map((p) => p.y)) }] as const; }));
for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
  const A = bbox.get(edges[i].id)!, B = bbox.get(edges[j].id)!;
  if (A.x1 < B.x0 || B.x1 < A.x0 || A.y1 < B.y0 || B.y1 < A.y0) continue;
  tested++;
  const pa = pts.get(edges[i].id)!, pb = pts.get(edges[j].id)!;
  let hit = false;
  for (let a = 0; a + 1 < pa.length && !hit; a++) for (let b = 0; b + 1 < pb.length && !hit; b++) if (segIntersect(pa[a], pa[a + 1], pb[b], pb[b + 1])) hit = true;
  if (!hit) continue;
  crossings++;
  const ei = edges[i], ej = edges[j];
  if (ei.from === ej.from || ei.from === ej.to || ei.to === ej.from || ei.to === ej.to) merged++;
}
console.log(`\n### Geometriska korsningar utan delad nod\n- ${crossings} par av kanter korsar varandra geometriskt (av ${tested} närliggande par), varav ${merged} delar ändå en ändnod (kors vid en nod, inte "falskt" ihopkopplade); övriga ${crossings - merged} är planskilda eller omärkta och förblir oförbundna i spelnätet (bygget förbinder bara delade OSM-nod-id).`);
