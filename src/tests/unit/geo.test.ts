import { describe, expect, it } from "vitest";
import { bridgeGraph, gridGraph, twoComponentGraph, lineGraph, ORIGIN } from "@/sim/test-graphs";
import { haversineM, fromLocal, polygonSelfIntersects, pointInPolygon } from "@/geo/geometry";
import { planRoute, networkDistances } from "@/engine/pathfinding/astar";
import { edgeLatLon, snapToGraph, serializeGraph, indexGraph } from "@/geo/graph/graph";
import { buildGraph } from "@/geo/graph/build";

describe("geometri", () => {
  it("haversine ≈ lokala meter", () => {
    const p = fromLocal(ORIGIN, { x: 300, y: 400 });
    expect(haversineM(ORIGIN, p)).toBeGreaterThan(499);
    expect(haversineM(ORIGIN, p)).toBeLessThan(501);
  });
  it("polygon: korsning och inneslutning", () => {
    expect(polygonSelfIntersects([[0, 0], [1, 1], [1, 0], [0, 1]])).toBe(true);
    expect(polygonSelfIntersects([[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(false);
    expect(pointInPolygon({ lat: 0.5, lon: 0.5 }, [[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(true);
    expect(pointInPolygon({ lat: 2, lon: 0.5 }, [[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(false);
  });
});

describe("stiggraf", () => {
  it("bro utan delad nod ger ingen falsk koppling", () => {
    const g = bridgeGraph();
    expect(g.components.length).toBe(2);
    const under = [...g.edges.values()].find((e) => e.id.startsWith("under"))!;
    const over = [...g.edges.values()].find((e) => e.id.startsWith("over"))!;
    expect(under.component).not.toBe(over.component);
    expect(planRoute(g, { edgeId: under.id, distM: 10 }, { edgeId: over.id, distM: 10 }, 1)).toBeNull();
  });
  it("två komponenter räknas separat", () => {
    const g = twoComponentGraph();
    expect(g.components.length).toBe(2);
  });
  it("korsningar i rutnät delar noder", () => {
    const g = gridGraph(3, 3, 100);
    expect(g.components.length).toBe(1);
    expect(g.components[0].junctionCount).toBe(5); // 4 kanter-korsningar (T) + mitten = 4 T + 1 X
  });
  it("serialisering rundar tillbaka", () => {
    const g = gridGraph(3, 3, 100);
    const g2 = indexGraph(JSON.parse(JSON.stringify(serializeGraph(g))));
    expect(g2.edges.size).toBe(g.edges.size);
  });
  it("buildGraph delar way vid skärningsnod", () => {
    const sg = buildGraph([
      { id: "a", type: "path", nodes: [{ id: "1", lat: 0, lon: 0 }, { id: "2", lat: 0, lon: 0.001 }, { id: "3", lat: 0, lon: 0.002 }] },
      { id: "b", type: "path", nodes: [{ id: "2", lat: 0, lon: 0.001 }, { id: "4", lat: 0.001, lon: 0.001 }] },
    ]);
    expect(sg.edges.length).toBe(3);
  });
});

describe("A*", () => {
  it("kortaste tid mellan två positioner i rutnät", () => {
    const g = gridGraph(4, 4, 100);
    const a = snapToGraph(g, edgeLatLon(g, { edgeId: "r0:0", distM: 0 }))!;
    const to = { edgeId: "r3:1", distM: 100 }; // (200,300) från (0,0) = 500 m
    const r = planRoute(g, a, to, 2)!;
    expect(r).not.toBeNull();
    expect(r.lengthM).toBeGreaterThan(499);
    expect(r.lengthM).toBeLessThan(501);
    expect(r.etaS).toBeCloseTo(r.lengthM / 2, 5);
  });
  it("samma kant ger direkt färd", () => {
    const g = lineGraph(500);
    const e = [...g.edges.values()][0];
    const r = planRoute(g, { edgeId: e.id, distM: 10 }, { edgeId: e.id, distM: 80 }, 1)!;
    expect(r.firstDir).toBe(1);
    expect(r.steps).toHaveLength(0);
    expect(r.lengthM).toBeCloseTo(70, 5);
  });
  it("ingen rutt mellan komponenter", () => {
    const g = twoComponentGraph();
    const es = [...g.edges.values()];
    const a = es.find((e) => e.component === 0)!;
    const b = es.find((e) => e.component === 1)!;
    expect(planRoute(g, { edgeId: a.id, distM: 1 }, { edgeId: b.id, distM: 1 }, 1)).toBeNull();
  });
  it("nätavstånd begränsas av maxM", () => {
    const g = gridGraph(6, 6, 150);
    const e = g.edges.get("r0:0")!;
    const d = networkDistances(g, { edgeId: e.id, distM: 0 }, 300);
    expect(d.size).toBeLessThan(g.nodes.size);
  });
});
