import { describe, expect, it } from "vitest";
import { Soundscape, type Levels } from "@/audio/soundscape";
import { AUDIO, DUCK, MIX, MatchAudio, VOICE, musicMode, type MatchSoundInput } from "@/app/_client/audio";
import { SOUND_RULES } from "@/play/sound-rules";
import { fakeEnv, flush, type FakeGain } from "./audio-fakes";

// What the soundscape starts, stops and schedules, on a fake Web Audio clock. This is not a listening test.
const DUR: Record<string, number> = {
  ...Object.fromEntries(AUDIO.threat.map((u) => [u, 15])),
  [AUDIO.heliLoop]: 30, [AUDIO.heliApproach]: 25, [AUDIO.heliSuccess]: 7, [AUDIO.captured]: 4, [AUDIO.safeDoor]: 5,
  [AUDIO.zombieNear]: 3, [AUDIO.revealed]: 2, [AUDIO.checkpoint]: 2,
  [VOICE.keepMoving.url]: 8, [VOICE.safehouseOnMap.url]: 8, [VOICE.checkpointSecured.url]: 5, [VOICE.getToSafehouse.url]: 7,
  [VOICE.rescueInbound.url]: 6, [VOICE.getToHelicopter.url]: 7, [VOICE.liftingOff.url]: 5, [VOICE.insideSafehouse.url]: 7,
  [VOICE.checkpointStart.url]: 8, [VOICE.count50.url]: 0.8, [VOICE.count40.url]: 0.8, [VOICE.count30.url]: 1, [VOICE.count20.url]: 0.8, [VOICE.count10.url]: 0.8,
};
const MUSIC = { url: AUDIO.music, startS: 4, endS: 210.6, crossfadeS: 3.5, fadeInS: 3, fadeOutS: 2.5 };

function setup(levels: Partial<Levels> = {}) {
  const f = fakeEnv(DUR);
  const l: Levels = { on: true, music: 1, fx: 1, voice: 1, ...levels };
  const s = new Soundscape(f.env, { mix: MIX, duckTo: DUCK.to, duckAttackS: DUCK.attackS, duckReleaseS: DUCK.releaseS, levels: () => l }, MUSIC);
  const m = new MatchAudio(s, { nowS: () => f.nowMs() / 1000 }, () => 0.4);
  return { ...f, s, l, m };
}
const urlsLive = (ctx: ReturnType<typeof fakeEnv>["ctx"]) => ctx.live().map((x) => x.buffer?.url);
const base = (o: Partial<MatchSoundInput> = {}): MatchSoundInput => ({ id: "m1", mode: "mission", activity: "walk", phase: "survival", paused: false, finished: false, nearestM: 800, ...o });
/** Feeds the match input once per second for `secs` seconds. */
async function run(t: ReturnType<typeof setup>, secs: number, o: Partial<MatchSoundInput> = {}) {
  for (let i = 0; i < secs; i++) { t.m.update(base(o)); await t.advance(1000); }
}

