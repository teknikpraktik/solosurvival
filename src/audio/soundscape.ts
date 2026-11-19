/**
 * Web Audio soundscape: buses with their own levels, one-shots, crossfaded loops, menu music and ducking under the voice. No React, no
 * game rules (those are in src/play/sound-rules.ts and the app's own controller). Nothing plays before `unlock()` has run inside a user
 * gesture, and every call is safe to make at any time: blocked or interrupted audio is ignored, never thrown.
 *
 *   music ─┐
 *   threat ┼─ duck ─┐
 *   heli ──┘        ├─ master ─ limiter ─ destination
 *   fx ─────────────┤
 *   voice ──────────┘  (the operator's recorded lines; they duck the others, never themselves)
 */

export type Bus = "music" | "threat" | "heli" | "fx" | "voice";

/** The listener's own levels (0–1, multiplied onto the mix) and the master switch. */
export interface Levels { on: boolean; music: number; fx: number; voice: number }

/** Everything the soundscape takes from the browser, so tests can give it fakes. */
export interface SoundscapeEnv {
  createContext(): AudioContext;
  fetchBytes(url: string): Promise<ArrayBuffer>;
  /** Menu music element (streamed, not decoded into memory). Omitted = no music. */
  createMediaElement?(): HTMLAudioElement;
  /** A URL for the music that works offline (e.g. a blob URL of the cached file), or null to stream `url` directly. */
  musicUrl?(url: string): Promise<string | null>;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export interface SoundscapeOptions {
  /** Fixed mix: each bus's level before the listener's own level. */
  mix: Record<Bus, number>;
  /** Level the ducked buses go down to under speech (linear). */
  duckTo: number;
  duckAttackS: number;
  duckReleaseS: number;
  levels: () => Levels;
}

export type PlayResult = "played" | "muted" | "suppressed" | "missing" | "error";

export interface Voice { stop(fadeS?: number): void; readonly playing: boolean }

const SILENT_EDGE = 1e-4;
const ramp = (p: AudioParam, to: number, at: number, overS: number) => {
  try {
    p.cancelScheduledValues(at);
    p.setValueAtTime(p.value, at);
    if (overS <= 0) p.setValueAtTime(to, at);
    else p.linearRampToValueAtTime(to, at + overS);
  } catch { /* a closed context */ }
};
/** Equal-power fade curves (smooth crossfades between uncorrelated material). */
const curve = (up: boolean, n = 33) => Float32Array.from({ length: n }, (_, i) => { const x = i / (n - 1); return up ? Math.sin((x * Math.PI) / 2) : Math.cos((x * Math.PI) / 2); });

/** The part of a decoded buffer that is not digital silence at its edges (MP3 encoder padding): loops play only this part. */
export function trimmedRegion(buf: AudioBuffer): { startS: number; durS: number } {
  const n = buf.length;
  let first = n, last = -1;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    let i = 0;
    while (i < n && Math.abs(d[i]) <= SILENT_EDGE) i++;
    let j = n - 1;
    while (j > i && Math.abs(d[j]) <= SILENT_EDGE) j--;
    if (i < n) { first = Math.min(first, i); last = Math.max(last, j); }
  }
  if (last < first) return { startS: 0, durS: buf.duration };
  return { startS: first / buf.sampleRate, durS: (last - first + 1) / buf.sampleRate };
}

