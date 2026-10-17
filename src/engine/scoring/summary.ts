import type { GameResult, GameState } from "../core/types";

export interface MatchSummary {
  id: string;
  result: GameResult;
  activity: string;
  difficulty: string;
  durationSeconds: number;
  survivedSeconds: number;
  distanceM: number;
  peakZombies: number;
  seed: number;
  rulesVersion: string;
}

/** Sammanfattning som sparas lokalt – inga positionsspår (PRD 9.4). */
export function summarize(s: GameState): MatchSummary {
  return {
    id: s.id,
    result: s.result ?? "incomplete",
    activity: s.config.activity,
    difficulty: s.config.difficulty,
    durationSeconds: s.config.durationSeconds,
    survivedSeconds: Math.round(s.elapsedSeconds),
    distanceM: Math.round(s.player.distanceM),
    peakZombies: s.peakZombies,
    seed: s.config.seed,
    rulesVersion: s.config.rulesVersion,
  };
}

/** INCOMPLETE räknas inte som förlust (PRD 3.6). */
export function countsAsLoss(r: GameResult): boolean {
  return r === "infected" || r === "failed";
}
