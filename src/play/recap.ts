import { haversineM, type LatLon } from "@/geo/geometry";
import { nodeLatLon } from "@/geo/graph/graph";
import { zombieLatLon } from "@/engine/core/movement";
import type { GameEvent } from "@/engine/core/types";
import type { Db } from "./idb";
import type { LiveGame } from "./live-game";
import type { MatchParams } from "./config";
import type { HistoryRecord } from "./storage";

/**
 * Match recap: the player's and every zombie's track plus a few numbers, shown after the match ("Show match") and kept on the device
 * for a week, then deleted automatically. Nothing leaves the device. Recorded in game time (pauses and background time are not in it).
 */

/** Seconds of game time between two recorded positions. */
export const RECAP_SAMPLE_S = 3;
/** Positions per stored chunk (one chunk ≈ one minute): the growing match is never rewritten as a whole. */
export const RECAP_CHUNK_SAMPLES = 20;
/** Tracks are deleted this long after the match started. */
export const RECAP_KEEP_MS = 7 * 24 * 3600 * 1000;
/** "In danger": a zombie within this distance (m). */
export const DANGER_M = 100;
/** Moving faster than this (m/s) between two samples counts as moving time. */
const MOVING_MPS = 0.7;
const E5 = 1e5;

export interface RecapStats {
  /** Time moving (s): the average speed is distance / movingS. */
  movingS: number;
  /** Highest speed over two samples (6 s), m/s. */
  maxSpeedMps: number;
  /** Closest any zombie came (m) and when (game seconds); null without zombies. */
  closestM: number | null;
  closestAtS: number | null;
  /** Zombie contacts that did not end the match. */
  nearMisses: number;
  /** Zombie sprints. */
  sprints: number;
  /** Time with a zombie within DANGER_M (s). */
  dangerS: number;
  /** Time off the road network (s, Bike). */
  offNetworkS: number;
  /** Bike: zombies ridden through. */
  passThroughs: number;
  /** Most zombies at the same time. */
  peakZombies: number;
}

export interface RecapMark { kind: "checkpoint" | "home" | "destination"; lat: number; lon: number; reachedAtS: number | null }

export interface RecapMeta {
  schema: 1;
  id: string;
  startedAt: number;
  mode: MatchParams["mode"];
  activity: MatchParams["activity"];
  difficulty: MatchParams["difficulty"];
  result: HistoryRecord["result"];
  elapsedS: number;
  distanceM: number;
  start: LatLon | null;
  end: LatLon | null;
  targets: RecapMark[];
  extraction: LatLon | null;
  stats: RecapStats;
  /** Number of full chunks; the chunk with this index is the one still growing. */
  chunks: number;
  /** Recorder state, so a restored match continues the same recap. */
  nextSampleS: number;
  lastTickS: number;
  captured: boolean;
}

/** One minute of positions. Each series is flat: [t (s, 0.1), lat·1e5, lon·1e5, …]. */
export interface RecapChunk {
  id: string;
  idx: number;
  player: number[];
  zombies: Record<string, number[]>;
}

export const emptyStats = (): RecapStats => ({ movingS: 0, maxSpeedMps: 0, closestM: null, closestAtS: null, nearMisses: 0, sprints: 0, dangerS: 0, offNetworkS: 0, passThroughs: 0, peakZombies: 0 });

const chunkKey = (id: string, idx: number) => `${id}:${String(idx).padStart(5, "0")}`;
const q = (x: number) => Math.round(x * E5);
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Records one match. The session calls `tick` every engine tick and `events` with the engine's events; `pending` says when to save. */
export class RecapRecorder {
  private chunk: RecapChunk;
  private recent: { t: number; p: LatLon }[] = [];
  /** Something changed since the last save. */
  pending = true;

  private constructor(readonly meta: RecapMeta, chunk?: RecapChunk) {
    this.chunk = chunk ?? { id: meta.id, idx: meta.chunks, player: [], zombies: {} };
  }

