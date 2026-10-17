/** Seedad mulberry32. Tillståndet ligger i spelets state så att en match kan återställas exakt. */
export interface RngHolder {
  rngState: number;
}

export function rand(h: RngHolder): number {
  h.rngState = (h.rngState + 0x6d2b79f5) >>> 0;
  let t = h.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(h: RngHolder, n: number): number {
  return Math.floor(rand(h) * n);
}

export function pick<T>(h: RngHolder, xs: T[]): T {
  return xs[randInt(h, xs.length)];
}
