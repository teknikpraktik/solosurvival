/** Minimal IndexedDB-omslutning (inga beroenden). En databas, flera objektlager med string-nycklar. */
export const DB_NAME = "outbreak";
export const DB_VERSION = 2;
/** v2: `recaps` and `recapChunks` (match recap, play/recap.ts). */
export const STORES = ["tiles", "matches", "history", "logs", "meta", "recaps", "recapChunks"] as const;
export type StoreName = (typeof STORES)[number];

export interface KvStore<T = unknown> {
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  all(): Promise<T[]>;
  /** Values whose key starts with `prefix`, in key order. */
  range(prefix: string): Promise<T[]>;
  /** Deletes every entry whose key starts with `prefix`. */
  deleteRange(prefix: string): Promise<void>;
  clear(): Promise<void>;
}

export interface Db {
  store<T = unknown>(name: StoreName): KvStore<T>;
  close(): void;
}

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

export function openDb(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<Db> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      // Framtida schemaändringar läggs till här med if (event.oldVersion < n). Befintlig data tas aldrig bort här.
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("The database is blocked by another tab."));
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => db.close();
      resolve({
        close: () => db.close(),
        store<T>(storeName: StoreName): KvStore<T> {
          const tx = (mode: IDBTransactionMode) => db.transaction(storeName, mode).objectStore(storeName);
          return {
            get: (k) => req(tx("readonly").get(k)) as Promise<T | undefined>,
            put: async (k, v) => void (await req(tx("readwrite").put(v, k))),
            delete: async (k) => void (await req(tx("readwrite").delete(k))),
            all: () => req(tx("readonly").getAll()) as Promise<T[]>,
            range: (prefix) => req(tx("readonly").getAll(IDBKeyRange.bound(prefix, prefix + "\uffff"))) as Promise<T[]>,
            deleteRange: async (prefix) => void (await req(tx("readwrite").delete(IDBKeyRange.bound(prefix, prefix + "\uffff")))),
            clear: async () => void (await req(tx("readwrite").clear())),
          };
        },
      });
    };
  });
}

/** Försöker öppna databasen; returnerar null om IndexedDB saknas eller är blockerat (t.ex. privat läge). */
export async function tryOpenDb(factory?: IDBFactory, name = DB_NAME): Promise<Db | null> {
  try {
    const f = factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    return f ? await openDb(f, name) : null;
  } catch {
    return null;
  }
}
