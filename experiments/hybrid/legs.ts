// npx tsx experiments/hybrid/legs.ts – hur zombier faktiskt använder off-road: benlängd, varaktighet, tillstånd och återgång.
import { STEP_S } from "@/config/game-rules";
import { zombieLatLon } from "@/engine/core/movement";
import { AREAS } from "./areas";
import { areaCtx, hybridFor } from "./lib/experiment";
import { createPairedSession } from "./lib/pairing";
import { model } from "./lib/presets";

const configs = [model("B2-25", 0.25, 150), model("B2-50", 0.5, 150), model("B3-50-perm", 0.5, 400, "permissive")];
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };
for (const cfg of configs) {
  const legs: { lenM: number; durS: number; state: string; nextState: string; direct: number }[] = [];
  let zombieHours = 0, matches = 0;
  for (const a of AREAS) for (const act of ["run", "mtb"] as const) for (let seed = 1; seed <= 6; seed++) {
    const c = areaCtx(a.id, act);
    const g = hybridFor(c, cfg.hybrid!).indexed;
    const { session: s } = createPairedSession({ base: c.ag.trailIndexed, g, activity: act, difficulty: "hard", durationS: 2700, strategy: "planner-trail", density: "normal", seed: 500 + seed });
    matches++;
    const open = new Map<string, { t0: number; state: string; start: { lat: number; lon: number }; len: number; last: { lat: number; lon: number } }>();
    while (!s.finished) {
      s.step();
      const t = s.state.elapsedSeconds;
      if (s.state.phase === "head_start") continue;
      for (const z of s.state.zombies) {
        zombieHours += STEP_S / 3600;
        const e = g.edges.get(z.edgeId)!;
        const cur = open.get(z.id);
        if (e.offroad) {
          if (!cur) open.set(z.id, { t0: t, state: z.state, start: zombieLatLon(g, z), len: 0, last: zombieLatLon(g, z) });
          else cur.len += z.speedMps * (e.speedFactor ?? 1) * STEP_S;
        } else if (cur) {
          const end = zombieLatLon(g, z);
          const dx = (end.lon - cur.start.lon) * 111320 * Math.cos((end.lat * Math.PI) / 180), dy = (end.lat - cur.start.lat) * 111320;
          legs.push({ lenM: cur.len, durS: t - cur.t0, state: cur.state, nextState: z.state, direct: Math.hypot(dx, dy) });
          open.delete(z.id);
        }
      }
    }
  }
  const by = (k: "state" | "nextState") => Object.entries(legs.reduce<Record<string, number>>((m, l) => ((m[l[k]] = (m[l[k]] ?? 0) + 1), m), {})).map(([a, b]) => `${a} ${b}`).join(", ");
  console.log(`\n${cfg.id}: ${matches} matcher, ${legs.length} off-road-ben (${(legs.length / zombieHours).toFixed(2)} per zombietimme)`);
  console.log(`  benlängd m: median ${q(legs.map((l) => l.lenM), 0.5).toFixed(0)}, p90 ${q(legs.map((l) => l.lenM), 0.9).toFixed(0)}, max ${q(legs.map((l) => l.lenM), 1).toFixed(0)}`);
  console.log(`  varaktighet s: median ${q(legs.map((l) => l.durS), 0.5).toFixed(0)}, p90 ${q(legs.map((l) => l.durS), 0.9).toFixed(0)}`);
  console.log(`  tillstånd när benet börjar: ${by("state")}; när det slutar: ${by("nextState")}`);
  console.log(`  andel ben som vänder (förskjutning < hälften av tillryggalagd sträcka): ${(legs.filter((l) => l.direct < l.lenM * 0.5).length / legs.length * 100).toFixed(0)} %`);
}
