/* Old zombie AI against the AI with roles (docs/ZOMBIE-AI-ROLES.md), same scenarios and seeds.
 *   npx tsx scripts/ai-compare.ts [matches per cell] [networks] [activities] [players] [difficulty] [pace, e.g. walk=1.5,mtb=1]
 *   networks: grid, karlstad, skog, karlstad+terrain, skog+terrain    activities: walk,mtb    players: risk,planner,random,straight
 * "+terrain" = the real trails plus the terrain lattice the live game lays over the play area (zombies at half speed off the trails), but
 * without buildings and water (the map tiles for them are not in the repo). The simulated player always stays on trails and roads.
 * Prints one Markdown row per cell. Simulated players are not people: read differences between the two AIs, not absolute levels. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { TileStore } from "../src/data/store";
import { defaultParams, withActivity } from "../src/play/config";
import { prepareMatch } from "../src/play/prepare";
import { SimSession, type PlayerCtx, type SimOptions } from "../src/sim/runner";
import { makeGoalBot, newBotStats } from "../src/sim/bots";
import { makeRiskBot } from "../src/sim/risk-bot";
import { gridGraph } from "../src/sim/test-graphs";
import { STEP_S, applyZombieAi, type Rules } from "../src/config/game-rules";
import { resolveModeRules } from "../src/config/modes";
import { zombieLatLon } from "../src/engine/core/movement";
import { pathStats } from "../src/engine/pathfinding/astar";
import { roleOf } from "../src/engine/ai/roles";
import { rand } from "../src/engine/core/rng";
import { fromLocal, haversineM, toLocal } from "../src/geo/geometry";
import { edgeLatLon, indexGraph } from "../src/geo/graph/graph";
import { buildTerrainMesh } from "../src/geo/graph/terrain-mesh";
import type { Activity } from "../src/config/activities";
import type { Difficulty } from "../src/config/difficulty";
import type { TrailGraph } from "../src/geo/graph/types";
import type { LatLon } from "../src/geo/geometry";

const N = Number(process.argv[2] ?? 12);
const NETS = (process.argv[3] ?? "grid,karlstad,skog+terrain").split(",");
const ACTS = (process.argv[4] ?? "walk,mtb").split(",") as Activity[];
const PLAYERS = (process.argv[5] ?? "risk,planner").split(",");
const DIFF = (process.argv[6] ?? "normal") as Difficulty;
/** Player pace as a share of the activity's nominal pace, per activity (walk 1.5 ≈ 7 km/h jogging: on foot in Survival the zombies are faster than a walker). */
const PACE: Record<string, number> = Object.fromEntries((process.argv[7] ?? "walk=1.5,mtb=1").split(",").map((kv) => { const [k, v] = kv.split("="); return [k, Number(v)]; }));

const root = path.join(process.cwd(), "public/data/v1/varmland");
const fsFetch = async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const store = new TileStore("/data/v1/varmland", fsFetch as never);
const STARTS: Record<string, LatLon> = { karlstad: { lat: 59.3793, lon: 13.5036 }, skog: { lat: 59.40731, lon: 13.46753 } };

async function network(name: string, activity: Activity): Promise<{ g: TrailGraph; start: LatLon }> {
  if (name === "grid") return { g: gridGraph(22, 22, 90), start: { lat: 59.38, lon: 13.5 } };
  const [area, terrain] = name.split("+");
  const start = STARTS[area];
  const p = { ...withActivity(defaultParams(activity), activity), mode: "survival" as const, seed: 11 };
  const prep = await prepareMatch(store, start, p);
  if (!prep.graph || !prep.region) throw new Error(`${name}/${activity}: ${prep.status} ${prep.message}`);
  if (!terrain) return { g: prep.graph, start };
  // As play/prepare.ts does with map tiles (AREA_MESH_MAX_NODES / AREA_MESH_MAX_SPACING_M), but without buildings and water.
  const R = activity === "mtb" ? 3000 : 1500;
  const play = { ...prep.region.play.graph, crossingNodes: [...prep.region.play.crossingNodes] };
  const mesh = buildTerrainMesh(play, { a: fromLocal(start, { x: -R, y: 0 }), b: fromLocal(start, { x: R, y: 0 }), halfWidthM: R, marginM: 0, maxNodes: 12_000, maxSpacingM: 120 });
  return { g: indexGraph(mesh.graph), start };
}

