"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DIFFICULTY_LABEL, MODE_LABEL, fmtKm, fmtTime, objectiveLabel } from "../_client/format";
import { useSessionCtx, useSessionView } from "../_client/SessionProvider";
import { cuesEnabled, playCue, setCuesEnabled, speak, unlockAudio, type CountdownLine } from "../_client/cues";
import { COUNTDOWN_START_M, nextCountdown, type CountdownStep } from "@/play/countdown";
import { APPROACH_COOLDOWN_S, nextApproaching, nextClose, nextGoalClose, viewProfile } from "@/play/camera-view";
import { matchAudio } from "../_client/audio";
import { Modal } from "../_client/Modal";
import { BIKE_SVG, HELI_SVG, SOUND_OFF_SVG, SOUND_ON_SVG, WALK_SVG } from "../_client/symbols";
import { t } from "../_client/strings";
import { personalRecord } from "@/play/recap";
import { extractionOpensAtS } from "@/config/game-rules";
import { MatchStorage } from "@/play/storage";
import { Scare } from "../_client/Scare";
import { JumpScare } from "../_client/JumpScare";
import { HeliCard } from "../_client/HeliCard";
import { preloadMatchPictures, resultPicture, type ResultPicture } from "../_client/matchImages";
import type { MapMarker } from "../_client/GameMap";

const fmtDist = (m: number): string => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

const GameMap = dynamic(() => import("../_client/GameMap"), { ssr: false });

/**
 * The picture behind the result: the subject is kept in view above the dialog (which sits low). A missing file falls back to the given
 * file, or to the dark background alone; the result itself never waits for it.
 */
function ResultBackdrop({ pic }: { pic: ResultPicture }) {
  const [src, setSrc] = useState<string | null>(pic.src);
  useEffect(() => { setSrc(pic.src); }, [pic.src]);
  return (
    <div className="resultbg" data-pic={pic.key} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt="" style={{ objectPosition: pic.position }} onError={() => setSrc((cur) => (cur === pic.src && pic.fallback ? pic.fallback : null))} />}
    </div>
  );
}

