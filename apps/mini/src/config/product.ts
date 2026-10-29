import type { ProductProfile } from "@/config/product";

/** Fiendernas visuella typer. Typen styr bara utseendet: alla delar samma AI, fart och regler. */
export const ENEMY_KINDS = ["cute-zombie", "rainbow-ghost", "rainbow-spider", "mini-monster"] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

/** Mini Outbreak: samma motor och regler som OUTBREAK, men bara till fots, 20 % långsammare fiender och inga skrämmor. */
export const MINI_PROFILE: ProductProfile = {
  id: "mini-outbreak",
  enemySpeedMultiplier: 0.8,
  activities: ["walk"],
  modes: ["mission", "escape", "survival"],
  jumpScares: false,
  graphics: "mini",
  sound: "mini",
  enemyKinds: ENEMY_KINDS,
};

/** Lokal lagring: egen IndexedDB och egna localStorage-nycklar (appen har också egen origin, så detta är ett extra skydd). */
export const MINI_DB_NAME = "mini-outbreak";
export const MINI_STORAGE_PREFIX = "mini-outbreak.";
