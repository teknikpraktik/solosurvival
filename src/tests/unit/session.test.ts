import { readFileSync } from "node:fs";
import path from "node:path";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import type { GeoLike } from "@/gps/provider/provider";
import { defaultParams } from "@/play/config";
import { openDb } from "@/play/idb";
import { PlaySession } from "@/play/session";
import { MatchStorage } from "@/play/storage";
import { cumulativeLengths, haversineM, pointAlong, type LatLon } from "@/geo/geometry";

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => {
  const rel = url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "");
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, rel), "utf8")) };
};
const START: LatLon = { lat: 59.40731, lon: 13.46753 };

/** Falsk Geolocation: tester skickar fixar och fel. */
function fakeGeo() {
  let ok: Parameters<GeoLike["watchPosition"]>[0] | null = null;
  let err: Parameters<GeoLike["watchPosition"]>[1] | null = null;
  const geo: GeoLike = {
    watchPosition: (a, b) => { ok = a; err = b; return 1; },
    clearWatch: () => { ok = null; },
  };
  return {
    geo,
    fix: (p: LatLon, acc: number, ts: number) => ok?.({ coords: { latitude: p.lat, longitude: p.lon, accuracy: acc, speed: null, heading: null }, timestamp: ts }),
    error: (code: number) => err?.({ code, message: "x" }),
  };
}

async function make() {
  const g = fakeGeo();
  const db = await openDb(new IDBFactory());
  let clock = 20_000_000;
  const timers: (() => void)[] = [];
  const cues: string[] = [];
  const session = new PlaySession({
    geo: g.geo, db, store: new TileStore("/data/v1/varmland", fsFetch), now: () => clock,
    setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval: () => { timers.length = 0; },
    onCue: (c) => cues.push(c),
  });
  const advance = (ms: number, step = 200) => { for (let i = 0; i < ms; i += step) { clock += step; timers.forEach((t) => t()); } };
  return { g, db, session, advance, now: () => clock, cues, set: (t: number) => (clock = t) };
}

