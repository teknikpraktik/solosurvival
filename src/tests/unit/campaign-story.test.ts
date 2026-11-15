import { describe, expect, it } from "vitest";
import { MissionStory } from "@/campaign/story";
import { THE_FALL } from "@/campaign/the-fall";
import type { GameEvent } from "@/engine/core/types";
import { radioShowMs } from "@/play/session";

const c = THE_FALL;
const mission = (id: string) => c.missions.find((m) => m.id === id)!;
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const tick = (elapsedS: number, durationS: number, goalM: number | null = null, goalFromStartM: number | null = null, finished = false) => ({ elapsedS, durationS, goalM, goalFromStartM, finished });

describe("mission story: which radio line is said when", () => {
  it("mission 01: opening, timed lines once each at their moment, the last-minute call, the win", () => {
    const s = new MissionStory(c, mission("01"), 900);
    expect(ids(s.start())).toEqual(["tf-m01-start"]);
    expect(s.start()).toEqual([]);
    expect(s.onTick(tick(10, 900))).toEqual([]);
    expect(ids(s.onTick(tick(50, 900)))).toEqual(["tf-m01-signal"]);
    expect(s.onTick(tick(51, 900))).toEqual([]);
    expect(ids(s.onTick(tick(360, 900)))).toEqual(["tf-m01-spread"]);
    expect(ids(s.onTick(tick(675, 900)))).toEqual(["tf-m01-survivors"]);
    expect(ids(s.onTick(tick(840, 900)))).toEqual(["tf-m01-minute"]);
    const end = s.onEvents([{ type: "finished", result: "survived" }], 900, 0);
    expect(end).toMatchObject([{ id: "tf-m01-win", final: true, speaker: "WATCHTOWER", campaignId: "the-fall", fallbackVoice: undefined }]);
  });

  it("the hunt and the contact line are said the first time only", () => {
    const s = new MissionStory(c, mission("01"), 900);
    const hunt: GameEvent[] = [{ type: "zombie_detected", zombieId: "z0" }, { type: "zombie_detected", zombieId: "z1" }];
    expect(ids(s.onEvents(hunt, 5, 0))).toEqual(["tf-m01-hunt"]);
    expect(s.onEvents(hunt, 60, 0)).toEqual([]);
    expect(ids(s.onEvents([{ type: "infection_contact" }], 70, 0))).toEqual(["tf-m01-contact"]);
    expect(s.onEvents([{ type: "infection_contact" }], 200, 0)).toEqual([]);
    expect(ids(s.onEvents([{ type: "finished", result: "infected" }], 210, 0))).toEqual(["tf-m01-caught"]);
  });

  it("mission 02: first, middle and last goal; the last one is the ending", () => {
    const s = new MissionStory(c, mission("02"), 1800);
    expect(s.onEvents([{ type: "objective_reached", targetId: "C2", index: 0 }], 300, 3)).toMatchObject([{ id: "tf-m02-first", final: false, fallbackVoice: "checkpointSecured" }]);
    expect(ids(s.onEvents([{ type: "objective_reached", targetId: "C1", index: 1 }], 600, 3))).toEqual(["tf-m02-middle"]);
    const end = s.onEvents([{ type: "objective_reached", targetId: "C3", index: 2 }, { type: "finished", result: "survived" }], 900, 3);
    expect(end).toMatchObject([{ id: "tf-m02-win", final: true }]);
  });

  it("with two goals (a small network) the story still has a first and a last", () => {
    const s = new MissionStory(c, mission("02"), 1800);
    expect(ids(s.onEvents([{ type: "objective_reached", targetId: "C1", index: 0 }], 300, 2))).toEqual(["tf-m02-first"]);
    expect(ids(s.onEvents([{ type: "objective_reached", targetId: "C2", index: 1 }, { type: "finished", result: "survived" }], 600, 2))).toEqual(["tf-m02-win"]);
  });

  it("mission 03: the interception warning once, halfway and 200 m from the distance to the goal", () => {
    const s = new MissionStory(c, mission("03"), 1500);
    expect(ids(s.onEvents([{ type: "zombie_intercept", zombieId: "z3" }], 100, 1))).toEqual(["tf-m03-intercept"]);
    expect(s.onEvents([{ type: "zombie_intercept", zombieId: "z4" }], 130, 1)).toEqual([]);
    expect(s.onTick(tick(200, 1500, 800, 1000))).toEqual([]);
    expect(ids(s.onTick(tick(400, 1500, 500, 1000)))).toEqual(["tf-m03-half"]);
    expect(ids(s.onTick(tick(700, 1500, 190, 1000)))).toEqual(["tf-m03-near"]);
    expect(s.onTick(tick(701, 1500, 150, 1000))).toEqual([]);
    expect(s.onEvents([{ type: "finished", result: "failed" }], 1500, 1)).toMatchObject([{ id: "tf-m03-late-fail", final: true }]);
  });

  it("mission 04: transmission lines may repeat, but not while the signal flickers at the zone's edge", () => {
    const s = new MissionStory(c, mission("04"), 2000);
    const hold = (change: "started" | "paused" | "resumed", t: number) => ids(s.onEvents([{ type: "objective_hold", targetId: "C1", change }], t, 3));
    expect(hold("started", 100)).toEqual(["tf-m04-tx-start"]);
    expect(hold("paused", 105)).toEqual(["tf-m04-tx-paused"]);
    expect(hold("resumed", 108)).toEqual(["tf-m04-tx-resumed"]);
    expect(hold("paused", 110)).toEqual([]);
    expect(hold("resumed", 112)).toEqual([]);
    expect(hold("paused", 130)).toEqual(["tf-m04-tx-paused"]);
    // The next relay's transmission is announced again.
    expect(hold("started", 400)).toEqual(["tf-m04-tx-start"]);
    // The last relay: Watchtower, then the helicopter answers; both belong to the ending, in that order.
    const end = s.onEvents([{ type: "objective_reached", targetId: "C3", index: 2 }, { type: "finished", result: "survived" }], 900, 3);
    expect(end.map((m) => [m.id, m.speaker, m.final])).toEqual([["tf-m04-win", "WATCHTOWER", true], ["tf-m04-raven", "RAVEN TWO", true]]);
  });

  it("mission 05: helicopter inbound and landed, each once", () => {
    const s = new MissionStory(c, mission("05"), 1800);
    expect(s.heliInbound()).toMatchObject([{ id: "tf-m05-inbound", speaker: "RAVEN TWO", fallbackVoice: "rescueInbound" }]);
    expect(s.heliInbound()).toEqual([]);
    expect(ids(s.onEvents([{ type: "extraction_opened", nodeId: "n1" }], 1320, 0))).toEqual(["tf-m05-landed"]);
    expect(ids(s.onTick(tick(1680, 1800)))).toContain("tf-m05-two-min");
  });

  it("nothing timed is said once the match is over", () => {
    const s = new MissionStory(c, mission("01"), 900);
    expect(s.onTick(tick(900, 900, null, null, true))).toEqual([]);
  });

  it("a restored match does not repeat the opening, the hunt or timed lines whose moment has passed", () => {
    const s = new MissionStory(c, mission("01"), 900, 400);
    expect(s.start()).toEqual([]);
    expect(s.onEvents([{ type: "zombie_detected", zombieId: "z0" }], 401, 0)).toEqual([]);
    expect(s.onTick(tick(402, 900))).toEqual([]);
    expect(ids(s.onTick(tick(675, 900)))).toEqual(["tf-m01-survivors"]);
    // The contact warning is about now, so it is still said.
    expect(ids(s.onEvents([{ type: "infection_contact" }], 700, 0))).toEqual(["tf-m01-contact"]);
  });

  it("a line stays on screen long enough to read, within limits", () => {
    expect(radioShowMs("Too close!")).toBe(4500);
    expect(radioShowMs(Array(60).fill("word").join(" "))).toBe(12_000);
    const mid = radioShowMs("First site cleared. Good. Two to go.");
    expect(mid).toBeGreaterThanOrEqual(4500);
    expect(mid).toBeLessThan(8000);
  });
});
