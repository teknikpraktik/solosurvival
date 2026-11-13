import { readFileSync } from "node:fs";
import path from "node:path";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import type { LatLon } from "@/geo/geometry";
import type { GeoLike } from "@/gps/provider/provider";
import { defaultParams, type MatchParams } from "@/play/config";
import { openDb, type Db } from "@/play/idb";
import { HELI_APPROACH_LEAD_S, HELI_NOTICE_MS, PlaySession } from "@/play/session";

// Survival helicopter cards on the session (simulated with real map data and a fake clock; not field evidence).
const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const START: LatLon = { lat: 59.40731, lon: 13.46753 };

async function make(db?: Db, clock0 = 50_000_000) {
  const w: { ok: Parameters<GeoLike["watchPosition"]>[0] | null } = { ok: null };
  const geo: GeoLike = { watchPosition: (a) => { w.ok = a; return 1; }, clearWatch: () => undefined };
  const theDb = db ?? (await openDb(new IDBFactory()));
  const c = { clock: clock0 };
  const timers: (() => void)[] = [];
  const cues: string[] = [];
  const session = new PlaySession({ geo, db: theDb, store: new TileStore("/data/v1/varmland", fsFetch), now: () => c.clock, setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval: () => { timers.length = 0; }, onCue: (cue) => cues.push(cue) });
  const fix = () => w.ok?.({ coords: { latitude: START.lat, longitude: START.lon, accuracy: 6, speed: null, heading: null }, timestamp: c.clock });
  const advance = (ms: number, step = 200) => { for (let i = 0; i < ms; i += step) { c.clock += step; timers.forEach((t) => t()); } };
  /** Seconds of play with a fresh fix every second. */
  const play = (secs: number) => { for (let i = 0; i < secs; i++) { fix(); advance(1000); } };
  async function begin(mode: MatchParams["mode"] = "survival") {
    session.startLocating();
    for (let i = 0; i < 3; i++) { fix(); advance(1000); }
    expect((await session.prepare({ ...defaultParams("walk"), mode, seed: 3 }))?.status).toBe("ok");
    expect(await session.startMatch()).toBe(true);
    fix();
    expect(session.resume()).toBe(true);
    play(3);
  }
  /** Moves the game clock to `s` seconds and keeps the zombies away (the test is about the helicopter, not about being caught). */
  const setElapsed = (s: number) => { const l = session.live!; l.state.elapsedSeconds = s; l.state.zombies = []; };
  const opens = () => session.live!.rules.extractionOpensAtS;
  const notice = () => session.getView().heliNotice;
  return { session, db: theDb, c, fix, advance, play, begin, setElapsed, opens, notice, cues };
}

describe("Survival helicopter cards", () => {
  it("approaching: once, when the game clock passes 60 s before extraction; gone after about 3 s; never again", async () => {
    const t = await make();
    await t.begin();
    expect(t.notice()).toBeNull();
    t.setElapsed(t.opens() - HELI_APPROACH_LEAD_S - 3);
    t.play(1);
    expect(t.notice()).toBeNull();
    t.play(3);
    expect(t.notice()).toBe("approaching");
    t.play(Math.ceil(HELI_NOTICE_MS / 1000) + 1);
    expect(t.notice()).toBeNull();
    t.setElapsed(t.opens() - 30);
    t.play(5);
    expect(t.notice()).toBeNull(); // shown once
  }, 60_000);

  it("landed: shown when extraction opens (the existing event), and the opening sound is not played twice", async () => {
    const t = await make();
    await t.begin();
    t.setElapsed(t.opens() - HELI_APPROACH_LEAD_S - 1);
    t.play(2);
    expect(t.notice()).toBe("approaching");
    t.play(4);
    t.setElapsed(t.opens() - 1);
    const sprintBefore = t.cues.filter((c) => c === "sprint").length;
    t.play(2);
    expect(t.session.getView().match?.extraction).toBeTruthy();
    expect(t.notice()).toBe("landed");
    expect(t.cues.filter((c) => c === "sprint").length - sprintBefore).toBe(1); // the one existing "extraction open" cue
    t.play(4);
    expect(t.notice()).toBeNull();
  }, 60_000);

  it("landed wins when both would come together (approaching never shown afterwards)", async () => {
    const t = await make();
    await t.begin();
    t.setElapsed(t.opens() - 0.5); // jumped past the approaching moment without it being shown
    t.play(1);
    expect(t.notice()).toBe("landed");
    t.play(5);
    expect(t.notice()).toBeNull();
  }, 60_000);

  it("pause: the clock stands still, so no card while paused; a card showing at pause is dropped and not shown again", async () => {
    const t = await make();
    await t.begin();
    t.setElapsed(t.opens() - HELI_APPROACH_LEAD_S - 2);
    t.session.pause("manual");
    for (let i = 0; i < 10; i++) { t.fix(); t.advance(1000); }
    expect(t.notice()).toBeNull();
    expect(t.session.getView().match!.elapsedS).toBeLessThan(t.opens() - HELI_APPROACH_LEAD_S);
    t.fix(); expect(t.session.resume()).toBe(true);
    t.play(4);
    expect(t.notice()).toBe("approaching");
    t.session.pause("manual");
    t.advance(400);
    expect(t.notice()).toBeNull();
    t.fix(); t.session.resume();
    t.play(1);
    expect(t.notice()).toBeNull();
  }, 60_000);

  it("match end removes a card that is showing", async () => {
    const t = await make();
    await t.begin();
    t.setElapsed(t.opens() - HELI_APPROACH_LEAD_S - 1);
    t.play(2);
    expect(t.notice()).toBe("approaching");
    await t.session.abort();
    expect(t.notice()).toBeNull();
  }, 60_000);

  it("Checkpoints and A TO B never get helicopter cards", async () => {
    const t = await make();
    await t.begin("mission");
    t.setElapsed(10_000);
    t.play(3);
    expect(t.notice()).toBeNull();
  }, 60_000);

  it("restored with less than 60 s to extraction: no late approaching card; landed still comes when extraction opens", async () => {
    const t = await make();
    await t.begin();
    t.setElapsed(t.opens() - 30);
    t.session.pause("manual"); // saves the match
    await new Promise((r) => setTimeout(r, 50));
    const t2 = await make(t.db, t.c.clock + 1000);
    expect(await t2.session.restoreActive()).toEqual({ ok: true });
    t2.fix(); expect(t2.session.resume()).toBe(true);
    t2.session.live!.state.zombies = [];
    t2.play(3);
    expect(t2.notice()).toBeNull();
    t2.setElapsed(t2.opens() - 1);
    t2.play(2);
    expect(t2.notice()).toBe("landed");
  }, 60_000);

  it("restored after extraction opened: no old card is shown again", async () => {
    const t = await make();
    await t.begin();
    t.setElapsed(t.opens() - 1);
    t.play(2);
    expect(t.notice()).toBe("landed");
    t.session.pause("manual");
    await new Promise((r) => setTimeout(r, 50));
    const t2 = await make(t.db, t.c.clock + 1000);
    expect(await t2.session.restoreActive()).toEqual({ ok: true });
    t2.fix(); t2.session.resume();
    t2.session.live!.state.zombies = [];
    t2.play(3);
    expect(t2.notice()).toBeNull();
  }, 60_000);
});
