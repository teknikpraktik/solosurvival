import type { Activity } from "@/config/activities";
import type { GameMode } from "@/engine/objectives/objectives";
import type { SoundEvent } from "@/play/session";
import { Cooldown, NearGate, SOUND_RULES, pickVariant } from "@/play/sound-rules";
import { VOICE_COUNTDOWN_M, nextCountdown, type CountdownStep } from "@/play/countdown";
import { beatVoiceUrl } from "@/campaign";
import { RECORDED_BEATS } from "@/campaign/voice-manifest";
import { Soundscape, type Bus, type Levels, type LoopVoice, type MusicSource, type MusicTrack, type PlayResult, type SoundscapeEnv, type Voice } from "@/audio/soundscape";

/**
 * OUTBREAK's soundscape (adult app only; Mini Outbreak has its own sound pack and never loads this file). Menu music, the close-zombie warnings,
 * helicopter phases and event sounds, all through one Web Audio context. The files are built by scripts/build-audio.mjs from
 * assets/audio/source/; game rules for when they play are in src/play/sound-rules.ts.
 */
/** The rest of the soundtrack, besides the theme's three versions in AUDIO (where each plays: MUSIC_PLAYLIST). */
export const SOUNDTRACK = {
  frostborne1: "/audio/music-frostborne-silence-1.mp3",
  fragile: "/audio/music-fragile-motif.mp3",
  fragile1: "/audio/music-fragile-motif-1.mp3",
  threeNote: "/audio/music-three-note-motif.mp3",
  stairwell: "/audio/music-stairwell-silence.mp3",
  untitled1: "/audio/music-untitled-1.mp3",
  footstep: "/audio/music-missing-footstep.mp3",
  groove: "/audio/music-relentless-groove.mp3",
  finalSilence: "/audio/music-final-silence.mp3",
} as const;

export const AUDIO = {
  music: "/audio/theme-frostborne.mp3",
  musicFade: "/audio/theme-frostborne-fade.mp3",
  musicShort: "/audio/theme-frostborne-short.mp3",

  /** 1–4: 15 s; 5–14: 30 s (a burst starts at a random place in them). */
  captured: "/audio/captured.mp3",
  safeDoor: "/audio/safe-door-close.mp3",
  heliSuccess: "/audio/heli-extraction-success.mp3",
  heliLoop: "/audio/heli-extraction.mp3",
  heliApproach: "/audio/heli-approach.mp3",
  zombieNear: "/audio/zombie-near.mp3",
  revealed: "/audio/position-revealed.mp3",
  checkpoint: "/audio/checkpoint-reached.mp3",
  jump: ["/audio/jump-scare-1.mp3", "/audio/jump-scare-2.mp3", "/audio/jump-scare-3.mp3"],
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
  ...AUDIO.jump, AUDIO.captured, AUDIO.safeDoor, AUDIO.zombieNear, AUDIO.revealed, AUDIO.checkpoint,
  VOICE.safehouseOnMap.url, VOICE.checkpointSecured.url, VOICE.getToSafehouse.url, VOICE.insideSafehouse.url, VOICE.keepMoving.url,
  VOICE.checkpointStart.url, VOICE.zombiesApproaching.url, ...COUNT_LINES.map((l) => VOICE[l].url),
];
/** Survival only (larger files): decoded when a Survival match is chosen or starts. */
export const HELI_SOUNDS: readonly string[] = [AUDIO.heliApproach, AUDIO.heliLoop, AUDIO.heliSuccess, VOICE.rescueInbound.url, VOICE.getToHelicopter.url, VOICE.liftingOff.url];

/**
 * The mix. The files are levelled (scripts/build-audio.mjs: one-shots ≈ −14 LUFS momentary peak, the waiting helicopter −20 LUFS integrated, true peak ≤ −1 dBTP); these gains place them against each other and under the voice.
 */
