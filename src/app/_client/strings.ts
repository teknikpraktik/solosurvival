import type { GameMode } from "@/engine/objectives/objectives";
import type { Difficulty } from "@/config/difficulty";

/**
 * User-visible UI strings, in one place so a second language (Swedish) can be added later: add a `sv: Strings` object and pick it in `t`.
 * Only the screens that have been moved here use it (New game, the in-game sound button); older screens still have their texts inline.
 * Game data and internal identifiers (mode ids, difficulty ids) are never translated.
 */
const en = {
  newGame: {
    title: "NEW GAME",
    steps: { setup: "Setup", preview: "Preview", start: "Start" },
    mode: "Mode",
    modeSubtitle: { mission: "Collect & return", escape: "Reach the target", survival: "Stay alive & escape" } satisfies Record<GameMode, string>,
    activity: "Activity",
    difficulty: "Difficulty",
    /** Difficulty line, built from the real rules: zombie speed, how many at most, and how they sprint. */
    difficultyLine: (d: Difficulty, kmh: string, maxZombies: number) =>
      `Zombies at ${kmh} km/h, up to ${maxZombies} at once${d === "easy" ? ", short sprints" : d === "hard" ? ", long and frequent sprints" : ""}.`,
    courseDistance: "Course distance",
    courseNote: "Straight-line distance. Your actual route is longer.",
    matchLength: "Match length",
    extractionNote: (min: number) => `Extraction opens after ${min} min. Reach it in time.`,
    short: "Short",
    long: "Long",
    destination: "Destination",
    pointA: "A",
    pointAValue: "Your position now",
    pointB: "B",
    pointBPicked: "Picked ✓",
    pointBTap: "Tap the map",
    showCourse: "SHOW COURSE",
    showRoute: "SHOW ROUTE",
    pickB: "PICK B ON THE MAP",
    start: "START",
    loadingMap: "LOADING MAP…",
    gpsFinding: "Finding your location… Move to open sky.",
    gpsWaiting: "Waiting for a better location signal…",
    loading: "Loading…",
  },
  hud: {
    soundOn: "Sound on (tap to mute)",
    soundOff: "Sound off (tap to turn on)",
  },
};

export type Strings = typeof en;
export type Locale = "en";
const LOCALES: Record<Locale, Strings> = { en };

/** The strings for a language (English is the only one so far). */
export const t = (locale: Locale = "en"): Strings => LOCALES[locale];
