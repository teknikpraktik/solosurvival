import { rand, type RngHolder } from "@/engine/core/rng";
import { networkDistances } from "@/engine/pathfinding/astar";
import { bearingDeg, haversineM, type LatLon } from "@/geo/geometry";
import { nodeLatLon, snapToGraph } from "@/geo/graph/graph";
import type { EdgePos, TrailGraph } from "@/geo/graph/types";
import { analyzeNetwork, coreExits, type NetworkAnalysis } from "./analysis";
import { addPenalty, joinGeometry, legBetween, legSteps, nodePos, type Leg } from "./pathing";
import type { RouteMetrics, RouteProposal, RouteRequest, RouteResult, RouteType, Waypoint } from "./types";

const MIN_CHECKPOINT_FROM_START_M = 150;
const MIN_WAYPOINT_SPACING_M = 120;
const PREFERRED_MAX_DEPTH_M = 60;
const HARD_MAX_DEPTH_M = 150;

interface Ctx {
  g: TrailGraph;
  an: NetworkAnalysis;
  req: RouteRequest;
  start: EdgePos;
  startLL: LatLon;
  dist: Map<string, number>;
  rng: RngHolder;
  hazard: Set<string>;
  junction: (n: string) => boolean;
}

/** Street key of an edge: the OSM way it belongs to (edge ids look like `wayId:idx` or `wayId.part:idx`). */
export const streetOf = (edgeId: string): string => edgeId.split(":")[0].split(".")[0];

/** Cost multiplier that effectively forbids an already used edge when planning the next leg. */
const BAN_PENALTY = 1e5;
/** Mild extra cost for other edges of an already used street, so the route prefers to leave a street for good. */
const SAME_STREET_PENALTY = 3;

/**
 * Dead-end spurs the start itself lies in: the player has to walk them in and out whatever the route is, so reuse there cannot be avoided.
 * Empty when the start is on the main network.
 */
function startSpur(c: Ctx): Set<string> {
  const out = new Set<string>();
  if (!c.an.deadEndEdges.has(c.start.edgeId)) return out;
  const queue = [c.start.edgeId];
  out.add(c.start.edgeId);
  while (queue.length) {
    const e = c.g.edges.get(queue.pop()!)!;
    for (const n of [e.from, e.to]) for (const a of c.g.adj.get(n) ?? []) if (c.an.deadEndEdges.has(a.edgeId) && !out.has(a.edgeId)) { out.add(a.edgeId); queue.push(a.edgeId); }
  }
  return out;
}

/**
 * A loop route is valid when it has no dead ends (no turning back) and never uses the same street twice:
 * every edge is walked at most once, and every street (OSM way) is walked in one continuous stretch only.
 * Exceptions: the start edge may be used twice in the same direction (the two halves either side of the start point),
 * and a dead-end spur the start lies in (unavoidable).
 */
export function isCleanLoop(c: { g: TrailGraph; start: EdgePos; an: NetworkAnalysis }, path: { edgeId: string; dir: 1 | -1 }[], spur: Set<string>): boolean {
  if (path.length === 0) return false;
  const seen = new Map<string, 1 | -1>();
  for (let i = 0; i < path.length; i++) {
    const { edgeId, dir } = path[i];
    if (spur.has(edgeId)) continue;
    const prev = seen.get(edgeId);
    if (prev !== undefined) {
      const wrap = edgeId === c.start.edgeId && prev === dir && i === path.length - 1; // the start edge: first and last piece, same direction
      if (!wrap) return false;
    }
    seen.set(edgeId, dir);
  }
  // Street runs (the path is a closed loop: the last run continues into the first).
  const keys = path.filter((x) => !spur.has(x.edgeId)).map((x) => streetOf(x.edgeId));
  const runs: string[] = [];
  for (const k of keys) if (runs[runs.length - 1] !== k) runs.push(k);
  if (runs.length > 1 && runs[0] === runs[runs.length - 1]) runs.pop();
  const used = new Set<string>();
  for (const k of runs) { if (used.has(k)) return false; used.add(k); }
  return true;
}

/** Nod får bli målpunkt: inte virtuell, inte spets på återvändsgren och inte vid farlig korsning. */
function eligibleNode(c: Ctx, n: string, maxDepth: number): boolean {
  const node = c.g.nodes.get(n);
  if (!node) return false;
  if (c.req.deadEndPolicy === "allow") return !c.hazard.has(n) && (c.g.adj.get(n)?.length ?? 0) >= 1;
  if ((c.g.adj.get(n)?.length ?? 0) < 2) return false;
  if (c.hazard.has(n)) return false;
  return (c.an.deadEndDepthM.get(n) ?? 0) <= maxDepth;
}

