/**
 * Lokalt produktionsskript för ElevenLabs. Standard är torrkörning: inga API-anrop, bara plan och kostnad.
 *
 *   npx tsx audio-production/generate.ts --pack sample                 # torrkörning av provpaketet (12 filer)
 *   npx tsx audio-production/generate.ts --product mini --pack core    # torrkörning, Minis ljud för befintliga händelser
 *   npx tsx audio-production/generate.ts --id adult.vo.game_start.1 --voice <voiceId> --live
 *   npx tsx audio-production/generate.ts --approve adult.vo.game_start.1:2
 *
 * Se audio-production/README.md och docs/ELEVENLABS-WORKFLOW.md. Nyckeln läses bara från ELEVENLABS_API_KEY och bara vid --live.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  approve, emptyManifest, forbiddenEnvironment, plan, reject, run, select, sumCost, validate,
  type Catalog, type Manifest, type PlanRow, type Product, type Voices,
} from "./lib";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");
const MANIFEST = path.join(HERE, "manifest.json");
const OUT = "audio-production/output";

const USAGE = `Usage: npx tsx audio-production/generate.ts [selection] [options]

Selection (nothing is selected without one of these):
  --pack <name>         sample | core (events that exist in code) | all | a pack in catalog.json
  --id <id>             sound id (all variants) or variant id; repeatable
  --product <p>         adult | mini (filters the selection)

Options:
  --live                call the ElevenLabs API (default: dry run, no calls)
  --yes                 skip the interactive confirmation (still needs --live)
  --max-credits <n>     refuse if the estimate is higher (default 1500)
  --accept-uncertain-cost  allow items whose price could not be computed reliably
  --voice <voiceId>     voice for all voice lines in the selection (one product only)
  --model <modelId>     text-to-speech model, e.g. eleven_multilingual_v2, eleven_v3
  --sfx-model <modelId> sound effects model (default eleven_text_to_sound_v2)
  --format <fmt>        output format (default mp3_44100_128)
  --regenerate          make a new take even if an approved or pending one exists
  --list                list all sound and variant ids
  --validate            only validate catalog.json and voices.json

Review:
  --approve <variantId>[:take]   mark a take approved and copy it to its place in public/
  --reject <variantId>:take      mark a take rejected
`;

interface Args {
  packs: string[]; ids: string[]; product?: Product; live: boolean; yes: boolean; maxCredits: number; acceptUncertain: boolean;
  voice?: string; model?: string; sfxModel?: string; format?: string; regenerate: boolean; list: boolean; validateOnly: boolean;
  approve?: string; reject?: string; help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { packs: [], ids: [], live: false, yes: false, maxCredits: 1500, acceptUncertain: false, regenerate: false, list: false, validateOnly: false, help: false };
  const need = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    switch (f) {
      case "--pack": a.packs.push(need(i, f)); i++; break;
      case "--id": a.ids.push(need(i, f)); i++; break;
      case "--product": {
        const p = need(i, f); i++;
        if (p !== "adult" && p !== "mini") throw new Error("--product must be adult or mini");
        a.product = p; break;
      }
      case "--live": a.live = true; break;
      case "--yes": a.yes = true; break;
      case "--max-credits": a.maxCredits = Number(need(i, f)); i++; if (!(a.maxCredits >= 0)) throw new Error("--max-credits must be a number"); break;
      case "--accept-uncertain-cost": a.acceptUncertain = true; break;
      case "--voice": a.voice = need(i, f); i++; break;
      case "--model": a.model = need(i, f); i++; break;
      case "--sfx-model": a.sfxModel = need(i, f); i++; break;
      case "--format": a.format = need(i, f); i++; break;
      case "--regenerate": a.regenerate = true; break;
      case "--list": a.list = true; break;
      case "--validate": a.validateOnly = true; break;
      case "--approve": a.approve = need(i, f); i++; break;
      case "--reject": a.reject = need(i, f); i++; break;
      case "-h": case "--help": a.help = true; break;
      default: throw new Error(`Unknown argument: ${f}`);
    }
  }
  if (a.packs.length > 1) throw new Error("Only one --pack at a time");
  if (a.packs.length && a.ids.length) throw new Error("Use either --pack or --id, not both");
  return a;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}
const saveManifest = (m: Manifest) => writeFile(MANIFEST, JSON.stringify(m, null, 2) + "\n");

const fmtCredits = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "unknown");
const fmtUsd = (n: number) => (Number.isFinite(n) ? `$${n.toFixed(3)}` : "unknown");

function printPlan(rows: PlanRow[]): void {
  const w = Math.max(10, ...rows.map((r) => r.item.variantId.length));
  console.log(`${"variant".padEnd(w)}  action         size        credits  usd      text`);
  for (const r of rows) {
    const c = r.cost;
    const size = c ? (c.chars ? `${c.chars} chars` : `${c.seconds} s`) : "";
    const text = r.item.variant.text.length > 60 ? r.item.variant.text.slice(0, 57) + "..." : r.item.variant.text;
    console.log(`${r.item.variantId.padEnd(w)}  ${r.action.padEnd(13)}  ${size.padEnd(10)}  ${(c ? fmtCredits(c.credits) : "").padStart(7)}  ${(c ? fmtUsd(c.usd) : "").padEnd(7)}  ${text}${c && !c.certain ? "  (uncertain price)" : ""}`);
    if (r.action !== "generate" && r.action !== "skip-approved") console.log(`${"".padEnd(w)}  ↳ ${r.reason}`);
  }
  const gen = rows.filter((r) => r.action === "generate");
  const blocked = rows.filter((r) => r.action === "blocked");
  const line = (label: string, rs: PlanRow[]) => {
    const sum = sumCost(rs.flatMap((r) => (r.cost ? [r.cost] : [])));
    console.log(`${label}: ${sum.chars} characters + ${Math.round(sum.seconds * 10) / 10} s of sound effects ≈ ${fmtCredits(sum.credits)} credits ≈ ${fmtUsd(sum.usd)} (API pay-as-you-go)${sum.certain ? "" : " – UNCERTAIN, see docs/ELEVENLABS-WORKFLOW.md"}`);
  };
  console.log(`\n${gen.length} to generate, ${blocked.length} blocked, ${rows.length - gen.length - blocked.length} skipped.`);
  line("Estimate now", gen);
  if (blocked.length) line("Estimate incl. blocked (once voices are chosen)", [...gen, ...blocked]);
  console.log("Each regeneration costs the same again.");
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim().toLowerCase() === "yes"; } finally { rl.close(); }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return 0; }
  const cat = await readJson<Catalog>(path.join(HERE, "catalog.json"));
  const voices = await readJson<Voices>(path.join(HERE, "voices.json"));
  const errors = validate(cat, voices);
  if (errors.length) { console.error("catalog.json / voices.json are invalid:\n  " + errors.join("\n  ")); return 2; }
  if (args.validateOnly) { console.log(`OK: ${cat.sounds.length} sounds, ${cat.sounds.reduce((a, s) => a + s.variants.length, 0)} files.`); return 0; }
  let manifest = existsSync(MANIFEST) ? await readJson<Manifest>(MANIFEST) : emptyManifest();

  if (args.list) {
    for (const s of cat.sounds) console.log(`${s.id.padEnd(34)} ${s.product.padEnd(5)} ${s.type.padEnd(7)} ${s.priority} ${s.trigger.padEnd(15)} variants: ${s.variants.map((v) => v.n).join(",")}`);
    console.log(`\nPacks: ${[...Object.keys(cat.packs), "core", "all"].join(", ")}`);
    return 0;
  }

  if (args.approve || args.reject) {
    const [variant, takeStr] = (args.approve ?? args.reject)!.split(":");
    const take = takeStr === undefined ? undefined : Number(takeStr);
    if (args.reject) {
      if (take === undefined) throw new Error("--reject needs <variantId>:<take>");
      manifest = reject(manifest, variant, take);
      await saveManifest(manifest);
      console.log(`Rejected ${variant} take ${take}.`);
      return 0;
    }
    const item = select(cat, { ids: [variant] }).find((i) => i.variantId === variant);
    if (!item) throw new Error(`${variant} is not a variant id (use e.g. ${variant}.1)`);
    const r = approve(manifest, variant, take);
    const src = path.join(ROOT, r.take.file);
    if (!existsSync(src)) throw new Error(`Take file is missing: ${r.take.file}`);
    const dest = path.join(ROOT, item.target);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    await saveManifest(r.manifest);
    console.log(`Approved ${variant} take ${r.take.take} -> ${item.target} (served as ${item.url}). Commit the file and manifest.json.`);
    return 0;
  }

  if (!args.packs.length && !args.ids.length) { console.log(USAGE); console.log("Nothing selected: pass --pack or --id."); return 1; }
  const items = select(cat, { product: args.product, pack: args.packs[0], ids: args.ids });
  if (!items.length) { console.log("The selection is empty."); return 1; }
  if (args.voice) {
    const products = new Set(items.filter((i) => i.sound.type === "voice").map((i) => i.sound.product));
    if (products.size > 1) throw new Error("--voice would apply to both products' voice lines; add --product adult or --product mini");
  }
  const rows = plan(items, cat, voices, manifest, { voiceId: args.voice, ttsModel: args.model, sfxModel: args.sfxModel, outputFormat: args.format, regenerate: args.regenerate });
  console.log(args.live ? "LIVE RUN: the API will be called after confirmation.\n" : "DRY RUN: no API calls. Add --live to generate.\n");
  printPlan(rows);

  const gen = rows.filter((r) => r.action === "generate");
  if (!args.live) return 0;
  if (!gen.length) { console.log("Nothing to generate."); return 0; }
  const blocked = rows.filter((r) => r.action === "blocked");
  if (blocked.length) { console.error(`\n${blocked.length} item(s) are blocked (see above). Fix them or narrow the selection.`); return 1; }
  const env = forbiddenEnvironment(process.env);
  if (env) { console.error(`\nRefusing to call the API: ${env} is set (CI, deployment or tests).`); return 1; }
  const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
  if (!apiKey) { console.error("\nELEVENLABS_API_KEY is not set."); return 1; }
  const sum = sumCost(gen.map((r) => r.cost!));
  if (!sum.certain && !args.acceptUncertain) { console.error("\nThe cost of this selection is uncertain. Review it and pass --accept-uncertain-cost to continue."); return 1; }
  if (!(sum.credits <= args.maxCredits)) { console.error(`\nEstimate ${fmtCredits(sum.credits)} credits is above --max-credits ${args.maxCredits}.`); return 1; }
  if (!args.yes && !(await confirm(`\nGenerate ${gen.length} file(s) for about ${fmtCredits(sum.credits)} credits (${fmtUsd(sum.usd)})? Type "yes": `))) { console.log("Cancelled."); return 1; }

  const res = await run(rows, manifest, {
    apiKey, fetch, now: () => new Date(), log: (l) => console.log(l), outDir: OUT,
    mkdir: async (d) => { await mkdir(path.join(ROOT, d), { recursive: true }); },
    writeFile: (f, data) => writeFile(path.join(ROOT, f), data),
  });
  await saveManifest(res.manifest);
  console.log(`\n${res.made.length} file(s) generated and recorded in audio-production/manifest.json as pending. Listen in ${OUT}/ and approve with --approve.`);
  if (res.error) { console.error(`Stopped: ${res.error}`); return 1; }
  return 0;
}

main().then((code) => { process.exitCode = code; }, (err: Error) => { console.error(`Error: ${err.message}`); process.exitCode = 1; });
