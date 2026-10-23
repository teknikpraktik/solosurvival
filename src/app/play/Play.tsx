"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText } from "@/gps/provider/provider";
import { RESULT_LABEL, MODE_LABEL, fmtKm, fmtTime } from "../_client/format";
import { useSessionCtx, useSessionView } from "../_client/SessionProvider";
import { cuesEnabled, playCue, setCuesEnabled, speak, unlockAudio } from "../_client/cues";
import { APPROACH_COOLDOWN_S, TENSION_COOLDOWN_S, VIEW_RETURN_S, nextApproaching, nextClose, viewProfile } from "@/play/camera-view";
import { Modal } from "../_client/Modal";
import { Scare } from "../_client/Scare";
import { JumpScare } from "../_client/JumpScare";
import type { MapMarker } from "../_client/GameMap";

const fmtDist = (m: number): string => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

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
  // After the user has moved/zoomed the map, it returns to the player after VIEW_RETURN_S seconds without interaction.
  const returnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onUserMove = useCallback(() => {
    setFollow(false);
    if (returnTimer.current) clearTimeout(returnTimer.current);
    returnTimer.current = setTimeout(() => setFollow(true), VIEW_RETURN_S * 1000);
  }, []);
  useEffect(() => () => { if (returnTimer.current) clearTimeout(returnTimer.current); }, []);
  const [pauseDismissed, setPauseDismissed] = useState(false);
  const [gpsDismissed, setGpsDismissed] = useState(false);
  const [sound, setSound] = useState(true);
  const [scareDone, setScareDone] = useState(false);
  const [jump, setJump] = useState(false);
  const lastScare = useRef(0);
  // Preload the jump-scare photo so it appears instantly when it fires.
  useEffect(() => { const i = new Image(); i.src = "/img/jump.jpg"; }, []);
  // Random jump scare (planned by the session): show the image briefly; the scream comes from the cue system.
  useEffect(() => {
    const n = view?.scareNonce ?? 0;
    if (n > lastScare.current) { lastScare.current = n; setJump(true); }
  }, [view?.scareNonce]);
  useEffect(() => { setSound(cuesEnabled()); }, []);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);

  // Deep link / reload: try to restore a saved match.
  useEffect(() => {
    if (!session || tried) return;
    setTried(true);
    if (session.getView().match) { session.startLocating(); return; }
    void session.restoreActive().then((r) => {
      if (!r) router.replace("/");
      else if (!r.ok) setRestoreMsg(r.reason ?? "The match could not be restored.");
    });
  }, [session, tried, router]);

  const m = view?.match ?? null;
  const vp = viewProfile(m?.activity ?? "walk");
  // Close state: zombie within 200 m (Bike) / 100 m (on foot); back out beyond 260 / 130 m. Bike zooms the map in; both play an uneasy sound on entering (with a cooldown).
  const [viewClose, setViewClose] = useState(false);
  const lastTension = useRef(-Infinity);
  const nearestM = m && !m.paused && m.phase !== "finished" ? m.nearestZombieM : null;
  const wantClose = nextClose(viewClose, nearestM, vp);
  useEffect(() => {
    if (wantClose === viewClose) return;
    setViewClose(wantClose);
    const now = Date.now();
    if (wantClose && now - lastTension.current >= TENSION_COOLDOWN_S * 1000) { lastTension.current = now; playCue("tension"); }
  }, [wantClose, viewClose]);
  // "Zombies approaching": spoken once when the nearest zombie comes within 200 m, armed again after it has been beyond 260 m (and not more often than the cooldown).
  const [approaching, setApproaching] = useState(false);
  const lastApproach = useRef(-Infinity);
  const wantApproaching = nextApproaching(approaching, nearestM);
  useEffect(() => {
    if (wantApproaching === approaching) return;
    setApproaching(wantApproaching);
    const now = Date.now();
    if (wantApproaching && now - lastApproach.current >= APPROACH_COOLDOWN_S * 1000) {
      lastApproach.current = now;
      playCue("alert"); // vibration; "alert" makes no sound of its own
      speak("Zombies approaching");
    }
  }, [wantApproaching, approaching]);
  // Captured: spoken a moment after the scream starts, when the scare screen opens.
  const capturedNow = m?.phase === "finished" && m.result === "infected";
  useEffect(() => {
    if (!capturedNow) return;
    const t = setTimeout(() => speak("Captured"), 700);
    return () => clearTimeout(t);
  }, [capturedNow]);
  const live = session?.live ?? null;
  const markers = useMemo<MapMarker[]>(() => {
    const o = m?.proposal;
    if (!o || !m?.objectives) return [];
    return o.waypoints.filter((w) => w.kind !== "home").map((w, i) => ({
      id: w.id, label: w.kind === "destination" ? "B" : String(i + 1), lat: w.lat, lon: w.lon,
      tone: i < m.objectives!.index ? "done" : i === m.objectives!.index ? "next" : "todo",
    }));
  }, [m?.proposal, m?.objectives?.index]);
  // A TO B: any route counts, so only a faint straight line from A to B is drawn. Mission: no line at all.
  const route = useMemo(() => {
    const pr = m?.proposal;
    if (!pr) return [];
    if (m?.mode === "escape") {
      const b = pr.waypoints[0];
      return [{ points: [pr.geometry[0], { lat: b.lat, lon: b.lon }], selected: false, faint: true }];
    }
    return []; // Mission: no route is drawn, only the checkpoints (markers)
  }, [m?.proposal, m?.mode]);
  const zombies = useMemo(() => (m?.zombiesNear ?? []).map((z) => ({ id: z.id, edgeId: z.edgeId, distM: z.distM, speedMps: z.speedMps, chasing: z.state === "chase" || z.state === "intercept", sprinting: z.sprinting })), [m?.zombiesNear]);
  useEffect(() => { if (m && !m.paused) setPauseDismissed(false); }, [m?.paused]); // eslint-disable-line react-hooks/exhaustive-deps

  if (restoreMsg) {
    return (
      <main className="page">
        <div className="card bad">{restoreMsg}</div>
        <Link className="btn" href="/history">PREVIOUS GAMES</Link>
        <Link className="btn" href="/">HOME</Link>
      </main>
    );
  }
  if (!view || !m || !session) return <main className="center"><p className="hint">Loading…</p></main>;

  const finished = view.stage === "finished" || m.phase === "finished";
  // Captured: a short scary full-screen image (with the scream sound) before the result dialog.
  const scare = finished && m.result === "infected" && !scareDone;
  const home = m.objectives?.next;
  const dHome = home && view.position ? Math.round(live?.distanceTo(home) ?? 0) : null;
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
        viewAheadM={vp.aheadM}
        viewCloseAheadM={vp.closeAheadM}
        viewClose={viewClose && vp.autoZoom}
        onUserMove={onUserMove}
        onError={(w) => session.fieldLog?.renderProblem(Date.now(), w)}
      />
      <div className="hudbar">
        <div className="line">
          <span className="pill">{MODE_LABEL[m.mode]}</span>
          <span className="pill" aria-label="Time left">{fmtTime(remaining)}</span>
        </div>
        <div className="line">
          {m.objectives ? (
            <span className="pill">Goal {Math.min(m.objectives.index + 1, m.objectives.total)}/{m.objectives.total}{dHome !== null ? ` · ${dHome} m` : ""}{m.objectives.holdS > 0 ? ` · ${m.objectives.holdS.toFixed(0)}s` : ""}</span>
          ) : (
            <span className="pill">{m.extraction ? "Extraction open" : m.phase === "head_start" ? `Head start ${fmtTime(m.headStartLeftS)}` : "Survive"}</span>
          )}
        </div>
        {!finished && (
          <div className="line">
            <span className="pill" aria-label="Nearest zombie">🧟 {m.nearestZombieM === null ? "–" : fmtDist(m.nearestZombieM)}</span>
            {m.activity === "mtb" && <span className="pill" aria-label="Your speed">{view.speedMps === null ? "– km/h" : `${(view.speedMps * 3.6).toFixed(1)} km/h`}</span>}
          </div>
        )}
        {m.infection > 0 && <div className="infect" aria-label="Smittrisk"><div style={{ width: `${Math.min(100, (m.infection / 3) * 100)}%` }} /></div>}
      </div>

      {!finished && (
        <div className="controls">
          {m.paused ? (
            <button className="primary wide" disabled={!canResume} onClick={() => { unlockAudio(); if (ready) speak("Game on"); session.resume(); setFollow(true); }}>{ready ? "START" : "CONTINUE"}</button>
          ) : (
            <button className="wide" onClick={() => session.pause("manual")}>PAUSE</button>
          )}
          <button className="iconbtn" onClick={() => setFollow(true)} aria-label="Center on me">⌖</button>
          <button className="iconbtn compass" onClick={() => { setTrackUp((t) => !t); setFollow(true); }} aria-label={trackUp ? "Track Up (tap for North Up)" : "North Up (tap for Track Up)"} aria-pressed={trackUp}>
            <svg viewBox="0 0 26 26" style={{ transform: trackUp && view.heading != null ? `rotate(${-view.heading}deg)` : "none" }} aria-hidden="true">
              <path d="M13 2l5 11h-10z" fill="#ef4444" /><path d="M13 24l-5-11h10z" fill="#8b98a5" /><circle cx="13" cy="13" r="1.8" fill="#0b0f14" />
            </svg>
          </button>
          <button className="iconbtn" onClick={() => { const on = !sound; setSound(on); setCuesEnabled(on); }} aria-label={sound ? "Sound on (tap to mute)" : "Sound off (tap to unmute)"} aria-pressed={sound}>{sound ? "🔊" : "🔇"}</button>
          <button onClick={() => setConfirmEnd(true)}>QUIT</button>
        </div>
      )}

      {!finished && m.paused && !pauseDismissed && !confirmEnd && (
        <Modal
          title={ready ? "Ready to start" : "Paused"}
          onClose={() => setPauseDismissed(true)}
          actions={
            <>
              <button className="btn primary big" disabled={!canResume} onClick={() => { unlockAudio(); if (ready) speak("Game on"); session.resume(); setFollow(true); }}>{canResume ? (ready ? "START" : "CONTINUE") : "WAITING FOR LOCATION…"}</button>
              <button className="btn" onClick={() => setConfirmEnd(true)}>QUIT</button>
            </>
          }
        >
          {m.frozen && !ready && <div className="muted">The app was inactive. No time was counted.</div>}
          {!ready && <div className="muted">After a pause you are protected for 5 seconds.</div>}
          <div className="muted">The app must stay open and in the foreground for location to work.</div>
        </Modal>
      )}

      {!finished && !m.paused && m.gpsLostLong && !gpsDismissed && !confirmEnd && (
        <Modal
          title="Location lost"
          tone="bad"
          onClose={() => setGpsDismissed(true)}
          actions={<button className="btn" onClick={() => setConfirmEnd(true)}>QUIT</button>}
        >
          <div className="muted">Your location has been lost for over a minute. The clock and the zombies stand still. Move to open sky and wait.</div>
        </Modal>
      )}

      {confirmEnd && !finished && (
        <Modal
          title="Quit the match?"
          onClose={() => setConfirmEnd(false)}
          actions={
            <>
              <button className="btn primary" onClick={() => { setConfirmEnd(false); void session.abort(); }}>QUIT</button>
              <button className="btn" onClick={() => setConfirmEnd(false)}>KEEP PLAYING</button>
            </>
          }
        >
          <div className="muted">The match is saved as aborted.</div>
        </Modal>
      )}

      {jump && !finished && <JumpScare onDone={() => setJump(false)} />}
      {scare && <Scare onDone={() => setScareDone(true)} />}
      {/* Match over is a mandatory decision: no X, the player chooses where to go. */}
      {finished && !scare && (
        <Modal
          title={m.result === "infected" ? "GAME OVER" : RESULT_LABEL[m.result ?? "incomplete"]?.toUpperCase() ?? "MATCH OVER"}
          actions={
            <>
              <Link className="btn primary" href="/" onClick={() => session.reset()}>HOME</Link>
              {m.result !== "aborted" && <Link className="btn" href="/history" onClick={() => session.reset()}>PREVIOUS GAMES</Link>}
            </>
          }
        >
          {m.result === "infected" && <div className="stat"><span>Result</span><b>Captured</b></div>}
          <div className="stat"><span>Match time</span><b>{fmtTime(m.elapsedS)}</b></div>
          <div className="stat"><span>Distance moved</span><b>{fmtKm(m.distanceM)}</b></div>
          {m.objectives && <div className="stat"><span>Goals</span><b>{m.objectives.index}/{m.objectives.total}</b></div>}
          {view.storageWarning && <div className="muted">The result could not be saved locally.</div>}
        </Modal>
      )}
    </div>
  );
}
