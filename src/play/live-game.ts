import { ACTIVITIES } from "@/config/activities";
import { RESUME_NEUTRAL_S, STEP_S, type Rules } from "@/config/game-rules";
import { resolveModeRules } from "@/config/modes";
import { abortGame, pauseGame, resumeGame, stepGame } from "@/engine/core/engine";
import type { GameEvent, GameState } from "@/engine/core/types";
import { zombieLatLon } from "@/engine/core/movement";
import { haversineM, type LatLon } from "@/geo/geometry";
import type { TrailGraph } from "@/geo/graph/types";
import { GpsFilter, type FilterVerdict } from "@/gps/filters/filter";
import type { GPSFix, GpsQuality } from "@/gps/types";

/**
 * En position äldre än så här (sedan senaste godkända fix) får inte ligga till grund för infektion.
 * Gränsen är kortare än infektionstiden (3 s), så en enda fix kan aldrig ensam orsaka en infektion.
 */
export const FIX_FRESH_MS = 2_500;
/** Längre gap mellan två tick räknas som att appen frysts (t.ex. skärmlås). Spelet pausas då i stället för att "ta igen" tid. */
export const FROZEN_GAP_MS = 5_000;
/** Gap över detta (men under FROZEN) släpper tiden utan att simulera den. */
const LOST_TICK_GAP_MS = 1_500;
const MAX_STEPS_PER_TICK = 25;
/**
 * Hur länge appen får ligga i bakgrunden (appbyte, kort skärmlås) utan att spelet pausas. Tiden räknas som speltid och zombierna rör sig
 * under den (så ett appbyte är ingen gratis paus), men ingen kan smittas av att man är borta (infektionen förblir av tills en färsk fix
 * finns och den neutrala perioden gått). Längre frånvaro pausar spelet och tiden räknas inte, precis som vid GPS-bortfall.
 * Mobilwebbläsare stryper GPS och timers i bakgrunden, så vi simulerar efteråt i stället för att lita på att något körs där.
 */
export const BACKGROUND_GRACE_MS = 45_000;
/**
 * Skyddet mot smitta under frånvaron gäller bara om ingen zombie var så här nära när appen lämnades. Annars gäller spelaren som stillastående på sin
 * senast kända plats och kan smittas där: att titta bort när man är jagad ger ingen räddning. Annars vore "dölj appen och spring" ett sätt att tappa bort jagarna.
 */
export const SHIELD_DANGER_M = 150;
/** Högst så här lång skyddad frånvaro per glidande fönster, så att korta frånvaron inte kan staplas till ett permanent skydd. */
export const SHIELD_BUDGET_MS = 60_000;
export const SHIELD_WINDOW_MS = 300_000;

const SEVERITY: Record<GpsQuality, number> = { ok: 0, verify: 1, infection_paused: 2, warning: 3, unavailable: 4 };
const worse = (a: GpsQuality, b: GpsQuality): GpsQuality => (SEVERITY[a] >= SEVERITY[b] ? a : b);

export interface FixCounters {
  fixes: number;
  accepted: number;
  invalid: number;
  stale: number;
  jumps: number;
  reacquired: number;
  dropouts: number;
  dropoutS: number;
  longestDropoutS: number;
  freezes: number;
  accuracySumM: number;
  accuracyMaxM: number;
}

export const emptyCounters = (): FixCounters => ({
  fixes: 0, accepted: 0, invalid: 0, stale: 0, jumps: 0, reacquired: 0, dropouts: 0, dropoutS: 0,
  longestDropoutS: 0, freezes: 0, accuracySumM: 0, accuracyMaxM: 0,
});

export interface LastFix {
  lat: number;
  lon: number;
  accuracyM: number;
  atMs: number;
}

export interface LiveStatus {
  quality: GpsQuality;
  accuracyM: number | null;
  /** Ålder (ms) på senaste godkända fix, null om ingen. */
  fixAgeMs: number | null;
  position: LatLon | null;
  paused: boolean;
  frozen: boolean;
}

/**
 * Kopplar riktiga GPS-fixar till spelmotorn (samma `stepGame` som simuleringarna).
 * - Fixar går genom GpsFilter. Avvisade fixar (ogiltiga, gamla, hopp) påverkar aldrig spelet.
 * - Spelklockan går i fasta steg från väggklockan. Utan färsk position stannar infektionen (>3 s) och därefter hela spelet (>5 s):
 *   klockan och zombierna pausas lika mycket, och ingen smitta registreras från en gissad position.
 * - Frysta tick (appen i bakgrunden/skärmlås) tas inte igen; spelet pausas och återupptas manuellt med neutral period.
 */
