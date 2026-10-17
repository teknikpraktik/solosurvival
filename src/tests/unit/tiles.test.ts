import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import { buildRegionGraph } from "@/data/region-graph";
import { decodeTile, tilesInRadius } from "@/data/tile-format";
import type { LatLon } from "@/geo/geometry";
import type { Activity } from "@/config/activities";

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const calls: string[] = [];
const fsFetch: Fetcher = async (url) => {
  calls.push(url);
  const rel = url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "");
  try {
    const body = JSON.parse(readFileSync(path.join(root, rel), "utf8"));
    return { ok: true, status: 200, json: async () => body };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const KARLSTAD: LatLon = { lat: 59.3793, lon: 13.5036 };
const SKUTBERGET: LatLon = { lat: 59.3725, lon: 13.394 };
const ARVIKA: LatLon = { lat: 59.655, lon: 12.59 };

describe("tiles och regionala grafer (riktig Värmlandsdata)", () => {
  it("laddar bara tiles som behövs", async () => {
    calls.length = 0;
    const store = new TileStore("/data/v1/varmland", fsFetch);
    const m = await store.loadManifest();
    expect(m.stats.tiles).toBeGreaterThan(500);
    const { ways, stats } = await store.loadAround(KARLSTAD, 3000);
    expect(stats.tiles).toBeLessThanOrEqual(4);
    expect(calls.filter((c) => c.includes("/t/")).length).toBe(stats.tiles - stats.missing);
    expect(stats.networkGzipBytes).toBeLessThan(1_500_000);
    expect(ways.length).toBeGreaterThan(1000);
    expect(new Set(ways.map((w) => w.id)).size).toBe(ways.length);
  });

  it("cache: andra anropet går inte mot nätverket", async () => {
    const mem = new Map<string, never>();
    const cache = { get: async (k: string) => mem.get(k), put: async (k: string, t: never) => void mem.set(k, t) };
    calls.length = 0;
    const a = new TileStore("/data/v1/varmland", fsFetch, cache);
    await a.loadAround(SKUTBERGET, 2000);
    const before = calls.filter((c) => c.includes("/t/")).length;
    await new Promise((r) => setTimeout(r, 5));
    const b = new TileStore("/data/v1/varmland", fsFetch, cache);
    const res = await b.loadAround(SKUTBERGET, 2000);
    expect(calls.filter((c) => c.includes("/t/")).length).toBe(before);
    expect(res.stats.fromNetwork).toBe(0);
    expect(res.stats.fromCache).toBeGreaterThan(0);
  });

  it("tile-avkodning ger rimliga koordinater", async () => {
    const t = JSON.parse(readFileSync(path.join(root, "t", "1187_135.json"), "utf8"));
    const ways = decodeTile(t);
    for (const w of ways.slice(0, 200)) for (const n of w.nodes) {
      expect(n.lat).toBeGreaterThan(59);
      expect(n.lat).toBeLessThan(60);
    }
  });

  it("tilesInRadius täcker cirkeln", () => {
    const tiles = tilesInRadius(KARLSTAD, 100, { latStepDeg: 0.05, lonStepDeg: 0.1, coordUnitDeg: 1e-6 });
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.length).toBeLessThanOrEqual(4);
  });

  for (const activity of ["walk", "run", "mtb"] as Activity[]) {
    it(`regionalt stignät (${activity}) kring Karlstad`, async () => {
      const store = new TileStore("/data/v1/varmland", fsFetch);
      const { ways } = await store.loadAround(SKUTBERGET, 3500);
      const t0 = performance.now();
      const rg = buildRegionGraph(ways, activity, SKUTBERGET, 3500);
      const ms = performance.now() - t0;
      expect(rg.stats.edges).toBeGreaterThan(50);
      expect(rg.stats.componentKm).toBeGreaterThan(5);
      expect(rg.startSnapM).not.toBeNull();
      expect(rg.hazardNodes.size).toBeGreaterThan(0);
      // Inga kanter får korsa en hazard-nod: hazard-noder har exakt en kant.
      const deg = new Map<string, number>();
      for (const e of rg.graph.edges) { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1); }
      for (const h of rg.hazardNodes) expect(deg.get(h)).toBe(1);
      expect(ms).toBeLessThan(4000);
      console.log(activity, "edges", rg.stats.edges, "km", rg.stats.componentKm.toFixed(1), "hazardStubs", rg.hazardNodes.size, "ms", ms.toFixed(0), JSON.stringify(rg.stats.excluded));
    });
  }

  it("start utanför nätet och glesbygd rapporteras", async () => {
    const store = new TileStore("/data/v1/varmland", fsFetch);
    const lake: LatLon = { lat: 59.2, lon: 13.2 }; // Vänern
    const { ways } = await store.loadAround(lake, 800);
    const rg = buildRegionGraph(ways, "walk", lake, 800);
    expect(rg.startSnapM === null || rg.startSnapM > 150).toBe(true);
  });

  it("Arvika-trakten har data", async () => {
    const store = new TileStore("/data/v1/varmland", fsFetch);
    const { ways } = await store.loadAround(ARVIKA, 2500);
    const rg = buildRegionGraph(ways, "run", ARVIKA, 2500);
    expect(rg.stats.edges).toBeGreaterThan(20);
  });
});
