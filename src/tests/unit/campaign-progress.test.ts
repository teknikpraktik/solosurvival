import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAMPAIGNS, findCampaign, findMission } from "@/campaign";
import {
  canPlay, chapterCompletedCount, completedCount, evaluateAwards, highestAward, isStoryComplete, legacyChapterKey, loadProgress, markIntroSeen,
  missionStatus, newProgress, nextMission, recordResult, recordStart, saveProgress, setDifficulty, storyKey, verifiedLevel, type MissionResult,
  type StoryProgress,
} from "@/campaign/progress";
import { REGENESIS, type StoryDef } from "@/campaign/stories";
import type { CampaignDef } from "@/campaign/types";
import type { Difficulty } from "@/config/difficulty";
import { THE_FALL } from "@/campaign/the-fall";
import { RECORDED_BEATS } from "@/campaign/voice-manifest";
import { VOICE } from "@/app/_client/audio";

const c = THE_FALL;
function memory(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
}
const S = REGENESIS;
const F = "the-fall";
const rr = (p: StoryProgress, id: string, result: MissionResult, d: Difficulty = "normal", secs = 600, at = 1000, story: StoryDef = S, chapter = F) => recordResult(story, p, chapter, id, result, d, secs, at);
const win = (p: StoryProgress = newProgress(S), id: string, secs = 600, d: Difficulty = "normal") => rr(p, id, "survived", d, secs).progress;
const statuses = (p: StoryProgress, story: StoryDef = S, ch: CampaignDef = c) => ch.missions.map((m) => missionStatus(story, p, ch.id, m.id));
const winAll = (p: StoryProgress, d: Difficulty, story: StoryDef = S) => {
  for (const ch of story.chapters) if (ch.kind === "playable") for (const m of ch.campaign.missions) p = recordResult(story, p, ch.campaign.id, m.id, "survived", d, 500, 2000).progress;
  return p;
};
/** A second chapter, as a story that has grown: the same missions under another id. */
const CH2: CampaignDef = { ...c, id: "ch2", title: "CHAPTER TWO", missions: c.missions.slice(0, 2) };
const GROWN: StoryDef = { ...S, chapters: [{ kind: "playable", campaign: c }, { kind: "playable", campaign: CH2 }] };
const OTHER: StoryDef = { id: "other-story", title: "OTHER", chapters: [{ kind: "playable", campaign: { ...c, id: "other-ch" } }] };

