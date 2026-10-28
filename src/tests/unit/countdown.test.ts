import { describe, expect, it } from "vitest";
import { nextCountdown, type CountdownStep } from "@/play/countdown";

/** Runs a sequence of distances and returns what was said. */
function said(ds: (number | null)[]): CountdownStep[] {
  let last: CountdownStep | null = null;
  const out: CountdownStep[] = [];
  for (const d of ds) {
    const r = nextCountdown(last, d);
    last = r.last;
    if (r.say !== null) out.push(r.say);
  }
  return out;
}

describe("zombie distance countdown", () => {
  it("says 100, 50, 40, 30, 20, 10 once each as a zombie closes in", () => {
    const ds = [];
    for (let d = 150; d >= 5; d -= 1) ds.push(d);
    expect(said(ds)).toEqual([100, 50, 40, 30, 20, 10]);
  });
  it("says nothing farther than 100 m", () => {
    expect(said([400, 200, 101, 150])).toEqual([]);
  });
  it("does not repeat a step for jitter around it", () => {
    expect(said([101, 99, 103, 98, 112, 97, 100])).toEqual([100]);
    expect(said([60, 49, 52, 48, 54, 49])).toEqual([100, 50]);
  });
  it("only says the nearest step when several are crossed at once", () => {
    expect(said([120, 35])).toEqual([40]);
    expect(said([120, 9])).toEqual([10]);
  });
  it("says a step again after the zombie dropped back beyond it", () => {
    expect(said([99, 29, 36, 31, 29])).toEqual([100, 30, 30]);
    expect(said([99, 60, 99, 120, 99])).toEqual([100, 100]);
  });
  it("resets when there are no zombies (or the match stops)", () => {
    expect(said([45, null, 45])).toEqual([50, 50]);
  });
});
