"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { TileStore } from "@/data/store";
import { tryOpenDb, type Db } from "@/play/idb";
import { PlaySession } from "@/play/session";
import { IdbTileCache } from "@/play/tile-cache";
import { createBrowserCompass } from "@/app/_client/compass";
import { MINI_DB_NAME, MINI_PROFILE } from "../config/product";
import { playCue, speak } from "./sounds";

interface Ctx {
  session: PlaySession;
  db: Db | null;
  ready: boolean;
}
const C = createContext<Ctx | null>(null);

/** Samma kartdata som OUTBREAK; kopieras in i appens public/ vid bygget (scripts/prepare.mjs). */
export const DATA_BASE = "/data/v1/varmland";

/** En enda PlaySession (delad spellogik) för hela appen, med Mini Outbreaks profil, egen lagring och eget ljudpaket. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  useEffect(() => {
    let cancelled = false;
    let session: PlaySession | null = null;
    (async () => {
      const db = await tryOpenDb(undefined, MINI_DB_NAME);
      const cache = db ? new IdbTileCache(db) : undefined;
      const store = new TileStore(DATA_BASE, (u) => fetch(u), cache);
      session = new PlaySession({
        geo: typeof navigator !== "undefined" ? navigator.geolocation : undefined,
        db,
        store,
        userAgent: navigator.userAgent,
        compass: createBrowserCompass(),
        profile: MINI_PROFILE,
        jumpScares: () => false,
        onCue: (c, text) => {
          void playCue(c);
          if (c === "goal" && /^(Checkpoint|All checkpoints)/.test(text)) setTimeout(() => speak("Checkpoint"), 1000);
        },
        wakeLock: "wakeLock" in navigator ? { request: () => (navigator as Navigator & { wakeLock: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock.request("screen") } : undefined,
      });
      try { const m = await store.loadManifest(); await cache?.purgeOthers(m.dataVersion); } catch { /* offline: använd cache */ }
      if (cancelled) return;
      setCtx({ session, db, ready: true });
    })();
    const vis = () => session?.onVisibility(document.hidden);
    const hide = () => session?.onPageHide();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", hide);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", vis); window.removeEventListener("pagehide", hide); };
  }, []);
  const value = useMemo(() => ctx, [ctx]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useSessionCtx(): Ctx | null {
  return useContext(C);
}

const noop = () => () => undefined;
export function useSessionView(session: PlaySession | undefined) {
  return useSyncExternalStore(session ? session.subscribe : noop, session ? session.getView : () => null, () => null);
}
