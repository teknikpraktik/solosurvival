import { createHash } from "node:crypto";

/**
 * Ljudproduktion med ElevenLabs: katalog, urval, kostnadsuppskattning, plan och generering. Ingen modul här läser miljövariabler,
 * nätverk eller filsystem på egen hand: allt sådant injiceras (se generate.ts), så att tester kan köra utan nätverk och utan nyckel.
 * Körs aldrig av appen, bygget eller CI; filerna som produceras är statiska och kopieras in i public/ först efter godkännande.
 */

export type Product = "adult" | "mini";
export type SoundType = "voice" | "enemy" | "effect" | "ambient";
export type Priority = "P0" | "P1" | "P2" | "P3" | "P4";
export type Trigger = "existing" | "existing-silent" | "proposed";

export interface Variant { n: number; key?: string; text: string }
export interface Sound {
  id: string;
  product: Product;
  type: SoundType;
  event: string;
  trigger: Trigger;
  priority: Priority;
  cooldownS: number;
  durationS: number;
  volume: number;
  interrupts: "none" | "lower" | "same-or-lower";
  random: boolean;
  voice?: string;
  file: string;
  sfx?: { promptInfluence?: number; loop?: boolean };
  notes?: string;
  variants: Variant[];
}
export interface Catalog {
  schemaVersion: number;
  products: Record<Product, { publicDir: string; urlPrefix: string }>;
  priorities: Record<Priority, string>;
  pricing: {
    tts: Record<string, { usdPer1kChars: number; creditsPerChar: number; creditsCertain: boolean }>;
    sfx: Record<string, { creditsPerSecond: number; creditsCertain: boolean; usdPerMinute: number; usdCertain: boolean }>;
  };
  defaults: { outputFormat: string; ttsModel: string; sfxModel: string; sfxPromptInfluence: number };
  packs: Record<string, string[]>;
  sounds: Sound[];
}
export interface VoiceProfile {
  product: Product;
  voiceId: string | null;
  voiceName: string | null;
  modelId: string;
  languageCode: string | null;
  seed: number | null;
  voiceSettings: Record<string, number | boolean>;
}
export interface Voices { schemaVersion: number; profiles: Record<string, VoiceProfile> }

export interface Take {
  take: number;
  file: string;
  paramsHash: string;
  params: RequestParams;
  sha256: string;
  bytes: number;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  /** Svarshuvuden från ElevenLabs som hjälper spårning (t.ex. request-id, character-cost), om de fanns. */
  response?: Record<string, string>;
}
export interface Manifest { schemaVersion: 1; entries: Record<string, { takes: Take[]; approvedTake: number | null }> }

/** En genererbar fil: en variant av ett ljud. */
export interface Item {
  variantId: string;
  sound: Sound;
  variant: Variant;
  /** Sökväg i repot där den godkända filen hamnar. */
  target: string;
  /** URL i appen (cachas av service workern under /audio/). */
  url: string;
}

export type RequestParams =
  | { kind: "tts"; endpoint: string; voiceId: string; outputFormat: string; body: { text: string; model_id: string; voice_settings: Record<string, number | boolean>; seed?: number; language_code?: string } }
  | { kind: "sfx"; endpoint: string; outputFormat: string; body: { text: string; model_id: string; duration_seconds: number; prompt_influence: number; loop: boolean } };

export const API_BASE = "https://api.elevenlabs.io";
export const SAFE_ID = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
/** Ord som inte får förekomma i Mini-texter (skräck, våld, och 'run' som uppmanar barn att springa i trafik). */
export const MINI_FORBIDDEN = /\b(run|running|kill|dead|death|die|blood|scream|screaming|terror|horror|scary|creepy|infected)\b/i;

export const variantId = (s: Sound, v: Variant): string => `${s.id}.${v.n}`;

export function expand(cat: Catalog): Item[] {
  const out: Item[] = [];
  for (const s of cat.sounds) {
    const p = cat.products[s.product];
    for (const v of s.variants) {
      const rel = `${s.file}-${v.n}.mp3`;
      out.push({ variantId: variantId(s, v), sound: s, variant: v, target: `${p.publicDir}/${rel}`, url: `${p.urlPrefix}/${rel}` });
    }
  }
  return out;
}

