import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import { prepareMatch, type Prepared } from "@/play/prepare";
import { defaultParams, withActivity, type MatchParams } from "@/play/config";
import { createLiveMatch } from "@/play/match";
import { FIX_FRESH_MS, type LiveGame } from "@/play/live-game";
import { haversineM, pointAlong, fromLocal, type LatLon } from "@/geo/geometry";
import { rand } from "@/engine/core/rng";
import type { GPSFix } from "@/gps/types";
import { zombieLatLon } from "@/engine/core/movement";
import { destinationPoint } from "./helpers";

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => {
  const rel = url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "");
  const body = JSON.parse(readFileSync(path.join(root, rel), "utf8"));
  return { ok: true, status: 200, json: async () => body };
};
const START: LatLon = { lat: 59.40731, lon: 13.46753 };

let prepared: Record<string, Prepared> = {};
beforeAll(async () => {
  for (const mode of ["mission", "escape", "survival"] as const) {
    const p = { ...defaultParams("walk"), mode, seed: 5 };
    prepared[mode] = await prepareMatch(new TileStore("/data/v1/varmland", fsFetch), START, p);
  }
}, 60000);

const params = (mode: MatchParams["mode"], over: Partial<MatchParams> = {}): MatchParams => ({ ...withActivity(defaultParams("walk"), "walk"), mode, seed: 5, ...over });

function newLive(mode: "mission" | "escape" | "survival", over: Partial<MatchParams> = {}): { live: LiveGame; p: MatchParams } {
  const prep = prepared[mode];
  const p = params(mode, over);
  const proposal = prep.proposals[0] ?? null;
  const live = createLiveMatch({ id: `t-${mode}`, params: p, start: START, proposal, graph: prep.graph!, dataVersion: "test" });
  return { live, p };
}

let seed = 1;
const gauss = () => {
  const h = { rngState: seed++ };
  const u = Math.max(1e-9, rand(h));
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand(h));
};

const fixAt = (p: LatLon, acc: number, nowMs: number, noiseM = 0): GPSFix => {
  const q = noiseM ? fromLocal(p, { x: gauss() * noiseM, y: gauss() * noiseM }) : p;
  return { latitude: q.lat, longitude: q.lon, accuracyM: acc, timestampMs: nowMs };
};

/** Kör `seconds` sekunder med ett fix/s på `pos`. Returnerar nya klockan. */
function stand(live: LiveGame, pos: LatLon, acc: number, now: number, seconds: number, noiseM = 0, fixesPerSec = 1): number {
  const dtMs = 1000 / fixesPerSec;
  let t = now;
  for (let i = 0; i < seconds * fixesPerSec; i++) {
    for (let k = 0; k < 5 / fixesPerSec; k++) { t += 200; live.tick(t); }
    live.pushFix(fixAt(pos, acc, t, noiseM), t);
  }
  void dtMs;
  return t;
}

function clearZombies(live: LiveGame) {
  live.state.zombies = [];
  Object.assign(live.rules, { initialZombies: 0, maxZombies: 0, growthPerMin: 0 });
}

