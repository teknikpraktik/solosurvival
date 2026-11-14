import type { Activity } from "@/config/activities";
import type { GameMode } from "@/engine/objectives/objectives";
import type { SoundEvent } from "@/play/session";
import { Cooldown, NearGate, SOUND_RULES, ThreatGate, between, pickVariant } from "@/play/sound-rules";
import { VOICE_COUNTDOWN_M, nextCountdown, type CountdownStep } from "@/play/countdown";
import { Soundscape, type Bus, type Levels, type LoopVoice, type MusicSource, type MusicTrack, type PlayResult, type SoundscapeEnv, type Voice } from "@/audio/soundscape";

/**
 * OUTBREAK's soundscape (adult app only; Mini Outbreak has its own sound pack and never loads this file). Menu music, threat pulses,
 * helicopter phases and event sounds, all through one Web Audio context. The files are built by scripts/build-audio.mjs from
 * assets/audio/source/; game rules for when they play are in src/play/sound-rules.ts.
 */
export const AUDIO = {
  music: "/audio/theme-outbreak.mp3",
  musicV2: "/audio/theme-v2.mp3",
  musicV3: "/audio/theme-v3.mp3",
  threat: ["/audio/threat-pulse-1.mp3", "/audio/threat-pulse-2.mp3", "/audio/threat-pulse-3.mp3", "/audio/threat-pulse-4.mp3"],
  captured: "/audio/captured.mp3",
  safeDoor: "/audio/safe-door-close.mp3",
  heliSuccess: "/audio/heli-extraction-success.mp3",
  heliLoop: "/audio/heli-extraction.mp3",
  heliApproach: "/audio/heli-approach.mp3",
  zombieNear: "/audio/zombie-near.mp3",
  revealed: "/audio/position-revealed.mp3",
  checkpoint: "/audio/checkpoint-reached.mp3",
} as const;

/**
 * The operator's recorded radio lines. The radio effect, static and squelch are in the files (checked: 80–94 % of the energy in
 * 300–3 400 Hz), so no radio click is added before them. `text` is what is said (machine-transcribed and checked by ear in the transcript
 * only, see docs/LJUD.md); it is kept for the field log.
 */
export const VOICE = {
  keepMoving: { url: "/audio/keep-moving.mp3", text: "You're on your own out there. Keep moving. Stay alive." },
  safehouseOnMap: { url: "/audio/safehouse-on-map.mp3", text: "Safe house marked on your map. Get there alive." },
  checkpointSecured: { url: "/audio/checkpoint-secured.mp3", text: "Checkpoint secured. Keep moving." },
  getToSafehouse: { url: "/audio/get-to-safehouse.mp3", text: "All checkpoints secured. Get to the safe house." },
  rescueInbound: { url: "/audio/rescue-inbound.mp3", text: "Rescue inbound. Stand by for the extraction point." },
  getToHelicopter: { url: "/audio/get-to-helicopter.mp3", text: "We're down. Get to the helicopter. We can't stay long." },
  liftingOff: { url: "/audio/lifting-off.mp3", text: "Lifting off. You made it." },
  insideSafehouse: { url: "/audio/inside-safehouse.mp3", text: "You're inside. Lock the door. You made it." },
  checkpointStart: { url: "/audio/checkpoint-start.mp3", text: "Checkpoints marked on your map. Secure them all, then get to the safe house. Stay alive." },
  // The nearest zombie's distance as it closes in (the uploaded files were named for other numbers than they say; mapped by what is said).
  count50: { url: "/audio/countdown-50.mp3", text: "Fifty." },
  count40: { url: "/audio/countdown-40.mp3", text: "Forty." },
  count30: { url: "/audio/countdown-30.mp3", text: "Thirty." },
  count20: { url: "/audio/countdown-20.mp3", text: "Twenty." },
  count10: { url: "/audio/countdown-10.mp3", text: "Ten." },
  zombiesApproaching: { url: "/audio/zombies-approaching.mp3", text: "Zombies approaching!" },
} as const;
export type VoiceLine = keyof typeof VOICE;
const COUNT_LINE: Record<(typeof VOICE_COUNTDOWN_M)[number], VoiceLine> = { 50: "count50", 40: "count40", 30: "count30", 20: "count20", 10: "count10" };
const COUNT_LINES: readonly VoiceLine[] = Object.values(COUNT_LINE);

