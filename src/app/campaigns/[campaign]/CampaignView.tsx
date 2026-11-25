"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { chapterPlace, findCampaign, findMission, storyOfChapter } from "@/campaign";
import {
  canPlay, chapterCompletedCount, completedCount, DIFFICULTY_ORDER, highestAward, isChapterComplete, markIntroSeen, missionProgress, missionStatus,
  nextMission, setDifficulty, storyMissions, type StoryProgress,
} from "@/campaign/progress";
import type { StoryDef } from "@/campaign/stories";
import { missionParams } from "@/campaign/setup";
import type { CampaignDef, MissionDef } from "@/campaign/types";
import type { Difficulty } from "@/config/difficulty";
import { errorText } from "@/gps/provider/provider";
import { preloadMissionVoices } from "../../_client/audio";
import { useStoryProgress } from "../../_client/campaignStore";
import { unlockAudio } from "../../_client/cues";
import { NarrationControl } from "../../_client/NarrationControl";
import { narrator } from "../../_client/narration";
import { briefingNarration } from "@/campaign/narration";
import { DIFFICULTY_LABEL, fmtTime } from "../../_client/format";
import { preloadMatchPictures } from "../../_client/matchImages";
import { PageHeader } from "../../_client/Modal";
import { useSessionCtx, useSessionView } from "../../_client/SessionProvider";
import { t } from "../../_client/strings";

const newSeed = () => Math.floor(Math.random() * 1e9);

const missionUrl = (campaignId: string, missionId: string | null) => (missionId ? `/campaigns/${campaignId}?mission=${missionId}` : `/campaigns/${campaignId}`);
/**
 * A briefing's history entry is marked, and the overview always sits right before it: the app's ‹ and the phone's back both step back to
 * the overview, whether the briefing was opened from the overview or by a link (NEXT, RETRY, a bookmark, a reload).
 */
const BRIEFING = "outbreakBriefing";
const onBriefingEntry = () => { try { return !!(window.history.state as Record<string, unknown> | null)?.[BRIEFING]; } catch { return false; } };

/** A mission as a large picture card: number, name, theme and state. Locked missions cannot be opened. */
function MissionCard({ s, c, m, progress, onOpen }: { s: StoryDef; c: CampaignDef; m: MissionDef; progress: StoryProgress; onOpen: () => void }) {
  const S = t().campaign;
  const status = missionStatus(s, progress, c.id, m.id);
  const mp = missionProgress(progress, c.id, m.id);
  const locked = status === "locked";
  // A won mission shows the highest difficulty it has been won on (none for a win from before difficulties were recorded).
  const best = status === "completed" && mp?.bestDifficulty ? DIFFICULTY_LABEL[mp.bestDifficulty].toUpperCase() : null;
  return (
    <button type="button" className="missioncard" data-status={status} disabled={locked} onClick={onOpen}
      aria-label={`${S.mission(m.id)}: ${m.title}. ${S.status[status]}${best ? ` ${S.onDifficulty(best)}` : ""}`}>
      <span className="missioncard-bg" aria-hidden="true" style={{ backgroundImage: `url(${m.image})`, backgroundPosition: m.imagePosition }} />
      <span className="missioncard-body" aria-hidden="true">
        <span className="missioncard-top">
          <span className="missioncard-n">{S.mission(m.id)}</span>
          <span className="campchip" data-state={status} data-best={mp?.bestDifficulty}>{status === "locked" ? "🔒 " : status === "completed" ? "✓ " : ""}{best ?? S.status[status]}</span>
        </span>
        <b className="missioncard-title">{m.title}</b>
        <span className="missioncard-sub">
          {`${m.tagline} · ${S.about(m.aboutMin)}`}
          {status === "completed" && mp?.bestTimeS !== undefined ? ` · ${S.best(fmtTime(mp.bestTimeS))}` : ""}
        </span>
      </span>
      {!locked && <span className="missioncard-go" aria-hidden="true">{status === "completed" ? S.replay : S.play} ›</span>}
    </button>
  );
}

/**
 * Before a mission: one screen between the overview and the match. The picture, the story so far, the goal, the time it takes and START
 * MISSION; the narrator reads the story and the goal aloud as it opens (LISTEN again, or STOP). Pressing START ends the read.
 */
