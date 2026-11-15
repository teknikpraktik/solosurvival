/**
 * Campaign progress on this device: which missions are done, the chosen difficulty, which intros have been seen. Kept in localStorage
 * (one key per campaign), the same way New game keeps its last setup: no account, no database, nothing leaves the device.
 *
 * Pure functions on a plain object, so the rules (unlocking, replay, failure) are tested without a browser. A campaign can never be
 * lost: a failed or quit mission changes nothing but its own counters, and replaying a finished mission never takes anything away.
 */
import type { Difficulty } from "@/config/difficulty";
import type { CampaignDef } from "./types";

export const PROGRESS_VERSION = 1;
export const progressKey = (campaignId: string): string => `outbreak.campaign.${campaignId}`;

export interface MissionProgress {
  completed: boolean;
  /** When it was first won (ms). */
  completedAt?: number;
  /** Matches started, and how many of them ended in capture or out of time. */
  attempts: number;
  failures: number;
  /** Fastest win (s of game time). */
  bestTimeS?: number;
  /** The cinematic intro has been shown (it is skipped from then on; the briefing is always shown). */
  introSeen: boolean;
}

export interface CampaignProgress {
  v: number;
  campaignId: string;
  /** The player has chosen a difficulty and begun. */
  started: boolean;
  difficulty: Difficulty;
  missions: Record<string, MissionProgress>;
  /** When the last mission was first won (ms). */
  completedAt?: number;
}

export type MissionStatus = "completed" | "next" | "locked";
export type MissionResult = "survived" | "infected" | "failed" | "aborted" | "incomplete";

type KV = Pick<Storage, "getItem" | "setItem">;
const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];
const emptyMission = (): MissionProgress => ({ completed: false, attempts: 0, failures: 0, introSeen: false });

export function newProgress(c: CampaignDef): CampaignProgress {
  return { v: PROGRESS_VERSION, campaignId: c.id, started: false, difficulty: "normal", missions: Object.fromEntries(c.missions.map((m) => [m.id, emptyMission()])) };
}

const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);

/**
 * Reads the saved progress. Anything missing, unreadable or of an unknown shape falls back to a value that cannot unlock more than was
 * earned: a damaged entry is a mission not yet done, a missing key is a new campaign. Missions the campaign no longer has are dropped.
 */
export function loadProgress(store: KV | null | undefined, c: CampaignDef): CampaignProgress {
  const fresh = newProgress(c);
  let raw: unknown;
  try { raw = JSON.parse(store?.getItem(progressKey(c.id)) ?? "null"); } catch { return fresh; }
  if (!raw || typeof raw !== "object") return fresh;
  const r = raw as Record<string, unknown>;
  const saved = r.missions && typeof r.missions === "object" ? (r.missions as Record<string, Record<string, unknown> | undefined>) : {};
  for (const m of c.missions) {
    const s = saved[m.id];
    if (!s || typeof s !== "object") continue;
    fresh.missions[m.id] = {
      completed: s.completed === true,
      completedAt: num(s.completedAt),
      attempts: num(s.attempts) ?? 0,
      failures: num(s.failures) ?? 0,
      bestTimeS: num(s.bestTimeS),
      introSeen: s.introSeen === true,
    };
  }
  fresh.difficulty = DIFFICULTIES.includes(r.difficulty as Difficulty) ? (r.difficulty as Difficulty) : "normal";
  fresh.started = r.started === true || c.missions.some((m) => fresh.missions[m.id].attempts > 0 || fresh.missions[m.id].completed);
  fresh.completedAt = num(r.completedAt);
  return fresh;
}

/** Saves the progress. Returns false when the device would not keep it (private mode, storage full); the game goes on either way. */
export function saveProgress(store: KV | null | undefined, p: CampaignProgress): boolean {
  if (!store) return false;
  try { store.setItem(progressKey(p.campaignId), JSON.stringify(p)); return true; } catch { return false; }
}

