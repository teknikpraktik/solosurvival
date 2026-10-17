// npx tsx experiments/hybrid/verify-links.ts – oberoende kontroll av off-road-förbindelser mot EXAKT OSM-geometri (inte rastret).
import { AREAS } from "./areas";
import { areaCtx, hybridFor } from "./lib/experiment";
import { assembleRings, toLocalRing, type Ring, type XY } from "./lib/fixture";
import { pointInPolygonXY } from "./lib/geom2d";
import { DEFAULT_HYBRID, type HybridConfig } from "./lib/hybrid-graph";
import { toLocal } from "@/geo/geometry";

const CONFIGS: [string, HybridConfig][] = [
  ["B2-25 (verifierad terräng)", { ...DEFAULT_HYBRID, offroadFactor: 0.25, maxLinkM: 150 }],
  ["B3-25 (400 m)", { ...DEFAULT_HYBRID, offroadFactor: 0.25, maxLinkM: 400 }],
  ["B3-50-perm (stress, okänd mark tillåten)", { ...DEFAULT_HYBRID, offroadFactor: 0.5, maxLinkM: 400, terrain: "permissive" }],
];
const segCross = (a: XY, b: XY, c: XY, d: XY) => {
  const o = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};
let totalLinks = 0, totalBad = 0;
for (const a of AREAS) {
  const c = areaCtx(a.id, "mtb");
  const fx = c.ag.fx;
  const polys: { ring: Ring; kind: string; bb: [number, number, number, number] }[] = [];
  const addPoly = (ring: Ring, kind: string) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } polys.push({ ring, kind, bb: [x0, y0, x1, y1] }); };
  const lines: { line: Ring; kind: string }[] = [];
  const kindOf = (t: Record<string, string>) => (t.building ? "byggnad" : t.natural === "water" || t.waterway === "riverbank" || t.landuse === "reservoir" ? "vatten" : t.natural === "wetland" ? "våtmark" : null);
  for (const w of fx.ways) {
    const t = w.tags ?? {};
    if (w.geometry.some((p) => !p)) continue;
    const loc = toLocalRing(fx, w.geometry as never);
    const k = !t.highway ? kindOf(t) : null;
    if (k && w.nodes.length > 3 && w.nodes[0] === w.nodes[w.nodes.length - 1]) addPoly(loc, k);
    if (["fence", "wall", "hedge", "retaining_wall"].includes(t.barrier)) lines.push({ line: loc, kind: "barriär" });
    if (t.natural === "cliff") lines.push({ line: loc, kind: "klippa" });
    if (t.waterway === "river" || t.waterway === "canal") lines.push({ line: loc, kind: "å/kanal" });
    if (t.railway === "rail") lines.push({ line: loc, kind: "järnväg" });
  }
  for (const r of fx.relations) {
    const k = kindOf(r.tags);
    if (!k || !r.complete) continue;
    for (const ring of assembleRings(r.members, "outer").closed) addPoly(toLocalRing(fx, ring), k);
  }
  for (const [name, cfg] of CONFIGS) {
    const h = hybridFor(c, cfg);
    const bad: Record<string, number> = {};
    for (const l of h.links) {
      const A = toLocal(fx.origin, l.a), B = toLocal(fx.origin, l.b);
      const P: XY = [A.x, A.y], Q: XY = [B.x, B.y];
      const d = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
      let hit: string | null = null;
      for (let s = 0; s <= d && !hit; s += 0.25) {
        const pt: XY = [P[0] + ((Q[0] - P[0]) * s) / d, P[1] + ((Q[1] - P[1]) * s) / d];
        for (const poly of polys) if (pt[0] >= poly.bb[0] && pt[0] <= poly.bb[2] && pt[1] >= poly.bb[1] && pt[1] <= poly.bb[3] && pointInPolygonXY(pt, poly.ring)) { hit = poly.kind; break; }
      }
      if (!hit) for (const ln of lines) { for (let i = 0; i + 1 < ln.line.length && !hit; i++) if (segCross(P, Q, ln.line[i], ln.line[i + 1])) hit = ln.kind; if (hit) break; }
      if (hit) bad[hit] = (bad[hit] ?? 0) + 1;
    }
    const n = Object.values(bad).reduce((x, y) => x + y, 0);
    totalLinks += h.links.length; totalBad += n;
    console.log(`${a.name.padEnd(11)} ${name.padEnd(42)} ${String(h.links.length).padStart(5)} förbindelser, ${n} korsar exakt hinder ${n ? JSON.stringify(bad) : ""}  (kontrollerat mot ${polys.length} polygoner, ${lines.length} linjer)`);
  }
}
console.log(`\nSammanlagt ${totalBad} av ${totalLinks} förbindelser korsar ett hinder enligt exakt geometri.`);
