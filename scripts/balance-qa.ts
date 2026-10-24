/* Balansutredning v2.2 (kvalitetssäkring):
 *   npx tsx scripts/balance-qa.ts <område> <läge> <modell> <strategier> <svårigheter> <tempon> <N> <utfil.jsonl> [maxSek]
 *   område: karlstad | skog | grid        läge: survival | mission | escape
 *   modell: v21 | v22                      strategier: random,avoid,shortest,planner,risk,risk-nomid
 *   tempon: gång,jogg,löp eller faktorer (1 = 4,7 km/h)
 * En rad JSON per match (resultat, tid, fångstorsak). Samma område/läge/seed ger samma startscenario för alla modeller och strategier.
 * Aggregering och konfidensintervall: scripts/balance-qa-report.ts. Simulerade spelare är inte människor. */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TileStore } from "../src/data/store";
import { defaultParams, withActivity } from "../src/play/config";
import { prepareMatch } from "../src/play/prepare";
import { objectivesFromProposal } from "../src/routes/objectives";
import { matchDurationS } from "../src/play/match";
import { SimSession, type PlayerCtx, type SimOptions } from "../src/sim/runner";
import { makeGoalBot, newBotStats, targetPos } from "../src/sim/bots";
import { makeRiskBot } from "../src/sim/risk-bot";
import { gridGraph } from "../src/sim/test-graphs";
import { STEP_S, type Rules } from "../src/config/game-rules";
import { zombieLatLon } from "../src/engine/core/movement";
import { rand } from "../src/engine/core/rng";
import { haversineM, bearingDeg, type LatLon } from "../src/geo/geometry";
import { indexGraph } from "../src/geo/graph/graph";
import type { Difficulty } from "../src/config/difficulty";
import type { TrailGraph } from "../src/geo/graph/types";

const [area, mode, modelName, stratArg, diffArg, paceArg, nArg, outFile, capArg] = process.argv.slice(2);
const N = Number(nArg);
const CAP = capArg ? Number(capArg) : Infinity;
const PACES: Record<string, number> = { gång: 1, jogg: 1.7, löp: 2.3 };
const paces = paceArg.split(",").map((p) => ({ name: p in PACES ? p : `${p}×`, f: p in PACES ? PACES[p] : Number(p) }));
const strategies = stratArg.split(",");
const diffs = diffArg.split(",") as Difficulty[];

const root = path.join(process.cwd(), "public/data/v1/varmland");
const fsFetch = async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = new TileStore("/data/v1/varmland", fsFetch as never);
const START: LatLon = area === "karlstad" ? { lat: 59.3793, lon: 13.5036 } : { lat: 59.40731, lon: 13.46753 };

const LEGACY_KMH: Record<Difficulty, number> = { easy: 6, normal: 10, hard: 13 };
const legacy = (d: Difficulty): Partial<Rules> => ({ zombieSpeedMps: LEGACY_KMH[d] / 3.6, sprintSpeedFactor: 1.5, sprintDurationS: 30, sprintRampS: 0, sprintDecayS: 0, sprintCooldownS: 30 });
/**
 * Variant = en eller flera ändringar av EN parameter i taget (för att ta reda på vad som orsakar förlusterna): t.ex. VARIANT="speed=0.8", "count=0.5", "magnet=600", "nosprint", "nointercept", "spawn=600".
 * Kombinera med "+". Utan VARIANT körs reglerna som de är.
 */
const VARIANT = process.env.VARIANT ?? "";
function variantPatch(base: Rules): Partial<Rules> {
  const out: Partial<Rules> = {};
  for (const part of VARIANT.split("+").filter(Boolean)) {
    const [k, v] = part.split("=");
    const x = Number(v);
    if (k === "speed") out.zombieSpeedMps = base.zombieSpeedMps * x;
    else if (k === "count") { out.initialZombies = Math.max(1, Math.round(base.initialZombies * x)); out.maxZombies = Math.max(1, Math.round(base.maxZombies * x)); }
    else if (k === "magnet") out.magnetRangeM = x;
    else if (k === "nosprint") out.sprintSpeedFactor = 1;
    else if (k === "nointercept") out.interceptShare = 0;
    else if (k === "spawn") { out.spawnMinDistanceM = x; out.startMinDistanceM = x; }
    else throw new Error(`okänd variant ${part}`);
  }
  return out;
}
import { resolveModeRules } from "../src/config/modes";
const rulesPatch = (d: Difficulty, durationS: number): Partial<Rules> | undefined => {
  const base = { ...resolveModeRules(mode as "survival" | "mission" | "escape", "walk", d, durationS), ...(modelName === "v21" ? legacy(d) : {}) } as Rules;
  const v = variantPatch(base);
  const merged = { ...(modelName === "v21" ? legacy(d) : {}), ...v };
  return Object.keys(merged).length ? merged : undefined;
};

