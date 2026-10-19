import { GRAPH_VERSION } from "./graph";
import type { GraphNode, PathType, RawEdge, SerializedGraph } from "./types";
import { cumulativeLengths } from "../geometry";

export interface RawWayNode {
  id: string;
  lat: number;
  lon: number;
}

export interface RawWay {
  id: string;
  nodes: RawWayNode[];
  type: PathType;
  oneway?: boolean;
  /** Bike: easy to ride (see isEasyBikeWay). */
  easy?: boolean;
}

/**
 * Bygger en graf av råa linjer. Noder delas bara mellan linjer som faktiskt refererar till samma nod-id,
 * så geometriska korsningar utan förbindelse (broar, tunnlar) blir aldrig falska korsningar (PRD 4.3).
 */
export function buildGraph(ways: RawWay[], source = "openstreetmap"): SerializedGraph {
  const uses = new Map<string, number>();
  for (const w of ways) {
    const seen = new Set<string>();
    w.nodes.forEach((n, i) => {
      // Ändpunkter och noder som återkommer i samma linje räknas som skärningar.
      const isEnd = i === 0 || i === w.nodes.length - 1;
      uses.set(n.id, (uses.get(n.id) ?? 0) + (seen.has(n.id) || isEnd ? 2 : 1));
      seen.add(n.id);
    });
  }

  const nodes = new Map<string, GraphNode>();
  const edges: RawEdge[] = [];
  for (const w of ways) {
    if (w.nodes.length < 2) continue;
    let start = 0;
    let idx = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      const isSplit = i === w.nodes.length - 1 || (uses.get(w.nodes[i].id) ?? 0) >= 2;
      if (!isSplit) continue;
      const slice = w.nodes.slice(start, i + 1);
      const geometry = slice.map((n) => ({ lat: n.lat, lon: n.lon }));
      const len = cumulativeLengths(geometry).at(-1)!;
      if (len > 0.5) {
        for (const n of [slice[0], slice[slice.length - 1]]) {
          if (!nodes.has(n.id)) nodes.set(n.id, { id: n.id, lat: n.lat, lon: n.lon });
        }
        edges.push({
          id: `${w.id}:${idx}`,
          from: slice[0].id,
          to: slice[slice.length - 1].id,
          geometry,
          type: w.type,
          oneway: w.oneway || undefined,
          easy: w.easy || undefined,
        });
        idx++;
      }
      start = i;
    }
  }
  return { graphVersion: GRAPH_VERSION, source, nodes: [...nodes.values()], edges };
}