function metricsFor(c: Ctx, legs: Leg[], wps: Waypoint[], isPointToPoint: boolean): RouteMetrics {
  const { g } = c;
  // Edge sequence as walked (legs share their joining edge; the sequence counts it once).
  const path = legs.flatMap((l, i) => legSteps(g, l, i === 0));
  const all = path.map((x) => x.edgeId);
  const seen = new Set<string>();
  let reuse = 0, deadEnd = 0, total = 0, decisions = 0, hazards = 0;
  for (const id of all) {
    const e = g.edges.get(id)!;
    total += e.lengthM;
    if (seen.has(id)) reuse += e.lengthM; else seen.add(id);
    if (c.an.deadEndEdges.has(id)) deadEnd += e.lengthM;
    for (const n of [e.from, e.to]) { if (c.hazard.has(n)) hazards += 0.5; }
  }
  // A loop that leaves along one half of the start edge and comes home along the other half does not repeat anything.
  if (path.length > 1 && path[0].edgeId === c.start.edgeId && path.at(-1)!.edgeId === c.start.edgeId && path[0].dir === path.at(-1)!.dir && path.filter((x) => x.edgeId === c.start.edgeId).length === 2) {
    reuse = Math.max(0, reuse - g.edges.get(c.start.edgeId)!.lengthM);
  }
  const nodes = new Set<string>();
  for (const id of seen) { const e = g.edges.get(id)!; nodes.add(e.from); nodes.add(e.to); }
  for (const n of nodes) if (c.junction(n)) decisions++;
  const geo = joinGeometry(legs);
  let maxFar = 0;
  for (const p of geo) maxFar = Math.max(maxFar, haversineM(p, c.startLL));
  const len = legs.reduce((s, l) => s + l.lengthM, 0);
  const real = wps.filter((w) => w.kind !== "home");
  const depth = real.reduce((m, w) => Math.max(m, c.an.deadEndDepthM.get(w.nodeId) ?? 0), 0);
  const exits = real.reduce((m, w) => Math.min(m, coreExits(g, w.nodeId, c.an)), Infinity);
  let alt: number | null = null;
  if (isPointToPoint) {
    const dest = real[real.length - 1];
    const pen = new Map<string, number>();
    const mid = all.slice(1, Math.max(1, all.length - 1));
    addPenalty(pen, mid, 1000);
    const l = legBetween(g, c.start, nodePos(g, dest.nodeId), pen);
    const used = l ? l.edgeIds.slice(1, -1).filter((id) => mid.includes(id)).length : 1;
    alt = l && used === 0 ? l.lengthM / len : null;
  }
  return {
    reuseShare: total ? reuse / total : 0,
    deadEndShare: total ? deadEnd / total : 0,
    maxWaypointDeadEndDepthM: depth,
    decisionPoints: decisions,
    hazardCrossings: Math.round(hazards),
    minWaypointExits: Number.isFinite(exits) ? exits : 0,
    alternativeRatio: alt,
    directness: len ? (isPointToPoint ? haversineM(c.startLL, nodeLatLon(g, real[real.length - 1].nodeId)) : maxFar * 2) / len : 0,
  };
}

/** Riskbedömning från geografin: ingen kännedom om zombierörelser. */
function rate(m: RouteMetrics, deviation: number, tol: number, type: RouteType, mode: "escape" | "mission", ignoreDeadEnds = false): RouteProposal["quality"] {
  const flags: string[] = [];
  let s = 100;
  const over = Math.max(0, Math.abs(deviation) - tol);
  if (over > 0) { s -= Math.min(30, over * 150); flags.push(`${(deviation * 100).toFixed(0)} % off the wanted length`); }
  if (!ignoreDeadEnds && m.deadEndShare > 0.1) { s -= Math.min(25, m.deadEndShare * 60); flags.push(`${(m.deadEndShare * 100).toFixed(0)} % in dead ends`); }
  if (!ignoreDeadEnds && m.maxWaypointDeadEndDepthM > PREFERRED_MAX_DEPTH_M) { s -= 15; flags.push(`a target ${m.maxWaypointDeadEndDepthM.toFixed(0)} m into a dead end`); }
  if (!ignoreDeadEnds && m.minWaypointExits < 2) { s -= 12; flags.push("a target with only one way out of the main network"); }
  if (m.hazardCrossings > 0) { s -= Math.min(30, 10 * m.hazardCrossings); flags.push(`${m.hazardCrossings} crossing(s) with a major road`); }
  if (m.decisionPoints < 3) { s -= 10; flags.push("few route choices"); }
  if (mode === "escape" && m.alternativeRatio === null) { s -= 10; flags.push("no alternative way to the target"); }
  if (mode === "mission") {
    if (type === "out-and-back") { s -= 10; flags.push("ut-och-tillbaka"); }
    else if (m.reuseShare > 0.25) { s -= m.reuseShare * 30; flags.push(`${(m.reuseShare * 100).toFixed(0)} % upprepade segment`); }
  }
  return { score: Math.max(0, Math.round(s)), flags };
}