/** The player keeps to trails and roads (never a terrain edge) whatever the strategy. */
function onTrails(g: TrailGraph, choose: (c: PlayerCtx) => number): (c: PlayerCtx) => number {
  return (c) => {
    const real = c.options.map((o, i) => [o, i] as const).filter(([o]) => !g.edges.get(o.edgeId)!.offtrail);
    if (!real.length || real.length === c.options.length) return choose(c);
    const i = choose({ ...c, options: real.map(([o]) => o) });
    return real[i][1];
  };
}
function player(name: string, g: TrailGraph): Pick<SimOptions, "strategy" | "strategyFn" | "midEdge"> {
  if (name === "risk") { const b = makeRiskBot({ useGoal: true }); return { strategy: "avoid", strategyFn: onTrails(g, b.choose), midEdge: b.midEdge }; }
  if (name === "planner") return { strategy: "avoid", strategyFn: onTrails(g, makeGoalBot("planner", newBotStats())) };
  if (name === "straight") {
    // Predictable: always the way that goes most nearly straight on (a player who ignores the zombies and keeps a heading).
    let hx = 1, hy = 0;
    return { strategy: "random", strategyFn: onTrails(g, (c) => {
      const e = g.edges.get(c.options[0].edgeId)!;
      const here = g.nodes.get(c.options[0].dir === 1 ? e.from : e.to)!;
      let best = 0, bd = -Infinity, bx = hx, by = hy;
      c.options.forEach((o, i) => {
        const v = toLocal(here, g.nodes.get(o.to)!); const l = Math.hypot(v.x, v.y) || 1;
        const d = (v.x * hx + v.y * hy) / l;
        if (d > bd) { bd = d; best = i; bx = v.x / l; by = v.y / l; }
      });
      hx = bx; hy = by;
      return best;
    }) };
  }
  return { strategy: "random", strategyFn: onTrails(g, (c) => Math.floor(rand(c.rng) * c.options.length)) };
}

interface Out {
  infected: boolean; survived: boolean; tCapS: number; plans: number; ambush: number; contact: number; passedNear: number; missed: number;
  behind: number[]; spread: number[]; offtrailCatch: boolean; interceptorCatch: boolean; searches: number; nodes: number; msPerStep: number; minutes: number;
}

function runOne(g: TrailGraph, start: LatLon, activity: Activity, ai: "old" | "roles", who: string, seed: number): Out {
  const durationS = activity === "mtb" ? 2700 : 1800;
  const base = resolveModeRules("survival", activity, DIFF, durationS);
  const rules: Rules = ai === "roles" ? applyZombieAi(base, "roles") : base;
  const patch: Partial<Rules> = ai === "roles" ? { zombieAi: "roles", interceptShare: rules.interceptShare, interceptModel: undefined } : {};
  const s = new SimSession({ g, activity, difficulty: DIFF, durationS, seed, start, mode: "survival", rulesPatch: patch, paceFactor: PACE[activity] ?? 1, ...player(who, g) });
  const o: Out = { infected: false, survived: false, tCapS: 0, plans: 0, ambush: 0, contact: 0, passedNear: 0, missed: 0, behind: [], spread: [], offtrailCatch: false, interceptorCatch: false, searches: 0, nodes: 0, msPerStep: 0, minutes: 0 };
  const plans = new Map<string, { lat: number; lon: number; playerCame: boolean; zombieThere: boolean }>();
  // How a plan ended: the player came to the point with the zombie there (met), the zombie got to the player some other way first
  // (contact: within 60 m when the plan ended), the player came but the zombie was not there yet (passed), or the player never came (missed).
  const close = (id: string) => {
    const p = plans.get(id); if (!p) return;
    const z = s.state.zombies.find((x) => x.id === id);
    const near = !!z && haversineM(zombieLatLon(g, z), edgeLatLon(g, s.pos)) <= 60;
    if (p.playerCame && p.zombieThere) o.ambush++; else if (near) o.contact++; else if (p.playerCame) o.passedNear++; else o.missed++;
    plans.delete(id);
  };
  const target = (z: (typeof s.state.zombies)[number]) => z.meeting ?? (z.state === "intercept" && z.targetNodeId ? g.nodes.get(z.targetNodeId) : undefined);
  const lastOff = new Map<string, number>();
  const s0 = { ...pathStats };
  let steps = 0;
  const t0 = performance.now();
  let prev = edgeLatLon(g, s.pos);
  for (let i = 0; i < Math.ceil((durationS + 60) / STEP_S) && !s.finished; i++) {
    s.step();
    steps++;
    const t = s.state.elapsedSeconds;
    const me = edgeLatLon(g, s.pos);
    for (const z of s.state.zombies) {
      if (g.edges.get(z.edgeId)?.offtrail) lastOff.set(z.id, t);
      const p = plans.get(z.id);
      const m = target(z);
      if (m && (!p || p.lat !== m.lat || p.lon !== m.lon)) { if (p) close(z.id); plans.set(z.id, { lat: m.lat, lon: m.lon, playerCame: false, zombieThere: false }); o.plans++; }
      else if (!m && p) close(z.id);
      const q = plans.get(z.id);
      if (q && haversineM(me, q) <= 30) { q.playerCame = true; if (haversineM(zombieLatLon(g, z), q) <= 40) q.zombieThere = true; }
    }
    if (i % 50 === 0) {
      // Where the hunting zombies within 600 m are, seen from the player: share behind (more than 120° from the direction of travel) and
      // how spread their directions are (1 − mean resultant length; 0 = all from one side, a "train").
      const v = toLocal(prev, me); prev = me;
      const len = Math.hypot(v.x, v.y);
      const hunting = s.state.zombies.filter((z) => (z.state === "chase" || z.state === "intercept") && haversineM(zombieLatLon(g, z), me) <= 600);
      if (hunting.length >= 2 && len > 1) {
        let sx = 0, sy = 0, behind = 0;
        for (const z of hunting) {
          const w = toLocal(me, zombieLatLon(g, z)); const l = Math.hypot(w.x, w.y) || 1;
          sx += w.x / l; sy += w.y / l;
          if ((w.x * v.x + w.y * v.y) / (l * len) < -0.5) behind++;
        }
        o.behind.push(behind / hunting.length);
        o.spread.push(1 - Math.hypot(sx, sy) / hunting.length);
      }
    }
  }
  o.msPerStep = (performance.now() - t0) / steps;
  for (const id of [...plans.keys()]) close(id);
  o.searches = pathStats.astar + pathStats.trees + pathStats.fields - s0.astar - s0.trees - s0.fields;
  o.nodes = pathStats.nodes - s0.nodes;
  o.minutes = s.state.elapsedSeconds / 60;
  o.infected = s.state.result === "infected";
  o.survived = s.state.result === "survived";
  o.tCapS = s.state.elapsedSeconds;
  if (o.infected) {
    const me = edgeLatLon(g, s.pos);
    const z = [...s.state.zombies].sort((a, b) => haversineM(zombieLatLon(g, a), me) - haversineM(zombieLatLon(g, b), me))[0];
    if (z) { o.offtrailCatch = (s.state.elapsedSeconds - (lastOff.get(z.id) ?? -1e9)) <= 60; o.interceptorCatch = ai === "roles" ? roleOf(z) === "interceptor" : z.canIntercept; }
  }
  return o;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
const wilson = (k: number, n: number) => { const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)); return `${pct((c - m) / d)}–${pct((c + m) / d)}`; };

