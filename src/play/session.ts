import type { Db } from "./idb";
import { ACTIVITIES } from "@/config/activities";
import type { GameEvent, Zombie } from "@/engine/core/types";
import { objectiveProgress, type ObjectiveProgress } from "@/engine/objectives/objectives";
import { zombieLatLon } from "@/engine/core/movement";
import { zombieSpeedFactor } from "@/engine/core/engine";
import { haversineM, type LatLon } from "@/geo/geometry";
import { GpsFilter, type FilterVerdict } from "@/gps/filters/filter";
import { GpsProvider, type GeoLike, type GpsErrorCode, type GpsEvent } from "@/gps/provider/provider";
import type { GPSFix, GpsQuality } from "@/gps/types";
import type { TileStore } from "@/data/store";
import type { RouteProposal } from "@/routes/types";
import { applyProfile, proximityRadiusM, START_MAX_ACCURACY_M, START_MOVED_LIMIT_M, type MatchParams } from "./config";
import type { ProductProfile } from "@/config/product";
import { FieldLog } from "./fieldlog";
import { HeadingFusion, HeadingTracker, type FusedHeading, type HeadingSource } from "./heading";
import { RecapRecorder, RecapStore, type RecapStats } from "./recap";
import type { CompassSource, CompassStatus } from "./compass";
import { SpeedTracker } from "./speed";
import { LiveGame } from "./live-game";
import { createLiveMatch, matchDurationS } from "./match";
import { prepareMatch, type Prepared } from "./prepare";
import { MatchStorage, type HistoryRecord } from "./storage";

