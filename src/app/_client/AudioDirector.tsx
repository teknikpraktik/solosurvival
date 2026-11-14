"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useSessionCtx, useSessionView } from "./SessionProvider";
import { MATCH_SOUNDS, matchAudio, musicMode, readLevels, soundscape } from "./audio";

/**
 * Music across page changes (it lives at app level, so a page change or a re-render never restarts it), and the audio unlock on the
 * first tap. See musicMode for when it plays.
 */
export function AudioDirector() {
  const path = usePathname() ?? "/";
  const session = useSessionCtx()?.session;
  const view = useSessionView(session);
  const m = view?.match;
  const [endDone, setEndDone] = useState(() => matchAudio().endSequenceDone);
  useEffect(() => matchAudio().onEndSequence(setEndDone), []);
  const mode = musicMode(path, m, { autoStartPending: !!session?.autoStartPending, finished: view?.stage === "finished", endSequenceDone: endDone });

  useEffect(() => {
    const s = soundscape();
    // Debug handle for field tests and e2e (same switch as window.__outbreak).
    try { if (localStorage.getItem("outbreak.debug") === "on") (window as unknown as { __outbreakAudio?: unknown }).__outbreakAudio = { soundscape: s, match: matchAudio() }; } catch { /* ignored */ }
    // Fetched (and cached for offline play) in the background, only if the music will be heard.
    const l = readLevels();
    if (l.on && l.music > 0) void s.music.prefetch();
    // Every tap unlocks (cheap when already unlocked) and starts music that a browser refused to start without one.
    const tap = () => s.unlock();
    const opts = { capture: true, passive: true } as const;
    for (const ev of ["pointerup", "touchend", "click", "keydown"] as const) document.addEventListener(ev, tap, opts);
    return () => { for (const ev of ["pointerup", "touchend", "click", "keydown"] as const) document.removeEventListener(ev, tap, opts); };
  }, []);

  useEffect(() => {
    const music = soundscape().music;
    if (mode === "off") { music.want(false); return; }
    music.setRepeat(mode === "loop");
    if (mode === "loop") music.want(true); // "finish" never starts it: it only lets a pass that plays run to its end
  }, [mode]);

  // Setting up a match: decode the match sounds now, without holding up the screen (Survival's helicopter follows at match start).
  useEffect(() => { if (path.startsWith("/new")) soundscape().preload(MATCH_SOUNDS); }, [path]);

  return null;
}
