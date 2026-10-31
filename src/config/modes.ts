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

/**
 * Survival felt too easy in field testing, first on the bike, then on foot: zombies 20 % faster in Survival (sprint follows, it is a factor
 * of the base speed). Checkpoints and A to B are unchanged.
 */
export const SURVIVAL_SPEED_FACTOR: Partial<Record<Activity, number>> = { mtb: 1.2, walk: 1.2 };

export function resolveModeRules(mode: GameMode, activity: Activity, difficulty: Difficulty, durationS: number, spawnCapacity?: number, straightM?: number): Rules {
  const r = resolveRules(activity, difficulty, durationS, spawnCapacity);
  if (mode === "survival") return { ...r, zombieSpeedMps: r.zombieSpeedMps * (SURVIVAL_SPEED_FACTOR[activity] ?? 1) };
  const base: Rules = { ...r, extractionOpensAtS: Infinity };
  if (mode !== "escape" || !straightM) return base;
  // A TO B: the population follows the distance, not the (long) time limit, but never beyond the level's maximum (ZOMBIE_COUNT, at most 20).
  const wanted = Math.round((straightM / 1000) * AB_ZOMBIES_PER_KM[activity] * DIFFICULTIES[difficulty].countMultiplier);
  const initialZombies = Math.min(Math.max(r.initialZombies, wanted), r.maxZombies, spawnCapacity ?? Infinity);
  const maxZombies = r.maxZombies;
  const windowMin = r.growthPerMin > 0 ? (r.maxZombies - r.initialZombies) / r.growthPerMin : 1;
  return { ...base, initialZombies, maxZombies, growthPerMin: (maxZombies - initialZombies) / Math.max(1, windowMin) };
}
