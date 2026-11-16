import { applyEnemySpeedMultiplier, applyZombieAi, type Rules } from "@/config/game-rules";
import { resolveModeRules } from "@/config/modes";
import { findMission } from "@/campaign";
import { missionRules } from "@/campaign/setup";
import type { MatchParams } from "./config";

/**
 * The rules of a match, for a new match and for a restored one alike: the mode's rules in Free Play, the mission's rules in a campaign
 * (a saved mission whose campaign this version no longer has falls back to the mode's rules), the zombie AI the match was started with,
 * then the product's enemy speed.
 */
export function resolveMatchRules(p: Pick<MatchParams, "mode" | "activity" | "difficulty" | "enemySpeedMultiplier" | "campaign" | "zombieAi">, durationS: number, straightM?: number): Rules {
  const cm = findMission(p.campaign);
  // The zombie AI with roles is a Free Play change; a campaign keeps the interception its missions were balanced with.
  const r = cm ? missionRules(cm.mission, p.difficulty, durationS, straightM) : applyZombieAi(resolveModeRules(p.mode, p.activity, p.difficulty, durationS, undefined, straightM), p.zombieAi);
  return applyEnemySpeedMultiplier(r, p.enemySpeedMultiplier);
}