export default function Play() {
  const ctx = useSessionCtx();
  const router = useRouter();
  const session = ctx?.session;
  const view = useSessionView(session);
  // Two map modes. AUTO (every match starts in it): the map follows you, Track Up, auto zoom. Off: the map is yours to pan and zoom, the game
  // never moves it. Touching the map turns AUTO off at once; tapping AUTO turns it back on.
  const [auto, setAuto] = useState(true);
  const [tried, setTried] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  // QUIT confirmed: the match is being closed; nothing of it (result, scare, cards) is shown on the way to the start page.
  const [quitting, setQuitting] = useState(false);
  const onUserMove = useCallback(() => setAuto(false), []);
  const [pauseDismissed, setPauseDismissed] = useState(false);
  const [gpsDismissed, setGpsDismissed] = useState(false);
  const [sound, setSound] = useState(true);
  // Back from SHOW MATCH: the scare (and the spoken "Captured") was already shown for this match.
  const [scareDone, setScareDone] = useState(() => !!ctx?.session?.scareShown);
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
  // The pictures this match may show (helicopter cards, its possible endings) start loading now, in the background.
  const matchMode = view?.match?.mode;
  useEffect(() => { if (matchMode) preloadMatchPictures(matchMode); }, [matchMode]);
  // Helicopter approaching: a vibration as the card appears (the existing "alert" cue; landing already has the extraction sound).
  const heliNotice = view?.heliNotice ?? null;
  const lastHeli = useRef<string | null>(null);
  useEffect(() => {
    if (heliNotice === "approaching" && lastHeli.current !== "approaching") playCue("alert");
    lastHeli.current = heliNotice;
  }, [heliNotice]);
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
  // Close state: zombie within 200 m (Bike) / 100 m (on foot); back out beyond 260 / 130 m. Auto zoom closes in (the close-zombie sound
  // follows the same distances, in the soundscape).
  const [viewClose, setViewClose] = useState(false);
  const nearestM = m && !m.paused && m.phase !== "finished" ? m.nearestZombieM : null;
  const wantClose = nextClose(viewClose, nearestM, vp);
  useEffect(() => { if (wantClose !== viewClose) setViewClose(wantClose); }, [wantClose, viewClose]);
  // The match's soundscape (threat pulses, close zombie, helicopter) follows what the HUD shows. Leaving the game screen ends it.
  const finishedNow = !m || view?.stage === "finished" || m.phase === "finished";
  useEffect(() => {
    matchAudio().update(m ? { id: m.id, mode: m.mode, activity: m.activity, phase: m.phase, paused: m.paused, finished: finishedNow, nearestM: m.nearestZombieM } : null);
  }, [m?.id, m?.mode, m?.activity, m?.phase, m?.paused, finishedNow, m?.nearestZombieM]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => matchAudio().end(), []);
  // Goal near: auto zoom also closes in when the next checkpoint (or home, B, extraction) is near, and widens again once it is taken. No sound.
  const [goalClose, setGoalClose] = useState(false);
  const goal = m && !m.paused && m.phase !== "finished" ? (m.objectives?.next ?? m.extraction) : null;
  const goalM = goal ? (session?.live?.distanceTo(goal) ?? null) : null;
  const wantGoalClose = nextGoalClose(goalClose, goalM, vp);
  useEffect(() => { if (wantGoalClose !== goalClose) setGoalClose(wantGoalClose); }, [wantGoalClose, goalClose]);
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
  // Countdown: the distance to the nearest zombie is spoken at 100, 50, 40, 30, 20 and 10 m as it closes in (eyes on the road, not the screen).
  const countdown = useRef<CountdownStep | null>(null);
  useEffect(() => {
    const r = nextCountdown(countdown.current, nearestM);
    countdown.current = r.last;
    if (r.say !== null) speak(String(r.say) as CountdownLine);
  }, [nearestM]);
  const zombieClose = nearestM !== null && nearestM <= COUNTDOWN_START_M;
  // Caution (amber) before danger (red): a zombie within twice the countdown distance.
  const zombieWarn = nearestM !== null && nearestM <= 2 * COUNTDOWN_START_M;
  // Captured: spoken a moment after the scream starts, when the scare screen opens.
  const capturedNow = m?.phase === "finished" && m.result === "infected";
  useEffect(() => {
    if (!capturedNow || session?.scareShown) return;
    const t = setTimeout(() => speak("Captured"), 700);
    return () => clearTimeout(t);
  }, [capturedNow]);
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
  // A TO B: any route counts, so only a faint straight line from A to B is drawn. Mission: a thin goal-coloured line joins
  // start → 1 → 2 → … → home, a hint of the direction of the next checkpoint (straight lines, not a route to follow).
  const route = useMemo(() => {
    const pr = m?.proposal;
    if (!pr) return [];
    if (m?.mode === "escape") {
      const b = pr.waypoints[0];
      return [{ points: [pr.geometry[0], { lat: b.lat, lon: b.lon }], selected: false, faint: true }];
    }
    if (m?.mode === "mission" && pr.waypoints.length) return [{ points: [pr.geometry[0], ...pr.waypoints.map((w) => ({ lat: w.lat, lon: w.lon }))], selected: false, hint: true }];
    return [];
  }, [m?.proposal, m?.mode]);
  const zombies = useMemo(() => (m?.zombiesNear ?? []).map((z) => ({ id: z.id, edgeId: z.edgeId, distM: z.distM, speedMps: z.speedMps, chasing: z.state === "chase" || z.state === "intercept", sprinting: z.sprinting })), [m?.zombiesNear]);
  useEffect(() => { if (m && !m.paused) setPauseDismissed(false); }, [m?.paused]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new match started with START GAME begins by itself as soon as the location is fresh: no "Ready to start" dialog in between.
  // (Audio and the compass were unlocked by that tap on the previous page; a restored match still asks to CONTINUE.)
  const autoReady = !!m && m.paused && m.elapsedS < 0.5 && !m.needsFix && !m.gpsLost && !!session?.autoStartPending;
  useEffect(() => {
    if (!autoReady || !session?.takeAutoStart()) return;
    unlockAudio();
    session.resume(); // the opening line (radio voice, or "Game on" in Checkpoints) follows the session's match_started
    setAuto(true);
  }, [autoReady]); // eslint-disable-line react-hooks/exhaustive-deps
  // Personal record, once the finished match is in the history.
  const [record, setRecord] = useState<string | null>(null);
  const finishedRec = session?.history ?? null;
  useEffect(() => {
    if (!finishedRec || !ctx?.db || finishedRec.result === "active") { setRecord(null); return; }
    let on = true;
    void new MatchStorage(ctx.db).listHistory().then((all) => { if (on) setRecord(personalRecord(finishedRec, all)); }, () => undefined);
    return () => { on = false; };
  }, [finishedRec, ctx?.db]);

  if (restoreMsg) {
    return (
      <main className="page">
        <div className="card bad">{restoreMsg}</div>
        <Link className="btn" href="/history">PREVIOUS GAMES</Link>
        <Link className="btn" href="/">HOME</Link>
      </main>
    );
  }
  if (quitting) return <main className="center" aria-busy="true" />;
  if (!view || !m || !session) return <main className="center"><p className="hint">Loading…</p></main>;

  const finished = view.stage === "finished" || m.phase === "finished";
  const savedHistory = session.history;
  // Captured: a short scary full-screen image (with the scream sound) before the result dialog.
  const scare = finished && m.result === "infected" && !scareDone;
  const home = m.objectives?.next;
  const dHome = home && view.position ? Math.round(live?.distanceTo(home) ?? 0) : null;
  const dExtraction = m.extraction ? (live?.distanceTo(m.extraction) ?? null) : null;
  const remaining = Math.max(0, m.limitS - m.elapsedS);
  const ready = m.elapsedS < 0.5;
  const canResume = !m.needsFix && !m.gpsLost;
  // The picture behind the result, chosen from how the match ended and its mode.
  const resultPic = finished && !scare ? resultPicture(m.result, m.mode) : null;
  const opensInS = Math.max(0, extractionOpensAtS(m.limitS) - m.elapsedS);

  return (
    <div className={`map-shell${m.activity === "mtb" ? " bike" : ""}${resultPic ? " resultshow" : ""}`}>
      <GameMap
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
        homeStepsBack
        zombieEdgeDots={!finished}
        scale
        follow={auto}
        viewAheadM={vp.aheadM}
        viewCloseAheadM={vp.closeAheadM}
        viewCloseSideM={vp.closeSideM}
        viewClose={viewClose || goalClose}
        viewPlayerY={vp.playerY}
        onUserMove={onUserMove}
        onError={(w) => session.fieldLog?.renderProblem(Date.now(), w)}
      />
      <div className="hudbar">
        <div className="line">
          <span className="modegroup">
            <span className="pill mode" aria-label="Mode and difficulty"><span>{MODE_LABEL[m.mode]}</span> <span>· {DIFFICULTY_LABEL[m.difficulty].toUpperCase()}</span></span>
            {/* On a bike the bike sits with the speed/distance/time group instead (below); a finished match shows it here. */}
            {finished && <span className="pill activity" role="img" aria-label={m.activity === "mtb" ? "Bike" : "On foot"} dangerouslySetInnerHTML={{ __html: m.activity === "mtb" ? BIKE_SVG : WALK_SVG }} />}
          </span>
          <span className="pill timeleft" aria-label={`Time left ${fmtTime(remaining)}`}><span className="tl" aria-hidden="true">TIME LEFT</span><span aria-hidden="true">{fmtTime(remaining)}</span></span>
        </div>
        {/* Goal and nearest zombie share a row: the top of the map is what the player is heading for, so the HUD covers as little of it as it can. */}
        <div className="line">
          {m.objectives ? (
            <span className="pill goal">{objectiveLabel(m.objectives.progress)}{dHome !== null ? ` · ${dHome} m` : ""}{m.objectives.holdS > 0 ? ` · ${m.objectives.holdS.toFixed(0)}s` : ""}</span>
          ) : (
            m.extraction || m.phase === "head_start" ? (
              <span className="pill goal">{m.extraction ? `Extraction open${dExtraction !== null ? ` · ${fmtDist(dExtraction)}` : ""}` : `Head start ${fmtTime(m.headStartLeftS)}`}</span>
            ) : (
              // Countdown to extraction: a helicopter and the time, no words.
              <span className="pill goal heli" aria-label={`Extraction in ${fmtTime(Math.max(0, extractionOpensAtS(m.limitS) - m.elapsedS))}`}>
                <span className="heliicon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: HELI_SVG }} />
                <span aria-hidden="true">{fmtTime(Math.max(0, extractionOpensAtS(m.limitS) - m.elapsedS))}</span>
              </span>
            )
          )}
          {!finished && <span className={`pill zpill${zombieClose ? " zclose" : zombieWarn ? " zwarn" : ""}`} aria-label="Nearest zombie">💀 {m.nearestZombieM === null ? "–" : fmtDist(m.nearestZombieM)}</span>}
        </div>
        {/* Your trip, on the left: the activity, (Bike) speed, the distance actually moved this match (the game's own filtered track, not
            the straight line from the start) and the game clock since the start (it stands still while paused, like the time left). */}
        {!finished && (
          <div className="line start">
            <span className="pill tripstats">
              <span className="tripicon" role="img" aria-label={m.activity === "mtb" ? "Bike" : "On foot"} dangerouslySetInnerHTML={{ __html: m.activity === "mtb" ? BIKE_SVG : WALK_SVG }} />
              {m.activity === "mtb" && <span className="cell" aria-label="Your speed"><span className="tl" aria-hidden="true">KM/H</span><span aria-hidden="true">{view.speedMps === null ? "–" : (view.speedMps * 3.6).toFixed(1)}</span></span>}
              <span className="cell" aria-label={`Distance ${fmtKm(m.distanceM)}`}><span className="tl" aria-hidden="true">KM</span><span aria-hidden="true">{(m.distanceM / 1000).toFixed(m.distanceM < 10_000 ? 2 : 1)}</span></span>
              <span className="cell" aria-label={`Elapsed ${fmtTime(m.elapsedS)}`}><span className="tl" aria-hidden="true">TIME</span><span aria-hidden="true">{fmtTime(m.elapsedS)}</span></span>
            </span>
          </div>
        )}
        {!finished && !m.paused && m.offNetwork?.active && (
          <div className="line"><span className="pill warn" role="status" aria-live="polite">{m.offNetwork.exposed ? "Off the road · zombies can reach you. Return to a road!" : `Off the road network · ${m.offNetwork.budgetLeftS} s until zombies find you`}</span></div>
        )}
        {m.infection > 0 && <div className="infect" aria-label="Smittrisk"><div style={{ width: `${Math.min(100, (m.infection / 3) * 100)}%` }} /></div>}
      </div>

      {!finished && (
        <div className="controls">
          {m.paused ? (
            <button className="primary wide" disabled={!canResume} onClick={() => { unlockAudio(); void session.enableCompass(); session.resume(); setAuto(true); }}>{!canResume ? "WAITING FOR LOCATION…" : ready ? "START" : "CONTINUE"}</button>
          ) : (
            <button className="wide" onClick={() => session.pause("manual")}>PAUSE</button>
          )}
          <button className="autobtn" onClick={() => { if (!auto) void session.enableCompass(); setAuto((a) => !a); }} aria-pressed={auto} aria-label={auto ? "AUTO on: the map follows you (tap to move the map yourself)" : "AUTO off: you move the map (tap to follow again)"}>AUTO</button>
          {/* Sound on/off for every game sound and spoken line (same player, same stored choice). Turning it on is a tap, so audio is unlocked here as iOS requires. */}
          <button className="iconbtn" onClick={() => { const on = !sound; setSound(on); setCuesEnabled(on); if (on) unlockAudio(); }} aria-label={sound ? t().hud.soundOn : t().hud.soundOff} aria-pressed={sound} dangerouslySetInnerHTML={{ __html: sound ? SOUND_ON_SVG : SOUND_OFF_SVG }} />
          <button className="quit" onClick={() => setConfirmEnd(true)}>QUIT</button>
        </div>
      )}

      {!finished && m.paused && !pauseDismissed && !confirmEnd && !(ready && session.autoStartPending) && (
        <Modal
          title={ready ? "Ready to start" : "Paused"}
          onClose={() => setPauseDismissed(true)}
          actions={
            <>
              <button className="btn primary big" disabled={!canResume} onClick={() => { unlockAudio(); void session.enableCompass(); session.resume(); setAuto(true); }}>{canResume ? (ready ? "START" : "CONTINUE") : "WAITING FOR LOCATION…"}</button>
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
          actions={
            <>
              <button className="btn primary" onClick={() => {
                // Straight to the start page: no result, no scare, no second question. Sounds and timers stop before the session resets.
                setConfirmEnd(false);
                setQuitting(true);
                matchAudio().end();
                void session.quit().finally(() => router.replace("/"));
              }}>QUIT</button>
              <button className="btn" onClick={() => setConfirmEnd(false)}>KEEP PLAYING</button>
            </>
          }
        />
      )}

      {!finished && heliNotice && (
        <HeliCard
          key={heliNotice}
          kind={heliNotice}
          title={heliNotice === "landed" ? t().heli.landed : t().heli.approaching}
          sub={heliNotice === "landed" ? t().heli.landedSub(dExtraction !== null ? fmtDist(dExtraction) : null) : t().heli.approachingSub(fmtTime(opensInS))}
        />
      )}
      {jump && !finished && <JumpScare onDone={() => setJump(false)} />}
      {scare && <Scare onDone={() => { session.scareShown = true; setScareDone(true); }} />}
      {/* The ending's picture behind the result dialog (captured: after the scare, the same picture, still). */}
      {resultPic && <ResultBackdrop pic={resultPic} />}
      {/* Match over is a mandatory decision: no X, the player chooses where to go. */}
      {finished && !scare && (() => {
        const R = t().result;
        const res = m.result ?? "incomplete";
        const won = res === "survived";
        const p = m.objectives?.progress;
        const title = won ? R.title[m.mode] : res === "infected" ? R.title.captured : res === "failed" ? R.title.failed : res === "aborted" ? R.title.aborted : R.title.incomplete;
        const tone = won ? "won" : res === "infected" ? "lost" : res === "failed" ? "late" : "neutral";
        // One sentence that says what happened, with the mode's own result in it (it used to come last, after all the numbers).
        const line = res === "aborted" ? ""
          : won ? (m.mode === "mission" ? R.missionDone(p?.primaryTotal ?? 0, fmtTime(m.elapsedS)) : m.mode === "escape" ? R.escapeDone(fmtTime(m.elapsedS)) : R.survivalDone(fmtTime(Math.max(0, m.limitS - m.elapsedS))))
          : res === "infected" ? (m.mode === "mission" && p ? R.capturedProgress(p.primaryReached, p.primaryTotal) : "") // the title already says CAPTURED
          : res === "failed" ? (m.mode === "mission" && p ? R.failedMission(p.primaryReached, p.primaryTotal, p.homeReached) : m.mode === "escape" ? R.failedEscape : R.failedSurvival)
          : "";
        const st = m.stats;
        const avg = st && st.movingS >= 30 ? `${((m.distanceM / st.movingS) * 3.6).toFixed(1)} km/h` : "–";
        const highlights = st && res !== "aborted" ? [
          // After a capture the closest zombie is the one that caught you: nothing to tell.
          res !== "infected" && st.closestM !== null && st.closestAtS !== null ? R.closest(st.closestM, fmtTime(st.closestAtS)) : null,
          st.nearMisses > 0 ? R.closeCalls(st.nearMisses) : null,
          m.activity === "mtb" && st.passThroughs > 0 ? R.riddenThrough(st.passThroughs) : null,
        ].filter((x): x is string => !!x) : [];
        const canShow = res !== "aborted" && !!savedHistory && !!ctx?.db;
        return (
          <Modal
            title={title}
            actions={res === "aborted" ? (
              <>
                <Link className="btn primary cta" href="/" onClick={() => session.reset()}>{R.home.toUpperCase()}</Link>
                <button className="btn" aria-label={R.playAgainLabel} onClick={() => { void session.enableCompass(); session.playAgain(); router.push("/new"); }}>{R.playAgain}</button>
              </>
            ) : (
              <>
                {canShow
                  ? <Link className="btn primary cta" href={`/recap?id=${encodeURIComponent(m.id)}&from=play`}>{R.showMatch}</Link>
                  : null}
                <button className={canShow ? "btn" : "btn primary cta"} aria-label={R.playAgainLabel} onClick={() => { void session.enableCompass(); session.playAgain(); router.push("/new"); }}>{R.playAgain}</button>
                <div className="resultlinks">
                  <Link className="link" href="/" onClick={() => session.reset()}>{R.home}</Link>
                  <Link className="link" href="/history" onClick={() => session.reset()}>{R.previousGames}</Link>
                </div>
              </>
            )}
          >
            {line && <div className={`outcome ${tone}`} role="status">
              <span className="outcomeicon" aria-hidden="true">{tone === "won" ? "✓" : tone === "lost" ? "✕" : tone === "late" ? "⏱" : "■"}</span>
              <p>{line}</p>
            </div>}
            {record && <div className="recordline">★ {record}</div>}
            {res !== "aborted" && (
              <dl className="pvstats statcells">
                <div><dt>{R.time}</dt><dd>{fmtTime(m.elapsedS)}</dd></div>
                <div><dt>{R.distance}</dt><dd>{fmtKm(m.distanceM)}</dd></div>
                <div><dt>{R.avgSpeed}</dt><dd>{avg}</dd></div>
              </dl>
            )}
            {highlights.length > 0 && <ul className="highlights">{highlights.map((h) => <li key={h}>{h}</li>)}</ul>}
            {view.storageWarning && <div className="muted">{R.notSaved}</div>}
          </Modal>
        );
      })()}
    </div>
  );
}
