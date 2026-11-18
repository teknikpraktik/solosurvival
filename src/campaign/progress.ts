/**
 * Campaign progress on this device, kept per STORY (stories.ts): the default difficulty, which missions of every chapter are done and on
 * which difficulty, which intros have been seen, and the story's awards. Kept in localStorage under one key per story, the same way New
 * game keeps its last setup: no account, no database, nothing leaves the device.
 *
 * Pure functions on a plain object, so the rules (unlocking, replay, failure, awards, migration) are tested without a browser. Nothing a
 * player has earned is ever taken away: a failed or quit mission changes nothing but its own counters, a replay on a lower difficulty
 * never lowers a record, and an award, once earned, is kept even if the story later gets more missions.
 *
 * Storage history:
 * - v1 (`outbreak.campaign.<chapter id>`): one record per chapter, a difficulty that could be changed at any time and no record of the
 *   difficulty a mission was won on. It is never written again and never deleted (an older build can still read it), but it is merged
 *   into v2 on every read, so a v1 record is migrated however often the app is opened, closed or updated half-way.
 * - v2 (`outbreak.story.<story id>`): this file.
 */
import type { Difficulty } from "@/config/difficulty";
import { playableChapters, type StoryDef } from "./stories";
import type { CampaignDef, MissionDef } from "./types";

export const PROGRESS_VERSION = 2;
export const storyKey = (storyId: string): string => `outbreak.story.${storyId}`;
/** Where v1 kept a chapter's progress. Read for migration only. */
export const legacyChapterKey = (chapterId: string): string => `outbreak.campaign.${chapterId}`;

export const DIFFICULTY_ORDER: readonly Difficulty[] = ["easy", "normal", "hard"];
const rank = (d: Difficulty): number => DIFFICULTY_ORDER.indexOf(d);
const isDifficulty = (x: unknown): x is Difficulty => DIFFICULTY_ORDER.includes(x as Difficulty);
/** The higher of two difficulties (either may be missing). */
const higher = (a: Difficulty | undefined, b: Difficulty | undefined): Difficulty | undefined => (!a ? b : !b ? a : rank(a) >= rank(b) ? a : b);

export interface MissionProgress {
  completed: boolean;
  /** When it was first won (ms). */
  completedAt?: number;
  /** Matches started, and how many of them ended in capture or out of time. */
  attempts: number;
  failures: number;
  /** Fastest win (s of game time), on any difficulty. */
  bestTimeS?: number;
  /** The cinematic intro has been shown (it is skipped from then on; the briefing is always shown). */
  introSeen: boolean;
  /**
   * The highest difficulty the mission has been won on, as recorded with the match. Missing for a mission won before v2 (the difficulty
   * was not kept then): it is done and unlocks what follows, but counts towards no award until it is won again.
   */
  bestDifficulty?: Difficulty;
  /** When `bestDifficulty` was first reached (ms). */
  bestDifficultyAt?: number;
}

export interface ChapterProgress {
  missions: Record<string, MissionProgress>;
  /** When the chapter's last mission was first won (ms). */
  completedAt?: number;
}

/** An award (EASY → SURVIVOR, NORMAL → VETERAN, HARD → LEGEND): every mission of the story won on at least that difficulty. */
export interface Award {
  earnedAt: number;
  /** The missions ("chapter/mission") the story had when it was earned. Kept so a later chapter can never take the award away. */
  missions: string[];
}

export interface StoryProgress {
  v: number;
  storyId: string;
  /** The difficulty new missions start on. Null until the player chooses one; it can be changed between missions. */
  difficulty: Difficulty | null;
  /** A mission has been started (choosing a difficulty alone does not begin the story). */
  started: boolean;
  chapters: Record<string, ChapterProgress>;
  /** Earned awards. Only ever added to. */
  awards: Partial<Record<Difficulty, Award>>;
  /** When the story's last mission was first won (ms). */
  completedAt?: number;
}

