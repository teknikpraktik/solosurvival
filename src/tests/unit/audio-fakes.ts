/**
 * A small fake of the Web Audio API and media elements, enough to test what the soundscape starts, stops and schedules (not how it
 * sounds). Time moves only through `advance`.
 */
import type { SoundscapeEnv } from "@/audio/soundscape";

export class FakeParam {
  value: number;
  events: { kind: string; v: number; t: number }[] = [];
  constructor(v = 1) { this.value = v; }
  setValueAtTime(v: number, t: number) { this.events.push({ kind: "set", v, t }); this.value = v; return this; }
  linearRampToValueAtTime(v: number, t: number) { this.events.push({ kind: "ramp", v, t }); this.value = v; return this; }
  setValueCurveAtTime(c: Float32Array, t: number, d: number) { this.events.push({ kind: "curve", v: c[c.length - 1], t: t + d }); return this; }
  cancelScheduledValues() { return this; }
  /** The value the last event leaves it at. */
  get target(): number { return this.events.length ? this.events[this.events.length - 1].v : this.value; }
}

class FakeNode {
  connected = new Set<FakeNode>();
  connect<T extends FakeNode>(n: T): T { this.connected.add(n); return n; }
  disconnect() { this.connected.clear(); }
}
export class FakeGain extends FakeNode { gain = new FakeParam(1); }
export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  started: { at: number; offset?: number; dur?: number } | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  ended = false;
  constructor(private readonly ctx: FakeContext) { super(); ctx.sources.push(this); }
  start(at = 0, offset?: number, dur?: number) { this.started = { at: at || this.ctx.currentTime, offset, dur }; }
  stop(at = 0) { this.stoppedAt = at || this.ctx.currentTime; }
  /** Sounding at the context's current time. */
  get live(): boolean {
    if (!this.started) return false;
    const t = this.ctx.currentTime;
    const end = this.started.at + (this.started.dur ?? this.buffer?.duration ?? Infinity);
    return t >= this.started.at && t < Math.min(end, this.stoppedAt ?? Infinity);
  }
}
export class FakeBuffer {
  numberOfChannels = 2;
  sampleRate = 48000;
  readonly length: number;
  private data: Float32Array;
  constructor(public readonly duration: number, public readonly url = "", padS = 0.03) {
    this.length = Math.round(duration * this.sampleRate);
    this.data = new Float32Array(this.length).fill(0.2);
    const pad = Math.round(padS * this.sampleRate);
    this.data.fill(0, 0, pad);
    this.data.fill(0, this.length - pad);
  }
  getChannelData() { return this.data; }
}

export class FakeContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  elementSources = 0;
  resumes = 0;
  constructor(readonly durations: Record<string, number>) {}
  createGain() { return new FakeGain(); }
  createBufferSource() { return new FakeSource(this); }
  createDynamicsCompressor() {
    const n = new FakeNode() as FakeNode & Record<string, FakeParam>;
    for (const k of ["threshold", "knee", "ratio", "attack", "release"]) n[k] = new FakeParam(0);
    return n;
  }
  createMediaElementSource() { this.elementSources++; return new FakeNode(); }
  async resume() { this.resumes++; this.state = "running"; }
  async decodeAudioData(b: ArrayBuffer) { const url = new TextDecoder().decode(b); return new FakeBuffer(this.durations[url] ?? 2, url); }
  /** Sources sounding now whose buffer came from `url` (or any). */
  live(url?: string) { return this.sources.filter((s) => s.live && (!url || s.buffer?.url === url)); }
}

export class FakeMedia {
  src = "";
  preload = "";
  loop = false;
  volume = 1;
  currentTime = 0;
  duration = 211.344;
  paused = true;
  plays = 0;
  block = false;
  getAttribute(k: string) { return k === "src" ? this.src : null; }
  play() { if (this.block) return Promise.reject(new Error("NotAllowedError")); this.plays++; this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}

/** Timers driven by `advance` (ms), in step with the fake audio clock. */
export function fakeEnv(durations: Record<string, number> = {}) {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const ctx = new FakeContext(durations);
  const media: FakeMedia[] = [];
  const env: SoundscapeEnv = {
    createContext: () => ctx as unknown as AudioContext,
    fetchBytes: async (url) => { if (url.includes("missing")) throw new Error("404"); return new TextEncoder().encode(url).buffer as ArrayBuffer; },
    createMediaElement: () => { const m = new FakeMedia(); media.push(m); return m as unknown as HTMLAudioElement; },
    musicUrl: async () => "blob:music",
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms), fn }); return id; },
    clearTimeout: (h) => { timers.delete(h as number); },
  };
  /** Moves time forward, running due timers in order (and the media elements' playback position). */
  async function advance(ms: number, step = 100) {
    for (let t = 0; t < ms; t += step) {
      now += step;
      ctx.currentTime = now / 1000;
      for (const m of media) if (!m.paused) m.currentTime += step / 1000;
      for (const s of ctx.sources) {
        if (!s.started || s.ended) continue;
        const end = Math.min(s.started.at + (s.started.dur ?? s.buffer?.duration ?? Infinity), s.stoppedAt ?? Infinity);
        if (ctx.currentTime >= end) { s.ended = true; s.onended?.(); }
      }
      for (const [id, x] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (x.at <= now) { timers.delete(id); x.fn(); }
      await flush();
    }
  }
  return { env, ctx, media, advance, timers, nowMs: () => now };
}

export const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
