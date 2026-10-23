import { readFileSync } from "node:fs";
import path from "node:path";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { STEP_S } from "@/config/game-rules";
import { TileStore, type Fetcher } from "@/data/store";
import { zombieLatLon } from "@/engine/core/movement";
import { haversineM, type LatLon } from "@/geo/geometry";
import type { GeoLike } from "@/gps/provider/provider";
import { defaultParams } from "@/play/config";
import { openDb } from "@/play/idb";
import { BACKGROUND_GRACE_MS } from "@/play/live-game";
import { PlaySession } from "@/play/session";
import { MatchStorage } from "@/play/storage";

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const START: LatLon = { lat: 59.40731, lon: 13.46753 };

async function make() {
  let ok: Parameters<GeoLike["watchPosition"]>[0] | null = null;
  let watches = 0;
  const geo: GeoLike = { watchPosition: (a) => { ok = a; watches++; return watches; }, clearWatch: () => undefined };
  const db = await openDb(new IDBFactory());
  let clock = 50_000_000;
  const timers: (() => void)[] = [];
  const session = new PlaySession({ geo, db, store: new TileStore("/data/v1/varmland", fsFetch), now: () => clock, setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval: () => { timers.length = 0; } });
  const fix = () => ok?.({ coords: { latitude: START.lat, longitude: START.lon, accuracy: 6, speed: null, heading: null }, timestamp: clock });
  const advance = (ms: number, step = 200) => { for (let i = 0; i < ms; i += step) { clock += step; timers.forEach((t) => t()); } };
  const jump = (ms: number) => { clock += ms; };
  const tickFixes = (secs: number) => { for (let i = 0; i < secs; i++) { fix(); advance(1000); } };
  // Startar en Survival-match på riktiga Värmlandsdata och kör igång den.
  async function begin() {
    session.startLocating();
    for (let i = 0; i < 3; i++) { fix(); advance(1000); }
    await session.prepare({ ...defaultParams("walk"), mode: "survival", seed: 3 });
    expect(await session.startMatch()).toBe(true);
    fix();
    expect(session.resume()).toBe(true);
    tickFixes(20);
  }
  return { session, db, begin, fix, advance, jump, tickFixes, watches: () => watches, now: () => clock };
}

describe("bakgrundsläge: appbyte pausar inte spelet, men tiden går och ingen smittas", () => {
  it("kort frånvaro (10 s): ingen paus, speltiden går ikapp och zombierna har flyttat sig", async () => {
    const t = await make();
    await t.begin();
    const live = t.session.live!;
    const before = t.session.getView().match!.elapsedS;
    const zBefore = live.state.zombies.map((z) => zombieLatLon(live.g, z));
    t.session.onVisibility(true);
    t.advance(10_000, 10_000); // inga tick medan appen är dold
    expect(t.session.getView().match!.elapsedS).toBe(before); // inget simuleras i bakgrunden
    t.session.onVisibility(false);
    const m = t.session.getView().match!;
    expect(m.paused).toBe(false);
    expect(m.elapsedS - before).toBeGreaterThan(9.5);
    expect(m.elapsedS - before).toBeLessThan(10.5);
    const zAfter = live.state.zombies.map((z) => zombieLatLon(live.g, z));
    expect(zAfter.some((p, i) => haversineM(p, zBefore[i]) > 1)).toBe(true);
    // Spelet fortsätter normalt efteråt.
    t.tickFixes(5);
    expect(t.session.getView().match!.elapsedS - before).toBeGreaterThan(14);
  });

  it("frånvaro över gränsen pausar, räknar ingen tid och går att fortsätta från med färsk position", async () => {
    const t = await make();
    await t.begin();
    const before = t.session.getView().match!.elapsedS;
    t.session.onVisibility(true);
    t.jump(BACKGROUND_GRACE_MS + 15_000);
    t.session.onVisibility(false);
    const v = t.session.getView();
    expect(v.match!.paused).toBe(true);
    expect(v.match!.elapsedS).toBe(before);
    expect(v.messages.join(" ")).toMatch(/away for/);
    t.fix();
    expect(t.session.resume()).toBe(true);
    expect(t.session.getView().match!.paused).toBe(false);
  });

  it("ingen kan smittas av att vara borta: zombie ovanpå spelaren när appen kommer tillbaka ger ingen infektion", async () => {
    const t = await make();
    await t.begin();
    const live = t.session.live!;
    const z = live.state.zombies[0];
    const here = live.filter.position!;
    // Lägg en zombie exakt vid spelaren på nätet.
    const snap = (await import("@/geo/graph/graph")).snapToGraph(live.g, here)!;
    z.edgeId = snap.edgeId; z.distanceAlongEdgeM = snap.distM; z.route = []; z.stopAtM = undefined; z.state = "chase";
    t.session.onVisibility(true);
    t.jump(30_000);
    t.session.onVisibility(false);
    expect(live.state.result).toBeUndefined();
    expect(live.state.infectionProgressSeconds).toBe(0);
    // Först när färska fixar finns och den neutrala perioden (5 s) gått kan smitta ske.
    t.fix(); t.advance(1000);
    expect(live.state.result).toBeUndefined();
  });

  it("en pausad match förblir pausad och oförändrad vid appbyte", async () => {
    const t = await make();
    await t.begin();
    t.session.pause("manual");
    const before = t.session.getView().match!.elapsedS;
    t.session.onVisibility(true);
    t.jump(20_000);
    t.session.onVisibility(false);
    expect(t.session.getView().match!.paused).toBe(true);
    expect(t.session.getView().match!.elapsedS).toBe(before);
  });

  it("GPS-bevakningen startas om vid återkomst (iOS kan tappa den i bakgrunden)", async () => {
    const t = await make();
    await t.begin();
    const n = t.watches();
    t.session.onVisibility(true);
    t.session.onVisibility(false);
    expect(t.watches()).toBe(n + 1);
  });

  it("dubbel dold-händelse eller återkomst utan att ha gått bort ändrar ingenting", async () => {
    const t = await make();
    await t.begin();
    const before = t.session.getView().match!.elapsedS;
    t.session.onVisibility(false);
    t.session.onVisibility(true);
    t.session.onVisibility(true);
    t.session.onVisibility(false);
    expect(t.session.getView().match!.paused).toBe(false);
    expect(t.session.getView().match!.elapsedS - before).toBeLessThan(0.5);
  });
});

