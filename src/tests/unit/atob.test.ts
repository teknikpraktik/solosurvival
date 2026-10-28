import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import { prepareMatch } from "@/play/prepare";
import { atoBMaxStraightM, clampParams, dataRadiusM, defaultParams, withActivity, type MatchParams } from "@/play/config";
import { createLiveMatch } from "@/play/match";
import { haversineM, type LatLon } from "@/geo/geometry";
import { destinationPoint } from "./helpers";

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = () => new TileStore("/data/v1/varmland", fsFetch);
const A: LatLon = { lat: 59.40731, lon: 13.46753 }; // stigkorsning I2-skogen (OSM)
const params = (over: Partial<MatchParams>): MatchParams => ({ ...withActivity(defaultParams("walk"), "walk"), mode: "escape", seed: 3, ...over });

/** En B-punkt ~1,2 km bort som ligger på nätet: hämta en nod i grafen. */
let B: LatLon;
beforeAll(async () => {
  const pre = await prepareMatch(store(), A, params({ mode: "survival" }));
  const nodes = pre.graph!.nodes;
  const cand = [...nodes.values()].filter((n) => { const d = haversineM(n, A); return d > 1000 && d < 1400; });
  B = cand[Math.floor(cand.length / 2)];
}, 60000);

describe("A TO B (egen A och B, ingen sträcka)", () => {
  it("till fots är A TO B terräng: inga spärrar, målet exakt där spelaren valde, fågelvägen som hjälplinje", async () => {
    const p = params({ pointA: A, pointB: B, targetLengthM: 99999 }); // targetLengthM ska ignoreras
    const r = await prepareMatch(store(), A, p);
    expect(r.status).toBe("ok");
    expect(r.proposals).toHaveLength(1);
    const pr = r.proposals[0];
    expect(pr.terrain).toBe(true);
    expect(pr.waypoints).toHaveLength(1);
    expect(pr.waypoints[0].kind).toBe("destination");
    expect(haversineM(pr.waypoints[0], B)).toBeLessThan(0.01); // inte snappad till en stig
    expect(pr.lengthM).toBeCloseTo(haversineM(A, B), 0);
    expect(haversineM(pr.geometry[0], A)).toBeLessThan(0.01);
    expect(haversineM(pr.geometry.at(-1)!, B)).toBeLessThan(0.01);
    expect(r.graph!.hasOfftrail).toBe(true);
  });

  it("till fots fungerar A→B mitt ute i terrängen, i en sjö och utanför kartdata (tomt nät, bara terrängnät)", async () => {
    for (const [a, b] of [[A, destinationPoint(A, 2500, 200)], [{ lat: 59.2, lon: 13.2 }, { lat: 59.22, lon: 13.25 }], [{ lat: 55.6, lon: 13.0 }, { lat: 55.62, lon: 13.02 }]] as [LatLon, LatLon][]) {
      const r = await prepareMatch(store(), a, params({ pointA: a, pointB: b }));
      expect(r.status).toBe("ok");
      expect(haversineM(r.proposals[0].waypoints[0], b)).toBeLessThan(0.01);
      const live = createLiveMatch({ id: "t", params: params({ pointA: a, pointB: b }), start: a, proposal: r.proposals[0], graph: r.graph!, dataVersion: "t" });
      expect(live.state.zombies.length).toBeGreaterThanOrEqual(3);
      expect(live.state.zombies.every((z) => !z.canIntercept)).toBe(true);
    }
  });

  it("matchen skapas med B som enda mål och tidsgräns från ruttens längd", async () => {
    const p = params({ pointA: A, pointB: B });
    const r = await prepareMatch(store(), A, p);
    const live = createLiveMatch({ id: "ab", params: p, start: A, proposal: r.proposals[0], graph: r.graph!, dataVersion: "t" });
    expect(live.state.objectives!.targets).toHaveLength(1);
    expect(live.state.objectives!.targets[0].kind).toBe("destination");
    expect(live.state.config.durationSeconds).toBeGreaterThan(600);
  });

  it("A:s och B:s avstånd styr datahämtningen (båda täcks, litet område ⇒ få tiles)", async () => {
    const p = params({ pointA: A, pointB: B });
    expect(dataRadiusM(p)).toBeCloseTo(haversineM(A, B) * 0.75 + 600, 0);
    const r = await prepareMatch(store(), A, p);
    expect(r.load!.tiles).toBeLessThanOrEqual(9);
  });

  it("cykel: B ute i skogen/sjön utan väg i närheten avslås med förklaring (cykel är vägbunden)", async () => {
    const lake = destinationPoint(A, 900, 200); // slumpad punkt: kontrollera avståndet till nätet i testet
    const r = await prepareMatch(store(), A, { ...withActivity(params({ pointA: A, pointB: { lat: 59.2, lon: 13.2 } }), "mtb"), mode: "escape", pointA: A, pointB: { lat: 59.2, lon: 13.2 } }); // Vänern, cykel är fortfarande vägbunden
    expect(["no_route", "off_network", "sparse"]).toContain(r.status);
    expect(r.message).toBeTruthy();
    expect(r.proposals).toHaveLength(0);
    void lake;
  });

  it("för nära och för långt avslås", async () => {
    const near = await prepareMatch(store(), A, params({ pointA: A, pointB: destinationPoint(A, 150, 90) }));
    expect(near.status).toBe("no_route");
    expect(near.message).toMatch(/too close/);
    const far = await prepareMatch(store(), A, params({ pointA: A, pointB: destinationPoint(A, atoBMaxStraightM("walk") + 1000, 0) }));
    expect(far.status).toBe("sparse");
    expect(far.message).toMatch(/too far/);
  });

  it("cykel: A utanför regionen avslås (till fots går det, se ovan); pointA/pointB överlever clampParams", async () => {
    const out = await prepareMatch(store(), { lat: 55.6, lon: 13.0 }, { ...withActivity(params({ pointA: { lat: 55.6, lon: 13.0 }, pointB: A }), "mtb"), mode: "escape", pointA: { lat: 55.6, lon: 13.0 }, pointB: A });
    expect(out.status).toBe("outside_region");
    const c = clampParams(params({ pointA: A, pointB: B }));
    expect(c.pointA).toEqual(A);
    expect(c.pointB).toEqual(B);
  });

  it("Mission behåller sträckan och ignorerar A/B", async () => {
    const r = await prepareMatch(store(), A, { ...params({ mode: "mission" }), pointB: B });
    expect(["ok", "alternative"]).toContain(r.status);
    expect(r.proposals[0].waypoints.some((w) => w.kind === "checkpoint")).toBe(true);
  });
});

