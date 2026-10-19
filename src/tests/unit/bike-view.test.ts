import { describe, expect, it } from "vitest";
import { BIKE_VIEW_AHEAD_M, BIKE_VIEW_CLOSE_AHEAD_M, nextBikeClose, bikeZoom } from "@/play/bike-view";

/** Metres per CSS pixel at a zoom level (MapLibre world size 512 · 2^z). */
const mpp = (z: number, lat: number) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** z);

describe("bikeZoom", () => {
  it("fits 1 km ahead and behind the player between the screen centre and the edges", () => {
    for (const h of [640, 844, 932]) {
      const z = bikeZoom(59.4, h);
      expect((h / 2) * mpp(z, 59.4)).toBeCloseTo(BIKE_VIEW_AHEAD_M, 0);
    }
  });
  it("gives a sensible side view on a phone (about 0.4–0.5 km on 390 px)", () => {
    const side = 195 * mpp(bikeZoom(59.4, 844), 59.4);
    expect(side).toBeGreaterThan(380);
    expect(side).toBeLessThan(520);
  });
  it("stays inside the map zoom limits", () => {
    expect(bikeZoom(59.4, 100)).toBeLessThanOrEqual(18);
    expect(bikeZoom(89, 5000)).toBeGreaterThanOrEqual(10);
  });
  it("close view fits 300 m ahead", () => {
    const z = bikeZoom(59.4, 844, BIKE_VIEW_CLOSE_AHEAD_M);
    expect(422 * mpp(z, 59.4)).toBeCloseTo(300, 0);
  });
  it("zooms in at 200 m and out only beyond 260 m (hysteresis), never without zombies", () => {
    expect(nextBikeClose(false, 250)).toBe(false);
    expect(nextBikeClose(false, 200)).toBe(true);
    expect(nextBikeClose(true, 240)).toBe(true);
    expect(nextBikeClose(true, 261)).toBe(false);
    expect(nextBikeClose(true, null)).toBe(false);
  });
});
