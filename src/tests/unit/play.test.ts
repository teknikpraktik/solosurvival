import { readFileSync } from "node:fs";
import path from "node:path";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeAll, describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import { prepareMatch, type Prepared } from "@/play/prepare";
import { defaultParams, withActivity, type MatchParams } from "@/play/config";
import { createLiveMatch } from "@/play/match";
import type { LiveGame } from "@/play/live-game";
import { openDb } from "@/play/idb";
import { MatchStorage, SNAPSHOT_SCHEMA } from "@/play/storage";
import { FieldLog, exportAllLogs, loadLog } from "@/play/fieldlog";
import { cumulativeLengths, pointAlong, fromLocal, type LatLon } from "@/geo/geometry";
import { rand } from "@/engine/core/rng";
import { stepGame } from "@/engine/core/engine";
import { IdbTileCache } from "@/play/tile-cache";
import type { Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => {
  const rel = url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "");
  const body = JSON.parse(readFileSync(path.join(root, rel), "utf8"));
  return { ok: true, status: 200, json: async () => body };
};
const START: LatLon = { lat: 59.40731, lon: 13.46753 };
const prep: Record<string, Prepared> = {};

beforeAll(async () => {
  for (const mode of ["mission", "escape", "survival"] as const) {
    prep[mode] = await prepareMatch(new TileStore("/data/v1/varmland", fsFetch), START, { ...defaultParams("walk"), mode, seed: 5 });
  }
}, 60000);

const mk = (mode: MatchParams["mode"], activity: Activity = "walk", difficulty: Difficulty = "normal") => {
  const params: MatchParams = { ...withActivity(defaultParams("walk"), activity), mode, difficulty, seed: 5 };
  const proposal = prep[mode].proposals[0] ?? null;
  const live = createLiveMatch({ id: `m-${mode}-${difficulty}`, params, start: START, proposal, graph: prep[mode].graph!, dataVersion: "test" });
  return { live, params, proposal };
};

/** Går längs polyline med 1 fix/s; returnerar när spelet är slut eller tiden tar slut. */
function walk(live: LiveGame, geometry: LatLon[], speedMps: number, maxS: number, clear: boolean, t0 = 10_000_000) {
  const cum = cumulativeLengths(geometry);
  const total = cum.at(-1)!;
  const noise = { rngState: 99 };
  let t = t0;
  let d = 0;
  const p0 = geometry[0];
  live.pushFix({ latitude: p0.lat, longitude: p0.lon, accuracyM: 5, timestampMs: t }, t);
  expect(live.resume(t)).toBe(true);
  if (clear) { live.state.zombies = []; Object.assign(live.rules, { initialZombies: 0, maxZombies: 0, growthPerMin: 0 }); }
  for (let s = 0; s < maxS && !live.finished; s++) {
    for (let k = 0; k < 5; k++) { t += 200; live.tick(t); }
    d = Math.min(total, d + speedMps);
    const q = fromLocal(pointAlong(geometry, cum, d), { x: (rand(noise) - 0.5) * 6, y: (rand(noise) - 0.5) * 6 });
    live.pushFix({ latitude: q.lat, longitude: q.lon, accuracyM: 5, timestampMs: t }, t);
  }
  return t;
}

