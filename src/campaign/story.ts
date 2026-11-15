/**
 * The story of one mission match: decides which radio lines are said, from what happens in the game. It only reads game events and a
 * few numbers the HUD already shows; it never changes the game. No DOM, no audio: the session hands its messages on as text (always)
 * and as a sound event (a recording when there is one).
 */
import type { GameEvent } from "@/engine/core/types";
import type { CampaignDef, MissionDef, StoryBeat } from "./types";

export interface RadioMessage {
  /** The beat's id (also its voice file's name). */
  id: string;
  campaignId: string;
  /** Call sign shown with the text. */
  speaker: string;
  text: string;
  /** Said as the match ends: it belongs to the ending (it may interrupt, and plays although the match is over). */
  final: boolean;
  /** An existing recorded line to play while this beat has no recording of its own. */
  fallbackVoice?: string;
}

/** What the story reads every second or so. */
export interface StoryTick {
  elapsedS: number;
  durationS: number;
  finished: boolean;
  /** Straight distance (m) to the active goal and from the match's start to it; null without a goal. */
  goalM: number | null;
  goalFromStartM: number | null;
}

export class MissionStory {
  private readonly said = new Map<string, number>();
  private elapsedS = 0;

  /**
   * `resumedAtS`: the match is being restored at this game time. Lines whose moment has passed (the opening, timed lines, the first
   * hunt) are not said again; a restored match is paused, and what the player needs is what happens next.
   */
  constructor(private readonly campaign: CampaignDef, private readonly mission: MissionDef, private readonly durationS: number, resumedAtS?: number) {
    if (resumedAtS === undefined || resumedAtS < 0.5) return;
    this.elapsedS = resumedAtS;
    for (const b of mission.beats) {
      const t = b.trigger;
      if (t.on === "start" || t.on === "hunt") this.said.set(b.id, resumedAtS);
      else if (t.on === "time" && this.timeOf(t) <= resumedAtS) this.said.set(b.id, resumedAtS);
    }
  }

  private timeOf(t: Extract<StoryBeat["trigger"], { on: "time" }>): number {
    if (t.atS !== undefined) return t.atS;
    if (t.atFrac !== undefined) return t.atFrac * this.durationS;
    if (t.beforeEndS !== undefined) return this.durationS - t.beforeEndS;
    return Infinity;
  }

  private take(match: (b: StoryBeat) => boolean, final = false): RadioMessage[] {
    const out: RadioMessage[] = [];
    for (const b of this.mission.beats) {
      if (!match(b)) continue;
      const last = this.said.get(b.id);
      if (last !== undefined && (b.repeatAfterS === undefined || this.elapsedS - last < b.repeatAfterS)) continue;
      this.said.set(b.id, this.elapsedS);
      const speaker = this.campaign.speakers.find((s) => s.id === b.speaker)?.name ?? b.speaker.toUpperCase();
      out.push({ id: b.id, campaignId: this.campaign.id, speaker, text: b.text, final, fallbackVoice: b.fallbackVoice });
    }
    return out;
  }

  /** The match really begins (never for a restored match). */
  start(): RadioMessage[] {
    return this.take((b) => b.trigger.on === "start");
  }

  /** The helicopter is about a minute out (the session decides when, with its card). */
  heliInbound(): RadioMessage[] {
    return this.take((b) => b.trigger.on === "heli_inbound");
  }

  /**
   * Game events of one engine tick. `goals`: how many goals the mission has in this match (to tell the first, the last and those in
   * between). Lines said on the tick the match ends are part of the ending.
   */
  onEvents(events: readonly GameEvent[], elapsedS: number, goals: number): RadioMessage[] {
    this.elapsedS = elapsedS;
    const ending = events.some((e) => e.type === "finished");
    const out: RadioMessage[] = [];
    for (const e of events) {
      switch (e.type) {
        case "zombie_detected": out.push(...this.take((b) => b.trigger.on === "hunt")); break;
        case "infection_contact": out.push(...this.take((b) => b.trigger.on === "contact")); break;
        case "zombie_intercept": out.push(...this.take((b) => b.trigger.on === "intercept")); break;
        case "extraction_opened": out.push(...this.take((b) => b.trigger.on === "heli_landed")); break;
        case "objective_hold": out.push(...this.take((b) => b.trigger.on === "transmit" && b.trigger.change === e.change)); break;
        case "objective_reached": {
          const which = e.index >= goals - 1 ? "last" : e.index === 0 ? "first" : "middle";
          out.push(...this.take((b) => b.trigger.on === "objective" && b.trigger.which === which, ending));
          break;
        }
        case "finished":
          out.push(...this.take((b) => b.trigger.on === "end" && b.trigger.result === e.result, true));
          break;
        default: break;
      }
    }
    return out;
  }

  /** Timed lines and lines about the distance to the goal. Nothing is said once the match is over. */
  onTick(t: StoryTick): RadioMessage[] {
    this.elapsedS = t.elapsedS;
    if (t.finished) return [];
    return this.take((b) => {
      const g = b.trigger;
      if (g.on === "time") return t.elapsedS >= this.timeOf(g);
      if (g.on !== "goal" || t.goalM === null) return false;
      if (g.withinM !== undefined) return t.goalM <= g.withinM;
      if (g.covered !== undefined && t.goalFromStartM) return 1 - t.goalM / t.goalFromStartM >= g.covered;
      return false;
    });
  }
}