describe("THE FALL: the campaign as data", () => {
  it("is the one campaign offered, with five missions in the story's order", () => {
    expect(CAMPAIGNS.map((x) => x.id)).toEqual(["the-fall"]);
    expect(c.missions.map((m) => m.title)).toEqual(["FIRST CONTACT", "THE SUPPLY RUN", "NO WAY BACK", "THE LAST SIGNAL", "FINAL EXTRACTION"]);
    expect(c.missions.map((m) => m.mode)).toEqual(["survival", "mission", "escape", "mission", "survival"]);
    expect(c.missions.map((m) => m.aboutMin)).toEqual([15, 20, 20, 25, 30]);
    expect(findCampaign("the-fall")).toBe(c);
    expect(findCampaign("nope")).toBeNull();
    expect(findMission({ id: "the-fall", mission: "03" })?.mission.title).toBe("NO WAY BACK");
    expect(findMission({ id: "the-fall", mission: "99" })).toBeNull();
    expect(findMission(undefined)).toBeNull();
  });

  it("has a picture for the cover and for every mission, in the repository", () => {
    const pub = path.join(import.meta.dirname, "..", "..", "..", "public");
    expect(existsSync(path.join(pub, c.cover))).toBe(true);
    c.missions.forEach((m, i) => {
      expect(m.image).toBe(`/campaign/the-fall/mission-0${i + 1}.jpg`);
      expect(existsSync(path.join(pub, m.image))).toBe(true);
    });
  });

  it("every mission has an intro, a goal, an opening line and a line for each way it can end", () => {
    for (const m of c.missions) {
      expect(m.intro.length).toBeGreaterThanOrEqual(2);
      expect(m.objective.length).toBeGreaterThan(20);
      expect(m.beats.filter((b) => b.trigger.on === "start")).toHaveLength(1);
      // A win is told either as the match ends or as the last goal is confirmed.
      expect(m.beats.some((b) => (b.trigger.on === "end" && b.trigger.result === "survived") || (b.trigger.on === "objective" && b.trigger.which === "last"))).toBe(true);
      expect(m.beats.some((b) => b.trigger.on === "end" && b.trigger.result === "infected")).toBe(true);
      // Mission 01 cannot run out of time (the clock running down is the win).
      if (m.layout.kind !== "survive") expect(m.beats.some((b) => b.trigger.on === "end" && b.trigger.result === "failed")).toBe(true);
    }
  });

  it("radio lines: unique permanent ids, known speakers, short enough to read on the move, stand-ins that exist", () => {
    const ids = c.missions.flatMap((m) => m.beats.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of c.missions) for (const b of m.beats) {
      expect(b.id).toMatch(new RegExp(`^tf-m${m.id}-[a-z0-9-]+$`));
      expect(c.speakers.some((s) => s.id === b.speaker)).toBe(true);
      expect(b.text.split(/\s+/).length).toBeLessThanOrEqual(40);
      if (b.fallbackVoice) expect(Object.keys(VOICE)).toContain(b.fallbackVoice);
    }
    // Only beats that exist may be listed as recorded, and every line listed has its file in the repository.
    const voice = path.join(import.meta.dirname, "..", "..", "..", "public", "campaign", "the-fall", "voice");
    for (const id of RECORDED_BEATS["the-fall"]) {
      expect(ids).toContain(id);
      expect(existsSync(path.join(voice, `${id}.mp3`)), id).toBe(true);
    }
  });
});

