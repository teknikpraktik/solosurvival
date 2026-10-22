import type { Activity } from "./activities";
import type { Difficulty } from "./difficulty";
import { DIFFICULTIES } from "./difficulty";
import { resolveRules, type Rules } from "./game-rules";
import type { GameMode } from "@/engine/objectives/objectives";

/**
 * Regler per spelläge. Escape och Mission använder samma motor som Survival: zombiepopulationen och
 * svårighetsgraden följer tidsgränsen, men ingen extraction öppnas (målen ersätter den).
 */
/** A TO B: zombies per km of straight A–B distance at Normal (scaled by difficulty); a long way needs many zombies along it. */
export const AB_ZOMBIES_PER_KM: Record<Activity, number> = { walk: 2.5, run: 2.5, mtb: 1.5 };

export function resolveModeRules(mode: GameMode, activity: Activity, difficulty: Difficulty, durationS: number, spawnCapacity?: number, straightM?: number): Rules {
  const r = resolveRules(activity, difficulty, durationS, spawnCapacity);
  if (mode === "survival") return r;
  const base: Rules = { ...r, extractionOpensAtS: Infinity };
  if (mode !== "escape" || !straightM) return base;
  // A TO B: the population follows the distance, not the (long) time limit.
  const wanted = Math.round((straightM / 1000) * AB_ZOMBIES_PER_KM[activity] * DIFFICULTIES[difficulty].countMultiplier);
  const initialZombies = Math.min(Math.max(r.initialZombies, wanted), spawnCapacity ?? Infinity);
  const maxZombies = Math.max(r.maxZombies, Math.round(initialZombies * 1.4));
  const windowMin = r.growthPerMin > 0 ? (r.maxZombies - r.initialZombies) / r.growthPerMin : 1;
  return { ...base, initialZombies, maxZombies, growthPerMin: (maxZombies - initialZombies) / Math.max(1, windowMin) };
}
