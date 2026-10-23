import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import type { GeoLike } from "@/gps/provider/provider";
import type { CompassSample, CompassSource } from "@/play/compass";
import { openDb } from "@/play/idb";
import { PlaySession } from "@/play/session";
import { destinationPoint } from "./helpers";
import type { LatLon } from "@/geo/geometry";

const START: LatLon = { lat: 59.40731, lon: 13.46753 };
const noFetch: Fetcher = async () => ({ ok: false, status: 404, json: async () => ({}) });

function fakeCompass(result: "granted" | "denied" | "unsupported") {
  let push: ((s: CompassSample) => void) | null = null;
  const src: CompassSource = { start: async (cb) => { if (result === "granted") push = cb; return result; }, stop: () => { push = null; } };
  return { src, sample: (deg: number | null) => push?.({ headingDeg: deg, accuracyDeg: null, tMs: 0 }) };
}

async function make(compass?: CompassSource) {
  let ok: Parameters<GeoLike["watchPosition"]>[0] | null = null;
  const geo: GeoLike = { watchPosition: (a) => { ok = a; return 1; }, clearWatch: () => undefined };
  let clock = 1_000_000;
  const session = new PlaySession({ geo, db: await openDb(new IDBFactory()), store: new TileStore("/x", noFetch), now: () => clock, setInterval: () => 1, clearInterval: () => undefined, compass });
  const fix = (p: LatLon, extra: { speed?: number | null; heading?: number | null } = {}) => ok?.({ coords: { latitude: p.lat, longitude: p.lon, accuracy: 6, speed: extra.speed ?? null, heading: extra.heading ?? null }, timestamp: clock });
  return { session, fix, advance: (ms: number) => { clock += ms; } };
}

describe("riktning i sessionen: GPS i rörelse, kompass stilla, okänd när den inte går att fastställa", () => {
  it("stilla utan kompass: riktningen är okänd (ingen gissad pil)", async () => {
    const { session, fix, advance } = await make();
    session.startLocating();
    for (let i = 0; i < 10; i++) { fix(START); advance(1000); }
    expect(session.getView().heading).toBeNull();
    expect(session.getView().headingSource).toBe("none");
    expect(session.liveHeading()).toEqual({ deg: null, source: "none" });
  });

  it("kompass tillåten: pilen följer kompassen när man står still", async () => {
    const c = fakeCompass("granted");
    const { session, fix, advance } = await make(c.src);
    session.startLocating();
    fix(START);
    expect(await session.enableCompass()).toBe("on");
    expect(session.getView().compass).toBe("on");
    for (let i = 0; i < 10; i++) { c.sample(200); advance(100); }
    expect(session.liveHeading().source).toBe("compass");
    expect(session.liveHeading().deg).toBeCloseTo(200, 0);
    // Vänder sig mot norr: följer utan att GPS behövs.
    for (let i = 0; i < 30; i++) { c.sample(5); advance(50); }
    expect(Math.abs(session.liveHeading().deg! - 5)).toBeLessThan(3);
  });

  it("i rörelse gäller GPS-kursen även om kompassen visar något annat", async () => {
    const c = fakeCompass("granted");
    const { session, fix, advance } = await make(c.src);
    session.startLocating();
    await session.enableCompass();
    let p = START;
    for (let i = 0; i < 25; i++) {
      p = destinationPoint(p, 1.6, 90);
      fix(p, { speed: 1.6, heading: 90 });
      c.sample(250);
      advance(1000);
    }
    expect(session.liveHeading().source).toBe("gps");
    expect(Math.abs(session.liveHeading().deg! - 90)).toBeLessThan(15);
  });

  it("nekad åtkomst till rörelsesensorer: status 'denied', GPS-riktning fungerar ändå; saknade sensorer: 'unsupported'", async () => {
    const denied = await make(fakeCompass("denied").src);
    expect(await denied.session.enableCompass()).toBe("denied");
    expect(denied.session.getView().compass).toBe("denied");
    const none = await make();
    expect(await none.session.enableCompass()).toBe("unsupported");
    expect(none.session.getView().headingSource).toBe("none");
  });
});
