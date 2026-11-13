import { describe, expect, it } from "vitest";
import { Soundscape, type Levels } from "@/audio/soundscape";
import { AUDIO, DUCK, MIX, MatchAudio, type MatchSoundInput } from "@/app/_client/audio";
import { SOUND_RULES } from "@/play/sound-rules";
import { fakeEnv, flush, type FakeGain } from "./audio-fakes";

// What the soundscape starts, stops and schedules, on a fake Web Audio clock. This is not a listening test.
const DUR: Record<string, number> = {
  ...Object.fromEntries(AUDIO.threat.map((u) => [u, 15])),
  [AUDIO.heliLoop]: 30, [AUDIO.heliApproach]: 25, [AUDIO.heliSuccess]: 7, [AUDIO.captured]: 4, [AUDIO.safeDoor]: 5,
  [AUDIO.zombieNear]: 3, [AUDIO.revealed]: 2, [AUDIO.checkpoint]: 2, [AUDIO.radio]: 0.49,
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
    await t.advance(8200);
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
  it("starts at the first tap, skips the leading silence, fades in, and never restarts while wanted", async () => {
    const t = setup();
    await t.s.music.prefetch();
    t.s.music.want(true);
    expect(t.media.filter((m) => m.plays > 0)).toHaveLength(0); // no tap yet
    t.s.unlock();
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
    expect(urlsLive(t.ctx)).toEqual([AUDIO.heliSuccess]);
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
      expect(urlsLive(t.ctx), `${result}/${mode}`).toEqual(url ? [url] : []);
    }
  });

  it("checkpoint and position revealed: one sound per event, revealed with a cooldown; stale events (from the background) are silent", async () => {
    const t = setup();
    t.s.unlock();
    await run(t, 1);
    await t.m.onEvent({ type: "checkpoint", stale: false });
    await t.m.onEvent({ type: "checkpoint", stale: true });
    await t.m.onEvent({ type: "revealed", reason: "hunt", stale: false });
    await t.m.onEvent({ type: "revealed", reason: "exposed", stale: false }); // within the cooldown
    const n = (u: string) => t.ctx.sources.filter((x) => x.buffer?.url === u).length;
    expect([n(AUDIO.checkpoint), n(AUDIO.revealed)]).toEqual([1, 1]);
    await run(t, SOUND_RULES.revealed.cooldownS + 1);
    await t.m.onEvent({ type: "revealed", reason: "exposed", stale: false });
    expect(n(AUDIO.revealed)).toBe(2);
    // The result still sounds when the match ended while the app was away (the result screen shows now).
    await t.m.onEvent({ type: "finished", result: "infected", mode: "mission", stale: true });
    expect(n(AUDIO.captured)).toBe(1);
  });

  it("the revealed warning waits until the operator has spoken (the hunt begins with \"Game on\")", async () => {
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
    expect(t.m.state).toEqual({ threat: null, heliLoop: false, approach: false });
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
    await t.m.onEvent({ type: "checkpoint", stale: false }); // while hidden
    t.s.setSuppressed(false);
    t.m.setHidden(false);
    await t.advance(500);
    expect(t.ctx.sources.some((x) => x.buffer?.url === AUDIO.checkpoint)).toBe(false);
  });

  it("muted: no match sound at all", async () => {
    const t = setup({ on: false });
    t.s.unlock();
    await run(t, 10, { mode: "survival", phase: "extraction", nearestM: 50 });
    await t.m.onEvent({ type: "checkpoint", stale: false });
    await t.m.onEvent({ type: "finished", result: "infected", mode: "survival", stale: false });
    expect(t.ctx.sources).toHaveLength(0);
  });
});
