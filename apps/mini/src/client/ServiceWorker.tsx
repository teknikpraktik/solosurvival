"use client";

import { useEffect, useRef, useState } from "react";
import { BUILD_ID } from "@/app/_client/build";
import { useSessionCtx, useSessionView } from "./SessionProvider";

const CHECK_MS = 30 * 60 * 1000;

/** Registrerar service workern (bara i produktion) och visar en kontrollerad uppdateringsrad. Uppdatering sker aldrig mitt i en match. */
export function ServiceWorker() {
  const ctx = useSessionCtx();
  const view = useSessionView(ctx?.session);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [newBuild, setNewBuild] = useState(false);
  const reg = useRef<ServiceWorkerRegistration | null>(null);
  const inMatch = view?.stage === "playing";

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloading) { reloading = true; location.reload(); } });
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(BUILD_ID)}`).then((r) => {
      reg.current = r;
      if (r.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting);
      r.addEventListener("updatefound", () => {
        const w = r.installing;
        w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) setWaiting(w); });
      });
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const check = async () => {
      try {
        const r = await fetch("/version.json", { cache: "no-store" });
        const v = (await r.json()) as { id: string };
        if (v.id && v.id !== BUILD_ID) { setNewBuild(true); void reg.current?.update(); }
      } catch { /* offline */ }
    };
    void check();
    const h = setInterval(check, CHECK_MS);
    const vis = () => { if (!document.hidden) void check(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(h); document.removeEventListener("visibilitychange", vis); };
  }, []);

  // Under en match visas ingenting (raden skulle täcka spelkontrollerna); den dyker upp när matchen är slut.
  if ((!waiting && !newBuild) || inMatch) return null;
  const apply = () => { if (waiting) waiting.postMessage({ type: "SKIP_WAITING" }); else location.reload(); };
  return (
    <div className="update card good" role="status">
      <div>A new version of the game is available.</div>
      <button className="btn" style={{ width: "100%", marginTop: 8 }} onClick={apply}>UPDATE</button>
    </div>
  );
}
