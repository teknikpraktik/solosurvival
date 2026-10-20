import type { Activity } from "@/config/activities";
import { rand, type RngHolder } from "@/engine/core/rng";
import { haversineM, toLocal, type LatLon } from "@/geo/geometry";
import { snapToGraph } from "@/geo/graph/graph";
import type { TrailGraph } from "@/geo/graph/types";
import { analyzeNetwork } from "./analysis";
import type { RouteMetrics, RouteProposal, RouteResult, Waypoint } from "./types";

/** Mission checkpoints are about this far apart as the crow flies (m). */
export const COURSE_SPACING_M: Record<Activity, number> = { walk: 500, run: 500, mtb: 1000 };
/** The walked/ridden way between checkpoints is longer than the straight line; used for the time limit and time estimate. */
export const COURSE_DETOUR_FACTOR = 1.35;

const MIN_FROM_START_M = 150;
const MIN_BETWEEN_M = 120;

export interface CourseRequest {
  start: LatLon;
  activity: Activity;
  targetLengthM: number;
  seed: number;
  count?: number;
  hazardNodes?: Set<string>;
  tolerance?: number;
}

const ZERO_METRICS: RouteMetrics = { reuseShare: 0, deadEndShare: 0, maxWaypointDeadEndDepthM: 0, decisionPoints: 3, hazardCrossings: 0, minWaypointExits: 2, alternativeRatio: null, directness: 1 };

interface Cand { id: string; p: LatLon; x: number; y: number }

/** Closed straight-line length: start → c1 → … → cn → start. */
const loopLength = (pts: LatLon[]): number => pts.reduce((s, q, i) => s + haversineM(i ? pts[i - 1] : q, q), 0) + (pts.length ? haversineM(pts[pts.length - 1], pts[0]) : 0);

/**
 * Mission without a route: only the checkpoints are laid out, to be fetched in order and then home. Checkpoints are network nodes
 * (so they can be reached on a trail or road) on a ring that passes through the start; the ring is rescaled until the straight-line
 * distance start → checkpoints → start matches the wanted length. A course can be made wherever the start is on the network.
 */