  static fresh(live: LiveGame, params: MatchParams, startedAt: number): RecapRecorder {
    const s = live.state;
    const meta: RecapMeta = {
      schema: 1, id: s.id, startedAt, mode: params.mode, activity: params.activity, difficulty: params.difficulty, result: "active",
      elapsedS: 0, distanceM: 0, start: s.startPos ?? s.player.position, end: null,
      targets: (s.objectives?.targets ?? []).map((t) => ({ kind: t.kind, lat: t.lat, lon: t.lon, reachedAtS: null })),
      extraction: null, stats: emptyStats(), chunks: 0, nextSampleS: 0, lastTickS: s.elapsedSeconds, captured: false,
    };
    const r = new RecapRecorder(meta);
    r.sample(live);
    return r;
  }

  /** Continue a recap after the match was restored (the last chunk keeps growing). */
  static resume(meta: RecapMeta, last: RecapChunk | undefined, live: LiveGame): RecapRecorder {
    return new RecapRecorder({ ...meta, lastTickS: live.state.elapsedSeconds }, last && last.idx === meta.chunks ? last : undefined);
  }

  get stats(): RecapStats { return this.meta.stats; }

  events(events: GameEvent[]): void {
    const st = this.meta.stats;
    for (const e of events) {
      if (e.type === "infection_contact") st.nearMisses++;
      else if (e.type === "zombie_sprint") st.sprints++;
      else if (e.type === "pass_through") st.passThroughs++;
      else if (e.type === "finished" && e.result === "infected") {
        // The contact that ended the match was no close call.
        this.meta.captured = true;
        st.nearMisses = Math.max(0, st.nearMisses - 1);
      }
    }
    if (events.length) this.pending = true;
  }

  tick(live: LiveGame): void {
    const s = live.state;
    const t = s.elapsedSeconds;
    const dt = Math.max(0, t - this.meta.lastTickS);
    this.meta.lastTickS = t;
    const st = this.meta.stats;
    const pos = s.player.position;
    let nearest = Infinity;
    for (const z of s.zombies) nearest = Math.min(nearest, haversineM(zombieLatLon(live.g, z), pos));
    if (Number.isFinite(nearest) && (st.closestM === null || nearest < st.closestM)) { st.closestM = Math.round(nearest); st.closestAtS = Math.round(t); }
    if (nearest <= DANGER_M) st.dangerS += dt;
    if (s.offNetwork?.active) st.offNetworkS += dt;
    st.peakZombies = Math.max(st.peakZombies, s.peakZombies ?? s.zombies.length);
    this.meta.elapsedS = Math.round(t);
    this.meta.distanceM = Math.round(s.player.distanceM);
    if (t >= this.meta.nextSampleS) this.sample(live);
  }

  /** The match is over: last positions, marks and result. */
  finish(live: LiveGame, result: HistoryRecord["result"]): void {
    this.tick(live);
    this.sample(live);
    const s = live.state;
    this.meta.result = result;
    this.meta.end = s.player.position;
    if (s.extractionNodeId && live.g.nodes.has(s.extractionNodeId)) this.meta.extraction = nodeLatLon(live.g, s.extractionNodeId);
    const reached = s.objectives?.reachedAtS ?? [];
    this.meta.targets = this.meta.targets.map((m, i) => ({ ...m, reachedAtS: reached[i] ?? null }));
    this.pending = true;
  }

