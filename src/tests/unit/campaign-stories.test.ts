/**
 * Stories above chapters (src/campaign/stories.ts): REGENESIS lists THE FALL as chapter 1 without changing anything a saved game or a
 * recorded line refers to, and the story's chapters match the canonical Story Bible.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAMPAIGNS, chapterPlace, findCampaign, findMission, STORIES } from "@/campaign";
import { legacyChapterKey, loadProgress, storyKey } from "@/campaign/progress";
import { chapterId, chapterTitle, REGENESIS } from "@/campaign/stories";
import { THE_FALL } from "@/campaign/the-fall";

describe("stories: Story → Chapter → Mission", () => {
  it("REGENESIS: THE FALL is chapter 1 and the only playable one; four chapters are announced by name", () => {
    expect(STORIES.map((s) => s.title)).toEqual(["REGENESIS"]);
    expect(REGENESIS.chapters.map(chapterTitle)).toEqual(["THE FALL", "GROUND ZERO", "THE HUNT", "NO MAN'S LAND", "THE LAST HOPE"]);
    expect(CAMPAIGNS).toEqual([THE_FALL]);
    expect(chapterPlace("the-fall")).toMatchObject({ story: REGENESIS, number: 1, total: 5, comingLater: ["GROUND ZERO", "THE HUNT", "NO MAN'S LAND", "THE LAST HOPE"] });
    expect(chapterPlace("ground-zero")).toBeNull();
    expect(findCampaign("ground-zero")).toBeNull();
  });

  it("chapter ids are unique across all stories, so a chapter's saved progress can never be shared", () => {
    const ids = STORIES.flatMap((s) => s.chapters.map(chapterId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the chapter keeps its id and mission ids; progress is kept per story and the chapter's v1 record still loads", () => {
    expect(THE_FALL.id).toBe("the-fall");
    expect(legacyChapterKey(THE_FALL.id)).toBe("outbreak.campaign.the-fall");
    expect(storyKey(REGENESIS.id)).toBe("outbreak.story.regenesis");
    expect(THE_FALL.missions.map((m) => m.id)).toEqual(["01", "02", "03", "04", "05"]);
    expect(findMission({ id: "the-fall", mission: "01" })?.mission.title).toBe("FIRST CONTACT");
    // Progress saved before stories existed loads as it was.
    const saved = { v: 1, campaignId: "the-fall", started: true, difficulty: "hard", missions: { "01": { completed: true, attempts: 2, failures: 1, bestTimeS: 900, introSeen: true } } };
    const store = { getItem: (k: string) => (k === "outbreak.campaign.the-fall" ? JSON.stringify(saved) : null), setItem: () => {} };
    const p = loadProgress(store, REGENESIS);
    expect(p.difficulty).toBe("hard");
    expect(p.chapters["the-fall"].missions["01"]).toMatchObject({ completed: true, attempts: 2, bestTimeS: 900 });
    expect(p.chapters["the-fall"].missions["01"].bestDifficulty).toBeUndefined();
  });

  it("matches the Story Bible: title and chapter order", () => {
    const bible = readFileSync(path.join(import.meta.dirname, "..", "..", "..", "docs", "OUTBREAK_STORY_BIBLE_V2_2.md"), "utf8");
    expect(bible.split("\n")[0]).toBe(`# OUTBREAK: ${REGENESIS.title}`);
    const chapters = [...bible.matchAll(/^## \d+\. Kapitel (\d+) – (.+?) \[/gm)].map((m) => [Number(m[1]), m[2]]);
    expect(chapters).toEqual(REGENESIS.chapters.map((c, i) => [i + 1, chapterTitle(c)]));
  });
});
