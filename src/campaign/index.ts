import { STORIES, playableChapters } from "./stories";
import type { CampaignDef, CampaignRef, MissionDef } from "./types";

/**
 * Every playable chapter (`CampaignDef`), in the order shown: the stories' playable chapters in story order. A new chapter is one more
 * definition file and one entry in its story (stories.ts); nothing else needs to know. The name is kept from before stories existed:
 * saved progress, URLs and matches refer to a chapter by this id.
 */
export const CAMPAIGNS: readonly CampaignDef[] = STORIES.flatMap(playableChapters);

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

export { STORIES, chapterPlace } from "./stories";
export type { ChapterPlace, ChapterSlot, StoryDef } from "./stories";
export type { CampaignDef, CampaignRef, MissionDef, StoryBeat } from "./types";
