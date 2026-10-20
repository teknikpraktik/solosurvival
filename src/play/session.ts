import type { Db } from "./idb";
import { ACTIVITIES } from "@/config/activities";
import type { GameEvent, Zombie } from "@/engine/core/types";
import { zombieLatLon } from "@/engine/core/movement";
import { haversineM, type LatLon } from "@/geo/geometry";
import { GpsFilter, type FilterVerdict } from "@/gps/filters/filter";
import { GpsProvider, type GeoLike, type GpsErrorCode, type GpsEvent } from "@/gps/provider/provider";
import type { GPSFix, GpsQuality } from "@/gps/types";
import type { TileStore } from "@/data/store";
import type { RouteProposal } from "@/routes/types";
import { proximityRadiusM, VISIBLE_RADIUS_M, START_MAX_ACCURACY_M, START_MOVED_LIMIT_M, type MatchParams } from "./config";
import { FieldLog } from "./fieldlog";
import { HeadingTracker } from "./heading";
import { SpeedTracker } from "./speed";
import { LiveGame } from "./live-game";
import { createLiveMatch, matchDurationS } from "./match";
import { prepareMatch, type Prepared } from "./prepare";
import { MatchStorage, type HistoryRecord } from "./storage";

export type Cue = "danger" | "alert" | "goal" | "info" | "end" | "zombie" | "captured" | "jump" | "tension";

/**
 * Planerar slumpade skrämmor för en match: en första efter 90–420 s speltid och (50 %) en andra 240–480 s senare.
 * Själva skrämman utlöses först när en zombie närmar sig (≤ 200 m) efter den tidpunkten, så den känns motiverad.
 */
export function planScares(random: () => number): number[] {
  const first = 90 + random() * 330;
  const times = [first];
  if (random() < 0.5) times.push(first + 240 + random() * 240);
  return times;
}
export const SCARE_TRIGGER_DISTANCE_M = 200;

/** Minsta tid (ms) mellan två närhetsljud; nya zombier som dyker upp under tiden grupperas till ett ljud. */
export const ZOMBIE_SOUND_COOLDOWN_MS = 12_000;
const CHECK_MS = 1_000;
const SAMPLE_MS = 30_000;
const CUE_MSG_MS = 6_000;

export interface SessionDeps {
  geo: GeoLike | undefined;
  db: Db | null;
  store: TileStore;
  now?: () => number;
  /** Fabrik för intervall så att tester kan styra tiden. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  wakeLock?: { request(): Promise<{ release(): Promise<void> } | null> };
  userAgent?: string;
  traceEnabled?: () => boolean;
  /** Slumpade skrämmor (standard av om utelämnat). Aldrig på cykel. */
  jumpScares?: () => boolean;
  random?: () => number;
  onCue?: (cue: Cue, text: string) => void;
}

export type Stage = "idle" | "locating" | "preparing" | "preview" | "playing" | "finished";

export interface ZombieView {
  id: string;
  edgeId: string;
  distM: number;
  dir: 1 | -1;
  speedMps: number;
  /** Zombien spurtar just nu (dubbel fart). */
  sprinting: boolean;
  lat: number;
  lon: number;
  distanceM: number;
  state: Zombie["state"];
}

export interface SessionView {
  stage: Stage;
  gpsError: { code: GpsErrorCode; message: string } | null;
  position: LatLon | null;
  /** Stabil färdriktning (0–360, 0 = norr) eller null; ren presentation. */
  heading: number | null;
  /** Smoothed player speed (m/s) for display, or null when unknown. */
  speedMps: number | null;
  accuracyM: number | null;
  quality: GpsQuality;
  fixAgeMs: number | null;
  prepared: Prepared | null;
  selected: number;
  params: MatchParams | null;
  /** Spelaren har rört sig för långt från den startpunkt som förslaget gjordes för. */
  movedFromPreview: boolean;
  /** Avstånd (m) mellan din position och förhandsvisningens startpunkt (A), annars null. */
  distToPreviewStartM: number | null;
  match: MatchView | null;
  storageWarning: boolean;
  messages: string[];
  /** Ökar varje gång en slumpad skrämma ska visas. */
  scareNonce: number;
}