function Briefing({ c, m, difficulty, onClose, onSeen }: { c: CampaignDef; m: MissionDef; difficulty: Difficulty; onClose: () => void; onSeen: () => void }) {
  const S = t().campaign;
  const ctx = useSessionCtx();
  const router = useRouter();
  const session = ctx?.session;
  const view = useSessionView(session);
  const [busy, setBusy] = useState<"scouting" | "starting" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);
  const narration = briefingNarration(c, m);

  // The story has been presented (kept in the progress as before; it no longer changes what is shown).
  useEffect(() => { onSeen(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
    narrator().stop();
    void session.enableCompass();
    setProblem(null);
    setBusy("scouting");
    const prep = await session.prepare(missionParams(c, m, difficulty, newSeed()));
    if (!prep) { setBusy(null); setProblem(session.getView().messages[0] ?? S.gpsWaiting); return; }
    if (prep.status !== "ok") { session.backToConfig(); setBusy(null); setProblem(prep.message ?? "This mission cannot be laid out where you are. Move to an area with more paths and try again."); return; }
    setBusy("starting");
    if (await session.startMatch()) { started.current = true; router.push("/play"); return; }
    setProblem(session.getView().messages[0] ?? "The mission could not be started. Try again.");
    session.backToConfig();
    setBusy(null);
  };

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
        <NarrationControl campaignId={c.id} id={narration.id} autoplay />
        <p className="brief-story">{m.intro.join(" ")}</p>
        <section className="brief-obj" aria-labelledby="brief-obj">
          <h2 id="brief-obj">{S.objective}</h2>
          <p>{m.objective}</p>
        </section>
        <ul className="brief-facts" aria-label="Mission facts">
          <li>{S.about(m.aboutMin)}</li>
          <li>{S.onFoot}</li>
          <li>{DIFFICULTY_LABEL[difficulty].toUpperCase()}</li>
        </ul>
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

/** The story's highest award, and the next one to aim for. */
function AwardBadge({ award }: { award: Difficulty }) {
  const S = t().campaign;
  const up = DIFFICULTY_ORDER[DIFFICULTY_ORDER.indexOf(award) + 1];
  return (
    <section className="campaward" data-award={award} aria-label={`${S.awardLabel}: ${S.award[award]}`}>
      <span className="campaward-mark" aria-hidden="true">★</span>
      <span className="campaward-body">
        <span className="campaward-k">{S.awardLabel}</span>
        <b className="campaward-name">{S.award[award]}</b>
        <span className="campaward-sub">{up ? S.awardNext(S.award[up], DIFFICULTY_LABEL[up].toUpperCase()) : S.awardTop}</span>
      </span>
    </section>
  );
}

export default function CampaignView({ id }: { id: string }) {
  const c = findCampaign(id);
  const story = c ? storyOfChapter(c.id) : null;
  const S = t().campaign;
  const router = useRouter();
  // The hooks below need a story; the page only renders this component for a chapter that exists, and every chapter is in a story.
  const { progress, ready, update } = useStoryProgress(story!);
  const [open, setOpen] = useState<string | null>(null);
  // A mission was tapped before a difficulty was chosen: say what is needed, at the difficulty buttons.
  const [needDifficulty, setNeedDifficulty] = useState(false);
  const diffRef = useRef<HTMLElement>(null);
  // The difficulty cannot be changed while a mission match is running (it was fixed when the match started).
  const session = useSessionCtx()?.session;
  const view = useSessionView(session);
  const matchRunning = view?.stage === "playing";

  // The open mission is in the URL (?mission=02), so the phone's back button closes the briefing and NEXT/RETRY can link straight to it.
  useEffect(() => {
    if (!ready || !c || !story) return;
    const read = () => {
      const mid = new URLSearchParams(window.location.search).get("mission");
      // A mission opens only once a difficulty has been chosen (none is chosen for the player) and when it is not locked.
      const ok = !!mid && progress.difficulty !== null && c.missions.some((m) => m.id === mid) && canPlay(story, progress, c.id, mid);
      if (mid && !ok) {
        // A link to a mission that cannot open is dropped from the address, so choosing the difficulty afterwards opens nothing by itself.
        window.history.replaceState(null, "", missionUrl(c.id, null));
      } else if (ok && !onBriefingEntry()) {
        // Opened by a link: put the overview in front of the briefing.
        window.history.replaceState(null, "", missionUrl(c.id, null));
        window.history.pushState({ [BRIEFING]: true }, "", missionUrl(c.id, mid));
      }
      setOpen(ok ? mid : null);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [ready, c, story, progress]);

  if (!c || !story) return <main className="page camp"><PageHeader title={S.listTitle} href="/campaigns" /><div className="card bad">{S.notFound}</div></main>;

  const promptDifficulty = () => { setNeedDifficulty(true); diffRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); };
  const openMission = (mid: string) => {
    if (!canPlay(story, progress, c.id, mid)) return;
    if (progress.difficulty === null) { promptDifficulty(); return; }
    unlockAudio(); // the tap that opens the briefing lets the narrator start
    window.history.pushState({ [BRIEFING]: true }, "", missionUrl(c.id, mid));
    setOpen(mid);
    window.scrollTo(0, 0);
  };
  const close = () => {
    if (onBriefingEntry()) { window.history.back(); return; }
    window.history.replaceState(null, "", missionUrl(c.id, null));
    setOpen(null);
  };

  const mission = open ? c.missions.find((m) => m.id === open) : undefined;
  if (mission && progress.difficulty) {
    return <Briefing key={mission.id} c={c} m={mission} difficulty={progress.difficulty} onClose={close} onSeen={() => update((p) => markIntroSeen(p, c.id, mission.id))} />;
  }

  const done = chapterCompletedCount(c, progress);
  const complete = isChapterComplete(c, progress);
  const next = nextMission(story, progress);
  const nextDef = next ? findMission({ id: next.chapterId, mission: next.missionId }) : null;
  const storyDone = completedCount(story, progress);
  const storyTotal = storyMissions(story).length;
  const award = highestAward(progress);
  const choosing = ready && progress.difficulty === null;
  const goNext = () => {
    if (!next) return;
    if (progress.difficulty === null) { promptDifficulty(); return; }
    if (next.chapterId === c.id) openMission(next.missionId);
    else { unlockAudio(); router.push(missionUrl(next.chapterId, next.missionId)); }
  };
  // Where this chapter sits in its story (the story page lists every chapter, the ones still to come locked).
  const place = chapterPlace(c.id);
  return (
    <main className="page camp">
      <PageHeader title={c.title} href={`/campaigns/${story.id}`} />
      <div className="camphero">
        <div className="camphero-bg" aria-hidden="true" style={{ backgroundImage: `url(${c.cover})`, backgroundPosition: c.coverPosition }} />
        {place && <span className="cine-k camphero-k">{S.chapterOf(place.story.title, place.number)}</span>}
        <p className="camphero-desc">{c.description}</p>
        <div className="campbar" role="img" aria-label={S.missions(done, c.missions.length)}>
          <span className="campbar-track" aria-hidden="true">{c.missions.map((m, i) => <i key={m.id} data-on={i < done || undefined} />)}</span>
          <span className="campbar-n" aria-hidden="true">{complete ? S.completed : S.missions(done, c.missions.length)}</span>
        </div>
      </div>

      {ready && award && <AwardBadge award={award} />}

      <section className="campdiff" ref={diffRef} aria-labelledby="campdiff-label" data-prompt={choosing || undefined}>
        <h2 className="nglabel" id="campdiff-label">{choosing ? S.chooseDifficulty : S.difficulty}</h2>
        <div className="seg" role="group" aria-labelledby="campdiff-label">
          {DIFFICULTY_ORDER.map((d) => (
            <button key={d} type="button" disabled={!ready || matchRunning} aria-pressed={ready && progress.difficulty === d}
              onClick={() => { setNeedDifficulty(false); update((p) => setDifficulty(p, d)); }}>{DIFFICULTY_LABEL[d].toUpperCase()}</button>
          ))}
        </div>
        {needDifficulty && progress.difficulty === null && <p className="ngneed" role="alert">{S.needDifficultyFirst}</p>}
        <p className="ngnote">{matchRunning ? S.difficultyLocked : S.difficultyNote}</p>
      </section>

      {ready && nextDef && (
        <div className="campnext">
          <span className="campnext-k">{S.storyProgress(story.title, storyDone, storyTotal)}</span>
          <button type="button" className="btn cta camp-cta big campcontinue" onClick={goNext} aria-label={`${progress.started ? S.continue : S.begin}: ${S.mission(nextDef.mission.id)} ${nextDef.mission.title}`}>
            <b>{progress.started ? S.continue : S.begin}</b>
            <span>{S.mission(nextDef.mission.id)} · {nextDef.mission.title}</span>
          </button>
        </div>
      )}
      {ready && !next && <p className="campnext-k campnext-done">{S.storyProgress(story.title, storyDone, storyTotal)}{award !== "hard" ? ` · ${S.improveHint}` : ""}</p>}

      {complete && (
        <section className="epilogue" aria-label={c.epilogue.title}>
          <b>{c.epilogue.title}</b>
          {c.epilogue.lines.map((l, i) => <p key={i}>{l}</p>)}
        </section>
      )}

      <div className="missionlist" data-next={next?.chapterId === c.id ? next.missionId : undefined}>
        {c.missions.map((m) => <MissionCard key={m.id} s={story} c={c} m={m} progress={progress} onOpen={() => openMission(m.id)} />)}
      </div>

    </main>
  );
}