describe("soundscape engine", () => {
  it("plays nothing before the first tap, nothing when muted, and nothing while the app is hidden", async () => {
    const t = setup();
    expect((await t.s.play(AUDIO.checkpoint, "fx", 1)).result).toBe("suppressed");
    expect(t.ctx.sources).toHaveLength(0);
    t.s.unlock();
    t.s.setSuppressed(true);
    expect((await t.s.play(AUDIO.checkpoint, "fx", 1)).result).toBe("suppressed");
    t.s.setSuppressed(false);
    t.l.on = false;
    expect((await t.s.play(AUDIO.checkpoint, "fx", 1)).result).toBe("muted");
    t.l.on = true;
    expect((await t.s.play(AUDIO.checkpoint, "fx", 1)).result).toBe("played");
    expect(t.ctx.sources).toHaveLength(1);
  });

  it("a missing or broken file does not throw", async () => {
    const t = setup();
    t.s.unlock();
    expect((await t.s.play("/audio/missing.mp3", "fx", 1)).result).toBe("missing");
    await t.s.loop("/audio/missing.mp3", "threat", 1, 0.1).start(1);
    expect(t.s.voiceCount).toBe(0);
  });

  it("a one-shot is cleaned up when it ends", async () => {
    const t = setup();
    t.s.unlock();
    await t.s.play(AUDIO.captured, "fx", 1);
    expect(t.s.voiceCount).toBe(1);
    await t.advance(4500);
    expect(t.s.voiceCount).toBe(0);
  });

  it("a loop repeats with a short overlap at the seam (padding trimmed), and stop leaves nothing scheduled", async () => {
    const t = setup();
    t.s.unlock();
    const lp = t.s.loop(AUDIO.threat[0], "threat", 1, 0.12);
    await lp.start(2);
    let maxLive = 0;
    let overlaps = 0;
    for (let i = 0; i < 600; i++) { await t.advance(100); const n = t.ctx.live().length; maxLive = Math.max(maxLive, n); if (n > 1) overlaps++; }
    expect(maxLive).toBe(2); // only at the seams…
    expect(overlaps).toBeLessThan(20); // …≈ 0.12 s per 15 s pass, sampled every 0.1 s
    const passes = t.ctx.sources.length;
    expect(passes).toBeGreaterThanOrEqual(4);
    // The trimmed region skips the fake 30 ms of padding at both ends; no change of speed.
    const first = t.ctx.sources[0].started!;
    expect(first.offset).toBeCloseTo(0.03, 2);
    expect(first.dur).toBeCloseTo(15 - 0.06, 2);
    lp.stop(1);
    await t.advance(3000);
    expect(t.ctx.live()).toHaveLength(0);
    await t.advance(60_000);
    expect(t.ctx.sources.length).toBe(passes); // no pass scheduled after stop
    expect(t.s.voiceCount).toBe(0);
  });

  it("ducks music, threat and helicopter under speech (fx stays), with a safety release", async () => {
    const t = setup();
    t.s.unlock();
    const duck = (t.s as unknown as { duck: FakeGain }).duck;
    t.s.setDuck("speech", true);
    expect(duck.gain.target).toBe(DUCK.to);
    t.s.setDuck("radio", true);
    t.s.setDuck("speech", false);
    expect(duck.gain.target).toBe(DUCK.to); // still held by the radio
    t.s.setDuck("radio", false);
    expect(duck.gain.target).toBe(1);
    t.s.setDuck("speech", true); // the voice never reports its end…
    await t.advance(12_200);
    expect(duck.gain.target).toBe(1); // …released anyway
    const fx = (t.s as unknown as { buses: Map<string, FakeGain> }).buses.get("fx")!;
    expect(fx.connected.has(duck as never)).toBe(false);
  });

  it("listener levels scale the buses; the master switch silences everything", async () => {
    const t = setup({ music: 0.5, fx: 0.25 });
    t.s.unlock();
    const buses = (t.s as unknown as { buses: Map<string, FakeGain> }).buses;
    expect(buses.get("music")!.gain.target).toBeCloseTo(MIX.music * 0.5);
    expect(buses.get("threat")!.gain.target).toBeCloseTo(MIX.threat * 0.25);
    t.l.on = false;
    t.s.applyLevels(0);
    expect((t.s as unknown as { master: FakeGain }).master.gain.target).toBe(0);
  });
});

describe("menu music", () => {
  it("starts as the app opens (before any tap, where the browser allows it), skips the leading silence, and never restarts while wanted", async () => {
    const t = setup();
    await t.s.music.prefetch();
    t.s.music.want(true); // no tap yet
    await flush();
    expect(t.media.filter((m) => m.plays > 0)).toHaveLength(1);
    t.s.unlock(); // the first tap wakes the audio context it plays into
    await flush();
    const playing = () => t.media.filter((m) => !m.paused);
    expect(playing()).toHaveLength(1);
    const el = playing()[0];
    expect(el.src).toBe("blob:music");
    expect(el.currentTime).toBeGreaterThanOrEqual(MUSIC.startS);
    const plays = el.plays;
    for (let i = 0; i < 20; i++) { t.s.music.want(true); t.s.unlock(); } // page changes, re-renders, taps
    await t.advance(5000);
    expect(el.plays).toBe(plays);
    expect(playing()).toHaveLength(1);
  });

  it("repeats with a crossfade near the end instead of stopping (the file is not assumed to loop)", async () => {
    const t = setup();
    t.s.unlock();
    t.s.music.want(true);
    await flush();
    const [a, b] = t.media;
    const cur = a.paused ? b : a;
    const other = cur === a ? b : a;
    cur.currentTime = MUSIC.endS - MUSIC.crossfadeS - 0.5;
    await t.advance(1000);
    expect(other.paused).toBe(false);
    expect(other.currentTime).toBeLessThan(MUSIC.startS + 2);
    await t.advance(5000);
    expect(cur.paused).toBe(true);
    expect(t.media.filter((m) => !m.paused)).toHaveLength(1);
  });

  it("fades out when the match starts and back in on return to the menu; muted stays silent", async () => {
    const t = setup();
    t.s.unlock();
    t.s.music.want(true);
    await t.advance(1000);
    t.s.music.want(false);
    await t.advance(1000);
    expect(t.media.some((m) => !m.paused)).toBe(true); // still fading
    await t.advance(2000);
    expect(t.media.every((m) => m.paused)).toBe(true);
    t.s.music.want(true);
    await t.advance(500);
    expect(t.media.some((m) => !m.paused)).toBe(true);
    t.s.music.want(false);
    await t.advance(3000);
    t.l.on = false;
    t.s.music.want(true);
    await t.advance(1000);
    expect(t.media.every((m) => m.paused)).toBe(true);
  });

  it("blocked playback is not an error: it waits for the next tap", async () => {
    const t = setup();
    t.s.unlock();
    for (const m of t.media) m.block = true;
    t.s.music.want(true);
    await flush();
    expect(t.media.every((m) => m.paused)).toBe(true);
    for (const m of t.media) m.block = false;
    t.s.unlock();
    await flush();
    expect(t.media.filter((m) => !m.paused)).toHaveLength(1);
  });

  it("pauses while the app is hidden and continues (with a fade) when it is back", async () => {
    const t = setup();
    t.s.unlock();
    t.s.music.want(true);
    await t.advance(1000);
    t.s.setSuppressed(true);
    expect(t.media.every((m) => m.paused)).toBe(true);
    t.s.setSuppressed(false);
    await flush();
    expect(t.media.filter((m) => !m.paused)).toHaveLength(1);
  });
});

