/**
 * New game as three steps (activity → mode → setup): the step in the URL, what each choice resets, whether a prepared course still
 * matches the choices, and the last valid setup kept on this device. Pure functions (no React, no DOM) so they can be tested in Node.
 */
import { ACTIVITIES, type Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import type { GameMode } from "@/engine/objectives/objectives";
import { clampParams, defaultParams, withActivity, type MatchParams } from "./config";

export type Step = "activity" | "mode" | "setup";
export const STEPS: readonly Step[] = ["activity", "mode", "setup"];

/** The activities and modes New game offers, in the order shown. */
export const NEW_GAME_ACTIVITIES: readonly Activity[] = ["walk", "mtb"];
export const NEW_GAME_MODES: readonly GameMode[] = ["mission", "escape", "survival"];
const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

/** The step a URL query names (`?step=mode`). Anything else is the first step. */
export function stepFromSearch(search: string): Step {
  const s = new URLSearchParams(search).get("step");
  return s === "mode" || s === "setup" ? s : "activity";
}

/** The URL (path and query) for a step: the first step is plain `/new`. */
export function stepUrl(step: Step, path = "/new"): string {
  return step === "activity" ? path : `${path}?step=${step}`;
}

/** The step before this one, or null on the first step (where back leaves New game). */
export function prevStep(step: Step): Step | null {
  const i = STEPS.indexOf(step);
  return i > 0 ? STEPS[i - 1] : null;
}

/**
 * Choosing an activity. The same activity again keeps every setting (a player who went back to look changes nothing); another one
 * resets distance and match length to that activity's defaults (as before) and drops B, which was checked against the old activity.
 */
export function chooseActivity(p: MatchParams, activity: Activity): MatchParams {
  if (p.activity === activity) return p;
  return clampParams({ ...withActivity(p, activity), pointA: null, pointB: null });
}

/** Choosing a mode. The same mode again keeps everything; another mode drops B (only A TO B uses it). */
export function chooseMode(p: MatchParams, mode: GameMode): MatchParams {
  if (p.mode === mode) return p;
  return clampParams({ ...p, mode, pointA: null, pointB: null });
}

/**
 * What a prepared course depends on. A course (or A TO B route) prepared for other values than these no longer fits the choices and
 * must not be shown or started. Difficulty is not part of it: it changes no course (it is handed to the session before START).
 */
export function courseKey(p: Pick<MatchParams, "mode" | "activity" | "targetLengthM" | "durationS" | "pointB">): string {
  if (p.mode === "mission") return `mission|${p.activity}|${p.targetLengthM}`;
  if (p.mode === "escape") return `escape|${p.activity}|${p.pointB ? `${p.pointB.lat.toFixed(6)},${p.pointB.lon.toFixed(6)}` : "-"}`;
  return `survival|${p.activity}|${p.durationS}`;
}

/** Does the setup step need a course prepared before START can be pressed? (Survival prepares when START is pressed.) */
export function needsCourse(p: Pick<MatchParams, "mode" | "pointB">): boolean {
  return p.mode === "mission" || (p.mode === "escape" && !!p.pointB);
}

// --- The last valid setup on this device ---

/** localStorage key for the last setup a match was started with. */
export const LAST_SETUP_KEY = "outbreak.newgame.last";

/** What is kept: the choices only. Never a position, a course, B or a seed (they are made new and checked again every time). */
export interface SavedSetup {
  activity: Activity;
  mode: GameMode;
  difficulty: Difficulty;
  targetLengthM: number;
  durationS: number;
}

type KV = Pick<Storage, "getItem" | "setItem">;

const isFiniteNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * Reads the saved setup. Missing, unreadable or unknown values fall back to the defaults; an unknown activity or mode means nothing
 * usable was saved (null), so the shortcut is not offered. Numbers are clamped to the activity's current limits.
 */
export function loadSetup(store: KV | null | undefined): SavedSetup | null {
  let raw: unknown;
  try { raw = JSON.parse(store?.getItem(LAST_SETUP_KEY) ?? "null"); } catch { return null; }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!NEW_GAME_ACTIVITIES.includes(r.activity as Activity) || !NEW_GAME_MODES.includes(r.mode as GameMode)) return null;
  const activity = r.activity as Activity;
  const base = defaultParams(activity);
  const p = clampParams({
    ...base,
    mode: r.mode as GameMode,
    difficulty: DIFFICULTIES.includes(r.difficulty as Difficulty) ? (r.difficulty as Difficulty) : base.difficulty,
    targetLengthM: isFiniteNum(r.targetLengthM) ? r.targetLengthM : base.targetLengthM,
    durationS: isFiniteNum(r.durationS) ? r.durationS : ACTIVITIES[activity].defaultDurationS,
  });
  return { activity: p.activity, mode: p.mode, difficulty: p.difficulty, targetLengthM: p.targetLengthM, durationS: p.durationS };
}

/** Keeps the choices of a match that was started. Storage errors (private mode, full) are ignored: the shortcut is a convenience. */
export function saveSetup(store: KV | null | undefined, p: MatchParams): void {
  const s: SavedSetup = { activity: p.activity, mode: p.mode, difficulty: p.difficulty, targetLengthM: p.targetLengthM, durationS: p.durationS };
  try { store?.setItem(LAST_SETUP_KEY, JSON.stringify(s)); } catch { /* not kept */ }
}

/** Match parameters from a saved setup: a new seed, no A or B. */
export function paramsFromSetup(s: SavedSetup): MatchParams {
  return clampParams({ ...defaultParams(s.activity), mode: s.mode, difficulty: s.difficulty, targetLengthM: s.targetLengthM, durationS: s.durationS, pointA: null, pointB: null });
}
