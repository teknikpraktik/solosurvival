import { headingFromOrientation, type CompassSource } from "@/play/compass";

interface IosOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

/** Highest number of compass readings per second passed on (the sensor gives 30–60): enough for the map to turn with the phone. */
const MAX_HZ = 60;

/**
 * Kompass via webbläsarens rörelsesensorer. iOS (Safari/PWA) kräver en användargest och ett uttryckligt tillstånd
 * (`DeviceOrientationEvent.requestPermission`); Android ger absolut orientering via `deviceorientationabsolute`.
 * Finns inga sensorer eller nekas tillståndet fungerar spelet vidare med GPS-riktning.
 */
export function createBrowserCompass(): CompassSource | undefined {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return undefined;
  let handler: ((e: Event) => void) | null = null;
  let eventName = "deviceorientation";
  const stop = () => {
    if (handler) window.removeEventListener(eventName, handler, true);
    handler = null;
  };
  return {
    async start(onSample) {
      stop();
      const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> };
      if (typeof DOE.requestPermission === "function") {
        const r = await DOE.requestPermission();
        if (r !== "granted") return "denied";
      }
      eventName = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
      let lastMs = 0;
      handler = (ev: Event) => {
        const e = ev as IosOrientationEvent;
        const now = Date.now();
        if (now - lastMs < 1000 / MAX_HZ - 4) return; // margin: event timing jitters, a 60 Hz sensor must not lose every other reading
        lastMs = now;
        const angle = (typeof screen !== "undefined" && screen.orientation?.angle) || 0;
        const h = headingFromOrientation({ alpha: e.alpha, beta: e.beta, gamma: e.gamma, absolute: e.absolute || eventName === "deviceorientationabsolute", webkitCompassHeading: e.webkitCompassHeading, webkitCompassAccuracy: e.webkitCompassAccuracy }, angle);
        onSample({ headingDeg: h.headingDeg, accuracyDeg: h.accuracyDeg, tMs: now });
      };
      window.addEventListener(eventName, handler, true);
      return "granted";
    },
    stop,
  };
}
