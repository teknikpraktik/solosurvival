import { describe, expect, it } from "vitest";
import { decideWay, normalizeOverpass, overpassQuery, overpassToGraph } from "@/geo/osm/overpass";
import { indexGraph } from "@/geo/graph/graph";
import { validateArea, validatePolygon, clipGraphToPolygon } from "@/geo/validation/area";
import { gridGraph, lineGraph, twoComponentGraph, ORIGIN } from "@/sim/test-graphs";
import { fromLocal } from "@/geo/geometry";
import { parseBbox, TerrainError } from "@/geo/osm/terrain-service";

const way = (id: number, nodes: number[], pts: [number, number][], tags: Record<string, string>) => ({
  type: "way", id, nodes, geometry: pts.map(([lat, lon]) => ({ lat, lon })), tags,
});

describe("OSM-filtrering", () => {
  it("promenad: tillåter stig, utesluter privata och foot=no", () => {
    expect(decideWay({ highway: "path" }, "walk").ok).toBe(true);
    expect(decideWay({ highway: "path", access: "private" }, "walk").ok).toBe(false);
    expect(decideWay({ highway: "path", foot: "no" }, "run").ok).toBe(false);
    expect(decideWay({ highway: "path", access: "private", foot: "yes" }, "walk").ok).toBe(true);
    expect(decideWay({ highway: "motorway" }, "walk").ok).toBe(false);
    expect(decideWay({ highway: "tertiary" }, "walk").ok).toBe(false);
    expect(decideWay({ highway: "path", railway: "abandoned" }, "walk").ok).toBe(false);
  });
  it("MTB: bicycle=no och gångväg utan cykeltillstånd utesluts", () => {
    expect(decideWay({ highway: "path" }, "mtb").ok).toBe(true);
    expect(decideWay({ highway: "path", bicycle: "no" }, "mtb").ok).toBe(false);
    expect(decideWay({ highway: "footway" }, "mtb").ok).toBe(false);
    expect(decideWay({ highway: "footway", bicycle: "yes" }, "mtb").ok).toBe(true);
    expect(decideWay({ highway: "path", "mtb:scale": "5" }, "mtb").ok).toBe(false);
    expect(decideWay({ highway: "cycleway" }, "mtb").ok).toBe(true);
  });
  it("normaliserar och bygger graf med delad nod", () => {
    const resp = {
      elements: [
        way(1, [10, 11, 12], [[59.38, 13.5], [59.38, 13.501], [59.38, 13.502]], { highway: "path" }),
        way(2, [11, 13], [[59.38, 13.501], [59.381, 13.501]], { highway: "footway" }),
        way(3, [20, 21], [[59.39, 13.5], [59.39, 13.501]], { highway: "motorway" }),
        way(4, [30, 31], [[59.38, 13.6], [59.38, 13.601]], { highway: "path", bicycle: "no" }),
      ],
    };
    expect(normalizeOverpass(resp, "walk")).toHaveLength(3);
    expect(normalizeOverpass(resp, "mtb")).toHaveLength(1);
    const g = indexGraph(overpassToGraph(resp, "walk"));
    expect(g.components.length).toBe(2);
  });
  it("query innehåller bbox i Overpass-ordning", () => {
    expect(overpassQuery([59.3, 13.35, 59.45, 13.55])).toContain("(59.3,13.35,59.45,13.55)");
  });
  it("bbox-validering", () => {
    expect(parseBbox([13.35, 59.3, 13.55, 59.45], "mtb")).toEqual([59.3, 13.35, 59.45, 13.55]);
    expect(() => parseBbox([13.55, 59.3, 13.35, 59.45], "mtb")).toThrow(TerrainError);
    expect(() => parseBbox([0, 0, 10, 10], "walk")).toThrow(TerrainError);
    expect(() => parseBbox("x", "walk")).toThrow(TerrainError);
  });
});

