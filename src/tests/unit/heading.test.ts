import { describe, expect, it } from "vitest";
import { HeadingTracker, wrap180, unwrapToward } from "@/play/heading";
import { destinationPoint } from "./helpers";
import { fromLocal, type LatLon } from "@/geo/geometry";
import { rand } from "@/engine/core/rng";

const O: LatLon = { lat: 59.4, lon: 13.5 };
const rng = { rngState: 7 };
const noise = (sigma: number) => (rand(rng) + rand(rng) + rand(rng) - 1.5) * 2 * sigma * 0.8;

/** Simulerar 1 fix/s längs en bana av (kurs, fart, sekunder)-segment med GPS-brus och ev. rå kurs. */
function drive(t: HeadingTracker, legs: [number, number, number][], opts: { sigma?: number; acc?: number; gpsHeading?: boolean; start?: LatLon } = {}) {
  let p = opts.start ?? O;
  let ms = 0;
  const hist: (number | null)[] = [];
  for (const [bearing, speed, secs] of legs) {
    for (let i = 0; i < secs; i++) {
      p = destinationPoint(p, speed, bearing);
      ms += 1000;
      const noisy = opts.sigma ? fromLocal(p, { x: noise(opts.sigma), y: noise(opts.sigma) }) : p;
      hist.push(t.update({ pos: noisy, accuracyM: opts.acc ?? 6, gpsHeadingDeg: opts.gpsHeading && speed >= 1 ? bearing : null, gpsSpeedMps: opts.gpsHeading ? speed : null, tMs: ms }));
    }
  }
  return { hist, p, ms };
}
const near = (a: number | null, b: number, tol: number) => a !== null && Math.abs(wrap180(a - b)) <= tol;

describe("HeadingTracker (Testfall B)", () => {
  it("stillastående: ingen riktning och inget slumpmässigt skutt trots brus", () => {
    const t = new HeadingTracker();
    const { hist } = drive(t, [[0, 0, 300]], { sigma: 4, acc: 8 });
    expect(hist.every((h) => h === null)).toBe(true);
  });
  it("gång med brus: riktningen hittas och håller sig stabil", () => {
    const t = new HeadingTracker();
    const { hist } = drive(t, [[75, 1.3, 120]], { sigma: 3, acc: 8 });
    const late = hist.slice(40);
    expect(late.every((h) => near(h, 75, 20))).toBe(true);
  });
  it("cykling med GPS-kurs: följer snabbt", () => {
    const t = new HeadingTracker();
    const { hist } = drive(t, [[200, 5, 30]], { gpsHeading: true });
    expect(near(hist.at(-1)!, 200, 3)).toBe(true);
  });
  it("90° sväng: följer utan överskjutning och utan hopp över 360", () => {
    const t = new HeadingTracker();
    const { hist } = drive(t, [[350, 4, 30], [80, 4, 30]], { gpsHeading: true });
    expect(near(hist.at(-1)!, 80, 6)).toBe(true);
    for (let i = 1; i < hist.length; i++) if (hist[i] !== null && hist[i - 1] !== null) expect(Math.abs(wrap180(hist[i]! - hist[i - 1]!))).toBeLessThan(60);
  });
  it("U-sväng: byter riktning efter bekräftelse", () => {
    const t = new HeadingTracker();
    const { hist } = drive(t, [[90, 4, 20], [270, 4, 25]], { gpsHeading: true });
    expect(near(hist[19], 90, 5)).toBe(true);
    expect(near(hist.at(-1)!, 270, 10)).toBe(true);
  });
  it("stopp behåller senaste riktning; brusig låg fart ändrar den inte", () => {
    const t = new HeadingTracker();
    const a = drive(t, [[130, 4, 20]], { gpsHeading: true });
    const h = a.hist.at(-1)!;
    const { hist } = drive(t, [[0, 0, 200]], { sigma: 4, acc: 9, start: a.p });
    expect(hist.every((x) => x === h || near(x, h, 0.001))).toBe(true);
  });
  it("tillfälligt GPS-bortfall (inga uppdateringar) och dålig noggrannhet ändrar ingenting", () => {
    const t = new HeadingTracker();
    const a = drive(t, [[40, 1.4, 40]], { sigma: 2 });
    const h = t.heading!;
    // Dålig fix med påhittat hopp och låg noggrannhet.
    const bad = t.update({ pos: destinationPoint(a.p, 500, 250), accuracyM: 60, gpsHeadingDeg: 250, gpsSpeedMps: 9, tMs: a.ms + 1000 });
    expect(bad).toBe(h);
    // Lång paus utan data, sedan fortsatt gång åt samma håll.
    const b = drive(t, [[40, 1.4, 30]], { start: a.p, sigma: 2 });
    expect(near(b.hist.at(-1)!, 40, 25)).toBe(true);
  });
  it("kurs under 1 m/s används inte som GPS-kurs (brus)", () => {
    const t = new HeadingTracker();
    for (let i = 0; i < 20; i++) t.update({ pos: O, accuracyM: 5, gpsHeadingDeg: (i * 97) % 360, gpsSpeedMps: 0.4, tMs: i * 1000 });
    expect(t.heading).toBeNull();
  });
  it("unwrapToward tar kortaste vägen", () => {
    expect(unwrapToward(350, 10)).toBe(370);
    expect(unwrapToward(10, 350)).toBe(-10);
  });
});
