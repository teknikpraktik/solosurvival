import { wrap360 } from "./heading";

/** Delmängd av DeviceOrientationEvent (inkl. iOS-tillägg) så att logiken kan testas utan webbläsare. */
export interface OrientationLike {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  /** True för `deviceorientationabsolute` (alpha räknas från magnetisk norr). */
  absolute?: boolean;
  /** iOS Safari: kompasskurs i grader medsols från magnetisk norr, redan tiltkompenserad. */
  webkitCompassHeading?: number | null;
  /** iOS Safari: uppskattat fel i grader; negativt = ogiltig. */
  webkitCompassAccuracy?: number | null;
}

export interface CompassSample {
  headingDeg: number | null;
  accuracyDeg: number | null;
  tMs: number;
}

export type CompassStatus = "off" | "on" | "denied" | "unsupported";

/** Källa för kompassdata (webbläsarens sensorer, eller en fejkad i test). `start` måste anropas från en användargest på iOS. */
export interface CompassSource {
  start(onSample: (s: CompassSample) => void): Promise<"granted" | "denied" | "unsupported">;
  stop(): void;
}

/** Kompasskurs sämre än så här (grader fel) används inte. */
export const COMPASS_MAX_ERROR_DEG = 35;

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Kompasskurs (0 = norr, medsols) ur en orienteringshändelse, eller null när den inte går att lita på.
 * - iOS: `webkitCompassHeading` (tiltkompenserad). Negativ eller för dålig `webkitCompassAccuracy` ⇒ null.
 * - Android/övriga: kräver absolut orientering (alpha mot magnetisk norr); kursen räknas ur alpha/beta/gamma så att den gäller åt det håll
 *   telefonen pekar även när den hålls upprätt (W3C:s kompassexempel). `screenAngleDeg` är skärmens rotation.
 * Magnetisk norr används utan deklinationskorrektion (≈ 5° öster i Värmland): kompassen är ett stöd för orienteringen, inte för navigering.
 */
export function headingFromOrientation(e: OrientationLike, screenAngleDeg = 0): { headingDeg: number | null; accuracyDeg: number | null } {
  if (e.webkitCompassHeading != null && Number.isFinite(e.webkitCompassHeading)) {
    const acc = e.webkitCompassAccuracy;
    if (acc != null && (acc < 0 || acc > COMPASS_MAX_ERROR_DEG)) return { headingDeg: null, accuracyDeg: acc >= 0 ? acc : null };
    return { headingDeg: wrap360(e.webkitCompassHeading + screenAngleDeg), accuracyDeg: acc ?? null };
  }
  if (!e.absolute || e.alpha == null || e.beta == null || e.gamma == null) return { headingDeg: null, accuracyDeg: null };
  const x = rad(e.beta), y = rad(e.gamma), z = rad(e.alpha);
  const cY = Math.cos(y), cZ = Math.cos(z), sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);
  const vx = -cZ * sY - sZ * sX * cY;
  const vy = -sZ * sY + cZ * sX * cY;
  if (Math.abs(vx) < 1e-6 && Math.abs(vy) < 1e-6) return { headingDeg: null, accuracyDeg: null }; // telefonen ligger exakt plant: ingen riktning
  return { headingDeg: wrap360((Math.atan2(vx, vy) * 180) / Math.PI + screenAngleDeg), accuracyDeg: null };
}
