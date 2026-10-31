"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { RECAP_KEEP_MS, RecapStore, nearZombies, tracksOf, type RecapChunk, type RecapMeta } from "@/play/recap";
import { ACTIVITY_LABEL, DIFFICULTY_LABEL, MODE_LABEL, RESULT_LABEL, fmtDate, fmtTime } from "../_client/format";
import { PageHeader } from "../_client/Modal";
import { useSessionCtx } from "../_client/SessionProvider";

const RecapMap = dynamic(() => import("../_client/RecapMap"), { ssr: false });

/** Zombies shown by default: those that came within this distance of the player. */
const NEAR_M = 300;
/** Playback plays the whole match in about this many seconds (never slower than 10× real time). */
const PLAY_S = 30;

/** After a match: the tracks on a map with a time slider, and the numbers. Kept a week on the device. */
export default function Recap() {
  const ctx = useSessionCtx();
  const search = useSearchParams();
  const id = search.get("id") ?? "";
  // From the result dialog (SHOW MATCH) back goes to it; from Previous games back to the list.
  const back = search.get("from") === "play" ? "/play" : "/history";
  const [data, setData] = useState<{ meta: RecapMeta; chunks: RecapChunk[] } | null | undefined>(undefined);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!ctx) return;
    if (!ctx.db || !id) { setData(null); return; }
    void new RecapStore(ctx.db).load(id).then((d) => { setData(d); if (d) setT(d.meta.elapsedS); }, () => setData(null));
  }, [ctx, id]);

  const tracks = useMemo(() => (data ? tracksOf(data.chunks) : null), [data]);
  const near = useMemo(() => (tracks ? nearZombies(tracks.player, tracks.zombies, NEAR_M) : []), [tracks]);
  const shown = near;
  const end = data?.meta.elapsedS ?? 0;

  // Playback: requestAnimationFrame, the whole match in about PLAY_S seconds.
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    if (!playing) return;
    const rate = Math.max(10, end / PLAY_S);
    let last = performance.now();
    let raf = requestAnimationFrame(function frame(now) {
      const next = Math.min(end, tRef.current + ((now - last) / 1000) * rate);
      last = now;
      setT(next);
      if (next >= end) { setPlaying(false); return; }
      raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, end]);

  if (data === undefined) return <main className="page"><PageHeader title="MATCH" href={back} /><div className="muted">Loading…</div></main>;
  if (!data || !tracks) {
    return (
      <main className="page">
        <PageHeader title="MATCH" href={back} />
        <div className="card">This match has no saved map. Maps are kept on this device for {Math.round(RECAP_KEEP_MS / 86_400_000)} days after the match and then deleted.</div>
      </main>
    );
  }
  const m = data.meta;
  return (
    <main className="page recap">
      <PageHeader title="MATCH" href={back} />
      <div className="muted">{MODE_LABEL[m.mode]} · {ACTIVITY_LABEL[m.activity]} · {DIFFICULTY_LABEL[m.difficulty]} · <b>{RESULT_LABEL[m.result] ?? m.result}</b> · {fmtDate(m.startedAt)}</div>
      <RecapMap player={tracks.player} zombies={shown} t={t} start={m.start} end={m.end} captured={m.captured} targets={m.targets} extraction={m.extraction} />
      <div className="recapbar">
        <button className="btn" aria-label={playing ? "Pause" : "Play"} onClick={() => { if (!playing && t >= end) setT(0); setPlaying(!playing); }}>{playing ? "❚❚" : "▶"}</button>
        <input type="range" aria-label="Time in the match" min={0} max={Math.max(1, end)} step={1} value={Math.round(t)} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} />
        <span className="recaptime">{fmtTime(t)} / {fmtTime(end)}</span>
      </div>
    </main>
  );
}
