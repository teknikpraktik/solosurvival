/**
 * The trail network from OpenFreeMap's vector tiles (data/ofm-store.ts): rules on hand-made tiles, a comparison with our OSM tiles on
 * two real tiles over Värmland, and a whole match prepared outside Sweden from recorded tiles (Karura forest, Nairobi).
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FallbackStore, TileStore, type Fetcher, type WayStore } from "@/data/store";
import { NO_ROUTE_TAG, OfmStore, tilesAround, waysFromTiles, type OfmTile } from "@/data/ofm-store";
import { buildRegionGraph } from "@/data/region-graph";
import { decideWay } from "@/geo/osm/overpass";
import { openFreeMap } from "@/geo/blockers";
import { prepareMatch } from "@/play/prepare";
import { defaultParams, withActivity } from "@/play/config";
import { haversineM, toLocal, type LatLon } from "@/geo/geometry";
import type { TileWay } from "@/data/tile-format";

// --- A minimal MVT encoder for hand-made tiles -------------------------------------------------------------------------------

class W {
  b: number[] = [];
  varint(n: number) { while (n > 127) { this.b.push((n & 127) | 128); n = Math.floor(n / 128); } this.b.push(n); return this; }
  key(f: number, wire: number) { return this.varint(f * 8 + wire); }
  bytes(f: number, data: number[] | Uint8Array) { this.key(f, 2).varint(data.length); this.b.push(...data); return this; }
  str(f: number, s: string) { return this.bytes(f, [...new TextEncoder().encode(s)]); }
  packed(f: number, xs: number[]) { const w = new W(); xs.forEach((x) => w.varint(x)); return this.bytes(f, w.b); }
}
const zz = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n);
type Feat = { type: 2 | 3; props: Record<string, string | number>; parts: [number, number][][] };
function geometry(parts: [number, number][][], polygon: boolean): number[] {
  const out: number[] = [];
  let cx = 0, cy = 0;
  for (const p of parts) {
    const pts = polygon ? p.slice(0, -1) : p;
    out.push((1 & 7) | (1 << 3), zz(pts[0][0] - cx), zz(pts[0][1] - cy));
    [cx, cy] = pts[0];
    out.push((2 & 7) | ((pts.length - 1) << 3));
    for (const [x, y] of pts.slice(1)) { out.push(zz(x - cx), zz(y - cy)); cx = x; cy = y; }
    if (polygon) out.push(7 | (1 << 3));
  }
  return out;
}
function tile(layers: Record<string, Feat[]>): Uint8Array {
  const t = new W();
  for (const [name, feats] of Object.entries(layers)) {
    const keys: string[] = [], values: (string | number)[] = [];
    const idx = <T,>(arr: T[], v: T) => { const i = arr.indexOf(v); return i >= 0 ? i : arr.push(v) - 1; };
    const l = new W().varint(15 * 8).varint(2).str(1, name);
    for (const f of feats) {
      const tags: number[] = [];
      for (const [k, v] of Object.entries(f.props)) tags.push(idx(keys, k), idx(values, v));
      l.bytes(2, new W().packed(2, tags).key(3, 0).varint(f.type).packed(4, geometry(f.parts, f.type === 3)).b);
    }
    keys.forEach((k) => l.str(3, k));
    values.forEach((v) => l.bytes(4, typeof v === "string" ? new W().str(1, v).b : new W().key(6, 0).varint(zz(v)).b));
    l.key(5, 0).varint(4096);
    t.bytes(3, l.b);
  }
  return new Uint8Array(t.b);
}
const line = (props: Feat["props"], ...pts: [number, number][]): Feat => ({ type: 2, props, parts: [pts] });
const at = (z: number, x: number, y: number, layers: Record<string, Feat[]>): OfmTile => ({ z, x, y, pbf: tile(layers) });
/** Ids of nodes used by more than one way (junctions and shared ends). */
function shared(ways: TileWay[]): Set<string> {
  const n = new Map<string, number>();
  for (const w of ways) for (const id of new Set(w.nodes.map((v) => v.id))) n.set(id, (n.get(id) ?? 0) + 1);
  return new Set([...n].filter(([, k]) => k > 1).map(([id]) => id));
}

