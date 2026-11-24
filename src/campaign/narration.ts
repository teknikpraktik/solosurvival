/**
 * The narrator: a man's voice that reads the screens between missions aloud. Two per mission, so the story can be listened to rather than
 * read:
 *   - briefing: before the mission (its name, the intro lines and the objective), on the one screen between the overview and the match;
 *   - debrief:  after a won mission (what the player achieved, and for the chapter's last mission the epilogue), on the result screen.
 *
 * The narrator is not on the radio: no call sign, no radio effect, and never during a match. The text read is built here from the mission
 * definition, word for word what the screens show, so a screen and its narration cannot drift apart. Files are
 * /campaign/<campaign>/narration/<id>.mp3 (scripts/campaign-voice-generate.ts); the game only asks for those in RECORDED_NARRATION.
 */
import type { CampaignDef, MissionDef } from "./types";

export type NarrationKind = "briefing" | "debrief";

export interface Narration {
  /** Also the file name. Changes only when the mission's id does. */
  id: string;
  kind: NarrationKind;
  /** What is read, in English. */
  text: string;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
/** "MISSION 01" read as "Mission one". */
const spokenNumber = (id: string) => NUMBER_WORDS[Number(id)] ?? id;
/** "FIRST CONTACT" read as a name, not spelled out letter by letter. */
const spokenTitle = (title: string) => title.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/** Short id prefix of a chapter's files ("the-fall" → "tf"), as the radio lines use. */
const prefix = (c: CampaignDef) => c.id.split("-").map((w) => w[0]).join("");

export function briefingNarration(c: CampaignDef, m: MissionDef): Narration {
  return {
    id: `${prefix(c)}-m${m.id}-briefing`,
    kind: "briefing",
    text: [`Mission ${spokenNumber(m.id)}. ${spokenTitle(m.title)}.`, ...m.intro, `Your objective. ${m.objective}`].join(" "),
  };
}

/** After a win. The chapter's last mission also reads the epilogue: the chapter ends on that screen. */
export function debriefNarration(c: CampaignDef, m: MissionDef): Narration {
  const last = c.missions[c.missions.length - 1]?.id === m.id;
  return {
    id: `${prefix(c)}-m${m.id}-debrief`,
    kind: "debrief",
    text: ["Mission complete.", m.success, ...(last ? c.epilogue.lines : [])].join(" "),
  };
}

/** Every narration of a chapter, in story order. */
export function chapterNarrations(c: CampaignDef): Narration[] {
  return c.missions.flatMap((m) => [briefingNarration(c, m), debriefNarration(c, m)]);
}

export const narrationUrl = (campaignId: string, id: string): string => `/campaign/${campaignId}/narration/${id}.mp3`;
