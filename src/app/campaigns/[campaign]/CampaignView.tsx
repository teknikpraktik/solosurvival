"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { findCampaign } from "@/campaign";
import { canPlay, completedCount, isCampaignComplete, markIntroSeen, missionStatus, nextMission, setDifficulty, type CampaignProgress } from "@/campaign/progress";
import { missionParams } from "@/campaign/setup";
import type { CampaignDef, MissionDef } from "@/campaign/types";
import type { Difficulty } from "@/config/difficulty";
import { errorText } from "@/gps/provider/provider";
import { preloadMissionVoices } from "../../_client/audio";
import { useCampaignProgress } from "../../_client/campaignStore";
import { unlockAudio } from "../../_client/cues";
import { DIFFICULTY_LABEL, fmtTime } from "../../_client/format";
import { preloadMatchPictures } from "../../_client/matchImages";
import { PageHeader } from "../../_client/Modal";
import { useSessionCtx, useSessionView } from "../../_client/SessionProvider";
import { t } from "../../_client/strings";

const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];
const newSeed = () => Math.floor(Math.random() * 1e9);
/** The cinematic intro moves on by itself after its lines have been shown (ms per line, plus a pause). */
const INTRO_LINE_MS = 2300;

const missionUrl = (campaignId: string, missionId: string | null) => (missionId ? `/campaigns/${campaignId}?mission=${missionId}` : `/campaigns/${campaignId}`);

/** A mission as a large picture card: number, name, theme and state. Locked missions cannot be opened. */
function MissionCard({ c, m, progress, onOpen }: { c: CampaignDef; m: MissionDef; progress: CampaignProgress; onOpen: () => void }) {
  const S = t().campaign;
  const status = missionStatus(c, progress, m.id);
  const mp = progress.missions[m.id];
  const locked = status === "locked";
  return (
    <button type="button" className="missioncard" data-status={status} disabled={locked} onClick={onOpen}
      aria-label={`${S.mission(m.id)}: ${m.title}. ${S.status[status]}${locked ? `. ${S.lockedHint}` : ""}`}>
      <span className="missioncard-bg" aria-hidden="true" style={{ backgroundImage: `url(${m.image})`, backgroundPosition: m.imagePosition }} />
      <span className="missioncard-body" aria-hidden="true">
        <span className="missioncard-top">
          <span className="missioncard-n">{S.mission(m.id)}</span>
          <span className="campchip" data-state={status}>{status === "locked" ? "🔒 " : status === "completed" ? "✓ " : ""}{S.status[status]}</span>
        </span>
        <b className="missioncard-title">{m.title}</b>
        <span className="missioncard-sub">
          {locked ? S.lockedHint : `${m.tagline} · ${S.about(m.aboutMin)}`}
          {status === "completed" && mp?.bestTimeS !== undefined ? ` · ${S.best(fmtTime(mp.bestTimeS))}` : ""}
        </span>
      </span>
      {!locked && <span className="missioncard-go" aria-hidden="true">{status === "completed" ? S.replay : S.play} ›</span>}
    </button>
  );
}

/**
 * Before a mission: a short cinematic intro the first time (the picture and three lines, skippable with a tap), then the briefing with the
 * goal, the time it takes and START MISSION. A mission whose intro has been seen opens on the briefing.
 */