export type MissionStatus = "completed" | "next" | "locked";
export type MissionResult = "survived" | "infected" | "failed" | "aborted" | "incomplete";
export interface MissionPlace { chapterId: string; missionId: string }
export interface StoryMission extends MissionPlace { chapter: CampaignDef; mission: MissionDef; key: string }

type KV = Pick<Storage, "getItem" | "setItem">;

export const missionKey = (chapterId: string, missionId: string): string => `${chapterId}/${missionId}`;

/** Every mission of the story's playable chapters, in story order. */
export function storyMissions(s: StoryDef): StoryMission[] {
  return playableChapters(s).flatMap((chapter) => chapter.missions.map((mission) => ({ chapter, mission, chapterId: chapter.id, missionId: mission.id, key: missionKey(chapter.id, mission.id) })));
}

const emptyMission = (): MissionProgress => ({ completed: false, attempts: 0, failures: 0, introSeen: false });
const emptyChapter = (c: CampaignDef): ChapterProgress => ({ missions: Object.fromEntries(c.missions.map((m) => [m.id, emptyMission()])) });

export function newProgress(s: StoryDef): StoryProgress {
  return { v: PROGRESS_VERSION, storyId: s.id, difficulty: null, started: false, chapters: Object.fromEntries(playableChapters(s).map((c) => [c.id, emptyChapter(c)])), awards: {} };
}

const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);
const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const minDefined = (a: number | undefined, b: number | undefined): number | undefined => (a === undefined ? b : b === undefined ? a : Math.min(a, b));

function readMission(x: unknown, withDifficulty: boolean): MissionProgress | null {
  const s = obj(x);
  if (!s) return null;
  const m: MissionProgress = {
    completed: s.completed === true,
    completedAt: num(s.completedAt),
    attempts: num(s.attempts) ?? 0,
    failures: num(s.failures) ?? 0,
    bestTimeS: num(s.bestTimeS),
    introSeen: s.introSeen === true,
  };
  // A recorded difficulty only counts for a mission that is done: storage cannot hand out an award for a mission never won.
  if (withDifficulty && m.completed && isDifficulty(s.bestDifficulty)) { m.bestDifficulty = s.bestDifficulty; m.bestDifficultyAt = num(s.bestDifficultyAt); }
  return m;
}

/** Two records of the same mission as one: nothing either of them earned is lost. Merging a record with itself changes nothing. */
function mergeMission(a: MissionProgress, b: MissionProgress): MissionProgress {
  const m: MissionProgress = {
    completed: a.completed || b.completed,
    completedAt: minDefined(a.completedAt, b.completedAt),
    attempts: Math.max(a.attempts, b.attempts),
    failures: Math.max(a.failures, b.failures),
    bestTimeS: minDefined(a.bestTimeS, b.bestTimeS),
    introSeen: a.introSeen || b.introSeen,
  };
  const best = higher(a.bestDifficulty, b.bestDifficulty);
  if (best) {
    m.bestDifficulty = best;
    const at = [a, b].filter((x) => x.bestDifficulty === best).map((x) => x.bestDifficultyAt);
    m.bestDifficultyAt = at.reduce<number | undefined>((x, y) => minDefined(x, y), undefined);
  }
  for (const k of ["completedAt", "bestTimeS", "bestDifficultyAt"] as const) if (m[k] === undefined) delete m[k];
  return m;
}