export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private duck: GainNode | null = null;
  private buses = new Map<Bus, GainNode>();
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private voices = new Set<Voice>();
  private ducking = new Set<string>();
  private duckSafety: unknown = null;
  private suppressed = false;
  unlocked = false;
  readonly music: MenuMusic;

  constructor(private readonly env: SoundscapeEnv, private readonly o: SoundscapeOptions, musicSrc: MusicSource | SingleMusic | null) {
    this.music = new MenuMusic(this, env, musicSrc);
  }

  /** The audio context, made on first need. Its graph (buses, limiter) is built with it. */
  context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const c = this.env.createContext();
      const limiter = c.createDynamicsCompressor();
      // A safety limiter only: the files are levelled, this catches several loud sounds at once.
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      limiter.connect(c.destination);
      this.master = c.createGain();
      this.master.connect(limiter);
      this.duck = c.createGain();
      this.duck.connect(this.master);
      for (const b of ["music", "threat", "heli", "fx", "voice"] as Bus[]) {
        const g = c.createGain();
        g.connect(b === "fx" || b === "voice" ? this.master : this.duck);
        this.buses.set(b, g);
      }
      this.ctx = c;
      this.applyLevels(0);
      return c;
    } catch { return null; }
  }

  bus(b: Bus): GainNode | null { this.context(); return this.buses.get(b) ?? null; }

  /** Call inside a user gesture (tap): allows sound from now on (iOS, Chrome autoplay rules). */
  unlock(): void {
    const c = this.context();
    if (!c) return;
    this.unlocked = true;
    try { if (c.state !== "running") void c.resume().catch(() => undefined); } catch { /* not allowed */ }
    this.music.gesture();
  }

  /** Brings an interrupted context back (iOS: a call, Siri, the screen going dark). Resolves with whether it runs. */
  async wake(maxMs = 1200): Promise<boolean> {
    const c = this.ctx;
    if (!c) return false;
    if (c.state === "running") return true;
    try { await Promise.race([c.resume(), new Promise((r) => this.env.setTimeout(() => r(null), maxMs))]); } catch { /* needs a gesture */ }
    return (c.state as string) === "running";
  }

  get enabled(): boolean { return this.o.levels().on; }
  get musicLevel(): number { return this.o.levels().music; }
  get isSuppressed(): boolean { return this.suppressed; }

  /** Bus levels from the mix and the listener's levels (call after a settings change). */
  applyLevels(fadeS = 0.3): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const l = this.o.levels();
    ramp(this.master.gain, l.on ? 1 : 0, c.currentTime, fadeS);
    for (const [b, g] of this.buses) ramp(g.gain, this.o.mix[b] * (b === "music" ? l.music : b === "voice" ? l.voice : l.fx), c.currentTime, fadeS);
    if (!l.on) this.music.want(false, 0.3);
  }

  /** App in the background (or back): no new sound while hidden, and what plays is faded out. */
  setSuppressed(hidden: boolean): void {
    if (this.suppressed === hidden) return;
    this.suppressed = hidden;
    if (hidden) {
      for (const v of [...this.voices]) v.stop(0.2);
      this.music.suspend();
      this.setDuck("speech", false);
    } else {
      this.music.restore();
      void this.wake();
    }
  }

  /** Decodes a file once (shared by later calls). Never throws: a missing file gives null. */
  load(url: string): Promise<AudioBuffer | null> {
    const have = this.buffers.get(url);
    if (have) return Promise.resolve(have);
    const busy = this.loading.get(url);
    if (busy) return busy;
    const c = this.context();
    if (!c) return Promise.resolve(null);
    const p = (async () => {
      try {
        const bytes = await this.env.fetchBytes(url);
        const buf = await c.decodeAudioData(bytes);
        this.buffers.set(url, buf);
        return buf;
      } catch { return null; } finally { this.loading.delete(url); }
    })();
    this.loading.set(url, p);
    return p;
  }

  preload(urls: readonly string[]): void { for (const u of urls) void this.load(u); }

  /** Lets a decoded file go (a voice that still plays keeps its own copy); the next use decodes it again. */
  unload(url: string): void { this.buffers.delete(url); }

  private canPlay(): PlayResult | null {
    if (!this.enabled) return "muted";
    if (this.suppressed || !this.unlocked) return "suppressed";
    return null;
  }

  /**
   * A one-shot on a bus. Returns a handle (to fade it out early) once it has started, or the reason it did not play. A file still loading
   * is waited for, but a sound that could only start more than `maxWaitMs` late is dropped rather than played out of time.
   */
  async play(url: string, bus: Bus, gain: number, maxWaitMs = 1500, onEnd?: () => void): Promise<{ result: PlayResult; voice?: Voice }> {
    const no = this.canPlay();
    if (no) return { result: no };
    const asked = Date.now();
    const c = this.context();
    if (!c) return { result: "error" };
    await this.wake();
    const buf = this.buffers.get(url) ?? (await this.load(url));
    if (!buf) return { result: "missing" };
    const late = this.canPlay();
    if (late) return { result: late };
    if (Date.now() - asked > maxWaitMs) return { result: "suppressed" };
    try {
      // `onEnd` runs exactly once, whether the sound ends by itself or is stopped (so a duck it holds is always released).
      const v = new VoiceImpl(c, this.buses.get(bus)!, () => { this.voices.delete(v); try { onEnd?.(); } catch { /* ignored */ } });
      v.oneShot(buf, gain);
      this.voices.add(v);
      return { result: "played", voice: v };
    } catch { return { result: "error" }; }
  }

  /** A loop on a bus: seamless repeats with a short equal-power crossfade at the seam (no change of pitch or speed). */
  loop(url: string, bus: Bus, gain: number, crossfadeS: number): LoopVoice {
    return new LoopVoice(this, this.env, url, bus, gain, crossfadeS, (v) => this.voices.add(v), (v) => this.voices.delete(v));
  }

  /** Lowers music, threat and helicopter while `key` holds it (speech, radio). Released keys restore the level smoothly. */
  setDuck(key: string, on: boolean): void {
    const had = this.ducking.size > 0;
    if (on) this.ducking.add(key); else this.ducking.delete(key);
    const has = this.ducking.size > 0;
    if (this.duckSafety !== null) { this.env.clearTimeout(this.duckSafety); this.duckSafety = null; }
    // A voice that never reports its end (Android's speech engine sometimes does not) must not keep everything low.
    if (has) this.duckSafety = this.env.setTimeout(() => { this.ducking.clear(); this.duckSafety = null; this.rampDuck(false); }, 12_000); // longest recorded line: 8 s
    if (had !== has) this.rampDuck(has);
  }

  get ducked(): boolean { return this.ducking.size > 0; }

  /** A timer on the soundscape's clock (cancel with `cancel`). */
  later(fn: () => void, ms: number): unknown { return this.env.setTimeout(fn, ms); }
  cancel(h: unknown): void { this.env.clearTimeout(h); }

  private rampDuck(down: boolean): void {
    const c = this.ctx;
    if (!c || !this.duck) return;
    ramp(this.duck.gain, down ? this.o.duckTo : 1, c.currentTime, down ? this.o.duckAttackS : this.o.duckReleaseS);
  }

  /** Stops every one-shot and loop (not the menu music). */
  stopAll(fadeS = 0.3): void { for (const v of [...this.voices]) v.stop(fadeS); }

  /** Number of sounding voices (one-shots and loops), for tests and the field log. */
  get voiceCount(): number { return this.voices.size; }
}

