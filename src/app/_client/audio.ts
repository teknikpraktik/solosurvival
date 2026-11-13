import type { Activity } from "@/config/activities";
import type { GameMode } from "@/engine/objectives/objectives";
import type { SoundEvent } from "@/play/session";
import { Cooldown, NearGate, SOUND_RULES, ThreatGate } from "@/play/sound-rules";
import { Soundscape, type Bus, type Levels, type LoopVoice, type PlayResult, type SoundscapeEnv, type Voice } from "@/audio/soundscape";

/**
 * OUTBREAK's soundscape (adult app only; Mini Outbreak has its own sound pack and never loads this file). Menu music, threat pulses,
 * helicopter phases and event sounds, all through one Web Audio context. The files are built by scripts/build-audio.mjs from
 * assets/audio/source/; game rules for when they play are in src/play/sound-rules.ts.
 */
export const AUDIO = {
  music: "/audio/theme-outbreak.mp3",
  threat: ["/audio/threat-pulse-1.mp3", "/audio/threat-pulse-2.mp3", "/audio/threat-pulse-3.mp3", "/audio/threat-pulse-4.mp3"],
  captured: "/audio/captured.mp3",
  safeDoor: "/audio/safe-door-close.mp3",
  heliSuccess: "/audio/heli-extraction-success.mp3",
  heliLoop: "/audio/heli-extraction.mp3",
  heliApproach: "/audio/heli-approach.mp3",
  zombieNear: "/audio/zombie-near.mp3",
  revealed: "/audio/position-revealed.mp3",
  checkpoint: "/audio/checkpoint-reached.mp3",
  radio: "/audio/radio-open.mp3",
} as const;

/** Every match: decoded while the player sets up the match. */
export const MATCH_SOUNDS: readonly string[] = [...AUDIO.threat, AUDIO.captured, AUDIO.safeDoor, AUDIO.zombieNear, AUDIO.revealed, AUDIO.checkpoint, AUDIO.radio];
/** Survival only (larger files): decoded when a Survival match is chosen or starts. */
export const HELI_SOUNDS: readonly string[] = [AUDIO.heliApproach, AUDIO.heliLoop, AUDIO.heliSuccess];

/**
 * The mix. The files are levelled (scripts/build-audio.mjs: one-shots ≈ −14 LUFS momentary peak, threat pulses −24 LUFS and the waiting
 * helicopter −20 LUFS integrated, true peak ≤ −1 dBTP); these gains place them against each other and under the voice.
 */
export const MIX: Record<Bus, number> = { music: 0.32, threat: 0.7, heli: 0.8, fx: 1 };
/** Per sound, on its bus (linear). */
export const GAIN = {
  threat: 1, heliLoop: 0.7, heliApproach: 0.9, heliSuccess: 1, captured: 1, safeDoor: 1, zombieNear: 0.8, revealed: 0.75, checkpoint: 0.7, radio: 0.55,
} as const;
/** Under the voice, music/threat/helicopter go down to this (≈ −10 dB). */
export const DUCK = { to: 0.32, attackS: 0.15, releaseS: 0.9 };

const MASTER_KEY = "outbreak.cues"; // the existing on/off choice (shared with the speech player), "off" = muted
const LEVELS_KEY = "outbreak.audio.levels";

function storage(): Storage | null { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } }

const clamp01 = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : d);
export function readLevels(s: Storage | null = storage()): Levels {
  let on = true;
  let raw: Partial<Levels> = {};
  try { on = s?.getItem(MASTER_KEY) !== "off"; } catch { /* blocked */ }
  try { raw = JSON.parse(s?.getItem(LEVELS_KEY) ?? "{}") ?? {}; } catch { raw = {}; }
  return { on, music: clamp01(raw.music, 1), fx: clamp01(raw.fx, 1), voice: clamp01(raw.voice, 1) };
}
export function writeLevels(l: Partial<Levels>, s: Storage | null = storage()): Levels {
  const cur = { ...readLevels(s), ...l };
  try {
    if (l.on !== undefined) s?.setItem(MASTER_KEY, cur.on ? "on" : "off");
    s?.setItem(LEVELS_KEY, JSON.stringify({ music: cur.music, fx: cur.fx, voice: cur.voice }));
  } catch { /* not kept */ }
  return cur;
}

/** The match state the soundscape follows (from the session view). */
export interface MatchSoundInput {
  id: string;
  mode: GameMode;
  activity: Activity;
  phase: string;
  paused: boolean;
  finished: boolean;
  nearestM: number | null;
}

export interface Clock { nowS(): number }

