import type { Activity } from "./activities";
import type { GameMode } from "@/engine/objectives/objectives";

/**
 * Produktprofil: det som skiljer appar som delar samma motor (OUTBREAK i repo-roten, Mini Outbreak i apps/mini).
 * Spelregler, AI, pathfinding och GPS är gemensamma; profilen styr bara fiendefart, tillåtna val och vilken grafik/ljud appen använder.
 * Varje app äger sin egen profil. Utan profil beter sig delad kod exakt som vuxenappen alltid gjort.
 */
export interface ProductProfile {
  id: string;
  /** Multipliceras på fiendernas grundfart efter aktivitet och svårighet (spurt och terrängfart följer med, de är relativa). 1 = oförändrat. */
  enemySpeedMultiplier: number;
  /** Förflyttningslägen som får väljas, sparas och återställas. */
  activities: readonly Activity[];
  /** Spellägen som får väljas, sparas och återställas. */
  modes: readonly GameMode[];
  /** Slumpade skrämmor under matchen. */
  jumpScares: boolean;
  /** Grafikprofil (appens egen tolkning). */
  graphics: string;
  /** Ljudpaket (appens egen tolkning, se src/audio/cue-player.ts). */
  sound: string;
  /** Fiendernas visuella typer. Typen påverkar aldrig AI, fart eller regler. */
  enemyKinds: readonly string[];
}

/** Vuxenappen som den alltid har fungerat. */
export const OUTBREAK_PROFILE: ProductProfile = {
  id: "outbreak",
  enemySpeedMultiplier: 1,
  activities: ["walk", "mtb"],
  modes: ["mission", "escape", "survival"],
  jumpScares: true,
  graphics: "outbreak",
  sound: "outbreak",
  enemyKinds: ["zombie"],
};
