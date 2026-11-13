import type { Cue } from "@/play/session";
import { createCuePlayer, type SoundPack } from "@/audio/cue-player";
import { SOUND_RULES } from "@/play/sound-rules";
import { AUDIO, GAIN, matchAudio, readLevels, soundscape, writeLevels } from "./audio";

export type { CueResult } from "@/audio/cue-player";

/** Spoken lines: the phone's own speech synthesis, so nothing is downloaded and it works the same on Android, iOS and desktop. */
export type Line = "Game on" | "Captured" | "Zombies approaching" | "Run!" | "Checkpoint" | CountdownLine;
/** Spoken distance to the nearest zombie as it closes in (see play/countdown.ts). */
export type CountdownLine = "100" | "50" | "40" | "30" | "20" | "10";
/** Lines said in a brighter voice than the low, menacing default (a reward, not a threat). */
const BRIGHT = new Set<Line>(["Checkpoint"]);
/** The operator's lines come over the radio: a short click first (not "Captured": that is the end, not a message). */
const NO_RADIO = new Set<Line>(["Captured"]);

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

/**
 * OUTBREAK's cue pack: vibration and speech only. Every sound file is played by the soundscape (./audio.ts), so no cue makes a sound of its
 * own and nothing is heard twice. Speech shares the soundscape's audio context and lowers the background while it speaks.
 */
export const OUTBREAK_SOUNDS: SoundPack<Line> = {
  storageKey: "outbreak.cues",
  samples: {},
  patterns: PATTERN,
  audible: new Set<Cue>(),
  gain: () => 0,
  // English in a low voice.
  voice: { lang: "en-US", pitch: (l) => (BRIGHT.has(l) ? 1.1 : 0.5), rate: (l) => (BRIGHT.has(l) ? 1 : 0.9), volume: () => readLevels().voice },
  context: () => soundscape().context(),
  onSpeech: (on) => soundscape().setDuck("speech", on),
};

const player = createCuePlayer(OUTBREAK_SOUNDS);
export const { preloadCues, playCue } = player;

export function cuesEnabled(): boolean { return readLevels().on; }
/** The master switch: all sound, music and speech. */
export function setCuesEnabled(on: boolean): void {
  writeLevels({ on });
  player.setCuesEnabled(on);
  const s = soundscape();
  s.applyLevels(0.3);
  if (!on) s.stopAll(0.3);
}

/** Call inside a tap: allows sound and speech from now on. */
export function unlockAudio(): void {
  soundscape().unlock();
  player.unlockAudio();
}

let lastLineMs = -Infinity;
let pending: { timer: ReturnType<typeof setTimeout>; due: number } | null = null;
const hidden = () => typeof document !== "undefined" && document.hidden;

/**
 * Says a line as the operator: a radio click first unless the channel is already open (a line within the last few seconds), then the voice.
 * A line that could only come late (busy phone, app in the background) is dropped, never said out of time.
 */
export function speak(line: Line): boolean {
  if (!cuesEnabled() || hidden()) return false;
  // One voice at a time: while the operator's recorded line plays, a spoken line waits for it (the newest waiting line wins).
  if (matchAudio().radio.busy) { afterRadio = { line, at: Date.now() }; return true; }
  const now = Date.now();
  const R = SOUND_RULES.radio;
  const open = now - lastLineMs < R.channelOpenS * 1000;
  lastLineMs = now;
  const s = soundscape();
  if (NO_RADIO.has(line) || open || !s.unlocked) return player.speak(line);
  if (pending) clearTimeout(pending.timer);
  s.setDuck("radio", true);
  void s.play(AUDIO.radio, "fx", GAIN.radio, 300);
  const due = now + R.leadMs;
  pending = {
    due,
    timer: setTimeout(() => {
      pending = null;
      if (Date.now() - due > R.maxLateMs || hidden() || !player.speak(line)) { s.setDuck("radio", false); return; }
      // Hold the background down until the voice itself has started (it reports that a moment later), so the level does not pump.
      setTimeout(() => s.setDuck("radio", false), 1500);
    }, R.leadMs),
  };
  return true;
}

/** Drops a line that is waiting for its radio click or for a recorded line to end (match over, app hidden). */
export function cancelPendingSpeech(): void {
  afterRadio = null;
  if (pending) { clearTimeout(pending.timer); pending = null; soundscape().setDuck("radio", false); }
}

/** A spoken line waiting for the recorded one; said when the channel is free, dropped when it would come this much later. */
let afterRadio: { line: Line; at: number } | null = null;
const AFTER_RADIO_MAX_MS = 9000;

// The recorded lines and the speech synthesis share one channel: a recorded line stops speech that is under way, and speech that had to
// wait is said when the line has ended. The match's soundscape uses speech for lines without a recording, and as their fallback.
{
  const m = matchAudio();
  m.speak = (l) => { speak(l); };
  m.radio.interrupt = () => {
    cancelPendingSpeech();
    try { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); } catch { /* no speech */ }
  };
  m.radio.onIdle(() => {
    const w = afterRadio;
    afterRadio = null;
    if (w && Date.now() - w.at <= AFTER_RADIO_MAX_MS) speak(w.line);
  });
}
