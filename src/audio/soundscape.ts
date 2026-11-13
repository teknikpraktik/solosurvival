/**
 * Web Audio soundscape: buses with their own levels, one-shots, crossfaded loops, menu music and ducking under the voice. No React, no
 * game rules (those are in src/play/sound-rules.ts and the app's own controller). Nothing plays before `unlock()` has run inside a user
 * gesture, and every call is safe to make at any time: blocked or interrupted audio is ignored, never thrown.
 *
 *   music ─┐
 *   threat ┼─ duck ─┐
 *   heli ──┘        ├─ master ─ limiter ─ destination
 *   fx ─────────────┘
 */

export type Bus = "music" | "threat" | "heli" | "fx";

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

  constructor(private readonly env: SoundscapeEnv, private readonly o: SoundscapeOptions, musicSrc: MusicSource | null) {
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
      for (const b of ["music", "threat", "heli", "fx"] as Bus[]) {
        const g = c.createGain();
        g.connect(b === "fx" ? this.master : this.duck);
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
    for (const [b, g] of this.buses) ramp(g.gain, this.o.mix[b] * (b === "music" ? l.music : l.fx), c.currentTime, fadeS);
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

  private canPlay(): PlayResult | null {
    if (!this.enabled) return "muted";
    if (this.suppressed || !this.unlocked) return "suppressed";
    return null;
  }

  /**
   * A one-shot on a bus. Returns a handle (to fade it out early) once it has started, or the reason it did not play. A file still loading
   * is waited for, but a sound that could only start more than `maxWaitMs` late is dropped rather than played out of time.
   */
  async play(url: string, bus: Bus, gain: number, maxWaitMs = 1500): Promise<{ result: PlayResult; voice?: Voice }> {
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
      const v = new VoiceImpl(c, this.buses.get(bus)!, () => this.voices.delete(v));
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
    if (has) this.duckSafety = this.env.setTimeout(() => { this.ducking.clear(); this.duckSafety = null; this.rampDuck(false); }, 8000);
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

  /** Starts with a fade-in (no-op while already playing). Resolves once it sounds or could not start. */
  start(fadeInS: number): Promise<void> {
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
      this.pass(c, buf, region, t0, true, gen);
    })();
    return this.starting;
  }

  private pass(c: AudioContext, buf: AudioBuffer, r: { startS: number; durS: number }, at: number, first: boolean, gen: number): void {
    if (gen !== this.gen || !this.active || !this.out) return;
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
    this.timer = this.env.setTimeout(() => this.pass(c, buf, r, next, false, gen), Math.max(0, (next - c.currentTime - 1) * 1000));
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

/** The menu music file and where its own repeat should begin and end (the file is not a seamless loop). */
export interface MusicSource {
  url: string;
  /** Start here (s): skips leading silence. */
  startS: number;
  /** The next pass starts this long before the end of the music (s), overlapping the track's own fade-out. */
  crossfadeS: number;
  /** End of the music (s) before trailing silence; null = the element's duration. */
  endS: number | null;
  fadeInS: number;
  fadeOutS: number;
}

/**
 * Menu music: two streamed media elements through the music bus, so a repeat can crossfade and the element's gain can be faded (iOS
 * ignores a media element's own volume). Wanting it twice does nothing: it never restarts on a page change or a re-render.
 */
export class MenuMusic {
  private els: { el: HTMLAudioElement; gain: GainNode | null }[] = [];
  private cur = 0;
  private wanted = false;
  private sounding = false;
  private paused = false;
  private watch: unknown = null;
  private stopTimer: unknown = null;
  private src: string | null = null;
  private resolving: Promise<void> | null = null;
  private primed = false;
  private needsGesture = false;
  /** Elements whose play() this player asked for and got (a primed element is paused again). */
  private confirmed = [false, false];

  constructor(private readonly s: Soundscape, private readonly env: SoundscapeEnv, private readonly m: MusicSource | null) {}

  get playing(): boolean { return this.sounding; }
  get isWanted(): boolean { return this.wanted; }

  /** Starts fetching the music for offline use (no sound). */
  prefetch(): Promise<void> {
    if (!this.m || this.src || !this.env.musicUrl) return this.resolving ?? Promise.resolve();
    this.resolving ??= this.env.musicUrl(this.m.url).then((u) => { this.src = u ?? this.m!.url; }, () => { this.src = this.m!.url; });
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

  private setSrc(el: HTMLAudioElement): void {
    const want = this.src ?? this.m!.url;
    if (el.getAttribute("src") !== want) el.src = want;
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
        this.setSrc(el);
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
      // Already playing, waiting for a tap, or hidden: nothing to do (no restart, no repeated play() attempts).
      if (this.paused || (was && (this.sounding || this.needsGesture))) return;
      this.begin(fadeS ?? this.m.fadeInS);
    } else if (was || this.sounding) this.end(fadeS ?? this.m.fadeOutS);
  }

  private level(i: number, to: number, overS: number): void {
    const e = this.els[i];
    const c = this.s.context();
    if (!e) return;
    if (e.gain && c) ramp(e.gain.gain, to, c.currentTime, overS);
    else e.el.volume = to;
  }

  private begin(fadeS: number): void {
    if (!this.s.unlocked) { this.needsGesture = true; return; }
    if (!this.ensure()) return;
    if (this.stopTimer !== null) { this.env.clearTimeout(this.stopTimer); this.stopTimer = null; }
    const e = this.els[this.cur];
    if (this.sounding) { this.level(this.cur, 1, fadeS); return; } // fading out: come back without a restart
    this.setSrc(e.el);
    try { e.el.currentTime = this.m!.startS; } catch { /* not loaded yet: set on play */ }
    this.level(this.cur, 0, 0);
    this.sounding = true;
    void this.s.wake();
    const idx = this.cur;
    const blocked = () => { this.sounding = false; this.needsGesture = true; this.confirmed[idx] = false; try { e.el.pause(); } catch { /* ignore */ } };
    try {
      void e.el.play().then(() => {
        this.confirmed[idx] = true;
        if (!this.wanted) return;
        if (e.el.currentTime < this.m!.startS - 0.5) { try { e.el.currentTime = this.m!.startS; } catch { /* ignore */ } }
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

  /** Repeat: near the end, the other element starts at the beginning and the two crossfade. */
  private startWatch(): void {
    if (this.watch !== null) return;
    const tick = () => {
      this.watch = null;
      if (!this.sounding) return;
      const e = this.els[this.cur];
      const end = this.m!.endS ?? (Number.isFinite(e.el.duration) ? e.el.duration : null);
      if (end !== null && e.el.currentTime >= end - this.m!.crossfadeS && this.wanted && !this.paused) {
        const prev = this.cur;
        this.cur = 1 - this.cur;
        const n = this.els[this.cur];
        this.setSrc(n.el);
        try { n.el.currentTime = this.m!.startS; } catch { /* ignore */ }
        this.level(this.cur, 0, 0);
        const next = this.cur;
        try { void n.el.play().then(() => { this.confirmed[next] = true; this.level(next, 1, this.m!.crossfadeS); }, () => undefined); } catch { /* ignore */ }
        this.level(prev, 0, this.m!.crossfadeS);
        this.env.setTimeout(() => { if (this.cur !== prev) { this.confirmed[prev] = false; try { this.els[prev].el.pause(); } catch { /* ignore */ } } }, this.m!.crossfadeS * 1000 + 200);
      }
      this.watch = this.env.setTimeout(tick, 400);
    };
    this.watch = this.env.setTimeout(tick, 400);
  }

  private stopWatch(): void {
    if (this.watch !== null) { this.env.clearTimeout(this.watch); this.watch = null; }
  }

  /** App hidden: pause (no fade is heard anyway); `restore` picks it up with a fade-in if it is still wanted. */
  suspend(): void {
    if (this.paused) return;
    this.paused = true;
    if (!this.sounding) return;
    for (let i = 0; i < this.els.length; i++) { this.level(i, 0, 0.1); try { this.els[i].el.pause(); } catch { /* ignore */ } }
    this.confirmed = [false, false];
    this.sounding = false;
    this.stopWatch();
  }

  restore(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.wanted) {
      // Continue where it was (not from the start).
      const e = this.els[this.cur];
      if (!e || !this.s.unlocked) { this.needsGesture = true; return; }
      this.sounding = true;
      this.level(this.cur, 0, 0);
      const idx = this.cur;
      try { void e.el.play().then(() => { this.confirmed[idx] = true; this.level(idx, 1, this.m!.fadeInS); }, () => { this.sounding = false; this.needsGesture = true; }); } catch { this.sounding = false; }
      this.startWatch();
    }
  }
}