/**
 * The match's sounds: threat pulses, close zombie, helicopter phases, event sounds. One instance; `update` is fed from the game screen,
 * `onEvent` from the session, `end` when the game screen goes away.
 */
export class MatchAudio {
  private readonly threat: ThreatGate;
  private readonly near = new NearGate();
  private readonly revealed = new Cooldown(SOUND_RULES.revealed.cooldownS);
  private threatVoice: LoopVoice | null = null;
  private heliLoop: LoopVoice | null = null;
  private approach: Voice | null = null;
  private matchId: string | null = null;
  private input: MatchSoundInput | null = null;
  private hidden = false;
  private done = false;

  constructor(private readonly s: Soundscape, private readonly clock: Clock, random: () => number = Math.random) {
    this.threat = new ThreatGate(AUDIO.threat.length, random);
  }

  /** Whether a match is being played right now (sound may follow it). */
  private running(i: MatchSoundInput | null): boolean {
    return !!i && !i.paused && !i.finished && !this.hidden && !this.done && this.s.enabled;
  }

  private ticker: unknown = null;

  update(i: MatchSoundInput | null): void {
    if (!i) { this.end(); return; }
    if (i.id !== this.matchId) this.newMatch(i);
    this.input = i;
    // The rules are timed (dwell, cooldowns): re-evaluate every second even when nothing on screen changes (a still zombie, a still player).
    if (this.ticker === null && !i.finished) this.ticker = this.s.later(() => { this.ticker = null; if (this.input) this.update(this.input); }, 1000);
    if (i.finished) this.done = true;
    const t = this.clock.nowS();
    const run = this.running(i);
    const a = this.threat.update(t, i.nearestM, i.activity, run);
    if (a && "start" in a) {
      this.threatVoice?.stop(SOUND_RULES.threat.stopFadeS);
      this.threatVoice = this.s.loop(AUDIO.threat[a.start], "threat", GAIN.threat, 0.12);
      void this.threatVoice.start(SOUND_RULES.threat.fadeInS);
    } else if (a && "stop" in a) {
      this.threatVoice?.stop(a.stop === "fade" ? SOUND_RULES.threat.fadeOutS : SOUND_RULES.threat.stopFadeS);
      this.threatVoice = null;
    }
    if (this.near.update(t, i.nearestM, i.activity, run)) void this.s.play(AUDIO.zombieNear, "fx", GAIN.zombieNear);
    // The helicopter waits while extraction is open (Survival). A restored match in that phase gets the loop without the approach.
    const wantLoop = run && i.mode === "survival" && i.phase === "extraction";
    if (wantLoop && !this.heliLoop?.playing) {
      this.heliLoop = this.s.loop(AUDIO.heliLoop, "heli", GAIN.heliLoop, 0.35);
      void this.heliLoop.start(SOUND_RULES.heli.loopFadeInS);
      this.approach?.stop(SOUND_RULES.heli.approachFadeOutS);
      this.approach = null;
    } else if (!wantLoop && this.heliLoop?.playing) {
      this.heliLoop.stop(i.finished ? SOUND_RULES.heli.loopStopS : 1.5);
      this.heliLoop = null;
    }
    if (!run && (i.paused || this.hidden)) { this.approach?.stop(0.8); this.approach = null; }
  }

  /** A game moment from the session. Resolves with what came of its sound (for the field log), or null when it has none. */
  onEvent(e: SoundEvent): Promise<PlayResult | null> {
    if (e.type === "finished") return this.finish(e.result, e.mode);
    // Moments worked out on return from the background happened while the app was away: no late sound for them.
    if (e.stale || this.hidden || this.done) return Promise.resolve("suppressed");
    const res = (p: Promise<{ result: PlayResult }>) => p.then((r) => r.result);
    switch (e.type) {
      case "checkpoint": return res(this.s.play(AUDIO.checkpoint, "fx", GAIN.checkpoint));
      case "revealed": return this.revealed.take(this.clock.nowS()) ? this.afterVoice(() => res(this.s.play(AUDIO.revealed, "fx", GAIN.revealed))) : Promise.resolve("suppressed");
      case "heli_approach":
        return this.s.play(AUDIO.heliApproach, "heli", GAIN.heliApproach, 4000).then((r) => {
          // Landed in the meantime (very short lead): the loop is already there.
          if (r.voice && (this.heliLoop?.playing || this.done)) r.voice.stop(SOUND_RULES.heli.approachFadeOutS);
          else if (r.voice) this.approach = r.voice;
          return r.result;
        });
      case "heli_landed": return Promise.resolve(null); // the loop follows the phase (see update), from the same tick as the landed card
    }
  }