function mkWaypoint(c: Ctx, id: string, kind: Waypoint["kind"], nodeId: string): Waypoint {
  const ll = nodeLatLon(c.g, nodeId);
  return { id, kind, nodeId, lat: ll.lat, lon: ll.lon };
}

function finish(c: Ctx, legs: Leg[], wps: Waypoint[], mode: "escape" | "mission", idx: number): RouteProposal | null {
  const tol = c.req.tolerance ?? 0.1;
  const lengthM = legs.reduce((s, l) => s + l.lengthM, 0);
  const deviation = (lengthM - c.req.targetLengthM) / c.req.targetLengthM;
  const p2p = mode === "escape";
  const m = metricsFor(c, legs, wps, p2p);
  const type: RouteType = p2p ? "point-to-point" : m.reuseShare <= 0.25 ? "loop" : m.reuseShare >= 0.7 ? "out-and-back" : "partial-loop";
  return {
    id: `${mode}-${c.req.seed}-${idx}`,
    mode, type, waypoints: wps, lengthM, deviation, withinTolerance: Math.abs(deviation) <= tol,
    geometry: joinGeometry(legs), edgeIds: [...new Set(legs.flatMap((l) => l.edgeIds))], metrics: m,
    path: legs.flatMap((l, i) => legSteps(c.g, l, i === 0)),
    quality: rate(m, deviation, tol, type, mode, c.req.deadEndPolicy === "allow"),
  };
}

const jaccard = (a: string[], b: string[], g: TrailGraph) => {
  const A = new Set(a), B = new Set(b);
  let inter = 0, uni = 0;
  for (const id of new Set([...A, ...B])) { const l = g.edges.get(id)!.lengthM; uni += l; if (A.has(id) && B.has(id)) inter += l; }
  return uni ? inter / uni : 0;
};

/** Väljer ut upp till `count` förslag: bäst först, men tillräckligt olika (kantöverlapp < 50 %). */
function pickDiverse(c: Ctx, pool: RouteProposal[], count: number): RouteProposal[] {
  const out: RouteProposal[] = [];
  const rank = (p: RouteProposal) => p.quality.score + (p.withinTolerance ? 50 : 0) + (p.type === "loop" ? 10 : 0);
  for (const p of [...pool].sort((a, b) => rank(b) - rank(a))) {
    if (out.length >= count) break;
    if (out.every((q) => jaccard(q.edgeIds, p.edgeIds, c.g) < 0.5 && (p.mode === "mission" || haversineM(q.waypoints.at(-1)!, p.waypoints.at(-1)!) > 200))) out.push(p);
  }
  return out;
}

/** A→B: olika möjliga destinationer vars kortaste väg ligger nära önskad längd. */
function generateEscape(c: Ctx, notes: string[]): { pool: RouteProposal[]; candidates: number } {
  const L = c.req.targetLengthM;
  const tol = c.req.tolerance ?? 0.1;
  const all = [...c.dist].filter(([n, d]) => d > 0 && c.g.nodes.has(n)).map(([n, d]) => ({ n, d, dev: (d - L) / L }));
  let cands = all.filter((x) => Math.abs(x.dev) <= tol && eligibleNode(c, x.n, HARD_MAX_DEPTH_M));
  if (cands.length < (c.req.count ?? 3)) {
    // Närmaste användbara alternativ utanför toleransen.
    const near = all.filter((x) => Math.abs(x.dev) <= tol * 3 && eligibleNode(c, x.n, HARD_MAX_DEPTH_M)).sort((a, b) => Math.abs(a.dev) - Math.abs(b.dev)).slice(0, 40);
    cands = [...cands, ...near.filter((x) => !cands.includes(x))];
    if (!cands.some((x) => Math.abs(x.dev) <= tol)) notes.push(`No destination within ±${(tol * 100).toFixed(0)} % of the wanted length; showing closest alternatives.`);
  }
  if (!cands.length) { notes.push("No usable destinations found."); return { pool: [], candidates: 0 }; }
  const pool: RouteProposal[] = [];
  const sorted = cands.sort((a, b) => Math.abs(a.dev) - Math.abs(b.dev)).slice(0, c.req.maxCandidates ?? 250);
  sorted.forEach((x, i) => {
    const leg = legBetween(c.g, c.start, nodePos(c.g, x.n));
    if (!leg) return;
    const p = finish(c, [leg], [mkWaypoint(c, "B", "destination", x.n)], "escape", i);
    if (p) pool.push(p);
  });
  // Sprid destinationerna åt olika håll.
  const out: RouteProposal[] = [];
  const bearing = (p: RouteProposal) => bearingDeg(c.startLL, p.waypoints[0]);
  for (const p of [...pool].sort((a, b) => (b.quality.score + (b.withinTolerance ? 50 : 0)) - (a.quality.score + (a.withinTolerance ? 50 : 0)))) {
    if (out.length >= 24) break;
    if (out.every((q) => Math.abs(((bearing(p) - bearing(q) + 540) % 360) - 180) >= 25 && haversineM(q.waypoints[0], p.waypoints[0]) > 200)) out.push(p);
  }
  return { pool: out.length ? out : pool.slice(0, 12), candidates: cands.length };
}

