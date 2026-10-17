import { MinHeap } from "@/engine/core/heap";
import type { TrailGraph } from "@/geo/graph/types";

export interface NetworkAnalysis {
  /** Kanter i återvändsgrenar. */
  deadEndEdges: Set<string>;
  /** Avstånd (m) från en nod in i en återvändsgren, 0 för noder i huvudnätet (eller om hela nätet är ett träd). */
  deadEndDepthM: Map<string, number>;
}

/** Rekursiv bladborttagning ger återvändsgrenar; djupet är avståndet till närmaste nod i huvudnätet. */
export function analyzeNetwork(g: TrailGraph): NetworkAnalysis {
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
  const core = new Set<string>();
  for (const e of g.edges.values()) if (!removed.has(e.id)) { core.add(e.from); core.add(e.to); }
  const depth = new Map<string, number>();
  if (core.size === 0) return { deadEndEdges: removed, deadEndDepthM: depth };
  const heap = new MinHeap<string>();
  for (const n of core) { depth.set(n, 0); heap.push(0, n); }
  while (heap.size) {
    const { k, v } = heap.pop()!;
    if (k > (depth.get(v) ?? Infinity)) continue;
    for (const a of g.adj.get(v) ?? []) {
      if (!removed.has(a.edgeId)) continue;
      const nd = k + a.lengthM;
      if (nd < (depth.get(a.to) ?? Infinity)) { depth.set(a.to, nd); heap.push(nd, a.to); }
    }
  }
  return { deadEndEdges: removed, deadEndDepthM: depth };
}

/** Antal utgångar från en nod som leder in i huvudnätet (inte in i återvändsgrenar). */
export function coreExits(g: TrailGraph, nodeId: string, an: NetworkAnalysis): number {
  return (g.adj.get(nodeId) ?? []).filter((a) => !an.deadEndEdges.has(a.edgeId)).length;
}