  private waits = new Set<unknown>();
  /**
   * Plays a warning after the operator's voice (and its radio click) instead of over it: the hunt begins in the very first second, together
   * with "Game on". Given up after a few seconds, or if the match ends or the app is hidden meanwhile.
   */
  private afterVoice(fn: () => Promise<PlayResult>): Promise<PlayResult> {
    if (!this.s.ducked) return fn();
    const id = this.matchId;
    return new Promise((resolve) => {
      let waited = 0;
      const step = () => {
        const h = this.s.later(() => {
          this.waits.delete(h);
          waited += 250;
          if (this.done || this.hidden || this.matchId !== id) { resolve("suppressed"); return; }
          if (this.s.ducked && waited < 4000) { step(); return; }
          if (this.s.ducked) { resolve("suppressed"); return; }
          void fn().then(resolve, () => resolve("error"));
        }, 250);
        this.waits.add(h);
      };
      step();
    });
  }

  /** The match ended: background loops out, then the ending's own sound (once). */
  private finish(result: string, mode: GameMode): Promise<PlayResult | null> {
    if (this.done && this.endedWith !== null) return Promise.resolve(null);
    this.done = true;
    this.endedWith = result;
    this.stopLoops(SOUND_RULES.heli.loopStopS);
    const url = result === "infected" ? AUDIO.captured
      : result === "survived" ? (mode === "survival" ? AUDIO.heliSuccess : AUDIO.safeDoor)
      : null; // out of time, quit: no sound
    if (!url) return Promise.resolve(null);
    return this.s.play(url, "fx", url === AUDIO.captured ? GAIN.captured : url === AUDIO.safeDoor ? GAIN.safeDoor : GAIN.heliSuccess, 2500).then((r) => r.result);
  }
  private endedWith: string | null = null;

  private stopLoops(fadeS: number): void {
    for (const h of this.waits) this.s.cancel(h);
    this.waits.clear();
    this.threatVoice?.stop(fadeS);
    this.threatVoice = null;
    this.heliLoop?.stop(fadeS);
    this.heliLoop = null;
    this.approach?.stop(fadeS);
    this.approach = null;
    this.threat.update(this.clock.nowS(), null, "walk", false);
  }

  private newMatch(i: MatchSoundInput): void {
    this.stopLoops(0.3);
    this.threat.reset();
    this.near.reset();
    this.revealed.reset();
    this.matchId = i.id;
    this.done = false;
    this.endedWith = null;
    this.s.preload(i.mode === "survival" ? [...MATCH_SOUNDS, ...HELI_SOUNDS] : MATCH_SOUNDS);
  }

  /** The game screen went away (quit, home, reset): nothing of the match may keep sounding. */
  end(): void {
    if (this.ticker !== null) { this.s.cancel(this.ticker); this.ticker = null; }
    this.stopLoops(0.4);
    this.input = null;
    this.matchId = null;
  }

  /** App to the background and back. Loops go at once and come back (with their fade) only if the match still calls for them. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.stopLoops(0.2);
    else if (this.input) this.update(this.input);
  }

  /** For tests: what is sounding. */
  get state() { return { threat: this.threatVoice?.playing ? this.threatVoice.url : null, heliLoop: !!this.heliLoop?.playing, approach: !!this.approach?.playing }; }
}

function browserEnv(): SoundscapeEnv {
  return {
    createContext: () => new AudioContext({ latencyHint: "playback" }),
    fetchBytes: async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); },
    createMediaElement: () => new Audio(),
    // A blob URL of the (service-worker cached) file: plays offline, and the media element never sends range requests the cache cannot answer.
    musicUrl: async (url) => { const r = await fetch(url); if (!r.ok) return null; return URL.createObjectURL(await r.blob()); },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}

let scape: Soundscape | null = null;
let match: MatchAudio | null = null;
/** The app's one soundscape (browser only). */
export function soundscape(): Soundscape {
  scape ??= new Soundscape(browserEnv(), { mix: MIX, duckTo: DUCK.to, duckAttackS: DUCK.attackS, duckReleaseS: DUCK.releaseS, levels: () => readLevels() }, {
    url: AUDIO.music,
    // The file starts with 4.2 s of silence and fades out from about 207.5 s to 210.6 s (measured; see assets/audio/README.md).
    startS: 4,
    endS: 210.6,
    crossfadeS: 3.5,
    fadeInS: 3,
    fadeOutS: 2.5,
  });
  return scape;
}
export function matchAudio(): MatchAudio {
  match ??= new MatchAudio(soundscape(), { nowS: () => Date.now() / 1000 });
  return match;
}
