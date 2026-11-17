/**
 * THE FALL 02 and 04: the number of goals laid out is the number the intro, objective and radio name (three). Before this, a sparse
 * network could give two goals while the radio said "Three supply sites on your map" and "That is all three"
 * (docs/BUGG-THE-FALL-TVA-CHECKPOINTS.md). Now such a start is refused with the usual message, and Free Play is unchanged.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareMission } from "@/campaign/prepare";
import { missionParams } from "@/campaign/setup";
import { THE_FALL } from "@/campaign/the-fall";
import { TileStore, type Fetcher } from "@/data/store";
import { edgeLatLon } from "@/geo/graph/graph";
import { fromLocal, type LatLon } from "@/geo/geometry";
import { generateCourse } from "@/routes/course";
import { ORIGIN, gridGraph } from "@/sim/test-graphs";

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = new TileStore("/data/v1/varmland", fsFetch);
const mission = (id: string) => THE_FALL.missions.find((m) => m.id === id)!;
const cps = (p: { waypoints: { kind: string }[] }) => p.waypoints.filter((w) => w.kind === "checkpoint").length;

/** A start in I2-skogen, Karlstad (the campaign session tests use it too): a dense network. */
const I2: LatLon = { lat: 59.40731, lon: 13.46753 };
/**
 * Countryside west of Arvika: a few kilometres of connected road with only two usable junctions. Found by
 * scripts/campaign-goal-count.ts; before the fix missions 02 and 04 were laid out here with two goals on every seed.
 */
const SPARSE: LatLon = { lat: 59.51491, lon: 12.09913 };

describe("THE FALL: every checkpoint mission requires the number of goals it names", () => {
  it("02 and 04 ask for exactly three goals", () => {
    const layouts = THE_FALL.missions.map((m) => m.layout).filter((l) => l.kind === "checkpoints");
    expect(layouts).toHaveLength(2);
    for (const l of layouts) if (l.kind === "checkpoints") expect([l.count, l.minCount]).toEqual([3, 3]);
  });
});

describe("course generator: a required number of checkpoints", () => {
  it("drops a course with too few checkpoints instead of offering it", () => {
    // A 200 m square, started from the middle of one side: the two far corners are the only usable checkpoints.
    const g = gridGraph(2, 2, 200);
    const start = fromLocal(ORIGIN, { x: 100, y: 0 });
    const free = generateCourse(g, { start, activity: "walk", targetLengthM: 1500, seed: 1, count: 3 });
    expect(free.proposals.length).toBeGreaterThan(0);
    expect(Math.max(...free.proposals.map(cps))).toBeLessThan(3);
    expect(generateCourse(g, { start, activity: "walk", targetLengthM: 1500, seed: 1, count: 3, minCheckpoints: 3 }).proposals).toEqual([]);
  });

  it("without the option the generator is exactly as before (Free Play)", () => {
    const g = gridGraph(12, 12, 150);
    const start = edgeLatLon(g, { edgeId: [...g.edges.keys()][40], distM: 0 });
    for (const seed of [1, 2, 3, 4, 5]) {
      const strip = (r: ReturnType<typeof generateCourse>) => r.proposals.map((p) => [p.id, p.lengthM, p.waypoints.map((w) => w.nodeId)]);
      const a = generateCourse(g, { start, activity: "walk", targetLengthM: 2000, seed, count: 3 });
      const b = generateCourse(g, { start, activity: "walk", targetLengthM: 2000, seed, count: 3, minCheckpoints: 2 });
      expect(strip(b)).toEqual(strip(a));
    }
  });

  it("every course it offers has the required number", () => {
    const g = gridGraph(12, 12, 150);
    const start = edgeLatLon(g, { edgeId: [...g.edges.keys()][40], distM: 0 });
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const L of [600, 1000, 1500]) {
        for (const p of generateCourse(g, { start, activity: "walk", targetLengthM: L, seed, count: 3, minCheckpoints: 3 }).proposals) expect(cps(p)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("THE FALL 02 and 04 on real Värmland data", () => {
  it("a dense network gets three goals on every seed", async () => {
    for (const id of ["02", "04"]) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const r = await prepareMission(store, I2, mission(id), missionParams(THE_FALL, mission(id), "normal", seed));
        expect(r.status, `${id} seed ${seed}`).toBe("ok");
        expect(r.proposals).toHaveLength(1);
        expect(cps(r.proposals[0])).toBe(3);
      }
    }
  });

  it("a network with room for only two goals is refused, never laid out with two", async () => {
    for (const id of ["02", "04"]) {
      for (const seed of [1, 2, 3]) {
        const r = await prepareMission(store, SPARSE, mission(id), missionParams(THE_FALL, mission(id), "normal", seed));
        expect(r.status, `${id} seed ${seed}`).toBe("no_route");
        expect(r.proposals).toEqual([]);
        expect(r.message).toMatch(/Move to/);
      }
    }
    // The other missions still start there: the refusal is about the goals, not the place.
    const m1 = await prepareMission(store, SPARSE, mission("01"), missionParams(THE_FALL, mission("01"), "normal", 1));
    expect(m1.status).toBe("ok");
  });
});
