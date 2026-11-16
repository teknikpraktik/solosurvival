"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CAMPAIGNS } from "@/campaign";
import { isCampaignComplete, nextMission } from "@/campaign/progress";
import { useCampaignProgress } from "./campaignStore";
import { t } from "./strings";
import { BOOK_SVG, GEAR_SVG, HISTORY_SVG, MENU_SVG } from "./symbols";

/**
 * The start page's two ways to play, as two equal buttons (a name and a line under it; no picture, nothing marked as chosen: they are
 * ways in, not a setting). CAMPAIGN leads into the story where the player is: the campaign page for a new or a finished campaign, the
 * next mission's briefing once the campaign has been begun (the same link a result's NEXT uses, so nothing of the briefing is skipped).
 * FREE PLAY leads to its setup. The address is worked out after the page has loaded; until then CAMPAIGN leads to the campaign page.
 */
export function HomePlay() {
  const c = CAMPAIGNS[0];
  const { progress, ready } = useCampaignProgress(c);
  const S = t().home;
  const next = nextMission(c, progress);
  const resumable = ready && progress.started && !isCampaignComplete(c, progress) && !!next;
  return (
    <div className="homeplay">
      <Link className="playbtn" data-play="campaign" data-state={resumable ? "resume" : "new"} href={resumable ? `/campaigns/${c.id}?mission=${next}` : `/campaigns/${c.id}`}>
        <b>{S.campaign}</b>
        <span>{S.campaignSub}</span>
      </Link>
      <Link className="playbtn" data-play="free" href="/new">
        <b>{S.freePlay}</b>
        <span>{S.freePlaySub}</span>
      </Link>
    </div>
  );
}

/**
 * Everything that is not playing (previous games, how to play, settings) behind one small menu button at the bottom of the start page.
 * It opens a sheet from the bottom edge with the three destinations. The sheet closes on a choice, on a tap outside it and on Escape;
 * focus moves into it when it opens, stays in it while it is open, and returns to the button when it closes.
 */
export function HomeMore() {
  const S = t().home;
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const items: [string, string, string][] = [["/history", S.previous, HISTORY_SVG], ["/how-to-play", S.howTo, BOOK_SVG], ["/settings", S.settings, GEAR_SVG]];

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) btn.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const links = () => [...(sheet.current?.querySelectorAll<HTMLElement>("a, button") ?? [])];
    links()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
      if (e.key !== "Tab") return;
      const l = links();
      if (!l.length) return;
      const first = l[0], last = l[l.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" className="homemore" aria-label={S.more} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
        dangerouslySetInnerHTML={{ __html: MENU_SVG }} />
      {open && (
        <div className="moresheet-backdrop" onClick={() => setOpen(false)}>
          <div ref={sheet} className="moresheet" role="dialog" aria-modal="true" aria-label={S.more} onClick={(e) => e.stopPropagation()}>
            <nav aria-label={S.more}>
              {items.map(([href, label, icon]) => (
                <Link key={href} href={href} onClick={() => setOpen(false)}>
                  <span className="moresheet-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon }} />
                  <span>{label}</span>
                </Link>
              ))}
            </nav>
            <button type="button" className="moresheet-close" onClick={() => setOpen(false)}>{S.close}</button>
          </div>
        </div>
      )}
    </>
  );
}
