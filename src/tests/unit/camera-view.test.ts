import { describe, expect, it } from "vitest";
import { nextApproaching, nextClose, nextGoalClose, viewProfile, viewZoom } from "@/play/camera-view";

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
  it("player a little below the middle: the whole ahead distance fits above the player", () => {
    for (const v of [BIKE, FOOT]) {
      expect(v.playerY).toBeGreaterThan(0.5);
      expect(v.playerY).toBeLessThanOrEqual(0.65);
      for (const h of [640, 844]) {
        const z = viewZoom(59.4, h, v.aheadM, v.playerY);
        expect(v.playerY * h * mpp(z, 59.4)).toBeCloseTo(v.aheadM, 0);
        expect(v.playerY * h * mpp(viewZoom(59.4, h, v.closeAheadM, v.playerY), 59.4)).toBeCloseTo(v.closeAheadM, 0);
      }
    }
    expect(BIKE.aheadM).toBe(1000);
    expect(BIKE.closeAheadM).toBe(300);
  });
  it("zooms in near the next goal and out again when it is taken (next goal far) or gone", () => {
    expect(nextGoalClose(false, 251, BIKE)).toBe(false);
    expect(nextGoalClose(false, 250, BIKE)).toBe(true);
    expect(nextGoalClose(true, 320, BIKE)).toBe(true);
    expect(nextGoalClose(true, 900, BIKE)).toBe(false);
    expect(nextGoalClose(true, null, BIKE)).toBe(false);
    expect(nextGoalClose(false, 120, FOOT)).toBe(true);
    expect(nextGoalClose(true, 161, FOOT)).toBe(false);
    // The goal is still inside the close view when the zoom closes in.
    for (const v of [BIKE, FOOT]) expect(v.goalEnterM).toBeLessThan(v.closeAheadM);
  });
  it("on foot: 400 m normal view, 150 m close", () => {
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

describe("nextApproaching (spoken warning)", () => {
  it("arms at 200 m, holds until 260 m, and is off with no zombies", () => {
    expect(nextApproaching(false, 201)).toBe(false);
    expect(nextApproaching(false, 200)).toBe(true);
    expect(nextApproaching(true, 260)).toBe(true);
    expect(nextApproaching(true, 261)).toBe(false);
    expect(nextApproaching(true, null)).toBe(false);
  });
});
