/** The internal switch for the zombie AI with roles (PlaySession `zombieAi`): which matches get it, and that a restored match keeps its AI. */
import { readFileSync } from "node:fs";
import path from "node:path";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { TileStore, type Fetcher } from "@/data/store";
import { defaultParams } from "@/play/config";
import { openDb } from "@/play/idb";
import { PlaySession } from "@/play/session";
import type { ZombieAiModel } from "@/config/zombie-ai";
import type { ProductProfile } from "@/config/product";
import { OUTBREAK_PROFILE } from "@/config/product";
import type { LatLon } from "@/geo/geometry";
import type { GeoLike } from "@/gps/provider/provider";

const root = path.join(import.meta.dirname, "..", "..", "..", "public", "data", "v1", "varmland");
const fsFetch: Fetcher = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(root, url.replace(/^\/data\/v1\/varmland\//, "").replace(/\?.*$/, "")), "utf8")) });
const START: LatLon = { lat: 59.40731, lon: 13.46753 };
const MINI_LIKE: ProductProfile = { ...OUTBREAK_PROFILE, id: "mini-test", enemySpeedMultiplier: 0.8, activities: ["walk"], jumpScares: false };

async function session(o: { zombieAi?: ZombieAiModel; profile?: ProductProfile; db?: Awaited<ReturnType<typeof openDb>> }) {
  let ok: Parameters<GeoLike["watchPosition"]>[0] | null = null;
  const geo: GeoLike = { watchPosition: (a) => { ok = a; return 1; }, clearWatch: () => { ok = null; } };
  const fix = (p: LatLon, ts: number) => ok?.({ coords: { latitude: p.lat, longitude: p.lon, accuracy: 5, speed: null, heading: null }, timestamp: ts });
  const db = o.db ?? (await openDb(new IDBFactory()));
  let clock = 50_000_000;
  const timers: (() => void)[] = [];
  const s = new PlaySession({ geo, db, store: new TileStore("/data/v1/varmland", fsFetch), now: () => clock, setInterval: (fn) => { timers.push(fn); return 1; }, clearInterval: () => undefined, random: () => 0.1, profile: o.profile, zombieAi: o.zombieAi });
  s.startLocating();
  for (let i = 0; i < 3; i++) { fix(START, clock); clock += 1000; }
  const advance = (ms: number) => { for (let i = 0; i < ms; i += 200) { clock += 200; timers.forEach((f) => f()); if (i % 1000 === 0) fix(START, clock); } };
  return { s, db, advance };
}

describe("PlaySession zombieAi (internal switch)", () => {
  it("new Free Play matches get the AI with roles and keep it when restored; without the switch nothing changes", async () => {
    const { s, db, advance } = await session({ zombieAi: "roles" });
    expect((await s.prepare({ ...defaultParams("walk"), mode: "survival", seed: 3 }))?.status).toBe("ok");
    expect(await s.startMatch()).toBe(true);
    expect(s.live!.rules.zombieAi).toBe("roles");
    expect(s.params?.zombieAi).toBe("roles");
    expect(s.live!.state.zombies.filter((z) => z.role === "interceptor").length).toBeGreaterThan(0);
    advance(20_000);
    await new Promise((r) => setTimeout(r, 50));
    // The app is closed and opened again without the switch (or after it was removed): the saved match keeps the AI it began with.
    const again = await session({ db });
    const out = await again.s.restoreActive();
    expect(out?.ok).toBe(true);
    expect(again.s.live!.rules.zombieAi).toBe("roles");

    const plain = await session({});
    await plain.s.prepare({ ...defaultParams("walk"), mode: "survival", seed: 3 });
    expect(await plain.s.startMatch()).toBe(true);
    expect(plain.s.live!.rules.zombieAi).toBeUndefined();
    expect(plain.s.live!.state.zombies.every((z) => z.role === undefined)).toBe(true);
  }, 60000);

  it("a Mini Outbreak-like profile without the switch keeps the old AI", async () => {
    const { s } = await session({ profile: MINI_LIKE });
    await s.prepare({ ...defaultParams("walk"), mode: "survival", seed: 3 });
    expect(await s.startMatch()).toBe(true);
    expect(s.live!.rules.zombieAi).toBeUndefined();
    expect(s.params?.zombieAi).toBeUndefined();
  }, 60000);
});