class VoiceImpl implements Voice {
  private out: GainNode;
  private src: AudioBufferSourceNode | null = null;
  private done = false;
  constructor(private readonly c: AudioContext, bus: GainNode, private readonly onEnd: () => void) {
    this.out = c.createGain();
    this.out.connect(bus);
  }
  get playing(): boolean { return !this.done; }
  oneShot(buf: AudioBuffer, gain: number): void {
    const s = this.c.createBufferSource();
    s.buffer = buf;
    this.out.gain.value = gain;
    s.connect(this.out);
    s.onended = () => this.finish();
    s.start();
    this.src = s;
  }
  stop(fadeS = 0.2): void {
    if (this.done) return;
    const t = this.c.currentTime;
    ramp(this.out.gain, 0, t, fadeS);
    try { this.src?.stop(t + fadeS + 0.02); } catch { /* already stopped */ }
    this.finish();
  }
  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.onEnd();
    const out = this.out;
    // Disconnect a little later so a fade can finish.
    setTimeout(() => { try { out.disconnect(); } catch { /* gone */ } }, 1500);
  }
}

/**
 * A crossfaded loop. Each pass is scheduled on the audio clock one pass ahead, so a late timer never makes a gap; the seam overlaps the
 * end of one pass with the start of the next by `crossfadeS` with equal-power curves (the files are not assumed to loop seamlessly, and
 * MP3 padding is trimmed away).
 */
export class LoopVoice implements Voice {
  private out: GainNode | null = null;
  private parts: AudioBufferSourceNode[] = [];
  private timer: unknown = null;
  private active = false;
  private starting: Promise<void> | null = null;
  private gen = 0;

  constructor(
    private readonly s: Soundscape, private readonly env: SoundscapeEnv, readonly url: string, private readonly busName: Bus,
    private readonly gain: number, private readonly crossfadeS: number,
    private readonly added: (v: LoopVoice) => void, private readonly removed: (v: LoopVoice) => void,
  ) {}

  get playing(): boolean { return this.active; }

  /**
   * Starts with a fade-in (no-op while already playing). Resolves once it sounds or could not start. `from`: the first pass begins at
   * `frac` of the part of the file that leaves at least `keepS` before its end (a long file is then heard from different places, and a
   * short burst never reaches the seam); the passes after it play the whole file.
   */
  start(fadeInS: number, from?: { frac: number; keepS: number }): Promise<void> {
    if (this.active) return this.starting ?? Promise.resolve();
    if (!this.s.enabled || this.s.isSuppressed || !this.s.unlocked) return Promise.resolve();
    this.active = true;
    const gen = ++this.gen;
    this.added(this);
    this.starting = (async () => {
      const buf = await this.s.load(this.url);
      const c = this.s.context();
      const bus = this.s.bus(this.busName);
      if (!buf || !c || !bus || gen !== this.gen || !this.active) { if (gen === this.gen) this.halt(); return; }
      await this.s.wake();
      if (gen !== this.gen || !this.active) return;
      const out = c.createGain();
      out.gain.value = 0;
      out.connect(bus);
      this.out = out;
      const t0 = c.currentTime + 0.03;
      ramp(out.gain, this.gain, t0, fadeInS);
      const region = trimmedRegion(buf);
      const off = from ? Math.max(0, Math.min(1, from.frac)) * Math.max(0, region.durS - from.keepS) : 0;
      this.pass(c, buf, region, t0, true, gen, { startS: region.startS + off, durS: region.durS - off });
    })();
    return this.starting;
  }

