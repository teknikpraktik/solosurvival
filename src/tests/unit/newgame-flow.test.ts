import { readFileSync } from "node:fs";
import path from "node:path";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import type { GeoLike } from "@/gps/provider/provider";
import { DISTANCE_LIMITS, defaultParams, withActivity } from "@/play/config";
import { openDb } from "@/play/idb";
import { PlaySession } from "@/play/session";
import type { LatLon } from "@/geo/geometry";
import {
  LAST_SETUP_KEY, chooseActivity, chooseMode, courseKey, loadSetup, needsCourse, paramsFromSetup, prevStep, saveSetup, stepFromSearch, stepUrl,
} from "@/play/newgame-flow";

/** In-memory Storage with the two methods New game uses. */
function mem(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe("New game steps: URL and back", () => {
  it("reads the step from the query; anything else is the first step", () => {
    expect(stepFromSearch("")).toBe("activity");
    expect(stepFromSearch("?step=mode")).toBe("mode");
    expect(stepFromSearch("?step=setup")).toBe("setup");
    expect(stepFromSearch("?step=play")).toBe("activity");
  });
  it("URLs round-trip and back goes one step at a time", () => {
    for (const s of ["activity", "mode", "setup"] as const) expect(stepFromSearch(stepUrl(s).replace("/new", ""))).toBe(s);
    expect(stepUrl("activity")).toBe("/new");
    expect(prevStep("setup")).toBe("mode");
    expect(prevStep("mode")).toBe("activity");
    expect(prevStep("activity")).toBeNull();
  });
});

describe("New game choices", () => {
  const B: LatLon = { lat: 59.41, lon: 13.47 };
  it("the same activity or mode again keeps every setting (going back to look changes nothing)", () => {
    const p = { ...defaultParams("mtb"), mode: "escape" as const, targetLengthM: 20000, difficulty: "hard" as const, pointB: B };
    expect(chooseActivity(p, "mtb")).toBe(p);
    expect(chooseMode(p, "escape")).toBe(p);
  });
  it("another activity resets distance and length to its defaults (as before) and drops B; difficulty and mode stay", () => {
    const p = { ...defaultParams("walk"), mode: "escape" as const, difficulty: "hard" as const, pointB: B };
    const q = chooseActivity(p, "mtb");
    expect(q.activity).toBe("mtb");
    expect(q.targetLengthM).toBe(withActivity(p, "mtb").targetLengthM);
    expect(q.pointB).toBeNull();
    expect(q.mode).toBe("escape");
    expect(q.difficulty).toBe("hard");
  });
  it("another mode drops B and keeps the rest", () => {
    const p = { ...defaultParams("walk"), mode: "escape" as const, targetLengthM: 4000, pointB: B };
    const q = chooseMode(p, "mission");
    expect(q.mode).toBe("mission");
    expect(q.pointB).toBeNull();
    expect(q.targetLengthM).toBe(4000);
  });
  it("the course key changes with what the course depends on, not with difficulty", () => {
    const p = { ...defaultParams("walk"), mode: "mission" as const };
    const hard = { ...p, difficulty: "hard" as const };
    expect(courseKey(hard)).toBe(courseKey(p));
    expect(courseKey({ ...p, targetLengthM: p.targetLengthM + 250 })).not.toBe(courseKey(p));
    expect(courseKey({ ...p, activity: "mtb" })).not.toBe(courseKey(p));
    const ab = { ...p, mode: "escape" as const, pointB: B };
    expect(courseKey({ ...ab, pointB: { lat: B.lat + 0.001, lon: B.lon } })).not.toBe(courseKey(ab));
    expect(courseKey({ ...ab, targetLengthM: 9999 })).toBe(courseKey(ab)); // A TO B has no distance setting
  });
  it("only Checkpoints, and A TO B with B chosen, need a course before START", () => {
    expect(needsCourse({ mode: "mission", pointB: null })).toBe(true);
    expect(needsCourse({ mode: "escape", pointB: null })).toBe(false);
    expect(needsCourse({ mode: "escape", pointB: B })).toBe(true);
    expect(needsCourse({ mode: "survival", pointB: null })).toBe(false);
  });
});

describe("The last setup on this device", () => {
  it("keeps only the choices, never B, A or a seed, and reads them back", () => {
    const store = mem();
    saveSetup(store, { ...defaultParams("mtb"), mode: "survival", difficulty: "easy", durationS: 50 * 60, pointA: B0, pointB: B0, seed: 42 });
    const raw = JSON.parse(store.m.get(LAST_SETUP_KEY)!);
    expect(Object.keys(raw).sort()).toEqual(["activity", "difficulty", "durationS", "mode", "targetLengthM"]);
    const s = loadSetup(store)!;
    expect(s).toMatchObject({ activity: "mtb", mode: "survival", difficulty: "easy", durationS: 3000 });
    const p = paramsFromSetup(s);
    expect(p.pointA ?? null).toBeNull();
    expect(p.pointB ?? null).toBeNull();
  });
  it("nothing saved, broken JSON, or an unknown activity/mode: no shortcut", () => {
    expect(loadSetup(mem())).toBeNull();
    expect(loadSetup(mem({ [LAST_SETUP_KEY]: "{not json" }))).toBeNull();
    expect(loadSetup(mem({ [LAST_SETUP_KEY]: JSON.stringify({ activity: "run", mode: "mission" }) }))).toBeNull();
    expect(loadSetup(mem({ [LAST_SETUP_KEY]: JSON.stringify({ activity: "walk", mode: "hunt" }) }))).toBeNull();
    expect(loadSetup(null)).toBeNull();
  });
  it("bad or out-of-range values fall back to the defaults or are clamped to today's limits", () => {
    const s = loadSetup(mem({ [LAST_SETUP_KEY]: JSON.stringify({ activity: "walk", mode: "mission", difficulty: "insane", targetLengthM: 999999, durationS: "x" }) }))!;
    expect(s.difficulty).toBe("normal");
    expect(s.targetLengthM).toBe(DISTANCE_LIMITS.walk.max);
    expect(s.durationS).toBe(defaultParams("walk").durationS);
  });
  it("a storage that throws is ignored", () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(loadSetup(bad)).toBeNull();
    expect(() => saveSetup(bad, defaultParams("walk"))).not.toThrow();
  });
});
const B0: LatLon = { lat: 59.4, lon: 13.4 };

