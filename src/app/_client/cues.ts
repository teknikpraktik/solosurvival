import type { Cue } from "@/play/session";

const KEY = "outbreak.cues";

export function cuesEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export function setCuesEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* lagring kan vara blockerad */ }
  if (!on) stopSpeech();
}

/** Spoken lines: the phone's own speech synthesis, so nothing is downloaded and it works the same on Android, iOS and desktop. */
export type Line = "Game on" | "Captured" | "Zombies approaching" | "Run!" | "Checkpoint" | CountdownLine;
/** Spoken distance to the nearest zombie as it closes in (see play/countdown.ts). */
export type CountdownLine = "100" | "50" | "40" | "30" | "20" | "10";
/** Lines said in a brighter voice than the low, menacing default (a reward, not a threat). */
const BRIGHT = new Set<Line>(["Checkpoint"]);

/** Android's speech engine drops an utterance nothing refers to; these keep them alive until they end. */
const speaking = new Set<SpeechSynthesisUtterance>();

function voice(): SpeechSynthesisVoice | null {
  try {
    const all = window.speechSynthesis.getVoices();
    return all.find((v) => v.lang.replace("_", "-").toLowerCase() === "en-us") ?? all.find((v) => v.lang.toLowerCase().startsWith("en")) ?? null;
  } catch { return null; }
}

function stopSpeech(): void {
  try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); } catch { /* inget att stoppa */ }
}

/** Says a line in English in a low voice. Needs a prior gesture (see unlockAudio); silently does nothing where speech is missing or muted. Returns whether it was handed to the engine. */
export function speak(text: Line): boolean {
  if (!cuesEnabled()) return false;
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    const v = voice();
    if (v) u.voice = v;
    u.pitch = BRIGHT.has(text) ? 1.1 : 0.5;
    u.rate = BRIGHT.has(text) ? 1 : 0.9;
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

let ctx: AudioContext | null = null;
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

/** Lokal ljudfil (cachas av service workern); avkodas en gång. Faller tillbaka på syntetiskt ljud om den saknas. */
const SAMPLES: Partial<Record<Cue, string>> = { zombie: "/audio/zombie-near.wav", captured: "/audio/captured-scream.wav", jump: "/audio/jump-scream.wav", tension: "/audio/tension.wav", sprint: "/audio/sprint-shriek.wav", goal: "/audio/checkpoint.wav" };
const buffers = new Map<Cue, AudioBuffer>();
const loading = new Set<Cue>();

/** Förladdar och avkodar matchens ljudfiler (anropas efter första användarinteraktionen). */
export async function preloadCues(): Promise<void> {
  try {
    ctx ??= new AudioContext();
    for (const [cue, url] of Object.entries(SAMPLES) as [Cue, string][]) {
      if (buffers.has(cue) || loading.has(cue)) continue;
      loading.add(cue);
      try {
        const r = await fetch(url);
        buffers.set(cue, await ctx.decodeAudioData(await r.arrayBuffer()));
      } catch { /* synt-reserv används */ } finally { loading.delete(cue); }
    }
  } catch { /* ljud ej tillgängligt */ }
}

/** Only these cues make sound ("goal" = the rewarding chime when a checkpoint is reached); the others (alerts, extraction, match over) are silent so the game is not noisy. */
const AUDIBLE = new Set<Cue>(["zombie", "captured", "jump", "tension", "goal", "sprint"]);

/**
 * Brings the audio context back to "running". iOS leaves it "suspended" or "interrupted" (speech, a call, Siri, another app's audio, the
 * screen going dark); a sound started then is silently lost. Resolves with the state reached (waits at most `maxMs`).
 */
async function wake(c: AudioContext, maxMs = 1500): Promise<string> {
  if (c.state === "running") return "running";
  try { await Promise.race([c.resume(), new Promise((r) => setTimeout(r, maxMs))]); } catch { /* not allowed without a gesture */ }
  return c.state;
}

/** How a cue came out, for the field log: "sample" / "synth" = sound started (context state after it), "silent" = no sound by design, "muted", "error". */
export type CueResult = { how: "sample" | "synth" | "silent" | "muted" | "error"; state?: string };

/** Ljud och vibration så att spelaren inte behöver titta på skärmen (särskilt viktigt på cykel). Vibration saknas på iPhone. */
export async function playCue(cue: Cue): Promise<CueResult> {
  if (!cuesEnabled()) return { how: "muted" };
  try { navigator.vibrate?.(PATTERN[cue].vib); } catch { /* ej stött */ }
  if (!AUDIBLE.has(cue)) return { how: "silent" };
  try {
    ctx ??= new AudioContext();
    // Start the sound only once the context really runs: started on a suspended/interrupted context it may never be heard (checkpoint chime "only sometimes").
    const state = await wake(ctx);
    let buf = buffers.get(cue);
    if (!buf && SAMPLES[cue]) { await preloadCues(); buf = buffers.get(cue); } // not decoded yet (e.g. right after a reload): load it now rather than a faint beep
    if (buf) {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = cue === "captured" || cue === "jump" || cue === "goal" || cue === "sprint" ? 1 : 0.7;
      src.buffer = buf;
      src.connect(gain).connect(ctx.destination);
      src.start();
      return { how: "sample", state };
    }
    let t = ctx.currentTime;
    for (const f of PATTERN[cue].f) {
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

let wakeOnTouch = false;

/** Anropas vid en knapptryckning så att ljud tillåts senare under spelet. */
export function unlockAudio(): void {
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
