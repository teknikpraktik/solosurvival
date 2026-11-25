/**
 * Stories: the level above a chapter. CAMPAIGN (the main menu's story mode) holds stories; a story is a chain of chapters; a chapter
 * is a fixed sequence of missions. In code a playable chapter is a `CampaignDef` (types.ts) and keeps its own id, saved progress
 * (`outbreak.campaign.<chapter id>`), URLs and voice files, so this file adds names and order and changes nothing that is stored.
 *
 * A planned chapter is only a title: it is shown as "coming later" and can never be opened. How many chapters a story has, and how many
 * missions a chapter has, belongs to that story; nothing here assumes five of either.
 *
 * Canon: docs/OUTBREAK_STORY_BIBLE_V2_2.md (OUTBREAK: REGENESIS).
 */
import { THE_FALL } from "./the-fall";
import type { CampaignDef } from "./types";

export type ChapterSlot =
  /** A chapter that can be played. */
  | { kind: "playable"; campaign: CampaignDef }
  /** A chapter announced by name only: no missions, no page. */
  | { kind: "planned"; id: string; title: string };

export interface StoryDef {
  /** Also the story page's address: /campaigns/<id>. Never the same as a chapter's id. */
  id: string;
  title: string;
  /** Picture for the story's card and page. */
  cover: string;
  coverPosition?: string;
  description: string;
  chapters: readonly ChapterSlot[];
}

export const REGENESIS: StoryDef = {
  id: "regenesis",
  title: "REGENESIS",
  cover: "/img/hero-v2.jpg",
  coverPosition: "50% 72%",
  description: "The outbreak, and the long road after it. Five chapters, played on foot wherever you are.",
  chapters: [
    { kind: "playable", campaign: THE_FALL },
    { kind: "planned", id: "ground-zero", title: "GROUND ZERO" },
    { kind: "planned", id: "the-hunt", title: "THE HUNT" },
    { kind: "planned", id: "no-mans-land", title: "NO MAN'S LAND" },
    { kind: "planned", id: "the-last-hope", title: "THE LAST HOPE" },
  ],
};

/** Every story CAMPAIGN offers, in the order shown. */
export const STORIES: readonly StoryDef[] = [REGENESIS];

export const chapterId = (slot: ChapterSlot): string => (slot.kind === "playable" ? slot.campaign.id : slot.id);
export const chapterTitle = (slot: ChapterSlot): string => (slot.kind === "playable" ? slot.campaign.title : slot.title);

/** The playable chapters of a story, in story order. */
export const playableChapters = (s: StoryDef): CampaignDef[] => s.chapters.flatMap((c) => (c.kind === "playable" ? [c.campaign] : []));

export interface ChapterPlace {
  story: StoryDef;
  /** 1-based chapter number within the story. */
  number: number;
  total: number;
  /** The chapters after this one that are announced but not playable yet. */
  comingLater: string[];
}

/** Which story a playable chapter belongs to, and where in it. Null for a chapter no story lists (it still plays as before). */
export function chapterPlace(campaignId: string): ChapterPlace | null {
  for (const story of STORIES) {
    const i = story.chapters.findIndex((c) => c.kind === "playable" && c.campaign.id === campaignId);
    if (i < 0) continue;
    const comingLater = story.chapters.slice(i + 1).flatMap((c) => (c.kind === "planned" ? [c.title] : []));
    return { story, number: i + 1, total: story.chapters.length, comingLater };
  }
  return null;
}

/** The story a playable chapter belongs to: its progress, difficulty and awards are kept per story. */
export function storyOfChapter(campaignId: string): StoryDef | null {
  return chapterPlace(campaignId)?.story ?? null;
}

export function findStory(id: string | null | undefined): StoryDef | null {
  return STORIES.find((s) => s.id === id) ?? null;
}
