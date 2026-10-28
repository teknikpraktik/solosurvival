import type { GameMode, ObjectiveProgress } from "@/engine/objectives/objectives";
import type { Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";

export const MODE_LABEL: Record<GameMode, string> = { mission: "CHECKPOINTS", escape: "A TO B", survival: "SURVIVAL" };
export const MODE_HELP: Record<GameMode, string> = {
  mission: "Fetch the numbered checkpoints in order, then return home. No route, choose your own way.",
  escape: "A is where you are now. Pick B on the map and get there before time runs out. Any way you like.",
  survival: "No route: survive until extraction opens, then reach it.",
};
export const ACTIVITY_LABEL: Record<Activity, string> = { walk: "On foot", run: "On foot", mtb: "Bike" };
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
export const RESULT_LABEL: Record<string, string> = {
  survived: "Survived", infected: "Captured", failed: "Out of time", aborted: "Aborted", incomplete: "Incomplete", active: "In progress", interrupted: "Aborted (could not restore)",
};

export const fmtTime = (s: number): string => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
export const fmtKm = (m: number): string => `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;
export const fmtDate = (ms: number): string => new Date(ms).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });

/** Texten i HUD för det aktiva målet. Hemkomst räknas inte som checkpoint. */
export function objectiveLabel(p: ObjectiveProgress): string {
  switch (p.stage) {
    case "checkpoint": return `Checkpoint ${p.primaryReached + 1}/${p.primaryTotal}`;
    case "destination": return "Get to B";
    case "home": return p.primaryTotal ? `Head home · ${p.primaryReached}/${p.primaryTotal} checkpoints` : "Head home";
    default: return "Done";
  }
}