/** Every match: decoded while the player sets up the match. */
export const MATCH_SOUNDS: readonly string[] = [
  ...AUDIO.threat, AUDIO.captured, AUDIO.safeDoor, AUDIO.zombieNear, AUDIO.revealed, AUDIO.checkpoint,
  VOICE.safehouseOnMap.url, VOICE.checkpointSecured.url, VOICE.getToSafehouse.url, VOICE.insideSafehouse.url, VOICE.keepMoving.url,
  VOICE.checkpointStart.url, VOICE.zombiesApproaching.url, ...COUNT_LINES.map((l) => VOICE[l].url),
];
/** Survival only (larger files): decoded when a Survival match is chosen or starts. */
export const HELI_SOUNDS: readonly string[] = [AUDIO.heliApproach, AUDIO.heliLoop, AUDIO.heliSuccess, VOICE.rescueInbound.url, VOICE.getToHelicopter.url, VOICE.liftingOff.url];

/**
 * The mix. The files are levelled (scripts/build-audio.mjs: one-shots ≈ −14 LUFS momentary peak, threat pulses −24 LUFS and the waiting
 * helicopter −20 LUFS integrated, true peak ≤ −1 dBTP); these gains place them against each other and under the voice.
 */
export const MIX: Record<Bus, number> = { music: 0.32, threat: 1, heli: 0.8, fx: 1, voice: 1 };
/** Per sound, on its bus (linear). */
export const GAIN = {
  // Threat pulse ≈ +5 dB after the field test (bus 0.7 → 1, pulse 1 → 1.25; the files peak at −4.8 dBTP or lower, the limiter guards the sum).
  threat: 1.25, heliLoop: 0.7, heliApproach: 0.9, heliSuccess: 1, captured: 1, safeDoor: 1, zombieNear: 0.8, revealed: 0.75, checkpoint: 0.7,
  // The operator's lines −2.5 dB after the field test (the radio static was felt too loud; the files also have it lowered between the words).
  voice: 0.75,
} as const;
/** Under the operator's recorded lines, music/threat/helicopter go down to this (≈ −10 dB). */
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

/**
 * The operator's radio channel: one recorded line at a time, never two over each other. A line that comes while another is playing waits
 * (one place in the queue, the newest wins) and is dropped if it would come too late. A final line (the win) interrupts whatever plays.
 * While a line plays, music, threat and helicopter are lowered; the duck is released however the line ends (end, stop, missing file).
 */
export class RadioVoices {
  private cur: { line: VoiceLine; token: number; final: boolean; voice: Voice | null } | null = null;
  private pending: { line: VoiceLine; at: number; final: boolean; resolve: (r: PlayResult) => void } | null = null;
  private token = 0;
  private idle: (() => void)[] = [];
  /** Lines started, for the field log and tests. */
  readonly log: VoiceLine[] = [];

  /**
   * `maxQueueMs`: a waiting line older than this is dropped. Lines lose their meaning through events (the match ends, the helicopter lands),
   * which drop them at once; this limit only keeps a line from coming long after its moment. A recorded line is up to 8 s.
   */
  constructor(private readonly s: Soundscape, private readonly nowMs: () => number, private readonly maxQueueMs = 12_000) {}

  get busy(): boolean { return this.cur !== null; }
  /** Resolves when no line plays or waits (at once if none does). */
  whenIdle(): Promise<void> {
    if (!this.cur && !this.pending) return Promise.resolve();
    return new Promise((r) => this.idle.push(r));
  }
  get speaking(): VoiceLine | null { return this.cur?.line ?? null; }
  get queued(): VoiceLine | null { return this.pending?.line ?? null; }

