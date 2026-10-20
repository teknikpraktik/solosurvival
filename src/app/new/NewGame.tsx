"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { PageHeader } from "../_client/Modal";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import type { GameMode } from "@/engine/objectives/objectives";
import { DISTANCE_LIMITS, DURATION_LIMITS, atoBMaxStraightM, START_MAX_ACCURACY_M, clampParams, defaultParams, withActivity, type MatchParams } from "@/play/config";
import { estimatedMinutes } from "@/play/prepare";
import { COURSE_DETOUR_FACTOR } from "@/routes/course";
import { haversineM } from "@/geo/geometry";
import { errorText } from "@/gps/provider/provider";
import { matchDurationS } from "@/play/match";
import { ACTIVITY_LABEL, DIFFICULTY_LABEL, MODE_HELP, MODE_LABEL, fmtKm, fmtTime } from "../_client/format";
import type { MapMarker } from "../_client/GameMap";
import { cuesEnabled, setCuesEnabled, unlockAudio } from "../_client/cues";
import { useSessionCtx, useSessionView } from "../_client/SessionProvider";

const GameMap = dynamic(() => import("../_client/GameMap"), { ssr: false });

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; t: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="seg" role="group" aria-label={label}>
        {options.map((o) => <button key={o.v} aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.t}</button>)}
      </div>
    </div>
  );
}

