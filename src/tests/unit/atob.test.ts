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
  it("rutt från A till B: ingen önskad sträcka, B som destination, rimlig längd, upp till tre alternativ", async () => {
    const p = params({ pointA: A, pointB: B, targetLengthM: 99999 }); // targetLengthM ska ignoreras
    const r = await prepareMatch(store(), A, p);
    expect(r.status).toBe("ok");
    expect(r.proposals.length).toBeGreaterThanOrEqual(1);
    expect(r.proposals.length).toBeLessThanOrEqual(3);
    const straight = haversineM(A, B);
    for (const pr of r.proposals) {
      expect(pr.lengthM).toBeGreaterThan(straight * 0.95);
      expect(pr.lengthM).toBeLessThan(straight * 5);
      expect(pr.lengthM).toBeLessThanOrEqual(r.proposals[0].lengthM * 1.6 + 1);
      expect(pr.waypoints).toHaveLength(1);
      expect(pr.waypoints[0].kind).toBe("destination");
      expect(haversineM(pr.waypoints[0], B)).toBeLessThan(150);
      expect(haversineM(pr.geometry[0], A)).toBeLessThan(150);
      expect(haversineM(pr.geometry.at(-1)!, pr.waypoints[0])).toBeLessThan(2);
    }
    // Kortaste först.
    for (let i = 1; i < r.proposals.length; i++) expect(r.proposals[i].lengthM).toBeGreaterThanOrEqual(r.proposals[0].lengthM - 1);
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

  it("B ute i skogen/sjön utan stig i närheten avslås med förklaring", async () => {
    const lake = destinationPoint(A, 900, 200); // slumpad punkt: kontrollera avståndet till nätet i testet
    const r = await prepareMatch(store(), A, params({ pointA: A, pointB: { lat: 59.2, lon: 13.2 } })); // Vänern
    expect(["no_route", "off_network", "sparse"]).toContain(r.status);
    expect(r.message).toBeTruthy();
    expect(r.proposals).toHaveLength(0);
    void lake;
  });

  it("för nära och för långt avslås", async () => {
    const near = await prepareMatch(store(), A, params({ pointA: A, pointB: destinationPoint(A, 150, 90) }));
    expect(near.status).toBe("no_route");
    expect(near.message).toMatch(/för nära/);
    const far = await prepareMatch(store(), A, params({ pointA: A, pointB: destinationPoint(A, atoBMaxStraightM("walk") + 1000, 0) }));
    expect(far.status).toBe("sparse");
    expect(far.message).toMatch(/för långt/);
  });

  it("A utanför regionen avslås; pointA/pointB överlever clampParams", async () => {
    const out = await prepareMatch(store(), { lat: 55.6, lon: 13.0 }, params({ pointA: { lat: 55.6, lon: 13.0 }, pointB: A }));
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
