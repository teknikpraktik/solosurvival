import { readFileSync } from "node:fs";
import path from "node:path";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { loadProgress, missionStatus, setDifficulty, storyKey, saveProgress, highestAward } from "@/campaign/progress";
import { REGENESIS } from "@/campaign/stories";
import { missionParams } from "@/campaign/setup";
import { THE_FALL } from "@/campaign/the-fall";
import type { Difficulty } from "@/config/difficulty";
import { TileStore, type Fetcher } from "@/data/store";
import { haversineM, type LatLon } from "@/geo/geometry";
import { snapToGraph } from "@/geo/graph/graph";
import type { GeoLike } from "@/gps/provider/provider";
import { defaultParams } from "@/play/config";
import { openDb } from "@/play/idb";
import { PlaySession, type SoundEvent } from "@/play/session";
import { MatchStorage } from "@/play/storage";

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const START: LatLon = { lat: 59.40731, lon: 13.46753 };
const c = THE_FALL;
const mission = (id: string) => c.missions.find((m) => m.id === id)!;

function fakeGeo() {
  let ok: Parameters<GeoLike["watchPosition"]>[0] | null = null;
  const geo: GeoLike = { watchPosition: (a) => { ok = a; return 1; }, clearWatch: () => { ok = null; } };
  return { geo, fix: (p: LatLon, acc: number, ts: number) => ok?.({ coords: { latitude: p.lat, longitude: p.lon, accuracy: acc, speed: null, heading: null }, timestamp: ts }) };
}

async function make(kv = new Map<string, string>(), idb = new IDBFactory()) {
  const g = fakeGeo();
  const db = await openDb(idb);
  let clock = 20_000_000;
  const timers: (() => void)[] = [];
  const sounds: SoundEvent[] = [];
  /** The texts of the cues the game shows (goal reached, zombie near, …). */
  const cueTexts: string[] = [];
  const store = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) };
  const session = new PlaySession({
    geo: g.geo, db, store: new TileStore("/data/v1/varmland", fsFetch), now: () => clock,
    setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval: () => { timers.length = 0; },
    onSound: (e) => sounds.push(e), onCue: (_c, text) => cueTexts.push(text), campaignStore: store,
  });
  const advance = (ms: number, step = 200) => { for (let i = 0; i < ms; i += step) { clock += step; timers.forEach((t) => t()); } };
  /** Game seconds with a fresh fix every second at `pos`. */
  const play = (seconds: number, pos: LatLon = START) => { for (let i = 0; i < seconds && session.getView().stage === "playing"; i++) { g.fix(pos, 6, clock); advance(1000); } };
  const begin = async (id: string, difficulty: Difficulty = "normal", seed = 3) => {
    session.startLocating();
    for (let i = 0; i < 3; i++) { g.fix(START, 6, clock); advance(1000); }
    const prep = await session.prepare(missionParams(c, mission(id), difficulty, seed));
    expect(prep?.status).toBe("ok");
    expect(await session.startMatch()).toBe(true);
    g.fix(START, 6, clock);
    expect(session.resume()).toBe(true);
    return prep!;
  };
  const progress = () => loadProgress(store, REGENESIS);
  /** Keeps every zombie far away, so a test about goals or the clock is not ended by a capture. */
  const calm = () => { for (const z of session.live!.state.zombies) z.speedMps = 0; session.live!.rules.maxZombies = session.live!.state.zombies.length; };
  return { g, db, session, advance, play, begin, progress, calm, sounds, cueTexts, kv, idb, now: () => clock, set: (t: number) => (clock = t) };
}
const story = (sounds: SoundEvent[]) => sounds.filter((e): e is Extract<SoundEvent, { type: "story" }> => e.type === "story").map((e) => e.id);

