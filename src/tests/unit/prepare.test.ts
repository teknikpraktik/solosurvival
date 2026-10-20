import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import { prepareMatch } from "@/play/prepare";
import { DISTANCE_LIMITS, clampParams, dataRadiusM, defaultParams, withActivity, type MatchParams } from "@/play/config";
import { haversineM, type LatLon } from "@/geo/geometry";
import type { Activity } from "@/config/activities";
import { analyzeNetwork } from "@/routes/analysis";

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => {
  const rel = url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "");
  try {
    const body = JSON.parse(readFileSync(path.join(root, rel), "utf8"));
    return { ok: true, status: 200, json: async () => body };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};
const store = () => new TileStore("/data/v1/varmland", fsFetch);
// Riktiga koordinater i Värmland (ungefärliga stigpunkter vid Skutberget/Karlstad).
const SKUTBERGET: LatLon = { lat: 59.37316, lon: 13.39471 }; // stigkorsning vid Skutberget (OSM)
const I2: LatLon = { lat: 59.40731, lon: 13.46753 }; // stigkorsning I2-skogen (OSM)

const params = (over: Partial<MatchParams>): MatchParams => ({ ...defaultParams("walk"), seed: 7, ...over });

describe("prepareMatch (riktiga Värmlandsdata)", { timeout: 60000 }, () => {
  for (const activity of ["walk", "run", "mtb"] as Activity[]) {
    for (const mode of ["escape", "mission"] as const) {
      it(`${mode}/${activity}: ger acceptabla förslag inom gränserna`, async () => {
        const p = withActivity(params({ mode }), activity);
        const r = await prepareMatch(store(), I2, p);
        expect(["ok", "alternative"]).toContain(r.status);
        expect(r.proposals.length).toBeGreaterThan(0);
        for (const pr of r.proposals) {
          expect(Math.abs(pr.deviation)).toBeLessThanOrEqual(0.25);
          expect(pr.metrics.hazardCrossings).toBe(0);
        }
        expect(r.load!.tiles).toBeLessThanOrEqual(20);
        expect(r.timing.totalMs).toBeLessThan(10000);
        console.log(mode, activity, r.status, r.proposals.map((x) => `${Math.round(x.lengthM)}m q${x.quality.score}`).join(" | "), "tiles", r.load!.tiles, "ms", Math.round(r.timing.totalMs), "MB(gz)", (r.load!.networkGzipBytes / 1e6).toFixed(2));
      });
    }
  }

  it("survival ger graf men inga rutter", async () => {
    const r = await prepareMatch(store(), SKUTBERGET, params({ mode: "survival" }));
    expect(r.status).toBe("ok");
    expect(r.proposals).toHaveLength(0);
    expect(r.graph).toBeDefined();
  });

  it("start utanför nätet: tydligt avslag", async () => {
    const r = await prepareMatch(store(), { lat: 59.2, lon: 13.2 }, params({ mode: "mission" })); // Vänern
    expect(r.status).toBe("off_network");
    expect(r.message).toBeTruthy();
    expect(r.proposals).toHaveLength(0);
  });

  it("start utanför regionen", async () => {
    const r = await prepareMatch(store(), { lat: 55.6, lon: 13.0 }, params({}));
    expect(r.status).toBe("outside_region");
  });

  it("orimligt lång sträcka i gles trakt avslås", async () => {
    const p = withActivity(params({ mode: "escape" }), "mtb");
    const r = await prepareMatch(store(), { lat: 60.62, lon: 12.9 }, { ...p, targetLengthM: 30000 });
    expect(["sparse", "off_network", "no_route", "outside_region", "alternative", "ok"]).toContain(r.status);
    if (r.status !== "ok") expect(r.message).toBeTruthy();
  });

  it("deterministisk per seed", async () => {
    const a = await prepareMatch(store(), I2, params({ mode: "mission", seed: 11 }));
    const b = await prepareMatch(store(), I2, params({ mode: "mission", seed: 11 }));
    expect(a.proposals.map((x) => x.edgeIds.join())).toEqual(b.proposals.map((x) => x.edgeIds.join()));
  });
});

describe("matchinställningar", () => {
  it("gränser per aktivitet och radie för datahämtning", () => {
    for (const a of ["walk", "run", "mtb"] as Activity[]) {
      const p = clampParams({ ...withActivity(defaultParams(a), a), targetLengthM: 1e6, durationS: 1 });
      expect(p.targetLengthM).toBe(DISTANCE_LIMITS[a].max);
      expect(p.durationS).toBeGreaterThan(600);
    }
    const r = dataRadiusM(params({ mode: "mission", targetLengthM: 3000 }));
    expect(r).toBeLessThan(2500);
  });
});

describe("Mission: bara checkpoints, ingen rutt, avstånd fågelvägen", () => {
  const cases: [string, LatLon, Activity, number][] = [
    ["I2", I2, "walk", 2000], ["I2", I2, "walk", 3000], ["I2", I2, "walk", 6000], ["I2", I2, "mtb", 5000], ["I2", I2, "mtb", 10000], ["I2", I2, "mtb", 20000],
    ["SKUT", SKUTBERGET, "walk", 2000], ["SKUT", SKUTBERGET, "walk", 5000], ["SKUT", SKUTBERGET, "mtb", 10000],
  ];
  for (const [name, A, act, len] of cases) {
    it(`${name} ${act} ${len} m: kurs genereras alltid; checkpoints i huvudnätet, hem sist, summa av fågelvägen ≈ önskad`, async () => {
      const r = await prepareMatch(store(), A, { ...params({ mode: "mission", targetLengthM: len }), activity: act, seed: 4 });
      expect(["ok", "alternative"]).toContain(r.status);
      expect(r.proposals.length).toBeGreaterThanOrEqual(1);
      const an = analyzeNetwork(r.graph!);
      for (const pr of r.proposals) {
        const cps = pr.waypoints.filter((w) => w.kind === "checkpoint");
        expect(pr.waypoints.at(-1)!.kind).toBe("home");
        expect(pr.edgeIds).toEqual([]); // ingen rutt
        expect(pr.path).toEqual([]);
        const spacing = act === "mtb" ? 1000 : 500;
        expect(cps.length).toBeGreaterThanOrEqual(Math.max(2, Math.round(len / spacing) - 2));
        expect(cps.length).toBeLessThanOrEqual(Math.round(len / spacing) + 1);
        // lengthM = sträckan start → checkpoints i ordning → start, fågelvägen
        const pts = [A, ...cps, A];
        let sum = 0;
        for (let i = 1; i < pts.length; i++) sum += haversineM(pts[i - 1], pts[i]);
        expect(Math.abs(sum - pr.lengthM)).toBeLessThan(1);
        if (r.status === "ok") expect(Math.abs(pr.deviation)).toBeLessThanOrEqual(0.1);
        for (const w of cps) {
          expect(r.graph!.nodes.has(w.nodeId)).toBe(true);
          expect(an.deadEndDepthM.get(w.nodeId) ?? 0).toBe(0);
          expect(haversineM(w, A)).toBeGreaterThanOrEqual(150);
        }
        expect(new Set(cps.map((c) => c.id)).size).toBe(cps.length);
      }
    });
  }
});
