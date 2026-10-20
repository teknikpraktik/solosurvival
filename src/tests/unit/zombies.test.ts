import { readFileSync } from "node:fs";
import path from "node:path";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeAll, describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import { prepareMatch, type Prepared } from "@/play/prepare";
import { defaultParams, proximityRadiusM, withActivity, dataRadiusM, type MatchParams } from "@/play/config";
import { createLiveMatch } from "@/play/match";
import type { LiveGame } from "@/play/live-game";
import { openDb } from "@/play/idb";
import { PlaySession, ZOMBIE_SOUND_COOLDOWN_MS } from "@/play/session";
import { cumulativeLengths, haversineM, pointAlong, type LatLon } from "@/geo/geometry";
import { zombieLatLon } from "@/engine/core/movement";
import { stepGame } from "@/engine/core/engine";
import { snapToGraph } from "@/geo/graph/graph";
import type { Difficulty } from "@/config/difficulty";
import type { Activity } from "@/config/activities";
import type { GeoLike } from "@/gps/provider/provider";

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const START: LatLon = { lat: 59.40731, lon: 13.46753 };
const prep: Record<string, Prepared> = {};
beforeAll(async () => {
  for (const [k, a, mode] of [["walk-mission", "walk", "mission"], ["mtb-survival", "mtb", "survival"], ["walk-survival", "walk", "survival"]] as const) {
    prep[k] = await prepareMatch(new TileStore("/data/v1/varmland", fsFetch), START, { ...withActivity(defaultParams("walk"), a), mode, seed: 5 });
  }
}, 60000);

const mk = (key: string, difficulty: Difficulty, activity: Activity = "walk", mode: MatchParams["mode"] = "mission") => {
  const params: MatchParams = { ...withActivity(defaultParams("walk"), activity), mode, difficulty, seed: 5 };
  const proposal = prep[key].proposals[0] ?? null;
  return { params, live: createLiveMatch({ id: "z", params, start: START, proposal, graph: prep[key].graph!, dataVersion: "t" }) };
};
const fix = (live: LiveGame, p: LatLon, t: number) => live.pushFix({ latitude: p.lat, longitude: p.lon, accuracyM: 5, timestampMs: t }, t);

