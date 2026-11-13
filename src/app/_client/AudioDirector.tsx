"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useSessionCtx, useSessionView } from "./SessionProvider";
import { MATCH_SOUNDS, matchAudio, readLevels, soundscape } from "./audio";

/** Pages without menu music: the game itself, the test mode and the simulator. */
const NO_MUSIC = /^\/(play|field|dev)(\/|$)/;

/**
 * Menu music across page changes (it lives at app level, so a page change or a re-render never restarts it), and the audio unlock on the
 * first tap. On the game screen the music keeps playing only while a new match waits for its first location fix, and fades out as the
 * match starts.
 */
export function AudioDirector() {
  const path = usePathname() ?? "/";
  const session = useSessionCtx()?.session;
  const view = useSessionView(session);
  const m = view?.match;
  const waiting = !!m && !!session?.autoStartPending && m.paused && m.elapsedS < 0.5 && m.phase !== "finished";
  const wanted = !NO_MUSIC.test(path) || (path.startsWith("/play") && waiting);

  useEffect(() => {
    const s = soundscape();
    // Debug handle for field tests and e2e (same switch as window.__outbreak).
    try { if (localStorage.getItem("outbreak.debug") === "on") (window as unknown as { __outbreakAudio?: unknown }).__outbreakAudio = { soundscape: s, match: matchAudio() }; } catch { /* ignored */ }
    // Fetched (and cached for offline play) in the background, only if the music will be heard.
    const l = readLevels();
    if (l.on && l.music > 0) void s.music.prefetch();
    // Sound may start only from a tap: every tap unlocks (cheap when already unlocked) and starts music that waits for one.
    const tap = () => s.unlock();
    const opts = { capture: true, passive: true } as const;
    for (const ev of ["pointerup", "touchend", "click", "keydown"] as const) document.addEventListener(ev, tap, opts);
    return () => { for (const ev of ["pointerup", "touchend", "click", "keydown"] as const) document.removeEventListener(ev, tap, opts); };
  }, []);

  useEffect(() => { soundscape().music.want(wanted); }, [wanted]);

  // Setting up a match: decode the match sounds now, without holding up the screen (Survival's helicopter follows at match start).
  useEffect(() => { if (path.startsWith("/new")) soundscape().preload(MATCH_SOUNDS); }, [path]);

  return null;
}