  /**
   * Says a line. `supersedes`: lines that are no longer true once this one is (a playing or waiting one is dropped). Resolves with what
   * came of it: "played", "suppressed" (dropped, replaced, too late), or the soundscape's reason ("muted", "missing", …).
   */
  say(line: VoiceLine, o: { final?: boolean; urgent?: boolean; supersedes?: readonly VoiceLine[] } = {}): Promise<PlayResult> {
    const final = !!o.final;
    // Urgent (the zombie distance): now, not after a line; it cuts a playing line and drops a waiting one, but never the win line.
    if (o.urgent && !final) {
      if (this.cur?.final || this.pending?.final) return Promise.resolve("suppressed");
      this.dropPending();
      this.stopCurrent();
      return this.start(line, false);
    }
    if (o.supersedes?.length) {
      if (this.pending && o.supersedes.includes(this.pending.line)) this.dropPending();
      if (this.cur && o.supersedes.includes(this.cur.line)) this.stopCurrent();
    }
    if (final) this.stop();
    if (!this.cur) return this.start(line, final);
    if (this.pending?.final) return Promise.resolve("suppressed");
    this.dropPending();
    return new Promise((resolve) => { this.pending = { line, at: this.nowMs(), final, resolve }; });
  }

  private async start(line: VoiceLine, final: boolean): Promise<PlayResult> {
    const token = ++this.token;
    this.cur = { line, token, final, voice: null };
    this.s.setDuck("voice", true);
    this.log.push(line);
    const r = await this.s.play(VOICE[line].url, "voice", GAIN.voice, 1500, () => this.ended(token));
    if (token !== this.token || this.cur?.token !== token) {
      // Stopped while the file was loading: it must not start late.
      r.voice?.stop(0.05);
      if (!r.voice) this.ended(token);
      return "suppressed";
    }
    this.cur.voice = r.voice ?? null;
    if (r.result !== "played") this.ended(token);
    return r.result;
  }

  private ended(token: number): void {
    if (this.cur?.token !== token) { this.releaseIfIdle(); return; }
    this.cur = null;
    const next = this.pending;
    this.pending = null;
    if (next && this.nowMs() - next.at <= this.maxQueueMs) { void this.start(next.line, next.final).then(next.resolve); return; }
    next?.resolve("suppressed");
    this.releaseIfIdle();
  }

  private releaseIfIdle(): void {
    if (this.cur) return;
    this.s.setDuck("voice", false);
    if (this.pending) return;
    const waiting = this.idle;
    this.idle = [];
    for (const r of waiting) r();
  }

  private dropPending(): void { const p = this.pending; this.pending = null; p?.resolve("suppressed"); }

  private stopCurrent(): void {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    this.token++;
    if (c.voice) c.voice.stop(0.15); // its onEnd finds a newer token and only releases the duck
    else this.releaseIfIdle();
  }

  /** Stops the playing line and drops the waiting one. `keepFinal`: a win line that plays or waits is left alone (the ending sequence). */
  stop(o: { keepFinal?: boolean } = {}): void {
    if (!(o.keepFinal && this.pending?.final)) this.dropPending();
    if (!(o.keepFinal && this.cur?.final)) this.stopCurrent();
  }
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
  private readonly approaching = new NearGate(SOUND_RULES.approach);
  private readonly revealed = new Cooldown(SOUND_RULES.revealed.cooldownS);
  /** The last distance step said (spoken countdown 50…10 m). */
  private countdown: CountdownStep | null = null;
  private threatVoice: LoopVoice | null = null;
  private heliLoop: LoopVoice | null = null;
  private approach: Voice | null = null;
  private matchId: string | null = null;
  private input: MatchSoundInput | null = null;
  private hidden = false;
  private done = false;

  /** The operator's recorded lines (one at a time). */
  readonly radio: RadioVoices;