  private pass(c: AudioContext, buf: AudioBuffer, region: { startS: number; durS: number }, at: number, first: boolean, gen: number, play = region): void {
    if (gen !== this.gen || !this.active || !this.out) return;
    const r = play;
    const xf = Math.min(this.crossfadeS, r.durS / 4);
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    src.connect(g).connect(this.out);
    try {
      if (first) g.gain.setValueAtTime(1, at);
      else g.gain.setValueCurveAtTime(curve(true), at, xf);
      g.gain.setValueCurveAtTime(curve(false), at + r.durS - xf, xf);
    } catch { /* fake or old context: plain cut */ }
    src.start(at, r.startS, r.durS);
    src.onended = () => { this.parts = this.parts.filter((p) => p !== src); try { g.disconnect(); } catch { /* gone */ } };
    this.parts.push(src);
    const next = at + r.durS - xf;
    // Schedule the following pass a second before it is due (the audio clock keeps the timing exact).
    this.timer = this.env.setTimeout(() => this.pass(c, buf, region, next, false, gen), Math.max(0, (next - c.currentTime - 1) * 1000));
  }

  /** Fades out and stops (also while it is still starting). */
  stop(fadeS = 1): void {
    if (!this.active) return;
    const c = this.s.context();
    const out = this.out;
    const parts = this.parts;
    this.halt();
    if (!c || !out) return;
    const t = c.currentTime;
    ramp(out.gain, 0, t, fadeS);
    for (const p of parts) { try { p.stop(t + fadeS + 0.05); } catch { /* not started */ } }
    this.env.setTimeout(() => { try { out.disconnect(); } catch { /* gone */ } }, (fadeS + 0.5) * 1000);
  }

  private halt(): void {
    this.active = false;
    this.gen++;
    this.starting = null;
    if (this.timer !== null) { this.env.clearTimeout(this.timer); this.timer = null; }
    this.out = null;
    this.parts = [];
    this.removed(this);
  }
}

/** One piece of music: where it really starts and ends (no leading or trailing silence), and its level (linear) to sit with the others. */
export interface MusicTrack {
  url: string;
  startS: number;
  /** End before trailing silence; null = the element's duration. */
  endS: number | null;
  /** Level on the music bus (linear; > 1 lifts a quiet file without re-encoding it). Default 1. */
  gain?: number;
}

/**
 * The music: a playlist. The first track opens the app; after that each pass is a random track, never the one just heard. Repeating (menu)
 * crossfades from one pass into the next; not repeating (during a match) lets the pass end with a short fade-out, then waits a random
 * silence (`gapS`) before the next random track.
 */
export interface MusicSource {
  tracks: MusicTrack[];
  crossfadeS: number;
  fadeInS: number;
  fadeOutS: number;
  /** Fade-out at the end of a pass that is not crossfaded (several tracks stop abruptly). */
  endFadeS: number;
  /** Silence between passes during a match (s, random in the range). */
  gapS: readonly [number, number];
  random?: () => number;
  /** The tracks the menu repeats (indexes into `tracks`). Missing = all. The first track opens the app either way. */
  menu?: readonly number[];
  /**
   * A match with its own plan instead of random passes: one of `start` plays as the match begins, then `midPasses` passes (default 1; Infinity = for as long as the match lasts)
   * drawn from `mid`, each after a silence (`gapS`), then nothing until the match is over, when `end` plays (`lost` after a lost match;
   * the menu's random repeat goes on from there). `moments` are tracks for a moment of the match, started at once (`moment`).
   * Indexes into `tracks`; a list is a pool, drawn at random and never the track just heard.
   */
  match?: MatchMusicPlan;
}
export interface MatchMusicPlan {
  start: number | readonly number[];
  mid: number | readonly number[];
  midPasses?: number;
  end: number;
  lost?: number;
  moments?: Readonly<Record<string, number>>;
}
/** The single-track form (older): one file that repeats. */
export interface SingleMusic { url: string; startS: number; endS: number | null; crossfadeS: number; fadeInS: number; fadeOutS: number }

