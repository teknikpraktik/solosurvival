import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeAll, describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import { prepareMatch, type Prepared } from "@/play/prepare";
import { applyProfile, defaultParams, withActivity, type MatchParams } from "@/play/config";
import { createLiveMatch } from "@/play/match";
import { openDb, tryOpenDb, DB_NAME } from "@/play/idb";
import { MatchStorage } from "@/play/storage";
import { PlaySession } from "@/play/session";
import { resolveModeRules } from "@/config/modes";
import { OUTBREAK_PROFILE } from "@/config/product";
import { SimSession } from "@/sim/runner";
import { gridGraph } from "@/sim/test-graphs";
import { edgeLatLon } from "@/geo/graph/graph";
import { createObjectives } from "@/engine/objectives/objectives";
import { makeGoalBot, newBotStats } from "@/sim/bots";
import { haversineM, pointAlong, type LatLon } from "@/geo/geometry";
import type { GeoLike } from "@/gps/provider/provider";
import type { Difficulty } from "@/config/difficulty";
import { ENEMY_KINDS, MINI_DB_NAME, MINI_PROFILE, MINI_STORAGE_PREFIX } from "../src/config/product";
import { enemyArt, enemyKind, enemyMarker, enemySvg } from "../src/client/enemies";
import { MINI_SOUNDS } from "../src/client/sounds";
import { OUTBREAK_SOUNDS } from "@/app/_client/cues";

const APP = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(APP, "../..");
const tiles = path.join(ROOT, "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(tiles, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const START: LatLon = { lat: 59.40731, lon: 13.46753 };
const MODES = ["survival", "escape", "mission"] as const;
const DIFFS: Difficulty[] = ["easy", "normal", "hard"];

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  if (f === "node_modules" || f === ".next" || f === "out") return [];
  return statSync(p).isDirectory() ? files(p) : [p];
});

describe("1. produktprofil", () => {
  it("Mini Outbreak: 80 % fiendefart, bara gång, alla tre lägen, inga skrämmor, fyra fiendetyper", () => {
    expect(MINI_PROFILE.enemySpeedMultiplier).toBe(0.8);
    expect(MINI_PROFILE.activities).toEqual(["walk"]);
    expect([...MINI_PROFILE.modes].sort()).toEqual(["escape", "mission", "survival"]);
    expect(MINI_PROFILE.jumpScares).toBe(false);
    expect(MINI_PROFILE.enemyKinds).toEqual(["cute-zombie", "rainbow-ghost", "rainbow-spider", "mini-monster"]);
    expect(MINI_PROFILE.graphics).not.toBe(OUTBREAK_PROFILE.graphics);
    expect(MINI_PROFILE.sound).not.toBe(OUTBREAK_PROFILE.sound);
  });
  it("vuxenprofilen är oförändrad", () => {
    expect(OUTBREAK_PROFILE).toMatchObject({ enemySpeedMultiplier: 1, activities: ["walk", "mtb"], jumpScares: true });
  });
});