/** A mission is open when every mission before it has been won. Difficulty never changes what is open. */
export function missionStatus(c: CampaignDef, p: CampaignProgress, missionId: string): MissionStatus {
  const i = c.missions.findIndex((m) => m.id === missionId);
  if (i < 0) return "locked";
  if (p.missions[missionId]?.completed) return "completed";
  return c.missions.slice(0, i).every((m) => p.missions[m.id]?.completed) ? "next" : "locked";
}

export const canPlay = (c: CampaignDef, p: CampaignProgress, missionId: string): boolean => missionStatus(c, p, missionId) !== "locked";

/** The mission to play next: the first one not yet won, or null when the campaign is complete. */
export function nextMission(c: CampaignDef, p: CampaignProgress): string | null {
  return c.missions.find((m) => !p.missions[m.id]?.completed)?.id ?? null;
}

export const completedCount = (c: CampaignDef, p: CampaignProgress): number => c.missions.filter((m) => p.missions[m.id]?.completed).length;
export const isCampaignComplete = (c: CampaignDef, p: CampaignProgress): boolean => completedCount(c, p) === c.missions.length;

const withMission = (p: CampaignProgress, id: string, patch: Partial<MissionProgress>): CampaignProgress =>
  ({ ...p, missions: { ...p.missions, [id]: { ...(p.missions[id] ?? emptyMission()), ...patch } } });

/** Choosing (or changing) the difficulty. It applies to every mission started from now on and resets nothing. */
export function setDifficulty(p: CampaignProgress, difficulty: Difficulty): CampaignProgress {
  return { ...p, difficulty, started: true };
}

export function markIntroSeen(p: CampaignProgress, missionId: string): CampaignProgress {
  return p.missions[missionId]?.introSeen ? p : withMission(p, missionId, { introSeen: true });
}

/** A mission match began. */
export function recordStart(p: CampaignProgress, missionId: string): CampaignProgress {
  return { ...withMission(p, missionId, { attempts: (p.missions[missionId]?.attempts ?? 0) + 1, introSeen: true }), started: true };
}

export interface ResultOutcome {
  progress: CampaignProgress;
  /** This win is the mission's first (it unlocked what comes next). */
  firstCompletion: boolean;
  /** This win completed the campaign for the first time. */
  campaignCompleted: boolean;
  /** The mission that follows this one, if any. */
  nextMissionId: string | null;
}

/**
 * How a mission match ended. A win marks the mission done (and keeps the best time); capture and out of time count as a failure of that
 * attempt only; quit and incomplete matches change nothing. No result ever removes a win or locks a mission again.
 */
export function recordResult(c: CampaignDef, p: CampaignProgress, missionId: string, result: MissionResult, elapsedS: number, nowMs: number): ResultOutcome {
  const i = c.missions.findIndex((m) => m.id === missionId);
  const nextMissionId = i >= 0 ? (c.missions[i + 1]?.id ?? null) : null;
  const cur = p.missions[missionId];
  if (i < 0 || !cur) return { progress: p, firstCompletion: false, campaignCompleted: false, nextMissionId };
  if (result === "infected" || result === "failed") {
    return { progress: withMission(p, missionId, { failures: cur.failures + 1 }), firstCompletion: false, campaignCompleted: false, nextMissionId };
  }
  if (result !== "survived") return { progress: p, firstCompletion: false, campaignCompleted: false, nextMissionId };
  // A win only counts for a mission that was open: a saved match of a locked mission (edited storage) cannot skip ahead.
  if (!canPlay(c, p, missionId)) return { progress: p, firstCompletion: false, campaignCompleted: false, nextMissionId };
  const firstCompletion = !cur.completed;
  let progress = withMission(p, missionId, {
    completed: true,
    completedAt: cur.completedAt ?? nowMs,
    bestTimeS: cur.bestTimeS === undefined ? Math.round(elapsedS) : Math.min(cur.bestTimeS, Math.round(elapsedS)),
  });
  const campaignCompleted = firstCompletion && isCampaignComplete(c, progress);
  if (campaignCompleted) progress = { ...progress, completedAt: nowMs };
  return { progress, firstCompletion, campaignCompleted, nextMissionId };
}
