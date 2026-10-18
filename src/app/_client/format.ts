import type { GameMode } from "@/engine/objectives/objectives";
import type { Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";

export const MODE_LABEL: Record<GameMode, string> = { mission: "MISSION", escape: "A TO B", survival: "SURVIVAL" };
export const MODE_HELP: Record<GameMode, string> = {
  mission: "Slinga från start: nå 1–3 checkpoints i ordning och gå sedan tillbaka till start.",
  escape: "Välj själv A och B på kartan och ta dig från A till B innan tiden går ut.",
  survival: "Ingen rutt: överlev tills extraction öppnar och nå den.",
};
export const ACTIVITY_LABEL: Record<Activity, string> = { walk: "Promenad", run: "Löpning", mtb: "MTB" };
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Lätt", normal: "Normal", hard: "Svår" };
export const RESULT_LABEL: Record<string, string> = {
  survived: "Överlevde", infected: "Smittad", failed: "Tiden tog slut", aborted: "Avbruten", incomplete: "Ofullständig", active: "Pågår", interrupted: "Avbruten (kunde ej återställas)",
};

export const fmtTime = (s: number): string => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
export const fmtKm = (m: number): string => `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;
export const fmtDate = (ms: number): string => new Date(ms).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
