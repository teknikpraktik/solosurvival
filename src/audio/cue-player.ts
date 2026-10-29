import type { Cue } from "@/play/session";

/**
 * Ljudpaket: allt som skiljer apparnas ljud (filer, vibrationsmönster, vilka händelser som hörs, röst). Själva uppspelningen
 * (Web Audio, iOS-väckning, talsyntes) är gemensam i `createCuePlayer`. Ett paket utan fil för en händelse spelar en kort syntetisk ton,
 * eller ingenting om händelsen inte finns i `audible`.
 */
export interface SoundPack<L extends string = string> {
  /** localStorage-nyckel för ljud av/på (en per app). */
  storageKey: string;
  /** Lokal ljudfil per händelse (cachas av service workern); avkodas en gång. */
  samples: Partial<Record<Cue, string>>;
  /** Syntetisk reservton (frekvenser) och vibrationsmönster per händelse. */
  patterns: Record<Cue, { f: number[]; vib: number[] }>;
  /** Händelser som ger ljud; övriga vibrerar bara. */
  audible: ReadonlySet<Cue>;
  /** Volym för en ljudfil. */
  gain: (cue: Cue) => number;
  /** Talsyntes: språk (BCP 47, t.ex. "en-US") samt tonhöjd och tempo per replik. */
  voice: { lang: string; pitch: (line: L) => number; rate: (line: L) => number };
}

/** How a cue came out, for the field log: "sample" / "synth" = sound started (context state after it), "silent" = no sound by design, "muted", "error". */
export type CueResult = { how: "sample" | "synth" | "silent" | "muted" | "error"; state?: string };

export interface CuePlayer<L extends string> {
  cuesEnabled(): boolean;
  setCuesEnabled(on: boolean): void;
  speak(text: L): boolean;
  preloadCues(): Promise<void>;
  playCue(cue: Cue): Promise<CueResult>;
  unlockAudio(): void;
}

/**
 * Brings the audio context back to "running". iOS leaves it "suspended" or "interrupted" (speech, a call, Siri, another app's audio, the
 * screen going dark); a sound started then is silently lost. Resolves with the state reached (waits at most `maxMs`).
 */
async function wake(c: AudioContext, maxMs = 1500): Promise<string> {
  if (c.state === "running") return "running";
  try { await Promise.race([c.resume(), new Promise((r) => setTimeout(r, maxMs))]); } catch { /* not allowed without a gesture */ }
  return c.state;
}

