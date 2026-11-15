import { haversineM } from "@/geo/geometry";
import { COURSE_DETOUR_FACTOR } from "@/routes/course";
import { RULES_VERSION } from "@/config/game-rules";
import { findMission } from "@/campaign";
import { missionDurationS, missionObjectives } from "@/campaign/setup";
import { resolveMatchRules } from "./rules";
import { createGame } from "@/engine/core/engine";
import type { LatLon } from "@/geo/geometry";
import { objectivesFromProposal } from "@/routes/objectives";
import { estimateTimeLimitS } from "@/routes/timing";
import type { RouteProposal } from "@/routes/types";
import type { TrailGraph } from "@/geo/graph/types";
import type { MatchParams } from "./config";
import { LiveGame } from "./live-game";

export interface MatchSetup {
  id: string;
  params: MatchParams;
  start: LatLon;
  proposal: RouteProposal | null;
  graph: TrailGraph;
  dataVersion: string;
}

/** Tidsgräns: Survival = vald matchlängd, annars lugn fart längs rutten (ingen bonus för snabbhet). */
export function matchDurationS(p: MatchParams, proposal: RouteProposal | null): number {
  const cm = findMission(p.campaign);
  if (cm) return missionDurationS(cm.mission, p, proposal);
  if (p.mode === "survival" || !proposal) return p.durationS;
  // Mission distances are straight lines between checkpoints; the way actually walked is longer.
  // Mission and terrain A TO B give straight-line lengths; the way actually walked is longer.
  const lengthM = p.mode === "mission" || proposal.terrain ? proposal.lengthM * COURSE_DETOUR_FACTOR : proposal.lengthM;
  return estimateTimeLimitS(lengthM, p.activity, p.difficulty, proposal.waypoints.length);
}

/** Skapar en match med samma motor och regler som simuleringarna. Spelet startar pausat tills första fixen är på plats. */
export function createLiveMatch(s: MatchSetup): LiveGame {
  const { params: p } = s;
  const durationS = matchDurationS(p, s.proposal);
  const dest = p.mode === "escape" ? s.proposal?.waypoints.find((w) => w.kind === "destination") : undefined;
  const rules = resolveMatchRules(p, durationS, dest ? haversineM(s.start, dest) : undefined);
  const cm = findMission(p.campaign);
  const { state } = createGame({
    g: s.graph,
    config: {
      activity: p.activity,
      difficulty: p.difficulty,
      durationSeconds: durationS,
      areaId: `varmland@${s.dataVersion}`,
      seed: p.seed,
      rulesVersion: RULES_VERSION,
      mode: p.mode,
    },
    rules,
    start: s.start,
    id: s.id,
    objectives: cm ? missionObjectives(cm.mission, s.proposal, p.difficulty) : p.mode === "survival" || !s.proposal ? undefined : objectivesFromProposal(s.proposal),
  });
  return new LiveGame(s.graph, state, rules);
}