describe("Testfall A: zombier (riktiga Värmlandsdata, simulerad GPS)", () => {
  for (const difficulty of ["easy", "normal", "hard"] as Difficulty[]) {
    it(`${difficulty}: initial spawn 200–1000 m från spelaren, antal ökar successivt (smittpaus) och minskar aldrig`, () => {
      const { live } = mk("walk-mission", difficulty);
      expect(live.state.zombies.length).toBe(live.rules.initialZombies);
      expect(live.state.zombies.length).toBeGreaterThanOrEqual(3);
      const pos0 = live.state.player.position;
      for (const z of live.state.zombies) {
        const d = haversineM(zombieLatLon(live.g, z), pos0);
        expect(d).toBeGreaterThanOrEqual(live.rules.spawnMinDistanceM);
        expect(d).toBeLessThanOrEqual(live.rules.spawnMaxDistanceM); // nära nog för action direkt, aldrig ovanpå spelaren
      }
      // Kör motorn 20 min med smitta pausad (kvalitet infection_paused) så att tillväxten kan mätas utan att matchen tar slut.
      live.state.paused = false;
      let skipped = 0, prev = live.state.zombies.length;
      const counts = [prev];
      for (let i = 0; i < 5 * 60 * 20; i++) {
        for (const e of stepGame(live.g, live.state, live.rules, { position: pos0, quality: "infection_paused", accuracyM: 25 })) if (e.type === "spawn_skipped") skipped++;
        expect(live.state.zombies.length).toBeGreaterThanOrEqual(prev);
        prev = live.state.zombies.length;
        if (i % 3000 === 0) counts.push(prev);
      }
      counts.push(prev);
      expect(Math.max(...counts)).toBeGreaterThan(counts[0]);
      expect(skipped).toBeLessThan(10);
      for (const z of live.state.zombies) { const ll = zombieLatLon(live.g, z); expect(Number.isFinite(ll.lat + ll.lon)).toBe(true); }
    });
  }

  it("magnet-jakt: alla zombier jagar och konvergerar mot en stillastående spelare längs nätet (Normal)", () => {
    const { live } = mk("walk-mission", "normal");
    live.state.paused = false;
    const pos = live.state.player.position;
    const dist = () => live.state.zombies.map((z) => haversineM(zombieLatLon(live.g, z), pos));
    const d0 = dist();
    expect(d0.length).toBeGreaterThanOrEqual(6);
    let chasing = 0;
    for (let i = 0; i < 5 * 240; i++) { stepGame(live.g, live.state, live.rules, { position: pos, quality: "infection_paused", accuracyM: 25 }); }
    chasing = live.state.zombies.filter((z) => z.state === "chase" || z.state === "intercept").length;
    expect(chasing).toBeGreaterThanOrEqual(Math.floor(live.state.zombies.length * 0.9));
    const d1 = dist();
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(d1.slice(0, d0.length))).toBeLessThan(mean(d0) - 80); // går mot spelaren (≈ 1 m/s i 3 min efter försprånget)
    // Och med smitta på blir spelaren fångad.
    let t = 0;
    for (; t < 5 * 60 * 25 && live.state.result === undefined; t++) stepGame(live.g, live.state, live.rules, { position: pos, quality: "ok", accuracyM: 5 });
    expect(live.state.result).toBe("infected");
  });

  it("svårighet påverkar hotbilden: fler, snabbare och mer uppmärksamma zombier", () => {
    const r = (d: Difficulty) => mk("walk-mission", d).live.rules;
    expect(r("easy").initialZombies).toBeLessThan(r("normal").initialZombies);
    expect(r("normal").initialZombies).toBeLessThan(r("hard").initialZombies);
    expect(r("easy").zombieSpeedMps).toBeLessThan(r("hard").zombieSpeedMps);
    expect(r("easy").detectionRadiusM).toBeLessThan(r("hard").detectionRadiusM);
  });

  it("en zombie nära en stillastående spelare upptäcker, jagar och fångar (infektion)", () => {
    for (const difficulty of ["easy", "normal", "hard"] as Difficulty[]) {
      const { live } = mk("walk-mission", difficulty);
      let t = 4e7; fix(live, START, t); live.resume(t);
      live.state.phase = "survival";
      live.state.neutralUntilS = 0;
      // Placera en zombie ~50 m längs kanten från spelaren (inom upptäcktsradien för alla nivåer).
      const snap = snapToGraph(live.g, START)!;
      const edge = live.g.edges.get(snap.edgeId)!;
      const along = snap.distM + 50 <= edge.lengthM ? snap.distM + 50 : Math.max(0, snap.distM - 50);
      expect(Math.abs(along - snap.distM)).toBeGreaterThan(30);
      const z = live.state.zombies[0];
      z.edgeId = edge.id; z.distanceAlongEdgeM = along; z.route = []; z.state = "patrol";
      live.state.zombies = [z];
      for (let s = 0; s < 240 && !live.finished; s++) { for (let k = 0; k < 5; k++) { t += 200; live.tick(t); } fix(live, START, t); }
      expect(live.state.result, difficulty).toBe("infected");
    }
  });

  it("spelaren utanför det ursprungliga spelområdet: motorn fungerar och zombier finns kvar", () => {
    const { live } = mk("walk-mission", "normal");
    let t = 5e7; fix(live, START, t); live.resume(t);
    const far = { lat: START.lat + 0.05, lon: START.lon + 0.07 }; // ~6 km bort
    live.state.phase = "survival";
    const n0 = live.state.zombies.length;
    for (let s = 0; s < 120; s++) { for (let k = 0; k < 5; k++) { t += 200; live.tick(t); } fix(live, s < 5 ? START : far, t); }
    expect(live.state.zombies.length).toBeGreaterThanOrEqual(n0);
    for (const z of live.state.zombies) expect(Number.isFinite(zombieLatLon(live.g, z).lat)).toBe(true);
  });

  it("närhetsradie: 500 m i små och 1000 m i stora spelområden, från områdets storlek (inte zoom)", () => {
    const p = (a: Activity, mode: MatchParams["mode"], len: number): MatchParams => ({ ...withActivity(defaultParams("walk"), a), mode, targetLengthM: len, seed: 1 });
    expect(proximityRadiusM(p("walk", "mission", 3000))).toBe(500);
    expect(proximityRadiusM(p("walk", "escape", 3000))).toBe(500);
    expect(proximityRadiusM(p("run", "mission", 5000))).toBe(500);
    expect(proximityRadiusM(p("mtb", "mission", 10000))).toBe(1000);
    expect(proximityRadiusM(p("mtb", "escape", 10000))).toBe(1000);
    expect(proximityRadiusM(p("mtb", "survival", 10000))).toBe(1000);
    expect(dataRadiusM(p("walk", "survival", 3000))).toBeLessThan(3500);
  });
});

