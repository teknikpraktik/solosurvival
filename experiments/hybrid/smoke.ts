import { runPair, type Scenario, type ModelSpec } from "./lib/experiment";
import { DEFAULT_HYBRID } from "./lib/hybrid-graph";

const models: ModelSpec[] = [
  { id: "A", hybrid: null },
  { id: "B25-100", hybrid: { ...DEFAULT_HYBRID, offroadFactor: 0.25, maxLinkM: 100 } },
  { id: "B50-150", hybrid: { ...DEFAULT_HYBRID, offroadFactor: 0.5, maxLinkM: 150 } },
];
for (const area of ["skutberget", "i2-skogen", "sormon"] as const) {
  const sc: Scenario = { area, activity: "run", difficulty: "hard", durationS: 2700, strategy: "avoid", density: "normal", seed: 11 };
  const t0 = performance.now();
  const ms = runPair(sc, models);
  console.log(`\n${area}  (${((performance.now() - t0) / 1000).toFixed(1)} s totalt)`);
  for (const m of ms) {
    console.log(`  ${m.model.padEnd(8)} ${m.result.padEnd(9)} end ${m.endS.toFixed(0)}s  minDist ${m.minDistM.toFixed(0)} m  <50m ${m.secsWithin50.toFixed(0)}s  trapped ${m.trappedSecs}s  offroad ${(m.zombieDistOffroadM / (m.zombieDistOffroadM + m.zombieDistTrailM) * 100).toFixed(2)}%  switches ${m.zombieSwitches}  viol ${m.offroadViolations}  maxStep ${m.maxStepM.toFixed(2)}/${m.maxStepAllowedM.toFixed(2)}  cpu ${m.cpuMs.toFixed(0)} ms  zombies ${m.zombies}`);
  }
}