describe("match sounds", () => {
  it("one threat pulse at a time: starts from the real distance, ends after it has gone, never two variants together", async () => {
    const t = setup();
    t.s.unlock();
    await run(t, 10, { nearestM: 800 });
    expect(t.m.state.threat).toBeNull();
    await run(t, 6, { nearestM: 150 });
    const first = t.m.state.threat;
    expect(first).not.toBeNull();
    for (let k = 0; k < 4; k++) {
      await run(t, 40, { nearestM: 150 });
      expect(new Set(urlsLive(t.ctx).filter((u) => AUDIO.threat.includes(u as never))).size).toBe(1);
      await run(t, 40, { nearestM: 600 });
      await t.advance(5000);
      expect(t.m.state.threat).toBeNull();
      expect(urlsLive(t.ctx).filter((u) => AUDIO.threat.includes(u as never))).toEqual([]);
    }
  });

  it("the timed rules run on their own clock: a still zombie at 150 m starts the pulse, and its leaving ends it", async () => {
    const t = setup();
    t.s.unlock();
    t.m.update(base({ nearestM: 150 })); // the screen sends nothing more while nothing changes
    await t.advance(5000);
    expect(t.m.state.threat).not.toBeNull();
    t.m.update(base({ nearestM: 900 }));
    await t.advance(SOUND_RULES.threat.minOnS * 1000 + 6000);
    expect(t.m.state.threat).toBeNull();
    t.m.end();
    const n = t.timers.size;
    await t.advance(5000);
    expect(t.timers.size).toBeLessThanOrEqual(n); // the clock stops with the match
  });

  it("close zombie sound plays once per approach (cooldown), not once per zombie or per update", async () => {
    const t = setup();
    t.s.unlock();
    await run(t, 3, { nearestM: 500 });
    await run(t, 10, { nearestM: 60 });
    await run(t, 5, { nearestM: 200 });
    await run(t, 5, { nearestM: 60 }); // back within the cooldown
    expect(t.ctx.sources.filter((x) => x.buffer?.url === AUDIO.zombieNear)).toHaveLength(1);
    await run(t, SOUND_RULES.near.cooldownS, { nearestM: 300 });
    await run(t, 2, { nearestM: 60 });
    expect(t.ctx.sources.filter((x) => x.buffer?.url === AUDIO.zombieNear)).toHaveLength(2);
  });

  it("helicopter: approach once, then the waiting loop from extraction (approach faded), success at the win and nothing left", async () => {
    const t = setup();
    t.s.unlock();
    const S = { mode: "survival" as const };
    await run(t, 2, S);
    await t.m.onEvent({ type: "heli_approach", stale: false });
    await run(t, 5, S);
    expect(urlsLive(t.ctx)).toContain(AUDIO.heliApproach);
    expect(t.m.state.heliLoop).toBe(false);
    await t.m.onEvent({ type: "heli_landed", stale: false });
    await run(t, 6, { ...S, phase: "extraction" });
    expect(t.m.state.heliLoop).toBe(true);
    expect(urlsLive(t.ctx)).not.toContain(AUDIO.heliApproach);
    await run(t, 70, { ...S, phase: "extraction" }); // the loop goes on through several passes
    expect(urlsLive(t.ctx).filter((u) => u === AUDIO.heliLoop).length).toBeGreaterThanOrEqual(1);
    await t.m.onEvent({ type: "finished", result: "survived", mode: "survival", stale: false });
    await t.m.onEvent({ type: "finished", result: "survived", mode: "survival", stale: false }); // a repeat is ignored
    t.m.update(base({ ...S, phase: "finished", finished: true }));
    await t.advance(1500);
    expect(urlsLive(t.ctx).sort()).toEqual([AUDIO.heliSuccess, VOICE.liftingOff.url].sort());
    expect(t.ctx.sources.filter((x) => x.buffer?.url === AUDIO.heliSuccess)).toHaveLength(1);
    await t.advance(8000);
    expect(t.ctx.live()).toHaveLength(0);
    expect(t.s.voiceCount).toBe(0);
  });

  it("each ending has its own sound (home and B: the door; Survival: the helicopter; captured; none when out of time or quit)", async () => {
    const cases: [string, "mission" | "escape" | "survival", string | null][] = [
      ["survived", "mission", AUDIO.safeDoor], ["survived", "escape", AUDIO.safeDoor], ["survived", "survival", AUDIO.heliSuccess],
      ["infected", "mission", AUDIO.captured], ["infected", "survival", AUDIO.captured], ["failed", "mission", null], ["aborted", "survival", null],
    ];
    for (const [result, mode, url] of cases) {
      const t = setup();
      t.s.unlock();
      await run(t, 8, { mode, nearestM: 120 });
      expect(t.m.state.threat).not.toBeNull();
      await t.m.onEvent({ type: "finished", result, mode, stale: false });
      t.m.update(base({ mode, finished: true, phase: "finished" }));
      await t.advance(1500);
      expect(t.m.state.threat).toBeNull();
      // A win also has the operator's line (Survival: lifting off; home or B: inside the safe house).
      const voice = result === "survived" ? (mode === "survival" ? VOICE.liftingOff.url : VOICE.insideSafehouse.url) : null;
      expect(urlsLive(t.ctx).sort(), `${result}/${mode}`).toEqual([url, voice].filter((x): x is string => !!x).sort());
    }
  });

  it("checkpoint and position revealed: one sound per event, revealed with a cooldown; stale events (from the background) are silent", async () => {
    const t = setup();
    t.s.unlock();
    await run(t, 1);
    await t.m.onEvent({ type: "checkpoint", last: false, stale: false });
    await t.m.onEvent({ type: "checkpoint", last: false, stale: true });
    const rv = t.m.onEvent({ type: "revealed", reason: "hunt", stale: false }); // waits for the checkpoint line
    await t.m.onEvent({ type: "revealed", reason: "exposed", stale: false }); // within the cooldown
    await t.advance(6000);
    expect(await rv).toBe("played");
    const n = (u: string) => t.ctx.sources.filter((x) => x.buffer?.url === u).length;
    expect([n(VOICE.checkpointSecured.url), n(AUDIO.checkpoint), n(AUDIO.revealed)]).toEqual([1, 0, 1]); // the line replaces the chime
    await run(t, SOUND_RULES.revealed.cooldownS + 1);
    await t.m.onEvent({ type: "revealed", reason: "exposed", stale: false });
    expect(n(AUDIO.revealed)).toBe(2);
    // The result still sounds when the match ended while the app was away (the result screen shows now).
    await t.m.onEvent({ type: "finished", result: "infected", mode: "mission", stale: true });
    expect(n(AUDIO.captured)).toBe(1);
  });

  it("the revealed warning waits until the operator's line has ended (the hunt begins with the opening line)", async () => {
    const t = setup();
    t.s.unlock();
    await run(t, 1);
    t.s.setDuck("speech", true);
    const p = t.m.onEvent({ type: "revealed", reason: "hunt", stale: false });
    await t.advance(1000);
    expect(t.ctx.sources.some((x) => x.buffer?.url === AUDIO.revealed)).toBe(false);
    t.s.setDuck("speech", false);
    await t.advance(500);
    expect(await p).toBe("played");
    expect(t.ctx.sources.filter((x) => x.buffer?.url === AUDIO.revealed)).toHaveLength(1);
  });

  it("quit or leaving the game screen stops every match sound; a new match starts clean", async () => {
    const t = setup();
    t.s.unlock();
    await run(t, 8, { mode: "survival", phase: "extraction", nearestM: 120 });
    expect(t.m.state.threat).not.toBeNull();
    expect(t.m.state.heliLoop).toBe(true);
    t.m.end();
    await t.advance(1500);
    expect(t.ctx.live()).toHaveLength(0);
    const n = t.ctx.sources.length;
    await t.advance(60_000);
    expect(t.ctx.sources.length).toBe(n); // no timer brings anything back
    await run(t, 2, { id: "m2", mode: "mission", nearestM: 900 });
    expect(t.ctx.live()).toHaveLength(0);
    expect(t.m.state).toEqual({ threat: null, heliLoop: false, approach: false, voice: null });
  });

  it("pause and the app in the background stop the loops; nothing old plays on return", async () => {
    const t = setup();
    t.s.unlock();
    await run(t, 8, { mode: "survival", phase: "extraction", nearestM: 120 });
    await run(t, 2, { mode: "survival", phase: "extraction", nearestM: 120, paused: true });
    await t.advance(2000);
    expect(t.ctx.live()).toHaveLength(0);
    await run(t, 8, { mode: "survival", phase: "extraction", nearestM: 120 });
    expect(t.m.state.heliLoop).toBe(true);
    t.s.setSuppressed(true);
    t.m.setHidden(true);
    await t.advance(1000);
    expect(t.ctx.live()).toHaveLength(0);
    await t.m.onEvent({ type: "checkpoint", last: false, stale: false }); // while hidden
    t.s.setSuppressed(false);
    t.m.setHidden(false);
    await t.advance(500);
    expect(t.ctx.sources.some((x) => x.buffer?.url === AUDIO.checkpoint)).toBe(false);
  });

  it("muted: no match sound at all", async () => {
    const t = setup({ on: false });
    t.s.unlock();
    await run(t, 10, { mode: "survival", phase: "extraction", nearestM: 50 });
    await t.m.onEvent({ type: "checkpoint", last: false, stale: false });
    await t.m.onEvent({ type: "finished", result: "infected", mode: "survival", stale: false });
    expect(t.ctx.sources).toHaveLength(0);
  });
});