  constructor(private readonly s: Soundscape, private readonly clock: Clock, private readonly random: () => number = Math.random) {
    this.threat = new ThreatGate(AUDIO.threat.length, random);
    this.radio = new RadioVoices(s, () => clock.nowS() * 1000);
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
      this.stopBursts(SOUND_RULES.threat.stopFadeS);
      this.burst(a.start, SOUND_RULES.threat.fadeInS);
    } else if (a && "stop" in a) {
      this.stopBursts(a.stop === "fade" ? SOUND_RULES.threat.fadeOutS : SOUND_RULES.threat.stopFadeS);
    }
    // 200 m: the operator's "Zombies approaching!" (urgent, like the countdown); 100 m: the zombies' roar. A zombie that appears inside
    // 100 m at once gets the roar only.
    const roar = this.near.update(t, i.nearestM, i.activity, run);
    const warn = this.approaching.update(t, i.nearestM, i.activity, run);
    if (roar) void this.s.play(AUDIO.zombieNear, "fx", GAIN.zombieNear);
    else if (warn) void this.radio.say("zombiesApproaching", { urgent: true });
    // Spoken distance as the nearest zombie closes in: 50, 40, 30, 20, 10 m, each once per approach (re-armed after it has dropped back).
    const c = nextCountdown(this.countdown, run ? i.nearestM : null, VOICE_COUNTDOWN_M);
    this.countdown = c.last;
    if (c.say !== null) void this.radio.say(COUNT_LINE[c.say as keyof typeof COUNT_LINE], { urgent: true });
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
    if (e.type === "match_started") return this.started(e.id, e.mode);
    // Moments worked out on return from the background happened while the app was away: no late sound for them.
    if (e.stale || this.hidden || this.done) return Promise.resolve("suppressed");
    const res = (p: Promise<{ result: PlayResult }>) => p.then((r) => r.result);
    switch (e.type) {
      // The radio line replaces the old chime; the chime comes back only if the line cannot play (missing or broken file).
      case "checkpoint":
        return this.radio.say(e.last ? "getToSafehouse" : "checkpointSecured").then((r) => {
          if (failed(r)) void this.s.play(AUDIO.checkpoint, "fx", GAIN.checkpoint);
          return r;
        });
      case "revealed": return this.revealed.take(this.clock.nowS()) ? this.afterVoice(() => res(this.s.play(AUDIO.revealed, "fx", GAIN.revealed))) : Promise.resolve("suppressed");
      case "heli_approach":
        void this.radio.say("rescueInbound");
        return this.s.play(AUDIO.heliApproach, "heli", GAIN.heliApproach, 4000).then((r) => {
          // Landed in the meantime (very short lead): the loop is already there.
          if (r.voice && (this.heliLoop?.playing || this.done)) r.voice.stop(SOUND_RULES.heli.approachFadeOutS);
          else if (r.voice) this.approach = r.voice;
          return r.result;
        });
      // The loop follows the phase (see update), from the same tick as the landed card. "Rescue inbound" is no longer true once it has landed.
      case "heli_landed":
        return this.radio.say("getToHelicopter", { supersedes: ["rescueInbound"] });
    }
  }

  private waits = new Set<unknown>();
  /**
   * Plays a warning after the operator's recorded line instead of over it: the hunt begins in the very first second, together with the
   * opening line. Given up after a few seconds, or if the match ends or the app is hidden meanwhile.
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
          if (this.s.ducked && waited < 9000) { step(); return; } // a recorded line is up to 8 s
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
    this.setEndDone(false);
    this.stopLoops(SOUND_RULES.heli.loopStopS);
    // Lines about the match (start, checkpoints, helicopter) are over; a win gets its own line, part of the ending.
    this.radio.stop();
    const line = result === "survived" && !this.hidden ? this.radio.say(mode === "survival" ? "liftingOff" : "insideSafehouse", { final: true }) : null;
    const url = result === "infected" ? AUDIO.captured
      : result === "survived" ? (mode === "survival" ? AUDIO.heliSuccess : AUDIO.safeDoor)
      : null; // out of time, quit: no sound
    // The ending's sounds are done when its effect has ended and the operator has finished speaking (the music comes back then). A safety
    // limit keeps a lost "ended" from holding the music back.
    let effectEnded!: () => void;
    const effect = new Promise<void>((r) => { effectEnded = r; });
    const id = this.matchId;
    // Safety: a lost "ended" (effect or line) never keeps the music away longer than this.
    const safety = this.s.later(() => { if (this.matchId === id && this.endedWith === result) this.setEndDone(true); }, END_SEQUENCE_MAX_MS);
    const played = url
      ? this.s.play(url, "fx", url === AUDIO.captured ? GAIN.captured : url === AUDIO.safeDoor ? GAIN.safeDoor : GAIN.heliSuccess, 2500, () => effectEnded())
        .then((r) => { if (!r.voice) effectEnded(); return r.result; })
      : (effectEnded(), Promise.resolve(null));
    void Promise.all([effect, (line ?? Promise.resolve(null)).then(() => this.radio.whenIdle())]).then(() => {
      this.s.cancel(safety);
      if (this.matchId === id && this.endedWith === result) this.setEndDone(true);
    });
    return played;
  }

  /** The ending's own sounds (effect and win line) have been heard: the menu music may come back. */
  get endSequenceDone(): boolean { return this.endDone; }
  private endDone = false;
  private endListeners = new Set<(done: boolean) => void>();
  onEndSequence(fn: (done: boolean) => void): () => void { this.endListeners.add(fn); return () => this.endListeners.delete(fn); }
  private setEndDone(done: boolean): void {
    if (this.endDone === done) return;
    this.endDone = done;
    for (const fn of [...this.endListeners]) { try { fn(done); } catch { /* ignored */ } }
  }
  private endedWith: string | null = null;

  private stopLoops(fadeS: number): void {
    for (const h of this.waits) this.s.cancel(h);
    this.waits.clear();
    this.stopBursts(fadeS);
    this.heliLoop?.stop(fadeS);
    this.heliLoop = null;
    this.approach?.stop(fadeS);
    this.approach = null;
    this.threat.update(this.clock.nowS(), null, "walk", false);
  }

  /** A match begins (after START, not on the setup step): the opening line for its mode. */
  private started(id: string, mode: GameMode): Promise<PlayResult | null> {
    if (id !== this.matchId) this.newMatch({ id, mode });
    if (this.hidden) return Promise.resolve("suppressed");
    return this.radio.say(mode === "survival" ? "keepMoving" : mode === "escape" ? "safehouseOnMap" : "checkpointStart");
  }

  private newMatch(i: Pick<MatchSoundInput, "id" | "mode">): void {
    // The previous match's state and its clock go: a tick must never bring back an old match's id.
    if (this.input && this.input.id !== i.id) {
      this.input = null;
      if (this.ticker !== null) { this.s.cancel(this.ticker); this.ticker = null; }
    }
    this.radio.stop();
    this.stopLoops(0.3);
    this.threat.reset();
    this.near.reset();
    this.approaching.reset();
    this.countdown = null;
    this.revealed.reset();
    this.matchId = i.id;
    this.done = false;
    this.endedWith = null;
    this.setEndDone(false);
    this.s.preload(i.mode === "survival" ? [...MATCH_SOUNDS, ...HELI_SOUNDS] : MATCH_SOUNDS);
  }

  /** The game screen went away (quit, home, reset): nothing of the match may keep sounding. */
  end(): void {
    if (this.ticker !== null) { this.s.cancel(this.ticker); this.ticker = null; }
    this.stopLoops(0.4);
    this.radio.stop(); // also the win line: the ending was left
    this.input = null;
    this.matchId = null;
  }

  /** App to the background and back. Loops go at once and come back (with their fade) only if the match still calls for them. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) { this.stopLoops(0.2); this.radio.stop(); }
    else if (this.input) this.update(this.input);
  }

  private burstTimer: unknown = null;
  /**
   * One burst of the threat pulse: a random length, then a fade-out and a random silence, then the next burst with another variant, for
   * as long as the threat period lasts (the gate decides that; stopBursts ends it).
   */
  private burst(variant: number, fadeInS: number): void {
    const T = SOUND_RULES.threat;
    this.threatVoice = this.s.loop(AUDIO.threat[variant], "threat", GAIN.threat, 0.12);
    void this.threatVoice.start(fadeInS);
    this.burstTimer = this.s.later(() => {
      this.threatVoice?.stop(T.burstFadeOutS);
      this.threatVoice = null;
      this.burstTimer = this.s.later(() => {
        this.burstTimer = null;
        if (this.threat.active && this.running(this.input)) this.burst(pickVariant(variant, AUDIO.threat.length, this.random), T.burstFadeInS);
      }, (T.burstFadeOutS + between(T.restS, this.random)) * 1000);
    }, between(T.burstS, this.random) * 1000);
  }

  private stopBursts(fadeS: number): void {
    if (this.burstTimer !== null) { this.s.cancel(this.burstTimer); this.burstTimer = null; }
    this.threatVoice?.stop(fadeS);
    this.threatVoice = null;
  }

  /** For tests: what is sounding. */
  get state() { return { threat: this.threatVoice?.playing ? this.threatVoice.url : null, heliLoop: !!this.heliLoop?.playing, approach: !!this.approach?.playing, voice: this.radio.speaking }; }
}