function fakeGeo() {
  let ok: Parameters<GeoLike["watchPosition"]>[0] | null = null;
  const geo: GeoLike = { watchPosition: (a) => { ok = a; return 1; }, clearWatch: () => { ok = null; } };
  return { geo, fix: (p: LatLon, acc: number, ts: number) => ok?.({ coords: { latitude: p.lat, longitude: p.lon, accuracy: acc, speed: null, heading: null }, timestamp: ts }) };
}

describe("Testfall D: närhetsljud", () => {
  async function setup() {
    const g = fakeGeo();
    const db = await openDb(new IDBFactory());
    let clock = 60_000_000;
    const timers: (() => void)[] = [];
    const cues: string[] = [];
    const session = new PlaySession({ geo: g.geo, db, store: new TileStore("/data/v1/varmland", fsFetch), now: () => clock, setInterval: (fn) => { timers.push(fn); return 1; }, clearInterval: () => undefined, onCue: (c) => cues.push(c) });
    const advance = (ms: number) => { for (let i = 0; i < ms; i += 200) { clock += 200; timers.forEach((f) => f()); if (i % 1000 === 0) g.fix(START, 5, clock); } };
    session.startLocating();
    for (let i = 0; i < 3; i++) { g.fix(START, 5, clock); clock += 1000; }
    await session.prepare({ ...withActivity(defaultParams("walk"), "walk"), mode: "survival", difficulty: "normal", seed: 9 });
    await session.startMatch();
    g.fix(START, 5, clock);
    session.resume();
    return { session, advance, cues, now: () => clock };
  }
  /** Flyttar en zombie så att den står ~`targetM` meter från spelaren (luftlinje) på en kant. */
  const place = (live: LiveGame, idx: number, targetM: number) => {
    const pos = live.filter.position!;
    let best: { e: string; d: number; diff: number } | null = null;
    for (const e of live.g.edges.values()) for (let d = 0; d <= e.lengthM; d += 5) {
      const diff = Math.abs(haversineM(pointAlong(e.geometry, e.cumM, d), pos) - targetM);
      if (!best || diff < best.diff) best = { e: e.id, d, diff };
    }
    const z = live.state.zombies[idx];
    z.edgeId = best!.e; z.distanceAlongEdgeM = best!.d; z.route = []; z.state = "patrol"; z.speedMps = 0;
  };

  it("ny zombie i närheten ger exakt ett ljud per match; därefter tyst", async () => {
    const { session, advance, cues } = await setup();
    const live = session.live!;
    live.state.phase = "head_start"; // zombierna står still; vi styr positionerna själva
    // Alla zombier långt bort först.
    for (let i = 0; i < live.state.zombies.length; i++) place(live, i, 4000);
    advance(3000);
    cues.length = 0;
    place(live, 0, 400); // kommer in i 500 m-radien
    advance(2500);
    expect(cues.filter((c) => c === "zombie")).toHaveLength(1);
    // Fler uppdateringar med samma zombie inne: inget nytt ljud.
    advance(20_000);
    expect(cues.filter((c) => c === "zombie")).toHaveLength(1);
    // Lämnar och återkommer: inget nytt ljud (en gång per zombie).
    place(live, 0, 4000); advance(3000); place(live, 0, 300); advance(3000);
    expect(cues.filter((c) => c === "zombie")).toHaveLength(1);
    // Zombie sound plays only once per match: later zombies, even after the cooldown, stay silent.
    if (live.state.zombies.length >= 3) {
      place(live, 1, 450); advance(ZOMBIE_SOUND_COOLDOWN_MS);
      place(live, 2, 350); advance(ZOMBIE_SOUND_COOLDOWN_MS * 2);
      expect(cues.filter((c) => c === "zombie")).toHaveLength(1);
    }
  }, 60000);

  it("zombier utanför radien (500 m) ger inget ljud", async () => {
    const { session, advance, cues } = await setup();
    const live = session.live!;
    live.state.phase = "head_start";
    for (let i = 0; i < live.state.zombies.length; i++) place(live, i, 900);
    cues.length = 0;
    advance(15_000);
    expect(cues.filter((c) => c === "zombie")).toHaveLength(0);
  }, 60000);

  it("vyn visar zombier inom radien på kartan och alltid närmaste avstånd", async () => {
    const { session, advance } = await setup();
    const live = session.live!;
    live.state.phase = "head_start";
    for (let i = 0; i < live.state.zombies.length; i++) place(live, i, 4000);
    place(live, 0, 300);
    advance(1500);
    const v = session.getView().match!;
    expect(v.proximityM).toBe(500);
    expect(v.zombiesNear.map((z) => z.id)).toEqual([live.state.zombies[0].id]);
    expect(v.nearestZombieM).toBeGreaterThan(200);
    expect(v.nearestZombieM).toBeLessThan(400);
    expect(v.zombieCount).toBe(live.state.zombies.length);
  }, 60000);

  it("zombie 600 m bort ritas (syns i vyn) men ger inget varningsljud i litet område", async () => {
    const { session, advance, cues } = await setup();
    const live = session.live!;
    live.state.phase = "head_start";
    for (let i = 0; i < live.state.zombies.length; i++) place(live, i, 4000);
    place(live, 0, 600);
    cues.length = 0;
    advance(3000);
    const v = session.getView().match!;
    expect(v.zombiesNear.map((z) => z.id)).toContain(live.state.zombies[0].id);
    expect(cues.filter((c) => c === "zombie")).toHaveLength(0);
    place(live, 0, 1300);
    advance(2000);
    expect(session.getView().match!.zombiesNear).toHaveLength(0);
  }, 60000);

  it("zombiehändelser loggas för att skilja spawn-, routing- och renderingsfel", async () => {
    const { session, advance } = await setup();
    advance(35_000);
    const log = session.fieldLog!;
    const start = log.data.entries.find((e) => e.k === "match_start")!;
    expect((start.d as { zombiesInitial: number }).zombiesInitial).toBeGreaterThan(0);
    expect(log.data.entries.some((e) => e.k === "zombie_sample")).toBe(true);
  }, 60000);
});