/** Spelarpolicy (korsningsval + ev. vändning mitt på kanten). */
function policy(name: string, hasGoalMode: boolean): Pick<SimOptions, "strategy" | "strategyFn" | "midEdge"> {
  switch (name) {
    case "random": return { strategy: "random" };
    case "avoid": return { strategy: "avoid" };
    case "shortest": {
      const follower = makeGoalBot("follower", newBotStats());
      // Kortaste väg till målet; utan mål (Survival före extraction) slumpas vägen.
      return { strategy: "random", strategyFn: (c: PlayerCtx) => (targetPos(c) ? follower(c) : Math.floor(rand(c.rng) * c.options.length)) };
    }
    case "planner": return { strategy: "avoid", strategyFn: makeGoalBot("planner", newBotStats()) };
    case "risk": { const b = makeRiskBot({ useGoal: true }); return { strategy: "avoid", strategyFn: b.choose, midEdge: b.midEdge }; }
    case "risk300": { const b = makeRiskBot({ useGoal: true, horizonM: 300 }); return { strategy: "avoid", strategyFn: b.choose, midEdge: b.midEdge }; }
    case "risk300-nomid": { const b = makeRiskBot({ useGoal: true, horizonM: 300, midEdge: false }); return { strategy: "avoid", strategyFn: b.choose }; }
    case "risk450-nomid": { const b = makeRiskBot({ useGoal: true, horizonM: 450, midEdge: false }); return { strategy: "avoid", strategyFn: b.choose }; }
    case "risk-nomid": { const b = makeRiskBot({ useGoal: true, midEdge: false }); return { strategy: "avoid", strategyFn: b.choose }; }
    default: throw new Error(`okänd strategi ${name}`);
  }
  void hasGoalMode;
}

interface Scenario { g: TrailGraph; durationS: number; proposal: Awaited<ReturnType<typeof prepareMatch>>["proposals"][number] | null; start: LatLon }
async function scenario(diff: Difficulty): Promise<Scenario> {
  if (area === "grid") return { g: gridGraph(22, 22, 90), durationS: 1800, proposal: null, start: { lat: 59.38, lon: 13.5 } };
  const base = { ...withActivity(defaultParams("walk"), "walk"), difficulty: diff, mode: mode as "survival" | "mission" | "escape", seed: 11 };
  let p = base;
  if (mode === "escape") {
    const probe = await prepareMatch(store, START, { ...base, mode: "mission" }); // strikt nät (B ska gå att nå utan att korsa en större väg)
    const b = [...probe.region!.graph.nodes].sort((x, y) => haversineM(x, { lat: START.lat, lon: START.lon + 0.0225 }) - haversineM(y, { lat: START.lat, lon: START.lon + 0.0225 }))[0];
    p = { ...base, pointA: START, pointB: { lat: b.lat, lon: b.lon } };
  }
  const prep = await prepareMatch(store, START, p);
  if (!prep.graph || prep.status === "off_network") throw new Error(`${area}: ${prep.status} ${prep.message}`);
  const proposal = mode === "survival" ? null : prep.proposals[0] ?? null;
  if (mode !== "survival" && !proposal) throw new Error(`${area}/${mode}: inget förslag (${prep.status})`);
  return { g: prep.graph, durationS: matchDurationS(p, proposal), proposal, start: START };
}

type Cause = "overtaken" | "head-on" | "side" | "unknown";
interface Snap { t: number; me: LatLon; z: { id: string; ll: LatLon; v: number; sprint: boolean; chase: boolean }[] }

