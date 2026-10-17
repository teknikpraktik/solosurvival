import type { TileCache } from "@/data/store";
import type { TileFile } from "@/data/tile-format";
import type { Db } from "./idb";

/** Persistent tile-cache i IndexedDB. Nyckeln innehåller dataVersion, så ny data aldrig blandas med gammal. */
export class IdbTileCache implements TileCache {
  constructor(private readonly db: Db) {}
  get(key: string) { return this.db.store<TileFile>("tiles").get(key); }
  put(key: string, tile: TileFile) { return this.db.store<TileFile>("tiles").put(key, tile); }
  /** Tar bort tiles från äldre datauppsättningar. */
  async purgeOthers(currentVersion: string): Promise<void> {
    // all() ger bara värden; nycklar kan inte läsas via vårt enkla gränssnitt, så rensa bara när versionen bytts.
    const meta = this.db.store<string>("meta");
    const prev = await meta.get("tileDataVersion");
    if (prev && prev !== currentVersion) await this.db.store("tiles").clear();
    await meta.put("tileDataVersion", currentVersion);
  }
}
