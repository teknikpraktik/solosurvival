"use client";

import Link from "next/link";
import { CAMPAIGNS } from "@/campaign";
import { completedCount, isCampaignComplete, nextMission } from "@/campaign/progress";
import { useCampaignProgress } from "./campaignStore";
import { t } from "./strings";

/**
 * The start page's main action: campaigns, as a wide picture card with the first campaign's cover and where the player is in it.
 * One tap goes to the campaign list (to the campaign itself while there is only one would hide that more are coming; the list is one
 * more tap and shows the progress).
 */
export function CampaignTeaser() {
  const c = CAMPAIGNS[0];
  const { progress, ready } = useCampaignProgress(c);
  const S = t().home;
  const next = nextMission(c, progress);
  const nextDef = c.missions.find((m) => m.id === next);
  const line = !ready || !progress.started ? S.campaignsNew
    : isCampaignComplete(c, progress) ? S.campaignsDone
    : nextDef ? S.campaignsContinue(nextDef.id, nextDef.title) : S.campaignsNew;
  const done = completedCount(c, progress);
  return (
    <Link className="campcta" href="/campaigns" aria-label={`${S.campaigns}. ${c.title}. ${line}`}>
      <span className="campcta-bg" aria-hidden="true" style={{ backgroundImage: `url(${c.cover})`, backgroundPosition: c.coverPosition }} />
      <span className="campcta-text" aria-hidden="true">
        <span className="campcta-k">{S.campaignsKicker}</span>
        <b>{S.campaigns}</b>
        <span className="campcta-s">{c.title} · {line}</span>
      </span>
      <span className="campcta-pips" aria-hidden="true">{c.missions.map((m, i) => <i key={m.id} data-on={i < done || undefined} />)}</span>
    </Link>
  );
}