const pool = (x: number | readonly number[]): readonly number[] => (typeof x === "number" ? [x] : x);

const toSource = (m: MusicSource | SingleMusic): MusicSource => ("tracks" in m ? m : {
  tracks: [{ url: m.url, startS: m.startS, endS: m.endS }], crossfadeS: m.crossfadeS, fadeInS: m.fadeInS, fadeOutS: m.fadeOutS, endFadeS: 0, gapS: [20, 60],
});

/**
 * Music: two streamed media elements through the music bus, so passes can crossfade and the elements' gain can be faded (iOS ignores a
 * media element's own volume). Wanting it twice does nothing: it never restarts on a page change or a re-render.
 */
export class MenuMusic {
  private els: { el: HTMLAudioElement; gain: GainNode | null }[] = [];
  private cur = 0;
  private wanted = false;
  private sounding = false;
  private paused = false;
  private wasSounding = false;
  private watch: unknown = null;
  private stopTimer: unknown = null;
  private gapTimer: unknown = null;
  private srcs = new Map<string, string>();
  private resolving: Promise<void> | null = null;
  private primed = false;
  private needsGesture = false;
  /** Elements whose play() this player asked for and got (a primed element is paused again). */
  private confirmed = [false, false];
  /** Repeat (menu): crossfade into the next pass. Not repeating (match): pass, fade-out, random silence, next pass. */
  private repeat = true;
  /** The track on each element, and the last one started (none before the first pass: the first track opens the app). */
  private elTrack = [0, 0];
  private lastTrack: number | null = null;
  private endFading = false;
  /** A track (or a pool to draw from) chosen for the next pass instead of a random one (match start, the pass in mid-match, match end). */
  private forced: number | readonly number[] | null = null;
  /** During a match: the pool the passes after the forced one are drawn from (null: the menu's). */
  private matchPool: readonly number[] | null = null;
  /** The match that ended was lost: its end track is the plan's `lost` one. */
  private lost = false;
  /** Passes still to come while not repeating; null = no limit (no match plan). */
  private budget: number | null = null;
  private readonly m: MusicSource | null;

  constructor(private readonly s: Soundscape, private readonly env: SoundscapeEnv, m: MusicSource | SingleMusic | null) {
    this.m = m ? toSource(m) : null;
  }

  get playing(): boolean { return this.sounding; }
  get isWanted(): boolean { return this.wanted; }
  get repeats(): boolean { return this.repeat; }
  /** The track playing now (its url), or null. */
  get track(): string | null { return this.sounding && this.m ? this.m.tracks[this.elTrack[this.cur]].url : null; }
  /** Tracks started so far, in order (for tests and the field log). */
  readonly history: string[] = [];

  /**
   * Repeat on (the menu, after a match) or off (during a match: the pass that plays finishes, then silence and random passes). Turning it
   * on while the music is wanted but silent starts a pass at once with a fade-in.
   */
  setRepeat(on: boolean): void {
    if (this.repeat === on) return;
    this.repeat = on;
    const plan = this.m?.match;
    // Into a match: after the pass that plays, the plan's mid passes. Out of it: the plan's end track comes first (the lost one at once).
    if (plan && !on && this.budget === null) { this.budget = plan.midPasses ?? 1; this.forced = plan.mid; this.matchPool = pool(plan.mid); }
    if (plan && on) {
      const end = this.lost && plan.lost !== undefined ? plan.lost : plan.end;
      const crossLost = this.lost && plan.lost !== undefined && this.sounding && this.els.length > 0 && !this.paused && this.lastTrack !== end;
      this.lost = false;
      this.budget = null;
      this.matchPool = null;
      this.forced = this.sounding ? null : end;
      if (crossLost) { this.crossTo(end); this.startWatch(); }
    }
    if (on) {
      this.clearGap();
      if (this.wanted && !this.sounding && !this.paused && !this.needsGesture && this.m) this.begin(this.m.fadeInS);
    }
  }

  /**
   * A match begins (with a match plan): the plan's start track from its beginning, now, crossfaded from whatever plays; not repeating, with
   * one more pass (the mid track) to come after it. Without a plan nothing changes.
   */
  matchStart(): void {
    const plan = this.m?.match;
    this.lost = false;
    if (!plan || !this.wanted || this.paused || this.needsGesture) return;
    this.repeat = false;
    this.budget = plan.midPasses ?? 1;
    this.matchPool = pool(plan.mid);
    this.clearGap();
    if (this.sounding && this.els.length) { this.crossTo(this.choose(pool(plan.start))); this.forced = plan.mid; this.startWatch(); return; }
    this.forced = plan.start;
    this.begin(this.m!.fadeInS);
    this.forced = plan.mid;
  }

