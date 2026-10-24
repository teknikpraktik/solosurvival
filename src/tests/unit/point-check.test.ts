import { describe, expect, it } from "vitest";
import { checkPickPoint, polygonContains, type MapFeature } from "@/geo/point-check";
import { destinationPoint } from "./helpers";

const P = { lat: 59.38, lon: 13.5 };
const sq = (c: { lat: number; lon: number }, halfM: number): [number, number][] => [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([x, y]) => { const q = destinationPoint(destinationPoint(c, x * halfM, 90), y * halfM, 0); return [q.lon, q.lat] as [number, number]; });
const poly = (layer: string, rings: [number, number][][]): MapFeature => ({ sourceLayer: layer, properties: {}, geometry: { type: "Polygon", coordinates: rings } });
const line = (cls: string, a: { lat: number; lon: number }, b: { lat: number; lon: number }, extra: Record<string, unknown> = {}): MapFeature => ({ sourceLayer: "transportation", properties: { class: cls, ...extra }, geometry: { type: "LineString", coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } });

describe("kontroll av vald B-punkt mot kartskikten", () => {
  it("punkt i vatten, och i en byggnad, avvisas; utanför är den fri", () => {
    expect(checkPickPoint([poly("water", [sq(P, 200)])], P)?.kind).toBe("water");
    expect(checkPickPoint([poly("building", [sq(P, 15)])], P)?.kind).toBe("building");
    expect(checkPickPoint([poly("water", [sq(destinationPoint(P, 500, 0), 100)])], P)).toBeNull();
  });
  it("hål i polygonen (en ö i sjön) är fri mark", () => {
    const lake = poly("water", [sq(P, 300), sq(P, 50)]);
    expect(checkPickPoint([lake], P)).toBeNull();
    expect(checkPickPoint([lake], destinationPoint(P, 150, 90))?.kind).toBe("water");
    expect(polygonContains([sq(P, 100)], [P.lon, P.lat])).toBe(true);
  });
  it("större väg och järnväg avvisas inom 12 m, men inte längre bort, och inte små vägar eller stigar", () => {
    const a = destinationPoint(P, 200, 270), b = destinationPoint(P, 200, 90);
    expect(checkPickPoint([line("primary", a, b)], destinationPoint(P, 8, 0))?.kind).toBe("major_road");
    expect(checkPickPoint([line("tertiary", a, b)], destinationPoint(P, 8, 0))?.kind).toBe("major_road");
    expect(checkPickPoint([line("primary", a, b)], destinationPoint(P, 30, 0))).toBeNull();
    expect(checkPickPoint([line("rail", a, b)], destinationPoint(P, 5, 0))?.kind).toBe("railway");
    expect(checkPickPoint([line("minor", a, b), line("path", a, b), line("service", a, b)], P)).toBeNull();
  });
  it("tunnlar räknas inte (marken ovanpå är fri) och inga kartdata ger ingen avvisning", () => {
    const a = destinationPoint(P, 200, 270), b = destinationPoint(P, 200, 90);
    expect(checkPickPoint([line("motorway", a, b, { brunnel: "tunnel" })], P)).toBeNull();
    expect(checkPickPoint([line("motorway", a, b, { brunnel: "bridge" })], P)?.kind).toBe("major_road");
    expect(checkPickPoint([], P)).toBeNull();
  });
  it("multipolygon och blandade objekt: första träffen vinner, järnväg före väg", () => {
    const multi: MapFeature = { sourceLayer: "water", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[sq(destinationPoint(P, 900, 0), 50)], [sq(P, 50)]] } };
    expect(checkPickPoint([multi], P)?.kind).toBe("water");
    const a = destinationPoint(P, 200, 270), b = destinationPoint(P, 200, 90);
    expect(checkPickPoint([line("primary", a, b), line("rail", a, b)], P)?.kind).toBe("railway");
  });
});
