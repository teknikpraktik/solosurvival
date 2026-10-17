import { MinHeap } from "@/engine/core/heap";
import { pointAlong, toLocal, type LatLon } from "@/geo/geometry";
import { indexGraph } from "@/geo/graph/graph";
import type { RawEdge, SerializedGraph, TrailGraph } from "@/geo/graph/types";
import type { Fixture } from "./fixture";
import { blockersFor } from "./blockers";
import { C, classAt, type TerrainRaster } from "./raster";

export interface HybridConfig {
  /** Off-road-hastighet som andel av stighastigheten. */
  offroadFactor: number;
  /** Längsta tillåtna off-road-förbindelse (m). */
  maxLinkM: number;
  /** "verified": bara kartlagd skog/öppen mark. "permissive": även okänd mark. */
  terrain: "verified" | "permissive";
  /** Avstånd mellan ankarpunkter längs stigar (m). */
  anchorSpacingM: number;
  /** Förbindelsen måste spara minst så här mycket tid mot bästa stigväg (kvot stigtid / off-road-tid). */
  minBenefit: number;
  /** Max antal förbindelser per ankarpunkt (de mest fördelaktiga behålls). */
  maxLinksPerAnchor: number;
  /** Sampelavstånd vid terrängkontroll (m). */
  sampleStepM: number;
  /** Om > 0: ta bort förbindelser vars båda ändar ligger inom detta avstånd från en bättre förbindelses ändar (icke-maximal undertryckning). */
  dedupeM?: number;
}

export const DEFAULT_HYBRID: HybridConfig = {
  offroadFactor: 0.25,
  maxLinkM: 100,
  terrain: "verified",
  anchorSpacingM: 40,
  minBenefit: 1.25,
  maxLinksPerAnchor: 3,
  sampleStepM: 1,
};

export interface HybridStats {
  anchors: number;
  candidatePairs: number;
  rejectedNoBenefit: number;
  rejectedTerrain: number;
  rejectedByClass: Record<string, number>;
  links: number;
  linkLengthM: { mean: number; p50: number; p90: number; max: number };
  trailEdges: number;
  buildMs: number;
  bytesJson: number;
}

export interface HybridResult {
  graph: SerializedGraph;
  indexed: TrailGraph;
  stats: HybridStats;
  /** Förbindelser i lat/lon, för visualisering och analys. */
  links: { id: string; a: LatLon; b: LatLon; lengthM: number; benefit: number }[];
}

interface Anchor {
  id: string;
  edgeId: string;
  distM: number;
  ll: LatLon;
  x: number;
  y: number;
}

const PASSABLE_VERIFIED = new Set<number>([C.FOREST, C.OPEN]);
const PASSABLE_PERMISSIVE = new Set<number>([C.FOREST, C.OPEN, C.UNKNOWN]);

/** Delar upp en polylinje vid givna avstånd längs den. */
function slice(geometry: LatLon[], cum: number[], from: number, to: number): LatLon[] {
  const pts: LatLon[] = [pointAlong(geometry, cum, from)];
  for (let i = 1; i < geometry.length - 1; i++) if (cum[i] > from + 1e-6 && cum[i] < to - 1e-6) pts.push(geometry[i]);
  pts.push(pointAlong(geometry, cum, to));
  return pts;
}

/**
 * Bygger en hybridgraf: stignätet delas vid ankarpunkter och kompletteras med raka off-road-förbindelser
 * mellan ankarpunkter. En förbindelse accepteras bara om (1) längden ≤ maxLinkM, (2) hela sträckan ligger i
 * godkänd terräng enligt rastret, och (3) den sparar tid mot bästa stigväg. Förbindelser har alltid stigar i båda
 * ändar, och A* tillåter aldrig två förbindelser i följd, så off-road-rörelse är aldrig längre än en förbindelse.
 */