describe("PlaySession: hela flödet med falsk GPS (simulerat, inte fältbevis)", () => {
  it("platsnekad ger tydligt fel", async () => {
    const { g, session } = await make();
    session.startLocating();
    g.error(1);
    expect(session.getView().gpsError?.code).toBe("denied");
  });

  it("väntar på tillräcklig noggrannhet innan förslag", async () => {
    const { g, session, now } = await make();
    session.startLocating();
    g.fix(START, 60, now());
    expect(session.currentStart()).toBeNull();
    expect(await session.prepare({ ...defaultParams("walk"), mode: "mission" })).toBeNull();
    g.fix(START, 8, now());
    expect(session.currentStart()).not.toBeNull();
  });

  it("locating → preview → match → pausa vid bakgrund → fortsätt → avbryt, med lagring och logg", async () => {
    const { g, db, session, advance, now } = await make();
    session.startLocating();
    for (let i = 0; i < 3; i++) { g.fix(START, 6, now()); advance(1000); }
    const prep = await session.prepare({ ...defaultParams("walk"), mode: "mission", seed: 3 });
    expect(prep!.status).toBe("ok");
    expect(session.getView().stage).toBe("preview");
    expect(await session.startMatch()).toBe(true);
    expect(session.getView().stage).toBe("playing");
    expect(session.getView().match!.paused).toBe(true); // startar pausat
    g.fix(START, 6, now());
    expect(session.resume()).toBe(true);
    for (let i = 0; i < 30; i++) { g.fix(START, 6, now()); advance(1000); }
    expect(session.getView().match!.elapsedS).toBeGreaterThan(20);
    // Appen går till bakgrunden.
    session.onVisibility(true);
    expect(session.getView().match!.paused).toBe(true);
    const e = session.getView().match!.elapsedS;
    advance(10_000);
    expect(session.getView().match!.elapsedS).toBe(e);
    session.onVisibility(false);
    g.fix(START, 6, now());
    expect(session.resume()).toBe(true);
    // Historik/aktiv match finns i IndexedDB.
    const st = new MatchStorage(db);
    await new Promise((r) => setTimeout(r, 50));
    expect((await st.listHistory())[0].result).toBe("active");
    await session.abort();
    await new Promise((r) => setTimeout(r, 50));
    const h = (await st.listHistory())[0];
    expect(h.result).toBe("aborted");
    expect(session.getView().stage).toBe("finished");
    const log = await db.store<{ summary: { result: string; gps: { fixes: number } } }>("logs").get(h.id);
    expect(log!.summary.result).toBe("aborted");
    expect(log!.summary.gps.fixes).toBeGreaterThan(20);
  });

  it("avbrutet uppdrag kan återställas i en ny session (pausat) och kräver ny fix", async () => {
    const a = await make();
    a.session.startLocating();
    for (let i = 0; i < 3; i++) { a.g.fix(START, 6, a.now()); a.advance(1000); }
    await a.session.prepare({ ...defaultParams("walk"), mode: "escape", seed: 4 });
    await a.session.startMatch();
    a.g.fix(START, 6, a.now());
    a.session.resume();
    for (let i = 0; i < 10; i++) { a.g.fix(START, 6, a.now()); a.advance(1000); }
    await new Promise((r) => setTimeout(r, 50));
    // Ny session mot samma databas (simulerar omladdning).
    const g2 = fakeGeo();
    const s2 = new PlaySession({ geo: g2.geo, db: a.db, store: new TileStore("/data/v1/varmland", fsFetch), now: a.now, setInterval: () => 1, clearInterval: () => undefined });
    expect(await s2.hasActive()).toBe(true);
    const r = await s2.restoreActive();
    expect(r).toEqual({ ok: true });
    const v = s2.getView().match!;
    expect(v.paused).toBe(true);
    expect(v.elapsedS).toBeGreaterThan(5);
    expect(s2.resume()).toBe(false); // ingen färsk fix än
    g2.fix(START, 6, a.now());
    expect(s2.resume()).toBe(true);
  });

  it("start flyttad >60 m från förhandsvisningen kräver uppdaterat förslag", async () => {
    const { g, session, advance, now } = await make();
    session.startLocating();
    for (let i = 0; i < 3; i++) { g.fix(START, 6, now()); advance(1000); }
    await session.prepare({ ...defaultParams("walk"), mode: "mission", seed: 3 });
    const far = { lat: START.lat + 0.0012, lon: START.lon };
    for (let i = 0; i < 12; i++) { g.fix(far, 6, now()); advance(1000); }
    expect(session.getView().movedFromPreview).toBe(true);
    expect(await session.startMatch()).toBe(false);
  });
});

describe("A TO B i sessionen", () => {
  it("A är alltid min position (en angiven pointA ignoreras); man väljer bara B", async () => {
    const { g, session, advance, now } = await make();
    session.startLocating();
    for (let i = 0; i < 3; i++) { g.fix(START, 6, now()); advance(1000); }
    const A2 = { lat: 59.40731, lon: 13.46753 };
    const probe = await session.prepare({ ...defaultParams("walk"), mode: "survival", seed: 1 });
    const nodes = [...probe!.graph!.nodes.values()];
    const a = nodes.find((n) => Math.abs(n.lat - A2.lat) > 0.004 && Math.abs(n.lat - A2.lat) < 0.007) ?? nodes[0]; // ~500 m från min position
    const b = nodes.find((n) => n !== a && Math.hypot(n.lat - a.lat, n.lon - a.lon) > 0.008) ?? nodes[nodes.length - 1];
    session.backToConfig();
    const prep = await session.prepare({ ...defaultParams("walk"), mode: "escape", pointA: { lat: a.lat, lon: a.lon }, pointB: { lat: b.lat, lon: b.lon }, seed: 2 });
    expect(["ok", "no_route", "sparse", "off_network"]).toContain(prep!.status);
    const v = session.getView();
    expect(haversineM(v.params!.pointA!, START)).toBeLessThan(30); // A = där jag står, inte den angivna punkten
    if (prep!.status === "ok") expect(v.distToPreviewStartM!).toBeLessThan(30);
  });
});