/** The music waits at most this long for the ending's sounds (longest: 7 s effect, 7 s line). */
const END_SEQUENCE_MAX_MS = 15_000;

/** A line that could not be heard for a reason other than the player's own choice (muted) or being replaced. */
const failed = (r: PlayResult) => r === "missing" || r === "error";

/** Pages without music: the test mode and the simulator. */
const NO_MUSIC = /^\/(field|dev)(\/|$)/;

/** What the music does: repeat (menu, after a match), finish the pass that plays (during a match), or stop. */
export type MusicMode = "loop" | "finish" | "off";

/**
 * The music for a page and match state. It starts as the app opens and repeats on the menu. A match does not stop it: the pass that plays
 * when the match starts plays to its end alongside the game (no fade-out, no new pass). When the match is over it comes back, repeating,
 * once the ending's own sounds (capture, door, helicopter, the operator's last line) have been heard.
 */
export function musicMode(path: string, match: { paused: boolean; elapsedS: number; phase: string } | null | undefined, opts: { autoStartPending: boolean; finished: boolean; endSequenceDone: boolean }): MusicMode {
  if (NO_MUSIC.test(path)) return "off";
  if (!path.startsWith("/play")) return "loop";
  if (!match) return "finish"; // loading or leaving: leave the music as it is
  if (opts.finished || match.phase === "finished") return opts.endSequenceDone ? "loop" : "finish";
  const waiting = opts.autoStartPending && match.paused && match.elapsedS < 0.5;
  return waiting ? "loop" : "finish";
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
  scape ??= new Soundscape(browserEnv(), { mix: MIX, duckTo: DUCK.to, duckAttackS: DUCK.attackS, duckReleaseS: DUCK.releaseS, levels: () => readLevels() }, MUSIC_PLAYLIST);
  return scape;
}