/** `threat` has no sound since the threat pulse went (field test); it is kept for the close-zombie layer to come (steps, breathing). */
export const MIX: Record<Bus, number> = { music: 0.32, threat: 1, heli: 0.8, fx: 1, voice: 1 };
/** Per sound, on its bus (linear). */
export const GAIN = {
  heliLoop: 0.7, heliApproach: 0.9, heliSuccess: 1, captured: 1, safeDoor: 1, zombieNear: 0.8, revealed: 0.75, checkpoint: 0.7,
  // A sprinting zombie is the roar again, a little lower; contact is the warning sting at full level.
  sprint: 0.7, contact: 1,
  // A new infected: a scream (the files are levelled a little above the other one-shots), placed further off (≈ −4.4 dB): someone out there.
  infected: 0.6,
  // Campaign: the soft chime that says "a radio message came in" while a line has no recording yet.
  radioCue: 0.45,
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
  private cur: { line: string; token: number; final: boolean; voice: Voice | null } | null = null;
  private pending: { line: string; at: number; final: boolean; resolve: (r: PlayResult) => void } | null = null;
  /** Campaign lines: where each one's recording is (the game's own lines are in VOICE). */
  private readonly clips = new Map<string, string>();
  private token = 0;
  private idle: (() => void)[] = [];
  /** Lines started, for the field log and tests. */
  readonly log: string[] = [];

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
  get speaking(): string | null { return this.cur?.line ?? null; }
  get queued(): string | null { return this.pending?.line ?? null; }

  /** A campaign line with its own recording at `url`. `queue`: after the line that plays (also an ending line), instead of replacing it. */
  sayClip(id: string, url: string, o: { final?: boolean; queue?: boolean } = {}): Promise<PlayResult> {
    this.clips.set(id, url);
    return this.say(id, o);
  }

  /**
   * Says a line. `supersedes`: lines that are no longer true once this one is (a playing or waiting one is dropped). Resolves with what
   * came of it: "played", "suppressed" (dropped, replaced, too late), or the soundscape's reason ("muted", "missing", …).
   */
  say(line: VoiceLine | string, o: { final?: boolean; urgent?: boolean; supersedes?: readonly string[]; queue?: boolean } = {}): Promise<PlayResult> {
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
    if (final && !o.queue) this.stop();
    if (!this.cur) return this.start(line, final);
    if (this.pending?.final && !final) return Promise.resolve("suppressed");
    this.dropPending();
    return new Promise((resolve) => { this.pending = { line, at: this.nowMs(), final, resolve }; });
  }

  private async start(line: string, final: boolean): Promise<PlayResult> {
    const token = ++this.token;
    this.cur = { line, token, final, voice: null };
    this.s.setDuck("voice", true);
    this.log.push(line);
    const url = this.clips.get(line) ?? (VOICE as Record<string, { url: string } | undefined>)[line]?.url;
    if (!url) { this.ended(token); return "missing"; }
    const r = await this.s.play(url, "voice", GAIN.voice, 1500, () => this.ended(token));
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
 * The match's sounds: close zombie ("Zombies approaching!", the roar, the countdown), helicopter phases, event sounds. One instance; `update` is fed from the game screen,
 * `onEvent` from the session, `end` when the game screen goes away.
 */
export class MatchAudio {
  private readonly near = new NearGate();
  private readonly approaching = new NearGate(SOUND_RULES.approach);
  private readonly revealed = new Cooldown(SOUND_RULES.revealed.cooldownS);
  private readonly contact = new Cooldown(SOUND_RULES.contact.cooldownS);
  private readonly infected = new Cooldown(SOUND_RULES.infected.cooldownS);
  /** When the roar was last heard (entering 100 m or a sprint), so the two never come on top of each other. */
  private lastRoarS = -Infinity;
  private jumpVariant: number | null = null;
  /** The last distance step said (spoken countdown 50…10 m). */
  private countdown: CountdownStep | null = null;
  private heliLoop: LoopVoice | null = null;
  private approach: Voice | null = null;
  private matchId: string | null = null;
  private input: MatchSoundInput | null = null;
  private hidden = false;
  private done = false;

  /** The operator's recorded lines (one at a time). */
  readonly radio: RadioVoices;

  constructor(private readonly s: Soundscape, private readonly clock: Clock, private readonly random: () => number = Math.random) {
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
    // 200 m: the operator's "Zombies approaching!" (urgent, like the countdown); 100 m: the zombies' roar. A zombie that appears inside
    // 100 m at once gets the roar only.
    const roar = this.near.update(t, i.nearestM, i.activity, run);
    const warn = this.approaching.update(t, i.nearestM, i.activity, run);
    if (roar) { this.lastRoarS = t; void this.s.play(AUDIO.zombieNear, "fx", GAIN.zombieNear); }
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
    if (e.type === "finished") return this.finish(e.result, e.mode, !!e.campaign, e.ending);
    if (e.type === "match_started") return this.started(e.id, e.mode, !!e.campaign);
    if (e.type === "story") return this.storyLine(e);
    // Moments worked out on return from the background happened while the app was away: no late sound for them.
    if (e.stale || this.hidden || this.done) return Promise.resolve("suppressed");
    const res = (p: Promise<{ result: PlayResult }>) => p.then((r) => r.result);
    switch (e.type) {
      // The radio line replaces the old chime; the chime comes back only if the line cannot play (missing or broken file).
      case "checkpoint":
        if (e.campaign) return Promise.resolve(null); // the mission's own line says it
        return this.radio.say(e.last ? "getToSafehouse" : "checkpointSecured").then((r) => {
          if (failed(r)) void this.s.play(AUDIO.checkpoint, "fx", GAIN.checkpoint);
          return r;
        });
      case "revealed": return this.revealed.take(this.clock.nowS()) ? this.afterVoice(() => res(this.s.play(AUDIO.revealed, "fx", GAIN.revealed))) : Promise.resolve("suppressed");
      // The jump scare is silent since the field test (its picture and vibration only); its screams are a new infected's now.
      case "jump":
        return Promise.resolve(null);
      // A new infected has come into the game: someone has just been bitten. A scream (another variant than the last), with a cooldown.
      case "infected": {
        const t = this.clock.nowS();
        if (!this.infected.take(t)) return Promise.resolve("suppressed");
        this.jumpVariant = pickVariant(this.jumpVariant, AUDIO.jump.length, this.random);
        return res(this.s.play(AUDIO.jump[this.jumpVariant], "fx", GAIN.infected));
      }
      // A zombie starts to sprint: the roar, unless it was just heard (entering 100 m and the first sprint often come together).
      case "sprint": {
        const t = this.clock.nowS();
        if (t - this.lastRoarS < SOUND_RULES.sprint.afterRoarS) return Promise.resolve("suppressed");
        this.lastRoarS = t;
        return res(this.s.play(AUDIO.zombieNear, "fx", GAIN.sprint));
      }
      // A zombie is on the player and the infection counts: the warning sting, not more often than its cooldown.
      case "contact":
        return this.contact.take(this.clock.nowS()) ? res(this.s.play(AUDIO.revealed, "fx", GAIN.contact)) : Promise.resolve("suppressed");
      case "heli_approach":
        if (!e.campaign) void this.radio.say("rescueInbound");
        return this.s.play(AUDIO.heliApproach, "heli", GAIN.heliApproach, 4000).then((r) => {
          // Landed in the meantime (very short lead): the loop is already there.
          if (r.voice && (this.heliLoop?.playing || this.done)) r.voice.stop(SOUND_RULES.heli.approachFadeOutS);
          else if (r.voice) this.approach = r.voice;
          return r.result;
        });
      // The loop follows the phase (see update), from the same tick as the landed card. "Rescue inbound" is no longer true once it has landed.
      case "heli_landed":
        this.s.music.moment("extraction"); // the run to the helicopter has its own music
        if (e.campaign) return Promise.resolve(null);
        return this.radio.say("getToHelicopter", { supersedes: ["rescueInbound"] });
    }
  }

  /**
   * A campaign radio line. With a recording: the operator's channel plays it (one line at a time, as always). Without one: the stand-in
   * line the beat names, or a soft chime, so the player knows to glance at the text. Ending lines play although the match is over.
   */
  private storyLine(e: Extract<SoundEvent, { type: "story" }>): Promise<PlayResult | null> {
    if (e.stale || this.hidden || (this.done && !e.final)) return Promise.resolve("suppressed");
    const o = { final: e.final, queue: e.queue };
    if (RECORDED_BEATS[e.campaignId]?.includes(e.id)) {
      return this.radio.sayClip(e.id, beatVoiceUrl(e.campaignId, e.id), o).then((r) => {
        if (failed(r) && !e.final) void this.s.play(AUDIO.checkpoint, "fx", GAIN.radioCue);
        return r;
      });
    }
    if (e.fallbackVoice && e.fallbackVoice in VOICE) return this.radio.say(e.fallbackVoice, o);
    if (e.final) return Promise.resolve(null);
    return this.s.play(AUDIO.checkpoint, "fx", GAIN.radioCue).then((r) => r.result);
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
  private finish(result: string, mode: GameMode, campaign = false, ending?: "heli" | "safehouse" | "plain"): Promise<PlayResult | null> {
    if (this.done && this.endedWith !== null) return Promise.resolve(null);
    this.done = true;
    this.endedWith = result;
    this.s.music.matchOutcome(result === "infected" || result === "failed"); // a lost match ends on its own music
    this.setEndDone(false);
    this.stopLoops(SOUND_RULES.heli.loopStopS);
    // Lines about the match (start, checkpoints, helicopter) are over; a win gets its own line, part of the ending.
    this.radio.stop();
    // A mission's ending lines come as story events right after this one; how its win sounds is the mission's own choice.
    const line = result === "survived" && !this.hidden && !campaign ? this.radio.say(mode === "survival" ? "liftingOff" : "insideSafehouse", { final: true }) : null;
    const winSound = campaign ? (ending === "heli" ? AUDIO.heliSuccess : ending === "safehouse" ? AUDIO.safeDoor : null) : mode === "survival" ? AUDIO.heliSuccess : AUDIO.safeDoor;
    const url = result === "infected" ? AUDIO.captured
      : result === "survived" ? winSound
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
    // Campaign: give the ending's story lines (sent just after this event) a moment to reach the radio before asking whether it is idle.
    const lines = campaign ? new Promise<void>((r) => { this.s.later(() => r(), 400); }) : (line ?? Promise.resolve(null));
    void Promise.all([effect, Promise.resolve(lines).then(() => this.radio.whenIdle())]).then(() => {
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
    this.heliLoop?.stop(fadeS);
    this.heliLoop = null;
    this.approach?.stop(fadeS);
    this.approach = null;
  }

  /** A match begins (after START, not on the setup step): the opening line for its mode. */
  private started(id: string, mode: GameMode, campaign = false): Promise<PlayResult | null> {
    if (id !== this.matchId) this.newMatch({ id, mode });
    if (this.hidden) return Promise.resolve("suppressed");
    this.s.music.matchStart(); // the theme from its beginning as the match begins
    if (campaign) return Promise.resolve(null); // the mission's opening line follows as a story event
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
    this.near.reset();
    this.approaching.reset();
    this.countdown = null;
    this.revealed.reset();
    this.contact.reset();
    this.infected.reset();
    this.lastRoarS = -Infinity;
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

  /** For tests: what is sounding. */
  get state() { return { heliLoop: !!this.heliLoop?.playing, approach: !!this.approach?.playing, voice: this.radio.speaking }; }
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
 * The soundtrack: three versions of the theme ("Frostborne Silence") and nine more pieces, all brought to the theme's level (≈ −16.3 LUFS)
 * by `gain` (a quiet piece is lifted at most +4 dB). Start and end are where the music really is (measured with silencedetect). The same
 * plan serves Free Play and every campaign mission:
 * - Menu: the full theme opens the app, then crossfaded passes drawn from the calm pieces (the theme's versions, Frostborne Silence 1 and
 *   the two Fragile Three-Note Motifs), never the one just heard.
 * - Match start: the short theme or the Three-Note Motif (which builds from near silence), crossfaded from the menu.
 * - Mid-match: a pass after each silence of 1–2.5 minutes for as long as the match lasts, drawn from the darker pieces (Frostborne Silence
 *   1, the Three-Note Motif, Stairwell Silence, Untitled 1, The Missing Footstep). After the field test the threat pulse is gone and the
 *   music is the match's backdrop instead (before: at most two passes, 4–9 minutes apart). Dirty Riff was removed (too bright and upbeat).
 * - The helicopter has landed (Survival, FINAL EXTRACTION): Relentless Groove at once, for the run to it.
 * - Over: the full theme after a win, Final Silence after a lost match (caught, out of time), each after the ending's own sounds.
 */
export const MUSIC_TRACKS: MusicTrack[] = [
  { url: AUDIO.music, startS: 0.5, endS: 206.9, gain: 1 }, // 0 · 209.5 s, 0.5 s of silence first, own fade-out, 2.6 s of silence last
  { url: AUDIO.musicFade, startS: 0.5, endS: 154.1, gain: 1 }, // 1 · 154.8 s, own fade-out
  { url: AUDIO.musicShort, startS: 0, endS: 137.9, gain: 1 }, // 2 · 138.0 s, own fade-out
  { url: SOUNDTRACK.frostborne1, startS: 0, endS: 129.2, gain: 1.04 }, // 3 · 130.0 s, −16.6 LUFS, 0.8 s of silence last
  { url: SOUNDTRACK.fragile, startS: 0.9, endS: 124.4, gain: 0.98 }, // 4 · 124.4 s, −16.1 LUFS
  { url: SOUNDTRACK.fragile1, startS: 0, endS: 157.2, gain: 0.94 }, // 5 · 157.2 s, −15.8 LUFS
  { url: SOUNDTRACK.threeNote, startS: 0.6, endS: 90.0, gain: 1.06 }, // 6 · 90.0 s, −16.8 LUFS, builds from near silence
  { url: SOUNDTRACK.stairwell, startS: 0, endS: 45.6, gain: 1.3 }, // 7 · 45.6 s, −18.6 LUFS
  { url: SOUNDTRACK.untitled1, startS: 0.6, endS: 70.0, gain: 1.19 }, // 8 · 70.0 s, −17.8 LUFS
  { url: SOUNDTRACK.footstep, startS: 0, endS: 11.9, gain: 1.6 }, // 9 · 13.6 s, −21.5 LUFS, a short cue; 1.8 s of silence last
  { url: SOUNDTRACK.groove, startS: 0.4, endS: 94.3, gain: 1 }, // 10 · 94.8 s, −16.3 LUFS, driving
  { url: SOUNDTRACK.finalSilence, startS: 0, endS: 58.7, gain: 1.51 }, // 11 · 59.6 s, −19.9 LUFS, 1 s of silence last
];
export const MUSIC_PLAYLIST: MusicSource = {
  tracks: MUSIC_TRACKS,
  crossfadeS: 3.5,
  fadeInS: 3,
  fadeOutS: 2.5,
  endFadeS: 2.5,
  // During a match: the silence before each pass in mid-match.
  gapS: [60, 150],
  menu: [0, 1, 2, 3, 4, 5],
  match: { start: [2, 6], mid: [3, 6, 7, 8, 9], midPasses: Infinity, end: 0, lost: 11, moments: { extraction: 10 } },
};
/** Every music file (fetched before a match, so the match's pieces play offline too). */
export const MUSIC_URLS: readonly string[] = MUSIC_TRACKS.map((t) => t.url);
/** Campaign: decode a mission's recorded lines before the match (only those that exist), with the sounds its ending may use. */
export function preloadMissionVoices(campaignId: string, beatIds: readonly string[]): void {
  void soundscape().music.prefetch("all");
  const have = RECORDED_BEATS[campaignId] ?? [];
  soundscape().preload([...MATCH_SOUNDS, ...HELI_SOUNDS, ...beatIds.filter((id) => have.includes(id)).map((id) => beatVoiceUrl(campaignId, id))]);
}
export function matchAudio(): MatchAudio {
  match ??= new MatchAudio(soundscape(), { nowS: () => Date.now() / 1000 });
  return match;
}
