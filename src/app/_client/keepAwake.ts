/**
 * Keeps the screen on while a match is running (the session asks through its wakeLock dependency, src/play/session.ts).
 *
 * After the field test the screen still went dark after a few minutes. Two causes are handled here:
 * - the browser may drop a Screen Wake Lock on its own (it fires "release"); while it is wanted it is asked for again, at once and when
 *   the page is visible again;
 * - iOS before 18.4 hands out a wake lock in an installed (home-screen) app that does nothing, and older browsers have none. There a
 *   tiny silent, muted video plays in a loop, invisibly: a playing inline video keeps iOS from dimming and locking the screen.
 * The session also asks again on its own every few seconds while a match runs, so one lost request never leaves the screen to sleep.
 */
type Sentinel = { released?: boolean; release(): Promise<void>; addEventListener?(t: "release", f: () => void): void };
type WakeLockApi = { request(t: "screen"): Promise<Sentinel> };

/** 2 s of a black 64×64 picture with a silent track (H.264 baseline + AAC), about 3 KB. Inline so no cache or range request is involved. */
const VIDEO = "data:video/mp4;base64,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";

const isIos = (): boolean => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

let video: HTMLVideoElement | null = null;
function videoOn(): void {
  if (!video) {
    video = document.createElement("video");
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.setAttribute("aria-hidden", "true");
    video.muted = true;
    video.loop = true;
    video.src = VIDEO;
    Object.assign(video.style, { position: "fixed", width: "1px", height: "1px", opacity: "0.01", pointerEvents: "none", left: "0", bottom: "0" });
    document.body.appendChild(video);
  }
  void video.play().catch(() => undefined);
}
function videoOff(): void { video?.pause(); }

let wanted = false;
let sentinel: Sentinel | null = null;
let listening = false;

async function nativeOn(): Promise<boolean> {
  const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  if (!api || document.hidden) return false;
  if (sentinel && !sentinel.released) return true;
  try {
    const s = await api.request("screen");
    sentinel = s;
    // Dropped by the browser while still wanted: ask again (it only works while the page is visible; see the listener below).
    s.addEventListener?.("release", () => { if (sentinel === s) sentinel = null; if (wanted && !document.hidden) void nativeOn(); });
    return true;
  } catch { sentinel = null; return false; }
}

async function on(): Promise<void> {
  wanted = true;
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", () => { if (wanted && !document.hidden) void on(); });
  }
  const native = await nativeOn();
  if (!native || isIos()) videoOn();
}

async function off(): Promise<void> {
  wanted = false;
  videoOff();
  const s = sentinel;
  sentinel = null;
  try { await s?.release(); } catch { /* already released */ }
}

/** The session's wakeLock dependency: request keeps the screen on until the handle is released. */
export const keepAwake = {
  async request(): Promise<{ release(): Promise<void> }> {
    await on();
    return { release: off };
  },
};