/**
 * The music: theme-outbreak opens the app; after that every pass is a random theme, never the one just heard. Start and end are where the
 * music really is (measured, see assets/audio/README.md). theme-v2 and theme-v3 are about 14 dB quieter than theme-outbreak (−29.7 against
 * −16 LUFS integrated) and are lifted here instead of re-encoded; they also stop abruptly, so a pass that is not crossfaded fades out
 * over its last `endFadeS`.
 */
export const MUSIC_TRACKS: MusicTrack[] = [
  { url: AUDIO.music, startS: 4, endS: 210.6, gain: 1 }, // 4.2 s of silence first, own fade-out 207.5–210.6 s
  { url: AUDIO.musicV2, startS: 2.1, endS: 62, gain: 10 ** (13.6 / 20) }, // −29.6 → −16 LUFS (peak −15.4 → −1.8 dBFS)
  { url: AUDIO.musicV3, startS: 6.6, endS: 66.5, gain: 10 ** (13.2 / 20) }, // −29.7 → −16.5 LUFS (peak −14.2 → −1.0 dBFS)
];
export const MUSIC_PLAYLIST: MusicSource = {
  tracks: MUSIC_TRACKS,
  crossfadeS: 3.5,
  fadeInS: 3,
  fadeOutS: 2.5,
  endFadeS: 2.5,
  // During a match: after a theme has ended, a random silence of 20–60 s before the next random theme.
  gapS: [20, 60],
};
export function matchAudio(): MatchAudio {
  match ??= new MatchAudio(soundscape(), { nowS: () => Date.now() / 1000 });
  return match;
}