function Briefing({ c, m, progress, onClose, onSeen }: { c: CampaignDef; m: MissionDef; progress: CampaignProgress; onClose: () => void; onSeen: () => void }) {
  const S = t().campaign;
  const ctx = useSessionCtx();
  const router = useRouter();
  const session = ctx?.session;
  const view = useSessionView(session);
  const [cine, setCine] = useState(() => !progress.missions[m.id]?.introSeen);
  const [busy, setBusy] = useState<"scouting" | "starting" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);

  const endCine = useCallback(() => { setCine(false); onSeen(); }, [onSeen]);
  useEffect(() => {
    if (!cine) return;
    const h = setTimeout(endCine, m.intro.length * INTRO_LINE_MS + 1800);
    return () => clearTimeout(h);
  }, [cine, endCine, m.intro.length]);

  useEffect(() => { session?.startLocating(); }, [session]);
  // The mission's pictures and recorded lines load in the background while the player reads.
  useEffect(() => { preloadMatchPictures(m.mode); preloadMissionVoices(c.id, m.beats.map((b) => b.id)); }, [c.id, m]);
  // Leaving the briefing while the area is being scouted: the half-made match is dropped.
  useEffect(() => () => { if (!started.current) session?.backToConfig(); }, [session]);

  const located = !!session?.currentStart();
  const gpsError = view?.gpsError ? errorText[view.gpsError.code] : null;

  const start = async () => {
    if (!session || busy) return;
    unlockAudio();
    void session.enableCompass();
    setProblem(null);
    setBusy("scouting");
    const prep = await session.prepare(missionParams(c, m, progress.difficulty, newSeed()));
    if (!prep) { setBusy(null); setProblem(session.getView().messages[0] ?? S.gpsWaiting); return; }
    if (prep.status !== "ok") { session.backToConfig(); setBusy(null); setProblem(prep.message ?? "This mission cannot be laid out where you are. Move to an area with more paths and try again."); return; }
    setBusy("starting");
    if (await session.startMatch()) { started.current = true; router.push("/play"); return; }
    setProblem(session.getView().messages[0] ?? "The mission could not be started. Try again.");
    session.backToConfig();
    setBusy(null);
  };

  if (cine) {
    return (
      <div className="cine" role="dialog" aria-label={`${S.mission(m.id)}: ${m.title}`} onClick={endCine}>
        <div className="cine-bg" aria-hidden="true" style={{ backgroundImage: `url(${m.image})`, backgroundPosition: m.imagePosition }} />
        <div className="cine-text">
          <span className="cine-k">{c.title} · {S.mission(m.id)}</span>
          <h1 className="cine-title">{m.title}</h1>
          <div className="cine-lines">
            {m.intro.map((line, i) => <p key={i} style={{ animationDelay: `${0.9 + (i * INTRO_LINE_MS) / 1000}s` }}>{line}</p>)}
          </div>
        </div>
        <button type="button" className="cine-skip" onClick={(e) => { e.stopPropagation(); endCine(); }}>{S.skipIntro} ›</button>
      </div>
    );
  }

  return (
    <main className="brief">
      <div className="brief-hero">
        <div className="brief-bg" aria-hidden="true" style={{ backgroundImage: `url(${m.image})`, backgroundPosition: m.imagePosition }} />
        <button type="button" className="pageback brief-back" aria-label={S.backToCampaign} onClick={onClose} disabled={!!busy}><span aria-hidden="true">‹</span></button>
        <div className="brief-head">
          <span className="cine-k">{c.title} · {S.mission(m.id)}</span>
          <h1 className="brief-title">{m.title}</h1>
        </div>
      </div>
      <div className="brief-body">
        <p className="brief-story">{m.intro.join(" ")}</p>
        <section className="brief-obj" aria-labelledby="brief-obj">
          <h2 id="brief-obj">{S.objective}</h2>
          <p>{m.objective}</p>
        </section>
        <ul className="brief-facts" aria-label="Mission facts">
          <li>{S.about(m.aboutMin)}</li>
          <li>{S.onFoot}</li>
          <li>{DIFFICULTY_LABEL[progress.difficulty].toUpperCase()}</li>
        </ul>
        <p className="brief-safety">{S.safety} {S.quitNote}</p>
        {problem && <div className="card bad" role="alert">{problem}</div>}
        {!problem && gpsError && <div className="card bad" role="alert">{gpsError}</div>}
        {!problem && !gpsError && !located && <div className="card warn" role="status">{S.gpsWaiting}</div>}
      </div>
      <div className="brief-foot">
        <button type="button" className="btn cta camp-cta big" disabled={!session || !!busy || !located} onClick={start}>
          {busy === "scouting" ? S.scouting : busy === "starting" ? S.starting : problem ? S.tryAgain : S.startMission}
        </button>
      </div>
    </main>
  );
}

