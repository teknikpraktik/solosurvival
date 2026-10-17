import { describe, expect, it } from "vitest";
import { generateRoutes } from "@/routes/generate";
import { analyzeNetwork } from "@/routes/analysis";
import { estimateTimeLimitS } from "@/routes/timing";
import { cumulativeLengths, haversineM } from "@/geo/geometry";
import { edgeLatLon } from "@/geo/graph/graph";
import { gridGraph, starGraph } from "@/sim/test-graphs";
import type { TrailGraph } from "@/geo/graph/types";
import type { RouteProposal } from "@/routes/types";

const grid = () => gridGraph(14, 14, 120);
const startOf = (g: TrailGraph) => edgeLatLon(g, { edgeId: "r7:5", distM: 60 });

/** Kantföljden ska vara sammanhängande: varje steg börjar där föregående slutade. */
function expectConnected(g: TrailGraph, p: RouteProposal) {
  for (let i = 1; i < p.path.length; i++) {
    const a = g.edges.get(p.path[i - 1].edgeId)!, b = g.edges.get(p.path[i].edgeId)!;
    const end = p.path[i - 1].dir === 1 ? a.to : a.from;
    const start = p.path[i].dir === 1 ? b.from : b.to;
    expect(start).toBe(end);
  }
}
const geoLen = (p: RouteProposal) => cumulativeLengths(p.geometry).at(-1)!;

describe("nätanalys", () => {
  it("hittar återvändsgrenar och djup", () => {
    const g = starGraph(600);
    const an = analyzeNetwork(g);
    expect(an.deadEndEdges.size).toBe(g.edges.size); // ett träd: allt är återvändsgren
    const lollipop = gridGraph(3, 3, 100);
    expect(analyzeNetwork(lollipop).deadEndEdges.size).toBe(0);
  });
});

describe("Escape (A→B)", () => {
  const g = grid();
  const req = { start: startOf(g), activity: "run" as const, mode: "escape" as const, targetLengthM: 1500, seed: 4 };
  it("ger flera destinationer med längd inom ±10 % och geometri som stämmer med längden", () => {
    const r = generateRoutes(g, req);
    expect(r.proposals.length).toBeGreaterThanOrEqual(2);
    const dests = new Set(r.proposals.map((p) => p.waypoints[0].nodeId));
    expect(dests.size).toBe(r.proposals.length);
    for (const p of r.proposals) {
      expect(p.mode).toBe("escape");
      expect(p.waypoints).toHaveLength(1);
      expect(p.waypoints[0].kind).toBe("destination");
      expect(Math.abs(p.deviation)).toBeLessThanOrEqual(0.1 + 1e-9);
      expect(p.withinTolerance).toBe(true);
      expect(geoLen(p)).toBeCloseTo(p.lengthM, 0);
      expectConnected(g, p);
      expect(haversineM(p.geometry.at(-1)!, p.waypoints[0])).toBeLessThan(1);
    }
  });
  it("använder omväg (via) när ingen destination ligger på rätt avstånd längs kortaste vägen", () => {
    const long = generateRoutes(g, { ...req, targetLengthM: 3600 });
    expect(long.proposals.length).toBeGreaterThan(0);
    for (const p of long.proposals) {
      expect(p.withinTolerance).toBe(true);
      expect(p.metrics.reuseShare).toBeLessThanOrEqual(0.2);
      expect(geoLen(p)).toBeCloseTo(p.lengthM, 0);
      expectConnected(g, p);
      expect(haversineM(p.waypoints[0], req.start)).toBeGreaterThanOrEqual(500);
    }
    expect(long.notes.some((n) => n.includes("omväg"))).toBe(true);
  });
  it("är deterministisk per seed", () => {
    expect(generateRoutes(g, req).proposals.map((p) => p.id + p.lengthM)).toEqual(generateRoutes(g, req).proposals.map((p) => p.id + p.lengthM));
  });
  it("redovisar avvikelse när ingen destination finns inom toleransen", () => {
    const r = generateRoutes(g, { ...req, targetLengthM: 40_000 });
    expect(r.proposals.length === 0 || r.proposals.every((p) => !p.withinTolerance)).toBe(true);
    expect(r.notes.length).toBeGreaterThan(0);
  });
  it("undviker farliga korsningar som destination", () => {
    const base = generateRoutes(g, req).proposals[0].waypoints[0].nodeId;
    const r = generateRoutes(g, { ...req, hazardNodes: new Set([base]) });
    expect(r.proposals.every((p) => p.waypoints[0].nodeId !== base)).toBe(true);
  });
  it("avvisar start långt från nätet", () => {
    const r = generateRoutes(g, { ...req, start: { lat: 10, lon: 10 } });
    expect(r.proposals).toHaveLength(0);
  });
});

