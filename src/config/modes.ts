import type { Activity } from "./activities";
import type { Difficulty } from "./difficulty";
import { resolveRules, type Rules } from "./game-rules";
import type { GameMode } from "@/engine/objectives/objectives";

/**
 * Regler per spelläge. Escape och Mission använder samma motor som Survival: zombiepopulationen och
 * svårighetsgraden följer tidsgränsen, men ingen extraction öppnas (målen ersätter den).
 */
export function resolveModeRules(mode: GameMode, activity: Activity, difficulty: Difficulty, durationS: number, spawnCapacity?: number): Rules {
  const r = resolveRules(activity, difficulty, durationS, spawnCapacity);
  return mode === "survival" ? r : { ...r, extractionOpensAtS: Infinity };
}