export function buildHybridGraph(trail: SerializedGraph, fx: Fixture, raster: TerrainRaster, cfg: HybridConfig): HybridResult {
  const t0 = performance.now();
  const base = indexGraph(trail);
  const blockers = blockersFor(raster);
  const inside = (a: { x: number; y: number }) => a.x >= 0 && a.y >= 0 && a.x <= fx.widthM && a.y <= fx.heightM;
  const passable = cfg.terrain === "verified" ? PASSABLE_VERIFIED : PASSABLE_PERMISSIVE;
  const xy = (p: LatLon) => toLocal(fx.origin, p);

  // 1. Ankarpunkter och delade stigkanter.
  const anchors: Anchor[] = [];
  const nodeAnchor = new Map<string, number>();
  const idxOfNode = (nid: string) => {
    let i = nodeAnchor.get(nid);
    if (i === undefined) {
      const n = base.nodes.get(nid)!;
      const l = xy(n);
      i = anchors.length;
      anchors.push({ id: nid, edgeId: "", distM: 0, ll: n, x: l.x, y: l.y });
      nodeAnchor.set(nid, i);
    }
    return i;
  };
  const edgeAnchors = new Map<string, { ids: number[]; dists: number[] }>();
  const asegs: { a: number; b: number; len: number }[] = [];
  for (const e of base.edges.values()) {
    const n = Math.max(1, Math.ceil(e.lengthM / cfg.anchorSpacingM));
    const ids: number[] = [idxOfNode(e.from)];
    const dists = [0];
    for (let i = 1; i < n; i++) {
      const d = (e.lengthM * i) / n;
      const ll = pointAlong(e.geometry, e.cumM, d);
      const l = xy(ll);
      ids.push(anchors.length);
      anchors.push({ id: `a:${e.id}:${i}`, edgeId: e.id, distM: d, ll, x: l.x, y: l.y });
      dists.push(d);
    }
    ids.push(idxOfNode(e.to));
    dists.push(e.lengthM);
    edgeAnchors.set(e.id, { ids, dists });
    for (let i = 0; i < ids.length - 1; i++) asegs.push({ a: ids[i], b: ids[i + 1], len: dists[i + 1] - dists[i] });
  }

  // 2. Närhetsindex (rutnät) och angränsande ankarpunkter längs stigar.
  const cellSize = Math.max(cfg.maxLinkM, 50);
  const grid = new Map<string, number[]>();
  const cellOf = (x: number, y: number) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
  anchors.forEach((a, i) => {
    const k = cellOf(a.x, a.y);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  const nbrs: { to: number; len: number }[][] = anchors.map(() => []);
  for (const s of asegs) {
    nbrs[s.a].push({ to: s.b, len: s.len });
    nbrs[s.b].push({ to: s.a, len: s.len }); // oriktat räcker för nyttobedömning
  }

  // 3. Kandidater, nyttotest och terrängkontroll.
  const bound = (cfg.maxLinkM / cfg.offroadFactor) * cfg.minBenefit * 1.05;
  const stats: HybridStats = {
    anchors: anchors.length, candidatePairs: 0, rejectedNoBenefit: 0, rejectedTerrain: 0, rejectedByClass: {},
    links: 0, linkLengthM: { mean: 0, p50: 0, p90: 0, max: 0 }, trailEdges: 0, buildMs: 0, bytesJson: 0,
  };
  type Cand = { a: number; b: number; d: number; benefit: number };
  const accepted: Cand[] = [];
  const dist = new Float64Array(anchors.length);
  for (let ai = 0; ai < anchors.length; ai++) {
    // Begränsad Dijkstra över stigarna från ai.
    dist.fill(Infinity);
    dist[ai] = 0;
    const heap = new MinHeap<number>();
    heap.push(0, ai);
    const seen: number[] = [];
    while (heap.size) {
      const { k, v } = heap.pop()!;
      if (k > dist[v]) continue;
      seen.push(v);
      for (const nb of nbrs[v]) {
        const nd = k + nb.len;
        if (nd < dist[nb.to] && nd <= bound) {
          dist[nb.to] = nd;
          heap.push(nd, nb.to);
        }
      }
    }
    const A = anchors[ai];
    const cx = Math.floor(A.x / cellSize), cy = Math.floor(A.y / cellSize);
    const cands: Cand[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const bi of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (bi <= ai) continue;
          const B = anchors[bi];
          const d = Math.hypot(A.x - B.x, A.y - B.y);
          if (d > cfg.maxLinkM || d < 15) continue;
          // Data är fullständig bara inom rutan: förbindelser får aldrig ligga utanför den (stigar kan sticka ut över kanten).
          if (!inside(A) || !inside(B)) continue;
          stats.candidatePairs++;
          // Nytta: stigväg i meter-ekvivalenter mot off-road-tid (d / faktor).
          const trailDist = dist[bi];
          const benefit = trailDist / (d / cfg.offroadFactor);
          if (benefit < cfg.minBenefit) { stats.rejectedNoBenefit++; continue; }
          // Terrängkontroll längs raka linjen (de första/sista 8 m ligger i stigkorridoren och hoppas över).
          let ok = true;
          let badClass = "";
          for (let s = 8; s <= d - 8 && ok; s += cfg.sampleStepM) {
            const f = s / d;
            const cls = classAt(raster, A.x + (B.x - A.x) * f, A.y + (B.y - A.y) * f);
            if (!passable.has(cls)) { ok = false; badClass = String(cls); }
          }
          if (!ok) { stats.rejectedTerrain++; stats.rejectedByClass[badClass] = (stats.rejectedByClass[badClass] ?? 0) + 1; continue; }
          cands.push({ a: ai, b: bi, d, benefit });
        }
    cands.sort((x, y) => y.benefit - x.benefit);
    // Exakt kontroll mot kända hinder längs HELA förbindelsen (inga undantag vid ändarna, ingen rasterupplösning).
    // Görs lazy, bara för de bäst rankade, vilket ger samma resultat som att kontrollera alla först.
    let taken = 0;
    for (const c of cands) {
      if (taken >= cfg.maxLinksPerAnchor) break;
      if (blockers.segmentBlocked([A.x, A.y], [anchors[c.b].x, anchors[c.b].y])) { stats.rejectedTerrain++; stats.rejectedByClass.hinder = (stats.rejectedByClass.hinder ?? 0) + 1; continue; }
      accepted.push(c);
      taken++;
    }
  }

  // 4. Gles ut så att ingen ankarpunkt får fler än maxLinksPerAnchor även som mål.
  const deg = new Uint16Array(anchors.length);
  const links: Cand[] = [];
  for (const c of accepted.sort((x, y) => y.benefit - x.benefit)) {
    if (deg[c.a] >= cfg.maxLinksPerAnchor || deg[c.b] >= cfg.maxLinksPerAnchor) continue;
    deg[c.a]++; deg[c.b]++;
    links.push(c);
  }

  if (cfg.dedupeM && cfg.dedupeM > 0) {
    const D = cfg.dedupeM;
    const near = (p: Anchor, q: Anchor) => Math.hypot(p.x - q.x, p.y - q.y) < D;
    const kept: Cand[] = [];
    for (const c of links.sort((x, y) => y.benefit - x.benefit)) {
      const A = anchors[c.a], B = anchors[c.b];
      if (!kept.some((k) => (near(anchors[k.a], A) && near(anchors[k.b], B)) || (near(anchors[k.a], B) && near(anchors[k.b], A)))) kept.push(c);
    }
    links.length = 0;
    links.push(...kept);
  }

  // 5. Sätt ihop grafen: stigar delas bara vid ankarpunkter som faktiskt får en förbindelse.
  const usedAnchor = new Set<number>();
  for (const l of links) { usedAnchor.add(l.a); usedAnchor.add(l.b); }
  const edges: RawEdge[] = [];
  for (const e of base.edges.values()) {
    const { ids, dists } = edgeAnchors.get(e.id)!;
    const cut = [0];
    for (let i = 1; i < ids.length - 1; i++) if (usedAnchor.has(ids[i])) cut.push(i);
    cut.push(ids.length - 1);
    for (let k = 0; k < cut.length - 1; k++) {
      const a0 = cut[k], a1 = cut[k + 1];
      edges.push({
        id: cut.length === 2 ? e.id : `${e.id}#${k}`,
        from: anchors[ids[a0]].id,
        to: anchors[ids[a1]].id,
        geometry: cut.length === 2 ? e.geometry : slice(e.geometry, e.cumM, dists[a0], dists[a1]),
        type: e.type,
        oneway: e.oneway,
      });
    }
  }
  stats.trailEdges = edges.length;
  for (const l of links) {
    const A = anchors[l.a], B = anchors[l.b];
    edges.push({
      id: `ofr:${A.id}~${B.id}`, from: A.id, to: B.id, geometry: [A.ll, B.ll], type: "other",
      offroad: true, speedFactor: cfg.offroadFactor,
    });
  }
  const nodes = [...base.nodes.values()].map((n) => ({ id: n.id, lat: n.lat, lon: n.lon }));
  for (const i of usedAnchor) {
    const a = anchors[i];
    if (a.edgeId) nodes.push({ id: a.id, lat: a.ll.lat, lon: a.ll.lon, virtual: true } as (typeof nodes)[number]);
  }
  const graph: SerializedGraph = { graphVersion: "1.0-hybrid", source: "experiment", nodes, edges };
  const indexed = indexGraph(graph);

  const lens = links.map((l) => l.d).sort((a, b) => a - b);
  stats.links = links.length;
  if (lens.length) stats.linkLengthM = { mean: lens.reduce((a, b) => a + b, 0) / lens.length, p50: lens[Math.floor(lens.length / 2)], p90: lens[Math.floor(lens.length * 0.9)], max: lens[lens.length - 1] };
  stats.bytesJson = JSON.stringify(graph).length;
  stats.buildMs = performance.now() - t0;
  return { graph, indexed, stats, links: links.map((l) => ({ id: `${anchors[l.a].id}~${anchors[l.b].id}`, a: anchors[l.a].ll, b: anchors[l.b].ll, lengthM: l.d, benefit: l.benefit })) };
}
