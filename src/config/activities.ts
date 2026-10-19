export type Activity = "walk" | "run" | "mtb";

export interface ActivityProfile {
  defaultDurationS: number;
  autoRadiusM: number;
  headStartS: number;
  zombieSpeedKmh: number;
  initialZombies: number;
  maxZombies: number;
  /** Minsta avstånd (geografiskt och längs nätet) till spelaren för nya zombier. */
  /** Initial zombies: minimum distance from the player (m), so the player gets time to look around. */
  startMinDistanceM: number;
  /** Initial zombies: minimum distance between each other (m). */
  startSpacingM: number;
  /** Initial zombies are spread out over the whole area / along the mission track instead of anywhere in the spawn band. */
  spreadStart: boolean;
  /** Zombies only hunt (magnet) / react to position reveals within this distance (m) of the player; farther away they patrol. */
  magnetRangeM: number;
  spawnMinDistanceM: number;
  /** Högsta fågelvägsavstånd för nya zombier: de ska uppstå nära nog att spelet ger action direkt (fälttest). */
  spawnMaxDistanceM: number;
  /** Nominell spelarfart, används av AI:n för att uppskatta var spelaren kan vara och av extraction-valet. */
  playerPaceMps: number;
  /** Högsta rimliga GPS-fart innan ett hopp avvisas. */
  maxPlausibleSpeedMps: number;
}

// Startvärden enligt PRD 3.1 – ska justeras genom fälttester.
export const ACTIVITIES: Record<Activity, ActivityProfile> = {
  walk: {
    defaultDurationS: 30 * 60,
    autoRadiusM: 1500,
    headStartS: 0,
    zombieSpeedKmh: 6.75,
    initialZombies: 6,
    maxZombies: 18,
    startMinDistanceM: 300,
    startSpacingM: 100,
    spreadStart: false,
    magnetRangeM: Infinity,
    spawnMinDistanceM: 300,
    spawnMaxDistanceM: 1000,
    playerPaceMps: 1.3,
    maxPlausibleSpeedMps: 4,
  },
  run: {
    defaultDurationS: 45 * 60,
    autoRadiusM: 3000,
    headStartS: 0,
    zombieSpeedKmh: 9,
    initialZombies: 8,
    maxZombies: 24,
    startMinDistanceM: 300,
    startSpacingM: 100,
    spreadStart: false,
    magnetRangeM: Infinity,
    spawnMinDistanceM: 300,
    spawnMaxDistanceM: 1000,
    playerPaceMps: 2.8,
    maxPlausibleSpeedMps: 8,
  },
  mtb: {
    defaultDurationS: 45 * 60,
    autoRadiusM: 5000,
    headStartS: 0,
    zombieSpeedKmh: 15.8,
    initialZombies: 10,
    maxZombies: 30,
    startMinDistanceM: 1500,
    startSpacingM: 300,
    spreadStart: true,
    magnetRangeM: 2000,
    spawnMinDistanceM: 600,
    spawnMaxDistanceM: 2000,
    playerPaceMps: 4.5,
    maxPlausibleSpeedMps: 20,
  },
};
