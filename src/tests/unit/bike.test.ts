import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import { prepareMatch } from "@/play/prepare";
import { defaultParams, withActivity, type MatchParams } from "@/play/config";
import { createLiveMatch } from "@/play/match";
import { haversineM, projectToPolyline, type LatLon } from "@/geo/geometry";
import { stepGame } from "@/engine/core/engine";
import { zombieLatLon } from "@/engine/core/movement";
import { ACTIVITIES } from "@/config/activities";
import { isEasyBikeWay } from "@/geo/osm/overpass";

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = () => new TileStore("/data/v1/varmland", fsFetch);
const I2: LatLon = { lat: 59.40731, lon: 13.46753 };
const bike = (over: Partial<MatchParams> = {}): MatchParams => ({ ...withActivity(defaultParams("mtb"), "mtb"), mode: "mission", seed: 5, targetLengthM: 10000, ...over });

describe("isEasyBikeWay", () => {
  it("paved/gravel roads, bike lanes and plain tracks are easy", () => {
    expect(isEasyBikeWay({ highway: "cycleway" })).toBe(true);
    expect(isEasyBikeWay({ highway: "residential" })).toBe(true);
    expect(isEasyBikeWay({ highway: "service", service: "alley" })).toBe(true);
    expect(isEasyBikeWay({ highway: "track" })).toBe(true);
    expect(isEasyBikeWay({ highway: "track", tracktype: "grade2", surface: "gravel" })).toBe(true);
    expect(isEasyBikeWay({ highway: "path", surface: "asphalt" })).toBe(true);
    expect(isEasyBikeWay({ highway: "path", surface: "compacted" })).toBe(true);
  });
  it("rough or unknown trails are not easy", () => {
    expect(isEasyBikeWay({ highway: "path" })).toBe(false); // unknown surface is never assumed easy
    expect(isEasyBikeWay({ highway: "footway" })).toBe(false);
    expect(isEasyBikeWay({ highway: "path", surface: "dirt" })).toBe(false);
    expect(isEasyBikeWay({ highway: "path", surface: "gravel", "mtb:scale": "1" })).toBe(false);
    expect(isEasyBikeWay({ highway: "track", tracktype: "grade5" })).toBe(false);
    expect(isEasyBikeWay({ highway: "track", surface: "grass" })).toBe(false);
    expect(isEasyBikeWay({ highway: "track", smoothness: "very_bad" })).toBe(false);
    expect(isEasyBikeWay({ highway: "cycleway", sac_scale: "mountain_hiking" })).toBe(false);
    expect(isEasyBikeWay({ highway: "service", service: "driveway" })).toBe(false);
    expect(isEasyBikeWay(undefined)).toBe(false);
  });
});

describe("Bike Mission (real Värmland data)", { timeout: 120000 }, () => {
  it("the 10 km track is planned on easy ways; zombies may use every way", async () => {
    const r = await prepareMatch(store(), I2, bike());
    expect(r.status).toBe("ok");
    expect(r.notes.some((n) => n.startsWith("easy-bike-network"))).toBe(false);
    const edges = [...r.graph!.edges.values()];
    expect(edges.some((e) => !e.easy)).toBe(true); // the full graph (used by zombies) still has the rougher ways
    for (const pr of r.proposals) {
      let on = 0, tot = 0;
      for (let i = 0; i < pr.geometry.length; i += 3) {
        let best = Infinity, easy = false;
        for (const e of edges) { const d = projectToPolyline(e.geometry, e.cumM, pr.geometry[i]).distanceM; if (d < best) { best = d; easy = !!e.easy; } }
        tot++; if (easy) on++;
      }
      expect(on / tot).toBeGreaterThan(0.85); // measurement noise at junctions where easy and rough ways meet
    }
  });
  it("falls back to every rideable way, with a note, where the easy network is too thin", async () => {
    const r = await prepareMatch(store(), { lat: 59.37316, lon: 13.39471 }, bike());
    expect(r.status).toBe("ok");
    expect(r.notes.some((n) => n.startsWith("easy-bike-network"))).toBe(true);
  });
  it("initial zombies keep their distance (≥ 1.5 km) and are spread out along the track", async () => {
    const r = await prepareMatch(store(), I2, bike());
    const live = createLiveMatch({ id: "s", params: bike(), start: I2, proposal: r.proposals[0], graph: r.graph!, dataVersion: "t" });
    const ds = live.state.zombies.map((z) => haversineM(zombieLatLon(live.g, z), I2));
    expect(ds.length).toBe(10);
    expect(Math.min(...ds)).toBeGreaterThanOrEqual(1500);
    const bins = new Set(ds.map((d) => Math.floor(d / 500)));
    expect(bins.size).toBeGreaterThanOrEqual(3);
    // Spread over different parts of the track: not all within the same 500 m of one checkpoint.
    const cps = r.proposals[0].waypoints.filter((w) => w.kind !== "home");
    const nearest = new Set(live.state.zombies.map((z) => { const ll = zombieLatLon(live.g, z); return cps.reduce((b, c, i) => (haversineM(c, ll) < haversineM(cps[b], ll) ? i : b), 0); }));
    expect(nearest.size).toBeGreaterThanOrEqual(5);
  });
  it("Survival on a bike also starts with zombies far away and spread out", async () => {
    const r = await prepareMatch(store(), I2, bike({ mode: "survival" }));
    const live = createLiveMatch({ id: "s2", params: bike({ mode: "survival" }), start: I2, proposal: undefined as never, graph: r.graph!, dataVersion: "t" });
    const ds = live.state.zombies.map((z) => haversineM(zombieLatLon(live.g, z), I2));
    expect(Math.min(...ds)).toBeGreaterThanOrEqual(1500);
    expect(Math.max(...ds) - Math.min(...ds)).toBeGreaterThan(1500);
  });
  it("zombies hunt only within the magnet range (2 km on Bike); farther away they keep patrolling", async () => {
    const r = await prepareMatch(store(), I2, bike());
    const run = (range: number) => {
      const live = createLiveMatch({ id: "s3", params: bike(), start: I2, proposal: r.proposals[0], graph: r.graph!, dataVersion: "t" });
      live.state.paused = false;
      live.rules.magnetRangeM = range;
      for (let i = 0; i < 10 * 5; i++) stepGame(live.g, live.state, live.rules, { position: I2, quality: "ok", accuracyM: 5 });
      return live.state.zombies.filter((z) => z.state === "chase" || z.state === "intercept").length;
    };
    expect(ACTIVITIES.mtb.magnetRangeM).toBe(2000);
    expect(run(1000)).toBe(0); // every initial zombie is ≥ 1.5 km away: nobody hunts
    expect(run(2000)).toBeGreaterThanOrEqual(3); // zombies at 1.5–2 km hunt
    expect(run(2000)).toBeLessThan(10); // the ones farther out do not
  });
});