describe("operator's radio lines", () => {
  /** The app has no synthetic voice: the match audio has no way to speak at all. */
  const noSynthVoice = (t: ReturnType<typeof setup>) => expect("speak" in t.m).toBe(false);
  const live = (t: ReturnType<typeof setup>) => t.ctx.live().map((x) => x.buffer?.url).filter((u) => Object.values(VOICE).some((v) => v.url === u));
  /** Samples the voice bus every 100 ms for `ms`: the most lines heard at the same moment. */
  async function maxTogether(t: ReturnType<typeof setup>, ms: number) { let m = 0; for (let i = 0; i < ms; i += 100) { await t.advance(100); m = Math.max(m, live(t).length); } return m; }

  it("each mode opens with its recorded line when the match starts (and nothing synthetic)", async () => {
    for (const [mode, url] of [["survival", VOICE.keepMoving.url], ["escape", VOICE.safehouseOnMap.url], ["mission", VOICE.checkpointStart.url]] as const) {
      const t = setup();
      t.s.unlock();
      noSynthVoice(t);
      await t.m.onEvent({ type: "match_started", id: "m1", mode });
      expect(live(t), mode).toEqual(url ? [url] : []);
    }
  });

  it("checkpoint: \"Checkpoint secured\", the last one \"Get to the safe house\" instead; no chime", async () => {
    const t = setup();
    t.s.unlock();
    await run(t, 1);
    await t.m.onEvent({ type: "checkpoint", last: false, stale: false });
    expect(live(t)).toEqual([VOICE.checkpointSecured.url]);
    await t.advance(6000);
    await t.m.onEvent({ type: "checkpoint", last: true, stale: false });
    expect(live(t)).toEqual([VOICE.getToSafehouse.url]);
    expect(t.ctx.sources.filter((x) => x.buffer?.url === AUDIO.checkpoint)).toHaveLength(0);
  });

  it("a missing recording changes nothing in the game: the checkpoint chime takes over; nothing synthetic replaces a line", async () => {
    const t = setup();
    const fetch0 = t.env.fetchBytes;
    t.env.fetchBytes = async (u) => { if (u.includes("checkpoint-secured") || u.includes("keep-moving")) throw new Error("404"); return fetch0(u); };
    t.s.unlock();
    noSynthVoice(t);
    expect(await t.m.onEvent({ type: "match_started", id: "m1", mode: "survival" })).toBe("missing");
    await run(t, 1, { mode: "survival" });
    expect(await t.m.onEvent({ type: "checkpoint", last: false, stale: false })).toBe("missing");
    expect(t.ctx.sources.filter((x) => x.buffer?.url === AUDIO.checkpoint)).toHaveLength(1);
    expect(t.s.ducked).toBe(false); // no duck left behind by a line that never played
  });

  it("never two lines at once: a line that comes during another waits, and plays after it", async () => {
    const t = setup();
    t.s.unlock();
    await t.m.onEvent({ type: "match_started", id: "m1", mode: "survival" });
    await run(t, 1, { mode: "survival" });
    const cp = t.m.onEvent({ type: "heli_approach", stale: false }); // rescue inbound, while "keep moving" (8 s) plays
    expect(t.m.radio.queued).toBe("rescueInbound");
    expect(await maxTogether(t, 16_000)).toBe(1);
    await cp;
    expect(t.m.radio.log).toEqual(["keepMoving", "rescueInbound"]);
  });

  it("a waiting line that would come too late is dropped", async () => {
    const t = setup();
    t.s.unlock();
    await t.m.onEvent({ type: "match_started", id: "m1", mode: "escape" }); // 8 s
    await run(t, 1, { mode: "escape" });
    await t.advance(500);
    const late = t.m.radio.say("checkpointSecured");
    await t.advance(1000);
    // Shorter queue limit for the test (12 s in the app): the waiting line is older than that when the first one ends.
    (t.m.radio as unknown as { maxQueueMs: number }).maxQueueMs = 3000;
    await t.advance(9000);
    expect(await late).toBe("suppressed");
    expect(t.m.radio.log).toEqual(["safehouseOnMap"]);
  });

  it("Survival: rescue inbound before the landing, never after; landing interrupts it with \"Get to the helicopter\"; the win says \"Lifting off\"", async () => {
    const t = setup();
    t.s.unlock();
    const S = { mode: "survival" as const };
    await t.m.onEvent({ type: "match_started", id: "m1", mode: "survival" });
    await run(t, 10, S);
    void t.m.onEvent({ type: "heli_approach", stale: false });
    await t.advance(1000);
    expect(t.m.state.voice).toBe("rescueInbound");
    void t.m.onEvent({ type: "heli_landed", stale: false }); // the landing comes while it still speaks (short lead)
    await t.advance(300);
    expect(live(t)).toEqual([VOICE.getToHelicopter.url]);
    await run(t, 8, { ...S, phase: "extraction" });
    expect(t.m.radio.log).toEqual(["keepMoving", "rescueInbound", "getToHelicopter"]);
    // Reaching the extraction area is not the win; only the finished event is.
    await t.m.onEvent({ type: "finished", result: "survived", mode: "survival", stale: false });
    await t.advance(300);
    expect(live(t)).toEqual([VOICE.liftingOff.url]);
    expect(t.m.radio.log.filter((l) => l === "liftingOff")).toHaveLength(1);
    // Landing again (restore, repeated event) after the end: nothing.
    await t.m.onEvent({ type: "heli_landed", stale: false });
    expect(t.m.radio.log.at(-1)).toBe("liftingOff");
  });

  it("captured or quit while a line plays or waits: both are dropped, nothing comes later", async () => {
    for (const how of ["captured", "quit"] as const) {
      const t = setup();
      t.s.unlock();
      await t.m.onEvent({ type: "match_started", id: "m1", mode: "escape" });
      await run(t, 1, { mode: "escape" });
      void t.m.onEvent({ type: "checkpoint", last: false, stale: false }); // waits
      if (how === "captured") await t.m.onEvent({ type: "finished", result: "infected", mode: "escape", stale: false });
      else t.m.end();
      await t.advance(300);
      expect(live(t), how).toEqual([]);
      await t.advance(15_000);
      expect(t.m.radio.log, how).toEqual(["safehouseOnMap"]);
      expect(t.s.ducked, how).toBe(false);
    }
  });

  it("the win line is part of the ending: it interrupts a line, and stops when the ending is left", async () => {
    const t = setup();
    t.s.unlock();
    await t.m.onEvent({ type: "match_started", id: "m1", mode: "mission" });
    await run(t, 1);
    void t.m.onEvent({ type: "checkpoint", last: true, stale: false }); // waits behind the opening line
    await t.advance(1000);
    await t.m.onEvent({ type: "finished", result: "survived", mode: "mission", stale: false });
    await t.advance(300);
    expect(live(t)).toEqual([VOICE.insideSafehouse.url]);
    t.m.end(); // SHOW MATCH, PLAY AGAIN or Main menu
    await t.advance(500);
    expect(live(t)).toEqual([]);
    expect(t.s.ducked).toBe(false);
  });

  it("the app in the background stops the line; muted plays none (and no fallback either)", async () => {
    const t = setup();
    t.s.unlock();
    await t.m.onEvent({ type: "match_started", id: "m1", mode: "survival" });
    t.s.setSuppressed(true);
    t.m.setHidden(true);
    await t.advance(500);
    expect(live(t)).toEqual([]);
    const u = setup({ on: false });
    u.s.unlock();
    expect(await u.m.onEvent({ type: "match_started", id: "m1", mode: "survival" })).toBe("muted");
    expect(u.ctx.sources).toHaveLength(0);
  });

  it("stale moments (worked out on return from the background) get no line; a new match after an ended one starts afresh", async () => {
    const t = setup();
    t.s.unlock();
    await t.m.onEvent({ type: "match_started", id: "m1", mode: "survival" });
    await t.advance(9000);
    await t.m.onEvent({ type: "heli_landed", stale: true });
    expect(t.m.radio.log).toEqual(["keepMoving"]);
    await t.m.onEvent({ type: "finished", result: "infected", mode: "survival", stale: false });
    t.m.update(base({ mode: "survival", finished: true, phase: "finished" }));
    t.m.end();
    await t.advance(5000);
    await t.m.onEvent({ type: "match_started", id: "m2", mode: "survival" });
    expect(live(t)).toEqual([VOICE.keepMoving.url]);
    expect(t.m.radio.log).toEqual(["keepMoving", "keepMoving"]);
  });

  it("the background is lowered while a line plays and restored when it ends or is stopped", async () => {
    const t = setup();
    t.s.unlock();
    await t.m.onEvent({ type: "match_started", id: "m1", mode: "survival" });
    expect(t.s.ducked).toBe(true);
    await t.advance(8500);
    expect(t.s.ducked).toBe(false);
    void t.m.radio.say("checkpointSecured");
    await flush();
    expect(t.s.ducked).toBe(true);
    t.m.radio.stop();
    await t.advance(300);
    expect(t.s.ducked).toBe(false);
  });
});