describe("OpenFreeMap tiles as ways: the rules", () => {
  const X = 9000, Y = 4800;
  it("tags: OpenMapTiles classes become the OSM highway types the filters read; bridges, oneway, access and MTB scale carry over", () => {
    const ways = waysFromTiles([at(14, X, Y, { transportation: [
      line({ class: "path", subclass: "footway", brunnel: "bridge" }, [100, 100], [300, 100]),
      line({ class: "minor" }, [100, 400], [300, 400]),
      line({ class: "track", oneway: -1, bicycle: "no", mtb_scale: "2" }, [100, 700], [300, 700]),
      line({ class: "primary" }, [100, 900], [300, 900]),
    ] })]);
    expect(ways.map((w) => w.tags)).toEqual([
      { highway: "footway", bridge: "yes" },
      { highway: "unclassified" },
      { highway: "track", oneway: "-1", bicycle: "no", "mtb:scale": "2" },
    ]);
  });

  it("a line end within about 1 m of another line joins it (a T junction the simplification lost); 5 m away it does not", () => {
    const tiles = (gap: number) => [at(14, X, Y, { transportation: [
      line({ class: "path", subclass: "path" }, [100, 1000], [2000, 1000]),
      line({ class: "path", subclass: "path" }, [1000, 1000 - gap], [1000, 200]),
    ] })];
    expect(shared(waysFromTiles(tiles(2))).size).toBe(1); // 2 units ≈ 0,6 m at 59° N
    expect(shared(waysFromTiles(tiles(16))).size).toBe(0); // 16 units ≈ 5 m
  });

  it("a crossing without a shared vertex joins on the same level, never at a bridge", () => {
    const tiles = (brunnel?: string) => [at(14, X, Y, { transportation: [
      line({ class: "path", subclass: "footway" }, [100, 1000], [2000, 1000]),
      line({ class: "path", subclass: "footway", ...(brunnel ? { brunnel } : {}) }, [1000, 200], [1000, 2000]),
    ] })];
    expect(shared(waysFromTiles(tiles())).size).toBe(1);
    expect(shared(waysFromTiles(tiles("bridge"))).size).toBe(0);
    expect(shared(waysFromTiles(tiles("tunnel"))).size).toBe(0);
  });

  it("a way across a tile edge is cut there and joined again (one network, not two)", () => {
    const ways = waysFromTiles([
      at(14, X, Y, { transportation: [line({ class: "path", subclass: "path" }, [3000, 2000], [4200, 2100], [5096, 2200])] }),
      // The same way as the tile on the left has, in this tile's units (the tiles overlap in a buffer).
      at(14, X + 1, Y, { transportation: [line({ class: "path", subclass: "path" }, [-1096, 2000], [104, 2100], [1000, 2200])] }),
    ]);
    expect(ways).toHaveLength(2);
    expect(shared(ways).size).toBe(1);
    const g = buildRegionGraph(ways, "walk", ways[0].nodes[0], 2000);
    expect(g.play.graph.edges.length).toBe(2);
    expect(g.stats.components).toBe(1);
  });

  it("a path sharing a vertex with a major road, railway or river is a hazard of that kind; a crossing on a bridge is not", () => {
    const ways = waysFromTiles([at(14, X, Y, {
      transportation: [
        line({ class: "path", subclass: "footway" }, [100, 1000], [1000, 1000], [2000, 1000]),
        line({ class: "primary" }, [1000, 100], [1000, 1000], [1000, 2000]),
        line({ class: "path", subclass: "footway" }, [100, 3000], [2000, 3000]),
        line({ class: "rail" }, [1500, 2500], [1500, 3500]),
        line({ class: "path", subclass: "footway", brunnel: "bridge" }, [100, 3600], [2000, 3600]),
      ],
      waterway: [line({ class: "river" }, [500, 3500], [500, 3700])],
    })]);
    const paths = ways.filter((w) => w.tags.highway === "footway");
    expect(paths[0].hazardKinds).toEqual(["T"]);
    expect(paths[1].hazardKinds).toEqual(["r"]); // the crossing got a vertex (same level, no bridge)
    expect(paths[2].hazardKinds).toEqual([]);
  });

  it("a plain path through rock or ice may not carry routes or checkpoints; zombies may still use it", () => {
    const rock = { type: 3 as const, props: { class: "rock" }, parts: [[[0, 0], [2000, 0], [2000, 2000], [0, 2000], [0, 0]] as [number, number][]] };
    const ways = waysFromTiles([at(14, X, Y, {
      landcover: [rock],
      transportation: [
        line({ class: "path", subclass: "path" }, [500, 500], [1500, 600]),
        line({ class: "path", subclass: "path", foot: "designated" }, [500, 900], [1500, 900]),
        line({ class: "path", subclass: "path", mtb_scale: "1" }, [500, 1300], [1500, 1300]),
        line({ class: "path", subclass: "path" }, [2500, 2500], [3500, 3500]),
        line({ class: "track" }, [500, 1700], [1500, 1700]),
      ],
    })]);
    expect(ways.map((w) => w.tags[NO_ROUTE_TAG] ?? "-")).toEqual(["no", "-", "-", "-", "-"]);
    const center = ways[0].nodes[0];
    const g = buildRegionGraph([ways[0]], "walk", center, 1000, center, { strict: true });
    expect(g.stats.excluded["route-unsafe"]).toBe(1);
    expect(g.graph.edges).toHaveLength(0);
    expect(g.play.graph.edges.length).toBeGreaterThan(0);
  });

  it("the same tiles always give the same ways", () => {
    const t = [at(14, X, Y, { transportation: [line({ class: "path", subclass: "path" }, [100, 100], [900, 900]), line({ class: "minor" }, [100, 900], [900, 100])] })];
    expect(waysFromTiles(t)).toEqual(waysFromTiles(t));
  });
});