describe("story progress: unlocking, failure, replay", () => {
  it("a new story: no difficulty chosen, not started, nothing done, only the first mission open", () => {
    const p = newProgress(S);
    expect(p.difficulty).toBeNull();
    expect(p.started).toBe(false);
    expect(p.awards).toEqual({});
    expect(statuses(p)).toEqual(["next", "locked", "locked", "locked", "locked"]);
    expect(nextMission(S, p)).toEqual({ chapterId: F, missionId: "01" });
    expect(canPlay(S, p, F, "02")).toBe(false);
    expect(missionStatus(S, p, F, "nope")).toBe("locked");
    expect(missionStatus(S, p, "nope", "01")).toBe("locked");
  });

  it("choosing a difficulty does not begin the story; starting the first mission does", () => {
    const chosen = setDifficulty(newProgress(S), "easy");
    expect(chosen).toMatchObject({ difficulty: "easy", started: false });
    expect(setDifficulty(chosen, "easy")).toBe(chosen);
    const begun = recordStart(chosen, F, "01");
    expect(begun.started).toBe(true);
    expect(begun.chapters[F].missions["01"]).toMatchObject({ attempts: 1, introSeen: true, completed: false });
    expect(markIntroSeen(begun, F, "01")).toBe(begun);
    expect(markIntroSeen(begun, F, "02").chapters[F].missions["02"].introSeen).toBe(true);
  });

  it("winning a mission unlocks the next one, and only that, and records the difficulty it was won on", () => {
    const out = rr(newProgress(S), "01", "survived", "easy", 900, 5000);
    expect(out).toMatchObject({ firstCompletion: true, chapterCompleted: false, storyCompleted: false, improved: true, newAward: null, next: { chapterId: F, missionId: "02" } });
    expect(statuses(out.progress)).toEqual(["completed", "next", "locked", "locked", "locked"]);
    expect(out.progress.chapters[F].missions["01"]).toMatchObject({ completed: true, completedAt: 5000, bestTimeS: 900, bestDifficulty: "easy", bestDifficultyAt: 5000 });
  });

  it("capture and out of time fail the attempt only: nothing earlier is lost and the mission stays open", () => {
    let p = win(undefined, "01");
    for (const r of ["infected", "failed"] as const) {
      const out = rr(p, "02", r);
      expect(out.firstCompletion).toBe(false);
      p = out.progress;
    }
    expect(p.chapters[F].missions["02"]).toMatchObject({ completed: false, failures: 2 });
    expect(p.chapters[F].missions["02"].bestDifficulty).toBeUndefined();
    expect(p.chapters[F].missions["01"].completed).toBe(true);
    expect(statuses(p).slice(0, 3)).toEqual(["completed", "next", "locked"]);
  });

  it("quitting or an incomplete match changes nothing", () => {
    const p = win(undefined, "01");
    expect(rr(p, "02", "aborted").progress).toBe(p);
    expect(rr(p, "02", "incomplete").progress).toBe(p);
  });

  it("replaying a finished mission never takes progress away, whatever happens in the replay", () => {
    let p = win(win(undefined, "01", 700), "02");
    const at = p.chapters[F].missions["01"].completedAt;
    for (const r of ["infected", "failed", "aborted"] as const) p = rr(p, "01", r, "hard", 50, 9999).progress;
    expect(p.chapters[F].missions["01"]).toMatchObject({ completed: true, bestDifficulty: "normal" });
    expect(missionStatus(S, p, F, "03")).toBe("next");
    // A slower win keeps the best time and the first date; a faster one improves the time.
    const slower = rr(p, "01", "survived", "normal", 800, 9999);
    expect(slower).toMatchObject({ firstCompletion: false, improved: false });
    expect(slower.progress.chapters[F].missions["01"]).toMatchObject({ bestTimeS: 700, completedAt: at });
    expect(rr(p, "01", "survived", "normal", 650, 9999).progress.chapters[F].missions["01"].bestTimeS).toBe(650);
  });

  it("an EASY win is upgraded by a NORMAL and a HARD win; a later EASY win never lowers it", () => {
    let p = win(undefined, "01", 600, "easy");
    const normal = rr(p, "01", "survived", "normal", 700, 2000);
    expect(normal.improved).toBe(true);
    p = normal.progress;
    expect(p.chapters[F].missions["01"]).toMatchObject({ bestDifficulty: "normal", bestDifficultyAt: 2000, bestTimeS: 600 });
    p = rr(p, "01", "survived", "hard", 900, 3000).progress;
    expect(p.chapters[F].missions["01"]).toMatchObject({ bestDifficulty: "hard", bestDifficultyAt: 3000 });
    const easyAgain = rr(p, "01", "survived", "easy", 400, 4000);
    expect(easyAgain.improved).toBe(false);
    // The faster time counts (best time is kept on any difficulty), the difficulty record does not drop.
    expect(easyAgain.progress.chapters[F].missions["01"]).toMatchObject({ bestDifficulty: "hard", bestDifficultyAt: 3000, bestTimeS: 400 });
    expect(rr(easyAgain.progress, "01", "infected", "easy").progress.chapters[F].missions["01"].bestDifficulty).toBe("hard");
  });

  it("a win of a locked mission (edited storage, stale saved match) does not skip ahead", () => {
    const p = newProgress(S);
    const out = rr(p, "04", "survived", "hard");
    expect(out.progress).toBe(p);
    expect(missionStatus(S, out.progress, F, "04")).toBe("locked");
  });

  it("the last win completes the chapter and the story, once", () => {
    let p = newProgress(S);
    for (const id of ["01", "02", "03", "04"]) p = win(p, id);
    expect(isStoryComplete(S, p)).toBe(false);
    const out = rr(p, "05", "survived", "normal", 1500, 7777);
    expect(out).toMatchObject({ chapterCompleted: true, storyCompleted: true, next: null });
    expect(out.progress.completedAt).toBe(7777);
    expect(out.progress.chapters[F].completedAt).toBe(7777);
    expect(completedCount(S, out.progress)).toBe(5);
    expect(nextMission(S, out.progress)).toBeNull();
    // Winning it again is a replay, not a second completion.
    const again = rr(out.progress, "05", "survived", "normal", 1400, 8888);
    expect(again).toMatchObject({ chapterCompleted: false, storyCompleted: false, firstCompletion: false });
    expect(again.progress.completedAt).toBe(7777);
  });

  it("difficulty can be changed between missions: what is open, done and recorded stays as it was", () => {
    let p = win(win(undefined, "01", 600, "hard"), "02", 600, "easy");
    for (const d of ["easy", "hard", "normal"] as const) {
      p = setDifficulty(p, d);
      expect(p.difficulty).toBe(d);
      expect(statuses(p)).toEqual(["completed", "completed", "next", "locked", "locked"]);
      expect(p.chapters[F].missions["01"].bestDifficulty).toBe("hard");
      expect(p.chapters[F].missions["02"].bestDifficulty).toBe("easy");
    }
    // Completing on Easy unlocks exactly what completing on Hard does.
    expect(statuses(win(undefined, "01", 1, "easy"))).toEqual(statuses(win(undefined, "01", 1, "hard")));
  });
});

