import type { GPSFix } from "../types";

export type GpsErrorCode = "denied" | "unavailable" | "timeout" | "unsupported";

export type GpsEvent = { type: "fix"; fix: GPSFix; receivedAtMs: number } | { type: "error"; code: GpsErrorCode; message: string };

/** Delmängd av navigator.geolocation så att leverantören kan testas utan webbläsare. */
export interface GeoLike {
  watchPosition(
    ok: (p: { coords: { latitude: number; longitude: number; accuracy: number; speed: number | null; heading: number | null }; timestamp: number }) => void,
    err: (e: { code: number; message: string }) => void,
    opts?: { enableHighAccuracy?: boolean; maximumAge?: number; timeout?: number },
  ): number;
  clearWatch(id: number): void;
}

/**
 * Tunn omslutning av Geolocation API. Ingen filtrering här: GpsFilter och motorn avgör vad som får användas.
 * Fixar levereras i den ordning de kommer, med mottagningstid (klockan på enheten).
 */
export class GpsProvider {
  private id: number | null = null;
  constructor(
    private readonly geo: GeoLike | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  get supported(): boolean {
    return !!this.geo;
  }

  get running(): boolean {
    return this.id !== null;
  }

  start(listener: (e: GpsEvent) => void): void {
    if (!this.geo) {
      listener({ type: "error", code: "unsupported", message: "This device or browser does not support location." });
      return;
    }
    this.stop();
    this.id = this.geo.watchPosition(
      (p) =>
        listener({
          type: "fix",
          receivedAtMs: this.now(),
          fix: {
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracyM: p.coords.accuracy,
            timestampMs: p.timestamp,
            speedMps: p.coords.speed,
            headingDeg: p.coords.heading,
          },
        }),
      (e) => {
        // GeolocationPositionError: 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        const code: GpsErrorCode = e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable";
        listener({ type: "error", code, message: e.message });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  }

  stop(): void {
    if (this.id !== null) this.geo?.clearWatch(this.id);
    this.id = null;
  }
}

export const errorText: Record<GpsErrorCode, string> = {
  denied: "Location access denied. Allow location for this site in your browser settings and reload.",
  unavailable: "No location available right now. Move to open sky.",
  timeout: "Getting a location is taking long. Move to open sky.",
  unsupported: "This browser does not support location.",
};
