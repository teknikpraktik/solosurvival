import { toLocal, type LatLon } from "../geometry";
import { indexGraph } from "../graph/graph";
import type { SerializedGraph, TrailGraph } from "../graph/types";

export interface GraphStats {
  lengthKm: number;
  edges: number;
  nodes: number;
  junctions: number;
  components: number;
  /** Andel av total stiglängd som ligger i största sammanhängande komponent. */
  largestComponentShare: number;
  /** Andel av stiglängden som ligger i återvändsgrenar (rekursiv bladborttagning). */
  deadEndShare: number;
  deadEndEdges: number;
}

/** Kanter i återvändsgrenar: grenar som blir kvar efter att bladnoder rekursivt tagits bort. */
export function deadEndEdgeIds(g: TrailGraph): Set<string> {
  const deg = new Map<string, number>();
  for (const [n, a] of g.adj) deg.set(n, a.length);
  const removed = new Set<string>();
  const queue = [...deg].filter(([, d]) => d === 1).map(([n]) => n);
  while (queue.length) {
    const n = queue.pop()!;
    for (const a of g.adj.get(n) ?? []) {
      if (removed.has(a.edgeId)) continue;
      removed.add(a.edgeId);
      const d = (deg.get(a.to) ?? 0) - 1;
      deg.set(a.to, d);
      if (d === 1) queue.push(a.to);
    }
  }
  return removed;
}

export function graphStats(sg: SerializedGraph): GraphStats {
  const g = indexGraph(sg);
  let total = 0;
  for (const e of g.edges.values()) total += e.lengthM;
  const de = deadEndEdgeIds(g);
  let deLen = 0;
  for (const id of de) deLen += g.edges.get(id)!.lengthM;
  const comps = [...g.components].sort((a, b) => b.lengthM - a.lengthM);
  let junctions = 0;
  for (const c of g.components) junctions += c.junctionCount;
  return {
    lengthKm: total / 1000,
    edges: g.edges.size,
    nodes: [...g.adj].filter(([, a]) => a.length > 0).length,
    junctions,
    components: comps.length,
    largestComponentShare: total ? (comps[0]?.lengthM ?? 0) / total : 0,
    deadEndShare: total ? deLen / total : 0,
    deadEndEdges: de.size,
  };
}

/** Rutnätsindex över linjesegment i lokala meter, för närmaste-avstånd inom en tolerans. */
class SegmentIndex {
  private cells = new Map<string, number[]>();
  private segs: [number, number, number, number][] = [];
  constructor(private cell: number) {}
  add(a: { x: number; y: number }, b: { x: number; y: number }) {
    const i = this.segs.length;
    this.segs.push([a.x, a.y, b.x, b.y]);
    const x0 = Math.floor(Math.min(a.x, b.x) / this.cell), x1 = Math.floor(Math.max(a.x, b.x) / this.cell);
    const y0 = Math.floor(Math.min(a.y, b.y) / this.cell), y1 = Math.floor(Math.max(a.y, b.y) / this.cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = `${x},${y}`;
      (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(i);
    }
  }
  /** Närmaste avstånd (m) till något segment, begränsat till `max`. */
  nearest(px: number, py: number, max: number): number {
    let best = Infinity;
    const r = Math.ceil(max / this.cell);
    const cx = Math.floor(px / this.cell), cy = Math.floor(py / this.cell);
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) {
      for (const i of this.cells.get(`${x},${y}`) ?? []) {
        const [ax, ay, bx, by] = this.segs[i];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
        best = Math.min(best, Math.hypot(ax + dx * t - px, ay + dy * t - py));
      }
    }
    return best;
  }
}

function buildIndex(sg: SerializedGraph, origin: LatLon, cell: number): SegmentIndex {
  const idx = new SegmentIndex(cell);
  for (const e of sg.edges) for (let i = 0; i + 1 < e.geometry.length; i++) idx.add(toLocal(origin, e.geometry[i]), toLocal(origin, e.geometry[i + 1]));
  return idx;
}

export interface MatchResult {
  toleranceM: number;
  /** Längd (km) i A som har B inom tolerans, respektive saknar B. */
  aMatchedKm: number;
  aOnlyKm: number;
  /** Andel av A:s längd som matchas. */
  aCoverage: number;
  junctionsMatched: number;
  junctionsA: number;
  /** A-kanter vars båda ändnoder saknar en B-nod inom tolerans (potentiella skillnader i anslutning). */
  aOnlySegments: { id: string; lengthM: number; type: string }[];
}

/** Hur stor del av A:s stignät som finns i B (inom `toleranceM`), samplat var `stepM` meter. */
export function matchAgainst(a: SerializedGraph, b: SerializedGraph, toleranceM = 15, stepM = 5): MatchResult {
  const origin = a.nodes[0] ?? b.nodes[0];
  const bi = buildIndex(b, origin, Math.max(25, toleranceM * 2));
  let matched = 0, only = 0;
  const aOnly: MatchResult["aOnlySegments"] = [];
  for (const e of a.edges) {
    let len = 0, miss = 0;
    for (let i = 0; i + 1 < e.geometry.length; i++) {
      const p = toLocal(origin, e.geometry[i]), q = toLocal(origin, e.geometry[i + 1]);
      const l = Math.hypot(q.x - p.x, q.y - p.y);
      const n = Math.max(1, Math.round(l / stepM));
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n;
        const d = bi.nearest(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f, toleranceM);
        if (d <= toleranceM) matched += l / n; else { only += l / n; miss += l / n; }
      }
      len += l;
    }
    if (len > 0 && miss / len > 0.5) aOnly.push({ id: e.id, lengthM: len, type: e.type });
  }
  const ga = indexGraph(a), gb = indexGraph(b);
  const bJ = [...gb.adj].filter(([, x]) => x.length >= 3).map(([id]) => toLocal(origin, gb.nodes.get(id)!));
  let jm = 0, ja = 0;
  for (const [id, x] of ga.adj) {
    if (x.length < 3) continue;
    ja++;
    const p = toLocal(origin, ga.nodes.get(id)!);
    if (bJ.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= toleranceM)) jm++;
  }
  const total = matched + only;
  return { toleranceM, aMatchedKm: matched / 1000, aOnlyKm: only / 1000, aCoverage: total ? matched / total : 0, junctionsMatched: jm, junctionsA: ja, aOnlySegments: aOnly };
}

export interface AttributeCoverage {
  ways: number;
  /** Andel ways (och längd) som har respektive attribut. */
  share: Record<string, number>;
  lengthShare: Record<string, number>;
}

/** Täckning av tillträdes- och cykelrelevanta attribut över råa ways (tags + längd). */
export function attributeCoverage(ways: { tags?: Record<string, string>; lengthM: number }[], keys: string[]): AttributeCoverage {
  const share: Record<string, number> = {}, lengthShare: Record<string, number> = {};
  const total = ways.reduce((s, w) => s + w.lengthM, 0);
  for (const k of keys) {
    const has = ways.filter((w) => w.tags && k in w.tags);
    share[k] = ways.length ? has.length / ways.length : 0;
    lengthShare[k] = total ? has.reduce((s, w) => s + w.lengthM, 0) / total : 0;
  }
  return { ways: ways.length, share, lengthShare };
}
