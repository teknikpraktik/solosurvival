import { describe, expect, it, vi } from "vitest";
import { Soundscape, type Levels } from "@/audio/soundscape";
import { AUDIO, DUCK, MIX, MatchAudio, VOICE } from "@/app/_client/audio";
import { beatVoiceUrl } from "@/campaign";
import type { SoundEvent } from "@/play/session";
import { fakeEnv, flush } from "./audio-fakes";

// The tests decide which lines count as recorded (one of them), so they do not depend on which voice files exist in the repository.
vi.mock("@/campaign/voice-manifest", () => ({ RECORDED_BEATS: { "the-fall": ["tf-m05-landed"] } }));

// What the soundscape starts for campaign radio lines, on a fake Web Audio clock. This is not a listening test.
const CLIP_A = beatVoiceUrl("the-fall", "tf-m04-win"), CLIP_B = beatVoiceUrl("the-fall", "tf-m04-raven"), CLIP_REC = beatVoiceUrl("the-fall", "tf-m05-landed");
const DUR: Record<string, number> = {
  [AUDIO.checkpoint]: 2, [AUDIO.heliApproach]: 25, [AUDIO.heliSuccess]: 7, [AUDIO.safeDoor]: 5, [AUDIO.captured]: 4,
  [VOICE.keepMoving.url]: 8, [VOICE.checkpointSecured.url]: 5, [VOICE.checkpointStart.url]: 8, [VOICE.rescueInbound.url]: 6, [VOICE.getToHelicopter.url]: 7,
  [VOICE.liftingOff.url]: 5, [VOICE.insideSafehouse.url]: 7, [VOICE.safehouseOnMap.url]: 8, [CLIP_A]: 6, [CLIP_B]: 5, [CLIP_REC]: 6,
};
function setup() {
  const f = fakeEnv(DUR);
  const l: Levels = { on: true, music: 1, fx: 1, voice: 1 };
  const s = new Soundscape(f.env, { mix: MIX, duckTo: DUCK.to, duckAttackS: DUCK.attackS, duckReleaseS: DUCK.releaseS, levels: () => l }, { url: AUDIO.music, startS: 0, endS: 100, crossfadeS: 3, fadeInS: 3, fadeOutS: 2 });
  const m = new MatchAudio(s, { nowS: () => f.nowMs() / 1000 }, () => 0.4);
  s.unlock();
  return { ...f, s, m };
}
const live = (t: ReturnType<typeof setup>) => t.ctx.live().map((x) => x.buffer?.url);
const line = (id: string, o: Partial<Extract<SoundEvent, { type: "story" }>> = {}): SoundEvent => ({ type: "story", id, campaignId: "the-fall", final: false, queue: false, stale: false, ...o });

