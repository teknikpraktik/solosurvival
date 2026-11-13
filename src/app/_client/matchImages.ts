/**
 * The adult app's mood and result pictures: which picture goes with which match ending and mode, where its subject sits, and preloading.
 * Pictures are always optional: every place that shows one has a fallback (an SVG or a dark gradient) and its text, so a missing or slow
 * file never holds up a match start, a card or a result. They are cached by the service worker like every /img/ file (on first fetch).
 */
import type { GameMode } from "@/engine/objectives/objectives";

export const IMG = {
  hero: "/img/hero-v2.jpg",
  captured: "/img/captured-v2.jpg",
  /** Drawn locally (no photo): shown if the captured photo cannot be loaded. */
  capturedFallback: "/img/captured.svg",
  outOfTime: "/img/out-of-time.jpg",
  safehouse: "/img/safehouse.jpg",
  extracted: "/img/extracted.jpg",
  heliApproaching: "/img/heli-approaching.jpg",
  heliLanded: "/img/heli-landed.jpg",
} as const;

/** A picture behind the result: its file, a fallback file (or null = the dark gradient alone) and where its subject is (`object-position`). */
export interface ResultPicture { key: "captured" | "out-of-time" | "safehouse" | "extracted"; src: string; fallback: string | null; position: string }

/**
 * The picture for how the match ended, from the match's own result and mode (not from any text): captured, out of time, won in
 * Checkpoints or A TO B (the safe house), won in Survival (extracted). Aborted or unknown endings get no picture.
 */
export function resultPicture(result: string | undefined, mode: GameMode): ResultPicture | null {
  if (result === "infected") return { key: "captured", src: IMG.captured, fallback: IMG.capturedFallback, position: "50% 22%" };
  if (result === "failed") return { key: "out-of-time", src: IMG.outOfTime, fallback: null, position: "50% 30%" };
  if (result === "survived") {
    return mode === "survival"
      ? { key: "extracted", src: IMG.extracted, fallback: null, position: "50% 30%" }
      : { key: "safehouse", src: IMG.safehouse, fallback: null, position: "50% 18%" };
  }
  return null;
}

/** The pictures a match of this mode may show (cards and every possible ending). */
export function matchPictures(mode: GameMode): string[] {
  const end = [IMG.captured, IMG.outOfTime, mode === "survival" ? IMG.extracted : IMG.safehouse];
  return mode === "survival" ? [IMG.heliApproaching, IMG.heliLanded, ...end] : end;
}

const asked = new Set<string>();
/** Starts loading the mode's pictures in the background (once per file and page load). Errors are ignored: the fallbacks cover them. */
export function preloadMatchPictures(mode: GameMode): void {
  if (typeof Image === "undefined") return;
  for (const src of matchPictures(mode)) {
    if (asked.has(src)) continue;
    asked.add(src);
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  }
}
