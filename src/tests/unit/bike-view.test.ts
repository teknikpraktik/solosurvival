import { describe, expect, it } from "vitest";
import { BIKE_VIEW_AHEAD_M, bikeZoom } from "@/play/bike-view";

/** Metres per CSS pixel at a zoom level (MapLibre world size 512 · 2^z). */
const mpp = (z: number, lat: number) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** z);

describe("bikeZoom", () => {
  it("fits 500 m ahead and behind the player between the screen centre and the edges", () => {
    for (const h of [640, 844, 932]) {
      const z = bikeZoom(59.4, h);
      expect((h / 2) * mpp(z, 59.4)).toBeCloseTo(BIKE_VIEW_AHEAD_M, 0);
    }
  });
  it("gives a sensible side view on a phone (about ±200–250 m on 390 px)", () => {
    const side = 195 * mpp(bikeZoom(59.4, 844), 59.4);
    expect(side).toBeGreaterThan(180);
    expect(side).toBeLessThan(260);
  });
  it("stays inside the map zoom limits", () => {
    expect(bikeZoom(59.4, 100)).toBeLessThanOrEqual(18);
    expect(bikeZoom(89, 5000)).toBeGreaterThanOrEqual(10);
  });
});