export function generateCourse(g: TrailGraph, req: CourseRequest): RouteResult {
  const t0 = performance.now();
  const notes: string[] = [];
  const snap = snapToGraph(g, req.start);
  if (!snap || snap.offNetworkM > 150) return { proposals: [], notes: ["The start position is too far from the trail network."], stats: { candidates: 0, evaluated: 0, ms: 0 } };
  const comp = g.edges.get(snap.edgeId)!.component;
  const an = analyzeNetwork(g);
  const hazard = req.hazardNodes ?? new Set<string>();
  const nodeIds = new Set<string>();
  for (const e of g.edges.values()) if (e.component === comp) { nodeIds.add(e.from); nodeIds.add(e.to); }
  const cands: Cand[] = [];
  for (const id of nodeIds) {
    const n = g.nodes.get(id);
    if (!n || hazard.has(id) || (an.deadEndDepthM.get(id) ?? 0) > 0 || (g.adj.get(id)?.length ?? 0) < 2) continue;
    const l = toLocal(req.start, n);
    if (Math.hypot(l.x, l.y) < MIN_FROM_START_M) continue;
    cands.push({ id, p: n, x: l.x, y: l.y });
  }
  const L = req.targetLengthM;
  const tol = req.tolerance ?? 0.1;
  const spacing = COURSE_SPACING_M[req.activity];
  const n = Math.max(2, Math.min(40, Math.round(L / spacing)));
  if (cands.length < 2) return { proposals: [], notes: ["Too few usable points on the network."], stats: { candidates: cands.length, evaluated: 0, ms: performance.now() - t0 } };
  const rng: RngHolder = { rngState: (req.seed * 2246822519) >>> 0 };
  const count = req.count ?? 3;
  const homeNode = g.edges.get(snap.edgeId)!.from;
  const proposals: RouteProposal[] = [];
  let evaluated = 0;

  const place = (theta0: number, dir: 1 | -1, R: number, jit: number[]): { ids: Cand[]; len: number } => {
    const cx = Math.cos(theta0) * R, cy = Math.sin(theta0) * R;      // ring centre; the ring passes through the start (origin)
    const psi0 = theta0 + Math.PI;                                   // direction from the centre to the start
    const used = new Set<string>();
    const chosen: Cand[] = [];
    for (let k = 1; k <= n; k++) {
      const a = psi0 + dir * ((2 * Math.PI * k) / (n + 1));
      const r = R * jit[k - 1];
      const tx = cx + Math.cos(a) * r, ty = cy + Math.sin(a) * r;
      let best: Cand | null = null, bd = Infinity;
      for (const c of cands) {
        if (used.has(c.id)) continue;
        const d = Math.hypot(c.x - tx, c.y - ty);
        if (d >= bd) continue;
        if (chosen.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < MIN_BETWEEN_M)) continue;
        best = c; bd = d;
      }
      if (!best) continue;
      used.add(best.id);
      chosen.push(best);
    }
    return { ids: chosen, len: loopLength([req.start, ...chosen.map((c) => c.p)]) };
  };

  for (let v = 0; v < count; v++) {
    const theta0 = rand(rng) * 2 * Math.PI + (v * 2 * Math.PI) / count;
    const dir: 1 | -1 = v % 2 === 0 ? 1 : -1;
    const jit = Array.from({ length: n }, () => 0.9 + rand(rng) * 0.2);
    let R = L / (2 * Math.PI);
    let best: { ids: Cand[]; len: number } | null = null;
    for (let it = 0; it < 8; it++) {
      const r = place(theta0, dir, R, jit);
      evaluated++;
      if (r.ids.length >= 2 && (!best || Math.abs(r.len - L) < Math.abs(best.len - L))) best = r;
      if (best && Math.abs(best.len - L) / L <= 0.03) break;
      if (r.len <= 0) break;
      R *= L / r.len;
    }
    if (!best) continue;
    const pts = best.ids.map((c) => c.p);
    // The first/last checkpoint should not sit on top of the start: already excluded by MIN_FROM_START_M.
    const waypoints: Waypoint[] = [
      ...best.ids.map((c, i): Waypoint => ({ id: `C${i + 1}`, kind: "checkpoint", nodeId: c.id, lat: c.p.lat, lon: c.p.lon })),
      { id: "A", kind: "home", nodeId: homeNode, lat: req.start.lat, lon: req.start.lon },
    ];
    const geometry = [req.start, ...pts, req.start];
    const lengthM = best.len;
    const deviation = (lengthM - L) / L;
    const flags: string[] = [];
    let score = 100;
    if (Math.abs(deviation) > tol) { score -= Math.min(40, Math.abs(deviation) * 100); flags.push(`${(deviation * 100).toFixed(0)} % off the wanted distance`); }
    proposals.push({
      id: `mission-${req.seed}-${v}`, mode: "mission", type: "loop", waypoints, lengthM, deviation, withinTolerance: Math.abs(deviation) <= tol,
      geometry, edgeIds: [], path: [], metrics: ZERO_METRICS, quality: { score: Math.max(0, Math.round(score)), flags },
    });
  }
  // Different courses: drop near-duplicates (same first checkpoint).
  const out: RouteProposal[] = [];
  for (const p of proposals.sort((a, b) => Math.abs(a.deviation) - Math.abs(b.deviation))) if (out.every((q) => haversineM(q.waypoints[0], p.waypoints[0]) > 150)) out.push(p);
  if (!out.some((p) => p.withinTolerance)) notes.push(`No course within ±${(tol * 100).toFixed(0)} % of the wanted distance; the map data limits it.`);
  return { proposals: out, notes, stats: { candidates: cands.length, evaluated, ms: performance.now() - t0 } };
}

