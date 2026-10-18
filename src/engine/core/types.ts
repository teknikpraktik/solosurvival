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
}

export interface PlayerState {
  position: LatLon;
  distanceM: number;
  /** Senast validerade position som AI:n har rätt att veta om. */
  lastObservation?: Observation;
  /** Magnet-jakt: spelarens snappade position, uppdaterad ca varje sekund. Delas av alla zombier (ett nätsnap i stället för ett per zombie). */
  magnetObservation?: Observation;
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
  /** Spelarens komponent i grafen – zombier hålls i samma komponent. */
  component: number;
  /** Mål för Escape/Mission. Saknas i Survival (där extraction gäller). */
  objectives?: ObjectiveSet;
}

export type GameEvent =
  | { type: "phase"; phase: GamePhase }
  | { type: "reveal" }
  | { type: "zombie_spawned"; zombieId: string }
  | { type: "spawn_skipped" }
  | { type: "spawn_relaxed" }
  | { type: "zombie_detected"; zombieId: string }
  | { type: "infection_contact" }
  | { type: "extraction_opened"; nodeId: string }
  | { type: "extraction_unavailable" }
  | { type: "objective_reached"; targetId: string; index: number }
  | { type: "gps_lost_long" }
  | { type: "finished"; result: GameResult };
