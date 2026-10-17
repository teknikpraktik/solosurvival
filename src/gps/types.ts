export type GPSFix = {
  latitude: number;
  longitude: number;
  accuracyM: number;
  timestampMs: number;
  speedMps?: number | null;
  headingDeg?: number | null;
};

/**
 * Positionskvalitet som spelmotorn agerar på (PRD 6.3).
 * - ok: normal
 * - verify: infektion kräver längre kontakt
 * - infection_paused: spelet går, men infektionstimern står still
 * - warning / unavailable: spelklocka och zombier pausas
 */
export type GpsQuality = "ok" | "verify" | "infection_paused" | "warning" | "unavailable";
