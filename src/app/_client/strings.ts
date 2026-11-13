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
    short: "Short",
    long: "Long",
    showCourse: "SHOW COURSE",
    start: "START",
    loadingMap: "LOADING MAP…",
    gpsFinding: "Finding your location… Move to open sky.",
    gpsWaiting: "Waiting for a better location signal…",
    loading: "Loading…",
    // Three steps: activity, mode, then the setup with the map.
    activityPrompt: "How will you travel?",
    modeTitle: "GAME MODE",
    modePrompt: "Choose how you win.",
    activityCard: { walk: "ON FOOT", mtb: "BY BIKE" } as Record<"walk" | "mtb", string>,
    activitySub: { walk: "Walk or run on paths and trails", mtb: "Ride roads and gravel tracks" } as Record<"walk" | "mtb", string>,
    // The win condition of each mode, as the game decides it (all modes: being caught ends the match).
    modeWin: {
      mission: "Take every checkpoint in order, then get home before time runs out.",
      escape: "Choose B on the map and reach it before time runs out. Any way goes.",
      survival: "Stay free until extraction opens, then reach it before time runs out.",
    } satisfies Record<GameMode, string>,
    back: "Back",
    backTo: { activity: "Back to activity", mode: "Back to game mode" } as Record<"activity" | "mode", string>,
    changeActivity: (a: string) => `Activity: ${a}. Change`,
    changeMode: (m: string) => `Game mode: ${m}. Change`,
    waitingForCourse: "Waiting for your location to plan the course…",
  },
  preview: {
    editSetup: "EDIT SETUP",
    editSetupLabel: "Edit setup (back to New game)",
    yourCourse: "Your course",
    yourRoute: "Your route",
    yourMatch: "Your match",
    distance: "Distance",
    timeLimit: "Time limit",
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
    capturedProgress: (reached: number, total: number) => `${reached} of ${total} checkpoints.`,
    missionDone: (n: number, time: string) => `All ${n} checkpoints and home in ${time}.`,
    escapeDone: (time: string) => `Reached B in ${time}.`,
    survivalDone: (spare: string) => `Extracted with ${spare} to spare.`,
    failedMission: (reached: number, total: number, home: boolean) => reached >= total && !home ? "All checkpoints, but time ran out before you got home." : `${reached} of ${total} checkpoints when time ran out.`,
    failedEscape: "Time ran out before you reached B.",
    failedSurvival: "Time ran out before you reached extraction.",
    time: "Time",
    distance: "Distance",
    avgSpeed: "Avg speed",
    closest: (m: number, at: string) => `Closest zombie ${m} m at ${at}`,
    closeCalls: (n: number) => `${n} close call${n === 1 ? "" : "s"}`,
    riddenThrough: (n: number) => `${n} zombie${n === 1 ? "" : "s"} ridden through`,
    showMatch: "SHOW MATCH",
    playAgain: "PLAY AGAIN",
    playAgainLabel: "Play again with the same settings (a new course)",
    home: "Main menu",
    previousGames: "Previous games",
    notSaved: "The result could not be saved locally.",
  },
  heli: {
    approaching: "HELICOPTER INBOUND",
    approachingSub: (time: string) => `Extraction opens in ${time}`,
    landed: "HELICOPTER LANDED",
    landedSub: (dist: string | null) => (dist ? `Extraction open · ${dist} away` : "Extraction open · reach it"),
  },
  sound: {
    button: "SOUND",
    title: "Sound",
    all: "Sound on",
    music: "Music",
    effects: "Effects",
    voice: "Voice",
    done: "DONE",
    note: "The speaker button in the game turns all sound off and on. On iPhone the ring/silent switch also mutes the game.",
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
