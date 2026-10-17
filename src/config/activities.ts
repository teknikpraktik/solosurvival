export type Activity = "walk" | "run" | "mtb";

export interface ActivityProfile {
  defaultDurationS: number;
  autoRadiusM: number;
  headStartS: number;
  zombieSpeedKmh: number;
  initialZombies: number;
  maxZombies: number;
  /** Minsta avstånd (geografiskt och längs nätet) till spelaren för nya zombier. */
  spawnMinDistanceM: number;
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
    headStartS: 3 * 60,
    zombieSpeedKmh: 2.5,
    initialZombies: 3,
    maxZombies: 9,
    spawnMinDistanceM: 250,
    playerPaceMps: 1.3,
    maxPlausibleSpeedMps: 4,
  },
  run: {
    defaultDurationS: 45 * 60,
    autoRadiusM: 3000,
    headStartS: 3 * 60,
    zombieSpeedKmh: 5,
    initialZombies: 4,
    maxZombies: 12,
    spawnMinDistanceM: 250,
    playerPaceMps: 2.8,
    maxPlausibleSpeedMps: 8,
  },
  mtb: {
    defaultDurationS: 45 * 60,
    autoRadiusM: 5000,
    headStartS: 4 * 60,
    zombieSpeedKmh: 9,
    initialZombies: 5,
    maxZombies: 15,
    spawnMinDistanceM: 400,
    playerPaceMps: 4.5,
    maxPlausibleSpeedMps: 20,
  },
};
