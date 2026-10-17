"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { errorText } from "@/gps/provider/provider";
import { RESULT_LABEL, MODE_LABEL, fmtKm, fmtTime } from "../_client/format";
import { useSessionCtx, useSessionView } from "../_client/SessionProvider";
import { unlockAudio } from "../_client/cues";
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
  const zombies = useMemo(() => (m?.zombiesNear ?? []).map((z) => ({ id: z.id, lat: z.lat, lon: z.lon, chasing: z.state === "chase" || z.state === "intercept" })), [m?.zombiesNear]);

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

  return (
    <div className="map-shell">
      <GameMap
        graph={live?.g}
        routes={route}
        markers={markers}
        player={view.position}
        accuracyM={view.accuracyM}
        zombies={zombies}
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
            <span className="pill">{m.extraction ? "Extraction öppen" : m.phase === "head_start" ? "Försprång" : "Överlev"}</span>
          )}
          <span className={`pill ${m.nearestZombieM !== null && m.nearestZombieM < 60 ? "bad" : ""}`}>{m.nearestZombieM !== null ? `Zombie ${Math.round(m.nearestZombieM)} m` : "Inga zombier nära"}</span>
        </div>
        {m.infection > 0 && <div className="infect" aria-label="Smittrisk"><div style={{ width: `${Math.min(100, (m.infection / 3) * 100)}%` }} /></div>}
      </div>
      <div className="toast" aria-live="polite">{view.messages.map((t) => <div key={t} className="card">{t}</div>)}</div>

      {!finished && (
        <div className="controls">
          {m.paused ? (
            <button className="primary" onClick={() => { unlockAudio(); session.resume(); setFollow(true); }}>{m.elapsedS < 0.5 ? "STARTA" : "FORTSÄTT"}</button>
          ) : (
            <button onClick={() => session.pause("manual")}>PAUS</button>
          )}
          <button onClick={() => setFollow(true)} aria-label="Centrera på mig">⌖</button>
          <button onClick={() => setConfirmEnd(true)}>AVSLUTA</button>
        </div>
      )}

      {!finished && m.paused && (
        <div className="overlay" style={{ background: "#0b0f14b3", alignItems: "flex-end", paddingBottom: 90, pointerEvents: "none" }}>
          <div className="card" style={{ pointerEvents: "auto" }}>
            <b>{m.elapsedS < 0.5 ? "Redo att starta" : "Pausad"}</b>
            {m.frozen && <div className="muted">Appen var inaktiv. Ingen tid har räknats.</div>}
            {m.needsFix || m.gpsLost ? <div className="muted">Väntar på GPS-position…</div> : <div className="muted">Tryck {m.elapsedS < 0.5 ? "STARTA" : "FORTSÄTT"} när du är redo. Efter paus är du skyddad mot smitta i 5 sekunder.</div>}
            <div className="muted">Appen måste vara öppen och i förgrunden för att GPS ska fungera.</div>
          </div>
        </div>
      )}

      {!finished && !m.paused && m.gpsLostLong && (
        <div className="overlay" style={{ background: "#0b0f14b3", alignItems: "center" }}>
          <div className="card bad"><b>GPS har saknats i över en minut.</b><div className="muted">Klockan och zombierna står stilla. Gå till öppen yta, eller avsluta matchen.</div>
            <button className="btn" onClick={() => setConfirmEnd(true)}>AVSLUTA</button></div>
        </div>
      )}

      {confirmEnd && !finished && (
        <div className="overlay">
          <div className="card">
            <b>Avsluta matchen?</b>
            <div className="muted">Matchen sparas som avbruten.</div>
            <div className="row">
              <button className="btn" onClick={() => setConfirmEnd(false)}>FORTSÄTT SPELA</button>
              <button className="btn primary" onClick={() => { setConfirmEnd(false); void session.abort(); }}>AVSLUTA</button>
            </div>
          </div>
        </div>
      )}

      {finished && (
        <div className="overlay">
          <div className="card">
            <h1 style={{ margin: 0 }}>{RESULT_LABEL[m.result ?? "incomplete"]?.toUpperCase()}</h1>
            <div className="stat"><span>Matchtid</span><b>{fmtTime(m.elapsedS)}</b></div>
            <div className="stat"><span>Uppmätt sträcka</span><b>{fmtKm(m.distanceM)}</b></div>
            {m.objectives && <div className="stat"><span>Mål</span><b>{m.objectives.index}/{m.objectives.total}</b></div>}
            {view.storageWarning && <div className="muted">Resultatet kunde inte sparas lokalt.</div>}
            <Link className="btn primary" href="/" onClick={() => session.reset()}>TILL START</Link>
            <Link className="btn" href="/history" onClick={() => session.reset()}>PREVIOUS GAMES</Link>
          </div>
        </div>
      )}
    </div>
  );
}
