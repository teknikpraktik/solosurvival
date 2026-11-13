"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { readLevels, soundscape, writeLevels } from "./audio";
import { setCuesEnabled } from "./cues";
import { t } from "./strings";
import type { Levels } from "@/audio/soundscape";

/** Sound settings: one switch for all sound, and separate levels for music, effects and the voice. Saved on the device. */
export function SoundSettings() {
  const [open, setOpen] = useState(false);
  const [l, setL] = useState<Levels | null>(null);
  useEffect(() => { if (open) setL(readLevels()); }, [open]);
  const S = t().sound;
  const set = (patch: Partial<Levels>) => {
    if (patch.on !== undefined) setCuesEnabled(patch.on);
    const next = writeLevels(patch);
    soundscape().applyLevels(0.2);
    if (patch.music !== undefined && next.music > 0) void soundscape().music.prefetch();
    setL(next);
  };
  const slider = (key: "music" | "fx" | "voice", label: string) => (
    <label className="soundrow">
      <span>{label}</span>
      <input type="range" min={0} max={100} step={5} value={Math.round((l?.[key] ?? 1) * 100)} disabled={!l?.on} aria-label={label}
        onChange={(e) => set({ [key]: Number(e.target.value) / 100 })} />
      <span className="soundval" aria-hidden="true">{Math.round((l?.[key] ?? 1) * 100)}</span>
    </label>
  );
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>{S.button}</button>
      {open && l && (
        <Modal title={S.title} onClose={() => setOpen(false)} actions={<button className="btn primary" onClick={() => setOpen(false)}>{S.done}</button>}>
          <label className="soundrow switch">
            <span>{S.all}</span>
            <input type="checkbox" checked={l.on} onChange={(e) => set({ on: e.target.checked })} aria-label={S.all} />
          </label>
          {slider("music", S.music)}
          {slider("fx", S.effects)}
          {slider("voice", S.voice)}
          <p className="muted">{S.note}</p>
        </Modal>
      )}
    </>
  );
}