/** Kontrollerar katalog och röstprofiler. Returnerar en lista med fel (tom = giltig). */
export function validate(cat: Catalog, voices: Voices): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const targets = new Set<string>();
  for (const s of cat.sounds) {
    const at = `sound ${s.id}`;
    if (!SAFE_ID.test(s.id)) errors.push(`${at}: id must be lowercase dotted (a-z, 0-9, _)`);
    if (!s.id.startsWith(`${s.product}.`)) errors.push(`${at}: id must start with its product`);
    if (ids.has(s.id)) errors.push(`${at}: duplicate id`);
    ids.add(s.id);
    if (!cat.priorities[s.priority]) errors.push(`${at}: unknown priority ${s.priority}`);
    if (!(s.volume > 0 && s.volume <= 1)) errors.push(`${at}: volume must be in (0, 1]`);
    if (!(s.cooldownS >= 0)) errors.push(`${at}: cooldownS must be >= 0`);
    if (!(s.durationS > 0)) errors.push(`${at}: durationS must be > 0`);
    if (!/^[a-z]+\/[a-z0-9-]+$/.test(s.file)) errors.push(`${at}: file must look like 'dir/name'`);
    if (!s.variants.length) errors.push(`${at}: no variants`);
    if (s.type === "voice") {
      if (!s.voice || !voices.profiles[s.voice]) errors.push(`${at}: unknown voice profile ${s.voice}`);
      else if (voices.profiles[s.voice].product !== s.product) errors.push(`${at}: voice profile ${s.voice} belongs to another product`);
      if (s.sfx) errors.push(`${at}: a voice has no sfx settings`);
    } else {
      if (s.voice) errors.push(`${at}: only voices have a voice profile`);
      // ElevenLabs: duration_seconds 0.5–30.
      if (!(s.durationS >= 0.5 && s.durationS <= 30)) errors.push(`${at}: sound effect duration must be 0.5–30 s`);
      const pi = s.sfx?.promptInfluence;
      if (pi !== undefined && !(pi >= 0 && pi <= 1)) errors.push(`${at}: promptInfluence must be 0–1`);
    }
    const ns = new Set<number>();
    for (const v of s.variants) {
      if (!Number.isInteger(v.n) || v.n < 1) errors.push(`${at}: variant n must be a positive integer`);
      if (ns.has(v.n)) errors.push(`${at}: duplicate variant ${v.n}`);
      ns.add(v.n);
      const text = v.text.trim();
      if (!text) errors.push(`${at}.${v.n}: empty text`);
      if (/[^\x20-\x7e]/.test(v.text)) errors.push(`${at}.${v.n}: text must be plain ASCII English`);
      if (s.type === "voice" && text.length > 120) errors.push(`${at}.${v.n}: voice line longer than 120 characters`);
      if (s.type !== "voice" && text.length > 450) errors.push(`${at}.${v.n}: sound prompt longer than 450 characters`);
      if (s.product === "mini" && s.type === "voice" && MINI_FORBIDDEN.test(text)) errors.push(`${at}.${v.n}: word not allowed in Mini voice lines`);
    }
  }
  for (const it of expand(cat)) {
    if (targets.has(it.target)) errors.push(`${it.variantId}: target file ${it.target} is used twice`);
    targets.add(it.target);
  }
  const vids = new Set(expand(cat).map((i) => i.variantId));
  for (const [name, list] of Object.entries(cat.packs)) {
    if (name === "core" || name === "all") errors.push(`pack ${name}: name is reserved`);
    for (const id of list) if (!vids.has(id) && !ids.has(id)) errors.push(`pack ${name}: unknown id ${id}`);
  }
  for (const [name, p] of Object.entries(voices.profiles)) {
    if (p.voiceId !== null && !/^[A-Za-z0-9]{8,40}$/.test(p.voiceId)) errors.push(`voice ${name}: voiceId looks wrong`);
    if (!cat.pricing.tts[p.modelId]) errors.push(`voice ${name}: model ${p.modelId} has no price in catalog.pricing.tts (cost would be unknown)`);
  }
  return errors;
}

