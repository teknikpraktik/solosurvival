import { readFileSync } from "node:fs";
import path from "node:path";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeAll, describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import { prepareMatch, type Prepared } from "@/play/prepare";
import { applyProfile, defaultParams, withActivity, type MatchParams } from "@/play/config";
import { createLiveMatch } from "@/play/match";
import { LiveGame } from "@/play/live-game";
import { openDb, tryOpenDb, DB_NAME } from "@/play/idb";
import { MatchStorage } from "@/play/storage";
import { PlaySession } from "@/play/session";
import { applyEnemySpeedMultiplier, resolveRules, sprintFactorAt, OFF_TRAIL_KMH } from "@/config/game-rules";
import { resolveModeRules } from "@/config/modes";
import { OUTBREAK_PROFILE, type ProductProfile } from "@/config/product";
import { haversineM, pointAlong, type LatLon } from "@/geo/geometry";
import type { GeoLike } from "@/gps/provider/provider";
import type { Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const START: LatLon = { lat: 59.40731, lon: 13.46753 };

/** En profil som bara tillåter gång och har lägre fiendefart (samma form som Mini Outbreak, men oberoende av appen). */
const SLOW_WALK: ProductProfile = { ...OUTBREAK_PROFILE, id: "test", enemySpeedMultiplier: 0.8, activities: ["walk"], jumpScares: false };

const ACTS: Activity[] = ["walk", "mtb"];
const DIFFS: Difficulty[] = ["easy", "normal", "hard"];
const MODES = ["survival", "escape", "mission"] as const;

describe("fiendefart per produkt (applyEnemySpeedMultiplier)", () => {
  it("multiplikator 1 ger exakt samma regelobjekt (vuxenappen oförändrad)", () => {
    const r = resolveRules("walk", "normal", 1800);
    expect(applyEnemySpeedMultiplier(r, 1)).toBe(r);
    expect(applyEnemySpeedMultiplier(r)).toBe(r);
  });

  it("0,8 skalar grundfart, spurt och terrängfart till 80 % för alla aktiviteter, svårigheter och lägen; inget annat ändras", () => {
    for (const a of ACTS) for (const d of DIFFS) for (const m of MODES) {
      const adult = resolveModeRules(m, a, d, 1800, undefined, m === "escape" ? 3000 : undefined);
      const mini = applyEnemySpeedMultiplier(adult, 0.8);
      expect(mini.zombieSpeedMps).toBeCloseTo(adult.zombieSpeedMps * 0.8, 12);
      // Toppfart i spurt och fart på terrängkanter är faktorer av grundfarten: absolut 80 %.
      expect(mini.zombieSpeedMps * sprintFactorAt(mini, mini.sprintRampS + 0.1)).toBeCloseTo(adult.zombieSpeedMps * sprintFactorAt(adult, adult.sprintRampS + 0.1) * 0.8, 12);
      expect(mini.zombieSpeedMps * mini.offTrailFactor).toBeCloseTo(adult.zombieSpeedMps * adult.offTrailFactor * 0.8, 12);
      // Allt annat är identiskt (spelarens fart, antal, radier, tider).
      expect({ ...mini, zombieSpeedMps: 0 }).toEqual({ ...adult, zombieSpeedMps: 0 });
    }
    // Terrängfarten i vuxenappen (A TO B till fots) är absolut OFF_TRAIL_KMH; i barnversionen 80 % av den.
    const w = resolveRules("walk", "normal", 1800);
    expect(applyEnemySpeedMultiplier(w, 0.8).zombieSpeedMps * w.offTrailFactor * 3.6).toBeCloseTo(OFF_TRAIL_KMH.normal * 0.8, 9);
  });

  it("ogiltig multiplikator avvisas", () => {
    const r = resolveRules("walk", "easy", 1800);
    for (const m of [0, -1, Number.NaN, Infinity]) expect(() => applyEnemySpeedMultiplier(r, m)).toThrow();
  });
});

describe("applyProfile", () => {
  const p = (a: Activity, mode: MatchParams["mode"] = "survival"): MatchParams => ({ ...withActivity(defaultParams("walk"), a), mode, seed: 1 });
  it("utan profil: oförändrade inställningar (samma objekt)", () => {
    const x = p("mtb");
    expect(applyProfile(x)).toBe(x);
  });
  it("vuxenprofilen tillåter allt som vuxenappen erbjuder och ändrar inte farten", () => {
    for (const a of ACTS) for (const m of MODES) expect(applyProfile(p(a, m), OUTBREAK_PROFILE)?.enemySpeedMultiplier).toBe(1);
  });
  it("otillåten aktivitet eller otillåtet läge ger null; tillåtet får profilens fart", () => {
    expect(applyProfile(p("mtb"), SLOW_WALK)).toBeNull();
    expect(applyProfile(p("run"), SLOW_WALK)).toBeNull();
    expect(applyProfile(p("walk"), { ...SLOW_WALK, modes: ["mission"] })).toBeNull();
    // Även en manipulerad fart skrivs över av profilen.
    expect(applyProfile({ ...p("walk"), enemySpeedMultiplier: 3 }, SLOW_WALK)?.enemySpeedMultiplier).toBe(0.8);
  });
});

describe("fiendefart i en riktig match (Värmlandsdata)", () => {
  const prep: Partial<Record<(typeof MODES)[number], Prepared>> = {};
  beforeAll(async () => {
    for (const mode of MODES) prep[mode] = await prepareMatch(new TileStore("/data/v1/varmland", fsFetch), START, { ...defaultParams("walk"), mode, seed: 5 });
  }, 60000);

  it("alla tre lägena: zombier skapas med 80 % fart, och en återställd match behåller den (även nya zombier)", () => {
    for (const mode of MODES) {
      const base: MatchParams = { ...defaultParams("walk"), mode, difficulty: "normal", seed: 5 };
      const proposal = prep[mode]!.proposals[0] ?? null;
      const adult = createLiveMatch({ id: "a", params: base, start: START, proposal, graph: prep[mode]!.graph!, dataVersion: "t" });
      const mini = createLiveMatch({ id: "m", params: { ...base, enemySpeedMultiplier: 0.8 }, start: START, proposal, graph: prep[mode]!.graph!, dataVersion: "t" });
      expect(mini.state.zombies.length).toBe(adult.state.zombies.length);
      expect(mini.state.zombies.length).toBeGreaterThan(0);
      for (const z of mini.state.zombies) expect(z.speedMps).toBeCloseTo(adult.rules.zombieSpeedMps * 0.8, 12);
      // Samma seed: samma platser (bara farten skiljer).
      expect(mini.state.zombies.map((z) => z.edgeId)).toEqual(adult.state.zombies.map((z) => z.edgeId));
      const restored = LiveGame.restore(mini.g, structuredClone(mini.state), { ...base, enemySpeedMultiplier: 0.8 }, proposal, mini.counters, null, 0);
      expect(restored.rules.zombieSpeedMps).toBeCloseTo(adult.rules.zombieSpeedMps * 0.8, 12);
      const restoredAdult = LiveGame.restore(adult.g, structuredClone(adult.state), base, proposal, adult.counters, null, 0);
      expect(restoredAdult.rules).toEqual(adult.rules);
    }
  });
});

function fakeGeo() {
  let ok: Parameters<GeoLike["watchPosition"]>[0] | null = null;
  const geo: GeoLike = { watchPosition: (a) => { ok = a; return 1; }, clearWatch: () => { ok = null; } };
  return { geo, fix: (p: LatLon, acc: number, ts: number) => ok?.({ coords: { latitude: p.lat, longitude: p.lon, accuracy: acc, speed: null, heading: null }, timestamp: ts }) };
}

async function session(profile: ProductProfile | undefined, db = undefined as Awaited<ReturnType<typeof openDb>> | undefined) {
  const g = fakeGeo();
  const d = db ?? (await openDb(new IDBFactory()));
  let clock = 50_000_000;
  const timers: (() => void)[] = [];
  const cues: string[] = [];
  const s = new PlaySession({ geo: g.geo, db: d, store: new TileStore("/data/v1/varmland", fsFetch), now: () => clock, setInterval: (fn) => { timers.push(fn); return 1; }, clearInterval: () => undefined, onCue: (c) => cues.push(c), jumpScares: () => true, random: () => 0.1, profile });
  s.startLocating();
  for (let i = 0; i < 3; i++) { g.fix(START, 5, clock); clock += 1000; }
  const advance = (ms: number) => { for (let i = 0; i < ms; i += 200) { clock += 200; timers.forEach((f) => f()); if (i % 1000 === 0) g.fix(START, 5, clock); } };
  return { s, g, db: d, cues, advance, now: () => clock };
}

describe("PlaySession med produktprofil (simulerad GPS)", () => {
  it("cykel kan inte förberedas eller startas med en gångprofil; gång får profilens fiendefart", async () => {
    const { s } = await session(SLOW_WALK);
    expect(await s.prepare({ ...withActivity(defaultParams("walk"), "mtb"), mode: "survival", seed: 3 })).toBeNull();
    expect(s.getView().messages[0]).toMatch(/not available/);
    expect(await s.startMatch()).toBe(false);
    const r = await s.prepare({ ...defaultParams("walk"), mode: "survival", seed: 3 });
    expect(r?.status).toBe("ok");
    expect(s.params?.enemySpeedMultiplier).toBe(0.8);
    // Inställningarna ändras i efterhand (t.ex. en bugg i UI): startMatch kontrollerar profilen igen.
    s.params = { ...s.params!, activity: "mtb" };
    expect(await s.startMatch()).toBe(false);
    s.params = { ...s.params!, activity: "walk" };
    expect(await s.startMatch()).toBe(true);
    expect(s.live!.rules.zombieSpeedMps).toBeCloseTo(resolveModeRules("survival", "walk", "normal", s.params!.durationS).zombieSpeedMps * 0.8, 12);
  }, 60000);

  it("utan profil (vuxenappen): cykel fungerar som förut och farten är oförändrad", async () => {
    const { s } = await session(undefined);
    const r = await s.prepare({ ...withActivity(defaultParams("walk"), "mtb"), mode: "survival", seed: 3 });
    expect(r?.status).toBe("ok");
    expect(s.params?.enemySpeedMultiplier).toBeUndefined();
    expect(await s.startMatch()).toBe(true);
    expect(s.live!.rules).toEqual(resolveModeRules("survival", "mtb", "normal", s.params!.durationS));
  }, 60000);

  it("profilen stänger av skrämmor även när appen ber om dem", async () => {
    for (const profile of [SLOW_WALK, undefined]) {
      const { s, g, advance, cues, now } = await session(profile);
      await s.prepare({ ...defaultParams("walk"), mode: "survival", difficulty: "easy", seed: 9 });
      await s.startMatch();
      g.fix(START, 5, now());
      s.resume();
      const live = s.live!;
      live.state.phase = "survival";
      Object.assign(live.rules, { initialZombies: 0, maxZombies: 0, growthPerMin: 0 });
      // En zombie 100 m bort, långt efter den planerade skrämman (samma upplägg som skrämmotesterna i zombies.test.ts).
      const pos = live.filter.position!;
      let best: { e: string; d: number; diff: number } | null = null;
      for (const e of live.g.edges.values()) for (let d = 0; d <= e.lengthM; d += 5) {
        const diff = Math.abs(haversineM(pointAlong(e.geometry, e.cumM, d), pos) - 100);
        if (!best || diff < best.diff) best = { e: e.id, d, diff };
      }
      for (const z of live.state.zombies) { z.edgeId = best!.e; z.distanceAlongEdgeM = best!.d; z.route = []; z.speedMps = 0; }
      live.state.elapsedSeconds = 600;
      advance(5000);
      const scared = s.getView().scareNonce > 0 || cues.includes("jump");
      expect(scared).toBe(profile === undefined);
    }
  }, 60000);

  it("en sparad cykelmatch återställs inte i en gångprofil: den avslutas kontrollerat", async () => {
    const db = await openDb(new IDBFactory());
    const adult = await session(undefined, db);
    await adult.s.prepare({ ...withActivity(defaultParams("walk"), "mtb"), mode: "survival", seed: 3 });
    expect(await adult.s.startMatch()).toBe(true);
    for (let i = 0; i < 200 && !(await adult.s.hasActive()); i++) await new Promise((r) => setTimeout(r, 10)); // första sparningen är asynkron
    expect(await adult.s.hasActive()).toBe(true);
    const kid = await session(SLOW_WALK, db);
    const out = await kid.s.restoreActive();
    expect(out?.ok).toBe(false);
    expect(kid.s.live).toBeNull();
    const h = await new MatchStorage(db).listHistory();
    expect(h[0].result).toBe("interrupted");
    expect(await kid.s.hasActive()).toBe(false);
  }, 60000);
});

describe("lokal lagring per app", () => {
  it("två databasnamn delar inga matcher", async () => {
    const f = new IDBFactory();
    const a = (await tryOpenDb(f))!;
    const b = (await tryOpenDb(f, "mini-outbreak"))!;
    await a.store("history").put("x", { id: "x" });
    expect(await b.store("history").get("x")).toBeUndefined();
    expect(await a.store("history").get("x")).toEqual({ id: "x" });
    expect(DB_NAME).toBe("outbreak"); // vuxenappens befintliga data ligger kvar under samma namn
  });
});

describe("ljudpaket", () => {
  it("vuxenappens ljudpaket är oförändrat efter uppdelningen i gemensam uppspelning och paket", async () => {
    const { OUTBREAK_SOUNDS } = await import("@/app/_client/cues");
    expect(OUTBREAK_SOUNDS.storageKey).toBe("outbreak.cues");
    expect(OUTBREAK_SOUNDS.samples).toEqual({ zombie: "/audio/zombie-near.wav", captured: "/audio/captured-scream.wav", jump: "/audio/jump-scream.wav", tension: "/audio/tension.wav", sprint: "/audio/sprint-shriek.wav", goal: "/audio/checkpoint.wav" });
    expect([...OUTBREAK_SOUNDS.audible].sort()).toEqual(["captured", "goal", "jump", "sprint", "tension", "zombie"]);
    expect(OUTBREAK_SOUNDS.voice).toMatchObject({ lang: "en-US" });
    expect([OUTBREAK_SOUNDS.voice.pitch("Run!"), OUTBREAK_SOUNDS.voice.pitch("Checkpoint"), OUTBREAK_SOUNDS.voice.rate("Run!"), OUTBREAK_SOUNDS.voice.rate("Checkpoint")]).toEqual([0.5, 1.1, 0.9, 1]);
    expect([OUTBREAK_SOUNDS.gain("captured"), OUTBREAK_SOUNDS.gain("zombie")]).toEqual([1, 0.7]);
  });
});
