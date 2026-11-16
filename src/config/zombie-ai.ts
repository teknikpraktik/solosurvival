/**
 * Zombie AI with roles (rules.zombieAi === "roles"): pursuers and interceptors. Every balance value of that AI is here.
 * Behaviour and the reasons for the values: docs/ZOMBIE-AI-ROLES.md. Without the rule nothing in this file is used.
 *
 * Calibration basis: zombies learn the player's snapped position about once a second (magnet chase, the existing rule), the engine keeps one
 * of those every 4 s for half a minute (TRACK_SAMPLE_S × TRACK_SAMPLES in engine.ts), a walker moves about 1.3 m/s and a rider 4.5 m/s.
 */
export type ZombieAiModel = "roles";
export type ZombieRole = "pursuer" | "interceptor";

export const ZOMBIE_AI = {
  /** Share of zombies that are interceptors; the rest are pursuers. Dealt out evenly by spawn order (roleForIndex), not by chance. */
  interceptorShare: 0.3,

  // --- Reading the player's movement from the observation history ---
  /** The newest observation may be at most this old (s); older and the interceptor just pursues. */
  maxInfoAgeS: 12,
  /** The direction is read against an observation at least this much older (s)... */
  headingMinAgeS: 6,
  /** ...at most this much older (s)... */
  headingMaxAgeS: 40,
  /**
   * ...and at least this far away (m). Below it the player counts as standing still: GPS noise of 5–10 m at each end can add up to about
   * 20 m between two fixes of a player who has not moved. A walker covers it in about 15 s, a rider in under 5 s.
   */
  headingMinMoveM: 20,
  /** Slower than this share of the activity's nominal pace is standing still; faster than the upper share is capped. */
  minSpeedShare: 0.35,
  maxSpeedShare: 2.5,
  /** If the newest direction and the one over the whole window disagree (turned round), the newest is trusted once it is this long (m). */
  reversalMinMoveM: 24,
  /** Farther than this from the snapped trail (m), or on a terrain edge, the player is off the trails: the forecast is a straight line. */
  offTrailM: 35,

  // --- Forecast ---
  /** How far ahead the forecast looks: this long at the player's estimated speed (s), never farther than horizonMaxM. */
  horizonS: 240,
  horizonMaxM: 900,
  /** At a junction a way straight on weighs 1 + this, a way at a right angle or sharper weighs this. Higher = less belief in "straight on". */
  straightBias: 0.35,
  /** Meeting points the player is less likely than this to pass are not used. */
  minProbability: 0.25,
  /** Off the trails: meeting points this many seconds ahead on the straight line, and how fast the belief falls (s to halve). */
  freeLeadsS: [30, 60, 90, 120],
  freeHalfLifeS: 90,
  /** Off the trails: a point on the line must have network within this distance (m), or it is in water or a building. */
  freeSnapMaxM: 80,
  /** Off the trails: the meeting point must stay within this angle of the direction of travel (cosine; 0.7 ≈ 45°). */
  freeConeCos: 0.7,

  // --- Choosing the meeting point ---
  /** Meeting points the player reaches sooner than this (s) are just pursuit. */
  minLeadS: 10,
  /** The zombie must arrive this much before the player (s)... */
  marginS: 4,
  /** ...but not wait longer than this (s): then walking towards the player is better. */
  maxWaitS: 60,
  /** How much an earlier meeting is preferred: the score falls by this share over the whole horizon. */
  latePenalty: 0.5,
  /** Score factor for a meeting point another interceptor is already heading for (within samePointM). */
  sharedTargetFactor: 0.5,
  /** Two meeting points this close (m) count as the same point (inertia and shared targets). */
  samePointM: 45,
  /** Within this distance (m) of the newest observation an interceptor drops its plan and goes straight for the player. */
  closeChaseM: 50,

  // --- Inertia ---
  /** A chasing interceptor tries to find a meeting point this often (s, plus jitter). Same pace as the original AI's tactical decision. */
  attemptS: 20,
  attemptJitterS: 10,
  /** After choosing, the plan is held this long (s, plus jitter) before the interceptor looks at the player's track again. */
  holdS: 15,
  holdJitterS: 10,
  /** At a review, a new meeting point must score this many times the current one to replace it. */
  switchGain: 1.3,
  /** A plan ends by itself this long (s) after the time the player was expected at the meeting point: the player did not come. */
  lateToleranceS: 8,
} as const;

/**
 * Role by spawn order: zombie number `index` (0, 1, 2, …) is an interceptor when the running total of `share` passes a whole number.
 * With 0.3 that is zombie 2, 5, 9, 12, 15, 19…: none of 2, 1 of 3–5, 2 of 6–9, 3 of 10–12, 4 of 13–15, 6 of 20. No chance involved, so a small group can
 * neither be all interceptors nor miss out on them, and the same match always gets the same roles.
 */
export function roleForIndex(index: number, share: number = ZOMBIE_AI.interceptorShare): ZombieRole {
  const upTo = (n: number) => Math.floor(n * share + 0.2 + 1e-9);
  return upTo(index + 1) > upTo(index) ? "interceptor" : "pursuer";
}
