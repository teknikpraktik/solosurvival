import type { Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import type { ModeScenario } from "./lib/run";

const AREAS = ["skutberget", "i2-skogen", "sormon"] as const;
const DIFFS: Difficulty[] = ["easy", "normal", "hard"];
const seeds = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i);

/** Storlek per aktivitet: Escape/Mission ruttlängd (m) som ryms i 3 × 3 km-rutorna, Survival matchlängd (s). */
export const SIZES: Record<Activity, { escape: number; mission: number; survival: number }> = {
  walk: { escape: 1500, mission: 2500, survival: 1800 },
  run: { escape: 3000, mission: 5000, survival: 2700 },
  mtb: { escape: 5000, mission: 8000, survival: 2700 },
};

export const PRESETS: Record<string, ModeScenario[]> = {
  // M1: de tre lägena, tre aktiviteter, tre svårigheter, två bottar.
  modes: (() => {
    const out: ModeScenario[] = [];
    for (const area of AREAS) for (const activity of ["walk", "run", "mtb"] as Activity[]) for (const difficulty of DIFFS)
      for (const mode of ["escape", "mission", "survival"] as const) for (const bot of ["follower", "planner"] as const)
        for (const seed of seeds(10)) out.push({ area, activity, mode, difficulty, size: SIZES[activity][mode], seed, bot });
    return out;
  })(),
  // M2: antal checkpoints (1–3), löpning, 5 km.
  checkpoints: (() => {
    const out: ModeScenario[] = [];
    for (const area of AREAS) for (const difficulty of DIFFS) for (const k of [1, 2, 3] as const) for (const bot of ["follower", "planner"] as const)
      for (const seed of seeds(15, 100)) out.push({ area, activity: "run", mode: "mission", difficulty, size: 5000, seed, bot, checkpoints: k });
    return out;
  })(),
  // M3: ablation – djupa återvändsgrenar tillåtna eller undvikna som checkpoints.
  deadend: (() => {
    const out: ModeScenario[] = [];
    for (const area of AREAS) for (const difficulty of DIFFS) for (const policy of ["avoid", "allow"] as const) for (const bot of ["follower", "planner"] as const)
      for (const seed of seeds(20, 300)) out.push({ area, activity: "run", mode: "mission", difficulty, size: 5000, seed, bot, deadEndPolicy: policy });
    return out;
  })(),
};