/** Skapar appens ljuduppspelning för ett ljudpaket. Anropas en gång per app (modulnivå): tillståndet (AudioContext, avkodade filer) hör till spelaren. */
export function createCuePlayer<L extends string>(pack: SoundPack<L>): CuePlayer<L> {
  let ctx: AudioContext | null = null;
  const buffers = new Map<Cue, AudioBuffer>();
  const loading = new Set<Cue>();
  /** Android's speech engine drops an utterance nothing refers to; these keep them alive until they end. */
  const speaking = new Set<SpeechSynthesisUtterance>();
  let wakeOnTouch = false;

  function cuesEnabled(): boolean {
    try { return localStorage.getItem(pack.storageKey) !== "off"; } catch { return true; }
  }
  function setCuesEnabled(on: boolean): void {
    try { localStorage.setItem(pack.storageKey, on ? "on" : "off"); } catch { /* lagring kan vara blockerad */ }
    if (!on) stopSpeech();
  }

  function voice(): SpeechSynthesisVoice | null {
    try {
      const want = pack.voice.lang.toLowerCase();
      const all = window.speechSynthesis.getVoices();
      return all.find((v) => v.lang.replace("_", "-").toLowerCase() === want) ?? all.find((v) => v.lang.toLowerCase().startsWith(want.split("-")[0])) ?? null;
    } catch { return null; }
  }

  function stopSpeech(): void {
    try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); } catch { /* inget att stoppa */ }
  }

  /** Says a line. Needs a prior gesture (see unlockAudio); silently does nothing where speech is missing or muted. Returns whether it was handed to the engine. */
  function speak(text: L): boolean {
    if (!cuesEnabled()) return false;
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
      const synth = window.speechSynthesis;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = pack.voice.lang;
      const v = voice();
      if (v) u.voice = v;
      u.pitch = pack.voice.pitch(text);
      u.rate = pack.voice.rate(text);
      u.volume = 1;
      const done = () => speaking.delete(u);
      u.onend = done;
      u.onerror = done;
      speaking.add(u);
      // cancel() directly before speak() loses the new line on Android, so only clear a queue that has something in it.
      if (synth.speaking || synth.pending) synth.cancel();
      if (synth.paused) synth.resume();
      synth.speak(u);
      return true;
    } catch { return false; }
  }

  /** Förladdar och avkodar paketets ljudfiler (anropas efter första användarinteraktionen). */
  async function preloadCues(): Promise<void> {
    try {
      ctx ??= new AudioContext();
      for (const [cue, url] of Object.entries(pack.samples) as [Cue, string][]) {
        if (buffers.has(cue) || loading.has(cue)) continue;
        loading.add(cue);
        try {
          const r = await fetch(url);
          buffers.set(cue, await ctx.decodeAudioData(await r.arrayBuffer()));
        } catch { /* synt-reserv används */ } finally { loading.delete(cue); }
      }
    } catch { /* ljud ej tillgängligt */ }
  }

  /** Ljud och vibration så att spelaren inte behöver titta på skärmen (särskilt viktigt på cykel). Vibration saknas på iPhone. */
  async function playCue(cue: Cue): Promise<CueResult> {
    if (!cuesEnabled()) return { how: "muted" };
    try { navigator.vibrate?.(pack.patterns[cue].vib); } catch { /* ej stött */ }
    if (!pack.audible.has(cue)) return { how: "silent" };
    try {
      ctx ??= new AudioContext();
      // Start the sound only once the context really runs: started on a suspended/interrupted context it may never be heard (checkpoint chime "only sometimes").
      const state = await wake(ctx);
      let buf = buffers.get(cue);
      if (!buf && pack.samples[cue]) { await preloadCues(); buf = buffers.get(cue); } // not decoded yet (e.g. right after a reload): load it now rather than a faint beep
      if (buf) {
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        gain.gain.value = pack.gain(cue);
        src.buffer = buf;
        src.connect(gain).connect(ctx.destination);
        src.start();
        return { how: "sample", state };
      }
      let t = ctx.currentTime;
      for (const f of pack.patterns[cue].f) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.2);
        t += 0.22;
      }
      return { how: "synth", state };
    } catch { return { how: "error", state: ctx?.state }; /* ljud kan vara blockerat före första användarinteraktionen */ }
  }

  /** Anropas vid en knapptryckning så att ljud tillåts senare under spelet. */
  function unlockAudio(): void {
    try { ctx ??= new AudioContext(); void ctx.resume(); void preloadCues(); } catch { /* ignoreras */ }
    // Every later touch also wakes the audio (iOS only allows resume() reliably inside a gesture), so one interruption does not silence the rest of the match.
    if (!wakeOnTouch) {
      wakeOnTouch = true;
      try { document.addEventListener("pointerdown", () => { if (ctx && ctx.state !== "running") void ctx.resume(); }, { capture: true, passive: true }); } catch { /* ignoreras */ }
    }
    // Speech has its own gesture requirement and must not depend on Web Audio having started: give it a silent first utterance.
    try {
      if ("speechSynthesis" in window) {
        const hush = new SpeechSynthesisUtterance(" ");
        hush.volume = 0;
        window.speechSynthesis.speak(hush);
        window.speechSynthesis.getVoices();
      }
    } catch { /* ingen talsyntes */ }
  }

  return { cuesEnabled, setCuesEnabled, speak, preloadCues, playCue, unlockAudio };
}
