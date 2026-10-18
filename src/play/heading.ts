import { bearingDeg, haversineM, type LatLon } from "@/geo/geometry";

/** GPS-kurs (heading) används först över denna fart; under den är kursen i praktiken brus. */
export const HEADING_MIN_SPEED_MPS = 1.0;
/** Under denna fart räknas spelaren som stillastående: riktningen fryses. */
export const STATIONARY_SPEED_MPS = 0.5;
/** Kurs från förflyttning kräver minst så här lång sträcka (och minst 1,5 × noggrannheten). */
export const MIN_DISPLACEMENT_M = 12;
/** Sämsta GPS-noggrannhet (m) som får påverka riktningen. */
export const MAX_ACCURACY_M = 25;
const DEADBAND_DEG = 4;
const CONSISTENT_DEG = 45;
const ALPHA = 0.4;

export interface HeadingSample {
  /** Filtrerad (utjämnad) position. */
  pos: LatLon;
  accuracyM: number;
  /** Rå GPS-kurs/fart från enheten om den finns. */
  gpsHeadingDeg?: number | null;
  gpsSpeedMps?: number | null;
  tMs: number;
}

export const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
export const wrap360 = (d: number): number => ((d % 360) + 360) % 360;

/**
 * Stabil färdriktning för pil och Track Up. Ren presentationslogik – påverkar aldrig position eller spelmotor.
 * - Använder enhetens GPS-kurs när spelaren rör sig (≥ 1 m/s), annars kurs från förflyttning över ≥ 12 m.
 * - Stillastående, låg noggrannhet och bortfall ändrar inget: senaste tillförlitliga riktning behålls.
 * - En ny riktning måste bekräftas av två sammanhängande mätningar innan den används, och utjämnas sedan (U-sväng och
 *   90° sväng fungerar, enstaka brusiga mätningar gör det inte).
 * - Ingen kompass/sensor behövs (inga nya behörigheter): färdriktningen räcker för Track Up.
 */
export class HeadingTracker {
  private _heading: number | null = null;
  private anchor: { pos: LatLon; tMs: number } | null = null;
  private lastCandidate: number | null = null;

  /** Utjämnad riktning 0–360 (0 = norr) eller null om ingen tillförlitlig riktning ännu funnits. */
  get heading(): number | null {
    return this._heading;
  }

  /** Efter ett GPS-hopp: släpp ankaret så att hoppet inte tolkas som färdriktning, men behåll senaste riktning. */
  rebase(): void {
    this.anchor = null;
    this.lastCandidate = null;
  }

  reset(): void {
    this._heading = null;
    this.anchor = null;
    this.lastCandidate = null;
  }

  update(s: HeadingSample): number | null {
    if (s.accuracyM > MAX_ACCURACY_M) return this._heading;
    if (!this.anchor) this.anchor = { pos: s.pos, tMs: s.tMs };
    const dt = Math.max(0.2, (s.tMs - this.anchor.tMs) / 1000);
    const moved = haversineM(this.anchor.pos, s.pos);
    const derivedSpeed = moved / dt;
    const speed = s.gpsSpeedMps != null && Number.isFinite(s.gpsSpeedMps) ? s.gpsSpeedMps : derivedSpeed;

    let candidate: number | null = null;
    if (s.gpsHeadingDeg != null && Number.isFinite(s.gpsHeadingDeg) && speed >= HEADING_MIN_SPEED_MPS) {
      candidate = wrap360(s.gpsHeadingDeg);
      this.anchor = { pos: s.pos, tMs: s.tMs };
    } else if (moved >= Math.max(MIN_DISPLACEMENT_M, 1.5 * s.accuracyM) && derivedSpeed >= STATIONARY_SPEED_MPS + 0.2) {
      candidate = bearingDeg(this.anchor.pos, s.pos);
      this.anchor = { pos: s.pos, tMs: s.tMs };
    } else if (speed < STATIONARY_SPEED_MPS && dt > 15) {
      // Stilla länge: släpp ankaret så att långsamt brus inte ackumuleras till en falsk förflyttning.
      this.anchor = { pos: s.pos, tMs: s.tMs };
      this.lastCandidate = null;
    }
    if (candidate === null) return this._heading;

    // Bekräfta med en sammanhängande föregående mätning innan riktningen ändras.
    const prev = this.lastCandidate;
    this.lastCandidate = candidate;
    if (prev === null || Math.abs(wrap180(candidate - prev)) > CONSISTENT_DEG) return this._heading;

    if (this._heading === null) {
      this._heading = candidate;
      return this._heading;
    }
    const delta = wrap180(candidate - this._heading);
    if (Math.abs(delta) < DEADBAND_DEG) return this._heading;
    this._heading = wrap360(this._heading + delta * ALPHA);
    return this._heading;
  }
}

/** Nästa visuella vinkel som följer kortaste vägen från `current` mot `target` (utan hopp över 360). */
export function unwrapToward(current: number, target: number): number {
  return current + wrap180(target - current);
}
