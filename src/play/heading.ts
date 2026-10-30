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

export type HeadingSource = "gps" | "compass" | "held" | "none";

/** Direction for the map and the player arrow. `deg` turns the map (Track Up); `courseDeg` is the direction of travel, for the arrow. */
export interface FusedHeading {
  deg: number | null;
  source: HeadingSource;
  /** Direction of travel (GPS) while moving; otherwise the same as `deg`. The arrow is drawn at this angle relative to the map. */
  courseDeg: number | null;
}

/** GPS-kursen litas på över denna (utjämnade) fart; under den används kompassen om den finns. */
export const FUSION_MOVING_MPS = 1.2;
/** En kompassmätning äldre än så här (ms) räknas som bortfall. */
export const COMPASS_MAX_AGE_MS = 2_000;
/** Hur länge (ms) den senast gångna riktningen visas efter att man stannat utan kompass; därefter är riktningen okänd. */
export const HELD_MAX_AGE_MS = 30_000;
/** Kompassen får ändra den visade kursen först när den skiljer sig minst så här mycket (grader): hindrar darrning. */
const COMPASS_DEADBAND_DEG = 0.5;
/**
 * Compass filter (one-euro): smooths hard when the phone is held still (no jitter) and hardly at all when it turns fast (no lag).
 * Cut-off frequency (Hz) at rest, how much it rises per °/s of turn rate, and the cut-off for the turn-rate estimate.
 */
const COMPASS_MIN_CUTOFF_HZ = 0.8;
const COMPASS_BETA = 0.02;
const COMPASS_D_CUTOFF_HZ = 1;
/** Compass correction: learned from GPS while moving, only when the two agree within this (a glance to the side is not learned)… */
export const BIAS_GATE_DEG = 25;
/** …with this time constant (s), so a constant error (declination, mount, phone held askew) is gone within about a minute. */
export const BIAS_TAU_S = 15;
/** A larger but steady disagreement while moving for this long (s) is a constant compass error (magnet in the mount): adopted at once. */
export const BIAS_SNAP_S = 10;
const BIAS_SNAP_SPREAD_DEG = 30;

/** One-euro low-pass filter on an angle (unwrapped, so it never turns the long way round). */
class AngleFilter {
  private x: number | null = null;
  private dx = 0;
  private tMs = 0;
  push(deg: number, tMs: number): number {
    if (this.x === null) { this.x = deg; this.dx = 0; this.tMs = tMs; return wrap360(deg); }
    const dt = Math.max(1e-3, (tMs - this.tMs) / 1000);
    this.tMs = tMs;
    const raw = this.x + wrap180(deg - this.x);
    const a = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.dx += a(COMPASS_D_CUTOFF_HZ) * ((raw - this.x) / dt - this.dx);
    this.x += a(COMPASS_MIN_CUTOFF_HZ + COMPASS_BETA * Math.abs(this.dx)) * (raw - this.x);
    return wrap360(this.x);
  }
  reset(): void { this.x = null; }
}

/**
 * Slår ihop GPS-färdriktning och kompass. Ren presentationslogik, samma för till fots och cykel.
 * - Kartan (`deg`) följer kompassen när den finns och är färsk, även i rörelse: vrider man telefonen eller huvudet vrids kartan samtidigt.
 *   Kompassen rättas med en korrektion som lärs från GPS-kursen i rörelse (missvisning, hållare, snett hållen telefon).
 * - Pilen (`courseDeg`) visar färdriktningen från GPS i rörelse, relativt kartan; stillastående pekar den dit telefonen pekar.
 * - Utan kompass (eller med kompassvyn avslagen): GPS-kursen i rörelse, kompassen stilla, senast gångna riktning ("held") i högst 30 s,
 *   sedan okänd (`none`) i stället för gammal och missvisande.
 */
export class HeadingFusion {
  /** Compass turns the map also while moving (the setting "Compass turns the map"). Off: the map follows GPS while moving, as before. */
  compassView = true;
  private compass: { deg: number; tMs: number } | null = null;
  private readonly filter = new AngleFilter();
  private gps: { deg: number; tMs: number } | null = null;
  private lastMovingMs = -Infinity;
  private shown: FusedHeading | null = null;
  private biasDeg = 0;
  private lastBiasMs: number | null = null;
  private snap: { sinceMs: number; errDeg: number } | null = null;