/**
 * A→B med omväg: referensrutten behöver inte vara kortaste vägen. Används när för få destinationer ligger på rätt avstånd.
 * Rutten går start → via-punkt → destination, med straff på redan använda kanter så att den inte dubblerar sig.
 */
function generateEscapeVia(c: Ctx, need: number): RouteProposal[] {
  const L = c.req.targetLengthM;
  const tol = c.req.tolerance ?? 0.1;
  const elig = [...c.dist].filter(([n, d]) => d > 150 && eligibleNode(c, n, HARD_MAX_DEPTH_M)).map(([n]) => n);
  if (elig.length < 4) return [];
  const out: RouteProposal[] = [];
  const samples = c.req.samples ?? 300;
  for (let s = 0; s < samples && out.length < need * 6; s++) {
    const via = elig[Math.floor(rand(c.rng) * elig.length)];
    const dest = elig[Math.floor(rand(c.rng) * elig.length)];
    if (via === dest || haversineM(nodeLatLon(c.g, via), nodeLatLon(c.g, dest)) < 200) continue;
    // Destinationen ska ligga tydligt från start, annars är det en förklädd slinga.
    if (haversineM(nodeLatLon(c.g, dest), c.startLL) < Math.max(500, 0.15 * L)) continue;
    const pen = new Map<string, number>();
    const l1 = legBetween(c.g, c.start, nodePos(c.g, via), pen);
    if (!l1) continue;
    addPenalty(pen, l1.edgeIds, 6);
    const l2b = legBetween(c.g, nodePos(c.g, via), nodePos(c.g, dest), pen);
    if (!l2b) continue;
    const total = l1.lengthM + l2b.lengthM;
    if (Math.abs(total - L) / L > tol * 1.5) continue;
    const p = finish(c, [l1, l2b], [mkWaypoint(c, "B", "destination", dest)], "escape", 1000 + s);
    if (p && p.metrics.reuseShare <= 0.2) out.push(p);
  }
  return out;
}