describe("story awards: SURVIVOR, VETERAN, LEGEND", () => {
  it("is earned when every mission is won on at least that difficulty, and the lower ones come with it", () => {
    let p = winAll(newProgress(S), "easy");
    expect(highestAward(p)).toBe("easy");
    expect(Object.keys(p.awards)).toEqual(["easy"]);
    p = winAll(p, "hard");
    expect(highestAward(p)).toBe("hard");
    expect(Object.keys(p.awards).sort()).toEqual(["easy", "hard", "normal"]);
    expect(p.awards.hard!.missions).toEqual(["01", "02", "03", "04", "05"].map((m) => `${F}/${m}`));
  });

  it("the lowest difficulty over all missions decides: HARD on most and NORMAL on one is VETERAN, until that one is won on HARD", () => {
    // Four on HARD, the last on NORMAL.
    let p = newProgress(S);
    for (const id of ["01", "02", "03", "04"]) p = win(p, id, 600, "hard");
    const last = rr(p, "05", "survived", "normal", 600, 5000);
    expect(last.newAward).toBe("normal");
    p = last.progress;
    expect(verifiedLevel(S, p)).toBe("normal");
    expect(highestAward(p)).toBe("normal");
    const up = rr(p, "05", "survived", "hard", 600, 6000);
    expect(up.newAward).toBe("hard");
    expect(highestAward(up.progress)).toBe("hard");
    expect(up.progress.awards.normal!.earnedAt).toBe(5000);
    expect(up.progress.awards.hard!.earnedAt).toBe(6000);
  });

  it("counts every chapter of the story", () => {
    let p = newProgress(GROWN);
    for (const m of c.missions) p = rr(p, m.id, "survived", "hard", 600, 1, GROWN).progress; // only THE FALL won
    expect(highestAward(p)).toBeNull();
    expect(highestAward(evaluateAwards(GROWN, p, 1))).toBeNull();
    expect(missionStatus(GROWN, p, "ch2", "01")).toBe("next");
    expect(missionStatus(GROWN, p, "ch2", "02")).toBe("locked");
    expect(nextMission(GROWN, p)).toEqual({ chapterId: "ch2", missionId: "01" });
    p = rr(p, "01", "survived", "hard", 600, 1, GROWN, "ch2").progress;
    expect(highestAward(p)).toBeNull();
    const out = rr(p, "02", "survived", "easy", 600, 2, GROWN, "ch2");
    expect(out).toMatchObject({ chapterCompleted: true, storyCompleted: true, newAward: "easy" });
    expect(out.progress.awards.easy!.missions).toHaveLength(7);
    expect(chapterCompletedCount(CH2, out.progress)).toBe(2);
  });

  it("an earned award is permanent: a later chapter, a lower replay or a fresh evaluation never takes it away", () => {
    const legend = winAll(newProgress(S), "hard");
    expect(highestAward(legend)).toBe("hard");
    // The story grows by a chapter: the award stays, with the missions it was earned on.
    const store = memory();
    saveProgress(store, legend);
    const grown = loadProgress(store, GROWN);
    expect(highestAward(grown)).toBe("hard");
    expect(grown.awards.hard!.missions).toHaveLength(5);
    expect(missionStatus(GROWN, grown, "ch2", "01")).toBe("next");
    expect(highestAward(evaluateAwards(GROWN, grown, 9))).toBe("hard");
    // Replays on Easy do not lower anything.
    expect(highestAward(winAll(legend, "easy"))).toBe("hard");
  });

  it("is never given for wins without a recorded difficulty, nor for a difficulty written into storage for a mission not won", () => {
    const raw = { v: 2, storyId: S.id, difficulty: "hard", started: true, chapters: { [F]: { missions: Object.fromEntries(c.missions.map((m) => [m.id, { completed: m.id !== "05", bestDifficulty: "hard" }])) } } };
    const p = loadProgress(memory({ [storyKey(S.id)]: JSON.stringify(raw) }), S);
    expect(p.chapters[F].missions["05"].bestDifficulty).toBeUndefined();
    expect(verifiedLevel(S, p)).toBeNull();
    expect(highestAward(p)).toBeNull();
  });
});

