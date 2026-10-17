import type { Activity } from "@/config/activities";
import { indexGraph, serializeGraph } from "@/geo/graph/graph";
import { overpassToGraph } from "@/geo/osm/overpass";
import { pointInPolygon } from "@/geo/geometry";
import type { SerializedGraph, TrailGraph } from "@/geo/graph/types";
import { asOverpass, loadFixture, type Fixture } from "./fixture";
import type { AreaDef } from "../areas";

export interface AreaGraph {
  fx: Fixture;
  activity: Activity;
  /** Endast spelarens stignät (största sammanhängande komponenten inom rutan). */
  trail: SerializedGraph;
  trailIndexed: TrailGraph;
  dropped: { outsideBox: number; smallComponents: number };
}

/**
 * Stignät för ett område och en aktivitet: OSM-filtrering enligt produktionskoden (`decideWay`),
 * klippt till rutan och reducerat till största sammanhängande komponent.
 */
export function loadAreaGraph(id: AreaDef["id"], activity: Activity): AreaGraph {
  const fx = loadFixture(id);
  const raw = overpassToGraph(asOverpass(fx), activity);
  const [s, w, n, e] = fx.area.bbox;
  const ring: [number, number][] = [[w, s], [e, s], [e, n], [w, n]];
  const inBox = raw.edges.filter((ed) => {
    const mid = ed.geometry[Math.floor(ed.geometry.length / 2)];
    return pointInPolygon(mid, ring);
  });
  const used = new Set(inBox.flatMap((ed) => [ed.from, ed.to]));
  const clipped: SerializedGraph = { ...raw, nodes: raw.nodes.filter((x) => used.has(x.id)), edges: inBox };
  const idx = indexGraph(clipped);
  const biggest = [...idx.components].sort((a, b) => b.lengthM - a.lengthM)[0];
  const edges = clipped.edges.filter((ed) => idx.edges.get(ed.id)?.component === biggest.id);
  const keep = new Set(edges.flatMap((ed) => [ed.from, ed.to]));
  const trail: SerializedGraph = { ...clipped, nodes: clipped.nodes.filter((x) => keep.has(x.id)), edges };
  return {
    fx,
    activity,
    trail,
    trailIndexed: indexGraph(trail),
    dropped: { outsideBox: raw.edges.length - inBox.length, smallComponents: inBox.length - edges.length },
  };
}

export { serializeGraph };