export interface Selection { product?: Product; pack?: string; ids?: string[] }

/**
 * Väljer filer. `pack`: ett namngivet paket i katalogen, "core" (ljud för händelser som redan finns i koden) eller "all".
 * `ids`: ljud-id (alla varianter) eller variant-id. Utan pack och ids väljs ingenting – en tom körning är säkrare än allt.
 */
export function select(cat: Catalog, sel: Selection): Item[] {
  const items = expand(cat);
  let chosen: Item[];
  if (sel.ids?.length) {
    const want = new Set(sel.ids);
    for (const id of want) if (!items.some((i) => i.variantId === id || i.sound.id === id)) throw new Error(`Unknown sound or variant id: ${id}`);
    chosen = items.filter((i) => want.has(i.variantId) || want.has(i.sound.id));
  } else if (sel.pack === "all") chosen = items;
  else if (sel.pack === "core") chosen = items.filter((i) => i.sound.trigger !== "proposed");
  else if (sel.pack) {
    const list = cat.packs[sel.pack];
    if (!list) throw new Error(`Unknown pack: ${sel.pack} (available: ${[...Object.keys(cat.packs), "core", "all"].join(", ")})`);
    const want = new Set(list);
    chosen = items.filter((i) => want.has(i.variantId) || want.has(i.sound.id));
  } else chosen = [];
  return sel.product ? chosen.filter((i) => i.sound.product === sel.product) : chosen;
}

export interface Overrides { voiceId?: string; ttsModel?: string; sfxModel?: string; outputFormat?: string }

/** Bygger exakt de parametrar som skickas (utan nyckel). null + orsak när något saknas. */
export function buildParams(it: Item, cat: Catalog, voices: Voices, o: Overrides = {}): { params: RequestParams } | { blocked: string } {
  const s = it.sound;
  const outputFormat = o.outputFormat ?? cat.defaults.outputFormat;
  if (s.type === "voice") {
    const prof = voices.profiles[s.voice!];
    const voiceId = o.voiceId ?? prof.voiceId;
    if (!voiceId) return { blocked: `no voiceId for profile ${s.voice} (set it in voices.json or pass --voice)` };
    const body: Extract<RequestParams, { kind: "tts" }>["body"] = { text: it.variant.text, model_id: o.ttsModel ?? prof.modelId, voice_settings: { ...prof.voiceSettings } };
    if (prof.seed !== null) body.seed = prof.seed + it.variant.n;
    if (prof.languageCode) body.language_code = prof.languageCode;
    return { params: { kind: "tts", endpoint: `/v1/text-to-speech/${voiceId}`, voiceId, outputFormat, body } };
  }
  return {
    params: {
      kind: "sfx", endpoint: "/v1/sound-generation", outputFormat,
      body: { text: it.variant.text, model_id: o.sfxModel ?? cat.defaults.sfxModel, duration_seconds: s.durationS, prompt_influence: s.sfx?.promptInfluence ?? cat.defaults.sfxPromptInfluence, loop: s.sfx?.loop ?? false },
    },
  };
}

/** Stabil JSON (sorterade nycklar) så att samma parametrar alltid ger samma hash. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const paramsHash = (p: RequestParams): string => createHash("sha256").update(stableJson(p)).digest("hex").slice(0, 16);

export interface Cost { chars: number; seconds: number; credits: number; usd: number; certain: boolean; note?: string }

/** Uppskattad kostnad för en generering. `certain` = false när priset för modellen saknas eller enheten är osäker. */
export function estimate(p: RequestParams, cat: Catalog): Cost {
  if (p.kind === "tts") {
    const chars = p.body.text.length;
    const price = cat.pricing.tts[p.body.model_id];
    if (!price) return { chars, seconds: 0, credits: NaN, usd: NaN, certain: false, note: `no price for model ${p.body.model_id}` };
    return { chars, seconds: 0, credits: chars * price.creditsPerChar, usd: (chars / 1000) * price.usdPer1kChars, certain: price.creditsCertain };
  }
  const price = cat.pricing.sfx[p.body.model_id];
  const seconds = p.body.duration_seconds;
  if (!price) return { chars: 0, seconds, credits: NaN, usd: NaN, certain: false, note: `no price for model ${p.body.model_id}` };
  return { chars: 0, seconds, credits: seconds * price.creditsPerSecond, usd: (seconds / 60) * price.usdPerMinute, certain: price.creditsCertain && price.usdCertain };
}