describe("svårighetsgrader: fart och antal", () => {
  it("fart per aktivitet och svårighetsgrad (km/h) och antal per nivå", async () => {
    const { resolveRules, SPRINT_SPEED_FACTOR } = await import("@/config/game-rules");
    const kmh = (a: "walk" | "mtb", d: "easy" | "normal" | "hard") => resolveRules(a, d, 3000).zombieSpeedMps * 3.6;
    expect([kmh("walk", "easy"), kmh("walk", "normal"), kmh("walk", "hard")]).toEqual([6, 10, 13].map((x) => expect.closeTo(x, 5)));
    expect([kmh("mtb", "easy"), kmh("mtb", "normal"), kmh("mtb", "hard")]).toEqual([14, 17, 24].map((x) => expect.closeTo(x, 5)));
    expect(SPRINT_SPEED_FACTOR).toBe(1.5);
    for (const a of ["walk", "mtb"] as const) {
      const e = resolveRules(a, "easy", 3000), n = resolveRules(a, "normal", 3000), h = resolveRules(a, "hard", 3000);
      expect(h.initialZombies).toBeGreaterThanOrEqual(n.initialZombies * 1.9);
      expect(h.maxZombies).toBeGreaterThanOrEqual(n.maxZombies * 1.9);
      expect(e.initialZombies).toBeLessThan(n.initialZombies);
    }
    const n = resolveRules("walk", "normal", 3000), h = resolveRules("walk", "hard", 3000);
    expect([n.initialZombies, n.maxZombies, h.initialZombies, h.maxZombies]).toEqual([6, 18, 12, 36]);
  });
});

import { planScares, SCARE_TRIGGER_DISTANCE_M } from "@/play/session";

