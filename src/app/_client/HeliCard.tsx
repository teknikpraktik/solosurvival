"use client";

import { HELI_SVG } from "./symbols";

/**
 * Survival: a compact picture card when the helicopter approaches or has landed. It sits above the controls (behind the player, who is
 * drawn a little below the middle), lets every touch through to the map and the controls, and goes by itself (the session decides how
 * long). No shake, no flash, no full screen. The picture is a CSS layer over a helicopter icon, so a missing file still leaves a card.
 */
export function HeliCard({ kind, title, sub }: { kind: "approaching" | "landed"; title: string; sub: string }) {
  return (
    <div className="helicard" data-kind={kind} role="status" aria-live="polite">
      <span className="helicard-thumb" aria-hidden="true">
        <span className="helicard-icon" dangerouslySetInnerHTML={{ __html: HELI_SVG }} />
        <span className="helicard-img" />
      </span>
      <span className="helicard-text">
        <b>{title}</b>
        <span>{sub}</span>
      </span>
    </div>
  );
}
