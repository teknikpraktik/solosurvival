import { DISTANCE_LIMITS, clampParams, type MatchParams } from "@/play/config";
import { MINI_PROFILE } from "./product";

/** Mini Outbreak only walks (MINI_PROFILE); the activity is fixed. */
export const MINI_ACTIVITY = MINI_PROFILE.activities[0];

/** CHECKPOINTS i Mini Outbreak: kortare banor än i OUTBREAK (där gång tillåter 6 km). Gäller bara barnappen. */
export const MINI_MISSION_MAX_M = 4000;

/** Sträckreglaget för CHECKPOINTS i barnappen: samma min, steg och förval som OUTBREAK till fots, men högst 4 km. */
export const MINI_DISTANCE_LIMITS = { ...DISTANCE_LIMITS[MINI_ACTIVITY], max: Math.min(DISTANCE_LIMITS[MINI_ACTIVITY].max, MINI_MISSION_MAX_M) };

/** Barnappens matchinställningar: alltid till fots och sträckan inom barnappens gränser. */
export function clampMiniParams(p: MatchParams): MatchParams {
  const c = clampParams({ ...p, activity: MINI_ACTIVITY });
  return c.targetLengthM > MINI_DISTANCE_LIMITS.max ? { ...c, targetLengthM: MINI_DISTANCE_LIMITS.max } : c;
}