export interface MatchView {
  id: string;
  mode: MatchParams["mode"];
  activity: MatchParams["activity"];
  phase: string;
  paused: boolean;
  result: string | undefined;
  elapsedS: number;
  limitS: number;
  distanceM: number;
  /** Zombier inom VISIBLE_RADIUS_M (ritas på kartan). */
  zombiesNear: ZombieView[];
  proximityM: number;
  /** Sekunder kvar av försprånget (zombierna står stilla tills det är slut), annars 0. */
  headStartLeftS: number;
  /** Antal levande zombier i matchen. */
  zombieCount: number;
  /** Avstånd (m) till närmaste zombie oavsett radie, null om inga. */
  nearestZombieM: number | null;
  infection: number;
  objectives: { index: number; total: number; holdS: number; next: { id: string; kind: string; lat: number; lon: number } | null } | null;
  extraction: LatLon | null;
  gpsLost: boolean;
  gpsLostLong: boolean;
  frozen: boolean;
  needsFix: boolean;
  proposal: RouteProposal | null;
}

const SAVE_EVERY_MS = 10_000;
const TICK_MS = 200;

/** Håller ihop GPS, förberedelse, pågående match, lagring och testlogg. Inga DOM-beroenden (injicerat). */
export class PlaySession {
  private readonly now: () => number;
  private readonly provider: GpsProvider;
  private pre = new GpsFilter({ maxPlausibleSpeedMps: ACTIVITIES.mtb.maxPlausibleSpeedMps });
  private lastRaw: GPSFix | null = null;
  private lastAccuracy: number | null = null;
  private gpsError: SessionView["gpsError"] = null;
  private stage: Stage = "idle";
  prepared: Prepared | null = null;
  selected = 0;
  params: MatchParams | null = null;
  private previewStart: LatLon | null = null;
  live: LiveGame | null = null;
  private proposal: RouteProposal | null = null;
  private dataVersion = "";
  private startedAt = 0;
  private storage: MatchStorage | null;
  private log: FieldLog | null = null;
  private timer: unknown = null;
  private lastSaveMs = 0;
  private storageWarning = false;
  private messages: string[] = [];
  private lock: { release(): Promise<void> } | null = null;
  private listeners = new Set<() => void>();
  private version = 0;
  private cached: SessionView | null = null;
  private routeGenMs = 0;
  history: HistoryRecord | null = null;
  private readonly speed = new SpeedTracker();
  private readonly heading = new HeadingTracker();
  /** Zombier som redan har gett närhetsljud (en gång per zombie per match, även om den lämnar och återkommer). */
  private alerted = new Set<string>();
  private pendingZombieSound = false;
  private zombieSoundPlayed = false; // the "zombie" sound plays only once per match (at the start)
  private lastZombieSoundMs = -Infinity;
  private lastCheckMs = 0;
  private lastSampleMs = 0;
  private silentFirstCheck = false;
  private scareTimes: number[] = [];
  private scareNonce = 0;
  private lastDetectCueMs = -Infinity;
  private lastSprintCueMs = -Infinity;
  private cueMsgs: { text: string; until: number }[] = [];

  constructor(private readonly d: SessionDeps) {
    this.now = d.now ?? Date.now;
    this.provider = new GpsProvider(d.geo, this.now);
    this.storage = d.db ? new MatchStorage(d.db) : null;
  }

