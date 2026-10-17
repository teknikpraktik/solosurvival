import { describe, expect, it } from "vitest";
import { GpsFilter, classifyAccuracy } from "@/gps/filters/filter";
import { matchToNetwork } from "@/gps/map-matching/match";
import { gridGraph, ORIGIN } from "@/sim/test-graphs";
import { fromLocal } from "@/geo/geometry";

const fix = (x: number, y: number, t: number, acc = 5) => {
  const p = fromLocal(ORIGIN, { x, y });
  return { latitude: p.lat, longitude: p.lon, accuracyM: acc, timestampMs: t };
};

describe("GPS-filter", () => {
  it("klassificerar noggrannhet enligt PRD", () => {
    expect(classifyAccuracy(8)).toBe("ok");
    expect(classifyAccuracy(15)).toBe("verify");
    expect(classifyAccuracy(30)).toBe("infection_paused");
    expect(classifyAccuracy(50)).toBe("warning");
  });
  it("avvisar ogiltiga koordinater", () => {
    const f = new GpsFilter({ maxPlausibleSpeedMps: 8 });
    expect(f.push({ latitude: 200, longitude: 0, accuracyM: 5, timestampMs: 1000 }, 1000).verdict).toBe("invalid");
    expect(f.push({ latitude: NaN, longitude: 0, accuracyM: 5, timestampMs: 1000 }, 1000).verdict).toBe("invalid");
  });
  it("avvisar gamla fixar", () => {
    const f = new GpsFilter({ maxPlausibleSpeedMps: 8 });
    expect(f.push(fix(0, 0, 0), 60_000).verdict).toBe("stale");
  });
  it("avvisar hopp på 300 m men accepterar bestående flytt", () => {
    const f = new GpsFilter({ maxPlausibleSpeedMps: 8 });
    f.push(fix(0, 0, 0), 0);
    f.push(fix(3, 0, 1000), 1000);
    expect(f.push(fix(300, 0, 2000), 2000).verdict).toBe("jump");
    expect(f.position!.lon).toBeCloseTo(fromLocal(ORIGIN, { x: 3, y: 0 }).lon, 4);
    f.push(fix(301, 0, 3000), 3000);
    expect(f.push(fix(302, 0, 4000), 4000).verdict).toBe("reacquired");
  });
  it("skapar ingen konstgjord rörelse för stillastående spelare", () => {
    const f = new GpsFilter({ maxPlausibleSpeedMps: 8 });
    for (let i = 0; i < 20; i++) f.push(fix(Math.sin(i) * 4, Math.cos(i) * 4, i * 1000, 6), i * 1000);
    const p = f.position!;
    const o = fromLocal(ORIGIN, { x: 0, y: 0 });
    expect(Math.abs(p.lat - o.lat) * 111_320).toBeLessThan(5);
  });
  it("blir otillgänglig utan nya fixar", () => {
    const f = new GpsFilter({ maxPlausibleSpeedMps: 8 });
    f.push(fix(0, 0, 0), 0);
    expect(f.qualityAt(2000)).toBe("ok");
    expect(f.qualityAt(9000)).toBe("unavailable");
  });
});

describe("map matching", () => {
  it("matchar entydigt på en stig", () => {
    const g = gridGraph(3, 3, 300);
    const m = matchToNetwork(g, fromLocal(ORIGIN, { x: 150, y: 2 }), 5);
    expect(m.match).not.toBeNull();
  });
});
