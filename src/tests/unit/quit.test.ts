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
import { MatchStorage } from "@/play/storage";
import { PlaySession, type SoundEvent } from "@/play/session";

// QUIT confirmed: the session ends the match and is back at the start, with nothing of the match left. Fake clock, real map data.
const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const START: LatLon = { lat: 59.40731, lon: 13.46753 };

async function make() {
  const w: { ok: Parameters<GeoLike["watchPosition"]>[0] | null } = { ok: null };
  const geo: GeoLike = { watchPosition: (a) => { w.ok = a; return 1; }, clearWatch: () => undefined };
  const db = await openDb(new IDBFactory());
  const c = { clock: 70_000_000 };
  const timers = new Map<number, () => void>();
  let seq = 0;
  const sounds: SoundEvent[] = [];
  const cues: string[] = [];
  const session = new PlaySession({
    geo, db, store: new TileStore("/data/v1/varmland", fsFetch), now: () => c.clock,
    setInterval: (fn) => { timers.set(++seq, fn); return seq; }, clearInterval: (h) => { timers.delete(h as number); },
    onSound: (e) => sounds.push(e), onCue: (cue) => cues.push(cue),
  });
  const fix = () => w.ok?.({ coords: { latitude: START.lat, longitude: START.lon, accuracy: 6, speed: null, heading: null }, timestamp: c.clock });
  const advance = (ms: number, step = 200) => { for (let i = 0; i < ms; i += step) { c.clock += step; [...timers.values()].forEach((t) => t()); } };
  const play = (secs: number) => { for (let i = 0; i < secs; i++) { fix(); advance(1000); } };
  async function begin(mode: MatchParams["mode"], activity: "walk" | "mtb" = "walk") {
    session.startLocating();
    for (let i = 0; i < 3; i++) { fix(); advance(1000); }
    expect((await session.prepare({ ...defaultParams(activity), mode, seed: 5 }))?.status).toBe("ok");
    expect(await session.startMatch()).toBe(true);
    fix();
    expect(session.resume()).toBe(true);
  }
  return { session, db, c, fix, advance, play, begin, timers, sounds, cues };
}

describe("QUIT", () => {
  it("ends the match and returns the session to the start: no match, no result, no ticker, no history shown", async () => {
    const t = await make();
    await t.begin("survival");
    t.play(5);
    expect(t.session.getView().match?.elapsedS).toBeGreaterThan(3);
    await t.session.quit();
    const v = t.session.getView();
    expect(v.match).toBeNull();
    expect(v.stage).not.toBe("finished");
    expect(v.heliNotice).toBeNull();
    expect(t.session.history).toBeNull();
    expect(t.session.autoStartPending).toBe(false);
    expect(t.timers.size).toBe(0); // the match ticker is gone
    // The ending is the plain aborted one (no win/lose sound) and the match is kept in the history as before.
    expect(t.sounds.filter((e) => e.type === "finished")).toEqual([{ type: "finished", result: "aborted", mode: "survival", stale: false }]);
    expect(t.cues).not.toContain("captured");
    const hist = await new MatchStorage(t.db).listHistory();
    expect(hist.map((h) => h.result)).toEqual(["aborted"]);
    expect(await new MatchStorage(t.db).loadActive()).toBeNull(); // nothing to restore
    t.advance(10_000);
    expect(t.session.getView().match).toBeNull();
  }, 60_000);

  it("a new match after QUIT starts clean (distance and time from zero)", async () => {
    const t = await make();
    await t.begin("mission");
    t.session.live!.state.player.distanceM = 1234; // as if moved
    t.play(10);
    await t.session.quit();
    await t.begin("survival", "mtb");
    const m = t.session.getView().match!;
    expect(m.distanceM).toBe(0);
    expect(m.elapsedS).toBeLessThan(1);
    expect(m.mode).toBe("survival");
    expect(m.activity).toBe("mtb");
    t.play(3);
    expect(t.session.getView().match!.elapsedS).toBeGreaterThan(1.5);
  }, 60_000);

  it("Keep playing changes nothing: the match keeps running (and a paused match stays paused)", async () => {
    // The confirmation dialog is UI only: until QUIT is pressed the session is not touched. Running on:
    const t = await make();
    await t.begin("survival");
    t.play(3);
    const before = t.session.getView().match!.elapsedS;
    t.play(3);
    expect(t.session.getView().match!.elapsedS).toBeGreaterThan(before + 2);
    t.session.pause("manual");
    t.play(3);
    const m = t.session.getView().match!;
    expect(m.paused).toBe(true);
    expect(m.phase).not.toBe("finished");
  }, 60_000);

  it("QUIT with no match left (already finished) just resets", async () => {
    const t = await make();
    await t.begin("survival");
    await t.session.abort();
    await t.session.quit();
    expect(t.session.getView().match).toBeNull();
  }, 60_000);
});
