import type { Cue } from "@/play/session";
import { createCuePlayer, type SoundPack } from "@/audio/cue-player";
import { readLevels, soundscape, writeLevels } from "./audio";

export type { CueResult } from "@/audio/cue-player";

/**
 * OUTBREAK has no synthetic voice: everything the operator says is a recorded line (VOICE in ./audio.ts), played by the soundscape.
 * The cue pack is kept for vibration only (which also works with the sound off on phones that vibrate).
 */
type NoLine = never;

const PATTERN: Record<Cue, { f: number[]; vib: number[] }> = {
  danger: { f: [], vib: [200, 100, 200, 100, 200] },
  alert: { f: [], vib: [150, 80, 150] },
  goal: { f: [], vib: [120] },
  info: { f: [], vib: [80] },
  end: { f: [], vib: [400] },
  zombie: { f: [], vib: [60, 40, 120] },
  captured: { f: [], vib: [300, 80, 300, 80, 500] },
  jump: { f: [], vib: [200, 60, 120] },
  tension: { f: [], vib: [80, 120, 80] },
  sprint: { f: [], vib: [150, 60, 150, 60, 400] },
};

/** OUTBREAK's cue pack: vibration only. No cue makes a sound and no line is spoken by the phone's speech synthesis. */
export const OUTBREAK_SOUNDS: SoundPack<NoLine> = {
  storageKey: "outbreak.cues",
  samples: {},
  patterns: PATTERN,
  audible: new Set<Cue>(),
  gain: () => 0,
  voice: { lang: "en-US", pitch: () => 1, rate: () => 1 }, // required by the shared pack type; never used (nothing is spoken)
  context: () => soundscape().context(),
};

const player = createCuePlayer(OUTBREAK_SOUNDS);
export const { playCue } = player;

export function cuesEnabled(): boolean { return readLevels().on; }
/** The master switch: all sound (music, effects and the operator's recorded lines). */
export function setCuesEnabled(on: boolean): void {
  writeLevels({ on });
  player.setCuesEnabled(on);
  const s = soundscape();
  s.applyLevels(0.3);
  if (!on) s.stopAll(0.3);
}

/** Call inside a tap: allows sound from now on. */
export function unlockAudio(): void {
  soundscape().unlock();
}
