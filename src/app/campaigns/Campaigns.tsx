"use client";

import Link from "next/link";
import { STORIES } from "@/campaign";
import { completedCount, storyMissions } from "@/campaign/progress";
import type { StoryDef } from "@/campaign/stories";
import { useStoryProgress } from "../_client/campaignStore";
import { PageHeader } from "../_client/Modal";
import { t } from "../_client/strings";

/** One story (REGENESIS): its cover, what it is, its chapters and how far the player has come. It opens the story's chapters. */
function StoryCard({ story }: { story: StoryDef }) {
  const S = t().campaign;
  const { progress, ready } = useStoryProgress(story);
  const done = ready ? completedCount(story, progress) : 0;
  const total = storyMissions(story).length;
  const state = done > 0 && done === total ? S.completed : ready && progress.started ? S.inProgress : S.notStarted;
  return (
    <Link className="campcard" href={`/campaigns/${story.id}`} aria-label={`${story.title}. ${S.chapters(story.chapters.length)}. ${state}`}>
      <span className="campcard-bg" aria-hidden="true" style={{ backgroundImage: `url(${story.cover})`, backgroundPosition: story.coverPosition }} />
      <span className="campcard-body" aria-hidden="true">
        <span className="campchip" data-state={state}>{state}</span>
        <span className="cine-k">{S.chapters(story.chapters.length)}</span>
        <b className="campcard-title">{story.title}</b>
        <span className="campcard-desc">{story.description}</span>
      </span>
    </Link>
  );
}

export default function Campaigns() {
  return (
    <main className="page camp">
      <PageHeader title={t().campaign.listTitle} />
      <div className="camplist">
        {STORIES.map((s) => <StoryCard key={s.id} story={s} />)}
      </div>
    </main>
  );
}
