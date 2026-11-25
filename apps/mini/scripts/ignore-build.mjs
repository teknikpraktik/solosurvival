// Avgör om en commit behöver bygga om Mini Outbreak. Används som Vercels ignoreCommand (apps/mini/vercel.json) och i CI.
// Utgångskod enligt Vercels konvention: 0 = hoppa över bygget, 1 = bygg.
//
// Relevant för barnappen är:
//  - allt under apps/mini/,
//  - delade byggfiler i roten (package.json, package-lock.json, build-id.mjs, .vercelignore),
//  - kartdatan i public/data/ (kopieras av scripts/prepare.mjs),
//  - varje fil i repo-roten som barnappen faktiskt importerar, direkt eller transitivt (via "@/…" eller relativa sökvägar).
// En ändring i vuxenappens egna filer (övriga src/, public/, scripts/, e2e/ …) bygger alltså inte om barnappen.
//
// Ändrade filer tas från git om historiken finns, annars från GitHubs compare-API (repo-rotens .vercelignore tar bort .git i Vercel).
// Allt som är osäkert (ingen tidigare SHA, nätverksfel, för stor diff) leder till att bygget körs.
//
// Bas och topp: --base/--head, annars VERCEL_GIT_PREVIOUS_SHA (senaste lyckade driftsättningen) och VERCEL_GIT_COMMIT_SHA.
// --ci: för CI-jobbet räknas även barnappens tester och e2e (och det de importerar). Utan --ci (Vercel) räknas bara det som
// hamnar i bygget: apps/mini/tests/, apps/mini/e2e/ och README påverkar inte en driftsättning.
// --list skriver ut filerna utanför apps/mini som räknas som relevanta och avslutar.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const app = path.resolve(import.meta.dirname, "..");
const root = path.resolve(app, "../..");
const rel = (p) => path.relative(root, p).split(path.sep).join("/");

const SHARED_FILES = new Set(["package.json", "package-lock.json", "build-id.mjs", ".vercelignore"]);
const SHARED_DIRS = ["apps/mini/", "public/data/"];
const CI = process.argv.includes("--ci");
// Barnappens filer som inte ingår i ett Vercel-bygge.
const NOT_IN_BUILD = /^apps\/mini\/(tests\/|e2e\/|README\.md$|scripts\/make-icons\.mts$)/;
const CODE = /\.(m?[jt]sx?|mts|cts|cjs)$/;
const EXTS = ["", ".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".json", "/index.ts", "/index.tsx", "/index.js"];
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bnew\s+URL\s*\(\s*)["'`]([^"'`]+)["'`]/g;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function decide(build, why) {
  console.log(`mini ignore-build: ${build ? "BYGG" : "HOPPA ÖVER"} (${why})`);
  process.exit(build ? 1 : 0);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function resolve(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return undefined; // paket: täcks av package-lock.json
  for (const ext of EXTS) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return undefined;
}

/** Filer utanför apps/mini som barnappen importerar, transitivt. */
function importedRootFiles() {
  const seen = new Set();
  const queue = walk(app).filter((p) => CODE.test(p) && (CI || !NOT_IN_BUILD.test(rel(p))));
  for (const p of queue) seen.add(p);
  while (queue.length) {
    const file = queue.pop();
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(IMPORT)) {
      const target = resolve(m[1], file);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      if (CODE.test(target)) queue.push(target);
    }
  }
  return new Set([...seen].map(rel).filter((f) => !f.startsWith("apps/mini/")));
}

function isRelevant(file, imported) {
  if (!CI && NOT_IN_BUILD.test(file)) return false;
  return SHARED_FILES.has(file) || SHARED_DIRS.some((d) => file.startsWith(d)) || imported.has(file);
}

function changedFromGit(base, head) {
  try {
    const out = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return out.toString().split("\n").filter(Boolean);
  } catch {
    return undefined;
  }
}

async function changedFromGitHub(base, head) {
  const owner = process.env.VERCEL_GIT_REPO_OWNER ?? "teknikpraktik";
  const repo = process.env.VERCEL_GIT_REPO_SLUG ?? "solosurvival";
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "mini-ignore-build" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}?per_page=300`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return undefined;
    const body = await res.json();
    const files = body.files ?? [];
    // GitHub listar högst 300 filer per jämförelse: en större diff kan sakna relevanta filer.
    if (files.length >= 300) return undefined;
    return files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean));
  } catch {
    return undefined;
  }
}

const imported = importedRootFiles();
if (process.argv.includes("--list")) {
  for (const f of [...imported].sort()) console.log(f);
  process.exit(0);
}

const base = arg("--base") ?? process.env.VERCEL_GIT_PREVIOUS_SHA;
const head = arg("--head") ?? process.env.VERCEL_GIT_COMMIT_SHA;
if (!base || !head || /^0+$/.test(base)) decide(true, "ingen tidigare commit att jämföra med");
if (base === head) decide(true, "samma commit som förra bygget");

const changed = changedFromGit(base, head) ?? (await changedFromGitHub(base, head));
if (!changed) decide(true, `kunde inte avgöra ändrade filer ${base.slice(0, 7)}...${head.slice(0, 7)}`);

const hits = changed.filter((f) => isRelevant(f, imported));
if (hits.length) decide(true, `${hits.length} relevanta ändringar, t.ex. ${hits.slice(0, 5).join(", ")}`);
decide(false, `${changed.length} ändrade filer, ingen påverkar Mini Outbreak`);