describe("områdesvalidering", () => {
  it("godkänner ett rikt nät och ger mätvärden", () => {
    const g = gridGraph(24, 24, 130);
    const v = validateArea({ graph: g, activity: "run", difficulty: "normal", durationS: 2700, start: fromLocal(ORIGIN, { x: 1000, y: 1000 }) });
    expect(v.valid).toBe(true);
    expect(v.metrics.junctionCount).toBeGreaterThan(100);
    expect(v.metrics.spawnCapacity).toBeGreaterThan(12);
  });
  it("underkänner en enda kort stig", () => {
    const v = validateArea({ graph: lineGraph(800), activity: "run", difficulty: "normal", durationS: 2700 });
    expect(v.valid).toBe(false);
  });
  it("underkänner start långt från nätet", () => {
    const v = validateArea({ graph: gridGraph(10, 10, 100), activity: "walk", difficulty: "easy", durationS: 1800, start: { lat: ORIGIN.lat + 0.1, lon: ORIGIN.lon } });
    expect(v.valid).toBe(false);
  });
  it("väljer komponenten närmast starten", () => {
    const g = twoComponentGraph();
    const v = validateArea({ graph: g, activity: "walk", difficulty: "easy", durationS: 1200, start: fromLocal(ORIGIN, { x: 500, y: 300 }) });
    expect(v.component).toBe(g.edges.get("B:0")!.component);
  });
  it("polygon: korsande, för liten och för stor avvisas", () => {
    const sq = (s: number) => ({ type: "Polygon", coordinates: [[[13, 59], [13 + s, 59], [13 + s, 59 + s], [13, 59 + s], [13, 59]]] });
    expect("ring" in validatePolygon(sq(0.02), "run")).toBe(true);
    expect("error" in validatePolygon(sq(1), "walk")).toBe(true);
    expect("error" in validatePolygon({ type: "Polygon", coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] }, "run")).toBe(true);
    expect("error" in validatePolygon({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0]]] }, "run")).toBe(true);
  });
  it("klippning behåller bara kanter inom polygonen", () => {
    const sg = { graphVersion: "1.0", source: "t", nodes: [] as any[], edges: [] as any[] };
    const mk = (id: string, lon: number) => ({ id, from: id + "a", to: id + "b", type: "path" as const, geometry: [{ lat: 0.5, lon }, { lat: 0.5, lon: lon + 0.1 }] });
    sg.edges.push(mk("in", 0.2), mk("out", 5));
    sg.nodes.push({ id: "ina", lat: 0.5, lon: 0.2 }, { id: "inb", lat: 0.5, lon: 0.3 }, { id: "outa", lat: 0.5, lon: 5 }, { id: "outb", lat: 0.5, lon: 5.1 });
    const c = clipGraphToPolygon(sg, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    expect(c.edges.map((e) => e.id)).toEqual(["in"]);
    expect(c.nodes).toHaveLength(2);
  });
});

describe("OSM-filtrering: saknade och osäkra attribut (Etapp 3)", () => {
  it("vadställe, dålig stigsynlighet och alpina stigar utesluts för alla aktiviteter", () => {
    for (const a of ["walk", "run", "mtb"] as const) {
      expect(decideWay({ highway: "path", ford: "yes" }, a)).toEqual({ ok: false, reason: "ford" });
      expect(decideWay({ highway: "path", trail_visibility: "bad" }, a).ok).toBe(false);
      expect(decideWay({ highway: "path", sac_scale: "mountain_hiking" }, a).ok).toBe(false);
    }
    expect(decideWay({ highway: "path", ford: "no" }, "walk").ok).toBe(true);
  });
  it("cykelbana utan foot=yes är inte en gångväg, men fungerar för MTB", () => {
    expect(decideWay({ highway: "cycleway" }, "walk").ok).toBe(false);
    expect(decideWay({ highway: "cycleway" }, "run").ok).toBe(false);
    expect(decideWay({ highway: "cycleway", foot: "designated" }, "walk").ok).toBe(true);
    expect(decideWay({ highway: "cycleway" }, "mtb").ok).toBe(true);
  });
  it("begränsad åtkomst (kunder, tillstånd, skogsbruk …) tolkas som förbud om inte foot/bicycle uttryckligen tillåts", () => {
    for (const access of ["customers", "permit", "delivery", "military", "forestry", "agricultural", "private", "no"]) {
      expect(decideWay({ highway: "track", access }, "walk").ok, access).toBe(false);
      expect(decideWay({ highway: "track", access, foot: "yes" }, "walk").ok, access).toBe(true);
      expect(decideWay({ highway: "track", access }, "mtb").ok, access).toBe(false);
    }
  });
  it("tekniska MTB-leder (mtb:scale ≥ 3) utesluts, enkelriktade MTB-stigar behåller riktningen", () => {
    expect(decideWay({ highway: "path", "mtb:scale": "2" }, "mtb").ok).toBe(true);
    expect(decideWay({ highway: "path", "mtb:scale": "3" }, "mtb").ok).toBe(false);
    expect(decideWay({ highway: "path", "oneway:bicycle": "yes" }, "mtb")).toEqual({ ok: true, oneway: true });
    expect(decideWay({ highway: "path", oneway: "yes" }, "walk")).toEqual({ ok: true });
  });
  it("trappor, byggen och p-gångar finns inte i nätet; ofullständig åtkomst (unknown) utesluts", () => {
    expect(decideWay({ highway: "steps" }, "walk").ok).toBe(false);
    expect(decideWay({ highway: "service", service: "parking_aisle" }, "walk").ok).toBe(false);
    expect(decideWay({ highway: "path", access: "unknown" }, "walk").ok).toBe(false);
  });
});
