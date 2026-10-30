"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtKm, fmtTime, objectiveLabel } from "@/app/_client/format";
import { Modal } from "@/app/_client/Modal";
import type { MapMarker } from "@/app/_client/GameMap";
import { APPROACH_COOLDOWN_S, nextApproaching, nextClose, nextGoalClose, viewProfile } from "@/play/camera-view";
import { COUNTDOWN_START_M } from "@/play/countdown";
import { DIFFICULTY_LABEL, MODE_LABEL, RESULT_LABEL } from "../../client/text";
import { useSessionCtx, useSessionView } from "../../client/SessionProvider";
import { cuesEnabled, playCue, setCuesEnabled, speak, unlockAudio } from "../../client/sounds";
import { enemyMarker } from "../../client/enemies";
import { Critters } from "../../client/Critters";
import { MINI_MAP_STYLE } from "../../client/mapStyle";

const fmtDist = (m: number): string => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

const GameMap = dynamic(() => import("@/app/_client/GameMap"), { ssr: false });

/**
 * Spelskärmen: samma karta, kartföljning, HUD, paus och avslut som OUTBREAK (samma PlaySession), men utan skrämmor, skrik,
 * spänningsljud, uppläst nedräkning och "Run!". Fienderna ritas som fyra blandade söta typer.
 */
