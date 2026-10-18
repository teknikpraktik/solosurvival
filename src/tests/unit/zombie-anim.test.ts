import { describe, expect, it } from "vitest";
import { ZombieAnimator } from "@/play/zombie-anim";
import { gridGraph } from "@/sim/test-graphs";
import { haversineM, projectToPolyline } from "@/geo/geometry";
import { nodeLatLon } from "@/geo/graph/graph";

const g = gridGraph(6, 6, 100);
const edges = [...g.edges.values()];
// Två intilliggande kanter via gemensam nod.
const e1 = edges[0];
const e2 = edges.find((e) => e.id !== e1.id && (e.from === e1.to || e.to === e1.to))!;
const nodeIsE1End = e1.to;
const distOnNew = (e: typeof e1, n: string) => (n === e.to ? e.lengthM : 0);

describe("ZombieAnimator (Testfall C)", () => {
  it("följer kantgeometrin över ett hörn utan att genvägar och utan hopp", () => {
    const a = new ZombieAnimator(g);
    const speed = 1;
    a.setTargets([{ id: "z1", edgeId: e1.id, distM: e1.lengthM - 3, speedMps: speed, chasing: false }]);
    const frames0 = a.frames()[0];
    // Mål: 3 m in på nästa kant, alltså 6 m längs vägen (över hörnet).
    const into = distOnNew(e2, nodeIsE1End);
    const dir = into === 0 ? 1 : -1;
    a.setTargets([{ id: "z1", edgeId: e2.id, distM: into + dir * 3, speedMps: speed, chasing: false }]);
    let prev = frames0;
    let traveled = 0;
    for (let i = 0; i < 120; i++) {
      a.step(1 / 60);
      const f = a.frames()[0];
      const step = haversineM(prev, f);
      traveled += step;
      expect(step).toBeLessThan(speed * 6 / 60 + 0.01); // aldrig snabbare än ~6 × fart
      // Ligger på en av de två kanterna.
      const d1 = projectToPolyline(e1.geometry, e1.cumM, f).distanceM;
      const d2 = projectToPolyline(e2.geometry, e2.cumM, f).distanceM;
      expect(Math.min(d1, d2)).toBeLessThan(0.05);
      prev = f;
    }
    const end = a.frames()[0];
    expect(projectToPolyline(e2.geometry, e2.cumM, end).distanceM).toBeLessThan(0.05);
    expect(traveled).toBeGreaterThan(5.5); // gick hela vägen via hörnet (~6 m), inte rakt över
    void nodeLatLon;
  });

  it("jämn rörelse mellan uppdateringar på samma kant", () => {
    const a = new ZombieAnimator(g);
    a.setTargets([{ id: "z", edgeId: e1.id, distM: 10, speedMps: 1, chasing: true }]);
    a.setTargets([{ id: "z", edgeId: e1.id, distM: 10.5, speedMps: 1, chasing: true }]);
    const pos: number[] = [];
    for (let i = 0; i < 40; i++) { a.step(1 / 60); pos.push(haversineM(a.frames()[0], { lat: e1.geometry[0].lat, lon: e1.geometry[0].lon })); }
    for (let i = 1; i < pos.length; i++) expect(pos[i] - pos[i - 1]).toBeGreaterThanOrEqual(-1e-6);
    expect(pos.at(-1)! - pos[0]).toBeGreaterThan(0.2);
  });

  it("stora avstånd (spawn/omplacering) snappas; borttagna zombier försvinner", () => {
    const a = new ZombieAnimator(g);
    a.setTargets([{ id: "z", edgeId: e1.id, distM: 5, speedMps: 1, chasing: false }]);
    const far = edges[edges.length - 1];
    a.setTargets([{ id: "z", edgeId: far.id, distM: 20, speedMps: 1, chasing: false }]);
    a.step(1 / 60);
    const f = a.frames()[0];
    expect(projectToPolyline(far.geometry, far.cumM, f).distanceM).toBeLessThan(0.05);
    a.setTargets([]);
    expect(a.frames()).toHaveLength(0);
  });

  it("når målet och står sedan stilla (ingen drift)", () => {
    const a = new ZombieAnimator(g);
    a.setTargets([{ id: "z", edgeId: e1.id, distM: 10, speedMps: 1, chasing: false }]);
    a.setTargets([{ id: "z", edgeId: e1.id, distM: 12, speedMps: 1, chasing: false }]);
    for (let i = 0; i < 300; i++) a.step(1 / 60);
    const a1 = a.frames()[0];
    for (let i = 0; i < 60; i++) a.step(1 / 60);
    expect(haversineM(a1, a.frames()[0])).toBeLessThan(1e-6);
  });
});
