import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import { prepareMatch } from "@/play/prepare";
import { defaultParams, withActivity, type MatchParams } from "@/play/config";
import { edgeLatLon } from "@/geo/graph/graph";
import type { LatLon } from "@/geo/geometry";
import { analyzeNetwork } from "@/routes/analysis";
import { generateRoutes, isCleanLoop, streetOf } from "@/routes/generate";

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = () => new TileStore("/data/v1/varmland", fsFetch);
const I2: LatLon = { lat: 59.40731, lon: 13.46753 };
const SKUT: LatLon = { lat: 59.37316, lon: 13.39471 };

const step = (edgeId: string, dir: 1 | -1 = 1) => ({ edgeId, dir });
const ctx = (startEdge: string) => ({ g: undefined as never, an: undefined as never, start: { edgeId: startEdge, distM: 10 } });

describe("isCleanLoop", () => {
  const none = new Set<string>();
  it("accepts a simple loop; the start edge may be used twice in the same direction (both halves)", () => {
    expect(isCleanLoop(ctx("1:0"), [step("1:0"), step("2:0"), step("3:0"), step("4:0"), step("1:0")], none)).toBe(true);
  });
  it("rejects turning back (dead end): the same edge both ways", () => {
    expect(isCleanLoop(ctx("1:0"), [step("1:0"), step("2:0"), step("3:0"), step("3:0", -1), step("2:0", -1), step("4:0")], none)).toBe(false);
  });
  it("rejects the start edge walked back over itself (opposite directions)", () => {
    expect(isCleanLoop(ctx("1:0"), [step("1:0"), step("2:0"), step("3:0"), step("1:0", -1)], none)).toBe(false);
  });
  it("rejects using the same street twice, even on different edges and with other streets in between", () => {
    expect(isCleanLoop(ctx("1:0"), [step("1:0"), step("7:0"), step("2:0"), step("7:1"), step("3:0"), step("1:0")], none)).toBe(false);
    expect(isCleanLoop(ctx("1:0"), [step("1:0"), step("7:0"), step("7:1"), step("2:0"), step("1:0")], none)).toBe(true); // one continuous stretch is fine
  });
  it("allows reuse inside the dead-end spur the start lies in (unavoidable)", () => {
    expect(isCleanLoop(ctx("9:0"), [step("9:0"), step("9:1"), step("2:0"), step("3:0"), step("9:1", -1), step("9:0", -1)], new Set(["9:0", "9:1"]))).toBe(true);
  });
  it("street key strips edge index and split part", () => {
    expect(streetOf("123:4")).toBe("123");
    expect(streetOf("123.2:0")).toBe("123");
  });
});

describe("Mission routes are loops without dead ends or repeated streets (real Värmland data)", { timeout: 120000 }, () => {
  const cases: [string, LatLon, "walk" | "mtb", number][] = [
    ["I2", I2, "walk", 2000], ["I2", I2, "walk", 3000], ["I2", I2, "walk", 5000], ["I2", I2, "mtb", 10000], ["SKUT", SKUT, "walk", 2000], ["SKUT", SKUT, "walk", 3000],
  ];
  for (const [name, A, act, len] of cases) {
    it(`${name} ${act} ${len} m: every proposal is clean`, async () => {
      for (const seed of [1, 2, 3]) {
        const p: MatchParams = { ...withActivity(defaultParams(act), act), mode: "mission", seed, targetLengthM: len };
        const r = await prepareMatch(store(), A, p);
        expect(["ok", "alternative", "no_route"]).toContain(r.status);
        if (!r.graph) continue;
        const an = analyzeNetwork(r.graph);
        for (const pr of r.proposals) {
          const start = { edgeId: pr.path[0].edgeId, distM: 0 };
          expect(isCleanLoop({ g: r.graph, an, start }, pr.path, new Set())).toBe(true);
          expect(pr.metrics.reuseShare).toBeLessThan(0.02);
          expect(pr.metrics.deadEndShare).toBe(0);
          // every checkpoint lies in the main network (never inside a dead end)
          for (const w of pr.waypoints.filter((x) => x.kind === "checkpoint")) expect(an.deadEndDepthM.get(w.nodeId) ?? 0).toBe(0);
        }
      }
    });
  }
  it("a start inside a dead-end spur still gets routes, with reuse only inside that spur", async () => {
    const pre = await prepareMatch(store(), I2, { ...withActivity(defaultParams("walk"), "walk"), mode: "survival", seed: 1 });
    const g = pre.graph!;
    const an = analyzeNetwork(g);
    const spurEdge = [...g.edges.values()].filter((e) => an.deadEndEdges.has(e.id) && e.lengthM > 80).sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!spurEdge) return; // no suitable spur in the data: nothing to test
    const start = edgeLatLon(g, { edgeId: spurEdge.id, distM: spurEdge.lengthM / 2 });
    const res = generateRoutes(g, { start, activity: "walk", mode: "mission", targetLengthM: 3000, seed: 3, count: 3, samples: 200, hazardNodes: new Set() });
    for (const pr of res.proposals) {
      const dups = new Map<string, number>();
      for (const s of pr.path) dups.set(s.edgeId, (dups.get(s.edgeId) ?? 0) + 1);
      for (const [id, n] of dups) if (n > 1) expect(an.deadEndEdges.has(id)).toBe(true);
    }
  });
});
