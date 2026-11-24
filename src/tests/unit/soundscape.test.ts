import { describe, expect, it } from "vitest";
import { Soundscape, type Levels } from "@/audio/soundscape";
import { AUDIO, DUCK, GAIN, MATCH_SOUNDS, MIX, MatchAudio, SOUNDTRACK, VOICE, musicMode, type MatchSoundInput } from "@/app/_client/audio";
import { SOUND_RULES } from "@/play/sound-rules";
import { fakeEnv, flush, type FakeGain } from "./audio-fakes";

/** Engine-only test loops (no game file: the threat pulse that used these lengths was removed after the field test). */
const LOOP15 = "/audio/test-loop-15.mp3";
const LOOP30 = "/audio/test-loop-30.mp3";

// What the soundscape starts, stops and schedules, on a fake Web Audio clock. This is not a listening test.
const DUR: Record<string, number> = {
  [LOOP15]: 15, [LOOP30]: 30,
  [AUDIO.heliLoop]: 30, [AUDIO.heliApproach]: 25, [AUDIO.heliSuccess]: 7, [AUDIO.captured]: 4, [AUDIO.safeDoor]: 5,
  [AUDIO.zombieNear]: 3, [AUDIO.revealed]: 2, [AUDIO.checkpoint]: 2,
  ...Object.fromEntries(AUDIO.jump.map((u) => [u, 3])),
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
    const lp = t.s.loop(LOOP15, "threat", 1, 0.12);
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
  it("no threat pulse: minutes with a zombie at 150 m give the 200 m warning once and nothing on the threat bus", async () => {
    const t = setup();
    t.s.unlock();
    await run(t, 10, { nearestM: 800 });
    await run(t, 240, { nearestM: 150 });
    expect(t.m.radio.log).toEqual(["zombiesApproaching"]);
    expect(t.ctx.sources.map((x) => x.buffer?.url).filter((u) => u !== VOICE.zombiesApproaching.url)).toEqual([]);
    expect(Object.keys(AUDIO)).not.toContain("threat");
    expect(MATCH_SOUNDS.some((u) => u.includes("threat-pulse"))).toBe(false);
  });

  it("the timed rules run on their own clock, which stops with the match", async () => {
    const t = setup();
    t.s.unlock();
    t.m.update(base({ nearestM: 150 })); // the screen sends nothing more while nothing changes
    await t.advance(5000);
    t.m.end();
    const n = t.timers.size;
    await t.advance(5000);
    expect(t.timers.size).toBeLessThanOrEqual(n);
  });

  it("a new infected (someone bitten): a scream, softer than the other one-shots, a new variant each time, with a cooldown; the jump scare is silent", async () => {
    const t = setup();
    t.s.unlock();
    await run(t, 1);
    const screams = () => t.ctx.sources.filter((x) => AUDIO.jump.includes(x.buffer?.url as never));
    expect(await t.m.onEvent({ type: "infected", stale: false })).toBe("played");
    expect(screams()).toHaveLength(1);
    expect(GAIN.infected).toBeLessThan(1);
    expect(await t.m.onEvent({ type: "infected", stale: false })).toBe("suppressed"); // within the cooldown
    await run(t, SOUND_RULES.infected.cooldownS + 1);
    const first = screams()[0].buffer?.url;
    expect(await t.m.onEvent({ type: "infected", stale: false })).toBe("played");
    expect(screams()[1].buffer?.url).not.toBe(first); // another variant
    expect(await t.m.onEvent({ type: "infected", stale: true })).toBe("suppressed"); // worked out after the app was away
    // The jump scare plays no sound (picture and vibration only), and does not hold back a new infected's scream.
    await run(t, SOUND_RULES.infected.cooldownS + 1);
    const n = t.ctx.sources.length;
    expect(await t.m.onEvent({ type: "jump", stale: false })).toBeNull();
    expect(t.ctx.sources.length).toBe(n);
    expect(await t.m.onEvent({ type: "infected", stale: false })).toBe("played");
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
      await t.m.onEvent({ type: "finished", result, mode, stale: false });
      t.m.update(base({ mode, finished: true, phase: "finished" }));
      await t.advance(1500);
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
    expect(t.m.state.heliLoop).toBe(true);
    t.m.end();
    await t.advance(1500);
    expect(t.ctx.live()).toHaveLength(0);
    const n = t.ctx.sources.length;
    await t.advance(60_000);
    expect(t.ctx.sources.length).toBe(n); // no timer brings anything back
    await run(t, 2, { id: "m2", mode: "mission", nearestM: 900 });
    expect(t.ctx.live()).toHaveLength(0);
    expect(t.m.state).toEqual({ heliLoop: false, approach: false, voice: null });
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
    await t.m.onEvent({ type: "match_started", id: "new", mode: "escape" });
    await t.advance(5000); // no update from the screen yet
    expect(t.m.radio.log).toEqual(["zombiesApproaching", "safehouseOnMap"]); // the old match's 150 m warning, then nothing more from it
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

describe("loops starting part-way", () => {
  it("a loop can start part-way into its file; the passes after it play the whole file", async () => {
    const t = setup();
    t.s.unlock();
    const lp = t.s.loop(LOOP30, "threat", 1, 0.12);
    await lp.start(1, { frac: 0.5, keepS: 16.5 });
    for (let i = 0; i < 300; i++) await t.advance(100);
    const [first, second] = t.ctx.sources.map((x) => x.started!);
    expect(first.offset).toBeCloseTo(0.03 + 0.5 * (29.94 - 16.5), 2); // the trimmed region is 29.94 s
    expect(second.offset).toBeCloseTo(0.03, 2);
    lp.stop(0.5);
  });
});

describe("music playlist (the theme and the soundtrack)", () => {
  async function playlist(random: () => number = Math.random) {
    const f = fakeEnv(DUR);
    const l: Levels = { on: true, music: 1, fx: 1, voice: 1 };
    const { MUSIC_PLAYLIST } = await import("@/app/_client/audio");
    const s = new Soundscape(f.env, { mix: MIX, duckTo: DUCK.to, duckAttackS: DUCK.attackS, duckReleaseS: DUCK.releaseS, levels: () => l }, { ...MUSIC_PLAYLIST, random });
    s.unlock();
    return { ...f, s, l, P: MUSIC_PLAYLIST };
  }
  const playingEl = (t: { media: { paused: boolean }[] }) => t.media.find((m) => !m.paused) as unknown as { currentTime: number } | undefined;
  /** Moves the playing pass to just before its end (the fake elements play in real time otherwise). */
  const nearEnd = (t: Awaited<ReturnType<typeof playlist>>, beforeS: number) => {
    const url = t.s.music.track!;
    const tr = t.P.tracks.find((x) => x.url === url)!;
    playingEl(t)!.currentTime = (tr.endS ?? 60) - beforeS;
  };

  const urls = (t: Awaited<ReturnType<typeof playlist>>, idx: readonly number[]) => idx.map((i) => t.P.tracks[i].url);
  /** A repeatable random sequence (a small LCG), so a test sees many different draws. */
  const lcg = (seed = 7) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  it("the full theme opens the app; on the menu each next pass is a random calm piece (crossfaded), never the same twice in a row", async () => {
    const t = await playlist(lcg());
    t.s.music.want(true);
    await t.advance(500);
    expect(t.s.music.history).toEqual([AUDIO.music]);
    for (let k = 0; k < 30; k++) { nearEnd(t, t.P.crossfadeS + 0.5); await t.advance(5000); }
    const h = t.s.music.history;
    expect(h.length).toBe(31);
    for (let k = 1; k < h.length; k++) expect(h[k]).not.toBe(h[k - 1]);
    // Only the menu's pieces, and all of them in time: the match's pieces (tense, the run to the helicopter, the loss) never play here.
    expect(new Set(h)).toEqual(new Set(urls(t, t.P.menu!)));
    expect(t.media.filter((m) => !m.paused)).toHaveLength(1);
  });

  it("a match: one opening piece as it begins, then a darker pass after every 1–2.5 min of silence for as long as it lasts, the full theme after a win", async () => {
    const t = await playlist(lcg(3));
    const mid = urls(t, t.P.match!.mid as readonly number[]);
    expect(t.P.gapS).toEqual([60, 150]);
    expect(t.P.tracks.some((x) => x.url.includes("dirty-riff"))).toBe(false); // removed after the field test (too bright and upbeat)
    t.s.music.want(true);
    await t.advance(1000);
    nearEnd(t, t.P.crossfadeS + 0.5); // the full theme has given way to another menu piece
    await t.advance(5000);
    const menuPass = t.s.music.track!;
    expect(menuPass).not.toBe(AUDIO.music);
    t.s.music.matchStart(); // crossfaded from the menu's pass
    await t.advance(5000);
    const opening = t.s.music.track!;
    expect(urls(t, t.P.match!.start as readonly number[])).toContain(opening);
    expect(t.media.filter((m) => !m.paused)).toHaveLength(1);
    t.s.music.setRepeat(false); // what the page does as the match runs: changes nothing
    const passes: string[] = [];
    for (let k = 0; k < 8; k++) {
      nearEnd(t, 1);
      await t.advance(2000);
      expect(t.s.music.playing).toBe(false); // the pass is over: a silence of 1–2.5 min (some pieces are short, so watch each second)
      let silentS = 0;
      while (!t.s.music.playing && silentS < 200) { await t.advance(1000); silentS++; }
      expect(silentS).toBeGreaterThanOrEqual(58);
      expect(silentS).toBeLessThanOrEqual(152);
      passes.push(t.s.music.track!);
    }
    for (const u of passes) expect(mid).toContain(u);
    for (let k = 1; k < passes.length; k++) expect(passes[k]).not.toBe(passes[k - 1]);
    expect(t.s.music.history).toEqual([AUDIO.music, menuPass, opening, ...passes]);
    // The theme's two shorter versions are among the passes drawn in mid-match.
    expect(mid).toEqual(expect.arrayContaining([AUDIO.musicFade, AUDIO.musicShort]));
    nearEnd(t, 1);
    await t.advance(2000);
    t.s.music.matchOutcome(false);
    t.s.music.setRepeat(true); // the match is over (won), in a silence
    await t.advance(500);
    expect(t.s.music.track).toBe(AUDIO.music);
  });

  it("the full theme still playing as a match begins plays on to its end; then the match's passes, and the full theme again after a win", async () => {
    const t = await playlist(lcg(5));
    const mid = urls(t, t.P.match!.mid as readonly number[]);
    t.s.music.want(true);
    await t.advance(1000);
    expect(t.s.music.track).toBe(AUDIO.music);
    t.s.music.matchStart();
    t.s.music.setRepeat(false);
    await t.advance(5000);
    expect(t.s.music.track).toBe(AUDIO.music); // not crossfaded away
    expect(t.s.music.history).toEqual([AUDIO.music]);
    expect(t.media.filter((m) => !m.paused)).toHaveLength(1);
    nearEnd(t, 1);
    await t.advance(2000);
    expect(t.s.music.playing).toBe(false); // ended by itself, then the silence before a mid pass
    await t.advance(155_000);
    expect(mid).toContain(t.s.music.track);
    nearEnd(t, 1);
    await t.advance(2000);
    t.s.music.matchOutcome(false);
    t.s.music.setRepeat(true);
    await t.advance(500);
    expect(t.s.music.track).toBe(AUDIO.music); // the debrief's music
  });

  it("a lost match ends on Final Silence: after the ending's sounds, or crossfaded from a pass that still plays", async () => {
    for (const sounding of [false, true]) {
      const t = await playlist(() => 0.5);
      t.s.music.want(true);
      await t.advance(1000);
      t.s.music.matchStart();
      await t.advance(5000);
      if (!sounding) { nearEnd(t, 1); await t.advance(2000); expect(t.s.music.playing).toBe(false); }
      t.s.music.matchOutcome(true);
      t.s.music.setRepeat(true);
      await t.advance(5000);
      expect(t.s.music.track, `sounding: ${sounding}`).toBe(SOUNDTRACK.finalSilence);
      expect(t.media.filter((m) => !m.paused)).toHaveLength(1);
      // The next match starts clean: its own ending decides again.
      t.s.music.matchStart();
      await t.advance(5000);
      t.s.music.setRepeat(true);
      await t.advance(5000);
      expect(t.s.music.track).not.toBe(SOUNDTRACK.finalSilence);
    }
  });

  it("the helicopter has landed: Relentless Groove at once (from a silence or crossfaded), only during a match; the planned passes still come", async () => {
    const t = await playlist(() => 0.5);
    t.s.music.want(true);
    await t.advance(1000);
    expect(t.s.music.moment("extraction")).toBe(false); // the menu: nothing
    expect(t.s.music.track).toBe(AUDIO.music);
    t.s.music.matchStart();
    await t.advance(5000);
    nearEnd(t, 1);
    await t.advance(2000);
    expect(t.s.music.playing).toBe(false); // the silence before the first tense pass
    expect(t.s.music.moment("extraction")).toBe(true);
    await t.advance(4000);
    expect(t.s.music.track).toBe(SOUNDTRACK.groove);
    expect(t.s.music.moment("nope")).toBe(false);
    nearEnd(t, 1);
    await t.advance(2000);
    await t.advance(110_000);
    expect(urls(t, t.P.match!.mid as readonly number[])).toContain(t.s.music.track); // the planned pass, after a silence
    expect(t.s.music.moment("extraction")).toBe(true); // crossfaded from it
    await t.advance(5000);
    expect(t.s.music.track).toBe(SOUNDTRACK.groove);
    expect(t.media.filter((m) => !m.paused)).toHaveLength(1);
  });

  it("the app opens with the menu's music fetched; the match's pieces are fetched before a match", async () => {
    const f = fakeEnv(DUR);
    const asked: string[] = [];
    f.env.musicUrl = async (u: string) => { asked.push(u); return `blob:${u}`; };
    const { MUSIC_PLAYLIST } = await import("@/app/_client/audio");
    const s = new Soundscape(f.env, { mix: MIX, duckTo: DUCK.to, duckAttackS: DUCK.attackS, duckReleaseS: DUCK.releaseS, levels: () => ({ on: true, music: 1, fx: 1, voice: 1 }) }, MUSIC_PLAYLIST);
    await s.music.prefetch();
    expect(asked).toEqual(MUSIC_PLAYLIST.menu!.map((i) => MUSIC_PLAYLIST.tracks[i].url));
    await s.music.prefetch("all");
    expect(new Set(asked)).toEqual(new Set(MUSIC_PLAYLIST.tracks.map((x) => x.url)));
    expect(asked.length).toBe(MUSIC_PLAYLIST.tracks.length); // nothing twice
  });

  it("the match's events drive it: the landed helicopter starts Relentless Groove, a lost match ends on Final Silence (Free Play and campaign alike)", async () => {
    for (const campaign of [false, true]) {
      const t = await playlist(() => 0.5);
      const m = new MatchAudio(t.s, { nowS: () => t.nowMs() / 1000 }, () => 0.4);
      t.s.music.want(true);
      await t.advance(1000);
      await m.onEvent({ type: "match_started", id: "m1", mode: "survival", ...(campaign ? { campaign: true } : {}) });
      await t.advance(5000);
      void m.onEvent({ type: "heli_landed", stale: false, ...(campaign ? { campaign: true } : {}) });
      await t.advance(5000);
      expect(t.s.music.track, `campaign: ${campaign}`).toBe(SOUNDTRACK.groove);
      void m.onEvent({ type: "finished", result: "infected", mode: "survival", stale: false, ...(campaign ? { campaign: true } : {}) });
      await t.advance(1000);
      t.s.music.setRepeat(true); // what the page does once the ending's sounds are over
      await t.advance(5000);
      expect(t.s.music.track, `campaign: ${campaign}`).toBe(SOUNDTRACK.finalSilence);
    }
  });

  it("the app hidden during the silence before the mid-match pass: the pass still comes afterwards", async () => {
    const t = await playlist(() => 0.5); // the silence is then 105 s
    t.s.music.want(true);
    await t.advance(1000);
    t.s.music.matchStart();
    await t.advance(5000);
    nearEnd(t, 1);
    await t.advance(2000);
    t.s.music.suspend();
    await t.advance(30_000);
    t.s.music.restore();
    await t.advance(110_000); // a new silence, then the pass
    expect(urls(t, t.P.match!.mid as readonly number[])).toContain(t.s.music.track);
  });

  it("the match ends during a silence: the music comes back at once; leaving or muting cancels a pending pass", async () => {
    const t = await playlist();
    t.s.music.want(true);
    await t.advance(500);
    t.s.music.setRepeat(false);
    nearEnd(t, 0.5);
    await t.advance(1500);
    expect(t.s.music.playing).toBe(false);
    t.s.music.setRepeat(true); // the ending's sounds are over
    await t.advance(500);
    expect(t.s.music.playing).toBe(true);
    // Silence again, then the music is no longer wanted (test page): nothing comes later.
    t.s.music.setRepeat(false);
    nearEnd(t, 0.5);
    await t.advance(1500);
    t.s.music.want(false);
    await t.advance(70_000);
    expect(t.s.music.playing).toBe(false);
  });

  it("hidden during a silence: no pass starts while hidden; back in front, a new silence then the next pass", async () => {
    const t = await playlist(() => 0.5); // the silence is then 105 s
    t.s.music.want(true);
    await t.advance(500);
    t.s.music.setRepeat(false);
    nearEnd(t, 0.5);
    await t.advance(1500);
    t.s.setSuppressed(true);
    await t.advance(70_000);
    expect(t.s.music.playing).toBe(false);
    t.s.setSuppressed(false);
    await t.advance(500);
    expect(t.s.music.playing).toBe(false); // not at once: a new silence
    await t.advance(110_000);
    expect(t.s.music.playing).toBe(true);
  });
});

describe("zombies approaching (200 m) and the roar (100 m)", () => {
  const roars = (t: ReturnType<typeof setup>) => t.ctx.sources.filter((x) => x.buffer?.url === AUDIO.zombieNear).length;
  const warns = (t: ReturnType<typeof setup>) => t.m.radio.log.filter((l) => l === "zombiesApproaching").length;
  it("on foot and by bike: \"Zombies approaching!\" at 200 m, the roar at 100 m, each once per approach", async () => {
    for (const activity of ["walk", "mtb"] as const) {
      const t = setup();
      t.s.unlock();
      await run(t, 2, { activity, nearestM: 350 });
      expect([warns(t), roars(t)], activity).toEqual([0, 0]);
      await run(t, 3, { activity, nearestM: 190 });
      expect([warns(t), roars(t)], activity).toEqual([1, 0]); // the roar no longer comes at 200 m by bike
      await run(t, 3, { activity, nearestM: 150 });
      await run(t, 3, { activity, nearestM: 95 });
      expect([warns(t), roars(t)], activity).toEqual([1, 1]);
      for (let k = 0; k < 6; k++) await run(t, 1, { activity, nearestM: k % 2 ? 105 : 98 }); // jitter around 100 m
      expect(roars(t), activity).toBe(1);
    }
  });

  it("a zombie that appears inside 100 m gets the roar only; the warning is a recorded line (no synthetic voice)", async () => {
    const t = setup();
    t.s.unlock();
    await run(t, 1, { nearestM: 400 });
    await run(t, 1, { nearestM: 80 });
    expect([warns(t), roars(t)]).toEqual([0, 1]);
    expect(VOICE.zombiesApproaching.url).toBe("/audio/zombies-approaching.mp3");
  });

  it("cooldown: back within 200 m soon after does not repeat the warning; after the cooldown it does", async () => {
    const t = setup();
    t.s.unlock();
    await run(t, 1, { nearestM: 180 });
    await run(t, 2, { nearestM: 300 });
    await run(t, 1, { nearestM: 180 });
    expect(warns(t)).toBe(1);
    await run(t, SOUND_RULES.approach.cooldownS, { nearestM: 300 });
    await run(t, 1, { nearestM: 180 });
    expect(warns(t)).toBe(2);
  });

  it("the jump scare is silent; sprint and contact have sounds: the roar (not twice in a row), the warning sting with a cooldown", async () => {
    const t = setup();
    t.s.unlock();
    t.m.update(base());
    const n = (url: string) => t.ctx.sources.filter((x) => x.buffer?.url === url).length;
    const jumps = () => AUDIO.jump.reduce((a, u) => a + n(u), 0);
    expect(await t.m.onEvent({ type: "jump", stale: false })).toBeNull();
    expect(jumps()).toBe(0);
    // Sprint: the roar; a second sprint right after it is not another roar.
    expect(await t.m.onEvent({ type: "sprint", stale: false })).toBe("played");
    expect(await t.m.onEvent({ type: "sprint", stale: false })).toBe("suppressed");
    expect(n(AUDIO.zombieNear)).toBe(1);
    await run(t, SOUND_RULES.sprint.afterRoarS + 1);
    expect(await t.m.onEvent({ type: "sprint", stale: false })).toBe("played");
    // Contact: the sting, at most once per cooldown.
    expect(await t.m.onEvent({ type: "contact", stale: false })).toBe("played");
    expect(await t.m.onEvent({ type: "contact", stale: false })).toBe("suppressed");
    expect(n(AUDIO.revealed)).toBe(1);
  });
});