export function sumCost(costs: Cost[]): Cost {
  return costs.reduce((a, c) => ({ chars: a.chars + c.chars, seconds: a.seconds + c.seconds, credits: a.credits + c.credits, usd: a.usd + c.usd, certain: a.certain && c.certain }), { chars: 0, seconds: 0, credits: 0, usd: 0, certain: true });
}

export type Action = "generate" | "skip-approved" | "skip-pending" | "skip-stale" | "blocked";
export interface PlanRow { item: Item; action: Action; reason: string; params?: RequestParams; hash?: string; cost?: Cost }

/**
 * Vad som skulle hända för varje vald fil. Inget genereras om en tagning med samma parametrar redan finns (godkänd eller väntande),
 * och en godkänd fil med ändrade parametrar markeras 'skip-stale' – den byts aldrig automatiskt. `regenerate` ger alltid en ny tagning.
 */
export function plan(items: Item[], cat: Catalog, voices: Voices, manifest: Manifest, opts: Overrides & { regenerate?: boolean } = {}): PlanRow[] {
  return items.map((item): PlanRow => {
    const b = buildParams(item, cat, voices, opts);
    if ("blocked" in b) {
      // Still show what it would cost once the voice is chosen (the price does not depend on the voice).
      const est = buildParams(item, cat, voices, { ...opts, voiceId: "voice_not_chosen" });
      return { item, action: "blocked", reason: b.blocked, cost: "params" in est ? estimate(est.params, cat) : undefined };
    }
    const hash = paramsHash(b.params);
    const cost = estimate(b.params, cat);
    const base = { item, params: b.params, hash, cost };
    const e = manifest.entries[item.variantId];
    if (opts.regenerate || !e) return { ...base, action: "generate", reason: opts.regenerate ? "regenerate requested" : "new" };
    const approved = e.takes.find((t) => t.take === e.approvedTake);
    if (approved && approved.paramsHash === hash) return { ...base, action: "skip-approved", reason: `approved take ${approved.take}` };
    if (approved) return { ...base, action: "skip-stale", reason: `approved take ${approved.take} was made with other parameters; use --regenerate to make a new take` };
    const same = e.takes.find((t) => t.paramsHash === hash && t.status === "pending");
    if (same) return { ...base, action: "skip-pending", reason: `take ${same.take} with the same parameters awaits review` };
    return { ...base, action: "generate", reason: "parameters changed since last take" };
  });
}

