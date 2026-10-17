import { RULES_VERSION } from "@/config/game-rules";
import type { GameResult, GameState } from "@/engine/core/types";
import type { LatLon } from "@/geo/geometry";
import { indexGraph, serializeGraph } from "@/geo/graph/graph";
import type { SerializedGraph } from "@/geo/graph/types";
import type { RouteProposal } from "@/routes/types";
import type { MatchParams } from "./config";
import type { Db } from "./idb";
import { emptyCounters, LiveGame, type FixCounters, type LastFix } from "./live-game";
import { matchDurationS } from "./match";

/** Höjs när lagringsformatet eller spelreglerna ändras så att gamla pågående matcher inte återställs felaktigt. */
export const SNAPSHOT_SCHEMA = 1;

export type HistoryResult = GameResult | "active" | "interrupted";

/** Lätt post för listan "Tidigare spel". Innehåller bara uppmätta värden. */
export interface HistoryRecord {
  schema: number;
  id: string;
  startedAt: number;
  endedAt?: number;
  mode: MatchParams["mode"];
  activity: MatchParams["activity"];
  difficulty: MatchParams["difficulty"];
  /** Föreslagen rutt (m); null i Survival. */
  plannedLengthM: number | null;
  /** Av spelmotorn uppmätt tillryggalagd sträcka (m) utifrån filtrerade GPS-positioner. */
  measuredDistanceM: number;
  /** Spelad matchtid (s), exklusive pauser. */
  elapsedS: number;
  timeLimitS: number;
  result: HistoryResult;
  checkpoints: { reached: number; total: number } | null;
}

interface MatchRecord {
  schema: number;
  id: string;
  rulesVersion: string;
  params: MatchParams;
  start: LatLon;
  dataVersion: string;
  proposal: RouteProposal | null;
  state: GameState;
  lastFix: LastFix | null;
  fixSeq: number;
  counters: FixCounters;
  savedAt: number;
}

export interface Restored {
  live: LiveGame;
  params: MatchParams;
  proposal: RouteProposal | null;
  start: LatLon;
  dataVersion: string;
  startedAt: number;
}

export type RestoreOutcome = { ok: true; restored: Restored } | { ok: false; reason: string } | null;

const ACTIVE_KEY = "activeMatchId";

export class MatchStorage {
  constructor(private readonly db: Db) {}

  private get matches() { return this.db.store<MatchRecord | SerializedGraph>("matches"); }
  private get history() { return this.db.store<HistoryRecord>("history"); }
  private get meta() { return this.db.store<string>("meta"); }

  private summarize(live: LiveGame, params: MatchParams, proposal: RouteProposal | null, startedAt: number, result: HistoryResult): HistoryRecord {
    const s = live.state;
    const o = s.objectives;
    return {
      schema: SNAPSHOT_SCHEMA,
      id: s.id,
      startedAt,
      endedAt: result === "active" ? undefined : Date.now(),
      mode: params.mode,
      activity: params.activity,
      difficulty: params.difficulty,
      plannedLengthM: proposal ? Math.round(proposal.lengthM) : null,
      measuredDistanceM: Math.round(s.player.distanceM),
      elapsedS: Math.round(s.elapsedSeconds),
      timeLimitS: Math.round(matchDurationS(params, proposal)),
      result,
      checkpoints: o ? { reached: o.index, total: o.targets.length } : null,
    };
  }

  /** Första sparningen: skriver grafen (stor, ändras inte) och matchens tillstånd. */
  async begin(live: LiveGame, params: MatchParams, proposal: RouteProposal | null, start: LatLon, dataVersion: string, startedAt = Date.now()): Promise<void> {
    await this.matches.put(`${live.state.id}:graph`, serializeGraph(live.g, "openstreetmap"));
    await this.meta.put(ACTIVE_KEY, live.state.id);
    await this.history.put(live.state.id, this.summarize(live, params, proposal, startedAt, "active"));
    await this.save(live, params, proposal, start, dataVersion);
  }

