import { THE_FALL } from "./the-fall";
import type { CampaignDef, CampaignRef, MissionDef } from "./types";

/** Every campaign the game offers, in the order shown. A new campaign is one more definition here; nothing else needs to know. */
export const CAMPAIGNS: readonly CampaignDef[] = [THE_FALL];

export function findCampaign(id: string | null | undefined): CampaignDef | null {
  return CAMPAIGNS.find((c) => c.id === id) ?? null;
}

export function findMission(ref: CampaignRef | null | undefined): { campaign: CampaignDef; mission: MissionDef; index: number } | null {
  const campaign = findCampaign(ref?.id);
  if (!campaign || !ref) return null;
  const index = campaign.missions.findIndex((m) => m.id === ref.mission);
  return index < 0 ? null : { campaign, mission: campaign.missions[index], index };
}

/** Where a beat's recording is served from (if it has been recorded, see voice-manifest.json). */
export const beatVoiceUrl = (campaignId: string, beatId: string): string => `/campaign/${campaignId}/voice/${beatId}.mp3`;

export type { CampaignDef, CampaignRef, MissionDef, StoryBeat } from "./types";