describe("campaign missions through the play session (real Värmland data, fake GPS; not field evidence)", () => {
  it("mission 01: starts from where the player is, runs as the mission, and surviving the 15 minutes wins and unlocks mission 02", async () => {
    const t = await make();
    await t.begin("01", "easy");
    const m = t.session.getView().match!;
    expect(m).toMatchObject({ mode: "survival", activity: "walk", difficulty: "easy", limitS: 900, winOnTimeout: true, extractionOpensAtS: Infinity, objectives: null });
    expect(m.campaign).toMatchObject({ campaignId: "the-fall", missionId: "01", number: 1, total: 5, title: "FIRST CONTACT", outcome: null });
    expect(m.zombieCount).toBe(1);
    expect(t.progress().chapters["the-fall"].missions["01"]).toMatchObject({ attempts: 1, completed: false });
    // The opening line: on screen and sent to the soundscape; the mode's own opening line is not said.
    expect(t.session.getView().radio).toMatchObject({ id: "tf-m01-start", speaker: "WATCHTOWER" });
    expect(t.sounds.find((e) => e.type === "match_started")).toMatchObject({ campaign: true });
    expect(story(t.sounds)).toEqual(["tf-m01-start"]);
    t.calm();
    t.play(905);
    const v = t.session.getView();
    expect(v.match!.result).toBe("survived");
    expect(v.match!.campaign!.outcome).toMatchObject({ firstCompletion: true, campaignCompleted: false, nextMissionId: "02", nextTitle: "THE SUPPLY RUN", saved: true });
    expect(v.match!.campaign!.endLines.map((l) => l.id)).toEqual(["tf-m01-win"]);
    expect(v.heliNotice).toBeNull();
    expect(t.sounds.find((e) => e.type === "finished")).toMatchObject({ result: "survived", campaign: true, ending: "plain" });
    const said = story(t.sounds);
    for (const id of ["tf-m01-signal", "tf-m01-spread", "tf-m01-survivors", "tf-m01-minute", "tf-m01-win"]) expect(said).toContain(id);
    expect(new Set(said).size).toBe(said.length);
    const p = t.progress();
    expect(p.chapters["the-fall"].missions["01"]).toMatchObject({ completed: true, bestTimeS: 900, bestDifficulty: "easy" });
    expect(p.started).toBe(true);
    expect(missionStatus(REGENESIS, p, "the-fall", "02")).toBe("next");
    expect(missionStatus(REGENESIS, p, "the-fall", "03")).toBe("locked");
    // The match is in the history as the mission it was.
    await new Promise((r) => setTimeout(r, 30));
    const h = (await new MatchStorage(t.db).listHistory())[0];
    expect(h).toMatchObject({ result: "survived", mode: "survival", campaign: { id: "the-fall", mission: "01" } });
  });

  it("no location, no clock: a minute of lost GPS does not win mission 01 or move its story", async () => {
    const t = await make();
    await t.begin("01");
    t.calm();
    t.play(20);
    const e = t.session.getView().match!.elapsedS;
    const said = story(t.sounds);
    t.advance(120_000);
    expect(t.session.getView().match!.elapsedS).toBeLessThan(e + 6);
    expect(t.session.getView().match!.gpsLostLong).toBe(true);
    expect(t.session.getView().match!.result).toBeUndefined();
    expect(story(t.sounds)).toEqual(said);
  });

  it("mission 02: three supply sites near the player on the network, any order, no way home; the last one wins", async () => {
    const t = await make();
    const prep = await t.begin("02");
    const course = prep.proposals[0];
    expect(course.waypoints.map((w) => w.kind)).toEqual(["checkpoint", "checkpoint", "checkpoint"]);
    for (const w of course.waypoints) {
      const d = haversineM(START, w);
      expect(d).toBeGreaterThan(120);
      expect(d).toBeLessThan(900);
      // On a trail or road of the player's own network: reachable without leaving the paths.
      expect(snapToGraph(prep.graph!, w)!.offNetworkM).toBeLessThan(5);
    }
    const o = t.session.getView().match!.objectives!;
    expect(o).toMatchObject({ total: 3, anyOrder: true, transmit: false, needS: 5 });
    expect(o.progress).toMatchObject({ primaryTotal: 3, hasHome: false });
    expect(t.session.getView().match!.limitS).toBeGreaterThan(20 * 60);
    t.calm();
    // Taken in the order 3, 1, 2.
    const order = [course.waypoints[2], course.waypoints[0], course.waypoints[1]];
    t.play(8, order[0]);
    expect(t.session.getView().match!.objectives!.reached).toEqual([order[0].id]);
    t.play(8, order[1]);
    t.play(8, order[2]);
    const v = t.session.getView();
    expect(v.match!.result).toBe("survived");
    expect(v.match!.objectives!.reached).toEqual(order.map((w) => w.id));
    expect(story(t.sounds).filter((id) => /first|middle|win/.test(id))).toEqual(["tf-m02-first", "tf-m02-middle", "tf-m02-win"]);
    expect(t.sounds.filter((e) => e.type === "checkpoint").every((e) => e.type === "checkpoint" && e.campaign)).toBe(true);
    // The screen speaks of supplies, not of checkpoints; so does the radio.
    expect(t.cueTexts.filter((x) => /collected|checkpoint/i.test(x))).toEqual(["Supplies collected 1/3", "Supplies collected 2/3", "Supplies collected 3/3"]);
    expect(mission("02").beats.filter((b) => b.trigger.on === "objective").every((b) => !/checkpoint|cleared/i.test(b.text))).toBe(true);
    // Mission 02 was played although mission 01 is not done (a test shortcut): the win must not unlock anything.
    expect(t.progress().chapters["the-fall"].missions["02"].completed).toBe(false);
  });

  it("mission 03: a destination is chosen on the network about 1.5 km away, with a route to it", async () => {
    const t = await make();
    const prep = await t.begin("03");
    const route = prep.proposals[0];
    expect(prep.proposals).toHaveLength(1);
    expect(route.waypoints).toMatchObject([{ kind: "destination", id: "B" }]);
    expect(route.lengthM).toBeGreaterThan(800);
    expect(route.lengthM).toBeLessThan(2400);
    expect(haversineM(START, route.waypoints[0])).toBeGreaterThan(300);
    const m = t.session.getView().match!;
    expect(m.mode).toBe("escape");
    expect(m.objectives!.progress.stage).toBe("destination");
    expect(t.session.live!.rules).toMatchObject({ interceptModel: "track", interceptShare: 0.45 });
    // Another seed may choose another destination; the same seed the same one.
    const again = await make();
    const prep2 = await again.begin("03");
    expect(prep2.proposals[0].waypoints[0]).toEqual(route.waypoints[0]);
    t.calm();
    t.play(8, route.waypoints[0]);
    expect(t.session.getView().match!.result).toBe("survived");
    expect(t.sounds.find((e) => e.type === "finished")).toMatchObject({ ending: "safehouse" });
  });

  it("mission 04: each relay is a zone to stay in; leaving pauses the signal, coming back resumes it", async () => {
    const t = await make();
    const prep = await t.begin("04");
    const relays = prep.proposals[0].waypoints;
    expect(relays).toHaveLength(3);
    let o = t.session.getView().match!.objectives!;
    expect(o).toMatchObject({ transmit: true, needS: 30, radiusM: 55, anyOrder: false, holding: false });
    t.calm();
    t.play(12, relays[0]);
    o = t.session.getView().match!.objectives!;
    expect(o.holding).toBe(true);
    expect(o.holdS).toBeGreaterThan(8);
    const sent = o.holdS;
    t.play(6, START);
    o = t.session.getView().match!.objectives!;
    expect(o.holding).toBe(false);
    // The fake player "teleports" out of the zone; the GPS filter takes a moment to believe it. Nothing is lost and nothing more is counted after that.
    expect(o.holdS).toBeGreaterThanOrEqual(sent);
    expect(o.holdS).toBeLessThan(sent + 3);
    expect(o.reached).toEqual([]);
    t.play(25, relays[0]);
    expect(t.session.getView().match!.objectives!.reached).toEqual([relays[0].id]);
    expect(story(t.sounds).filter((id) => id.includes("tx") || id.includes("first"))).toEqual(["tf-m04-tx-start", "tf-m04-tx-paused", "tf-m04-tx-resumed", "tf-m04-first"]);
    expect(t.cueTexts).toContain("Relay live 1/3");
    expect(t.cueTexts.some((x) => /checkpoint/i.test(x))).toBe(false);
    // The last relay needs longer.
    t.play(34, relays[1]);
    expect(t.session.getView().match!.objectives!).toMatchObject({ needS: 45, index: 2 });
    t.play(50, relays[2]);
    const v = t.session.getView().match!;
    expect(v.result).toBe("survived");
    expect(v.campaign!.endLines.map((l) => l.speaker)).toEqual(["WATCHTOWER", "RAVEN TWO"]);
    const ending = t.sounds.filter((e): e is Extract<SoundEvent, { type: "story" }> => e.type === "story" && e.final);
    expect(ending.map((e) => [e.id, e.queue])).toEqual([["tf-m04-win", false], ["tf-m04-raven", true]]);
  });

  it("mission 05: the helicopter is announced, lands at 22 minutes with a reachable landing zone, and reaching it wins", async () => {
    const t = await make();
    await t.begin("05", "easy");
    expect(t.session.getView().match!).toMatchObject({ limitS: 1800, extractionOpensAtS: 1320, winOnTimeout: false });
    t.calm();
    t.session.live!.state.elapsedSeconds = 1250;
    t.play(11);
    expect(t.session.getView().heliNotice).toBe("approaching");
    expect(story(t.sounds)).toContain("tf-m05-inbound");
    t.play(65);
    const m = t.session.getView().match!;
    expect(m.phase).toBe("extraction");
    expect(m.extraction).not.toBeNull();
    const d = haversineM(START, m.extraction!);
    expect(d).toBeGreaterThan(40);
    expect(d).toBeLessThan(500);
    expect(snapToGraph(t.session.live!.g, m.extraction!)!.offNetworkM).toBeLessThan(5);
    expect(story(t.sounds)).toContain("tf-m05-landed");
    expect(t.sounds.find((e) => e.type === "heli_landed")).toMatchObject({ campaign: true });
    t.play(8, m.extraction!);
    const v = t.session.getView().match!;
    expect(v.result).toBe("survived");
    expect(t.sounds.find((e) => e.type === "finished")).toMatchObject({ ending: "heli", campaign: true });
    expect(v.campaign!.endLines.map((l) => l.id)).toEqual(["tf-m05-win"]);
  });

  it("the whole campaign in order: each win unlocks the next, the last one completes it", async () => {
    const kv = new Map<string, string>();
    for (const id of ["01", "02", "03", "04", "05"]) {
      const t = await make(kv);
      expect(missionStatus(REGENESIS, t.progress(), "the-fall", id)).toBe("next");
      const prep = await t.begin(id, "easy");
      t.calm();
      if (id === "01") t.play(905);
      else if (id === "05") { t.session.live!.state.elapsedSeconds = 1319; t.play(4); t.play(8, t.session.getView().match!.extraction!); }
      else for (const w of prep.proposals[0].waypoints) t.play(id === "04" ? 40 : 8, w);
      const out = t.session.getView().match!.campaign!.outcome!;
      expect(t.session.getView().match!.result).toBe("survived");
      expect(out).toMatchObject({ firstCompletion: true, campaignCompleted: id === "05", saved: true });
    }
    const p = loadProgress({ getItem: (k) => kv.get(k) ?? null, setItem: () => undefined }, REGENESIS);
    expect(c.missions.every((m) => p.chapters["the-fall"].missions[m.id].completed)).toBe(true);
    expect(p.completedAt).toBeGreaterThan(0);
    expect(p.difficulty).toBeNull(); // playing on Easy by parameter does not set the saved choice
    // Every win is recorded on the difficulty the match was played on, and the story award follows from them.
    expect(c.missions.every((m) => p.chapters["the-fall"].missions[m.id].bestDifficulty === "easy")).toBe(true);
    expect(highestAward(p)).toBe("easy");
    expect([...kv.keys()]).toEqual([storyKey("regenesis")]);
  });

  it("failure and retry: out of time fails only this attempt; the retry is a new match of the same mission and can be won", async () => {
    const kv = new Map<string, string>();
    const first = await make(kv);
    await first.begin("01", "easy");
    first.calm();
    first.play(905);
    const t = await make(kv);
    await t.begin("02");
    t.calm();
    t.session.live!.state.elapsedSeconds = t.session.getView().match!.limitS - 3;
    t.play(6);
    let v = t.session.getView().match!;
    expect(v.result).toBe("failed");
    expect(v.campaign!.outcome).toMatchObject({ firstCompletion: false, nextMissionId: "03", saved: true });
    expect(v.campaign!.endLines.map((l) => l.id)).toEqual(["tf-m02-late-fail"]);
    let p = t.progress();
    expect(p.chapters["the-fall"].missions["01"].completed).toBe(true);
    expect(p.chapters["the-fall"].missions["02"]).toMatchObject({ completed: false, failures: 1, attempts: 1 });
    expect(missionStatus(REGENESIS, p, "the-fall", "02")).toBe("next");
    // Retry Mission: the session is reset and the mission is laid out again (a new seed, a new match).
    const firstId = v.id;
    t.session.reset();
    expect(t.session.getView().match).toBeNull();
    expect(t.session.getView().radio).toBeNull();
    const prep = await t.begin("02", "normal", 77);
    v = t.session.getView().match!;
    expect(v.id).not.toBe(firstId);
    expect(v.elapsedS).toBeLessThan(2);
    expect(v.objectives!.reached).toEqual([]);
    expect(v.campaign!.outcome).toBeNull();
    t.calm();
    for (const w of prep.proposals[0].waypoints) t.play(8, w);
    expect(t.session.getView().match!.result).toBe("survived");
    p = t.progress();
    expect(p.chapters["the-fall"].missions["02"]).toMatchObject({ completed: true, failures: 1, attempts: 2 });
    expect(missionStatus(REGENESIS, p, "the-fall", "03")).toBe("next");
  });

  it("being caught fails the mission with the capture ending, and nothing else changes", async () => {
    const kv = new Map<string, string>();
    const t = await make(kv);
    await t.begin("01", "hard");
    // A zombie is put on the player.
    const live = t.session.live!;
    const here = snapToGraph(live.g, START, live.state.component)!;
    Object.assign(live.state.zombies[0], { edgeId: here.edgeId, distanceAlongEdgeM: here.distM, speedMps: 0, route: [] });
    t.play(8);
    const v = t.session.getView().match!;
    expect(v.result).toBe("infected");
    expect(v.campaign!.outcome).toMatchObject({ firstCompletion: false, saved: true });
    expect(v.campaign!.endLines.map((l) => l.id)).toEqual(["tf-m01-caught"]);
    expect(story(t.sounds)).toContain("tf-m01-contact");
    expect(t.progress().chapters["the-fall"].missions["01"]).toMatchObject({ completed: false, failures: 1 });
  });

  it("quit: the mission ends as aborted, the session is back at the start, and the campaign is as it was", async () => {
    const kv = new Map<string, string>();
    const t = await make(kv);
    await t.begin("01");
    t.play(30);
    const before = JSON.stringify({ ...t.progress() });
    await t.session.quit();
    expect(t.session.getView().match).toBeNull();
    expect(JSON.stringify(t.progress())).toBe(before);
    expect(t.progress().chapters["the-fall"].missions["01"]).toMatchObject({ completed: false, failures: 0, attempts: 1 });
    expect((await new MatchStorage(t.db).listHistory())[0]).toMatchObject({ result: "aborted", campaign: { mission: "01" } });
  });

  it("app closed in the middle of a mission: it is restored as the same mission, paused, with its rules and without repeating old lines", async () => {
    const kv = new Map<string, string>();
    const idb = new IDBFactory();
    const t = await make(kv, idb);
    await t.begin("04");
    const relays = t.session.getView().match!.proposal!.waypoints;
    t.calm();
    t.play(12, relays[0]);
    t.session.onPageHide();
    await new Promise((r) => setTimeout(r, 60));
    const held = t.session.getView().match!.objectives!.holdS;
    // A new page load.
    const t2 = await make(kv, idb);
    t2.set(t.now() + 600_000);
    expect(await t2.session.restoreActive()).toEqual({ ok: true });
    const m = t2.session.getView().match!;
    expect(m.paused).toBe(true);
    expect(m.campaign).toMatchObject({ missionId: "04", title: "THE LAST SIGNAL" });
    expect(m.objectives!).toMatchObject({ transmit: true, needS: 30, radiusM: 55 });
    expect(m.objectives!.holdS).toBeGreaterThan(held - 11);
    expect(t2.session.live!.rules).toMatchObject({ interceptModel: "track", transmitSpawn: 1 });
    for (let i = 0; i < 3; i++) { t2.g.fix(relays[0], 6, t2.now()); t2.advance(1000); }
    expect(t2.session.resume()).toBe(true);
    expect(story(t2.sounds)).not.toContain("tf-m04-start");
    t2.calm();
    t2.play(40, relays[0]);
    expect(t2.session.getView().match!.objectives!.reached).toEqual([relays[0].id]);
    // The attempt was counted once, when it began.
    expect(t2.progress().chapters["the-fall"].missions["04"].attempts).toBe(1);
  });

  it("a short look away from the app during a transmission: no line is said late, and the mission goes on", async () => {
    const t = await make();
    const prep = await t.begin("04");
    t.calm();
    t.play(6, prep.proposals[0].waypoints[0]);
    const before = t.sounds.length;
    t.session.onVisibility(true);
    t.advance(20_000, 20_000);
    t.session.onVisibility(false);
    const late = t.sounds.slice(before).filter((e) => "stale" in e && !e.stale && e.type === "story");
    expect(late).toEqual([]);
    expect(t.session.getView().match!.paused).toBe(false);
    expect(t.session.getView().match!.result).toBeUndefined();
  });

  it("the result is recorded on the difficulty the match started with, even if the setting changes during the match or the app reloads", async () => {
    const kv = new Map<string, string>();
    const idb = new IDBFactory();
    const kvStore = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) };
    saveProgress(kvStore, setDifficulty(loadProgress(kvStore, REGENESIS), "hard"));
    const t = await make(kv, idb);
    await t.begin("01", "easy");
    t.calm();
    t.play(30);
    // The saved default is changed while the match runs (another tab, edited storage): the match keeps its own difficulty.
    saveProgress(kvStore, setDifficulty(loadProgress(kvStore, REGENESIS), "normal"));
    t.session.onPageHide();
    await new Promise((r) => setTimeout(r, 60));
    const t2 = await make(kv, idb);
    t2.set(t.now() + 1000);
    expect(await t2.session.restoreActive()).toEqual({ ok: true });
    expect(t2.session.getView().match!.difficulty).toBe("easy");
    for (let i = 0; i < 3; i++) { t2.g.fix(START, 6, t2.now()); t2.advance(1000); }
    expect(t2.session.resume()).toBe(true);
    t2.calm();
    t2.play(905);
    expect(t2.session.getView().match!.result).toBe("survived");
    const p = t2.progress();
    expect(p.chapters["the-fall"].missions["01"]).toMatchObject({ completed: true, bestDifficulty: "easy", attempts: 1 });
    expect(p.difficulty).toBe("normal");
  });

  it("Free Play is untouched: no campaign on the match, the mode's own sound events, and no campaign progress written", async () => {
    const t = await make();
    t.session.startLocating();
    for (let i = 0; i < 3; i++) { t.g.fix(START, 6, t.now()); t.advance(1000); }
    expect((await t.session.prepare({ ...defaultParams("walk"), mode: "survival", durationS: 900, seed: 3 }))?.status).toBe("ok");
    expect(await t.session.startMatch()).toBe(true);
    t.g.fix(START, 6, t.now());
    t.session.resume();
    const m = t.session.getView().match!;
    expect(m.campaign).toBeNull();
    expect(m.winOnTimeout).toBe(false);
    expect(m.extractionOpensAtS).toBe(600);
    expect(t.session.live!.rules.interceptModel).toBeUndefined();
    expect(t.session.getView().radio).toBeNull();
    expect(t.sounds.find((e) => e.type === "match_started")).toEqual({ type: "match_started", id: m.id, mode: "survival" });
    t.play(20);
    expect(story(t.sounds)).toEqual([]);
    expect(t.kv.size).toBe(0);
    // PLAY AGAIN never carries a mission into Free Play.
    await t.session.abort();
    t.session.playAgain();
    expect(t.session.takeAgain()?.campaign).toBeUndefined();
  });
});
