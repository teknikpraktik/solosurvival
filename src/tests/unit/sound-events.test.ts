import { readFileSync } from "node:fs";
import path from "node:path";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import type { LatLon } from "@/geo/geometry";
import type { GeoLike } from "@/gps/provider/provider";
import { defaultParams, type MatchParams } from "@/play/config";
import { openDb } from "@/play/idb";
import { HELI_APPROACH_LEAD_S, PlaySession, type SoundEvent } from "@/play/session";
import type { GameEvent } from "@/engine/core/types";

// The session's sound moments (what the soundscape is told, and when), on real map data with a fake clock. Not field evidence.
const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const START: LatLon = { lat: 59.40731, lon: 13.46753 };

async function make() {
  const w: { ok: Parameters<GeoLike["watchPosition"]>[0] | null } = { ok: null };
  const geo: GeoLike = { watchPosition: (a) => { w.ok = a; return 1; }, clearWatch: () => undefined };
  const db = await openDb(new IDBFactory());
  const c = { clock: 60_000_000 };
  const timers: (() => void)[] = [];
  const sounds: SoundEvent[] = [];
  const session = new PlaySession({ geo, db, store: new TileStore("/data/v1/varmland", fsFetch), now: () => c.clock, setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval: () => { timers.length = 0; }, onSound: (e) => sounds.push(e) });
  const fix = () => w.ok?.({ coords: { latitude: START.lat, longitude: START.lon, accuracy: 6, speed: null, heading: null }, timestamp: c.clock });
  const advance = (ms: number, step = 200) => { for (let i = 0; i < ms; i += step) { c.clock += step; timers.forEach((t) => t()); } };
  const play = (secs: number) => { for (let i = 0; i < secs; i++) { fix(); advance(1000); } };
  async function begin(mode: MatchParams["mode"]) {
    session.startLocating();
    for (let i = 0; i < 3; i++) { fix(); advance(1000); }
    expect((await session.prepare({ ...defaultParams("walk"), mode, seed: 3 }))?.status).toBe("ok");
    expect(await session.startMatch()).toBe(true);
    fix();
    expect(session.resume()).toBe(true);
  }
  const calm = (s?: number) => { const l = session.live!; if (s !== undefined) l.state.elapsedSeconds = s; l.state.zombies = []; };
  const of = (type: SoundEvent["type"]) => sounds.filter((e) => e.type === type);
  const handle = (events: GameEvent[]) => (session as unknown as { endMatch(e: GameEvent[]): void }).endMatch(events);
  return { session, c, fix, advance, play, begin, calm, sounds, of, handle };
}

describe("sound moments from the session", () => {
  it("Survival: helicopter approach once (with its card), landing once (with its card), never twice", async () => {
    const t = await make();
    await t.begin("survival");
    t.play(2);
    const opens = t.session.live!.rules.extractionOpensAtS;
    t.calm(opens - HELI_APPROACH_LEAD_S - 1);
    t.play(3);
    expect(t.of("heli_approach")).toHaveLength(1);
    expect(t.session.getView().heliNotice).toBe("approaching");
    t.calm(opens - 1);
    t.play(3);
    expect(t.of("heli_landed")).toEqual([{ type: "heli_landed", stale: false }]);
    expect(t.session.getView().heliNotice).toBe("landed");
    t.play(10);
    expect(t.of("heli_approach")).toHaveLength(1);
    expect(t.of("heli_landed")).toHaveLength(1);
  }, 60_000);

  it("the hunt revealing your position is one moment per match, plus being exposed off the road network", async () => {
    const t = await make();
    await t.begin("mission");
    t.play(20); // the zombies detect the player (magnet hunt) as soon as the match runs
    expect(t.of("revealed")).toEqual([{ type: "revealed", reason: "hunt", stale: false }]);
    t.handle([{ type: "zombie_detected", zombieId: "x" }, { type: "zombie_detected", zombieId: "y" }]);
    expect(t.of("revealed")).toHaveLength(1);
    t.handle([{ type: "off_network", change: "entered" }]);
    expect(t.of("revealed")).toHaveLength(1);
    t.handle([{ type: "off_network", change: "exposed" }]);
    expect(t.of("revealed").map((e) => e.type === "revealed" && e.reason)).toEqual(["hunt", "exposed"]);
  }, 60_000);

  it("checkpoint: for a checkpoint only (home and B are the win, with their own sound)", async () => {
    const t = await make();
    await t.begin("mission");
    t.calm();
    const targets = t.session.live!.state.objectives!.targets;
    const cp = targets.findIndex((x) => x.kind === "checkpoint");
    const home = targets.findIndex((x) => x.kind !== "checkpoint");
    expect(cp).toBeGreaterThanOrEqual(0);
    expect(home).toBeGreaterThanOrEqual(0);
    t.handle([{ type: "objective_reached", targetId: targets[cp].id, index: cp }]);
    expect(t.of("checkpoint")).toEqual([{ type: "checkpoint", stale: false }]);
    t.handle([{ type: "objective_reached", targetId: targets[home].id, index: home }]);
    expect(t.of("checkpoint")).toHaveLength(1);
  }, 60_000);

  it("the end comes at once, in the same moment as the game decides it (not after the result is saved)", async () => {
    const t = await make();
    await t.begin("escape");
    t.play(2);
    const p = t.session.abort();
    expect(t.of("finished")).toEqual([{ type: "finished", result: "aborted", mode: "escape", stale: false }]);
    await p;
    expect(t.of("finished")).toHaveLength(1);
  }, 60_000);

  it("moments worked out on return from the background are marked stale (no late event sounds)", async () => {
    const t = await make();
    await t.begin("survival");
    t.play(2);
    const opens = t.session.live!.rules.extractionOpensAtS;
    t.calm(opens - HELI_APPROACH_LEAD_S + 5); // the approach is already past (and shown)
    t.play(5);
    t.calm(opens - 3);
    t.session.onVisibility(true);
    t.c.clock += 10_000; // away 10 s: the session catches up on return, and extraction opens in that time
    t.session.onVisibility(false);
    const landed = t.of("heli_landed");
    expect(landed).toEqual([{ type: "heli_landed", stale: true }]);
    t.play(2);
    expect(t.of("heli_landed")).toHaveLength(1);
  }, 60_000);
});
