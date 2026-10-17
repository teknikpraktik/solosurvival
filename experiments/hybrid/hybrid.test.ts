import { describe, expect, it } from "vitest";
import { AREAS } from "./areas";
import { areaCtx, hybridFor } from "./lib/experiment";
import { blockersFor } from "./lib/blockers";
import { DEFAULT_HYBRID, type HybridConfig } from "./lib/hybrid-graph";
import { mapToHybrid } from "./lib/pairing";
import { C, coverage, classAt } from "./lib/raster";
import { edgeLatLon, trailOf } from "@/geo/graph/graph";
import { haversineM, toLocal } from "@/geo/geometry";

const cfg = (over: Partial<HybridConfig> = {}): HybridConfig => ({ ...DEFAULT_HYBRID, offroadFactor: 0.25, maxLinkM: 150, ...over });

describe("fixturer och terräng (verklig OSM-data)", () => {
  it("terrängen har rimlig täckning och Vänern finns vid Skutberget", () => {
    const cov = coverage(areaCtx("skutberget", "run").raster);
    expect(cov["vatten"]).toBeGreaterThan(0.3); // Vänern kommer från en ofullständig relation som sluts mot rutans kant
    expect(cov["okänd"]).toBeLessThan(0.3);
    expect(coverage(areaCtx("sormon", "run").raster)["skog"]).toBeGreaterThan(0.6);
  });
  it("stigar ligger (nästan) aldrig i vatten eller byggnader", () => {
    for (const a of AREAS) {
      const c = areaCtx(a.id, "run");
      let n = 0, bad = 0;
      for (const e of c.ag.trailIndexed.edges.values()) for (const p of e.geometry) {
        const l = toLocal(c.ag.fx.origin, p);
        n++;
        const k = classAt(c.raster, l.x, l.y);
        if (k === C.WATER || k === C.BUILDING) bad++;
      }
      expect(bad / n).toBeLessThan(0.005);
    }
  });
});

describe("hybridgraf på verklig data", () => {
  for (const area of ["sormon", "skutberget"] as const) {
    const c = areaCtx(area, "mtb");
    for (const [name, config] of [["B2-25", cfg()], ["B3-25", cfg({ maxLinkM: 400 })], ["B2-25-nms", cfg({ dedupeM: 40 })]] as const) {
      it(`${area} ${name}: längdgräns, anslutning, hinder och tidsnytta`, () => {
        const h = hybridFor(c, config);
        const g = h.indexed;
        const blockers = blockersFor(c.raster);
        expect(h.links.length).toBeGreaterThan(0);
        const onTrail = new Set<string>();
        for (const e of trailOf(g).edges.values()) { onTrail.add(e.from); onTrail.add(e.to); }
        for (const e of g.edges.values()) {
          if (!e.offroad) continue;
          expect(e.lengthM).toBeLessThanOrEqual(config.maxLinkM + 0.5);
          expect(e.speedFactor).toBe(config.offroadFactor);
          // Båda ändar är noder på stigarna (kedjan av off-road begränsas därmed till en förbindelse).
          expect(onTrail.has(e.from)).toBe(true);
          expect(onTrail.has(e.to)).toBe(true);
          const a = toLocal(c.ag.fx.origin, e.geometry[0]), b = toLocal(c.ag.fx.origin, e.geometry[1]);
          expect(blockers.segmentBlocked([a.x, a.y], [b.x, b.y])).toBe(false);
          expect(a.x).toBeGreaterThanOrEqual(0); expect(b.x).toBeLessThanOrEqual(c.ag.fx.widthM);
        }
        for (const l of h.links) expect(l.benefit).toBeGreaterThanOrEqual(config.minBenefit);
      });
    }
    it(`${area}: delning av stigar bevarar total längd och komponenter`, () => {
      const h = hybridFor(c, cfg());
      const base = c.ag.trailIndexed;
      const sum = (g: typeof base) => [...g.edges.values()].filter((e) => !e.offroad).reduce((s, e) => s + e.lengthM, 0);
      expect(sum(h.indexed)).toBeCloseTo(sum(base), 0);
      expect(trailOf(h.indexed).components.length).toBe(base.components.length);
      expect(h.indexed.nodes.size).toBeGreaterThan(base.nodes.size);
      expect([...h.indexed.nodes.values()].filter((n) => n.virtual).length).toBeGreaterThan(0);
    });
    it(`${area}: positioner flyttas exakt från basgraf till hybridgraf`, () => {
      const h = hybridFor(c, cfg());
      const base = c.ag.trailIndexed;
      let checked = 0;
      for (const e of [...base.edges.values()].slice(0, 80)) {
        for (const f of [0.1, 0.5, 0.9]) {
          const d = e.lengthM * f;
          const p = mapToHybrid(h.indexed, e.id, d);
          expect(haversineM(edgeLatLon(base, { edgeId: e.id, distM: d }), edgeLatLon(h.indexed, { edgeId: p.edgeId, distM: p.distM }))).toBeLessThan(0.05);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(100);
    });
  }
  it("NMS minskar antalet förbindelser", () => {
    const c = areaCtx("sormon", "mtb");
    expect(hybridFor(c, cfg({ dedupeM: 40 })).links.length).toBeLessThan(hybridFor(c, cfg()).links.length);
  });
  it("striktare terrängpolicy ger inte fler förbindelser än tillåtande", () => {
    const c = areaCtx("skutberget", "mtb");
    expect(hybridFor(c, cfg()).links.length).toBeLessThanOrEqual(hybridFor(c, cfg({ terrain: "permissive" })).links.length);
  });
});