describe("story progress: kept on the device", () => {
  it("is saved under the story's own key and read back unchanged", () => {
    const store = memory();
    const p = setDifficulty(win(recordStart(newProgress(S), F, "01"), "01", 812, "hard"), "easy");
    expect(saveProgress(store, p)).toBe(true);
    expect([...store.raw.keys()]).toEqual([storyKey("regenesis")]);
    expect(loadProgress(store, S)).toEqual(p);
    const legend = winAll(newProgress(S), "hard");
    saveProgress(store, legend);
    expect(loadProgress(store, S)).toEqual(legend);
  });

  it("different stories keep separate progress, difficulty and awards", () => {
    const store = memory();
    saveProgress(store, winAll(setDifficulty(newProgress(S), "hard"), "hard"));
    const other = loadProgress(store, OTHER);
    expect(other).toEqual(newProgress(OTHER));
    expect(other.difficulty).toBeNull();
    saveProgress(store, setDifficulty(other, "easy"));
    expect(loadProgress(store, S).difficulty).toBe("hard");
    expect(highestAward(loadProgress(store, S))).toBe("hard");
    expect([...store.raw.keys()].sort()).toEqual([storyKey("other-story"), storyKey("regenesis")]);
  });

  it("no storage, unreadable or foreign data: a new story, never a crash and never extra unlocks", () => {
    expect(loadProgress(null, S)).toEqual(newProgress(S));
    expect(saveProgress(null, newProgress(S))).toBe(false);
    for (const bad of ["{not json", "42", "null", "[]", JSON.stringify({ chapters: "x", difficulty: "nightmare", awards: { hard: { earnedAt: "x" } } })]) {
      for (const key of [storyKey(S.id), legacyChapterKey(F)]) {
        const p = loadProgress(memory({ [key]: bad }), S);
        expect(p.difficulty).toBeNull();
        expect(highestAward(p)).toBeNull();
        expect(completedCount(S, p)).toBe(0);
        expect(nextMission(S, p)).toEqual({ chapterId: F, missionId: "01" });
      }
    }
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(loadProgress(throwing, S)).toEqual(newProgress(S));
    expect(saveProgress(throwing, newProgress(S))).toBe(false);
  });

  it("a later mission marked done in storage without the ones before it stays locked until they are done", () => {
    const raw = { v: 2, storyId: S.id, difficulty: "easy", chapters: { [F]: { missions: { "03": { completed: true, attempts: 1 }, "zz": { completed: true } } }, gone: { missions: {} } } };
    const p = loadProgress(memory({ [storyKey(S.id)]: JSON.stringify(raw) }), S);
    expect(p.difficulty).toBe("easy");
    expect(Object.keys(p.chapters)).toEqual([F]);
    expect(Object.keys(p.chapters[F].missions)).toEqual(["01", "02", "03", "04", "05"]);
    expect(nextMission(S, p)).toEqual({ chapterId: F, missionId: "01" });
    expect(canPlay(S, p, F, "02")).toBe(false);
    expect(canPlay(S, p, F, "04")).toBe(false);
  });
});

