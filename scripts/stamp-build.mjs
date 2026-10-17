// Skriver public/version.json (hämtas av klienten för att upptäcka en ny version). Bygg-id: Vercels commit, annars git, annars "dev".
import { mkdirSync, writeFileSync } from "node:fs";
import { buildId } from "../build-id.mjs";

const info = { id: buildId(), builtAt: new Date().toISOString() };
mkdirSync("public", { recursive: true });
writeFileSync("public/version.json", JSON.stringify(info) + "\n");
console.log("stamp-build:", info.id);