import { inCorridor } from "@/engine/spawning/spawn";
import { toLocal } from "@/geo/geometry";
import { stepGame } from "@/engine/core/engine";
import { zombieLatLon } from "@/engine/core/movement";

describe("A TO B: zombier uppstår mellan A och B", () => {
  it("inCorridor: bara mellan A och B, inom bredden", () => {
    const Bp = destinationPoint(A, 2000, 90);
    const c = { a: A, b: Bp, halfWidthM: 300, minT: 0.05, maxT: 0.97 };
    expect(inCorridor(destinationPoint(A, 1000, 90), c)).toBe(true);
    expect(inCorridor(destinationPoint(A, -300, 90), c)).toBe(false); // bakom A
    expect(inCorridor(destinationPoint(A, 2500, 90), c)).toBe(false); // bortom B
    expect(inCorridor(destinationPoint(destinationPoint(A, 1000, 90), 500, 0), c)).toBe(false); // för långt åt sidan
    expect(inCorridor(destinationPoint(destinationPoint(A, 1000, 90), 200, 0), c)).toBe(true);
  });

  it("alla initiala och senare zombier ligger mellan A och B (framför spelaren), på alla svårigheter", async () => {
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      const p = params({ pointA: A, pointB: B, difficulty });
      const r = await prepareMatch(store(), A, p);
      const live = createLiveMatch({ id: "c", params: p, start: A, proposal: r.proposals[0], graph: r.graph!, dataVersion: "t" });
      const bv = toLocal(A, B);
      const len2 = bv.x * bv.x + bv.y * bv.y;
      const tOf = (q: LatLon) => { const v = toLocal(A, q); return (v.x * bv.x + v.y * bv.y) / len2; };
      const lat = (q: LatLon) => { const v = toLocal(A, q); const t = tOf(q); return Math.hypot(v.x - t * bv.x, v.y - t * bv.y); };
      const half = Math.max(250, 0.3 * Math.sqrt(len2));
      const check = () => {
        let inside = 0;
        for (const z of live.state.zombies) { const ll = zombieLatLon(live.g, z); const t = tOf(ll); if (t >= 0.05 && t <= 0.97 && lat(ll) <= half + 1) inside++; }
        return inside;
      };
      expect(live.state.zombies.length).toBeGreaterThanOrEqual(3);
      expect(check()).toBe(live.state.zombies.length); // initialt: alla i korridoren
      // Nya zombier under matchen (spelaren står kvar vid A, smitta pausad så att matchen lever).
      live.state.paused = false;
      for (let i = 0; i < 5 * 60 * 4; i++) {
        const before = live.state.zombies.length;
        stepGame(live.g, live.state, live.rules, { position: A, quality: "infection_paused", accuracyM: 25 });
        if (live.state.zombies.length > before) {
          const z = live.state.zombies.at(-1)!;
          const ll = zombieLatLon(live.g, z);
          const t = tOf(ll);
          expect(t).toBeGreaterThanOrEqual(0.05);
          expect(t).toBeLessThanOrEqual(0.97);
          expect(lat(ll)).toBeLessThanOrEqual(half + 1);
        }
      }
      // Zombier som står still i en hög långt bort gallras (engine/ai/culling.ts) och räknas då i tillväxten i stället.
      expect(live.state.zombies.length + (live.state.culledZombies ?? 0)).toBeGreaterThan(live.rules.initialZombies - 1);
    }
  });
});