export class LiveGame {
  readonly filter: GpsFilter;
  counters: FixCounters = emptyCounters();
  fixSeq = 0;
  lastFix: LastFix | null = null;
  private lastAcceptedAtMs: number | null = null;
  private lastTickMs: number | null = null;
  private accS = 0;
  private dropoutStartMs: number | null = null;
  /** Spelets egen paus (användare/bakgrund/fryst) – skild från GPS-bortfall. */
  frozen = false;
  /** Sätts när appen lämnar förgrunden medan spelet pågår; null annars. */
  private backgroundSinceMs: number | null = null;
  /** Närmaste zombie (m) när appen lämnades; null om okänd. */
  private nearestAtDepartureM: number | null = null;
  /** Tidigare skyddad frånvaro (klockslag + längd) inom fönstret. Sparas inte; nollställs vid återställning. */
  private shieldUse: { atMs: number; ms: number }[] = [];

  constructor(
    readonly g: TrailGraph,
    readonly state: GameState,
    readonly rules: Rules,
  ) {
    this.filter = new GpsFilter({ maxPlausibleSpeedMps: ACTIVITIES[state.config.activity].maxPlausibleSpeedMps });
    if (!state.paused) pauseGame(state); // Spelet startar pausat tills första fixen är på plats och spelaren trycker start/fortsätt.
  }

  /**
   * Återställer en sparad match: motorns tillstånd (inkl. RNG och zombie-AI) är oförändrat. Filtret börjar tomt:
   * ingen position gäller förrän nya fixar kommit, och spelet förblir pausat tills spelaren fortsätter.
   */
  static restore(g: TrailGraph, state: GameState, params: { activity: GameState["config"]["activity"]; mode: GameState["config"]["mode"]; difficulty: GameState["config"]["difficulty"] }, proposal: unknown, counters: FixCounters, lastFix: LastFix | null, fixSeq: number): LiveGame {
    void proposal;
    const dest = state.objectives?.targets.find((t) => t.kind === "destination");
    const rules = resolveModeRules(params.mode ?? "survival", params.activity, params.difficulty, state.config.durationSeconds, undefined, dest && state.startPos ? haversineM(state.startPos, dest) : undefined);
    const live = new LiveGame(g, state, rules);
    live.counters = counters;
    live.lastFix = lastFix;
    live.fixSeq = fixSeq;
    live.frozen = true;
    return live;
  }

  /** Mata in en rå GPS-fix. Returnerar filtrets utfall. */
  pushFix(fix: GPSFix, nowMs: number): FilterVerdict {
    const c = this.counters;
    c.fixes++;
    const out = this.filter.push(fix, nowMs);
    switch (out.verdict) {
      case "invalid": c.invalid++; break;
      case "stale": c.stale++; break;
      case "jump": c.jumps++; break;
      case "reacquired": c.reacquired++; c.accepted++; this.accept(fix, nowMs); break;
      case "accepted": c.accepted++; this.accept(fix, nowMs); break;
    }
    return out.verdict;
  }

  private accept(fix: GPSFix, nowMs: number) {
    this.fixSeq++;
    this.lastAcceptedAtMs = nowMs;
    this.lastFix = { lat: fix.latitude, lon: fix.longitude, accuracyM: fix.accuracyM, atMs: nowMs };
    this.counters.accuracySumM += fix.accuracyM;
    this.counters.accuracyMaxM = Math.max(this.counters.accuracyMaxM, fix.accuracyM);
    if (this.dropoutStartMs !== null) {
      const gap = (nowMs - this.dropoutStartMs) / 1000;
      this.counters.dropoutS += gap;
      this.counters.longestDropoutS = Math.max(this.counters.longestDropoutS, gap);
      this.dropoutStartMs = null;
    }
  }

  /** Kvalitet som motorn ska agera på just nu. */
  quality(nowMs: number): GpsQuality {
    let q = this.filter.qualityAt(nowMs);
    if (q !== "unavailable" && this.lastAcceptedAtMs !== null && nowMs - this.lastAcceptedAtMs > FIX_FRESH_MS) q = worse(q, "infection_paused");
    return q;
  }

  status(nowMs: number): LiveStatus {
    return {
      quality: this.quality(nowMs),
      accuracyM: this.lastFix?.accuracyM ?? null,
      fixAgeMs: this.lastAcceptedAtMs === null ? null : nowMs - this.lastAcceptedAtMs,
      position: this.filter.position,
      paused: this.state.paused,
      frozen: this.frozen,
    };
  }

  pause(): void {
    pauseGame(this.state);
    this.lastTickMs = null;
    this.backgroundSinceMs = null;
  }

  /** Återupptar. Kräver färsk position; annars returneras false och spelet förblir pausat. */
  resume(nowMs: number): boolean {
    if (this.state.phase === "finished") return false;
    if (this.quality(nowMs) === "unavailable" || !this.filter.position) return false;
    resumeGame(this.state);
    this.frozen = false;
    this.lastTickMs = nowMs;
    this.accS = 0;
    return true;
  }

  abort(): GameEvent[] {
    return abortGame(this.state, "aborted");
  }

