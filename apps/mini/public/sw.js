/* Mini Outbreak service worker (samma upplägg som OUTBREAK: public/sw.js i repo-roten) – enkel och försiktig.
 * - Cachar bara statiska filer (hashade /_next/static, ikoner, MapLibre-worker) så att appen startar snabbare.
 * - Sidor hämtas nätverk-först med reserv i cachen om nätet saknas en stund. Detta är INTE en offline-garanti.
 * - Kartdata (/data/) hanteras av appens egen IndexedDB-cache, inte här. /version.json och /sw.js cachas aldrig.
 * - Ny version väntar tills spelaren väljer att uppdatera (SKIP_WAITING); aldrig mitt i en match.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const STATIC = "mini-outbreak-static-v1";
const PAGES = "mini-outbreak-pages-" + VERSION;

self.addEventListener("install", () => {
  // Ingen skipWaiting här: den nya versionen aktiveras först när appen ber om det.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) {
        if (k !== STATIC && k !== PAGES) await caches.delete(k);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

const isStatic = (url) =>
  url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/maplibre/") || url.pathname.startsWith("/audio/") || url.pathname.startsWith("/img/") || url.pathname.startsWith("/brand/") || url.pathname === "/manifest.webmanifest";

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/data/") || url.pathname === "/version.json" || url.pathname === "/sw.js") return;

  if (isStatic(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC);
        const hit = await cache.match(req);
        const hashed = url.pathname.startsWith("/_next/static/");
        if (hit && hashed) return hit; // innehållshashade filer ändras aldrig
        const net = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; });
        if (hit) { event.waitUntil(net.catch(() => undefined)); return hit; }
        return net;
      })(),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGES);
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 5000);
          const r = await fetch(req, { signal: ctrl.signal });
          clearTimeout(timer);
          if (r.ok) cache.put(req, r.clone());
          return r;
        } catch {
          return (await cache.match(req)) || (await cache.match("/")) || Response.error();
        }
      })(),
    );
  }
});
