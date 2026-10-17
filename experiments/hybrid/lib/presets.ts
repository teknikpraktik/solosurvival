import type { Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import type { Density, ModelSpec, Scenario } from "./experiment";
import { DEFAULT_HYBRID, type HybridConfig } from "./hybrid-graph";

const AREAS = ["skutberget", "i2-skogen", "sormon"] as const;
const STRATS: Scenario["strategy"][] = ["random", "avoid", "extraction", "planner-trail", "planner-omni"];
const seeds = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i);

const hy = (factor: number, maxLinkM: number, terrain: HybridConfig["terrain"] = "verified"): HybridConfig => ({
  ...DEFAULT_HYBRID,
  offroadFactor: factor,
  maxLinkM,
  terrain,
});
export const model = (id: string, factor: number, maxLinkM: number, terrain: HybridConfig["terrain"] = "verified", dedupeM = 0): ModelSpec => ({ id, hybrid: { ...hy(factor, maxLinkM, terrain), dedupeM } });
export const A: ModelSpec = { id: "A", hybrid: null };

export interface Preset {
  scenarios: Scenario[];
  models: ModelSpec[];
}

function grid(o: {
  activities: Activity[]; difficulties: Difficulty[]; durations: number[]; strategies: Scenario["strategy"][];
  densities: Density[]; seeds: number[]; areas?: readonly (typeof AREAS)[number][];
}): Scenario[] {
  const out: Scenario[] = [];
  for (const area of o.areas ?? AREAS)
    for (const activity of o.activities)
      for (const difficulty of o.difficulties)
        for (const durationS of o.durations)
          for (const strategy of o.strategies)
            for (const density of o.densities)
              for (const seed of o.seeds) out.push({ area, activity, difficulty, durationS, strategy, density, seed });
  return out;
}

export const PRESETS: Record<string, Preset> = {
  // Grind: korta körningar som visar att modellerna fungerar innan stora serier.
  validate: {
    scenarios: grid({ activities: ["run", "mtb"], difficulties: ["normal", "hard"], durations: [2700], strategies: ["avoid", "planner-trail", "planner-omni"], densities: ["normal"], seeds: seeds(4, 900) }),
    models: [A, model("B1-25", 0.25, 100), model("B2-25", 0.25, 150), model("B3-25", 0.25, 400), model("B2-50", 0.5, 150)],
  },
  // S1: huvudjämförelse A mot B1/B2/B3 vid 25 % över aktiviteter, svårigheter och strategier.
  s1: {
    scenarios: grid({ activities: ["walk", "run", "mtb"], difficulties: ["easy", "normal", "hard"], durations: [2700], strategies: STRATS, densities: ["normal"], seeds: seeds(12) }),
    models: [A, model("B1-25", 0.25, 100), model("B2-25", 0.25, 150), model("B3-25", 0.25, 400)],
  },
  // S2: off-road-hastighet (15/35/50 %) samt tillåtande terrängpolicy (okänd mark passerbar).
  s2: {
    scenarios: grid({ activities: ["run", "mtb"], difficulties: ["normal", "hard"], durations: [2700], strategies: STRATS, densities: ["normal"], seeds: seeds(12, 101) }),
    models: [A, model("B2-15", 0.15, 150), model("B2-35", 0.35, 150), model("B2-50", 0.5, 150), model("B1-50", 0.5, 100), model("B2-25-perm", 0.25, 150, "permissive"), model("B3-50-perm", 0.5, 400, "permissive")],
  },
  // S4: ablation – glesa ut redundanta, nästan parallella förbindelser (NMS 40 m).
  s4: {
    scenarios: grid({ activities: ["run", "mtb"], difficulties: ["normal", "hard"], durations: [2700], strategies: STRATS, densities: ["normal"], seeds: seeds(12, 301) }),
    models: [A, model("B2-25", 0.25, 150), model("B2-25-nms", 0.25, 150, "verified", 40), model("B2-50", 0.5, 150), model("B2-50-nms", 0.5, 150, "verified", 40)],
  },
  // S3: matchlängd och zombietäthet.
  s3: {
    scenarios: grid({ activities: ["run"], difficulties: ["normal"], durations: [1200, 2700, 3600], strategies: ["avoid", "planner-trail"], densities: ["sparse", "normal", "dense"], seeds: seeds(12, 201) }),
    models: [A, model("B2-25", 0.25, 150), model("B2-50", 0.5, 150)],
  },
};
