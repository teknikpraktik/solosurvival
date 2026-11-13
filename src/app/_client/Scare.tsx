"use client";

import { useEffect, useRef } from "react";
import { IMG } from "./matchImages";

/** Full-screen "captured" jump scare: a scary local image with shaking and red flashes, shown for 3 seconds, then the GAME OVER summary follows (the scream is played by the cue system). */
export function Scare({ onDone }: { onDone: () => void }) {
  // onDone is kept in a ref: the parent re-renders on every GPS update and a new callback must not restart the timer.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const t = setTimeout(() => done.current(), 3000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="scare" role="alert" aria-label="You were captured" onClick={onDone}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={IMG.captured} alt="" onError={(e) => { const img = e.target as HTMLImageElement; if (!img.src.endsWith(IMG.capturedFallback)) img.src = IMG.capturedFallback; }} />
      <div className="scare-text">CAPTURED</div>
    </div>
  );
}