/** v1: one chapter's record, as v2 chapter progress. The difficulty it was played on is unknown, so no mission gets one. */
function readLegacyChapter(store: KV | null | undefined, c: CampaignDef): { chapter: ChapterProgress; difficulty: Difficulty | null; played: boolean } | null {
  let raw: unknown;
  try { raw = JSON.parse(store?.getItem(legacyChapterKey(c.id)) ?? "null"); } catch { return null; }
  const r = obj(raw);
  if (!r) return null;
  const saved = obj(r.missions) ?? {};
  const chapter = emptyChapter(c);
  for (const m of c.missions) {
    const mp = readMission(saved[m.id], false);
    if (mp) chapter.missions[m.id] = mp;
  }
  if (num(r.completedAt) !== undefined && c.missions.every((m) => chapter.missions[m.id].completed)) chapter.completedAt = num(r.completedAt);
  const played = c.missions.some((m) => chapter.missions[m.id].attempts > 0 || chapter.missions[m.id].completed);
  // v1 set `started` when a difficulty was chosen: that choice is kept as the default, it is not a sign that a mission was played.
  return { chapter, difficulty: r.started === true && isDifficulty(r.difficulty) ? r.difficulty : null, played };
}

/**
 * Reads the story's saved progress, with any v1 chapter records merged in. Anything missing, unreadable or of an unknown shape falls back
 * to a value that cannot unlock more than was earned: a damaged entry is a mission not yet done, a missing key is a new story. Missions
 * and chapters the story no longer has are dropped from the result; awards are kept as they were earned.
 */
export function loadProgress(store: KV | null | undefined, s: StoryDef): StoryProgress {
  const p = newProgress(s);
  let raw: unknown = null;
  try { raw = JSON.parse(store?.getItem(storyKey(s.id)) ?? "null"); } catch { raw = null; }
  const r = obj(raw);
  if (r) {
    const chapters = obj(r.chapters) ?? {};
    for (const c of playableChapters(s)) {
      const sc = obj(chapters[c.id]);
      if (!sc) continue;
      const ms = obj(sc.missions) ?? {};
      for (const m of c.missions) {
        const mp = readMission(ms[m.id], true);
        if (mp) p.chapters[c.id].missions[m.id] = mp;
      }
      if (num(sc.completedAt) !== undefined && c.missions.every((m) => p.chapters[c.id].missions[m.id].completed)) p.chapters[c.id].completedAt = num(sc.completedAt);
    }
    p.difficulty = isDifficulty(r.difficulty) ? r.difficulty : null;
    p.started = r.started === true;
    p.completedAt = num(r.completedAt);
    const awards = obj(r.awards) ?? {};
    for (const d of DIFFICULTY_ORDER) {
      const a = obj(awards[d]);
      const at = a ? num(a.earnedAt) : undefined;
      if (a && at !== undefined && Array.isArray(a.missions) && a.missions.every((x) => typeof x === "string")) p.awards[d] = { earnedAt: at, missions: a.missions as string[] };
    }
  }
  // v1 → v2: merged on every read, so the migration needs no flag and survives an update that was interrupted half-way.
  for (const c of playableChapters(s)) {
    const legacy = readLegacyChapter(store, c);
    if (!legacy) continue;
    const ch = p.chapters[c.id];
    for (const m of c.missions) ch.missions[m.id] = mergeMission(ch.missions[m.id], legacy.chapter.missions[m.id]);
    ch.completedAt = minDefined(ch.completedAt, legacy.chapter.completedAt);
    if (ch.completedAt === undefined) delete ch.completedAt;
    p.difficulty ??= legacy.difficulty;
    p.started ||= legacy.played;
  }
  p.started ||= storyMissions(s).some((x) => { const mp = p.chapters[x.chapterId].missions[x.missionId]; return mp.attempts > 0 || mp.completed; });
  if (p.completedAt === undefined) delete p.completedAt;
  return p;
}

/** Saves the progress. Returns false when the device would not keep it (private mode, storage full); the game goes on either way. */
export function saveProgress(store: KV | null | undefined, p: StoryProgress): boolean {
  if (!store) return false;
  try { store.setItem(storyKey(p.storyId), JSON.stringify(p)); return true; } catch { return false; }
}

export const missionProgress = (p: StoryProgress, chapterId: string, missionId: string): MissionProgress | undefined => p.chapters[chapterId]?.missions[missionId];

