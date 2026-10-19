import { haversineM, type LatLon } from "@/geo/geometry";

/** Window (ms) used to derive speed from positions when the device reports none. */
const WINDOW_MS = 6000;
/** Speed readings older than this are not shown (GPS lost / stopped updating). */
export const SPEED_STALE_MS = 6000;
const ALPHA = 0.5;

/** Smoothed player speed for display only (never affects the game engine). */
export class SpeedTracker {
  private samples: { pos: LatLon; tMs: number }[] = [];
  private _mps: number | null = null;
  private atMs = -Infinity;

  push(pos: LatLon, tMs: number, gpsSpeedMps?: number | null): void {
    this.samples.push({ pos, tMs });
    while (this.samples.length > 1 && tMs - this.samples[0].tMs > WINDOW_MS) this.samples.shift();
    let v: number | null = null;
    if (gpsSpeedMps != null && Number.isFinite(gpsSpeedMps) && gpsSpeedMps >= 0) v = gpsSpeedMps;
    else {
      const a = this.samples[0];
      const dt = (tMs - a.tMs) / 1000;
      if (dt >= 1.5) v = haversineM(a.pos, pos) / dt;
    }
    if (v === null) return;
    this._mps = this._mps === null ? v : this._mps + ALPHA * (v - this._mps);
    this.atMs = tMs;
  }

  /** Smoothed speed in m/s, or null when there is no recent reading. Speeds under 0.5 m/s count as standing still. */
  speedAt(tMs: number): number | null {
    if (this._mps === null || tMs - this.atMs > SPEED_STALE_MS) return null;
    return this._mps < 0.5 ? 0 : this._mps;
  }

  reset(): void { this.samples = []; this._mps = null; this.atMs = -Infinity; }
}
