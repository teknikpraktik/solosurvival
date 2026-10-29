import type { Cue } from "@/play/session";
import { createCuePlayer, type SoundPack } from "@/audio/cue-player";

export type { CueResult } from "@/audio/cue-player";

/** Spoken lines: the phone's own speech synthesis, so nothing is downloaded and it works the same on Android, iOS and desktop. */
export type Line = "Game on" | "Captured" | "Zombies approaching" | "Run!" | "Checkpoint" | CountdownLine;
/** Spoken distance to the nearest zombie as it closes in (see play/countdown.ts). */
export type CountdownLine = "100" | "50" | "40" | "30" | "20" | "10";
/** Lines said in a brighter voice than the low, menacing default (a reward, not a threat). */
const BRIGHT = new Set<Line>(["Checkpoint"]);

const PATTERN: Record<Cue, { f: number[]; vib: number[] }> = {
  danger: { f: [880, 660, 880], vib: [200, 100, 200, 100, 200] },
  alert: { f: [660, 660], vib: [150, 80, 150] },
  goal: { f: [523, 784], vib: [120] },
  info: { f: [600], vib: [80] },
  end: { f: [392, 330, 262], vib: [400] },
  zombie: { f: [110, 78], vib: [60, 40, 120] },
  captured: { f: [900, 1400, 700, 1600], vib: [300, 80, 300, 80, 500] },
  jump: { f: [1300, 900], vib: [200, 60, 120] },
  tension: { f: [90, 95, 233], vib: [80, 120, 80] },
  sprint: { f: [300, 500, 900, 1400], vib: [150, 60, 150, 60, 400] },
};

/** OUTBREAK's sound pack. Only these cues make sound ("goal" = the rewarding chime when a checkpoint is reached); the others (alerts, extraction, match over) are silent so the game is not noisy. */
export const OUTBREAK_SOUNDS: SoundPack<Line> = {
  storageKey: "outbreak.cues",
  samples: { zombie: "/audio/zombie-near.wav", captured: "/audio/captured-scream.wav", jump: "/audio/jump-scream.wav", tension: "/audio/tension.wav", sprint: "/audio/sprint-shriek.wav", goal: "/audio/checkpoint.wav" },
  patterns: PATTERN,
  audible: new Set<Cue>(["zombie", "captured", "jump", "tension", "goal", "sprint"]),
  gain: (cue) => (cue === "captured" || cue === "jump" || cue === "goal" || cue === "sprint" ? 1 : 0.7),
  // English in a low voice.
  voice: { lang: "en-US", pitch: (l) => (BRIGHT.has(l) ? 1.1 : 0.5), rate: (l) => (BRIGHT.has(l) ? 1 : 0.9) },
};

export const { cuesEnabled, setCuesEnabled, speak, preloadCues, playCue, unlockAudio } = createCuePlayer(OUTBREAK_SOUNDS);
