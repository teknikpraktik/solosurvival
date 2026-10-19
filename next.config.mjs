import { buildId } from "./build-id.mjs";

const SECURITY = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Plats tillåts bara för vår egen origin; kamera/mikrofon används inte.
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
];
const cache = (value) => [{ key: "Cache-Control", value }];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: buildId() },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY },
      // Kartdata: manifestet valideras alltid; tiles hämtas med ?v=<dataVersion> och kan cachas "för evigt".
      { source: "/data/v1/:region/manifest.json", headers: cache("public, max-age=0, must-revalidate") },
      { source: "/data/v1/:region/t/:file", headers: cache("public, max-age=31536000, immutable") },
      // Version och service worker får aldrig serveras gamla.
      { source: "/version.json", headers: cache("no-store") },
      { source: "/sw.js", headers: [...cache("no-cache, no-store, must-revalidate"), { key: "Service-Worker-Allowed", value: "/" }] },
      { source: "/manifest.webmanifest", headers: cache("public, max-age=3600") },
      { source: "/img/:file", headers: cache("public, max-age=604800") },
      { source: "/audio/:file", headers: cache("public, max-age=604800") },
      { source: "/icons/:file", headers: cache("public, max-age=604800") },
      // Filnamn utan hash: revalidera.
      { source: "/maplibre/:file", headers: cache("public, max-age=3600, must-revalidate") },
    ];
  },
};
export default nextConfig;
