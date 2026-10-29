import path from "node:path";
import { buildId } from "../../build-id.mjs";

/**
 * Mini Outbreak. Delad kod (motor, GPS, karta) importeras från repo-rotens src/ via "@/…" (tsconfig.json), så Turbopack måste få
 * kompilera filer utanför den här katalogen: `turbopack.root` är repo-roten. Beroendena (next, react, maplibre-gl) installeras bara i
 * repo-roten (npm ci där) och löses upp därifrån, så delad kod och barnappen använder samma React-instans.
 */
const root = path.resolve(import.meta.dirname, "../..");

const SECURITY = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
];
const cache = (value) => [{ key: "Cache-Control", value }];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: { root },
  outputFileTracingRoot: root,
  env: { NEXT_PUBLIC_BUILD_ID: buildId() },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY },
      { source: "/data/v1/:region/manifest.json", headers: cache("public, max-age=0, must-revalidate") },
      { source: "/data/v1/:region/t/:file", headers: cache("public, max-age=31536000, immutable") },
      { source: "/version.json", headers: cache("no-store") },
      { source: "/sw.js", headers: [...cache("no-cache, no-store, must-revalidate"), { key: "Service-Worker-Allowed", value: "/" }] },
      { source: "/manifest.webmanifest", headers: cache("public, max-age=3600") },
      { source: "/audio/:file", headers: cache("public, max-age=604800") },
      { source: "/icons/:file", headers: cache("public, max-age=604800") },
      { source: "/maplibre/:file", headers: cache("public, max-age=3600, must-revalidate") },
    ];
  },
};
export default nextConfig;
