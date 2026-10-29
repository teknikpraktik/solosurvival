import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
/** @type {import('next').NextConfig} */
export default { reactStrictMode: true, turbopack: { root }, outputFileTracingRoot: root };