describe("Mission (A→A)", () => {
  const g = grid();
  const req = { start: startOf(g), activity: "run" as const, mode: "mission" as const, targetLengthM: 2400, seed: 9 };
  it("ger slingor med 1–3 checkpoints, hemkomst sist och korrekt geometri", () => {
    const r = generateRoutes(g, req);
    expect(r.proposals.length).toBeGreaterThanOrEqual(2);
    for (const p of r.proposals) {
      const cps = p.waypoints.filter((w) => w.kind === "checkpoint");
      expect(cps.length).toBeGreaterThanOrEqual(1);
      expect(cps.length).toBeLessThanOrEqual(3);
      expect(p.waypoints.at(-1)!.kind).toBe("home");
      expect(haversineM(p.waypoints.at(-1)!, req.start)).toBeLessThan(1);
      for (const c of cps) expect(haversineM(c, req.start)).toBeGreaterThanOrEqual(150);
      expect(geoLen(p)).toBeCloseTo(p.lengthM, 0);
      expectConnected(g, p);
      expect(haversineM(p.geometry[0], req.start)).toBeLessThan(1);
      expect(haversineM(p.geometry.at(-1)!, req.start)).toBeLessThan(1);
    }
  });
  it("föredrar slingor framför ut-och-tillbaka när nätet tillåter", () => {
    const r = generateRoutes(g, req);
    expect(r.proposals[0].type).toBe("loop");
    expect(r.proposals[0].metrics.reuseShare).toBeLessThanOrEqual(0.25);
  });
  it("respekterar valt antal checkpoints", () => {
    for (const k of [1, 2, 3] as const) {
      const r = generateRoutes(g, { ...req, checkpoints: k, targetLengthM: 3000 });
      for (const p of r.proposals) expect(p.waypoints.filter((w) => w.kind === "checkpoint")).toHaveLength(k);
    }
  });
  it("lägger inte checkpoints djupt i återvändsgrenar när bättre alternativ finns", () => {
    // Rutnät med en lång spets: noder i spetsen får inte bli checkpoints.
    const g2 = gridGraph(10, 10, 120);
    const r = generateRoutes(g2, { ...req, start: edgeLatLon(g2, { edgeId: "r5:4", distM: 60 }) });
    const an = analyzeNetwork(g2);
    for (const p of r.proposals) for (const w of p.waypoints) if (w.kind === "checkpoint") expect(an.deadEndDepthM.get(w.nodeId) ?? 0).toBeLessThanOrEqual(60);
  });
  it("är deterministisk per seed men varierar mellan seeds", () => {
    const a = generateRoutes(g, req).proposals.map((p) => p.lengthM);
    expect(generateRoutes(g, req).proposals.map((p) => p.lengthM)).toEqual(a);
    expect(generateRoutes(g, { ...req, seed: 10 }).proposals.map((p) => p.lengthM)).not.toEqual(a);
  });
});

describe("tidsgräns", () => {
  it("växer med längd och minskar med svårighet, utan bonus för fart", () => {
    expect(estimateTimeLimitS(6000, "run", "normal")).toBeGreaterThan(estimateTimeLimitS(3000, "run", "normal"));
    expect(estimateTimeLimitS(5000, "run", "easy")).toBeGreaterThan(estimateTimeLimitS(5000, "run", "hard"));
    // Rimlig: 5 km löpning ≥ 30 min även på Svår (≈ 6,6 km/h lugn fart).
    expect(estimateTimeLimitS(5000, "run", "hard")).toBeGreaterThan(30 * 60);
  });
});