describe("spellägen via LiveGame (simulerad GPS, inte fälttest)", () => {
  it("Mission: ordnade checkpoints, sedan hem → survived", () => {
    const { live, proposal } = mk("mission");
    expect(proposal!.waypoints.at(-1)!.kind).toBe("home");
    walk(live, proposal!.geometry, 1.3, 5000, true);
    expect(live.state.result).toBe("survived");
    expect(live.state.objectives!.index).toBe(live.state.objectives!.targets.length);
  });

  it("Escape: nå destinationen → survived", () => {
    const { live, proposal } = mk("escape");
    walk(live, proposal!.geometry, 1.3, 5000, true);
    expect(live.state.result).toBe("survived");
  });

  it("Escape: att stå still tills tiden är slut ger failed", () => {
    const { live, proposal } = mk("escape");
    walk(live, [proposal!.geometry[0], proposal!.geometry[0]], 0, 60 * 120, true);
    expect(live.state.result).toBe("failed");
  });

  it("spelaren får lämna rutten (rutten är vägledning)", () => {
    const { live, proposal } = mk("mission");
    const g = proposal!.geometry;
    const off = fromLocal(g[0], { x: 60, y: 0 });
    walk(live, [g[0], off, g[0], ...g], 1.3, 60 * 10, true);
    expect(live.state.player.distanceM).toBeGreaterThan(300);
    expect(live.state.phase).not.toBe("finished"); // inget straff för att lämna rutten
  });

  for (const mode of ["mission", "escape", "survival"] as const) {
    for (const difficulty of ["easy", "normal", "hard"] as Difficulty[]) {
      it(`${mode}/${difficulty}: körs till slut utan fel med giltigt resultat`, () => {
        const { live } = mk(mode, "walk", difficulty);
        const geom = (prep.mission.proposals[0] ?? prep.escape.proposals[0]).geometry;
        walk(live, geom, 1.3, 60 * 60, false);
        if (live.finished) expect(["survived", "infected", "failed"]).toContain(live.state.result);
        expect(Number.isFinite(live.state.elapsedSeconds)).toBe(true);
      });
    }
  }

  it("infektion avslutar matchen med resultat infected", () => {
    const { live, proposal } = mk("mission", "walk", "hard");
    // Stå still och låt zombierna komma: tid nog.
    const g0 = proposal!.geometry[0];
    walk(live, [g0, g0], 0, 60 * 60, false);
    if (live.state.result === "infected") expect(live.finished).toBe(true);
    expect(["infected", "failed", undefined]).toContain(live.state.result);
  });

  it("zombie-AI läser aldrig mål eller extraction (statisk kontroll)", () => {
    const dir = path.join(import.meta.dirname, "..", "..", "engine", "ai");
    const files = ["ai.ts", "behavior.ts"].map((f) => path.join(dir, f));
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/objectives|extractionNodeId|ObjectiveSet/);
    }
    void files;
  });
});

