import type { GameMode } from "@/engine/objectives/objectives";

/**
 * User-visible UI strings, in one place so a second language (Swedish) can be added later: add a `sv: Strings` object and pick it in `t`.
 * Only the screens that have been moved here use it (New game, the in-game sound button); older screens still have their texts inline.
 * Game data and internal identifiers (mode ids, difficulty ids) are never translated.
 */
const en = {
  newGame: {
    title: "NEW GAME",
    mode: "Mode",
    modeSubtitle: { mission: "Collect & return", escape: "Reach the target", survival: "Stay alive & escape" } satisfies Record<GameMode, string>,
    activity: "Activity",
    difficulty: "Difficulty",
    courseDistance: "Course distance",
    matchLength: "Match length",
    extractionNote: (min: number) => `Extraction opens after ${min} min. Reach it in time.`,
    short: "Short",
    long: "Long",
    showCourse: "SHOW COURSE",
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
    regenerate: "REGENERATE",
    regenerateLabel: "Regenerate: a new course with the same settings",
    startGame: "START GAME",
    loading: "Loading map data and planning…",
  },
  pick: {
    tapForB: "Tap the map to set B",
    bSet: "B is set. Tap again to move it.",
  },
  result: {
    title: { captured: "CAPTURED", failed: "OUT OF TIME", aborted: "MATCH ABORTED", incomplete: "MATCH OVER", mission: "COURSE COMPLETE", escape: "YOU MADE IT", survival: "EXTRACTED" },
    captured: (at: string) => `Captured at ${at}.`,
    capturedProgress: (at: string, reached: number, total: number) => `Captured at ${at}, with ${reached} of ${total} checkpoints.`,
    missionDone: (n: number, time: string) => `All ${n} checkpoints and home in ${time}.`,
    escapeDone: (time: string) => `Reached B in ${time}.`,
    survivalDone: (spare: string) => `Extracted with ${spare} to spare.`,
    failedMission: (reached: number, total: number, home: boolean) => reached >= total && !home ? "All checkpoints, but time ran out before you got home." : `${reached} of ${total} checkpoints when time ran out.`,
    failedEscape: "Time ran out before you reached B.",
    failedSurvival: "Time ran out before you reached extraction.",
    aborted: "The match is saved as aborted.",
    time: "Time",
    distance: "Distance",
    avgSpeed: "Avg speed",
    closest: (m: number, at: string) => `Closest zombie ${m} m at ${at}`,
    closeCalls: (n: number) => `${n} close call${n === 1 ? "" : "s"}`,
    riddenThrough: (n: number) => `${n} zombie${n === 1 ? "" : "s"} ridden through`,
    allStats: "All numbers",
    hideStats: "Fewer numbers",
    showMatch: "SHOW MATCH",
    playAgain: "PLAY AGAIN",
    playAgainLabel: "Play again with the same settings (a new course)",
    home: "Home",
    previousGames: "Previous games",
    notSaved: "The result could not be saved locally.",
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
