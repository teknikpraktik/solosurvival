"use client";

import Link from "next/link";
import { chapterPlace, STORIES } from "@/campaign";
import { chapterCompletedCount, isChapterComplete, type StoryProgress } from "@/campaign/progress";
import { playableChapters, type StoryDef } from "@/campaign/stories";
import type { CampaignDef } from "@/campaign/types";
import { useStoryProgress } from "../_client/campaignStore";
import { PageHeader } from "../_client/Modal";
import { t } from "../_client/strings";

/** One playable chapter: its cover, where it sits in its story, what it is, and how far the player has come. Only chapters that exist are listed. */
function CampaignCard({ c, progress, ready }: { c: CampaignDef; progress: StoryProgress; ready: boolean }) {
  const S = t().campaign;
  const done = chapterCompletedCount(c, progress);
  const state = isChapterComplete(c, progress) ? S.completed : ready && c.missions.some((m) => (progress.chapters[c.id]?.missions[m.id]?.attempts ?? 0) > 0 || progress.chapters[c.id]?.missions[m.id]?.completed) ? S.inProgress : S.notStarted;
  const place = chapterPlace(c.id);
  return (
    <Link className="campcard" href={`/campaigns/${c.id}`} data-complete={isChapterComplete(c, progress) || undefined} aria-label={`${place ? `${S.chapterOf(place.story.title, place.number)}: ` : ""}${c.title}. ${S.missions(done, c.missions.length)}. ${state}`}>
      <span className="campcard-bg" aria-hidden="true" style={{ backgroundImage: `url(${c.cover})`, backgroundPosition: c.coverPosition }} />
      <span className="campcard-body" aria-hidden="true">
        <span className="campchip" data-state={state}>{state}</span>
        {place && <span className="cine-k">{S.chapterOf(place.story.title, place.number)}</span>}
        <b className="campcard-title">{c.title}</b>
        <span className="campcard-desc">{c.description}</span>
        <span className="campbar"><span className="campbar-track">{c.missions.map((m, i) => <i key={m.id} data-on={i < done || undefined} />)}</span><span className="campbar-n">{S.missions(done, c.missions.length)}</span></span>
      </span>
    </Link>
  );
}

/** A story's playable chapters, read from the story's one progress record. */
function StoryCards({ story }: { story: StoryDef }) {
  const { progress, ready } = useStoryProgress(story);
  return <>{playableChapters(story).map((c) => <CampaignCard key={c.id} c={c} progress={progress} ready={ready} />)}</>;
}

export default function Campaigns() {
  return (
    <main className="page camp">
      <PageHeader title={t().campaign.listTitle} />
      <div className="camplist">
        {/* Every playable chapter, story by story. */}
        {STORIES.map((s) => <StoryCards key={s.id} story={s} />)}
      </div>
    </main>
  );
}