describe("music around a match", () => {
  it("during a match the playing pass finishes (no fade-out, no new pass), then the music stops", async () => {
    const t = setup();
    t.s.unlock();
    t.s.music.want(true);
    await t.advance(1000);
    const el = t.media.find((m) => !m.paused)!;
    const plays = el.plays;
    t.s.music.setRepeat(false); // the match starts
    await t.advance(5000);
    expect(el.paused).toBe(false);
    expect(el.plays).toBe(plays);
    el.currentTime = MUSIC.endS - 2; // near the end of the pass
    await t.advance(3000);
    expect(t.media.every((m) => m.paused)).toBe(true); // no crossfade into a new pass
    expect(t.s.music.playing).toBe(false);
  });

  it("after the match it comes back, repeating; if it still plays it simply goes on", async () => {
    const t = setup();
    t.s.unlock();
    t.s.music.want(true);
    await t.advance(500);
    t.s.music.setRepeat(false);
    const el = t.media.find((m) => !m.paused)!;
    el.currentTime = MUSIC.endS - 1;
    await t.advance(2000);
    expect(t.s.music.playing).toBe(false);
    t.s.music.setRepeat(true); // the ending's sounds are over
    t.s.music.want(true);
    await t.advance(500);
    const now = t.media.filter((m) => !m.paused);
    expect(now).toHaveLength(1);
    expect(now[0].currentTime).toBeLessThan(MUSIC.startS + 2); // a new pass from the start, with a fade-in
    // Short match: the pass from the start is still playing at the end: no restart.
    const plays = now[0].plays;
    t.s.music.setRepeat(false);
    await t.advance(2000);
    t.s.music.setRepeat(true);
    t.s.music.want(true);
    await t.advance(500);
    expect(now[0].plays).toBe(plays);
    expect(now[0].paused).toBe(false);
  });

  it("which music mode each page and match state gives", () => {
    const run = { paused: false, elapsedS: 120, phase: "survival" };
    const o = { autoStartPending: false, finished: false, endSequenceDone: false };
    expect(musicMode("/", null, o)).toBe("loop");
    expect(musicMode("/new", null, o)).toBe("loop");
    expect(musicMode("/how-to-play", null, o)).toBe("loop");
    expect(musicMode("/field", null, o)).toBe("off");
    expect(musicMode("/dev", null, o)).toBe("off");
    expect(musicMode("/play", { paused: true, elapsedS: 0, phase: "survival" }, { ...o, autoStartPending: true })).toBe("loop"); // waiting for GPS
    expect(musicMode("/play", run, o)).toBe("finish"); // the match runs: the pass finishes
    expect(musicMode("/play", { ...run, paused: true }, o)).toBe("finish"); // paused: unchanged
    expect(musicMode("/play", { ...run, phase: "finished" }, { ...o, finished: true })).toBe("finish"); // the ending's sounds play
    expect(musicMode("/play", { ...run, phase: "finished" }, { ...o, finished: true, endSequenceDone: true })).toBe("loop");
  });

  it("the ending's sounds are reported done after the effect and the win line, at once when there are none", async () => {
    const t = setup();
    t.s.unlock();
    const seen: boolean[] = [];
    t.m.onEndSequence((d) => seen.push(d));
    await run(t, 1, { mode: "survival" });
    void t.m.onEvent({ type: "finished", result: "survived", mode: "survival", stale: false }); // effect 7 s, line 5 s
    await t.advance(5500);
    expect(t.m.endSequenceDone).toBe(false);
    await t.advance(2000);
    expect(t.m.endSequenceDone).toBe(true);
    // A new match, then captured (effect 4 s, no line).
    await t.m.onEvent({ type: "match_started", id: "m2", mode: "mission" });
    expect(t.m.endSequenceDone).toBe(false);
    void t.m.onEvent({ type: "finished", result: "infected", mode: "mission", stale: false });
    await t.advance(3500);
    expect(t.m.endSequenceDone).toBe(false);
    await t.advance(1000);
    expect(t.m.endSequenceDone).toBe(true);
    // Out of time: no ending sound, done at once.
    await t.m.onEvent({ type: "match_started", id: "m3", mode: "mission" });
    void t.m.onEvent({ type: "finished", result: "failed", mode: "mission", stale: false });
    await t.advance(100);
    expect(t.m.endSequenceDone).toBe(true);
    expect(seen).toEqual([true, false, true, false, true]);
  });

  it("a lost end signal does not keep the music away", async () => {
    const t = setup();
    t.s.unlock();
    await run(t, 1);
    const voice = t.m.radio as unknown as { whenIdle(): Promise<void> };
    voice.whenIdle = () => new Promise(() => undefined); // never resolves
    void t.m.onEvent({ type: "finished", result: "survived", mode: "mission", stale: false });
    await t.advance(14_000);
    expect(t.m.endSequenceDone).toBe(false); // the line's end is never reported…
    await t.advance(2000);
    expect(t.m.endSequenceDone).toBe(true); // …the music comes back anyway after 15 s
  });

  it("a new match drops the previous match's state: its clock never brings the old match back", async () => {
    const t = setup();
    t.s.unlock();
    await run(t, 3, { id: "old", nearestM: 150 });
    expect(t.m.state.threat).not.toBeNull();
    await t.m.onEvent({ type: "match_started", id: "new", mode: "escape" });
    await t.advance(5000); // no update from the screen yet
    expect(t.m.state.threat).toBeNull();
    expect(t.m.radio.log).toEqual(["safehouseOnMap"]);
  });
});

