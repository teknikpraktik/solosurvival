"use client";

import Link from "next/link";
import { CAMPAIGNS } from "@/campaign";
import { completedCount, isCampaignComplete, nextMission } from "@/campaign/progress";
import { useCampaignProgress } from "./campaignStore";
import { t } from "./strings";

/** "FIRST CONTACT" → "First Contact" (mission names are stored as they are shown on their cards, in capitals). */
const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/**
 * The start page's main action: the campaign, as a wide picture card. It says where the player is and what one tap does, from the
 * campaign's saved state:
 *   - nothing played yet: START CAMPAIGN, to the campaign page (difficulty and the first mission);
 *   - a mission to go on with: CONTINUE, straight to that mission's briefing (its intro first if it has not been seen). The briefing is
 *     the campaign page's own, opened by the same link a result's NEXT button uses, so nothing of the setup is skipped;
 *   - everything done: REPLAY MISSIONS, to the campaign page.
 * The whole card is one link. Progress is read after the page has loaded; the three lines keep their place while it is read, so
 * nothing moves when the text arrives.
 */
export function CampaignTeaser() {
  const c = CAMPAIGNS[0];
  const { progress, ready } = useCampaignProgress(c);
  const S = t().home;
  const done = completedCount(c, progress);
  const complete = isCampaignComplete(c, progress);
  const next = c.missions.find((m) => m.id === nextMission(c, progress)) ?? c.missions[0];
  // Resumable: the player has begun (a mission started or won) and there is a mission left.
  const resumable = ready && progress.started && !complete;
  const action = complete ? S.replay : resumable ? S.continue : S.start;
  const line = complete ? S.allDone(c.missions.length) : S.missionLine(next.id, titleCase(next.title));
  const href = resumable ? `/campaigns/${c.id}?mission=${next.id}` : `/campaigns/${c.id}`;
  return (
    <Link className="campcta" href={href} data-state={!ready ? "loading" : complete ? "complete" : resumable ? "resume" : "new"}
      aria-label={ready ? `${S.campaigns}: ${c.title}. ${line}. ${action}` : `${S.campaigns}: ${c.title}`}>
      <span className="campcta-bg" aria-hidden="true" style={{ backgroundImage: `url(${c.cover})`, backgroundPosition: c.coverPosition }} />
      <span className="campcta-text" aria-hidden="true">
        <span className="campcta-k">{S.campaignsKicker}</span>
        <b>{S.campaigns}</b>
        <span className="campcta-name">{c.title}</span>
        <span className="campcta-mission" data-ready={ready || undefined}>{line}</span>
        <span className="campcta-go" data-ready={ready || undefined}>{action}<i>→</i></span>
      </span>
      <span className="campcta-pips" aria-hidden="true">{c.missions.map((m, i) => <i key={m.id} data-on={i < done || undefined} />)}</span>
    </Link>
  );
}
