import { readFileSync } from "node:fs";
import path from "node:path";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeAll, describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import { prepareMatch, type Prepared } from "@/play/prepare";
import { defaultParams, type MatchParams } from "@/play/config";
import { createLiveMatch } from "@/play/match";
import type { LiveGame } from "@/play/live-game";
import { openDb } from "@/play/idb";
import { MatchStorage, type HistoryRecord } from "@/play/storage";
import { RECAP_CHUNK_SAMPLES, RECAP_KEEP_MS, RECAP_SAMPLE_S, RecapRecorder, RecapStore, nearZombies, personalRecord, positionAt, tracksOf, type RecapMeta } from "@/play/recap";
import { cumulativeLengths, haversineM, pointAlong, type LatLon } from "@/geo/geometry";
import { edgeLatLon } from "@/geo/graph/graph";

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => {
  const rel = url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "");
  const body = JSON.parse(readFileSync(path.join(root, rel), "utf8"));
  return { ok: true, status: 200, json: async () => body };
};
const START: LatLon = { lat: 59.40731, lon: 13.46753 };
let prep: Prepared;
const params: MatchParams = { ...defaultParams("walk"), mode: "survival", difficulty: "normal", seed: 5 };

beforeAll(async () => {
  prep = await prepareMatch(new TileStore("/data/v1/varmland", fsFetch), START, params);
}, 60000);

/** A survival match walked along the first long edge at 1.4 m/s, 1 fix/s, for `secs` seconds; `each` runs every second (persist, restore…). */
function play(secs: number, id = "m-recap", each?: (s: number, rec: RecapRecorder, live: LiveGame) => RecapRecorder | void) {
  const live = createLiveMatch({ id, params, start: START, proposal: null, graph: prep.graph!, dataVersion: "t" });
  const edge = [...prep.graph!.edges.values()].filter((e) => !e.offtrail).sort((a, b) => b.lengthM - a.lengthM)[0];
  const geom = edge.geometry, cum = cumulativeLengths(geom);
  let t = 10_000_000;
  live.pushFix({ latitude: geom[0].lat, longitude: geom[0].lon, accuracyM: 5, timestampMs: t }, t);
  live.resume(t);
  live.state.neutralUntilS = 1e9; // nobody gets captured: this is about the recording
  let rec = RecapRecorder.fresh(live, params, t);
  for (let s = 0; s < secs; s++) {
    for (let k = 0; k < 5; k++) { t += 200; rec.events(live.tick(t)); rec.tick(live); }
    const q = pointAlong(geom, cum, Math.min(cum.at(-1)!, (s + 1) * 1.4));
    live.pushFix({ latitude: q.lat, longitude: q.lon, accuracyM: 5, timestampMs: t }, t);
    rec = each?.(s, rec, live) ?? rec;
  }
  return { live, rec };
}

describe("match recap: recording", () => {
  it("records the player and every zombie every 3 s of game time, and the numbers", () => {
    const { live, rec } = play(600);
    rec.finish(live, "survived");
    const w = rec.take();
    const { player, zombies } = tracksOf(w.chunks); // only the latest chunk is in `take` here (the others were full and handed over before)
    expect(w.meta.elapsedS).toBeGreaterThanOrEqual(599);
    expect(player.t.length).toBeGreaterThan(0);
    expect(zombies.length).toBeGreaterThan(0);
    const st = w.meta.stats;
    expect(st.closestM).not.toBeNull();
    expect(st.peakZombies).toBeGreaterThanOrEqual(live.state.zombies.length);
    // Walked at 1.4 m/s until the end of the edge: the moving time matches the distance at that speed.
    expect(Math.abs(st.movingS - w.meta.distanceM / 1.4)).toBeLessThan(0.1 * st.movingS);
    expect(st.maxSpeedMps).toBeGreaterThan(1);
    expect(st.maxSpeedMps).toBeLessThan(3);
    expect(w.meta.result).toBe("survived");
    expect(w.meta.end).not.toBeNull();
  });

  it("stored a chunk at a time: the loaded track is complete, in order and without duplicates", async () => {
    const store = new RecapStore(await openDb(new IDBFactory()));
    const writes: Promise<void>[] = [];
    const { live, rec } = play(600, "m-store", (s, r) => { if (s % 10 === 9) writes.push(store.write(r.take())); });
    rec.finish(live, "survived");
    await Promise.all(writes);
    await store.write(rec.take());
    const got = (await store.load("m-store"))!;
    expect(got.chunks.length).toBeGreaterThanOrEqual(Math.floor(600 / RECAP_SAMPLE_S / RECAP_CHUNK_SAMPLES));
    const { player, zombies } = tracksOf(got.chunks);
    expect(player.t.length).toBeGreaterThanOrEqual(600 / RECAP_SAMPLE_S - 1);
    for (let i = 1; i < player.t.length; i++) {
      expect(player.t[i]).toBeGreaterThan(player.t[i - 1]);
      expect(player.t[i] - player.t[i - 1]).toBeLessThanOrEqual(RECAP_SAMPLE_S + 0.3);
    }
    // The last recorded zombie position is where the zombie is.
    const z = live.state.zombies[0];
    const tr = zombies.find((x) => x.id === z.id)!;
    expect(haversineM({ lat: tr.lat.at(-1)!, lon: tr.lon.at(-1)! }, edgeLatLon(live.g, { edgeId: z.edgeId, distM: z.distanceAlongEdgeM }))).toBeLessThan(2);
  });

  it("a restored match continues the same recap (only what was not yet saved is missing, no duplicates)", async () => {
    const store = new RecapStore(await openDb(new IDBFactory()));
    let saved: Promise<void> = Promise.resolve();
    let last: ReturnType<RecapRecorder["take"]> | null = null;
    const { live, rec } = play(300, "m-resume", (s, r, lv) => {
      if (s % 10 === 9) { const w = r.take(); last = w; saved = saved.then(() => store.write(w)); }
      // The app is reloaded at 155 s: the recap continues from what was saved at 150 s.
      if (s === 154) return RecapRecorder.resume(structuredClone(last!.meta), structuredClone(last!.chunks.find((c) => c.idx === last!.meta.chunks)), lv);
    });
    rec.finish(live, "survived");
    await saved;
    await store.write(rec.take());
    const { player } = tracksOf((await store.load("m-resume"))!.chunks);
    let maxGap = 0;
    for (let i = 1; i < player.t.length; i++) { expect(player.t[i]).toBeGreaterThan(player.t[i - 1]); maxGap = Math.max(maxGap, player.t[i] - player.t[i - 1]); }
    expect(maxGap).toBeLessThanOrEqual(5 + RECAP_SAMPLE_S); // the 5 s not yet saved when the app was reloaded
    expect(player.t.at(-1)!).toBeGreaterThanOrEqual(299);
  });
});

