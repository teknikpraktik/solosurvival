/**
 * The Story Bible's word-for-word quotes of THE FALL match the campaign definition, mission by mission and field by field. When the first
 * test fails, find out which side is wrong before changing anything (see CLAUDE.md): the code is what the game does, the Bible is what the
 * story decided. The other tests prove the check itself on a small made-up campaign, so real drift fails one test with a clear message.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THE_FALL } from "@/campaign/the-fall";
import type { CampaignDef, MissionDef, StoryBeat } from "@/campaign/types";
import { bibleQuotes, checkBibleQuotes, requiredRefs } from "./story-bible-quotes";

const FILE = "docs/OUTBREAK_STORY_BIBLE_V2_2.md";
const BIBLE = readFileSync(path.resolve(import.meta.dirname, "../../..", FILE), "utf8");

describe("Story Bible: implemented quotes of THE FALL match the code", () => {
  it("every marked quote equals its field, every required line is quoted, no quote in sections 7 and 11 is left unchecked", () => {
    expect(checkBibleQuotes(BIBLE, THE_FALL, FILE).map((p) => p.message)).toEqual([]);
  });

  it("the check covers what it should (guards against a check that silently checks nothing)", () => {
    const quoted = new Set(bibleQuotes(BIBLE).map((q) => q.ref));
    const required = requiredRefs(THE_FALL);
    // 5 missions × (3 intro lines + success) + 6 winning lines + epilogue title and 4 lines.
    expect(required.length).toBe(31);
    expect(required.filter((r) => !quoted.has(r))).toEqual([]);
  });
});

// ---- The check itself, on a made-up campaign and a made-up Bible ----

const beat = (id: string, trigger: StoryBeat["trigger"], text: string): StoryBeat => ({ id, speaker: "watchtower", trigger, text });
const missionDef = (id: string, title: string, intro: string[], success: string, beats: StoryBeat[]) =>
  ({ id, title, intro, success, objective: `Objective of ${title}.`, beats }) as unknown as MissionDef;

function campaign(): CampaignDef {
  return {
    id: "test", title: "TEST", cover: "", description: "", speakers: [],
    missions: [
      missionDef("01", "ALPHA", ["Alpha intro one.", "Alpha intro two."], "Alpha is done now.", [
        beat("t-01-start", { on: "start" }, "Start the alpha run."),
        beat("t-01-win", { on: "end", result: "survived" }, "You made it through alpha."),
      ]),
      missionDef("02", "BRAVO", ["Bravo intro one."], "Bravo is done now.", [beat("t-02-last", { on: "objective", which: "last" }, "That is all of bravo.")]),
    ],
    epilogue: { title: "TEST – DONE", lines: ["Epilogue line zero.", "Epilogue line one."] },
  };
}

const MD = `# Test bible

## 7. The thread

- Mission 1, success: <!--q:test/01.success-->*"Alpha is done now."*<!--/q-->

## 11. The campaign

- **Intro:** <!--q:test/01.intro.0-->"Alpha intro one."<!--/q--> / <!--q:test/01.intro.1-->"Alpha intro two."<!--/q-->
- **Radio:** <!--q:test/01.beat.t-01-start-->*"Start the alpha run."*<!--/q-->
- **End:** <!--q:test/01.beat.t-01-win-->*"You made it through alpha."*<!--/q-->
- **Success:** <!--q:test/01.success-->**"Alpha is done now."**<!--/q-->
- **Intro:** <!--q:test/02.intro.0-->"Bravo intro one."<!--/q-->
- **End:** <!--q:test/02.beat.t-02-last-->*"That is all of bravo."*<!--/q-->
- **Success:** <!--q:test/02.success-->"Bravo is done now."<!--/q--> The name "safe zone" is a word, not a quote.

> <!--q:test/epilogue.title-->**TEST – DONE**<!--/q-->
> <!--q:test/epilogue.0-->Epilogue line zero.<!--/q-->
> <!--q:test/epilogue.1-->Epilogue line one.<!--/q-->

## 12. Planned

- Not checked: "Planned lines are free text here."
`;

const check = (md = MD, c = campaign()) => checkBibleQuotes(md, c, "bible.md").map((p) => p.message);
const m01 = (c: CampaignDef) => c.missions[0];

describe("Story Bible check: it catches what it must", () => {
  it("passes when Bible and code agree (emphasis and quote marks around a quote are ignored)", () => {
    expect(check()).toEqual([]);
  });

  it("a line changed in the code: names the file line, the mission, the field and both texts, once per place it is quoted", () => {
    const c = campaign();
    m01(c).success = "Alpha is finished.";
    const m = check(MD, c);
    expect(m).toHaveLength(2); // quoted in section 7 and in section 11
    expect(m[0]).toBe('bible.md:5: TEST 01 ALPHA, success differs.\n  Story Bible: "Alpha is done now."\n  Code:        "Alpha is finished."');
  });

  it("a radio line, an intro line and an epilogue line changed in the code", () => {
    const c = campaign();
    m01(c).beats[1].text = "You made it.";
    m01(c).intro[1] = "Alpha intro 2.";
    c.epilogue.lines[1] = "Epilogue line 1.";
    const m = check(MD, c);
    expect(m).toHaveLength(3);
    expect(m.join("\n")).toContain("TEST 01 ALPHA, radio line t-01-win differs");
    expect(m.join("\n")).toContain("TEST 01 ALPHA, intro line 1 differs");
    expect(m.join("\n")).toContain("TEST epilogue line 1 differs");
  });

  it("a quote changed in the Bible, not in the code", () => {
    expect(check(MD.replace('"That is all of bravo."', '"That is all."'))).toEqual([
      'bible.md:14: TEST 02 BRAVO, radio line t-02-last differs.\n  Story Bible: "That is all."\n  Code:        "That is all of bravo."',
    ]);
  });

  it("a quote bound to the wrong mission is caught, although its text exists in the code", () => {
    const m = check(MD.replace("<!--q:test/02.success-->", "<!--q:test/01.success-->"));
    expect(m).toContainEqual(expect.stringContaining("TEST 01 ALPHA, success differs"));
    expect(m).toContainEqual(expect.stringContaining('TEST 02 BRAVO, success is not quoted (no <!--q:test/02.success--> marker): "Bravo is done now."'));
  });

  it("a radio line renamed or moved to another mission in the code does not pass silently", () => {
    const c = campaign();
    m01(c).beats[0].id = "t-01-go";
    expect(check(MD, c)).toEqual([expect.stringContaining('bible.md:10: TEST 01 ALPHA has no radio line "t-01-start" (renamed, removed or moved')]);
    const moved = campaign();
    moved.missions[1].beats.push(m01(moved).beats.shift()!);
    expect(check(MD, moved)).toContainEqual(expect.stringContaining('TEST 01 ALPHA has no radio line "t-01-start"'));
  });

  it("a line removed in the code does not pass silently", () => {
    const c = campaign();
    m01(c).intro.pop();
    c.epilogue.lines.pop();
    const m = check(MD, c);
    expect(m).toContainEqual(expect.stringContaining("TEST 01 ALPHA has no intro line 1 (it has 1)"));
    expect(m).toContainEqual(expect.stringContaining("TEST epilogue has no line 1 (it has 1)"));
  });

  it("a new intro line, winning line or epilogue line in the code must be quoted in the Bible", () => {
    const c = campaign();
    m01(c).intro.push("Alpha intro three.");
    c.missions[1].beats.push(beat("t-02-win", { on: "end", result: "survived" }, "Bravo won."));
    c.epilogue.lines.push("Epilogue line two.");
    expect(check(MD, c)).toEqual([
      'bible.md: TEST 01 ALPHA, intro line 2 is not quoted (no <!--q:test/01.intro.2--> marker): "Alpha intro three."',
      'bible.md: TEST 02 BRAVO, radio line t-02-win is not quoted (no <!--q:test/02.beat.t-02-win--> marker): "Bravo won."',
      'bible.md: TEST epilogue line 2 is not quoted (no <!--q:test/epilogue.2--> marker): "Epilogue line two."',
    ]);
  });

  it("a marker removed from the Bible: the required line is missing and the bare quote is unchecked", () => {
    const m = check(MD.replace('<!--q:test/02.beat.t-02-last-->*"That is all of bravo."*<!--/q-->', '*"That is all of bravo."*'));
    expect(m).toEqual([
      expect.stringContaining("TEST 02 BRAVO, radio line t-02-last is not quoted"),
      'bible.md:14: quote without a <!--q:…--> marker, so nothing checks it: "That is all of bravo."',
    ]);
  });

  it("a new quote or epilogue line in a checked section without a marker is reported; other sections and short words are not checked", () => {
    const md = MD.replace("- **Intro:** <!--q:test/02", '- **New:** "Start the bravo run."\n- **Intro:** <!--q:test/02')
      .replace("> <!--q:test/epilogue.1-->", "> An unmarked epilogue line.\n> <!--q:test/epilogue.1-->");
    expect(check(md)).toEqual([
      'bible.md:13: quote without a <!--q:…--> marker, so nothing checks it: "Start the bravo run."',
      "bible.md:20: quote without a <!--q:…--> marker, so nothing checks it: \"An unmarked epilogue line.\"",
    ]);
  });

  it("a marker written as an example in inline code is documentation, not a quote", () => {
    expect(check(MD.replace("## 7. The thread\n", "## 7. The thread\n\nMarkers look like `<!--q:test/01.success-->…<!--/q-->`.\n"))).toEqual([]);
  });

  it("broken markers, malformed or unknown refs and a missing section are reported", () => {
    expect(check(MD.replace("<!--/q-->", ""))).toContainEqual(expect.stringContaining("without a closing"));
    expect(check(MD.replace("<!--q:test/02.success-->", "<!--q:test/09.success-->"))).toContainEqual(expect.stringContaining('TEST has no mission "09"'));
    expect(check(MD.replace("<!--q:test/02.success-->", "<!--q:other/02.success-->"))).toContainEqual(expect.stringContaining("unknown campaign"));
    expect(check(MD.replace("<!--q:test/02.success-->", "<!--q:test/02.sucess-->"))).toContainEqual(expect.stringContaining('malformed ref "test/02.sucess"'));
    expect(check(MD.replace("## 7. ", "## 7b. "))).toContainEqual(expect.stringContaining('section "## 7." is missing'));
  });
});
