"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { TileStore } from "@/data/store";
import { tryOpenDb } from "@/play/idb";
import { PlaySession } from "@/play/session";
import { IdbTileCache } from "@/play/tile-cache";
import type { Db } from "@/play/idb";
import { cancelPendingSpeech, playCue, speak } from "./cues";
import { matchAudio, soundscape } from "./audio";
import { openFreeMapFetcher } from "@/geo/blockers";
import { createBrowserCompass } from "./compass";

interface Ctx {
  session: PlaySession;
  db: Db | null;
  ready: boolean;
}
const C = createContext<Ctx | null>(null);

export const DATA_BASE = "/data/v1/varmland";
const TRACE_KEY = "outbreak.trace";
export const traceEnabled = () => { try { return localStorage.getItem(TRACE_KEY) === "on"; } catch { return false; } };
export const setTraceEnabled = (on: boolean) => { try { localStorage.setItem(TRACE_KEY, on ? "on" : "off"); } catch { /* ignoreras */ } };

/** Skapar en enda PlaySession för hela appen så att GPS och match överlever sidbyten. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  useEffect(() => {
    let cancelled = false;
    let session: PlaySession | null = null;
    (async () => {
      const db = await tryOpenDb();
      const cache = db ? new IdbTileCache(db) : undefined;
      const store = new TileStore(DATA_BASE, (u) => fetch(u), cache);
      session = new PlaySession({
        geo: typeof navigator !== "undefined" ? navigator.geolocation : undefined,
        db,
        store,
        userAgent: navigator.userAgent,
        compass: createBrowserCompass(),
        terrainTiles: openFreeMapFetcher(),
        traceEnabled,
        jumpScares: () => true, // hidden feature: always on (never on Bike, decided by the session)
        // Cues vibrate and speak; every sound file comes from the soundscape (onSound), so nothing is heard twice.
        onCue: (c, text) => {
          void playCue(c);
          // A bright spoken "Checkpoint" follows the chime on its own audio path, so the reward comes through even if Web Audio was interrupted.
          if (c === "goal" && /^(Checkpoint|All checkpoints)/.test(text)) setTimeout(() => speak("Checkpoint"), 1000);
          if (c === "sprint") setTimeout(() => speak("Run!"), 250); // zombie sprint (and extraction open): a spoken "Run!"
        },
        // What came of each event sound goes to the field log (the old checkpoint chime was heard "only sometimes" in the field).
        onSound: (e) => {
          if (e.type === "finished") cancelPendingSpeech();
          void matchAudio().onEvent(e).then((r) => { if (r !== null) session?.fieldLog?.add(Date.now(), "sound", { event: e.type, result: r, stale: e.stale, ctx: soundscape().context()?.state }); }, () => undefined);
        },
        wakeLock: "wakeLock" in navigator ? { request: () => (navigator as Navigator & { wakeLock: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock.request("screen") } : undefined,
      });
      // Ny datauppsättning på servern rensar gamla tiles i cachen.
      try { const m = await store.loadManifest(); await cache?.purgeOthers(m.dataVersion); } catch { /* offline: använd cache */ }
      if (cancelled) return;
      // Felsökningshak för fälttest/e2e: localStorage "outbreak.debug" = "on" exponerar sessionen som window.__outbreak.
      try { if (localStorage.getItem("outbreak.debug") === "on") (window as unknown as { __outbreak?: PlaySession }).__outbreak = session; } catch { /* ignoreras */ }
      setCtx({ session, db, ready: true });
    })();
    const vis = () => {
      // Sound first: nothing old may play when the session works out the time away.
      soundscape().setSuppressed(document.hidden);
      matchAudio().setHidden(document.hidden);
      if (document.hidden) cancelPendingSpeech();
      session?.onVisibility(document.hidden);
    };
    const hide = () => session?.onPageHide();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", hide);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", vis); window.removeEventListener("pagehide", hide); };
  }, []);
  const value = useMemo(() => ctx, [ctx]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

/** Sessionen eller null medan appen startar. */
export function useSessionCtx(): Ctx | null {
  return useContext(C);
}

const noop = () => () => undefined;
export function useSessionView(session: PlaySession | undefined) {
  return useSyncExternalStore(session ? session.subscribe : noop, session ? session.getView : () => null, () => null);
}