  private sample(live: LiveGame): void {
    const s = live.state;
    const t = s.elapsedSeconds;
    this.meta.nextSampleS = (Math.floor(t / RECAP_SAMPLE_S) + 1) * RECAP_SAMPLE_S;
    const p = s.player.position;
    const last = this.chunk.player.length >= 3 ? this.chunk.player[this.chunk.player.length - 3] : null;
    if (last !== null && Math.abs(last - r1(t)) < 0.05) return; // same instant (finish right after a sample)
    // Moving time and top speed, from the filtered positions (6 s window: one noisy fix does not make a top speed).
    this.recent.push({ t, p });
    if (this.recent.length > 3) this.recent.shift();
    if (this.recent.length >= 2) {
      // Faster than anyone can move is a position jump (GPS reacquired, start point), not speed.
      const cap = live.rules.maxPlausibleSpeedMps;
      const a = this.recent[this.recent.length - 2], b = this.recent[this.recent.length - 1];
      const v = b.t > a.t ? haversineM(a.p, b.p) / (b.t - a.t) : 0;
      if (v >= MOVING_MPS && v <= cap) this.meta.stats.movingS += b.t - a.t;
      const o = this.recent[0];
      const vo = b.t - o.t >= 2 * RECAP_SAMPLE_S - 0.5 ? haversineM(o.p, b.p) / (b.t - o.t) : 0;
      if (vo <= cap && v <= cap) this.meta.stats.maxSpeedMps = Math.max(this.meta.stats.maxSpeedMps, vo);
    }
    this.chunk.player.push(r1(t), q(p.lat), q(p.lon));
    for (const z of s.zombies) {
      const ll = zombieLatLon(live.g, z);
      (this.chunk.zombies[z.id] ??= []).push(r1(t), q(ll.lat), q(ll.lon));
    }
    this.pending = true;
    if (this.chunk.player.length / 3 >= RECAP_CHUNK_SAMPLES) this.full = this.chunk;
  }

  /** A chunk that just filled up; the store writes it once more, then a new chunk starts. */
  private full: RecapChunk | null = null;

  /** What to write now: the meta and the current chunk (and a chunk that just filled up). Clears `pending`. */
  take(): { meta: RecapMeta; chunks: RecapChunk[] } {
    const chunks = [this.chunk];
    if (this.full) {
      this.meta.chunks = this.full.idx + 1;
      this.chunk = { id: this.meta.id, idx: this.meta.chunks, player: [], zombies: {} };
      this.full = null;
    }
    this.pending = false;
    return { meta: { ...this.meta, stats: { ...this.meta.stats } }, chunks: chunks.map((c) => ({ ...c, player: [...c.player], zombies: Object.fromEntries(Object.entries(c.zombies).map(([k, v]) => [k, [...v]])) })) };
  }
}

/** Recaps on the device: `recaps` (one meta per match) and `recapChunks` (the positions, one minute per entry). */
export class RecapStore {
  constructor(private readonly db: Db) {}
  private get metas() { return this.db.store<RecapMeta>("recaps"); }
  private get chunks() { return this.db.store<RecapChunk>("recapChunks"); }

  async write(w: { meta: RecapMeta; chunks: RecapChunk[] }): Promise<void> {
    for (const c of w.chunks) await this.chunks.put(chunkKey(c.id, c.idx), c);
    await this.metas.put(w.meta.id, w.meta);
  }

  async meta(id: string): Promise<RecapMeta | undefined> { return this.metas.get(id); }

  async load(id: string): Promise<{ meta: RecapMeta; chunks: RecapChunk[] } | null> {
    const meta = await this.metas.get(id);
    if (!meta) return null;
    const chunks = (await this.chunks.range(`${id}:`)).sort((a, b) => a.idx - b.idx);
    return { meta, chunks };
  }

  /** The chunk a restored match keeps writing to. */
  async lastChunk(id: string, idx: number): Promise<RecapChunk | undefined> { return this.chunks.get(chunkKey(id, idx)); }

  async ids(): Promise<Set<string>> { return new Set((await this.metas.all()).map((m) => m.id)); }

  async delete(id: string): Promise<void> {
    await this.chunks.deleteRange(`${id}:`);
    await this.metas.delete(id);
  }

