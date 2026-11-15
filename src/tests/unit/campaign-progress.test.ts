import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAMPAIGNS, findCampaign, findMission } from "@/campaign";
import {
  canPlay, completedCount, isCampaignComplete, loadProgress, markIntroSeen, missionStatus, newProgress, nextMission, progressKey, recordResult,
  recordStart, saveProgress, setDifficulty,
} from "@/campaign/progress";
import { THE_FALL } from "@/campaign/the-fall";
import { RECORDED_BEATS } from "@/campaign/voice-manifest";
import { VOICE } from "@/app/_client/audio";

const c = THE_FALL;
function memory(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
}
const win = (p = newProgress(c), id: string, s = 600) => recordResult(c, p, id, "survived", s, 1000).progress;

describe("THE FALL: the campaign as data", () => {
  it("is the one campaign offered, with five missions in the story's order", () => {
    expect(CAMPAIGNS.map((x) => x.id)).toEqual(["the-fall"]);
    expect(c.missions.map((m) => m.title)).toEqual(["FIRST CONTACT", "THE SUPPLY RUN", "NO WAY BACK", "THE LAST SIGNAL", "FINAL EXTRACTION"]);
    expect(c.missions.map((m) => m.mode)).toEqual(["survival", "mission", "escape", "mission", "survival"]);
    expect(c.missions.map((m) => m.aboutMin)).toEqual([15, 20, 20, 25, 30]);
    expect(findCampaign("the-fall")).toBe(c);
    expect(findCampaign("nope")).toBeNull();
    expect(findMission({ id: "the-fall", mission: "03" })?.mission.title).toBe("NO WAY BACK");
    expect(findMission({ id: "the-fall", mission: "99" })).toBeNull();
    expect(findMission(undefined)).toBeNull();
  });

  it("has a picture for the cover and for every mission, in the repository", () => {
    const pub = path.join(import.meta.dirname, "..", "..", "..", "public");
    expect(existsSync(path.join(pub, c.cover))).toBe(true);
    c.missions.forEach((m, i) => {
      expect(m.image).toBe(`/campaign/the-fall/mission-0${i + 1}.jpg`);
      expect(existsSync(path.join(pub, m.image))).toBe(true);
    });
  });

  it("every mission has an intro, a goal, an opening line and a line for each way it can end", () => {
    for (const m of c.missions) {
      expect(m.intro.length).toBeGreaterThanOrEqual(2);
      expect(m.objective.length).toBeGreaterThan(20);
      expect(m.beats.filter((b) => b.trigger.on === "start")).toHaveLength(1);
      // A win is told either as the match ends or as the last goal is confirmed.
      expect(m.beats.some((b) => (b.trigger.on === "end" && b.trigger.result === "survived") || (b.trigger.on === "objective" && b.trigger.which === "last"))).toBe(true);
      expect(m.beats.some((b) => b.trigger.on === "end" && b.trigger.result === "infected")).toBe(true);
      // Mission 01 cannot run out of time (the clock running down is the win).
      if (m.layout.kind !== "survive") expect(m.beats.some((b) => b.trigger.on === "end" && b.trigger.result === "failed")).toBe(true);
    }
  });

  it("radio lines: unique permanent ids, known speakers, short enough to read on the move, stand-ins that exist", () => {
    const ids = c.missions.flatMap((m) => m.beats.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of c.missions) for (const b of m.beats) {
      expect(b.id).toMatch(new RegExp(`^tf-m${m.id}-[a-z0-9-]+$`));
      expect(c.speakers.some((s) => s.id === b.speaker)).toBe(true);
      expect(b.text.split(/\s+/).length).toBeLessThanOrEqual(40);
      if (b.fallbackVoice) expect(Object.keys(VOICE)).toContain(b.fallbackVoice);
    }
    // Only beats that exist may be listed as recorded.
    for (const id of RECORDED_BEATS["the-fall"]) expect(ids).toContain(id);
  });
});

