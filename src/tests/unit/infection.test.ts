import { describe, expect, it } from "vitest";
import { STEP_S } from "@/config/game-rules";
import { updateInfection } from "@/engine/infection/infection";

function run(seconds: number, opts: { dist?: number; quality?: any; neutral?: boolean } = {}, start = 0) {
  let p = start;
  let infected = false;
  for (let i = 0; i < Math.round(seconds / STEP_S) && !infected; i++) {
    const r = updateInfection(p, {
      dtS: STEP_S,
      nearestZombieM: opts.dist ?? 10,
      quality: opts.quality ?? "ok",
      neutral: opts.neutral ?? false,
    });
    p = r.progressS;
    infected = r.infected;
  }
  return { p, infected };
}

describe("infektion", () => {
  it("2,8 s inom 20 m ger ingen infektion", () => expect(run(2.8).infected).toBe(false));
  it("3,0 s inom 20 m med giltig GPS ger infektion", () => expect(run(3.0).infected).toBe(true));
  it("kontakt som bryts efter 2 s nollställer timern", () => {
    const a = run(2);
    const b = updateInfection(a.p, { dtS: STEP_S, nearestZombieM: 25, quality: "ok", neutral: false });
    expect(b.progressS).toBe(0);
  });
  it("gränsen är 20 m", () => {
    expect(run(3, { dist: 20 }).infected).toBe(true);
    expect(run(10, { dist: 20.5 }).infected).toBe(false);
  });
  it("GPS-bortfall pausar timern utan att infektera", () => {
    const a = run(2);
    const b = run(60, { quality: "unavailable" }, a.p);
    expect(b.infected).toBe(false);
    expect(b.p).toBe(a.p);
  });
  it("noggrannhet 20–35 m pausar infektionskontrollen", () => {
    expect(run(30, { quality: "infection_paused" }).infected).toBe(false);
  });
  it("noggrannhet 10–20 m kräver längre kontakt", () => {
    expect(run(3.4, { quality: "verify" }).infected).toBe(false);
    expect(run(5, { quality: "verify" }).infected).toBe(true);
  });
  it("neutral återstart ger ingen infektion", () => expect(run(30, { neutral: true }).infected).toBe(false));
});