  /** Appen lämnar förgrunden. Spelet fortsätter inte att simuleras förrän vi är tillbaka (se BACKGROUND_GRACE_MS). */
  enterBackground(nowMs: number): void {
    if (this.state.phase === "finished" || this.state.paused || this.backgroundSinceMs !== null) return;
    this.backgroundSinceMs = nowMs;
    const pos = this.filter.position;
    this.nearestAtDepartureM = pos && this.state.zombies.length ? Math.min(...this.state.zombies.map((z) => haversineM(zombieLatLon(this.g, z), pos))) : null;
  }

  get inBackground(): boolean {
    return this.backgroundSinceMs !== null;
  }

  /**
   * Appen är tillbaka. Kort frånvaro: spelet hinner ikapp (zombierna rör sig, klockan går) med infektion avstängd under frånvaron och en
   * neutral period efteråt. Lång frånvaro, eller ingen känd position: spelet pausas och tiden räknas inte.
   */
  leaveBackground(nowMs: number): { awayMs: number; paused: boolean; shielded: boolean; events: GameEvent[] } {
    const since = this.backgroundSinceMs;
    this.backgroundSinceMs = null;
    const s = this.state;
    if (since === null || s.phase === "finished" || s.paused) return { awayMs: 0, paused: false, shielded: false, events: [] };
    const awayMs = Math.max(0, nowMs - since);
    const pos = this.filter.position;
    if (awayMs > BACKGROUND_GRACE_MS || !pos) {
      this.counters.freezes++;
      this.frozen = true;
      pauseGame(s);
      this.lastTickMs = null;
      return { awayMs, paused: true, shielded: false, events: [] };
    }
    // Skydd: inga zombier nära när appen lämnades, och budgeten inte slut. Annars gäller spelaren som stillastående och sårbar på senast kända plats.
    this.shieldUse = this.shieldUse.filter((u) => nowMs - u.atMs < SHIELD_WINDOW_MS);
    const used = this.shieldUse.reduce((a, u) => a + u.ms, 0);
    const shielded = (this.nearestAtDepartureM === null || this.nearestAtDepartureM > SHIELD_DANGER_M) && used + awayMs <= SHIELD_BUDGET_MS;
    if (shielded) this.shieldUse.push({ atMs: nowMs, ms: awayMs });
    const events: GameEvent[] = [];
    const acc = this.lastFix?.accuracyM ?? 99;
    const steps = Math.floor(awayMs / 1000 / STEP_S);
    for (let i = 0; i < steps && !this.finished; i++) {
      events.push(...stepGame(this.g, s, this.rules, { position: pos, quality: shielded ? "infection_paused" : "ok", accuracyM: shielded ? acc : Math.min(acc, 8), fixSeq: this.fixSeq }));
    }
    if (!this.finished) s.neutralUntilS = Math.max(s.neutralUntilS, s.elapsedSeconds + RESUME_NEUTRAL_S);
    this.lastTickMs = nowMs;
    this.accS = 0;
    return { awayMs, paused: false, shielded, events };
  }

  /** Avancerar spelet till `nowMs` i fasta motorsteg. Returnerar händelserna. */
  tick(nowMs: number): GameEvent[] {
    const s = this.state;
    if (s.phase === "finished" || s.paused) {
      this.lastTickMs = nowMs;
      return [];
    }
    // Appen är i bakgrunden: ingenting simuleras här; leaveBackground tar igen tiden (eller pausar) när vi är tillbaka.
    if (this.backgroundSinceMs !== null) return [];
    const last = this.lastTickMs ?? nowMs;
    this.lastTickMs = nowMs;
    const gap = nowMs - last;
    if (gap > FROZEN_GAP_MS) {
      // Appen har varit fryst: pausa hellre än att simulera tid vi inte har sett.
      this.counters.freezes++;
      this.frozen = true;
      pauseGame(s);
      return [];
    }
    if (gap > LOST_TICK_GAP_MS) this.counters.freezes++; // för stort hack: släpp tiden utan att simulera den
    else this.accS += gap / 1000;
    const events: GameEvent[] = [];
    const pos = this.filter.position;
    const q = this.quality(nowMs);
    // Registrera bortfall för loggen.
    if ((q === "unavailable" || !pos) && this.dropoutStartMs === null && this.lastAcceptedAtMs !== null) {
      this.dropoutStartMs = this.lastAcceptedAtMs;
      this.counters.dropouts++;
    }
    const acc = this.lastFix?.accuracyM ?? 99;
    for (let i = 0; i < MAX_STEPS_PER_TICK && this.accS >= STEP_S - 1e-9 && !this.finished; i++) {
      this.accS -= STEP_S;
      events.push(...stepGame(this.g, s, this.rules, { position: pos, quality: q, accuracyM: acc, fixSeq: this.fixSeq }));
    }
    if (this.accS > 1) this.accS = 1; // aldrig mer än 1 s eftersläpning
    return events;
  }

  get finished(): boolean {
    return this.state.phase === "finished";
  }

  /** Avstånd (m) från senaste godkända position till en punkt. */
  distanceTo(p: LatLon): number | null {
    const pos = this.filter.position;
    return pos ? haversineM(pos, p) : null;
  }
}