  // --- abonnemang (React useSyncExternalStore) ---
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => void this.listeners.delete(fn); };
  private lastEmitMs = 0;
  private emit() { this.version++; this.lastEmitMs = this.now(); this.cached = null; this.listeners.forEach((l) => l()); }
  getView = (): SessionView => (this.cached ??= this.buildView());

  // --- GPS ---
  startLocating(): void {
    if (this.provider.running) return;
    if (this.stage === "idle") this.stage = "locating";
    this.provider.start((e) => this.onGps(e));
    this.emit();
  }

  private onGps(e: GpsEvent): void {
    const t = this.now();
    if (e.type === "error") {
      this.gpsError = { code: e.code, message: e.message };
      this.log?.add(t, "gps_error", { code: e.code });
      this.emit();
      return;
    }
    this.gpsError = null;
    this.lastRaw = e.fix;
    this.lastAccuracy = e.fix.accuracyM;
    let verdict: FilterVerdict;
    if (this.live && !this.live.finished) {
      verdict = this.live.pushFix(e.fix, t);
      if (this.log) {
        this.log.trace(t, e.fix.latitude, e.fix.longitude, e.fix.accuracyM);
        if (verdict !== "accepted") this.log.add(t, "fix_" + verdict, { acc: Math.round(e.fix.accuracyM) });
      }
    } else {
      verdict = this.pre.push(e.fix, t).verdict;
    }
    if (verdict === "accepted" || verdict === "reacquired") {
      const pos = this.live && !this.live.finished ? this.live.filter.position : this.pre.position;
      if (verdict === "reacquired") { this.heading.rebase(); this.speed.reset(); }
      if (pos) this.speed.push(pos, t, e.fix.speedMps);
      if (pos) this.heading.update({ pos, accuracyM: e.fix.accuracyM, gpsHeadingDeg: e.fix.headingDeg, gpsSpeedMps: e.fix.speedMps, tMs: e.fix.timestampMs });
    }
    this.emit();
  }

  /** Aktuell startposition för förhandsvisning: filtrerad position med tillräcklig noggrannhet. */
  currentStart(): LatLon | null {
    const p = this.pre.position;
    if (!p) return null;
    const acc = this.lastAccuracy;
    if (acc === null || acc > START_MAX_ACCURACY_M) return null;
    if (this.pre.qualityAt(this.now()) === "unavailable") return null;
    return p;
  }

  // --- förberedelse ---
  async prepare(params: MatchParams): Promise<Prepared | null> {
    const gps = this.currentStart();
    // A TO B: A is always the player's current position; the player only picks B.
    const isAB = params.mode === "escape" && !!params.pointB;
    const start = gps;
    if (!start) {
      this.messages = ["Waiting for a better location signal…"];
      this.emit();
      return null;
    }
    if (isAB) params = { ...params, pointA: start };
    this.stage = "preparing";
    this.params = params;
    this.previewStart = start;
    this.messages = [];
    this.emit();
    const t0 = performance.now();
    try {
      this.prepared = await prepareMatch(this.d.store, start, params);
    } catch (err) {
      this.prepared = { status: "no_route", message: `Map data could not be loaded: ${(err as Error).message}`, proposals: [], notes: [], timing: { loadMs: 0, graphMs: 0, routeMs: 0, totalMs: 0 } };
    }
    this.routeGenMs = performance.now() - t0;
    this.selected = 0;
    this.stage = "preview";
    this.emit();
    return this.prepared;
  }

  select(i: number): void {
    this.selected = i;
    this.emit();
  }

  /** Ny uppsättning förslag från aktuell position (nytt seed). */
  async regenerate(): Promise<void> {
    if (!this.params) return;
    await this.prepare({ ...this.params, seed: (this.params.seed * 1664525 + 1013904223) >>> 0 });
  }

  backToConfig(): void {
    this.stage = this.provider.running ? "locating" : "idle";
    this.prepared = null;
    this.emit();
  }

  // --- match ---
  async startMatch(): Promise<boolean> {
    const prep = this.prepared;
    const params = this.params;
    const start = this.currentStart();
    if (!prep || !params || !prep.graph || !start || prep.status === "off_network" || prep.status === "outside_region" || prep.status === "sparse" || prep.status === "no_route") return false;
    if (this.previewStart && haversineM(start, this.previewStart) > START_MOVED_LIMIT_M) {
      const d = Math.round(haversineM(start, this.previewStart));
      this.messages = [params.mode === "escape" && params.pointB ? `You are ${d} m from A. Go to A to start.` : "You have moved from the start point. Update the route first."];
      this.emit();
      return false;
    }
    const proposal = params.mode === "survival" ? null : (prep.proposals[this.selected] ?? null);
    if (params.mode !== "survival" && !proposal) return false;
    const t = this.now();
    const id = `m${t.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    this.dataVersion = prep.dataVersion ?? "";
    this.proposal = proposal;
    this.startedAt = t;
    this.live = createLiveMatch({ id, params, start, proposal, graph: prep.graph, dataVersion: this.dataVersion });
    if (this.lastRaw) this.live.pushFix(this.lastRaw, t);
    this.attachMatch(true);
    return true;
  }

  private attachMatch(fresh: boolean): void {
    const live = this.live!;
    const params = this.params!;
    const t = this.now();
    this.stage = "playing";
    this.log = new FieldLog(live.state.id, t, this.d.traceEnabled?.() ?? false, this.d.userAgent);
    this.alerted = new Set();
    this.pendingZombieSound = false;
    this.zombieSoundPlayed = false;
    this.lastZombieSoundMs = -Infinity;
    this.lastCheckMs = 0;
    this.lastSampleMs = 0;
    this.silentFirstCheck = !fresh;
    // Slumpade skrämmor (aldrig på cykel och bara om påslaget). Återställd match: planera om från nuvarande speltid.
    const random = this.d.random ?? Math.random;
    this.scareTimes = this.d.jumpScares?.() && params.activity !== "mtb" ? planScares(random).map((x) => x + (fresh ? 0 : live.state.elapsedSeconds)) : [];
    this.log.add(t, "match_start", {
      zombiesInitial: live.state.zombies.length, rulesZombies: { initial: live.rules.initialZombies, max: live.rules.maxZombies, headStartS: live.rules.headStartS, spawnMinM: live.rules.spawnMinDistanceM }, proximityM: proximityRadiusM(params),
      mode: params.mode, activity: params.activity, difficulty: params.difficulty,
      plannedLengthM: this.proposal ? Math.round(this.proposal.lengthM) : null, routeGenerationMs: Math.round(this.routeGenMs),
      tiles: this.prepared?.load ? { n: this.prepared.load.tiles, cache: this.prepared.load.fromCache, net: this.prepared.load.fromNetwork, gzBytes: this.prepared.load.networkGzipBytes } : undefined,
      restored: !fresh,
    });
    if (fresh) void this.persist(true);
    this.lastSaveMs = t;
    this.startTicker();
    this.emit();
  }

  /** Spelaren trycker "Starta"/"Fortsätt". Kräver färsk position. */
  resume(): boolean {
    const live = this.live;
    if (!live || live.finished) return false;
    const t = this.now();
    if (!live.resume(t)) {
      this.messages = ["Waiting for your location before the game can continue."];
      this.emit();
      return false;
    }
    this.messages = [];
    this.log?.add(t, "resume");
    void this.acquireWakeLock();
    void this.persist();
    this.emit();
    return true;
  }

  pause(reason = "manual"): void {
    const live = this.live;
    if (!live || live.finished || live.state.paused) return;
    live.pause();
    this.log?.add(this.now(), "pause", { reason });
    void this.persist();
    this.emit();
  }

  /** Anropas från document.visibilitychange. Bakgrundsläge kan inte ge pålitlig GPS, så spelet pausas alltid. */
  onVisibility(hidden: boolean): void {
    if (hidden) {
      this.pause("hidden");
      void this.releaseWakeLock();
    } else if (this.live && !this.live.finished) {
      this.messages = ["The game paused when the app left the foreground. Tap Continue."];
      this.emit();
    }
  }

  async abort(): Promise<void> {
    const live = this.live;
    if (!live) return;
    this.endMatch(live.abort());
  }

  private startTicker(): void {
    this.stopTicker();
    const si = this.d.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.timer = si(() => this.tick(), TICK_MS);
  }

  private stopTicker(): void {
    if (this.timer !== null) (this.d.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>)))(this.timer);
    this.timer = null;
  }

  tick(): void {
    const live = this.live;
    if (!live) return;
    const t = this.now();
    const before = live.state.paused;
    const events = live.tick(t);
    if (!before && live.state.paused) {
      // Fryst app: spelet pausades av LiveGame.
      this.log?.add(t, "freeze");
      this.messages = ["The app was inactive for a while and the game paused. Tap Continue."];
    }
    if (events.length) this.endMatch(events);
    if (this.stage === "playing" && !live.state.paused && t - this.lastCheckMs >= CHECK_MS) { this.lastCheckMs = t; this.checkZombies(live, t); }
    if (this.stage === "playing" && t - this.lastSaveMs > SAVE_EVERY_MS) void this.persist();
    // React-vyn uppdateras ungefär 2 gånger per sekund; kartan ritar själv från live-objektet.
    if (events.length || t - this.lastEmitMs >= 500) this.emit();
  }

  private endMatch(events: GameEvent[]): void {
    const live = this.live!;
    const t = this.now();
    let finished = false;
    for (const e of events) {
      switch (e.type) {
        case "objective_reached": this.cue("goal", e.index + 1 >= (live.state.objectives?.targets.length ?? 0) ? "Final objective reached" : "Checkpoint reached"); this.log?.add(t, "objective", { id: e.targetId, atS: Math.round(live.state.elapsedSeconds) }); break;
        case "zombie_detected":
          // Med magnet-jakt upptäcker många zombier spelaren samtidigt: ett gemensamt larm, inte ett per zombie.
          if (t - this.lastDetectCueMs > 15_000) { this.lastDetectCueMs = t; this.cue("alert", "Zombies are hunting you"); }
          break;
        case "infection_contact": this.cue("danger", "Zombie close – move away!"); this.log?.add(t, "infection_contact"); break;
        case "zombie_spawned": this.log?.add(t, "zombie_spawned", { id: e.zombieId, n: live.state.zombies.length }); break;
        case "zombie_sprint":
          this.log?.add(t, "zombie_sprint", { id: e.zombieId });
          if (t - this.lastSprintCueMs > 8_000) { this.lastSprintCueMs = t; this.cue("danger", "Zombie sprinting!"); }
          break;
        case "spawn_relaxed": this.log?.add(t, "spawn_relaxed", { n: live.state.zombies.length }); break;
        case "spawn_skipped": this.log?.add(t, "spawn_skipped", { n: live.state.zombies.length, atS: Math.round(live.state.elapsedSeconds) }); break;
        case "extraction_opened": this.cue("info", "Extraction open"); this.log?.add(t, "extraction_opened"); break;
        case "gps_lost_long": this.cue("alert", "Location lost for a while"); this.log?.add(t, "gps_lost_long"); break;
        case "phase": this.log?.add(t, "phase", { phase: e.phase }); break;
        case "finished": finished = true; this.log?.add(t, "finished", { result: e.result }); break;
        default: break;
      }
    }
    if (finished || live.finished) void this.finishMatch();
    else if (events.some((e) => e.type === "objective_reached" || e.type === "phase" || e.type === "infection_contact")) void this.persist();
  }

  /**
   * Närhetsljud och provtagning till testloggen. Ljud triggas av en spelhändelse – en zombie som första gången är inom
   * närhetsradien (geografiskt avstånd) – aldrig av att samma zombie återkommer i en uppdatering. Cooldown och gruppering mot ljudspam.
   */
  private checkZombies(live: LiveGame, t: number): void {
    const s = live.state;
    const pos = live.filter.position ?? s.player.position;
    const radius = this.params ? proximityRadiusM(this.params) : 500;
    let nearest = Infinity;
    let inRange = 0;
    let fresh = 0;
    for (const z of s.zombies) {
      const d = haversineM(zombieLatLon(live.g, z), pos);
      nearest = Math.min(nearest, d);
      if (d > radius) continue;
      inRange++;
      if (!this.alerted.has(z.id)) { this.alerted.add(z.id); fresh++; }
    }
    if (this.silentFirstCheck) { this.silentFirstCheck = false; fresh = 0; } // återställd match: redan kända zombier ger inget ljud
    if (fresh > 0) this.pendingZombieSound = true;
    if (this.pendingZombieSound && !this.zombieSoundPlayed && t - this.lastZombieSoundMs >= ZOMBIE_SOUND_COOLDOWN_MS) {
      this.pendingZombieSound = false;
      this.zombieSoundPlayed = true;
      this.lastZombieSoundMs = t;
      this.cue("zombie", "Zombie approaching");
      this.log?.add(t, "zombie_near_sound", { fresh, inRange });
    }
    if (this.scareTimes.length && s.elapsedSeconds >= this.scareTimes[0] && nearest <= SCARE_TRIGGER_DISTANCE_M && s.phase !== "finished") {
      this.scareTimes.shift();
      this.scareNonce++;
      this.d.onCue?.("jump", "");
      this.log?.add(t, "jump_scare", { atS: Math.round(s.elapsedSeconds), nearestM: Math.round(nearest) });
    }
    if (t - this.lastSampleMs >= SAMPLE_MS) {
      this.lastSampleMs = t;
      this.log?.add(t, "zombie_sample", { n: s.zombies.length, nearest: Number.isFinite(nearest) ? Math.round(nearest) : null, inRange, radius, phase: s.phase, atS: Math.round(s.elapsedSeconds) });
    }
  }

  private cue(c: Cue, text: string) {
    this.d.onCue?.(c, text);
    // Händelsemeddelanden (t.ex. "Zombie nära") visas en kort stund och försvinner sedan av sig själva.
    this.cueMsgs = [{ text, until: this.now() + CUE_MSG_MS }, ...this.cueMsgs.filter((m) => m.text !== text)].slice(0, 3);
  }

  private async finishMatch(): Promise<void> {
    const live = this.live!;
    this.stopTicker();
    await this.releaseWakeLock();
    this.stage = "finished";
    try {
      if (this.storage && this.params) {
        await this.storage.finish(live, this.params, this.proposal);
        const h = (await this.storage.listHistory()).find((x) => x.id === live.state.id) ?? null;
        this.history = h;
        if (h && this.log && this.d.db) {
          this.log.finalize(h, live.counters, { routeGenerationMs: Math.round(this.routeGenMs), dataVersion: this.dataVersion });
          await this.log.save(this.d.db);
        }
      }
    } catch {
      this.storageWarning = true;
    }
    if (live.state.result === "infected") this.cue("captured", "You were captured!");
    else this.cue("end", "Match over");
    this.emit();
  }

  private async persist(first = false): Promise<void> {
    const live = this.live;
    if (!live || !this.storage || !this.params || live.finished) return;
    this.lastSaveMs = this.now();
    try {
      if (first) await this.storage.begin(live, this.params, this.proposal, this.previewStart ?? live.state.player.position, this.dataVersion, this.startedAt);
      else await this.storage.save(live, this.params, this.proposal, this.previewStart ?? live.state.player.position, this.dataVersion);
      if (this.log && this.d.db) await this.log.save(this.d.db);
    } catch {
      this.storageWarning = true;
      this.emit();
    }
  }

  // --- återställning ---
  async restoreActive(): Promise<{ ok: boolean; reason?: string } | null> {
    if (!this.storage) return null;
    const out = await this.storage.loadActive();
    if (!out) return null;
    if (!out.ok) {
      this.messages = [out.reason];
      this.emit();
      return { ok: false, reason: out.reason };
    }
    const r = out.restored;
    this.live = r.live;
    this.params = r.params;
    this.proposal = r.proposal;
    this.previewStart = r.start;
    this.dataVersion = r.dataVersion;
    this.startedAt = r.startedAt;
    this.prepared = null;
    this.attachMatch(false);
    this.messages = ["Match restored and paused. Tap Continue when your location is back."];
    this.startLocating();
    this.emit();
    return { ok: true };
  }

  async hasActive(): Promise<boolean> {
    if (!this.storage) return false;
    // Billig kontroll utan att läsa grafen.
    const out = await this.d.db!.store<string>("meta").get("activeMatchId");
    return !!out;
  }

  // --- wake lock ---
  private async acquireWakeLock() {
    if (this.lock || !this.d.wakeLock) return;
    try { this.lock = await this.d.wakeLock.request(); } catch { this.lock = null; }
  }
  private async releaseWakeLock() {
    try { await this.lock?.release(); } catch { /* ignoreras */ }
    this.lock = null;
  }

  /** Återställer sessionen till startläge (efter avslutad match). */
  reset(): void {
    this.stopTicker();
    this.live = null;
    this.proposal = null;
    this.log = null;
    this.prepared = null;
    this.history = null;
    this.messages = [];
    this.stage = this.provider.running ? "locating" : "idle";
    this.pre = new GpsFilter({ maxPlausibleSpeedMps: ACTIVITIES.mtb.maxPlausibleSpeedMps });
    this.heading.reset();
    this.speed.reset();
    this.emit();
  }

  dispose(): void {
    this.stopTicker();
    this.provider.stop();
    void this.releaseWakeLock();
  }

  get fieldLog(): FieldLog | null { return this.log; }

  // --- vy ---
  private buildView(): SessionView {
    const t = this.now();
    const live = this.live;
    const pos = live ? live.filter.position : this.pre.position;
    const quality = live ? live.quality(t) : this.pre.qualityAt(t);
    const start = this.previewStart;
    const moved = !!(start && pos && haversineM(start, pos) > START_MOVED_LIMIT_M);
    return {
      stage: this.stage,
      gpsError: this.gpsError,
      position: pos,
      heading: this.heading.heading,
      speedMps: this.speed.speedAt(t),
      accuracyM: this.lastAccuracy,
      quality,
      fixAgeMs: live ? live.status(t).fixAgeMs : null,
      prepared: this.prepared,
      selected: this.selected,
      params: this.params,
      movedFromPreview: moved && this.stage === "preview",
      distToPreviewStartM: start && pos ? Math.round(haversineM(start, pos)) : null,
      match: live ? this.matchView(live, t) : null,
      storageWarning: this.storageWarning,
      scareNonce: this.scareNonce,
      messages: [...this.cueMsgs.filter((m) => m.until > t).map((m) => m.text), ...this.messages],
    };
  }

  private matchView(live: LiveGame, t: number): MatchView {
    const s = live.state;
    const pos = live.filter.position ?? s.player.position;
    const aware = this.params ? proximityRadiusM(this.params) : 500;
    const zs: ZombieView[] = s.zombies
      .map((z) => {
        const ll = zombieLatLon(live.g, z);
        return { id: z.id, edgeId: z.edgeId, distM: z.distanceAlongEdgeM, dir: z.dir, speedMps: z.speedMps * (z.sprintUntilS !== undefined ? live.rules.sprintSpeedFactor : 1), sprinting: z.sprintUntilS !== undefined, lat: ll.lat, lon: ll.lon, distanceM: haversineM(ll, pos), state: z.state };
      })
      .sort((a, b) => a.distanceM - b.distanceM);
    const o = s.objectives;
    const next = o && o.index < o.targets.length ? o.targets[o.index] : null;
    const st = live.status(t);
    return {
      id: s.id,
      mode: s.config.mode ?? "survival",
      activity: live.rules.activity,
      phase: s.phase,
      paused: s.paused,
      result: s.result,
      elapsedS: s.elapsedSeconds,
      limitS: s.config.durationSeconds,
      distanceM: s.player.distanceM,
      zombiesNear: zs.filter((z) => z.distanceM <= VISIBLE_RADIUS_M),
      proximityM: aware,
      headStartLeftS: s.phase === "head_start" ? Math.max(0, live.rules.headStartS - s.elapsedSeconds) : 0,
      zombieCount: zs.length,
      nearestZombieM: zs.length ? zs[0].distanceM : null,
      infection: s.infectionProgressSeconds,
      objectives: o ? { index: o.index, total: o.targets.length, holdS: o.holdS, next: next ? { id: next.id, kind: next.kind, lat: next.lat, lon: next.lon } : null } : null,
      extraction: s.extractionNodeId ? (live.g.nodes.get(s.extractionNodeId) ?? null) : null,
      gpsLost: st.quality === "unavailable" || st.quality === "warning",
      gpsLostLong: s.gpsLostLong,
      frozen: live.frozen,
      needsFix: !live.filter.position,
      proposal: this.proposal,
    };
  }
}

export { matchDurationS };