  /** How the match ended, before the music comes back: a lost match gets the plan's `lost` track. */
  matchOutcome(lost: boolean): void { this.lost = lost; }

  /**
   * A moment of the match with its own music (the plan's `moments`): that track now, crossfaded from whatever plays or faded in from a
   * silence. Only during a match (not repeating); the passes still owed come after it as planned.
   */
  moment(name: string): boolean {
    const i = this.m?.match?.moments?.[name];
    if (i === undefined || this.repeat || !this.wanted || this.paused || this.needsGesture) return false;
    this.clearGap();
    if (this.sounding && this.els.length) {
      if (this.lastTrack === i && !this.endFading) return true;
      this.crossTo(i);
      this.startWatch();
      return true;
    }
    const keep = this.forced;
    this.forced = i;
    this.begin(this.m!.fadeInS);
    this.forced = keep;
    return true;
  }

  /** Crossfades from the pass that plays into `nextTrack` on the other element. */
  private crossTo(nextTrack: number): void {
    const m = this.m!;
    const prev = this.cur;
    this.cur = 1 - this.cur;
    this.elTrack[this.cur] = nextTrack;
    this.endFading = false;
    const n = this.els[this.cur];
    this.setSrc(n.el, nextTrack);
    try { n.el.currentTime = m.tracks[nextTrack].startS; } catch { /* ignore */ }
    this.level(this.cur, 0, 0);
    const next = this.cur;
    try {
      void n.el.play().then(() => {
        this.confirmed[next] = true;
        this.lastTrack = nextTrack;
        this.history.push(m.tracks[nextTrack].url);
        this.level(next, 1, m.crossfadeS);
      }, () => undefined);
    } catch { /* ignore */ }
    this.level(prev, 0, m.crossfadeS);
    this.env.setTimeout(() => { if (this.cur !== prev) { this.confirmed[prev] = false; try { this.els[prev].el.pause(); } catch { /* ignore */ } } }, m.crossfadeS * 1000 + 200);
  }

  /**
   * Starts fetching the music for offline use (no sound): the opening track first, then the menu's (`"menu"`, as the app opens), or every
   * track (`"all"`, before a match). A track not fetched yet still plays, streamed from its address.
   */
  prefetch(which: "menu" | "all" = "menu"): Promise<void> {
    if (!this.m || !this.env.musicUrl) return this.resolving ?? Promise.resolve();
    const m = this.m;
    const menu = this.m.menu ?? m.tracks.map((_, i) => i);
    const want = which === "all" ? m.tracks.map((_, i) => i) : [0, ...menu.filter((i) => i !== 0)];
    const before = this.resolving ?? Promise.resolve();
    this.resolving = before.then(async () => {
      for (const i of want) {
        const t = m.tracks[i];
        if (!t || this.srcs.has(t.url)) continue;
        try { this.srcs.set(t.url, (await this.env.musicUrl!(t.url)) ?? t.url); } catch { this.srcs.set(t.url, t.url); }
      }
    });
    return this.resolving;
  }

  private ensure(): boolean {
    if (!this.m || !this.env.createMediaElement) return false;
    if (this.els.length) return true;
    const c = this.s.context();
    const bus = this.s.bus("music");
    if (!c || !bus) return false;
    try {
      for (let i = 0; i < 2; i++) {
        const el = this.env.createMediaElement();
        el.preload = "auto";
        el.loop = false;
        let gain: GainNode | null = null;
        try {
          const node = c.createMediaElementSource(el);
          gain = c.createGain();
          gain.gain.value = 0;
          node.connect(gain).connect(bus);
        } catch { el.volume = 0; /* no Web Audio routing: the element's own volume */ }
        this.els.push({ el, gain });
      }
      return true;
    } catch { this.els = []; return false; }
  }

  private setSrc(el: HTMLAudioElement, track: number): void {
    const url = this.m!.tracks[track].url;
    const want = this.srcs.get(url) ?? url;
    if (el.getAttribute("src") !== want) el.src = want;
  }