export default function CampaignView({ id }: { id: string }) {
  const c = findCampaign(id);
  const S = t().campaign;
  // The hooks below need a campaign; the page only renders this component for one that exists.
  const { progress, ready, update } = useCampaignProgress(c!);
  const [open, setOpen] = useState<string | null>(null);
  const pushed = useRef(false);

  // The open mission is in the URL (?mission=02), so the phone's back button closes the briefing and "retry" can link straight to it.
  useEffect(() => {
    if (!ready || !c) return;
    const read = () => {
      const mid = new URLSearchParams(window.location.search).get("mission");
      setOpen(mid && c.missions.some((m) => m.id === mid) && canPlay(c, progress, mid) ? mid : null);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [ready, c, progress]);

  if (!c) return <main className="page camp"><PageHeader title={S.listTitle} href="/campaigns" /><div className="card bad">{S.notFound}</div></main>;

  const openMission = (mid: string) => {
    if (!canPlay(c, progress, mid)) return;
    pushed.current = true;
    window.history.pushState(null, "", missionUrl(c.id, mid));
    setOpen(mid);
    window.scrollTo(0, 0);
  };
  const close = () => {
    if (pushed.current) { pushed.current = false; window.history.back(); return; }
    window.history.replaceState(null, "", missionUrl(c.id, null));
    setOpen(null);
  };

  const mission = open ? c.missions.find((m) => m.id === open) : undefined;
  if (mission) return <Briefing key={mission.id} c={c} m={mission} progress={progress} onClose={close} onSeen={() => update((p) => markIntroSeen(p, mission.id))} />;

  const done = completedCount(c, progress);
  const complete = isCampaignComplete(c, progress);
  const next = nextMission(c, progress);
  return (
    <main className="page camp">
      <PageHeader title={c.title} href="/campaigns" />
      <div className="camphero">
        <div className="camphero-bg" aria-hidden="true" style={{ backgroundImage: `url(${c.cover})`, backgroundPosition: c.coverPosition }} />
        <p className="camphero-desc">{c.description}</p>
        <div className="campbar" role="img" aria-label={S.missions(done, c.missions.length)}>
          <span className="campbar-track" aria-hidden="true">{c.missions.map((m, i) => <i key={m.id} data-on={i < done || undefined} />)}</span>
          <span className="campbar-n" aria-hidden="true">{complete ? S.completed : S.missions(done, c.missions.length)}</span>
        </div>
      </div>

      <section className="campdiff" aria-labelledby="campdiff-label" data-prompt={(ready && !progress.started) || undefined}>
        <h2 className="nglabel" id="campdiff-label">{ready && !progress.started ? S.chooseDifficulty : S.difficulty}</h2>
        <div className="seg" role="group" aria-labelledby="campdiff-label">
          {DIFFICULTIES.map((d) => (
            <button key={d} type="button" aria-pressed={progress.difficulty === d} onClick={() => update((p) => setDifficulty(p, d))}>{DIFFICULTY_LABEL[d].toUpperCase()}</button>
          ))}
        </div>
        <p className="ngnote">{S.difficultyNote}</p>
      </section>

      {complete && (
        <section className="epilogue" aria-label={c.epilogue.title}>
          <b>{c.epilogue.title}</b>
          {c.epilogue.lines.map((l, i) => <p key={i}>{l}</p>)}
        </section>
      )}

      <div className="missionlist" data-next={next ?? undefined}>
        {c.missions.map((m) => <MissionCard key={m.id} c={c} m={m} progress={progress} onOpen={() => openMission(m.id)} />)}
      </div>
    </main>
  );
}