  /** Sparar ögonblicksbilden. Anropas vid händelser och periodiskt – inte per bildruta. */
  async save(live: LiveGame, params: MatchParams, proposal: RouteProposal | null, start: LatLon, dataVersion: string): Promise<void> {
    const rec: MatchRecord = {
      schema: SNAPSHOT_SCHEMA,
      id: live.state.id,
      rulesVersion: RULES_VERSION,
      params,
      start,
      dataVersion,
      proposal,
      state: structuredClone(live.state),
      lastFix: live.lastFix,
      fixSeq: live.fixSeq,
      counters: live.counters,
      savedAt: Date.now(),
    };
    await this.matches.put(live.state.id, rec);
    const prev = await this.history.get(live.state.id);
    if (prev) await this.history.put(live.state.id, { ...this.summarize(live, params, proposal, prev.startedAt, live.state.result ?? "active"), endedAt: prev.endedAt });
  }

  /** Avslutad match: historikposten får slutresultat och de tunga posterna (graf, tillstånd) tas bort. */
  async finish(live: LiveGame, params: MatchParams, proposal: RouteProposal | null, result?: HistoryResult): Promise<void> {
    const prev = await this.history.get(live.state.id);
    const res = result ?? live.state.result ?? "incomplete";
    await this.history.put(live.state.id, this.summarize(live, params, proposal, prev?.startedAt ?? Date.now(), res));
    await this.matches.delete(live.state.id);
    await this.matches.delete(`${live.state.id}:graph`);
    if ((await this.meta.get(ACTIVE_KEY)) === live.state.id) await this.meta.delete(ACTIVE_KEY);
  }

  /**
   * Pågående match från förra sessionen. Kan den inte återställas säkert (nytt format, nya regler, skadat tillstånd)
   * avslutas den kontrollerat som "interrupted" i stället för att återupptas felaktigt.
   */
  async loadActive(): Promise<RestoreOutcome> {
    const id = await this.meta.get(ACTIVE_KEY);
    if (!id) return null;
    const rec = (await this.matches.get(id)) as MatchRecord | undefined;
    const graph = (await this.matches.get(`${id}:graph`)) as SerializedGraph | undefined;
    const interrupt = async (reason: string): Promise<RestoreOutcome> => {
      const h = await this.history.get(id);
      if (h) await this.history.put(id, { ...h, result: "interrupted", endedAt: Date.now() });
      await this.matches.delete(id);
      await this.matches.delete(`${id}:graph`);
      await this.meta.delete(ACTIVE_KEY);
      return { ok: false, reason };
    };
    if (!rec || !graph) return interrupt("Sparad match saknar data.");
    if (rec.schema !== SNAPSHOT_SCHEMA || rec.rulesVersion !== RULES_VERSION) return interrupt("Matchen sparades med en annan version av spelet och kan inte återupptas.");
    const s = rec.state;
    if (!s || s.phase === "finished" || !Number.isFinite(s.elapsedSeconds) || !Array.isArray(s.zombies)) return interrupt("Sparad match är skadad.");
    const g = indexGraph(graph);
    for (const z of s.zombies) if (!g.edges.has(z.edgeId)) return interrupt("Sparad match stämmer inte med kartdatan.");
    const prev = await this.history.get(id);
    const live = LiveGame.restore(g, s, rec.params, rec.proposal, rec.counters ?? emptyCounters(), rec.lastFix, rec.fixSeq);
    return { ok: true, restored: { live, params: rec.params, proposal: rec.proposal, start: rec.start, dataVersion: rec.dataVersion, startedAt: prev?.startedAt ?? rec.savedAt } };
  }

  async listHistory(): Promise<HistoryRecord[]> {
    return (await this.history.all()).sort((a, b) => b.startedAt - a.startedAt);
  }

  /** Raderar en match helt (historik, tillstånd, graf och testlogg). */
  async deleteMatch(id: string): Promise<void> {
    await this.history.delete(id);
    await this.matches.delete(id);
    await this.matches.delete(`${id}:graph`);
    await this.db.store("logs").delete(id);
    if ((await this.meta.get(ACTIVE_KEY)) === id) await this.meta.delete(ACTIVE_KEY);
  }

  async deleteAll(): Promise<void> {
    for (const n of ["history", "matches", "logs", "meta"] as const) await this.db.store(n).clear();
  }
}
