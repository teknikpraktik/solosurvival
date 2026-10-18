import type { LatLon } from "@/geo/geometry";
import { decodeTile, tileKey, tilesInRadius, type TileFile, type TileManifest, type TileWay } from "./tile-format";

/** Persistent tile-cache (IndexedDB i webbläsaren). Nyckeln innehåller dataVersion. */
export interface TileCache {
  get(key: string): Promise<TileFile | undefined>;
  put(key: string, tile: TileFile): Promise<void>;
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface LoadStats {
  tiles: number;
  fromCache: number;
  fromNetwork: number;
  missing: number;
  /** Överförda bytes (komprimerad storlek enligt manifestet) – uppskattning för nätverkstiles. */
  networkGzipBytes: number;
  ms: number;
}

export class TileStore {
  private manifest?: TileManifest;
  private memory = new Map<string, TileWay[]>();
  private inflight = new Map<string, Promise<TileWay[] | null>>();

  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: Fetcher,
    private readonly cache?: TileCache,
  ) {}

  /** Manifestet hämtas alltid färskt (servern svarar med must-revalidate). */
  async loadManifest(): Promise<TileManifest> {
    const r = await this.fetcher(`${this.baseUrl}/manifest.json`);
    if (!r.ok) throw new Error(`Map data could not be loaded (${r.status})`);
    const m = (await r.json()) as TileManifest;
    if (this.manifest && this.manifest.dataVersion !== m.dataVersion) this.memory.clear();
    this.manifest = m;
    return m;
  }

  get dataVersion(): string | undefined {
    return this.manifest?.dataVersion;
  }

  covers(p: LatLon): boolean {
    const b = this.manifest?.bbox;
    return !!b && p.lat >= b[0] && p.lat <= b[2] && p.lon >= b[1] && p.lon <= b[3];
  }

  private async loadTile(ty: number, tx: number, stats: LoadStats): Promise<TileWay[] | null> {
    const m = this.manifest!;
    const key = `${m.dataVersion}/${tileKey(ty, tx)}`;
    const mem = this.memory.get(key);
    if (mem) return mem;
    const running = this.inflight.get(key);
    if (running) return running;
    const entry = m.tiles.find((t) => t[0] === ty && t[1] === tx);
    if (!entry) {
      stats.missing++;
      return null;
    }
    const job = (async () => {
      let file = await this.cache?.get(key).catch(() => undefined);
      if (file) stats.fromCache++;
      else {
        const r = await this.fetcher(`${this.baseUrl}/t/${tileKey(ty, tx)}.json?v=${m.dataVersion}`);
        if (!r.ok) throw new Error(`Map tile ${tileKey(ty, tx)} could not be loaded (${r.status})`);
        file = (await r.json()) as TileFile;
        stats.fromNetwork++;
        stats.networkGzipBytes += entry[4];
        void this.cache?.put(key, file).catch(() => undefined);
      }
      const ways = decodeTile(file, m.tile.coordUnitDeg);
      this.memory.set(key, ways);
      return ways;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  /** Läser bara de tiles som behövs för cirkeln. Ways som ligger i flera tiles dedupliceras på id. */
  async loadAround(center: LatLon, radiusM: number): Promise<{ ways: TileWay[]; stats: LoadStats }> {
    if (!this.manifest) await this.loadManifest();
    const t0 = Date.now();
    const keys = tilesInRadius(center, radiusM, this.manifest!.tile);
    const stats: LoadStats = { tiles: keys.length, fromCache: 0, fromNetwork: 0, missing: 0, networkGzipBytes: 0, ms: 0 };
    const results = await Promise.all(keys.map(([ty, tx]) => this.loadTile(ty, tx, stats)));
    const byId = new Map<string, TileWay>();
    for (const r of results) for (const w of r ?? []) byId.set(w.id, w);
    stats.ms = Date.now() - t0;
    return { ways: [...byId.values()], stats };
  }
}