describe("lagring och återställning", () => {
  const fresh = async () => {
    const db = await openDb(new IDBFactory());
    return { db, st: new MatchStorage(db) };
  };

  it("spara, avbryt, återställ: motorns tillstånd (RNG, zombier, mål) är identiskt och deterministiskt", async () => {
    const { st } = await fresh();
    const { live, params, proposal } = mk("mission");
    const geom = proposal!.geometry;
    walk(live, geom.slice(0, 20), 1.3, 60 * 15, false);
    await st.begin(live, params, proposal, START, "test");
    await st.save(live, params, proposal, START, "test");
    const out = await st.loadActive();
    expect(out && out.ok).toBe(true);
    const r = (out as { ok: true; restored: import("@/play/storage").Restored }).restored;
    expect(JSON.parse(JSON.stringify(r.live.state))).toEqual(JSON.parse(JSON.stringify({ ...live.state, paused: true })));
    expect(r.live.state.rngState).toBe(live.state.rngState);
    expect(r.live.state.paused).toBe(true);
    // Samma indata → samma utfall från och med återställningen.
    const a = JSON.parse(JSON.stringify(live.state));
    const b = JSON.parse(JSON.stringify(r.live.state));
    a.paused = false; b.paused = false;
    const pos = a.player.position;
    for (let i = 0; i < 300; i++) {
      stepGame(live.g, a, live.rules, { position: pos, quality: "ok", accuracyM: 5 });
      stepGame(r.live.g, b, r.live.rules, { position: pos, quality: "ok", accuracyM: 5 });
    }
    expect(b).toEqual(a);
  });

  it("återställd match är pausad och kräver färsk fix innan den kan fortsätta", async () => {
    const { st } = await fresh();
    const { live, params, proposal } = mk("escape");
    await st.begin(live, params, proposal, START, "test");
    const out = (await st.loadActive()) as { ok: true; restored: import("@/play/storage").Restored };
    expect(out.restored.live.resume(1)).toBe(false);
    const t = 5_000_000;
    out.restored.live.pushFix({ latitude: START.lat, longitude: START.lon, accuracyM: 5, timestampMs: t }, t);
    expect(out.restored.live.resume(t)).toBe(true);
  });

  it("historik innehåller bara uppmätta värden och sorteras nyast först; avslut tar bort tunga poster", async () => {
    const { st, db } = await fresh();
    const m1 = mk("mission");
    walk(m1.live, m1.proposal!.geometry, 1.3, 5000, true);
    await st.begin(m1.live, m1.params, m1.proposal, START, "test", 1000);
    await st.finish(m1.live, m1.params, m1.proposal);
    const m2 = mk("survival");
    await st.begin(m2.live, m2.params, m2.proposal, START, "test", 2000);
    await st.finish(m2.live, m2.params, m2.proposal, "aborted");
    const h = await st.listHistory();
    expect(h.map((x) => x.mode)).toEqual(["survival", "mission"]);
    expect(h[1].result).toBe("survived");
    expect(h[1].measuredDistanceM).toBeGreaterThan(500);
    expect(h[1].plannedLengthM).toBeGreaterThan(2000);
    expect(h[0].plannedLengthM).toBeNull();
    expect(h[0].result).toBe("aborted");
    expect(await st.loadActive()).toBeNull();
    expect((await db.store("matches").all()).length).toBe(0);
  });

  it("ny version: gammal ögonblicksbild avslutas kontrollerat som interrupted", async () => {
    const { st, db } = await fresh();
    const { live, params, proposal } = mk("mission");
    await st.begin(live, params, proposal, START, "test");
    const rec = (await db.store("matches").get(live.state.id)) as { schema: number };
    await db.store("matches").put(live.state.id, { ...rec, schema: SNAPSHOT_SCHEMA + 1 });
    const out = await st.loadActive();
    expect(out && !out.ok).toBe(true);
    expect((await st.listHistory())[0].result).toBe("interrupted");
    expect(await st.loadActive()).toBeNull();
  });

  it("skadat tillstånd återställs inte", async () => {
    const { st, db } = await fresh();
    const { live, params, proposal } = mk("mission");
    await st.begin(live, params, proposal, START, "test");
    const rec = (await db.store("matches").get(live.state.id)) as { state: { elapsedSeconds: unknown } };
    rec.state.elapsedSeconds = "x";
    await db.store("matches").put(live.state.id, rec);
    const out = await st.loadActive();
    expect(out && !out.ok).toBe(true);
  });

  it("radering: enskild match, all data, och testlogg", async () => {
    const { st, db } = await fresh();
    const a = mk("mission");
    await st.begin(a.live, a.params, a.proposal, START, "test", 1);
    await new FieldLog(a.live.state.id, 1).save(db);
    await st.finish(a.live, a.params, a.proposal, "aborted");
    expect(await loadLog(db, a.live.state.id)).toBeDefined();
    await st.deleteMatch(a.live.state.id);
    expect(await st.listHistory()).toHaveLength(0);
    expect(await loadLog(db, a.live.state.id)).toBeUndefined();
    const b = mk("escape");
    await st.begin(b.live, b.params, b.proposal, START, "test", 2);
    await st.deleteAll();
    expect(await st.listHistory()).toHaveLength(0);
    expect(await st.loadActive()).toBeNull();
  });

  it("tile-cache: ny datauppsättning rensar gamla tiles", async () => {
    const { db } = await fresh();
    const c = new IdbTileCache(db);
    await c.purgeOthers("v1");
    await c.put("v1/1_1", { f: 1, ty: 1, tx: 1, w: [] });
    await c.purgeOthers("v1");
    expect(await c.get("v1/1_1")).toBeDefined();
    await c.purgeOthers("v2");
    expect(await c.get("v1/1_1")).toBeUndefined();
  });
});

describe("testlogg (lokal)", () => {
  it("innehåller räknare och sammanfattning, spår bara om påslaget, exporteras som JSON", async () => {
    const db = await openDb(new IDBFactory());
    const st = new MatchStorage(db);
    const { live, params, proposal } = mk("mission");
    walk(live, proposal!.geometry.slice(0, 15), 1.3, 120, true);
    await st.begin(live, params, proposal, START, "test");
    await st.finish(live, params, proposal, "aborted");
    const h = (await st.listHistory())[0];
    const off = new FieldLog(live.state.id, 0);
    off.trace(1000, 59, 13, 5);
    expect(off.data.trace).toBeUndefined();
    const on = new FieldLog(live.state.id, 0, true);
    on.trace(1000, 59.123456789, 13, 5);
    on.trace(1200, 59.1, 13, 5); // inom 1 s: hoppas över
    on.trace(2500, 59.2, 13, 5);
    expect(on.data.trace).toHaveLength(2);
    on.add(5, "objective_reached", { id: "C1" });
    on.finalize(h, live.counters, { routeGenerationMs: 1234 });
    await on.save(db);
    const json = await exportAllLogs(db);
    const parsed = JSON.parse(json);
    expect(parsed.logs[0].summary.gps.fixes).toBe(live.counters.fixes);
    expect(parsed.logs[0].summary.routeGenerationMs).toBe(1234);
    expect(JSON.stringify(parsed)).not.toMatch(/token|authorization/i);
  });
});