describe("match recap: kept a week, then deleted", () => {
  const meta = (id: string, startedAt: number): RecapMeta => ({ schema: 1, id, startedAt, mode: "survival", activity: "walk", difficulty: "normal", result: "survived", elapsedS: 1, distanceM: 1, start: null, end: null, targets: [], extraction: null, stats: { movingS: 0, maxSpeedMps: 0, closestM: null, closestAtS: null, nearMisses: 0, sprints: 0, dangerS: 0, offNetworkS: 0, passThroughs: 0, peakZombies: 0 }, chunks: 0, nextSampleS: 0, lastTickS: 0, captured: false });
  it("purges recaps (and their positions) older than 7 days, keeps newer ones", async () => {
    const db = await openDb(new IDBFactory());
    const store = new RecapStore(db);
    const now = Date.UTC(2026, 9, 30);
    await store.write({ meta: meta("old", now - RECAP_KEEP_MS - 1000), chunks: [{ id: "old", idx: 0, player: [0, 1, 1], zombies: {} }] });
    await store.write({ meta: meta("new", now - RECAP_KEEP_MS + 3600_000), chunks: [{ id: "new", idx: 0, player: [0, 1, 1], zombies: {} }] });
    expect(await store.purge(now)).toBe(1);
    expect(await store.load("old")).toBeNull();
    expect(await db.store("recapChunks").range("old:")).toEqual([]);
    expect((await store.load("new"))!.chunks).toHaveLength(1);
  });
  it("deleting a match in the history deletes its recap", async () => {
    const db = await openDb(new IDBFactory());
    const store = new RecapStore(db);
    await store.write({ meta: meta("m1", Date.now()), chunks: [{ id: "m1", idx: 0, player: [0, 1, 1], zombies: {} }, { id: "m1", idx: 1, player: [3, 1, 1], zombies: {} }] });
    await store.write({ meta: meta("m10", Date.now()), chunks: [{ id: "m10", idx: 0, player: [0, 1, 1], zombies: {} }] });
    await new MatchStorage(db).deleteMatch("m1");
    expect(await store.load("m1")).toBeNull();
    expect(await store.load("m10")).not.toBeNull(); // "m1:" is not a prefix of "m10:"
  });
});

describe("match recap: showing it", () => {
  const tr = { id: "z", t: [0, 3, 6], lat: [59, 59.001, 59.002], lon: [13, 13, 13] };
  it("positions between samples are interpolated; outside the track there is none", () => {
    expect(positionAt(tr, 1.5)!.lat).toBeCloseTo(59.0005, 6);
    expect(positionAt(tr, -1)).toBeNull();
    expect(positionAt(tr, 60)).toBeNull();
  });
  it("near zombies: only those that came within the distance of the player", () => {
    const player = { id: "player", t: [0, 3, 6], lat: [59, 59, 59], lon: [13, 13, 13] };
    const far = { id: "far", t: [0, 3, 6], lat: [59.02, 59.02, 59.02], lon: [13, 13, 13] };
    expect(nearZombies(player, [tr, far], 300).map((z) => z.id)).toEqual(["z"]);
  });
  it("personal records: fastest completion, longest survival; nothing without earlier matches", () => {
    const h = (id: string, startedAt: number, result: HistoryRecord["result"], elapsedS: number, mode: HistoryRecord["mode"] = "mission"): HistoryRecord => ({ schema: 1, id, startedAt, mode, activity: "walk", difficulty: "normal", plannedLengthM: null, measuredDistanceM: 0, elapsedS, timeLimitS: 3600, result, checkpoints: null });
    expect(personalRecord(h("a", 3, "survived", 900), [h("b", 1, "survived", 1000), h("c", 2, "survived", 950)])).toMatch(/fastest/);
    expect(personalRecord(h("a", 3, "survived", 990), [h("b", 1, "survived", 980)])).toBeNull();
    expect(personalRecord(h("a", 3, "infected", 700, "survival"), [h("b", 1, "infected", 600, "survival")])).toMatch(/longest/);
    expect(personalRecord(h("a", 3, "infected", 700), [])).toBeNull();
  });
});
