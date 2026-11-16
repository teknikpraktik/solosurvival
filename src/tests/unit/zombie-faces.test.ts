import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ZOMBIE_FACE_URLS, zombieFace, zombieFaceHtml } from "@/app/_client/zombieFaces";
import { zombieTarget } from "@/play/zombie-anim";

const PUBLIC = path.resolve(import.meta.dirname, "../../../public");

describe("zombie faces on the map: which face a zombie wears", () => {
  it("is the same for a zombie every time (its whole life, every render), from its id alone", () => {
    for (const id of ["z0", "z5", "z17", "z123", "mini-7", "x"]) expect(new Set(Array.from({ length: 5 }, () => zombieFace(id))).size).toBe(1);
  });

  it("gives the engine's consecutive zombies (z0, z1, …) different faces: the first seven are all different", () => {
    const faces = Array.from({ length: ZOMBIE_FACE_URLS.length }, (_, i) => zombieFace(`z${i}`));
    expect(new Set(faces).size).toBe(ZOMBIE_FACE_URLS.length);
  });

  it("spreads many zombies evenly over the faces, and never points outside the list", () => {
    const count = new Array(ZOMBIE_FACE_URLS.length).fill(0);
    for (let i = 0; i < 700; i++) count[zombieFace(`z${i}`)]++;
    expect(count.every((c) => c === 100)).toBe(true);
    for (const id of ["", "abc", "zombie", "z-1", "z1x", "🧟"]) expect(zombieFace(id)).toBeGreaterThanOrEqual(0), expect(zombieFace(id)).toBeLessThan(ZOMBIE_FACE_URLS.length);
  });

  it("draws no random numbers (the engine's simulations stay deterministic)", () => {
    const spy = vi.spyOn(Math, "random");
    zombieFace("z3"); zombieFace("other"); zombieFaceHtml("z9");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("the marker is the face only: no text inside, one shared picture per face", () => {
    const html = zombieFaceHtml("z2");
    expect(html).toBe(`<span class="zface" data-face="3" style="background-image:url(/img/zombies/zombie-3.webp)"></span>`);
    expect(html.replace(/<[^>]*>/g, "")).toBe("");
  });

  it("every face is a small WebP in public/, sized for a 40 px marker (128 px)", () => {
    for (const url of ZOMBIE_FACE_URLS) {
      const file = path.join(PUBLIC, url);
      const b = readFileSync(file);
      expect(b.subarray(0, 4).toString("latin1") + b.subarray(8, 12).toString("latin1"), url).toBe("RIFFWEBP");
      // VP8X (extended, with alpha): canvas width/height - 1 as 24-bit little endian at bytes 24 and 27.
      expect(b.subarray(12, 16).toString("latin1"), url).toBe("VP8X");
      expect([b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1], url).toEqual([128, 128]);
      expect(statSync(file).size, url).toBeLessThan(12_000);
    }
  });
});

describe("zombie on the map: threat level from the engine's own states (presentation only)", () => {
  const z = (state: string, sprinting = false) => zombieTarget({ id: "z1", edgeId: "e", distM: 3, speedMps: 1, state, sprinting });

  it("patrol = wandering, investigate = searching, chase and intercept = chasing; sprint passes through", () => {
    expect(z("patrol")).toMatchObject({ chasing: false, searching: false, sprinting: false });
    expect(z("investigate")).toMatchObject({ chasing: false, searching: true });
    expect(z("chase")).toMatchObject({ chasing: true, searching: false });
    expect(z("intercept")).toMatchObject({ chasing: true, searching: false });
    expect(z("chase", true)).toMatchObject({ chasing: true, sprinting: true });
  });

  it("keeps position and speed as they are", () => {
    expect(z("patrol")).toMatchObject({ id: "z1", edgeId: "e", distM: 3, speedMps: 1 });
  });
});
