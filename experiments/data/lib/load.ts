import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import type { Activity } from "@/config/activities";
import { indexGraph } from "@/geo/graph/graph";
import { pointInPolygon, cumulativeLengths, type LatLon } from "@/geo/geometry";
import type { SerializedGraph } from "@/geo/graph/types";
import { overpassToGraph, decideWay, type OverpassResponse } from "@/geo/osm/overpass";
import { AREAS, type AreaDef } from "../areas";

export type OsmSource = "api" | "pbf";
const dir = (s: OsmSource) => path.join(import.meta.dirname, "..", s === "api" ? "fixtures-osm-api" : "fixtures-osm-pbf");

export interface RawWayElement {
  type: "way";
  id: number;
  nodes: number[];
  geometry: ({ lat: number; lon: number } | null)[];
  tags?: Record<string, string>;
}

export function loadWays(area: AreaDef["id"], source: OsmSource): RawWayElement[] {
  const file = path.join(dir(source), `${area}.${source === "api" ? "osm" : "pbf"}.json.gz`);
  const els = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")).elements as { type: string }[];
  return els.filter((e): e is RawWayElement => e.type === "way" && !!(e as RawWayElement).tags?.highway);
}

export interface AreaGraphs {
  area: AreaDef;
  source: OsmSource;
  activity: Activity;
  /** Alla filtrerade stigar inom rutan (kan ha flera komponenter). */
  all: SerializedGraph;
  /** Endast största sammanhängande komponent. */
  main: SerializedGraph;
  /** Noder där inkluderade stigar möter uteslutna större vägar (korsningar med biltrafik). */
  hazardNodes: Set<string>;
}

const MAJOR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"]);

/** Stignät för område/källa/aktivitet: produktionens OSM-filter, klippt till rutan, plus korsningar med större vägar. */
export function loadAreaGraphs(areaId: AreaDef["id"], source: OsmSource, activity: Activity): AreaGraphs {
  const area = AREAS.find((a) => a.id === areaId)!;
  const ways = loadWays(areaId, source);
  const raw = overpassToGraph({ elements: ways } as unknown as OverpassResponse, activity);
  const [s, w, n, e] = area.bbox;
  const ring: [number, number][] = [[w, s], [e, s], [e, n], [w, n]];
  const inBox = raw.edges.filter((ed) => pointInPolygon(ed.geometry[Math.floor(ed.geometry.length / 2)], ring));
  const used = new Set(inBox.flatMap((x) => [x.from, x.to]));
  const all: SerializedGraph = { ...raw, nodes: raw.nodes.filter((x) => used.has(x.id)), edges: inBox };
  const idx = indexGraph(all);
  const biggest = [...idx.components].sort((a, b) => b.lengthM - a.lengthM)[0];
  const medges = all.edges.filter((x) => idx.edges.get(x.id)?.component === biggest.id);
  const keep = new Set(medges.flatMap((x) => [x.from, x.to]));
  const main: SerializedGraph = { ...all, nodes: all.nodes.filter((x) => keep.has(x.id)), edges: medges };
  // Farliga passager: noder som delas mellan en tillåten stig och en utesluten större väg.
  const majorNodes = new Set<string>();
  for (const wy of ways) if (MAJOR.has(wy.tags!.highway) && !decideWay(wy.tags, activity).ok) for (const id of wy.nodes) majorNodes.add(String(id));
  const hazardNodes = new Set(main.nodes.filter((x) => majorNodes.has(x.id)).map((x) => x.id));
  return { area, source, activity, all, main, hazardNodes };
}

/** Råa highway-ways med längd, för attributstatistik. */
export function wayLengths(ways: RawWayElement[]): { tags?: Record<string, string>; lengthM: number }[] {
  return ways.filter((w) => !w.geometry.some((p) => !p)).map((w) => ({ tags: w.tags, lengthM: cumulativeLengths(w.geometry as LatLon[]).at(-1)! }));
}