describe("slumpade skrämmor", () => {
  it("planScares: 1–2 skrämmor, första 90–420 s, andra 240–480 s efter första", () => {
    for (let i = 0; i < 200; i++) {
      const t = planScares(Math.random);
      expect(t.length).toBeGreaterThanOrEqual(1);
      expect(t.length).toBeLessThanOrEqual(2);
      expect(t[0]).toBeGreaterThanOrEqual(90);
      expect(t[0]).toBeLessThanOrEqual(420);
      if (t[1] !== undefined) { expect(t[1] - t[0]).toBeGreaterThanOrEqual(240); expect(t[1] - t[0]).toBeLessThanOrEqual(480); }
    }
    expect(planScares(() => 0.9)).toHaveLength(1);
    expect(planScares(() => 0.1)).toHaveLength(2);
  });

  async function setup(opts: { enabled: boolean; activity: Activity }) {
    const g = fakeGeo();
    const db = await openDb(new IDBFactory());
    let clock = 80_000_000;
    const timers: (() => void)[] = [];
    const cues: string[] = [];
    const session = new PlaySession({ geo: g.geo, db, store: new TileStore("/data/v1/varmland", fsFetch), now: () => clock, setInterval: (fn) => { timers.push(fn); return 1; }, clearInterval: () => undefined, onCue: (c) => cues.push(c), jumpScares: () => opts.enabled, random: () => 0.1 });
    const advance = (ms: number) => { for (let i = 0; i < ms; i += 200) { clock += 200; timers.forEach((f) => f()); if (i % 1000 === 0) g.fix(START, 5, clock); } };
    session.startLocating();
    for (let i = 0; i < 3; i++) { g.fix(START, 5, clock); clock += 1000; }
    await session.prepare({ ...withActivity(defaultParams("walk"), opts.activity), mode: "survival", difficulty: "easy", seed: 9 });
    await session.startMatch();
    g.fix(START, 5, clock);
    session.resume();
    return { session, advance, cues };
  }
  const place = (live: LiveGame, idx: number, targetM: number) => {
    const pos = live.filter.position!;
    let best: { e: string; d: number; diff: number } | null = null;
    for (const e of live.g.edges.values()) for (let d = 0; d <= e.lengthM; d += 5) {
      const diff = Math.abs(haversineM(pointAlong(e.geometry, e.cumM, d), pos) - targetM);
      if (!best || diff < best.diff) best = { e: e.id, d, diff };
    }
    const z = live.state.zombies[idx];
    z.edgeId = best!.e; z.distanceAlongEdgeM = best!.d; z.route = []; z.speedMps = 0;
  };

  it("skrämma utlöses först efter planerad tid och när en zombie närmar sig; högst 2; spelet pausas inte", async () => {
    const { session, advance, cues } = await setup({ enabled: true, activity: "walk" });
    const live = session.live!;
    live.state.phase = "survival";
    Object.assign(live.rules, { initialZombies: 0, maxZombies: 0, growthPerMin: 0 });
    for (let i = 0; i < live.state.zombies.length; i++) place(live, i, 600);
    // Före 90 s: ingen skrämma även om en zombie är nära.
    place(live, 0, 120);
    advance(30_000);
    expect(session.getView().scareNonce).toBe(0);
    // Efter tiden men zombien långt bort: ingen skrämma.
    place(live, 0, 600);
    live.state.elapsedSeconds = 130; // planerad första tid med random=0,1: 123 s
    advance(5000);
    expect(session.getView().scareNonce).toBe(0);
    // Zombie närmar sig (≤ 200 m): skrämma + cue "jump", spelet fortsätter (ej pausat).
    place(live, 0, SCARE_TRIGGER_DISTANCE_M - 50);
    advance(3000);
    expect(session.getView().scareNonce).toBe(1);
    expect(cues.filter((c) => c === "jump")).toHaveLength(1);
    expect(live.state.paused).toBe(false);
    // Samma läge igen direkt: ingen ny (nästa planerad 240+ s senare).
    advance(10_000);
    expect(session.getView().scareNonce).toBe(1);
    live.state.elapsedSeconds = 430; // andra: 123 + 240 + 24 = 387 s
    advance(3000);
    expect(session.getView().scareNonce).toBe(2);
    live.state.elapsedSeconds = 5000;
    advance(10_000);
    expect(session.getView().scareNonce).toBe(2); // aldrig fler än planerat
  }, 60000);

  it("aldrig på cykel och aldrig när avstängt", async () => {
    for (const o of [{ enabled: true, activity: "mtb" as Activity }, { enabled: false, activity: "walk" as Activity }]) {
      const { session, advance } = await setup(o);
      const live = session.live!;
      live.state.phase = "survival";
      Object.assign(live.rules, { initialZombies: 0, maxZombies: 0, growthPerMin: 0 });
      place(live, 0, 100);
      live.state.elapsedSeconds = 600;
      advance(5000);
      expect(session.getView().scareNonce).toBe(0);
    }
  }, 60000);
});