  /** The next pass: the first track to open the app, then a random one from the pool in use that is not the one just heard. */
  private pickNext(): number {
    const n = this.m!.tracks.length;
    if (this.forced !== null) { const f = this.forced; this.forced = null; return Math.min(n - 1, this.choose(pool(f))); }
    if (this.lastTrack === null || n <= 1) return 0;
    return this.choose(!this.repeat && this.matchPool ? this.matchPool : (this.m!.menu ?? this.m!.tracks.map((_, i) => i)));
  }

  /** A random track of `from`, never the one just heard when there is another. */
  private choose(from: readonly number[]): number {
    const other = from.filter((i) => i !== this.lastTrack);
    const c = other.length ? other : from;
    if (c.length <= 1) return c[0] ?? 0;
    const r = this.m!.random ?? Math.random;
    return c[Math.min(c.length - 1, Math.floor(r() * c.length))];
  }

  /** Inside a user gesture: lets both elements play later (iOS allows play() on an element only after one from a gesture). */
  gesture(): void {
    // Muted: nothing is prepared (and the music is not downloaded); a later tap after sound is turned on does it.
    if (!this.s.enabled || this.s.musicLevel <= 0 || !this.ensure()) return;
    if (!this.primed) {
      this.primed = true;
      for (let i = 0; i < this.els.length; i++) {
        if (i === this.cur && this.wanted) continue;
        const { el } = this.els[i];
        this.setSrc(el, this.elTrack[i]);
        // Paused again unless the player has meanwhile started this element for real (a blocked start pauses it itself).
        try { void el.play().then(() => { if (!this.confirmed[i] && !(this.sounding && i === this.cur)) el.pause(); }, () => undefined); } catch { /* blocked */ }
      }
    }
    if (this.needsGesture && this.wanted) { this.needsGesture = false; this.begin(this.m!.fadeInS); }
  }

  /** Music on (fade in) or off (fade out). Idempotent. */
  want(on: boolean, fadeS?: number): void {
    if (!this.m) return;
    if (on && !this.s.enabled) on = false;
    const was = this.wanted;
    this.wanted = on;
    if (on) {
      // Already playing, waiting for a tap, in a silence between passes, or hidden: nothing to do (no restart).
      if (this.paused || (was && (this.sounding || this.needsGesture || this.gapTimer !== null))) return;
      this.begin(fadeS ?? this.m.fadeInS);
    } else {
      this.clearGap();
      if (was || this.sounding) this.end(fadeS ?? this.m.fadeOutS);
    }
  }

  /** Fades element `i` to `frac` of its track's level. */
  private level(i: number, frac: number, overS: number): void {
    const e = this.els[i];
    const c = this.s.context();
    if (!e) return;
    const g = this.m!.tracks[this.elTrack[i]].gain ?? 1;
    if (e.gain && c) ramp(e.gain.gain, frac * g, c.currentTime, overS);
    else e.el.volume = Math.min(1, frac);
  }

  private clearGap(): void {
    if (this.gapTimer !== null) { this.env.clearTimeout(this.gapTimer); this.gapTimer = null; }
  }

  /**
   * Starts a pass. Tried at once, also before any tap: browsers that allow it (a site the player uses often, an installed app) start at
   * once; the others refuse, and the music starts at the first tap instead. Started before the audio context may run, it is heard as soon
   * as the first tap wakes the context.
   */
  private begin(fadeS: number): void {
    if (!this.ensure()) return;
    this.clearGap();
    if (this.stopTimer !== null) { this.env.clearTimeout(this.stopTimer); this.stopTimer = null; }
    const e = this.els[this.cur];
    if (this.sounding) { if (!this.endFading) this.level(this.cur, 1, fadeS); return; } // fading out: come back without a restart
    const track = this.pickNext();
    const t = this.m!.tracks[track];
    this.elTrack[this.cur] = track;
    this.endFading = false;
    this.setSrc(e.el, track);
    try { e.el.currentTime = t.startS; } catch { /* not loaded yet: set on play */ }
    this.level(this.cur, 0, 0);
    this.sounding = true;
    void this.s.wake();
    const idx = this.cur;
    const blocked = () => { this.sounding = false; this.needsGesture = true; this.confirmed[idx] = false; try { e.el.pause(); } catch { /* ignore */ } };
    try {
      void e.el.play().then(() => {
        this.confirmed[idx] = true;
        this.lastTrack = track;
        this.history.push(t.url);
        if (!this.wanted) return;
        if (e.el.currentTime < t.startS - 0.5) { try { e.el.currentTime = t.startS; } catch { /* ignore */ } }
        this.level(idx, 1, fadeS);
      }, blocked); // blocked: try again at the next tap
    } catch { blocked(); }
    this.startWatch();
  }

