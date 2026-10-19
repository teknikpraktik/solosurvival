import type { Cue } from "@/play/session";

const KEY = "outbreak.cues";

export function cuesEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export function setCuesEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* lagring kan vara blockerad */ }
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
};

/** Lokal ljudfil (cachas av service workern); avkodas en gång. Faller tillbaka på syntetiskt ljud om den saknas. */
const SAMPLES: Partial<Record<Cue, string>> = { zombie: "/audio/zombie-near.wav", captured: "/audio/captured-scream.wav", jump: "/audio/jump-scream.wav" };
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

/** Ljud och vibration så att spelaren inte behöver titta på skärmen (särskilt viktigt på cykel). Vibration saknas på iPhone. */
export function playCue(cue: Cue): void {
  if (!cuesEnabled()) return;
  try { navigator.vibrate?.(PATTERN[cue].vib); } catch { /* ej stött */ }
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const buf = buffers.get(cue);
    if (buf) {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = cue === "captured" || cue === "jump" ? 1 : 0.7;
      src.buffer = buf;
      src.connect(gain).connect(ctx.destination);
      src.start();
      return;
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
  } catch { /* ljud kan vara blockerat före första användarinteraktionen */ }
}

/** Anropas vid en knapptryckning så att ljud tillåts senare under spelet. */
export function unlockAudio(): void {
  try { ctx ??= new AudioContext(); void ctx.resume(); void preloadCues(); } catch { /* ignoreras */ }
}