// --- The session: an answer for older choices must not overwrite newer ones ---
const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => {
  const rel = url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "");
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, rel), "utf8")) };
};
const START: LatLon = { lat: 59.40731, lon: 13.46753 };
async function make() {
  const w: { ok: Parameters<GeoLike["watchPosition"]>[0] | null } = { ok: null };
  const geo: GeoLike = { watchPosition: (a) => { w.ok = a; return 1; }, clearWatch: () => { w.ok = null; } };
  const db = await openDb(new IDBFactory());
  let clock = 20_000_000;
  const timers: (() => void)[] = [];
  const session = new PlaySession({
    geo, db, store: new TileStore("/data/v1/varmland", fsFetch), now: () => clock,
    setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval: () => { timers.length = 0; },
  });
  session.startLocating();
  for (let i = 0; i < 3; i++) {
    w.ok?.({ coords: { latitude: START.lat, longitude: START.lon, accuracy: 6, speed: null, heading: null }, timestamp: clock });
    clock += 1000; timers.forEach((t) => t());
  }
  return session;
}

describe("PlaySession.prepare: late answers (simulated, not field evidence)", () => {
  it("two overlapping requests: the newer one wins, whatever order they finish in", async () => {
    const session = await make();
    const older = session.prepare({ ...defaultParams("walk"), mode: "mission", targetLengthM: 2000, seed: 1 });
    const newer = session.prepare({ ...defaultParams("walk"), mode: "mission", targetLengthM: 4000, seed: 2 });
    const [a, b] = await Promise.all([older, newer]);
    expect(a).toBeNull(); // discarded
    expect(b?.status).toBe("ok");
    expect(session.getView().params?.targetLengthM).toBe(4000);
    expect(session.getView().prepared).toBe(b);
    expect(session.getView().stage).toBe("preview");
  }, 60_000);
  it("an answer that arrives after the choices were dropped (another mode or activity) is discarded", async () => {
    const session = await make();
    const pending = session.prepare({ ...defaultParams("walk"), mode: "mission", seed: 1 });
    session.backToConfig();
    expect(await pending).toBeNull();
    expect(session.getView().prepared).toBeNull();
    expect(session.getView().stage).not.toBe("preview");
  }, 60_000);
  it("difficulty is handed over without planning again, and START uses it", async () => {
    const session = await make();
    const prep = await session.prepare({ ...defaultParams("walk"), mode: "mission", difficulty: "normal", seed: 3 });
    expect(prep?.status).toBe("ok");
    session.setDifficulty("hard");
    expect(session.getView().prepared).toBe(prep);
    expect(session.getView().params?.difficulty).toBe("hard");
    expect(await session.startMatch()).toBe(true);
    expect(session.getView().match?.difficulty).toBe("hard");
  }, 60_000);
});
