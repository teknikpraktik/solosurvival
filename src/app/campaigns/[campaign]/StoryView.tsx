"use client";

import Link from "next/link";
import { findMission, findStory } from "@/campaign";
import { chapterCompletedCount, completedCount, isChapterComplete, nextMission, storyMissions, type StoryProgress } from "@/campaign/progress";
import { chapterId, type ChapterSlot } from "@/campaign/stories";
import { useStoryProgress } from "../../_client/campaignStore";
import { unlockAudio } from "../../_client/cues";
import { PageHeader } from "../../_client/Modal";
import { t } from "../../_client/strings";

/**
 * A story (REGENESIS): its chapters in order. A playable chapter is a picture card that opens its missions; a chapter still to come is
 * shown in its place, locked, so the whole story can be seen from the start. CONTINUE goes straight to the next mission.
 */
function ChapterCard({ slot, n, progress, ready }: { slot: ChapterSlot; n: number; progress: StoryProgress; ready: boolean }) {
  const S = t().campaign;
  if (slot.kind === "planned") {
    return (
      <div className="campcard chaptercard" data-locked="true" aria-label={`${S.chapter(n)}: ${slot.title}. ${S.chapterLocked}`}>
        <span className="campcard-body" aria-hidden="true">
          <span className="chaptercard-top"><span className="cine-k">{S.chapter(n)}</span><span className="campchip" data-state="locked">🔒 {S.chapterLocked}</span></span>
          <b className="campcard-title">{slot.title}</b>
        </span>
      </div>
    );
  }
  const c = slot.campaign;
  const done = chapterCompletedCount(c, progress);
  const complete = isChapterComplete(c, progress);
  const started = ready && c.missions.some((m) => (progress.chapters[c.id]?.missions[m.id]?.attempts ?? 0) > 0 || progress.chapters[c.id]?.missions[m.id]?.completed);
  const state = complete ? S.completed : started ? S.inProgress : S.notStarted;
  return (
    <Link className="campcard chaptercard" href={`/campaigns/${c.id}`} data-complete={complete || undefined} aria-label={`${S.chapter(n)}: ${c.title}. ${S.missions(done, c.missions.length)}. ${state}`}>
      <span className="campcard-bg" aria-hidden="true" style={{ backgroundImage: `url(${c.cover})`, backgroundPosition: c.coverPosition }} />
      <span className="campcard-body" aria-hidden="true">
        <span className="chaptercard-top"><span className="cine-k">{S.chapter(n)}</span><span className="campchip" data-state={state}>{state}</span></span>
        <b className="campcard-title">{c.title}</b>
        <span className="campcard-desc">{c.description}</span>
        <span className="campbar"><span className="campbar-track">{c.missions.map((m, i) => <i key={m.id} data-on={i < done || undefined} />)}</span><span className="campbar-n">{S.missions(done, c.missions.length)}</span></span>
      </span>
    </Link>
  );
}

export default function StoryView({ id }: { id: string }) {
  const story = findStory(id)!;
  const S = t().campaign;
  const { progress, ready } = useStoryProgress(story);
  const next = ready ? nextMission(story, progress) : null;
  const nextDef = next ? findMission({ id: next.chapterId, mission: next.missionId }) : null;
  return (
    <main className="page camp">
      <PageHeader title={story.title} href="/campaigns" />
      <div className="camphero">
        <div className="camphero-bg" aria-hidden="true" style={{ backgroundImage: `url(${story.cover})`, backgroundPosition: story.coverPosition }} />
        <p className="camphero-desc">{story.description}</p>
        <span className="campbar-n">{S.storyProgress(story.title, completedCount(story, progress), storyMissions(story).length)}</span>
      </div>
      {ready && progress.started && nextDef && next && (
        <Link className="btn cta camp-cta big campcontinue" href={`/campaigns/${next.chapterId}?mission=${next.missionId}`} onClick={() => unlockAudio()}>
          <b>{S.continue}</b>
          <span>{S.mission(nextDef.mission.id)} · {nextDef.mission.title}</span>
        </Link>
      )}
      <div className="camplist">
        {story.chapters.map((slot, i) => <ChapterCard key={chapterId(slot)} slot={slot} n={i + 1} progress={progress} ready={ready} />)}
      </div>
    </main>
  );
}
