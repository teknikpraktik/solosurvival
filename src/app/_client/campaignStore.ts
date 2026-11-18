"use client";

import { useCallback, useEffect, useState } from "react";
import { loadProgress, newProgress, saveProgress, type StoryProgress } from "@/campaign/progress";
import type { StoryDef } from "@/campaign/stories";

type KV = Pick<Storage, "getItem" | "setItem">;

/** Used when the browser will not give us localStorage (private mode): progress then lasts as long as the page does. */
const memory = new Map<string, string>();
const memoryKv: KV = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) };

/** Where campaign progress is kept: localStorage, or the page's memory when that is not available. One store for the pages and the session. */
export function campaignKv(): KV {
  try {
    const ls = window.localStorage;
    ls.getItem("outbreak.campaign.probe");
    return ls;
  } catch {
    return memoryKv;
  }
}

/**
 * A story's progress for a page (every chapter, the difficulty, the awards). It is read after mount (the server render and the first client
 * render show a new story, so the markup matches), and every change is saved at once.
 */
export function useStoryProgress(s: StoryDef): { progress: StoryProgress; ready: boolean; update: (fn: (p: StoryProgress) => StoryProgress) => void } {
  const [progress, setProgress] = useState<StoryProgress>(() => newProgress(s));
  const [ready, setReady] = useState(false);
  useEffect(() => { setProgress(loadProgress(campaignKv(), s)); setReady(true); }, [s]);
  const update = useCallback((fn: (p: StoryProgress) => StoryProgress) => {
    // From what is stored, not from this page's copy: a match may have saved a result since the page read it.
    const next = fn(loadProgress(campaignKv(), s));
    saveProgress(campaignKv(), next);
    setProgress(next);
  }, [s]);
  return { progress, ready, update };
}
