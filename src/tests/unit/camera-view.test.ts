import { describe, expect, it } from "vitest";
import { nextClose, viewProfile, viewZoom } from "@/play/camera-view";

const BIKE = viewProfile("mtb"), FOOT = viewProfile("walk");

/** Metres per CSS pixel at a zoom level (MapLibre world size 512 · 2^z). */
const mpp = (z: number, lat: number) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** z);

describe("viewZoom", () => {
  it("fits 1 km ahead and behind the player between the screen centre and the edges", () => {
    for (const h of [640, 844, 932]) {
      const z = viewZoom(59.4, h, BIKE.aheadM);
      expect((h / 2) * mpp(z, 59.4)).toBeCloseTo(BIKE.aheadM, 0);
    }
  });
  it("gives a sensible side view on a phone (about 0.4–0.5 km on 390 px)", () => {
    const side = 195 * mpp(viewZoom(59.4, 844, BIKE.aheadM), 59.4);
    expect(side).toBeGreaterThan(380);
    expect(side).toBeLessThan(520);
  });
  it("stays inside the map zoom limits", () => {
    expect(viewZoom(59.4, 100, BIKE.aheadM)).toBeLessThanOrEqual(18);
    expect(viewZoom(89, 5000, BIKE.aheadM)).toBeGreaterThanOrEqual(10);
  });
  it("close view fits 300 m ahead", () => {
    const z = viewZoom(59.4, 844, BIKE.closeAheadM);
    expect(422 * mpp(z, 59.4)).toBeCloseTo(300, 0);
  });
  it("zooms in at 200 m and out only beyond 260 m (hysteresis), never without zombies", () => {
    expect(nextClose(false, 250, BIKE)).toBe(false);
    expect(nextClose(false, 200, BIKE)).toBe(true);
    expect(nextClose(true, 240, BIKE)).toBe(true);
    expect(nextClose(true, 261, BIKE)).toBe(false);
    expect(nextClose(true, null, BIKE)).toBe(false);
  });
  it("on foot: 400 m normal view, 150 m when a zombie is within 100 m (out again beyond 130 m)", () => {
    expect(FOOT.aheadM).toBeLessThan(BIKE.aheadM);
    expect(422 * mpp(viewZoom(59.4, 844, FOOT.aheadM), 59.4)).toBeCloseTo(400, 0);
    expect(422 * mpp(viewZoom(59.4, 844, FOOT.closeAheadM), 59.4)).toBeCloseTo(150, 0);
    expect(viewZoom(59.4, 844, FOOT.closeAheadM)).toBeLessThanOrEqual(18);
    expect(nextClose(false, 101, FOOT)).toBe(false);
    expect(nextClose(false, 100, FOOT)).toBe(true);
    expect(nextClose(true, 130, FOOT)).toBe(true);
    expect(nextClose(true, 131, FOOT)).toBe(false);
  });
});