// --- Real tiles ---------------------------------------------------------------------------------------------------------------

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const MVT = path.join(import.meta.dirname, "..", "fixtures", "mvt");
const NAIROBI = path.join(import.meta.dirname, "..", "fixtures", "ofm", "nairobi");

describe("OpenFreeMap against our OSM tiles (two real z14 tiles over Värmland)", () => {
  it("the same trails: nearly all OSM trail length has an OFM way within 10 m, and the OFM ways are real", async () => {
    const tiles: OfmTile[] = [[8804, 4811], [8805, 4811]].map(([x, y]) => ({ z: 14, x, y, pbf: new Uint8Array(readFileSync(path.join(MVT, `14-${x}-${y}.pbf`))) }));
    const ofm = waysFromTiles(tiles);
    // Inside the two tiles, kept a little away from their edges.
    const inside = (p: LatLon) => p.lat < 59.4113 && p.lat > 59.4006 && p.lon > 13.4478 && p.lon < 13.4908;
    const { ways } = await new TileStore("/data/v1/varmland", fsFetch).loadAround({ lat: 59.406, lon: 13.469 }, 1500);
    const osm = ways.filter((w) => decideWay(w.tags, "walk").ok);
    const coverage = (a: TileWay[], b: TileWay[]) => {
      const o = { lat: 59.406, lon: 13.469 };
      const segs = b.flatMap((w) => w.nodes.slice(1).map((n, i) => [toLocal(o, w.nodes[i]), toLocal(o, n)] as const));
      let tot = 0, hit = 0;
      for (const w of a) for (let i = 0; i + 1 < w.nodes.length; i++) {
        const p = w.nodes[i], q = w.nodes[i + 1], L = haversineM(p, q), n = Math.max(1, Math.ceil(L / 10));
        for (let k = 0; k < n; k++) {
          const s = { lat: p.lat + ((q.lat - p.lat) * k) / n, lon: p.lon + ((q.lon - p.lon) * k) / n };
          if (!inside(s)) continue;
          const v = toLocal(o, s);
          tot += L / n;
          if (segs.some(([a0, a1]) => { const vx = a1.x - a0.x, vy = a1.y - a0.y, l2 = vx * vx + vy * vy; const t = l2 ? Math.max(0, Math.min(1, ((v.x - a0.x) * vx + (v.y - a0.y) * vy) / l2)) : 0; return Math.hypot(v.x - a0.x - t * vx, v.y - a0.y - t * vy) <= 10; })) hit += L / n;
        }
      }
      return { tot, share: hit / Math.max(1, tot) };
    };
    const osmByOfm = coverage(osm, ofm), ofmByOsm = coverage(ofm.filter((w) => decideWay(w.tags, "walk").ok), osm);
    expect(osmByOfm.tot).toBeGreaterThan(1000);
    expect(osmByOfm.share).toBeGreaterThan(0.95);
    expect(ofmByOsm.share).toBeGreaterThan(0.9);
  });
});

