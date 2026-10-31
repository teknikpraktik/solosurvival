import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { decodePolygons } from "@/geo/mvt";
import { BLOCKER_ZOOM, loadBlockers, makeBlockers, type Blockers, type TileFetcher } from "@/geo/blockers";
import { buildTerrainMesh } from "@/geo/graph/terrain-mesh";
import { fromLocal, type LatLon } from "@/geo/geometry";
import { TileStore, type Fetcher } from "@/data/store";
import { prepareMatch } from "@/play/prepare";
import { defaultParams, withActivity } from "@/play/config";

// Two real background-map tiles (OpenFreeMap, OpenStreetMap data, ODbL) around the test start in Karlstad.
const FIX = path.join(import.meta.dirname, "..", "fixtures", "mvt");
const tile = (z: number, x: number, y: number) => { const f = path.join(FIX, `${z}-${x}-${y}.pbf`); return existsSync(f) ? new Uint8Array(readFileSync(f)) : null; };
const fixtureFetcher: TileFetcher = async (z, x, y) => tile(z, x, y);
const START: LatLon = { lat: 59.40731, lon: 13.46753 };
const centroid = (ring: LatLon[]) => ({ lat: ring.reduce((a, p) => a + p.lat, 0) / ring.length, lon: ring.reduce((a, p) => a + p.lon, 0) / ring.length });

describe("vector tiles: buildings and water", () => {
  it("decodes polygons of the chosen layers from a real tile", () => {
    const t = decodePolygons(tile(14, 8805, 4811)!, 14, 8805, 4811, new Set(["building", "water"]));
    expect(t.layers.get("building")!.length).toBeGreaterThan(500);
    expect(t.layers.get("water")!.length).toBeGreaterThan(0);
    // Inside the tile's bounds.
    for (const poly of t.layers.get("building")!.slice(0, 50)) for (const p of poly[0]) { expect(p.lat).toBeGreaterThan(59.39); expect(p.lat).toBeLessThan(59.42); }
  });
});

describe("blockers", () => {
  let b: Blockers;
  let house: LatLon[];
  beforeAll(async () => {
    b = (await loadBlockers(START, 1500, BLOCKER_ZOOM, fixtureFetcher))!;
    house = decodePolygons(tile(14, 8805, 4811)!, 14, 8805, 4811, new Set(["building"])).layers.get("building")!.sort((p, q) => q[0].length - p[0].length)[0][0];
  });
  it("a point inside a building is blocked, open ground is not", () => {
    expect(b.blocked(centroid(house))).toBe(true);
    // Most ground is open: of a grid of points around the start, only a minority falls in a building or water.
    let n = 0, hit = 0;
    for (let x = -1000; x <= 1000; x += 50) for (let y = -500; y <= 500; y += 50) { n++; if (b.blocked(fromLocal(START, { x, y }))) hit++; }
    expect(hit).toBeGreaterThan(0);
    expect(hit / n).toBeLessThan(0.4);
    expect(makeBlockers([]).blocked(centroid(house))).toBe(false);
  });
  it("a segment through a building is blocked", () => {
    const c = centroid(house);
    expect(b.segmentBlocked(fromLocal(c, { x: -60, y: 0 }), fromLocal(c, { x: 60, y: 0 }))).toBe(true);
  });
  it("a tile that cannot be fetched means no blockers at all (zombies then stay on the trails)", async () => {
    expect(await loadBlockers(START, 500, BLOCKER_ZOOM, async () => { throw new Error("offline"); })).toBeNull();
  });
});

describe("terrain lattice without buildings and water", () => {
  it("no lattice node inside, and no lattice edge across, a building or water", async () => {
    const b = (await loadBlockers(START, 1200, BLOCKER_ZOOM, fixtureFetcher))!;
    const a = fromLocal(START, { x: -1000, y: 0 }), z = fromLocal(START, { x: 1000, y: 0 });
    const free = buildTerrainMesh(null, { a, b: z, halfWidthM: 600, marginM: 0 });
    const mesh = buildTerrainMesh(null, { a, b: z, halfWidthM: 600, marginM: 0, blockers: b });
    expect(mesh.meshNodes).toBeLessThan(free.meshNodes);
    const byId = new Map(mesh.graph.nodes.map((n) => [n.id, n]));
    for (const n of mesh.graph.nodes) expect(b.blocked(n)).toBe(false);
    for (const e of mesh.graph.edges) expect(b.segmentBlocked(byId.get(e.from)!, byId.get(e.to)!)).toBe(false);
  });
});

describe("prepare: zombies may leave the trails when the map's buildings and water are known", () => {
  const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
  const fsFetch: Fetcher = async (url) => { const rel = url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, ""); const body = JSON.parse(readFileSync(path.join(root, rel), "utf8")); return { ok: true, status: 200, json: async () => body }; };
  it("with tiles: a terrain lattice over the play area; without: trails only", async () => {
    const store = new TileStore("/data/v1/varmland", fsFetch);
    const p = { ...defaultParams("walk"), mode: "survival" as const, seed: 3 };
    const on = await prepareMatch(store, START, p, { terrainTiles: fixtureFetcher });
    const off = await prepareMatch(store, START, p);
    expect(on.status).toBe("ok");
    expect(on.graph!.hasOfftrail).toBe(true);
    expect(on.notes.some((n) => n.startsWith("terrain:"))).toBe(true);
    expect(off.graph!.hasOfftrail).toBeFalsy();
    const bike = await prepareMatch(store, START, { ...withActivity(defaultParams("walk"), "mtb"), mode: "survival" as const, seed: 3 }, { terrainTiles: fixtureFetcher });
    expect(bike.graph!.hasOfftrail).toBe(true);
  }, 120000);
});
