"use client";

import { useEffect, useRef } from "react";
import { cuesEnabled, unlockAudio } from "./cues";
import { narrator, useNarrator } from "./narration";
import { t } from "./strings";

/**
 * The narrator on a screen between missions: reads `id` by itself once `autoplay` is true (a briefing as it opens, a debrief once the
 * ending's own sounds are over), and a button to listen again or stop. Leaving the screen stops the read. Shows nothing when the read has
 * no recording. With the sound off nothing is read and the button says so (turning the sound on is the sound button's job).
 */
export function NarrationControl({ campaignId, id, autoplay }: { campaignId: string; id: string; autoplay: boolean }) {
  const S = t().campaign.narration;
  const state = useNarrator();
  const n = narrator();
  const has = n.has(campaignId, id);
  const started = useRef(false);

  useEffect(() => { n.preload(campaignId, id); }, [n, campaignId, id]);
  useEffect(() => {
    if (!has || !autoplay || started.current || !cuesEnabled()) return;
    started.current = true;
    void n.play(campaignId, id);
  }, [n, has, autoplay, campaignId, id]);
  useEffect(() => () => { if (n.get().id === id) n.stop(); }, [n, id]);

  if (!has) return null;
  const mine = state.id === id && state.status !== "idle";
  const toggle = () => {
    if (mine) { n.stop(); return; }
    unlockAudio();
    started.current = true;
    void n.play(campaignId, id);
  };
  const off = !cuesEnabled();
  return (
    <button type="button" className="narrate" data-state={mine ? state.status : "idle"} onClick={toggle} disabled={off && !mine}
      aria-label={off ? S.soundOff : mine ? S.stop : S.listen}>
      <span className="narrate-icon" aria-hidden="true">{mine ? "■" : "▶"}</span>
      <span className="narrate-label">{off ? S.soundOff : mine ? (state.status === "loading" ? S.loading : S.stop) : S.listen}</span>
      {mine && state.status === "playing" && <span className="narrate-bars" aria-hidden="true"><i /><i /><i /></span>}
    </button>
  );
}
