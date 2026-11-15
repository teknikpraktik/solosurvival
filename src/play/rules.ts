import { applyEnemySpeedMultiplier, type Rules } from "@/config/game-rules";
import { resolveModeRules } from "@/config/modes";
import { findMission } from "@/campaign";
import { missionRules } from "@/campaign/setup";
import type { MatchParams } from "./config";

/**
 * The rules of a match, for a new match and for a restored one alike: the mode's rules in Free Play, the mission's rules in a campaign
 * (a saved mission whose campaign this version no longer has falls back to the mode's rules), then the product's enemy speed.
 */
export function resolveMatchRules(p: Pick<MatchParams, "mode" | "activity" | "difficulty" | "enemySpeedMultiplier" | "campaign">, durationS: number, straightM?: number): Rules {
  const cm = findMission(p.campaign);
  const r = cm ? missionRules(cm.mission, p.difficulty, durationS, straightM) : resolveModeRules(p.mode, p.activity, p.difficulty, durationS, undefined, straightM);
  return applyEnemySpeedMultiplier(r, p.enemySpeedMultiplier);
}
