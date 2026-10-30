import { describe, expect, it } from "vitest";
import { BearingSmoother, BEARING_SETTLED_DEG } from "@/play/bearing";
import { COMPASS_MAX_ERROR_DEG, headingFromOrientation } from "@/play/compass";
import { BIAS_SNAP_S, BIAS_TAU_S, COMPASS_MAX_AGE_MS, FUSION_MOVING_MPS, HELD_MAX_AGE_MS, HeadingFusion, wrap180 } from "@/play/heading";

describe("kompass ur orienteringsdata", () => {
  it("iOS: webkitCompassHeading används som den är, med skärmrotation", () => {
    expect(headingFromOrientation({ alpha: null, beta: null, gamma: null, webkitCompassHeading: 123.4, webkitCompassAccuracy: 10 }).headingDeg).toBeCloseTo(123.4);
    expect(headingFromOrientation({ alpha: null, beta: null, gamma: null, webkitCompassHeading: 350 }, 90).headingDeg).toBeCloseTo(80);
  });
  it("iOS: ogiltig eller dålig noggrannhet ger ingen riktning i stället för en missvisande", () => {
    expect(headingFromOrientation({ alpha: null, beta: null, gamma: null, webkitCompassHeading: 90, webkitCompassAccuracy: -1 }).headingDeg).toBeNull();
    expect(headingFromOrientation({ alpha: null, beta: null, gamma: null, webkitCompassHeading: 90, webkitCompassAccuracy: COMPASS_MAX_ERROR_DEG + 1 }).headingDeg).toBeNull();
  });
  it("Android: kräver absolut orientering; alpha 0 plant = norr, 90 = väster (kompassen räknar medsols)", () => {
    expect(headingFromOrientation({ alpha: 0, beta: 0, gamma: 0 }).headingDeg).toBeNull(); // relativ orientering
    expect(headingFromOrientation({ alpha: 0, beta: 90, gamma: 0, absolute: true }).headingDeg).toBeCloseTo(0, 3);
    expect(headingFromOrientation({ alpha: 90, beta: 90, gamma: 0, absolute: true }).headingDeg).toBeCloseTo(270, 3);
    expect(headingFromOrientation({ alpha: 270, beta: 90, gamma: 0, absolute: true }).headingDeg).toBeCloseTo(90, 3);
  });
  it("saknade värden ger null", () => {
    expect(headingFromOrientation({ alpha: null, beta: 10, gamma: 0, absolute: true }).headingDeg).toBeNull();
  });
});

describe("BearingSmoother (mjuk kartrotation)", () => {
  const run = (s: BearingSmoother, secs: number, fps: number) => { for (let i = 0; i < secs * fps; i++) s.step(1 / fps); };
  it("når målet utan ryck och utan fördröjning över en sekund", () => {
    const s = new BearingSmoother(0);
    s.setTarget(90);
    run(s, 0.25, 60);
    expect(s.value).toBeGreaterThan(40); // redan en bit på väg efter en kvarts sekund
    run(s, 0.75, 60);
    expect(Math.abs(s.value - 90)).toBeLessThan(2); // en sekund: i princip framme
    run(s, 1.5, 60);
    expect(Math.abs(s.value - 90)).toBeLessThan(BEARING_SETTLED_DEG + 1e-9);
    expect(s.settled).toBe(true);
  });
  it("samma resultat oavsett bildfrekvens", () => {
    const a = new BearingSmoother(0), b = new BearingSmoother(0);
    a.setTarget(120); b.setTarget(120);
    run(a, 0.5, 30); run(b, 0.5, 120);
    expect(Math.abs(a.value - b.value)).toBeLessThan(2);
  });
  it("tar kortaste vägen över 0°/360° och rör sig aldrig fortare än maxfarten", () => {
    const s = new BearingSmoother(350);
    s.setTarget(10);
    expect(s.target).toBe(370);
    const before = s.value;
    s.step(0.016);
    expect(s.value - before).toBeLessThanOrEqual(420 * 0.016 + 1e-9);
    expect(s.value).toBeGreaterThan(before);
    const u = new BearingSmoother(0);
    u.setTarget(180);
    const v0 = u.value;
    u.step(0.05);
    expect(u.value - v0).toBeLessThanOrEqual(420 * 0.05 + 1e-9);
  });
  it("står stilla när målet inte ändras", () => {
    const s = new BearingSmoother(33);
    s.setTarget(33);
    expect(s.step(0.016)).toBe(false);
  });
});