describe("LiveGame: GPS → motor", () => {
  it("brusiga fixar vid ett checkpoint registrerar målet först efter 5 s och minst 3 fixar", () => {
    const { live } = newLive("mission");
    clearZombies(live);
    const target = live.state.objectives!.targets[0];
    let t = 1_000_000;
    // Ett första bra fix vid start, sedan fortsätt.
    live.pushFix(fixAt(START, 6, t), t);
    expect(live.resume(t)).toBe(true);
    t = stand(live, target, 6, t, 3, 3);
    expect(live.state.objectives!.index).toBe(0); // fortfarande bara 3 s
    t = stand(live, target, 6, t, 5, 3);
    expect(live.state.objectives!.index).toBe(1);
  });

  it("brus utanför radien ger aldrig falska checkpoints (45 m bort, accuracy 15 m, σ 8 m, 5 min)", () => {
    const { live } = newLive("mission");
    clearZombies(live);
    const target = live.state.objectives!.targets[0];
    const away = destinationPoint(target, 45, 80);
    let t = 2_000_000;
    live.pushFix(fixAt(away, 12, t), t);
    live.resume(t);
    t = stand(live, away, 12, t, 300, 8);
    expect(live.state.objectives!.index).toBe(0);
  });

  it("verify (accuracy 18 m) kräver marginal: 28 m räknas inte, 12 m räknas", () => {
    const { live } = newLive("mission");
    clearZombies(live);
    const target = live.state.objectives!.targets[0];
    let t = 3_000_000;
    const near28 = destinationPoint(target, 28, 10);
    live.pushFix(fixAt(near28, 18, t), t);
    live.resume(t);
    t = stand(live, near28, 18, t, 20);
    expect(live.state.objectives!.index).toBe(0);
    const near12 = destinationPoint(target, 12, 10);
    t = stand(live, near12, 18, t, 25); // Kalman-utjämningen behöver några sekunder att flytta sig
    expect(live.state.objectives!.index).toBe(1);
  });

  it("en enda dålig fix som hoppar till målet registrerar inget", () => {
    const { live } = newLive("mission");
    clearZombies(live);
    const target = live.state.objectives!.targets[0];
    let t = 4_000_000;
    live.pushFix(fixAt(START, 5, t), t);
    live.resume(t);
    t = stand(live, START, 5, t, 10);
    const v = live.pushFix(fixAt(target, 5, t + 1000), t + 1000);
    expect(v).toBe("jump");
    t = stand(live, START, 5, t + 1000, 10);
    expect(live.state.objectives!.index).toBe(0);
    expect(live.counters.jumps).toBe(1);
  });

  it("gammal position används inte för infektion: >3 s utan fix pausar infektionen, >5 s pausar klockan", () => {
    const { live } = newLive("survival");
    // Placera en zombie rakt på spelaren och hoppa förbi huvudstarten.
    let t = 5_000_000;
    live.pushFix(fixAt(START, 5, t), t);
    live.resume(t);
    live.state.phase = "survival";
    t = stand(live, START, 5, t, 2);
    expect(live.quality(t)).toBe("ok");
    t += FIX_FRESH_MS + 500;
    expect(live.quality(t)).toBe("infection_paused");
    const before = live.state.elapsedSeconds;
    const t2 = t + 3000; // totalt >5 s utan fix
    for (let x = t; x <= t2; x += 200) live.tick(x);
    expect(live.quality(t2)).toBe("unavailable");
    // Klockan har stannat sedan fixen blev för gammal (högst ~5 s fortsatte efter sista fix).
    expect(live.state.elapsedSeconds - before).toBeLessThan(2.5);
  });

  it("infektion registreras inte av en zombie när fixen är gammal, men registreras med färska fixar", () => {
    const run = (staleAfterLastFix: boolean) => {
      const { live } = newLive("survival");
      let t = 6_000_000;
      live.pushFix(fixAt(START, 5, t), t);
      live.resume(t);
      live.state.phase = "survival";
      live.state.neutralUntilS = 0;
      // Zombie på samma kant som spelaren, 5 m bort.
      const z = live.state.zombies[0];
      const pos = live.filter.position!;
      let best = { d: Infinity, edgeId: "", distM: 0 };
      for (const e of live.g.edges.values()) for (let d = 0; d <= e.lengthM; d += 2) {
        const ll = pointAlong(e.geometry, e.cumM, d);
        const dd = haversineM(ll, pos);
        if (dd < best.d && dd > 3) best = { d: dd, edgeId: e.id, distM: d };
      }
      z.edgeId = best.edgeId; z.distanceAlongEdgeM = best.distM; z.speedMps = 0; z.state = "patrol"; z.route = [];
      live.state.zombies = [z];
      expect(haversineM(zombieLatLon(live.g, z), pos)).toBeLessThan(15);
      if (staleAfterLastFix) {
        // En fix, därefter tystnad i 4 s (3 s färsk gräns, 5 s otillgänglig).
        for (let x = t; x < t + 4500; x += 200) live.tick(x);
        return live.state.infectionProgressSeconds;
      }
      t = stand(live, pos, 5, t, 6);
      return live.state.result === "infected" ? 3 : live.state.infectionProgressSeconds;
    };
    const fresh = run(false);
    expect(fresh).toBeGreaterThanOrEqual(3); // med färska fixar leder kontakt till infektion
    const stale = run(true);
    expect(stale).toBeLessThan(2.7); // högst FIX_FRESH_MS (2,5 s) kan ha räknats från en enda fix
    expect(stale).toBeLessThan(3); // alltså ingen infektion från en enda fix
  });

  it("bortfall och återhämtning: klockan står still, räknare uppdateras, spelet fortsätter", () => {
    const { live } = newLive("mission");
    clearZombies(live);
    let t = 7_000_000;
    live.pushFix(fixAt(START, 5, t), t);
    live.resume(t);
    t = stand(live, START, 5, t, 10);
    const e1 = live.state.elapsedSeconds;
    // 20 s utan fix.
    for (let k = 0; k < 100; k++) { t += 200; live.tick(t); }
    const e2 = live.state.elapsedSeconds;
    expect(e2 - e1).toBeLessThan(6);
    t = stand(live, START, 5, t, 5);
    expect(live.counters.dropouts).toBe(1);
    expect(live.counters.longestDropoutS).toBeGreaterThan(10);
    expect(live.state.elapsedSeconds).toBeGreaterThan(e2 + 3);
    expect(live.state.phase).not.toBe("finished");
  });

  it("fryst app (>5 s mellan tick) pausar och går inte att fortsätta utan färsk position", () => {
    const { live } = newLive("mission");
    clearZombies(live);
    let t = 8_000_000;
    live.pushFix(fixAt(START, 5, t), t);
    live.resume(t);
    t = stand(live, START, 5, t, 3);
    const e = live.state.elapsedSeconds;
    t += 60_000; // skärmlås
    live.tick(t);
    expect(live.state.paused).toBe(true);
    expect(live.counters.freezes).toBe(1);
    expect(live.state.elapsedSeconds).toBe(e);
    expect(live.resume(t)).toBe(false); // ingen färsk fix
    live.pushFix(fixAt(START, 5, t + 500), t + 500);
    expect(live.resume(t + 500)).toBe(true);
    expect(live.state.neutralUntilS).toBeGreaterThan(live.state.elapsedSeconds); // neutral period efter paus
  });

  it("ogiltiga och gamla fixar påverkar inte spelet", () => {
    const { live } = newLive("mission");
    let t = 9_000_000;
    expect(live.pushFix({ latitude: 999, longitude: 0, accuracyM: 5, timestampMs: t }, t)).toBe("invalid");
    expect(live.pushFix({ latitude: START.lat, longitude: START.lon, accuracyM: 5, timestampMs: t - 60_000 }, t)).toBe("stale");
    expect(live.filter.position).toBeNull();
    expect(live.counters.accepted).toBe(0);
  });
});
