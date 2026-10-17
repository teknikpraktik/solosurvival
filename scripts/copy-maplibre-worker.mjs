// MapLibre 6 laddar sin worker som separat ES-modul. Turbopack paketerar den inte, så vi serverar den statiskt.
import { cpSync, mkdirSync } from "node:fs";
const src = "node_modules/maplibre-gl/dist";
mkdirSync("public/maplibre", { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) cpSync(`${src}/${f}`, `public/maplibre/${f}`);
