import type { Cue } from "@/play/session";
import { createCuePlayer, type SoundPack } from "@/audio/cue-player";
import { MINI_STORAGE_PREFIX } from "../config/product";

/** Spoken lines in Mini Outbreak: friendly, in a normal voice. */
export type MiniLine = "Game on" | "Checkpoint" | "Watch out!" | "Caught! Try again!" | "You made it!";

/**
 * Mini Outbreaks ljudpaket. Bara den glada checkpoint-klangen har en ljudfil; alla andra händelser är tysta (vibration finns kvar) tills
 * barnvänliga ljud har producerats. Inga skräckljud: zombie-, skrik-, spänning- och spurtljuden finns inte i paketet och inte i appen.
 * Ett nytt ljud läggs till som en fil i public/audio/ plus en rad i `samples` och `audible`.
 */
export const MINI_SOUNDS: SoundPack<MiniLine> = {
  storageKey: `${MINI_STORAGE_PREFIX}cues`,
  samples: { goal: "/audio/checkpoint.wav" },
  patterns: {
    danger: { f: [], vib: [120, 80, 120] },
    alert: { f: [], vib: [100, 60, 100] },
    goal: { f: [523, 659, 784], vib: [120] },
    info: { f: [], vib: [80] },
    end: { f: [], vib: [200] },
    zombie: { f: [], vib: [60] },
    captured: { f: [], vib: [150, 80, 150] },
    jump: { f: [], vib: [] },
    tension: { f: [], vib: [] },
    sprint: { f: [], vib: [80] },
  } satisfies Record<Cue, { f: number[]; vib: number[] }>,
  audible: new Set<Cue>(["goal"]),
  gain: () => 0.8,
  voice: { lang: "en-US", pitch: () => 1.1, rate: () => 1 },
};

export const { cuesEnabled, setCuesEnabled, speak, preloadCues, playCue, unlockAudio } = createCuePlayer(MINI_SOUNDS);