export default function NewGame() {
  const ctx = useSessionCtx();
  const router = useRouter();
  const session = ctx?.session;
  const view = useSessionView(session);
  const [p, setP] = useState<MatchParams>(() => defaultParams("walk"));
  const [cues, setCues] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCues(cuesEnabled()); }, []);
  useEffect(() => {
    if (!session) return;
    if (session.getView().stage === "finished") session.reset();
    session.startLocating();
  }, [session]);

  const stage = view?.stage ?? "idle";
  const preview = stage === "preview" || stage === "preparing";
  const prepared = view?.prepared ?? null;
  const proposal = prepared?.proposals[view?.selected ?? 0] ?? null;
  const set = (patch: Partial<MatchParams>) => setP((cur) => clampParams({ ...cur, ...patch }));

  // Location details are not shown to the player: only a short note when something needs attention.
  const gps = useMemo(() => {
    if (!view) return null;
    if (view.gpsError) return { tone: "bad", text: errorText[view.gpsError.code] };
    if (view.accuracyM === null) return { tone: "warn", text: "Finding your location… Move to open sky." };
    if (view.accuracyM > START_MAX_ACCURACY_M) return { tone: "warn", text: "Waiting for a better location signal…" };
    return null;
  }, [view]);

  const isAB = p.mode === "escape";
  const canPrepare = !!session?.currentStart() && (!isAB || !!p.pointB) && !busy && stage !== "preparing";
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  const limit = DISTANCE_LIMITS[p.activity];
  const dur = DURATION_LIMITS[p.activity];
  // A TO B: any way goes, so only a faint straight line between A and B is drawn (not the shortest path).
  const abA = view?.params?.pointA ?? null;
  const abB = proposal?.waypoints[0] ?? null;
  const routes = isAB
    ? (abA && abB ? [{ points: [abA, { lat: abB.lat, lon: abB.lon }], selected: false, faint: true }] : [])
    : []; // Mission: no route line, only the numbered checkpoints
  const markers: MapMarker[] = proposal ? proposal.waypoints.filter((w) => w.kind !== "home").map((w, i) => ({ id: w.id, label: w.kind === "destination" ? "B" : String(i + 1), lat: w.lat, lon: w.lon, tone: "todo" as const })) : [];
  if (proposal && isAB && view?.params?.pointA) markers.push({ id: "A", label: "A", lat: view.params.pointA.lat, lon: view.params.pointA.lon, tone: "done" });

  if (preview && view) {
    const status = prepared?.status;
    const ok = status === "ok" || status === "alternative";
    return (
      <div className="map-shell">
        <GameMap graph={prepared?.graph} routes={routes} markers={markers} start={session?.currentStart()} player={view.position} accuracyM={view.accuracyM} fit={isAB && abA && abB ? [abA, { lat: abB.lat, lon: abB.lon }] : proposal?.geometry ?? (view.position ? [view.position] : null)} />
        <div className="hudbar"><div className="line"><span className="pill">{MODE_LABEL[p.mode]} · {ACTIVITY_LABEL[p.activity]}</span><Link className="pill" href="/">✕</Link></div></div>
        <div className="sheet">
          {stage === "preparing" && <div className="card">Loading map data and planning…</div>}
          {stage !== "preparing" && prepared && !ok && <div className="card bad">{prepared.message}</div>}
          {stage !== "preparing" && prepared?.status === "ok" && prepared.notes.some((n) => n.startsWith("easy-bike-network")) && <div className="card warn">Few easy gravel roads or bike lanes here, so the route may include rougher trails.</div>}
          {stage !== "preparing" && prepared?.status === "alternative" && <div className="card warn">{prepared.message}</div>}
          {stage !== "preparing" && prepared && ok && p.mode === "mission" && prepared.proposals.length > 1 && (
            <div className="chips" role="group" aria-label="Proposals">
              {prepared.proposals.map((r, i) => <button key={r.id} className="chip" aria-pressed={i === view.selected} onClick={() => session!.select(i)}>Course {i + 1}</button>)}
            </div>
          )}
          {stage !== "preparing" && ok && proposal && (
            <>
              <div className="stat"><span>{isAB ? "Straight line" : "Distance (straight lines)"}</span><b>{fmtKm(isAB && abA && abB ? haversineM(abA, abB) : proposal.lengthM)}</b></div>
              <div className="stat"><span>Estimated time</span><b>about {estimatedMinutes(proposal.lengthM * (p.mode === "mission" ? COURSE_DETOUR_FACTOR : 1), p)} min</b></div>
              <div className="stat"><span>Time limit</span><b>{fmtTime(matchDurationS(p, proposal))}</b></div>
              <div className="stat"><span>Goal</span><b>{p.mode === "escape" ? "Point B – any route" : `${proposal.waypoints.filter((w) => w.kind === "checkpoint").length} checkpoints + home`}</b></div>
              {proposal.quality.flags.length > 0 && <div className="muted">{proposal.quality.flags.join(" · ")}</div>}
            </>
          )}
          {stage !== "preparing" && ok && p.mode === "survival" && (
            <>
              <div className="stat"><span>Match length</span><b>{fmtTime(p.durationS)}</b></div>
              <div className="muted">Survival has no route. Move freely along the trails. Extraction opens at 80 % of the time.</div>
            </>
          )}
          {view.movedFromPreview && (
            <div className="card warn">
              {isAB ? `You have moved ${view.distToPreviewStartM ?? "?"} m from A. Update the route from your position.` : "You have moved from the start point. Update the route."}
              {isAB && <button className="link" style={{ display: "block" }} onClick={() => run(() => session!.prepare({ ...(view.params ?? p), pointA: null }))}>Update A to my position</button>}
            </div>
          )}
          {view.messages.map((m) => <div key={m} className="card warn">{m}</div>)}
          <div className="muted">{isAB ? "Any route you like counts. The line is only a hint. Never cross a road or railway just because the game suggests it." : "Fetch the numbered checkpoints in order, then return home. Choose your own way. Never cross a road or railway just because the game suggests it."}</div>
          <div className="row">
            {!isAB && <button className="btn" disabled={busy || stage === "preparing"} onClick={() => run(() => session!.regenerate())}>{p.mode === "survival" ? "REFRESH" : "NEW COURSE"}</button>}
            <button className="btn" disabled={busy} onClick={() => session!.backToConfig()}>CHANGE</button>
          </div>
          <button
            className="btn primary big"
            disabled={!ok || stage === "preparing" || view.movedFromPreview || !session!.currentStart()}
            onClick={() => run(async () => { unlockAudio(); if (await session!.startMatch()) router.push("/play"); })}
          >
            START
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="page">
      <PageHeader title="NEW GAME" />
      {gps && <div className={`card ${gps.tone}`} role="status">{gps.text}</div>}
      <Seg<GameMode> label="Mode" value={p.mode} options={(["mission", "escape", "survival"] as GameMode[]).map((m) => ({ v: m, t: MODE_LABEL[m] }))} onChange={(mode) => set({ mode })} />
      <div className="muted">{MODE_HELP[p.mode]}</div>
      <Seg<Activity> label="Activity" value={p.activity} options={(["walk", "mtb"] as Activity[]).map((a) => ({ v: a, t: ACTIVITY_LABEL[a] }))} onChange={(a) => setP(withActivity(p, a))} />
      <Seg<Difficulty> label="Difficulty" value={p.difficulty} options={(["easy", "normal", "hard"] as Difficulty[]).map((d) => ({ v: d, t: DIFFICULTY_LABEL[d] }))} onChange={(difficulty) => set({ difficulty })} />
      {p.mode === "survival" ? (
        <div className="field">
          <label htmlFor="dur">Match length: <b>{Math.round(p.durationS / 60)} min</b></label>
          <input id="dur" type="range" min={dur.minMin} max={dur.maxMin} step={dur.stepMin} value={Math.round(p.durationS / 60)} onChange={(e) => set({ durationS: Number(e.target.value) * 60 })} />
        </div>
      ) : p.mode === "mission" ? (
        <div className="field">
          <label htmlFor="dist">Distance (straight lines between checkpoints): <b>{fmtKm(p.targetLengthM)}</b></label>
          <input id="dist" type="range" min={limit.min} max={limit.max} step={limit.step} value={p.targetLengthM} onChange={(e) => set({ targetLengthM: Number(e.target.value) })} />
        </div>
      ) : (
        <div className="field">
          <div className="stat"><span>A</span><b>Your position now</b></div>
          <div className="stat"><span>B</span><b>{p.pointB ? "Picked ✓" : "Tap the map"}</b></div>
          <div className="pickmap" data-testid="pickmap">
            <GameMap
              zoom={14}
              player={view?.position}
              accuracyM={view?.accuracyM}
              fit={view?.position && p.pointB ? [view.position, p.pointB] : null}
              markers={[...(view?.position ? [{ id: "A", label: "A", lat: view.position.lat, lon: view.position.lon, tone: "done" as const }] : []), ...(p.pointB ? [{ id: "B", label: "B", lat: p.pointB.lat, lon: p.pointB.lon, tone: "next" as const }] : [])]}
              onPick={(pt) => set({ pointB: pt })}
            />
          </div>
        </div>
      )}
      <label className="muted" style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}>
        <input type="checkbox" checked={cues} onChange={(e) => { setCues(e.target.checked); setCuesEnabled(e.target.checked); }} style={{ width: 22, height: 22 }} />
        Sound and vibration for events (no vibration on iPhone)
      </label>
      <button className="btn primary big" disabled={!canPrepare} onClick={() => run(async () => { unlockAudio(); await session!.prepare(clampParams({ ...p, seed: Math.floor(Math.random() * 1e9) })); })}>
        {p.mode === "survival" ? "SHOW AREA" : isAB && !p.pointB ? "PICK B ON THE MAP" : isAB ? "SHOW ROUTE" : "SHOW COURSE"}
      </button>
      {!ctx && <div className="muted">Loading…</div>}
    </main>
  );
}