export default function Play() {
  const ctx = useSessionCtx();
  const router = useRouter();
  const session = ctx?.session;
  const view = useSessionView(session);
  const [auto, setAuto] = useState(true);
  const [tried, setTried] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const onUserMove = useCallback(() => setAuto(false), []);
  const [pauseDismissed, setPauseDismissed] = useState(false);
  const [gpsDismissed, setGpsDismissed] = useState(false);
  const [sound, setSound] = useState(true);
  useEffect(() => { setSound(cuesEnabled()); }, []);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!session || tried) return;
    setTried(true);
    if (session.getView().match) { session.startLocating(); return; }
    void session.restoreActive().then((r) => {
      if (!r) router.replace("/");
      else if (!r.ok) setRestoreMsg(r.reason ?? "The game could not be restored.");
    });
  }, [session, tried, router]);

  const m = view?.match ?? null;
  const vp = viewProfile("walk");
  // Auto zoom closes in when a critter or the next goal is near (no sound).
  const [viewClose, setViewClose] = useState(false);
  const nearestM = m && !m.paused && m.phase !== "finished" ? m.nearestZombieM : null;
  const wantClose = nextClose(viewClose, nearestM, vp);
  useEffect(() => { if (wantClose !== viewClose) setViewClose(wantClose); }, [wantClose, viewClose]);
  const [goalClose, setGoalClose] = useState(false);
  const goal = m && !m.paused && m.phase !== "finished" ? (m.objectives?.next ?? m.extraction) : null;
  const goalM = goal ? (session?.live?.distanceTo(goal) ?? null) : null;
  const wantGoalClose = nextGoalClose(goalClose, goalM, vp);
  useEffect(() => { if (wantGoalClose !== goalClose) setGoalClose(wantGoalClose); }, [wantGoalClose, goalClose]);
  // A friendly "Watch out!" once when the nearest critter comes within 200 m (same rule and cooldown as OUTBREAK's warning).
  const [approaching, setApproaching] = useState(false);
  const lastApproach = useRef(-Infinity);
  const wantApproaching = nextApproaching(approaching, nearestM);
  useEffect(() => {
    if (wantApproaching === approaching) return;
    setApproaching(wantApproaching);
    const now = Date.now();
    if (wantApproaching && now - lastApproach.current >= APPROACH_COOLDOWN_S * 1000) {
      lastApproach.current = now;
      playCue("alert"); // vibration only
      speak("Watch out!");
    }
  }, [wantApproaching, approaching]);
  const critterClose = nearestM !== null && nearestM <= COUNTDOWN_START_M;
  const result = m?.phase === "finished" ? m.result : null;
  useEffect(() => {
    if (result === "infected") speak("Caught! Try again!");
    else if (result === "survived") speak("You made it!");
  }, [result]);
  const live = session?.live ?? null;
  const markers = useMemo<MapMarker[]>(() => {
    const o = m?.proposal;
    if (!o || !m?.objectives) return [];
    return o.waypoints.map((w, i): MapMarker => ({
      id: w.id, label: w.kind === "destination" ? "B" : w.kind === "home" ? "" : String(i + 1), lat: w.lat, lon: w.lon,
      icon: w.kind === "home" ? "home" : undefined,
      tone: i < m.objectives!.index ? "done" : i === m.objectives!.index ? "next" : "todo",
    }));
  }, [m?.proposal, m?.objectives?.index]);
  const route = useMemo(() => {
    const pr = m?.proposal;
    if (!pr || m?.mode !== "escape") return [];
    const b = pr.waypoints[0];
    return [{ points: [pr.geometry[0], { lat: b.lat, lon: b.lon }], selected: false, faint: true }];
  }, [m?.proposal, m?.mode]);
  const zombies = useMemo(() => (m?.zombiesNear ?? []).map((z) => ({ id: z.id, edgeId: z.edgeId, distM: z.distM, speedMps: z.speedMps, chasing: z.state === "chase" || z.state === "intercept", sprinting: z.sprinting })), [m?.zombiesNear]);
  const matchId = m?.id ?? "";
  const enemySvg = useMemo(() => enemyMarker(matchId), [matchId]);
  useEffect(() => { if (m && !m.paused) setPauseDismissed(false); }, [m?.paused]); // eslint-disable-line react-hooks/exhaustive-deps

  if (restoreMsg) {
    return (
      <main className="page">
        <div className="card bad">{restoreMsg}</div>
        <Link className="btn" href="/history">MY GAMES</Link>
        <Link className="btn" href="/">HOME</Link>
      </main>
    );
  }
  if (!view || !m || !session) return <main className="center"><p className="hint">Loading…</p></main>;

  const finished = view.stage === "finished" || m.phase === "finished";
  const home = m.objectives?.next;
  const dHome = home && view.position ? Math.round(live?.distanceTo(home) ?? 0) : null;
  const dExtraction = m.extraction ? (live?.distanceTo(m.extraction) ?? null) : null;
  const remaining = Math.max(0, m.limitS - m.elapsedS);
  const ready = m.elapsedS < 0.5;
  const canResume = !m.needsFix && !m.gpsLost;
  const go = () => { unlockAudio(); void session.enableCompass(); if (ready) speak("Game on"); session.resume(); setAuto(true); };

  return (
    <div className="map-shell">
      <GameMap
        key={matchId}
        mapStyle={MINI_MAP_STYLE}
        enemySvg={enemySvg}
        graph={live?.g}
        routes={route}
        markers={markers}
        player={view.position}
        accuracyM={view.accuracyM}
        zombies={zombies}
        frozen={m.paused || finished}
        heading={view.heading}
        getHeading={() => session.liveHeading()}
        trackUp={auto}
        zoom={16}
        extraction={m.extraction}
        pointTo={!finished ? (m.objectives?.next ?? m.extraction) : null}
        scale
        follow={auto}
        viewAheadM={vp.aheadM}
        viewCloseAheadM={vp.closeAheadM}
        viewClose={viewClose || goalClose}
        viewPlayerY={vp.playerY}
        onUserMove={onUserMove}
        onError={(w) => session.fieldLog?.renderProblem(Date.now(), w)}
      />
      <div className="hudbar">
        <div className="line">
          <span className="pill mode" aria-label="Game and level">{MODE_LABEL[m.mode]} · {DIFFICULTY_LABEL[m.difficulty].toUpperCase()}</span>
          <span className="pill" aria-label="Time left">{fmtTime(remaining)}</span>
        </div>
        <div className="line">
          {m.objectives ? (
            <span className="pill">{objectiveLabel(m.objectives.progress)}{dHome !== null ? ` · ${dHome} m` : ""}{m.objectives.holdS > 0 ? ` · ${m.objectives.holdS.toFixed(0)}s` : ""}</span>
          ) : (
            <span className="pill">{m.extraction ? `Helicopter is here${dExtraction !== null ? ` · ${fmtDist(dExtraction)}` : ""}` : m.phase === "head_start" ? `Head start ${fmtTime(m.headStartLeftS)}` : "Stay away from the critters"}</span>
          )}
        </div>
        {!finished && (
          <div className="line">
            <span className={`pill${critterClose ? " zclose" : ""}`} aria-label="Nearest critter">👀 {m.nearestZombieM === null ? "–" : fmtDist(m.nearestZombieM)}</span>
          </div>
        )}
        {m.infection > 0 && <div className="infect" aria-label="Critter is very close"><div style={{ width: `${Math.min(100, (m.infection / 3) * 100)}%` }} /></div>}
      </div>

      {!finished && (
        <div className="controls">
          {m.paused ? (
            <button className="primary wide" disabled={!canResume} onClick={go}>{!canResume ? "WAITING FOR LOCATION…" : ready ? "START" : "CONTINUE"}</button>
          ) : (
            <button className="wide" onClick={() => session.pause("manual")}>PAUSE</button>
          )}
          <button className="autobtn" onClick={() => { if (!auto) void session.enableCompass(); setAuto((a) => !a); }} aria-pressed={auto} aria-label={auto ? "AUTO on: the map follows you (tap to move the map yourself)" : "AUTO off: you move the map (tap to follow again)"}>AUTO</button>
          <button className="iconbtn" onClick={() => { const on = !sound; setSound(on); setCuesEnabled(on); }} aria-label={sound ? "Sound on (tap to mute)" : "Sound off (tap to unmute)"} aria-pressed={sound}>{sound ? "🔊" : "🔇"}</button>
          <button onClick={() => setConfirmEnd(true)}>STOP</button>
        </div>
      )}

      {!finished && m.paused && !pauseDismissed && !confirmEnd && (
        <Modal
          title={ready ? "Ready to start" : "Paused"}
          onClose={() => setPauseDismissed(true)}
          actions={
            <>
              <button className="btn primary big" disabled={!canResume} onClick={go}>{canResume ? (ready ? "START" : "CONTINUE") : "WAITING FOR LOCATION…"}</button>
              <button className="btn" onClick={() => setConfirmEnd(true)}>STOP</button>
            </>
          }
        >
          {ready && <div className="muted">Look around first. Watch out for traffic, and stay in the area a grown-up said is OK.</div>}
          {m.frozen && !ready && <div className="muted">The app was asleep. No time was counted.</div>}
          {!ready && <div className="muted">After a pause the critters cannot catch you for 5 seconds.</div>}
          <div className="muted">Keep the app open on the screen so it knows where you are.</div>
        </Modal>
      )}

      {!finished && !m.paused && m.gpsLostLong && !gpsDismissed && !confirmEnd && (
        <Modal
          title="Location lost"
          tone="bad"
          onClose={() => setGpsDismissed(true)}
          actions={<button className="btn" onClick={() => setConfirmEnd(true)}>STOP</button>}
        >
          <div className="muted">The phone has not known where you are for over a minute. The clock and the critters are waiting. Go where you can see the sky and wait.</div>
        </Modal>
      )}

      {confirmEnd && !finished && (
        <Modal
          title="Stop the game?"
          onClose={() => setConfirmEnd(false)}
          actions={
            <>
              <button className="btn primary" onClick={() => { setConfirmEnd(false); void session.abort(); }}>STOP</button>
              <button className="btn" onClick={() => setConfirmEnd(false)}>KEEP PLAYING</button>
            </>
          }
        >
          <div className="muted">Stopping is always OK. The game is saved as stopped.</div>
        </Modal>
      )}

      {finished && (
        <Modal
          title={m.result === "infected" ? "CAUGHT!" : RESULT_LABEL[m.result ?? "incomplete"]?.toUpperCase() ?? "GAME OVER"}
          actions={
            <>
              <Link className="btn primary" href="/" onClick={() => session.reset()}>HOME</Link>
              {m.result !== "aborted" && <Link className="btn" href="/history" onClick={() => session.reset()}>MY GAMES</Link>}
            </>
          }
        >
          <Critters size={52} className="critters result" />
          {m.result === "infected" && <div className="muted">A critter caught you this time. Have a rest and try again!</div>}
          {m.result === "survived" && <div className="muted">Great job! You got away from all the critters.</div>}
          <div className="stat"><span>Time played</span><b>{fmtTime(m.elapsedS)}</b></div>
          <div className="stat"><span>Distance walked</span><b>{fmtKm(m.distanceM)}</b></div>
          {m.objectives && m.mode === "mission" && <div className="stat"><span>Checkpoints</span><b>{m.objectives.progress.primaryReached}/{m.objectives.progress.primaryTotal}</b></div>}
          {m.objectives && m.objectives.progress.hasHome && <div className="stat"><span>Back home</span><b>{m.objectives.progress.homeReached ? "Yes" : "No"}</b></div>}
          {m.objectives && m.mode === "escape" && <div className="stat"><span>Goal B</span><b>{m.objectives.progress.primaryReached >= m.objectives.progress.primaryTotal ? "Reached" : "Not reached"}</b></div>}
          {view.storageWarning && <div className="muted">The result could not be saved on this phone.</div>}
        </Modal>
      )}
    </div>
  );
}