function classify(ring: Snap[], tEnd: number): { cause: Cause; zV: number; sprint: boolean; chasers: number; distBefore: number } {
  const last = ring[ring.length - 1];
  if (!last || !last.z.length) return { cause: "unknown", zV: 0, sprint: false, chasers: 0, distBefore: 0 };
  const nearest = last.z.reduce((a, b) => (haversineM(a.ll, last.me) <= haversineM(b.ll, last.me) ? a : b));
  const before = ring.find((s) => s.t >= tEnd - 10) ?? ring[0];
  const zb = before.z.find((z) => z.id === nearest.id);
  if (!zb) return { cause: "unknown", zV: nearest.v, sprint: nearest.sprint, chasers: last.z.filter((z) => z.chase).length, distBefore: 0 };
  const motion = bearingDeg(before.me, last.me);
  const toZ = bearingDeg(before.me, zb.ll);
  const ang = Math.abs(((toZ - motion + 540) % 360) - 180);
  const cause: Cause = ang < 60 ? "head-on" : ang > 120 ? "overtaken" : "side";
  return { cause, zV: nearest.v, sprint: nearest.sprint, chasers: last.z.filter((z) => z.chase).length, distBefore: Math.round(haversineM(before.me, zb.ll)) };
}

const lines: string[] = [];
for (const diff of diffs) {
  const sc = await scenario(diff);
  for (const pace of paces) {
    for (const strat of strategies) {
      for (let i = 0; i < N; i++) {
        const seed = 100 + i;
        const objectives = sc.proposal ? objectivesFromProposal(sc.proposal) : undefined;
        const pol = policy(strat, !!objectives);
        const sim = new SimSession({ g: sc.g, activity: "walk", difficulty: diff, durationS: sc.durationS, seed, start: sc.start, paceFactor: pace.f, mode: mode === "escape" ? "escape" : (mode as "survival" | "mission"), objectives, rulesPatch: rulesPatch(diff, sc.durationS), ...pol });
        const ring: Snap[] = [];
        let nextSnap = 0;
        const t0 = performance.now();
        const limit = Math.min(CAP, sc.durationS + 60);
        while (!sim.finished && sim.state.elapsedSeconds < limit) {
          sim.step();
          const t = sim.state.elapsedSeconds;
          if (t >= nextSnap) {
            nextSnap = t + 1;
            ring.push({ t, me: edgeLL(sc.g, sim), z: sim.state.zombies.map((z) => ({ id: z.id, ll: zombieLatLon(sc.g, z), v: z.speedMps, sprint: z.sprintUntilS !== undefined, chase: z.state === "chase" || z.state === "intercept" })) });
            if (ring.length > 14) ring.shift();
          }
        }
        const result = sim.finished ? sim.state.result! : "alive";
        const rec: Record<string, unknown> = { area, mode, model: modelName, variant: VARIANT || "base", diff, pace: pace.name, paceF: pace.f, strat, seed, result, t: Math.round(sim.state.elapsedSeconds), zombies: sim.state.zombies.length, wallMs: Math.round(performance.now() - t0), sprints: sim.events.filter((e) => e.type === "zombie_sprint").length };
        if (result === "infected") Object.assign(rec, classify(ring, sim.state.elapsedSeconds));
        if (objectives) rec.goals = sim.state.objectives?.index ?? 0;
        lines.push(JSON.stringify(rec));
        appendFileSync(outFile, JSON.stringify(rec) + "\n");
      }
    }
  }
}
void lines; void writeFileSync; void indexGraph; void STEP_S;

function edgeLL(g: TrailGraph, sim: SimSession): LatLon {
  const e = g.edges.get(sim.pos.edgeId)!;
  const f = e.lengthM > 0 ? sim.pos.distM / e.lengthM : 0;
  const i = Math.min(e.geometry.length - 2, Math.floor(f * (e.geometry.length - 1)));
  const a = e.geometry[i], b = e.geometry[i + 1];
  const u = f * (e.geometry.length - 1) - i;
  return { lat: a.lat + (b.lat - a.lat) * u, lon: a.lon + (b.lon - a.lon) * u };
}