/** A→A: slumpade checkpoint-uppsättningar; avsnitt planeras med straff på redan använda kanter så att slingor uppstår. */
function generateMission(c: Ctx, notes: string[]): { pool: RouteProposal[]; candidates: number; evaluated: number } {
  const L = c.req.targetLengthM;
  const ks: (1 | 2 | 3)[] = c.req.checkpoints ? [c.req.checkpoints] : L >= 2500 ? [1, 2, 3] : [1, 2];
  const samples = c.req.samples ?? 300;
  const pool: RouteProposal[] = [];
  let evaluated = 0;
  const hi = L * 0.5;
  const lo = Math.min(150, L * 0.1);
  const spur = startSpur(c);
  const streets = new Map<string, string[]>();
  for (const e of c.g.edges.values()) { const k = streetOf(e.id); (streets.get(k) ?? streets.set(k, []).get(k)!).push(e.id); }
  // Checkpoints must lie on the main network: a checkpoint inside a dead end would force the player to turn back.
  for (const maxDepth of [0]) {
    const elig = [...c.dist].filter(([n, d]) => d >= lo && d <= hi && eligibleNode(c, n, maxDepth) && haversineM(nodeLatLon(c.g, n), c.startLL) >= MIN_CHECKPOINT_FROM_START_M).map(([n]) => n);
    if (elig.length < 3) continue;
    for (const k of ks) {
      for (let s = 0; s < samples; s++) {
        const picked: string[] = [];
        for (let t = 0; t < 12 && picked.length < k; t++) {
          const n = elig[Math.floor(rand(c.rng) * elig.length)];
          if (picked.every((q) => haversineM(nodeLatLon(c.g, q), nodeLatLon(c.g, n)) >= MIN_WAYPOINT_SPACING_M)) picked.push(n);
        }
        if (picked.length < k) continue;
        // Ordna runt startpunkten (moturs eller medurs) för att få slinga i stället för sicksack.
        const dir = rand(c.rng) < 0.5 ? 1 : -1;
        picked.sort((a, b) => dir * (bearingDeg(c.startLL, nodeLatLon(c.g, a)) - bearingDeg(c.startLL, nodeLatLon(c.g, b))));
        const pen = new Map<string, number>();
        const legs: Leg[] = [];
        let from = c.start, ok = true;
        const stops = [...picked.map((n) => nodePos(c.g, n)), c.start];
        for (let i = 0; i < stops.length; i++) {
          const leg = legBetween(c.g, from, stops[i], pen);
          if (!leg) { ok = false; break; }
          legs.push(leg);
          // Used edges are (all but) forbidden for the next legs; the start edge stays open so the loop can come home on its other half.
          for (const id of leg.edgeIds) {
            if (spur.has(id)) continue;
            if (id !== c.start.edgeId) pen.set(id, BAN_PENALTY);
            for (const other of streets.get(streetOf(id)) ?? []) if (!pen.has(other)) pen.set(other, SAME_STREET_PENALTY);
          }
          from = stops[i];
        }
        evaluated++;
        if (!ok) continue;
        const total = legs.reduce((a, l) => a + l.lengthM, 0);
        if (Math.abs(total - L) / L > 0.35) continue;
        const path = legs.flatMap((l, i) => legSteps(c.g, l, i === 0));
        if (!isCleanLoop(c, path, spur)) continue;
        const wps = [...picked.map((n, i) => mkWaypoint(c, `C${i + 1}`, "checkpoint", n)), { ...mkWaypoint(c, "A", "home", c.g.edges.get(c.start.edgeId)!.from), lat: c.startLL.lat, lon: c.startLL.lon }];
        const p = finish(c, legs, wps, "mission", pool.length);
        if (p) pool.push(p);
      }
    }
    if (pool.some((p) => p.withinTolerance && p.quality.score >= 70)) break;
  }
  if (!pool.some((p) => p.withinTolerance)) notes.push(pool.length ? `No loop within ±${((c.req.tolerance ?? 0.1) * 100).toFixed(0)} % found; showing closest alternatives.` : "No loop without dead ends or repeated streets found.");
  return { pool, candidates: pool.length, evaluated };
}

/** Genererar 2–3 ruttförslag för Escape (A→B) eller Mission (A→A) på ett lokalt stignät. */
export function generateRoutes(g: TrailGraph, req: RouteRequest): RouteResult {
  const t0 = performance.now();
  const notes: string[] = [];
  const snap = snapToGraph(g, req.start);
  if (!snap || snap.offNetworkM > 150) return { proposals: [], notes: ["The start position is too far from the trail network."], stats: { candidates: 0, evaluated: 0, ms: 0 } };
  const start: EdgePos = { edgeId: snap.edgeId, distM: snap.distM };
  const c: Ctx = {
    g, an: analyzeNetwork(g), req, start, startLL: req.start,
    dist: networkDistances(g, start, req.targetLengthM * 1.6),
    rng: { rngState: (req.seed * 2246822519) >>> 0 }, hazard: req.hazardNodes ?? new Set(),
    junction: (n) => (g.adj.get(n)?.length ?? 0) >= 3,
  };
  const res = req.mode === "escape" ? { ...generateEscape(c, notes), evaluated: 0 } : generateMission(c, notes);
  if (req.mode === "escape") {
    const direct = res.pool.filter((p) => p.withinTolerance).length;
    if (direct < (req.count ?? 3)) {
      const via = generateEscapeVia(c, (req.count ?? 3) - direct);
      if (via.length) { res.pool.push(...via); notes.push(`${via.length} proposals take a detour because too few destinations lie at the right distance along the shortest path.`); }
    }
  }
  const proposals = pickDiverse(c, res.pool, req.count ?? 3);
  if (proposals.length < (req.count ?? 3)) notes.push(`Only ${proposals.length} sufficiently different proposals could be generated.`);
  return { proposals, notes, stats: { candidates: res.candidates, evaluated: res.evaluated || res.candidates, ms: performance.now() - t0 } };
}