describe("spoken zombie distance (50, 40, 30, 20, 10 m)", () => {
  const said = (t: ReturnType<typeof setup>) => t.m.radio.log.filter((l) => l.startsWith("count"));
  it("each step once as the nearest zombie closes in; none beyond 50 m", async () => {
    const t = setup();
    t.s.unlock();
    for (const d of [120, 90, 60, 52]) await run(t, 1, { nearestM: d });
    expect(said(t)).toEqual([]);
    for (const d of [49, 47, 41, 39, 33, 29, 21, 19, 12, 9, 6]) await run(t, 1, { nearestM: d });
    expect(said(t)).toEqual(["count50", "count40", "count30", "count20", "count10"]);
    // The right recording for each number (named by what it says).
    expect(VOICE.count50.url).toBe("/audio/countdown-50.mp3");
    expect(VOICE.count10.url).toBe("/audio/countdown-10.mp3");
  });

  it("a fast approach says only the nearest step crossed (no backlog), GPS jitter repeats nothing", async () => {
    const t = setup();
    t.s.unlock();
    await run(t, 1, { nearestM: 80 });
    await run(t, 1, { nearestM: 24 }); // jumped past 50, 40 and 30
    expect(said(t)).toEqual(["count30"]);
    for (let k = 0; k < 10; k++) await run(t, 1, { nearestM: k % 2 ? 26 : 22 }); // jitter around 25 m
    expect(said(t)).toEqual(["count30"]);
    // Dropped back beyond the margin and comes again: said again.
    await run(t, 1, { nearestM: 70 });
    await run(t, 1, { nearestM: 45 });
    expect(said(t)).toEqual(["count30", "count50"]);
  });

  it("urgent: cuts a playing line at once, but never the win line; paused or muted says nothing", async () => {
    const t = setup();
    t.s.unlock();
    await t.m.onEvent({ type: "match_started", id: "m1", mode: "survival" }); // keep moving, 8 s
    await t.advance(1000);
    t.m.update(base({ mode: "survival", nearestM: 45 }));
    await t.advance(200);
    expect(t.m.radio.speaking).toBe("count50");
    expect(t.ctx.live().map((x) => x.buffer?.url)).not.toContain(VOICE.keepMoving.url); // cut at once
    expect(t.ctx.live().map((x) => x.buffer?.url)).toContain(VOICE.count50.url);
    await t.advance(1500);
    await run(t, 2, { mode: "survival", nearestM: 35, paused: true });
    expect(said(t)).toEqual(["count50"]);
    await t.m.onEvent({ type: "finished", result: "survived", mode: "survival", stale: false });
    void t.m.radio.say("count20", { urgent: true });
    expect(t.m.radio.speaking).toBe("liftingOff");
    const u = setup({ on: false });
    u.s.unlock();
    await run(u, 3, { nearestM: 15 });
    expect(u.ctx.sources).toHaveLength(0);
  });
});