  /** Deletes recaps of matches that started more than RECAP_KEEP_MS ago. Returns how many. */
  async purge(now: number): Promise<number> {
    let n = 0;
    for (const m of await this.metas.all()) if (now - m.startedAt > RECAP_KEEP_MS) { await this.delete(m.id); n++; }
    return n;
  }

  async clear(): Promise<void> {
    await this.metas.clear();
    await this.chunks.clear();
  }
}

// --- for showing a recap ---

export interface Track { id: string; t: number[]; lat: number[]; lon: number[] }

/** Joins the chunks into one track per series (player first, then zombies by id). */
export function tracksOf(chunks: RecapChunk[]): { player: Track; zombies: Track[] } {
  const acc = new Map<string, Track>();
  const add = (id: string, flat: number[]) => {
    const tr = acc.get(id) ?? { id, t: [], lat: [], lon: [] };
    acc.set(id, tr);
    for (let i = 0; i + 2 < flat.length; i += 3) {
      if (tr.t.length && flat[i] <= tr.t[tr.t.length - 1]) continue; // a chunk saved twice around a restore
      tr.t.push(flat[i]); tr.lat.push(flat[i + 1] / E5); tr.lon.push(flat[i + 2] / E5);
    }
  };
  for (const c of [...chunks].sort((a, b) => a.idx - b.idx)) {
    add("player", c.player);
    for (const [id, flat] of Object.entries(c.zombies)) add(id, flat);
  }
  const player = acc.get("player") ?? { id: "player", t: [], lat: [], lon: [] };
  acc.delete("player");
  return { player, zombies: [...acc.values()] };
}

/** Position on a track at time t (linear between samples), or null outside it (zombie not yet there, or gone). */
export function positionAt(tr: Track, t: number): LatLon | null {
  const n = tr.t.length;
  if (!n || t < tr.t[0] || t > tr.t[n - 1] + RECAP_SAMPLE_S) return null;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tr.t[mid] <= t) lo = mid; else hi = mid - 1; }
  if (lo === n - 1) return { lat: tr.lat[lo], lon: tr.lon[lo] };
  const f = (t - tr.t[lo]) / (tr.t[lo + 1] - tr.t[lo]);
  return { lat: tr.lat[lo] + (tr.lat[lo + 1] - tr.lat[lo]) * f, lon: tr.lon[lo] + (tr.lon[lo + 1] - tr.lon[lo]) * f };
}

/** Zombies that at some point came within `withinM` of the player (compared at the zombie's own sample times). */
export function nearZombies(player: Track, zombies: Track[], withinM: number): Track[] {
  return zombies.filter((z) => z.t.some((t, i) => { const p = positionAt(player, t); return p !== null && haversineM(p, { lat: z.lat[i], lon: z.lon[i] }) <= withinM; }));
}

/**
 * Personal record for this match among earlier ones with the same mode, activity and difficulty: fastest completion (Checkpoints, A to B),
 * or longest time before being captured. Null when it is not a record (or there is nothing to compare with).
 */
export function personalRecord(h: HistoryRecord, earlier: HistoryRecord[]): string | null {
  const same = earlier.filter((x) => x.id !== h.id && x.startedAt < h.startedAt && x.mode === h.mode && x.activity === h.activity && x.difficulty === h.difficulty);
  if (h.result === "survived" && h.mode !== "survival") {
    const prev = same.filter((x) => x.result === "survived").map((x) => x.elapsedS);
    return prev.length && h.elapsedS < Math.min(...prev) ? "New record: fastest time" : null;
  }
  if (h.result === "survived" && h.mode === "survival") return same.some((x) => x.result === "survived") ? null : same.length ? "First extraction at this level" : null;
  if (h.result === "infected") {
    const prev = same.filter((x) => x.result === "infected" || x.result === "survived").map((x) => x.elapsedS);
    return prev.length && h.elapsedS > Math.max(...prev) ? "New record: longest survival" : null;
  }
  return null;
}