describe("migration from v1 (one record per chapter, no recorded difficulty)", () => {
  const v1 = {
    v: 1, campaignId: F, started: true, difficulty: "hard", completedAt: 4444,
    missions: {
      "01": { completed: true, completedAt: 1111, attempts: 3, failures: 1, bestTimeS: 905, introSeen: true },
      "02": { completed: true, completedAt: 2222, attempts: 1, failures: 0, bestTimeS: 1200, introSeen: true },
      "03": { completed: false, attempts: 2, failures: 2, introSeen: true },
    },
  };

  it("keeps wins, unlocks, times, counters and the chosen difficulty, and gives no win a difficulty or an award", () => {
    const store = memory({ [legacyChapterKey(F)]: JSON.stringify(v1) });
    const p = loadProgress(store, S);
    expect(p).toMatchObject({ v: 2, storyId: S.id, difficulty: "hard", started: true, awards: {} });
    expect(p.chapters[F].missions["01"]).toEqual({ completed: true, completedAt: 1111, attempts: 3, failures: 1, bestTimeS: 905, introSeen: true });
    expect(p.chapters[F].missions["02"]).toMatchObject({ completed: true, bestTimeS: 1200 });
    expect(p.chapters[F].missions["03"]).toMatchObject({ completed: false, attempts: 2, failures: 2 });
    expect(statuses(p)).toEqual(["completed", "completed", "next", "locked", "locked"]);
    expect(c.missions.every((m) => p.chapters[F].missions[m.id].bestDifficulty === undefined)).toBe(true);
    expect(highestAward(p)).toBeNull();
    // An old win is verified by playing the mission again.
    const replay = rr(p, "01", "survived", "hard", 950, 9000);
    expect(replay).toMatchObject({ firstCompletion: false, improved: true });
    expect(replay.progress.chapters[F].missions["01"]).toMatchObject({ bestDifficulty: "hard", bestTimeS: 905, completedAt: 1111 });
  });

  it("is idempotent and survives an interrupted update: reading, saving and reading again changes nothing, and the v1 record is kept", () => {
    const store = memory({ [legacyChapterKey(F)]: JSON.stringify(v1) });
    const once = loadProgress(store, S);
    expect(loadProgress(store, S)).toEqual(once);
    saveProgress(store, once);
    expect(loadProgress(store, S)).toEqual(once);
    expect(store.raw.get(legacyChapterKey(F))).toBe(JSON.stringify(v1));
    // Played on after the migration: the v1 record merged in again takes nothing away and adds nothing twice.
    const later = rr(recordStart(once, F, "03"), "03", "survived", "normal", 1300, 9000).progress;
    saveProgress(store, later);
    const back = loadProgress(store, S);
    expect(back).toEqual(later);
    expect(back.chapters[F].missions["03"]).toMatchObject({ completed: true, attempts: 3, bestDifficulty: "normal" });
  });

  it("a v1 difficulty that was only chosen is kept as the default, but does not mark the story as begun", () => {
    const chosen = { v: 1, campaignId: F, started: true, difficulty: "easy", missions: {} };
    const p = loadProgress(memory({ [legacyChapterKey(F)]: JSON.stringify(chosen) }), S);
    expect(p).toMatchObject({ difficulty: "easy", started: false });
    const fresh = { v: 1, campaignId: F, started: false, difficulty: "hard", missions: {} };
    expect(loadProgress(memory({ [legacyChapterKey(F)]: JSON.stringify(fresh) }), S).difficulty).toBeNull();
  });

  it("a v2 choice wins over the v1 one, and wins of either record are kept", () => {
    const v2 = setDifficulty(win(newProgress(S), "01", 800, "easy"), "normal");
    const store = memory({ [legacyChapterKey(F)]: JSON.stringify(v1), [storyKey(S.id)]: JSON.stringify(v2) });
    const p = loadProgress(store, S);
    expect(p.difficulty).toBe("normal");
    expect(p.chapters[F].missions["01"]).toMatchObject({ completed: true, completedAt: 1000, bestTimeS: 800, bestDifficulty: "easy", attempts: 3 });
    expect(p.chapters[F].missions["02"].completed).toBe(true);
  });
});