  pushCompass(deg: number | null, tMs: number): void {
    if (deg === null) return; // bortfall märks av att mätningen blir gammal
    if (this.compass && tMs - this.compass.tMs > COMPASS_MAX_AGE_MS) this.filter.reset();
    this.compass = { deg: this.filter.push(wrap360(deg), tMs), tMs };
  }

  /** Senaste GPS-baserade riktning (från HeadingTracker) och utjämnad fart; anropas vid varje GPS-fix. */
  pushGps(deg: number | null, speedMps: number | null, tMs: number): void {
    if (deg !== null) this.gps = { deg, tMs };
    const moving = speedMps !== null && speedMps >= FUSION_MOVING_MPS && deg !== null;
    if (moving) this.lastMovingMs = tMs;
    if (moving && this.compassFresh(tMs)) this.learnBias(deg!, tMs);
    else { this.lastBiasMs = null; this.snap = null; }
  }

  private compassFresh(tMs: number): boolean {
    return this.compass !== null && tMs - this.compass.tMs <= COMPASS_MAX_AGE_MS;
  }

  private learnBias(gpsDeg: number, tMs: number): void {
    const err = wrap180(gpsDeg - (this.compass!.deg + this.biasDeg));
    const dt = this.lastBiasMs === null ? 0 : Math.min(2, (tMs - this.lastBiasMs) / 1000);
    this.lastBiasMs = tMs;
    if (Math.abs(err) <= BIAS_GATE_DEG) {
      this.snap = null;
      this.biasDeg = wrap180(this.biasDeg + err * (1 - Math.exp(-dt / BIAS_TAU_S)));
      return;
    }
    if (!this.snap || Math.abs(wrap180(err - this.snap.errDeg)) > BIAS_SNAP_SPREAD_DEG) { this.snap = { sinceMs: tMs, errDeg: err }; return; }
    if (tMs - this.snap.sinceMs >= BIAS_SNAP_S * 1000) {
      this.biasDeg = wrap180(this.biasDeg + err);
      this.snap = null;
    }
  }

  /** Learned compass correction (degrees), for the field log. */
  get compassBiasDeg(): number { return this.biasDeg; }

  /** Compass minus GPS course right now (degrees, after the correction), or null when not moving with a fresh compass. For the field log. */
  disagreement(tMs: number): { gpsDeg: number; compassDeg: number; biasDeg: number; errDeg: number } | null {
    if (!this.gps || tMs - this.lastMovingMs >= 3_000 || !this.compassFresh(tMs)) return null;
    const compassDeg = this.compass!.deg;
    return { gpsDeg: this.gps.deg, compassDeg, biasDeg: this.biasDeg, errDeg: wrap180(compassDeg + this.biasDeg - this.gps.deg) };
  }

  reset(): void {
    this.compass = null;
    this.filter.reset();
    this.gps = null;
    this.lastMovingMs = -Infinity;
    this.shown = null;
    this.biasDeg = 0;
    this.lastBiasMs = null;
    this.snap = null;
  }

  /** Aktuell riktning för kartan och pilen, och varifrån kartans riktning kommer. */
  get(tMs: number): FusedHeading {
    const moving = tMs - this.lastMovingMs < 3_000 && this.gps !== null;
    const compass = this.compassFresh(tMs) ? wrap360(this.compass!.deg + this.biasDeg) : null;
    let view: { deg: number; source: HeadingSource } | null = null;
    if (compass !== null && (this.compassView || !moving)) view = { deg: compass, source: "compass" };
    else if (moving) view = { deg: this.gps!.deg, source: "gps" };
    else if (this.gps && tMs - this.lastMovingMs <= HELD_MAX_AGE_MS) view = { deg: this.gps.deg, source: "held" };
    if (!view) { this.shown = null; return { deg: null, source: "none", courseDeg: null }; }
    const next: FusedHeading = { ...view, courseDeg: moving ? this.gps!.deg : view.deg };
    const s = this.shown;
    // Standing still the arrow follows the map, so the dead band covers both; moving, a new GPS course always gets through.
    if (s && s.source === "compass" && next.source === "compass" && (!moving || s.courseDeg === next.courseDeg) && Math.abs(wrap180(next.deg! - s.deg!)) < COMPASS_DEADBAND_DEG) return s;
    this.shown = next;
    return next;
  }
}