describe("2. fiendefart 80 % (regler och riktig match)", () => {
  const prep: Partial<Record<(typeof MODES)[number], Prepared>> = {};
  beforeAll(async () => {
    for (const mode of MODES) prep[mode] = await prepareMatch(new TileStore("/data/v1/varmland", fsFetch), START, { ...defaultParams("walk"), mode, seed: 7 });
  }, 60000);

  it("alla lägen och svårigheter: barnmatchens fiender har 80 % av vuxenfarten; allt annat i reglerna är lika", () => {
    for (const mode of MODES) for (const difficulty of DIFFS) {
      const base: MatchParams = { ...defaultParams("walk"), mode, difficulty, seed: 7 };
      const kid = applyProfile(base, MINI_PROFILE)!;
      const proposal = prep[mode]!.proposals[0] ?? null;
      const adult = createLiveMatch({ id: "a", params: base, start: START, proposal, graph: prep[mode]!.graph!, dataVersion: "t" });
      const mini = createLiveMatch({ id: "m", params: kid, start: START, proposal, graph: prep[mode]!.graph!, dataVersion: "t" });
      expect(mini.rules.zombieSpeedMps).toBeCloseTo(adult.rules.zombieSpeedMps * 0.8, 12);
      expect({ ...mini.rules, zombieSpeedMps: 0 }).toEqual({ ...adult.rules, zombieSpeedMps: 0 });
      for (const z of mini.state.zombies) expect(z.speedMps).toBeCloseTo(adult.rules.zombieSpeedMps * 0.8, 12);
      // Spelarens del av reglerna (fart för GPS-filtret, infektion) är densamma.
      expect(mini.rules.playerPaceMps).toBe(adult.rules.playerPaceMps);
      expect(mini.rules.maxPlausibleSpeedMps).toBe(adult.rules.maxPlausibleSpeedMps);
    }
  });

  it("simulerade matcher (samma motor): långsammare fiender fångar inte oftare, och alla tre lägen kan vinnas och förloras", () => {
    const g = gridGraph(12, 12, 120);
    const at = (edgeId: string, distM: number) => edgeLatLon(g, { edgeId, distM });
    const start = at("r6:5", 60);
    const outcomes: Record<string, { adult: string[]; mini: string[] }> = {};
    for (const mode of MODES) {
      outcomes[mode] = { adult: [], mini: [] };
      for (let seed = 1; seed <= 8; seed++) for (const who of ["adult", "mini"] as const) {
        const objectives = mode === "escape" ? createObjectives([{ id: "B", kind: "destination", ...at("r6:9", 0) }])
          : mode === "mission" ? createObjectives([{ id: "C1", kind: "checkpoint", ...at("r4:5", 60) }, { id: "C2", kind: "checkpoint", ...at("r8:8", 60) }, { id: "A", kind: "home", ...start }]) : undefined;
        const base = resolveModeRules(mode, "walk", "normal", 1500);
        const s = new SimSession({ g, activity: "walk", difficulty: "normal", durationS: 1500, seed, strategy: "avoid", start, mode, objectives, strategyFn: objectives ? makeGoalBot("planner", newBotStats()) : undefined, rulesPatch: who === "mini" ? { zombieSpeedMps: base.zombieSpeedMps * 0.8 } : {} });
        let n = 0; while (!s.finished && n < 9000) { s.step(); n++; }
        outcomes[mode][who].push(s.state.result ?? "none");
      }
      const caught = (r: string[]) => r.filter((x) => x === "infected").length;
      expect(caught(outcomes[mode].mini)).toBeLessThanOrEqual(caught(outcomes[mode].adult));
      expect(outcomes[mode].mini.every((r) => ["survived", "infected", "failed"].includes(r))).toBe(true);
    }
  }, 120000);
});

