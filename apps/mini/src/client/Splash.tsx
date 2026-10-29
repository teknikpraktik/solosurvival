"use client";

import { useEffect, useRef, useState } from "react";

/** sessionStorage-nyckel: startbilden visas en gång per session (inte vid varje sidladdning). */
export const SPLASH_KEY = "mini-outbreak.splash";
/** Startbilden visas så här länge efter att bilden har laddats … */
const SHOW_MS = 2200;
/** … men aldrig längre än så här från start, även om bilden laddas långsamt. */
const MAX_MS = 4000;
const FADE_MS = 400;

/**
 * Körs i <head> före första ritningen: hoppar över startbilden om den redan visats i den här sessionen, eller om en pågående match
 * laddas om (/play), så att den varken blinkar till eller fördröjer spelet.
 */
export const SPLASH_GATE = `try{if(sessionStorage.getItem(${JSON.stringify(SPLASH_KEY)})||location.pathname.indexOf("/play")===0)document.documentElement.classList.add("nosplash")}catch(e){}`;

/**
 * Startbild när appen öppnas: ritas redan i den statiska HTML:en (syns direkt), tonas ut efter några sekunder eller vid tryck.
 * Bilden är levererad av beställaren (public/brand/splash.*).
 */
export function Splash() {
  const [phase, setPhase] = useState<"show" | "fade" | "gone">("show");
  const loadedAt = useRef<number | null>(null);

  useEffect(() => {
    if (document.documentElement.classList.contains("nosplash")) { setPhase("gone"); return; }
    const start = Date.now();
    const img = document.querySelector<HTMLImageElement>(".splash img");
    if (img?.complete) loadedAt.current = start;
    const onLoad = () => { loadedAt.current ??= Date.now(); };
    img?.addEventListener("load", onLoad);
    const t = setInterval(() => {
      const now = Date.now();
      if (now - start >= MAX_MS || (loadedAt.current !== null && now - loadedAt.current >= SHOW_MS)) setPhase((p) => (p === "show" ? "fade" : p));
    }, 100);
    return () => { clearInterval(t); img?.removeEventListener("load", onLoad); };
  }, []);

  useEffect(() => {
    if (phase !== "fade") return;
    // Markeras som visad först nu: laddas sidan om under startbilden (service workern gör det en gång vid första installationen) visas den igen.
    try { sessionStorage.setItem(SPLASH_KEY, "1"); } catch { /* privat läge: visas igen nästa gång */ }
    const t = setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "gone") return null;
  return (
    <div className={`splash${phase === "fade" ? " out" : ""}`} role="img" aria-label="Mini Outbreak" onClick={() => setPhase("fade")}>
      <picture>
        <source srcSet="/brand/splash.webp" type="image/webp" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/splash.jpg" alt="" width={1080} height={1080} />
      </picture>
      <div className="splash-hint">Loading…</div>
    </div>
  );
}
