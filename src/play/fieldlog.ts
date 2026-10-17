import type { Db } from "./idb";
import type { FixCounters } from "./live-game";
import type { HistoryRecord } from "./storage";

export const LOG_SCHEMA = 1;
const MAX_ENTRIES = 5000;

export interface LogEntry {
  /** Millisekunder sedan loggen startade (väggklocka). */
  t: number;
  k: string;
  d?: Record<string, unknown>;
}

export interface FieldLogData {
  schema: number;
  matchId: string;
  startedAtIso: string;
  userAgent?: string;
  entries: LogEntry[];
  /** Endast om spelaren aktivt slagit på lokal spårinspelning. */
  trace?: [t: number, lat: number, lon: number, accuracyM: number][];
  battery?: { startPct?: number; endPct?: number; note: string };
  renderProblems: number;
  summary?: Record<string, unknown>;
}

/**
 * Lokal testlogg för fälttester. Allt stannar i enheten (IndexedDB); filexport sker bara när spelaren väljer det.
 * GPS-spår sparas bara om spelaren slagit på det (av som standard).
 */
export class FieldLog {
  readonly data: FieldLogData;
  private t0: number;
  private lastTraceT = -1e9;

  constructor(matchId: string, now: number, private readonly traceEnabled = false, userAgent?: string) {
    this.t0 = now;
    this.data = {
      schema: LOG_SCHEMA, matchId, startedAtIso: new Date(now).toISOString(), userAgent, entries: [], renderProblems: 0,
      battery: { note: "Batteri mäts manuellt: notera procent före och efter, och skärmens ljusstyrka. Webbläsare på iPhone saknar Battery API." },
    };
    if (traceEnabled) this.data.trace = [];
  }

  static fromData(data: FieldLogData, now: number, traceEnabled = false): FieldLog {
    const l = new FieldLog(data.matchId, now, traceEnabled);
    Object.assign(l.data, data);
    l.t0 = Date.parse(data.startedAtIso) || now;
    return l;
  }

  add(now: number, k: string, d?: Record<string, unknown>): void {
    if (this.data.entries.length >= MAX_ENTRIES) return;
    this.data.entries.push({ t: now - this.t0, k, d });
  }

  /** Spår (om påslaget) – högst en punkt per sekund. */
  trace(now: number, lat: number, lon: number, accuracyM: number): void {
    if (!this.traceEnabled || !this.data.trace || now - this.lastTraceT < 1000) return;
    this.lastTraceT = now;
    this.data.trace.push([now - this.t0, Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6, Math.round(accuracyM)]);
  }

  renderProblem(now: number, what: string): void {
    this.data.renderProblems++;
    this.add(now, "render_problem", { what });
  }

  finalize(h: HistoryRecord, c: FixCounters, extra: Record<string, unknown> = {}): void {
    this.data.summary = {
      mode: h.mode, activity: h.activity, difficulty: h.difficulty, result: h.result,
      plannedLengthM: h.plannedLengthM, measuredDistanceM: h.measuredDistanceM,
      matchTimeS: h.elapsedS, timeLimitS: h.timeLimitS, checkpoints: h.checkpoints,
      gps: {
        fixes: c.fixes, accepted: c.accepted, rejectedInvalid: c.invalid, rejectedStale: c.stale, rejectedJump: c.jumps, reacquired: c.reacquired,
        meanAccuracyM: c.accepted ? Math.round((c.accuracySumM / c.accepted) * 10) / 10 : null, maxAccuracyM: Math.round(c.accuracyMaxM),
        dropouts: c.dropouts, dropoutS: Math.round(c.dropoutS), longestDropoutS: Math.round(c.longestDropoutS), appFreezes: c.freezes,
      },
      renderProblems: this.data.renderProblems,
      ...extra,
    };
  }

  async save(db: Db): Promise<void> {
    await db.store<FieldLogData>("logs").put(this.data.matchId, this.data);
  }

  toJson(): string {
    return JSON.stringify(this.data, null, 1);
  }
}

export async function loadLog(db: Db, matchId: string): Promise<FieldLogData | undefined> {
  return db.store<FieldLogData>("logs").get(matchId);
}

export async function exportAllLogs(db: Db): Promise<string> {
  return JSON.stringify({ exportedAtIso: new Date().toISOString(), logs: await db.store<FieldLogData>("logs").all() }, null, 1);
}
