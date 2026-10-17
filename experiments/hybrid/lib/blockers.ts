import type { XY } from "./fixture";
import type { TerrainRaster } from "./raster";

const CELL_M = 1;
const LINE_WIDTH_M = 2;

/**
 * Hård mask över kända hinder (vatten, våtmark, byggnader, berg samt staket/järnväg/å/klippa) i 1 m upplösning,
 * utvidgad en cell (~1 m säkerhetsmarginal). O(1) per punkt, oberoende av polygonernas storlek.
 * Rastret på 5 m är för grovt för tunna objekt; den här masken ger garantin för det som finns i OSM-data.
 * Verifieras separat mot vektorgeometri i `verify-links.ts`.
 */
export class Blockers {
  readonly w: number;
  readonly h: number;
  private data: Uint8Array;

  constructor(r: TerrainRaster) {
    this.w = Math.ceil((r.w * r.cell) / CELL_M);
    this.h = Math.ceil((r.h * r.cell) / CELL_M);
    const raw = new Uint8Array(this.w * this.h);
    for (const p of r.vector.polys) this.fill(raw, p.rings);
    for (const l of r.vector.lines) this.draw(raw, l.line);
    // Utvidga med en cell.
    this.data = new Uint8Array(raw.length);
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) {
        if (!raw[j * this.w + i]) continue;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii >= 0 && jj >= 0 && ii < this.w && jj < this.h) this.data[jj * this.w + ii] = 1;
          }
      }
  }

  private fill(data: Uint8Array, rings: XY[][]) {
    let minY = Infinity, maxY = -Infinity;
    for (const ring of rings) for (const [, y] of ring) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const j0 = Math.max(0, Math.floor(minY / CELL_M));
    const j1 = Math.min(this.h - 1, Math.floor(maxY / CELL_M));
    for (let j = j0; j <= j1; j++) {
      const y = (j + 0.5) * CELL_M;
      const xs: number[] = [];
      for (const ring of rings)
        for (let i = 0; i + 1 < ring.length; i++) {
          const [ax, ay] = ring[i];
          const [bx, by] = ring[i + 1];
          if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil(xs[k] / CELL_M - 0.5));
        const i1 = Math.min(this.w - 1, Math.floor(xs[k + 1] / CELL_M - 0.5));
        for (let i = i0; i <= i1; i++) data[j * this.w + i] = 1;
      }
    }
  }

  private draw(data: Uint8Array, line: XY[]) {
    const reach = Math.ceil(LINE_WIDTH_M / 2 / CELL_M);
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, ay] = line[i];
      const [bx, by] = line[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL_M / 2)));
      for (let s = 0; s <= steps; s++) {
        const ci = Math.floor((ax + ((bx - ax) * s) / steps) / CELL_M), cj = Math.floor((ay + ((by - ay) * s) / steps) / CELL_M);
        for (let dj = -reach; dj <= reach; dj++)
          for (let di = -reach; di <= reach; di++) {
            const ii = ci + di, jj = cj + dj;
            if (ii >= 0 && jj >= 0 && ii < this.w && jj < this.h) data[jj * this.w + ii] = 1;
          }
      }
    }
  }

  pointBlocked(p: XY): boolean {
    const i = Math.floor(p[0] / CELL_M), j = Math.floor(p[1] / CELL_M);
    return i >= 0 && j >= 0 && i < this.w && j < this.h && this.data[j * this.w + i] === 1;
  }

  /** Sant om sträckan P–Q (hela längden, inga undantag vid ändarna) rör ett känt hinder. */
  segmentBlocked(P: XY, Q: XY, stepM = CELL_M / 2): boolean {
    const d = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    for (let s = 0; s <= d; s += stepM) {
      const f = d === 0 ? 0 : s / d;
      if (this.pointBlocked([P[0] + (Q[0] - P[0]) * f, P[1] + (Q[1] - P[1]) * f])) return true;
    }
    return this.pointBlocked(Q);
  }
}

const cache = new WeakMap<TerrainRaster, Blockers>();
export function blockersFor(r: TerrainRaster): Blockers {
  let b = cache.get(r);
  if (!b) cache.set(r, (b = new Blockers(r)));
  return b;
}
