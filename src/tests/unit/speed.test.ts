import { describe, expect, it } from "vitest";
import { SpeedTracker, SPEED_STALE_MS } from "@/play/speed";

const at = (m: number) => ({ lat: 59.4, lon: 13.4 + m / 55_400 }); // ≈ m metres east at 59.4°N

describe("SpeedTracker", () => {
  it("uses device speed when present, smoothed", () => {
    const s = new SpeedTracker();
    s.push(at(0), 0, 5);
    s.push(at(5), 1000, 5);
    expect(s.speedAt(1000)).toBeCloseTo(5, 5);
  });
  it("derives speed from positions when the device gives none", () => {
    const s = new SpeedTracker();
    for (let i = 0; i <= 6; i++) s.push(at(i * 4), i * 1000);
    const v = s.speedAt(6000)!;
    expect(v).toBeGreaterThan(3.5);
    expect(v).toBeLessThan(4.5);
  });
  it("reports 0 when standing still and null when readings are stale", () => {
    const s = new SpeedTracker();
    s.push(at(0), 0, 0.1);
    expect(s.speedAt(500)).toBe(0);
    expect(s.speedAt(SPEED_STALE_MS + 1)).toBeNull();
  });
  it("is null before any reading", () => { expect(new SpeedTracker().speedAt(0)).toBeNull(); });
});
