/**
 * Campaigns: a story told as a fixed sequence of missions. A campaign is data (this file's types); the game itself is the same engine
 * Free Play uses. A mission names a base mode (survival, checkpoints, A to B), how its goals are laid out, how the rules differ per
 * difficulty, and its story beats (radio lines and when they are said).
 *
 * This is deliberately small: enough for THE FALL and for adding another campaign as one more definition file, not a general platform.
 */
import type { Difficulty } from "@/config/difficulty";
import type { GameMode } from "@/engine/objectives/objectives";

export type ByDifficulty<T> = Record<Difficulty, T>;

/** Who speaks a radio line (shown with the text; one voice per speaker when the lines are recorded). */
export interface Speaker {
  id: string;
  /** Call sign as shown on screen, e.g. "WATCHTOWER". */
  name: string;
  /** Direction for the voice recording (who they are, how they talk). Never shown in the game. */
  voice: string;
}

/** When a story beat is said. Every beat is said at most once per match unless it has `repeatAfterS`. */
export type Trigger =
  /** The match really begins. */
  | { on: "start" }
  /** Game clock: seconds from the start, a share of the time limit (0–1), or seconds before the time limit. */
  | { on: "time"; atS?: number; atFrac?: number; beforeEndS?: number }
  /** The first time the infected have the player's position. */
  | { on: "hunt" }
  /** The first time an infected is on the player (the infection timer counts). */
  | { on: "contact" }
  /** The first time an infected stops following and cuts ahead. */
  | { on: "intercept" }
  /** A goal is confirmed: the first, the last, or any in between. */
  | { on: "objective"; which: "first" | "middle" | "last" }
  /** A signal transmission begins, pauses (the player left the zone) or resumes. */
  | { on: "transmit"; change: "started" | "paused" | "resumed" }
  /** The active goal is this near (m), or the player has covered this share (0–1) of the straight distance from the start to it. */
  | { on: "goal"; withinM?: number; covered?: number }
  /** The helicopter is about a minute out / has landed (extraction is open). */
  | { on: "heli_inbound" }
  | { on: "heli_landed" }
  /** The match is over. */
  | { on: "end"; result: "survived" | "infected" | "failed" };

export interface StoryBeat {
  /** Also the name of the voice file: /campaign/<campaign>/voice/<id>.mp3. Never reuse or rename an id once it has been recorded. */
  id: string;
  speaker: string;
  /** What is said, in English. Short: it is also shown on screen while the player is moving. */
  text: string;
  trigger: Trigger;
  /** May be said again after this many seconds (transmission paused/resumed). Missing = once per match. */
  repeatAfterS?: number;
  /** An existing recorded line of the game (a key of VOICE in app/_client/audio.ts) played until this beat has its own recording. */
  fallbackVoice?: string;
}

/** How a mission's rules differ from the base mode, per difficulty. Zombie speed is a factor of the level's own base speed on foot. */
export interface MissionTuning {
  speed: number;
  zombies: ByDifficulty<{ initial: number; max: number }>;
  /** The population reaches its maximum at this share of the time limit (0–1). */
  growthUntil: number;
  /** Share of the infected that may cut ahead of the player (interception model "track"). */
  interceptShare: ByDifficulty<number>;
  /** The director: zombie speed factor from a share of the time limit onwards (steps). */
  intensity?: { atFrac: number; speed: number }[];
  /** The first infected are placed around the goals instead of anywhere, and may start this near the player (m). */
  spreadStart?: { minDistanceM: number };
}

export type MissionLayout =
  /** Stay alive for the whole time; time running out is the win. */
  | { kind: "survive"; durationS: number }
  /** Stay alive until the helicopter lands at `extractionAtS`, then reach it before `durationS`. */
  | { kind: "extraction"; durationS: number; extractionAtS: number; rushFactor: number }
  /** `count` goals around the player; `courseLengthM` is the length the course generator aims for (a ring through the start). */
  | { kind: "checkpoints"; count: number; minCount: number; courseLengthM: number; anyOrder: boolean; transmit?: MissionTransmit }
  /** One destination about `routeLengthM` away along the network. */
  | { kind: "destination"; routeLengthM: number };

/** Signal transmission: every goal is a zone to stay in while the signal is established. */
export interface MissionTransmit {
  /** Seconds in the zone per goal; the last goal may need longer. */
  holdS: ByDifficulty<number>;
  lastHoldS: ByDifficulty<number>;
  /** Zone radius (m). Large enough for GPS noise and for the player to keep moving inside it. */
  radiusM: ByDifficulty<number>;
  /** Extra infected drawn to the area each time a transmission begins. */
  spawn: ByDifficulty<number>;
}

export interface MissionDef {
  /** Stable id within the campaign ("01" … ), used in saved progress and URLs. */
  id: string;
  title: string;
  /** One line under the title (the theme). */
  tagline: string;
  /** The engine mode this mission runs on. */
  mode: GameMode;
  layout: MissionLayout;
  tuning: MissionTuning;
  /** About how long a play-through takes, for the briefing (minutes). */
  aboutMin: number;
  /** Picture for the card and the intro. */
  image: string;
  /** Where the picture's subject sits (CSS object-position). */
  imagePosition?: string;
  /** The cinematic intro: a few short lines shown one after another. */
  intro: string[];
  /** The mission's goal in one sentence (briefing and the card over the map as the match begins). */
  objective: string;
  /** Short goal label for the game HUD. */
  hud: string;
  /** How a win is staged: helicopter (picture and sound), safe house (door), or nothing but the radio. */
  ending: "heli" | "safehouse" | "plain";
  /** Result dialog: one line for a win, and what comes next in the story. */
  success: string;
  beats: StoryBeat[];
}

export interface CampaignDef {
  id: string;
  title: string;
  /** Cover artwork (campaign list and campaign header). */
  cover: string;
  coverPosition?: string;
  description: string;
  speakers: Speaker[];
  missions: MissionDef[];
  /** Shown when the last mission is won. */
  epilogue: { title: string; lines: string[] };
}

/** Marks a match as a campaign mission (kept with the match's parameters, so a restored match gets the same rules and story). */
export interface CampaignRef {
  id: string;
  mission: string;
}
