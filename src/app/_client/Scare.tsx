"use client";

import { useEffect } from "react";

/** Full-screen "captured" jump scare: a scary local image with shaking and red flashes, shown for a few seconds (the scream is played by the cue system). */
export function Scare({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="scare" role="alert" aria-label="You were captured" onClick={onDone}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/img/captured.svg" alt="" />
      <div className="scare-text">CAPTURED</div>
    </div>
  );
}