/** A mission is open when every mission before it in the story, in every chapter, has been won. Difficulty never changes what is open. */
export function missionStatus(s: StoryDef, p: StoryProgress, chapterId: string, missionId: string): MissionStatus {
  const all = storyMissions(s);
  const i = all.findIndex((x) => x.chapterId === chapterId && x.missionId === missionId);
  if (i < 0) return "locked";
  if (missionProgress(p, chapterId, missionId)?.completed) return "completed";
  return all.slice(0, i).every((x) => missionProgress(p, x.chapterId, x.missionId)?.completed) ? "next" : "locked";
}

export const canPlay = (s: StoryDef, p: StoryProgress, chapterId: string, missionId: string): boolean => missionStatus(s, p, chapterId, missionId) !== "locked";

/** The mission to play next: the first one in the story not yet won, or null when the story is complete. */
export function nextMission(s: StoryDef, p: StoryProgress): MissionPlace | null {
  const x = storyMissions(s).find((m) => !missionProgress(p, m.chapterId, m.missionId)?.completed);
  return x ? { chapterId: x.chapterId, missionId: x.missionId } : null;
}

export const completedCount = (s: StoryDef, p: StoryProgress): number => storyMissions(s).filter((x) => missionProgress(p, x.chapterId, x.missionId)?.completed).length;
export const isStoryComplete = (s: StoryDef, p: StoryProgress): boolean => completedCount(s, p) === storyMissions(s).length;
export const chapterCompletedCount = (c: CampaignDef, p: StoryProgress): number => c.missions.filter((m) => missionProgress(p, c.id, m.id)?.completed).length;
export const isChapterComplete = (c: CampaignDef, p: StoryProgress): boolean => chapterCompletedCount(c, p) === c.missions.length;

function withMission(p: StoryProgress, chapterId: string, missionId: string, patch: Partial<MissionProgress>): StoryProgress {
  const ch = p.chapters[chapterId] ?? { missions: {} };
  return { ...p, chapters: { ...p.chapters, [chapterId]: { ...ch, missions: { ...ch.missions, [missionId]: { ...(ch.missions[missionId] ?? emptyMission()), ...patch } } } } };
}

/** Choosing (or changing) the default difficulty. It applies to missions started from now on, resets nothing and begins nothing. */
export function setDifficulty(p: StoryProgress, difficulty: Difficulty): StoryProgress {
  return p.difficulty === difficulty ? p : { ...p, difficulty };
}

export function markIntroSeen(p: StoryProgress, chapterId: string, missionId: string): StoryProgress {
  return missionProgress(p, chapterId, missionId)?.introSeen ? p : withMission(p, chapterId, missionId, { introSeen: true });
}

/** A mission match began: the story has begun. */
export function recordStart(p: StoryProgress, chapterId: string, missionId: string): StoryProgress {
  return { ...withMission(p, chapterId, missionId, { attempts: (missionProgress(p, chapterId, missionId)?.attempts ?? 0) + 1, introSeen: true }), started: true };
}

/** The highest award earned, or null. */
export function highestAward(p: StoryProgress): Difficulty | null {
  for (let i = DIFFICULTY_ORDER.length - 1; i >= 0; i--) if (p.awards[DIFFICULTY_ORDER[i]]) return DIFFICULTY_ORDER[i];
  return null;
}

/** The highest difficulty every mission of the story (as it is now) has been won on, or null. */
export function verifiedLevel(s: StoryDef, p: StoryProgress): Difficulty | null {
  let level: Difficulty | null = "hard";
  for (const x of storyMissions(s)) {
    const d = missionProgress(p, x.chapterId, x.missionId)?.bestDifficulty;
    if (!d) return null;
    if (level && rank(d) < rank(level)) level = d;
  }
  return level;
}

/**
 * Adds the awards the mission results now qualify for, and the lower ones with them. Awards already earned are never touched: they keep
 * their date and the missions they were earned with, whatever the story looks like now.
 */