console.log(`# Zombie AI: old against roles (${DIFF}, Survival, ${N} matches per cell, seeds 100…${99 + N}, player pace ${JSON.stringify(PACE)})\n`);
console.log("| network | activity | player | AI | caught (95 %) | median min to capture | plans/match | met / contact / passed / missed | behind | spread | caught off trail | caught by interceptor | searches/min | nodes/min | ms/step |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const net of NETS) for (const activity of ACTS) {
  const { g, start } = await network(net, activity);
  for (const who of PLAYERS) for (const ai of ["old", "roles"] as const) {
    const rs: Out[] = [];
    for (let i = 0; i < N; i++) rs.push(runOne(g, start, activity, ai, who, 100 + i));
    const caught = rs.filter((r) => r.infected);
    const plans = rs.reduce((a, r) => a + r.plans, 0);
    const sum = (k: "ambush" | "contact" | "passedNear" | "missed") => rs.reduce((a, r) => a + r[k], 0);
    const mins = rs.reduce((a, r) => a + r.minutes, 0);
    console.log(`| ${net} | ${activity} | ${who} | ${ai} | ${pct(caught.length / N)} (${wilson(caught.length, N)}) | ${caught.length ? (median(caught.map((r) => r.tCapS)) / 60).toFixed(1) : "–"} | ${(plans / N).toFixed(1)} | ${plans ? `${pct(sum("ambush") / plans)} / ${pct(sum("contact") / plans)} / ${pct(sum("passedNear") / plans)} / ${pct(sum("missed") / plans)}` : "–"} | ${pct(mean(rs.flatMap((r) => r.behind)))} | ${mean(rs.flatMap((r) => r.spread)).toFixed(2)} | ${caught.length ? pct(caught.filter((r) => r.offtrailCatch).length / caught.length) : "–"} | ${caught.length ? pct(caught.filter((r) => r.interceptorCatch).length / caught.length) : "–"} | ${(rs.reduce((a, r) => a + r.searches, 0) / mins).toFixed(1)} | ${Math.round(rs.reduce((a, r) => a + r.nodes, 0) / mins)} | ${mean(rs.map((r) => r.msPerStep)).toFixed(3)} |`);
  }
}

