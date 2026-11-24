import { describe, expect, it } from "vitest";
import { CAMPAIGNS } from "@/campaign";
import { briefingNarration, chapterNarrations, debriefNarration, narrationUrl } from "@/campaign/narration";
import { THE_FALL } from "@/campaign/the-fall";
import { RECORDED_NARRATION } from "@/campaign/voice-manifest";

describe("narration between missions", () => {
  it("reads exactly what the briefing shows: the name, the story and the goal", () => {
    const m = THE_FALL.missions[0];
    const n = briefingNarration(THE_FALL, m);
    expect(n.id).toBe("tf-m01-briefing");
    expect(n.text.startsWith("Mission one. First Contact.")).toBe(true);
    for (const line of m.intro) expect(n.text).toContain(line);
    expect(n.text).toContain(m.objective);
  });

  it("reads what a win achieved, and the epilogue after the chapter's last mission only", () => {
    const first = debriefNarration(THE_FALL, THE_FALL.missions[0]);
    expect(first.text).toBe(`Mission complete. ${THE_FALL.missions[0].success}`);
    const last = debriefNarration(THE_FALL, THE_FALL.missions[4]);
    for (const line of THE_FALL.epilogue.lines) expect(last.text).toContain(line);
    expect(first.text).not.toContain(THE_FALL.epilogue.lines[0]);
  });

  it("has two reads per mission with unique ids, and every read of a chapter with a narrator is recorded", () => {
    for (const c of CAMPAIGNS) {
      const all = chapterNarrations(c);
      expect(all).toHaveLength(c.missions.length * 2);
      expect(new Set(all.map((n) => n.id)).size).toBe(all.length);
      if (c.narrator) expect([...(RECORDED_NARRATION[c.id] ?? [])].sort()).toEqual(all.map((n) => n.id).sort());
    }
    expect(narrationUrl("the-fall", "tf-m01-briefing")).toBe("/campaign/the-fall/narration/tf-m01-briefing.mp3");
  });
});