describe("campaign progress: unlocking, failure, replay", () => {
  it("a new campaign: Normal, nothing done, only the first mission open", () => {
    const p = newProgress(c);
    expect(p.difficulty).toBe("normal");
    expect(p.started).toBe(false);
    expect(c.missions.map((m) => missionStatus(c, p, m.id))).toEqual(["next", "locked", "locked", "locked", "locked"]);
    expect(nextMission(c, p)).toBe("01");
    expect(canPlay(c, p, "02")).toBe(false);
    expect(missionStatus(c, p, "nope")).toBe("locked");
  });

  it("winning a mission unlocks the next one, and only that", () => {
    const out = recordResult(c, newProgress(c), "01", "survived", 900, 5000);
    expect(out.firstCompletion).toBe(true);
    expect(out.campaignCompleted).toBe(false);
    expect(out.nextMissionId).toBe("02");
    expect(c.missions.map((m) => missionStatus(c, out.progress, m.id))).toEqual(["completed", "next", "locked", "locked", "locked"]);
    expect(out.progress.missions["01"]).toMatchObject({ completed: true, completedAt: 5000, bestTimeS: 900 });
  });

  it("capture and out of time fail the attempt only: nothing earlier is lost and the mission stays open", () => {
    let p = win(undefined, "01");
    for (const r of ["infected", "failed"] as const) {
      const out = recordResult(c, p, "02", r, 300, 1);
      expect(out.firstCompletion).toBe(false);
      p = out.progress;
    }
    expect(p.missions["02"]).toMatchObject({ completed: false, failures: 2 });
    expect(p.missions["01"].completed).toBe(true);
    expect(missionStatus(c, p, "02")).toBe("next");
    expect(missionStatus(c, p, "03")).toBe("locked");
  });

  it("quitting or an incomplete match changes nothing", () => {
    const p = win(undefined, "01");
    expect(recordResult(c, p, "02", "aborted", 100, 1).progress).toBe(p);
    expect(recordResult(c, p, "02", "incomplete", 100, 1).progress).toBe(p);
  });

  it("replaying a finished mission never takes progress away, whatever happens in the replay", () => {
    let p = win(win(undefined, "01", 700), "02");
    const at = p.missions["01"].completedAt;
    for (const r of ["infected", "failed", "aborted"] as const) p = recordResult(c, p, "01", r, 50, 9999).progress;
    expect(p.missions["01"].completed).toBe(true);
    expect(missionStatus(c, p, "03")).toBe("next");
    // A slower win keeps the best time and the first date; a faster one improves the time.
    const slower = recordResult(c, p, "01", "survived", 800, 9999);
    expect(slower.firstCompletion).toBe(false);
    expect(slower.progress.missions["01"]).toMatchObject({ bestTimeS: 700, completedAt: at });
    expect(recordResult(c, p, "01", "survived", 650, 9999).progress.missions["01"].bestTimeS).toBe(650);
  });

  it("a win of a locked mission (edited storage, stale saved match) does not skip ahead", () => {
    const p = newProgress(c);
    const out = recordResult(c, p, "04", "survived", 100, 1);
    expect(out.progress).toBe(p);
    expect(missionStatus(c, out.progress, "04")).toBe("locked");
  });

  it("the last win completes the campaign, once", () => {
    let p = newProgress(c);
    for (const id of ["01", "02", "03", "04"]) p = win(p, id);
    expect(isCampaignComplete(c, p)).toBe(false);
    const out = recordResult(c, p, "05", "survived", 1500, 7777);
    expect(out.campaignCompleted).toBe(true);
    expect(out.nextMissionId).toBeNull();
    expect(out.progress.completedAt).toBe(7777);
    expect(completedCount(c, out.progress)).toBe(5);
    expect(nextMission(c, out.progress)).toBeNull();
    // Winning it again is a replay, not a second completion.
    expect(recordResult(c, out.progress, "05", "survived", 1400, 8888)).toMatchObject({ campaignCompleted: false, firstCompletion: false });
    expect(recordResult(c, out.progress, "05", "survived", 1400, 8888).progress.completedAt).toBe(7777);
  });

  it("difficulty: any level at any time, saved, and it never changes what is open or done", () => {
    let p = win(win(undefined, "01"), "02");
    for (const d of ["easy", "hard", "normal"] as const) {
      p = setDifficulty(p, d);
      expect(p.difficulty).toBe(d);
      expect(p.started).toBe(true);
      expect(c.missions.map((m) => missionStatus(c, p, m.id))).toEqual(["completed", "completed", "next", "locked", "locked"]);
    }
    // Completing on Easy unlocks exactly what completing on Hard does.
    const easy = recordResult(c, setDifficulty(newProgress(c), "easy"), "01", "survived", 1, 1).progress;
    const hard = recordResult(c, setDifficulty(newProgress(c), "hard"), "01", "survived", 1, 1).progress;
    expect(c.missions.map((m) => missionStatus(c, easy, m.id))).toEqual(c.missions.map((m) => missionStatus(c, hard, m.id)));
  });

  it("starting a mission counts the attempt and marks its intro as seen", () => {
    const p = recordStart(newProgress(c), "01");
    expect(p.started).toBe(true);
    expect(p.missions["01"]).toMatchObject({ attempts: 1, introSeen: true, completed: false });
    expect(markIntroSeen(p, "01")).toBe(p);
    expect(markIntroSeen(p, "02").missions["02"].introSeen).toBe(true);
  });
});

describe("campaign progress: kept on the device", () => {
  it("is saved under the campaign's own key and read back unchanged", () => {
    const store = memory();
    const p = setDifficulty(win(recordStart(newProgress(c), "01"), "01", 812), "hard");
    expect(saveProgress(store, p)).toBe(true);
    expect([...store.raw.keys()]).toEqual([progressKey("the-fall")]);
    expect(loadProgress(store, c)).toEqual(p);
  });

  it("no storage, unreadable or foreign data: a new campaign, never a crash and never extra unlocks", () => {
    expect(loadProgress(null, c)).toEqual(newProgress(c));
    expect(saveProgress(null, newProgress(c))).toBe(false);
    for (const bad of ["{not json", "42", "null", "[]", JSON.stringify({ missions: "x", difficulty: "nightmare" })]) {
      const p = loadProgress(memory({ [progressKey(c.id)]: bad }), c);
      expect(p.difficulty).toBe("normal");
      expect(completedCount(c, p)).toBe(0);
      expect(nextMission(c, p)).toBe("01");
    }
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(loadProgress(throwing, c)).toEqual(newProgress(c));
    expect(saveProgress(throwing, newProgress(c))).toBe(false);
  });

  it("a later mission marked done in storage without the ones before it stays locked until they are done", () => {
    const raw = { v: 1, campaignId: c.id, difficulty: "easy", missions: { "03": { completed: true, attempts: 1 }, "zz": { completed: true } } };
    const p = loadProgress(memory({ [progressKey(c.id)]: JSON.stringify(raw) }), c);
    expect(p.difficulty).toBe("easy");
    expect(Object.keys(p.missions)).toEqual(["01", "02", "03", "04", "05"]);
    expect(nextMission(c, p)).toBe("01");
    expect(canPlay(c, p, "02")).toBe(false);
    expect(canPlay(c, p, "04")).toBe(false);
  });
});
