"use client";

import { useEffect, useRef } from "react";

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
      <img src="/img/captured.jpg" alt="" onError={(e) => { (e.target as HTMLImageElement).src = "/img/captured.svg"; }} />
      <div className="scare-text">CAPTURED</div>
    </div>
  );
}
