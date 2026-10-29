// Förbereder Mini Outbreaks public/ före dev/build (allt som skapas här är gitignorerat):
//  - MapLibre-workern (samma som scripts/copy-maplibre-worker.mjs i roten),
//  - kartdatan från repo-rotens public/data (samma tiles som OUTBREAK; kopieras så att de inte dubbleras i git),
//  - public/version.json med bygg-id (samma som scripts/stamp-build.mjs i roten).
// Inga andra filer från vuxenappens public/ kopieras: skräckbilder och skräckljud finns aldrig i den här appen.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildId } from "../../../build-id.mjs";

const app = path.resolve(import.meta.dirname, "..");
const root = path.resolve(app, "../..");
const pub = path.join(app, "public");

mkdirSync(path.join(pub, "maplibre"), { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) cpSync(path.join(root, "node_modules/maplibre-gl/dist", f), path.join(pub, "maplibre", f));

rmSync(path.join(pub, "data"), { recursive: true, force: true });
cpSync(path.join(root, "public/data"), path.join(pub, "data"), { recursive: true });

const info = { id: buildId(), builtAt: new Date().toISOString() };
writeFileSync(path.join(pub, "version.json"), JSON.stringify(info) + "\n");
console.log("mini prepare:", info.id);
