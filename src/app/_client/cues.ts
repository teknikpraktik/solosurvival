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
};

/** Ljud och vibration så att spelaren inte behöver titta på skärmen (särskilt viktigt på cykel). Vibration saknas på iPhone. */
export function playCue(cue: Cue): void {
  if (!cuesEnabled()) return;
  try { navigator.vibrate?.(PATTERN[cue].vib); } catch { /* ej stött */ }
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
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
  try { ctx ??= new AudioContext(); void ctx.resume(); } catch { /* ignoreras */ }
}
