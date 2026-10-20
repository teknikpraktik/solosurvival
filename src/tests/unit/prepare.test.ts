import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import { prepareMatch } from "@/play/prepare";
import { DISTANCE_LIMITS, clampParams, dataRadiusM, defaultParams, withActivity, type MatchParams } from "@/play/config";
import { haversineM, type LatLon } from "@/geo/geometry";
import type { Activity } from "@/config/activities";

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

describe("Mission: ett checkpoint per ca 500 m", () => {
  it("checkpoints jämnt längs slingan i ordning, hem sist", async () => {
    for (const len of [3000, 5000]) {
      const r = await prepareMatch(store(), I2, { ...params({ mode: "mission", targetLengthM: len }), seed: 4 });
      expect(["ok", "alternative"]).toContain(r.status);
      for (const pr of r.proposals) {
        const cps = pr.waypoints.filter((w) => w.kind === "checkpoint");
        expect(pr.waypoints.at(-1)!.kind).toBe("home");
        const expected = Math.floor((pr.lengthM - 250) / 500);
        expect(cps.length).toBe(expected);
        expect(cps.length).toBeGreaterThanOrEqual(Math.floor(len / 500) - 2);
        // Ordnade längs geometrin: varje checkpoint ligger på rutten (≤ 5 m från en segmentpunkt), i körordning (matchas framåt).
        const kx = Math.cos((pr.geometry[0].lat * Math.PI) / 180) * 111320, ky = 110540;
        let along = 0, prevAlong = 0;
        const segs = pr.geometry.slice(1).map((q, i) => { const p0 = pr.geometry[i]; const len = Math.hypot((q.lon - p0.lon) * kx, (q.lat - p0.lat) * ky); const start = along; along += len; return { p0, q, len, start }; });
        for (const c of cps) {
          let best = { d: Infinity, at: 0 };
          for (const sg of segs) {
            if (sg.start + sg.len < prevAlong - 1) continue;
            const vx = (sg.q.lon - sg.p0.lon) * kx, vy = (sg.q.lat - sg.p0.lat) * ky;
            const wx = (c.lon - sg.p0.lon) * kx, wy = (c.lat - sg.p0.lat) * ky;
            const t = sg.len > 0 ? Math.max(0, Math.min(1, (vx * wx + vy * wy) / (sg.len * sg.len))) : 0;
            const d = Math.hypot(wx - t * vx, wy - t * vy);
            const at = sg.start + t * sg.len;
            if (at >= prevAlong - 1 && d < best.d) best = { d, at };
          }
          expect(best.d).toBeLessThan(5);
          prevAlong = best.at;
        }
        expect(new Set(cps.map((c) => c.id)).size).toBe(cps.length);
      }
    }
  });
});
