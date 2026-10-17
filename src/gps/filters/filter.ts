import { GPS_ACCURACY } from "@/config/game-rules";
import { haversineM, isValidLatLon, type LatLon } from "@/geo/geometry";
import type { GPSFix, GpsQuality } from "../types";

export function classifyAccuracy(accuracyM: number): GpsQuality {
  if (accuracyM <= GPS_ACCURACY.okM) return "ok";
  if (accuracyM <= GPS_ACCURACY.verifyM) return "verify";
  if (accuracyM <= GPS_ACCURACY.infectionPausedM) return "infection_paused";
  return "warning";
}

export interface FilterOptions {
  maxPlausibleSpeedMps: number;
  /** Äldre fixar än så här ignoreras. */
  maxFixAgeMs?: number;
  /** Utan godkänd fix så här länge räknas positionen som otillgänglig. */
  staleAfterMs?: number;
  /** Antal konsekutiva "hopp" till samma nya plats innan den accepteras som verklig. */
  reacquireCount?: number;
}

export type FilterVerdict = "accepted" | "invalid" | "stale" | "jump" | "reacquired";

export interface FilterOutput {
  verdict: FilterVerdict;
  /** Filtrerad spelposition (skild från rå GPS), eller null om ingen finns än. */
  position: LatLon | null;
  quality: GpsQuality;
}

/**
 * Filtrerar rå GPS till en spelposition: avvisar ogiltiga/gamla fixar och osannolika hopp,
 * och utjämnar brus med ett positions-Kalman som inte skapar konstgjord rörelse (PRD 6.2).
 */
export class GpsFilter {
  private est: LatLon | null = null;
  private varM2 = 0;
  private lastTs = 0;
  private lastAccepted: GPSFix | null = null;
  private jumpCandidate: { pos: LatLon; n: number } | null = null;
  private readonly o: Required<FilterOptions>;

  constructor(opts: FilterOptions) {
    this.o = { maxFixAgeMs: 10_000, staleAfterMs: 5_000, reacquireCount: 3, ...opts };
  }

  get position(): LatLon | null {
    return this.est;
  }

  /** Kvalitet vid tidpunkten `nowMs` (utan ny fix): otillgänglig om senaste godkända fix är för gammal. */
  qualityAt(nowMs: number): GpsQuality {
    if (!this.est || !this.lastAccepted) return "unavailable";
    if (nowMs - this.lastTs > this.o.staleAfterMs) return "unavailable";
    return classifyAccuracy(this.lastAccepted.accuracyM);
  }

  push(fix: GPSFix, nowMs: number): FilterOutput {
    const pos = { lat: fix.latitude, lon: fix.longitude };
    const bad = (verdict: FilterVerdict): FilterOutput => ({
      verdict,
      position: this.est,
      quality: this.qualityAt(nowMs),
    });
    if (!isValidLatLon(pos) || !Number.isFinite(fix.accuracyM) || fix.accuracyM < 0) return bad("invalid");
    if (nowMs - fix.timestampMs > this.o.maxFixAgeMs) return bad("stale");

    if (!this.est || !this.lastAccepted) return this.accept(fix, pos, "accepted");

    const dt = Math.max(0.2, (fix.timestampMs - this.lastTs) / 1000);
    const dist = haversineM(this.est, pos);
    // Förflyttning som inte kan förklaras av fart + positionsosäkerhet är ett hopp.
    const allowed = this.o.maxPlausibleSpeedMps * dt + this.lastAccepted.accuracyM + fix.accuracyM;
    if (dist > allowed) {
      const c = this.jumpCandidate;
      if (c && haversineM(c.pos, pos) < fix.accuracyM + 15) {
        c.n++;
        c.pos = pos;
      } else {
        this.jumpCandidate = { pos, n: 1 };
      }
      if (this.jumpCandidate!.n >= this.o.reacquireCount) {
        this.jumpCandidate = null;
        this.est = null;
        return this.accept(fix, pos, "reacquired");
      }
      return bad("jump");
    }
    this.jumpCandidate = null;
    return this.accept(fix, pos, "accepted");
  }

  private accept(fix: GPSFix, pos: LatLon, verdict: FilterVerdict): FilterOutput {
    const r = Math.max(3, fix.accuracyM) ** 2;
    if (!this.est) {
      this.est = pos;
      this.varM2 = r;
    } else {
      const dt = Math.max(0.2, (fix.timestampMs - this.lastTs) / 1000);
      // Processbrus: spelaren kan röra sig ungefär en halv maxfart.
      const q = (this.o.maxPlausibleSpeedMps * 0.5) ** 2 * dt * dt;
      const p = this.varM2 + q;
      const k = p / (p + r);
      this.est = {
        lat: this.est.lat + (pos.lat - this.est.lat) * k,
        lon: this.est.lon + (pos.lon - this.est.lon) * k,
      };
      this.varM2 = (1 - k) * p;
    }
    this.lastTs = fix.timestampMs;
    this.lastAccepted = fix;
    return { verdict, position: this.est, quality: classifyAccuracy(fix.accuracyM) };
  }
}