export function evaluateAwards(s: StoryDef, p: StoryProgress, nowMs: number): StoryProgress {
  const level = verifiedLevel(s, p);
  if (!level) return p;
  const missions = storyMissions(s).map((x) => x.key);
  let awards = p.awards;
  for (const d of DIFFICULTY_ORDER.slice(0, rank(level) + 1)) if (!awards[d]) awards = { ...awards, [d]: { earnedAt: nowMs, missions } };
  return awards === p.awards ? p : { ...p, awards };
}

export interface ResultOutcome {
  progress: StoryProgress;
  /** This win is the mission's first (it unlocked what comes next). */
  firstCompletion: boolean;
  /** This win completed the mission's chapter for the first time. */
  chapterCompleted: boolean;
  /** This win completed the story for the first time. */
  storyCompleted: boolean;
  /** This win raised the mission's best difficulty (a first win counts). */
  improved: boolean;
  /** The highest award this result earned, if it earned one. */
  newAward: Difficulty | null;
  /** The mission that follows this one in the story, if any. */
  next: MissionPlace | null;
}

/**
 * How a mission match ended, on the difficulty the match was started with. A win marks the mission done, keeps the best time and raises
 * its best difficulty; capture and out of time count as a failure of that attempt only; quit and incomplete matches change nothing. No
 * result ever removes a win, lowers a recorded difficulty, locks a mission again or takes an award away.
 */
export function recordResult(s: StoryDef, p: StoryProgress, chapterId: string, missionId: string, result: MissionResult, difficulty: Difficulty, elapsedS: number, nowMs: number): ResultOutcome {
  const all = storyMissions(s);
  const i = all.findIndex((x) => x.chapterId === chapterId && x.missionId === missionId);
  const after = i >= 0 ? all[i + 1] : undefined;
  const next = after ? { chapterId: after.chapterId, missionId: after.missionId } : null;
  const cur = missionProgress(p, chapterId, missionId);
  const none = { progress: p, firstCompletion: false, chapterCompleted: false, storyCompleted: false, improved: false, newAward: null, next };
  if (i < 0 || !cur) return none;
  if (result === "infected" || result === "failed") return { ...none, progress: { ...withMission(p, chapterId, missionId, { failures: cur.failures + 1 }), started: true } };
  if (result !== "survived" || !isDifficulty(difficulty)) return none;
  // A win only counts for a mission that was open: a saved match of a locked mission (edited storage) cannot skip ahead.
  if (!canPlay(s, p, chapterId, missionId)) return none;
  const firstCompletion = !cur.completed;
  const improved = !cur.bestDifficulty || rank(difficulty) > rank(cur.bestDifficulty);
  let progress: StoryProgress = { ...p, started: true };
  progress = withMission(progress, chapterId, missionId, {
    completed: true,
    completedAt: cur.completedAt ?? nowMs,
    bestTimeS: cur.bestTimeS === undefined ? Math.round(elapsedS) : Math.min(cur.bestTimeS, Math.round(elapsedS)),
    ...(improved ? { bestDifficulty: difficulty, bestDifficultyAt: nowMs } : {}),
  });
  const chapter = all[i].chapter;
  const chapterCompleted = firstCompletion && isChapterComplete(chapter, progress);
  if (chapterCompleted) progress = { ...progress, chapters: { ...progress.chapters, [chapterId]: { ...progress.chapters[chapterId], completedAt: nowMs } } };
  const storyCompleted = firstCompletion && isStoryComplete(s, progress);
  if (storyCompleted) progress = { ...progress, completedAt: nowMs };
  const before = highestAward(progress);
  progress = evaluateAwards(s, progress, nowMs);
  const nowAward = highestAward(progress);
  return { progress, firstCompletion, chapterCompleted, storyCompleted, improved, newAward: nowAward !== before ? nowAward : null, next };
}
