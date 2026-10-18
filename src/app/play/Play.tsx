"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { errorText } from "@/gps/provider/provider";
import { RESULT_LABEL, MODE_LABEL, fmtKm, fmtTime } from "../_client/format";
import { useSessionCtx, useSessionView } from "../_client/SessionProvider";
import { cuesEnabled, setCuesEnabled, unlockAudio } from "../_client/cues";
import { Modal } from "../_client/Modal";
import type { MapMarker } from "../_client/GameMap";

const GameMap = dynamic(() => import("../_client/GameMap"), { ssr: false });

export default function Play() {
  const ctx = useSessionCtx();
  const router = useRouter();
  const session = ctx?.session;
  const view = useSessionView(session);
  const [follow, setFollow] = useState(true);
  const [tried, setTried] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [trackUp, setTrackUp] = useState(true);
  const [pauseDismissed, setPauseDismissed] = useState(false);
  const [gpsDismissed, setGpsDismissed] = useState(false);
  const [sound, setSound] = useState(true);
  useEffect(() => { setSound(cuesEnabled()); }, []);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);

  // Direktlänk/omladdning: försök återställa en sparad match.
  useEffect(() => {
    if (!session || tried) return;
    setTried(true);
    if (session.getView().match) { session.startLocating(); return; }
    void session.restoreActive().then((r) => {
      if (!r) router.replace("/");
      else if (!r.ok) setRestoreMsg(r.reason ?? "Matchen kunde inte återställas.");
    });
  }, [session, tried, router]);

  const m = view?.match ?? null;
  const live = session?.live ?? null;
  const markers = useMemo<MapMarker[]>(() => {
    const o = m?.proposal;
    if (!o || !m?.objectives) return [];
    return o.waypoints.filter((w) => w.kind !== "home").map((w, i) => ({
      id: w.id, label: w.kind === "destination" ? "B" : String(i + 1), lat: w.lat, lon: w.lon,
      tone: i < m.objectives!.index ? "done" : i === m.objectives!.index ? "next" : "todo",
    }));
  }, [m?.proposal, m?.objectives?.index]);
  const route = useMemo(() => (m?.proposal ? [{ points: m.proposal.geometry, selected: true }] : []), [m?.proposal]);
  const zombies = useMemo(() => (m?.zombiesNear ?? []).map((z) => ({ id: z.id, edgeId: z.edgeId, distM: z.distM, speedMps: z.speedMps, chasing: z.state === "chase" || z.state === "intercept", sprinting: z.sprinting })), [m?.zombiesNear]);
  useEffect(() => { if (m && !m.paused) setPauseDismissed(false); }, [m?.paused]); // eslint-disable-line react-hooks/exhaustive-deps

  if (restoreMsg) {
    return (
      <main className="page">
        <div className="card bad">{restoreMsg}</div>
        <Link className="btn" href="/history">PREVIOUS GAMES</Link>
        <Link className="btn" href="/">TILL START</Link>
      </main>
    );
  }
  if (!view || !m || !session) return <main className="center"><p className="hint">Laddar…</p></main>;

  const finished = view.stage === "finished" || m.phase === "finished";
  const home = m.objectives?.next;
  const dHome = home && view.position ? Math.round(live?.distanceTo(home) ?? 0) : null;
  const gpsPill = view.gpsError ? errorText[view.gpsError.code] : m.gpsLost ? "GPS saknas" : view.quality === "infection_paused" ? "GPS svag" : view.quality === "verify" ? "GPS ok−" : "GPS ok";
  const gpsTone = m.gpsLost || view.gpsError ? "bad" : view.quality === "ok" ? "" : "warn";
  const remaining = Math.max(0, m.limitS - m.elapsedS);
  const ready = m.elapsedS < 0.5;
  const canResume = !m.needsFix && !m.gpsLost;

  return (
    <div className="map-shell">
      <GameMap
        graph={live?.g}
        routes={route}
        markers={markers}
        player={view.position}
        accuracyM={view.accuracyM}
        zombies={zombies}
        frozen={m.paused || finished}
        heading={view.heading}
        trackUp={trackUp}
        zoom={16}
        extraction={m.extraction}
        follow={follow}
        onUserMove={() => setFollow(false)}
        onError={(w) => session.fieldLog?.renderProblem(Date.now(), w)}
      />
      <div className="hudbar">
        <div className="line">
          <span className="pill">{MODE_LABEL[m.mode]}</span>
          <span className="pill" aria-label="Återstående tid">{fmtTime(remaining)}</span>
          <span className={`pill ${gpsTone}`}>{gpsPill}</span>
        </div>
        <div className="line">
          {m.objectives ? (
            <span className="pill">Mål {Math.min(m.objectives.index + 1, m.objectives.total)}/{m.objectives.total}{dHome !== null ? ` · ${dHome} m` : ""}{m.objectives.holdS > 0 ? ` · ${m.objectives.holdS.toFixed(0)}s` : ""}</span>
          ) : (
            <span className="pill">{m.extraction ? "Extraction öppen" : m.phase === "head_start" ? `Försprång ${fmtTime(m.headStartLeftS)}` : "Överlev"}</span>
          )}
        </div>
        {m.infection > 0 && <div className="infect" aria-label="Smittrisk"><div style={{ width: `${Math.min(100, (m.infection / 3) * 100)}%` }} /></div>}
      </div>
      <div className="toast" aria-live="polite">{view.messages.map((t) => <div key={t} className="card">{t}</div>)}</div>

      {!finished && (
        <div className="controls">
          {m.paused ? (
            <button className="primary wide" disabled={!canResume} onClick={() => { unlockAudio(); session.resume(); setFollow(true); }}>{ready ? "STARTA" : "FORTSÄTT"}</button>
          ) : (
            <button className="wide" onClick={() => session.pause("manual")}>PAUS</button>
          )}
          <button className="iconbtn" onClick={() => setFollow(true)} aria-label="Centrera på mig">⌖</button>
          <button className="iconbtn compass" onClick={() => { setTrackUp((t) => !t); setFollow(true); }} aria-label={trackUp ? "Track Up (tryck för North Up)" : "North Up (tryck för Track Up)"} aria-pressed={trackUp}>
            <svg viewBox="0 0 26 26" style={{ transform: trackUp && view.heading != null ? `rotate(${-view.heading}deg)` : "none" }} aria-hidden="true">
              <path d="M13 2l5 11h-10z" fill="#ef4444" /><path d="M13 24l-5-11h10z" fill="#8b98a5" /><circle cx="13" cy="13" r="1.8" fill="#0b0f14" />
            </svg>
          </button>
          <button className="iconbtn" onClick={() => { const on = !sound; setSound(on); setCuesEnabled(on); }} aria-label={sound ? "Ljud på (tryck för av)" : "Ljud av (tryck för på)"} aria-pressed={sound}>{sound ? "🔊" : "🔇"}</button>
          <button onClick={() => setConfirmEnd(true)}>AVSLUTA</button>
        </div>
      )}

      {!finished && m.paused && !pauseDismissed && !confirmEnd && (
        <Modal
          title={ready ? "Redo att starta" : "Pausad"}
          onClose={() => setPauseDismissed(true)}
          actions={
            <>
              <button className="btn primary big" disabled={!canResume} onClick={() => { unlockAudio(); session.resume(); setFollow(true); }}>{canResume ? (ready ? "STARTA" : "FORTSÄTT") : "VÄNTAR PÅ GPS…"}</button>
              <button className="btn" onClick={() => setConfirmEnd(true)}>AVSLUTA</button>
            </>
          }
        >
          {m.frozen && !ready && <div className="muted">Appen var inaktiv. Ingen tid har räknats.</div>}
          {!ready && <div className="muted">Efter paus är du skyddad mot smitta i 5 sekunder.</div>}
          <div className="muted">Appen måste vara öppen och i förgrunden för att GPS ska fungera.</div>
        </Modal>
      )}

      {!finished && !m.paused && m.gpsLostLong && !gpsDismissed && !confirmEnd && (
        <Modal
          title="GPS saknas"
          tone="bad"
          onClose={() => setGpsDismissed(true)}
          actions={<button className="btn" onClick={() => setConfirmEnd(true)}>AVSLUTA</button>}
        >
          <div className="muted">GPS har saknats i över en minut. Klockan och zombierna står stilla. Gå till öppen yta och vänta.</div>
        </Modal>
      )}

      {confirmEnd && !finished && (
        <Modal
          title="Avsluta matchen?"
          onClose={() => setConfirmEnd(false)}
          actions={
            <>
              <button className="btn primary" onClick={() => { setConfirmEnd(false); void session.abort(); }}>AVSLUTA</button>
              <button className="btn" onClick={() => setConfirmEnd(false)}>FORTSÄTT SPELA</button>
            </>
          }
        >
          <div className="muted">Matchen sparas som avbruten.</div>
        </Modal>
      )}

      {/* Match slut är ett obligatoriskt beslut: inget X, spelaren väljer vart hen går. */}
      {finished && (
        <Modal
          title={RESULT_LABEL[m.result ?? "incomplete"]?.toUpperCase() ?? "MATCH SLUT"}
          actions={
            <>
              <Link className="btn primary" href="/" onClick={() => session.reset()}>TILL START</Link>
              <Link className="btn" href="/history" onClick={() => session.reset()}>PREVIOUS GAMES</Link>
            </>
          }
        >
          <div className="stat"><span>Matchtid</span><b>{fmtTime(m.elapsedS)}</b></div>
          <div className="stat"><span>Uppmätt sträcka</span><b>{fmtKm(m.distanceM)}</b></div>
          {m.objectives && <div className="stat"><span>Mål</span><b>{m.objectives.index}/{m.objectives.total}</b></div>}
          {view.storageWarning && <div className="muted">Resultatet kunde inte sparas lokalt.</div>}
        </Modal>
      )}
    </div>
  );
}