describe("HeadingFusion (GPS + kompass, North Up/Track Up)", () => {
  it("kompassvyn av: i rörelse gäller GPS-kursen för kartan, även om kompassen visar något annat", () => {
    const f = new HeadingFusion();
    f.compassView = false;
    f.pushCompass(200, 1000);
    f.pushGps(75, FUSION_MOVING_MPS + 0.3, 1000);
    expect(f.get(1000)).toEqual({ deg: 75, source: "gps", courseDeg: 75 });
  });
  it("kompassvyn på: i rörelse vrids kartan efter kompassen och pilen visar GPS-färdriktningen", () => {
    const f = new HeadingFusion();
    f.pushCompass(200, 1000);
    f.pushGps(75, FUSION_MOVING_MPS + 0.3, 1000);
    expect(f.get(1000)).toEqual({ deg: 200, source: "compass", courseDeg: 75 });
  });
  it("stillastående: kompassen tar över efter några sekunder och följer när man vänder sig", () => {
    const f = new HeadingFusion();
    f.pushGps(75, 1.6, 1000);
    f.pushGps(75, 0.1, 6000);
    f.pushCompass(300, 6000);
    expect(f.get(6000)).toMatchObject({ source: "compass" });
    expect(Math.abs(wrap180(f.get(6000).deg! - 300))).toBeLessThan(1);
    // Vänder sig åt öster: utjämnat men snabbt (under en halv sekund).
    for (let t = 6100; t <= 6500; t += 50) f.pushCompass(90, t);
    expect(Math.abs(wrap180(f.get(6500).deg! - 90))).toBeLessThan(25);
  });
  it("kompassen darrar inte: små ändringar under dödbandet ändrar inte riktningen", () => {
    const f = new HeadingFusion();
    f.pushCompass(100, 0);
    const a = f.get(0).deg!;
    f.pushCompass(100.8, 40);
    expect(f.get(40).deg).toBe(a);
  });
  it("utan kompass behålls senast gångna riktning ('held') en stund, därefter är den okänd", () => {
    const f = new HeadingFusion();
    f.pushGps(75, 1.6, 0);
    f.pushGps(75, 0, 5000);
    expect(f.get(5000)).toEqual({ deg: 75, source: "held", courseDeg: 75 });
    expect(f.get(HELD_MAX_AGE_MS + 1000)).toEqual({ deg: null, source: "none", courseDeg: null });
  });
  it("kompassbortfall: gammal mätning används inte (ingen frusen pil)", () => {
    const f = new HeadingFusion();
    f.pushCompass(10, 0);
    expect(f.get(COMPASS_MAX_AGE_MS + 500).source).toBe("none");
  });
  it("ingen data alls: okänd riktning, aldrig 0° som gissning", () => {
    expect(new HeadingFusion().get(0)).toEqual({ deg: null, source: "none", courseDeg: null });
  });
  it("kompassvyn av: växling mellan stilla och rörelse ger ingen mellanliggande felvinkel", () => {
    const f = new HeadingFusion();
    f.compassView = false;
    f.pushCompass(40, 0);
    f.pushGps(100, 0.2, 0);
    expect(f.get(0).source).toBe("compass");
    f.pushGps(100, 1.5, 1000);
    f.pushCompass(40, 1000);
    expect(f.get(1000)).toEqual({ deg: 100, source: "gps", courseDeg: 100 });
    f.pushGps(100, 0.2, 5000); f.pushCompass(100, 5000);
    expect(f.get(5200).source).toBe("compass");
  });
});

describe("HeadingFusion: kompassen vrider kartan även i rörelse (till fots och cykel)", () => {
  /** Rörelse i `gps` grader med kompassen på `compass` i `secs` sekunder: kompass 30 Hz, GPS 1 Hz. */
  function ride(f: HeadingFusion, t0: number, secs: number, gps: number, compass: number | ((t: number) => number)) {
    for (let t = t0; t <= t0 + secs * 1000; t += 33) {
      f.pushCompass(typeof compass === "number" ? compass : compass(t), t);
      if ((t - t0) % 990 === 0) f.pushGps(gps, 4, t);
    }
    return t0 + secs * 1000;
  }
  it("ett huvudvridning följs direkt: kartan vrids lika mycket som telefonen inom ett par tiondels sekunder, pilen visar fortfarande färdriktningen", () => {
    const f = new HeadingFusion();
    let t = ride(f, 0, 5, 90, 90);
    expect(Math.abs(wrap180(f.get(t).deg! - 90))).toBeLessThan(2);
    // Vrider 60° åt höger på 0,3 s (200°/s).
    for (let i = 1; i <= 9; i++) { t += 33; f.pushCompass(90 + (60 * i) / 9, t); }
    for (let i = 0; i < 6; i++) { t += 33; f.pushCompass(150, t); }
    expect(Math.abs(wrap180(f.get(t).deg! - 150))).toBeLessThan(8);
    expect(f.get(t).courseDeg).toBe(90);
  });
  it("ett konstant kompassfel (missvisning, hållare) lärs bort från GPS i rörelse", () => {
    const f = new HeadingFusion();
    const t = ride(f, 0, 4 * BIAS_TAU_S, 90, 72); // kompassen visar 18° fel
    expect(Math.abs(wrap180(f.get(t).deg! - 90))).toBeLessThan(2);
    expect(f.compassBiasDeg).toBeCloseTo(18, 0);
  });
  it("en kort blick åt sidan lärs inte in (korrektionen ändras inte)", () => {
    const f = new HeadingFusion();
    let t = ride(f, 0, 5, 90, 90);
    t = ride(f, t + 33, 4, 90, 160); // tittar 70° åt sidan i 4 s
    expect(Math.abs(f.compassBiasDeg)).toBeLessThan(0.5);
    expect(Math.abs(wrap180(f.get(t).deg! - 160))).toBeLessThan(3);
  });
  it("ett stort men stadigt fel (magnet i hållaren) tas in efter en stund i rörelse", () => {
    const f = new HeadingFusion();
    const t = ride(f, 0, BIAS_SNAP_S + 3, 90, 250);
    expect(Math.abs(wrap180(f.get(t).deg! - 90))).toBeLessThan(3);
  });
  it("kompassbrus i vila jämnas ut (ingen darrning), men ingen fördröjning vid vridning", () => {
    const f = new HeadingFusion();
    let seed = 1;
    const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 6; }; // ±3°
    let max = 0;
    for (let t = 0; t < 5000; t += 16) { f.pushCompass(40 + noise(), t); if (t > 2000) max = Math.max(max, Math.abs(wrap180(f.get(t).deg! - 40))); }
    expect(max).toBeLessThan(1.5);
  });
});