describe("3. fiendefördelning", () => {
  it("de fyra första fienderna i varje match är fyra olika typer", () => {
    for (let m = 0; m < 200; m++) {
      const id = `m${m.toString(36)}x`;
      expect(new Set(["z0", "z1", "z2", "z3"].map((z) => enemyKind(z, id))).size).toBe(4);
    }
  });
  it("jämn fördelning över tid: exakt lika många av varje typ över 1000 fiender", () => {
    const count = Object.fromEntries(ENEMY_KINDS.map((k) => [k, 0]));
    for (let i = 0; i < 1000; i++) count[enemyKind(`z${i}`, "match-1")]++;
    expect(Object.values(count)).toEqual([250, 250, 250, 250]);
  });
  it("typen är stabil (samma fiende och match ger samma typ, även efter återställning) och varierar mellan matcher", () => {
    expect(enemyKind("z5", "abc")).toBe(enemyKind("z5", "abc"));
    const firsts = new Set(Array.from({ length: 40 }, (_, i) => enemyKind("z0", `match-${i}`)));
    expect(firsts.size).toBe(4);
    // Okänd id-form: fortfarande en giltig typ.
    expect(ENEMY_KINDS).toContain(enemyKind("weird-id", "x"));
  });
  it("kartmarkören visar typen och har unika, giltiga gradient-id:n", () => {
    const svg = enemyMarker("m 1/x")("z2");
    expect(svg).toMatch(/data-kind="(cute-zombie|rainbow-ghost|rainbow-spider|mini-monster)"/);
    for (const k of ENEMY_KINDS) {
      const s = enemySvg(k, "a b/c") + enemyArt(k, "a b/c", 40);
      for (const [, id] of s.matchAll(/id="([^"]+)"/g)) expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });
});

function fakeGeo() {
  let ok: Parameters<GeoLike["watchPosition"]>[0] | null = null;
  const geo: GeoLike = { watchPosition: (a) => { ok = a; return 1; }, clearWatch: () => { ok = null; } };
  return { geo, fix: (p: LatLon, acc: number, ts: number) => ok?.({ coords: { latitude: p.lat, longitude: p.lon, accuracy: acc, speed: null, heading: null }, timestamp: ts }) };
}
async function miniSession(db?: Awaited<ReturnType<typeof openDb>>) {
  const g = fakeGeo();
  const d = db ?? (await openDb(new IDBFactory(), MINI_DB_NAME));
  let clock = 70_000_000;
  const timers: (() => void)[] = [];
  const cues: string[] = [];
  // jumpScares: () => true efterliknar en felkonfiguration: profilen ska ändå stänga av dem.
  const s = new PlaySession({ geo: g.geo, db: d, store: new TileStore("/data/v1/varmland", fsFetch), now: () => clock, setInterval: (fn) => { timers.push(fn); return 1; }, clearInterval: () => undefined, onCue: (c) => cues.push(c), jumpScares: () => true, random: () => 0.1, profile: MINI_PROFILE });
  s.startLocating();
  for (let i = 0; i < 3; i++) { g.fix(START, 5, clock); clock += 1000; }
  const advance = (ms: number) => { for (let i = 0; i < ms; i += 200) { clock += 200; timers.forEach((f) => f()); if (i % 1000 === 0) g.fix(START, 5, clock); } };
  return { s, g, db: d, cues, advance, now: () => clock };
}

describe("4. cykelläget är avstängt", () => {
  it("cykel (och löpning) kan inte förberedas eller startas, inte heller via ändrade inställningar", async () => {
    const { s } = await miniSession();
    for (const a of ["mtb", "run"] as const) expect(await s.prepare({ ...withActivity(defaultParams("walk"), a), mode: "survival", seed: 1 })).toBeNull();
    expect(await s.prepare({ ...defaultParams("walk"), mode: "survival", seed: 1 })).not.toBeNull();
    s.params = { ...s.params!, activity: "mtb" };
    expect(await s.startMatch()).toBe(false);
  }, 60000);
  it("gränssnittet erbjuder bara gång", () => {
    const src = readFileSync(path.join(APP, "src/app/new/NewGame.tsx"), "utf8");
    expect(src).not.toMatch(/"mtb"|On Bike|ACTIVITY_LABEL/);
    expect(src).toMatch(/const ACTIVITY = MINI_PROFILE\.activities\[0\]/);
  });
  it("en sparad cykelmatch i barnappens lagring återställs inte", async () => {
    const db = await openDb(new IDBFactory(), MINI_DB_NAME);
    // Skriv en cykelmatch direkt med den delade sessionen utan profil (som om data hade hamnat där på annat sätt).
    const g = fakeGeo();
    let clock = 1_000_000;
    const raw = new PlaySession({ geo: g.geo, db, store: new TileStore("/data/v1/varmland", fsFetch), now: () => clock, setInterval: () => 1, clearInterval: () => undefined });
    raw.startLocating();
    for (let i = 0; i < 3; i++) { g.fix(START, 5, clock); clock += 1000; }
    await raw.prepare({ ...withActivity(defaultParams("walk"), "mtb"), mode: "survival", seed: 2 });
    expect(await raw.startMatch()).toBe(true);
    for (let i = 0; i < 200 && !(await raw.hasActive()); i++) await new Promise((r) => setTimeout(r, 10));
    const { s } = await miniSession(db);
    const out = await s.restoreActive();
    expect(out?.ok).toBe(false);
    expect(s.live).toBeNull();
    expect((await new MatchStorage(db).listHistory())[0].result).toBe("interrupted");
  }, 60000);
});

describe("5. inga skrämmor och inga skräckljud", () => {
  it("ingen jumpscare under en lång match med en fiende nära, även om appen skulle be om det", async () => {
    const { s, g, advance, cues, now } = await miniSession();
    await s.prepare({ ...defaultParams("walk"), mode: "survival", difficulty: "easy", seed: 9 });
    await s.startMatch();
    g.fix(START, 5, now());
    s.resume();
    const live = s.live!;
    live.state.phase = "survival";
    Object.assign(live.rules, { initialZombies: 0, maxZombies: 0, growthPerMin: 0 });
    const pos = live.filter.position!;
    let best: { e: string; d: number; diff: number } | null = null;
    for (const e of live.g.edges.values()) for (let d = 0; d <= e.lengthM; d += 5) {
      const diff = Math.abs(haversineM(pointAlong(e.geometry, e.cumM, d), pos) - 100);
      if (!best || diff < best.diff) best = { e: e.id, d, diff };
    }
    for (const z of live.state.zombies) { z.edgeId = best!.e; z.distanceAlongEdgeM = best!.d; z.route = []; z.speedMps = 0; }
    for (const t of [130, 400, 900]) { live.state.elapsedSeconds = t; advance(3000); }
    expect(s.getView().scareNonce).toBe(0);
    expect(cues).not.toContain("jump");
  }, 60000);
  it("ljudpaketet: bara checkpoint-klangen hörs; inga skräckljud finns i paketet", () => {
    expect(MINI_SOUNDS.samples).toEqual({ goal: "/audio/checkpoint.wav" });
    expect([...MINI_SOUNDS.audible]).toEqual(["goal"]);
    for (const c of ["zombie", "captured", "jump", "tension", "sprint"] as const) expect(MINI_SOUNDS.audible.has(c)).toBe(false);
    expect(MINI_SOUNDS.voice.pitch("Watch out!")).toBeGreaterThanOrEqual(1);
    expect(MINI_SOUNDS.storageKey).not.toBe(OUTBREAK_SOUNDS.storageKey);
  });
  it("barnappen innehåller inga av vuxenappens skräckfiler (namn eller innehåll)", () => {
    const horror = ["img/jump.jpg", "img/jump.svg", "img/captured.jpg", "img/captured.svg", "img/hero.jpg", "img/hero.svg", "img/backdrop.jpg", "audio/jump-scream.wav", "audio/captured-scream.wav", "audio/zombie-near.wav", "audio/tension.wav", "audio/sprint-shriek.wav"];
    const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
    const horrorHashes = new Set(horror.map((h) => sha(path.join(ROOT, "public", h))));
    const pub = files(path.join(APP, "public")).filter((p) => !p.includes(`${path.sep}data${path.sep}`) && !p.includes(`${path.sep}maplibre${path.sep}`));
    for (const p of pub) {
      expect(horror.map((h) => path.basename(h))).not.toContain(path.basename(p));
      expect(horrorHashes.has(sha(p))).toBe(false);
    }
    expect(pub.some((p) => p.endsWith(`audio${path.sep}checkpoint.wav`))).toBe(true);
  });
  it("barnappens kod använder inte vuxenappens skräckkomponenter, -bilder, -ljud, zombiesymbol eller stilmall", () => {
    const src = files(path.join(APP, "src")).map((p) => [p, readFileSync(p, "utf8")] as const);
    for (const [p, s] of src) {
      expect(s, p).not.toMatch(/_client\/(Scare|JumpScare|cues|symbols|SessionProvider|ServiceWorker|ResumeBanner)["']/);
      expect(s, p).not.toMatch(/\/img\/|scream|jump\.(jpg|svg)|captured\.(jpg|svg)|backdrop\.jpg|hero\.(jpg|svg)|zombie-near|tension\.wav|sprint-shriek|ZOMBIE_SVG/);
      expect(s, p).not.toMatch(/app\/globals\.css|\.\.\/\.\.\/\.\.\/src\/app/);
    }
  });
});

describe("6. gemensam AI, pathfinding och GPS", () => {
  it("barnappen innehåller ingen egen spelmotor, AI, pathfinding eller GPS-kod: allt delat importeras från src/", () => {
    const src = files(path.join(APP, "src")).map((p) => readFileSync(p, "utf8")).join("\n");
    expect(src).not.toMatch(/function (updateZombieAI|planRoute|stepGame|createGame|updateInfection|findSpawn|snapToGraph)\b|class (GpsFilter|GpsProvider|PlaySession|LiveGame)\b/);
    const allowed = /^@\/(engine|geo|gps|routes|data|config|play|audio|app\/_client\/(GameMap|Modal|format|build|compass|mapStyle))(\/|$)/;
    const imports = [...src.matchAll(/from "(@\/[^"]+)"/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(10);
    for (const i of imports) expect(i, i).toMatch(allowed);
  });
  it("barnmatchen använder samma fiendeplacering och AI som vuxenmatchen (samma seed ger samma start, bara farten skiljer)", async () => {
    const prep = await prepareMatch(new TileStore("/data/v1/varmland", fsFetch), START, { ...defaultParams("walk"), mode: "survival", seed: 3 });
    const base: MatchParams = { ...defaultParams("walk"), mode: "survival", seed: 3 };
    const a = createLiveMatch({ id: "x", params: base, start: START, proposal: null, graph: prep.graph!, dataVersion: "t" });
    const m = createLiveMatch({ id: "x", params: applyProfile(base, MINI_PROFILE)!, start: START, proposal: null, graph: prep.graph!, dataVersion: "t" });
    expect(m.state.zombies.map((z) => [z.id, z.edgeId, z.distanceAlongEdgeM, z.state])).toEqual(a.state.zombies.map((z) => [z.id, z.edgeId, z.distanceAlongEdgeM, z.state]));
  }, 60000);
});

describe("7. PWA-metadata", () => {
  const mini = JSON.parse(readFileSync(path.join(APP, "public/manifest.webmanifest"), "utf8"));
  const adult = JSON.parse(readFileSync(path.join(ROOT, "public/manifest.webmanifest"), "utf8"));
  it("eget namn, kortnamn, id, start och ikoner", () => {
    expect(mini.name).toBe("Mini Outbreak Solo Survival");
    expect(mini.short_name).toBe("Mini Outbreak");
    expect(mini.lang).toBe("en");
    expect(mini.display).toBe("standalone");
    for (const k of ["name", "short_name", "id", "start_url", "theme_color"]) expect(mini[k]).not.toBe(adult[k]);
    expect(new Set(mini.icons.map((i: { src: string }) => i.src)).size).toBe(3);
  });
  it("ikonerna finns, är PNG i rätt storlek och skiljer sig från vuxenappens", () => {
    const png = (p: string) => { const b = readFileSync(p); expect(b.subarray(1, 4).toString()).toBe("PNG"); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
    for (const i of mini.icons as { src: string; sizes: string }[]) {
      const file = path.join(APP, "public", i.src.replace(/\?.*$/, ""));
      const [w, h] = png(file);
      expect(`${w}x${h}`).toBe(i.sizes);
      expect(readFileSync(file).equals(readFileSync(path.join(ROOT, "public", i.src.replace(/\?.*$/, ""))))).toBe(false);
    }
    expect(png(path.join(APP, "public/icons/apple-touch-icon.png"))).toEqual([180, 180]);
  });
  it("layout: titel, Apple Web App och manifest", () => {
    const layout = readFileSync(path.join(APP, "src/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/title: "Mini Outbreak Solo Survival"/);
    expect(layout).toMatch(/appleWebApp: \{ capable: true, title: "Mini Outbreak"/);
    expect(layout).toMatch(/manifest: "\/manifest\.webmanifest"/);
    expect(layout).toMatch(/apple: "\/icons\/apple-touch-icon\.png/);
    expect(layout).not.toMatch(/OUTBREAK –/);
  });
  it("service worker med egna cachenamn", () => {
    const sw = readFileSync(path.join(APP, "public/sw.js"), "utf8");
    expect(sw).toMatch(/const STATIC = "mini-outbreak-static-v1"/);
    expect(sw).toMatch(/const PAGES = "mini-outbreak-pages-"/);
    expect(sw).not.toMatch(/"outbreak-/);
  });
});

describe("8. lagringsisolering", () => {
  it("egen IndexedDB och egna localStorage-nycklar", async () => {
    expect(MINI_DB_NAME).not.toBe(DB_NAME);
    expect(MINI_SOUNDS.storageKey.startsWith(MINI_STORAGE_PREFIX)).toBe(true);
    const f = new IDBFactory();
    const adult = (await tryOpenDb(f))!;
    const kid = (await tryOpenDb(f, MINI_DB_NAME))!;
    await new MatchStorage(adult).deleteAll();
    await adult.store("history").put("a1", { schema: 1, id: "a1", startedAt: 1 });
    expect(await new MatchStorage(kid).listHistory()).toEqual([]);
    await kid.store("history").put("k1", { schema: 1, id: "k1", startedAt: 2 });
    expect((await new MatchStorage(adult).listHistory()).map((h) => h.id)).toEqual(["a1"]);
    const src = files(path.join(APP, "src")).map((p) => readFileSync(p, "utf8")).join("\n");
    expect(src).not.toMatch(/localStorage\.(get|set)Item\("outbreak/);
    expect(readFileSync(path.join(APP, "src/client/SessionProvider.tsx"), "utf8")).toMatch(/tryOpenDb\(undefined, MINI_DB_NAME\)/);
  });
});

describe("9. alla tre spellägen i barnappen (simulerad GPS, riktiga kartdata)", () => {
  for (const mode of MODES) {
    it(`${mode}: förbereds, startar, går och kan avslutas; historiken sparas i barnappens databas`, async () => {
      const { s, g, advance, now, db } = await miniSession();
      const params: MatchParams = { ...defaultParams("walk"), mode, seed: 11, ...(mode === "escape" ? { pointB: { lat: START.lat + 0.006, lon: START.lon + 0.004 } } : {}) };
      const r = await s.prepare(params);
      expect(["ok", "alternative"]).toContain(r?.status);
      expect(await s.startMatch()).toBe(true);
      g.fix(START, 5, now());
      expect(s.resume()).toBe(true);
      advance(5000);
      const v = s.getView().match!;
      expect(v.mode).toBe(mode);
      expect(v.activity).toBe("walk");
      expect(v.elapsedS).toBeGreaterThan(3);
      expect(v.zombieCount).toBeGreaterThan(0);
      expect(s.live!.rules.zombieSpeedMps).toBeCloseTo(resolveModeRules(mode, "walk", "normal", s.live!.state.config.durationSeconds, undefined, mode === "escape" ? haversineM(START, s.live!.state.objectives!.targets[0]) : undefined).zombieSpeedMps * 0.8, 9);
      if (mode === "survival") expect(s.live!.rules.extractionOpensAtS).toBeLessThan(s.live!.state.config.durationSeconds);
      else expect(v.objectives?.total).toBeGreaterThan(0);
      await s.abort();
      for (let i = 0; i < 100 && s.getView().stage !== "finished"; i++) await new Promise((res) => setTimeout(res, 10));
      const h = await new MatchStorage(db).listHistory();
      expect(h[0]).toMatchObject({ mode, activity: "walk", result: "aborted" });
    }, 60000);
  }
});
