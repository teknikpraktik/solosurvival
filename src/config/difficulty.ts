export type Difficulty = "easy" | "normal" | "hard";

export interface DifficultyProfile {
  speedMultiplier: number;
  countMultiplier: number;
  revealIntervalS: number;
  detectionRadiusM: number;
  /** Andel av jagande zombier som får försöka genskjuta (0–1). */
  interceptShare: number;
  /** Sannolikhet att en patrullerande zombie reagerar på ett periodiskt positionsavslöjande. */
  revealResponseProb: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyProfile> = {
  easy: {
    speedMultiplier: 0.9,
    countMultiplier: 0.7,
    revealIntervalS: 180,
    detectionRadiusM: 60,
    interceptShare: 0,
    revealResponseProb: 0.4,
  },
  normal: {
    speedMultiplier: 1.0,
    countMultiplier: 1.0,
    revealIntervalS: 120,
    detectionRadiusM: 100,
    interceptShare: 0.3,
    revealResponseProb: 0.6,
  },
  hard: {
    speedMultiplier: 2,
    countMultiplier: 2,
    revealIntervalS: 60,
    detectionRadiusM: 140,
    interceptShare: 0.6,
    revealResponseProb: 0.8,
  },
};
