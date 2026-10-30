import type { OffNetworkState } from "../offnetwork";
import type { Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import type { LatLon } from "@/geo/geometry";
import type { Dir } from "@/geo/graph/types";
import type { RouteStep } from "../pathfinding/astar";
import type { GameMode, ObjectiveSet } from "../objectives/objectives";

export type GamePhase = "preparing" | "head_start" | "survival" | "extraction" | "finished";
export type GameResult = "survived" | "infected" | "failed" | "aborted" | "incomplete";
export type ZombieState = "patrol" | "investigate" | "chase" | "intercept";

export interface GameConfig {
  activity: Activity;
  difficulty: Difficulty;
  durationSeconds: number;
  areaId: string;
  seed: number;
  rulesVersion: string;
  /** Spelläge; utelämnat = survival. */
  mode?: GameMode;
}

export interface Observation {
  lat: number;
  lon: number;
  /** Spelklocka (s) då observationen gjordes. */
  observedAtS: number;
  edgeId: string;
  edgeDistM: number;
}

export interface Zombie {
  id: string;
  edgeId: string;
  distanceAlongEdgeM: number;
  speedMps: number;
  state: ZombieState;
  targetNodeId?: string;
  lastKnownPlayerPosition?: { lat: number; lon: number; observedAtMs: number };

  // --- intern AI/rörelse (serialiserbart) ---
  dir: Dir;
  route: RouteStep[];
  stopAtM?: number;
  /** Snappad position för senaste observation. */
  lastKnownEdge?: { edgeId: string; distM: number };
  /** Föregående observation, för riktningsuppskattning vid genskjutning. */
  prevKnownEdge?: { edgeId: string; distM: number; atS: number };
  stateSinceS: number;
  replanAtS: number;
  tacticalAtS: number;
  contactLostS: number;
  canIntercept: boolean;
  /** Spurt: spelklocka (s) då pågående spurt slutar. Saknas när zombien inte spurtar. */
  sprintUntilS?: number;
  /** Spurt: spelklocka (s) då pågående spurt började (för ramp/avtagande). Saknas i äldre sparade matcher. */
  sprintStartS?: number;
  /** Tidigast tid (s) för nästa spurt (återhämtning). */
  sprintReadyAtS?: number;
}

export interface PlayerState {
  position: LatLon;
  distanceM: number;
  /** Senast validerade position som AI:n har rätt att veta om. */
  lastObservation?: Observation;
  /** Magnet-jakt: spelarens snappade position, uppdaterad ca varje sekund. Delas av alla zombier (ett nätsnap i stället för ett per zombie). */
  magnetObservation?: Observation;
  /** Recent positions (game time) for the pass-through speed; the oldest is at least `PASS_THROUGH_WINDOW_S` old once available. */
  speedTrail?: { t: number; lat: number; lon: number }[];
}

export interface GameState {
  id: string;
  config: GameConfig;
  phase: GamePhase;
  elapsedSeconds: number;
  zombies: Zombie[];
  infectionProgressSeconds: number;
  extractionNodeId?: string;
  result?: GameResult;

  // --- tillägg för motorn ---
  rngState: number;
  player: PlayerState;
  paused: boolean;
  /** Spelklocka (s) tills infektion åter är möjlig efter paus. */
  neutralUntilS: number;
  extractionHoldS: number;
  extractionFixes?: number;
  extractionLastFix?: number;
  gpsLostS: number;
  gpsLostLong: boolean;
  nextRevealAtS: number;
  nextSpawnTryAtS: number;
  zombieCounter: number;
  peakZombies: number;
  /** Zombier som tagits bort ur högar av jagande zombier (engine/ai/culling.ts). Räknas in i tillväxten så att de inte ersätts. */
  culledZombies?: number;
  /** Spelarens komponent i grafen – zombier hålls i samma komponent. */
  component: number;
  /** Matchens startposition (A i A TO B). */
  startPos?: LatLon;
  /** Mål för Escape/Mission. Saknas i Survival (där extraction gäller). */
  objectives?: ObjectiveSet;
  /** Cykel: läge och budget för spelare utanför nätet. Saknas i matcher sparade före 2.3. */
  offNetwork?: OffNetworkState;
  /** Bike: riding through a zombie right now (so `pass_through` is sent once per encounter). */
  passingThrough?: boolean;
}

export type GameEvent =
  | { type: "phase"; phase: GamePhase }
  | { type: "reveal" }
  | { type: "zombie_spawned"; zombieId: string }
  | { type: "spawn_skipped" }
  | { type: "zombie_sprint"; zombieId: string }
  | { type: "zombie_culled"; zombieId: string }
  | { type: "spawn_relaxed" }
  | { type: "zombie_detected"; zombieId: string }
  | { type: "infection_contact" }
  /** Bike: a zombie was in contact but the player was fast enough to ride through it (once per encounter). */
  | { type: "pass_through" }
  | { type: "extraction_opened"; nodeId: string }
  | { type: "extraction_unavailable" }
  | { type: "objective_reached"; targetId: string; index: number }
  | { type: "gps_lost_long" }
  | { type: "off_network"; change: "entered" | "left" | "exposed" }
  | { type: "finished"; result: GameResult };