  private end(fadeS: number): void {
    this.needsGesture = false;
    if (!this.sounding) return;
    for (let i = 0; i < this.els.length; i++) this.level(i, 0, fadeS);
    if (this.stopTimer !== null) this.env.clearTimeout(this.stopTimer);
    this.stopTimer = this.env.setTimeout(() => {
      this.stopTimer = null;
      if (this.wanted) return;
      for (const { el } of this.els) { try { el.pause(); } catch { /* ignore */ } }
      this.confirmed = [false, false];
      this.sounding = false;
      this.stopWatch();
    }, fadeS * 1000 + 100);
  }

  /** Near the end of a pass: crossfade into the next one (repeat), or fade out, stop and wait a random silence (no repeat). */
  private startWatch(): void {
    if (this.watch !== null) return;
    const tick = () => {
      this.watch = null;
      if (!this.sounding) return;
      const m = this.m!;
      const e = this.els[this.cur];
      const t = m.tracks[this.elTrack[this.cur]];
      const end = t.endS ?? (Number.isFinite(e.el.duration) ? e.el.duration : null);
      if (!this.repeat) {
        if (!this.endFading && end !== null && m.endFadeS > 0 && e.el.currentTime >= end - m.endFadeS) { this.endFading = true; this.level(this.cur, 0, m.endFadeS); }
        if ((end !== null && e.el.currentTime >= end) || e.el.ended) {
          for (const { el } of this.els) { try { el.pause(); } catch { /* ignore */ } }
          this.confirmed = [false, false];
          this.sounding = false;
          this.endFading = false;
          // A silence of random length, then the next random pass (if the music is still wanted and still not repeating).
          if (this.wanted && !this.paused && this.takePass()) {
            const r = m.random ?? Math.random;
            const gap = m.gapS[0] + (m.gapS[1] - m.gapS[0]) * r();
            this.gapTimer = this.env.setTimeout(() => {
              this.gapTimer = null;
              if (this.wanted && !this.paused && !this.sounding) this.begin(m.fadeInS);
            }, gap * 1000);
          }
          return;
        }
      } else if (end !== null && e.el.currentTime >= end - m.crossfadeS && this.wanted && !this.paused) {
        this.crossTo(this.pickNext());
      }
      this.watch = this.env.setTimeout(tick, 400);
    };
    this.watch = this.env.setTimeout(tick, 400);
  }

  /** While not repeating: whether another pass may come (and counts it against the match plan's budget). */
  private takePass(): boolean {
    if (this.budget === null) return true;
    if (this.budget <= 0) return false;
    this.budget--;
    return true;
  }

  private stopWatch(): void {
    if (this.watch !== null) { this.env.clearTimeout(this.watch); this.watch = null; }
  }

  /** App hidden: pause (no fade is heard anyway); `restore` picks it up again. */
  suspend(): void {
    if (this.paused) return;
    this.paused = true;
    this.wasSounding = this.sounding;
    if (this.gapTimer !== null && this.budget !== null) this.budget++; // the pass that was waiting is still owed
    this.clearGap();
    if (!this.sounding) return;
    for (let i = 0; i < this.els.length; i++) { this.level(i, 0, 0.1); try { this.els[i].el.pause(); } catch { /* ignore */ } }
    this.confirmed = [false, false];
    this.sounding = false;
    this.stopWatch();
  }

  /** Back in front: the pass that played continues where it was; in a silence between passes, the next pass comes after a new silence. */
  restore(): void {
    if (!this.paused) return;
    this.paused = false;
    if (!this.wanted || !this.m) return;
    if (!this.wasSounding) {
      if (this.repeat) this.begin(this.m.fadeInS);
      else if (this.takePass()) {
        const m = this.m;
        const r = m.random ?? Math.random;
        this.gapTimer = this.env.setTimeout(() => { this.gapTimer = null; if (this.wanted && !this.paused && !this.sounding) this.begin(m.fadeInS); }, (m.gapS[0] + (m.gapS[1] - m.gapS[0]) * r()) * 1000);
      }
      return;
    }
    const e = this.els[this.cur];
    if (!e || !this.s.unlocked) { this.needsGesture = true; return; }
    this.sounding = true;
    this.level(this.cur, 0, 0);
    const idx = this.cur;
    try { void e.el.play().then(() => { this.confirmed[idx] = true; this.level(idx, this.endFading ? 0 : 1, this.m!.fadeInS); }, () => { this.sounding = false; this.needsGesture = true; }); } catch { this.sounding = false; }
    this.startWatch();
  }
}
