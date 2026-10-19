"use client";

import { useEffect } from "react";

/** Kort slumpad skrämma under pågående match: bild + (via cue-systemet) skrik. Blockerar inte spelet (pointer-events: none). */
export function JumpScare({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1300);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="jump" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/img/jump.jpg" alt="" onError={(e) => { (e.target as HTMLImageElement).src = "/img/jump.svg"; }} />
    </div>
  );
}
