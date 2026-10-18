import { bearingDeg, haversineM, pointAlong, type LatLon } from "@/geo/geometry";
import type { GraphEdge, TrailGraph } from "@/geo/graph/types";

/** Auktoritativ zombieposition från motorn (kant + sträcka längs kanten). */
export interface ZombieTarget {
  id: string;
  edgeId: string;
  distM: number;
  speedMps: number;
  chasing: boolean;
  sprinting?: boolean;
}

export interface ZombieFrame {
  id: string;
  lat: number;
  lon: number;
  chasing: boolean;
  sprinting: boolean;
  /** Färdriktning (0–360, 0 = norr) senast den rörde sig, annars null. */
  bearing: number | null;
}

/** Större avstånd än så mellan visuell och auktoritativ position räknas som omplacering (spawn/återställning) och animeras inte. */
const SNAP_GAP_M = 30;
/** Visuell inhämtningstid (s): positionen når målet ungefär så här lång tid efter en uppdatering. */
const CATCH_UP_S = 0.5;

interface Visual {
  edgeId: string;
  distM: number;
  target: ZombieTarget;
  last?: LatLon;
  bearing: number | null;
}

const endDist = (e: GraphEdge, node: string) => (node === e.to ? e.lengthM : 0);

/**
 * Visuell animation av zombier mellan motorns positionsuppdateringar. Ren presentation:
 * - Rör sig bara längs grafens verkliga kantgeometri (aldrig rakt mellan två punkter), via kantens polylinje.
 * - Hastigheten begränsas (högst ~6 × zombiens fart), så det finns ingen teleportering; bara riktiga omplaceringar (> 30 m) hoppar.
 * - Läser aldrig tillbaka till motorn och påverkar varken kollision, infektion eller spelets tillstånd.
 */
export class ZombieAnimator {
  private v = new Map<string, Visual>();
  constructor(private readonly g: TrailGraph) {}

  /** Nytt auktoritativt ögonblick. Zombier som försvunnit tas bort. */
  setTargets(list: ZombieTarget[]): void {
    const seen = new Set<string>();
    for (const t of list) {
      seen.add(t.id);
      const cur = this.v.get(t.id);
      if (!cur) this.v.set(t.id, { edgeId: t.edgeId, distM: t.distM, target: t, bearing: null });
      else cur.target = t;
    }
    for (const id of [...this.v.keys()]) if (!seen.has(id)) this.v.delete(id);
  }

  /** Flyttar de visuella positionerna `dtS` sekunder mot målen. */
  step(dtS: number): void {
    for (const z of this.v.values()) this.advance(z, dtS);
  }

  private advance(z: Visual, dtS: number): void {
    const t = z.target;
    const g = this.g;
    const cur = g.edges.get(z.edgeId);
    const tgt = g.edges.get(t.edgeId);
    if (!cur || !tgt) { z.edgeId = t.edgeId; z.distM = t.distM; return; }
    if (z.edgeId === t.edgeId) {
      const gap = t.distM - z.distM;
      if (Math.abs(gap) > SNAP_GAP_M) { z.distM = t.distM; return; }
      z.distM += clampMove(gap, rate(t, Math.abs(gap)) * dtS);
      return;
    }
    // Olika kanter: gå via en gemensam nod om kanterna ligger intill varandra.
    let best: { node: string; dv: number; dt: number } | null = null;
    for (const n of [cur.from, cur.to]) {
      if (n !== tgt.from && n !== tgt.to) continue;
      const dv = Math.abs(endDist(cur, n) - z.distM);
      const dt = Math.abs(endDist(tgt, n) - t.distM);
      if (!best || dv + dt < best.dv + best.dt) best = { node: n, dv, dt };
    }
    if (!best || best.dv + best.dt > SNAP_GAP_M) { z.edgeId = t.edgeId; z.distM = t.distM; return; }
    const gap = best.dv + best.dt;
    const move = Math.min(gap, rate(t, gap) * dtS);
    if (move < best.dv) {
      z.distM += Math.sign(endDist(cur, best.node) - z.distM) * move;
    } else {
      // Förbi noden: ligger nu på målkanten, `move - dv` meter från noden mot målet.
      const along = move - best.dv;
      z.edgeId = t.edgeId;
      const from = endDist(tgt, best.node);
      z.distM = from + Math.sign(t.distM - from) * along;
    }
  }

  /** Aktuella visuella positioner på kantgeometrin. */
  frames(): ZombieFrame[] {
    const out: ZombieFrame[] = [];
    for (const [id, z] of this.v) {
      const e = this.g.edges.get(z.edgeId);
      if (!e) continue;
      const p: LatLon = pointAlong(e.geometry, e.cumM, Math.max(0, Math.min(e.lengthM, z.distM)));
      // Riktning ur den visuella förflyttningen (minst 0,3 m), så pilen följer stigens faktiska riktning.
      if (!z.last) z.last = p;
      else if (haversineM(z.last, p) >= 0.3) { z.bearing = bearingDeg(z.last, p); z.last = p; }
      out.push({ id, lat: p.lat, lon: p.lon, chasing: z.target.chasing, sprinting: !!z.target.sprinting, bearing: z.bearing });
    }
    return out;
  }
}

const rate = (t: ZombieTarget, gap: number) => Math.min(Math.max(t.speedMps * 1.2, gap / CATCH_UP_S), Math.max(1, t.speedMps) * 6);
const clampMove = (gap: number, max: number) => Math.sign(gap) * Math.min(Math.abs(gap), max);
