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
  preview: {
    editSetup: "EDIT SETUP",
    editSetupLabel: "Edit setup (back to New game)",
    yourCourse: "Your course",
    yourRoute: "Your route",
    yourMatch: "Your match",
    details: "Details",
    detailsHide: "Hide details",
    distance: "Distance",
    estTime: "Est. time",
    checkpoints: "Checkpoints",
    goal: "Goal",
    matchLength: "Match length",
    extraction: "Extraction",
    timeLimit: "Time limit",
    checkpointsValue: (n: number) => `${n} + home`,
    pointB: "Point B",
    reachExtraction: "Reach it",
    afterMin: (min: number) => `after ${min} min`,
    minutes: (min: number) => `${min} min`,
    safety: "Never cross a road or railway just because the game suggests it.",
    goalMission: (n: number) => `Fetch the ${n} numbered checkpoints in order, then return home. Choose your own way; no route is drawn.`,
    goalEscape: "Get from A to B any way you like. The faint line between them only shows the direction, not a route.",
    goalEscapeTerrain: "Get from A to B any way you like, on trails or across country. The faint line only shows the direction. Zombies run on trails and walk slowly across country.",
    goalSurvival: (min: number) => `No route: move freely along the trails. Extraction opens after ${min} min; reach it before time runs out.`,
    distanceNoteMission: (morePct: number) => `Distance is the straight line from home through the checkpoints and back. Your actual route will be longer; the time estimate and the time limit assume about ${morePct} % more.`,
    distanceNoteEscape: "Distance is the straight line from A to B. Your actual route will be longer.",
    estNote: "Estimated at a calm pace for the activity.",
    safetyMore: "Roads, railways, water and private land are not part of the game. Follow traffic rules and your own judgement.",
    regenerate: "REGENERATE",
    regenerateLabel: "Regenerate: a new course with the same settings",
    startGame: "START GAME",
    loading: "Loading map data and planning…",
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
