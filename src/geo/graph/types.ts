import type { LatLon } from "../geometry";

export type PathType = "path" | "footway" | "track" | "cycleway" | "service" | "residential" | "other";

export interface GraphNode extends LatLon {
  id: string;
}

/** Kompakt, serialiserbar kant (så som den levereras av servern). */
export interface RawEdge {
  id: string;
  from: string;
  to: string;
  geometry: LatLon[];
  type: PathType;
  /** Sant om kanten bara får färdas från `from` till `to`. */
  oneway?: boolean;
  /** Bike: easy to ride (paved/gravel road, bike lane, good track). Zombies ignore this; Mission tracks prefer it. */
  easy?: boolean;
  /** Edge lies on a bridge or in a tunnel (OSM bridge/tunnel). Used to avoid snapping the player to the wrong level. */
  grade?: "bridge" | "tunnel";
  /** Edge ends at a mapped crossing of a major road/railway (zombies may use it; Survival extraction and player routes avoid it). */
  crossing?: boolean;
}

export interface SerializedGraph {
  graphVersion: string;
  source: string;
  nodes: GraphNode[];
  edges: RawEdge[];
  /** Noder där en kartlagd gångpassage över större väg/järnväg är sammankopplad (se region-graph). */
  crossingNodes?: string[];
}

export interface GraphEdge extends RawEdge {
  cumM: number[];
  lengthM: number;
  component: number;
}

/** dir = 1: färd från `from` till `to`. dir = -1: omvänt. */
export type Dir = 1 | -1;

export interface Adjacent {
  edgeId: string;
  to: string;
  dir: Dir;
  lengthM: number;
}

export interface ComponentInfo {
  id: number;
  lengthM: number;
  nodeIds: string[];
  junctionCount: number;
}

export interface TrailGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  adj: Map<string, Adjacent[]>;
  components: ComponentInfo[];
  crossingNodes: Set<string>;
}

export interface EdgePos {
  edgeId: string;
  distM: number;
}