export interface RunDeps {
  apiKey: string;
  fetch: typeof fetch;
  writeFile: (path: string, data: Uint8Array | string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  now: () => Date;
  log: (line: string) => void;
  /** Katalog för tagningar, t.ex. "audio-production/output". */
  outDir: string;
}

const KEEP_HEADERS = ["request-id", "x-request-id", "history-item-id", "character-cost", "x-character-count", "content-type"];

/** Fel från API:t, med nyckeln bortfiltrerad om den mot förmodan skulle ekas tillbaka. */
export class ApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

export function redact(s: string, key: string): string {
  return key ? s.split(key).join("[redacted]") : s;
}

function explain(status: number): string {
  if (status === 401) return "the API key was rejected (401)";
  if (status === 402) return "the account has too few credits or the plan does not allow this (402)";
  if (status === 403) return "forbidden: the plan, voice or output format is not allowed for this account (403)";
  if (status === 404) return "not found: check the voice ID and model (404)";
  if (status === 422) return "the request was invalid (422)";
  if (status === 429) return "rate limited or too many concurrent requests (429); wait and run again – nothing is retried automatically";
  return `HTTP ${status}`;
}

/**
 * Genererar raderna med action "generate", en i taget. Stoppar vid första fel (inga automatiska omförsök); det som redan har
 * genererats är sparat och registrerat i manifestet. Returnerar manifestet med nya tagningar som "pending".
 */
export async function run(rows: PlanRow[], manifest: Manifest, d: RunDeps): Promise<{ manifest: Manifest; made: Take[]; error?: string }> {
  const made: Take[] = [];
  const m: Manifest = structuredClone(manifest);
  for (const r of rows) {
    if (r.action !== "generate" || !r.params || !r.hash) continue;
    const p = r.params;
    const url = `${API_BASE}${p.endpoint}?output_format=${encodeURIComponent(p.outputFormat)}`;
    let res: Response;
    try {
      res = await d.fetch(url, { method: "POST", headers: { "xi-api-key": d.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" }, body: JSON.stringify(p.body) });
    } catch (err) {
      return { manifest: m, made, error: redact(`${r.item.variantId}: network error: ${(err as Error).message}`, d.apiKey) };
    }
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 500); } catch { /* ingen kropp */ }
      return { manifest: m, made, error: redact(`${r.item.variantId}: ${explain(res.status)}${detail ? ` – ${detail}` : ""}`, d.apiKey) };
    }
    const type = res.headers.get("content-type") ?? "";
    if (type && !type.startsWith("audio/") && !type.startsWith("application/octet-stream")) {
      return { manifest: m, made, error: `${r.item.variantId}: expected audio, got ${type}` };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 256) return { manifest: m, made, error: `${r.item.variantId}: response too small (${bytes.length} bytes)` };
    const entry = (m.entries[r.item.variantId] ??= { takes: [], approvedTake: null });
    const takeNo = entry.takes.reduce((a, t) => Math.max(a, t.take), 0) + 1;
    const dir = `${d.outDir}/${r.item.sound.product}/${r.item.variantId}`;
    const file = `${dir}/take-${takeNo}.mp3`;
    const response: Record<string, string> = {};
    for (const h of KEEP_HEADERS) { const v = res.headers.get(h); if (v) response[h] = v; }
    const take: Take = {
      take: takeNo, file, paramsHash: r.hash, params: p, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
      createdAt: d.now().toISOString(), status: "pending", response,
    };
    await d.mkdir(dir);
    await d.writeFile(file, bytes);
    await d.writeFile(`${dir}/take-${takeNo}.json`, JSON.stringify({ variantId: r.item.variantId, target: r.item.target, estimate: r.cost, ...take }, null, 2) + "\n");
    entry.takes.push(take);
    made.push(take);
    d.log(`generated ${r.item.variantId} take ${takeNo} (${bytes.length} bytes) -> ${file}`);
  }
  return { manifest: m, made };
}

/** Markerar en tagning som godkänd (övriga tagningar för varianten behåller sin status). Returnerar tagningen. */
export function approve(manifest: Manifest, variant: string, take?: number): { manifest: Manifest; take: Take } {
  const m: Manifest = structuredClone(manifest);
  const e = m.entries[variant];
  if (!e || !e.takes.length) throw new Error(`No takes recorded for ${variant}`);
  const t = take === undefined ? e.takes[e.takes.length - 1] : e.takes.find((x) => x.take === take);
  if (!t) throw new Error(`No take ${take} for ${variant}`);
  for (const x of e.takes) if (x.status === "approved") x.status = "pending";
  t.status = "approved";
  e.approvedTake = t.take;
  return { manifest: m, take: t };
}

export function reject(manifest: Manifest, variant: string, take: number): Manifest {
  const m: Manifest = structuredClone(manifest);
  const t = m.entries[variant]?.takes.find((x) => x.take === take);
  if (!t) throw new Error(`No take ${take} for ${variant}`);
  t.status = "rejected";
  if (m.entries[variant].approvedTake === take) m.entries[variant].approvedTake = null;
  return m;
}

export const emptyManifest = (): Manifest => ({ schemaVersion: 1, entries: {} });

/** Miljöer där API-anrop aldrig får ske (CI, Vercel, tester). */
export function forbiddenEnvironment(env: Record<string, string | undefined>): string | null {
  for (const k of ["CI", "GITHUB_ACTIONS", "VERCEL", "VERCEL_ENV", "VITEST", "NEXT_PHASE"]) if (env[k]) return k;
  return null;
}
