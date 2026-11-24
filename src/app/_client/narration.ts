import { useSyncExternalStore } from "react";
import { narrationUrl } from "@/campaign/narration";
import { RECORDED_NARRATION } from "@/campaign/voice-manifest";
import type { PlayResult, Voice } from "@/audio/soundscape";
import { GAIN, soundscape } from "./audio";

/**
 * The narrator between missions (src/campaign/narration.ts): one read at a time, on the voice bus, with the music lowered under it. Never
 * during a match: the briefing stops it when the mission starts, and leaving a screen stops its read.
 */
export type NarratorState = { id: string | null; status: "idle" | "loading" | "playing" };

const IDLE: NarratorState = { id: null, status: "idle" };
const DUCK_KEY = "narration";

class Narrator {
  private state: NarratorState = IDLE;
  private voice: Voice | null = null;
  private token = 0;
  private readonly listeners = new Set<() => void>();

  get = (): NarratorState => this.state;
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private set(s: NarratorState): void { this.state = s; for (const l of this.listeners) l(); }

  /** Whether a read has a recording (only those are ever asked for). */
  has(campaignId: string, id: string): boolean { return (RECORDED_NARRATION[campaignId] ?? []).includes(id); }

  /** Decodes a read ahead, so it starts at once when asked for. */
  preload(campaignId: string, id: string): void { if (this.has(campaignId, id)) soundscape().preload([narrationUrl(campaignId, id)]); }

  /** Reads `id` (whatever was being read stops). Resolves with what came of it; "suppressed" also means it was stopped before it began. */
  async play(campaignId: string, id: string): Promise<PlayResult> {
    this.stop();
    if (!this.has(campaignId, id)) return "missing";
    const token = ++this.token;
    this.set({ id, status: "loading" });
    const s = soundscape();
    const url = narrationUrl(campaignId, id);
    const buf = await s.load(url);
    if (token !== this.token) return "suppressed";
    const ended = () => {
      if (token !== this.token) return;
      this.voice = null;
      s.setDuck(DUCK_KEY, false);
      this.set(IDLE);
    };
    // A long read may wait for its file a while (the briefing preloads it); it is never out of time the way a radio line is.
    const r = await s.play(url, "voice", GAIN.narration, 10_000, ended);
    if (token !== this.token) { r.voice?.stop(0.05); return "suppressed"; }
    if (r.result !== "played" || !r.voice) { this.set(IDLE); return r.result; }
    this.voice = r.voice;
    s.setDuck(DUCK_KEY, true, ((buf?.duration ?? 30) + 3) * 1000);
    this.set({ id, status: "playing" });
    return "played";
  }

  /** Stops the read (a short fade), if any. */
  stop(): void {
    if (this.state.status === "idle" && !this.voice) return;
    this.token++;
    const v = this.voice;
    this.voice = null;
    v?.stop(0.4);
    soundscape().setDuck(DUCK_KEY, false);
    this.set(IDLE);
  }
}

let one: Narrator | null = null;
export function narrator(): Narrator {
  one ??= new Narrator();
  return one;
}

const server = () => IDLE;
/** The narrator's state, for a screen's listen button. */
export function useNarrator(): NarratorState {
  const n = narrator();
  return useSyncExternalStore(n.subscribe, n.get, server);
}