export type Cue = "danger" | "alert" | "goal" | "info" | "end" | "zombie" | "captured" | "jump" | "tension" | "sprint";

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
/** Skriket + rösten "Run!" vid zombiespurt ljuder högst så här ofta. Med många zombier spurtar någon nästan hela tiden; utan gräns blir det ett konstant skrik. */
export const SPRINT_CUE_COOLDOWN_MS = 25_000;

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
  /** The compass turns the map also while moving (the arrow shows the GPS direction of travel). Read when the compass is turned on. Default on. */
  compassView?: () => boolean;
  /** Slumpade skrämmor (standard av om utelämnat). Aldrig på cykel, och aldrig om produktprofilen stänger av dem. */
  jumpScares?: () => boolean;
  /** Produktprofil (src/config/product.ts): tillåtna aktiviteter och lägen, fiendefart, skrämmor. Utelämnad = vuxenappens beteende. */
  profile?: ProductProfile;
  random?: () => number;
  onCue?: (cue: Cue, text: string) => void;
  /** Kompass (webbläsarens rörelsesensorer). Utelämnad = bara GPS-riktning. */
  compass?: CompassSource;
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
  /** Stabil riktning (0–360, 0 = norr) eller null när den inte går att fastställa; ren presentation. */
  heading: number | null;
  /** Varifrån riktningen kommer: GPS (i rörelse), kompass (stilla), senast gångna ("held") eller ingen. */
  headingSource: HeadingSource;
  /** Kompassens tillstånd: av, på, nekad (rörelsesensorer) eller saknas. */
  compass: CompassStatus;
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
  difficulty: MatchParams["difficulty"];
  phase: string;
  paused: boolean;
  result: string | undefined;
  elapsedS: number;
  limitS: number;
  distanceM: number;
  /** Alla zombier i matchen, närmast först (ritas på kartan oavsett avstånd). */
  zombiesNear: ZombieView[];
  proximityM: number;
  /** Sekunder kvar av försprånget (zombierna står stilla tills det är slut), annars 0. */
  headStartLeftS: number;
  /** Antal levande zombier i matchen. */
  zombieCount: number;
  /** Avstånd (m) till närmaste zombie oavsett radie, null om inga. */
  nearestZombieM: number | null;
  infection: number;
  /** `index`/`total` räknar alla mål inklusive hemkomst; visa i stället `progress` (checkpoints räknas för sig, hem för sig). */
  objectives: { index: number; total: number; holdS: number; next: { id: string; kind: string; lat: number; lon: number } | null; progress: ObjectiveProgress } | null;
  extraction: LatLon | null;
  gpsLost: boolean;
  gpsLostLong: boolean;
  /** Cykel: spelaren är varaktigt utanför det kartlagda nätet. `exposed` = budgeten är slut och zombier som väntar vid vägen kan smitta. */
  offNetwork: { active: boolean; exposed: boolean; budgetLeftS: number } | null;
  /** Numbers for the end of the match (recap); null without a recording. */
  stats: RecapStats | null;
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
  private readonly recaps: RecapStore | null;
  private recorder: RecapRecorder | null = null;
  /** Recap to continue when a restored match is attached (loaded in restoreActive). */
  private resumeRecap: RecapRecorder | null = null;
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
  private readonly fusion = new HeadingFusion();
  private compassStatus: CompassStatus = "off";
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
  /** Alla skrivningar till lagringen går i kö, så en pågående sparning aldrig kan skriva efter att matchen avslutats (och lämna en föräldralös post). */
  private io: Promise<void> = Promise.resolve();

  constructor(private readonly d: SessionDeps) {
    this.now = d.now ?? Date.now;
    this.provider = new GpsProvider(d.geo, this.now);
    this.storage = d.db ? new MatchStorage(d.db) : null;
    this.recaps = d.db ? new RecapStore(d.db) : null;
    // Match recaps (tracks) are kept a week, then deleted.
    void this.recaps?.purge(this.now()).catch(() => undefined);
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
      this.fusion.pushGps(this.heading.heading, this.speed.speedAt(t), t);
      this.logHeading(t);
    }
    this.emit();
  }

  /**
   * Slår på kompassen. Måste anropas från en användargest (iOS frågar då om tillstånd för rörelsesensorer). Ofarlig att anropa flera gånger.
   * Utan kompass fungerar Track Up ändå med GPS-riktningen när man rör sig.
   */
  async enableCompass(): Promise<CompassStatus> {
    this.fusion.compassView = this.d.compassView?.() ?? true;
    if (this.compassStatus === "on") return "on";
    if (!this.d.compass) { this.compassStatus = "unsupported"; this.emit(); return this.compassStatus; }
    try {
      const r = await this.d.compass.start((s) => this.fusion.pushCompass(s.headingDeg, this.now()));
      this.compassStatus = r === "granted" ? "on" : r;
    } catch {
      this.compassStatus = "denied";
    }
    this.emit();
    return this.compassStatus;
  }

  /** The setting "Compass turns the map" changed: applies at once. */
  setCompassView(on: boolean): void {
    this.fusion.compassView = on;
  }

  /** Aktuell riktning utan att vänta på nästa vy-uppdatering (kartan läser den varje bildruta). */
  liveHeading(): FusedHeading {
    return this.fusion.get(this.now());
  }

  private lastHeadingLogMs = -Infinity;
  /** Field log: compass against GPS course while moving, every 10 s, so a mount's compass error and noise can be read after a ride. */
  private logHeading(t: number): void {
    if (!this.log || t - this.lastHeadingLogMs < 10_000) return;
    const d = this.fusion.disagreement(t);
    if (!d) return;
    this.lastHeadingLogMs = t;
    const r = (x: number) => Math.round(x);
    this.log.add(t, "heading", { gps: r(d.gpsDeg), compass: r(d.compassDeg), bias: r(d.biasDeg), err: r(d.errDeg), view: this.fusion.compassView });
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
    const allowed = applyProfile(params, this.d.profile);
    if (!allowed) {
      this.messages = ["This option is not available in this app."];
      this.emit();
      return null;
    }
    params = allowed;
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
    const params = this.params && applyProfile(this.params, this.d.profile);
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
    this.recorder = fresh || !this.resumeRecap ? RecapRecorder.fresh(live, params, this.startedAt) : this.resumeRecap;
    this.resumeRecap = null;
    // Slumpade skrämmor (aldrig på cykel och bara om påslaget). Återställd match: planera om från nuvarande speltid.
    const random = this.d.random ?? Math.random;
    this.scareTimes = this.d.jumpScares?.() && (this.d.profile?.jumpScares ?? true) && params.activity !== "mtb" ? planScares(random).map((x) => x + (fresh ? 0 : live.state.elapsedSeconds)) : [];
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

  /**
   * Anropas från document.visibilitychange. Ett appbyte pausar inte spelet: se BACKGROUND_GRACE_MS. Mobilwebbläsare kan strypa eller stoppa
   * både GPS och timers i bakgrunden, så ingenting antas köra där; vid återkomst simuleras den bortavarande tiden (eller spelet pausas om
   * frånvaron var lång) och GPS-bevakningen startas om, eftersom iOS ibland tappar den.
   */
  onVisibility(hidden: boolean): void {
    const t = this.now();
    const live = this.live;
    if (hidden) {
      void this.releaseWakeLock();
      if (live && !live.finished && !live.state.paused) {
        live.enterBackground(t);
        this.log?.add(t, "background");
        void this.persist(); // om webbläsaren avslutar sidan i bakgrunden kan matchen återställas
      }
      return;
    }
    this.refreshGps();
    if (!live || live.finished) return;
    const r = live.leaveBackground(t);
    if (r.paused) {
      this.log?.add(t, "pause", { reason: "background_long", awayS: Math.round(r.awayMs / 1000) });
      this.messages = [`You were away for ${Math.round(r.awayMs / 1000)} s and the game paused. Tap Continue.`];
      void this.persist();
    } else if (r.awayMs > 0) {
      this.log?.add(t, "background_return", { awayS: Math.round(r.awayMs / 1000), shielded: r.shielded });
      if (r.events.length) this.endMatch(r.events);
      if (!live.finished && !live.state.paused) void this.acquireWakeLock();
    }
    this.emit();
  }

  /** Startar om GPS-bevakningen (efter bakgrundsläge eller återställning) utan att röra spelet. */
  refreshGps(): void {
    if (this.provider.running) this.provider.start((e) => this.onGps(e));
  }

  /** Sidan göms eller stängs: spara ögonblicksbilden så att matchen kan återställas. */
  onPageHide(): void {
    void this.persist();
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
    if (!live.finished) this.recorder?.tick(live);
    if (this.stage === "playing" && !live.state.paused && t - this.lastCheckMs >= CHECK_MS) { this.lastCheckMs = t; this.checkZombies(live, t); }
    if (this.stage === "playing" && t - this.lastSaveMs > SAVE_EVERY_MS) void this.persist();
    // React-vyn uppdateras ungefär 2 gånger per sekund; kartan ritar själv från live-objektet.
    if (events.length || t - this.lastEmitMs >= 500) this.emit();
  }

  private endMatch(events: GameEvent[]): void {
    const live = this.live!;
    const t = this.now();
    let finished = false;
    this.recorder?.events(events);
    for (const e of events) {
      switch (e.type) {
        case "objective_reached": this.cue("goal", this.objectiveMessage(live, e.index)); this.log?.add(t, "objective", { id: e.targetId, atS: Math.round(live.state.elapsedSeconds) }); break;
        case "zombie_detected":
          // Med magnet-jakt upptäcker många zombier spelaren samtidigt: ett gemensamt larm, inte ett per zombie.
          if (t - this.lastDetectCueMs > 15_000) { this.lastDetectCueMs = t; this.cue("alert", "Zombies are hunting you"); }
          break;
        case "infection_contact": this.cue("danger", "Zombie close – move away!"); this.log?.add(t, "infection_contact"); break;
        case "zombie_spawned": this.log?.add(t, "zombie_spawned", { id: e.zombieId, n: live.state.zombies.length }); break;
        case "zombie_culled": this.log?.add(t, "zombie_culled", { id: e.zombieId, n: live.state.zombies.length }); break;
        case "zombie_sprint":
          this.log?.add(t, "zombie_sprint", { id: e.zombieId });
          if (t - this.lastSprintCueMs > SPRINT_CUE_COOLDOWN_MS) { this.lastSprintCueMs = t; this.cue("sprint", "Zombie sprinting!"); }
          break;
        case "spawn_relaxed": this.log?.add(t, "spawn_relaxed", { n: live.state.zombies.length }); break;
        case "spawn_skipped": this.log?.add(t, "spawn_skipped", { n: live.state.zombies.length, atS: Math.round(live.state.elapsedSeconds) }); break;
        case "extraction_opened": this.cue("info", "Extraction open"); this.log?.add(t, "extraction_opened"); break;
        case "gps_lost_long": this.cue("alert", "Location lost for a while"); this.log?.add(t, "gps_lost_long"); break;
        case "off_network":
          this.log?.add(t, "off_network", { change: e.change, budgetS: Math.round(live.state.offNetwork?.budgetS ?? 0), offsetM: Math.round(live.state.offNetwork?.offsetM ?? 0) });
          if (e.change === "entered") this.cue("alert", "You are off the road network. Zombies are closing in on the nearest road.");
          else if (e.change === "exposed") this.cue("danger", "Zombies have found you. Get back to the road!");
          break;
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

  /** Text för ett nått mål. Sista checkpointet är inte en vinst när hemkomst återstår, och säger det. */
  private objectiveMessage(live: LiveGame, index: number): string {
    const o = live.state.objectives;
    if (!o) return "Objective reached";
    const target = o.targets[index];
    const p = objectiveProgress(o);
    if (target?.kind === "checkpoint") return p.stage === "home" ? "All checkpoints found – now head home!" : `Checkpoint ${p.primaryReached}/${p.primaryTotal}`;
    return p.stage === "done" ? "Final objective reached" : "Objective reached";
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
        const storage = this.storage, params = this.params, proposal = this.proposal;
        const rec = this.recorder;
        rec?.finish(live, live.state.result ?? "incomplete");
        await this.enqueue(async () => {
          await storage.finish(live, params, proposal);
          if (rec) {
            await storage.setStats(live.state.id, { ...rec.stats });
            if (this.recaps) await this.recaps.write(rec.take());
          }
          const h = (await storage.listHistory()).find((x) => x.id === live.state.id) ?? null;
          if (this.live === live) this.history = h; // inte om spelaren redan gått vidare (reset)
          if (h && this.log && this.d.db && this.live === live) {
            this.log.finalize(h, live.counters, { routeGenerationMs: Math.round(this.routeGenMs), dataVersion: this.dataVersion });
            await this.log.save(this.d.db);
          }
        });
      }
    } catch {
      this.storageWarning = true;
    }
    if (this.live !== live) return; // återställd medan vi sparade
    if (live.state.result === "infected") this.cue("captured", "You were captured!");
    else this.cue("end", "Match over");
    this.emit();
  }

  /** Kör lagringsarbete i tur och ordning. Ett fel i ett steg stoppar inte nästa. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.io.then(fn, fn);
    this.io = run.then(() => undefined, () => undefined);
    return run;
  }

  private async persist(first = false): Promise<void> {
    const live = this.live;
    if (!live || !this.storage || !this.params || live.finished) return;
    const storage = this.storage, params = this.params, proposal = this.proposal;
    const start = this.previewStart ?? live.state.player.position, dataVersion = this.dataVersion, startedAt = this.startedAt;
    this.lastSaveMs = this.now();
    try {
      await this.enqueue(async () => {
        if (live.finished || this.live !== live) return; // matchen hann avslutas innan det blev vår tur
        if (first) await storage.begin(live, params, proposal, start, dataVersion, startedAt);
        else await storage.save(live, params, proposal, start, dataVersion);
        const rec = this.recorder;
        if (rec?.pending && this.recaps && !live.finished) await this.recaps.write(rec.take());
        if (this.log && this.d.db) await this.log.save(this.d.db);
      });
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
    const allowed = applyProfile(r.params, this.d.profile);
    if (!allowed || allowed !== r.params) {
      // Sparad med inställningar som den här appen inte erbjuder (t.ex. cykel eller annan fiendefart): avsluta kontrollerat i stället för att återuppta.
      const reason = "The saved match uses settings that are not available in this app.";
      try { await this.enqueue(() => this.storage!.finish(r.live, r.params, r.proposal, "interrupted")); } catch { this.storageWarning = true; }
      this.messages = [reason];
      this.emit();
      return { ok: false, reason };
    }
    try {
      const meta = await this.recaps?.meta(r.live.state.id);
      this.resumeRecap = meta ? RecapRecorder.resume(meta, await this.recaps!.lastChunk(meta.id, meta.chunks), r.live) : null;
    } catch { this.resumeRecap = null; }
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

  /** PLAY AGAIN: the finished match's settings, for New game to pick up and make a new course from. */
  private again: MatchParams | null = null;
  playAgain(): void {
    this.again = this.params ? { ...this.params, pointA: null, seed: Math.floor(Math.random() * 1e9) } : null;
    this.reset();
  }
  /** The settings PLAY AGAIN left (once). */
  takeAgain(): MatchParams | null {
    const a = this.again;
    this.again = null;
    return a;
  }

  /** Återställer sessionen till startläge (efter avslutad match). */
  reset(): void {
    this.stopTicker();
    this.live = null;
    this.recorder = null;
    this.proposal = null;
    this.log = null;
    this.prepared = null;
    this.history = null;
    this.messages = [];
    this.stage = this.provider.running ? "locating" : "idle";
    this.pre = new GpsFilter({ maxPlausibleSpeedMps: ACTIVITIES.mtb.maxPlausibleSpeedMps });
    this.heading.reset();
    this.fusion.reset();
    this.speed.reset();
    // Nytt förfilter har ingen position, och en stillastående iPhone skickar inga nya fixar av sig själv: be om en direkt.
    this.refreshGps();
    this.emit();
  }

  dispose(): void {
    this.d.compass?.stop();
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
      heading: this.fusion.get(t).deg,
      headingSource: this.fusion.get(t).source,
      compass: this.compassStatus,
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
        return { id: z.id, edgeId: z.edgeId, distM: z.distanceAlongEdgeM, dir: z.dir, speedMps: z.speedMps * zombieSpeedFactor(live.rules, z, s.elapsedSeconds), sprinting: z.sprintUntilS !== undefined, lat: ll.lat, lon: ll.lon, distanceM: haversineM(ll, pos), state: z.state };
      })
      .sort((a, b) => a.distanceM - b.distanceM);
    const o = s.objectives;
    const next = o && o.index < o.targets.length ? o.targets[o.index] : null;
    const st = live.status(t);
    return {
      id: s.id,
      mode: s.config.mode ?? "survival",
      activity: live.rules.activity,
      difficulty: live.rules.difficulty,
      phase: s.phase,
      paused: s.paused,
      result: s.result,
      elapsedS: s.elapsedSeconds,
      limitS: s.config.durationSeconds,
      distanceM: s.player.distanceM,
      // Every zombie is drawn, however far away: a map without zombies at the start looked like a bug (field test, Bike Survival).
      zombiesNear: zs,
      proximityM: aware,
      headStartLeftS: s.phase === "head_start" ? Math.max(0, live.rules.headStartS - s.elapsedSeconds) : 0,
      zombieCount: zs.length,
      nearestZombieM: zs.length ? zs[0].distanceM : null,
      infection: s.infectionProgressSeconds,
      objectives: o ? { index: o.index, total: o.targets.length, holdS: o.holdS, next: next ? { id: next.id, kind: next.kind, lat: next.lat, lon: next.lon } : null, progress: objectiveProgress(o) } : null,
      extraction: s.extractionNodeId ? (live.g.nodes.get(s.extractionNodeId) ?? null) : null,
      gpsLost: st.quality === "unavailable" || st.quality === "warning",
      gpsLostLong: s.gpsLostLong,
      stats: this.recorder ? { ...this.recorder.stats } : null,
      offNetwork: s.offNetwork && live.rules.offNetworkExposure ? { active: s.offNetwork.active, exposed: s.offNetwork.active && s.offNetwork.budgetS <= 0, budgetLeftS: Math.ceil(s.offNetwork.budgetS) } : null,
      frozen: live.frozen,
      needsFix: !live.filter.position,
      proposal: this.proposal,
    };
  }
}

export { matchDurationS };