describe("campaign radio lines in the soundscape", () => {
  it("a mission match does not get the mode's own opening line; Free Play still does", async () => {
    const t = setup();
    expect(await t.m.onEvent({ type: "match_started", id: "c1", mode: "survival", campaign: true })).toBeNull();
    await flush();
    expect(t.m.radio.speaking).toBeNull();
    expect(await t.m.onEvent({ type: "match_started", id: "f1", mode: "survival" })).toBe("played");
    expect(t.m.radio.speaking).toBe("keepMoving");
  });

  it("a recorded line plays its own file on the operator's channel, not its stand-in, and lowers the music while it plays", async () => {
    const t = setup();
    await t.m.onEvent({ type: "match_started", id: "c1", mode: "survival", campaign: true });
    expect(await t.m.onEvent(line("tf-m05-landed", { fallbackVoice: "getToHelicopter" }))).toBe("played");
    expect(live(t)).toEqual([CLIP_REC]);
    expect(t.m.radio.speaking).toBe("tf-m05-landed");
    expect(t.s.ducked).toBe(true);
    await t.advance(7000);
    expect(t.m.radio.speaking).toBeNull();
    expect(t.s.ducked).toBe(false);
  });

  it("a line without a recording plays its stand-in line when it has one", async () => {
    const t = setup();
    await t.m.onEvent({ type: "match_started", id: "c1", mode: "survival", campaign: true });
    expect(await t.m.onEvent(line("tf-m01-start", { fallbackVoice: "keepMoving" }))).toBe("played");
    expect(live(t)).toContain(VOICE.keepMoving.url);
    expect(t.s.ducked).toBe(true);
    await t.advance(9000);
    expect(t.s.ducked).toBe(false);
  });

  it("a line with neither gets a soft chime, so the player knows to glance at the text; nothing is ever fetched for it", async () => {
    const t = setup();
    await t.m.onEvent({ type: "match_started", id: "c1", mode: "survival", campaign: true });
    expect(await t.m.onEvent(line("tf-m01-signal"))).toBe("played");
    expect(live(t)).toEqual([AUDIO.checkpoint]);
    expect(t.m.radio.speaking).toBeNull();
    expect(t.s.ducked).toBe(false);
    // An unknown stand-in name is treated as none.
    expect(await t.m.onEvent(line("tf-m01-spread", { fallbackVoice: "noSuchLine" }))).toBe("played");
    expect(live(t).every((u) => u === AUDIO.checkpoint)).toBe(true);
  });

  it("nothing is said late: lines worked out after time away, and lines that come after the match has ended", async () => {
    const t = setup();
    await t.m.onEvent({ type: "match_started", id: "c1", mode: "survival", campaign: true });
    expect(await t.m.onEvent(line("tf-m01-signal", { stale: true }))).toBe("suppressed");
    t.m.setHidden(true);
    expect(await t.m.onEvent(line("tf-m01-signal"))).toBe("suppressed");
    t.m.setHidden(false);
    await t.m.onEvent({ type: "finished", result: "failed", mode: "survival", stale: false, campaign: true, ending: "plain" });
    expect(await t.m.onEvent(line("tf-m01-spread"))).toBe("suppressed");
    expect(live(t)).toEqual([]);
  });

  it("in a mission the checkpoint and helicopter lines of the mode are left to the story; the helicopter itself is still heard", async () => {
    const t = setup();
    await t.m.onEvent({ type: "match_started", id: "c1", mode: "survival", campaign: true });
    expect(await t.m.onEvent({ type: "checkpoint", last: false, stale: false, campaign: true })).toBeNull();
    expect(await t.m.onEvent({ type: "heli_landed", stale: false, campaign: true })).toBeNull();
    expect(await t.m.onEvent({ type: "heli_approach", stale: false, campaign: true })).toBe("played");
    await flush();
    expect(live(t)).toEqual([AUDIO.heliApproach]);
    expect(t.m.radio.speaking).toBeNull();
  });

  it("a mission's win sounds the way the mission ends: nothing, the door, or the helicopter, never the mode's win line", async () => {
    for (const [ending, url] of [["plain", null], ["safehouse", AUDIO.safeDoor], ["heli", AUDIO.heliSuccess]] as const) {
      const t = setup();
      await t.m.onEvent({ type: "match_started", id: "c1", mode: "survival", campaign: true });
      const r = await t.m.onEvent({ type: "finished", result: "survived", mode: "survival", stale: false, campaign: true, ending });
      await flush();
      expect(r).toBe(url ? "played" : null);
      expect(live(t)).toEqual(url ? [url] : []);
      expect(t.m.radio.speaking).toBeNull();
    }
    // Free Play Survival: unchanged.
    const f = setup();
    await f.m.onEvent({ type: "match_started", id: "f1", mode: "survival" });
    await f.advance(9000);
    await f.m.onEvent({ type: "finished", result: "survived", mode: "survival", stale: false });
    await flush();
    expect(live(f).sort()).toEqual([AUDIO.heliSuccess, VOICE.liftingOff.url].sort());
  });

  it("the ending's line is said although the match is over, and the music waits for it", async () => {
    const t = setup();
    await t.m.onEvent({ type: "match_started", id: "c1", mode: "survival", campaign: true });
    await t.m.onEvent({ type: "finished", result: "survived", mode: "survival", stale: false, campaign: true, ending: "heli" });
    expect(await t.m.onEvent(line("tf-m05-win", { final: true, fallbackVoice: "liftingOff" }))).toBe("played");
    expect(t.m.radio.speaking).toBe("liftingOff");
    await t.advance(1000);
    expect(t.m.endSequenceDone).toBe(false);
    await t.advance(8000);
    expect(t.m.endSequenceDone).toBe(true);
    // A capture: its own sound, and an ending line without a recording is text only (no chime over the capture).
    const c = setup();
    await c.m.onEvent({ type: "match_started", id: "c2", mode: "survival", campaign: true });
    await c.m.onEvent({ type: "finished", result: "infected", mode: "survival", stale: false, campaign: true, ending: "plain" });
    expect(await c.m.onEvent(line("tf-m01-caught", { final: true }))).toBeNull();
    await flush();
    expect(live(c)).toEqual([AUDIO.captured]);
  });

  it("recorded lines: one at a time, a queued line follows the one before it (also two ending lines), and a missing file leaves nothing hanging", async () => {
    const t = setup();
    const a = t.m.radio.sayClip("tf-m04-win", CLIP_A, { final: true });
    const b = t.m.radio.sayClip("tf-m04-raven", CLIP_B, { final: true, queue: true });
    await flush();
    expect(t.m.radio.speaking).toBe("tf-m04-win");
    expect(t.m.radio.queued).toBe("tf-m04-raven");
    expect(live(t)).toEqual([CLIP_A]);
    expect(await a).toBe("played");
    await t.advance(6500);
    expect(t.m.radio.speaking).toBe("tf-m04-raven");
    expect(live(t)).toEqual([CLIP_B]);
    expect(await b).toBe("played");
    await t.advance(6000);
    expect(t.m.radio.speaking).toBeNull();
    expect(t.s.ducked).toBe(false);
    expect(t.m.radio.log).toEqual(["tf-m04-win", "tf-m04-raven"]);
    // Without "queue" an ending line replaces what is playing (as before).
    void t.m.radio.sayClip("tf-m04-win", CLIP_A);
    await flush();
    void t.m.radio.sayClip("tf-m04-raven", CLIP_B, { final: true });
    await flush();
    expect(t.m.radio.speaking).toBe("tf-m04-raven");
    await t.advance(6000);
    expect(await t.m.radio.sayClip("tf-m02-first", "/campaign/the-fall/voice/missing.mp3")).toBe("missing");
    expect(t.s.ducked).toBe(false);
    expect(await t.m.radio.say("notALine")).toBe("missing");
    expect(t.m.radio.speaking).toBeNull();
  });
});
