import { describe, expect, it } from "vitest";
import { IMG, matchPictures, resultPicture } from "@/app/_client/matchImages";

describe("result pictures follow the match's result and mode (not any text)", () => {
  it("captured, out of time, safe house (Checkpoints, A TO B) and extracted (Survival)", () => {
    for (const mode of ["mission", "escape", "survival"] as const) {
      expect(resultPicture("infected", mode)?.src).toBe(IMG.captured);
      expect(resultPicture("failed", mode)?.src).toBe(IMG.outOfTime);
    }
    expect(resultPicture("survived", "mission")?.src).toBe(IMG.safehouse);
    expect(resultPicture("survived", "escape")?.src).toBe(IMG.safehouse);
    expect(resultPicture("survived", "survival")?.src).toBe(IMG.extracted);
  });
  it("aborted or unknown endings get no picture; the captured photo falls back to the drawn picture", () => {
    expect(resultPicture("aborted", "survival")).toBeNull();
    expect(resultPicture("incomplete", "mission")).toBeNull();
    expect(resultPicture(undefined, "escape")).toBeNull();
    expect(resultPicture("infected", "mission")?.fallback).toBe(IMG.capturedFallback);
  });
  it("never the old won.jpg, and the replaced photos have new names", () => {
    const all = Object.values(IMG).join(" ");
    expect(all).not.toMatch(/won\.jpg|\/hero\.jpg|\/captured\.jpg/);
  });
  it("preloads only what the mode can show (helicopter cards only in Survival)", () => {
    expect(matchPictures("survival")).toEqual(expect.arrayContaining([IMG.heliApproaching, IMG.heliLanded, IMG.extracted, IMG.captured, IMG.outOfTime]));
    expect(matchPictures("mission")).not.toContain(IMG.heliApproaching);
    expect(matchPictures("escape")).toContain(IMG.safehouse);
    expect(matchPictures("escape")).not.toContain(IMG.extracted);
  });
});
