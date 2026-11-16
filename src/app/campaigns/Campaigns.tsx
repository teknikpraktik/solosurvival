"use client";

import Link from "next/link";
import { CAMPAIGNS, chapterPlace } from "@/campaign";
import { completedCount, isCampaignComplete } from "@/campaign/progress";
import type { CampaignDef } from "@/campaign/types";
import { useCampaignProgress } from "../_client/campaignStore";
import { PageHeader } from "../_client/Modal";
import { t } from "../_client/strings";

/** One playable chapter: its cover, where it sits in its story, what it is, and how far the player has come. Only chapters that exist are listed. */
function CampaignCard({ c }: { c: CampaignDef }) {
  const { progress, ready } = useCampaignProgress(c);
  const S = t().campaign;
  const done = completedCount(c, progress);
  const state = isCampaignComplete(c, progress) ? S.completed : ready && progress.started ? S.inProgress : S.notStarted;
  const place = chapterPlace(c.id);
  return (
    <Link className="campcard" href={`/campaigns/${c.id}`} data-complete={isCampaignComplete(c, progress) || undefined} aria-label={`${place ? `${S.chapterOf(place.story.title, place.number)}: ` : ""}${c.title}. ${S.missions(done, c.missions.length)}. ${state}`}>
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

export default function Campaigns() {
  return (
    <main className="page camp">
      <PageHeader title={t().campaign.listTitle} />
      <div className="camplist">
        {/* Every playable chapter, story by story (CAMPAIGNS is in story order). */}
        {CAMPAIGNS.map((c) => <CampaignCard key={c.id} c={c} />)}
      </div>
    </main>
  );
}