describe("omstart och lagring: inga kapplöpningar", () => {
  it("avbryt direkt efter att sidan göms: ingen föräldralös post och ingen 'aktiv match' kvar", async () => {
    const t = await make();
    await t.begin();
    t.session.onVisibility(true); // köar en sparning
    await t.session.abort(); // och avslutar direkt
    await new Promise((r) => setTimeout(r, 100));
    const st = new MatchStorage(t.db);
    expect(await t.session.hasActive()).toBe(false);
    expect(await t.db.store("matches").all()).toEqual([]);
    expect((await st.listHistory())[0].result).toBe("aborted");
  });

  it("avslutad men inte städad match återställs inte som 'skadad' utan slutförs i historiken", async () => {
    const t = await make();
    await t.begin();
    await new Promise((r) => setTimeout(r, 50));
    const live = t.session.live!;
    // Simulera att appen stängdes mitt i avslutet: tillståndet är avslutat men posterna finns kvar.
    live.state.phase = "finished"; live.state.result = "survived";
    const st = new MatchStorage(t.db);
    await st.save(live, t.session.params!, null, START, "v");
    const s2 = new PlaySession({ geo: undefined, db: t.db, store: new TileStore("/data/v1/varmland", fsFetch), now: t.now });
    expect(await s2.restoreActive()).toBeNull();
    expect(await s2.hasActive()).toBe(false);
    expect((await st.listHistory())[0].result).toBe("survived");
  });

  it("efter avslut och 'hem' begärs en ny GPS-fix direkt (en stillastående telefon skickar inga av sig själv)", async () => {
    const t = await make();
    await t.begin();
    await t.session.abort();
    await new Promise((r) => setTimeout(r, 100));
    const n = t.watches();
    t.session.reset();
    expect(t.watches()).toBe(n + 1);
    expect(t.session.getView().stage).toBe("locating");
    t.fix();
    expect(t.session.currentStart()).not.toBeNull();
    // Och en ny match kan startas direkt.
    await t.session.prepare({ ...defaultParams("walk"), mode: "survival", seed: 4 });
    expect(await t.session.startMatch()).toBe(true);
  });
});

describe("speltid mot verklig tid", () => {
  it("speltiden följer väggklockan i fasta steg och tar aldrig igen en frusen app utan beslut", async () => {
    const t = await make();
    await t.begin();
    const before = t.session.getView().match!.elapsedS;
    // Fruset tick utan synlighetshändelse (t.ex. webbvy): pausa i stället för att simulera okänd tid.
    t.jump(8_000);
    t.advance(200);
    expect(t.session.getView().match!.paused).toBe(true);
    expect(t.session.getView().match!.elapsedS).toBe(before);
    expect(STEP_S).toBe(0.2);
  });
});