describe("a match outside Värmland (recorded OpenFreeMap tiles, Karura forest, Nairobi)", () => {
  const KARURA: LatLon = { lat: -1.236, lon: 36.83 };
  const recorded = () => {
    let fetched = 0;
    const client = {
      async tile(z: number, x: number, y: number) {
        fetched++;
        try { return new Uint8Array(gunzipSync(readFileSync(path.join(NAIROBI, `${z}_${x}_${y}.pbf.gz`)))); } catch { return null; }
      },
      async version() { return "20261101_080013_pt"; },
    };
    return { client, fetched: () => fetched };
  };
  const store = (c: ReturnType<typeof recorded>["client"]): WayStore => new FallbackStore(new TileStore("/data/v1/varmland", fsFetch), new OfmStore(c));

  it("Survival and Checkpoints are prepared from OpenFreeMap, with its version as the data version", async () => {
    const r = recorded();
    const s = store(r.client);
    const survival = await prepareMatch(s, KARURA, { ...defaultParams("walk"), mode: "survival", seed: 3 });
    expect(survival.status).toBe("ok");
    expect(survival.dataVersion).toBe("ofm-20261101_080013_pt");
    expect(survival.load?.source).toBe("openfreemap");
    expect(survival.notes.some((n) => n.startsWith("data: OpenFreeMap"))).toBe(true);
    expect(survival.region!.stats.componentKm).toBeGreaterThan(3);
    const mission = await prepareMatch(s, KARURA, { ...defaultParams("walk"), mode: "mission", targetLengthM: 2000, seed: 3 });
    expect(["ok", "alternative"]).toContain(mission.status);
    expect(mission.proposals.length).toBeGreaterThan(0);
    // The second prepare used the tiles already fetched.
    expect(mission.load!.fromCache).toBeGreaterThan(0);
  }, 60000);

  it("in Värmland the OSM tiles are used, and OpenFreeMap is never asked", async () => {
    const r = recorded();
    const p = await prepareMatch(store(r.client), { lat: 59.40731, lon: 13.46753 }, { ...withActivity(defaultParams("walk"), "walk"), mode: "survival", seed: 3 });
    expect(p.status).toBe("ok");
    expect(p.load?.source).toBe("osm");
    expect(r.fetched()).toBe(0);
  }, 60000);

  it("a circle reaching past the OSM tiles' edge comes from OpenFreeMap entirely, never a mix", async () => {
    const primary = new TileStore("/data/v1/varmland", fsFetch);
    const m = await primary.loadManifest();
    const edge = { lat: m.bbox[0] + 0.005, lon: (m.bbox[1] + m.bbox[3]) / 2 };
    expect(await primary.coversCircle(edge, 2000)).toBe(false);
    expect(await primary.coversCircle({ lat: 59.40731, lon: 13.46753 }, 2000)).toBe(true);
    let asked = 0;
    const s = new FallbackStore(primary, { loadManifest: async () => ({ dataVersion: "x" }), covers: () => true, loadAround: async () => { asked++; return { ways: [], stats: { tiles: 0, fromCache: 0, fromNetwork: 0, missing: 0, networkGzipBytes: 0, ms: 0, source: "openfreemap" } }; } });
    await s.loadAround(edge, 2000);
    expect(asked).toBe(1);
  });

  it("tilesAround covers the circle at z14", () => {
    expect(tilesAround(KARURA, 1500).sort()).toEqual([[9867, 8247], [9867, 8248], [9868, 8247], [9868, 8248]]);
  });

  it("openFreeMap(): the version is the build in the tile URL", async () => {
    const fetchFn = (async () => ({ json: async () => ({ tiles: ["https://tiles.openfreemap.org/planet/20261101_080013_pt/{z}/{x}/{y}.pbf"] }) })) as unknown as typeof fetch;
    expect(await openFreeMap(fetchFn).version()).toBe("20261101_080013_pt");
  });
});