describe("A TO B: antal zombies följer sträckan och sprids längs hela vägen (riktiga data)", () => {
  for (const [act, expectedMin] of [["walk", 12], ["mtb", 10]] as const) {
    it(`${act} ~5 km: tillräckligt många zombies (Normal), jämnt längs A–B`, async () => {
      const p0 = params({ ...withActivity(defaultParams(act), act), mode: "escape", seed: 3, pointA: A, pointB: destinationPoint(A, 5000, 90) });
      const pre = await prepareMatch(store(), A, p0);
      const near = act === "walk" ? p0.pointB! : [...pre.region!.graph.nodes].sort((a, b) => haversineM(a, p0.pointB!) - haversineM(b, p0.pointB!))[0];
      const p = { ...p0, pointB: near as LatLon };
      const r = await prepareMatch(store(), A, p);
      expect(r.status).toBe("ok");
      const live = createLiveMatch({ id: "ab5", params: p, start: A, proposal: r.proposals[0], graph: r.graph!, dataVersion: "t" });
      const zs = live.state.zombies;
      expect(zs.length).toBeGreaterThanOrEqual(expectedMin);
      // A–B is about 5 km: 2.5 zombies/km on foot, 1.5/km by bike (at least the base population)
      const bv = toLocal(A, near);
      const len2 = bv.x * bv.x + bv.y * bv.y;
      const ts = zs.map((z) => { const v = toLocal(A, zombieLatLon(live.g, z)); return (v.x * bv.x + v.y * bv.y) / len2; });
      const bins = new Set(ts.map((t) => Math.min(4, Math.max(0, Math.floor(t * 5)))));
      expect(bins.size).toBeGreaterThanOrEqual(4); // spread over (almost) every fifth of the way
      for (const t of ts) { expect(t).toBeGreaterThan(0); expect(t).toBeLessThan(1); }
    });
  }
  it("Hard har dubbelt så många som Normal på samma sträcka", async () => {
    const p0 = params({ mode: "escape", seed: 3, pointA: A, pointB: destinationPoint(A, 5000, 90) });
    const near = p0.pointB!; // till fots: terräng, B exakt där spelaren valde
    const count = async (difficulty: "easy" | "normal" | "hard") => {
      const p = { ...p0, difficulty, pointB: near as LatLon };
      const r = await prepareMatch(store(), A, p);
      return createLiveMatch({ id: "d", params: p, start: A, proposal: r.proposals[0], graph: r.graph!, dataVersion: "t" }).state.zombies.length;
    };
    const [e, n, h] = [await count("easy"), await count("normal"), await count("hard")];
    expect(e).toBeLessThan(n);
    expect(h).toBeGreaterThanOrEqual(n * 1.8);
  });
});
